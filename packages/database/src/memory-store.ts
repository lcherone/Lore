import { newUuid } from "@lore/shared/ids.js";
import { createDemoSnapshot, getDemoEvidence } from "@lore/shared/demo-data.js";
import { createDemoCodeGraph } from "@lore/shared/demo-graph.js";
import type {
  AgentSession,
  CandidateRecord,
  CodeEntity,
  CodeRelationship,
  ContextPackage,
  ContextPackageRecord,
  DashboardSnapshot,
  EvidenceRecord,
  KnowledgeItem,
  KnowledgeProposalRecord,
  PolicyRecord,
  RepositoryRetentionConfig,
  RepositorySummary,
  RegressionRecord,
  SafetyReport,
  SessionEvent
} from "@lore/shared/types.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type LoreStore,
  type ManualKnowledgeInput,
  type RepositoryAnalysisOutput
} from "@lore/core/index.js";

export class InMemoryLoreStore implements LoreStore {
  readonly #snapshot: DashboardSnapshot;
  readonly #evidence: EvidenceRecord[];
  readonly #receipts = new Set<string>();
  readonly #proposals: KnowledgeProposalRecord[] = [];
  readonly #contexts = new Map<string, ContextPackageRecord[]>();
  readonly #sessionEvents = new Map<string, SessionEvent[]>();
  readonly #graphs = new Map<string, { entities: CodeEntity[]; relationships: CodeRelationship[]; regressions: RegressionRecord[] }>();

  public constructor(snapshot = createDemoSnapshot(), evidence = getDemoEvidence()) {
    this.#snapshot = structuredClone(snapshot);
    this.#evidence = structuredClone(evidence);
    this.#graphs.set("repo_soho_ecom", createDemoCodeGraph());
  }

  async health(): Promise<void> {}

  async validateMembership(organisationId: string, userId: string): Promise<void> {
    this.#assertOrganisation(organisationId);
    if (userId !== "user_casey" && userId !== "system") throw new ForbiddenError("The current user is not an active organisation member");
  }

  async getSnapshot(organisationId: string): Promise<DashboardSnapshot> {
    this.#assertOrganisation(organisationId);
    return structuredClone(this.#snapshot);
  }

  async getEvidence(organisationId: string): Promise<EvidenceRecord[]> {
    this.#assertOrganisation(organisationId);
    return structuredClone(this.#evidence.filter((record) => record.organisationId === organisationId));
  }

  async getRepository(organisationId: string, repositoryId: string) {
    this.#assertOrganisation(organisationId);
    const repository = this.#snapshot.repositories.find((item) => item.id === repositoryId);
    if (!repository) throw new NotFoundError("Repository", repositoryId);
    return structuredClone(repository);
  }

  async resolveProviderRepository(
    provider: RepositorySummary["provider"],
    providerInstallationId: string,
    providerRepositoryId: string,
    owner: string,
    name: string
  ): Promise<RepositorySummary> {
    const repository = this.#snapshot.repositories.find(
      (item) =>
        item.provider === provider &&
        item.providerInstallationId === providerInstallationId &&
        ((item.providerRepositoryId && item.providerRepositoryId === providerRepositoryId) ||
          (item.owner.toLowerCase() === owner.toLowerCase() && item.name.toLowerCase() === name.toLowerCase()))
    );
    if (!repository) throw new NotFoundError("Provider repository", `${owner}/${name}`);
    return structuredClone(repository);
  }

  async getCodeGraph(organisationId: string, repositoryId: string): Promise<{ entities: CodeEntity[]; relationships: CodeRelationship[] }> {
    await this.getRepository(organisationId, repositoryId);
    const graph = this.#graphs.get(repositoryId) ?? { entities: [], relationships: [], regressions: [] };
    return structuredClone({ entities: graph.entities, relationships: graph.relationships });
  }

  async getRegressions(organisationId: string, repositoryId: string): Promise<RegressionRecord[]> {
    await this.getRepository(organisationId, repositoryId);
    return structuredClone(this.#graphs.get(repositoryId)?.regressions ?? []);
  }

  async saveAnalysis(organisationId: string, output: RepositoryAnalysisOutput): Promise<void> {
    await this.getRepository(organisationId, output.repository.id);
    const current = this.#graphs.get(output.repository.id);
    this.#graphs.set(output.repository.id, {
      entities: structuredClone(output.entities),
      relationships: structuredClone(output.relationships),
      regressions: current?.regressions ?? []
    });
    const index = this.#snapshot.repositories.findIndex((repository) => repository.id === output.repository.id);
    if (index >= 0) this.#snapshot.repositories[index] = structuredClone({ ...output.repository, status: "ready" });
  }

