import { describe, expect, it } from "vitest";
import { githubIntegrationStatus, resolveGitHubAuthMode } from "@lore/github/index.js";

describe("GitHub authentication mode", () => {
  it("uses an explicit mode and otherwise infers token before app", () => {
    expect(resolveGitHubAuthMode({ GITHUB_AUTH_MODE: "disabled" })).toBe("disabled");
    expect(resolveGitHubAuthMode({ GITHUB_TOKEN_PATH: "/secret/token" })).toBe("token");
    expect(resolveGitHubAuthMode({ GITHUB_TOKEN_FILE: "/host/secret/token" })).toBe("token");
    expect(resolveGitHubAuthMode({ GITHUB_APP_ID: "123" })).toBe("app");
    expect(resolveGitHubAuthMode({})).toBe("disabled");
    expect(() => resolveGitHubAuthMode({ GITHUB_AUTH_MODE: "oauth" })).toThrow(
      "disabled, token, or app"
    );
  });

  it("reports readiness without returning credential values", () => {
    expect(
      githubIntegrationStatus({
        GITHUB_AUTH_MODE: "token",
        GITHUB_TOKEN: "github_pat_secret-value-never-returned"
      })
    ).toEqual({
      mode: "token",
      historicalImportReady: true,
      installFlowReady: false,
      webhooksReady: false
    });
    expect(
      githubIntegrationStatus({
        GITHUB_AUTH_MODE: "app",
        GITHUB_APP_ID: "123",
        GITHUB_APP_SLUG: "lore-local",
        GITHUB_PRIVATE_KEY_PATH: "/secret/key",
        GITHUB_WEBHOOK_SECRET: "secret"
      })
    ).toEqual({
      mode: "app",
      historicalImportReady: true,
      installFlowReady: true,
      webhooksReady: true
    });
    expect(
      githubIntegrationStatus({
        GITHUB_AUTH_MODE: "token",
        GITHUB_TOKEN_FILE: "/host/secret/token"
      })
    ).toMatchObject({ mode: "token", historicalImportReady: true });
  });
});
