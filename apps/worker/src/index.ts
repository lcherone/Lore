import { createHash } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { z } from "zod";
import { TypeScriptAnalyzer, PhpLanguageAnalyzer, LocalRepositoryIndexer, addGitHistoryRelationships } from "@lore/analysis/index.js";
import { createBundledMockAIProvider, createConfiguredAIProvider } from "@lore/ai/index.js";
import { createLoreStore, createRedisConnection, LORE_QUEUE_NAME } from "@lore/database/index.js";
import { assertTrustedRepositoryPath, LocalGit } from "@lore/git/index.js";
import {
  GitHubImportService,
  GitHubSourceControlProvider,
  GitHubTokenSourceControlProvider
} from "@lore/github/index.js";
import { KnowledgeCandidateExtractionService, KnowledgeHealthService } from "@lore/knowledge/index.js";
import { loadGitHubPrivateKey, loadGitHubToken } from "./github-credentials.js";

const store = createLoreStore({ ...process.env, DEMO_MODE: "false" });
const connection = createRedisConnection();
const queue = new Queue(LORE_QUEUE_NAME, { connection });
const git = new LocalGit();

const indexJobSchema = z.object({
  organisationId: z.string().min(1),
  repositoryId: z.string().min(1),
  localPath: z.string().min(1)
});

const githubJobSchema = z
  .object({
    organisationId: z.string().min(1),
    repositoryId: z.string().min(1),
    authMode: z.enum(["app", "token"]),
    installationId: z.number().int().positive().optional(),
    limit: z
      .union([
        z.literal(50),
        z.literal(100),
        z.literal(250),
        z.literal(500),
        z.literal(1000),
        z.literal("all")
      ])
      .default(100)
  })
  .superRefine((input, context) => {
    if (input.authMode === "app" && !input.installationId) {
      context.addIssue({
        code: "custom",
        path: ["installationId"],
        message: "GitHub App jobs require an installation ID"
      });
    }
  });

const extractionJobSchema = z.object({
  organisationId: z.string().min(1),
  repositoryId: z.string().min(1),
  evidenceIds: z.array(z.string()).min(1)
});

const mockProvider = createBundledMockAIProvider();
const aiRuntime = createConfiguredAIProvider(process.env, mockProvider);
const aiProvider = aiRuntime.provider;

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
      const repository = await store.getRepository(input.organisationId, input.repositoryId);
      const provider =
        input.authMode === "token"
          ? new GitHubTokenSourceControlProvider(
              (await loadGitHubToken()) ??
                (() => {
                  throw new Error(
                    "GITHUB_TOKEN or GITHUB_TOKEN_PATH is required for token import jobs"
                  );
                })()
            )
          : new GitHubSourceControlProvider({
              appId:
                Number(process.env.GITHUB_APP_ID) ||
                (() => {
                  throw new Error("GITHUB_APP_ID is required for GitHub App import jobs");
                })(),
              privateKey:
                (await loadGitHubPrivateKey()) ??
                (() => {
                  throw new Error(
                    "GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_PATH is required for GitHub App import jobs"
                  );
                })(),
              installationId: input.installationId!
            });
      const importer = new GitHubImportService(provider, store);
      const imported = await importer.importMergedPullRequests(input.organisationId, repository, input.limit);
      const organisationSettings = await store.getOrganisationSettings(input.organisationId);
      if (organisationSettings.autoExtractKnowledge && imported.evidenceIds.length > 0) {
        const evidenceBatch = createHash("sha256").update(imported.evidenceIds.sort().join("\n")).digest("hex").slice(0, 16);
        await queue.add(
          "knowledge.extract",
          { organisationId: input.organisationId, repositoryId: input.repositoryId, evidenceIds: imported.evidenceIds },
          {
            jobId: `extract-import-${input.repositoryId}-${evidenceBatch}`,
            attempts: 3,
            removeOnComplete: 1_000,
            removeOnFail: 5_000
          }
        );
      }
      return imported;
    }

    if (job.name === "knowledge.extract") {
      const input = extractionJobSchema.parse(job.data);
      const result = await new KnowledgeCandidateExtractionService(
        store,
        aiProvider,
        `${aiRuntime.name}-ai:knowledge-extractor/v1${aiRuntime.model ? `:${aiRuntime.model}` : ""}`
      ).extract(input);
      return {
        evidenceAnalysed: result.evidenceAnalysed,
        proposals: result.proposals,
        candidatesCreated: result.candidatesCreated
      };
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
