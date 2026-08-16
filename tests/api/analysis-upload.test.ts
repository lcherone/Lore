import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import { InMemoryJobDispatcher, InMemoryLoreStore } from "@lore/database/index.js";

describe("trusted local analysis upload", () => {
  it("accepts a bounded sanitised graph larger than the general API body limit", async () => {
    const store = new InMemoryLoreStore();
    const app = await createApp({
      demoMode: true,
      logger: false,
      dependencies: { store, jobs: new InMemoryJobDispatcher() }
    });
    const entityId = randomUUID();
    const response = await app.inject({
      method: "PUT",
      url: "/api/repositories/repo_soho_ecom/analysis",
      payload: {
        repositoryId: "repo_soho_ecom",
        indexedAt: new Date().toISOString(),
        entities: [{
          id: entityId,
          repositoryId: "repo_soho_ecom",
          type: "file",
          name: "large-index.ts",
          qualifiedName: "large-index.ts",
          path: "src/large-index.ts",
          language: "typescript",
          fingerprint: "large-index-fixture",
          metadata: { boundedAnalyzerOutput: "x".repeat(3_000_000) }
        }],
        relationships: []
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "indexed",
      repositoryId: "repo_soho_ecom",
      entities: 1,
      relationships: 0
    });
    expect((await store.getRepository("org_acme", "repo_soho_ecom")).entityCount).toBe(1);
    await app.close();
  });
});
