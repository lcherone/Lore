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
    repositoryId: "repo_example_commerce",
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
      proposedScope: {
        organisation: null,
        repository: null,
        paths: null,
        excludedPaths: null,
        symbols: null,
        subsystem: null,
        language: null,
        framework: null,
        team: null,
        reviewer: null,
        integration: null,
        ticketType: null
      },
      evidenceIds: [id],
      possibleContradictionIds: []
    }]
  }));
  const result = await new KnowledgeCandidateExtractionService(store, provider).extract({
    organisationId: "org_acme",
    repositoryId: "repo_example_commerce",
    evidenceIds: [id]
  });
  return result.items[0]!.disposition;
}

describe("candidate comparison", () => {
  it("distinguishes new, already-added, supporting, and conflicting suggestions", async () => {
    await expect(dispositionFor(
      "Origin and destination addresses must receive independent codes in external tax payloads."
    )).resolves.toBe("already_added");
    await expect(dispositionFor(
      "Alex prefers application services built against repository interfaces."
    )).resolves.toBe("supports_existing");
    await expect(dispositionFor(
      "Origin and destination addresses must not receive independent codes in external tax payloads."
    )).resolves.toBe("conflicts");
    await expect(dispositionFor(
      "Release notes should include a link to the weekend support rota."
    )).resolves.toBe("new");
  });

  it("persists only durable candidates after the extraction quality gate", async () => {
    const store = new InMemoryLoreStore();
    const id = deterministicUuid("test.pull-request", "quality-gate");
    await store.ingestEvidence([{
      id,
      organisationId: "org_acme",
      repositoryId: "repo_example_commerce",
      type: "pull_request",
      provider: "github",
      externalId: "owner/repository:pr:123",
      title: "PR #123: Safer importer",
      content: "The content importer must roll back unless live mode and the target database are confirmed.",
      occurredAt: "2026-08-16T09:00:00.000Z",
      metadata: { number: 123 }
    }]);
    const emptyScope = {
      organisation: null,
      repository: null,
      paths: null,
      excludedPaths: null,
      symbols: null,
      subsystem: null,
      language: null,
      framework: null,
      team: null,
      reviewer: null,
      integration: null,
      ticketType: null
    };
    const provider = new MockAIProvider(() => ({
      candidates: [
        {
          kind: "fact",
          title: "Importer exists",
          statement: "A content importer exists in the current codebase.",
          rationale: "The pull request adds it.",
          proposedScope: emptyScope,
          evidenceIds: [id],
          possibleContradictionIds: []
        },
        {
          kind: "rule",
          title: "Deployment changelog must be updated",
          statement: "The deployment changelog must be updated after a pull request is deployed.",
          rationale: "The pull request template says so.",
          proposedScope: emptyScope,
          evidenceIds: [id],
          possibleContradictionIds: []
        },
        {
          kind: "decision",
          title: "Use the importer",
          statement: "The repository uses the content importer for staged data changes.",
          rationale: "The pull request changed the importer.",
          proposedScope: emptyScope,
          evidenceIds: [id],
          possibleContradictionIds: []
        },
        {
          kind: "rule",
          title: "Importer requires live confirmation",
          statement: "The content importer must roll back unless live mode and the target database are confirmed.",
          rationale: "The change summary identifies this as a safety invariant.",
          proposedScope: emptyScope,
          evidenceIds: [id],
          possibleContradictionIds: []
        }
      ]
    }));

    const result = await new KnowledgeCandidateExtractionService(store, provider).extract({
      organisationId: "org_acme",
      repositoryId: "repo_example_commerce",
      evidenceIds: [id]
    });

    expect(result).toMatchObject({ proposals: 4, candidatesCreated: 1 });
    expect(result.items.map((item) => item.candidate.title)).toEqual(["Importer requires live confirmation"]);
  });
});
