import { describe, expect, it } from "vitest";
import { candidateQualityErrors } from "@lore/knowledge/index.js";
import type { EvidenceRecord } from "@lore/shared/types.js";

const pullRequest = (
  id: string,
  content = "An explicit engineering change summary."
): EvidenceRecord => ({
  id,
  organisationId: "organisation",
  repositoryId: "repository",
  type: "pull_request",
  provider: "github",
  externalId: `owner/repository:pr:${id}`,
  title: `PR #${id}`,
  content,
  occurredAt: "2026-08-16T00:00:00.000Z",
  metadata: { number: id }
});

const candidate = (overrides: Partial<Parameters<typeof candidateQualityErrors>[0]> = {}) => ({
  kind: "fact" as const,
  title: "Importer exists",
  statement: "A selective content importer exists in the current codebase.",
  rationale: "The pull request adds the importer.",
  proposedScope: {},
  evidenceIds: ["1"],
  possibleContradictionIds: [],
  ...overrides
});

describe("candidate extraction quality gate", () => {
  it("rejects single-PR facts but accepts independently corroborated facts", () => {
    expect(candidateQualityErrors(candidate(), [pullRequest("1")])).toContain(
      "A single Git change cannot establish a durable fact or inference; require corroboration from at least two independent pull requests."
    );
    expect(candidateQualityErrors(
      candidate({ evidenceIds: ["1", "2"] }),
      [pullRequest("1"), pullRequest("2")]
    )).toEqual([]);
  });

  it("routes PR-template process requirements away from AI knowledge", () => {
    expect(candidateQualityErrors(candidate({
      kind: "rule",
      title: "Deployment changelog must be updated",
      statement: "The deployment changelog must be updated after a pull request is deployed."
    }), [pullRequest("1")])).toContain(
      "Pull-request template and compliance-process rules require an explicitly owned policy; AI extraction cannot promote them into knowledge."
    );
  });

  it("rejects Git activity summaries even when multiple pull requests corroborate them", () => {
    expect(candidateQualityErrors(candidate({
      kind: "fact",
      title: "Multiple production dependencies were upgraded",
      statement: "Production dependencies were changed across multiple PRs."
    }), [pullRequest("1"), pullRequest("2")])).toContain(
      "Git activity, review outcomes, and reusable test-template summaries are evidence history, not durable engineering knowledge."
    );
  });

  it("allows an explicit reusable rule from one pull request", () => {
    expect(candidateQualityErrors(candidate({
      kind: "rule",
      title: "Importer requires live confirmation",
      statement: "The content importer must roll back unless live mode and the target database are confirmed."
    }), [pullRequest("1", "The importer must roll back unless live mode and the target database are confirmed.")])).toEqual([]);
  });

  it("rejects a one-off change relabelled as a decision", () => {
    expect(candidateQualityErrors(candidate({
      kind: "decision",
      title: "Use a mobile gradient",
      statement: "Hero content blocks use a gradient overlay on mobile."
    }), [pullRequest("1", "# Change Summary\n\nFix hero gradient")])).toContain(
      "A single Git change cannot establish a durable decision without an explicit authored decision signal."
    );
  });

  it("accepts a decision explicitly stated by its author", () => {
    expect(candidateQualityErrors(candidate({
      kind: "decision",
      title: "Keep generated manifests selective",
      statement: "Generated manifests intentionally include only approved content records."
    }), [pullRequest("1", "We decided generated manifests will include only approved content records.")])).toEqual([]);
  });

  it("does not treat normative wording in stripped PR-template sections as a rule signal", () => {
    expect(candidateQualityErrors(candidate({
      kind: "rule",
      title: "Use a mobile gradient",
      statement: "Hero content blocks must use a gradient overlay on mobile."
    }), [pullRequest("1", "# Change Summary\n\nFix hero gradient\n\n## SOX\n\nPull requests must link Jira tickets.")])).toContain(
      "A single Git change cannot establish a durable rule without an explicit authored rule signal."
    );
  });
});
