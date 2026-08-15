export type KnowledgeKind =
  | "fact"
  | "decision"
  | "rule"
  | "preference"
  | "inference"
  | "policy"
  | "regression"
  | "warning";

export type KnowledgeStatus =
  | "candidate"
  | "active"
  | "challenged"
  | "superseded"
  | "archived"
  | "rejected";

export type Severity = "info" | "suggestion" | "warning" | "error" | "blocker";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ContextPriority = "mandatory" | "high" | "medium" | "low";

export interface KnowledgeScope {
  organisation?: string;
  repository?: string;
  paths?: string[];
  excludedPaths?: string[];
  symbols?: string[];
  subsystem?: string;
  language?: string;
  framework?: string;
  team?: string;
  reviewer?: string;
  integration?: string;
  ticketType?: string;
}

export interface OrganisationSummary {
  id: string;
  name: string;
  slug: string;
}

export interface RepositoryRetentionConfig {
  retainRawPullRequestDiff: boolean;
  retainSummariesOnly: boolean;
  retainReviewComments: boolean;
  retainCodeSnippets: boolean;
}

export interface RepositorySummary {
  id: string;
  organisationId: string;
  provider: "github" | "gitlab" | "bitbucket" | "local";
  providerRepositoryId?: string;
  providerInstallationId?: string;
  owner: string;
  name: string;
  defaultBranch: string;
  cloneUrl?: string;
  localPath?: string;
  languageSummary: Record<string, number>;
  retentionConfig?: RepositoryRetentionConfig;
  lastIndexedCommit?: string;
  indexedAt?: string;
  entityCount: number;
  relationshipCount: number;
  status: "ready" | "indexing" | "attention" | "disconnected";
}

