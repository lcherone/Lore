import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import type {
  PullRequestImport,
  PullRequestImportOptions,
  SourceControlProvider
} from "@lore/core/index.js";
import type { PullRequestImportLimit, RepositorySummary } from "@lore/shared/types.js";
import { GitHubRequestPacer, type GitHubRequestWait } from "./request-pacer.js";

export interface GitHubProviderOptions {
  appId: number;
  privateKey: string;
  installationId: number;
  requestPacer?: GitHubRequestPacer;
  onRequestWait?: (wait: GitHubRequestWait) => void;
}

interface GitHubPage<T> {
  data: T[];
  headers?: Record<string, string | number | undefined>;
}

async function paginate<T>(
  pacer: GitHubRequestPacer,
  request: (page: number) => Promise<GitHubPage<T>>,
  onRequestWait?: (wait: GitHubRequestWait) => void
): Promise<T[]> {
  const results: T[] = [];
  for (let page = 1; ; page += 1) {
    const response = await pacer.request(() => request(page), onRequestWait);
    results.push(...response.data);
    if (response.data.length < 100) return results;
  }
}

async function importMergedPullRequests(
  octokit: Octokit,
  repository: RepositorySummary,
  limit: PullRequestImportLimit,
  pacer: GitHubRequestPacer,
  onRequestWait?: (wait: GitHubRequestWait) => void,
  options: PullRequestImportOptions = {}
): Promise<PullRequestImport[]> {
  const merged: Array<{
    number: number;
    title: string;
    body: string | null;
    user: { login: string } | null;
    merged_at: string | null;
    updated_at: string;
    html_url: string;
  }> = [];

  for (let page = 1; limit === "all" || merged.length < limit; page += 1) {
    const response = await pacer.request(
      () =>
        octokit.rest.pulls.list({
          owner: repository.owner,
          repo: repository.name,
          state: "closed",
          sort: "updated",
          direction: "desc",
          per_page: 100,
          page
        }),
      onRequestWait
    );
    merged.push(...response.data.filter((pullRequest) => pullRequest.merged_at));
    if (response.data.length < 100) break;
  }

  const selected = limit === "all" ? merged : merged.slice(0, limit);
  const results: PullRequestImport[] = [];
  for (const pullRequest of selected) {
    const sourceVersion = pullRequest.updated_at;
    if (
      sourceVersion &&
      options.knownSourceVersions?.[String(pullRequest.number)] === sourceVersion
    )
      continue;
    const common = {
      owner: repository.owner,
      repo: repository.name,
      pull_number: pullRequest.number,
      per_page: 100 as const
    };
    const reviews = await paginate(
      pacer,
      (page) => octokit.rest.pulls.listReviews({ ...common, page }),
      onRequestWait
    );
    const reviewComments = await paginate(
      pacer,
      (page) => octokit.rest.pulls.listReviewComments({ ...common, page }),
      onRequestWait
    );
    const conversationComments = await paginate(
      pacer,
      (page) =>
        octokit.rest.issues.listComments({
          owner: repository.owner,
          repo: repository.name,
          issue_number: pullRequest.number,
          per_page: 100,
          page
        }),
      onRequestWait
    );
    const commits = await paginate(
      pacer,
      (page) => octokit.rest.pulls.listCommits({ ...common, page }),
      onRequestWait
    );
    const files = await paginate(
      pacer,
      (page) => octokit.rest.pulls.listFiles({ ...common, page }),
      onRequestWait
    );
    const reviewerAvatars = Object.fromEntries(
      reviews.flatMap((review) =>
        review.user?.login && review.user.avatar_url
          ? [[review.user.login, review.user.avatar_url] as const]
          : []
      )
    );
    const imported: PullRequestImport = {
      externalId: String(pullRequest.number),
      ...(sourceVersion ? { sourceVersion } : {}),
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
      ...(Object.keys(reviewerAvatars).length > 0 ? { reviewerAvatars } : {}),
      reviewComments: [
        ...reviews
          .filter((review) => Boolean(review.body?.trim()))
          .map((review) => ({
            externalId: `review-${review.id}`,
            author: review.user?.login ?? "unknown",
            ...(review.user?.avatar_url ? { avatarUrl: review.user.avatar_url } : {}),
            body: review.body,
            url: review.html_url,
            occurredAt: review.submitted_at ?? pullRequest.merged_at ?? new Date().toISOString()
          })),
        ...reviewComments.map((comment) => ({
          externalId: String(comment.id),
          author: comment.user.login,
          ...(comment.user.avatar_url ? { avatarUrl: comment.user.avatar_url } : {}),
          body: comment.body,
          url: comment.html_url,
          occurredAt: comment.created_at
        })),
        ...conversationComments.map((comment) => ({
          externalId: `conversation-${comment.id}`,
          author: comment.user?.login ?? "unknown",
          ...(comment.user?.avatar_url ? { avatarUrl: comment.user.avatar_url } : {}),
          body: comment.body ?? "",
          url: comment.html_url,
          occurredAt: comment.created_at
        }))
      ],
      commits: commits.map((commit) => commit.sha),
      changedFiles: files.map((file) => file.filename),
      rawDiff: files
        .filter((file) => typeof file.patch === "string")
        .map((file) => `diff --git a/${file.filename} b/${file.filename}\n${file.patch ?? ""}`)
        .join("\n\n")
        .slice(0, 2_000_000),
      mergedAt: pullRequest.merged_at ?? new Date().toISOString(),
      url: pullRequest.html_url
    };
    results.push(imported);
    await options.onPullRequest?.(imported);
  }
  return results;
}

export class GitHubSourceControlProvider implements SourceControlProvider {
  readonly #app: App<{ Octokit: typeof Octokit }>;
  readonly #requestPacer: GitHubRequestPacer;

  public constructor(private readonly options: GitHubProviderOptions) {
    this.#requestPacer = options.requestPacer ?? new GitHubRequestPacer();
    this.#app = new App({
      appId: options.appId,
      privateKey: options.privateKey.replaceAll("\\n", "\n"),
      Octokit
    });
  }

  async listMergedPullRequests(
    repository: RepositorySummary,
    limit: PullRequestImportLimit,
    options?: PullRequestImportOptions
  ): Promise<PullRequestImport[]> {
    const octokit = await this.#app.getInstallationOctokit(this.options.installationId);
    return importMergedPullRequests(
      octokit,
      repository,
      limit,
      this.#requestPacer,
      this.options.onRequestWait,
      options
    );
  }
}

export class GitHubTokenSourceControlProvider implements SourceControlProvider {
  readonly #octokit: Octokit;
  readonly #requestPacer: GitHubRequestPacer;

  public constructor(
    token: string,
    octokit?: Octokit,
    requestPacer?: GitHubRequestPacer,
    private readonly onRequestWait?: (wait: GitHubRequestWait) => void
  ) {
    this.#octokit = octokit ?? new Octokit({ auth: token });
    this.#requestPacer = requestPacer ?? new GitHubRequestPacer();
  }

  async listMergedPullRequests(
    repository: RepositorySummary,
    limit: PullRequestImportLimit,
    options?: PullRequestImportOptions
  ): Promise<PullRequestImport[]> {
    return importMergedPullRequests(
      this.#octokit,
      repository,
      limit,
      this.#requestPacer,
      this.onRequestWait,
      options
    );
  }
}
