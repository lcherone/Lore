import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalProject } from "../../apps/cli/src/local-project.js";
import { runGit } from "@lore/git/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local Lore state", () => {
  it("writes private state through atomic replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-state-"));
    temporaryDirectories.push(root);
    const project = new LocalProject(root);
    await project.initialize({ repository: "local/fixture" });
    expect((await lstat(join(root, ".lore"))).mode & 0o777).toBe(0o700);
    expect((await lstat(join(root, ".lore", "config.json"))).mode & 0o777).toBe(0o600);
    expect((await project.readConfig()).repository).toBe("local/fixture");
  });

  it("rejects symlinked and broadly-readable private files", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-state-"));
    temporaryDirectories.push(root);
    const project = new LocalProject(root);
    await project.initialize();
    const external = join(root, "external.json");
    await writeFile(external, "{}\n");
    await rm(join(root, ".lore", "config.json"));
    await symlink(external, join(root, ".lore", "config.json"));
    await expect(project.readConfig()).rejects.toThrow("symbolic-link");

    await rm(join(root, ".lore", "config.json"));
    await writeFile(join(root, ".lore", "config.json"), "{}\n");
    await chmod(join(root, ".lore", "config.json"), 0o644);
    await expect(project.readConfig()).rejects.toThrow("permissions are too broad");
  });

  it("adds Lore state to the repository-local Git exclude", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-state-"));
    temporaryDirectories.push(root);
    await runGit(root, ["init", "--quiet"]);
    await new LocalProject(root).initialize();
    expect(await readFile(join(root, ".git", "info", "exclude"), "utf8")).toContain(".lore/");
    expect((await runGit(root, ["status", "--porcelain", "--untracked-files=all"])).trim()).toBe("");
  });
});
