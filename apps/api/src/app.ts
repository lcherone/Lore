import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import csrfProtection from "@fastify/csrf-protection";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";
import { z, ZodError } from "zod";
import type { JobDispatcher, LoreStore } from "@lore/core/index.js";
import { LoreError, NotFoundError } from "@lore/core/index.js";
import { BullMqJobDispatcher, createLoreStore, InMemoryJobDispatcher } from "@lore/database/index.js";
import { TaskPreparationService } from "@lore/context/index.js";
import { KnowledgeService } from "@lore/knowledge/index.js";
import { ChangeVerificationService } from "@lore/reporting/index.js";
import { assertTrustedRepositoryPath } from "@lore/git/index.js";
import {
  approveCandidateSchema,
  createSessionSchema,
  prepareTaskSchema,
  verifyChangeSchema
} from "@lore/shared/schemas.js";
import type { CodeEntity, CodeRelationship, PolicyDetector, PolicyRecord } from "@lore/shared/types.js";
import { newUuid } from "@lore/shared/ids.js";
import { policyPatternError } from "@lore/shared/policy-patterns.js";
import { verifyGitHubWebhook, webhookEvidence } from "@lore/github/index.js";
import { createOAuthState, encodeSession, tenantContext, verifyOAuthState } from "./auth.js";
import { ApiMetrics } from "./metrics.js";

export interface ApiDependencies {
  store: LoreStore;
  jobs: JobDispatcher;
}

export interface CreateAppOptions {
  dependencies?: Partial<ApiDependencies>;
  demoMode?: boolean;
  logger?: boolean;
}

const repositoryRetentionSchema = z.object({
  retainRawPullRequestDiff: z.boolean().default(false),
  retainSummariesOnly: z.boolean().default(false),
  retainReviewComments: z.boolean().default(true),
  retainCodeSnippets: z.boolean().default(false)
}).strict().superRefine((value, context) => {
  if (value.retainSummariesOnly && (value.retainRawPullRequestDiff || value.retainCodeSnippets)) {
    context.addIssue({
      code: "custom",
      message: "Summary-only retention cannot also retain raw diffs or code snippets"
    });
  }
});

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

const codeEntitySchema = z.object({
  id: z.string().uuid(),
  repositoryId: z.string().min(1),
  type: z.enum(["file", "class", "interface", "trait", "function", "method", "constant", "event", "listener", "service", "repository", "controller", "route", "database_table", "configuration_key", "external_api", "test"]),
  name: z.string().min(1).max(1_000),
  qualifiedName: z.string().min(1).max(2_000),
  path: z.string().min(1).max(4_000),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  language: z.string().min(1).max(100),
  fingerprint: z.string().min(1).max(4_000),
  metadata: z.record(z.string(), z.unknown())
}).strict();

const codeRelationshipSchema = z.object({
  id: z.string().uuid(),
  repositoryId: z.string().min(1),
  sourceEntityId: z.string().uuid(),
  targetEntityId: z.string().uuid(),
  relationshipType: z.string().min(1).max(200),
  confidence: z.number().min(0).max(1),
  source: z.enum(["static_analysis", "git_history", "ai_inference", "manual", "github", "jira"]),
  metadata: z.record(z.string(), z.unknown())
}).strict();

const analysisUploadSchema = z.object({
  repositoryId: z.string().min(1),
  commit: z.string().min(1).max(128).optional(),
  indexedAt: z.string().datetime(),
  entities: z.array(codeEntitySchema).max(50_000),
  relationships: z.array(codeRelationshipSchema).max(200_000)
}).strict();

