import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import csrfProtection from "@fastify/csrf-protection";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import rawBody from "fastify-raw-body";
import { z, ZodError } from "zod";
import type { AIProvider, JobDispatcher, LoreStore } from "@lore/core/index.js";
import { LoreError, NotFoundError } from "@lore/core/index.js";
import { createBundledMockAIProvider, createConfiguredAIProvider } from "@lore/ai/index.js";
import {
  BullMqJobDispatcher,
  createLoreStore,
  createPrismaClient,
  InMemoryJobDispatcher,
  InMemoryJobLedger,
  PersistentJobDispatcher,
  PrismaJobLedger,
  PrismaLoreStore,
  type JobLedger
} from "@lore/database/index.js";
import { TaskPreparationService } from "@lore/context/index.js";
import {
  createKnowledgeExtractionBatches,
  CandidateTriageService,
  candidateTriageFingerprint,
  KnowledgeCandidateExtractionService,
  KnowledgeService
} from "@lore/knowledge/index.js";
import { ChangeVerificationService } from "@lore/reporting/index.js";
import { assertTrustedRepositoryPath } from "@lore/git/index.js";
import {
  approveCandidateSchema,
  candidateBulkReviewSchema,
  candidateTriageRequestSchema,
  communicationEvidenceSchema,
  createSessionSchema,
  organisationSettingsSchema,
  prepareTaskSchema,
  repositoryRetentionConfigSchema,
  userSettingsSchema,
  verifyChangeSchema
} from "@lore/shared/schemas.js";
import type {
  CandidateRecord,
  CodeEntity,
  CodeRelationship,
  CommunicationEvidenceAnalysis,
  DashboardSnapshot,
  EvidenceComparisonDisposition,
  EvidenceRecord,
  DeploymentConfiguration,
  OrganisationSettings,
  PolicyDetector,
  PolicyRecord,
  PullRequestImportLimit,
  RepositorySummary
} from "@lore/shared/types.js";
import { deterministicUuid, newUuid } from "@lore/shared/ids.js";
import { DEMO_ORGANISATION_ID, DEMO_REPOSITORY_ID } from "@lore/shared/demo-data.js";
import { policyPatternError } from "@lore/shared/policy-patterns.js";
import {
  githubIntegrationStatus,
  GitHubTokenAccountClient,
  resolveGitHubAuthMode,
  verifyGitHubWebhook,
  webhookEvidence,
  type GitHubRepositoryOption
} from "@lore/github/index.js";

import {
  accountSession,
  assertRole,
  createOAuthState,
  createOAuthTransaction,
  decodeOAuthTransaction,
  encodeOAuthTransaction,
  GitHubOAuthProvider,
  issueSession,
  OAUTH_COOKIE,
  requireAuth,
  resolveAuthentication,
  SESSION_COOKIE,
  tenantContext,
  verifyOAuthState,
  verifyOAuthTransaction,
  type AuthContext,
  type GitHubIdentityProvider
} from "./auth.js";
import { ApiMetrics } from "./metrics.js";

const CANDIDATE_LIST_EVIDENCE_PREVIEW_CHARS = 1_500;

const candidateListView = (candidate: CandidateRecord): CandidateRecord => ({
  ...candidate,
  evidence: candidate.evidence.map((record) => ({
    ...record,
    content:
      record.content.length > CANDIDATE_LIST_EVIDENCE_PREVIEW_CHARS
        ? `${record.content.slice(0, CANDIDATE_LIST_EVIDENCE_PREVIEW_CHARS)}\n[… full retained source loads on candidate open …]`
        : record.content
  }))
});

const dashboardListView = (snapshot: DashboardSnapshot): DashboardSnapshot => ({
  ...snapshot,
  candidates: snapshot.candidates.map(candidateListView)
});

export interface ApiDependencies {
  store: LoreStore;
  jobs: JobDispatcher;
  jobLedger: JobLedger;
  aiProvider: AIProvider;
  githubIdentityProvider: GitHubIdentityProvider;
}

export interface CreateAppOptions {
  dependencies?: Partial<ApiDependencies>;
  demoMode?: boolean;
  logger?: boolean;
}

function deploymentConfiguration(demoMode: boolean): DeploymentConfiguration {
  const appUrl = process.env.APP_URL ?? "http://localhost:5173";
  const hostname = new URL(appUrl).hostname;
  const github = githubIntegrationStatus(process.env, demoMode);
  const configuredAI =
    (process.env.AI_PROVIDER?.trim().toLowerCase() ||
      (process.env.OPENAI_API_KEY?.trim() ? "openai" : "mock")) === "openai";
  return {
    deploymentMode: process.env.LORE_DEPLOYMENT_MODE === "saas" ? "saas" : "local",
    productMode: demoMode ? "demo" : "full",
    appUrl,
    loopbackOnly: new Set(["localhost", "127.0.0.1", "::1"]).has(hostname),
    persistence: demoMode ? "memory" : "postgresql",
    jobs: demoMode ? "memory" : "redis",
    login: {
      provider: "github",
      configured:
        process.env.LORE_DEPLOYMENT_MODE === "saas"
          ? Boolean(
              process.env.GITHUB_OAUTH_CLIENT_ID?.trim() &&
              process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim()
            )
          : Boolean(process.env.GITHUB_TOKEN?.trim())
    },
    github: {
      mode: github.mode,
      historicalImportReady: github.historicalImportReady,
      webhooksReady: github.webhooksReady
    },
    ai: {
      provider: configuredAI ? "openai" : "mock",
      configured: configuredAI ? Boolean(process.env.OPENAI_API_KEY?.trim()) : demoMode,
      ...(configuredAI ? { model: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini" } : {})
    },
    mcp: { transport: "stdio", serviceBacked: !demoMode }
  };
}

const repositoryRetentionSchema = repositoryRetentionConfigSchema;

const repositoryInputSchema = z.object({
  provider: z.enum(["github", "gitlab", "bitbucket", "local"]).default("github"),
  providerRepositoryId: z.string().max(200).optional(),
  providerInstallationId: z.string().regex(/^\d+$/).max(100).optional(),
  owner: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  defaultBranch: z.string().min(1).max(200).default("main"),
  cloneUrl: z.string().max(2_000).optional(),
  retentionConfig: repositoryRetentionSchema.optional()
});

const repositoryBatchInputSchema = z.object({
  repositories: z.array(repositoryInputSchema).min(1).max(500)
});

type RepositoryInput = z.infer<typeof repositoryInputSchema>;

const demoGitHubRepositories: GitHubRepositoryOption[] = Array.from({ length: 120 }, (_, index) => {
  const number = String(index + 1).padStart(3, "0");
  const owner = ["northstar-platform", "northstar-products", "casey-labs"][index % 3]!;
  const name = `service-${number}`;
  return {
    id: String(900_000 + index),
    owner,
    name,
    fullName: `${owner}/${name}`,
    private: index % 2 === 0,
    archived: index === 119,
    defaultBranch: index % 4 === 0 ? "master" : "main",
    description:
      index < 12
        ? `Payments platform component ${number}`
        : `Development fixture repository ${number}`,
    cloneUrl: `https://github.com/${owner}/${name}.git`,
    htmlUrl: `https://github.com/${owner}/${name}`
  };
});

const codeEntitySchema = z
  .object({
    id: z.string().uuid(),
    repositoryId: z.string().min(1),
    type: z.enum([
      "file",
      "class",
      "interface",
      "trait",
      "function",
      "method",
      "constant",
      "event",
      "listener",
      "service",
      "repository",
      "controller",
      "route",
      "database_table",
      "configuration_key",
      "external_api",
      "test"
    ]),
    name: z.string().min(1).max(1_000),
    qualifiedName: z.string().min(1).max(2_000),
    path: z.string().min(1).max(4_000),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    language: z.string().min(1).max(100),
    fingerprint: z.string().min(1).max(4_000),
    metadata: z.record(z.string(), z.unknown())
  })
  .strict();

const codeRelationshipSchema = z
  .object({
    id: z.string().uuid(),
    repositoryId: z.string().min(1),
    sourceEntityId: z.string().uuid(),
    targetEntityId: z.string().uuid(),
    relationshipType: z.string().min(1).max(200),
    confidence: z.number().min(0).max(1),
    source: z.enum(["static_analysis", "git_history", "ai_inference", "manual", "github", "jira"]),
    metadata: z.record(z.string(), z.unknown())
  })
  .strict();

const analysisUploadSchema = z
  .object({
    repositoryId: z.string().min(1),
    commit: z.string().min(1).max(128).optional(),
    indexedAt: z.string().datetime(),
    entities: z.array(codeEntitySchema).max(50_000),
    relationships: z.array(codeRelationshipSchema).max(200_000)
  })
  .strict();

// Local index files are already bounded to 50 MB by LocalProject. Keep the
// larger allowance scoped to the sanitised graph endpoint instead of raising
// the API-wide request limit for browser and account mutations.
const ANALYSIS_UPLOAD_BODY_LIMIT_BYTES = 50_000_000;

const policyInputSchema = z
  .object({
    repositoryId: z.string().optional(),
    name: z.string().min(3).max(200),
    description: z.string().min(8).max(4_000),
    owner: z.string().min(2).max(200),
    severity: z.enum(["info", "suggestion", "warning", "error", "blocker"]),
    scope: z.record(z.string(), z.unknown()),
    enabled: z.boolean().default(true),
    detector: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("forbidden_pattern"),
        patterns: z.array(z.string().min(1).max(256)).min(1).max(25),
        message: z.string().min(3).max(1_000)
      }),
      z.object({
        type: z.literal("forbidden_import"),
        imports: z.array(z.string().min(1).max(500)).min(1).max(100),
        message: z.string().min(3).max(1_000)
      }),
      z.object({
        type: z.literal("forbidden_path"),
        paths: z.array(z.string().min(1).max(1_000)).min(1).max(100),
        message: z.string().min(3).max(1_000)
      }),
      z.object({
        type: z.literal("required_test"),
        whenPaths: z.array(z.string().min(1).max(1_000)).min(1).max(100),
        testPaths: z.array(z.string().min(1).max(1_000)).min(1).max(100),
        message: z.string().min(3).max(1_000)
      }),
      z.object({
        type: z.literal("secret_scan"),
        patterns: z.array(z.string().min(1).max(256)).min(1).max(25),
        message: z.string().min(3).max(1_000)
      })
    ])
  })
  .strict()
  .superRefine((value, context) => {
    if (value.detector.type !== "forbidden_pattern" && value.detector.type !== "secret_scan")
      return;
    value.detector.patterns.forEach((pattern, index) => {
      const message = policyPatternError(pattern);
      if (message)
        context.addIssue({ code: "custom", path: ["detector", "patterns", index], message });
    });
  });