  async saveKnowledgeProposal(
    organisationId: string,
    input: Omit<KnowledgeProposalRecord, "id" | "organisationId" | "createdAt">
  ): Promise<KnowledgeProposalRecord> {
    this.#assertOrganisation(organisationId);
    const proposal: KnowledgeProposalRecord = {
      ...input,
      id: this.createId("proposal"),
      organisationId,
      createdAt: new Date().toISOString()
    };
    this.#proposals.unshift(proposal);
    return structuredClone(proposal);
  }

  async createKnowledgeCandidate(organisationId: string, candidate: CandidateRecord): Promise<CandidateRecord> {
    this.#assertOrganisation(organisationId);
    const duplicate = this.#snapshot.candidates.find((item) => item.id === candidate.id || item.statement === candidate.statement);
    if (duplicate) return structuredClone(duplicate);
    this.#snapshot.candidates.unshift(structuredClone(candidate));
    return structuredClone(candidate);
  }

  async getCandidate(organisationId: string, candidateId: string): Promise<CandidateRecord> {
    this.#assertOrganisation(organisationId);
    const candidate = this.#snapshot.candidates.find((item) => item.id === candidateId);
    if (!candidate) throw new NotFoundError("Knowledge candidate", candidateId);
    return structuredClone(candidate);
  }

