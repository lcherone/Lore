import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import fg from "fast-glob";
import type {
  AnalysisResult,
  LanguageAnalyzer,
  RepositoryAnalysisOutput,
  RepositoryAnalyzer,
  SourceFile
} from "@lore/core/index.js";
import type { CodeEntity, CodeRelationship, RepositorySummary } from "@lore/shared/types.js";
import { createRelationship } from "./entity-factory.js";

const detectLanguage = (path: string): string => {
  if (/\.(?:ts|tsx)$/.test(path)) return "typescript";
  if (/\.(?:js|jsx|mjs|cjs)$/.test(path)) return "javascript";
  if (path.endsWith(".php")) return "php";
  return "unknown";
};

export class LocalRepositoryIndexer implements RepositoryAnalyzer {
  public constructor(private readonly analyzers: LanguageAnalyzer[]) {}

  async analyze(repository: RepositorySummary, repositoryPath: string): Promise<RepositoryAnalysisOutput> {
    const startedAt = performance.now();
    const paths = await fg(["**/*.{ts,tsx,js,jsx,mjs,cjs,php}"], {
      cwd: repositoryPath,
      onlyFiles: true,
      dot: false,
      followSymbolicLinks: false,
      ignore: ["**/node_modules/**", "**/vendor/**", "**/dist/**", "**/build/**", "**/.git/**", "**/coverage/**"]
    });
    const results: AnalysisResult[] = [];
    let skipped = 0;
    const languageCounts = new Map<string, number>();

    for (const path of paths) {
      const absolutePath = resolve(repositoryPath, path);
      const fileStats = await stat(absolutePath);
      if (fileStats.size > 1_000_000) {
        skipped += 1;
        continue;
      }
      const language = detectLanguage(path);
      const analyzer = this.analyzers.find((candidate) =>
        candidate.supports({ repositoryId: repository.id, path, absolutePath, language, contentHash: "" })
      );
      if (!analyzer) {
        skipped += 1;
        continue;
      }
      const contentHash = createHash("sha256").update(await readFile(absolutePath)).digest("hex");
      const sourceFile: SourceFile = { repositoryId: repository.id, path, absolutePath, language, contentHash };
      try {
        results.push(await analyzer.analyze(sourceFile));
        languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
      } catch (error) {
        results.push({
          entities: [],
          relationships: [],
          diagnostics: [{ path, message: error instanceof Error ? error.message : "Unknown analysis failure", severity: "error" }]
        });
      }
    }

    const entityMap = new Map<string, CodeEntity>();
    const relationshipMap = new Map<string, CodeRelationship>();
    for (const result of results) {
      for (const entity of result.entities) {
        const existing = entityMap.get(entity.fingerprint);
        if (!existing || (existing.metadata.placeholder && !entity.metadata.placeholder)) entityMap.set(entity.fingerprint, entity);
      }
      for (const relationship of result.relationships) relationshipMap.set(relationship.id, relationship);
    }
    const allEntities = [...entityMap.values()];
    const canonicalByName = new Map<string, CodeEntity>();
    for (const entity of allEntities.filter((candidate) => !candidate.metadata.placeholder)) {
      canonicalByName.set(`${entity.type}:${entity.qualifiedName}`, entity);
    }
    const replacements = new Map<string, string>();
    for (const entity of allEntities.filter((candidate) => candidate.metadata.placeholder)) {
      const canonical = canonicalByName.get(`${entity.type}:${entity.qualifiedName}`);
      if (canonical) replacements.set(entity.id, canonical.id);
    }
    const entities = allEntities.filter((entity) => !replacements.has(entity.id));
    const relationships = [...new Map([...relationshipMap.values()].map((relationship) => {
      const sourceEntityId = replacements.get(relationship.sourceEntityId) ?? relationship.sourceEntityId;
      const targetEntityId = replacements.get(relationship.targetEntityId) ?? relationship.targetEntityId;
      const resolved = sourceEntityId === relationship.sourceEntityId && targetEntityId === relationship.targetEntityId
        ? relationship
        : createRelationship({ ...relationship, sourceEntityId, targetEntityId });
      return [resolved.id, resolved] as const;
    })).values()];
    const total = [...languageCounts.values()].reduce((sum, value) => sum + value, 0) || 1;
    const languageSummary = Object.fromEntries(
      [...languageCounts.entries()].map(([language, count]) => [language, Number(((count / total) * 100).toFixed(1))])
    );

    return {
      repository: { ...repository, languageSummary, entityCount: entities.length, relationshipCount: relationships.length },
      entities,
      relationships,
      filesScanned: paths.length - skipped,
      filesSkipped: skipped,
      durationMs: Math.round(performance.now() - startedAt)
    };
  }
}