const manualKnowledgeSchema = z.object({
  repositoryId: z.string().optional(),
  kind: z.enum(["fact", "decision", "rule", "preference", "regression", "warning"]),
  title: z.string().min(3).max(200),
  statement: z.string().min(8).max(4_000),
  rationale: z.string().min(3).max(8_000),
  severity: z.enum(["info", "suggestion", "warning", "error", "blocker"]),
  scope: z.record(z.string(), z.unknown()),
  sourceUrl: z.string().url().max(2_000).optional(),
  sourceName: z.string().min(1).max(500).optional()
});

const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    bio: z.string().trim().max(500).optional(),
    company: z.string().trim().max(160).optional(),
    jobTitle: z.string().trim().max(160).optional(),
    location: z.string().trim().max(160).optional(),
    websiteUrl: z.union([z.string().trim().url().max(2_000), z.literal("")]).optional(),
    timezone: z.string().trim().max(100).optional()
  })
  .strict();

const organisationInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .min(2)
      .max(80)
  })
  .strict();

const organisationUpdateSchema = organisationInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one organisation field is required"
  });

const organisationRoleSchema = z.enum(["admin", "member", "viewer"]);

const invitationInputSchema = z
  .object({
    email: z.string().trim().email().max(320),
    role: organisationRoleSchema.default("member")
  })
  .strict();

const markdownKnowledgeImportSchema = z.object({
  format: z.literal("markdown"),
  content: z.string().min(8).max(2_000_000),
  sourceName: z.string().min(1).max(500),
  sourceUrl: z.string().url().max(2_000).optional(),
  repositoryId: z.string().min(1).optional()
});

