import { newUuid } from "@lore/shared/ids.js";
import { createDemoSnapshot, getDemoEvidence } from "@lore/shared/demo-data.js";
import { createDemoCodeGraph } from "@lore/shared/demo-graph.js";
import type { ChangedFile, ContextPackage, DashboardSnapshot, EvidenceRecord, RepositorySummary, SafetyReport } from "@lore/shared/types.js";
import { TypeScriptAnalyzer, PhpLanguageAnalyzer, LocalRepositoryIndexer, addGitHistoryRelationships } from "@lore/analysis/index.js";
import { TaskPreparationService, formatAgentInstructions } from "@lore/context/index.js";
import { LocalGit } from "@lore/git/index.js";
import { ImpactGraph } from "@lore/impact/index.js";
import { ChangeVerificationService } from "@lore/reporting/index.js";
import { LocalProject } from "./local-project.js";
import { HttpLoreClient } from "./lore-client.js";

export class CliRuntime {
  readonly project: LocalProject;
  readonly git = new LocalGit();
  readonly #context = new TaskPreparationService();
  readonly #verification = new ChangeVerificationService();

  public constructor(root = process.cwd()) {
    this.project = new LocalProject(root);
  }

  async mode(): Promise<"local" | "service" | "demo"> {
    return (await this.project.readConfigOrDefault()).mode;
  }

  async graphData() {
    const config = await this.project.readConfigOrDefault();
    return (await this.project.readIndex()) ?? (config.mode === "demo" ? createDemoCodeGraph() : { entities: [], relationships: [], regressions: [] });
  }

  async repository(): Promise<RepositorySummary> {
    const config = await this.project.readConfigOrDefault();
    if (config.mode === "service") {
      const repository = (await new HttpLoreClient(config).snapshot()).repositories.find((item) => item.id === config.repositoryId);
      if (!repository) throw new Error(`Repository ${config.repositoryId} is not available to the configured Lore service tenant`);
      const index = await this.project.readIndex();
      return {
        ...repository,
        localPath: this.project.root,
        entityCount: index?.entities.length ?? repository.entityCount,
        relationshipCount: index?.relationships.length ?? repository.relationshipCount
      };
    }
    const [owner = "local", name = this.project.root.split("/").at(-1) ?? "repository"] = config.repository.split("/");
    const index = await this.project.readIndex();
    return {
      id: config.repositoryId,
      organisationId: config.organisationId,
      provider: "local",
      owner,
      name,
      defaultBranch: "main",
      localPath: this.project.root,
      languageSummary: {},
      ...(index?.commit ? { lastIndexedCommit: index.commit } : {}),
      ...(index?.indexedAt ? { indexedAt: index.indexedAt } : {}),
      entityCount: index?.entities.length ?? 0,
      relationshipCount: index?.relationships.length ?? 0,
      status: index ? "ready" : "attention"
    };
  }

  async indexRepository(): Promise<{ filesScanned: number; entities: number; relationships: number; durationMs: number; commit?: string }> {
    const repository = await this.repository();
    const indexer = new LocalRepositoryIndexer([new TypeScriptAnalyzer(), new PhpLanguageAnalyzer()]);
    const output = await indexer.analyze(repository, this.project.root);
    const commit = await this.git.currentCommit(this.project.root).catch(() => undefined);
    const history = await this.git.history(this.project.root, undefined, 500).catch(() => []);
    const relationships = addGitHistoryRelationships(repository.id, output.entities, output.relationships, history);
    await this.project.saveIndex({
      entities: output.entities,
      relationships,
      indexedAt: new Date().toISOString(),
      ...(commit ? { commit } : {})
    });
    const config = await this.project.readConfigOrDefault();
    if (config.mode === "service") {
      await new HttpLoreClient(config).uploadAnalysis({
        repositoryId: repository.id,
        ...(commit ? { commit } : {}),
        indexedAt: new Date().toISOString(),
        entities: output.entities,
        relationships
      });
    }
    return {
      filesScanned: output.filesScanned,
      entities: output.entities.length,
      relationships: relationships.length,
      durationMs: output.durationMs,
      ...(commit ? { commit } : {})
    };
  }

