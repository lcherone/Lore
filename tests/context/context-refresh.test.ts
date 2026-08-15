import { describe, expect, it } from "vitest";
import { TaskPreparationService } from "@lore/context/index.js";
import { createDemoSnapshot, getDemoEvidence } from "@lore/shared/demo-data.js";
import { createDemoCodeGraph } from "@lore/shared/demo-graph.js";

describe("progressive context", () => {
  it("adds context when an agent touches a newly observed file", () => {
    const snapshot = createDemoSnapshot();
    const repository = snapshot.repositories[0]!;
    const graph = createDemoCodeGraph();
    const service = new TaskPreparationService();
    const initial = service.prepare({ repository, task: "Update address handling", snapshot, evidence: getDemoEvidence(), entities: graph.entities, relationships: graph.relationships, regressions: graph.regressions });
    const refreshed = service.prepare({ repository, task: "Update address handling", explicitPaths: ["src/Tax/RefundTaxTransaction.php"], snapshot, evidence: getDemoEvidence(), entities: graph.entities, relationships: graph.relationships, regressions: graph.regressions });
    expect(refreshed.candidateFiles.some((file) => file.path === "src/Tax/RefundTaxTransaction.php")).toBe(true);
    expect(refreshed.candidateFiles).not.toEqual(initial.candidateFiles);
    expect(refreshed.historicalRegressions.some((item) => item.item.title.includes("refund"))).toBe(true);
  });
});
