import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import type { GitHubIdentityProvider, OAuthTransaction } from "../../apps/api/src/auth.js";
import { InMemoryJobDispatcher, InMemoryLoreStore } from "@lore/database/index.js";
import type { GitHubUserIdentity } from "@lore/shared/types.js";

class ConfiguredIdentityProvider implements GitHubIdentityProvider {
  readonly configured = true;

  authorizationUrl(transaction: OAuthTransaction): string {
    return `https://github.example/authorize?state=${encodeURIComponent(transaction.state)}`;
  }

  async authenticate(): Promise<GitHubUserIdentity> {
    return {
      providerUserId: "1",
      login: "boundary-test",
      email: "boundary@example.test",
      name: "Boundary Test",
      profileUrl: "https://github.com/boundary-test"
    };
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

async function productionApp() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("LORE_DEPLOYMENT_MODE", "saas");
  vi.stubEnv("APP_URL", "https://lore.example.com");
  vi.stubEnv("WEB_ORIGIN", "https://lore.example.com");
  vi.stubEnv("SESSION_SECRET", "test-only-request-boundary-secret-over-32-characters");
  return createApp({
    demoMode: false,
    logger: false,
    dependencies: {
      store: new InMemoryLoreStore(),
      jobs: new InMemoryJobDispatcher(),
      githubIdentityProvider: new ConfiguredIdentityProvider()
    }
  });
}

describe("production request boundaries", () => {
  it("rejects an unconfigured Host before routing", async () => {
    const app = await productionApp();
    const response = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { host: "evil.example" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "INVALID_HOST" });
    await app.close();
  });

  it("allows the configured host and internal loopback health probes", async () => {
    const app = await productionApp();
    const publicResponse = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { host: "lore.example.com" }
    });
    const probeResponse = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { host: "127.0.0.1:3001" }
    });
    expect(publicResponse.statusCode).toBe(200);
    expect(probeResponse.statusCode).toBe(200);
    await app.close();
  });

  it("rejects a cross-origin browser request before a public mutation route", async () => {
    const app = await productionApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/demo",
      headers: {
        host: "lore.example.com",
        origin: "https://evil.example"
      }
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "INVALID_ORIGIN" });
    await app.close();
  });

  it("accepts an exact configured Origin and reaches the intended route", async () => {
    const app = await productionApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/demo",
      headers: {
        host: "lore.example.com",
        origin: "https://lore.example.com"
      }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "NOT_AVAILABLE" });
    await app.close();
  });
});
