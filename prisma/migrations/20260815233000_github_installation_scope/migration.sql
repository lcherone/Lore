ALTER TABLE "Repository" ADD COLUMN "providerInstallationId" TEXT;
CREATE INDEX "Repository_provider_providerInstallationId_providerRepositoryId_idx"
ON "Repository"("provider", "providerInstallationId", "providerRepositoryId");

CREATE TABLE "SessionEvent" (
  "id" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SessionEvent_sessionId_sequence_key" ON "SessionEvent"("sessionId", "sequence");
CREATE INDEX "SessionEvent_sessionId_createdAt_idx" ON "SessionEvent"("sessionId", "createdAt");
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