function markdownKnowledgeItems(
  input: z.infer<typeof markdownKnowledgeImportSchema>,
  repositoryName?: string
): Array<z.input<typeof manualKnowledgeSchema>> {
  const sections = input.content
    .split(/(?=^#{1,3}\s+)/m)
    .map((section) => section.trim())
    .filter(Boolean);
  return sections.slice(0, 500).flatMap((section, index) => {
    const heading = section.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
    const body = section.replace(/^#{1,3}\s+.+$/m, "").trim();
    const statement = body
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4_000);
    if (statement.length < 8) return [];
    const title = (
      heading ??
      (sections.length === 1 ? input.sourceName : `${input.sourceName} section ${index + 1}`)
    ).slice(0, 200);
    const classificationText = `${input.sourceName} ${title}`.toLowerCase();
    const kind = /\badr\b|decision|architecture/.test(classificationText)
      ? ("decision" as const)
      : /agents\.md|contributing|rule|convention|must\b|never\b/.test(classificationText)
        ? ("rule" as const)
        : ("fact" as const);
    return [
      {
        ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
        kind,
        title,
        statement,
        rationale: `Imported from ${input.sourceName} through an explicit human action.`,
        severity: kind === "rule" ? ("warning" as const) : ("suggestion" as const),
        scope: repositoryName ? { repository: repositoryName } : {},
        ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
        sourceName: input.sourceName
      }
    ];
  });
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const demoMode = options.demoMode ?? process.env.DEMO_MODE === "true";
  if (demoMode && process.env.NODE_ENV === "production") {
    throw new Error(
      "DEMO_MODE is development-only; use the persistent local or SaaS runtime in production"
    );
  }
  const deploymentMode = process.env.LORE_DEPLOYMENT_MODE === "saas" ? "saas" : "local";
  const appUrl = new URL(process.env.APP_URL ?? "http://localhost:5173");
  const webOrigins = (process.env.WEB_ORIGIN ?? appUrl.origin)
    .split(",")
    .map((origin) => new URL(origin.trim()).origin);
  const secureCookies = appUrl.protocol === "https:";
  const configuredAllowedHosts = (process.env.LORE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean);
  if (
    configuredAllowedHosts.some((hostname) => !/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])$/i.test(hostname))
  ) {
    throw new Error(
      "LORE_ALLOWED_HOSTS must contain comma-separated hostnames without schemes, ports, or paths"
    );
  }
  const allowedHosts = new Set([
    appUrl.hostname.toLowerCase(),
    ...webOrigins.map((origin) => new URL(origin).hostname.toLowerCase()),
    ...configuredAllowedHosts.map((hostname) => hostname.replace(/^\[|\]$/g, ""))
  ]);
  if (deploymentMode === "local") {
    for (const hostname of ["localhost", "127.0.0.1", "::1"]) allowedHosts.add(hostname);
  }
  const sessionSecret =
    process.env.SESSION_SECRET ?? "demo-only-session-secret-change-before-production";
  const ownedPrisma =
    !demoMode && !options.dependencies?.store
      ? createPrismaClient(process.env.DATABASE_URL)
      : undefined;
  const store =
    options.dependencies?.store ??
    (ownedPrisma
      ? new PrismaLoreStore(ownedPrisma)
      : createLoreStore({ ...process.env, DEMO_MODE: String(demoMode) }));
  const jobLedger: JobLedger =
    options.dependencies?.jobLedger ??
    (ownedPrisma ? new PrismaJobLedger(ownedPrisma) : new InMemoryJobLedger());
  if (demoMode && !options.dependencies?.jobLedger) {
    const imported = await jobLedger.enqueue({
      organisationId: DEMO_ORGANISATION_ID,
      repositoryId: DEMO_REPOSITORY_ID,
      name: "github.import",
      payload: {
        organisationId: DEMO_ORGANISATION_ID,
        repositoryId: DEMO_REPOSITORY_ID,
        limit: "all"
      },
      idempotencyKey: "demo-import-complete"
    });
    await jobLedger.markDispatched(imported.id, "demo-import-complete");
    await jobLedger.markRunning({
      runId: imported.id,
      organisationId: DEMO_ORGANISATION_ID,
      repositoryId: DEMO_REPOSITORY_ID,
      name: "github.import",
      externalJobId: "demo-import-complete",
      attempt: 1,
      maximumAttempts: 3
    });
    await jobLedger.markSucceeded(imported.id, {
      pullRequests: 248,
      evidenceAdded: 811,
      evidenceUpdated: 3
    });

    const extracting = await jobLedger.enqueue({
      organisationId: DEMO_ORGANISATION_ID,
      repositoryId: DEMO_REPOSITORY_ID,
      name: "knowledge.extract",
      payload: {
        organisationId: DEMO_ORGANISATION_ID,
        repositoryId: DEMO_REPOSITORY_ID,
        evidenceIds: ["demo"]
      },
      idempotencyKey: "demo-extraction-running"
    });
    await jobLedger.markDispatched(extracting.id, "demo-extraction-running");
    await jobLedger.markRunning({
      runId: extracting.id,
      organisationId: DEMO_ORGANISATION_ID,
      repositoryId: DEMO_REPOSITORY_ID,
      name: "knowledge.extract",
      externalJobId: "demo-extraction-running",
      attempt: 1,
      maximumAttempts: 3
    });
  }
  const transport: JobDispatcher =
    options.dependencies?.jobs ??
    (demoMode ? new InMemoryJobDispatcher() : new BullMqJobDispatcher(process.env.REDIS_URL));
  const jobs: JobDispatcher = new PersistentJobDispatcher(transport, jobLedger);
  const aiRuntime = options.dependencies?.aiProvider
    ? { provider: options.dependencies.aiProvider, name: "injected" as const }
    : createConfiguredAIProvider(process.env, createBundledMockAIProvider());
  const aiProvider = aiRuntime.provider;
  const githubIdentityProvider =
    options.dependencies?.githubIdentityProvider ?? new GitHubOAuthProvider();
  const localGitHubToken = process.env.GITHUB_TOKEN?.trim();
  const localGitHubAccount =
    deploymentMode === "local" && localGitHubToken
      ? new GitHubTokenAccountClient(localGitHubToken)
      : undefined;
  let localAuthenticationPromise: Promise<AuthContext> | undefined;
  const resolveLocalAuthentication = async (): Promise<AuthContext | undefined> => {
    if (demoMode || !localGitHubAccount) return undefined;
    const appHostname = new URL(process.env.APP_URL ?? "http://localhost:5173").hostname;
    if (!new Set(["localhost", "127.0.0.1", "::1"]).has(appHostname)) {
      throw new LoreError(
        "Single-token local authentication is restricted to a loopback APP_URL",
        "UNSAFE_LOCAL_AUTH",
        500
      );
    }
    localAuthenticationPromise ??= (async (): Promise<AuthContext> => {
      const credentialFingerprint = createHmac("sha256", sessionSecret)
        .update(localGitHubToken!)
        .digest("hex");
      let user = await store.getLocalGitHubUser(credentialFingerprint);
      if (!user) {
        try {
          const identity = await localGitHubAccount.identity();
          user = await store.signInWithGitHub(identity);
        } catch (error) {
          user = await store.getSoleGitHubUser();
          if (!user) throw error;
        }
        await store.linkLocalGitHubCredential(user.id, credentialFingerprint);
      }
      let organisations = await store.listOrganisationAccess(user.id);
      if (!organisations.length) {
        const baseSlug = `${user.githubLogin ?? user.name}-local`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 70);
        await store.createOrganisation(user.id, {
          name: `${user.name}'s Workspace`,
          slug: `${baseSlug}-${user.id}`.slice(0, 80)
        });
        organisations = await store.listOrganisationAccess(user.id);
      }
      const active = organisations[0];
      if (!active)
        throw new LoreError("Lore could not create the local workspace", "LOCAL_SETUP_FAILED", 500);
      return {
        sessionId: "local-github-token-session",
        userId: user.id,
        name: user.name,
        authType: "synthetic",
        activeOrganisationId: active.id,
        role: active.role,
        synthetic: true
      };
    })().catch((error: unknown) => {
      localAuthenticationPromise = undefined;
      throw error;
    });
    return localAuthenticationPromise;
  };
  if (!demoMode && process.env.NODE_ENV === "production") {
    if (process.env.LOCAL_DEV_AUTH === "true") {
      throw new Error("LOCAL_DEV_AUTH cannot be enabled in production mode");
    }
    if (sessionSecret.length < 32 || sessionSecret.startsWith("replace-with")) {
      throw new Error(
        "SESSION_SECRET must be a non-placeholder random value of at least 32 characters"
      );
    }
    if (deploymentMode === "local" && !localGitHubAccount) {
      throw new Error("GITHUB_TOKEN is required for a full local installation");
    }
    if (deploymentMode === "saas" && !githubIdentityProvider.configured) {
      throw new Error(
        "GitHub OAuth login is required in SaaS mode; configure GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET"
      );
    }
  }
  const metrics = new ApiMetrics();
  const contextService = new TaskPreparationService();
  const verificationService = new ChangeVerificationService();
  const knowledgeService = new KnowledgeService(store);
  const candidateExtractionService = new KnowledgeCandidateExtractionService(
    store,
    aiProvider,
    `${aiRuntime.name}-ai:knowledge-extractor/v3${"model" in aiRuntime && aiRuntime.model ? `:${aiRuntime.model}` : ""}`
  );

  const githubImportPayload = (
    organisationId: string,
    repository: RepositorySummary,
    limit: PullRequestImportLimit
  ): Record<string, unknown> => {
    const status = githubIntegrationStatus(process.env, demoMode);
    if (!status.historicalImportReady) {
      throw new LoreError(
        "Configure a GitHub personal access token or GitHub App credentials before importing",
        "NOT_CONFIGURED",
        503
      );
    }
    const authMode = demoMode
      ? repository.providerInstallationId
        ? "app"
        : "token"
      : resolveGitHubAuthMode();
    const installationId = Number(repository.providerInstallationId);
    if (authMode === "app" && (!Number.isSafeInteger(installationId) || installationId <= 0)) {
      throw new LoreError(
        "Connect this repository to a verified GitHub App installation before importing",
        "INSTALLATION_REQUIRED",
        409
      );
    }
    if (authMode !== "app" && authMode !== "token") {
      throw new LoreError("GitHub historical import is disabled", "NOT_CONFIGURED", 503);
    }
    return {
      organisationId,
      repositoryId: repository.id,
      authMode,
      ...(authMode === "app" ? { installationId } : {}),
      limit
    };
  };

  const syncSchedulerId = (repositoryId: string): string => `github-sync-${repositoryId}`;
  const updateRepositorySync = async (
    organisationId: string,
    repository: RepositorySummary,
    settings: OrganisationSettings
  ): Promise<void> => {
    if (repository.provider !== "github" || !settings.autoImportGitHub || demoMode) {
      await jobs.unschedule?.(syncSchedulerId(repository.id));
      return;
    }
    if (!githubIntegrationStatus(process.env, demoMode).historicalImportReady || !jobs.schedule)
      return;
    await jobs.schedule(
      "github.import",
      githubImportPayload(organisationId, repository, 100),
      syncSchedulerId(repository.id),
      settings.githubSyncIntervalMinutes * 60_000
    );
  };

  const queueGitHubImport = async (
    organisationId: string,
    repository: RepositorySummary,
    limit: PullRequestImportLimit
  ): Promise<{ id: string; deferred?: boolean; existing?: boolean }> => {
    const active = (await jobLedger.list(organisationId, 500)).find(
      (run) =>
        run.name === "github.import" &&
        run.repositoryId === repository.id &&
        ["queued", "dispatch_pending", "dispatched", "running", "retrying"].includes(run.state)
    );
    if (active) return { id: active.id, existing: true };
    return jobs.dispatch(
      "github.import",
      githubImportPayload(organisationId, repository, limit),
      `github-import-${repository.id}-${randomUUID()}`
    );
  };

  const connectRepository = async (
    organisationId: string,
    userId: string,
    input: RepositoryInput,
    settings: OrganisationSettings
  ): Promise<RepositorySummary & { initialImportQueued: boolean }> => {
    const repository = await store.addRepository(
      organisationId,
      {
        ...input,
        retentionConfig: input.retentionConfig ?? settings.repositoryRetention,
        languageSummary: {},
        indexedAt: new Date().toISOString()
      },
      userId
    );
    let initialImportQueued = false;
    if (
      repository.provider === "github" &&
      settings.autoImportGitHub &&
      githubIntegrationStatus(process.env, demoMode).historicalImportReady &&
      !demoMode
    ) {
      await queueGitHubImport(organisationId, repository, settings.githubImportLimit);
      initialImportQueued = true;
    }
    await updateRepositorySync(organisationId, repository, settings);
    return { ...repository, initialImportQueued };
  };

  const app = Fastify({
    trustProxy: process.env.TRUST_PROXY === "true",
    logger:
      options.logger === false
        ? false
        : {
            level: process.env.LOG_LEVEL ?? "info",
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "res.headers.set-cookie",
                "*.token",
                "*.privateKey",
                "*.apiKey"
              ],
              censor: "[REDACTED]"
            }
          },
    genReqId: (request) => String(request.headers["x-request-id"] ?? randomUUID()),
    bodyLimit: 2_500_000
  });

  await app.register(cookie, { secret: sessionSecret, hook: "onRequest" });
  await app.register(cors, {
    origin: webOrigins,
    credentials: true
  });
  await app.register(rateLimit, { max: demoMode ? 1_000 : 300, timeWindow: "1 minute" });
  await app.register(rawBody, { field: "rawBody", global: false, encoding: false, runFirst: true });

  if (!demoMode && process.env.NODE_ENV === "production") {
    app.addHook("onRequest", async (request) => {
      const hostHeader = request.headers.host?.trim();
      let hostname: string | undefined;
      try {
        hostname = hostHeader ? new URL(`http://${hostHeader}`).hostname.toLowerCase() : undefined;
      } catch {
        throw new LoreError("Request Host is malformed", "INVALID_HOST", 400);
      }
      const path = request.url.split("?")[0]!;
      const healthPath = path === "/healthz" || path === "/readyz" || path === "/metrics";
      const loopbackHealth =
        healthPath && hostname && new Set(["localhost", "127.0.0.1", "::1"]).has(hostname);
      if (!hostname || (!allowedHosts.has(hostname) && !loopbackHealth)) {
        throw new LoreError("Request Host is not allowed", "INVALID_HOST", 400);
      }

      const origin = request.headers.origin?.trim();
      if (origin) {
        let normalizedOrigin: string;
        try {
          normalizedOrigin = new URL(origin).origin;
        } catch {
          throw new LoreError("Request Origin is malformed", "INVALID_ORIGIN", 403);
        }
        if (!webOrigins.includes(normalizedOrigin)) {
          throw new LoreError("Request Origin is not allowed", "INVALID_ORIGIN", 403);
        }
      }
      const browserWrite =
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        Boolean(request.cookies[SESSION_COOKIE]);
      if (browserWrite && path !== "/api/github/webhook" && !origin) {
        throw new LoreError("Browser mutations require an allowed Origin", "INVALID_ORIGIN", 403);
      }
    });
  }

  let csrfEnabled = false;
  if (!demoMode && process.env.NODE_ENV === "production") {
    csrfEnabled = true;
    await app.register(csrfProtection, {
      cookieKey: "lore_csrf",
      cookieOpts: {
        signed: true,
        sameSite: "strict",
        secure: secureCookies,
        httpOnly: true,
        path: "/"
      }
    });
    app.addHook("onRequest", (request, reply, done) => {
      if (
        ["GET", "HEAD", "OPTIONS"].includes(request.method) ||
        request.url === "/api/github/webhook" ||
        !request.cookies.lore_session
      ) {
        done();
        return;
      }
      app.csrfProtection(request, reply, done);
    });
  }

  app.addHook("onRequest", async () => {
    metrics.requests += 1;
  });
  const publicApiPaths = new Set([
    "/api/auth/demo",
    "/api/auth/github",
    "/api/auth/github/callback",
    "/api/auth/session",
    "/api/auth/csrf",
    "/api/github/webhook"
  ]);
  const accountApiPrefixes = [
    "/api/account",
    "/api/organisations",
    "/api/invitations",
    "/api/auth/logout",
    "/api/auth/sessions"
  ];
  app.addHook("preHandler", async (request) => {
    if (!request.url.startsWith("/api/")) return;
    const path = request.url.split("?")[0]!;
    if (path === "/api/github/webhook" || path === "/api/auth/github/callback") return;
    request.loreAuth = await resolveAuthentication(request, store, demoMode);
    if (!request.loreAuth) {
      const localAuth = await resolveLocalAuthentication();
      const requestedOrganisation = request.headers["x-lore-organisation-id"];
      if (localAuth && requestedOrganisation !== undefined) {
        if (typeof requestedOrganisation !== "string" || !requestedOrganisation.trim()) {
          throw new LoreError(
            "x-lore-organisation-id must contain one organisation ID",
            "INVALID_ORGANISATION",
            400
          );
        }
        const role = await store.getMembershipRole(requestedOrganisation, localAuth.userId);
        request.loreAuth = {
          ...localAuth,
          activeOrganisationId: requestedOrganisation,
          role
        };
      } else {
        request.loreAuth = localAuth;
      }
    }
    if (publicApiPaths.has(path)) return;
    const auth = requireAuth(request);
    if (auth.authType === "api_token") {
      const requiredScope = ["GET", "HEAD", "OPTIONS"].includes(request.method) ? "read" : "write";
      if (!auth.scopes?.includes(requiredScope)) {
        throw new LoreError(
          `This API token does not have ${requiredScope} access`,
          "FORBIDDEN",
          403
        );
      }
      if (accountApiPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
        throw new LoreError(
          "API tokens cannot manage the account that created them",
          "FORBIDDEN",
          403
        );
      }
      if (!auth.activeOrganisationId) {
        throw new LoreError("This API token is not scoped to an organisation", "FORBIDDEN", 403);
      }
      const tokenSettings = await store.getOrganisationSettings(auth.activeOrganisationId);
      if (!tokenSettings.mcpAccessEnabled) {
        throw new LoreError("API token access is disabled for this organisation", "FORBIDDEN", 403);
      }
    }
    if (accountApiPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)))
      return;
    const tenant = tenantContext(request, demoMode);
    await store.validateMembership(tenant.organisationId, tenant.userId);
    if (tenant.role === "viewer" && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      throw new LoreError("Viewer access is read-only", "FORBIDDEN", 403);
    }
    void auth;
  });
  const reconcileJobs = (): void => {
    void jobs.reconcile?.().catch((error: unknown) => {
      app.log.error({ err: error, event: "jobs.reconcile.failed" }, "Job reconciliation failed");
    });
  };
  const reconciliationTimer =
    !demoMode && jobs.reconcile ? setInterval(reconcileJobs, 30_000).unref() : undefined;
  if (!demoMode) reconcileJobs();
  app.addHook("onClose", async () => {
    if (reconciliationTimer) clearInterval(reconciliationTimer);
    await jobs.close?.();
    await ownedPrisma?.$disconnect();
  });

  app.setErrorHandler((error, request, reply) => {
    metrics.failures += 1;
    if (error instanceof ZodError) {
      void reply
        .status(400)
        .send({
          error: "VALIDATION_ERROR",
          message: "Request validation failed",
          issues: error.issues,
          requestId: request.id
        });
      return;
    }
    if (error instanceof LoreError) {
      void reply
        .status(error.statusCode)
        .send({
          error: error.code,
          message: error.message,
          details: error.details,
          requestId: request.id
        });
      return;
    }
    const httpError =
      typeof error === "object" && error !== null
        ? (error as { statusCode?: unknown; code?: unknown })
        : undefined;
    if (
      typeof httpError?.statusCode === "number" &&
      httpError.statusCode >= 400 &&
      httpError.statusCode < 500
    ) {
      const csrfRejected =
        typeof httpError.code === "string" && httpError.code.startsWith("FST_CSRF_");
      const payloadTooLarge = httpError.code === "FST_ERR_CTP_BODY_TOO_LARGE";
      void reply.status(httpError.statusCode).send({
        error: csrfRejected
          ? "CSRF_REJECTED"
          : payloadTooLarge
            ? "PAYLOAD_TOO_LARGE"
            : "REQUEST_REJECTED",
        message: csrfRejected
          ? "The browser request did not include a valid CSRF token"
          : payloadTooLarge && request.url.split("?")[0]?.endsWith("/analysis")
            ? "The sanitised code graph exceeds Lore's 50 MB upload limit; exclude generated or vendor files and index again"
            : payloadTooLarge
              ? "The request body exceeds this endpoint's upload limit"
              : "The request was rejected",
        requestId: request.id
      });
      return;
    }
    request.log.error({ err: error, event: "request.failed" }, "Request failed");
    void reply
      .status(500)
      .send({
        error: "INTERNAL_ERROR",
        message: "Lore could not complete the request",
        requestId: request.id
      });
  });

  app.get("/healthz", async () => ({ status: "ok", service: "lore-api", version: "0.1.0" }));
  app.get("/readyz", async (_request, reply) => {
    try {
      await Promise.all([store.health(), jobs.health()]);
      return {
        status: "ready",
        storage: demoMode ? "demo" : "postgresql",
        jobs: demoMode ? "memory" : "redis"
      };
    } catch {
      return reply
        .status(503)
        .send({
          status: "not_ready",
          storage: demoMode ? "demo" : "postgresql",
          jobs: demoMode ? "memory" : "redis"
        });
    }
  });
  app.get("/metrics", async (_request, reply) =>
    reply.type("text/plain; version=0.0.4").send(metrics.render())
  );

  const setSessionCookie = (reply: FastifyReply, token: string, expiresAt: string): void => {
    reply.setCookie(SESSION_COOKIE, token, {
      signed: true,
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
      path: "/",
      maxAge: Math.max(1, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))
    });
  };

  app.post("/api/auth/demo", async (request, reply) => {
    if (!demoMode) throw new LoreError("Demo sign-in is disabled", "NOT_AVAILABLE", 404);
    const issued = await issueSession(request, store, "user_casey", "org_acme");
    setSessionCookie(reply, issued.token, issued.expiresAt);
    return { ok: true };
  });

  app.get("/api/auth/github", async (request, reply) => {
    const { returnTo } = z
      .object({ returnTo: z.string().max(500).optional() })
      .parse(request.query);
    const safeReturnTo = returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
    const transaction = createOAuthTransaction(safeReturnTo);
    reply.setCookie(OAUTH_COOKIE, encodeOAuthTransaction(transaction), {
      signed: true,
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
      path: "/api/auth",
      maxAge: 600
    });
    return reply.redirect(githubIdentityProvider.authorizationUrl(transaction));
  });

  app.get("/api/auth/github/callback", async (request, reply) => {
    const query = z
      .object({
        code: z.string().min(1).optional(),
        state: z.string().min(1).optional(),
        error: z.string().optional()
      })
      .parse(request.query);
    const signed = request.cookies[OAUTH_COOKIE];
    const unsigned = signed ? request.unsignCookie(signed) : undefined;
    const transaction =
      unsigned?.valid && unsigned.value ? decodeOAuthTransaction(unsigned.value) : undefined;
    reply.clearCookie(OAUTH_COOKIE, { path: "/api/auth" });
    if (query.error)
      throw new LoreError("GitHub sign-in was cancelled", "GITHUB_AUTH_CANCELLED", 401);
    if (
      !query.code ||
      !query.state ||
      !transaction ||
      !verifyOAuthTransaction(transaction, query.state)
    ) {
      throw new LoreError(
        "GitHub sign-in state is missing, expired, or invalid",
        "INVALID_OAUTH_STATE",
        401
      );
    }
    const identity = await githubIdentityProvider.authenticate(query.code, transaction.verifier);
    const user = await store.signInWithGitHub(identity);
    const organisations = await store.listOrganisationAccess(user.id);
    const issued = await issueSession(request, store, user.id, organisations[0]?.id);
    setSessionCookie(reply, issued.token, issued.expiresAt);
    const appUrl = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
    return reply.redirect(`${appUrl}${transaction.returnTo}`);
  });

  app.get("/api/auth/session", async (request) =>
    accountSession(
      request,
      store,
      demoMode,
      demoMode
        ? githubIdentityProvider.configured
        : deploymentMode === "local"
          ? Boolean(localGitHubAccount)
          : githubIdentityProvider.configured
    )
  );
  app.get("/api/auth/csrf", async (_request, reply) => {
    if (csrfEnabled) reply.clearCookie("_csrf", { path: "/api/auth/" });
    return { enabled: csrfEnabled, token: csrfEnabled ? reply.generateCsrf() : undefined };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const auth = requireAuth(request);
    if (!auth.synthetic) await store.revokeAuthSession(auth.sessionId, auth.userId);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.status(204).send();
  });

  app.get("/api/auth/sessions", async (request) => {
    const auth = requireAuth(request);
    return { items: await store.listAuthSessions(auth.userId, auth.sessionId) };
  });

  app.delete("/api/auth/sessions/others", async (request) => {
    const auth = requireAuth(request);
    return { revoked: await store.revokeOtherAuthSessions(auth.userId, auth.sessionId) };
  });

  app.get("/api/account/profile", async (request) =>
    store.getUserProfile(requireAuth(request).userId)
  );
  app.patch("/api/account/profile", async (request) => {
    const auth = requireAuth(request);
    return store.updateUserProfile(auth.userId, profileUpdateSchema.parse(request.body));
  });

  app.get("/api/settings", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const [user, organisation, apiTokens] = await Promise.all([
      store.getUserSettings(tenant.userId),
      store.getOrganisationSettings(tenant.organisationId),
      store.listApiTokens(tenant.userId, tenant.organisationId)
    ]);
    return { user, organisation, deployment: deploymentConfiguration(demoMode), apiTokens };
  });

  app.patch("/api/settings/user", async (request) => {
    const auth = requireAuth(request);
    if (auth.authType === "api_token")
      throw new LoreError(
        "Use an interactive session to change personal settings",
        "FORBIDDEN",
        403
      );
    const current = await store.getUserSettings(auth.userId);
    return store.updateUserSettings(
      auth.userId,
      userSettingsSchema.parse({ ...current, ...(request.body as object) })
    );
  });

  app.patch("/api/settings/organisation", async (request) => {
    const tenant = tenantContext(request, demoMode);
    assertRole(tenant.role, ["owner", "admin"]);
    const current = await store.getOrganisationSettings(tenant.organisationId);
    const update =
      request.body && typeof request.body === "object"
        ? (request.body as Record<string, unknown>)
        : {};
    const saved = await store.updateOrganisationSettings(
      tenant.organisationId,
      organisationSettingsSchema.parse({
        ...current,
        ...update,
        repositoryRetention: {
          ...current.repositoryRetention,
          ...(update.repositoryRetention && typeof update.repositoryRetention === "object"
            ? update.repositoryRetention
            : {})
        }
      }),
      tenant.userId
    );
    const snapshot = await store.getSnapshot(tenant.organisationId);
    await Promise.all(
      snapshot.repositories.map((repository) =>
        updateRepositorySync(tenant.organisationId, repository, saved)
      )
    );
    return saved;
  });

  app.post("/api/account/tokens", async (request, reply) => {
    const auth = requireAuth(request);
    if (auth.authType !== "session" && !auth.synthetic) {
      throw new LoreError("Use an interactive session to create an API token", "FORBIDDEN", 403);
    }
    const tenant = tenantContext(request, demoMode);
    const input = z
      .object({
        name: z.string().trim().min(3).max(100),
        expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).default(90)
      })
      .strict()
      .parse(request.body);
    const prefix = `lore_pat_${randomBytes(5).toString("hex")}`;
    const token = `${prefix}_${randomBytes(32).toString("base64url")}`;
    const item = await store.createApiToken({
      organisationId: tenant.organisationId,
      userId: tenant.userId,
      name: input.name,
      prefix,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      scopes: ["read", "write"],
      expiresAt: new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    });
    return reply.status(201).send({ item, token });
  });

  app.delete("/api/account/tokens/:id", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    await store.revokeApiToken(id, tenant.userId, tenant.organisationId);
    return reply.status(204).send();
  });

  app.get("/api/organisations", async (request) => ({
    items: await store.listOrganisationAccess(requireAuth(request).userId)
  }));
  app.post("/api/organisations", async (request, reply) => {
    const auth = requireAuth(request);
    const organisation = await store.createOrganisation(
      auth.userId,
      organisationInputSchema.parse(request.body)
    );
    const issued = await issueSession(request, store, auth.userId, organisation.id);
    if (!auth.synthetic) await store.revokeAuthSession(auth.sessionId, auth.userId);
    setSessionCookie(reply, issued.token, issued.expiresAt);
    return reply.status(201).send(organisation);
  });

  app.post("/api/organisations/:id/switch", async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    await store.validateMembership(id, auth.userId);
    const issued = await issueSession(request, store, auth.userId, id);
    if (!auth.synthetic) await store.revokeAuthSession(auth.sessionId, auth.userId);
    setSessionCookie(reply, issued.token, issued.expiresAt);
    return { activeOrganisationId: id };
  });

  app.get("/api/organisations/:id", async (request) => {
    const auth = requireAuth(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const role = await store.getMembershipRole(id, auth.userId);
    const [organisation, members, invitations] = await Promise.all([
      store
        .listOrganisationAccess(auth.userId)
        .then((items) => items.find((item) => item.id === id)),
      store.listOrganisationMembers(id),
      role === "owner" || role === "admin"
        ? store.listOrganisationInvitations(id)
        : Promise.resolve([])
    ]);
    if (!organisation) throw new NotFoundError("Organisation", id);
    return { organisation, members, invitations };
  });

  app.patch("/api/organisations/:id", async (request) => {
    const auth = requireAuth(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return store.updateOrganisation(id, organisationUpdateSchema.parse(request.body), auth.userId);
  });

  app.post("/api/organisations/:id/invitations", async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    assertRole(await store.getMembershipRole(id, auth.userId), ["owner", "admin"]);
    const input = invitationInputSchema.parse(request.body);
    const invitation = await store.createOrganisationInvitation(
      id,
      {
        ...input,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      },
      auth.userId
    );
    const appUrl = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
    return reply
      .status(201)
      .send({ ...invitation, inviteUrl: `${appUrl}/?invite=${invitation.id}#organisations` });
  });

  app.delete("/api/organisations/:id/invitations/:invitationId", async (request, reply) => {
    const auth = requireAuth(request);
    const { id, invitationId } = z
      .object({ id: z.string().min(1), invitationId: z.string().min(1) })
      .parse(request.params);
    assertRole(await store.getMembershipRole(id, auth.userId), ["owner", "admin"]);
    await store.revokeOrganisationInvitation(id, invitationId);
    return reply.status(204).send();
  });

  app.post("/api/invitations/:id/accept", async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const organisation = await store.acceptOrganisationInvitation(id, auth.userId);
    const issued = await issueSession(request, store, auth.userId, organisation.id);
    if (!auth.synthetic) await store.revokeAuthSession(auth.sessionId, auth.userId);
    setSessionCookie(reply, issued.token, issued.expiresAt);
    return organisation;
  });

  app.patch("/api/organisations/:id/members/:userId", async (request) => {
    const auth = requireAuth(request);
    const { id, userId } = z
      .object({ id: z.string().min(1), userId: z.string().min(1) })
      .parse(request.params);
    assertRole(await store.getMembershipRole(id, auth.userId), ["owner", "admin"]);
    const { role } = z.object({ role: organisationRoleSchema }).parse(request.body);
    return store.updateOrganisationMemberRole(id, userId, role);
  });

  app.delete("/api/organisations/:id/members/:userId", async (request, reply) => {
    const auth = requireAuth(request);
    const { id, userId } = z
      .object({ id: z.string().min(1), userId: z.string().min(1) })
      .parse(request.params);
    assertRole(await store.getMembershipRole(id, auth.userId), ["owner", "admin"]);
    await store.removeOrganisationMember(id, userId);
    return reply.status(204).send();
  });

  app.get("/api/bootstrap", async (request) => {
    const tenant = tenantContext(request, demoMode);
    return dashboardListView(await store.getSnapshot(tenant.organisationId));
  });

  app.get("/api/onboarding", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const snapshot = await store.getSnapshot(tenant.organisationId);
    return {
      complete: snapshot.repositories.length > 0 && snapshot.knowledge.length > 0,
      steps: [
        {
          id: "repository",
          title: "Connect a repository",
          complete: snapshot.repositories.length > 0
        },
        {
          id: "history",
          title: "Import historical pull requests",
          complete: snapshot.candidates.length > 0
        },
        {
          id: "candidates",
          title: "Review discovered knowledge",
          complete: snapshot.knowledge.length > 0
        },
        {
          id: "local",
          title: "Index the local checkout",
          complete: snapshot.repositories.some((repository) => repository.entityCount > 0)
        },
        {
          id: "agent",
          title: "Connect an agent through CLI or MCP",
          complete: snapshot.sessions.length > 0
        }
      ]
    };
  });

  app.post("/api/repositories", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const input = repositoryInputSchema.parse(request.body);
    const settings = await store.getOrganisationSettings(tenant.organisationId);
    if (tenant.role === "member" && !settings.memberCanConnectRepositories) {
      throw new LoreError(
        "Only organisation owners and admins can connect repositories",
        "FORBIDDEN",
        403
      );
    }
    const repository = await connectRepository(
      tenant.organisationId,
      tenant.userId,
      input,
      settings
    );
    return reply.status(201).send(repository);
  });

  app.post("/api/repositories/batch", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const input = repositoryBatchInputSchema.parse(request.body);
    const settings = await store.getOrganisationSettings(tenant.organisationId);
    if (tenant.role === "member" && !settings.memberCanConnectRepositories) {
      throw new LoreError(
        "Only organisation owners and admins can connect repositories",
        "FORBIDDEN",
        403
      );
    }

    const snapshot = await store.getSnapshot(tenant.organisationId);
    const connectedProviderIds = new Set(
      snapshot.repositories.flatMap((repository) =>
        repository.providerRepositoryId
          ? [`${repository.provider}:${repository.providerRepositoryId}`]
          : []
      )
    );
    const connectedNames = new Set(
      snapshot.repositories.map(
        (repository) =>
          `${repository.provider}:${repository.owner.toLowerCase()}/${repository.name.toLowerCase()}`
      )
    );
    const requestKeys = new Set<string>();
    const items: Array<RepositorySummary & { initialImportQueued: boolean }> = [];
    const skipped: Array<{ fullName: string; reason: "already_connected" | "duplicate_request" }> =
      [];

    for (const repositoryInput of input.repositories) {
      const fullName = `${repositoryInput.owner}/${repositoryInput.name}`;
      const providerIdKey = repositoryInput.providerRepositoryId
        ? `${repositoryInput.provider}:${repositoryInput.providerRepositoryId}`
        : undefined;
      const nameKey = `${repositoryInput.provider}:${fullName.toLowerCase()}`;
      const requestKey = providerIdKey ?? nameKey;
      if (requestKeys.has(requestKey)) {
        skipped.push({ fullName, reason: "duplicate_request" });
        continue;
      }
      requestKeys.add(requestKey);
      if (
        (providerIdKey && connectedProviderIds.has(providerIdKey)) ||
        connectedNames.has(nameKey)
      ) {
        skipped.push({ fullName, reason: "already_connected" });
        continue;
      }
      const repository = await connectRepository(
        tenant.organisationId,
        tenant.userId,
        repositoryInput,
        settings
      );
      items.push(repository);
      if (providerIdKey) connectedProviderIds.add(providerIdKey);
      connectedNames.add(nameKey);
    }

    return reply.status(201).send({
      items,
      connected: items.length,
      skipped,
      initialImportsQueued: items.filter((repository) => repository.initialImportQueued).length
    });
  });

  app.post("/api/repositories/:id/index", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const repository = await store.getRepository(tenant.organisationId, id);
    if (demoMode) {
      return reply
        .status(202)
        .send({ jobId: `demo-index-${id}`, status: "completed", simulated: true });
    }
    if (!repository.localPath) {
      throw new LoreError(
        "Indexing requires a trusted local Lore client to upload a sanitised code graph",
        "LOCAL_NODE_REQUIRED",
        409
      );
    }
    const localPath = await assertTrustedRepositoryPath(repository.localPath).catch(
      (error: unknown) => {
        throw new LoreError(
          error instanceof Error ? error.message : "Repository path is not trusted",
          "UNTRUSTED_REPOSITORY_PATH",
          403
        );
      }
    );
    const job = await jobs.dispatch(
      "repository.index",
      { organisationId: tenant.organisationId, repositoryId: id, localPath },
      `repository-index-${id}-${repository.lastIndexedCommit ?? "initial"}`
    );
    return reply
      .status(202)
      .send({ jobId: job.id, status: job.deferred ? "dispatch_pending" : "queued" });
  });

  app.put(
    "/api/repositories/:id/analysis",
    {
      bodyLimit: ANALYSIS_UPLOAD_BODY_LIMIT_BYTES
    },
    async (request) => {
      const tenant = tenantContext(request, demoMode);
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const input = analysisUploadSchema.parse(request.body);
      if (input.repositoryId !== id)
        throw new LoreError("Repository identity does not match the route", "TENANT_MISMATCH", 400);
      const repository = await store.getRepository(tenant.organisationId, id);
      const entityIds = new Set(input.entities.map((entity) => entity.id));
      if (
        input.entities.some((entity) => entity.repositoryId !== id) ||
        input.relationships.some(
          (relationship) =>
            relationship.repositoryId !== id ||
            !entityIds.has(relationship.sourceEntityId) ||
            !entityIds.has(relationship.targetEntityId)
        )
      ) {
        throw new LoreError(
          "Analysis graph contains a foreign repository or unresolved relationship",
          "INVALID_GRAPH",
          400
        );
      }
      await store.saveAnalysis(tenant.organisationId, {
        repository: {
          ...repository,
          ...(input.commit ? { lastIndexedCommit: input.commit } : {}),
          indexedAt: input.indexedAt,
          entityCount: input.entities.length,
          relationshipCount: input.relationships.length,
          status: "ready"
        },
        entities: input.entities as CodeEntity[],
        relationships: input.relationships as CodeRelationship[],
        filesScanned: new Set(input.entities.map((entity) => entity.path)).size,
        filesSkipped: 0,
        durationMs: 0
      });
      return {
        status: "indexed",
        repositoryId: id,
        entities: input.entities.length,
        relationships: input.relationships.length
      };
    }
  );

  app.post("/api/repositories/:id/github-import", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const input = z
      .object({
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
      .parse(request.body);
    const repository = await store.getRepository(tenant.organisationId, id);
    if (repository.provider !== "github")
      throw new LoreError(
        "Historical import requires a GitHub repository",
        "INVALID_PROVIDER",
        400
      );
    const job = await queueGitHubImport(tenant.organisationId, repository, input.limit);
    return reply.status(202).send({
      jobId: job.id,
      status: job.existing
        ? "already_running"
        : demoMode
          ? "simulated"
          : job.deferred
            ? "dispatch_pending"
            : "queued",
      simulated: demoMode,
      alreadyRunning: job.existing ?? false,
      limit: input.limit
    });
  });

  app.post("/api/repositories/:id/knowledge-extraction", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { includeProcessed } = z
      .object({
        includeProcessed: z.boolean().default(false)
      })
      .parse(request.body ?? {});
    await store.getRepository(tenant.organisationId, id);
    const [evidence, snapshot] = await Promise.all([
      store.getEvidence(tenant.organisationId),
      store.getSnapshot(tenant.organisationId)
    ]);
    const processedIds = new Set(
      [...snapshot.candidates, ...snapshot.knowledge].flatMap((item) => item.evidenceIds)
    );
    const selectedIds = evidence
      .filter(
        (record) => record.repositoryId === id && (includeProcessed || !processedIds.has(record.id))
      )
      .map((record) => record.id);
    const batches = createKnowledgeExtractionBatches(evidence, selectedIds);
    for (const evidenceIds of batches) {
      const batchHash = createHash("sha256")
        .update(evidenceIds.toSorted().join("\n"))
        .digest("hex")
        .slice(0, 16);
      await jobs.dispatch(
        "knowledge.extract",
        { organisationId: tenant.organisationId, repositoryId: id, evidenceIds },
        `extract-manual-${id}-${batchHash}-${randomUUID()}`
      );
    }
    return reply.status(202).send({
      status: demoMode ? "simulated" : "queued",
      evidenceQueued: selectedIds.length,
      batchesQueued: batches.length,
      includeProcessed
    });
  });

  app.delete("/api/repositories/:id", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { confirm } = z.object({ confirm: z.string().min(1) }).parse(request.query);
    const repository = await store.getRepository(tenant.organisationId, id);
    const expectedConfirmation = `${repository.owner}/${repository.name}`;
    if (confirm !== expectedConfirmation) {
      throw new LoreError(
        `Type ${expectedConfirmation} to confirm repository deletion`,
        "CONFIRMATION_REQUIRED",
        400
      );
    }
    return store.deleteRepository(tenant.organisationId, id, tenant.userId);
  });

  app.patch("/api/repositories/:id/retention", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const retentionConfig = repositoryRetentionSchema.parse(request.body);
    return store.updateRepositoryRetention(
      tenant.organisationId,
      id,
      retentionConfig,
      tenant.userId
    );
  });

  app.get("/api/repositories/:id/entities", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const query = z
      .object({
        search: z.string().trim().max(200).optional(),
        type: z
          .enum([
            "file",
            "class",
            "interface",
            "trait",
            "function",
            "method",
            "constant",
            "event",
            "listener",
            "service",
            "repository",
            "controller",
            "route",
            "database_table",
            "configuration_key",
            "external_api",
            "test"
          ])
          .optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50)
      })
      .parse(request.query);
    return store.listCodeEntities(tenant.organisationId, id, query);
  });

  app.get("/api/repositories/:id/relationships", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const query = z
      .object({
        search: z.string().trim().max(200).optional(),
        entityId: z.string().min(1).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50)
      })
      .parse(request.query);
    return store.listCodeRelationships(tenant.organisationId, id, query);
  });

  app.post("/api/tasks/prepare", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const input = prepareTaskSchema.parse(request.body);
    const [snapshot, evidence, repository, graph, regressions] = await Promise.all([
      store.getSnapshot(tenant.organisationId),
      store.getEvidence(tenant.organisationId),
      store.getRepository(tenant.organisationId, input.repositoryId),
      store.getCodeGraph(tenant.organisationId, input.repositoryId),
      store.getRegressions(tenant.organisationId, input.repositoryId)
    ]);
    metrics.taskPreparations += 1;
    return contextService.prepare({
      repository,
      task: input.task,
      ...(input.paths ? { explicitPaths: input.paths } : {}),
      snapshot,
      evidence,
      entities: graph.entities,
      relationships: graph.relationships,
      regressions
    });
  });

  app.post("/api/sessions", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const input = createSessionSchema.parse(request.body);
    await store.getRepository(tenant.organisationId, input.repositoryId);
    const session = await store.createSession({
      id: newUuid(),
      organisationId: tenant.organisationId,
      repositoryId: input.repositoryId,
      task: input.task,
      status: "preparing",
      ...(input.baseCommit
        ? { baseCommit: input.baseCommit, currentCommit: input.baseCommit }
        : {}),
      startedAt: new Date().toISOString(),
      agentType: input.agentType,
      filesObserved: [],
      filesChanged: [],
      warningCount: 0
    });
    return reply.status(201).send(session);
  });

  app.get("/api/sessions/:id", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const snapshot = await store.getSnapshot(tenant.organisationId);
    const session = snapshot.sessions.find((item) => item.id === id);
    if (!session) throw new NotFoundError("Agent session", id);
    return session;
  });

  app.get("/api/sessions/:id/events", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return { items: await store.getSessionEvents(tenant.organisationId, id) };
  });

  app.post("/api/sessions/:id/abandon", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { reason } = z.object({ reason: z.string().min(3).max(1_000) }).parse(request.body);
    const snapshot = await store.getSnapshot(tenant.organisationId);
    const session = snapshot.sessions.find((item) => item.id === id);
    if (!session) throw new NotFoundError("Agent session", id);
    if (["completed", "abandoned"].includes(session.status))
      throw new LoreError(
        "Only an open session can be abandoned",
        "INVALID_SESSION_TRANSITION",
        409
      );
    return store.abandonSession(tenant.organisationId, id, reason);
  });

  app.post("/api/sessions/:id/refresh-context", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { paths } = z
      .object({ paths: z.array(z.string().min(1).max(4_000)).max(200).optional() })
      .parse(request.body ?? {});
    const snapshot = await store.getSnapshot(tenant.organisationId);
    let session = snapshot.sessions.find((item) => item.id === id);
    if (!session) throw new NotFoundError("Agent session", id);
    if (["completed", "abandoned"].includes(session.status))
      throw new LoreError(
        "A terminal session cannot refresh context",
        "INVALID_SESSION_TRANSITION",
        409
      );
    if (paths) {
      session = await store.updateSession(tenant.organisationId, {
        ...session,
        filesChanged: [...new Set([...session.filesChanged, ...paths])]
      });
    }
    const [repository, evidence, graph, regressions] = await Promise.all([
      store.getRepository(tenant.organisationId, session.repositoryId),
      store.getEvidence(tenant.organisationId),
      store.getCodeGraph(tenant.organisationId, session.repositoryId),
      store.getRegressions(tenant.organisationId, session.repositoryId)
    ]);
    const context = contextService.prepare({
      repository,
      task: session.task,
      explicitPaths: session.filesChanged,
      snapshot,
      evidence,
      entities: graph.entities,
      relationships: graph.relationships,
      regressions
    });
    const record = await store.saveContextPackage(tenant.organisationId, id, context);
    return { ...context, revision: record.revision, persistedAt: record.createdAt };
  });

  app.post("/api/sessions/:id/verify", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        changedFiles: verifyChangeSchema.shape.changedFiles,
        currentCommit: z.string().min(1).max(128).optional()
      })
      .parse(request.body);
    const snapshot = await store.getSnapshot(tenant.organisationId);
    const session = snapshot.sessions.find((item) => item.id === id);
    if (!session) throw new NotFoundError("Agent session", id);
    if (["completed", "abandoned"].includes(session.status))
      throw new LoreError(
        "A terminal session cannot be verified again",
        "INVALID_SESSION_TRANSITION",
        409
      );
    const [repository, graph, regressions] = await Promise.all([
      store.getRepository(tenant.organisationId, session.repositoryId),
      store.getCodeGraph(tenant.organisationId, session.repositoryId),
      store.getRegressions(tenant.organisationId, session.repositoryId)
    ]);
    const contextRecord = await store.getLatestContextPackage(tenant.organisationId, id);
    if (!contextRecord)
      throw new LoreError(
        "Prepare and persist session context before verification",
        "CONTEXT_REQUIRED",
        409
      );
    const generated = verificationService.verify({
      task: session.task,
      repository,
      snapshot,
      changedFiles: body.changedFiles,
      entities: graph.entities,
      relationships: graph.relationships,
      regressions
    });
    const report = {
      ...generated,
      sessionId: id,
      contextId: contextRecord.id,
      ...(session.baseCommit ? { baseCommit: session.baseCommit } : {}),
      ...(body.currentCommit
        ? { currentCommit: body.currentCommit }
        : session.currentCommit
          ? { currentCommit: session.currentCommit }
          : {})
    };
    metrics.verifications += 1;
    return store.saveReport(tenant.organisationId, report, id, contextRecord.revision);
  });

  app.get("/api/knowledge", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const query = z
      .object({
        kind: z.string().optional(),
        status: z.string().optional(),
        repositoryId: z.string().optional()
      })
      .parse(request.query);
    const snapshot = await store.getSnapshot(tenant.organisationId);
    return {
      items: snapshot.knowledge.filter(
        (item) =>
          (!query.kind || item.kind === query.kind) &&
          (!query.status || item.status === query.status) &&
          (!query.repositoryId || item.repositoryId === query.repositoryId)
      )
    };
  });

  app.get("/api/evidence", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const query = z
      .object({
        type: z
          .enum([
            "pull_request",
            "review_comment",
            "commit",
            "ticket",
            "code",
            "documentation",
            "test_result",
            "ci_result",
            "manual_confirmation",
            "incident",
            "communication"
          ])
          .optional(),
        provider: z.string().min(1).max(100).optional(),
        repositoryId: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(1_000).default(1_000)
      })
      .parse(request.query);
    const allItems = await store.getEvidence(tenant.organisationId);
    const filtered = allItems
      .filter(
        (item) =>
          (!query.type || item.type === query.type) &&
          (!query.provider || item.provider === query.provider) &&
          (!query.repositoryId || item.repositoryId === query.repositoryId)
      )
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
    return {
      items: filtered.slice(0, query.limit),
      count: Math.min(filtered.length, query.limit),
      total: filtered.length,
      truncated: filtered.length > query.limit
    };
  });

  app.get("/api/jobs", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { limit } = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(100)
      })
      .parse(request.query);
    const items = await jobLedger.list(tenant.organisationId, limit);
    return { items, count: items.length };
  });

  app.get("/api/evidence/:id/revisions", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const revisions = await store.getEvidenceRevisions(tenant.organisationId, id);
    return { items: revisions, count: revisions.length };
  });

  app.post("/api/evidence/communications", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const input = communicationEvidenceSchema.parse(request.body);
    const organisationSettings = await store.getOrganisationSettings(tenant.organisationId);
    if (!organisationSettings.communicationEvidenceEnabled) {
      throw new LoreError(
        "Ad-hoc communication evidence is disabled for this organisation",
        "FORBIDDEN",
        403
      );
    }
    if (input.repositoryId) await store.getRepository(tenant.organisationId, input.repositoryId);

    const canonicalContent = input.content.replace(/\r\n/g, "\n").trim();
    const identity = JSON.stringify({
      repositoryId: input.repositoryId ?? null,
      sourceType: input.sourceType,
      title: input.title,
      content: canonicalContent,
      sourceReference: input.sourceReference ?? null,
      occurredAt: input.occurredAt ?? null
    });
    const contentHash = createHash("sha256").update(canonicalContent).digest("hex");
    const identityHash = createHash("sha256").update(identity).digest("hex");
    const externalId = `communication:${input.sourceType}:${identityHash}`;
    const evidence: EvidenceRecord = {
      id: deterministicUuid("lore.evidence", `${tenant.organisationId}:${externalId}`),
      organisationId: tenant.organisationId,
      ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
      type: "communication",
      provider: "human-communication",
      externalId,
      ...(input.sourceUrl ? { url: input.sourceUrl } : {}),
      title: input.title,
      content: canonicalContent,
      author: tenant.name,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      metadata: {
        sourceType: input.sourceType,
        participants: input.participants ?? [],
        ...(input.sourceReference ? { sourceReference: input.sourceReference } : {}),
        submittedBy: tenant.userId,
        submittedByName: tenant.name,
        humanSubmitted: true,
        authorityConfirmed: true,
        aiTreatment: "untrusted-source"
      },
      contentHash
    };
    const evidenceAdded = (await store.ingestEvidence([evidence])) === 1;
    const storedEvidence =
      (await store.getEvidence(tenant.organisationId)).find((item) => item.id === evidence.id) ??
      evidence;
    const extraction = organisationSettings.autoExtractKnowledge
      ? await candidateExtractionService.extract({
          organisationId: tenant.organisationId,
          ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
          evidenceIds: [storedEvidence.id]
        })
      : { items: [], evidenceAnalysed: 0, proposals: 0, candidatesCreated: 0 };
    const counts: Record<EvidenceComparisonDisposition, number> = {
      new: 0,
      already_added: 0,
      supports_existing: 0,
      conflicts: 0
    };
    extraction.items.forEach((item) => {
      counts[item.disposition] += 1;
    });
    const analysis: CommunicationEvidenceAnalysis = {
      evidence: storedEvidence,
      evidenceAdded,
      candidates: extraction.items,
      counts
    };
    return reply.status(evidenceAdded ? 201 : 200).send(analysis);
  });

  app.get("/api/search", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { q, repositoryId } = z
      .object({ q: z.string().min(2).max(500), repositoryId: z.string().optional() })
      .parse(request.query);
    const [snapshot, evidence, graph] = await Promise.all([
      store.getSnapshot(tenant.organisationId),
      store.getEvidence(tenant.organisationId),
      repositoryId
        ? store.getCodeGraph(tenant.organisationId, repositoryId)
        : Promise.resolve({ entities: [], relationships: [] })
    ]);
    const needle = q.toLowerCase();
    return {
      knowledge: [...snapshot.knowledge, ...snapshot.candidates]
        .filter((item) =>
          `${item.title} ${item.statement} ${item.rationale}`.toLowerCase().includes(needle)
        )
        .slice(0, 50),
      evidence: evidence
        .filter((item) => `${item.title ?? ""} ${item.content}`.toLowerCase().includes(needle))
        .slice(0, 50),
      entities: graph.entities
        .filter((item) => `${item.qualifiedName} ${item.path}`.toLowerCase().includes(needle))
        .slice(0, 50)
    };
  });

  app.get("/api/knowledge-export", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const [snapshot, evidence] = await Promise.all([
      store.getSnapshot(tenant.organisationId),
      store.getEvidence(tenant.organisationId)
    ]);
    reply.header(
      "content-disposition",
      `attachment; filename="lore-${snapshot.organisation.slug}.json"`
    );
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      organisation: snapshot.organisation,
      knowledge: snapshot.knowledge,
      evidence
    };
  });

  app.post("/api/knowledge", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const input = manualKnowledgeSchema.parse(request.body);
    const item = await store.createManualKnowledge(tenant.organisationId, input, tenant.userId);
    return reply.status(201).send(item);
  });

  app.post("/api/knowledge-import", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const markdown = markdownKnowledgeImportSchema.safeParse(request.body);
    const items = markdown.success
      ? markdownKnowledgeItems(
          markdown.data,
          markdown.data.repositoryId
            ? ((repository) => `${repository.owner}/${repository.name}`)(
                await store.getRepository(tenant.organisationId, markdown.data.repositoryId)
              )
            : undefined
        )
      : z.object({ items: z.array(manualKnowledgeSchema).min(1).max(500) }).parse(request.body)
          .items;
    if (items.length === 0)
      throw new LoreError("No importable knowledge statements were found", "EMPTY_IMPORT", 400);
    const created = [];
    for (const item of items)
      created.push(
        await store.createManualKnowledge(
          tenant.organisationId,
          manualKnowledgeSchema.parse(item),
          tenant.userId
        )
      );
    return reply.status(201).send({ imported: created.length, items: created });
  });

  app.get("/api/knowledge/:id", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const snapshot = await store.getSnapshot(tenant.organisationId);
    const item = [...snapshot.knowledge, ...snapshot.candidates].find(
      (knowledge) => knowledge.id === id
    );
    if (!item) throw new NotFoundError("Knowledge item", id);
    return item;
  });

  app.post("/api/knowledge/:id/challenge", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { reason } = z.object({ reason: z.string().min(3) }).parse(request.body);
    return store.updateKnowledgeStatus(
      tenant.organisationId,
      id,
      "challenged",
      reason,
      tenant.userId
    );
  });

  app.post("/api/knowledge/:id/archive", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { reason } = z.object({ reason: z.string().min(3) }).parse(request.body);
    return store.updateKnowledgeStatus(
      tenant.organisationId,
      id,
      "archived",
      reason,
      tenant.userId
    );
  });

  app.get("/api/knowledge-candidates", async (request) => {
    const tenant = tenantContext(request, demoMode);
    return {
      items: (await store.getSnapshot(tenant.organisationId)).candidates.map(candidateListView)
    };
  });

  app.get("/api/knowledge-candidates/:id", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    return store.getCandidate(tenant.organisationId, id);
  });

  app.post("/api/knowledge-candidates/triage", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const input = candidateTriageRequestSchema.parse(request.body ?? {});
    const snapshot = await store.getSnapshot(tenant.organisationId);
    const requestedIds = input.candidateIds ? new Set(input.candidateIds) : undefined;
    const requested = input.candidateIds
      ? snapshot.candidates.filter((candidate) => requestedIds?.has(candidate.id))
      : snapshot.candidates;
    if (input.candidateIds && requested.length !== new Set(input.candidateIds).size) {
      const available = new Set(requested.map((candidate) => candidate.id));
      throw new NotFoundError(
        "Knowledge candidate",
        input.candidateIds.find((candidateId) => !available.has(candidateId)) ?? "unknown"
      );
    }
    const candidates = input.force
      ? requested
      : requested.filter(
          (candidate) =>
            candidate.triage?.candidateFingerprint !== candidateTriageFingerprint(candidate)
        );
    if (!candidates.length) {
      return { status: "up_to_date", queued: 0, skippedFresh: requested.length };
    }
    const candidateIds = candidates.map((candidate) => candidate.id);
    if (demoMode) {
      const result = await new CandidateTriageService(
        store,
        aiProvider,
        "mock-ai:candidate-triage/v1"
      ).triage({ organisationId: tenant.organisationId, candidateIds, force: input.force });
      return { status: "completed", queued: candidateIds.length, result };
    }
    const fingerprint = createHash("sha256")
      .update(
        candidates
          .map((candidate) => `${candidate.id}:${candidateTriageFingerprint(candidate)}`)
          .toSorted()
          .join("\n")
      )
      .digest("hex")
      .slice(0, 24);
    const job = await jobs.dispatch(
      "candidate.triage",
      { organisationId: tenant.organisationId, candidateIds, force: input.force },
      `candidate-triage-${tenant.organisationId}-${fingerprint}`
    );
    return reply.status(202).send({
      status: job.deferred ? "dispatch_pending" : "queued",
      queued: candidateIds.length,
      skippedFresh: requested.length - candidateIds.length,
      jobId: job.id
    });
  });

  app.post("/api/knowledge-candidates/bulk-review", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const input = candidateBulkReviewSchema.parse(request.body);
    return knowledgeService.bulkReviewCandidates(
      tenant.organisationId,
      {
        action: input.action,
        candidateIds: input.candidateIds,
        reason: input.reason
      },
      tenant.userId
    );
  });

  app.post("/api/knowledge-candidates/:id/approve", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return knowledgeService.approveCandidate(
      tenant.organisationId,
      id,
      approveCandidateSchema.parse(request.body),
      tenant.userId
    );
  });

  app.post("/api/knowledge/:id/approve", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return knowledgeService.approveCandidate(
      tenant.organisationId,
      id,
      approveCandidateSchema.parse(request.body),
      tenant.userId
    );
  });

  app.post("/api/knowledge-candidates/:id/reject", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { reason } = z.object({ reason: z.string().min(3) }).parse(request.body);
    await knowledgeService.rejectCandidate(tenant.organisationId, id, reason, tenant.userId);
    return reply.status(204).send();
  });

  app.post("/api/knowledge-candidates/:id/merge", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { targetId, reason } = z
      .object({ targetId: z.string().min(1), reason: z.string().min(3).max(1_000) })
      .parse(request.body);
    return knowledgeService.mergeCandidate(
      tenant.organisationId,
      id,
      targetId,
      reason,
      tenant.userId
    );
  });

  app.get("/api/policies", async (request) => {
    const tenant = tenantContext(request, demoMode);
    return { items: (await store.getSnapshot(tenant.organisationId)).policies };
  });

  app.post("/api/policies", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const input = policyInputSchema.parse(request.body);
    const policy = await store.createPolicy(
      tenant.organisationId,
      {
        ...input,
        scope: input.scope,
        detector: input.detector as PolicyDetector
      } as Omit<PolicyRecord, "id" | "organisationId" | "createdAt" | "updatedAt">,
      tenant.userId
    );
    return reply.status(201).send(policy);
  });

  app.get("/api/reports/:id", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const report = (await store.getSnapshot(tenant.organisationId)).reports.find(
      (item) => item.id === id
    );
    if (!report) throw new NotFoundError("Safety report", id);
    return report;
  });

  app.get("/api/observations/:id", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return store.getChangeObservation(tenant.organisationId, id);
  });

  app.get("/api/github/repositories", async (request) => {
    tenantContext(request, demoMode);
    if (demoMode) {
      return { items: demoGitHubRepositories, count: demoGitHubRepositories.length };
    }
    if (!localGitHubAccount) {
      throw new LoreError(
        "Repository discovery with a personal access token is available when GITHUB_TOKEN is configured",
        "NOT_CONFIGURED",
        503
      );
    }
    const repositories = await localGitHubAccount.repositories();
    return { items: repositories, count: repositories.length };
  });

  app.get("/api/github/install", async (request, reply) => {
    tenantContext(request, demoMode);
    if (!demoMode && resolveGitHubAuthMode() !== "app") {
      throw new LoreError(
        "GitHub App installation is unavailable while GITHUB_AUTH_MODE is not app",
        "NOT_CONFIGURED",
        503
      );
    }
    const slug = process.env.GITHUB_APP_SLUG;
    if (!slug) throw new LoreError("GITHUB_APP_SLUG is not configured", "NOT_CONFIGURED", 503);
    const state = createOAuthState(sessionSecret);
    reply.setCookie("lore_oauth_state", state, {
      signed: true,
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: 600
    });
    return {
      url: `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`
    };
  });

  app.get("/api/github/status", async (request) => {
    tenantContext(request, demoMode);
    return githubIntegrationStatus(process.env, demoMode);
  });

  app.get("/api/github/callback", async (request, reply) => {
    tenantContext(request, demoMode);
    const {
      state,
      installation_id: installationId,
      setup_action: setupAction,
      format
    } = z
      .object({
        state: z.string().min(1),
        installation_id: z.coerce.number().int().positive(),
        setup_action: z.string().optional(),
        format: z.enum(["json"]).optional()
      })
      .parse(request.query);
    const signedCookie = request.cookies.lore_oauth_state;
    const stored = signedCookie ? request.unsignCookie(signedCookie) : undefined;
    if (!stored?.valid || stored.value !== state || !verifyOAuthState(sessionSecret, state)) {
      throw new LoreError(
        "GitHub installation state is invalid or expired",
        "INVALID_OAUTH_STATE",
        401
      );
    }
    reply.clearCookie("lore_oauth_state", { path: "/" });
    const result = {
      installed: true,
      installationId,
      setupAction: setupAction ?? "install",
      next: "/repositories"
    };
    if (format === "json") return result;
    const appUrl = new URL(process.env.APP_URL ?? "http://localhost:5173");
    appUrl.searchParams.set("githubInstallationId", String(installationId));
    appUrl.searchParams.set("githubSetupAction", result.setupAction);
    appUrl.hash = "repositories";
    return reply.redirect(appUrl.toString());
  });

  app.post("/api/github/webhook", { config: { rawBody: true } }, async (request, reply) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
    const signature = Array.isArray(request.headers["x-hub-signature-256"])
      ? request.headers["x-hub-signature-256"][0]
      : request.headers["x-hub-signature-256"];
    const webhookBody =
      typeof request.rawBody === "string" ? Buffer.from(request.rawBody, "utf8") : request.rawBody;
    if (!webhookBody || !verifyGitHubWebhook(secret, webhookBody, signature)) {
      throw new LoreError("GitHub webhook signature is invalid", "INVALID_WEBHOOK_SIGNATURE", 401);
    }
    const deliveryId = String(request.headers["x-github-delivery"] ?? "");
    const eventName = String(request.headers["x-github-event"] ?? "unknown");
    if (!deliveryId) throw new LoreError("GitHub delivery ID is required", "INVALID_WEBHOOK", 400);
    const payload =
      request.body && typeof request.body === "object"
        ? (request.body as Record<string, unknown>)
        : {};
    const payloadRepository =
      payload.repository && typeof payload.repository === "object"
        ? (payload.repository as Record<string, unknown>)
        : {};
    const ownerRecord =
      payloadRepository.owner && typeof payloadRepository.owner === "object"
        ? (payloadRepository.owner as Record<string, unknown>)
        : {};
    const owner = typeof ownerRecord.login === "string" ? ownerRecord.login : "";
    const repositoryName = typeof payloadRepository.name === "string" ? payloadRepository.name : "";
    const providerRepositoryId = ["string", "number"].includes(typeof payloadRepository.id)
      ? String(payloadRepository.id)
      : "";
    const installation =
      payload.installation && typeof payload.installation === "object"
        ? (payload.installation as Record<string, unknown>)
        : {};
    const providerInstallationId = ["string", "number"].includes(typeof installation.id)
      ? String(installation.id)
      : "";
    if (!owner || !repositoryName || !providerRepositoryId || !providerInstallationId) {
      throw new LoreError("Webhook repository identity is missing", "INVALID_WEBHOOK", 400);
    }
    const routedRepository = await store.resolveProviderRepository(
      "github",
      providerInstallationId,
      providerRepositoryId,
      owner,
      repositoryName
    );
    const organisationId = routedRepository.organisationId;
    const repositoryId = routedRepository.id;
    if (await store.hasIngestionReceipt(organisationId, "github", deliveryId)) {
      metrics.webhookReplays += 1;
      return reply.status(202).send({ status: "duplicate", deliveryId });
    }
    const records = webhookEvidence({
      organisationId,
      repositoryId,
      eventName,
      deliveryId,
      payload: request.body
    });
    const added = await store.ingestEvidence(records);
    if (records.length > 0) {
      await jobs.dispatch(
        "knowledge.extract",
        { organisationId, repositoryId, evidenceIds: records.map((record) => record.id) },
        `extract-${deliveryId}`
      );
    }
    // The queue job ID is deterministic, so replay is safe. Persist the
    // receipt only after dispatch; a crash before this point causes replay
    // instead of permanently losing extraction work.
    await store.saveIngestionReceipt(organisationId, "github", deliveryId, eventName);
    metrics.webhookDeliveries += 1;
    return reply.status(202).send({ status: "accepted", deliveryId, evidenceAdded: added });
  });

  const webRoot = resolve("apps/web/dist");
  if (process.env.NODE_ENV === "production" && existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, prefix: "/" });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/"))
        return reply.status(404).send({ error: "NOT_FOUND", message: "Route not found" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
