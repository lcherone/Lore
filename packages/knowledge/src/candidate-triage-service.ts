import { createHash } from "node:crypto";
import { CandidateTriageAIService, type CandidateTriageAIInput } from "@lore/ai/index.js";
import type { AIProvider, LoreStore } from "@lore/core/index.js";
import { knowledgeStatementOverlap } from "@lore/core/index.js";
import { createKnowledgeEvidenceView } from "@lore/shared/evidence-content.js";
import type {
  CandidateRecord,
  CandidateTriageRecommendation,
  KnowledgeItem
} from "@lore/shared/types.js";
import { candidateQualityErrors } from "./candidate-quality.js";

const TRIAGE_BATCH_SIZE = 10;
const MAX_EVIDENCE_PER_CANDIDATE = 3;
const MAX_EVIDENCE_EXCERPT = 1_500;

export const candidateTriageFingerprint = (candidate: CandidateRecord): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        title: candidate.title,
        statement: candidate.statement,
        rationale: candidate.rationale,
        kind: candidate.kind,
        scope: candidate.scope,
        confidence: candidate.confidence,
        evidenceIds: candidate.evidenceIds.toSorted(),
        evidenceVersions: candidate.evidence
          .map((record) => ({
            id: record.id,
            contentHash:
              record.contentHash ?? createHash("sha256").update(record.content).digest("hex")
          }))
          .toSorted((left, right) => left.id.localeCompare(right.id)),
        contradictionSummaries: candidate.contradictionSummaries
      })
    )
    .digest("hex");

export const hasFreshCandidateTriage = (candidate: CandidateRecord): boolean =>
  candidate.triage?.candidateFingerprint === candidateTriageFingerprint(candidate);

const makeRecommendation = (
  candidate: CandidateRecord,
  source: string,
  input: Omit<
    CandidateTriageRecommendation,
    | "source"
    | "promptVersion"
    | "candidateFingerprint"
    | "candidateUpdatedAt"
    | "evidenceCount"
    | "triagedAt"
  >
): CandidateTriageRecommendation => ({
  ...input,
  source,
  promptVersion: "candidate-triage/v1",
  candidateFingerprint: candidateTriageFingerprint(candidate),
  candidateUpdatedAt: candidate.updatedAt,
  evidenceCount: candidate.evidenceIds.length,
  triagedAt: new Date().toISOString()
});

const deterministicRecommendation = (
  candidate: CandidateRecord,
  source: string
): CandidateTriageRecommendation | undefined => {
  if (candidate.kind === "policy") {
    return makeRecommendation(candidate, source, {
      action: "review",
      durability: "unclear",
      policyFit: "possible_policy",
      confidence: 1,
      explanation:
        "Knowledge candidates cannot become enforcement policy. Review this item and create an explicitly owned deterministic policy if appropriate.",
      reasons: ["Policy requires a human owner, scope, severity, and detector configuration."],
      method: "deterministic"
    });
  }
  const comparison = candidate.comparison;
  const duplicateTargetId = comparison?.matchedKnowledgeIds[0];
  if (
    duplicateTargetId &&
    (comparison.disposition === "already_added" || comparison.disposition === "supports_existing")
  ) {
    return makeRecommendation(candidate, source, {
      action: "merge",
      durability: "duplicate",
      policyFit: "not_policy",
      duplicateTargetId,
      confidence: comparison.disposition === "already_added" ? 0.99 : 0.9,
      explanation:
        comparison.disposition === "already_added"
          ? "Equivalent approved knowledge already exists. Merge this candidate so its evidence strengthens the existing item."
          : "This candidate substantially overlaps approved knowledge and should be reviewed as supporting evidence.",
      reasons: [comparison.explanation],
      method: "deterministic"
    });
  }
  if (comparison?.disposition === "conflicts") {
    return makeRecommendation(candidate, source, {
      action: "review",
      durability: "unclear",
      policyFit: "not_policy",
      confidence: 1,
      explanation: "Lore found conflicting approved knowledge, so this candidate requires individual human review.",
      reasons: [comparison.explanation],
      method: "deterministic"
    });
  }

  const qualityErrors = candidateQualityErrors(
    {
      kind: candidate.kind,
      title: candidate.title,
      statement: candidate.statement,
      rationale: candidate.rationale,
      proposedScope: candidate.scope,
      evidenceIds: candidate.evidenceIds,
      possibleContradictionIds: []
    },
    candidate.evidence
  );
  const policyError = qualityErrors.find((error) => error.includes("explicitly owned policy"));
  if (policyError) {
    return makeRecommendation(candidate, source, {
      action: "review",
      durability: "unclear",
      policyFit: "possible_policy",
      confidence: 0.99,
      explanation:
        "This looks like an enforceable process requirement rather than ordinary knowledge. A human must define ownership, scope, severity, and a deterministic detector in Policies.",
      reasons: [policyError],
      method: "deterministic"
    });
  }
  if (qualityErrors.length) {
    return makeRecommendation(candidate, source, {
      action: "ignore",
      durability: "one_off_change",
      policyFit: "not_policy",
      confidence: 0.99,
      explanation:
        "This is source history or a one-off implementation claim, not durable guidance for future engineering work.",
      reasons: qualityErrors.slice(0, 5),
      bulkEligibleAction: "ignore",
      method: "deterministic"
    });
  }
  return undefined;
};

