import { describe, expect, it, vi } from "vitest";
import { GitHubTokenSourceControlProvider } from "@lore/github/index.js";
import type { RepositorySummary } from "@lore/shared/types.js";

const repository: RepositorySummary = {
  id: "repository",
  organisationId: "organisation",
  provider: "github",
  owner: "acme",
  name: "commerce",
  defaultBranch: "main",
  languageSummary: {},
  entityCount: 0,
  relationshipCount: 0,
  status: "ready"
};

describe("GitHub pull request provider", () => {
  it("paginates all merged PRs and every evidence collection", async () => {
    const listReviews = vi.fn();
    const listReviewComments = vi.fn();
    const listCommits = vi.fn();
    const listFiles = vi.fn();
    const listConversationComments = vi.fn();
    const pullList = vi.fn(async ({ page }: { page: number }) => ({
      data:
        page === 1
          ? [
              {
                number: 8,
                title: "Accepted change",
                body: "Why it changed",
                user: { login: "author" },
                merged_at: "2026-01-02T00:00:00.000Z",
                html_url: "https://github.example/acme/commerce/pull/8"
              },
              ...Array.from({ length: 99 }, (_, index) => ({
                number: 100 + index,
                title: "Closed without merge",
                body: null,
                user: null,
                merged_at: null,
                html_url: "https://github.example/closed"
              }))
            ]
          : [
              {
                number: 7,
                title: "Older accepted change",
                body: null,
                user: null,
                merged_at: "2025-12-01T00:00:00.000Z",
                html_url: "https://github.example/acme/commerce/pull/7"
              }
            ]
    }));
    const paginate = vi.fn(async (endpoint: unknown) => {
      if (endpoint === listReviews) {
        return [
          {
            id: 10,
            user: { login: "reviewer" },
            body: "Please keep the boundary explicit.",
            html_url: "https://github.example/review/10",
            submitted_at: "2026-01-01T00:00:00.000Z"
          }
        ];
      }
      if (endpoint === listReviewComments) {
        return [
          {
            id: 11,
            user: { login: "reviewer" },
            body: "Use the repository interface here.",
            html_url: "https://github.example/comment/11",
            created_at: "2026-01-01T01:00:00.000Z"
          }
        ];
      }
      if (endpoint === listConversationComments) {
        return [
          {
            id: 12,
            user: { login: "maintainer" },
            body: "Confirmed after the deploy test.",
            html_url: "https://github.example/conversation/12",
            created_at: "2026-01-01T02:00:00.000Z"
          }
        ];
      }
      if (endpoint === listCommits) return [{ sha: "abc123" }];
      if (endpoint === listFiles) {
        return [{ filename: "src/service.ts", patch: "@@ -1 +1 @@\n-old\n+new" }];
      }
      throw new Error("Unexpected endpoint");
    });
    const fakeOctokit = {
      rest: {
        pulls: {
          list: pullList,
          listReviews,
          listReviewComments,
          listCommits,
          listFiles
        },
        issues: { listComments: listConversationComments }
      },
      paginate
    };

    const provider = new GitHubTokenSourceControlProvider(
      "github_pat_test_12345678901234567890",
      fakeOctokit as never
    );
    const imported = await provider.listMergedPullRequests(repository, "all");

    expect(pullList).toHaveBeenCalledTimes(2);
    expect(imported.map((pullRequest) => pullRequest.number)).toEqual([8, 7]);
    expect(imported[0]).toMatchObject({
      reviewers: ["reviewer"],
      commits: ["abc123"],
      changedFiles: ["src/service.ts"]
    });
    expect(imported[0]!.reviewComments.map((comment) => comment.externalId)).toEqual([
      "review-10",
      "11",
      "conversation-12"
    ]);
    expect(imported[0]!.rawDiff).toContain("diff --git a/src/service.ts b/src/service.ts");
    expect(paginate).toHaveBeenCalledTimes(10);
  });
});
