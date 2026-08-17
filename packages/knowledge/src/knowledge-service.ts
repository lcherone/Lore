import type { LoreStore } from "@lore/core/index.js";
import { calculateConfidence, freshnessFactor } from "@lore/core/index.js";
import type {
  CandidateBulkReviewResult,
  ConfidenceFactors,
  KnowledgeItem
} from "@lore/shared/types.js";
import type { z } from "zod";
import { approveCandidateSchema } from "@lore/shared/schemas.js";
import { hasFreshCandidateTriage } from "./candidate-triage-service.js";

export class KnowledgeService {
  public constructor(private readonly store: LoreStore) {}

  async approveCandidate(
    organisationId: string,
    candidateId: string,
    rawInput: z.input<typeof approveCandidateSchema>,
    actor: string
  ): Promise<KnowledgeItem> {
    const input = approveCandidateSchema.parse(rawInput);
    const candidate = await this.store.getCandidate(organisationId, candidateId);
    if (candidate.kind === "policy") {
      throw new Error("Candidates cannot be promoted into policy. Create an explicitly owned policy instead.");
    }
    return this.store.approveCandidate(organisationId, candidateId, input, actor);
  }

  async rejectCandidate(organisationId: string, candidateId: string, reason: string, actor: string): Promise<void> {
    if (reason.trim().length < 3) throw new Error("A rejection reason is required for the audit trail.");
    await this.store.rejectCandidate(organisationId, candidateId, reason, actor);
  }

  async mergeCandidate(
    organisationId: string,
    candidateId: string,
    targetId: string,
    reason: string,
    actor: string
  ): Promise<KnowledgeItem> {
    if (reason.trim().length < 3) throw new Error("A merge reason is required for the audit trail.");
    return this.store.mergeCandidate(organisationId, candidateId, targetId, reason, actor);
  }

  async bulkReviewCandidates(
    organisationId: string,
    input: {
      action: "approve" | "ignore";
      candidateIds: string[];
      reason: string;
    },
    actor: string
  ): Promise<CandidateBulkReviewResult> {
    const result: CandidateBulkReviewResult = {
      action: input.action,
      processedIds: [],
      approved: [],
      skipped: []
    };
    for (const candidateId of input.candidateIds) {
      try {
        const candidate = await this.store.getCandidate(organisationId, candidateId);
        if (input.action === "approve") {
          const approved = await this.approveCandidate(
            organisationId,
            candidateId,
            { reason: input.reason },
            actor
          );
          result.approved.push(approved);
        } else {
          if (!hasFreshCandidateTriage(candidate)) {
            result.skipped.push({ id: candidateId, reason: "AI triage is missing or stale" });
            continue;
          }
          if (candidate.triage?.bulkEligibleAction !== "ignore") {
            result.skipped.push({
              id: candidateId,
              reason: "Candidate is not guarded for bulk ignore"
            });
            continue;
          }
          await this.rejectCandidate(organisationId, candidateId, input.reason, actor);
        }
        result.processedIds.push(candidateId);
      } catch (error) {
        result.skipped.push({
          id: candidateId,
          reason: error instanceof Error ? error.message : "Candidate review failed"
        });
      }
    }
    return result;
  }
}

export interface KnowledgeHealthResult {
  itemId: string;
  originalConfidence: number;
  adjustedConfidence: number;
  health: KnowledgeItem["health"];
  reasons: string[];
}

export class KnowledgeHealthService {
  evaluate(
    item: KnowledgeItem,
    input: { codeStillMatches: boolean; recentContradictions: number; scopeStable: boolean; now?: Date }
  ): KnowledgeHealthResult {
    const freshness = freshnessFactor(item.lastConfirmedAt, input.now);
    let adjusted = item.confidence * (0.55 + freshness * 0.45);
    const reasons: string[] = [];
    if (freshness < 0.7) reasons.push("Supporting evidence is aging.");
    if (!input.codeStillMatches) {
      adjusted *= 0.55;
      reasons.push("The referenced code pattern no longer exists.");
    }
    if (!input.scopeStable) {
      adjusted *= 0.8;
      reasons.push("Repository or ownership scope changed.");
    }
    if (input.recentContradictions > 0) {
      adjusted -= Math.min(0.35, input.recentContradictions * 0.08);
      reasons.push(`${input.recentContradictions} recent contradiction${input.recentContradictions === 1 ? "" : "s"} found.`);
    }
    adjusted = Number(Math.max(0, Math.min(1, adjusted)).toFixed(2));
    const health: KnowledgeItem["health"] = input.recentContradictions > 0
      ? "conflicted"
      : adjusted < 0.55
        ? "stale"
        : adjusted < 0.72
          ? "needs_review"
          : "healthy";
    return { itemId: item.id, originalConfidence: item.confidence, adjustedConfidence: adjusted, health, reasons };
  }

  recalculateCandidate(kind: KnowledgeItem["kind"], factors: ConfidenceFactors): number {
    return calculateConfidence(factors, kind);
  }
}
