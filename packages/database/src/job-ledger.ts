import type { Prisma, PrismaClient } from "@prisma/client";
import type { JobEventRecord, JobRunRecord, JobRunState, LoreJobName } from "@lore/shared/types.js";
import { newUuid } from "@lore/shared/ids.js";

export interface PendingJobDispatch {
  runId: string;
  name: LoreJobName;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

export interface JobLedger {
  enqueue(input: {
    organisationId: string;
    repositoryId?: string;
    name: LoreJobName;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    maximumAttempts?: number;
  }): Promise<JobRunRecord>;
  markDispatched(runId: string, externalJobId: string): Promise<void>;
  markDispatchFailure(runId: string, error: unknown): Promise<void>;
  pending(limit?: number): Promise<PendingJobDispatch[]>;
  markRunning(input: {
    runId?: string;
    organisationId: string;
    repositoryId?: string;
    name: LoreJobName;
    externalJobId: string;
    attempt: number;
    maximumAttempts: number;
  }): Promise<string>;
  markSucceeded(runId: string, result: unknown): Promise<void>;
  markFailed(runId: string, error: unknown, terminal: boolean): Promise<void>;
  list(organisationId: string, limit?: number): Promise<JobRunRecord[]>;
}

const errorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error))
    .replace(/\b(?:github_pat_|gh[opusr]_)[A-Za-z0-9_]+/gi, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]+/gi, "[REDACTED_OPENAI_KEY]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\s+/g, " ")
    .slice(0, 2_000);

const summaryValue = (value: unknown): string | number | boolean | null => {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return typeof value === "string" ? value.slice(0, 500) : value as number | boolean | null;
  }
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  return "[details omitted]";
};

const summary = (value: unknown): Record<string, unknown> => {
  if (value === null || value === undefined) return { value: "" };
  if (Array.isArray(value)) return { items: summaryValue(value) };
  if (typeof value !== "object") return { value: summaryValue(value) };
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 50)
      .map(([key, item]) => [key, summaryValue(item)])
  );
};

type PrismaRun = Awaited<ReturnType<PrismaClient["jobRun"]["findFirst"]>>;

export class PrismaJobLedger implements JobLedger {
  public constructor(private readonly prisma: PrismaClient) {}

  async enqueue(input: {
    organisationId: string;
    repositoryId?: string;
    name: LoreJobName;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    maximumAttempts?: number;
  }): Promise<JobRunRecord> {
    const run = await this.prisma.jobRun.upsert({
      where: {
        organisationId_idempotencyKey: {
          organisationId: input.organisationId,
          idempotencyKey: input.idempotencyKey
        }
      },
      create: {
        organisationId: input.organisationId,
        repositoryId: input.repositoryId,
        name: input.name,
        idempotencyKey: input.idempotencyKey,
        maximumAttempts: input.maximumAttempts ?? 3,
        events: { create: { state: "queued", message: "Dispatch intent persisted" } },
        outbox: {
          create: {
            name: input.name,
            payload: input.payload as Prisma.InputJsonValue,
            idempotencyKey: input.idempotencyKey
          }
        }
      },
      update: {},
      include: { events: { orderBy: { createdAt: "asc" } } }
    });
    return this.#map(run);
  }

