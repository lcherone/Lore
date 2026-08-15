import type { CodeEntity, CodeRelationship } from "@lore/shared/types.js";

export interface TraversalOptions {
  maxDepth: number;
  maximumNodes: number;
  minimumConfidence: number;
  relationshipTypes?: string[];
}

export interface ImpactNode {
  entity: CodeEntity;
  depth: number;
  confidence: number;
  reason: string;
  viaRelationship: string;
}

const relationshipWeight: Record<string, number> = {
  calls: 0.98,
  called_by: 0.98,
  imports: 0.92,
  extends: 0.98,
  implements: 0.98,
  instantiates: 0.95,
  tests: 0.99,
  tested_by: 0.99,
  produces_payload: 0.94,
  consumes_payload: 0.94,
  historically_changes_with: 0.82,
  related_ticket: 0.7,
  related_pull_request: 0.7,
  ai_inference: 0.55
};

export class ImpactGraph {
  readonly #entities = new Map<string, CodeEntity>();
  readonly #outgoing = new Map<string, CodeRelationship[]>();
  readonly #incoming = new Map<string, CodeRelationship[]>();

  public constructor(entities: CodeEntity[], relationships: CodeRelationship[]) {
    for (const entity of entities) this.#entities.set(entity.id, entity);
    for (const relationship of relationships) {
      const outgoing = this.#outgoing.get(relationship.sourceEntityId) ?? [];
      outgoing.push(relationship);
      this.#outgoing.set(relationship.sourceEntityId, outgoing);
      const incoming = this.#incoming.get(relationship.targetEntityId) ?? [];
      incoming.push(relationship);
      this.#incoming.set(relationship.targetEntityId, incoming);
    }
  }

  findEntities(query: string): CodeEntity[] {
    const terms = query.toLowerCase().split(/[^a-z0-9_]+/).filter((term) => term.length > 2);
    return [...this.#entities.values()]
      .map((entity) => {
        const haystack = `${entity.qualifiedName} ${entity.path}`.toLowerCase();
        const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
        return { entity, score };
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.entity.path.localeCompare(right.entity.path))
      .map(({ entity }) => entity);
  }

  traverse(seedIds: string[], options: TraversalOptions): ImpactNode[] {
    const queue = seedIds.map((id) => ({ id, depth: 0, confidence: 1 }));
    const best = new Map<string, number>(seedIds.map((id) => [id, 1]));
    const results: ImpactNode[] = [];

    while (queue.length > 0 && results.length < options.maximumNodes) {
      const current = queue.shift();
      if (!current || current.depth >= options.maxDepth) continue;
      const edges = [
        ...(this.#outgoing.get(current.id) ?? []).map((edge) => ({ edge, nextId: edge.targetEntityId, direction: "outgoing" })),
        ...(this.#incoming.get(current.id) ?? []).map((edge) => ({ edge, nextId: edge.sourceEntityId, direction: "incoming" }))
      ];

      for (const { edge, nextId, direction } of edges) {
        if (options.relationshipTypes && !options.relationshipTypes.includes(edge.relationshipType)) continue;
        const confidence =
          current.confidence * edge.confidence * (relationshipWeight[edge.relationshipType] ?? 0.65) * Math.pow(0.88, current.depth);
        if (confidence < options.minimumConfidence || confidence <= (best.get(nextId) ?? 0)) continue;
        const entity = this.#entities.get(nextId);
        if (!entity) continue;
        best.set(nextId, confidence);
        const subject = this.#entities.get(current.id)?.qualifiedName ?? current.id;
        const reason =
          direction === "incoming"
            ? `${entity.qualifiedName} ${edge.relationshipType.replaceAll("_", " ")} ${subject}`
            : `${subject} ${edge.relationshipType.replaceAll("_", " ")} ${entity.qualifiedName}`;
        results.push({
          entity,
          depth: current.depth + 1,
          confidence: Number(confidence.toFixed(2)),
          reason,
          viaRelationship: edge.relationshipType
        });
        queue.push({ id: nextId, depth: current.depth + 1, confidence });
        if (results.length >= options.maximumNodes) break;
      }
    }

    return results.sort((left, right) => right.confidence - left.confidence || left.depth - right.depth);
  }

  testsFor(entityIds: string[]): ImpactNode[] {
    return this.traverse(entityIds, {
      maxDepth: 2,
      maximumNodes: 30,
      minimumConfidence: 0.45,
      relationshipTypes: ["tests", "tested_by", "historically_changes_with"]
    }).filter((result) => result.entity.type === "test");
  }
}

