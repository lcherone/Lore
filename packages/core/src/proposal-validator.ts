import type { EvidenceRecord, KnowledgeItem } from "@lore/shared/types.js";
import type { ProposalPayload } from "@lore/shared/schemas.js";

export interface ProposalValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  contradictions: KnowledgeItem[];
  duplicates: KnowledgeItem[];
}

const tokens = (value: string): Set<string> =>
  new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((token) => token.length >= 4)
  );

export const knowledgeStatementOverlap = (left: string, right: string): number => {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / Math.min(leftTokens.size, rightTokens.size);
};

export function validateKnowledgeProposal(input: {
  organisationId: string;
  repositoryId?: string;
  payload: ProposalPayload;
  evidence: EvidenceRecord[];
  existingKnowledge: KnowledgeItem[];
  humanInitiated: boolean;
}): ProposalValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if ((input.payload.kind as string) === "policy" && !input.humanInitiated) {
    errors.push("AI proposals cannot create policy. A human owner must create or explicitly approve policy.");
  }

  const referencedEvidence = input.payload.evidenceIds
    .map((id) => input.evidence.find((record) => record.id === id))
    .filter((record): record is EvidenceRecord => Boolean(record));

  if (referencedEvidence.length !== input.payload.evidenceIds.length) {
    errors.push("One or more referenced evidence records do not exist.");
  }

  if (referencedEvidence.some((record) => record.organisationId !== input.organisationId)) {
    errors.push("Evidence cannot cross organisation boundaries.");
  }

  if (
    input.repositoryId &&
    referencedEvidence.some((record) => record.repositoryId && record.repositoryId !== input.repositoryId)
  ) {
    errors.push("Repository-scoped proposals may only cite evidence from the same repository.");
  }

  const supportScore = referencedEvidence.reduce(
    (best, record) => Math.max(best, knowledgeStatementOverlap(input.payload.statement, `${record.title ?? ""} ${record.content}`)),
    0
  );
  if (referencedEvidence.length > 0 && supportScore < 0.12) {
    warnings.push("The deterministic text check found weak direct support; require manual evidence review.");
  }

  if (input.payload.scope.paths?.some((path) => path.includes("..") || path.startsWith("/"))) {
    errors.push("Knowledge paths must be repository-relative and cannot traverse parent directories.");
  }

  const duplicates = input.existingKnowledge.filter(
    (item) => item.status !== "rejected" && knowledgeStatementOverlap(item.statement, input.payload.statement) >= 0.72
  );
  if (duplicates.length > 0) warnings.push("Similar knowledge already exists; consider merging instead of creating a duplicate.");

  const negations = /\b(?:not|never|must not|do not|forbid)\b/i;
  const contradictions = input.existingKnowledge.filter((item) => {
    const similar = knowledgeStatementOverlap(item.statement, input.payload.statement) >= 0.45;
    const oppositePolarity = negations.test(item.statement) !== negations.test(input.payload.statement);
    return item.status === "active" && similar && oppositePolarity;
  });
  if (contradictions.length > 0) warnings.push("The proposal contradicts active knowledge and must create a challenge.");

  return { valid: errors.length === 0, errors, warnings, contradictions, duplicates };
}