  async markDispatched(runId: string, externalJobId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.jobRun.update({
        where: { id: runId },
        data: {
          state: "dispatched",
          externalJobId,
          events: { create: { state: "dispatched", message: "Accepted by the job transport" } }
        }
      }),
      this.prisma.jobDispatchOutbox.update({
        where: { jobRunId: runId },
        data: { dispatchedAt: new Date(), lastError: null, dispatchTries: { increment: 1 } }
      })
    ]);
  }

  async markDispatchFailure(runId: string, error: unknown): Promise<void> {
    const message = errorMessage(error);
    const outbox = await this.prisma.jobDispatchOutbox.findUnique({ where: { jobRunId: runId } });
    const tries = (outbox?.dispatchTries ?? 0) + 1;
    const delay = Math.min(60_000, 1_000 * (2 ** Math.min(tries, 6)));
    await this.prisma.$transaction([
      this.prisma.jobDispatchOutbox.update({
        where: { jobRunId: runId },
        data: {
          dispatchTries: { increment: 1 },
          lastError: message,
          nextAttemptAt: new Date(Date.now() + delay)
        }
      }),
      this.prisma.jobEvent.create({
        data: { jobRunId: runId, state: "queued", message: "Transport unavailable; dispatch will be retried", metadata: { error: message } }
      })
    ]);
  }

  async pending(limit = 50): Promise<PendingJobDispatch[]> {
    const records = await this.prisma.jobDispatchOutbox.findMany({
      where: { dispatchedAt: null, nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: "asc" },
      take: Math.min(Math.max(limit, 1), 100)
    });
    return records.map((record) => ({
      runId: record.jobRunId,
      name: record.name as LoreJobName,
      payload: record.payload as Record<string, unknown>,
      idempotencyKey: record.idempotencyKey
    }));
  }

  async markRunning(input: {
    runId?: string;
    organisationId: string;
    repositoryId?: string;
    name: LoreJobName;
    externalJobId: string;
    attempt: number;
    maximumAttempts: number;
  }): Promise<string> {
    const existing = input.runId
      ? await this.prisma.jobRun.findFirst({ where: { id: input.runId, organisationId: input.organisationId } })
      : undefined;
    const state: JobRunState = input.attempt > 1 ? "retrying" : "running";
    const run = existing
      ? await this.prisma.jobRun.update({
          where: { id: existing.id },
          data: {
            state,
            attempt: input.attempt,
            maximumAttempts: input.maximumAttempts,
            externalJobId: input.externalJobId,
            startedAt: existing.startedAt ?? new Date(),
            errorMessage: null,
            events: { create: { state, message: input.attempt > 1 ? `Attempt ${input.attempt} started` : "Worker started" } }
          }
        })
      : await this.prisma.jobRun.create({
          data: {
            organisationId: input.organisationId,
            repositoryId: input.repositoryId,
            name: input.name,
            state,
            idempotencyKey: `worker:${input.externalJobId}`,
            externalJobId: input.externalJobId,
            attempt: input.attempt,
            maximumAttempts: input.maximumAttempts,
            startedAt: new Date(),
            events: { create: { state, message: "Scheduled job started by worker" } }
          }
        });
    return run.id;
  }

  async markSucceeded(runId: string, result: unknown): Promise<void> {
    await this.prisma.jobRun.update({
      where: { id: runId },
      data: {
        state: "succeeded",
        finishedAt: new Date(),
        resultSummary: summary(result) as Prisma.InputJsonValue,
        errorMessage: null,
        events: { create: { state: "succeeded", message: "Job completed" } }
      }
    });
  }

  async markFailed(runId: string, error: unknown, terminal: boolean): Promise<void> {
    const state: JobRunState = terminal ? "dead_letter" : "retrying";
    const message = errorMessage(error);
    await this.prisma.jobRun.update({
      where: { id: runId },
      data: {
        state,
        errorMessage: message,
        ...(terminal ? { finishedAt: new Date() } : {}),
        events: { create: { state, message, metadata: { terminal } } }
      }
    });
  }

  async list(organisationId: string, limit = 100): Promise<JobRunRecord[]> {
    const runs = await this.prisma.jobRun.findMany({
      where: { organisationId },
      include: { events: { orderBy: { createdAt: "asc" } } },
      orderBy: { queuedAt: "desc" },
      take: Math.min(Math.max(limit, 1), 500)
    });
    return runs.map((run) => this.#map(run));
  }

  #map(run: NonNullable<PrismaRun> & { events?: Array<{ id: string; jobRunId: string; state: JobRunState; message: string | null; metadata: unknown; createdAt: Date }> }): JobRunRecord {
    return {
      id: run.id,
      organisationId: run.organisationId,
      ...(run.repositoryId ? { repositoryId: run.repositoryId } : {}),
      name: run.name as LoreJobName,
      state: run.state,
      idempotencyKey: run.idempotencyKey,
      ...(run.externalJobId ? { externalJobId: run.externalJobId } : {}),
      attempt: run.attempt,
      maximumAttempts: run.maximumAttempts,
      queuedAt: run.queuedAt.toISOString(),
      ...(run.startedAt ? { startedAt: run.startedAt.toISOString() } : {}),
      ...(run.finishedAt ? { finishedAt: run.finishedAt.toISOString() } : {}),
      updatedAt: run.updatedAt.toISOString(),
      ...(run.errorMessage ? { errorMessage: run.errorMessage } : {}),
      ...(run.resultSummary ? { resultSummary: run.resultSummary as Record<string, unknown> } : {}),
      ...(run.events ? { events: run.events.map((event): JobEventRecord => ({
        id: event.id,
        jobRunId: event.jobRunId,
        state: event.state,
        ...(event.message ? { message: event.message } : {}),
        metadata: event.metadata as Record<string, unknown>,
        createdAt: event.createdAt.toISOString()
      })) } : {})
    };
  }
}

