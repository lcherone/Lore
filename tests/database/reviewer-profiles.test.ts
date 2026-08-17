import { describe, expect, it } from "vitest";
import { buildReviewerProfiles } from "@lore/database/index.js";
import type { KnowledgeItem } from "@lore/shared/types.js";

describe("reviewer profiles", () => {
  it("derives reviewer profiles from imported GitHub pull requests and review comments", () => {
    const preference = {
      id: "preference-1",
      organisationId: "organisation-1",
      kind: "preference",
      status: "active",
      title: "Prefer focused changes",
      statement: "Keep changes focused.",
      rationale: "Observed in review.",
      confidence: 0.8,
      severity: "suggestion",
      scope: { reviewer: "octo-reviewer" },
      createdBy: "test",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      evidenceIds: [],
      contradictionCount: 0,
      health: "healthy"
    } satisfies KnowledgeItem;

    const reviewers = buildReviewerProfiles({
      organisationId: "organisation-1",
      existing: [],
      knowledge: [preference],
      evidence: [
        {
          type: "pull_request",
          occurredAt: "2026-08-10T10:00:00.000Z",
          metadata: {
            reviewers: ["octo-reviewer", "dependabot[bot]"],
            reviewerAvatars: {
              "octo-reviewer": "https://avatars.githubusercontent.com/u/123?v=4"
            }
          }
        },
        {
          type: "review_comment",
          author: "octo-reviewer",
          occurredAt: "2026-08-11T10:00:00.000Z",
          metadata: {}
        }
      ]
    });

    expect(reviewers).toHaveLength(1);
    expect(reviewers[0]).toMatchObject({
      name: "Octo Reviewer",
      providerIdentity: "octo-reviewer",
      avatarUrl: "https://avatars.githubusercontent.com/u/123?v=4",
      preferenceCount: 1,
      reinforcedCount: 2,
      lastObservedAt: "2026-08-11T10:00:00.000Z"
    });
  });

  it("uses GitHub's login avatar endpoint for previously imported reviewers", () => {
    const reviewers = buildReviewerProfiles({
      organisationId: "organisation-1",
      existing: [],
      knowledge: [],
      evidence: [
        {
          type: "review_comment",
          author: "legacy-reviewer",
          occurredAt: "2026-08-11T10:00:00.000Z",
          metadata: {}
        }
      ]
    });

    expect(reviewers[0]?.avatarUrl).toBe(
      "https://avatars.githubusercontent.com/legacy-reviewer?size=96"
    );
  });
});
