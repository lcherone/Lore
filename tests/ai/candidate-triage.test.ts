import { describe, expect, it } from "vitest";
import { CandidateTriageAIService, MockAIProvider } from "@lore/ai/index.js";

const item = {
  candidateId: "candidate-1",
  kind: "fact" as const,
  title: "Updated checkout controller",
  statement: "The checkout controller was updated in PR 123.",
  rationale: "A pull request changed the controller.",
  scope: { repository: "acme/commerce" },
  candidateConfidence: 0.5,
  evidenceCount: 1,
  contradictionCount: 0,
  evidence: [
    {
      type: "pull_request",
      occurredAt: "2026-08-16T00:00:00.000Z",
      excerpt: "Updated the checkout controller and tests passed."
    }
  ],
  possibleMatches: [{
    id: "knowledge-1",
    status: "active",
    kind: "fact" as const,
    title: "Checkout controller",
    statement: "The checkout controller handles checkout.",
    similarity: 0.5
  }]
};

describe("candidate AI triage", () => {
  it("returns validated recommendations without allowing invented merge targets", async () => {
    const provider = new MockAIProvider(() => ({
      items: [{
        candidateId: "candidate-1",
        action: "ignore",
        durability: "one_off_change",
        policyFit: "not_policy",
        recommendedKind: null,
        recommendedStatement: null,
        duplicateTargetId: null,
        confidence: 0.97,
        explanation: "This is a completed change rather than future guidance.",
        reasons: ["It only restates one pull request."]
      }]
    }));

    const result = await new CandidateTriageAIService(provider).triage([item]);

    expect(result[0]).toMatchObject({
      candidateId: "candidate-1",
      action: "ignore",
      durability: "one_off_change",
      confidence: 0.97
    });
    expect(result[0]).not.toHaveProperty("recommendedKind");
  });

  it("rejects a duplicate target that was not supplied to the model", async () => {
    const provider = new MockAIProvider(() => ({
      items: [{
        candidateId: "candidate-1",
        action: "merge",
        durability: "duplicate",
        policyFit: "not_policy",
        recommendedKind: null,
        recommendedStatement: null,
        duplicateTargetId: "invented-target",
        confidence: 0.99,
        explanation: "Duplicate.",
        reasons: ["The wording overlaps."]
      }]
    }));

    await expect(new CandidateTriageAIService(provider).triage([item])).rejects.toThrow(
      "outside the supplied matches"
    );
  });
});