export class InMemoryJobLedger implements JobLedger {
  readonly runs: JobRunRecord[] = [];
  readonly #pending = new Map<string, PendingJobDispatch>();

  async enqueue(input: { organisationId: string; repositoryId?: string; name: LoreJobName; payload: Record<string, unknown>; idempotencyKey: string; maximumAttempts?: number }): Promise<JobRunRecord> {
    const existing = this.runs.find((run) => run.organisationId === input.organisationId && run.idempotencyKey === input.idempotencyKey);
    if (existing) return structuredClone(existing);
    const now = new Date().toISOString();
    const run: JobRunRecord = {
      id: newUuid(), organisationId: input.organisationId, ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
      name: input.name, state: "queued", idempotencyKey: input.idempotencyKey, attempt: 0,
      maximumAttempts: input.maximumAttempts ?? 3, queuedAt: now, updatedAt: now,
      events: [{ id: newUuid(), jobRunId: "", state: "queued", message: "Dispatch intent persisted", metadata: {}, createdAt: now }]
    };
    run.events![0]!.jobRunId = run.id;
    this.runs.unshift(run);
    this.#pending.set(run.id, { runId: run.id, name: input.name, payload: structuredClone(input.payload), idempotencyKey: input.idempotencyKey });
    return structuredClone(run);
  }

  async markDispatched(runId: string, externalJobId: string): Promise<void> { this.#transition(runId, "dispatched", "Accepted by the job transport", { externalJobId }); this.#pending.delete(runId); }
  async markDispatchFailure(runId: string, error: unknown): Promise<void> { this.#event(runId, "queued", `Transport unavailable: ${errorMessage(error)}`); }
  async pending(limit = 50): Promise<PendingJobDispatch[]> { return [...this.#pending.values()].slice(0, limit).map((item) => structuredClone(item)); }
  async markRunning(input: { runId?: string; organisationId: string; repositoryId?: string; name: LoreJobName; externalJobId: string; attempt: number; maximumAttempts: number }): Promise<string> {
    let run = input.runId ? this.runs.find((item) => item.id === input.runId) : undefined;
    if (!run) run = await this.enqueue({
      organisationId: input.organisationId,
      ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
      name: input.name,
      payload: {},
      idempotencyKey: `worker:${input.externalJobId}`,
      maximumAttempts: input.maximumAttempts
    });
    run.attempt = input.attempt; run.maximumAttempts = input.maximumAttempts; run.startedAt ??= new Date().toISOString();
    this.#transition(run.id, input.attempt > 1 ? "retrying" : "running", "Worker started", { externalJobId: input.externalJobId });
    this.#pending.delete(run.id);
    return run.id;
  }
  async markSucceeded(runId: string, result: unknown): Promise<void> { this.#transition(runId, "succeeded", "Job completed", { resultSummary: summary(result), terminal: true }); }
  async markFailed(runId: string, error: unknown, terminal: boolean): Promise<void> { const run = this.#run(runId); run.errorMessage = errorMessage(error); this.#transition(runId, terminal ? "dead_letter" : "retrying", run.errorMessage, { terminal }); }
  async list(organisationId: string, limit = 100): Promise<JobRunRecord[]> { return structuredClone(this.runs.filter((run) => run.organisationId === organisationId).slice(0, limit)); }

  #run(id: string): JobRunRecord { const run = this.runs.find((item) => item.id === id); if (!run) throw new Error(`Unknown job run ${id}`); return run; }
  #event(id: string, state: JobRunState, message: string): void { const run = this.#run(id); const now = new Date().toISOString(); run.events ??= []; run.events.push({ id: newUuid(), jobRunId: id, state, message, metadata: {}, createdAt: now }); run.updatedAt = now; }
  #transition(id: string, state: JobRunState, message: string, details: { externalJobId?: string; resultSummary?: Record<string, unknown>; terminal?: boolean }): void {
    const run = this.#run(id); run.state = state; if (details.externalJobId) run.externalJobId = details.externalJobId; if (details.resultSummary) run.resultSummary = details.resultSummary; if (details.terminal) run.finishedAt = new Date().toISOString(); this.#event(id, state, message);
  }
}
