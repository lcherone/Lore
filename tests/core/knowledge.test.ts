import { describe, expect, it } from "vitest";
import { calculateConfidence, scopeApplies, sortByPrecedence, validateKnowledgeProposal } from "@lore/core/index.js";
import { KnowledgeHealthService } from "@lore/knowledge/index.js";
import { createDemoSnapshot, getDemoEvidence } from "@lore/shared/demo-data.js";
import type { ConfidenceFactors, KnowledgeItem } from "@lore/shared/types.js";

const factors = (overrides: Partial<ConfidenceFactors> = {}): ConfidenceFactors => ({
  supportingObservations: 1,
  independentPullRequests: 1,
  independentReviewers: 1,
  recency: 0.9,
  explicitness: 0.8,
  sourceReliability: 0.85,
  contradictions: 0,
  humanConfirmed: false,
  scopeStable: true,
  codeStillMatches: true,
  ...overrides
});

describe("evidence-backed knowledge", () => {
  it("keeps one-observation rules weak and rewards independent evidence", () => {
    const weak = calculateConfidence(factors(), "rule");
    const supported = calculateConfidence(
      factors({ supportingObservations: 7, independentPullRequests: 4, independentReviewers: 3 }),
      "rule"
    );
    expect(weak).toBeLessThan(0.6);
    expect(supported).toBeGreaterThan(weak);
    expect(supported).toBeGreaterThanOrEqual(0.7);
  });

  it("does not treat a reviewer preference as global", () => {
    const repository = createDemoSnapshot().repositories[0]!;
    const scope = { repository: "soho/ecom", reviewer: "joe@acme.example", paths: ["src/**/Service/**"] };
    expect(scopeApplies(scope, { repository, reviewer: "joe@acme.example", paths: ["src/Order/Service/Create.php"] })).toBe(true);
    expect(scopeApplies(scope, { repository, reviewer: "rebecca@acme.example", paths: ["src/Order/Service/Create.php"] })).toBe(false);
    expect(scopeApplies(scope, { repository, paths: ["src/Order/Service/Create.php"] })).toBe(false);
  });

  it("flags contradictory active knowledge instead of overwriting it", () => {
    const current = createDemoSnapshot().knowledge[0]!;
    const existing: KnowledgeItem = {
      ...current,
      statement: "Checkout services must cache authentication tokens in memory.",
      scope: { repository: "soho/ecom", paths: ["src/Checkout/**"] }
    };
    const evidence = getDemoEvidence();
    const result = validateKnowledgeProposal({
      organisationId: current.organisationId,
      repositoryId: current.repositoryId,
      payload: {
        kind: "rule",
        title: "Do not cache authentication tokens",
        statement: "Checkout services must not cache authentication tokens in memory.",
        rationale: "A security review rejected the cache.",
        scope: existing.scope,
        evidenceIds: [evidence[0]!.id]
      },
      evidence,
      existingKnowledge: [existing],
      humanInitiated: false
    });
    expect(result.valid).toBe(true);
    expect(result.contradictions).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain("contradicts");
  });

  it("rejects AI-created policies even if a caller bypasses the public schema", () => {
    const snapshot = createDemoSnapshot();
    const result = validateKnowledgeProposal({
      organisationId: snapshot.organisation.id,
      repositoryId: snapshot.repositories[0]!.id,
      payload: {
        kind: "policy",
        title: "AI policy",
        statement: "Never allow the model to write policy directly.",
        rationale: "Governance requires a human owner.",
        scope: { organisation: snapshot.organisation.slug },
        evidenceIds: [getDemoEvidence()[0]!.id]
      } as never,
      evidence: getDemoEvidence(),
      existingKnowledge: snapshot.knowledge,
      humanInitiated: false
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("cannot create policy");
  });

  it("downgrades stale knowledge and ranks symbol rules ahead of organisation preferences", () => {
    const snapshot = createDemoSnapshot();
    const stale = new KnowledgeHealthService().evaluate(
      { ...snapshot.knowledge[0]!, confidence: 0.9, lastConfirmedAt: "2021-01-01T00:00:00.000Z" },
      { codeStillMatches: false, recentContradictions: 0, scopeStable: true, now: new Date("2026-08-15T00:00:00.000Z") }
    );
    expect(stale.adjustedConfidence).toBeLessThan(0.55);
    expect(stale.health).toBe("stale");

    const preference: KnowledgeItem = { ...snapshot.knowledge[3]!, confidence: 0.99, scope: { organisation: "acme-engineering" } };
    const symbolRule: KnowledgeItem = { ...snapshot.knowledge[1]!, confidence: 0.7, scope: { symbols: ["AddressCode::fromRole"] } };
    expect(sortByPrecedence([preference, symbolRule])[0]!.id).toBe(symbolRule.id);
  });
});
