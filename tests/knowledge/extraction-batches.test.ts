import { describe, expect, it } from "vitest";
import { createKnowledgeExtractionBatches } from "@lore/knowledge/index.js";
import type { EvidenceRecord } from "@lore/shared/types.js";

const evidence = (id: string, content: string): EvidenceRecord => ({
  id,
  organisationId: "organisation",
  repositoryId: "repository",
  type: "pull_request",
  provider: "github",
  externalId: id,
  content,
  occurredAt: "2026-08-16T00:00:00.000Z",
  metadata: {}
});

describe("knowledge extraction batches", () => {
  it("bounds record count, preserves order, and removes duplicate or missing IDs", () => {
    const records = [evidence("one", "first"), evidence("two", "second"), evidence("three", "third")];
    expect(createKnowledgeExtractionBatches(records, ["one", "two", "two", "missing", "three"], {
      maxEvidence: 2,
      maxCharacters: 100_000
    })).toEqual([["one", "two"], ["three"]]);
  });

  it("keeps an oversized evidence record intact in its own batch", () => {
    const records = [evidence("large", "x".repeat(2_000)), evidence("small", "small")];
    expect(createKnowledgeExtractionBatches(records, ["large", "small"], {
      maxEvidence: 20,
      maxCharacters: 1_000
    })).toEqual([["large"], ["small"]]);
  });
});
