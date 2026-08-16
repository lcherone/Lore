CREATE TABLE "SyncCheckpoint" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SyncCheckpoint_organisationId_repositoryId_provider_stream_externalId_key"
ON "SyncCheckpoint"("organisationId", "repositoryId", "provider", "stream", "externalId");

CREATE INDEX "SyncCheckpoint_organisationId_repositoryId_provider_stream_idx"
ON "SyncCheckpoint"("organisationId", "repositoryId", "provider", "stream");

ALTER TABLE "SyncCheckpoint"
ADD CONSTRAINT "SyncCheckpoint_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SyncCheckpoint"
ADD CONSTRAINT "SyncCheckpoint_repositoryId_fkey"
FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
