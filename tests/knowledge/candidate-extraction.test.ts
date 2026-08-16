import { describe, expect, it } from "vitest";
import { MockAIProvider } from "@lore/ai/index.js";
import { InMemoryLoreStore } from "@lore/database/index.js";
import { KnowledgeCandidateExtractionService } from "@lore/knowledge/index.js";
import { deterministicUuid } from "@lore/shared/ids.js";
import type { EvidenceComparisonDisposition, EvidenceRecord } from "@lore/shared/types.js";

async function dispositionFor(statement: string): Promise<EvidenceComparisonDisposition> {
  const store = new InMemoryLoreStore();
  const id = deterministicUuid("test.communication", statement);
  const evidence: EvidenceRecord = {
    id,
    organisationId: "org_acme",
    repositoryId: "repo_soho_ecom",
    type: "communication",
    provider: "human-communication",
    externalId: `communication:test:${id}`,
    title: "Comparison test",
    content: statement,
    occurredAt: "2026-08-16T09:00:00.000Z",
    metadata: { sourceType: "note" }
  };
  await store.ingestEvidence([evidence]);
  const provider = new MockAIProvider(() => ({
    candidates: [{
      kind: "rule",
      title: "Extracted comparison candidate",
      statement,
      rationale: "Explicitly supplied for deterministic comparison testing.",
      proposedScope: {},
      evidenceIds: [id],
      possibleContradictionIds: []
    }]
  }));
  const result = await new KnowledgeCandidateExtractionService(store, provider).extract({
    organisationId: "org_acme",
    repositoryId: "repo_soho_ecom",
    evidenceIds: [id]
  });
  return result.items[0]!.disposition;
}

describe("candidate comparison", () => {
  it("distinguishes new, already-added, supporting, and conflicting suggestions", async () => {
    await expect(dispositionFor(
      "ShipFrom and ShipTo addresses must receive independent address codes in Avalara payloads."
    )).resolves.toBe("already_added");
    await expect(dispositionFor(
      "Joe prefers application services built against repository interfaces."
    )).resolves.toBe("supports_existing");
    await expect(dispositionFor(
      "ShipFrom and ShipTo addresses must not receive independent address codes in Avalara payloads."
    )).resolves.toBe("conflicts");
    await expect(dispositionFor(
      "Release notes should include a link to the weekend support rota."
    )).resolves.toBe("new");
  });
});
