import { createHash } from "node:crypto";
import type { LoreStore, SourceControlProvider } from "@lore/core/index.js";
import { deterministicUuid } from "@lore/shared/ids.js";
import type {
  EvidenceRecord,
  PullRequestImportLimit,
  RepositorySummary
} from "@lore/shared/types.js";

const evidenceId = (provider: string, externalId: string): string =>
  deterministicUuid("lore.evidence", `${provider}:${externalId}`);

const evidenceHash = (record: EvidenceRecord): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        url: record.url ?? null,
        title: record.title ?? null,
        content: record.content,
        author: record.author ?? null,
        occurredAt: record.occurredAt,
        metadata: record.metadata
      })
    )
    .digest("hex");

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
    limit: PullRequestImportLimit,
    onEvidencePersisted?: (evidence: EvidenceRecord[]) => Promise<void>
  ): Promise<{
    pullRequests: number;
    evidenceAdded: number;
    evidenceUpdated: number;
    evidenceIds: string[];
  }> {
    const existingEvidence = new Map(
      (await this.store.getEvidence(organisationId)).map((record) => [record.id, record])
    );
    const retention = repository.retentionConfig ?? {
      retainRawPullRequestDiff: false,
      retainSummariesOnly: false,
      retainReviewComments: true,
      retainCodeSnippets: false
    };
    const knownSourceVersions = await this.store.getSyncSourceVersions(
      organisationId,
      repository.id,
      "github",
      "merged_pull_request"
    );
    const processedPullRequests = new Set<string>();
    const changedEvidenceIds: string[] = [];
    let evidenceAdded = 0;
    let evidenceUpdated = 0;

    const persistPullRequest = async (
      pullRequest: Awaited<ReturnType<SourceControlProvider["listMergedPullRequests"]>>[number]
    ): Promise<void> => {
      if (processedPullRequests.has(pullRequest.externalId)) return;
      processedPullRequests.add(pullRequest.externalId);
      const evidence: EvidenceRecord[] = [];
      const externalId = `${repository.owner}/${repository.name}:pr:${pullRequest.number}`;
      evidence.push(
        versioned({
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
            : [
                pullRequest.body,
                retention.retainRawPullRequestDiff ? pullRequest.rawDiff : undefined
              ]
                .filter(Boolean)
                .join("\n\n"),
          author: pullRequest.author,
          occurredAt: pullRequest.mergedAt,
          metadata: {
            number: pullRequest.number,
            reviewers: pullRequest.reviewers,
            ...(pullRequest.reviewerAvatars
              ? { reviewerAvatars: pullRequest.reviewerAvatars }
              : {}),
            commits: pullRequest.commits,
            changedFiles: pullRequest.changedFiles,
            merged: true,
            retention: {
              rawDiffRetained: retention.retainRawPullRequestDiff && Boolean(pullRequest.rawDiff),
              summariesOnly: retention.retainSummariesOnly,
              codeSnippetsRetained: false
            }
          }
        })
      );
      if (retention.retainReviewComments) {
        for (const comment of pullRequest.reviewComments) {
          const commentExternalId = `${repository.owner}/${repository.name}:review-comment:${comment.externalId}`;
          evidence.push(
            versioned({
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
              metadata: {
                pullRequest: pullRequest.number,
                ...(comment.avatarUrl ? { avatarUrl: comment.avatarUrl } : {})
              }
            })
          );
        }
      }
      const newEvidenceIds = evidence
        .filter((record) => !existingEvidence.has(record.id))
        .map((record) => record.id);
      const updatedEvidenceIds = evidence
        .filter((record) => {
          const existing = existingEvidence.get(record.id);
          return (
            existing && (existing.contentHash ?? evidenceHash(existing)) !== record.contentHash
          );
        })
        .map((record) => record.id);
      await this.store.ingestEvidence(evidence);
      for (const record of evidence) existingEvidence.set(record.id, record);
      evidenceAdded += newEvidenceIds.length;
      evidenceUpdated += updatedEvidenceIds.length;
      changedEvidenceIds.push(...newEvidenceIds, ...updatedEvidenceIds);
      const changedIds = new Set([...newEvidenceIds, ...updatedEvidenceIds]);
      const changedEvidence = evidence.filter((record) => changedIds.has(record.id));
      const checkpointChanged = Boolean(
        pullRequest.sourceVersion &&
        knownSourceVersions[pullRequest.externalId] !== pullRequest.sourceVersion
      );
      const downstreamEvidence =
        changedEvidence.length > 0 ? changedEvidence : checkpointChanged ? evidence : [];
      if (downstreamEvidence.length > 0) await onEvidencePersisted?.(downstreamEvidence);
      if (pullRequest.sourceVersion) {
        await this.store.saveSyncCheckpoint({
          organisationId,
          repositoryId: repository.id,
          provider: "github",
          stream: "merged_pull_request",
          externalId: pullRequest.externalId,
          sourceVersion: pullRequest.sourceVersion
        });
        knownSourceVersions[pullRequest.externalId] = pullRequest.sourceVersion;
      }
    };

    const pullRequests = await this.provider.listMergedPullRequests(repository, limit, {
      knownSourceVersions,
      onPullRequest: persistPullRequest
    });
    for (const pullRequest of pullRequests) await persistPullRequest(pullRequest);
    return {
      pullRequests: processedPullRequests.size,
      evidenceAdded,
      evidenceUpdated,
      evidenceIds: [...new Set(changedEvidenceIds)]
    };
  }
}
