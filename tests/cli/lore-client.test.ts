import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpLoreClient } from "../../apps/cli/src/lore-client.js";
import type { LocalConfig } from "../../apps/cli/src/local-project.js";

const config: LocalConfig = {
  repositoryId: "repository-1",
  organisationId: "organisation-1",
  organisation: "test",
  repository: "owner/repository",
  mode: "service",
  defaultAgent: "codex",
  apiUrl: "http://127.0.0.1:3001",
  tests: {}
};

afterEach(() => vi.unstubAllGlobals());

describe("HTTP Lore client", () => {
  it("sends an explicit JSON object when preparing a new session context", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init?: RequestInit) => {
      requests.push({ url: url.toString(), init });
      if (requests.length === 1) {
        return new Response(JSON.stringify({
          id: "session-1",
          organisationId: "organisation-1",
          repositoryId: "repository-1",
          task: "Test task",
          status: "preparing",
          startedAt: "2026-08-17T10:00:00.000Z",
          agentType: "codex",
          filesObserved: [],
          filesChanged: [],
          warningCount: 0
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ id: "context-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }));

    await new HttpLoreClient(config).startSession("repository-1", "Test task", "codex");

    expect(requests[1]).toMatchObject({
      url: "http://127.0.0.1:3001/api/sessions/session-1/refresh-context",
      init: { method: "POST", body: "{}" }
    });
  });
});