export interface EvidenceRecord {
  id: string;
  organisationId: string;
  repositoryId?: string;
  type:
    | "pull_request"
    | "review_comment"
    | "commit"
    | "ticket"
    | "code"
    | "documentation"
    | "test_result"
    | "ci_result"
    | "manual_confirmation"
    | "incident";
  provider: string;
  externalId: string;
  url?: string;
  title?: string;
  content: string;
  author?: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

export interface KnowledgeItem {
  id: string;
  organisationId: string;
  repositoryId?: string;
  kind: KnowledgeKind;
  status: KnowledgeStatus;
  title: string;
  statement: string;
  rationale: string;
  confidence: number;
  severity: Severity;
  scope: KnowledgeScope;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastConfirmedAt?: string;
  evidenceIds: string[];
  contradictionCount: number;
  health: "healthy" | "needs_review" | "stale" | "conflicted";
}

export interface ConfidenceFactors {
  supportingObservations: number;
  independentPullRequests: number;
  independentReviewers: number;
  recency: number;
  explicitness: number;
  sourceReliability: number;
  contradictions: number;
  humanConfirmed: boolean;
  scopeStable: boolean;
  codeStillMatches: boolean;
}

export interface CandidateRecord extends KnowledgeItem {
  status: "candidate";
  proposalId?: string;
  evidence: EvidenceRecord[];
  contradictionSummaries: string[];
  confidenceFactors: ConfidenceFactors;
  proposedExclusion?: string;
}

export interface KnowledgeProposalRecord {
  id: string;
  organisationId: string;
  repositoryId?: string;
  operation: "create" | "update" | "supersede" | "challenge" | "merge" | "archive";
  payload: Record<string, unknown>;
  source: string;
  status: "pending" | "auto_accepted" | "approved" | "rejected" | "failed_validation";
  validationErrors: string[];
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface CodeEntity {
  id: string;
  repositoryId: string;
  type:
    | "file"
    | "class"
    | "interface"
    | "trait"
    | "function"
    | "method"
    | "constant"
    | "event"
    | "listener"
    | "service"
    | "repository"
    | "controller"
    | "route"
    | "database_table"
    | "configuration_key"
    | "external_api"
    | "test";
  name: string;
  qualifiedName: string;
  path: string;
  startLine?: number;
  endLine?: number;
  language: string;
  fingerprint: string;
  metadata: Record<string, unknown>;
}

export interface CodeRelationship {
  id: string;
  repositoryId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string;
  confidence: number;
  source: "static_analysis" | "git_history" | "ai_inference" | "manual" | "github" | "jira";
  metadata: Record<string, unknown>;
}

export interface RegressionRecord {
  id: string;
  repositoryId: string;
  title: string;
  description: string;
  introducedByCommit?: string;
  fixedByCommit?: string;
  pullRequestId?: string;
  ticketId?: string;
  affectedEntities: string[];
  evidenceIds: string[];
  severity: Severity;
  createdAt: string;
}

export type PolicyDetector =
  | { type: "forbidden_pattern"; patterns: string[]; message: string }
  | { type: "forbidden_import"; imports: string[]; message: string }
  | { type: "forbidden_path"; paths: string[]; message: string }
  | { type: "required_test"; whenPaths: string[]; testPaths: string[]; message: string }
  | { type: "secret_scan"; patterns: string[]; message: string };

export interface PolicyRecord {
  id: string;
  organisationId: string;
  repositoryId?: string;
  name: string;
  description: string;
  owner: string;
  severity: Severity;
  scope: KnowledgeScope;
  enabled: boolean;
  detector: PolicyDetector;
  createdAt: string;
  updatedAt: string;
}

export interface ContextEntry<T = KnowledgeItem> {
  id: string;
  priority: ContextPriority;
  confidence: number;
  reason: string;
  scope: KnowledgeScope;
  evidence: EvidenceRecord[];
  item: T;
}

export interface ContextPackage {
  id: string;
  task: {
    text: string;
    ticketReferences: string[];
    concepts: string[];
  };
  repository: RepositorySummary;
  candidateFiles: Array<{ path: string; confidence: number; reason: string }>;
  candidateSymbols: Array<{ symbol: string; path: string; confidence: number; reason: string }>;
  affectedAreas: Array<{ name: string; confidence: number; reason: string }>;
  rules: ContextEntry[];
  decisions: ContextEntry[];
  policies: ContextEntry<PolicyRecord>[];
  preferences: ContextEntry[];
  historicalRegressions: ContextEntry<RegressionRecord>[];
  relatedPullRequests: EvidenceRecord[];
  relatedTickets: EvidenceRecord[];
  recommendedTests: Array<{ path: string; confidence: number; reason: string }>;
  unknowns: Array<{ statement: string; reason: string; suggestion: string }>;
  warnings: Array<{ severity: Severity; message: string; reason: string }>;
  generatedAt: string;
}

export interface ContextPackageRecord {
  id: string;
  sessionId: string;
  revision: number;
  payload: ContextPackage;
  createdAt: string;
}

export interface PolicyFinding {
  policyId: string;
  policyName: string;
  severity: Severity;
  path: string;
  line?: number;
  message: string;
  evidence: string;
}

export interface ChangedFile {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  patch?: string;
}

export interface SafetyReport {
  id: string;
  sessionId?: string;
  contextId?: string;
  baseCommit?: string;
  currentCommit?: string;
  task: string;
  repositoryId: string;
  repositoryName: string;
  changedFiles: ChangedFile[];
  changedSymbols: Array<{ name: string; path: string }>;
  affectedCode: Array<{ name: string; path: string; reason: string; confidence: number }>;
  applicablePolicies: PolicyRecord[];
  applicableRules: KnowledgeItem[];
  relevantDecisions: KnowledgeItem[];
  historicalRegressions: RegressionRecord[];
  testsChanged: string[];
  testsRecommended: Array<{ path: string; reason: string }>;
  potentialMissingTests: Array<{ path: string; reason: string }>;
  findings: PolicyFinding[];
  warnings: string[];
  blockers: string[];
  unknowns: string[];
  risk: RiskLevel;
  riskReasons: string[];
  evidenceCount: number;
  createdAt: string;
}

export interface ReviewerProfile {
  id: string;
  name: string;
  providerIdentity: string;
  email?: string;
  preferenceCount: number;
  reinforcedCount: number;
  lastObservedAt: string;
}

export interface AgentSession {
  id: string;
  organisationId: string;
  repositoryId: string;
  task: string;
  status: "preparing" | "active" | "verifying" | "completed" | "abandoned";
  baseCommit?: string;
  currentCommit?: string;
  startedAt: string;
  completedAt?: string;
  agentType: string;
  filesObserved: string[];
  filesChanged: string[];
  warningCount: number;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  sequence: number;
  type: "started" | "context_prepared" | "context_refreshed" | "file_changed" | "verification_started" | "verification_finished" | "completed" | "failed" | "abandoned";
  data: Record<string, unknown>;
  createdAt: string;
}

export interface DashboardSnapshot {
  organisation: OrganisationSummary;
  repositories: RepositorySummary[];
  knowledge: KnowledgeItem[];
  candidates: CandidateRecord[];
  policies: PolicyRecord[];
  reports: SafetyReport[];
  reviewers: ReviewerProfile[];
  sessions: AgentSession[];
}
