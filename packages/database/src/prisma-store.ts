import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { LoreStore, ManualKnowledgeInput, RepositoryAnalysisOutput } from "@lore/core/index.js";
import { ConflictError, ForbiddenError, NotFoundError } from "@lore/core/index.js";
import { createChangeObservation } from "./change-observation.js";
import type {
  AgentSession,
  CandidateRecord,
  ChangeObservation,
  CodeEntity,
  CodeRelationship,
  ContextPackage,
  ContextPackageRecord,
  DashboardSnapshot,
  EvidenceRecord,
  KnowledgeItem,
  KnowledgeProposalRecord,
  KnowledgeScope,
  PolicyDetector,
  PolicyRecord,
  RepositoryRetentionConfig,
  RepositorySummary,
  RegressionRecord,
  ReviewerProfile,
  SafetyReport,
  SessionEvent
} from "@lore/shared/types.js";

type JsonRecord = Record<string, unknown>;

interface EvidenceRow {
  id: string;
  organisationId: string;
  repositoryId: string | null;
  type: EvidenceRecord["type"];
  provider: string;
  externalId: string;
  url: string | null;
  title: string | null;
  content: string;
  author: string | null;
  occurredAt: Date;
  metadata: unknown;
  contentHash?: string | null;
}

interface KnowledgeRowBase {
  id: string;
  organisationId: string;
  repositoryId: string | null;
  kind: KnowledgeItem["kind"];
  status: KnowledgeItem["status"];
  title: string;
  statement: string;
  rationale: string;
  confidence: number;
  severity: KnowledgeItem["severity"];
  scope: unknown;
  metadata?: unknown;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  lastConfirmedAt: Date | null;
  challenges: Array<{ status: string }>;
}

type KnowledgeRow = KnowledgeRowBase & { evidenceLinks: Array<{ evidenceId: string }> };
type CandidateRow = KnowledgeRowBase & {
  metadata: unknown;
  evidenceLinks: Array<{ evidenceId: string; evidence: EvidenceRow }>;
};

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const optional = <T>(value: T | null | undefined, key: string): Record<string, T> =>
  value == null ? {} : { [key]: value };

export class PrismaLoreStore implements LoreStore {
  public constructor(private readonly prisma: PrismaClient) {}

