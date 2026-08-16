-- CreateTable
CREATE TABLE "ChangeObservation" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "contextPackageId" UUID NOT NULL,
    "contextRevision" INTEGER NOT NULL,
    "baseCommit" TEXT,
    "currentCommit" TEXT,
    "manifest" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeObservation_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ChangeSafetyReport"
ADD COLUMN "contextPackageId" UUID,
ADD COLUMN "contextRevision" INTEGER,
ADD COLUMN "observationId" UUID,
ADD COLUMN "baseCommit" TEXT,
ADD COLUMN "currentCommit" TEXT;

-- CreateIndex
CREATE INDEX "ChangeObservation_organisationId_repositoryId_capturedAt_idx" ON "ChangeObservation"("organisationId", "repositoryId", "capturedAt");

-- CreateIndex
CREATE INDEX "ChangeObservation_sessionId_capturedAt_idx" ON "ChangeObservation"("sessionId", "capturedAt");

-- CreateIndex
CREATE INDEX "ChangeObservation_contentHash_idx" ON "ChangeObservation"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeSafetyReport_observationId_key" ON "ChangeSafetyReport"("observationId");

-- AddForeignKey
ALTER TABLE "ChangeObservation" ADD CONSTRAINT "ChangeObservation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeObservation" ADD CONSTRAINT "ChangeObservation_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeObservation" ADD CONSTRAINT "ChangeObservation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeObservation" ADD CONSTRAINT "ChangeObservation_contextPackageId_fkey" FOREIGN KEY ("contextPackageId") REFERENCES "ContextPackageRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeSafetyReport" ADD CONSTRAINT "ChangeSafetyReport_contextPackageId_fkey" FOREIGN KEY ("contextPackageId") REFERENCES "ContextPackageRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeSafetyReport" ADD CONSTRAINT "ChangeSafetyReport_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "ChangeObservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

