-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RepositoryProvider" AS ENUM ('github', 'gitlab', 'bitbucket', 'local');

-- CreateEnum
CREATE TYPE "CodeEntityType" AS ENUM ('file', 'class', 'interface', 'trait', 'function', 'method', 'constant', 'event', 'listener', 'service', 'repository', 'controller', 'route', 'database_table', 'configuration_key', 'external_api', 'test');

-- CreateEnum
CREATE TYPE "RelationshipSource" AS ENUM ('static_analysis', 'git_history', 'ai_inference', 'manual', 'github', 'jira');

-- CreateEnum
CREATE TYPE "KnowledgeKind" AS ENUM ('fact', 'decision', 'rule', 'preference', 'inference', 'policy', 'regression', 'warning');

-- CreateEnum
CREATE TYPE "KnowledgeStatus" AS ENUM ('candidate', 'active', 'challenged', 'superseded', 'archived', 'rejected');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('info', 'suggestion', 'warning', 'error', 'blocker');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('pull_request', 'review_comment', 'commit', 'ticket', 'code', 'documentation', 'test_result', 'ci_result', 'manual_confirmation', 'incident');

-- CreateEnum
CREATE TYPE "EvidenceRelationship" AS ENUM ('supports', 'contradicts', 'originated_from', 'confirmed_by', 'supersedes');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "ChallengeResolution" AS ENUM ('confirmed', 'modified', 'superseded', 'split_scope', 'archived', 'false_positive');

-- CreateEnum
CREATE TYPE "ProposalOperation" AS ENUM ('create', 'update', 'supersede', 'challenge', 'merge', 'archive');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('pending', 'auto_accepted', 'approved', 'rejected', 'failed_validation');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('preparing', 'active', 'verifying', 'completed', 'abandoned');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateTable
CREATE TABLE "Organisation" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "provider" "RepositoryProvider" NOT NULL,
    "providerRepositoryId" TEXT,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "cloneUrl" TEXT,
    "localPath" TEXT,
    "languageSummary" JSONB NOT NULL,
    "lastIndexedCommit" TEXT,
    "analysisVersion" TEXT NOT NULL DEFAULT '1',
    "retentionConfig" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeEntity" (
    "id" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "type" "CodeEntityType" NOT NULL,
    "name" TEXT NOT NULL,
    "qualifiedName" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "startLine" INTEGER,
    "endLine" INTEGER,
    "language" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "fingerprint" TEXT NOT NULL,
    "contentHash" TEXT,
    "analyzerVersion" TEXT NOT NULL DEFAULT '1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeRelationship" (
    "id" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "sourceEntityId" UUID NOT NULL,
    "targetEntityId" UUID NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" "RelationshipSource" NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "repositoryId" UUID,
    "type" "EvidenceType" NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "author" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "contentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "repositoryId" UUID,
    "kind" "KnowledgeKind" NOT NULL,
    "status" "KnowledgeStatus" NOT NULL,
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "severity" "Severity" NOT NULL,
    "scope" JSONB NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastConfirmedAt" TIMESTAMP(3),
    "supersededById" UUID,

    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeEvidence" (
    "knowledgeItemId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "relationship" "EvidenceRelationship" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "KnowledgeEvidence_pkey" PRIMARY KEY ("knowledgeItemId","evidenceId","relationship")
);