const possibleMatches = (
  candidate: CandidateRecord,
  candidates: CandidateRecord[],
  knowledge: KnowledgeItem[]
): CandidateTriageAIInput["possibleMatches"] =>
  [...knowledge, ...candidates]
    .filter((item) => item.id !== candidate.id)
    .map((item) => ({
      item,
      similarity: knowledgeStatementOverlap(candidate.statement, item.statement)
    }))
    .filter(({ similarity }) => similarity >= 0.42)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 5)
    .map(({ item, similarity }) => ({
      id: item.id,
      status: item.status,
      kind: item.kind,
      title: item.title,
      statement: item.statement,
      similarity: Number(similarity.toFixed(3))
    }));

const aiInput = (
  candidate: CandidateRecord,
  candidates: CandidateRecord[],
  knowledge: KnowledgeItem[]
): CandidateTriageAIInput => ({
  candidateId: candidate.id,
  kind: candidate.kind,
  title: candidate.title,
  statement: candidate.statement,
  rationale: candidate.rationale,
  scope: candidate.scope,
  candidateConfidence: candidate.confidence,
  evidenceCount: candidate.evidenceIds.length,
  contradictionCount: candidate.contradictionCount,
  evidence: candidate.evidence.slice(0, MAX_EVIDENCE_PER_CANDIDATE).map((record) => ({
    type: record.type,
    ...(record.title ? { title: record.title } : {}),
    ...(record.author ? { author: record.author } : {}),
    occurredAt: record.occurredAt,
    excerpt: createKnowledgeEvidenceView(record).text.slice(0, MAX_EVIDENCE_EXCERPT)
  })),
  possibleMatches: possibleMatches(candidate, candidates, knowledge)
});

const normaliseAIRecommendation = (
  candidate: CandidateRecord,
  source: string,
  result: Awaited<ReturnType<CandidateTriageAIService["triage"]>>[number]
): CandidateTriageRecommendation => {
  let action = result.action;
  if (result.duplicateTargetId) action = "merge";
  if (action === "merge" && !result.duplicateTargetId) action = "review";
  if (result.policyFit === "possible_policy") action = "review";
  if (
    action === "approve" &&
    (result.recommendedKind && result.recommendedKind !== candidate.kind)
  ) {
    action = "edit";
  }
  if (
    action === "approve" &&
    result.recommendedStatement &&
    result.recommendedStatement !== candidate.statement
  ) {
    action = "edit";
  }

  const approveEligible =
    action === "approve" &&
    result.durability === "durable" &&
    result.confidence >= 0.9 &&
    candidate.confidence >= 0.72 &&
    candidate.evidenceIds.length >= 2 &&
    candidate.contradictionCount === 0 &&
    candidate.contradictionSummaries.length === 0 &&
    !result.recommendedKind &&
    !result.recommendedStatement;
  const ignoreEligible =
    action === "ignore" &&
    (result.durability === "one_off_change" || result.durability === "situational") &&
    result.confidence >= 0.9 &&
    result.policyFit === "not_policy" &&
    candidate.contradictionCount === 0 &&
    candidate.contradictionSummaries.length === 0;

  return makeRecommendation(candidate, source, {
    action,
    durability: result.durability,
    policyFit: result.policyFit,
    ...(result.recommendedKind ? { recommendedKind: result.recommendedKind } : {}),
    ...(result.recommendedStatement
      ? { recommendedStatement: result.recommendedStatement }
      : {}),
    ...(result.duplicateTargetId ? { duplicateTargetId: result.duplicateTargetId } : {}),
    confidence: result.confidence,
    explanation: result.explanation,
    reasons: result.reasons,
    ...(approveEligible
      ? { bulkEligibleAction: "approve" as const }
      : ignoreEligible
        ? { bulkEligibleAction: "ignore" as const }
        : {}),
    method: "ai"
  });
};

