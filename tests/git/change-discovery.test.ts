import { mkdir, mkdtemp, rm, writeFile, rename, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalGit, runGit } from "@lore/git/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Git change discovery", () => {
  it("collects staged, unstaged, renamed, deleted, and untracked files", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-git-"));
    temporaryDirectories.push(root);
    await runGit(root, ["init", "--quiet"]);
    await runGit(root, ["config", "user.email", "lore@example.test"]);
    await runGit(root, ["config", "user.name", "Lore Test"]);
    await runGit(root, ["config", "commit.gpgsign", "false"]);
    await writeFile(join(root, "staged.ts"), "export const staged = 1;\n");
    await writeFile(join(root, "unstaged.ts"), "export const unstaged = 1;\n");
    await writeFile(join(root, "rename-me.ts"), "export const renamed = 1;\n");
    await writeFile(join(root, "delete-me.ts"), "export const removed = 1;\n");
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "--quiet", "-m", "fixture baseline"]);

    await writeFile(join(root, "staged.ts"), "export const staged = 2;\n");
    await runGit(root, ["add", "staged.ts"]);
    await writeFile(join(root, "unstaged.ts"), "export const unstaged = 2;\n");
    await rename(join(root, "rename-me.ts"), join(root, "renamed.ts"));
    await runGit(root, ["add", "-A", "rename-me.ts", "renamed.ts"]);
    await unlink(join(root, "delete-me.ts"));
    await writeFile(join(root, "untracked.ts"), "export const untracked = true;\n");
    await mkdir(join(root, ".lore"));
    await writeFile(join(root, ".lore", "context.json"), "{\"private\":true}\n");

    const changes = await new LocalGit().changedFiles(root);
    expect(changes.map(({ path, status }) => ({ path, status }))).toEqual([
      { path: "delete-me.ts", status: "deleted" },
      { path: "renamed.ts", status: "renamed" },
      { path: "staged.ts", status: "modified" },
      { path: "unstaged.ts", status: "modified" },
      { path: "untracked.ts", status: "added" }
    ]);
    expect(changes.find((item) => item.path === "renamed.ts")?.previousPath).toBe("rename-me.ts");
    expect(changes.find((item) => item.path === "untracked.ts")?.patch).toContain("+export const untracked = true;");
    expect(changes.some((item) => item.path.startsWith(".lore/"))).toBe(false);
  });
});
