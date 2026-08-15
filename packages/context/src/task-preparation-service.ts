import { sortByPrecedence, scopeApplies } from "@lore/core/index.js";
import { ImpactGraph } from "@lore/impact/index.js";
import { newUuid } from "@lore/shared/ids.js";
import type {
  CodeEntity,
  CodeRelationship,
  ContextEntry,
  ContextPackage,
  DashboardSnapshot,
  EvidenceRecord,
  KnowledgeItem,
  PolicyRecord,
  RegressionRecord,
  RepositorySummary
} from "@lore/shared/types.js";

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "from",
  "into",
  "with",
  "update",
  "change",
  "add",
  "remove",
  "should",
  "this",
  "that",
  "addresses"
]);

const taskTokens = (task: string): string[] =>
  [...new Set(task.toLowerCase().split(/[^a-z0-9_]+/).filter((token) => token.length > 2 && !STOP_WORDS.has(token)))];

const relevance = (text: string, concepts: string[]): number => {
  const haystack = text.toLowerCase();
  if (concepts.length === 0) return 0;
  return concepts.filter((concept) => haystack.includes(concept)).length / concepts.length;
};

const priorityForKnowledge = (item: KnowledgeItem): ContextEntry["priority"] => {
  if (item.severity === "blocker") return "mandatory";
  if (item.kind === "decision" && item.confidence >= 0.8) return "high";
  if (item.kind === "rule" && item.confidence >= 0.7) return "high";
  if (item.kind === "preference") return "medium";
  return item.confidence >= 0.7 ? "medium" : "low";
};

const evidenceFor = (ids: string[], evidence: EvidenceRecord[]): EvidenceRecord[] =>
  ids.map((id) => evidence.find((record) => record.id === id)).filter((record): record is EvidenceRecord => Boolean(record));

export class TaskPreparationService {
  prepare(input: {
    repository: RepositorySummary;
    task: string;
    explicitPaths?: string[];
    snapshot: DashboardSnapshot;
    evidence: EvidenceRecord[];
    entities: CodeEntity[];
    relationships: CodeRelationship[];
    regressions: RegressionRecord[];
  }): ContextPackage {
    const concepts = taskTokens(input.task);
    const ticketReferences = [...input.task.matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)].map(([reference]) => reference);
    const graph = new ImpactGraph(input.entities, input.relationships);
    const candidates = graph.findEntities(input.task).filter((entity) => !entity.metadata.placeholder).slice(0, 6);
    const explicitEntities = input.entities.filter((entity) => input.explicitPaths?.includes(entity.path));
    const seedEntities = [...new Map([...explicitEntities, ...candidates].map((entity) => [entity.id, entity])).values()].slice(0, 8);
    const impact = graph.traverse(
      seedEntities.map((entity) => entity.id),
      { maxDepth: 3, maximumNodes: 30, minimumConfidence: 0.42 }
    );
    const candidatePaths = [...new Set([...seedEntities.map((entity) => entity.path), ...(input.explicitPaths ?? [])])];
    const symbols = seedEntities.filter((entity) => entity.type !== "file").map((entity) => entity.qualifiedName);
    const language = [...new Set(seedEntities.map((entity) => entity.language))].length === 1 ? seedEntities[0]?.language : undefined;
    const scopeInput = {
      repository: input.repository,
      organisation: input.snapshot.organisation.slug,
      paths: candidatePaths,
      symbols,
      ...(language ? { language } : {}),
      integration: input.task,
      subsystem: input.task
    };

    const applicableKnowledge = sortByPrecedence(
      input.snapshot.knowledge.filter((item) => {
        if (!["active", "challenged"].includes(item.status)) return false;
        const directlyRelevant = relevance(`${item.title} ${item.statement} ${item.rationale}`, concepts) >= 0.12;
        const scopedToTask = Boolean(
          item.scope.paths?.length || item.scope.symbols?.length || item.scope.subsystem || item.scope.language ||
          item.scope.framework || item.scope.integration || item.scope.ticketType
        );
        return scopeApplies(item.scope, scopeInput) && (directlyRelevant || scopedToTask);
      })
    ).slice(0, 12);

    const toEntry = (item: KnowledgeItem): ContextEntry => ({
      id: item.id,
      priority: priorityForKnowledge(item),
      confidence: item.status === "challenged" ? Number((item.confidence * 0.75).toFixed(2)) : item.confidence,
      reason: this.#reasonForKnowledge(item, candidatePaths, symbols, concepts),
      scope: item.scope,
      evidence: evidenceFor(item.evidenceIds, input.evidence),
      item
    });

    const policies = input.snapshot.policies
      .filter((policy) => policy.enabled && scopeApplies(policy.scope, scopeInput))
      .map((policy): ContextEntry<PolicyRecord> => ({
        id: policy.id,
        priority: policy.severity === "blocker" ? "mandatory" : "high",
        confidence: 1,
        reason: `Explicit ${policy.scope.repository ? "repository" : "organisation"} policy applies to the candidate paths.`,
        scope: policy.scope,
        evidence: [],
        item: policy
      }));

