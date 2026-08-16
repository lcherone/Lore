import { KnowledgeExtractionService } from "@lore/ai/index.js";
import type { AIProvider, LoreStore } from "@lore/core/index.js";
import { knowledgeStatementOverlap, validateKnowledgeProposal } from "@lore/core/index.js";
import { newUuid } from "@lore/shared/ids.js";
import type {
  CandidateRecord,
  ConfidenceFactors,
  EvidenceComparisonDisposition,
  KnowledgeItem
} from "@lore/shared/types.js";
import { KnowledgeHealthService } from "./knowledge-service.js";
import { candidateQualityErrors } from "./candidate-quality.js";

export interface CandidateExtractionItem {
  candidate: CandidateRecord;
  disposition: EvidenceComparisonDisposition;
  matches: Array<Pick<KnowledgeItem, "id" | "title" | "statement" | "status" | "kind">>;
  explanation: string;
}

export interface CandidateExtractionResult {
  evidenceAnalysed: number;
  proposals: number;
  candidatesCreated: number;
  items: CandidateExtractionItem[];
}

function compareCandidate(
  statement: string,
  existing: KnowledgeItem[],
  contradictions: KnowledgeItem[]
): Omit<CandidateExtractionItem, "candidate"> {
  if (contradictions.length > 0) {
    return {
      disposition: "conflicts",
      matches: contradictions.slice(0, 5),
      explanation: "This suggestion appears to conflict with active knowledge and needs an explicit challenge or correction."
    };
  }

  const ranked = existing
    .filter((item) => item.status === "active")
    .map((item) => ({ item, score: knowledgeStatementOverlap(item.statement, statement) }))
    .filter(({ score }) => score >= 0.55)
    .sort((left, right) => right.score - left.score);
  const matches = ranked.slice(0, 5).map(({ item }) => item);
  const best = ranked[0]?.score ?? 0;

  if (best >= 0.9) {
    return {
      disposition: "already_added",
      matches,
      explanation: "Equivalent knowledge is already recorded; review this evidence as confirmation or merge it into the existing item."
    };
  }
  if (best >= 0.55) {
    return {
      disposition: "supports_existing",
      matches,
      explanation: "This communication adds supporting evidence to similar knowledge already in Lore."
    };
  }
  return {
    disposition: "new",
    matches: [],
    explanation: "No close existing knowledge was found. This remains a candidate until a human approves it."
  };
}

export class KnowledgeCandidateExtractionService {
  public constructor(
    private readonly store: LoreStore,
    private readonly provider: AIProvider,
    private readonly source = "mock-ai:knowledge-extractor/v3"
  ) {}