-- CreateTable
CREATE TABLE "KnowledgeChallenge" (
    "id" UUID NOT NULL,
    "knowledgeItemId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolution" "ChallengeResolution",

    CONSTRAINT "KnowledgeChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeProposal" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "repositoryId" UUID,
    "operation" "ProposalOperation" NOT NULL,
    "payload" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'pending',
    "validationErrors" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "KnowledgeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeRevision" (
    "id" UUID NOT NULL,
    "knowledgeItemId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "statement" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "classification" "KnowledgeKind" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "KnowledgeStatus" NOT NULL,
    "changeReason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "KnowledgeRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "repositoryId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "scope" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "detectorType" TEXT NOT NULL,
    "detectorConfig" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegressionRecord" (
    "id" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "introducedByCommit" TEXT,
    "fixedByCommit" TEXT,
    "pullRequestId" TEXT,
    "ticketId" TEXT,
    "affectedEntities" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "severity" "Severity" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegressionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewerProfile" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "providerIdentity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ReviewerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "task" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL,
    "baseCommit" TEXT,
    "currentCommit" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "agentType" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "filesObserved" JSONB NOT NULL DEFAULT '[]',
    "filesChanged" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContextPackageRecord" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContextPackageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeSafetyReport" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "repositoryId" UUID NOT NULL,
    "sessionId" UUID,
    "task" TEXT NOT NULL,
    "risk" "RiskLevel" NOT NULL,
    "payload" JSONB NOT NULL,
    "blockers" INTEGER NOT NULL DEFAULT 0,
    "warnings" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeSafetyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeUsage" (
    "id" UUID NOT NULL,
    "knowledgeItemId" UUID NOT NULL,
    "sessionId" UUID,
    "outcome" TEXT,
    "includedAs" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionReceipt" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "IngestionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_slug_key" ON "Organisation"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organisationId_userId_key" ON "Membership"("organisationId", "userId");

-- CreateIndex
CREATE INDEX "Repository_organisationId_idx" ON "Repository"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_organisationId_provider_owner_name_key" ON "Repository"("organisationId", "provider", "owner", "name");

-- CreateIndex
CREATE INDEX "CodeEntity_repositoryId_path_idx" ON "CodeEntity"("repositoryId", "path");

-- CreateIndex
CREATE INDEX "CodeEntity_repositoryId_qualifiedName_idx" ON "CodeEntity"("repositoryId", "qualifiedName");

-- CreateIndex
CREATE UNIQUE INDEX "CodeEntity_repositoryId_fingerprint_key" ON "CodeEntity"("repositoryId", "fingerprint");

-- CreateIndex
CREATE INDEX "CodeRelationship_sourceEntityId_relationshipType_idx" ON "CodeRelationship"("sourceEntityId", "relationshipType");

-- CreateIndex
CREATE INDEX "CodeRelationship_targetEntityId_relationshipType_idx" ON "CodeRelationship"("targetEntityId", "relationshipType");

-- CreateIndex
CREATE UNIQUE INDEX "CodeRelationship_repositoryId_sourceEntityId_targetEntityId_key" ON "CodeRelationship"("repositoryId", "sourceEntityId", "targetEntityId", "relationshipType", "source");

-- CreateIndex
CREATE INDEX "Evidence_organisationId_repositoryId_occurredAt_idx" ON "Evidence"("organisationId", "repositoryId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_organisationId_provider_externalId_key" ON "Evidence"("organisationId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "KnowledgeItem_organisationId_repositoryId_status_kind_idx" ON "KnowledgeItem"("organisationId", "repositoryId", "status", "kind");

-- CreateIndex
CREATE INDEX "KnowledgeItem_organisationId_confidence_idx" ON "KnowledgeItem"("organisationId", "confidence");

-- CreateIndex
CREATE INDEX "KnowledgeChallenge_knowledgeItemId_status_idx" ON "KnowledgeChallenge"("knowledgeItemId", "status");

-- CreateIndex
CREATE INDEX "KnowledgeProposal_organisationId_repositoryId_status_idx" ON "KnowledgeProposal"("organisationId", "repositoryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRevision_knowledgeItemId_version_key" ON "KnowledgeRevision"("knowledgeItemId", "version");

-- CreateIndex
CREATE INDEX "Policy_organisationId_repositoryId_enabled_idx" ON "Policy"("organisationId", "repositoryId", "enabled");

-- CreateIndex
CREATE INDEX "RegressionRecord_repositoryId_severity_idx" ON "RegressionRecord"("repositoryId", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewerProfile_organisationId_providerIdentity_key" ON "ReviewerProfile"("organisationId", "providerIdentity");

-- CreateIndex
CREATE INDEX "AgentSession_organisationId_repositoryId_status_idx" ON "AgentSession"("organisationId", "repositoryId", "status");

-- CreateIndex
CREATE INDEX "ContextPackageRecord_sessionId_createdAt_idx" ON "ContextPackageRecord"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ChangeSafetyReport_organisationId_repositoryId_createdAt_idx" ON "ChangeSafetyReport"("organisationId", "repositoryId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeUsage_knowledgeItemId_createdAt_idx" ON "KnowledgeUsage"("knowledgeItemId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_organisationId_createdAt_idx" ON "AuditEvent"("organisationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionReceipt_organisationId_provider_externalId_key" ON "IngestionReceipt"("organisationId", "provider", "externalId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeEntity" ADD CONSTRAINT "CodeEntity_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeRelationship" ADD CONSTRAINT "CodeRelationship_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeRelationship" ADD CONSTRAINT "CodeRelationship_sourceEntityId_fkey" FOREIGN KEY ("sourceEntityId") REFERENCES "CodeEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeRelationship" ADD CONSTRAINT "CodeRelationship_targetEntityId_fkey" FOREIGN KEY ("targetEntityId") REFERENCES "CodeEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "KnowledgeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEvidence" ADD CONSTRAINT "KnowledgeEvidence_knowledgeItemId_fkey" FOREIGN KEY ("knowledgeItemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEvidence" ADD CONSTRAINT "KnowledgeEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChallenge" ADD CONSTRAINT "KnowledgeChallenge_knowledgeItemId_fkey" FOREIGN KEY ("knowledgeItemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeProposal" ADD CONSTRAINT "KnowledgeProposal_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeProposal" ADD CONSTRAINT "KnowledgeProposal_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRevision" ADD CONSTRAINT "KnowledgeRevision_knowledgeItemId_fkey" FOREIGN KEY ("knowledgeItemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegressionRecord" ADD CONSTRAINT "RegressionRecord_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewerProfile" ADD CONSTRAINT "ReviewerProfile_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextPackageRecord" ADD CONSTRAINT "ContextPackageRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeSafetyReport" ADD CONSTRAINT "ChangeSafetyReport_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeSafetyReport" ADD CONSTRAINT "ChangeSafetyReport_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeSafetyReport" ADD CONSTRAINT "ChangeSafetyReport_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeUsage" ADD CONSTRAINT "KnowledgeUsage_knowledgeItemId_fkey" FOREIGN KEY ("knowledgeItemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionReceipt" ADD CONSTRAINT "IngestionReceipt_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
