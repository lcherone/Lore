import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import {
  knowledgeExtractionScopeWireSchema,
  knowledgeExtractionWireSchema,
  parseKnowledgeExtractionWireResult
} from "@lore/ai/index.js";

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

describe("OpenAI knowledge extraction schema", () => {
  it("makes every Structured Outputs field required while preserving nullable scope", () => {
    const format = zodTextFormat(knowledgeExtractionWireSchema, "KnowledgeExtractionResult_v2");
    const schema = format.schema as {
      required: string[];
      properties: {
        candidates: { items: { required: string[]; properties: { proposedScope: { required: string[] } } } };
      };
    };

    expect(schema.required).toEqual(["candidates"]);
    expect(schema.properties.candidates.items.required).toEqual([
      "kind",
      "title",
      "statement",
      "rationale",
      "proposedScope",
      "evidenceIds",
      "possibleContradictionIds"
    ]);
    expect(schema.properties.candidates.items.properties.proposedScope.required).toEqual(
      Object.keys(knowledgeExtractionScopeWireSchema.shape)
    );
  });

  it("compacts required null scope values into Lore's optional domain shape", () => {
    const parsed = parseKnowledgeExtractionWireResult({
      candidates: [{
        kind: "decision",
        title: "Keep refund calculation explicit",
        statement: "Refund calculation must remain explicit at the service boundary.",
        rationale: "The evidence records an accepted architectural decision.",
        proposedScope: { ...emptyScope, paths: ["src/Refund/**"] },
        evidenceIds: ["evidence-1"],
        possibleContradictionIds: []
      }]
    });

    expect(parsed.candidates[0]!.proposedScope).toEqual({ paths: ["src/Refund/**"] });
  });
});
