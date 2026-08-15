import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { z } from "zod";
import { TypeScriptAnalyzer, PhpLanguageAnalyzer, LocalRepositoryIndexer, addGitHistoryRelationships } from "@lore/analysis/index.js";
import { MockAIProvider, KnowledgeExtractionService, selectAIProvider } from "@lore/ai/index.js";
import { validateKnowledgeProposal } from "@lore/core/index.js";
import { createLoreStore, createRedisConnection, LORE_QUEUE_NAME } from "@lore/database/index.js";
import { assertTrustedRepositoryPath, LocalGit } from "@lore/git/index.js";
import { GitHubImportService, GitHubSourceControlProvider } from "@lore/github/index.js";
import { KnowledgeHealthService } from "@lore/knowledge/index.js";
import type { CandidateRecord, ConfidenceFactors } from "@lore/shared/types.js";

const store = createLoreStore({ ...process.env, DEMO_MODE: "false" });
const connection = createRedisConnection();
const queue = new Queue(LORE_QUEUE_NAME, { connection });
const git = new LocalGit();

const indexJobSchema = z.object({
  organisationId: z.string().min(1),
  repositoryId: z.string().min(1),
  localPath: z.string().min(1)
});

const githubJobSchema = z.object({
  organisationId: z.string().min(1),
  repositoryId: z.string().min(1),
  installationId: z.number().int().positive(),
  limit: z.union([z.literal(50), z.literal(100), z.literal(250), z.literal(500), z.literal(1000)]).default(100)
});

const extractionJobSchema = z.object({
  organisationId: z.string().min(1),
  repositoryId: z.string().min(1),
  evidenceIds: z.array(z.string()).min(1)
});

const mockProvider = new MockAIProvider((request) => {
  const ids = [...request.untrustedSourceContent.matchAll(/<evidence id="([^"]+)"/g)].map((match) => match[1]).filter((id): id is string => Boolean(id));
  const content = request.untrustedSourceContent.toLowerCase();
  if (ids.length >= 2 && content.includes("repository interface")) {
    return {
      candidates: [
        {
          kind: "preference",
          title: "Prefer repository interfaces at service boundaries",
          statement: "The observed reviewer tends to prefer repository interfaces at application service boundaries.",
          rationale: "The same explicit review request appears in independent evidence.",
          proposedScope: { repository: "current", paths: ["src/**/Service/**"] },
          evidenceIds: ids.slice(0, 5),
          possibleContradictionIds: []
        }
      ]
    };
  }
  return { candidates: [] };
});
const aiProvider = selectAIProvider(process.env.AI_PROVIDER ?? "mock", { mock: mockProvider });