  async health(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  async validateMembership(organisationId: string, userId: string): Promise<void> {
    const membership = await this.prisma.membership.findFirst({ where: { organisationId, userId } });
    if (!membership) throw new ForbiddenError("The current user is not an active organisation member");
  }

  async getSnapshot(organisationId: string): Promise<DashboardSnapshot> {
    const organisation = await this.prisma.organisation.findUnique({ where: { id: organisationId } });
    if (!organisation) throw new ForbiddenError();

    const [repositoryRows, knowledgeRows, policyRows, reportRows, reviewerRows, sessionRows] = await Promise.all([
      this.prisma.repository.findMany({ where: { organisationId }, include: { _count: { select: { entities: true, relationships: true } } } }),
      this.prisma.knowledgeItem.findMany({
        where: { organisationId, status: { notIn: ["rejected", "archived", "superseded"] } },
        include: { evidenceLinks: { include: { evidence: true } }, challenges: true },
        orderBy: { updatedAt: "desc" }
      }),
      this.prisma.policy.findMany({ where: { organisationId }, orderBy: { updatedAt: "desc" } }),
      this.prisma.changeSafetyReport.findMany({ where: { organisationId }, orderBy: { createdAt: "desc" }, take: 50 }),
      this.prisma.reviewerProfile.findMany({ where: { organisationId } }),
      this.prisma.agentSession.findMany({ where: { organisationId }, orderBy: { startedAt: "desc" }, take: 50 })
    ]);

    const repositories: RepositorySummary[] = repositoryRows.map((row) => ({
      id: row.id,
      organisationId: row.organisationId,
      provider: row.provider,
      ...optional(row.providerRepositoryId, "providerRepositoryId"),
      ...optional(row.providerInstallationId, "providerInstallationId"),
      owner: row.owner,
      name: row.name,
      defaultBranch: row.defaultBranch,
      ...optional(row.cloneUrl, "cloneUrl"),
      ...optional(row.localPath, "localPath"),
      languageSummary: asRecord(row.languageSummary) as Record<string, number>,
      retentionConfig: asRecord(row.retentionConfig) as unknown as RepositoryRetentionConfig,
      ...optional(row.lastIndexedCommit, "lastIndexedCommit"),
      indexedAt: row.updatedAt.toISOString(),
      entityCount: row._count.entities,
      relationshipCount: row._count.relationships,
      status: row.lastIndexedCommit ? "ready" : "attention"
    })) as RepositorySummary[];

    const mappedKnowledge = knowledgeRows.map((row) => this.#mapKnowledge(row));
    const knowledge = mappedKnowledge.filter((item) => item.status !== "candidate");
    const candidates = knowledgeRows
      .filter((row) => row.status === "candidate")
      .map((row) => this.#mapCandidate(row));

    const policies: PolicyRecord[] = policyRows.map((row) => {
      const config = asRecord(row.detectorConfig);
      return {
        id: row.id,
        organisationId: row.organisationId,
        ...optional(row.repositoryId, "repositoryId"),
        name: row.name,
        description: row.description,
        owner: row.owner,
        severity: row.severity,
        scope: asRecord(row.scope) as KnowledgeScope,
        enabled: row.enabled,
        detector: { ...config, type: row.detectorType } as PolicyDetector,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      } as PolicyRecord;
    });

    const reports = reportRows.map((row) => row.payload as unknown as SafetyReport);
    const reviewers: ReviewerProfile[] = reviewerRows.map((row) => {
      const metadata = asRecord(row.metadata);
      return {
        id: row.id,
        name: row.name,
        providerIdentity: row.providerIdentity,
        ...optional(row.email, "email"),
        preferenceCount: Number(metadata.preferenceCount ?? 0),
        reinforcedCount: Number(metadata.reinforcedCount ?? 0),
        lastObservedAt: typeof metadata.lastObservedAt === "string" ? metadata.lastObservedAt : row.id
      } as ReviewerProfile;
    });

    const sessions: AgentSession[] = sessionRows.map((row) => ({
      id: row.id,
      organisationId: row.organisationId,
      repositoryId: row.repositoryId,
      task: row.task,
      status: row.status,
      ...optional(row.baseCommit, "baseCommit"),
      ...optional(row.currentCommit, "currentCommit"),
      startedAt: row.startedAt.toISOString(),
      ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
      agentType: row.agentType,
      filesObserved: asStringArray(row.filesObserved),
      filesChanged: asStringArray(row.filesChanged),
      warningCount: Number(asRecord(row.metadata).warningCount ?? 0)
    })) as AgentSession[];

    return {
      organisation: { id: organisation.id, name: organisation.name, slug: organisation.slug },
      repositories,
      knowledge,
      candidates,
      policies,
      reports,
      reviewers,
      sessions
    };
  }

  async getEvidence(organisationId: string): Promise<EvidenceRecord[]> {
    await this.#assertOrganisation(organisationId);
    const rows = await this.prisma.evidence.findMany({ where: { organisationId }, orderBy: { occurredAt: "desc" } });
    return rows.map((row) => this.#mapEvidence(row));
  }

  async getRepository(organisationId: string, repositoryId: string): Promise<RepositorySummary> {
    const snapshot = await this.getSnapshot(organisationId);
    const repository = snapshot.repositories.find((item) => item.id === repositoryId);
    if (!repository) throw new NotFoundError("Repository", repositoryId);
    return repository;
  }

  async resolveProviderRepository(
    provider: RepositorySummary["provider"],
    providerInstallationId: string,
    providerRepositoryId: string,
    owner: string,
    name: string
  ): Promise<RepositorySummary> {
    const row = await this.prisma.repository.findFirst({
      where: {
        provider,
        providerInstallationId,
        OR: [
          { providerRepositoryId },
          { owner: { equals: owner, mode: "insensitive" }, name: { equals: name, mode: "insensitive" } }
        ]
      },
      include: { _count: { select: { entities: true, relationships: true } } }
    });
    if (!row) throw new NotFoundError("Provider repository", `${owner}/${name}`);
    return {
      id: row.id,
      organisationId: row.organisationId,
      provider: row.provider,
      ...optional(row.providerRepositoryId, "providerRepositoryId"),
      ...optional(row.providerInstallationId, "providerInstallationId"),
      owner: row.owner,
      name: row.name,
      defaultBranch: row.defaultBranch,
      ...optional(row.cloneUrl, "cloneUrl"),
      ...optional(row.localPath, "localPath"),
      languageSummary: asRecord(row.languageSummary) as Record<string, number>,
      ...optional(row.lastIndexedCommit, "lastIndexedCommit"),
      indexedAt: row.updatedAt.toISOString(),
      entityCount: row._count.entities,
      relationshipCount: row._count.relationships,
      status: row.lastIndexedCommit ? "ready" : "attention"
    } as RepositorySummary;
  }

  async getCodeGraph(organisationId: string, repositoryId: string): Promise<{ entities: CodeEntity[]; relationships: CodeRelationship[] }> {
    await this.getRepository(organisationId, repositoryId);
    const [entityRows, relationshipRows] = await Promise.all([
      this.prisma.codeEntity.findMany({ where: { repositoryId } }),
      this.prisma.codeRelationship.findMany({ where: { repositoryId } })
    ]);
    return {
      entities: entityRows.map((row) => ({
        id: row.id,
        repositoryId: row.repositoryId,
        type: row.type,
        name: row.name,
        qualifiedName: row.qualifiedName,
        path: row.path,
        ...optional(row.startLine, "startLine"),
        ...optional(row.endLine, "endLine"),
        language: row.language,
        fingerprint: row.fingerprint,
        metadata: asRecord(row.metadata)
      })) as CodeEntity[],
      relationships: relationshipRows.map((row) => ({
        id: row.id,
        repositoryId: row.repositoryId,
        sourceEntityId: row.sourceEntityId,
        targetEntityId: row.targetEntityId,
        relationshipType: row.relationshipType,
        confidence: row.confidence,
        source: row.source,
        metadata: asRecord(row.metadata)
      }))
    };
  }

  async getRegressions(organisationId: string, repositoryId: string): Promise<RegressionRecord[]> {
    await this.getRepository(organisationId, repositoryId);
    const rows = await this.prisma.regressionRecord.findMany({ where: { repositoryId }, orderBy: { createdAt: "desc" } });
    return rows.map((row) => ({
      id: row.id,
      repositoryId: row.repositoryId,
      title: row.title,
      description: row.description,
      ...optional(row.introducedByCommit, "introducedByCommit"),
      ...optional(row.fixedByCommit, "fixedByCommit"),
      ...optional(row.pullRequestId, "pullRequestId"),
      ...optional(row.ticketId, "ticketId"),
      affectedEntities: asStringArray(row.affectedEntities),
      evidenceIds: asStringArray(row.evidence),
      severity: row.severity,
      createdAt: row.createdAt.toISOString()
    })) as RegressionRecord[];
  }

  async saveAnalysis(organisationId: string, output: RepositoryAnalysisOutput): Promise<void> {
    await this.getRepository(organisationId, output.repository.id);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.codeRelationship.deleteMany({ where: { repositoryId: output.repository.id } });
      await transaction.codeEntity.deleteMany({ where: { repositoryId: output.repository.id } });
      if (output.entities.length > 0) {
        await transaction.codeEntity.createMany({
          data: output.entities.map((entity) => ({
            id: entity.id,
            repositoryId: entity.repositoryId,
            type: entity.type,
            name: entity.name,
            qualifiedName: entity.qualifiedName,
            path: entity.path,
            startLine: entity.startLine,
            endLine: entity.endLine,
            language: entity.language,
            metadata: entity.metadata as Prisma.InputJsonValue,
            fingerprint: entity.fingerprint,
            contentHash: typeof entity.metadata.contentHash === "string" ? entity.metadata.contentHash : null,
            analyzerVersion: typeof entity.metadata.analyzerVersion === "string" ? entity.metadata.analyzerVersion : "1"
          }))
        });
      }
      if (output.relationships.length > 0) {
        await transaction.codeRelationship.createMany({
          data: output.relationships.map((relationship) => ({
            id: relationship.id,
            repositoryId: relationship.repositoryId,
            sourceEntityId: relationship.sourceEntityId,
            targetEntityId: relationship.targetEntityId,
            relationshipType: relationship.relationshipType,
            confidence: relationship.confidence,
            source: relationship.source,
            metadata: relationship.metadata as Prisma.InputJsonValue
          }))
        });
      }
      await transaction.repository.update({
        where: { id: output.repository.id },
        data: {
          languageSummary: output.repository.languageSummary as Prisma.InputJsonValue,
          lastIndexedCommit: output.repository.lastIndexedCommit,
          analysisVersion: "1"
        }
      });
    });
  }

  async saveKnowledgeProposal(
    organisationId: string,
    input: Omit<KnowledgeProposalRecord, "id" | "organisationId" | "createdAt">
  ): Promise<KnowledgeProposalRecord> {
    await this.#assertOrganisation(organisationId);
    const row = await this.prisma.knowledgeProposal.create({
      data: {
        organisationId,
        repositoryId: input.repositoryId,
        operation: input.operation,
        payload: input.payload as Prisma.InputJsonValue,
        source: input.source,
        status: input.status,
        validationErrors: input.validationErrors as Prisma.InputJsonValue,
        reviewedAt: input.reviewedAt ? new Date(input.reviewedAt) : null,
        reviewedBy: input.reviewedBy
      }
    });
    return {
      id: row.id,
      organisationId: row.organisationId,
      ...optional(row.repositoryId, "repositoryId"),
      operation: row.operation,
      payload: asRecord(row.payload),
      source: row.source,
      status: row.status,
      validationErrors: asStringArray(row.validationErrors),
      createdAt: row.createdAt.toISOString(),
      ...(row.reviewedAt ? { reviewedAt: row.reviewedAt.toISOString() } : {}),
      ...optional(row.reviewedBy, "reviewedBy")
    } as KnowledgeProposalRecord;
  }

  async createKnowledgeCandidate(organisationId: string, candidate: CandidateRecord): Promise<CandidateRecord> {
    await this.#assertOrganisation(organisationId);
    const existing = await this.prisma.knowledgeItem.findFirst({
      where: {
        organisationId,
        repositoryId: candidate.repositoryId ?? null,
        status: "candidate",
        title: candidate.title,
        statement: candidate.statement
      },
      include: { evidenceLinks: { include: { evidence: true } }, challenges: true }
    });
    if (existing) {
      const linked = new Set(existing.evidenceLinks.map((link) => link.evidenceId));
      const missingEvidenceIds = candidate.evidenceIds.filter((evidenceId) => !linked.has(evidenceId));
      if (missingEvidenceIds.length > 0) {
        await this.prisma.knowledgeEvidence.createMany({
          data: missingEvidenceIds.map((evidenceId) => ({
            knowledgeItemId: existing.id,
            evidenceId,
            relationship: "supports" as const,
            weight: 1
          })),
          skipDuplicates: true
        });
      }
      const refreshed = await this.prisma.knowledgeItem.findUniqueOrThrow({
        where: { id: existing.id },
        include: { evidenceLinks: { include: { evidence: true } }, challenges: true }
      });
      return this.#mapCandidate(refreshed);
    }
    const row = await this.prisma.knowledgeItem.create({
      data: {
        id: candidate.id,
        organisationId,
        repositoryId: candidate.repositoryId,
        kind: candidate.kind,
        status: "candidate",
        title: candidate.title,
        statement: candidate.statement,
        rationale: candidate.rationale,
        confidence: candidate.confidence,
        severity: candidate.severity,
        scope: candidate.scope as Prisma.InputJsonValue,
        metadata: {
          confidenceFactors: candidate.confidenceFactors,
          contradictionSummaries: candidate.contradictionSummaries,
          ...(candidate.comparison ? { comparison: candidate.comparison } : {}),
          ...(candidate.proposalId ? { proposalId: candidate.proposalId } : {}),
          ...(candidate.proposedExclusion ? { proposedExclusion: candidate.proposedExclusion } : {})
        } as unknown as Prisma.InputJsonValue,
        createdBy: candidate.createdBy,
        createdAt: new Date(candidate.createdAt),
        updatedAt: new Date(candidate.updatedAt),
        evidenceLinks: {
          create: candidate.evidenceIds.map((evidenceId) => ({
            evidenceId,
            relationship: "supports",
            weight: 1
          }))
        },
        revisions: {
          create: {
            version: 1,
            statement: candidate.statement,
            scope: candidate.scope as Prisma.InputJsonValue,
            classification: candidate.kind,
            confidence: candidate.confidence,
            status: "candidate",
            changeReason: "Created from validated evidence proposal",
            createdBy: candidate.createdBy
          }
        }
      },
      include: { evidenceLinks: { include: { evidence: true } }, challenges: true }
    });
    return this.#mapCandidate(row);
  }

  async getCandidate(organisationId: string, candidateId: string): Promise<CandidateRecord> {
    await this.#assertOrganisation(organisationId);
    const row = await this.prisma.knowledgeItem.findFirst({
      where: { id: candidateId, organisationId, status: "candidate" },
      include: { evidenceLinks: { include: { evidence: true } }, challenges: true }
    });
    if (!row) throw new NotFoundError("Knowledge candidate", candidateId);
    return this.#mapCandidate(row);
  }

  async addRepository(
    organisationId: string,
    input: Omit<RepositorySummary, "id" | "organisationId" | "entityCount" | "relationshipCount" | "status">,
    actor = "system"
  ): Promise<RepositorySummary> {
    await this.#assertOrganisation(organisationId);
    const row = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.repository.create({
        data: {
          organisationId,
          provider: input.provider,
          providerRepositoryId: input.providerRepositoryId,
          providerInstallationId: input.providerInstallationId,
          owner: input.owner,
          name: input.name,
          defaultBranch: input.defaultBranch,
          cloneUrl: input.cloneUrl,
          localPath: input.localPath,
          languageSummary: input.languageSummary as Prisma.InputJsonValue,
          ...(input.retentionConfig ? { retentionConfig: input.retentionConfig as unknown as Prisma.InputJsonValue } : {}),
          lastIndexedCommit: input.lastIndexedCommit
        }
      });
      await transaction.auditEvent.create({
        data: {
          organisationId,
          userId: actor,
          action: "repository.connected",
          targetType: "Repository",
          targetId: created.id,
          after: { provider: created.provider, owner: created.owner, name: created.name }
        }
      });
      return created;
    });
    return {
      id: row.id,
      organisationId,
      provider: row.provider,
      ...optional(row.providerRepositoryId, "providerRepositoryId"),
      ...optional(row.providerInstallationId, "providerInstallationId"),
      owner: row.owner,
      name: row.name,
      defaultBranch: row.defaultBranch,
      ...optional(row.cloneUrl, "cloneUrl"),
      ...optional(row.localPath, "localPath"),
      languageSummary: asRecord(row.languageSummary) as Record<string, number>,
      retentionConfig: asRecord(row.retentionConfig) as unknown as RepositoryRetentionConfig,
      ...optional(row.lastIndexedCommit, "lastIndexedCommit"),
      indexedAt: row.updatedAt.toISOString(),
      entityCount: 0,
      relationshipCount: 0,
      status: "attention"
    } as RepositorySummary;
  }

