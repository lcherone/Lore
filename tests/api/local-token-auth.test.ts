import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import { InMemoryJobDispatcher, InMemoryLoreStore } from "@lore/database/index.js";
import type { GitHubRepositoryOption } from "@lore/github/index.js";
import type { RepositorySummary } from "@lore/shared/types.js";

function responseCookies(response: { headers: Record<string, string | string[] | number | undefined> }): string[] {
  const values = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"]
    : [response.headers["set-cookie"]];
  return values.flatMap((value) => typeof value === "string" ? value.split(/,(?=\s*[^;,]+=)/) : []);
}

function requestCookie(setCookie: string): string {
  return setCookie.split(";", 1)[0]!.trim();
}

const previous = {
  appUrl: process.env.APP_URL,
  deploymentMode: process.env.LORE_DEPLOYMENT_MODE,
  githubToken: process.env.GITHUB_TOKEN,
  githubAuthMode: process.env.GITHUB_AUTH_MODE,
  nodeEnv: process.env.NODE_ENV,
  sessionSecret: process.env.SESSION_SECRET
};

afterEach(() => {
  vi.unstubAllGlobals();
  if (previous.appUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previous.appUrl;
  if (previous.deploymentMode === undefined) delete process.env.LORE_DEPLOYMENT_MODE;
  else process.env.LORE_DEPLOYMENT_MODE = previous.deploymentMode;
  if (previous.githubToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = previous.githubToken;
  if (previous.githubAuthMode === undefined) delete process.env.GITHUB_AUTH_MODE;
  else process.env.GITHUB_AUTH_MODE = previous.githubAuthMode;
  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;
  if (previous.sessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previous.sessionSecret;
});

describe("single-token local product mode", () => {
  it("uses the PAT as the local GitHub identity and automatically schedules repository evidence", async () => {
    process.env.LORE_DEPLOYMENT_MODE = "local";
    process.env.GITHUB_TOKEN = "github_pat_test_token_long_enough_for_lore";
    process.env.NODE_ENV = "production";
    process.env.APP_URL = "http://localhost:5173";
    process.env.SESSION_SECRET = "test-only-local-session-secret-with-more-than-32-characters";
    delete process.env.GITHUB_AUTH_MODE;
    const githubFetch = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/user/emails")) {
        return new Response(JSON.stringify([{ email: "casey@acme.example", primary: true, verified: true }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/user/repos")) {
        return new Response(JSON.stringify([
          {
            id: 73421010,
            name: "soho-home",
            full_name: "D3R/soho-home",
            private: true,
            archived: false,
            default_branch: "master",
            description: "Organisation repository",
            clone_url: "https://github.com/D3R/soho-home.git",
            html_url: "https://github.com/D3R/soho-home",
            owner: { login: "D3R" }
          },
          {
            id: 22,
            name: "personal-repository",
            full_name: "casey-hall/personal-repository",
            private: false,
            archived: false,
            default_branch: "main",
            clone_url: "https://github.com/casey-hall/personal-repository.git",
            html_url: "https://github.com/casey-hall/personal-repository",
            owner: { login: "casey-hall" }
          }
        ]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/user")) {
        return new Response(JSON.stringify({
          id: 1,
          login: "casey-hall",
          name: "Casey Hall",
          email: "casey@acme.example",
          html_url: "https://github.com/casey-hall",
          avatar_url: "https://avatars.example/casey.png",
          bio: "Engineering lead",
          company: "Acme",
          location: "London",
          blog: "https://example.test"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected GitHub request: ${url}`);
    });
    vi.stubGlobal("fetch", githubFetch);

    const store = new InMemoryLoreStore();
    const jobs = new InMemoryJobDispatcher();
    const app = await createApp({ demoMode: false, logger: false, dependencies: { store, jobs } });
    const session = await app.inject({ method: "GET", url: "/api/auth/session" });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({
      authenticated: true,
      githubLoginEnabled: true,
      user: { githubLogin: "casey-hall" },
      activeOrganisation: { id: "org_acme", role: "owner" }
    });

    const discovered = await app.inject({ method: "GET", url: "/api/github/repositories" });
    expect(discovered.statusCode).toBe(200);
    const repositoryOptions = discovered.json<{ items: GitHubRepositoryOption[]; count: number }>();
    expect(repositoryOptions.count).toBe(2);
    expect(repositoryOptions.items.map((repository) => repository.fullName)).toEqual([
      "D3R/soho-home",
      "casey-hall/personal-repository"
    ]);
    expect(repositoryOptions.items[0]).toMatchObject({ private: true, defaultBranch: "master" });
    const repositoryRequest = githubFetch.mock.calls
      .map(([input]) => input instanceof Request ? input.url : String(input))
      .find((url) => url.includes("/user/repos"));
    expect(repositoryRequest).toBeDefined();
    const repositoryQuery = new URL(repositoryRequest!).searchParams;
    expect(repositoryQuery.get("visibility")).toBe("all");
    expect(repositoryQuery.get("affiliation")).toBe("owner,collaborator,organization_member");
    expect(repositoryQuery.get("per_page")).toBe("100");

    const createdOrganisation = await app.inject({
      method: "POST",
      url: "/api/organisations",
      payload: { name: "Personal Experiments", slug: "personal-experiments" }
    });
    expect(createdOrganisation.statusCode).toBe(201);
    expect(String(createdOrganisation.headers["set-cookie"])).not.toContain("Secure");
    const sessionCookie = responseCookies(createdOrganisation)
      .find((value) => value.trim().startsWith("lore_session="));
    expect(sessionCookie).toBeDefined();

    const missingOrigin = await app.inject({
      method: "PATCH",
      url: "/api/account/profile",
      headers: { cookie: requestCookie(sessionCookie!) },
      payload: { name: "Casey Without Origin" }
    });
    expect(missingOrigin.statusCode).toBe(403);
    expect(missingOrigin.json()).toMatchObject({ error: "INVALID_ORIGIN" });

    const missingCsrf = await app.inject({
      method: "PATCH",
      url: "/api/account/profile",
      headers: {
        cookie: requestCookie(sessionCookie!),
        origin: "http://localhost:5173"
      },
      payload: { name: "Casey Without CSRF" }
    });
    expect(missingCsrf.statusCode).toBe(403);
    expect(missingCsrf.json()).toMatchObject({ error: "CSRF_REJECTED" });

    const csrf = await app.inject({
      method: "GET",
      url: "/api/auth/csrf",
      headers: { cookie: requestCookie(sessionCookie!) }
    });
    const csrfBody = csrf.json<{ enabled: boolean; token?: string }>();
    const csrfCookie = responseCookies(csrf)
      .find((value) => !value.trim().startsWith("lore_session="));
    expect(csrfBody.enabled).toBe(true);
    expect(csrfBody.token).toBeTruthy();
    expect(csrfCookie).toBeDefined();

    const protectedMutation = await app.inject({
      method: "PATCH",
      url: "/api/account/profile",
      headers: {
        cookie: `${requestCookie(sessionCookie!)}; ${requestCookie(csrfCookie!)}`,
        origin: "http://localhost:5173",
        "csrf-token": csrfBody.token!
      },
      payload: { name: "Casey With CSRF" }
    });
    expect(protectedMutation.statusCode).toBe(200);
    expect(protectedMutation.json()).toMatchObject({ name: "Casey With CSRF" });

    const connected = await app.inject({
      method: "POST",
      url: "/api/repositories/batch",
      payload: {
        repositories: [
          {
            provider: "github",
            providerRepositoryId: "73421010",
            owner: "D3R",
            name: "soho-home",
            defaultBranch: "master"
          },
          {
            provider: "github",
            providerRepositoryId: "22",
            owner: "casey-hall",
            name: "personal-repository",
            defaultBranch: "main"
          },
          {
            provider: "github",
            providerRepositoryId: "73421010",
            owner: "D3R",
            name: "soho-home",
            defaultBranch: "master"
          }
        ]
      }
    });
    expect(connected.statusCode).toBe(201);
    expect(connected.json()).toMatchObject({
      connected: 2,
      initialImportsQueued: 2,
      skipped: [{ fullName: "D3R/soho-home", reason: "duplicate_request" }]
    });
    expect(connected.json<{ items: RepositorySummary[] }>().items.map((repository) => `${repository.owner}/${repository.name}`)).toEqual([
      "D3R/soho-home",
      "casey-hall/personal-repository"
    ]);
    expect(jobs.jobs.filter((job) =>
      job.name === "github.import" && job.payload.limit === "all" && job.payload.authMode === "token"
    )).toHaveLength(2);
    expect(jobs.schedulers).toHaveLength(2);
    expect(jobs.schedulers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "github.import", everyMs: 3_600_000 })
    ]));
    expect(jobs.schedulers.every((scheduler) => scheduler.payload.limit === 100)).toBe(true);

    const repeated = await app.inject({
      method: "POST",
      url: "/api/repositories/batch",
      payload: {
        repositories: [{
          provider: "github",
          providerRepositoryId: "73421010",
          owner: "D3R",
          name: "soho-home",
          defaultBranch: "master"
        }]
      }
    });
    expect(repeated.statusCode).toBe(201);
    expect(repeated.json()).toMatchObject({
      connected: 0,
      initialImportsQueued: 0,
      skipped: [{ fullName: "D3R/soho-home", reason: "already_connected" }]
    });
    await app.close();
  });
});
