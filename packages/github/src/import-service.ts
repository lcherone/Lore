import type { LoreStore, SourceControlProvider } from "@lore/core/index.js";
import { deterministicUuid } from "@lore/shared/ids.js";
import type { EvidenceRecord, RepositorySummary } from "@lore/shared/types.js";

const evidenceId = (provider: string, externalId: string): string =>
  deterministicUuid("lore.evidence", `${provider}:${externalId}`);

export class GitHubImportService {
  public constructor(
    private readonly provider: SourceControlProvider,
    private readonly store: LoreStore
  ) {}

  async importMergedPullRequests(
    organisationId: string,
    repository: RepositorySummary,
    limit: 50 | 100 | 250 | 500 | 1000
  ): Promise<{ pullRequests: number; evidenceAdded: number; evidenceIds: string[] }> {
    const pullRequests = await this.provider.listMergedPullRequests(repository, limit);
    const retention = repository.retentionConfig ?? {
      retainRawPullRequestDiff: false,
      retainSummariesOnly: false,
      retainReviewComments: true,
      retainCodeSnippets: false
    };
    const evidence: EvidenceRecord[] = [];
    for (const pullRequest of pullRequests) {
      const externalId = `${repository.owner}/${repository.name}:pr:${pullRequest.number}`;
      evidence.push({
        id: evidenceId("github", externalId),
        organisationId,
        repositoryId: repository.id,
        type: "pull_request",
        provider: "github",
        externalId,
        url: pullRequest.url,
        title: `PR #${pullRequest.number}: ${pullRequest.title}`,
        content: retention.retainSummariesOnly
          ? pullRequest.title
          : [pullRequest.body, retention.retainRawPullRequestDiff ? pullRequest.rawDiff : undefined].filter(Boolean).join("\n\n"),
        author: pullRequest.author,
        occurredAt: pullRequest.mergedAt,
        metadata: {
          number: pullRequest.number,
          reviewers: pullRequest.reviewers,
          commits: pullRequest.commits,
          changedFiles: pullRequest.changedFiles,
          merged: true,
          retention: {
            rawDiffRetained: retention.retainRawPullRequestDiff && Boolean(pullRequest.rawDiff),
            summariesOnly: retention.retainSummariesOnly,
            codeSnippetsRetained: false
          }
        }
      });
      if (!retention.retainReviewComments) continue;
      for (const comment of pullRequest.reviewComments) {
        const commentExternalId = `${repository.owner}/${repository.name}:review-comment:${comment.externalId}`;
        evidence.push({
          id: evidenceId("github", commentExternalId),
          organisationId,
          repositoryId: repository.id,
          type: "review_comment",
          provider: "github",
          externalId: commentExternalId,
          ...(comment.url ? { url: comment.url } : {}),
          title: `Review comment on PR #${pullRequest.number}`,
          content: comment.body,
          author: comment.author,
          occurredAt: comment.occurredAt,
          metadata: { pullRequest: pullRequest.number }
        });
      }
    }
    return {
      pullRequests: pullRequests.length,
      evidenceAdded: await this.store.ingestEvidence(evidence),
      evidenceIds: evidence.map((record) => record.id)
    };
  }
}