  async createManualKnowledge(
    organisationId: string,
    input: ManualKnowledgeInput,
    actor: string
  ): Promise<KnowledgeItem> {
    await this.#assertOrganisation(organisationId);
    if (input.repositoryId) await this.getRepository(organisationId, input.repositoryId);
    const now = new Date();
    const row = await this.prisma.$transaction(async (transaction) => {
      const evidence = await transaction.evidence.create({
        data: {
          organisationId,
          repositoryId: input.repositoryId,
          type: "manual_confirmation",
          provider: "lore",
          externalId: `manual:${randomUUID()}`,
          url: input.sourceUrl,
          title: `Manual confirmation: ${input.title}`,
          content: `${input.statement}\n\nRationale: ${input.rationale}`,
          author: actor,
          occurredAt: now,
          metadata: { humanConfirmed: true, ...(input.sourceName ? { sourceName: input.sourceName } : {}) }
        }
      });
      const knowledge = await transaction.knowledgeItem.create({
        data: {
          organisationId,
          repositoryId: input.repositoryId,
          kind: input.kind,
          status: "active",
          title: input.title,
          statement: input.statement,
          rationale: input.rationale,
          confidence: 1,
          severity: input.severity,
          scope: input.scope as Prisma.InputJsonValue,
          metadata: { humanConfirmed: true },
          createdBy: actor,
          lastConfirmedAt: now,
          evidenceLinks: { create: { evidenceId: evidence.id, relationship: "confirmed_by", weight: 1 } },
          revisions: {
            create: {
              version: 1,
              statement: input.statement,
              scope: input.scope as Prisma.InputJsonValue,
              classification: input.kind,
              confidence: 1,
              status: "active",
              changeReason: "Human confirmation",
              createdBy: actor
            }
          }
        },
        include: { evidenceLinks: { include: { evidence: true } }, challenges: true }
      });
      await transaction.auditEvent.create({
        data: {
          organisationId,
          userId: actor,
          action: "knowledge.created",
          targetType: "KnowledgeItem",
          targetId: knowledge.id,
          after: { kind: input.kind, title: input.title, scope: input.scope } as unknown as Prisma.InputJsonValue
        }
      });
      return knowledge;
    });
    return this.#mapKnowledge(row);
  }

