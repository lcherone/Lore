import { createHash } from "node:crypto";
import type {
  LoreStore,
  SourceControlProvider
} from "@lore/core/index.js";
import { deterministicUuid } from "@lore/shared/ids.js";
import type {
  EvidenceRecord,
  PullRequestImportLimit,
  RepositorySummary
} from "@lore/shared/types.js";

const evidenceId = (provider: string, externalId: string): string =>
  deterministicUuid("lore.evidence", `${provider}:${externalId}`);

const evidenceHash = (record: EvidenceRecord): string => createHash("sha256").update(JSON.stringify({
  url: record.url ?? null,
  title: record.title ?? null,
  content: record.content,
  author: record.author ?? null,
  occurredAt: record.occurredAt,
  metadata: record.metadata
})).digest("hex");

const versioned = (record: EvidenceRecord): EvidenceRecord => ({
  ...record,
  contentHash: evidenceHash(record)
});

export class GitHubImportService {
  public constructor(
    private readonly provider: SourceControlProvider,
    private readonly store: LoreStore
  ) {}

  async importMergedPullRequests(
    organisationId: string,
    repository: RepositorySummary,
    limit: PullRequestImportLimit
  ): Promise<{ pullRequests: number; evidenceAdded: number; evidenceUpdated: number; evidenceIds: string[] }> {
    const existingEvidence = new Map(
      (await this.store.getEvidence(organisationId)).map((record) => [record.id, record])
    );
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
      evidence.push(versioned({
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
      }));
      if (!retention.retainReviewComments) continue;
      for (const comment of pullRequest.reviewComments) {
        const commentExternalId = `${repository.owner}/${repository.name}:review-comment:${comment.externalId}`;
        evidence.push(versioned({
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
        }));
      }
    }
    const newEvidenceIds = evidence
      .filter((record) => !existingEvidence.has(record.id))
      .map((record) => record.id);
    const updatedEvidenceIds = evidence
      .filter((record) => {
        const existing = existingEvidence.get(record.id);
        return existing && (existing.contentHash ?? evidenceHash(existing)) !== record.contentHash;
      })
      .map((record) => record.id);
    await this.store.ingestEvidence(evidence);
    return {
      pullRequests: pullRequests.length,
      evidenceAdded: newEvidenceIds.length,
      evidenceUpdated: updatedEvidenceIds.length,
      evidenceIds: [...newEvidenceIds, ...updatedEvidenceIds]
    };
  }
}
