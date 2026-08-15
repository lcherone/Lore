import { calculateCoChangePairs } from "@lore/impact/index.js";
import { deterministicUuid } from "@lore/shared/ids.js";
import type { CodeEntity, CodeRelationship } from "@lore/shared/types.js";

export interface GitHistoryCommit {
  sha: string;
  occurredAt: string;
  paths: string[];
}

/**
 * Adds conservative, file-level co-change edges to an existing static graph.
 * Small samples are discarded by calculateCoChangePairs, and the raw counts
 * remain on every edge so callers can explain why it exists.
 */
export function addGitHistoryRelationships(
  repositoryId: string,
  entities: CodeEntity[],
  relationships: CodeRelationship[],
  commits: GitHistoryCommit[]
): CodeRelationship[] {
  const fileByPath = new Map<string, CodeEntity>();
  for (const entity of entities) {
    const existing = fileByPath.get(entity.path);
    if (!existing || entity.type === "file" || entity.type === "test") fileByPath.set(entity.path, entity);
  }
  const historical = calculateCoChangePairs(commits)
    .map((pair): CodeRelationship | undefined => {
      const left = fileByPath.get(pair.leftPath);
      const right = fileByPath.get(pair.rightPath);
      if (!left || !right) return undefined;
      const id = deterministicUuid("lore.code.relationship.git-history", `${repositoryId}:co-change:${left.id}:${right.id}`);
      return {
        id,
        repositoryId,
        sourceEntityId: left.id,
        targetEntityId: right.id,
        relationshipType: "historically_changes_with",
        confidence: pair.confidence,
        source: "git_history",
        metadata: {
          sampleCount: pair.sampleCount,
          coChangeCount: pair.coChangeCount,
          conditionalProbability: pair.conditionalProbability,
          lastObserved: pair.lastObserved
        }
      };
    })
    .filter((relationship): relationship is CodeRelationship => Boolean(relationship));

  const all = new Map(relationships.map((relationship) => [relationship.id, relationship]));
  for (const relationship of historical) all.set(relationship.id, relationship);
  return [...all.values()];
}