  async approveCandidate(
    organisationId: string,
    candidateId: string,
    input: { statement?: string; kind?: CandidateRecord["kind"]; scope?: CandidateRecord["scope"]; reason: string },
    actor: string
  ): Promise<KnowledgeItem> {
    const candidate = await this.getCandidate(organisationId, candidateId);
    await this.prisma.$transaction(async (transaction) => {
      const version = (await transaction.knowledgeRevision.count({ where: { knowledgeItemId: candidateId } })) + 1;
      await transaction.knowledgeItem.update({
        where: { id: candidateId },
        data: {
          status: "active",
          statement: input.statement ?? candidate.statement,
          kind: input.kind ?? candidate.kind,
          scope: (input.scope ?? candidate.scope) as Prisma.InputJsonValue,
          confidence: Math.max(candidate.confidence, 0.86),
          lastConfirmedAt: new Date(),
          createdBy: actor,
          revisions: {
            create: {
              version,
              statement: input.statement ?? candidate.statement,
              scope: (input.scope ?? candidate.scope) as Prisma.InputJsonValue,
              classification: input.kind ?? candidate.kind,
              confidence: Math.max(candidate.confidence, 0.86),
              status: "active",
              changeReason: input.reason,
              createdBy: actor
            }
          }
        }
      });
      await transaction.auditEvent.create({
        data: {
          organisationId,
          userId: actor,
          action: "knowledge.approved",
          targetType: "KnowledgeItem",
          targetId: candidateId,
          before: { status: "candidate" },
          after: { status: "active", reason: input.reason }
        }
      });
      if (candidate.proposalId) {
        await transaction.knowledgeProposal.updateMany({
          where: { id: candidate.proposalId, organisationId, status: "pending" },
          data: { status: "approved", reviewedAt: new Date(), reviewedBy: actor }
        });
      }
    });

    const row = await this.prisma.knowledgeItem.findUniqueOrThrow({
      where: { id: candidateId },
      include: { evidenceLinks: { include: { evidence: true } }, challenges: true }
    });
    return this.#mapKnowledge(row);
  }