  async addRepository(
    organisationId: string,
    input: Omit<RepositorySummary, "id" | "organisationId" | "entityCount" | "relationshipCount" | "status">,
    actor = "system"
  ): Promise<RepositorySummary> {
    void actor;
    this.#assertOrganisation(organisationId);
    const duplicate = this.#snapshot.repositories.find(
      (repository) => repository.owner === input.owner && repository.name === input.name && repository.provider === input.provider
    );
    if (duplicate) throw new ConflictError("Repository is already connected", { repositoryId: duplicate.id });
    const repository: RepositorySummary = {
      ...input,
      id: this.createId("repo"),
      organisationId,
      entityCount: 0,
      relationshipCount: 0,
      status: "attention"
    };
    this.#snapshot.repositories.push(repository);
    return structuredClone(repository);
  }

  async createManualKnowledge(
    organisationId: string,
    input: ManualKnowledgeInput,
    actor: string
  ): Promise<KnowledgeItem> {
    this.#assertOrganisation(organisationId);
    if (input.repositoryId) await this.getRepository(organisationId, input.repositoryId);
    const now = new Date().toISOString();
    const evidenceId = this.createId("evidence");
    this.#evidence.unshift({
      id: evidenceId,
      organisationId,
      ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
      type: "manual_confirmation",
      provider: "lore",
      externalId: evidenceId,
      ...(input.sourceUrl ? { url: input.sourceUrl } : {}),
      title: `Manual confirmation: ${input.title}`,
      content: `${input.statement}\n\nRationale: ${input.rationale}`,
      author: actor,
      occurredAt: now,
      metadata: { humanConfirmed: true, ...(input.sourceName ? { sourceName: input.sourceName } : {}) }
    });
    const item: KnowledgeItem = {
      id: this.createId("knowledge"),
      organisationId,
      ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
      kind: input.kind,
      status: "active",
      title: input.title,
      statement: input.statement,
      rationale: input.rationale,
      confidence: 1,
      severity: input.severity,
      scope: input.scope,
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
      lastConfirmedAt: now,
      evidenceIds: [evidenceId],
      contradictionCount: 0,
      health: "healthy"
    };
    this.#snapshot.knowledge.unshift(item);
    return structuredClone(item);
  }

  async approveCandidate(
    organisationId: string,
    candidateId: string,
    input: { statement?: string; kind?: CandidateRecord["kind"]; scope?: CandidateRecord["scope"]; reason: string },
    actor: string
  ): Promise<KnowledgeItem> {
    const candidate = await this.getCandidate(organisationId, candidateId);
    const index = this.#snapshot.candidates.findIndex((item) => item.id === candidateId);
    if (index < 0) throw new NotFoundError("Knowledge candidate", candidateId);

    const approved: KnowledgeItem = {
      ...candidate,
      statement: input.statement ?? candidate.statement,
      kind: input.kind ?? candidate.kind,
      scope: input.scope ?? candidate.scope,
      status: "active",
      confidence: Math.max(candidate.confidence, 0.86),
      health: "healthy",
      createdBy: actor,
      updatedAt: new Date().toISOString(),
      lastConfirmedAt: new Date().toISOString()
    };
    this.#snapshot.candidates.splice(index, 1);
    this.#snapshot.knowledge.unshift(approved);
    const proposal = candidate.proposalId ? this.#proposals.find((item) => item.id === candidate.proposalId) : undefined;
    if (proposal) {
      proposal.status = "approved";
      proposal.reviewedAt = new Date().toISOString();
      proposal.reviewedBy = actor;
    }
    return structuredClone(approved);
  }

  async rejectCandidate(organisationId: string, candidateId: string, reason: string, actor: string): Promise<void> {
    void reason;
    this.#assertOrganisation(organisationId);
    const index = this.#snapshot.candidates.findIndex((item) => item.id === candidateId);
    if (index < 0) throw new NotFoundError("Knowledge candidate", candidateId);
    const candidate = this.#snapshot.candidates[index]!;
    this.#snapshot.candidates.splice(index, 1);
    const proposal = candidate.proposalId ? this.#proposals.find((item) => item.id === candidate.proposalId) : undefined;
    if (proposal) {
      proposal.status = "rejected";
      proposal.reviewedAt = new Date().toISOString();
      proposal.reviewedBy = actor;
    }
  }

  async mergeCandidate(
    organisationId: string,
    candidateId: string,
    targetId: string,
    reason: string,
    actor: string
  ): Promise<KnowledgeItem> {
    void reason;
    if (candidateId === targetId) throw new ConflictError("A candidate cannot be merged into itself");
    const source = await this.getCandidate(organisationId, candidateId);
    const candidateTarget = this.#snapshot.candidates.find((item) => item.id === targetId);
    const target: KnowledgeItem | undefined = candidateTarget
      ?? this.#snapshot.knowledge.find((item) => item.id === targetId && item.status === "active");
    if (!target) throw new NotFoundError("Merge target", targetId);

    target.evidenceIds = [...new Set([...target.evidenceIds, ...source.evidenceIds])];
    target.confidence = Math.max(target.confidence, source.confidence);
    target.updatedAt = new Date().toISOString();
    if (candidateTarget) {
      candidateTarget.evidence = [...candidateTarget.evidence, ...source.evidence.filter((record) => !candidateTarget.evidence.some((item) => item.id === record.id))];
      candidateTarget.confidenceFactors.supportingObservations = Math.max(
        candidateTarget.confidenceFactors.supportingObservations,
        candidateTarget.evidenceIds.length
      );
    }
    const sourceIndex = this.#snapshot.candidates.findIndex((item) => item.id === candidateId);
    this.#snapshot.candidates.splice(sourceIndex, 1);
    const proposal = source.proposalId ? this.#proposals.find((item) => item.id === source.proposalId) : undefined;
    if (proposal) {
      proposal.status = "approved";
      proposal.reviewedAt = new Date().toISOString();
      proposal.reviewedBy = actor;
    }
    return structuredClone(target);
  }

  async deleteRepository(
    organisationId: string,
    repositoryId: string,
    actor: string
  ): Promise<{ deletedId: string; challengedKnowledgeIds: string[] }> {
    void actor;
    await this.getRepository(organisationId, repositoryId);
    const repositoryEvidenceIds = new Set(
      this.#evidence.filter((record) => record.repositoryId === repositoryId).map((record) => record.id)
    );
    const challengedKnowledgeIds: string[] = [];
    for (const item of this.#snapshot.knowledge) {
      if (!item.repositoryId && item.evidenceIds.some((id) => repositoryEvidenceIds.has(id))) {
        item.status = "challenged";
        item.health = "conflicted";
        item.contradictionCount += 1;
        item.updatedAt = new Date().toISOString();
        challengedKnowledgeIds.push(item.id);
      }
    }

    const removeWhere = <T>(items: T[], predicate: (item: T) => boolean): void => {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (predicate(items[index]!)) items.splice(index, 1);
      }
    };
    removeWhere(this.#snapshot.repositories, (item) => item.id === repositoryId);
    removeWhere(this.#snapshot.knowledge, (item) => item.repositoryId === repositoryId);
    removeWhere(this.#snapshot.candidates, (item) => item.repositoryId === repositoryId);
    removeWhere(this.#snapshot.policies, (item) => item.repositoryId === repositoryId);
    removeWhere(this.#snapshot.sessions, (item) => item.repositoryId === repositoryId);
    removeWhere(this.#snapshot.reports, (item) => item.repositoryId === repositoryId);
    removeWhere(this.#evidence, (item) => item.repositoryId === repositoryId);
    removeWhere(this.#proposals, (item) => item.repositoryId === repositoryId);
    this.#graphs.delete(repositoryId);
    return { deletedId: repositoryId, challengedKnowledgeIds };
  }

  async updateRepositoryRetention(
    organisationId: string,
    repositoryId: string,
    retentionConfig: RepositoryRetentionConfig,
    actor: string
  ): Promise<RepositorySummary> {
    void actor;
    await this.getRepository(organisationId, repositoryId);
    const repository = this.#snapshot.repositories.find((item) => item.id === repositoryId)!;
    repository.retentionConfig = structuredClone(retentionConfig);
    return structuredClone(repository);
  }

  async updateKnowledgeStatus(
    organisationId: string,
    knowledgeId: string,
    status: "challenged" | "archived",
    reason: string,
    actor: string
  ): Promise<KnowledgeItem> {
    void reason;
    void actor;
    this.#assertOrganisation(organisationId);
    const item = this.#snapshot.knowledge.find((knowledge) => knowledge.id === knowledgeId);
    if (!item) throw new NotFoundError("Knowledge item", knowledgeId);
    item.status = status;
    item.updatedAt = new Date().toISOString();
    item.health = status === "challenged" ? "conflicted" : item.health;
    return structuredClone(item);
  }

  async createPolicy(
    organisationId: string,
    input: Omit<PolicyRecord, "id" | "organisationId" | "createdAt" | "updatedAt">,
    actor = "system"
  ): Promise<PolicyRecord> {
    void actor;
    this.#assertOrganisation(organisationId);
    const now = new Date().toISOString();
    const policy: PolicyRecord = { ...input, id: this.createId("policy"), organisationId, createdAt: now, updatedAt: now };
    this.#snapshot.policies.unshift(policy);
    return structuredClone(policy);
  }

  async createSession(session: AgentSession): Promise<AgentSession> {
    this.#assertOrganisation(session.organisationId);
    if (this.#snapshot.sessions.some((item) => item.id === session.id)) {
      throw new ConflictError("Session already exists", { sessionId: session.id });
    }
    this.#snapshot.sessions.unshift(structuredClone(session));
    this.#appendSessionEvent(session.id, "started", { status: session.status, agentType: session.agentType });
    return structuredClone(session);
  }

  async updateSession(organisationId: string, session: AgentSession): Promise<AgentSession> {
    this.#assertOrganisation(organisationId);
    const index = this.#snapshot.sessions.findIndex((item) => item.id === session.id);
    if (index < 0) throw new NotFoundError("Agent session", session.id);
    const previous = this.#snapshot.sessions[index]!;
    if (previous.organisationId !== organisationId) throw new ForbiddenError();
    this.#snapshot.sessions[index] = structuredClone(session);
    if (previous.status !== session.status && session.status === "abandoned") {
      this.#appendSessionEvent(session.id, "abandoned", { previousStatus: previous.status });
    }
    return structuredClone(session);
  }

  async getSessionEvents(organisationId: string, sessionId: string): Promise<SessionEvent[]> {
    this.#assertOrganisation(organisationId);
    if (!this.#snapshot.sessions.some((item) => item.id === sessionId && item.organisationId === organisationId)) {
      throw new NotFoundError("Agent session", sessionId);
    }
    return structuredClone(this.#sessionEvents.get(sessionId) ?? []);
  }

  async abandonSession(organisationId: string, sessionId: string, reason: string): Promise<AgentSession> {
    this.#assertOrganisation(organisationId);
    const session = this.#snapshot.sessions.find((item) => item.id === sessionId && item.organisationId === organisationId);
    if (!session) throw new NotFoundError("Agent session", sessionId);
    if (["completed", "abandoned"].includes(session.status)) throw new ConflictError("Only an open session can be abandoned");
    const previousStatus = session.status;
    session.status = "abandoned";
    session.completedAt = new Date().toISOString();
    this.#appendSessionEvent(sessionId, "abandoned", { previousStatus, reason });
    return structuredClone(session);
  }

  async saveContextPackage(
    organisationId: string,
    sessionId: string,
    context: ContextPackage
  ): Promise<ContextPackageRecord> {
    this.#assertOrganisation(organisationId);
    const session = this.#snapshot.sessions.find((item) => item.id === sessionId && item.organisationId === organisationId);
    if (!session) throw new NotFoundError("Agent session", sessionId);
    if (session.repositoryId !== context.repository.id) throw new ForbiddenError("Context repository does not belong to the session");
    const records = this.#contexts.get(sessionId) ?? [];
    const record: ContextPackageRecord = {
      id: context.id,
      sessionId,
      revision: records.length + 1,
      payload: structuredClone(context),
      createdAt: new Date().toISOString()
    };
    records.push(record);
    this.#contexts.set(sessionId, records);
    session.status = "active";
    session.filesObserved = context.candidateFiles.map((file) => file.path);
    this.#appendSessionEvent(sessionId, record.revision === 1 ? "context_prepared" : "context_refreshed", {
      contextId: context.id,
      revision: record.revision,
      filesObserved: session.filesObserved.length
    });
    return structuredClone(record);
  }

  async getLatestContextPackage(organisationId: string, sessionId: string): Promise<ContextPackageRecord | undefined> {
    this.#assertOrganisation(organisationId);
    const session = this.#snapshot.sessions.find((item) => item.id === sessionId && item.organisationId === organisationId);
    if (!session) throw new NotFoundError("Agent session", sessionId);
    return structuredClone(this.#contexts.get(sessionId)?.at(-1));
  }

  async saveReport(organisationId: string, report: SafetyReport, sessionId?: string): Promise<SafetyReport> {
    this.#assertOrganisation(organisationId);
    const linked = sessionId ? { ...report, sessionId } : report;
    if (sessionId) {
      const session = this.#snapshot.sessions.find((item) => item.id === sessionId && item.organisationId === organisationId);
      if (!session) throw new NotFoundError("Agent session", sessionId);
      if (session.repositoryId !== report.repositoryId) throw new ForbiddenError("Report repository does not belong to the session");
      session.status = "completed";
      session.completedAt = new Date().toISOString();
      session.warningCount = report.warnings.length;
      session.filesChanged = report.changedFiles.map((file) => file.path);
      this.#appendSessionEvent(sessionId, "verification_started", { contextId: report.contextId });
      this.#appendSessionEvent(sessionId, "verification_finished", { reportId: report.id, risk: report.risk });
      this.#appendSessionEvent(sessionId, "completed", { reportId: report.id });
    }
    this.#snapshot.reports.unshift(structuredClone(linked));
    return structuredClone(linked);
  }

  async ingestEvidence(records: EvidenceRecord[]): Promise<number> {
    let added = 0;
    for (const record of records) {
      this.#assertOrganisation(record.organisationId);
      const duplicate = this.#evidence.some(
        (existing) => existing.provider === record.provider && existing.externalId === record.externalId
      );
      if (!duplicate) {
        this.#evidence.push(structuredClone(record));
        added += 1;
      }
    }
    return added;
  }

  async hasIngestionReceipt(organisationId: string, provider: string, externalId: string): Promise<boolean> {
    this.#assertOrganisation(organisationId);
    return this.#receipts.has(`${organisationId}:${provider}:${externalId}`);
  }

  async saveIngestionReceipt(
    organisationId: string,
    provider: string,
    externalId: string,
    eventType: string
  ): Promise<void> {
    void eventType;
    this.#assertOrganisation(organisationId);
    this.#receipts.add(`${organisationId}:${provider}:${externalId}`);
  }

  public createId(prefix: string): string {
    void prefix;
    return newUuid();
  }

  #appendSessionEvent(sessionId: string, type: SessionEvent["type"], data: Record<string, unknown>): void {
    const events = this.#sessionEvents.get(sessionId) ?? [];
    events.push({ id: newUuid(), sessionId, sequence: events.length + 1, type, data, createdAt: new Date().toISOString() });
    this.#sessionEvents.set(sessionId, events);
  }

  #assertOrganisation(organisationId: string): void {
    if (organisationId !== this.#snapshot.organisation.id) throw new ForbiddenError();
  }
}