  async extract(input: {
    organisationId: string;
    repositoryId?: string;
    evidenceIds: string[];
  }): Promise<CandidateExtractionResult> {
    const [allEvidence, snapshot, repository] = await Promise.all([
      this.store.getEvidence(input.organisationId),
      this.store.getSnapshot(input.organisationId),
      input.repositoryId
        ? this.store.getRepository(input.organisationId, input.repositoryId)
        : Promise.resolve(undefined)
    ]);
    const requested = new Set(input.evidenceIds);
    const sourceEvidence = allEvidence.filter((record) => requested.has(record.id));
    if (sourceEvidence.length !== requested.size) {
      throw new Error("One or more requested evidence records do not exist in this organisation.");
    }

    const extraction = await new KnowledgeExtractionService(this.provider).extract(sourceEvidence);
    const relevantKnowledge = snapshot.knowledge.filter((item) =>
      input.repositoryId
        ? !item.repositoryId || item.repositoryId === input.repositoryId
        : !item.repositoryId
    );
    const items: CandidateExtractionItem[] = [];
    let candidatesCreated = 0;

    for (const proposed of extraction.candidates) {
      const evidenceRecords = sourceEvidence.filter((record) => proposed.evidenceIds.includes(record.id));
      const scope = {
        ...proposed.proposedScope,
        ...(repository && !proposed.proposedScope.repository
          ? { repository: `${repository.owner}/${repository.name}` }
          : {})
      };
      const payload = {
        kind: proposed.kind,
        title: proposed.title,
        statement: proposed.statement,
        rationale: proposed.rationale,
        scope,
        evidenceIds: proposed.evidenceIds
      };
      const validation = validateKnowledgeProposal({
        organisationId: input.organisationId,
        ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
        payload,
        evidence: allEvidence,
        existingKnowledge: relevantKnowledge,
        humanInitiated: false
      });
      const outOfRequestEvidence = proposed.evidenceIds.filter((id) => !requested.has(id));
      const validationErrors = [
        ...validation.errors,
        ...candidateQualityErrors(proposed, evidenceRecords),
        ...(outOfRequestEvidence.length
          ? ["The extractor cited evidence outside the requested source set."]
          : [])
      ];
      const valid = validationErrors.length === 0;
      const proposal = await this.store.saveKnowledgeProposal(input.organisationId, {
        ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
        operation: "create",
        payload,
        source: this.source,
        status: valid ? "pending" : "failed_validation",
        validationErrors
      });
      if (!valid) continue;

      const communicationOnly = evidenceRecords.every((record) => record.type === "communication");
      const factors: ConfidenceFactors = {
        supportingObservations: evidenceRecords.length,
        independentPullRequests: communicationOnly
          ? 0
          : new Set(
              evidenceRecords.map((record) => {
                const pullRequest = record.metadata.pullRequest;
                return typeof pullRequest === "string" || typeof pullRequest === "number"
                  ? String(pullRequest)
                  : record.externalId;
              })
            ).size,
        independentReviewers: communicationOnly
          ? 0
          : new Set(evidenceRecords.map((record) => record.author).filter(Boolean)).size,
        recency: 0.9,
        explicitness: communicationOnly ? 0.72 : 0.78,
        sourceReliability: communicationOnly ? 0.62 : 0.82,
        contradictions: validation.contradictions.length,
        humanConfirmed: false,
        scopeStable: Boolean(scope.paths?.length || repository),
        codeStillMatches: true
      };
      const comparison = compareCandidate(
        proposed.statement,
        relevantKnowledge,
        validation.contradictions
      );
      const now = new Date().toISOString();
      const candidate: CandidateRecord = {
        id: newUuid(),
        organisationId: input.organisationId,
        ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
        kind: proposed.kind,
        status: "candidate",
        title: proposed.title,
        statement: proposed.statement,
        rationale: proposed.rationale,
        confidence: new KnowledgeHealthService().recalculateCandidate(proposed.kind, factors),
        severity:
          proposed.kind === "regression" || proposed.kind === "warning"
            ? "warning"
            : proposed.kind === "preference"
              ? "suggestion"
              : "warning",
        scope,
        createdBy: this.source,
        createdAt: now,
        updatedAt: now,
        evidenceIds: proposed.evidenceIds,
        contradictionCount: validation.contradictions.length,
        health: validation.contradictions.length ? "conflicted" : "needs_review",
        evidence: evidenceRecords,
        contradictionSummaries: validation.contradictions.map((item) => item.statement),
        confidenceFactors: factors,
        proposalId: proposal.id,
        comparison: {
          disposition: comparison.disposition,
          matchedKnowledgeIds: comparison.matches.map((item) => item.id),
          explanation: comparison.explanation
        }
      };
      const persisted = await this.store.createKnowledgeCandidate(input.organisationId, candidate);
      if (persisted.id === candidate.id) candidatesCreated += 1;
      items.push({ ...comparison, candidate: { ...persisted, comparison: candidate.comparison } });
    }

    return {
      evidenceAnalysed: sourceEvidence.length,
      proposals: extraction.candidates.length,
      candidatesCreated,
      items
    };
  }
}
