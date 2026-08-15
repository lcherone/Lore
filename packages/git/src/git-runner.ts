import { spawn } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import type { ChangedFile } from "@lore/shared/types.js";
import type { GitChangeReader } from "@lore/core/index.js";

export class GitCommandError extends Error {
  public constructor(
    public readonly args: string[],
    public readonly exitCode: number,
    public readonly stderr: string
  ) {
    super(`git ${args[0] ?? "command"} failed with exit code ${exitCode}: ${stderr.trim()}`);
    this.name = "GitCommandError";
  }
}

export async function runGit(repositoryPath: string, args: string[], timeoutMs = 30_000): Promise<string> {
  await access(repositoryPath, constants.R_OK);
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repositoryPath, ...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new GitCommandError(args, code ?? -1, stderr));
    });
  });
}

const MAX_CHANGED_FILES = 200;
const MAX_PATCH_BYTES = 2_000_000;
const MAX_FILE_PATCH_BYTES = 250_000;

interface GitStatusEntry {
  path: string;
  previousPath?: string;
  status: ChangedFile["status"];
  untracked: boolean;
}

function parseNameStatus(output: string): GitStatusEntry[] {
  const tokens = output.split("\0");
  const entries: GitStatusEntry[] = [];
  for (let index = 0; index < tokens.length - 1;) {
    const code = tokens[index++] ?? "M";
    const firstPath = tokens[index++];
    if (!firstPath) continue;
    if (code.startsWith("R") || code.startsWith("C")) {
      const path = tokens[index++];
      if (path) entries.push({ path, previousPath: firstPath, status: "renamed", untracked: false });
      continue;
    }
    entries.push({
      path: firstPath,
      status: code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified",
      untracked: false
    });
  }
  return entries;
}

function parsePorcelainStatus(output: string): GitStatusEntry[] {
  const tokens = output.split("\0");
  const entries: GitStatusEntry[] = [];
  for (let index = 0; index < tokens.length - 1;) {
    const record = tokens[index++] ?? "";
    if (!record || record.startsWith("# ") || record.startsWith("! ")) continue;
    if (record.startsWith("? ")) {
      entries.push({ path: record.slice(2), status: "added", untracked: true });
      continue;
    }
    const fields = record.split(" ");
    if (record.startsWith("2 ")) {
      const path = fields.slice(9).join(" ");
      const previousPath = tokens[index++];
      if (path) entries.push({ path, ...(previousPath ? { previousPath } : {}), status: "renamed", untracked: false });
      continue;
    }
    if (record.startsWith("1 ")) {
      const xy = fields[1] ?? "M.";
      const path = fields.slice(8).join(" ");
      if (!path) continue;
      entries.push({
        path,
        status: xy.includes("A") ? "added" : xy.includes("D") ? "deleted" : "modified",
        untracked: false
      });
    }
  }
  return entries;
}

function patchStats(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function assertSafeRevision(revision: string): void {
  if (revision.startsWith("-") || !/^[A-Za-z0-9._/@{}~^+:-]+$/.test(revision)) {
    throw new Error("Git revision contains unsupported characters");
  }
}

export class LocalGit implements GitChangeReader {
  async currentCommit(repositoryPath: string): Promise<string> {
    return (await runGit(repositoryPath, ["rev-parse", "HEAD"])).trim();
  }

  async changedFiles(repositoryPath: string, base?: string): Promise<ChangedFile[]> {
    if (base) assertSafeRevision(base);
    const comparison = base ?? "HEAD";
    const statusOutput = await runGit(repositoryPath, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]);
    let trackedChanges: GitStatusEntry[] = [];
    try {
      trackedChanges = parseNameStatus(
        await runGit(repositoryPath, ["diff", "--no-ext-diff", "--name-status", "-z", "--find-renames", comparison, "--"])
      );
    } catch (error) {
      if (base) throw error;
    }

    const byPath = new Map<string, GitStatusEntry>();
    for (const entry of trackedChanges) byPath.set(entry.path, entry);
    for (const entry of parsePorcelainStatus(statusOutput)) {
      const existing = byPath.get(entry.path);
      byPath.set(entry.path, existing ? { ...existing, ...entry, untracked: existing.untracked || entry.untracked } : entry);
    }
    if (byPath.size > MAX_CHANGED_FILES) {
      throw new Error(`Git change set contains ${byPath.size} files; the safety limit is ${MAX_CHANGED_FILES}`);
    }

    const files: ChangedFile[] = [];
    let totalPatchBytes = 0;
    for (const entry of [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path))) {
      let patch = "";
      if (entry.untracked) {
        const absolutePath = resolve(repositoryPath, entry.path);
        const file = await stat(absolutePath);
        if (file.isFile() && file.size <= MAX_FILE_PATCH_BYTES) {
          const content = await readFile(absolutePath);
          if (!content.includes(0)) {
            const text = content.toString("utf8");
            patch = `diff --git a/${entry.path} b/${entry.path}\nnew file mode 100644\n--- /dev/null\n+++ b/${entry.path}\n${text.split("\n").map((line) => `+${line}`).join("\n")}`;
          }
        }
      } else {
        patch = await runGit(repositoryPath, ["diff", "--no-ext-diff", "--unified=3", comparison, "--", entry.path]);
      }
      const patchBytes = Buffer.byteLength(patch);
      if (patchBytes > MAX_FILE_PATCH_BYTES) {
        throw new Error(`Git patch for ${entry.path} exceeds the ${MAX_FILE_PATCH_BYTES}-byte safety limit`);
      }
      totalPatchBytes += patchBytes;
      if (totalPatchBytes > MAX_PATCH_BYTES) {
        throw new Error(`Git change set exceeds the ${MAX_PATCH_BYTES}-byte safety limit`);
      }
      files.push({
        path: entry.path,
        ...(entry.previousPath ? { previousPath: entry.previousPath } : {}),
        status: entry.status,
        ...patchStats(patch),
        ...(patch ? { patch } : {})
      });
    }
    return files;
  }

  async history(repositoryPath: string, path?: string, limit = 100): Promise<Array<{ sha: string; occurredAt: string; subject: string; paths: string[] }>> {
    const safeLimit = Math.min(10_000, Math.max(1, limit));
    const args = ["log", `-${safeLimit}`, "--format=@@%H|%aI|%s", "--name-only", "--no-renames"];
    if (path) args.push("--", path);
    const output = await runGit(repositoryPath, args, 120_000);
    const commits: Array<{ sha: string; occurredAt: string; subject: string; paths: string[] }> = [];
    let current: { sha: string; occurredAt: string; subject: string; paths: string[] } | undefined;
    for (const line of output.split("\n")) {
      if (line.startsWith("@@")) {
        if (current) commits.push(current);
        const [sha = "", occurredAt = "", ...subjectParts] = line.slice(2).split("|");
        current = { sha, occurredAt, subject: subjectParts.join("|"), paths: [] };
      } else if (current && line.trim()) {
        current.paths.push(line.trim());
      }
    }
    if (current) commits.push(current);
    return commits;
  }

  async blame(repositoryPath: string, path: string, startLine?: number, endLine?: number): Promise<string> {
    const lineArgs = startLine && endLine ? ["-L", `${startLine},${endLine}`] : [];
    return runGit(repositoryPath, ["blame", "--line-porcelain", ...lineArgs, "--", path], 60_000);
  }

  async show(repositoryPath: string, revision: string, path?: string): Promise<string> {
    assertSafeRevision(revision);
    return runGit(repositoryPath, ["show", "--no-ext-diff", "--format=fuller", revision, ...(path ? ["--", path] : [])], 60_000);
  }
}
