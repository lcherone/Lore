import type { CodeEntity, CodeRelationship } from "@lore/shared/types.js";
import { deterministicUuid } from "@lore/shared/ids.js";

export const stableId = (namespace: string, value: string): string =>
  deterministicUuid(`lore.code.${namespace}`, value);

export function createEntity(input: Omit<CodeEntity, "id" | "fingerprint" | "metadata"> & {
  fingerprint?: string;
  metadata?: Record<string, unknown>;
}): CodeEntity {
  const fingerprint = input.fingerprint ?? `${input.type}:${input.qualifiedName}:${input.path}`;
  return {
    ...input,
    id: stableId("entity", `${input.repositoryId}:${fingerprint}`),
    fingerprint,
    metadata: input.metadata ?? {}
  };
}

export function createRelationship(input: Omit<CodeRelationship, "id" | "metadata"> & {
  metadata?: Record<string, unknown>;
}): CodeRelationship {
  return {
    ...input,
    id: stableId(
      "relationship",
      `${input.repositoryId}:${input.sourceEntityId}:${input.targetEntityId}:${input.relationshipType}:${input.source}`
    ),
    metadata: input.metadata ?? {}
  };
}