export interface CandidateTriageResult {
  requested: number;
  triaged: number;
  skippedFresh: number;
  deterministic: number;
  ai: number;
  recommendations: Record<CandidateTriageRecommendation["action"], number>;
}

export class CandidateTriageService {
  public constructor(
    private readonly store: LoreStore,
    private readonly provider: AIProvider,
    private readonly source = "mock-ai:candidate-triage/v1"
  ) {}

  async triage(input: {
    organisationId: string;
    candidateIds: string[];
    force?: boolean;
    onProgress?: (progress: {
      completed: number;
      total: number;
      deterministic: number;
      ai: number;
    }) => Promise<void> | void;
  }): Promise<CandidateTriageResult> {
    const snapshot = await this.store.getSnapshot(input.organisationId);
    const requestedIds = new Set(input.candidateIds);
    const candidates = snapshot.candidates.filter((candidate) => requestedIds.has(candidate.id));
    if (candidates.length !== requestedIds.size) {
      throw new Error("One or more requested candidates do not exist in this organisation.");
    }
    const recommendations: CandidateTriageResult["recommendations"] = {
      approve: 0,
      edit: 0,
      merge: 0,
      ignore: 0,
      review: 0
    };
    let skippedFresh = 0;
    let deterministic = 0;
    let ai = 0;
    const requiresAI: CandidateRecord[] = [];

    for (const candidate of candidates) {
      if (!input.force && hasFreshCandidateTriage(candidate)) {
        skippedFresh += 1;
        continue;
      }
      const recommendation = deterministicRecommendation(candidate, this.source);
      if (!recommendation) {
        requiresAI.push(candidate);
        continue;
      }
      await this.store.saveCandidateTriage(input.organisationId, candidate.id, recommendation);
      recommendations[recommendation.action] += 1;
      deterministic += 1;
    }

    await input.onProgress?.({
      completed: deterministic + skippedFresh,
      total: candidates.length,
      deterministic,
      ai
    });

    const aiService = new CandidateTriageAIService(this.provider);
    for (let offset = 0; offset < requiresAI.length; offset += TRIAGE_BATCH_SIZE) {
      const batch = requiresAI.slice(offset, offset + TRIAGE_BATCH_SIZE);
      const results = await aiService.triage(
        batch.map((candidate) => aiInput(candidate, snapshot.candidates, snapshot.knowledge))
      );
      const byId = new Map(results.map((result) => [result.candidateId, result]));
      for (const candidate of batch) {
        const result = byId.get(candidate.id);
        if (!result) throw new Error(`AI triage omitted candidate ${candidate.id}`);
        const recommendation = normaliseAIRecommendation(candidate, this.source, result);
        await this.store.saveCandidateTriage(input.organisationId, candidate.id, recommendation);
        recommendations[recommendation.action] += 1;
        ai += 1;
      }
      await input.onProgress?.({
        completed: deterministic + ai + skippedFresh,
        total: candidates.length,
        deterministic,
        ai
      });
    }

    return {
      requested: candidates.length,
      triaged: deterministic + ai,
      skippedFresh,
      deterministic,
      ai,
      recommendations
    };
  }
}
