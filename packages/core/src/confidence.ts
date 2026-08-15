import type { ConfidenceFactors, KnowledgeKind } from "@lore/shared/types.js";

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

export function calculateConfidence(factors: ConfidenceFactors, kind: KnowledgeKind): number {
  const positive =
    Math.min(factors.supportingObservations / 8, 1) * 0.13 +
    Math.min(factors.independentPullRequests / 5, 1) * 0.14 +
    Math.min(factors.independentReviewers / 3, 1) * 0.1 +
    clamp(factors.recency) * 0.12 +
    clamp(factors.explicitness) * 0.12 +
    clamp(factors.sourceReliability) * 0.12 +
    (factors.humanConfirmed ? 0.14 : 0) +
    (factors.scopeStable ? 0.07 : 0) +
    (factors.codeStillMatches ? 0.06 : 0);

  const contradictionPenalty = Math.min(0.35, factors.contradictions * 0.07);
  let score = positive - contradictionPenalty;

  if ((kind === "rule" || kind === "decision") && factors.independentPullRequests < 2 && !factors.humanConfirmed) {
    score *= 0.72;
  }

  if (kind === "preference" && factors.independentReviewers === 1 && factors.supportingObservations >= 3) {
    score += 0.06;
  }

  if (kind === "policy") {
    return factors.humanConfirmed ? 1 : 0;
  }

  return Number(clamp(score).toFixed(2));
}

export function confidenceBand(confidence: number):
  | "weak candidate"
  | "candidate"
  | "strongly supported"
  | "strong"
  | "established" {
  if (confidence < 0.4) return "weak candidate";
  if (confidence < 0.7) return "candidate";
  if (confidence < 0.85) return "strongly supported";
  if (confidence < 0.95) return "strong";
  return "established";
}

export function freshnessFactor(lastConfirmedAt: string | undefined, now = new Date()): number {
  if (!lastConfirmedAt) return 0.35;
  const ageDays = Math.max(0, (now.getTime() - new Date(lastConfirmedAt).getTime()) / 86_400_000);
  if (ageDays <= 90) return 1;
  if (ageDays <= 365) return 1 - ((ageDays - 90) / 275) * 0.35;
  if (ageDays <= 730) return 0.65 - ((ageDays - 365) / 365) * 0.3;
  return 0.35;
}