  async rejectCandidate(organisationId: string, candidateId: string, reason: string, actor: string): Promise<void> {
    const candidate = await this.getCandidate(organisationId, candidateId);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.knowledgeItem.update({ where: { id: candidateId }, data: { status: "rejected" } });
      await transaction.auditEvent.create({
        data: {
          organisationId,
          userId: actor,
          action: "knowledge.rejected",
          targetType: "KnowledgeItem",
          targetId: candidateId,
          before: { status: "candidate" },
          after: { status: "rejected", reason }
        }
      });
      if (candidate.proposalId) {
        await transaction.knowledgeProposal.updateMany({
          where: { id: candidate.proposalId, organisationId, status: "pending" },
          data: { status: "rejected", reviewedAt: new Date(), reviewedBy: actor }
        });
      }
    });
  }

  async mergeCandidate(
    organisationId: string,
    candidateId: string,
    targetId: string,
    reason: string,
    actor: string
  ): Promise<KnowledgeItem> {
    if (candidateId === targetId) throw new Error("A candidate cannot be merged into itself");
    const source = await this.getCandidate(organisationId, candidateId);
    const target = await this.prisma.knowledgeItem.findFirst({
      where: {
        id: targetId,
        organisationId,
        status: { in: ["candidate", "active", "challenged"] }
      },
      include: { evidenceLinks: { include: { evidence: true } }, challenges: true }
    });
    if (!target) throw new NotFoundError("Merge target", targetId);

    const mergedConfidence = Math.max(target.confidence, source.confidence);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.knowledgeEvidence.createMany({
        data: source.evidenceIds.map((evidenceId) => ({
          knowledgeItemId: targetId,
          evidenceId,
          relationship: "supports" as const,
          weight: 1
        })),
        skipDuplicates: true
      });
      const version = (await transaction.knowledgeRevision.count({ where: { knowledgeItemId: targetId } })) + 1;
      await transaction.knowledgeItem.update({
        where: { id: targetId },
        data: {
          confidence: mergedConfidence,
          revisions: {
            create: {
              version,
              statement: target.statement,
              scope: target.scope as Prisma.InputJsonValue,
              classification: target.kind,
              confidence: mergedConfidence,
              status: target.status,
              changeReason: reason,
              createdBy: actor
            }
          }
        }
      });
      await transaction.knowledgeItem.update({
        where: { id: candidateId },
        data: { status: "superseded", supersededById: targetId }
      });
      if (source.proposalId) {
        await transaction.knowledgeProposal.updateMany({
          where: { id: source.proposalId, organisationId, status: "pending" },
          data: { status: "approved", reviewedAt: new Date(), reviewedBy: actor }
        });
      }
      await transaction.knowledgeProposal.create({
        data: {
          organisationId,
          repositoryId: source.repositoryId,
          operation: "merge",
          payload: { candidateId, targetId, evidenceIds: source.evidenceIds, reason },
          source: "human_candidate_review",
          status: "approved",
          validationErrors: [],
          reviewedAt: new Date(),
          reviewedBy: actor
        }
      });
      await transaction.auditEvent.create({
        data: {
          organisationId,
          userId: actor,
          action: "knowledge.merged",
          targetType: "KnowledgeItem",
          targetId,
          before: { sourceId: candidateId, sourceStatus: "candidate" },
          after: { sourceStatus: "superseded", mergedEvidenceIds: source.evidenceIds, reason }
        }
      });
    });

    const merged = await this.prisma.knowledgeItem.findUniqueOrThrow({
      where: { id: targetId },
      include: { evidenceLinks: { include: { evidence: true } }, challenges: true }
    });
    return merged.status === "candidate"
      ? this.#mapCandidate(merged)
      : this.#mapKnowledge(merged);
  }

  async deleteRepository(
    organisationId: string,
    repositoryId: string,
    actor: string
  ): Promise<{ deletedId: string; challengedKnowledgeIds: string[] }> {
    const repository = await this.getRepository(organisationId, repositoryId);
    const affectedOrganisationKnowledge = await this.prisma.knowledgeItem.findMany({
      where: {
        organisationId,
        repositoryId: null,
        status: { in: ["active", "challenged"] },
        evidenceLinks: { some: { evidence: { repositoryId } } }
      },
      select: { id: true }
    });
    const challengedKnowledgeIds = affectedOrganisationKnowledge.map((item) => item.id);

    await this.prisma.$transaction(async (transaction) => {
      for (const item of affectedOrganisationKnowledge) {
        await transaction.knowledgeItem.update({ where: { id: item.id }, data: { status: "challenged" } });
        await transaction.knowledgeChallenge.create({
          data: {
            knowledgeItemId: item.id,
            reason: `Supporting evidence was removed with repository ${repository.owner}/${repository.name}. Reconfirm or replace the provenance.`
          }
        });
      }
      await transaction.auditEvent.create({
        data: {
          organisationId,
          userId: actor,
          action: "repository.deleted",
          targetType: "Repository",
          targetId: repositoryId,
          before: { owner: repository.owner, name: repository.name, provider: repository.provider },
          after: { challengedKnowledgeIds }
        }
      });
      await transaction.repository.delete({ where: { id: repositoryId } });
    });
    return { deletedId: repositoryId, challengedKnowledgeIds };
  }

  async updateRepositoryRetention(
    organisationId: string,
    repositoryId: string,
    retentionConfig: RepositoryRetentionConfig,
    actor: string
  ): Promise<RepositorySummary> {
    await this.getRepository(organisationId, repositoryId);
    await this.prisma.$transaction([
      this.prisma.repository.update({
        where: { id: repositoryId },
        data: { retentionConfig: retentionConfig as unknown as Prisma.InputJsonValue }
      }),
      this.prisma.auditEvent.create({
        data: {
          organisationId,
          userId: actor,
          action: "repository.retention.updated",
          targetType: "Repository",
          targetId: repositoryId,
          after: retentionConfig as unknown as Prisma.InputJsonValue
        }
      })
    ]);
    return this.getRepository(organisationId, repositoryId);
  }

  async updateKnowledgeStatus(
    organisationId: string,
    knowledgeId: string,
    status: "challenged" | "archived",
    reason: string,
    actor: string
  ): Promise<KnowledgeItem> {
    await this.#assertOrganisation(organisationId);
    const existing = await this.prisma.knowledgeItem.findFirst({ where: { id: knowledgeId, organisationId } });
    if (!existing) throw new NotFoundError("Knowledge item", knowledgeId);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.knowledgeItem.update({ where: { id: knowledgeId }, data: { status } });
      if (status === "challenged") {
        await transaction.knowledgeChallenge.create({ data: { knowledgeItemId: knowledgeId, reason } });
      }
      await transaction.auditEvent.create({
        data: {
          organisationId,
          userId: actor,
          action: `knowledge.${status}`,
          targetType: "KnowledgeItem",
          targetId: knowledgeId,
          before: { status: existing.status },
          after: { status, reason }
        }
      });
    });
    const row = await this.prisma.knowledgeItem.findUniqueOrThrow({
      where: { id: knowledgeId },
      include: { evidenceLinks: { include: { evidence: true } }, challenges: true }
    });
    return this.#mapKnowledge(row);
  }

  async createPolicy(
    organisationId: string,
    input: Omit<PolicyRecord, "id" | "organisationId" | "createdAt" | "updatedAt">,
    actor = "system"
  ): Promise<PolicyRecord> {
    await this.#assertOrganisation(organisationId);
    const row = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.policy.create({
        data: {
          organisationId,
          repositoryId: input.repositoryId,
          name: input.name,
          description: input.description,
          owner: input.owner,
          severity: input.severity,
          scope: input.scope as Prisma.InputJsonValue,
          enabled: input.enabled,
          detectorType: input.detector.type,
          detectorConfig: input.detector as unknown as Prisma.InputJsonValue
        }
      });
      await transaction.auditEvent.create({
        data: {
          organisationId,
          userId: actor,
          action: "policy.created",
          targetType: "Policy",
          targetId: created.id,
          after: { name: created.name, severity: created.severity, owner: created.owner }
        }
      });
      return created;
    });
    return {
      id: row.id,
      organisationId,
      ...optional(row.repositoryId, "repositoryId"),
      name: row.name,
      description: row.description,
      owner: row.owner,
      severity: row.severity,
      scope: asRecord(row.scope) as KnowledgeScope,
      enabled: row.enabled,
      detector: { ...asRecord(row.detectorConfig), type: row.detectorType } as PolicyDetector,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    } as PolicyRecord;
  }

  async createSession(session: AgentSession): Promise<AgentSession> {
    await this.#assertOrganisation(session.organisationId);
    await this.getRepository(session.organisationId, session.repositoryId);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.agentSession.create({
        data: {
          id: session.id,
          organisationId: session.organisationId,
          repositoryId: session.repositoryId,
          task: session.task,
          status: session.status,
          baseCommit: session.baseCommit,
          currentCommit: session.currentCommit,
          startedAt: new Date(session.startedAt),
          completedAt: session.completedAt ? new Date(session.completedAt) : null,
          agentType: session.agentType,
          metadata: { warningCount: session.warningCount },
          filesObserved: session.filesObserved,
          filesChanged: session.filesChanged
        }
      });
      await transaction.sessionEvent.create({
        data: { id: randomUUID(), sessionId: session.id, sequence: 1, type: "started", data: { status: session.status, agentType: session.agentType } }
      });
    });
    return session;
  }

  async updateSession(organisationId: string, session: AgentSession): Promise<AgentSession> {
    await this.#assertOrganisation(organisationId);
    const existing = await this.prisma.agentSession.findFirst({ where: { id: session.id, organisationId } });
    if (!existing) throw new NotFoundError("Agent session", session.id);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.agentSession.update({
        where: { id: session.id },
        data: {
          status: session.status,
          currentCommit: session.currentCommit,
          completedAt: session.completedAt ? new Date(session.completedAt) : null,
          metadata: { warningCount: session.warningCount },
          filesObserved: session.filesObserved,
          filesChanged: session.filesChanged
        }
      });
      if (existing.status !== session.status && session.status === "abandoned") {
        const sequence = (await transaction.sessionEvent.count({ where: { sessionId: session.id } })) + 1;
        await transaction.sessionEvent.create({
          data: { id: randomUUID(), sessionId: session.id, sequence, type: "abandoned", data: { previousStatus: existing.status } }
        });
      }
    });
    return session;
  }

  async getSessionEvents(organisationId: string, sessionId: string): Promise<SessionEvent[]> {
    await this.#assertOrganisation(organisationId);
    const session = await this.prisma.agentSession.findFirst({ where: { id: sessionId, organisationId } });
    if (!session) throw new NotFoundError("Agent session", sessionId);
    const rows = await this.prisma.sessionEvent.findMany({ where: { sessionId }, orderBy: { sequence: "asc" } });
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      sequence: row.sequence,
      type: row.type as SessionEvent["type"],
      data: asRecord(row.data),
      createdAt: row.createdAt.toISOString()
    }));
  }

  async abandonSession(organisationId: string, sessionId: string, reason: string): Promise<AgentSession> {
    await this.#assertOrganisation(organisationId);
    const existing = await this.prisma.agentSession.findFirst({ where: { id: sessionId, organisationId } });
    if (!existing) throw new NotFoundError("Agent session", sessionId);
    if (["completed", "abandoned"].includes(existing.status)) throw new ConflictError("Only an open session can be abandoned");
    await this.prisma.$transaction(async (transaction) => {
      await transaction.agentSession.update({ where: { id: sessionId }, data: { status: "abandoned", completedAt: new Date() } });
      const sequence = (await transaction.sessionEvent.count({ where: { sessionId } })) + 1;
      await transaction.sessionEvent.create({
        data: { id: randomUUID(), sessionId, sequence, type: "abandoned", data: { previousStatus: existing.status, reason } }
      });
    });
    const snapshot = await this.getSnapshot(organisationId);
    const session = snapshot.sessions.find((item) => item.id === sessionId);
    if (!session) throw new NotFoundError("Agent session", sessionId);
    return session;
  }

  async saveContextPackage(
    organisationId: string,
    sessionId: string,
    context: ContextPackage
  ): Promise<ContextPackageRecord> {
    await this.#assertOrganisation(organisationId);
    const session = await this.prisma.agentSession.findFirst({ where: { id: sessionId, organisationId } });
    if (!session) throw new NotFoundError("Agent session", sessionId);
    if (session.repositoryId !== context.repository.id) throw new ForbiddenError("Context repository does not belong to the session");
    const record = await this.prisma.$transaction(async (transaction) => {
      const revision = (await transaction.contextPackageRecord.count({ where: { sessionId } })) + 1;
      const created = await transaction.contextPackageRecord.create({
        data: { id: context.id, sessionId, payload: { ...context, revision } as unknown as Prisma.InputJsonValue }
      });
      await transaction.agentSession.update({
        where: { id: sessionId },
        data: { status: "active", filesObserved: context.candidateFiles.map((file) => file.path) }
      });
      const eventSequence = (await transaction.sessionEvent.count({ where: { sessionId } })) + 1;
      await transaction.sessionEvent.create({
        data: {
          id: randomUUID(),
          sessionId,
          sequence: eventSequence,
          type: revision === 1 ? "context_prepared" : "context_refreshed",
          data: { contextId: context.id, revision, filesObserved: context.candidateFiles.length }
        }
      });
      const knowledgeEntries = [...context.rules, ...context.decisions, ...context.preferences];
      if (knowledgeEntries.length > 0) {
        await transaction.knowledgeUsage.createMany({
          data: knowledgeEntries.map((entry) => ({
            id: randomUUID(),
            knowledgeItemId: entry.item.id,
            sessionId,
            includedAs: `${entry.priority}:${entry.reason}`.slice(0, 1_000)
          }))
        });
      }
      return { created, revision };
    });
    return {
      id: record.created.id,
      sessionId,
      revision: record.revision,
      payload: context,
      createdAt: record.created.createdAt.toISOString()
    };
  }

  async getLatestContextPackage(organisationId: string, sessionId: string): Promise<ContextPackageRecord | undefined> {
    await this.#assertOrganisation(organisationId);
    const session = await this.prisma.agentSession.findFirst({ where: { id: sessionId, organisationId } });
    if (!session) throw new NotFoundError("Agent session", sessionId);
    const [row, count] = await Promise.all([
      this.prisma.contextPackageRecord.findFirst({ where: { sessionId }, orderBy: { createdAt: "desc" } }),
      this.prisma.contextPackageRecord.count({ where: { sessionId } })
    ]);
    if (!row) return undefined;
    return {
      id: row.id,
      sessionId,
      revision: count,
      payload: row.payload as unknown as ContextPackage,
      createdAt: row.createdAt.toISOString()
    };
  }

  async saveReport(
    organisationId: string,
    report: SafetyReport,
    sessionId?: string,
    contextRevision?: number
  ): Promise<SafetyReport> {
    await this.#assertOrganisation(organisationId);
    const session = sessionId
      ? await this.prisma.agentSession.findFirst({ where: { id: sessionId, organisationId } })
      : undefined;
    if (sessionId && !session) throw new NotFoundError("Agent session", sessionId);
    if (session && session.repositoryId !== report.repositoryId) throw new ForbiddenError("Report repository does not belong to the session");
    if (sessionId && (!report.contextId || !contextRevision)) {
      throw new ConflictError("A persisted context revision is required before saving a session report");
    }
    const context = sessionId && report.contextId
      ? await this.prisma.contextPackageRecord.findFirst({ where: { id: report.contextId, sessionId } })
      : undefined;
    if (sessionId && !context) throw new ForbiddenError("Report context does not belong to the session");
    const observation = sessionId && report.contextId && contextRevision
      ? createChangeObservation({ organisationId, sessionId, contextId: report.contextId, contextRevision, report })
      : undefined;
    const linked = observation
      ? { ...report, sessionId, contextRevision, observationId: observation.id }
      : sessionId
        ? { ...report, sessionId }
        : report;
    await this.prisma.$transaction(async (transaction) => {
      if (observation) {
        await transaction.changeObservation.create({
          data: {
            id: observation.id,
            organisationId,
            repositoryId: observation.repositoryId,
            sessionId: observation.sessionId,
            contextPackageId: observation.contextId,
            contextRevision: observation.contextRevision,
            baseCommit: observation.baseCommit,
            currentCommit: observation.currentCommit,
            manifest: observation.files as unknown as Prisma.InputJsonValue,
            contentHash: observation.contentHash,
            capturedAt: new Date(observation.capturedAt)
          }
        });
      }
      await transaction.changeSafetyReport.create({
        data: {
          id: report.id,
          organisationId,
          repositoryId: report.repositoryId,
          sessionId,
          contextPackageId: report.contextId,
          contextRevision,
          observationId: observation?.id,
          baseCommit: report.baseCommit,
          currentCommit: report.currentCommit,
          task: report.task,
          risk: report.risk.toLowerCase() as "low" | "medium" | "high" | "critical",
          payload: linked as unknown as Prisma.InputJsonValue,
          blockers: report.blockers.length,
          warnings: report.warnings.length
        }
      });
      if (sessionId) {
        const sequence = (await transaction.sessionEvent.count({ where: { sessionId } })) + 1;
        await transaction.sessionEvent.createMany({
          data: [
            { id: randomUUID(), sessionId, sequence, type: "verification_started", data: { contextId: report.contextId, contextRevision, observationId: observation?.id } },
            { id: randomUUID(), sessionId, sequence: sequence + 1, type: "verification_finished", data: { reportId: report.id, observationId: observation?.id, risk: report.risk } },
            { id: randomUUID(), sessionId, sequence: sequence + 2, type: "completed", data: { reportId: report.id } }
          ]
        });
        await transaction.agentSession.update({
          where: { id: sessionId },
          data: {
            status: "completed",
            currentCommit: report.currentCommit,
            completedAt: new Date(),
            filesChanged: report.changedFiles.map((file) => file.path),
            metadata: { warningCount: report.warnings.length }
          }
        });
      }
    });
    return linked;
  }

  async getChangeObservation(organisationId: string, observationId: string): Promise<ChangeObservation> {
    await this.#assertOrganisation(organisationId);
    const observation = await this.prisma.changeObservation.findFirst({
      where: { id: observationId, organisationId }
    });
    if (!observation) throw new NotFoundError("Change observation", observationId);
    return {
      id: observation.id,
      organisationId: observation.organisationId,
      repositoryId: observation.repositoryId,
      sessionId: observation.sessionId,
      contextId: observation.contextPackageId,
      contextRevision: observation.contextRevision,
      ...(observation.baseCommit ? { baseCommit: observation.baseCommit } : {}),
      ...(observation.currentCommit ? { currentCommit: observation.currentCommit } : {}),
      files: observation.manifest as unknown as ChangeObservation["files"],
      contentHash: observation.contentHash,
      capturedAt: observation.capturedAt.toISOString()
    };
  }

  async ingestEvidence(records: EvidenceRecord[]): Promise<number> {
    if (records.length === 0) return 0;
    const result = await this.prisma.evidence.createMany({
      data: records.map((record) => ({
        id: record.id,
        organisationId: record.organisationId,
        repositoryId: record.repositoryId,
        type: record.type,
        provider: record.provider,
        externalId: record.externalId,
        url: record.url,
        title: record.title,
        content: record.content,
        author: record.author,
        occurredAt: new Date(record.occurredAt),
        metadata: record.metadata as Prisma.InputJsonValue,
        contentHash: record.contentHash
      })),
      skipDuplicates: true
    });
    return result.count;
  }

  async hasIngestionReceipt(organisationId: string, provider: string, externalId: string): Promise<boolean> {
    await this.#assertOrganisation(organisationId);
    const count = await this.prisma.ingestionReceipt.count({ where: { organisationId, provider, externalId } });
    return count > 0;
  }

  async saveIngestionReceipt(
    organisationId: string,
    provider: string,
    externalId: string,
    eventType: string
  ): Promise<void> {
    await this.#assertOrganisation(organisationId);
    await this.prisma.ingestionReceipt.upsert({
      where: { organisationId_provider_externalId: { organisationId, provider, externalId } },
      create: { organisationId, provider, externalId, eventType, processedAt: new Date() },
      update: { processedAt: new Date(), eventType }
    });
  }

  async #assertOrganisation(organisationId: string): Promise<void> {
    const count = await this.prisma.organisation.count({ where: { id: organisationId } });
    if (count === 0) throw new ForbiddenError();
  }

  #mapEvidence(row: EvidenceRow): EvidenceRecord {
    return {
      id: row.id,
      organisationId: row.organisationId,
      ...optional(row.repositoryId, "repositoryId"),
      type: row.type,
      provider: row.provider,
      externalId: row.externalId,
      ...optional(row.url, "url"),
      ...optional(row.title, "title"),
      content: row.content,
      ...optional(row.author, "author"),
      occurredAt: row.occurredAt.toISOString(),
      metadata: asRecord(row.metadata),
      ...optional(row.contentHash, "contentHash")
    } as EvidenceRecord;
  }

  #mapKnowledge(row: KnowledgeRow): KnowledgeItem {
    const openChallenges = row.challenges.filter((challenge) => challenge.status === "open").length;
    return {
      id: row.id,
      organisationId: row.organisationId,
      ...optional(row.repositoryId, "repositoryId"),
      kind: row.kind,
      status: row.status,
      title: row.title,
      statement: row.statement,
      rationale: row.rationale,
      confidence: row.confidence,
      severity: row.severity,
      scope: asRecord(row.scope) as KnowledgeScope,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(row.lastConfirmedAt ? { lastConfirmedAt: row.lastConfirmedAt.toISOString() } : {}),
      evidenceIds: row.evidenceLinks.map((link) => link.evidenceId),
      contradictionCount: openChallenges,
      health: openChallenges > 0 ? "conflicted" : row.lastConfirmedAt ? "healthy" : "needs_review"
    } as KnowledgeItem;
  }

  #mapCandidate(row: CandidateRow): CandidateRecord {
    const item = this.#mapKnowledge(row);
    const metadata = asRecord(row.metadata);
    return {
      ...item,
      status: "candidate",
      evidence: row.evidenceLinks.map((link) => this.#mapEvidence(link.evidence)),
      contradictionSummaries: asStringArray(metadata.contradictionSummaries),
      confidenceFactors: asRecord(metadata.confidenceFactors) as unknown as CandidateRecord["confidenceFactors"],
      ...(Object.keys(asRecord(metadata.comparison)).length
        ? { comparison: asRecord(metadata.comparison) as unknown as CandidateRecord["comparison"] }
        : {}),
      ...(typeof metadata.proposalId === "string" ? { proposalId: metadata.proposalId } : {}),
      ...(typeof metadata.proposedExclusion === "string" ? { proposedExclusion: metadata.proposedExclusion } : {})
    };
  }
}
