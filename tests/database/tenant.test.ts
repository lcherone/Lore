import { describe, expect, it } from "vitest";
import { InMemoryLoreStore } from "@lore/database/index.js";
import { createDemoSnapshot } from "@lore/shared/demo-data.js";

describe("tenant boundaries", () => {
  it("never returns organisation A data through organisation B", async () => {
    const store = new InMemoryLoreStore();
    await expect(store.getSnapshot("org_other")).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(store.getRepository("org_other", "repo_soho_ecom")).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  it("creates human knowledge with first-party evidence", async () => {
    const snapshot = createDemoSnapshot();
    const store = new InMemoryLoreStore();
    const item = await store.createManualKnowledge(snapshot.organisation.id, {
      repositoryId: snapshot.repositories[0]!.id,
      kind: "decision",
      title: "Human-owned exception",
      statement: "Migration commands may use concrete repositories for one-off operations.",
      rationale: "The interface intentionally omits migration-only methods.",
      severity: "suggestion",
      scope: { repository: "soho/ecom", paths: ["src/Migrations/**"] }
    }, "user_casey");
    expect(item.confidence).toBe(1);
    expect(item.evidenceIds).toHaveLength(1);
    const evidence = await store.getEvidence(snapshot.organisation.id);
    expect(evidence.find((record) => record.id === item.evidenceIds[0])?.type).toBe("manual_confirmation");
  });
});
