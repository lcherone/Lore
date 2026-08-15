import { createApp } from "../apps/api/src/app.js";
import { createPrismaClient, InMemoryJobDispatcher, PrismaLoreStore } from "../packages/database/src/index.js";
import type { ContextPackage, DashboardSnapshot } from "../packages/shared/src/types.js";

const prisma = createPrismaClient();
const app = await createApp({
  demoMode: false,
  logger: false,
  dependencies: { store: new PrismaLoreStore(prisma), jobs: new InMemoryJobDispatcher() }
});

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
  process.stdout.write(`${JSON.stringify({
    bootstrap: bootstrapResponse.statusCode,
    repository: `${repository.owner}/${repository.name}`,
    knowledge: snapshot.knowledge.length,
    candidates: snapshot.candidates.length,
    context: contextResponse.statusCode,
    regressions: context.historicalRegressions.length,
    recommendedTests: context.recommendedTests.length
  })}\n`);
} finally {
  await app.close();
  await prisma.$disconnect();
}
