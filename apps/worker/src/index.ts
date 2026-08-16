import "dotenv/config";
import { createHash } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import { z } from "zod";
import {
  TypeScriptAnalyzer,
  PhpLanguageAnalyzer,
  LocalRepositoryIndexer,
  addGitHistoryRelationships
} from "@lore/analysis/index.js";
import { createBundledMockAIProvider, createConfiguredAIProvider } from "@lore/ai/index.js";
import {
  BullMqJobDispatcher,
  createPrismaClient,
  createRedisConnection,
  LORE_QUEUE_NAME,
  PersistentJobDispatcher,
  PrismaJobLedger,
  PrismaLoreStore
} from "@lore/database/index.js";
import { assertTrustedRepositoryPath, LocalGit } from "@lore/git/index.js";
import {
  GitHubImportService,
  GitHubRequestPacer,
  GitHubSourceControlProvider,
  GitHubTokenSourceControlProvider,
  resolveGitHubRequestsPerHour,
  type GitHubRequestWait
} from "@lore/github/index.js";
import {
  createKnowledgeExtractionBatches,
  CandidateTriageService,
  KnowledgeCandidateExtractionService,
  KnowledgeHealthService
} from "@lore/knowledge/index.js";
import { loadGitHubPrivateKey, loadGitHubToken } from "./github-credentials.js";
import type { LoreJobName } from "@lore/shared/types.js";

const prisma = createPrismaClient();
const store = new PrismaLoreStore(prisma);
const jobLedger = new PrismaJobLedger(prisma);
const nestedJobs = new PersistentJobDispatcher(
  new BullMqJobDispatcher(process.env.REDIS_URL),
  jobLedger
);
const connection = createRedisConnection();
const queue = new Queue(LORE_QUEUE_NAME, { connection });
const git = new LocalGit();
const GITHUB_IMPORT_LOCK_TTL_MS = 120_000;
const GITHUB_IMPORT_LOCK_HEARTBEAT_MS = 30_000;
const REFRESH_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
const RELEASE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const githubRequestPacer = new GitHubRequestPacer({
  requestsPerHour: resolveGitHubRequestsPerHour(process.env.GITHUB_REQUESTS_PER_HOUR),
  onWait: (wait) => {
    process.stdout.write(`${JSON.stringify({ event: "github.rate_limit.wait", ...wait })}\n`);
  }
});

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

const candidateTriageJobSchema = z.object({
  organisationId: z.string().min(1),
  candidateIds: z.array(z.string().min(1)).min(1).max(1_000),
  force: z.boolean().default(false)
});

const mockProvider = createBundledMockAIProvider();
const aiRuntime = createConfiguredAIProvider(process.env, mockProvider);
const aiProvider = aiRuntime.provider;

