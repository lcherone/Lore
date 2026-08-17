import type {
  AccountSession,
  AgentSession,
  AuthSessionSummary,
  CandidateBulkReviewResult,
  CandidateRecord,
  CodeEntity,
  CodeGraphPage,
  CodeRelationshipView,
  CommunicationEvidenceAnalysis,
  CommunicationEvidenceInput,
  ContextPackage,
  DashboardSnapshot,
  EvidenceRecord,
  KnowledgeItem,
  JobRunRecord,
  OrganisationAccess,
  OrganisationInvitation,
  OrganisationMember,
  OrganisationSettings,
  OrganisationRole,
  PolicyRecord,
  PullRequestImportLimit,
  RepositoryRetentionConfig,
  RepositorySummary,
  SessionEvent,
  SettingsBundle,
  UserSettings,
  UserProfile
} from "@lore/shared/types.js";

export interface GitHubIntegrationStatus {
  mode: "disabled" | "token" | "app" | "demo";
  historicalImportReady: boolean;
  installFlowReady: boolean;
  webhooksReady: boolean;
}

export interface GitHubRepositoryOption {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
  description?: string;
  cloneUrl: string;
  htmlUrl: string;
}

export interface OrganisationDetails {
  organisation: OrganisationAccess;
  members: OrganisationMember[];
  invitations: OrganisationInvitation[];
}

export interface RepositoryBatchConnectionResult {
  items: Array<RepositorySummary & { initialImportQueued: boolean }>;
  connected: number;
  skipped: Array<{ fullName: string; reason: "already_connected" | "duplicate_request" }>;
  initialImportsQueued: number;
}

