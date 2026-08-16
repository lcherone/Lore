-- CreateEnum
CREATE TYPE "OrganisationRole" AS ENUM ('owner', 'admin', 'member', 'viewer');

-- Extend users with a GitHub-seeded, user-editable profile.
ALTER TABLE "User"
ADD COLUMN "emailNormalized" TEXT,
ADD COLUMN "avatarUrl" TEXT,
ADD COLUMN "githubLogin" TEXT,
ADD COLUMN "githubProfileUrl" TEXT,
ADD COLUMN "bio" TEXT,
ADD COLUMN "company" TEXT,
ADD COLUMN "jobTitle" TEXT,
ADD COLUMN "location" TEXT,
ADD COLUMN "websiteUrl" TEXT,
ADD COLUMN "timezone" TEXT,
ADD COLUMN "profileEditedAt" TIMESTAMP(3),
ADD COLUMN "lastLoginAt" TIMESTAMP(3);

UPDATE "User" SET "emailNormalized" = lower(trim("email"));
ALTER TABLE "User" ALTER COLUMN "emailNormalized" SET NOT NULL;
CREATE UNIQUE INDEX "User_emailNormalized_key" ON "User"("emailNormalized");

-- Make membership roles explicit and auditable.
ALTER TABLE "Membership"
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Membership"
ALTER COLUMN "role" TYPE "OrganisationRole" USING "role"::"OrganisationRole";

-- A GitHub identity is linked by GitHub's stable numeric user ID, not a mutable login.
CREATE TABLE "AuthIdentity" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "providerUserId" TEXT NOT NULL,
  "providerLogin" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuthIdentity_provider_providerUserId_key" ON "AuthIdentity"("provider", "providerUserId");
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

-- Cookies contain only a random token; this table is the session authority.
CREATE TABLE "AuthSession" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "activeOrganisationId" UUID,
  "tokenHash" TEXT NOT NULL,
  "userAgentHash" TEXT,
  "ipHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");
CREATE INDEX "AuthSession_userId_revokedAt_expiresAt_idx" ON "AuthSession"("userId", "revokedAt", "expiresAt");
CREATE INDEX "AuthSession_activeOrganisationId_idx" ON "AuthSession"("activeOrganisationId");

-- Invitations are accepted only by a signed-in GitHub account with the same verified email.
CREATE TABLE "OrganisationInvitation" (
  "id" UUID NOT NULL,
  "organisationId" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "emailNormalized" TEXT NOT NULL,
  "role" "OrganisationRole" NOT NULL,
  "invitedByUserId" UUID NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganisationInvitation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrganisationInvitation_organisationId_createdAt_idx" ON "OrganisationInvitation"("organisationId", "createdAt");
CREATE INDEX "OrganisationInvitation_emailNormalized_acceptedAt_revokedAt_expiresAt_idx" ON "OrganisationInvitation"("emailNormalized", "acceptedAt", "revokedAt", "expiresAt");

ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_activeOrganisationId_fkey" FOREIGN KEY ("activeOrganisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrganisationInvitation" ADD CONSTRAINT "OrganisationInvitation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganisationInvitation" ADD CONSTRAINT "OrganisationInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
