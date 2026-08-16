import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { JobDispatcher } from "@lore/core/index.js";

export const LORE_QUEUE_NAME = "lore-jobs";

export function createRedisConnection(redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379"): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

export class BullMqJobDispatcher implements JobDispatcher {
  readonly #connection: Redis;
  readonly #queue: Queue;

  public constructor(redisUrl?: string) {
    this.#connection = createRedisConnection(redisUrl);
    this.#queue = new Queue(LORE_QUEUE_NAME, { connection: this.#connection });
  }

  async health(): Promise<void> {
    const response = await this.#connection.ping();
    if (response !== "PONG") throw new Error("Redis did not answer PONG");
  }

  async dispatch(
    name: "repository.index" | "github.import" | "knowledge.extract" | "knowledge.health",
    payload: Record<string, unknown>,
    idempotencyKey: string
  ): Promise<{ id: string }> {
    const job = await this.#queue.add(name, payload, {
      jobId: idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "_"),
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000
    });
    return { id: String(job.id) };
  }

  async schedule(
    name: "github.import" | "knowledge.health",
    payload: Record<string, unknown>,
    schedulerId: string,
    everyMs: number
  ): Promise<{ id: string }> {
    const id = schedulerId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const job = await this.#queue.upsertJobScheduler(
      id,
      { every: everyMs },
      {
        name,
        data: payload,
        opts: {
          attempts: 3,
          backoff: { type: "exponential", delay: 2_000 },
          removeOnComplete: 1_000,
          removeOnFail: 5_000
        }
      }
    );
    return { id: String(job.id) };
  }

  async unschedule(schedulerId: string): Promise<boolean> {
    return this.#queue.removeJobScheduler(schedulerId.replace(/[^a-zA-Z0-9_-]/g, "_"));
  }

  async close(): Promise<void> {
    await this.#queue.close();
    await this.#connection.quit();
  }
}

export class InMemoryJobDispatcher implements JobDispatcher {
  readonly jobs: Array<{ id: string; name: string; payload: Record<string, unknown> }> = [];
  readonly schedulers: Array<{ id: string; name: string; payload: Record<string, unknown>; everyMs: number }> = [];

  async health(): Promise<void> {}

  async dispatch(name: "repository.index" | "github.import" | "knowledge.extract" | "knowledge.health", payload: Record<string, unknown>, idempotencyKey: string): Promise<{ id: string }> {
    const existing = this.jobs.find((job) => job.id === idempotencyKey);
    if (!existing) this.jobs.push({ id: idempotencyKey, name, payload: structuredClone(payload) });
    return { id: idempotencyKey };
  }

  async schedule(name: "github.import" | "knowledge.health", payload: Record<string, unknown>, schedulerId: string, everyMs: number): Promise<{ id: string }> {
    const existing = this.schedulers.find((scheduler) => scheduler.id === schedulerId);
    if (existing) {
      existing.name = name;
      existing.payload = structuredClone(payload);
      existing.everyMs = everyMs;
    } else {
      this.schedulers.push({ id: schedulerId, name, payload: structuredClone(payload), everyMs });
    }
    return { id: schedulerId };
  }

  async unschedule(schedulerId: string): Promise<boolean> {
    const index = this.schedulers.findIndex((scheduler) => scheduler.id === schedulerId);
    if (index < 0) return false;
    this.schedulers.splice(index, 1);
    return true;
  }
}
