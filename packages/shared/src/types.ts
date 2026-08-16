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
export type PullRequestImportLimit = 50 | 100 | 250 | 500 | 1000 | "all";
export type CommunicationSourceType =
  | "slack"
  | "standup"
  | "meeting"
  | "call"
  | "in_person"
  | "email"
  | "note"
  | "other";
export type EvidenceComparisonDisposition =
  | "new"
  | "already_added"
  | "supports_existing"
  | "conflicts";

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
    | "incident"
    | "communication";
  provider: string;
  externalId: string;
  url?: string;
  title?: string;
  content: string;
  author?: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
  contentHash?: string;
}

export interface EvidenceRevisionRecord {
  id: string;
  evidenceId: string;
  version: number;
  contentHash: string;
  url?: string;
  title?: string;
  content: string;
  author?: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type LoreJobName =
  | "repository.index"
  | "github.import"
  | "knowledge.extract"
  | "candidate.triage"
  | "knowledge.health";
export type JobRunState = "queued" | "dispatched" | "running" | "retrying" | "succeeded" | "failed" | "dead_letter";

export interface JobEventRecord {
  id: string;
  jobRunId: string;
  state: JobRunState;
  message?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface JobRunRecord {
  id: string;
  organisationId: string;
  repositoryId?: string;
  name: LoreJobName;
  state: JobRunState;
  idempotencyKey: string;
  externalJobId?: string;
  attempt: number;
  maximumAttempts: number;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
  errorMessage?: string;
  resultSummary?: Record<string, unknown>;
  events?: JobEventRecord[];
}

export interface CandidateComparison {
  disposition: EvidenceComparisonDisposition;
  matchedKnowledgeIds: string[];
  explanation: string;
}

export type CandidateTriageAction = "approve" | "edit" | "merge" | "ignore" | "review";
export type CandidateDurability = "durable" | "situational" | "one_off_change" | "duplicate" | "unclear";
export type CandidatePolicyFit = "not_policy" | "possible_policy";

export interface CandidateTriageRecommendation {
  action: CandidateTriageAction;
  durability: CandidateDurability;
  policyFit: CandidatePolicyFit;
  recommendedKind?: KnowledgeKind;
  recommendedStatement?: string;
  duplicateTargetId?: string;
  confidence: number;
  explanation: string;
  reasons: string[];
  bulkEligibleAction?: "approve" | "ignore";
  method: "deterministic" | "ai";
  source: string;
  promptVersion: string;
  candidateFingerprint: string;
  candidateUpdatedAt: string;
  evidenceCount: number;
  triagedAt: string;
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
  comparison?: CandidateComparison;
  triage?: CandidateTriageRecommendation;
}

export interface CandidateBulkReviewResult {
  action: "approve" | "ignore";
  processedIds: string[];
  approved: KnowledgeItem[];
  skipped: Array<{ id: string; reason: string }>;
}

export interface CommunicationEvidenceInput {
  repositoryId?: string;
  sourceType: CommunicationSourceType;
  title: string;
  content: string;
  participants?: string[];
  occurredAt?: string;
  sourceUrl?: string;
  sourceReference?: string;
  authorityConfirmed: true;
}

export interface CommunicationEvidenceAnalysisItem {
  candidate: CandidateRecord;
  disposition: EvidenceComparisonDisposition;
  matches: Array<Pick<KnowledgeItem, "id" | "title" | "statement" | "status" | "kind">>;
  explanation: string;
}

export interface CommunicationEvidenceAnalysis {
  evidence: EvidenceRecord;
  evidenceAdded: boolean;
  candidates: CommunicationEvidenceAnalysisItem[];
  counts: Record<EvidenceComparisonDisposition, number>;
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

export interface CodeGraphPage<T> {
  items: T[];
  count: number;
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface CodeEntityListQuery {
  search?: string;
  type?: CodeEntity["type"];
  page: number;
  pageSize: number;
}

export type CodeEntityReference = Pick<
  CodeEntity,
  "id" | "type" | "name" | "qualifiedName" | "path" | "startLine" | "endLine" | "language"
>;

export interface CodeRelationshipView extends CodeRelationship {
  sourceEntity: CodeEntityReference;
  targetEntity: CodeEntityReference;
}

export interface CodeRelationshipListQuery {
  search?: string;
  entityId?: string;
  page: number;
  pageSize: number;
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

export interface ChangeObservation {
  id: string;
  organisationId: string;
  repositoryId: string;
  sessionId: string;
  contextId: string;
  contextRevision: number;
  baseCommit?: string;
  currentCommit?: string;
  files: Array<{
    path: string;
    previousPath?: string;
    status: ChangedFile["status"];
    additions: number;
    deletions: number;
    patchHash?: string;
  }>;
  contentHash: string;
  capturedAt: string;
}

export interface SafetyReport {
  id: string;
  sessionId?: string;
  contextId?: string;
  contextRevision?: number;
  observationId?: string;
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

export type OrganisationRole = "owner" | "admin" | "member" | "viewer";

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  githubLogin?: string;
  githubProfileUrl?: string;
  avatarUrl?: string;
  bio?: string;
  company?: string;
  jobTitle?: string;
  location?: string;
  websiteUrl?: string;
  timezone?: string;
  profileEditedAt?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganisationAccess {
  id: string;
  name: string;
  slug: string;
  role: OrganisationRole;
  memberCount: number;
  createdAt: string;
}

export interface OrganisationMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  githubLogin?: string;
  avatarUrl?: string;
  role: OrganisationRole;
  joinedAt: string;
}

export interface OrganisationInvitation {
  id: string;
  organisationId: string;
  organisationName: string;
  email: string;
  role: Exclude<OrganisationRole, "owner">;
  invitedByName: string;
  expiresAt: string;
  createdAt: string;
}

export interface AuthSessionSummary {
  id: string;
  activeOrganisationId?: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface AccountSession {
  authenticated: boolean;
  demoMode: boolean;
  githubLoginEnabled: boolean;
  user?: UserProfile;
  activeOrganisation?: OrganisationAccess;
  organisations: OrganisationAccess[];
  pendingInvitations: OrganisationInvitation[];
}

export type LoreStartPage =
  | "dashboard"
  | "repositories"
  | "knowledge"
  | "evidence"
  | "candidates"
  | "sessions";

export interface UserSettings {
  theme: "system" | "light" | "dark";
  startPage: LoreStartPage;
  defaultImportLimit: PullRequestImportLimit;
  showGettingStarted: boolean;
  notifyImportCompleted: boolean;
  notifyCandidateReview: boolean;
}

export interface OrganisationSettings {
  autoImportGitHub: boolean;
  githubImportLimit: PullRequestImportLimit;
  githubSyncIntervalMinutes: number;
  autoExtractKnowledge: boolean;
  communicationEvidenceEnabled: boolean;
  memberCanConnectRepositories: boolean;
  mcpAccessEnabled: boolean;
  repositoryRetention: RepositoryRetentionConfig;
}

export interface DeploymentConfiguration {
  deploymentMode: "local" | "saas";
  productMode: "demo" | "full";
  appUrl: string;
  loopbackOnly: boolean;
  persistence: "memory" | "postgresql";
  jobs: "memory" | "redis";
  login: { provider: "github"; configured: boolean };
  github: {
    mode: "disabled" | "token" | "app" | "demo";
    historicalImportReady: boolean;
    webhooksReady: boolean;
  };
  ai: { provider: "mock" | "openai"; configured: boolean; model?: string };
  mcp: { transport: "stdio"; serviceBacked: boolean };
}

export interface ApiTokenSummary {
  id: string;
  organisationId: string;
  name: string;
  prefix: string;
  scopes: Array<"read" | "write">;
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt: string;
}

export interface SettingsBundle {
  user: UserSettings;
  organisation: OrganisationSettings;
  deployment: DeploymentConfiguration;
  apiTokens: ApiTokenSummary[];
}

export interface GitHubUserIdentity {
  providerUserId: string;
  login: string;
  email: string;
  name: string;
  avatarUrl?: string;
  profileUrl: string;
  bio?: string;
  company?: string;
  location?: string;
  websiteUrl?: string;
}