const executeJob = async (job: Job, runId?: string): Promise<unknown> => {
  const startedAt = Date.now();
  if (job.name === "repository.index") {
    const input = indexJobSchema.parse(job.data);
    const repository = await store.getRepository(input.organisationId, input.repositoryId);
    const localPath = await assertTrustedRepositoryPath(input.localPath);
    const commit = await git.currentCommit(localPath);
    const indexer = new LocalRepositoryIndexer([
      new TypeScriptAnalyzer(),
      new PhpLanguageAnalyzer()
    ]);
    const output = await indexer.analyze({ ...repository, lastIndexedCommit: commit }, localPath);
    const history = await git.history(localPath, undefined, 500);
    const enriched = {
      ...output,
      relationships: addGitHistoryRelationships(
        repository.id,
        output.entities,
        output.relationships,
        history
      )
    };
    await store.saveAnalysis(input.organisationId, enriched);
    return {
      filesScanned: enriched.filesScanned,
      entities: enriched.entities.length,
      relationships: enriched.relationships.length,
      durationMs: Date.now() - startedAt
    };
  }

  if (job.name === "github.import") {
    const input = githubJobSchema.parse(job.data);
    const lockKey = `lore:github-import:${input.repositoryId}`;
    const lockOwner = String(job.id);
    const acquired = await connection.set(
      lockKey,
      lockOwner,
      "PX",
      GITHUB_IMPORT_LOCK_TTL_MS,
      "NX"
    );
    if (acquired !== "OK") {
      return { skipped: true, reason: "repository_import_already_running" };
    }
    const heartbeat = setInterval(() => {
      void connection
        .eval(REFRESH_LOCK_SCRIPT, 1, lockKey, lockOwner, String(GITHUB_IMPORT_LOCK_TTL_MS))
        .catch((error: unknown) => {
          process.stderr.write(
            `${JSON.stringify({ event: "github.import.lock_refresh_failed", error: error instanceof Error ? error.message : String(error) })}\n`
          );
        });
    }, GITHUB_IMPORT_LOCK_HEARTBEAT_MS);
    const onRequestWait = (wait: GitHubRequestWait): void => {
      if (!runId) return;
      const reason = wait.reason.replaceAll("-", " ");
      void jobLedger
        .recordProgress(
          runId,
          `GitHub ${reason}; Lore will continue automatically at ${wait.resumeAt}`,
          { ...wait }
        )
        .catch((error: unknown) => {
          process.stderr.write(
            `${JSON.stringify({ event: "github.rate_limit.progress_failed", error: error instanceof Error ? error.message : String(error) })}\n`
          );
        });
    };
    try {
      const repository = await store.getRepository(input.organisationId, input.repositoryId);
      const provider =
        input.authMode === "token"
          ? new GitHubTokenSourceControlProvider(
              (await loadGitHubToken()) ??
                (() => {
                  throw new Error(
                    "GITHUB_TOKEN or GITHUB_TOKEN_PATH is required for token import jobs"
                  );
                })(),
              undefined,
              githubRequestPacer,
              onRequestWait
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
              installationId: input.installationId!,
              requestPacer: githubRequestPacer,
              onRequestWait
            });
      const organisationSettings = await store.getOrganisationSettings(input.organisationId);
      let extractionBatchesQueued = 0;
      const importer = new GitHubImportService(provider, store);
      const imported = await importer.importMergedPullRequests(
        input.organisationId,
        repository,
        input.limit,
        async (evidence) => {
          if (!organisationSettings.autoExtractKnowledge) return;
          const evidenceIds = evidence.map((record) => record.id);
          const batches = createKnowledgeExtractionBatches(evidence, evidenceIds);
          for (const evidenceIds of batches) {
            const evidenceBatch = createHash("sha256")
              .update(evidenceIds.toSorted().join("\n"))
              .digest("hex")
              .slice(0, 16);
            await nestedJobs.dispatch(
              "knowledge.extract",
              {
                organisationId: input.organisationId,
                repositoryId: input.repositoryId,
                evidenceIds
              },
              `extract-import-${input.repositoryId}-${evidenceBatch}`
            );
            extractionBatchesQueued += 1;
          }
        }
      );
      return { ...imported, extractionBatchesQueued };
    } finally {
      clearInterval(heartbeat);
      await connection.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockOwner);
    }
  }

  if (job.name === "knowledge.extract") {
    const input = extractionJobSchema.parse(job.data);
    const result = await new KnowledgeCandidateExtractionService(
      store,
      aiProvider,
      `${aiRuntime.name}-ai:knowledge-extractor/v3${aiRuntime.model ? `:${aiRuntime.model}` : ""}`
    ).extract(input);
    return {
      evidenceAnalysed: result.evidenceAnalysed,
      proposals: result.proposals,
      candidatesCreated: result.candidatesCreated
    };
  }

  if (job.name === "candidate.triage") {
    const input = candidateTriageJobSchema.parse(job.data);
    return new CandidateTriageService(
      store,
      aiProvider,
      `${aiRuntime.name}-ai:candidate-triage/v1${aiRuntime.model ? `:${aiRuntime.model}` : ""}`
    ).triage({
      ...input,
      onProgress: async (progress) => {
        if (!runId) return;
        await jobLedger.recordProgress(
          runId,
          `Candidate triage ${progress.completed}/${progress.total}; ${progress.deterministic} deterministic, ${progress.ai} AI`,
          progress
        );
      }
    });
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
    return {
      evaluated: results.length,
      needsReview: results.filter((item) => item.health !== "healthy").length,
      results
    };
  }

  throw new Error(`Unsupported Lore job: ${job.name}`);
};

