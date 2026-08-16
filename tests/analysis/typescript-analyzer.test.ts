import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TypeScriptAnalyzer } from "@lore/analysis/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("TypeScript analyzer", () => {
  it("keeps placeholder call names non-empty when a long expression is truncated after a dot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lore-typescript-analyzer-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "long-call.js");
    const longIdentifier = "a".repeat(159);
    await writeFile(path, `${longIdentifier}.call();\n`, "utf8");

    const result = await new TypeScriptAnalyzer().analyze({
      repositoryId: "repo-test",
      path: "long-call.js",
      absolutePath: path,
      language: "javascript",
      contentHash: "fixture"
    });

    expect(result.entities.every((entity) => entity.name.length > 0)).toBe(true);
    expect(result.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "function",
        name: longIdentifier,
        metadata: { placeholder: true }
      })
    ]));
  });
});