const policyInputSchema = z.object({
  repositoryId: z.string().optional(),
  name: z.string().min(3).max(200),
  description: z.string().min(8).max(4_000),
  owner: z.string().min(2).max(200),
  severity: z.enum(["info", "suggestion", "warning", "error", "blocker"]),
  scope: z.record(z.string(), z.unknown()),
  enabled: z.boolean().default(true),
  detector: z.discriminatedUnion("type", [
    z.object({ type: z.literal("forbidden_pattern"), patterns: z.array(z.string().min(1).max(256)).min(1).max(25), message: z.string().min(3).max(1_000) }),
    z.object({ type: z.literal("forbidden_import"), imports: z.array(z.string().min(1).max(500)).min(1).max(100), message: z.string().min(3).max(1_000) }),
    z.object({ type: z.literal("forbidden_path"), paths: z.array(z.string().min(1).max(1_000)).min(1).max(100), message: z.string().min(3).max(1_000) }),
    z.object({ type: z.literal("required_test"), whenPaths: z.array(z.string().min(1).max(1_000)).min(1).max(100), testPaths: z.array(z.string().min(1).max(1_000)).min(1).max(100), message: z.string().min(3).max(1_000) }),
    z.object({ type: z.literal("secret_scan"), patterns: z.array(z.string().min(1).max(256)).min(1).max(25), message: z.string().min(3).max(1_000) })
  ])
}).strict().superRefine((value, context) => {
  if (value.detector.type !== "forbidden_pattern" && value.detector.type !== "secret_scan") return;
  value.detector.patterns.forEach((pattern, index) => {
    const message = policyPatternError(pattern);
    if (message) context.addIssue({ code: "custom", path: ["detector", "patterns", index], message });
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
  const sections = input.content.split(/(?=^#{1,3}\s+)/m).map((section) => section.trim()).filter(Boolean);
  return sections.slice(0, 500).flatMap((section, index) => {
    const heading = section.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
    const body = section.replace(/^#{1,3}\s+.+$/m, "").trim();
    const statement = body.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim().slice(0, 4_000);
    if (statement.length < 8) return [];
    const title = (heading ?? (sections.length === 1 ? input.sourceName : `${input.sourceName} section ${index + 1}`)).slice(0, 200);
    const classificationText = `${input.sourceName} ${title}`.toLowerCase();
    const kind = /\badr\b|decision|architecture/.test(classificationText)
      ? "decision" as const
      : /agents\.md|contributing|rule|convention|must\b|never\b/.test(classificationText)
        ? "rule" as const
        : "fact" as const;
    return [{
      ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
      kind,
      title,
      statement,
      rationale: `Imported from ${input.sourceName} through an explicit human action.`,
      severity: kind === "rule" ? "warning" as const : "suggestion" as const,
      scope: repositoryName ? { repository: repositoryName } : {},
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      sourceName: input.sourceName
    }];
  });
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const demoMode = options.demoMode ?? process.env.DEMO_MODE !== "false";
  const sessionSecret = process.env.SESSION_SECRET ?? "demo-only-session-secret-change-before-production";
  const store = options.dependencies?.store ?? createLoreStore({ ...process.env, DEMO_MODE: String(demoMode) });
  const jobs: JobDispatcher = options.dependencies?.jobs ?? (demoMode ? new InMemoryJobDispatcher() : new BullMqJobDispatcher(process.env.REDIS_URL));
  const metrics = new ApiMetrics();
  const contextService = new TaskPreparationService();
  const verificationService = new ChangeVerificationService();
  const knowledgeService = new KnowledgeService(store);
  const app = Fastify({
    logger: options.logger === false ? false : {
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
    origin: (process.env.WEB_ORIGIN ?? "http://localhost:5173").split(","),
    credentials: true
  });
  await app.register(rateLimit, { max: demoMode ? 1_000 : 300, timeWindow: "1 minute" });
  await app.register(rawBody, { field: "rawBody", global: false, encoding: false, runFirst: true });

  let csrfEnabled = false;
  if (!demoMode && process.env.NODE_ENV === "production") {
    csrfEnabled = true;
    await app.register(csrfProtection, {
      cookieOpts: { signed: true, sameSite: "strict", secure: true, httpOnly: true }
    });
    app.addHook("onRequest", (request, reply, done) => {
      if (["GET", "HEAD", "OPTIONS"].includes(request.method) || request.url === "/api/github/webhook" || !request.cookies.lore_session) {
        done();
        return;
      }
      app.csrfProtection(request, reply, done);
    });
  }

  app.addHook("onRequest", async () => {
    metrics.requests += 1;
  });
  app.addHook("preHandler", async (request) => {
    if (!request.url.startsWith("/api/") || request.url === "/api/github/webhook") return;
    const tenant = tenantContext(request, demoMode);
    await store.validateMembership(tenant.organisationId, tenant.userId);
  });
  app.addHook("onClose", async () => {
    await jobs.close?.();
  });

  app.setErrorHandler((error, request, reply) => {
    metrics.failures += 1;
    if (error instanceof ZodError) {
      void reply.status(400).send({ error: "VALIDATION_ERROR", message: "Request validation failed", issues: error.issues, requestId: request.id });
      return;
    }
    if (error instanceof LoreError) {
      void reply.status(error.statusCode).send({ error: error.code, message: error.message, details: error.details, requestId: request.id });
      return;
    }
    request.log.error({ err: error, event: "request.failed" }, "Request failed");
    void reply.status(500).send({ error: "INTERNAL_ERROR", message: "Lore could not complete the request", requestId: request.id });
  });

  app.get("/healthz", async () => ({ status: "ok", service: "lore-api", version: "0.1.0" }));
  app.get("/readyz", async (_request, reply) => {
    try {
      await Promise.all([store.health(), jobs.health()]);
      return { status: "ready", storage: demoMode ? "demo" : "postgresql", jobs: demoMode ? "memory" : "redis" };
    } catch {
      return reply.status(503).send({ status: "not_ready", storage: demoMode ? "demo" : "postgresql", jobs: demoMode ? "memory" : "redis" });
    }
  });
  app.get("/metrics", async (_request, reply) => reply.type("text/plain; version=0.0.4").send(metrics.render()));

  app.post("/api/auth/demo", async (_request, reply) => {
    if (!demoMode) throw new LoreError("Demo sign-in is disabled", "NOT_AVAILABLE", 404);
    reply.setCookie(
      "lore_session",
      encodeSession({ organisationId: "org_acme", userId: "user_casey", name: "Casey Hall" }),
      { signed: true, httpOnly: true, sameSite: "strict", secure: false, path: "/", maxAge: 28_800 }
    );
    return { ok: true };
  });

  app.get("/api/auth/session", async (request) => ({ user: tenantContext(request, demoMode), demoMode }));
  app.get("/api/auth/csrf", async (_request, reply) => ({ enabled: csrfEnabled, token: csrfEnabled ? reply.generateCsrf() : undefined }));

  app.get("/api/bootstrap", async (request) => {
    const tenant = tenantContext(request, demoMode);
    return store.getSnapshot(tenant.organisationId);
  });

  app.get("/api/onboarding", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const snapshot = await store.getSnapshot(tenant.organisationId);
    return {
      complete: snapshot.repositories.length > 0 && snapshot.knowledge.length > 0,
      steps: [
        { id: "repository", title: "Connect a repository", complete: snapshot.repositories.length > 0 },
        { id: "history", title: "Import historical pull requests", complete: snapshot.candidates.length > 0 },
        { id: "candidates", title: "Review discovered knowledge", complete: snapshot.knowledge.length > 0 },
        { id: "local", title: "Index the local checkout", complete: snapshot.repositories.some((repository) => repository.entityCount > 0) },
        { id: "agent", title: "Connect an agent through CLI or MCP", complete: snapshot.sessions.length > 0 }
      ]
    };
  });

  app.post("/api/repositories", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const input = repositoryInputSchema.parse(request.body);
    const repository = await store.addRepository(tenant.organisationId, {
      ...input,
      languageSummary: {},
      indexedAt: new Date().toISOString()
    }, tenant.userId);
    return reply.status(201).send(repository);
  });

  app.post("/api/repositories/:id/index", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const repository = await store.getRepository(tenant.organisationId, id);
    if (demoMode) {
      return reply.status(202).send({ jobId: `demo-index-${id}`, status: "completed", simulated: true });
    }
    if (!repository.localPath) {
      throw new LoreError("Indexing requires a trusted local Lore client to upload a sanitised code graph", "LOCAL_NODE_REQUIRED", 409);
    }
    const localPath = await assertTrustedRepositoryPath(repository.localPath).catch((error: unknown) => {
      throw new LoreError(error instanceof Error ? error.message : "Repository path is not trusted", "UNTRUSTED_REPOSITORY_PATH", 403);
    });
    const job = await jobs.dispatch(
      "repository.index",
      { organisationId: tenant.organisationId, repositoryId: id, localPath },
      `repository-index-${id}-${repository.lastIndexedCommit ?? "initial"}`
    );
    return reply.status(202).send({ jobId: job.id, status: "queued" });
  });

  app.put("/api/repositories/:id/analysis", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const input = analysisUploadSchema.parse(request.body);
    if (input.repositoryId !== id) throw new LoreError("Repository identity does not match the route", "TENANT_MISMATCH", 400);
    const repository = await store.getRepository(tenant.organisationId, id);
    const entityIds = new Set(input.entities.map((entity) => entity.id));
    if (input.entities.some((entity) => entity.repositoryId !== id) ||
        input.relationships.some((relationship) =>
          relationship.repositoryId !== id || !entityIds.has(relationship.sourceEntityId) || !entityIds.has(relationship.targetEntityId))) {
      throw new LoreError("Analysis graph contains a foreign repository or unresolved relationship", "INVALID_GRAPH", 400);
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
    return { status: "indexed", repositoryId: id, entities: input.entities.length, relationships: input.relationships.length };
  });

  app.post("/api/repositories/:id/github-import", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const input = z.object({
      limit: z.union([z.literal(50), z.literal(100), z.literal(250), z.literal(500), z.literal(1000)]).default(100)
    }).parse(request.body);
    const repository = await store.getRepository(tenant.organisationId, id);
    if (repository.provider !== "github") throw new LoreError("Historical import requires a GitHub repository", "INVALID_PROVIDER", 400);
    const installationId = Number(repository.providerInstallationId);
    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      throw new LoreError("Connect this repository to a verified GitHub App installation before importing", "INSTALLATION_REQUIRED", 409);
    }
    const job = await jobs.dispatch(
      "github.import",
      { organisationId: tenant.organisationId, repositoryId: id, installationId, limit: input.limit },
      `github-import-${id}-${installationId}-${input.limit}`
    );
    return reply.status(202).send({
      jobId: job.id,
      status: demoMode ? "simulated" : "queued",
      simulated: demoMode,
      limit: input.limit
    });
  });

  app.delete("/api/repositories/:id", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { confirm } = z.object({ confirm: z.string().min(1) }).parse(request.query);
    const repository = await store.getRepository(tenant.organisationId, id);
    const expectedConfirmation = `${repository.owner}/${repository.name}`;
    if (confirm !== expectedConfirmation) {
      throw new LoreError(`Type ${expectedConfirmation} to confirm repository deletion`, "CONFIRMATION_REQUIRED", 400);
    }
    return store.deleteRepository(tenant.organisationId, id, tenant.userId);
  });

  app.patch("/api/repositories/:id/retention", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const retentionConfig = repositoryRetentionSchema.parse(request.body);
    return store.updateRepositoryRetention(tenant.organisationId, id, retentionConfig, tenant.userId);
  });

  app.get("/api/repositories/:id/entities", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const graph = await store.getCodeGraph(tenant.organisationId, id);
    return { items: graph.entities, count: graph.entities.length };
  });

  app.get("/api/repositories/:id/relationships", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const graph = await store.getCodeGraph(tenant.organisationId, id);
    return { items: graph.relationships, count: graph.relationships.length };
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
      ...(input.baseCommit ? { baseCommit: input.baseCommit, currentCommit: input.baseCommit } : {}),
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
    if (["completed", "abandoned"].includes(session.status)) throw new LoreError("Only an open session can be abandoned", "INVALID_SESSION_TRANSITION", 409);
    return store.abandonSession(tenant.organisationId, id, reason);
  });

  app.post("/api/sessions/:id/refresh-context", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { paths } = z.object({ paths: z.array(z.string().min(1).max(4_000)).max(200).optional() }).parse(request.body ?? {});
    const snapshot = await store.getSnapshot(tenant.organisationId);
    let session = snapshot.sessions.find((item) => item.id === id);
    if (!session) throw new NotFoundError("Agent session", id);
    if (["completed", "abandoned"].includes(session.status)) throw new LoreError("A terminal session cannot refresh context", "INVALID_SESSION_TRANSITION", 409);
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
    const body = z.object({
      changedFiles: verifyChangeSchema.shape.changedFiles,
      currentCommit: z.string().min(1).max(128).optional()
    }).parse(request.body);
    const snapshot = await store.getSnapshot(tenant.organisationId);
    const session = snapshot.sessions.find((item) => item.id === id);
    if (!session) throw new NotFoundError("Agent session", id);
    if (["completed", "abandoned"].includes(session.status)) throw new LoreError("A terminal session cannot be verified again", "INVALID_SESSION_TRANSITION", 409);
    const [repository, graph, regressions] = await Promise.all([
      store.getRepository(tenant.organisationId, session.repositoryId),
      store.getCodeGraph(tenant.organisationId, session.repositoryId),
      store.getRegressions(tenant.organisationId, session.repositoryId)
    ]);
    const contextRecord = await store.getLatestContextPackage(tenant.organisationId, id);
    if (!contextRecord) throw new LoreError("Prepare and persist session context before verification", "CONTEXT_REQUIRED", 409);
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
      ...(body.currentCommit ? { currentCommit: body.currentCommit } : session.currentCommit ? { currentCommit: session.currentCommit } : {})
    };
    metrics.verifications += 1;
    return store.saveReport(tenant.organisationId, report, id);
  });

  app.get("/api/knowledge", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const query = z.object({ kind: z.string().optional(), status: z.string().optional(), repositoryId: z.string().optional() }).parse(request.query);
    const snapshot = await store.getSnapshot(tenant.organisationId);
    return {
      items: snapshot.knowledge.filter(
        (item) => (!query.kind || item.kind === query.kind) && (!query.status || item.status === query.status) && (!query.repositoryId || item.repositoryId === query.repositoryId)
      )
    };
  });

  app.get("/api/evidence", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const items = await store.getEvidence(tenant.organisationId);
    return { items: items.slice(0, 1_000), count: Math.min(items.length, 1_000), truncated: items.length > 1_000 };
  });

  app.get("/api/search", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { q, repositoryId } = z.object({ q: z.string().min(2).max(500), repositoryId: z.string().optional() }).parse(request.query);
    const [snapshot, evidence, graph] = await Promise.all([
      store.getSnapshot(tenant.organisationId),
      store.getEvidence(tenant.organisationId),
      repositoryId ? store.getCodeGraph(tenant.organisationId, repositoryId) : Promise.resolve({ entities: [], relationships: [] })
    ]);
    const needle = q.toLowerCase();
    return {
      knowledge: [...snapshot.knowledge, ...snapshot.candidates]
        .filter((item) => `${item.title} ${item.statement} ${item.rationale}`.toLowerCase().includes(needle))
        .slice(0, 50),
      evidence: evidence.filter((item) => `${item.title ?? ""} ${item.content}`.toLowerCase().includes(needle)).slice(0, 50),
      entities: graph.entities.filter((item) => `${item.qualifiedName} ${item.path}`.toLowerCase().includes(needle)).slice(0, 50)
    };
  });

  app.get("/api/knowledge-export", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const [snapshot, evidence] = await Promise.all([
      store.getSnapshot(tenant.organisationId),
      store.getEvidence(tenant.organisationId)
    ]);
    reply.header("content-disposition", `attachment; filename="lore-${snapshot.organisation.slug}.json"`);
    return { version: 1, exportedAt: new Date().toISOString(), organisation: snapshot.organisation, knowledge: snapshot.knowledge, evidence };
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
            ? ((repository) => `${repository.owner}/${repository.name}`)(await store.getRepository(tenant.organisationId, markdown.data.repositoryId))
            : undefined
        )
      : z.object({ items: z.array(manualKnowledgeSchema).min(1).max(500) }).parse(request.body).items;
    if (items.length === 0) throw new LoreError("No importable knowledge statements were found", "EMPTY_IMPORT", 400);
    const created = [];
    for (const item of items) created.push(await store.createManualKnowledge(tenant.organisationId, manualKnowledgeSchema.parse(item), tenant.userId));
    return reply.status(201).send({ imported: created.length, items: created });
  });

  app.get("/api/knowledge/:id", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const snapshot = await store.getSnapshot(tenant.organisationId);
    const item = [...snapshot.knowledge, ...snapshot.candidates].find((knowledge) => knowledge.id === id);
    if (!item) throw new NotFoundError("Knowledge item", id);
    return item;
  });

  app.post("/api/knowledge/:id/challenge", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { reason } = z.object({ reason: z.string().min(3) }).parse(request.body);
    return store.updateKnowledgeStatus(tenant.organisationId, id, "challenged", reason, tenant.userId);
  });

  app.post("/api/knowledge/:id/archive", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { reason } = z.object({ reason: z.string().min(3) }).parse(request.body);
    return store.updateKnowledgeStatus(tenant.organisationId, id, "archived", reason, tenant.userId);
  });

  app.get("/api/knowledge-candidates", async (request) => {
    const tenant = tenantContext(request, demoMode);
    return { items: (await store.getSnapshot(tenant.organisationId)).candidates };
  });

  app.post("/api/knowledge-candidates/:id/approve", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return knowledgeService.approveCandidate(tenant.organisationId, id, approveCandidateSchema.parse(request.body), tenant.userId);
  });

  app.post("/api/knowledge/:id/approve", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return knowledgeService.approveCandidate(tenant.organisationId, id, approveCandidateSchema.parse(request.body), tenant.userId);
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
    const { targetId, reason } = z.object({ targetId: z.string().min(1), reason: z.string().min(3).max(1_000) }).parse(request.body);
    return knowledgeService.mergeCandidate(tenant.organisationId, id, targetId, reason, tenant.userId);
  });

  app.get("/api/policies", async (request) => {
    const tenant = tenantContext(request, demoMode);
    return { items: (await store.getSnapshot(tenant.organisationId)).policies };
  });

  app.post("/api/policies", async (request, reply) => {
    const tenant = tenantContext(request, demoMode);
    const input = policyInputSchema.parse(request.body);
    const policy = await store.createPolicy(tenant.organisationId, {
      ...input,
      scope: input.scope,
      detector: input.detector as PolicyDetector
    } as Omit<PolicyRecord, "id" | "organisationId" | "createdAt" | "updatedAt">, tenant.userId);
    return reply.status(201).send(policy);
  });

  app.get("/api/reports/:id", async (request) => {
    const tenant = tenantContext(request, demoMode);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const report = (await store.getSnapshot(tenant.organisationId)).reports.find((item) => item.id === id);
    if (!report) throw new NotFoundError("Safety report", id);
    return report;
  });

  app.get("/api/github/install", async (request, reply) => {
    tenantContext(request, demoMode);
    const slug = process.env.GITHUB_APP_SLUG;
    if (!slug) throw new LoreError("GITHUB_APP_SLUG is not configured", "NOT_CONFIGURED", 503);
    const state = createOAuthState(sessionSecret);
    reply.setCookie("lore_oauth_state", state, {
      signed: true,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600
    });
    return { url: `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}` };
  });

  app.get("/api/github/callback", async (request, reply) => {
    tenantContext(request, demoMode);
    const { state, installation_id: installationId, setup_action: setupAction } = z.object({
      state: z.string().min(1),
      installation_id: z.coerce.number().int().positive(),
      setup_action: z.string().optional()
    }).parse(request.query);
    const signedCookie = request.cookies.lore_oauth_state;
    const stored = signedCookie ? request.unsignCookie(signedCookie) : undefined;
    if (!stored?.valid || stored.value !== state || !verifyOAuthState(sessionSecret, state)) {
      throw new LoreError("GitHub installation state is invalid or expired", "INVALID_OAUTH_STATE", 401);
    }
    reply.clearCookie("lore_oauth_state", { path: "/" });
    return { installed: true, installationId, setupAction: setupAction ?? "install", next: "/repositories" };
  });

  app.post(
    "/api/github/webhook",
    { config: { rawBody: true } },
    async (request, reply) => {
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
      const payload = request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {};
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
      const installation = payload.installation && typeof payload.installation === "object"
        ? payload.installation as Record<string, unknown>
        : {};
      const providerInstallationId = ["string", "number"].includes(typeof installation.id) ? String(installation.id) : "";
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
      const records = webhookEvidence({ organisationId, repositoryId, eventName, deliveryId, payload: request.body });
      const added = await store.ingestEvidence(records);
      if (records.length > 0) {
        await jobs.dispatch("knowledge.extract", { organisationId, repositoryId, evidenceIds: records.map((record) => record.id) }, `extract-${deliveryId}`);
      }
      // The queue job ID is deterministic, so replay is safe. Persist the
      // receipt only after dispatch; a crash before this point causes replay
      // instead of permanently losing extraction work.
      await store.saveIngestionReceipt(organisationId, "github", deliveryId, eventName);
      metrics.webhookDeliveries += 1;
      return reply.status(202).send({ status: "accepted", deliveryId, evidenceAdded: added });
    }
  );

  const webRoot = resolve("apps/web/dist");
  if (process.env.NODE_ENV === "production" && existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, prefix: "/" });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.status(404).send({ error: "NOT_FOUND", message: "Route not found" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