  async prepare(task: string, explicitPaths?: string[]): Promise<ContextPackage> {
    const repository = await this.repository();
    const config = await this.project.readConfigOrDefault();
    if (config.mode === "service") {
      const context = await new HttpLoreClient(config).prepareTask(repository.id, task, explicitPaths);
      await this.project.saveContext(context, formatAgentInstructions(context));
      return context;
    }
    const localIndex = await this.project.readIndex();
    const demo = config.mode === "demo" ? createDemoCodeGraph() : { entities: [], relationships: [], regressions: [] };
    const graph = localIndex ?? demo;
    const { snapshot, evidence } = this.#localAuthority(repository, config.mode);
    const context = this.#context.prepare({
      repository,
      task,
      ...(explicitPaths ? { explicitPaths } : {}),
      snapshot,
      evidence,
      entities: graph.entities.map((item) => ({ ...item, repositoryId: repository.id })),
      relationships: graph.relationships.map((item) => ({ ...item, repositoryId: repository.id })),
      regressions: demo.regressions.map((item) => ({ ...item, repositoryId: repository.id }))
    });
    await this.project.saveContext(context, formatAgentInstructions(context));
    return context;
  }

  async verify(task?: string, changedFiles?: ChangedFile[]): Promise<SafetyReport> {
    const repository = await this.repository();
    const config = await this.project.readConfigOrDefault();
    const context = await this.project.readContext();
    const actualChanges = changedFiles ?? (await this.git.changedFiles(this.project.root, context?.repository.lastIndexedCommit));
    if (config.mode === "service") {
      const localSession = await this.project.readSession();
      const client = new HttpLoreClient(config);
      const sessionId = typeof localSession?.id === "string" && ["preparing", "active"].includes(String(localSession.status))
        ? localSession.id
        : (await client.startSession(
            repository.id,
            task ?? context?.task.text ?? "Unspecified local change",
            "other",
            context?.repository.lastIndexedCommit
          )).session.id;
      const currentCommit = await this.git.currentCommit(this.project.root).catch(() => undefined);
      const result = await client.verify(sessionId, actualChanges, currentCommit);
      await this.project.saveSession(result.session);
      await this.project.saveReport(result.report);
      return result.report;
    }
    const localIndex = await this.project.readIndex();
    const demo = config.mode === "demo" ? createDemoCodeGraph() : { entities: [], relationships: [], regressions: [] };
    const graph = localIndex ?? demo;
    const { snapshot } = this.#localAuthority(repository, config.mode);
    const report = this.#verification.verify({
      task: task ?? context?.task.text ?? "Unspecified local change",
      repository,
      snapshot,
      changedFiles: actualChanges,
      entities: graph.entities.map((item) => ({ ...item, repositoryId: repository.id })),
      relationships: graph.relationships.map((item) => ({ ...item, repositoryId: repository.id })),
      regressions: demo.regressions.map((item) => ({ ...item, repositoryId: repository.id }))
    });
    await this.project.saveReport(report);
    return report;
  }

  async explain(target: string) {
    const config = await this.project.readConfigOrDefault();
    const repository = await this.repository();
    const index = await this.project.readIndex();
    const demo = config.mode === "demo" ? createDemoCodeGraph() : { entities: [], relationships: [], regressions: [] };
    const graphData = index ?? demo;
    const graph = new ImpactGraph(graphData.entities, graphData.relationships);
    const entity = graph.findEntities(target)[0];
    if (!entity) return undefined;
    const impact = graph.traverse([entity.id], { maxDepth: 2, maximumNodes: 20, minimumConfidence: 0.35 });
    const { snapshot, evidence } = config.mode === "service"
      ? { snapshot: await new HttpLoreClient(config).snapshot(), evidence: await new HttpLoreClient(config).evidence() }
      : this.#localAuthority(repository, config.mode);
    const knowledge = snapshot.knowledge.filter((item) =>
      `${item.title} ${item.statement} ${JSON.stringify(item.scope)}`.toLowerCase().includes(entity.name.toLowerCase()) ||
      item.scope.paths?.some((path) => entity.path.includes(path.replaceAll("**", "")))
    );
    const timeline = await this.git.history(this.project.root, entity.path, 10).catch(() => []);
    return {
      target: entity.qualifiedName,
      purpose: `Indexed ${entity.type} in ${entity.path}`,
      decisions: knowledge.filter((item) => item.kind === "decision"),
      rules: knowledge.filter((item) => item.kind === "rule"),
      preferences: knowledge.filter((item) => item.kind === "preference"),
      regressions: demo.regressions.filter((item) => item.affectedEntities.some((name) => entity.qualifiedName.includes(name))),
      affectedConsumers: impact,
      tests: impact.filter((item) => item.entity.type === "test"),
      evidence: evidence.filter((record) => knowledge.some((item) => item.evidenceIds.includes(record.id))),
      timeline
    };
  }

  async search(query: string): Promise<Record<string, unknown>> {
    const config = await this.project.readConfigOrDefault();
    if (config.mode === "service") return new HttpLoreClient(config).search(query, config.repositoryId);
    const repository = await this.repository();
    const { snapshot, evidence } = this.#localAuthority(repository, config.mode);
    const index = await this.project.readIndex();
    const graph = index ?? (config.mode === "demo" ? createDemoCodeGraph() : { entities: [], relationships: [] });
    const needle = query.toLowerCase();
    return {
      mode: config.mode,
      organisationId: config.organisationId,
      repositoryId: config.repositoryId,
      knowledge: [...snapshot.knowledge, ...snapshot.candidates].filter((item) => `${item.title} ${item.statement}`.toLowerCase().includes(needle)),
      evidence: evidence.filter((item) => `${item.title ?? ""} ${item.content}`.toLowerCase().includes(needle)),
      entities: graph.entities.filter((item) => `${item.qualifiedName} ${item.path}`.toLowerCase().includes(needle))
    };
  }

  async knowledge() {
    const config = await this.project.readConfigOrDefault();
    const repository = await this.repository();
    const snapshot = config.mode === "service"
      ? await new HttpLoreClient(config).snapshot()
      : this.#localAuthority(repository, config.mode).snapshot;
    return { mode: config.mode, organisationId: config.organisationId, repositoryId: config.repositoryId, items: snapshot.knowledge, policies: snapshot.policies };
  }

  async startSession(task: string, agentType: string): Promise<Record<string, unknown>> {
    const repository = await this.repository();
    const config = await this.project.readConfigOrDefault();
    const baseCommit = await this.git.currentCommit(this.project.root).catch(() => undefined);
    if (config.mode === "service") {
      const started = await new HttpLoreClient(config).startSession(repository.id, task, agentType, baseCommit);
      await this.project.saveContext(started.context, formatAgentInstructions(started.context));
      await this.project.saveSession(started.session);
      return started.session as unknown as Record<string, unknown>;
    }
    const context = await this.prepare(task);
    const session = {
      id: newUuid(),
      status: "active",
      task,
      agentType,
      repositoryId: repository.id,
      ...(baseCommit ? { baseCommit } : {}),
      contextId: context.id,
      startedAt: new Date().toISOString(),
      filesObserved: context.candidateFiles.map((file) => file.path),
      filesChanged: []
    };
    await this.project.saveSession(session);
    return session;
  }

  async abandonSession(reason: string): Promise<Record<string, unknown>> {
    const current = await this.project.readSession();
    if (!current || typeof current.id !== "string") throw new Error("No session exists");
    const config = await this.project.readConfigOrDefault();
    const abandoned = config.mode === "service"
      ? await new HttpLoreClient(config).abandonSession(current.id, reason)
      : { ...current, status: "abandoned", completedAt: new Date().toISOString(), reason };
    await this.project.saveSession(abandoned);
    return abandoned as unknown as Record<string, unknown>;
  }

  async refreshSessionContext(task: string, paths: string[]): Promise<ContextPackage> {
    const config = await this.project.readConfigOrDefault();
    const session = await this.project.readSession();
    if (config.mode === "service") {
      if (!session || typeof session.id !== "string") throw new Error("No service session exists");
      const context = await new HttpLoreClient(config).refreshContext(session.id, paths);
      await this.project.saveContext(context, formatAgentInstructions(context));
      await this.project.saveSession({ ...session, status: "active", filesChanged: paths });
      return context;
    }
    return this.prepare(task, paths);
  }

  #localAuthority(repository: RepositorySummary, mode: "local" | "demo" | "service"): { snapshot: DashboardSnapshot; evidence: EvidenceRecord[] } {
    if (mode === "demo") {
      const snapshot = createDemoSnapshot();
      snapshot.repositories = [repository];
      snapshot.knowledge = snapshot.knowledge.map((item) => ({ ...item, repositoryId: repository.id }));
      snapshot.policies = snapshot.policies.map((item) => ({ ...item, repositoryId: item.repositoryId ? repository.id : undefined }));
      return {
        snapshot,
        evidence: getDemoEvidence().map((item) => ({ ...item, repositoryId: item.repositoryId ? repository.id : undefined }))
      };
    }
    return {
      snapshot: {
        organisation: { id: repository.organisationId, name: repository.organisationId, slug: repository.organisationId },
        repositories: [repository],
        knowledge: [],
        candidates: [],
        policies: [],
        reports: [],
        reviewers: [],
        sessions: []
      },
      evidence: []
    };
  }
}
