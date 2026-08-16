import type {
  AgentSession,
  ChangedFile,
  CodeEntity,
  CodeRelationship,
  ContextPackage,
  DashboardSnapshot,
  EvidenceRecord,
  SafetyReport
} from "@lore/shared/types.js";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { LocalConfig } from "./local-project.js";

export interface LoreClient {
  snapshot(): Promise<DashboardSnapshot>;
  evidence(): Promise<EvidenceRecord[]>;
  prepareTask(repositoryId: string, task: string, paths?: string[]): Promise<ContextPackage>;
  search(query: string, repositoryId?: string): Promise<Record<string, unknown>>;
  uploadAnalysis(input: {
    repositoryId: string;
    commit?: string;
    indexedAt: string;
    entities: CodeEntity[];
    relationships: CodeRelationship[];
  }): Promise<void>;
  startSession(repositoryId: string, task: string, agentType: string, baseCommit?: string): Promise<{ session: AgentSession; context: ContextPackage }>;
  refreshContext(sessionId: string, paths: string[]): Promise<ContextPackage>;
  verify(sessionId: string, changedFiles: ChangedFile[], currentCommit?: string): Promise<{ session: AgentSession; report: SafetyReport }>;
  abandonSession(sessionId: string, reason: string): Promise<AgentSession>;
}

export class HttpLoreClient implements LoreClient {
  public constructor(private readonly config: LocalConfig, private readonly token = process.env.LORE_API_TOKEN) {}

  async #resolveToken(): Promise<string | undefined> {
    if (this.token?.trim()) return this.token.trim();
    const configuredPath = process.env.LORE_API_TOKEN_FILE?.trim() || this.config.apiTokenFile;
    if (!configuredPath) {
      const hostname = new URL(this.config.apiUrl).hostname;
      if (new Set(["localhost", "127.0.0.1", "::1"]).has(hostname)) return undefined;
      throw new Error("Remote service mode requires LORE_API_TOKEN, LORE_API_TOKEN_FILE, or `lore connect --token-file ...`");
    }
    const path = resolve(configuredPath);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Lore API token path must be a regular non-symlink file: ${path}`);
    if (metadata.size > 16_000) throw new Error("Lore API token file is unexpectedly large");
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
      throw new Error(`Lore API token permissions are too broad; run: chmod 600 ${path}`);
    }
    const value = (await readFile(path, "utf8")).trim();
    if (!value.startsWith("lore_pat_") || value.length < 40 || /\s/.test(value)) {
      throw new Error("Lore API token file does not contain one valid token");
    }
    return value;
  }

  async snapshot(): Promise<DashboardSnapshot> {
    return this.#request("/api/bootstrap");
  }

  async evidence(): Promise<EvidenceRecord[]> {
    return (await this.#request<{ items: EvidenceRecord[] }>("/api/evidence")).items;
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
    const result = await this.#request<Record<string, unknown>>(`/api/search?${parameters.toString()}`);
    return {
      mode: "service",
      organisationId: this.config.organisationId,
      repositoryId: repositoryId ?? this.config.repositoryId,
      ...result
    };
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

  async startSession(
    repositoryId: string,
    task: string,
    agentType: string,
    baseCommit?: string
  ): Promise<{ session: AgentSession; context: ContextPackage }> {
    const session = await this.#request<AgentSession>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ repositoryId, task, agentType, ...(baseCommit ? { baseCommit } : {}) })
    });
    const context = await this.#request<ContextPackage>(`/api/sessions/${session.id}/refresh-context`, { method: "POST" });
    return { session: { ...session, status: "active" }, context };
  }

  async refreshContext(sessionId: string, paths: string[]): Promise<ContextPackage> {
    return this.#request(`/api/sessions/${sessionId}/refresh-context`, {
      method: "POST",
      body: JSON.stringify({ paths })
    });
  }

  async verify(sessionId: string, changedFiles: ChangedFile[], currentCommit?: string): Promise<{ session: AgentSession; report: SafetyReport }> {
    const report = await this.#request<SafetyReport>(`/api/sessions/${sessionId}/verify`, {
      method: "POST",
      body: JSON.stringify({ changedFiles, ...(currentCommit ? { currentCommit } : {}) })
    });
    const session = await this.#request<AgentSession>(`/api/sessions/${sessionId}`);
    return { session, report };
  }

  async abandonSession(sessionId: string, reason: string): Promise<AgentSession> {
    return this.#request(`/api/sessions/${sessionId}/abandon`, { method: "POST", body: JSON.stringify({ reason }) });
  }

  async #request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.#resolveToken();
    const response = await fetch(new URL(path, this.config.apiUrl), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {})
      }
    });
    const body = await response.json().catch(() => ({})) as { message?: string };
    if (!response.ok) throw new Error(body.message ?? `Lore API returned HTTP ${response.status}`);
    return body as T;
  }
}
