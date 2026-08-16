import { readFile } from "node:fs/promises";
import { Project, SyntaxKind } from "ts-morph";
import type { AnalysisResult, LanguageAnalyzer, SourceFile } from "@lore/core/index.js";
import type { CodeEntity, CodeRelationship } from "@lore/shared/types.js";
import { createEntity, createRelationship } from "./entity-factory.js";

export class TypeScriptAnalyzer implements LanguageAnalyzer {
  public readonly version = "typescript-v1";

  supports(file: SourceFile): boolean {
    return ["typescript", "javascript"].includes(file.language);
  }

  async analyze(file: SourceFile): Promise<AnalysisResult> {
    const content = await readFile(file.absolutePath, "utf8");
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true } });
    const source = project.createSourceFile(file.path, content);
    const entities: CodeEntity[] = [];
    const relationships: CodeRelationship[] = [];
    const fileEntity = createEntity({
      repositoryId: file.repositoryId,
      type: file.path.includes(".test.") || file.path.includes(".spec.") ? "test" : "file",
      name: file.path.split("/").at(-1) ?? file.path,
      qualifiedName: file.path,
      path: file.path,
      language: file.language,
      metadata: { contentHash: file.contentHash, analyzerVersion: this.version }
    });
    entities.push(fileEntity);

    const addContainedEntity = (entity: CodeEntity): void => {
      entities.push(entity);
      relationships.push(
        createRelationship({
          repositoryId: file.repositoryId,
          sourceEntityId: fileEntity.id,
          targetEntityId: entity.id,
          relationshipType: "contains",
          confidence: 1,
          source: "static_analysis"
        })
      );
    };

    for (const declaration of source.getClasses()) {
      const name = declaration.getName() ?? "anonymous-class";
      const classEntity = createEntity({
        repositoryId: file.repositoryId,
        type: "class",
        name,
        qualifiedName: name,
        path: file.path,
        startLine: declaration.getStartLineNumber(),
        endLine: declaration.getEndLineNumber(),
        language: file.language
      });
      addContainedEntity(classEntity);

      for (const method of declaration.getMethods()) {
        const methodEntity = createEntity({
          repositoryId: file.repositoryId,
          type: "method",
          name: method.getName(),
          qualifiedName: `${name}.${method.getName()}`,
          path: file.path,
          startLine: method.getStartLineNumber(),
          endLine: method.getEndLineNumber(),
          language: file.language,
          metadata: { async: method.isAsync(), static: method.isStatic() }
        });
        entities.push(methodEntity);
        relationships.push(
          createRelationship({
            repositoryId: file.repositoryId,
            sourceEntityId: classEntity.id,
            targetEntityId: methodEntity.id,
            relationshipType: "contains",
            confidence: 1,
            source: "static_analysis"
          })
        );
      }

      for (const implemented of declaration.getImplements()) {
        const nameText = implemented.getExpression().getText();
        const target = createEntity({
          repositoryId: file.repositoryId,
          type: "interface",
          name: nameText,
          qualifiedName: nameText,
          path: `[symbol]/${nameText}`,
          language: file.language,
          metadata: { placeholder: true }
        });
        entities.push(target);
        relationships.push(
          createRelationship({
            repositoryId: file.repositoryId,
            sourceEntityId: classEntity.id,
            targetEntityId: target.id,
            relationshipType: "implements",
            confidence: 0.99,
            source: "static_analysis"
          })
        );
      }
    }

    for (const declaration of source.getInterfaces()) {
      addContainedEntity(
        createEntity({
          repositoryId: file.repositoryId,
          type: "interface",
          name: declaration.getName(),
          qualifiedName: declaration.getName(),
          path: file.path,
          startLine: declaration.getStartLineNumber(),
          endLine: declaration.getEndLineNumber(),
          language: file.language
        })
      );
    }

    for (const declaration of source.getFunctions()) {
      const name = declaration.getName() ?? "anonymous-function";
      addContainedEntity(
        createEntity({
          repositoryId: file.repositoryId,
          type: "function",
          name,
          qualifiedName: name,
          path: file.path,
          startLine: declaration.getStartLineNumber(),
          endLine: declaration.getEndLineNumber(),
          language: file.language,
          metadata: { async: declaration.isAsync() }
        })
      );
    }

    for (const declaration of source.getImportDeclarations()) {
      const moduleName = declaration.getModuleSpecifierValue();
      const target = createEntity({
        repositoryId: file.repositoryId,
        type: "file",
        name: moduleName,
        qualifiedName: moduleName,
        path: `[import]/${moduleName}`,
        language: file.language,
        metadata: { placeholder: true, moduleSpecifier: moduleName }
      });
      entities.push(target);
      relationships.push(
        createRelationship({
          repositoryId: file.repositoryId,
          sourceEntityId: fileEntity.id,
          targetEntityId: target.id,
          relationshipType: "imports",
          confidence: 1,
          source: "static_analysis"
        })
      );
    }

    const callers = new Map<number, CodeEntity>();
    for (const entity of entities.filter((item) => item.type === "method" || item.type === "function")) {
      if (entity.startLine) callers.set(entity.startLine, entity);
    }
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression().getText().slice(0, 160);
      if (!expression || expression === "require") continue;
      const callName = expression
        .split(".")
        .map((segment) => segment.trim())
        .filter(Boolean)
        .at(-1) ?? "anonymous-call";
      const caller = [...callers.entries()]
        .filter(([line]) => line <= call.getStartLineNumber())
        .sort(([left], [right]) => right - left)[0]?.[1] ?? fileEntity;
      const target = createEntity({
        repositoryId: file.repositoryId,
        type: "function",
        name: callName,
        qualifiedName: expression,
        path: `[symbol]/${expression}`,
        language: file.language,
        metadata: { placeholder: true }
      });
      entities.push(target);
      relationships.push(
        createRelationship({
          repositoryId: file.repositoryId,
          sourceEntityId: fileEntity.type === "test" ? fileEntity.id : caller.id,
          targetEntityId: target.id,
          relationshipType: fileEntity.type === "test" ? "tests" : "calls",
          confidence: 0.82,
          source: "static_analysis"
        })
      );
    }

    return { entities, relationships, diagnostics: [] };
  }
}