const reconcileDurableTransportState = async (): Promise<void> => {
  const activeRuns = await prisma.jobRun.findMany({
    where: {
      state: { in: ["dispatched", "running", "retrying"] },
      externalJobId: { not: null }
    },
    select: { id: true, externalJobId: true }
  });
  for (const run of activeRuns) {
    const externalJobId = run.externalJobId;
    if (!externalJobId) continue;
    const transportJob = await queue.getJob(externalJobId);
    if (!transportJob) {
      await jobLedger.markTransportFailed(
        externalJobId,
        new Error(
          "The queued job no longer exists after worker restart; queue it again to resume safely"
        ),
        true
      );
      continue;
    }
    const state = await transportJob.getState();
    if (state === "failed") {
      await jobLedger.markTransportFailed(
        externalJobId,
        new Error(transportJob.failedReason || "The job transport reported a terminal failure"),
        true
      );
    } else if (state === "completed") {
      await jobLedger.markSucceeded(run.id, transportJob.returnvalue ?? { reconciled: true });
    }
  }
};

await reconcileDurableTransportState();

const worker = new Worker(
  LORE_QUEUE_NAME,
  async (job) => {
    const data =
      job.data && typeof job.data === "object" ? (job.data as Record<string, unknown>) : {};
    const organisationId =
      typeof data.organisationId === "string" ? data.organisationId : undefined;
    const repositoryId = typeof data.repositoryId === "string" ? data.repositoryId : undefined;
    const suppliedRunId = typeof data.loreJobRunId === "string" ? data.loreJobRunId : undefined;
    const attempt = job.attemptsMade + 1;
    const maximumAttempts = Number(job.opts.attempts ?? 1);
    let runId: string | undefined;
    if (organisationId) {
      runId = await jobLedger.markRunning({
        ...(suppliedRunId ? { runId: suppliedRunId } : {}),
        organisationId,
        ...(repositoryId ? { repositoryId } : {}),
        name: job.name as LoreJobName,
        externalJobId: String(job.id),
        attempt,
        maximumAttempts
      });
    }
    try {
      const result = await executeJob(job, runId);
      if (runId) await jobLedger.markSucceeded(runId, result);
      return result;
    } catch (error) {
      if (runId) await jobLedger.markFailed(runId, error, attempt >= maximumAttempts);
      throw error;
    }
  },
  {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
    maxStalledCount: Number(process.env.WORKER_MAX_STALLED_COUNT ?? 10)
  }
);

worker.on("completed", (job, value) => {
  const result: unknown = value;
  process.stdout.write(
    `${JSON.stringify({ event: "job.completed", jobId: job.id, jobName: job.name, result })}\n`
  );
});
worker.on("failed", (job, error) => {
  process.stderr.write(
    `${JSON.stringify({ event: "job.failed", jobId: job?.id, jobName: job?.name, error: error.message })}\n`
  );
  if (job?.id) {
    void job
      .getState()
      .then((state) => jobLedger.markTransportFailed(String(job.id), error, state === "failed"))
      .catch((reconciliationError: unknown) => {
        process.stderr.write(
          `${JSON.stringify({
            event: "job.failed.reconciliation_failed",
            jobId: job.id,
            error:
              reconciliationError instanceof Error
                ? reconciliationError.message
                : String(reconciliationError)
          })}\n`
        );
      });
  }
});

const shutdown = async (): Promise<void> => {
  await worker.close();
  await nestedJobs.close();
  await queue.close();
  await connection.quit();
  await prisma.$disconnect();
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