    const relevantRegressions = input.regressions
      .filter((regression) =>
        regression.affectedEntities.some((entity) =>
          [...symbols, ...seedEntities.map((item) => item.name)].some((candidate) => candidate.includes(entity) || entity.includes(candidate))
        )
      )
      .map((regression): ContextEntry<RegressionRecord> => ({
        id: regression.id,
        priority: regression.severity === "blocker" ? "mandatory" : "high",
        confidence: 0.95,
        reason: `The task touches ${regression.affectedEntities.join(", ")}, which appears in this historical regression.`,
        scope: { repository: `${input.repository.owner}/${input.repository.name}`, symbols: regression.affectedEntities },
        evidence: evidenceFor(regression.evidenceIds, input.evidence),
        item: regression
      }));

    const relatedEvidence = input.evidence.filter((record) => {
      const text = `${record.externalId} ${record.title ?? ""} ${record.content}`.toLowerCase();
      return ticketReferences.some((reference) => text.includes(reference.toLowerCase())) || relevance(text, concepts) >= 0.24;
    });

    const tests = graph.testsFor(seedEntities.map((entity) => entity.id));
    const recommendedTests = [...new Map(tests.map((test) => [test.entity.path, test])).values()]
      .slice(0, 8)
      .map((test) => ({
        path: test.entity.path,
        confidence: test.confidence,
        reason: test.viaRelationship === "historically_changes_with" ? "Historically changes with an affected symbol" : test.reason
      }));

    const affectedAreas = [...new Map(impact.map((node) => [node.entity.path, node])).values()]
      .filter((node) => !candidatePaths.includes(node.entity.path))
      .slice(0, 12)
      .map((node) => ({ name: node.entity.qualifiedName, confidence: node.confidence, reason: node.reason }));

    const unknowns = impact.length === 0
      ? [
          {
            statement: "Lore could not prove downstream consumers from the indexed graph.",
            reason: "No relationship passed the bounded traversal confidence threshold.",
            suggestion: "Index the latest commit and inspect dynamic service/container configuration."
          }
        ]
      : [
          {
            statement: "Dynamic service resolution may expose additional consumers.",
            reason: "Static analysis cannot resolve every runtime container alias.",
            suggestion: "Search runtime container configuration before changing public return semantics."
          }
        ];

    return {
      id: newUuid(),
      task: { text: input.task, ticketReferences, concepts },
      repository: input.repository,
      candidateFiles: seedEntities
        .filter((entity, index, all) => all.findIndex((candidate) => candidate.path === entity.path) === index)
        .map((entity, index) => ({
          path: entity.path,
          confidence: Number(Math.max(0.55, 0.98 - index * 0.07).toFixed(2)),
          reason: `Matched task concepts in ${entity.qualifiedName}`
        })),
      candidateSymbols: seedEntities
        .filter((entity) => entity.type !== "file")
        .map((entity, index) => ({
          symbol: entity.qualifiedName,
          path: entity.path,
          confidence: Number(Math.max(0.5, 0.96 - index * 0.07).toFixed(2)),
          reason: `Symbol name or path matches: ${concepts.filter((concept) => `${entity.qualifiedName} ${entity.path}`.toLowerCase().includes(concept)).join(", ")}`
        })),
      affectedAreas,
      rules: applicableKnowledge.filter((item) => item.kind === "rule").map(toEntry),
      decisions: applicableKnowledge.filter((item) => item.kind === "decision" || item.kind === "fact").map(toEntry),
      policies,
      preferences: applicableKnowledge.filter((item) => item.kind === "preference").map(toEntry),
      historicalRegressions: relevantRegressions,
      relatedPullRequests: relatedEvidence.filter((record) => record.type === "pull_request" || record.type === "review_comment").slice(0, 8),
      relatedTickets: relatedEvidence.filter((record) => record.type === "ticket").slice(0, 8),
      recommendedTests,
      unknowns,
      warnings: applicableKnowledge
        .filter((item) => item.status === "challenged")
        .map((item) => ({ severity: "warning", message: `${item.title} is challenged`, reason: "Recent evidence conflicts with this item." })),
      generatedAt: new Date().toISOString()
    };
  }

  #reasonForKnowledge(item: KnowledgeItem, paths: string[], symbols: string[], concepts: string[]): string {
    const matchingSymbol = item.scope.symbols?.find((symbol) => symbols.includes(symbol));
    if (matchingSymbol) return `The task touches ${matchingSymbol}, which is explicitly in this item's scope.`;
    const matchingPath = item.scope.paths?.find((path) => paths.some((candidate) => candidate.includes(path.replaceAll("**", ""))));
    if (matchingPath) return `The candidate code falls within the scoped path ${matchingPath}.`;
    const matchingConcept = concepts.find((concept) => `${item.title} ${item.statement}`.toLowerCase().includes(concept));
    return matchingConcept ? `The knowledge directly mentions the task concept “${matchingConcept}”.` : "Ranked by scoped repository relevance.";
  }
}
