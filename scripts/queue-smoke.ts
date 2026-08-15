import assert from "node:assert/strict";
import { Worker } from "bullmq";
import { BullMqJobDispatcher, createRedisConnection, LORE_QUEUE_NAME } from "../packages/database/src/index.js";
import { newUuid } from "../packages/shared/src/index.js";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for the queue smoke test");

const dispatcher = new BullMqJobDispatcher(redisUrl);
const workerConnection = createRedisConnection(redisUrl);
const idempotencyKey = `queue-smoke-${newUuid()}`;
let handled = 0;
let resolveCompletion: (() => void) | undefined;
let rejectCompletion: ((error: Error) => void) | undefined;
const completion = new Promise<void>((resolve, reject) => {
  resolveCompletion = resolve;
  rejectCompletion = reject;
});

const worker = new Worker(
  LORE_QUEUE_NAME,
  async (job) => {
    if (job.id === idempotencyKey) {
      handled += 1;
      resolveCompletion?.();
    }
    return { processed: true };
  },
  { connection: workerConnection }
);

worker.on("failed", (job, error) => {
  if (job?.id === idempotencyKey) rejectCompletion?.(error);
});

try {
  await dispatcher.health();
  const [first, replay] = await Promise.all([
    dispatcher.dispatch("knowledge.health", { source: "queue-smoke" }, idempotencyKey),
    dispatcher.dispatch("knowledge.health", { source: "queue-smoke" }, idempotencyKey)
  ]);
  assert.equal(first.id, idempotencyKey);
  assert.equal(replay.id, idempotencyKey);
  await Promise.race([
    completion,
    new Promise<never>((_resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Queue smoke timed out")), 10_000);
      timeout.unref();
    })
  ]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(handled, 1, "the same idempotency key must execute once");
  console.log(JSON.stringify({ status: "ok", queue: LORE_QUEUE_NAME, jobId: idempotencyKey, handled }));
} finally {
  await worker.close();
  await dispatcher.close();
  await workerConnection.quit();
}
