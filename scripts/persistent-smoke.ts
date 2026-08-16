import { createApp } from "../apps/api/src/app.js";
import { createPrismaClient, InMemoryJobDispatcher, PrismaLoreStore } from "../packages/database/src/index.js";
import { LocalRepositoryIndexer, PhpLanguageAnalyzer, TypeScriptAnalyzer } from "../packages/analysis/src/index.js";
import { isUuid } from "../packages/shared/src/ids.js";
import type { AgentSession, ContextPackage, DashboardSnapshot, RepositorySummary, SafetyReport } from "../packages/shared/src/types.js";

const prisma = createPrismaClient();
const app = await createApp({
  demoMode: false,
  logger: false,
  dependencies: { store: new PrismaLoreStore(prisma), jobs: new InMemoryJobDispatcher() }
});
let persistedObservationId: string | undefined;

try {
  const bootstrapResponse = await app.inject({ method: "GET", url: "/api/bootstrap" });
  if (bootstrapResponse.statusCode !== 200) throw new Error(`Bootstrap failed: ${bootstrapResponse.body}`);
  const snapshot = bootstrapResponse.json<DashboardSnapshot>();
  const repository = snapshot.repositories[0];
  if (!repository) throw new Error("The selected organisation has no seeded repository");
  const contextResponse = await app.inject({
    method: "POST",
    url: "/api/tasks/prepare",
    payload: { repositoryId: repository.id, task: "SS-6160 Update Avalara ShipFrom and ShipTo addresses" }
  });
  if (contextResponse.statusCode !== 200) throw new Error(`Task preparation failed: ${contextResponse.body}`);
  const context = contextResponse.json<ContextPackage>();
  if (!isUuid(context.id)) throw new Error(`Runtime context ID is not a UUID: ${context.id}`);

  const sessionResponse = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { repositoryId: repository.id, task: "Persistent lifecycle smoke test", agentType: "other", baseCommit: repository.lastIndexedCommit }
  });
  if (sessionResponse.statusCode !== 201) throw new Error(`Session creation failed: ${sessionResponse.body}`);
  const session = sessionResponse.json<AgentSession>();
  if (!isUuid(session.id)) throw new Error(`Runtime session ID is not a UUID: ${session.id}`);
  const persistedContextResponse = await app.inject({ method: "POST", url: `/api/sessions/${session.id}/refresh-context` });
  if (persistedContextResponse.statusCode !== 200) throw new Error(`Context persistence failed: ${persistedContextResponse.body}`);
  const persistedContext = persistedContextResponse.json<ContextPackage & { revision: number }>();
  if (!isUuid(persistedContext.id) || persistedContext.revision !== 1) throw new Error("Context revision was not persisted with a canonical ID");
  const reportResponse = await app.inject({
    method: "POST",
    url: `/api/sessions/${session.id}/verify`,
    payload: {
      currentCommit: repository.lastIndexedCommit ?? "working-tree",
      changedFiles: [{ path: "src/Tax/Avalara/AddressCode.php", status: "modified", additions: 1, deletions: 0, patch: "@@ -1,1 +1,2 @@\n <?php\n+// smoke" }]
    }
  });
  if (reportResponse.statusCode !== 200) throw new Error(`Report persistence failed: ${reportResponse.body}`);
  const report = reportResponse.json<SafetyReport>();
  if (!isUuid(report.id) || !report.observationId || !isUuid(report.observationId) || report.sessionId !== session.id || report.contextId !== persistedContext.id || report.contextRevision !== 1) {
    throw new Error("Safety report lost its session/context provenance");
  }
  persistedObservationId = report.observationId;

  const smokeRepositoryResponse = await app.inject({
    method: "POST",
    url: "/api/repositories",
    payload: { provider: "local", owner: "lore-smoke", name: `fixture-${session.id.slice(0, 8)}`, defaultBranch: "main" }
  });
  if (smokeRepositoryResponse.statusCode !== 201) throw new Error(`Repository creation failed: ${smokeRepositoryResponse.body}`);
  const smokeRepository = smokeRepositoryResponse.json<RepositorySummary>();
  const analysis = await new LocalRepositoryIndexer([new TypeScriptAnalyzer(), new PhpLanguageAnalyzer()])
    .analyze(smokeRepository, "tests/fixtures/demo-repo");
  if (analysis.entities.some((entity) => !isUuid(entity.id)) || analysis.relationships.some((relationship) => !isUuid(relationship.id))) {
    throw new Error("Runtime analysis produced a non-UUID graph identifier");
  }
  const uploadResponse = await app.inject({
    method: "PUT",
    url: `/api/repositories/${smokeRepository.id}/analysis`,
    payload: {
      repositoryId: smokeRepository.id,
      indexedAt: new Date().toISOString(),
      entities: analysis.entities,
      relationships: analysis.relationships
    }
  });
  if (uploadResponse.statusCode !== 200) throw new Error(`Analysis upload failed: ${uploadResponse.body}`);
  const manualKnowledgeResponse = await app.inject({
    method: "POST",
    url: "/api/knowledge",
    payload: {
      repositoryId: smokeRepository.id,
      kind: "rule",
      title: "Persistent smoke rule",
      statement: "Persistent smoke changes must retain their evidence lineage.",
      rationale: "Exercises ordinary runtime writes against PostgreSQL.",
      severity: "warning",
      scope: { repository: `${smokeRepository.owner}/${smokeRepository.name}` },
      sourceName: "persistent-smoke"
    }
  });
  if (manualKnowledgeResponse.statusCode !== 201 || !isUuid(manualKnowledgeResponse.json<{ id: string }>().id)) {
    throw new Error(`Manual knowledge persistence failed: ${manualKnowledgeResponse.body}`);
  }

  process.stdout.write(`${JSON.stringify({
    bootstrap: bootstrapResponse.statusCode,
    repository: `${repository.owner}/${repository.name}`,
    knowledge: snapshot.knowledge.length,
    candidates: snapshot.candidates.length,
    context: contextResponse.statusCode,
    session: session.id,
    contextRevision: persistedContext.revision,
    report: report.id,
    observation: report.observationId,
    reportLinked: report.sessionId === session.id,
    runtimeGraph: { entities: analysis.entities.length, relationships: analysis.relationships.length },
    regressions: context.historicalRegressions.length,
    recommendedTests: context.recommendedTests.length
  })}\n`);
} finally {
  await app.close();
  await prisma.$disconnect();
}

