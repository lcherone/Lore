import type {
  ContextPackage,
  DashboardSnapshot,
  KnowledgeItem,
  PolicyRecord,
  PullRequestImportLimit,
  RepositoryRetentionConfig,
  RepositorySummary
} from "@lore/shared/types.js";

export interface GitHubIntegrationStatus {
  mode: "disabled" | "token" | "app" | "demo";
  historicalImportReady: boolean;
  installFlowReady: boolean;
  webhooksReady: boolean;
}

let csrfToken: string | undefined;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(csrfToken && init?.method && init.method !== "GET" ? { "csrf-token": csrfToken } : {}), ...(init?.headers ?? {}) },
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
  session: async (): Promise<{ user: { organisationId: string; userId: string; name: string }; demoMode: boolean }> => {
    const session = await request<{ user: { organisationId: string; userId: string; name: string }; demoMode: boolean }>("/api/auth/session");
    if (!session.demoMode) {
      const csrf = await request<{ enabled: boolean; token?: string }>("/api/auth/csrf");
      csrfToken = csrf.token;
    }
    return session;
  },
  bootstrap: (): Promise<DashboardSnapshot> => request("/api/bootstrap"),
  githubStatus: (): Promise<GitHubIntegrationStatus> => request("/api/github/status"),
  githubInstall: (): Promise<{ url: string }> => request("/api/github/install"),
  prepareTask: (repositoryId: string, task: string): Promise<ContextPackage> =>
    request("/api/tasks/prepare", { method: "POST", body: JSON.stringify({ repositoryId, task }) }),
  approveCandidate: (id: string, input: Record<string, unknown>) =>
    request(`/api/knowledge-candidates/${id}/approve`, { method: "POST", body: JSON.stringify(input) }),
  rejectCandidate: (id: string, reason: string) =>
    request(`/api/knowledge-candidates/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  mergeCandidate: (id: string, targetId: string, reason: string): Promise<KnowledgeItem> =>
    request(`/api/knowledge-candidates/${id}/merge`, { method: "POST", body: JSON.stringify({ targetId, reason }) }),
  createKnowledge: (input: Record<string, unknown>): Promise<KnowledgeItem> =>
    request("/api/knowledge", { method: "POST", body: JSON.stringify(input) }),
  challengeKnowledge: (id: string, reason: string): Promise<KnowledgeItem> =>
    request(`/api/knowledge/${id}/challenge`, { method: "POST", body: JSON.stringify({ reason }) }),
  archiveKnowledge: (id: string, reason: string): Promise<KnowledgeItem> =>
    request(`/api/knowledge/${id}/archive`, { method: "POST", body: JSON.stringify({ reason }) }),
  connectRepository: (input: Record<string, unknown>) =>
    request("/api/repositories", { method: "POST", body: JSON.stringify(input) }),
  indexRepository: (id: string): Promise<{ status: "queued" | "completed"; simulated?: boolean }> => request(`/api/repositories/${id}/index`, { method: "POST" }),
  importHistory: (id: string, limit: PullRequestImportLimit): Promise<{ status: "queued" | "simulated"; simulated?: boolean }> =>
    request(`/api/repositories/${id}/github-import`, { method: "POST", body: JSON.stringify({ limit }) }),
  deleteRepository: (id: string, confirmation: string): Promise<{ deletedId: string; challengedKnowledgeIds: string[] }> =>
    request(`/api/repositories/${id}?confirm=${encodeURIComponent(confirmation)}`, { method: "DELETE" }),
  updateRepositoryRetention: (id: string, retentionConfig: RepositoryRetentionConfig): Promise<RepositorySummary> =>
    request(`/api/repositories/${id}/retention`, { method: "PATCH", body: JSON.stringify(retentionConfig) }),
  createPolicy: (policy: Omit<PolicyRecord, "id" | "organisationId" | "createdAt" | "updatedAt">) =>
    request("/api/policies", { method: "POST", body: JSON.stringify(policy) })
};
