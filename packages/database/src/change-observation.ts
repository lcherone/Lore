import { createHash } from "node:crypto";
import { newUuid } from "@lore/shared/ids.js";
import type { ChangeObservation, ChangedFile, SafetyReport } from "@lore/shared/types.js";

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

function manifestFor(changedFiles: ChangedFile[]): ChangeObservation["files"] {
  return [...changedFiles]
    .map((file) => ({
      path: file.path,
      ...(file.previousPath ? { previousPath: file.previousPath } : {}),
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      ...(file.patch ? { patchHash: hash(file.patch) } : {})
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function createChangeObservation(input: {
  organisationId: string;
  sessionId: string;
  contextId: string;
  contextRevision: number;
  report: SafetyReport;
}): ChangeObservation {
  const files = manifestFor(input.report.changedFiles);
  const contentHash = hash(
    JSON.stringify({
      repositoryId: input.report.repositoryId,
      sessionId: input.sessionId,
      contextId: input.contextId,
      contextRevision: input.contextRevision,
      baseCommit: input.report.baseCommit ?? null,
      currentCommit: input.report.currentCommit ?? null,
      files
    })
  );
  return {
    id: newUuid(),
    organisationId: input.organisationId,
    repositoryId: input.report.repositoryId,
    sessionId: input.sessionId,
    contextId: input.contextId,
    contextRevision: input.contextRevision,
    ...(input.report.baseCommit ? { baseCommit: input.report.baseCommit } : {}),
    ...(input.report.currentCommit ? { currentCommit: input.report.currentCommit } : {}),
    files,
    contentHash,
    capturedAt: new Date().toISOString()
  };
}
