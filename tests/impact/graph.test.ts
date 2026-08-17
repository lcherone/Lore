import { describe, expect, it } from "vitest";
import { addGitHistoryRelationships } from "@lore/analysis/index.js";
import { calculateCoChangePairs, coChangeConfidence, ImpactGraph } from "@lore/impact/index.js";
import { createDemoCodeGraph } from "@lore/shared/demo-graph.js";

describe("bounded impact graph", () => {
  it("respects maximum traversal depth", () => {
    const data = createDemoCodeGraph();
    const graph = new ImpactGraph(data.entities, data.relationships);
    const oneHop = graph.traverse(["entity_address_code"], { maxDepth: 1, maximumNodes: 50, minimumConfidence: 0.1 });
    expect(oneHop.every((item) => item.depth === 1)).toBe(true);
    expect(oneHop.some((item) => item.entity.id === "entity_create_tax")).toBe(false);
    const deeper = graph.traverse(["entity_address_code"], { maxDepth: 3, maximumNodes: 50, minimumConfidence: 0.1 });
    expect(deeper.some((item) => item.entity.id === "entity_create_tax")).toBe(true);
  });

  it("discards co-change relationships with insufficient samples", () => {
    expect(coChangeConfidence(1, 2)).toBe(0);
    expect(calculateCoChangePairs([{ sha: "1", occurredAt: "2026-01-01", paths: ["a.php", "b.php"] }])).toEqual([]);
  });

  it("adds explainable Git-history edges only for indexed files", () => {
    const data = createDemoCodeGraph();
    const commits = Array.from({ length: 6 }, (_, index) => ({
      sha: String(index),
      occurredAt: `2026-0${index + 1}-01T00:00:00.000Z`,
      paths: ["src/Tax/Provider/AddressRoleCode.php", "tests/Tax/RefundTaxTransactionTest.php", "missing.php"]
    }));
    const enriched = addGitHistoryRelationships("repo_example_commerce", data.entities, [], commits);
    expect(enriched).toHaveLength(1);
    expect(enriched[0]!.source).toBe("git_history");
    expect(enriched[0]!.metadata).toMatchObject({ sampleCount: 6, coChangeCount: 6 });
  });
});
