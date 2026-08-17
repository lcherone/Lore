import { describe, expect, it } from "vitest";
import { createDemoSnapshot, getDemoEvidence } from "@lore/shared/demo-data.js";
import { createDemoCodeGraph } from "@lore/shared/demo-graph.js";

describe("public demo data", () => {
  it("contains only fictional, generic screenshot content", () => {
    const content = JSON.stringify({
      snapshot: createDemoSnapshot(),
      evidence: getDemoEvidence(),
      graph: createDemoCodeGraph()
    });

    expect(content).not.toMatch(/soho(?:-home| home)?/i);
    expect(content).not.toMatch(/\bD3R\b/i);
    expect(content).not.toMatch(/\bSS3?-\d+\b/i);
    expect(content).not.toMatch(/Avalara|Business Central/i);
    expect(content).not.toContain("/clients/");
  });
});
