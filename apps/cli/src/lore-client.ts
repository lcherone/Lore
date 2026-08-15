import type {
  AgentSession,
  ChangedFile,
  CodeEntity,
  CodeRelationship,
  ContextPackage,
  DashboardSnapshot,
  SafetyReport
} from "@lore/shared/types.js";
import type { LocalConfig } from "./local-project.js";

export interface LoreClient {
  snapshot(): Promise<DashboardSnapshot>;
  prepareTask(repositoryId: string, task: string, paths?: string[]): Promise<ContextPackage>;
  search(query: string, repositoryId?: string): Promise<Record<string, unknown>>;
  uploadAnalysis(input: {
    repositoryId: string;
    commit?: string;
    indexedAt: string;
    entities: CodeEntity[];
    relationships: CodeRelationship[];
  }): Promise<void>;
  verify(repositoryId: string, task: string, changedFiles: ChangedFile[], baseCommit?: string): Promise<{ session: AgentSession; report: SafetyReport }>;
}

export class HttpLoreClient implements LoreClient {
  public constructor(private readonly config: LocalConfig, private readonly token = process.env.LORE_API_TOKEN) {}

  async snapshot(): Promise<DashboardSnapshot> {
    return this.#request("/api/bootstrap");
  }

  async prepareTask(repositoryId: string, task: string, paths?: string[]): Promise<ContextPackage> {
    return this.#request("/api/tasks/prepare", {
      method: "POST",
      body: JSON.stringify({ repositoryId, task, ...(paths ? { paths } : {}) })
    });
  }

  async search(query: string, repositoryId?: string): Promise<Record<string, unknown>> {
    const parameters = new URLSearchParams({ q: query });
    if (repositoryId) parameters.set("repositoryId", repositoryId);
    return this.#request(`/api/search?${parameters.toString()}`);
  }

  async uploadAnalysis(input: {
    repositoryId: string;
    commit?: string;
    indexedAt: string;
    entities: CodeEntity[];
    relationships: CodeRelationship[];
  }): Promise<void> {
    await this.#request(`/api/repositories/${input.repositoryId}/analysis`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  }

  async verify(
    repositoryId: string,
    task: string,
    changedFiles: ChangedFile[],
    baseCommit?: string
  ): Promise<{ session: AgentSession; report: SafetyReport }> {
    const session = await this.#request<AgentSession>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ repositoryId, task, agentType: "other", ...(baseCommit ? { baseCommit } : {}) })
    });
    await this.#request(`/api/sessions/${session.id}/refresh-context`, { method: "POST" });
    const report = await this.#request<SafetyReport>(`/api/sessions/${session.id}/verify`, {
      method: "POST",
      body: JSON.stringify({ changedFiles })
    });
    return { session, report };
  }

  async #request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, this.config.apiUrl), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(init?.headers ?? {})
      }
    });
    const body = await response.json().catch(() => ({})) as { message?: string };
    if (!response.ok) throw new Error(body.message ?? `Lore API returned HTTP ${response.status}`);
    return body as T;
  }
}
