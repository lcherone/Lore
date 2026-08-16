import { describe, expect, it, vi } from "vitest";
import { GitHubRequestPacer, resolveGitHubRequestsPerHour } from "@lore/github/index.js";

const rateLimitError = (
  status: number,
  message: string,
  headers: Record<string, string>
): Error & { status: number; response: { status: number; headers: Record<string, string> } } =>
  Object.assign(new Error(message), { status, response: { status, headers } });

describe("GitHub request pacing", () => {
  it("defaults to a conservative 1,000 request hourly budget", () => {
    expect(resolveGitHubRequestsPerHour(undefined)).toBe(1_000);
    expect(resolveGitHubRequestsPerHour("5000")).toBe(5_000);
    expect(() => resolveGitHubRequestsPerHour("0")).toThrow(/between 1 and 15000/);
  });

  it("serialises requests and spaces them at the configured hourly rate", async () => {
    let now = 0;
    let active = 0;
    let maximumActive = 0;
    const waits: number[] = [];
    const pacer = new GitHubRequestPacer({
      requestsPerHour: 1_000,
      now: () => now,
      sleep: async (delayMs) => {
        waits.push(delayMs);
        now += delayMs;
      }
    });
    const request = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return { data: "ok" };
    });

    await Promise.all([pacer.request(request), pacer.request(request), pacer.request(request)]);

    expect(maximumActive).toBe(1);
    expect(waits).toEqual([3_600, 3_600]);
  });

  it("slows further from remaining and reset headers", async () => {
    let now = 0;
    const waits: number[] = [];
    const pacer = new GitHubRequestPacer({
      requestsPerHour: 1_000,
      now: () => now,
      sleep: async (delayMs) => {
        waits.push(delayMs);
        now += delayMs;
      }
    });

    await pacer.request(async () => ({
      data: "first",
      headers: {
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "1000",
        "x-ratelimit-reset": "3600"
      }
    }));
    await pacer.request(async () => ({ data: "second" }));

    expect(waits).toEqual([7_202]);
  });

  it("waits until the primary reset and continues the same request", async () => {
    let now = 0;
    const waits: number[] = [];
    const events: string[] = [];
    const requestEvents: string[] = [];
    let attempt = 0;
    const pacer = new GitHubRequestPacer({
      requestsPerHour: 15_000,
      now: () => now,
      sleep: async (delayMs) => {
        waits.push(delayMs);
        now += delayMs;
      },
      onWait: (wait) => events.push(wait.reason)
    });

    const response = await pacer.request(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw rateLimitError(403, "API rate limit exceeded", {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "10"
        });
      }
      return { data: "continued" };
    }, (wait) => requestEvents.push(wait.reason));

    expect(response.data).toBe("continued");
    expect(waits).toEqual([11_000]);
    expect(events).toEqual(["primary-rate-limit"]);
    expect(requestEvents).toEqual(["primary-rate-limit"]);
  });

  it("honours Retry-After for secondary rate limits", async () => {
    let now = 0;
    const waits: number[] = [];
    let attempt = 0;
    const pacer = new GitHubRequestPacer({
      requestsPerHour: 15_000,
      now: () => now,
      sleep: async (delayMs) => {
        waits.push(delayMs);
        now += delayMs;
      }
    });

    await pacer.request(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw rateLimitError(429, "secondary rate limit", { "retry-after": "2" });
      }
      return { data: "continued" };
    });

    expect(waits).toEqual([2_000]);
  });
});
