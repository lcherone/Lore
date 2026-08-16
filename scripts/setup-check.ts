import "dotenv/config";

const docker = process.argv.includes("--docker");
const requireGitHub = process.argv.includes("--github");
const requireAI = process.argv.includes("--ai");
const deploymentMode = process.env.LORE_DEPLOYMENT_MODE === "saas" ? "saas" : "local";
const demo = !docker && process.env.DEMO_MODE === "true";
const errors: string[] = [];
const warnings: string[] = [];
const ok: string[] = [];
const present = (name: string): boolean => Boolean(process.env[name]?.trim());

const githubRequestsPerHour = process.env.GITHUB_REQUESTS_PER_HOUR?.trim();
if (githubRequestsPerHour) {
  const parsed = Number(githubRequestsPerHour);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 15_000) {
    errors.push("GITHUB_REQUESTS_PER_HOUR must be an integer between 1 and 15000.");
  } else {
    ok.push(`GitHub crawler: capped at ${parsed.toLocaleString("en-GB")} requests/hour before header-based slowdown.`);
  }
} else {
  ok.push("GitHub crawler: safe default of 1,000 requests/hour plus header-based slowdown.");
}

if (demo) {
  ok.push("Runtime: seeded demo; credentials and persistent services are optional.");
} else {
  ok.push(`Runtime: full ${deploymentMode} product; accounts, organisations, evidence, AI, and MCP remain available.`);
  if (!docker) {
    for (const name of ["DATABASE_URL", "REDIS_URL"] as const) {
      if (!present(name)) errors.push(`${name} is required for native persistent mode.`);
    }
  }
}

const sessionSecret = process.env.SESSION_SECRET?.trim() ?? "";
if (sessionSecret.length < 32 || sessionSecret.startsWith("replace-with")) {
  (demo ? warnings : errors).push("SESSION_SECRET must be a non-placeholder random value of at least 32 characters.");
} else {
  ok.push("Session secret: configured (value hidden).");
}

if (deploymentMode === "local") {
  if (!demo && !present("GITHUB_TOKEN")) {
    errors.push("GITHUB_TOKEN is the only required local GitHub setting. Add a PAT that can read the repositories you want Lore to index.");
  } else if (present("GITHUB_TOKEN")) {
    ok.push("GitHub: one local PAT will provide profile identity, repository discovery, and PR evidence (value hidden).");
  }
  const advanced = [
    "GITHUB_AUTH_MODE", "GITHUB_TOKEN_PATH", "GITHUB_TOKEN_FILE", "GITHUB_OAUTH_CLIENT_ID",
    "GITHUB_OAUTH_CLIENT_SECRET", "GITHUB_OAUTH_CALLBACK_URL", "GITHUB_APP_ID", "GITHUB_APP_SLUG",
    "GITHUB_PRIVATE_KEY", "GITHUB_PRIVATE_KEY_PATH", "GITHUB_PRIVATE_KEY_FILE", "GITHUB_WEBHOOK_SECRET",
    "LOCAL_DEV_AUTH", "LOCAL_ORGANISATION_ID", "LOCAL_USER_ID", "LOCAL_USER_NAME"
  ].filter(present);
  if (advanced.length) {
    warnings.push(`Local mode does not require these advanced/SaaS settings: ${advanced.join(", ")}. They can be removed from .env.`);
  }
} else {
  for (const name of ["GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET", "GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_PRIVATE_KEY", "GITHUB_WEBHOOK_SECRET"] as const) {
    if (!present(name)) errors.push(`${name} is required in SaaS mode.`);
  }
  if (present("GITHUB_OAUTH_CALLBACK_URL")) {
    try {
      const callback = new URL(process.env.GITHUB_OAUTH_CALLBACK_URL!);
      if (callback.pathname !== "/api/auth/github/callback") errors.push("GITHUB_OAUTH_CALLBACK_URL must end with /api/auth/github/callback.");
    } catch { errors.push("GITHUB_OAUTH_CALLBACK_URL must be an absolute URL."); }
  }
  ok.push("GitHub: SaaS OAuth identity and App installation configuration checked (secrets hidden).");
}

if (requireGitHub && !present("GITHUB_TOKEN") && deploymentMode === "local") {
  errors.push("Live GitHub repository discovery needs GITHUB_TOKEN.");
}

const aiProvider = process.env.AI_PROVIDER?.trim().toLowerCase()
  || (present("OPENAI_API_KEY") ? "openai" : "mock");
if (aiProvider === "openai") {
  if (!present("OPENAI_API_KEY")) errors.push("AI_PROVIDER=openai requires OPENAI_API_KEY.");
  else ok.push(`AI: OpenAI Responses API configured with ${process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini"} (key hidden).`);
} else if (aiProvider === "mock") {
  if (!demo && requireAI) errors.push("Full AI verification requires AI_PROVIDER=openai and OPENAI_API_KEY.");
  else if (present("OPENAI_API_KEY")) warnings.push("OPENAI_API_KEY is present but AI_PROVIDER=mock, so the key will not be used.");
  else warnings.push("AI: deterministic mock provider is active.");
} else {
  errors.push("AI_PROVIDER must be openai or mock.");
}

for (const message of ok) process.stdout.write(`✓ ${message}\n`);
for (const message of warnings) process.stdout.write(`! ${message}\n`);
for (const message of errors) process.stderr.write(`✗ ${message}\n`);
process.stdout.write(`\n${errors.length ? "Setup needs attention" : "Setup is ready"}: ${errors.length} error(s), ${warnings.length} warning(s).\n`);
if (errors.length) process.exitCode = 1;
