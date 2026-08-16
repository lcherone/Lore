ALTER TABLE "Organisation" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "User" ADD COLUMN "preferences" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "ApiToken" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");
CREATE INDEX "ApiToken_userId_revokedAt_expiresAt_idx" ON "ApiToken"("userId", "revokedAt", "expiresAt");
CREATE INDEX "ApiToken_organisationId_revokedAt_idx" ON "ApiToken"("organisationId", "revokedAt");

ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
