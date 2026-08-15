import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { addGitHistoryRelationships, LocalRepositoryIndexer, PhpLanguageAnalyzer, TypeScriptAnalyzer } from "@lore/analysis/index.js";
import { createDemoSnapshot } from "@lore/shared/demo-data.js";

const fixture = fileURLToPath(new URL("../fixtures/demo-repo", import.meta.url));

describe("local repository indexing", () => {
  it("indexes PHP symbols without regex parsing and enriches them from Git history", async () => {
    const repository = { ...createDemoSnapshot().repositories[0]!, localPath: fixture };
    const output = await new LocalRepositoryIndexer([new TypeScriptAnalyzer(), new PhpLanguageAnalyzer()]).analyze(repository, fixture);
    expect(output.filesScanned).toBeGreaterThanOrEqual(10);
    expect(output.entities.some((entity) => entity.qualifiedName === "AddressCode::fromRole")).toBe(true);
    expect(output.entities.some((entity) => entity.type === "test")).toBe(true);
    const commits = JSON.parse(await readFile(`${fixture}/fixtures/git-history.json`, "utf8")) as Array<{ sha: string; occurredAt: string; paths: string[] }>;
    const enriched = addGitHistoryRelationships(repository.id, output.entities, output.relationships, commits);
    expect(enriched.some((relationship) => relationship.relationshipType === "historically_changes_with")).toBe(true);
  });
});
