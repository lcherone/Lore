import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadGitHubToken } from "../../apps/worker/src/github-credentials.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("GitHub personal access token loading", () => {
  it("prefers an inline token and reads an owner-only token file", async () => {
    await expect(
      loadGitHubToken({ GITHUB_TOKEN: "github_pat_inline_1234567890" })
    ).resolves.toBe("github_pat_inline_1234567890");

    const root = await mkdtemp(join(tmpdir(), "lore-github-token-"));
    temporaryDirectories.push(root);
    const path = join(root, "token");
    await writeFile(path, "github_pat_file_12345678901234567890\n");
    await chmod(path, 0o600);

    await expect(loadGitHubToken({ GITHUB_TOKEN_PATH: path })).resolves.toBe(
      "github_pat_file_12345678901234567890"
    );
  });

  it("rejects malformed tokens", async () => {
    await expect(loadGitHubToken({ GITHUB_TOKEN: "too-short" })).rejects.toThrow(
      "token is malformed"
    );
    await expect(
      loadGitHubToken({ GITHUB_TOKEN: "github_pat_contains whitespace" })
    ).rejects.toThrow("token is malformed");
  });

  it("rejects broadly-readable and symlinked token files", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-github-token-"));
    temporaryDirectories.push(root);
    const path = join(root, "token");
    await writeFile(path, "github_pat_file_12345678901234567890\n");
    await chmod(path, 0o644);

    await expect(loadGitHubToken({ GITHUB_TOKEN_PATH: path })).rejects.toThrow(
      "permissions are too broad"
    );

    const link = join(root, "token-link");
    await symlink(path, link);
    await expect(loadGitHubToken({ GITHUB_TOKEN_PATH: link })).rejects.toThrow("non-symlink");
  });
});
