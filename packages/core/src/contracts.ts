import type {
  AgentSession,
  CandidateRecord,
  ChangeObservation,
  ChangedFile,
  CodeEntity,
  CodeRelationship,
  ContextPackage,
  ContextPackageRecord,
  DashboardSnapshot,
  EvidenceRecord,
  KnowledgeItem,
  KnowledgeProposalRecord,
  PolicyRecord,
  PullRequestImportLimit,
  RepositoryRetentionConfig,
  RegressionRecord,
  RepositorySummary,
  SafetyReport,
  SessionEvent
} from "@lore/shared/types.js";

export interface PullRequestImport {
  externalId: string;
  number: number;
  title: string;
  body: string;
  author: string;
  reviewers: string[];
  reviewComments: Array<{ externalId: string; author: string; body: string; url?: string; occurredAt: string }>;
  commits: string[];
  changedFiles: string[];
  rawDiff?: string;
  mergedAt: string;
  url: string;
}

export interface SourceControlProvider {
  listMergedPullRequests(
    repository: RepositorySummary,
    limit: PullRequestImportLimit
  ): Promise<PullRequestImport[]>;
}

export interface WorkItem {
  reference: string;
  title: string;
  description: string;
  url?: string;
  metadata: Record<string, unknown>;
}

export interface WorkItemProvider {
  getWorkItem(reference: string): Promise<WorkItem | null>;
  searchWorkItems(query: string): Promise<WorkItem[]>;
}

export interface ManualKnowledgeInput {
  repositoryId?: string;
  kind: Exclude<KnowledgeItem["kind"], "policy" | "inference">;
  title: string;
  statement: string;
  rationale: string;
  severity: KnowledgeItem["severity"];
  scope: KnowledgeItem["scope"];
  sourceUrl?: string;
  sourceName?: string;
}

export interface StructuredAIRequest<T> {
  task: string;
  schemaName: string;
  systemInstructions: string;
  applicationInstructions: string;
  untrustedSourceContent: string;
  parse: (value: unknown) => T;
  promptVersion: string;
}

export interface AIProvider {
  generateStructured<T>(request: StructuredAIRequest<T>): Promise<T>;
}

export interface AnalysisResult {
  entities: CodeEntity[];
  relationships: CodeRelationship[];
  diagnostics: Array<{ path: string; message: string; severity: "info" | "warning" | "error" }>;
}

export interface SourceFile {
  repositoryId: string;
  path: string;
  absolutePath: string;
  language: string;
  contentHash: string;
}

export interface LanguageAnalyzer {
  readonly version: string;
  supports(file: SourceFile): boolean;
  analyze(file: SourceFile): Promise<AnalysisResult>;
}

