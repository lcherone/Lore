const DEFAULT_REQUESTS_PER_HOUR = 1_000;
const DEFAULT_RESERVE_RATIO = 0.1;
const DEFAULT_MAX_RATE_LIMIT_RETRIES = 5;
const MINIMUM_SECONDARY_LIMIT_DELAY_MS = 60_000;
const RESET_BUFFER_MS = 1_000;

type GitHubHeaders = Record<string, string | number | undefined>;

interface GitHubResponse<T> {
  data: T;
  headers?: GitHubHeaders;
}

interface GitHubErrorDetails {
  status?: number;
  message: string;
  headers: GitHubHeaders;
}

export type GitHubRequestWaitReason =
  | "configured-pace"
  | "quota-pace"
  | "quota-reserve"
  | "primary-rate-limit"
  | "secondary-rate-limit";

export interface GitHubRequestWait {
  reason: GitHubRequestWaitReason;
  delayMs: number;
  resumeAt: string;
}

export interface GitHubRequestPacerOptions {
  requestsPerHour?: number;
  reserveRatio?: number;
  maxRateLimitRetries?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  onWait?: (wait: GitHubRequestWait) => void;
}

const sleep = async (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

const finiteInteger = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;

const header = (headers: GitHubHeaders, name: string): string | undefined => {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = match?.[1];
  return value === undefined ? undefined : String(value);
};

const headerNumber = (headers: GitHubHeaders, name: string): number | undefined => {
  const value = Number(header(headers, name));
  return Number.isFinite(value) ? value : undefined;
};

const errorDetails = (error: unknown): GitHubErrorDetails => {
  if (!error || typeof error !== "object") {
    return { message: error instanceof Error ? error.message : String(error), headers: {} };
  }
  const candidate = error as {
    status?: unknown;
    message?: unknown;
    response?: { status?: unknown; headers?: unknown };
  };
  const rawHeaders = candidate.response?.headers;
  const headers = rawHeaders && typeof rawHeaders === "object"
    ? rawHeaders as GitHubHeaders
    : {};
  const statusValue = candidate.status ?? candidate.response?.status;
  const status = typeof statusValue === "number" ? statusValue : undefined;
  return {
    ...(status === undefined ? {} : { status }),
    message: typeof candidate.message === "string" ? candidate.message : "GitHub request failed",
    headers
  };
};

const retryAfterMs = (headers: GitHubHeaders, now: number): number | undefined => {
  const value = header(headers, "retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
};

const resetDelayMs = (headers: GitHubHeaders, now: number): number | undefined => {
  const resetSeconds = headerNumber(headers, "x-ratelimit-reset");
  if (resetSeconds === undefined) return undefined;
  return Math.max(0, resetSeconds * 1_000 - now) + RESET_BUFFER_MS;
};

export const resolveGitHubRequestsPerHour = (value: string | undefined): number => {
  if (!value?.trim()) return DEFAULT_REQUESTS_PER_HOUR;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 15_000) {
    throw new Error("GITHUB_REQUESTS_PER_HOUR must be an integer between 1 and 15000");
  }
  return parsed;
};

/**
 * Serialises GitHub requests and deliberately spreads them across the hour.
 * Response headers can slow the configured pace further or reserve the final
 * part of a shared credential's quota for interactive use.
 */
export class GitHubRequestPacer {
  readonly #minimumIntervalMs: number;
  readonly #reserveRatio: number;
  readonly #maximumRetries: number;
  readonly #now: () => number;
  readonly #sleep: (delayMs: number) => Promise<void>;
  readonly #onWait?: (wait: GitHubRequestWait) => void;
  #nextRequestAt = 0;
  #nextWaitReason: "configured-pace" | "quota-pace" | "quota-reserve" = "configured-pace";
  #tail: Promise<void> = Promise.resolve();

  public constructor(options: GitHubRequestPacerOptions = {}) {
    const requestsPerHour = finiteInteger(options.requestsPerHour, DEFAULT_REQUESTS_PER_HOUR);
    this.#minimumIntervalMs = Math.ceil(3_600_000 / requestsPerHour);
    this.#reserveRatio = typeof options.reserveRatio === "number" && options.reserveRatio >= 0 && options.reserveRatio < 1
      ? options.reserveRatio
      : DEFAULT_RESERVE_RATIO;
    this.#maximumRetries = finiteInteger(options.maxRateLimitRetries, DEFAULT_MAX_RATE_LIMIT_RETRIES);
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? sleep;
    this.#onWait = options.onWait;
  }

  async request<T>(
    operation: () => Promise<GitHubResponse<T>>,
    onWait?: (wait: GitHubRequestWait) => void
  ): Promise<GitHubResponse<T>> {
    let release: (() => void) | undefined;
    const predecessor = this.#tail;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      return await this.#requestWithRetries(operation, onWait);
    } finally {
      release?.();
    }
  }

  async #requestWithRetries<T>(
    operation: () => Promise<GitHubResponse<T>>,
    onWait?: (wait: GitHubRequestWait) => void
  ): Promise<GitHubResponse<T>> {
    let rateLimitAttempt = 0;
    while (true) {
      await this.#waitForTurn(onWait);
      try {
        const response = await operation();
        this.#observe(response.headers ?? {});
        return response;
      } catch (error) {
        const details = errorDetails(error);
        this.#observe(details.headers);
        const retry = this.#retry(details, rateLimitAttempt);
        if (!retry || rateLimitAttempt >= this.#maximumRetries) throw error;
        rateLimitAttempt += 1;
        await this.#wait(
          Math.max(retry.delayMs, this.#nextRequestAt - this.#now()),
          retry.reason,
          onWait
        );
        this.#nextRequestAt = this.#now();
        this.#nextWaitReason = "configured-pace";
      }
    }
  }

  async #waitForTurn(onWait?: (wait: GitHubRequestWait) => void): Promise<void> {
    const delayMs = Math.max(0, this.#nextRequestAt - this.#now());
    if (delayMs > 0) await this.#wait(delayMs, this.#nextWaitReason, onWait);
  }

  #observe(headers: GitHubHeaders): void {
    const now = this.#now();
    this.#deferUntil(now + this.#minimumIntervalMs, "configured-pace");
    const limit = headerNumber(headers, "x-ratelimit-limit");
    const remaining = headerNumber(headers, "x-ratelimit-remaining");
    const resetMs = resetDelayMs(headers, now);
    if (limit === undefined || remaining === undefined || resetMs === undefined) return;

    const reserve = Math.max(1, Math.ceil(limit * this.#reserveRatio));
    const usableRemaining = remaining - reserve;
    if (usableRemaining <= 0) {
      this.#deferUntil(now + resetMs, "quota-reserve");
      return;
    }
    const quotaIntervalMs = Math.ceil(resetMs / usableRemaining);
    this.#deferUntil(now + quotaIntervalMs, "quota-pace");
  }

  #deferUntil(timestamp: number, reason: "configured-pace" | "quota-pace" | "quota-reserve"): void {
    if (timestamp <= this.#nextRequestAt) return;
    this.#nextRequestAt = timestamp;
    this.#nextWaitReason = reason;
  }

  #retry(
    details: GitHubErrorDetails,
    attempt: number
  ): { reason: "primary-rate-limit" | "secondary-rate-limit"; delayMs: number } | undefined {
    if (details.status !== 403 && details.status !== 429) return undefined;
    const remaining = headerNumber(details.headers, "x-ratelimit-remaining");
    const primary = remaining === 0;
    const secondary = details.status === 429
      || header(details.headers, "retry-after") !== undefined
      || /secondary rate limit|abuse detection/i.test(details.message);
    if (!primary && !secondary) return undefined;

    if (primary) {
      return {
        reason: "primary-rate-limit",
        delayMs: resetDelayMs(details.headers, this.#now()) ?? MINIMUM_SECONDARY_LIMIT_DELAY_MS
      };
    }
    return {
      reason: "secondary-rate-limit",
      delayMs: retryAfterMs(details.headers, this.#now())
        ?? MINIMUM_SECONDARY_LIMIT_DELAY_MS * (2 ** attempt)
    };
  }

  async #wait(
    delayMs: number,
    reason: GitHubRequestWaitReason,
    onWait?: (wait: GitHubRequestWait) => void
  ): Promise<void> {
    if (reason === "quota-reserve" || reason === "primary-rate-limit" || reason === "secondary-rate-limit") {
      const wait = {
        reason,
        delayMs,
        resumeAt: new Date(this.#now() + delayMs).toISOString()
      };
      this.#onWait?.(wait);
      onWait?.(wait);
    }
    await this.#sleep(delayMs);
  }
}
