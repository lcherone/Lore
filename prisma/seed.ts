import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { createPrismaClient } from "../packages/database/src/client.js";
import { createDemoSnapshot, getDemoEvidence } from "../packages/shared/src/demo-data.js";
import { createDemoCodeGraph } from "../packages/shared/src/demo-graph.js";
import type { CandidateRecord } from "../packages/shared/src/types.js";

const uuidFor = (value: string): string => {
  const hex = createHash("sha256").update(`lore-demo:${value}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) % 4] ?? "8";
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
};

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const snapshot = createDemoSnapshot();
const evidence = getDemoEvidence();
const graph = createDemoCodeGraph();
const organisationId = uuidFor(snapshot.organisation.id);
const repositoryId = uuidFor(snapshot.repositories[0]!.id);
const userId = uuidFor("user_casey");
const prisma = createPrismaClient();

const existing = await prisma.organisation.findUnique({ where: { slug: snapshot.organisation.slug } });
if (existing && process.env.SEED_FORCE !== "true") {
  process.stdout.write(`${JSON.stringify({ skipped: true, reason: "demo organisation already exists", organisationId: existing.id })}\n`);
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.organisation.deleteMany({ where: { slug: snapshot.organisation.slug } });
await prisma.user.upsert({
  where: { email: "casey@acme.example" },
  create: { id: userId, email: "casey@acme.example", name: "Casey Hall" },
  update: { name: "Casey Hall" }
});
await prisma.organisation.create({
  data: {
    id: organisationId,
    name: snapshot.organisation.name,
    slug: snapshot.organisation.slug,
    memberships: { create: { id: uuidFor("membership_casey"), userId, role: "owner" } }
  }
});

const repository = snapshot.repositories[0]!;
await prisma.repository.create({
  data: {
    id: repositoryId,
    organisationId,
    provider: repository.provider,
    providerRepositoryId: repository.providerRepositoryId,
    owner: repository.owner,
    name: repository.name,
    defaultBranch: repository.defaultBranch,
    cloneUrl: repository.cloneUrl,
    localPath: repository.localPath,
    languageSummary: json(repository.languageSummary),
    retentionConfig: json(repository.retentionConfig ?? {}),
    lastIndexedCommit: repository.lastIndexedCommit,
    analysisVersion: "1"
  }
});

await prisma.evidence.createMany({
  data: evidence.map((record) => ({
    id: uuidFor(record.id),
    organisationId,
    repositoryId: record.repositoryId ? repositoryId : null,
    type: record.type,
    provider: record.provider,
    externalId: record.externalId,
    url: record.url,
    title: record.title,
    content: record.content,
    author: record.author,
    occurredAt: new Date(record.occurredAt),
    metadata: json(record.metadata),
    contentHash: createHash("sha256").update(record.content).digest("hex")
  }))
});

await prisma.codeEntity.createMany({
  data: graph.entities.map((entity) => ({
    id: uuidFor(entity.id),
    repositoryId,
    type: entity.type,
    name: entity.name,
    qualifiedName: entity.qualifiedName,
    path: entity.path,
    startLine: entity.startLine,
    endLine: entity.endLine,
    language: entity.language,
    metadata: json(entity.metadata),
    fingerprint: entity.fingerprint,
    analyzerVersion: typeof entity.metadata.analyzerVersion === "string" ? entity.metadata.analyzerVersion : "fixture-v1"
  }))
});
await prisma.codeRelationship.createMany({
  data: graph.relationships.map((relationship) => ({
    id: uuidFor(relationship.id),
    repositoryId,
    sourceEntityId: uuidFor(relationship.sourceEntityId),
    targetEntityId: uuidFor(relationship.targetEntityId),
    relationshipType: relationship.relationshipType,
    confidence: relationship.confidence,
    source: relationship.source,
    metadata: json(relationship.metadata)
  }))
});
await prisma.regressionRecord.createMany({
  data: graph.regressions.map((regression) => ({
    id: uuidFor(regression.id),
    repositoryId,
    title: regression.title,
    description: regression.description,
    introducedByCommit: regression.introducedByCommit,
    fixedByCommit: regression.fixedByCommit,
    pullRequestId: regression.pullRequestId,
    ticketId: regression.ticketId,
    affectedEntities: json(regression.affectedEntities),
    evidence: json(regression.evidenceIds.map(uuidFor)),
    severity: regression.severity,
    createdAt: new Date(regression.createdAt)
  }))
});

for (const item of [...snapshot.knowledge, ...snapshot.candidates]) {
  const candidate = "confidenceFactors" in item ? (item as CandidateRecord) : undefined;
  await prisma.knowledgeItem.create({
    data: {
      id: uuidFor(item.id),
      organisationId,
      repositoryId: item.repositoryId ? repositoryId : null,
      kind: item.kind,
      status: item.status,
      title: item.title,
      statement: item.statement,
      rationale: item.rationale,
      confidence: item.confidence,
      severity: item.severity,
      scope: json(item.scope),
      metadata: json(
        candidate
          ? {
              confidenceFactors: candidate.confidenceFactors,
              contradictionSummaries: candidate.contradictionSummaries,
              ...(candidate.proposedExclusion ? { proposedExclusion: candidate.proposedExclusion } : {})
            }
          : { seeded: true }
      ),
      createdBy: item.createdBy,
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
      lastConfirmedAt: item.lastConfirmedAt ? new Date(item.lastConfirmedAt) : null,
      evidenceLinks: {
        create: item.evidenceIds.map((evidenceId) => ({
          evidenceId: uuidFor(evidenceId),
          relationship: "supports" as const,
          weight: 1
        }))
      },
      revisions: {
        create: {
          version: 1,
          statement: item.statement,
          scope: json(item.scope),
          classification: item.kind,
          confidence: item.confidence,
          status: item.status,
          changeReason: "Created by the Lore demonstration seed",
          createdBy: item.createdBy
        }
      },
      ...(item.status === "challenged"
        ? { challenges: { create: { reason: "New evidence suggests the scope needs review", status: "open" } } }
        : {})
    }
  });
}

await prisma.policy.createMany({
  data: snapshot.policies.map((policy) => ({
    id: uuidFor(policy.id),
    organisationId,
    repositoryId: policy.repositoryId ? repositoryId : null,
    name: policy.name,
    description: policy.description,
    owner: policy.owner,
    severity: policy.severity,
    scope: json(policy.scope),
    enabled: policy.enabled,
    detectorType: policy.detector.type,
    detectorConfig: json(policy.detector),
    createdAt: new Date(policy.createdAt),
    updatedAt: new Date(policy.updatedAt)
  }))
});
await prisma.reviewerProfile.createMany({
  data: snapshot.reviewers.map((reviewer) => ({
    id: uuidFor(reviewer.id),
    organisationId,
    providerIdentity: reviewer.providerIdentity,
    name: reviewer.name,
    email: reviewer.email,
    metadata: json({
      preferenceCount: reviewer.preferenceCount,
      reinforcedCount: reviewer.reinforcedCount,
      lastObservedAt: reviewer.lastObservedAt
    })
  }))
});
await prisma.agentSession.createMany({
  data: snapshot.sessions.map((session) => ({
    id: uuidFor(session.id),
    organisationId,
    repositoryId,
    task: session.task,
    status: session.status,
    baseCommit: session.baseCommit,
    currentCommit: session.currentCommit,
    startedAt: new Date(session.startedAt),
    completedAt: session.completedAt ? new Date(session.completedAt) : null,
    agentType: session.agentType,
    metadata: json({ warningCount: session.warningCount }),
    filesObserved: json(session.filesObserved),
    filesChanged: json(session.filesChanged)
  }))
});
await prisma.changeSafetyReport.createMany({
  data: snapshot.reports.map((report) => ({
    id: uuidFor(report.id),
    organisationId,
    repositoryId,
    task: report.task,
    risk: report.risk.toLowerCase() as "low" | "medium" | "high" | "critical",
    payload: json({
      ...report,
      id: uuidFor(report.id),
      repositoryId,
      applicablePolicies: report.applicablePolicies.map((policy) => ({ ...policy, id: uuidFor(policy.id), organisationId, repositoryId: policy.repositoryId ? repositoryId : undefined })),
      applicableRules: report.applicableRules.map((item) => ({ ...item, id: uuidFor(item.id), organisationId, repositoryId })),
      relevantDecisions: report.relevantDecisions.map((item) => ({ ...item, id: uuidFor(item.id), organisationId, repositoryId })),
      historicalRegressions: report.historicalRegressions.map((item) => ({ ...item, id: uuidFor(item.id), repositoryId }))
    }),
    blockers: report.blockers.length,
    warnings: report.warnings.length,
    createdAt: new Date(report.createdAt)
  }))
});
await prisma.auditEvent.create({
  data: {
    id: uuidFor("audit_seed"),
    organisationId,
    userId,
    action: "demo.seeded",
    targetType: "Organisation",
    targetId: organisationId,
    after: json({ repositories: 1, knowledge: snapshot.knowledge.length, candidates: snapshot.candidates.length })
  }
});

process.stdout.write(
  `${JSON.stringify({ organisationId, repositoryId, knowledge: snapshot.knowledge.length, candidates: snapshot.candidates.length, evidence: evidence.length })}\n`
);
await prisma.$disconnect();
