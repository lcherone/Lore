import type { KnowledgeExtractionResult } from "@lore/ai/index.js";
import { createKnowledgeEvidenceView } from "@lore/shared/evidence-content.js";
import type { EvidenceRecord } from "@lore/shared/types.js";

type ProposedCandidate = KnowledgeExtractionResult["candidates"][number];

const pullRequestIdentity = (record: EvidenceRecord): string | undefined => {
  const metadataPullRequest = record.metadata.pullRequest;
  if (typeof metadataPullRequest === "string" || typeof metadataPullRequest === "number") {
    return String(metadataPullRequest);
  }
  const externalPullRequest = record.externalId.match(/:pr:(\d+)$/)?.[1];
  return externalPullRequest ?? (record.type === "pull_request" ? record.externalId : undefined);
};

const looksLikePullRequestProcessPolicy = (value: string): boolean => [
  /\bdeployment changelog\b/i,
  /\b(?:pull requests?|prs?)\b.{0,80}\b(?:jira|title|description|link|merge|deploy)\b/i,
  /\bjira tickets?\b.{0,100}\b(?:approved to go live|ready to go live|rtgl|related|status)\b/i,
  /\b(?:code review|emergency change) process\b/i,
  /\bsox\b/i
].some((pattern) => pattern.test(value));

const looksLikeGitActivitySummary = (value: string): boolean => [
  /\b(?:pull requests?|prs?|review comments?)\b/i,
  /\b(?:functional|test) checks?(?:list)?\b/i,
  /\b(?:dependencies|packages)\b.{0,100}\b(?:changed|updated|upgraded)\b/i,
  /\b(?:changed|updated|upgraded)\b.{0,100}\b(?:dependencies|packages)\b/i,
  /\b(?:review approval|approved for staging)\b/i
].some((pattern) => pattern.test(value));

const SINGLE_PULL_REQUEST_SIGNALS: Partial<Record<ProposedCandidate["kind"], RegExp[]>> = {
  decision: [
    /\b(?:we|the team|maintainers?)\s+(?:have\s+)?(?:decided|agreed|chose|selected)\b/i,
    /\bdecision\s*:/i,
    /\b(?:intentional(?:ly)?|by design|deliberately)\b/i
  ],
  rule: [
    /\bmust(?:\s+not)?\b/i,
    /\b(?:is|are) required to\b/i,
    /\brequires?\b/i,
    /\b(?:never|do not|don't|cannot|can't)\b/i,
    /\bonly when\b/i,
    /\bunless\b/i
  ],
  preference: [
    /\bwe prefer\b/i,
    /\bpreferred\b/i,
    /\bpreference\s*:/i,
    /\b(?:our|the) (?:convention|standard)\b/i
  ],
  regression: [
    /\bregression\b/i,
    /\b(?:broke|broken|failed) again\b/i,
    /\b(?:recurred|recurring|previously fixed)\b/i
  ],
  warning: [
    /\b(?:warning|risk|unsafe|danger|data loss|security issue)\b/i,
    /\b(?:must not|never|do not|don't|cannot|can't)\b/i
  ]
};

const hasExplicitSinglePullRequestSignal = (
  kind: ProposedCandidate["kind"],
  evidence: EvidenceRecord[]
): boolean => {
  const patterns = SINGLE_PULL_REQUEST_SIGNALS[kind];
  if (!patterns) return false;
  const authoredSource = evidence
    .map((record) => createKnowledgeEvidenceView(record).text)
    .join("\n");
  return patterns.some((pattern) => pattern.test(authoredSource));
};

export function candidateQualityErrors(
  candidate: ProposedCandidate,
  evidence: EvidenceRecord[]
): string[] {
  const errors: string[] = [];
  const candidateText = `${candidate.title} ${candidate.statement}`;

  if (looksLikePullRequestProcessPolicy(candidateText)) {
    errors.push("Pull-request template and compliance-process rules require an explicitly owned policy; AI extraction cannot promote them into knowledge.");
  }

  if (looksLikeGitActivitySummary(candidateText)) {
    errors.push("Git activity, review outcomes, and reusable test-template summaries are evidence history, not durable engineering knowledge.");
  }

  const githubChangeEvidence = evidence.length > 0 && evidence.every((record) =>
    ["pull_request", "review_comment", "commit", "code"].includes(record.type)
  );
  const independentPullRequests = new Set(
    evidence.map(pullRequestIdentity).filter((value): value is string => Boolean(value))
  ).size;
  if (
    githubChangeEvidence &&
    (candidate.kind === "fact" || candidate.kind === "inference") &&
    independentPullRequests < 2
  ) {
    errors.push("A single Git change cannot establish a durable fact or inference; require corroboration from at least two independent pull requests.");
  }

  if (
    githubChangeEvidence &&
    !["fact", "inference"].includes(candidate.kind) &&
    independentPullRequests < 2 &&
    !hasExplicitSinglePullRequestSignal(candidate.kind, evidence)
  ) {
    errors.push(`A single Git change cannot establish a durable ${candidate.kind} without an explicit authored ${candidate.kind} signal.`);
  }

  return errors;
}