let csrfToken: string | undefined;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(csrfToken && init?.method && init.method !== "GET" ? { "csrf-token": csrfToken } : {}),
      ...(init?.headers ?? {})
    },
    ...init
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Lore API returned ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const loreApi = {
  session: async (): Promise<AccountSession> => {
    const session = await request<AccountSession>("/api/auth/session");
    if (session.authenticated && !session.demoMode) {
      const csrf = await request<{ enabled: boolean; token?: string }>("/api/auth/csrf");
      csrfToken = csrf.token;
    }
    return session;
  },
  demoLogin: (): Promise<{ ok: boolean }> => request("/api/auth/demo", { method: "POST" }),
  logout: (): Promise<void> => request("/api/auth/logout", { method: "POST" }),
  profile: (): Promise<UserProfile> => request("/api/account/profile"),
  updateProfile: (input: Partial<Pick<UserProfile, "name" | "bio" | "company" | "jobTitle" | "location" | "websiteUrl" | "timezone">>): Promise<UserProfile> =>
    request("/api/account/profile", { method: "PATCH", body: JSON.stringify(input) }),
  authSessions: (): Promise<{ items: AuthSessionSummary[] }> => request("/api/auth/sessions"),
  revokeOtherSessions: (): Promise<{ revoked: number }> => request("/api/auth/sessions/others", { method: "DELETE" }),
  organisations: (): Promise<{ items: OrganisationAccess[] }> => request("/api/organisations"),
  organisation: (id: string): Promise<OrganisationDetails> => request(`/api/organisations/${id}`),
  createOrganisation: (input: { name: string; slug: string }): Promise<OrganisationAccess> =>
    request("/api/organisations", { method: "POST", body: JSON.stringify(input) }),
  updateOrganisation: (id: string, input: { name?: string; slug?: string }): Promise<OrganisationAccess> =>
    request(`/api/organisations/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  switchOrganisation: (id: string): Promise<{ activeOrganisationId: string }> =>
    request(`/api/organisations/${id}/switch`, { method: "POST" }),
  inviteMember: (id: string, input: { email: string; role: Exclude<OrganisationRole, "owner"> }): Promise<OrganisationInvitation & { inviteUrl: string }> =>
    request(`/api/organisations/${id}/invitations`, { method: "POST", body: JSON.stringify(input) }),
  revokeInvitation: (organisationId: string, invitationId: string): Promise<void> =>
    request(`/api/organisations/${organisationId}/invitations/${invitationId}`, { method: "DELETE" }),
  acceptInvitation: (id: string): Promise<OrganisationAccess> => request(`/api/invitations/${id}/accept`, { method: "POST" }),
  updateMemberRole: (organisationId: string, userId: string, role: Exclude<OrganisationRole, "owner">): Promise<OrganisationMember> =>
    request(`/api/organisations/${organisationId}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  removeMember: (organisationId: string, userId: string): Promise<void> =>
    request(`/api/organisations/${organisationId}/members/${userId}`, { method: "DELETE" }),
  bootstrap: (): Promise<DashboardSnapshot> => request("/api/bootstrap"),
  jobs: (limit = 100): Promise<{ items: JobRunRecord[]; count: number }> => request(`/api/jobs?limit=${limit}`),
  githubStatus: (): Promise<GitHubIntegrationStatus> => request("/api/github/status"),
  githubRepositories: (): Promise<{ items: GitHubRepositoryOption[]; count: number }> => request("/api/github/repositories"),
  settings: (): Promise<SettingsBundle> => request("/api/settings"),
  updateUserSettings: (input: UserSettings): Promise<UserSettings> =>
    request("/api/settings/user", { method: "PATCH", body: JSON.stringify(input) }),
  updateOrganisationSettings: (input: OrganisationSettings): Promise<OrganisationSettings> =>
    request("/api/settings/organisation", { method: "PATCH", body: JSON.stringify(input) }),
  createApiToken: (input: { name: string; expiresInDays: 30 | 90 | 365 }): Promise<{ item: SettingsBundle["apiTokens"][number]; token: string }> =>
    request("/api/account/tokens", { method: "POST", body: JSON.stringify(input) }),
  revokeApiToken: (id: string): Promise<void> => request(`/api/account/tokens/${id}`, { method: "DELETE" }),
  githubInstall: (): Promise<{ url: string }> => request("/api/github/install"),
  prepareTask: (repositoryId: string, task: string): Promise<ContextPackage> =>
    request("/api/tasks/prepare", { method: "POST", body: JSON.stringify({ repositoryId, task }) }),
  approveCandidate: (id: string, input: Record<string, unknown>) =>
    request(`/api/knowledge-candidates/${id}/approve`, { method: "POST", body: JSON.stringify(input) }),
  getCandidate: (id: string): Promise<CandidateRecord> =>
    request(`/api/knowledge-candidates/${id}`),
  rejectCandidate: (id: string, reason: string) =>
    request(`/api/knowledge-candidates/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  mergeCandidate: (id: string, targetId: string, reason: string): Promise<KnowledgeItem> =>
    request(`/api/knowledge-candidates/${id}/merge`, { method: "POST", body: JSON.stringify({ targetId, reason }) }),
  triageCandidates: (
    candidateIds?: string[],
    force = false
  ): Promise<{
    status: "queued" | "dispatch_pending" | "completed" | "up_to_date";
    queued: number;
    skippedFresh?: number;
    jobId?: string;
  }> =>
    request("/api/knowledge-candidates/triage", {
      method: "POST",
      body: JSON.stringify({ ...(candidateIds?.length ? { candidateIds } : {}), force })
    }),
  bulkReviewCandidates: (
    action: "approve" | "ignore",
    candidateIds: string[],
    reason: string
  ): Promise<CandidateBulkReviewResult> =>
    request("/api/knowledge-candidates/bulk-review", {
      method: "POST",
      body: JSON.stringify({
        action,
        candidateIds,
        confirmationCount: candidateIds.length,
        reason
      })
    }),
  createKnowledge: (input: Record<string, unknown>): Promise<KnowledgeItem> =>
    request("/api/knowledge", { method: "POST", body: JSON.stringify(input) }),
  challengeKnowledge: (id: string, reason: string): Promise<KnowledgeItem> =>
    request(`/api/knowledge/${id}/challenge`, { method: "POST", body: JSON.stringify({ reason }) }),
  archiveKnowledge: (id: string, reason: string): Promise<KnowledgeItem> =>
    request(`/api/knowledge/${id}/archive`, { method: "POST", body: JSON.stringify({ reason }) }),
  connectRepository: (input: Record<string, unknown>) =>
    request("/api/repositories", { method: "POST", body: JSON.stringify(input) }),
  connectRepositories: (repositories: Array<Record<string, unknown>>): Promise<RepositoryBatchConnectionResult> =>
    request("/api/repositories/batch", { method: "POST", body: JSON.stringify({ repositories }) }),
  importHistory: (id: string, limit: PullRequestImportLimit): Promise<{ status: "queued" | "dispatch_pending" | "already_running" | "simulated"; simulated?: boolean; alreadyRunning?: boolean }> =>
    request(`/api/repositories/${id}/github-import`, { method: "POST", body: JSON.stringify({ limit }) }),
  extractRepositoryEvidence: (id: string): Promise<{ status: "queued" | "simulated"; evidenceQueued: number; batchesQueued: number }> =>
    request(`/api/repositories/${id}/knowledge-extraction`, { method: "POST", body: JSON.stringify({}) }),
  agentSession: (id: string): Promise<AgentSession> => request(`/api/sessions/${id}`),
  agentSessionEvents: (id: string): Promise<{ items: SessionEvent[] }> =>
    request(`/api/sessions/${id}/events`),
  repositoryEntities: (
    id: string,
    input: { search?: string; type?: CodeEntity["type"]; page?: number; pageSize?: number }
  ): Promise<CodeGraphPage<CodeEntity>> => {
    const query = new URLSearchParams();
    if (input.search) query.set("search", input.search);
    if (input.type) query.set("type", input.type);
    query.set("page", String(input.page ?? 1));
    query.set("pageSize", String(input.pageSize ?? 50));
    return request(`/api/repositories/${id}/entities?${query}`);
  },
  repositoryRelationships: (
    id: string,
    input: { search?: string; entityId?: string; page?: number; pageSize?: number }
  ): Promise<CodeGraphPage<CodeRelationshipView>> => {
    const query = new URLSearchParams();
    if (input.search) query.set("search", input.search);
    if (input.entityId) query.set("entityId", input.entityId);
    query.set("page", String(input.page ?? 1));
    query.set("pageSize", String(input.pageSize ?? 50));
    return request(`/api/repositories/${id}/relationships?${query}`);
  },
  deleteRepository: (id: string, confirmation: string): Promise<{ deletedId: string; challengedKnowledgeIds: string[] }> =>
    request(`/api/repositories/${id}?confirm=${encodeURIComponent(confirmation)}`, { method: "DELETE" }),
  updateRepositoryRetention: (id: string, retentionConfig: RepositoryRetentionConfig): Promise<RepositorySummary> =>
    request(`/api/repositories/${id}/retention`, { method: "PATCH", body: JSON.stringify(retentionConfig) }),
  createPolicy: (policy: Omit<PolicyRecord, "id" | "organisationId" | "createdAt" | "updatedAt">) =>
    request("/api/policies", { method: "POST", body: JSON.stringify(policy) }),
  analyseCommunication: (input: CommunicationEvidenceInput): Promise<CommunicationEvidenceAnalysis> =>
    request("/api/evidence/communications", { method: "POST", body: JSON.stringify(input) }),
  listCommunicationEvidence: (): Promise<{ items: EvidenceRecord[]; count: number; total: number; truncated: boolean }> =>
    request("/api/evidence?type=communication&limit=50")
};