export interface LoreStore {
  health(): Promise<void>;
  validateMembership(organisationId: string, userId: string): Promise<void>;
  getSnapshot(organisationId: string): Promise<DashboardSnapshot>;
  getEvidence(organisationId: string): Promise<EvidenceRecord[]>;
  getRepository(organisationId: string, repositoryId: string): Promise<RepositorySummary>;
  resolveProviderRepository(
    provider: RepositorySummary["provider"],
    providerInstallationId: string,
    providerRepositoryId: string,
    owner: string,
    name: string
  ): Promise<RepositorySummary>;
  getCodeGraph(
    organisationId: string,
    repositoryId: string
  ): Promise<{ entities: CodeEntity[]; relationships: CodeRelationship[] }>;
  getRegressions(organisationId: string, repositoryId: string): Promise<RegressionRecord[]>;
  saveAnalysis(organisationId: string, output: RepositoryAnalysisOutput): Promise<void>;
  saveKnowledgeProposal(
    organisationId: string,
    proposal: Omit<KnowledgeProposalRecord, "id" | "organisationId" | "createdAt">
  ): Promise<KnowledgeProposalRecord>;
  createKnowledgeCandidate(organisationId: string, candidate: CandidateRecord): Promise<CandidateRecord>;
  getCandidate(organisationId: string, candidateId: string): Promise<CandidateRecord>;
  addRepository(
    organisationId: string,
    input: Omit<RepositorySummary, "id" | "organisationId" | "entityCount" | "relationshipCount" | "status">,
    actor?: string
  ): Promise<RepositorySummary>;
  createManualKnowledge(organisationId: string, input: ManualKnowledgeInput, actor: string): Promise<KnowledgeItem>;
  approveCandidate(
    organisationId: string,
    candidateId: string,
    input: { statement?: string; kind?: CandidateRecord["kind"]; scope?: CandidateRecord["scope"]; reason: string },
    actor: string
  ): Promise<KnowledgeItem>;
  rejectCandidate(organisationId: string, candidateId: string, reason: string, actor: string): Promise<void>;
  mergeCandidate(
    organisationId: string,
    candidateId: string,
    targetId: string,
    reason: string,
    actor: string
  ): Promise<KnowledgeItem>;
  deleteRepository(
    organisationId: string,
    repositoryId: string,
    actor: string
  ): Promise<{ deletedId: string; challengedKnowledgeIds: string[] }>;
  updateRepositoryRetention(
    organisationId: string,
    repositoryId: string,
    retentionConfig: RepositoryRetentionConfig,
    actor: string
  ): Promise<RepositorySummary>;
  updateKnowledgeStatus(
    organisationId: string,
    knowledgeId: string,
    status: "challenged" | "archived",
    reason: string,
    actor: string
  ): Promise<KnowledgeItem>;
  createPolicy(
    organisationId: string,
    policy: Omit<PolicyRecord, "id" | "organisationId" | "createdAt" | "updatedAt">,
    actor?: string
  ): Promise<PolicyRecord>;
  createSession(session: AgentSession): Promise<AgentSession>;
  updateSession(organisationId: string, session: AgentSession): Promise<AgentSession>;
  abandonSession(organisationId: string, sessionId: string, reason: string): Promise<AgentSession>;
  getSessionEvents(organisationId: string, sessionId: string): Promise<SessionEvent[]>;
  saveContextPackage(organisationId: string, sessionId: string, context: ContextPackage): Promise<ContextPackageRecord>;
  getLatestContextPackage(organisationId: string, sessionId: string): Promise<ContextPackageRecord | undefined>;
  saveReport(
    organisationId: string,
    report: SafetyReport,
    sessionId?: string,
    contextRevision?: number
  ): Promise<SafetyReport>;
  getChangeObservation(organisationId: string, observationId: string): Promise<ChangeObservation>;
  ingestEvidence(records: EvidenceRecord[]): Promise<number>;
  hasIngestionReceipt(organisationId: string, provider: string, externalId: string): Promise<boolean>;
  saveIngestionReceipt(organisationId: string, provider: string, externalId: string, eventType: string): Promise<void>;
}

export interface GitChangeReader {
  currentCommit(repositoryPath: string): Promise<string>;
  changedFiles(repositoryPath: string, base?: string): Promise<ChangedFile[]>;
}

export interface JobDispatcher {
  health(): Promise<void>;
  dispatch(
    name: "repository.index" | "github.import" | "knowledge.extract" | "knowledge.health",
    payload: Record<string, unknown>,
    idempotencyKey: string
  ): Promise<{ id: string }>;
  close?(): Promise<void>;
}

export interface RepositoryAnalysisOutput {
  repository: RepositorySummary;
  entities: CodeEntity[];
  relationships: CodeRelationship[];
  filesScanned: number;
  filesSkipped: number;
  durationMs: number;
}

export interface RepositoryAnalyzer {
  analyze(repository: RepositorySummary, repositoryPath: string): Promise<RepositoryAnalysisOutput>;
}

export interface PolicyEvaluationInput {
  policies: PolicyRecord[];
  changedFiles: ChangedFile[];
}