const restartedPrisma = createPrismaClient();
const restartedApp = await createApp({
  demoMode: false,
  logger: false,
  dependencies: { store: new PrismaLoreStore(restartedPrisma), jobs: new InMemoryJobDispatcher() }
});
try {
  const response = await restartedApp.inject({ method: "GET", url: "/api/bootstrap" });
  if (response.statusCode !== 200) throw new Error(`Restart bootstrap failed: ${response.body}`);
  const snapshot = response.json<DashboardSnapshot>();
  if (!snapshot.sessions.some((session) => session.status === "completed") || !snapshot.reports.some((report) => Boolean(report.sessionId))) {
    throw new Error("Restarted service could not retrieve the completed linked lifecycle");
  }
  if (!persistedObservationId) throw new Error("Persistent smoke did not capture an observation ID");
  const observationResponse = await restartedApp.inject({ method: "GET", url: `/api/observations/${persistedObservationId}` });
  if (observationResponse.statusCode !== 200) throw new Error("Restarted service could not retrieve the change observation");
  process.stdout.write(`${JSON.stringify({ restart: true, observationReadback: true, completedSessions: snapshot.sessions.filter((session) => session.status === "completed").length, linkedReports: snapshot.reports.filter((report) => Boolean(report.sessionId)).length })}\n`);
} finally {
  await restartedApp.close();
  await restartedPrisma.$disconnect();
}
