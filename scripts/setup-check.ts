import "dotenv/config";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

const docker = process.argv.includes("--docker");
const demo = process.env.DEMO_MODE !== "false";
const errors: string[] = [];
const warnings: string[] = [];
const ok: string[] = [];
const present = (name: string): boolean => Boolean(process.env[name]?.trim());

async function checkSecretFile(variable: string, label: string): Promise<void> {
  const configuredPath = process.env[variable]?.trim();
  if (!configuredPath) return;
  try {
    const metadata = await lstat(resolve(configuredPath));
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      errors.push(`${label} must be a regular, non-symlink file.`);
      return;
    }
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
      errors.push(`${label} permissions are too broad; run chmod 600 on the file.`);
      return;
    }
    ok.push(`${label}: found with restricted permissions (contents hidden).`);
  } catch {
    errors.push(`${label} does not exist.`);
  }
}

if (demo) {
  ok.push("Runtime: demo mode; PostgreSQL, Redis, and GitHub credentials are optional.");
} else if (docker) {
  ok.push(
    "Runtime: persistent Docker mode; Compose supplies internal PostgreSQL, Redis, and local-auth values."
  );
} else {
  for (const name of [
    "DATABASE_URL",
    "REDIS_URL",
    "LOCAL_ORGANISATION_ID",
    "LOCAL_USER_ID"
  ] as const) {
    if (!present(name)) errors.push(`${name} is required for native persistent mode.`);
  }
  if (process.env.LOCAL_DEV_AUTH !== "true") {
    errors.push("LOCAL_DEV_AUTH=true is required for the bundled native local login.");
  }
  ok.push("Runtime: native persistent mode.");
}

const sessionSecret = process.env.SESSION_SECRET?.trim() ?? "";
if (sessionSecret.length < 32 || sessionSecret.startsWith("replace-with")) {
  (demo ? warnings : errors).push(
    "SESSION_SECRET should be a non-placeholder random value of at least 32 characters."
  );
} else {
  ok.push("Session secret: configured (value hidden).");
}

const configuredMode = process.env.GITHUB_AUTH_MODE?.trim().toLowerCase();
const inferredMode =
  present("GITHUB_TOKEN") || present("GITHUB_TOKEN_PATH") || present("GITHUB_TOKEN_FILE")
    ? "token"
    : [
          "GITHUB_APP_ID",
          "GITHUB_APP_SLUG",
          "GITHUB_PRIVATE_KEY",
          "GITHUB_PRIVATE_KEY_PATH",
          "GITHUB_PRIVATE_KEY_FILE",
          "GITHUB_WEBHOOK_SECRET"
        ].some(present)
      ? "app"
      : "disabled";
const githubMode = configuredMode || inferredMode;

if (!new Set(["disabled", "token", "app"]).has(githubMode)) {
  errors.push("GITHUB_AUTH_MODE must be disabled, token, or app.");
} else if (githubMode === "disabled") {
  ok.push("GitHub: disabled; this is valid for demo and checkout-only workflows.");
} else if (githubMode === "token") {
  const fileVariable = docker ? "GITHUB_TOKEN_FILE" : "GITHUB_TOKEN_PATH";
  if (!present("GITHUB_TOKEN") && !present(fileVariable)) {
    errors.push(`GITHUB_TOKEN or ${fileVariable} is required for token mode.`);
  }
  await checkSecretFile(fileVariable, "GitHub token file");
  ok.push("GitHub authentication: local personal access token mode.");
  warnings.push(
    "PAT mode imports history on demand but does not receive live GitHub webhooks; use App mode for that."
  );
} else if (githubMode === "app") {
  for (const name of ["GITHUB_APP_ID", "GITHUB_APP_SLUG"] as const) {
    if (!present(name)) errors.push(`${name} is required in GitHub App mode.`);
  }
  const fileVariable = docker ? "GITHUB_PRIVATE_KEY_FILE" : "GITHUB_PRIVATE_KEY_PATH";
  if (!present("GITHUB_PRIVATE_KEY") && !present(fileVariable)) {
    errors.push(`GITHUB_PRIVATE_KEY or ${fileVariable} is required for App history imports.`);
  }
  await checkSecretFile(fileVariable, "GitHub private key file");
  if (present("GITHUB_WEBHOOK_SECRET")) {
    ok.push(
      "GitHub webhooks: secret configured; a public webhook URL or proxy is still required."
    );
  } else {
    warnings.push(
      "GitHub historical imports can run, but live review webhooks are disabled until GITHUB_WEBHOOK_SECRET is set."
    );
  }
  ok.push("GitHub authentication: GitHub App mode.");
}

for (const message of ok) process.stdout.write(`✓ ${message}\n`);
for (const message of warnings) process.stdout.write(`! ${message}\n`);
for (const message of errors) process.stderr.write(`✗ ${message}\n`);
process.stdout.write(
  `\n${errors.length ? "Setup needs attention" : "Setup is ready"}: ${errors.length} error(s), ${warnings.length} warning(s).\n`
);
if (errors.length) process.exitCode = 1;
