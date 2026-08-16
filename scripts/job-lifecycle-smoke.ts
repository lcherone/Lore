import "dotenv/config";
import type { JobDispatcher } from "@lore/core/index.js";
import {
  createPrismaClient,
  InMemoryJobDispatcher,
  PersistentJobDispatcher,
  PrismaJobLedger
} from "../packages/database/src/index.js";
import { newUuid } from "../packages/shared/src/ids.js";

class UnavailableTransport implements JobDispatcher {
  async health(): Promise<void> {
    throw new Error("Transport unavailable for smoke setup");
  }
  async dispatch(): Promise<{ id: string }> {
    throw new Error("Transport unavailable for smoke setup");
  }
}

let prisma = createPrismaClient();
const suffix = newUuid().slice(0, 8);
const organisation = await prisma.organisation.create({
  data: { name: `Job lifecycle smoke ${suffix}`, slug: `job-lifecycle-smoke-${suffix}` }
});

try {
  const firstLedger = new PrismaJobLedger(prisma);
  const unavailable = new PersistentJobDispatcher(new UnavailableTransport(), firstLedger);
  const queued = await unavailable.dispatch(
    "knowledge.health",
    { organisationId: organisation.id },
    `health-smoke-${suffix}`
  );
  const retained = await prisma.jobDispatchOutbox.count({
    where: { jobRunId: queued.id, dispatchedAt: null }
  });
  if (!queued.deferred || retained !== 1) {
    throw new Error("Unavailable transport did not retain a pending outbox intent");
  }
  await prisma.jobDispatchOutbox.update({
    where: { jobRunId: queued.id },
    data: { nextAttemptAt: new Date(0) }
  });

  await prisma.$disconnect();
  prisma = createPrismaClient();
  const restartedLedger = new PrismaJobLedger(prisma);
  const transport = new InMemoryJobDispatcher();
  const restarted = new PersistentJobDispatcher(transport, restartedLedger);
  if ((await restarted.reconcile()) !== 1 || transport.jobs.length !== 1) {
    throw new Error("Restart reconciliation did not dispatch the retained job");
  }

  const runId = await restartedLedger.markRunning({
    runId: queued.id,
    organisationId: organisation.id,
    name: "knowledge.health",
    externalJobId: transport.jobs[0]!.id,
    attempt: 1,
    maximumAttempts: 3
  });
  await restartedLedger.markSucceeded(runId, { evaluated: 0 });
  const run = (await restartedLedger.list(organisation.id))[0];
  if (
    !run ||
    run.state !== "succeeded" ||
    run.events?.map((event) => event.state).join(",") !==
      "queued,queued,dispatched,running,succeeded"
  ) {
    throw new Error(`Unexpected durable job lifecycle: ${JSON.stringify(run)}`);
  }

  const scheduledExternalId = `repeat:knowledge-health:${suffix}`;
  const scheduledRun = await restartedLedger.markRunning({
    organisationId: organisation.id,
    name: "knowledge.health",
    externalJobId: scheduledExternalId,
    attempt: 1,
    maximumAttempts: 3
  });
  await restartedLedger.markFailed(scheduledRun, new Error("retryable smoke failure"), false);
  const retriedRun = await restartedLedger.markRunning({
    organisationId: organisation.id,
    name: "knowledge.health",
    externalJobId: scheduledExternalId,
    attempt: 2,
    maximumAttempts: 3
  });
  if (retriedRun !== scheduledRun)
    throw new Error("A scheduled retry created a duplicate durable run");
  await restartedLedger.markTransportFailed(
    scheduledExternalId,
    new Error("job stalled more than allowable limit"),
    true
  );
  const reconciled = (await restartedLedger.list(organisation.id)).find(
    (item) => item.id === scheduledRun
  );
  if (reconciled?.state !== "dead_letter")
    throw new Error("Transport stall was not reconciled into the durable ledger");

  process.stdout.write(
    "✓ PostgreSQL retained a queued job while Redis transport was unavailable\n"
  );
  process.stdout.write("✓ A restarted dispatcher reconciled the durable outbox intent\n");
  process.stdout.write("✓ Worker lifecycle reached succeeded with append-only events\n");
  process.stdout.write(
    "✓ Scheduled retries reused one run and transport stalls reconciled terminal state\n"
  );
} finally {
  await prisma.organisation.delete({ where: { id: organisation.id } }).catch(() => undefined);
  await prisma.$disconnect();
}
