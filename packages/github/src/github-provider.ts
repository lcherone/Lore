import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import type { PullRequestImport, SourceControlProvider } from "@lore/core/index.js";
import type { RepositorySummary } from "@lore/shared/types.js";

export interface GitHubProviderOptions {
  appId: number;
  privateKey: string;
  installationId: number;
}

export class GitHubSourceControlProvider implements SourceControlProvider {
  readonly #app: App<{ Octokit: typeof Octokit }>;

  public constructor(private readonly options: GitHubProviderOptions) {
    this.#app = new App({
      appId: options.appId,
      privateKey: options.privateKey.replaceAll("\\n", "\n"),
      Octokit
    });
  }

  async listMergedPullRequests(
    repository: RepositorySummary,
    limit: 50 | 100 | 250 | 500 | 1000
  ): Promise<PullRequestImport[]> {
    const octokit = await this.#app.getInstallationOctokit(this.options.installationId);
    const merged: Array<{ number: number; title: string; body: string | null; user: { login: string } | null; merged_at: string | null; html_url: string }> = [];

    for (let page = 1; merged.length < limit && page <= 20; page += 1) {
      const response = await octokit.rest.pulls.list({
        owner: repository.owner,
        repo: repository.name,
        state: "closed",
        sort: "updated",
        direction: "desc",
        per_page: 100,
        page
      });
      merged.push(...response.data.filter((pullRequest) => pullRequest.merged_at));
      if (response.data.length < 100) break;
    }

    const results: PullRequestImport[] = [];
    for (const pullRequest of merged.slice(0, limit)) {
      const [reviews, comments, commits, files] = await Promise.all([
        octokit.rest.pulls.listReviews({ owner: repository.owner, repo: repository.name, pull_number: pullRequest.number }),
        octokit.rest.pulls.listReviewComments({ owner: repository.owner, repo: repository.name, pull_number: pullRequest.number }),
        octokit.rest.pulls.listCommits({ owner: repository.owner, repo: repository.name, pull_number: pullRequest.number, per_page: 100 }),
        octokit.rest.pulls.listFiles({ owner: repository.owner, repo: repository.name, pull_number: pullRequest.number, per_page: 100 })
      ]);
      results.push({
        externalId: String(pullRequest.number),
        number: pullRequest.number,
        title: pullRequest.title,
        body: pullRequest.body ?? "",
        author: pullRequest.user?.login ?? "unknown",
        reviewers: [...new Set(reviews.data.map((review) => review.user?.login).filter((name): name is string => Boolean(name)))],
        reviewComments: comments.data.map((comment) => ({
          externalId: String(comment.id),
          author: comment.user.login,
          body: comment.body,
          url: comment.html_url,
          occurredAt: comment.created_at
        })),
        commits: commits.data.map((commit) => commit.sha),
        changedFiles: files.data.map((file) => file.filename),
        rawDiff: files.data
          .filter((file) => typeof file.patch === "string")
          .map((file) => `diff --git a/${file.filename} b/${file.filename}\n${file.patch ?? ""}`)
          .join("\n\n")
          .slice(0, 2_000_000),
        mergedAt: pullRequest.merged_at ?? new Date().toISOString(),
        url: pullRequest.html_url
      });
    }
    return results;
  }
}
