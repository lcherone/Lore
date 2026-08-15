import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadGitHubPrivateKey } from "../../apps/worker/src/github-credentials.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("GitHub App private key loading", () => {
  it("prefers inline configuration and reads a private PEM file", async () => {
    await expect(loadGitHubPrivateKey({ GITHUB_PRIVATE_KEY: "inline-key" })).resolves.toBe("inline-key");
    const root = await mkdtemp(join(tmpdir(), "lore-github-key-"));
    temporaryDirectories.push(root);
    const path = join(root, "app.pem");
    await writeFile(path, "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n");
    await chmod(path, 0o600);
    await expect(loadGitHubPrivateKey({ GITHUB_PRIVATE_KEY_PATH: path })).resolves.toContain("BEGIN PRIVATE KEY");
  });

  it("rejects broadly-readable and symlinked key files", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-github-key-"));
    temporaryDirectories.push(root);
    const path = join(root, "app.pem");
    await writeFile(path, "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n");
    await chmod(path, 0o644);
    await expect(loadGitHubPrivateKey({ GITHUB_PRIVATE_KEY_PATH: path })).rejects.toThrow("permissions are too broad");
    const link = join(root, "link.pem");
    await symlink(path, link);
    await expect(loadGitHubPrivateKey({ GITHUB_PRIVATE_KEY_PATH: link })).rejects.toThrow("non-symlink");
  });
});