const worker = new Worker(
  LORE_QUEUE_NAME,
  async (job) => {
    const startedAt = Date.now();
    if (job.name === "repository.index") {
      const input = indexJobSchema.parse(job.data);
      const repository = await store.getRepository(input.organisationId, input.repositoryId);
      const localPath = await assertTrustedRepositoryPath(input.localPath);
      const commit = await git.currentCommit(localPath);
      const indexer = new LocalRepositoryIndexer([new TypeScriptAnalyzer(), new PhpLanguageAnalyzer()]);
      const output = await indexer.analyze({ ...repository, lastIndexedCommit: commit }, localPath);
      const history = await git.history(localPath, undefined, 500);
      const enriched = {
        ...output,
        relationships: addGitHistoryRelationships(repository.id, output.entities, output.relationships, history)
      };
      await store.saveAnalysis(input.organisationId, enriched);
      return { filesScanned: enriched.filesScanned, entities: enriched.entities.length, relationships: enriched.relationships.length, durationMs: Date.now() - startedAt };
    }

    if (job.name === "github.import") {
      const input = githubJobSchema.parse(job.data);
      const appId = Number(process.env.GITHUB_APP_ID);
      const privateKey = process.env.GITHUB_PRIVATE_KEY;
      if (!appId || !privateKey) throw new Error("GITHUB_APP_ID and GITHUB_PRIVATE_KEY are required for GitHub import jobs");
      const repository = await store.getRepository(input.organisationId, input.repositoryId);
      const importer = new GitHubImportService(
        new GitHubSourceControlProvider({ appId, privateKey, installationId: input.installationId }),
        store
      );
      const imported = await importer.importMergedPullRequests(input.organisationId, repository, input.limit);
      if (imported.evidenceIds.length > 0) {
        await queue.add(
          "knowledge.extract",
          { organisationId: input.organisationId, repositoryId: input.repositoryId, evidenceIds: imported.evidenceIds },
          { jobId: `extract-import-${input.repositoryId}-${input.limit}`, attempts: 3, removeOnComplete: 1_000, removeOnFail: 5_000 }
        );
      }
      return imported;
    }

    if (job.name === "knowledge.extract") {
      const input = extractionJobSchema.parse(job.data);
      const [allEvidence, snapshot] = await Promise.all([
        store.getEvidence(input.organisationId),
        store.getSnapshot(input.organisationId)
      ]);
      const sourceEvidence = allEvidence.filter((record) => input.evidenceIds.includes(record.id));
      const extraction = await new KnowledgeExtractionService(aiProvider).extract(sourceEvidence);
      let created = 0;
      for (const proposed of extraction.candidates) {
        const payload = {
          kind: proposed.kind,
          title: proposed.title,
          statement: proposed.statement,
          rationale: proposed.rationale,
          scope: proposed.proposedScope,
          evidenceIds: proposed.evidenceIds
        };
        const validation = validateKnowledgeProposal({
          organisationId: input.organisationId,
          repositoryId: input.repositoryId,
          payload,
          evidence: allEvidence,
          existingKnowledge: snapshot.knowledge,
          humanInitiated: false
        });
        const proposal = await store.saveKnowledgeProposal(input.organisationId, {
          repositoryId: input.repositoryId,
          operation: "create",
          payload,
          source: "mock-ai:knowledge-extractor/v1",
          status: validation.valid ? "pending" : "failed_validation",
          validationErrors: validation.errors
        });
        if (!validation.valid) continue;
        const evidenceRecords = allEvidence.filter((record) => proposed.evidenceIds.includes(record.id));
        const factors: ConfidenceFactors = {
          supportingObservations: evidenceRecords.length,
          independentPullRequests: new Set(evidenceRecords.map((record) => {
            const pullRequest = record.metadata.pullRequest;
            return typeof pullRequest === "string" || typeof pullRequest === "number" ? String(pullRequest) : record.externalId;
          })).size,
          independentReviewers: new Set(evidenceRecords.map((record) => record.author).filter(Boolean)).size,
          recency: 0.9,
          explicitness: 0.78,
          sourceReliability: 0.82,
          contradictions: validation.contradictions.length,
          humanConfirmed: false,
          scopeStable: proposed.proposedScope.paths?.length ? true : false,
          codeStillMatches: true
        };
        const confidence = new KnowledgeHealthService().recalculateCandidate(proposed.kind, factors);
        const now = new Date().toISOString();
        const candidate: CandidateRecord = {
          id: randomUUID(),
          organisationId: input.organisationId,
          repositoryId: input.repositoryId,
          kind: proposed.kind,
          status: "candidate",
          title: proposed.title,
          statement: proposed.statement,
          rationale: proposed.rationale,
          confidence,
          severity: proposed.kind === "regression" ? "warning" : proposed.kind === "preference" ? "suggestion" : "warning",
          scope: proposed.proposedScope,
          createdBy: "mock-ai:knowledge-extractor/v1",
          createdAt: now,
          updatedAt: now,
          evidenceIds: proposed.evidenceIds,
          contradictionCount: validation.contradictions.length,
          health: validation.contradictions.length ? "conflicted" : "needs_review",
          evidence: evidenceRecords,
          contradictionSummaries: validation.contradictions.map((item) => item.statement),
          confidenceFactors: factors,
          proposalId: proposal.id
        };
        await store.createKnowledgeCandidate(input.organisationId, candidate);
        created += 1;
      }
      return { evidenceAnalysed: sourceEvidence.length, proposals: extraction.candidates.length, candidatesCreated: created };
    }

    if (job.name === "knowledge.health") {
      const input = z.object({ organisationId: z.string().min(1) }).parse(job.data);
      const snapshot = await store.getSnapshot(input.organisationId);
      const health = new KnowledgeHealthService();
      const results = snapshot.knowledge.map((item) =>
        health.evaluate(item, {
          codeStillMatches: item.health !== "stale",
          recentContradictions: item.contradictionCount,
          scopeStable: true
        })
      );
      return { evaluated: results.length, needsReview: results.filter((item) => item.health !== "healthy").length, results };
    }

    throw new Error(`Unsupported Lore job: ${job.name}`);
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4) }
);

worker.on("completed", (job, value) => {
  const result: unknown = value;
  process.stdout.write(`${JSON.stringify({ event: "job.completed", jobId: job.id, jobName: job.name, result })}\n`);
});
worker.on("failed", (job, error) => {
  process.stderr.write(`${JSON.stringify({ event: "job.failed", jobId: job?.id, jobName: job?.name, error: error.message })}\n`);
});

const shutdown = async (): Promise<void> => {
  await worker.close();
  await queue.close();
  await connection.quit();
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
