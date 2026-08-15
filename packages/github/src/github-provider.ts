import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import type {
  PullRequestImport,
  SourceControlProvider
} from "@lore/core/index.js";
import type { PullRequestImportLimit, RepositorySummary } from "@lore/shared/types.js";

export interface GitHubProviderOptions {
  appId: number;
  privateKey: string;
  installationId: number;
}

async function importMergedPullRequests(
  octokit: Octokit,
  repository: RepositorySummary,
  limit: PullRequestImportLimit
): Promise<PullRequestImport[]> {
  const merged: Array<{
    number: number;
    title: string;
    body: string | null;
    user: { login: string } | null;
    merged_at: string | null;
    html_url: string;
  }> = [];

  for (let page = 1; limit === "all" || merged.length < limit; page += 1) {
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

  const selected = limit === "all" ? merged : merged.slice(0, limit);
  const results: PullRequestImport[] = [];
  for (const pullRequest of selected) {
    const common = {
      owner: repository.owner,
      repo: repository.name,
      pull_number: pullRequest.number,
      per_page: 100 as const
    };
    const [reviews, reviewComments, conversationComments, commits, files] = await Promise.all([
      octokit.paginate(octokit.rest.pulls.listReviews, common),
      octokit.paginate(octokit.rest.pulls.listReviewComments, common),
      octokit.paginate(octokit.rest.issues.listComments, {
        owner: repository.owner,
        repo: repository.name,
        issue_number: pullRequest.number,
        per_page: 100
      }),
      octokit.paginate(octokit.rest.pulls.listCommits, common),
      octokit.paginate(octokit.rest.pulls.listFiles, common)
    ]);
    results.push({
      externalId: String(pullRequest.number),
      number: pullRequest.number,
      title: pullRequest.title,
      body: pullRequest.body ?? "",
      author: pullRequest.user?.login ?? "unknown",
      reviewers: [
        ...new Set(
          reviews
            .map((review) => review.user?.login)
            .filter((name): name is string => Boolean(name))
        )
      ],
      reviewComments: [
        ...reviews
          .filter((review) => Boolean(review.body?.trim()))
          .map((review) => ({
            externalId: `review-${review.id}`,
            author: review.user?.login ?? "unknown",
            body: review.body,
            url: review.html_url,
            occurredAt: review.submitted_at ?? pullRequest.merged_at ?? new Date().toISOString()
          })),
        ...reviewComments.map((comment) => ({
          externalId: String(comment.id),
          author: comment.user.login,
          body: comment.body,
          url: comment.html_url,
          occurredAt: comment.created_at
        })),
        ...conversationComments.map((comment) => ({
          externalId: `conversation-${comment.id}`,
          author: comment.user?.login ?? "unknown",
          body: comment.body ?? "",
          url: comment.html_url,
          occurredAt: comment.created_at
        }))
      ],
      commits: commits.map((commit) => commit.sha),
      changedFiles: files.map((file) => file.filename),
      rawDiff: files
        .filter((file) => typeof file.patch === "string")
        .map(
          (file) =>
            `diff --git a/${file.filename} b/${file.filename}\n${file.patch ?? ""}`
        )
        .join("\n\n")
        .slice(0, 2_000_000),
      mergedAt: pullRequest.merged_at ?? new Date().toISOString(),
      url: pullRequest.html_url
    });
  }
  return results;
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
    limit: PullRequestImportLimit
  ): Promise<PullRequestImport[]> {
    const octokit = await this.#app.getInstallationOctokit(this.options.installationId);
    return importMergedPullRequests(octokit, repository, limit);
  }
}

export class GitHubTokenSourceControlProvider implements SourceControlProvider {
  readonly #octokit: Octokit;

  public constructor(token: string, octokit?: Octokit) {
    this.#octokit = octokit ?? new Octokit({ auth: token });
  }

  async listMergedPullRequests(
    repository: RepositorySummary,
    limit: PullRequestImportLimit
  ): Promise<PullRequestImport[]> {
    return importMergedPullRequests(this.#octokit, repository, limit);
  }
}
