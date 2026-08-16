-- Preserve every accepted source edit while keeping Evidence as the latest snapshot.
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "EvidenceRevision" (
    "id" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "author" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceRevision_evidenceId_version_key" ON "EvidenceRevision"("evidenceId", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceRevision_evidenceId_contentHash_key" ON "EvidenceRevision"("evidenceId", "contentHash");
CREATE INDEX IF NOT EXISTS "EvidenceRevision_evidenceId_createdAt_idx" ON "EvidenceRevision"("evidenceId", "createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'EvidenceRevision_evidenceId_fkey'
    ) THEN
        ALTER TABLE "EvidenceRevision"
        ADD CONSTRAINT "EvidenceRevision_evidenceId_fkey"
        FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Existing rows become revision 1. Older rows without a source hash receive a
-- stable database-side hash; future writes use the application SHA-256 hash.
INSERT INTO "EvidenceRevision" (
    "id", "evidenceId", "version", "contentHash", "url", "title", "content", "author", "occurredAt", "metadata", "createdAt"
)
SELECT
    gen_random_uuid(), "id", 1,
    COALESCE("contentHash", md5(COALESCE("title", '') || E'\n' || "content" || E'\n' || "metadata"::text)),
    "url", "title", "content", "author", "occurredAt", "metadata", "createdAt"
FROM "Evidence"
ON CONFLICT ("evidenceId", "version") DO NOTHING;

UPDATE "Evidence"
SET "contentHash" = COALESCE("Evidence"."contentHash", revision."contentHash")
FROM "EvidenceRevision" AS revision
WHERE revision."evidenceId" = "Evidence"."id" AND revision."version" = 1;
