import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import type { GitHubIdentityProvider, OAuthTransaction } from "../../apps/api/src/auth.js";
import { InMemoryJobDispatcher, InMemoryLoreStore } from "@lore/database/index.js";
import type { GitHubUserIdentity } from "@lore/shared/types.js";

const originalDemoRequireLogin = process.env.DEMO_REQUIRE_LOGIN;
const originalNodeEnv = process.env.NODE_ENV;
const originalSessionSecret = process.env.SESSION_SECRET;
const originalLocalDevAuth = process.env.LOCAL_DEV_AUTH;
afterEach(() => {
  if (originalDemoRequireLogin == null) delete process.env.DEMO_REQUIRE_LOGIN;
  else process.env.DEMO_REQUIRE_LOGIN = originalDemoRequireLogin;
  if (originalNodeEnv == null) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalSessionSecret == null) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
  if (originalLocalDevAuth == null) delete process.env.LOCAL_DEV_AUTH;
  else process.env.LOCAL_DEV_AUTH = originalLocalDevAuth;
});

function cookie(response: { headers: Record<string, string | string[] | number | undefined> }, name: string): string {
  const values = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"]
    : [response.headers["set-cookie"]];
  const match = values.flatMap((value) => typeof value === "string" ? value.split(/,(?=\s*[^;,]+=)/) : []).find((value) => value.trim().startsWith(`${name}=`));
  if (!match) throw new Error(`Cookie ${name} was not set`);
  return match.split(";", 1)[0]!.trim();
}

class MockGitHubIdentityProvider implements GitHubIdentityProvider {
  readonly configured = true;
  identity: GitHubUserIdentity = {
    providerUserId: "202",
    login: "alex-example",
    email: "alex@example.com",
    name: "Alex Example",
    profileUrl: "https://github.com/alex-example",
    avatarUrl: "https://avatars.example/alex.png",
    bio: "Platform engineer"
  };
  verifier?: string;

  authorizationUrl(transaction: OAuthTransaction): string {
    return `https://github.test/authorize?state=${encodeURIComponent(transaction.state)}`;
  }

  async authenticate(_code: string, verifier: string): Promise<GitHubUserIdentity> {
    this.verifier = verifier;
    return this.identity;
  }
}

describe("GitHub identity, profiles, sessions, and organisations", () => {
  it("refuses unsafe local identity bypasses in production mode", async () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "a-secure-local-production-session-secret-12345";
    process.env.LOCAL_DEV_AUTH = "true";
    await expect(createApp({
      demoMode: false,
      logger: false,
      dependencies: {
        store: new InMemoryLoreStore(),
        jobs: new InMemoryJobDispatcher(),
        githubIdentityProvider: new MockGitHubIdentityProvider()
      }
    })).rejects.toThrow("LOCAL_DEV_AUTH cannot be enabled in production mode");
  });

  it("supports login, private organisation creation, invitations, switching, and role enforcement", async () => {
    process.env.DEMO_REQUIRE_LOGIN = "true";
    const store = new InMemoryLoreStore();
    const provider = new MockGitHubIdentityProvider();
    const app = await createApp({
      demoMode: true,
      logger: false,
      dependencies: { store, jobs: new InMemoryJobDispatcher(), githubIdentityProvider: provider }
    });

    const anonymous = await app.inject({ method: "GET", url: "/api/auth/session" });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.json()).toMatchObject({ authenticated: false, githubLoginEnabled: true });
    expect((await app.inject({ method: "GET", url: "/api/bootstrap" })).statusCode).toBe(401);

    const demoLogin = await app.inject({ method: "POST", url: "/api/auth/demo" });
    const caseyCookie = cookie(demoLogin, "lore_session");
    expect(caseyCookie).not.toContain("org_acme");
    expect(caseyCookie).not.toContain("user_casey");

    const caseySession = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: caseyCookie } });
    expect(caseySession.json()).toMatchObject({
      authenticated: true,
      user: { name: "Casey Hall", email: "casey@acme.example" },
      activeOrganisation: { id: "org_acme", role: "owner" }
    });

    const profile = await app.inject({
      method: "PATCH",
      url: "/api/account/profile",
      headers: { cookie: caseyCookie },
      payload: { name: "Casey H.", jobTitle: "Principal Engineer", timezone: "Europe/London" }
    });
    expect(profile.json()).toMatchObject({ name: "Casey H.", jobTitle: "Principal Engineer", githubLogin: "casey-hall" });

    const created = await app.inject({
      method: "POST",
      url: "/api/organisations",
      headers: { cookie: caseyCookie },
      payload: { name: "Northstar Engineering", slug: "northstar-engineering" }
    });
    expect(created.statusCode).toBe(201);
    const organisationId = created.json<{ id: string }>().id;
    const rotatedCaseyCookie = cookie(created, "lore_session");
    expect((await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie: caseyCookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie: rotatedCaseyCookie } })).json()).toMatchObject({
      organisation: { id: organisationId, name: "Northstar Engineering" }, repositories: []
    });

    const invited = await app.inject({
      method: "POST",
      url: `/api/organisations/${organisationId}/invitations`,
      headers: { cookie: rotatedCaseyCookie },
      payload: { email: "alex@example.com", role: "viewer" }
    });
    expect(invited.statusCode).toBe(201);
    expect(invited.json()).toMatchObject({ email: "alex@example.com", role: "viewer" });
    const invitationId = invited.json<{ id: string }>().id;

    const start = await app.inject({ method: "GET", url: "/api/auth/github?returnTo=%2F%23organisations" });
    expect(start.statusCode).toBe(302);
    const oauthCookie = cookie(start, "lore_github_oauth");
    const state = new URL(String(start.headers.location)).searchParams.get("state")!;
    const callback = await app.inject({
      method: "GET",
      url: `/api/auth/github/callback?code=temporary-code&state=${encodeURIComponent(state)}`,
      headers: { cookie: oauthCookie }
    });
    expect(callback.statusCode).toBe(302);
    expect(provider.verifier?.length).toBeGreaterThan(40);
    const alexCookie = cookie(callback, "lore_session");
    const alexSession = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: alexCookie } });
    expect(alexSession.json()).toMatchObject({
      user: { email: "alex@example.com", name: "Alex Example", bio: "Platform engineer" },
      pendingInvitations: [{ id: invitationId, organisationId }]
    });

    const accepted = await app.inject({
      method: "POST",
      url: `/api/invitations/${invitationId}/accept`,
      headers: { cookie: alexCookie }
    });
    expect(accepted.json()).toMatchObject({ id: organisationId, role: "viewer" });
    const viewerCookie = cookie(accepted, "lore_session");
    const viewerWrite = await app.inject({
      method: "POST",
      url: "/api/knowledge",
      headers: { cookie: viewerCookie },
      payload: {
        kind: "fact", title: "Should not save", statement: "Viewer writes must be rejected.",
        rationale: "Role boundary", severity: "info", scope: {}
      }
    });
    expect(viewerWrite.statusCode).toBe(403);
    expect(viewerWrite.json()).toMatchObject({ message: "Viewer access is read-only" });

    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: viewerCookie } });
    expect(logout.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: viewerCookie } })).json()).toMatchObject({ authenticated: false });
    await app.close();
  });
});
