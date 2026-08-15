import { readFile } from "node:fs/promises";
import PhpParser from "php-parser";
import type { AnalysisResult, LanguageAnalyzer, SourceFile } from "@lore/core/index.js";
import type { CodeEntity, CodeRelationship } from "@lore/shared/types.js";
import { createEntity, createRelationship } from "./entity-factory.js";

interface PhpNode {
  kind?: string;
  name?: string | { name?: string };
  what?: unknown;
  offset?: unknown;
  extends?: unknown;
  implements?: unknown[];
  loc?: { start?: { line?: number }; end?: { line?: number } };
  [key: string]: unknown;
}

const nodeName = (node: PhpNode): string => {
  if (typeof node.name === "string") return node.name;
  if (node.name && typeof node.name === "object" && typeof node.name.name === "string") return node.name.name;
  return "anonymous";
};

const walk = (
  value: unknown,
  visit: (node: PhpNode, parent: PhpNode | undefined, ancestors: PhpNode[]) => void,
  parent?: PhpNode,
  ancestors: PhpNode[] = []
): void => {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const child of value) walk(child, visit, parent, ancestors);
    return;
  }
  const node = value as PhpNode;
  visit(node, parent, ancestors);
  for (const [key, child] of Object.entries(node)) {
    if (key === "loc") continue;
    walk(child, visit, node, [...ancestors, node]);
  }
};

const referenceName = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "unknown";
  const node = value as PhpNode;
  if (node.kind === "staticlookup") {
    const className = referenceName(node.what).split("\\").at(-1) ?? referenceName(node.what);
    return `${className}::${referenceName(node.offset)}`;
  }
  if (node.kind === "propertylookup") return `${referenceName(node.what)}->${referenceName(node.offset)}`;
  return nodeName(node);
};

export class PhpLanguageAnalyzer implements LanguageAnalyzer {
  public readonly version = "php-parser-v1";

  supports(file: SourceFile): boolean {
    return file.language === "php";
  }

  async analyze(file: SourceFile): Promise<AnalysisResult> {
    const content = await readFile(file.absolutePath, "utf8");
    const parser = new PhpParser.Engine({
      parser: { extractDoc: true, php7: true },
      ast: { withPositions: true, withSource: false }
    });
    const ast = parser.parseCode(content, file.path) as PhpNode;
    const entities: CodeEntity[] = [];
    const relationships: CodeRelationship[] = [];
    const fileEntity = createEntity({
      repositoryId: file.repositoryId,
      type: file.path.toLowerCase().includes("test") ? "test" : "file",
      name: file.path.split("/").at(-1) ?? file.path,
      qualifiedName: file.path,
      path: file.path,
      language: "php",
      metadata: { contentHash: file.contentHash, analyzerVersion: this.version }
    });
    entities.push(fileEntity);
    const entityByNode = new WeakMap<object, CodeEntity>();

    walk(ast, (node, parent) => {
      const kindMap: Record<string, CodeEntity["type"]> = {
        class: "class",
        interface: "interface",
        trait: "trait",
        function: "function",
        method: "method",
        constant: "constant"
      };
      const entityType = node.kind ? kindMap[node.kind] : undefined;
      if (!entityType) return;
      const name = nodeName(node);
      const parentEntity = parent ? entityByNode.get(parent) : undefined;
      const qualifiedName = parentEntity && entityType === "method" ? `${parentEntity.qualifiedName}::${name}` : name;
      const entity = createEntity({
        repositoryId: file.repositoryId,
        type: entityType,
        name,
        qualifiedName,
        path: file.path,
        ...(node.loc?.start?.line ? { startLine: node.loc.start.line } : {}),
        ...(node.loc?.end?.line ? { endLine: node.loc.end.line } : {}),
        language: "php"
      });
      entities.push(entity);
      entityByNode.set(node, entity);
      relationships.push(
        createRelationship({
          repositoryId: file.repositoryId,
          sourceEntityId: parentEntity?.id ?? fileEntity.id,
          targetEntityId: entity.id,
          relationshipType: "contains",
          confidence: 1,
          source: "static_analysis"
        })
      );
    });

    walk(ast, (node, _parent, ancestors) => {
      const caller = [...ancestors]
        .reverse()
        .map((ancestor) => entityByNode.get(ancestor))
        .find((entity) => entity?.type === "method" || entity?.type === "function" || entity?.type === "class") ?? fileEntity;

      if (node.kind === "call") {
        const qualifiedName = referenceName(node.what);
        if (!qualifiedName || qualifiedName === "unknown") return;
        const target = createEntity({
          repositoryId: file.repositoryId,
          type: qualifiedName.includes("::") || qualifiedName.includes("->") ? "method" : "function",
          name: qualifiedName.split(/::|->/).at(-1) ?? qualifiedName,
          qualifiedName,
          path: `[symbol]/${qualifiedName}`,
          language: "php",
          metadata: { placeholder: true }
        });
        entities.push(target);
        relationships.push(createRelationship({
          repositoryId: file.repositoryId,
          sourceEntityId: fileEntity.type === "test" ? fileEntity.id : caller.id,
          targetEntityId: target.id,
          relationshipType: fileEntity.type === "test" ? "tests" : "calls",
          confidence: 0.94,
          source: "static_analysis"
        }));
      }

      if (node.kind === "new") {
        const qualifiedName = referenceName(node.what);
        if (!qualifiedName || qualifiedName === "unknown") return;
        const target = createEntity({
          repositoryId: file.repositoryId,
          type: "class",
          name: qualifiedName,
          qualifiedName,
          path: `[symbol]/${qualifiedName}`,
          language: "php",
          metadata: { placeholder: true }
        });
        entities.push(target);
        relationships.push(createRelationship({
          repositoryId: file.repositoryId,
          sourceEntityId: caller.id,
          targetEntityId: target.id,
          relationshipType: "instantiates",
          confidence: 0.98,
          source: "static_analysis"
        }));
      }

      if (node.kind === "class") {
        const source = entityByNode.get(node);
        if (!source) return;
        const references = [
          ...(node.extends ? [{ value: node.extends, relationshipType: "extends" }] : []),
          ...(node.implements ?? []).map((value) => ({ value, relationshipType: "implements" }))
        ];
        for (const reference of references) {
          const qualifiedName = referenceName(reference.value);
          const target = createEntity({
            repositoryId: file.repositoryId,
            type: reference.relationshipType === "implements" ? "interface" : "class",
            name: qualifiedName,
            qualifiedName,
            path: `[symbol]/${qualifiedName}`,
            language: "php",
            metadata: { placeholder: true }
          });
          entities.push(target);
          relationships.push(createRelationship({
            repositoryId: file.repositoryId,
            sourceEntityId: source.id,
            targetEntityId: target.id,
            relationshipType: reference.relationshipType,
            confidence: 0.99,
            source: "static_analysis"
          }));
        }
      }
    });

    return { entities, relationships, diagnostics: [] };
  }
}
