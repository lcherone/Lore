CREATE TYPE "JobRunState" AS ENUM ('queued', 'dispatched', 'running', 'retrying', 'succeeded', 'failed', 'dead_letter');

CREATE TABLE "JobRun" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "repositoryId" UUID,
    "name" TEXT NOT NULL,
    "state" "JobRunState" NOT NULL DEFAULT 'queued',
    "idempotencyKey" TEXT NOT NULL,
    "externalJobId" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maximumAttempts" INTEGER NOT NULL DEFAULT 3,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "resultSummary" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobEvent" (
    "id" UUID NOT NULL,
    "jobRunId" UUID NOT NULL,
    "state" "JobRunState" NOT NULL,
    "message" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobDispatchOutbox" (
    "id" UUID NOT NULL,
    "jobRunId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "dispatchTries" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobDispatchOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobRun_organisationId_idempotencyKey_key" ON "JobRun"("organisationId", "idempotencyKey");
CREATE INDEX "JobRun_organisationId_state_queuedAt_idx" ON "JobRun"("organisationId", "state", "queuedAt");
CREATE INDEX "JobRun_externalJobId_idx" ON "JobRun"("externalJobId");
CREATE INDEX "JobEvent_jobRunId_createdAt_idx" ON "JobEvent"("jobRunId", "createdAt");
CREATE UNIQUE INDEX "JobDispatchOutbox_jobRunId_key" ON "JobDispatchOutbox"("jobRunId");
CREATE INDEX "JobDispatchOutbox_dispatchedAt_nextAttemptAt_idx" ON "JobDispatchOutbox"("dispatchedAt", "nextAttemptAt");

ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_jobRunId_fkey" FOREIGN KEY ("jobRunId") REFERENCES "JobRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobDispatchOutbox" ADD CONSTRAINT "JobDispatchOutbox_jobRunId_fkey" FOREIGN KEY ("jobRunId") REFERENCES "JobRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
