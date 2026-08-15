export type GitHubAuthMode = "disabled" | "token" | "app";

const present = (environment: NodeJS.ProcessEnv, name: string): boolean =>
  Boolean(environment[name]?.trim());

export function resolveGitHubAuthMode(
  environment: NodeJS.ProcessEnv = process.env
): GitHubAuthMode {
  const configured = environment.GITHUB_AUTH_MODE?.trim().toLowerCase();
  if (configured) {
    if (configured === "disabled" || configured === "token" || configured === "app") {
      return configured;
    }
    throw new Error("GITHUB_AUTH_MODE must be disabled, token, or app");
  }

  if (present(environment, "GITHUB_TOKEN") || present(environment, "GITHUB_TOKEN_PATH")) {
    return "token";
  }
  if (
    [
      "GITHUB_APP_ID",
      "GITHUB_APP_SLUG",
      "GITHUB_PRIVATE_KEY",
      "GITHUB_PRIVATE_KEY_PATH",
      "GITHUB_WEBHOOK_SECRET"
    ].some((name) => present(environment, name))
  ) {
    return "app";
  }
  return "disabled";
}

export function githubIntegrationStatus(
  environment: NodeJS.ProcessEnv = process.env,
  demoMode = false
): {
  mode: GitHubAuthMode | "demo";
  historicalImportReady: boolean;
  installFlowReady: boolean;
  webhooksReady: boolean;
} {
  if (demoMode) {
    return {
      mode: "demo",
      historicalImportReady: true,
      installFlowReady: false,
      webhooksReady: false
    };
  }

  const mode = resolveGitHubAuthMode(environment);
  const tokenReady =
    present(environment, "GITHUB_TOKEN") || present(environment, "GITHUB_TOKEN_PATH");
  const appKeyReady =
    present(environment, "GITHUB_PRIVATE_KEY") ||
    present(environment, "GITHUB_PRIVATE_KEY_PATH");
  return {
    mode,
    historicalImportReady:
      mode === "token"
        ? tokenReady
        : mode === "app"
          ? present(environment, "GITHUB_APP_ID") && appKeyReady
          : false,
    installFlowReady: mode === "app" && present(environment, "GITHUB_APP_SLUG"),
    webhooksReady: mode === "app" && present(environment, "GITHUB_WEBHOOK_SECRET")
  };
}
