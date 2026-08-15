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

  async close(): Promise<void> {
    await this.#queue.close();
    await this.#connection.quit();
  }
}

export class InMemoryJobDispatcher implements JobDispatcher {
  readonly jobs: Array<{ id: string; name: string; payload: Record<string, unknown> }> = [];

  async dispatch(name: "repository.index" | "github.import" | "knowledge.extract" | "knowledge.health", payload: Record<string, unknown>, idempotencyKey: string): Promise<{ id: string }> {
    const existing = this.jobs.find((job) => job.id === idempotencyKey);
    if (!existing) this.jobs.push({ id: idempotencyKey, name, payload: structuredClone(payload) });
    return { id: idempotencyKey };
  }
}
