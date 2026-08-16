import { describe, expect, it } from "vitest";
import { MockAIProvider } from "@lore/ai/index.js";
import { InMemoryLoreStore } from "@lore/database/index.js";
import {
  CandidateTriageService,
  candidateTriageFingerprint,
  hasFreshCandidateTriage
} from "@lore/knowledge/index.js";
import { DEMO_ORGANISATION_ID } from "@lore/shared/demo-data.js";
import type { CandidateRecord } from "@lore/shared/types.js";

describe("candidate triage service", () => {
  it("classifies obvious Git activity and process-policy wording without an AI request", async () => {
    const store = new InMemoryLoreStore();
    const snapshot = await store.getSnapshot(DEMO_ORGANISATION_ID);
    const source = snapshot.candidates.find((candidate) => candidate.id === "candidate_interfaces")!;
    const oneOff: CandidateRecord = {
      ...structuredClone(source),
      id: "candidate_one_off",
      kind: "fact",
      title: "Updated the checkout service",
      statement: "The checkout service was updated in pull request 1832.",
      rationale: "One pull request changed the service.",
      evidenceIds: [source.evidence[0]!.id],
      evidence: [source.evidence[0]!],
      contradictionCount: 0,
      contradictionSummaries: []
    };
    const policyLike: CandidateRecord = {
      ...structuredClone(source),
      id: "candidate_policy_like",
      kind: "rule",
      title: "Pull requests must include a Jira link",
      statement: "Pull requests must include the related Jira ticket before merge.",
      rationale: "A pull request template included this requirement.",
      contradictionCount: 0,
      contradictionSummaries: []
    };
    await store.createKnowledgeCandidate(DEMO_ORGANISATION_ID, oneOff);
    await store.createKnowledgeCandidate(DEMO_ORGANISATION_ID, policyLike);
    const provider = new MockAIProvider(() => {
      throw new Error("AI should not be called for deterministic classifications");
    });

    const result = await new CandidateTriageService(store, provider).triage({
      organisationId: DEMO_ORGANISATION_ID,
      candidateIds: [oneOff.id, policyLike.id]
    });

    expect(result).toMatchObject({ requested: 2, deterministic: 2, ai: 0 });
    expect((await store.getCandidate(DEMO_ORGANISATION_ID, oneOff.id)).triage).toMatchObject({
      action: "ignore",
      durability: "one_off_change",
      bulkEligibleAction: "ignore"
    });
    expect((await store.getCandidate(DEMO_ORGANISATION_ID, policyLike.id)).triage).toMatchObject({
      action: "review",
      policyFit: "possible_policy"
    });
  });

  it("invalidates a recommendation when linked evidence content changes", async () => {
    const snapshot = await new InMemoryLoreStore().getSnapshot(DEMO_ORGANISATION_ID);
    const candidate = structuredClone(
      snapshot.candidates.find((item) => item.id === "candidate_avalara")!
    );
    const fingerprint = candidateTriageFingerprint(candidate);
    candidate.triage = {
      action: "approve",
      durability: "durable",
      policyFit: "not_policy",
      confidence: 0.95,
      explanation: "Durable guidance.",
      reasons: ["Independent evidence supports it."],
      method: "ai",
      source: "test",
      promptVersion: "candidate-triage/v1",
      candidateFingerprint: fingerprint,
      candidateUpdatedAt: candidate.updatedAt,
      evidenceCount: candidate.evidenceIds.length,
      triagedAt: new Date().toISOString()
    };
    expect(hasFreshCandidateTriage(candidate)).toBe(true);

    candidate.evidence[0]!.content = `${candidate.evidence[0]!.content}\nUpstream correction`;
    candidate.evidence[0]!.contentHash = undefined;

    expect(hasFreshCandidateTriage(candidate)).toBe(false);
  });
});
