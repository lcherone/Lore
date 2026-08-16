import "dotenv/config";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

function parseRepository(value: string): { owner: string; name: string } {
  const trimmed = value.trim().replace(/\/$/, "").replace(/\.git$/, "");
  let path = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    if (url.hostname !== "github.com") throw new Error("Repository URL must use github.com");
    path = url.pathname.replace(/^\//, "");
  }
  const [owner, name, extra] = path.split("/");
  if (!owner || !name || extra || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error("Use OWNER/REPOSITORY or https://github.com/OWNER/REPOSITORY");
  }
  return { owner, name };
}

async function tokenFromEnvironment(): Promise<string> {
  const inline = process.env.GITHUB_TOKEN?.trim();
  if (inline) return inline;
  const configuredPath = process.env.GITHUB_TOKEN_PATH?.trim() || process.env.GITHUB_TOKEN_FILE?.trim();
  if (!configuredPath) {
    throw new Error("Set GITHUB_TOKEN_FILE (Docker) or GITHUB_TOKEN_PATH (native) to an owner-only token file");
  }
  const path = resolve(configuredPath);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("GitHub token path must be a regular, non-symlink file");
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) throw new Error(`GitHub token permissions are too broad; run chmod 600 ${path}`);
  const token = (await readFile(path, "utf8")).trim();
  if (token.length < 20 || /\s/.test(token)) throw new Error("GitHub token file does not contain one valid token");
  return token;
}

async function github(path: string, token: string): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "Lore local setup",
      "x-github-api-version": "2022-11-28"
    }
  });
}

async function expectReadable(path: string, token: string, label: string): Promise<unknown> {
  const response = await github(path, token);
  if (!response.ok) {
    const hint = response.status === 404
      ? "Check selected-repository access, organisation approval, and SAML SSO authorisation."
      : response.status === 403
        ? "Check token expiry, rate limits, organisation approval, and read-only permissions."
        : "Check the token and GitHub availability.";
    throw new Error(`${label} returned HTTP ${response.status}. ${hint}`);
  }
  return response.json();
}

async function main(): Promise<void> {
  const target = process.argv[2] ?? process.env.LORE_TEST_REPOSITORY;
  if (!target) throw new Error("Pass OWNER/REPOSITORY, for example: npm run github:check -- D3R/soho-home");
  if ((process.env.GITHUB_AUTH_MODE?.trim() || "token") !== "token") {
    throw new Error("This preflight checks fine-grained PAT access; set GITHUB_AUTH_MODE=token");
  }

  const repository = parseRepository(target);
  const token = await tokenFromEnvironment();
  const encodedOwner = encodeURIComponent(repository.owner);
  const encodedName = encodeURIComponent(repository.name);
  const base = `/repos/${encodedOwner}/${encodedName}`;
  const metadata = await expectReadable(base, token, "Repository metadata") as {
    full_name?: string;
    private?: boolean;
    archived?: boolean;
    default_branch?: string;
  };
  const pulls = await expectReadable(`${base}/pulls?state=closed&per_page=1`, token, "Pull request history") as Array<{ number?: number }>;
  const pullNumber = pulls[0]?.number;
  if (pullNumber) {
    await Promise.all([
      expectReadable(`${base}/pulls/${pullNumber}/reviews?per_page=1`, token, "Submitted reviews"),
      expectReadable(`${base}/pulls/${pullNumber}/comments?per_page=1`, token, "Inline review comments"),
      expectReadable(`${base}/issues/${pullNumber}/comments?per_page=1`, token, "PR conversation comments"),
      expectReadable(`${base}/pulls/${pullNumber}/commits?per_page=1`, token, "PR commits"),
      expectReadable(`${base}/pulls/${pullNumber}/files?per_page=1`, token, "Changed files")
    ]);
  }

  process.stdout.write(`✓ GitHub repository: ${metadata.full_name ?? `${repository.owner}/${repository.name}`}\n`);
  process.stdout.write(`✓ Visibility: ${metadata.private ? "private" : "public"}; default branch: ${metadata.default_branch ?? "unknown"}\n`);
  process.stdout.write(`✓ Pull requests, reviews, conversation comments, commits, and changed files are readable${pullNumber ? ` (checked PR #${pullNumber})` : " (no closed PR was available for child-resource checks)"}.\n`);
  if (metadata.archived) process.stdout.write("! Repository is archived; Lore can import it but should treat the resulting knowledge as historical.\n");
}

try {
  await main();
} catch (error) {
  process.stderr.write(`GitHub access check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
