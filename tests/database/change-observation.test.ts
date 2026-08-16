import { describe, expect, it } from "vitest";
import { createChangeObservation } from "../../packages/database/src/change-observation.js";
import { isUuid } from "@lore/shared/ids.js";
import type { SafetyReport } from "@lore/shared/types.js";

const report = (changedFiles: SafetyReport["changedFiles"]): SafetyReport => ({
  id: "bd1b6430-0f5f-431f-93d8-73d9dbef62db",
  sessionId: "45f7bc67-6f80-4215-a0a1-a7ae79154721",
  contextId: "2d7969cb-09fe-46f8-a421-88eb016375b3",
  baseCommit: "base-sha",
  currentCommit: "current-sha",
  task: "Prove change observation provenance",
  repositoryId: "ed30d980-c929-4a98-a6ad-7d358473a639",
  repositoryName: "lore/lore",
  changedFiles,
  changedSymbols: [],
  affectedCode: [],
  applicablePolicies: [],
  applicableRules: [],
  relevantDecisions: [],
  historicalRegressions: [],
  testsChanged: [],
  testsRecommended: [],
  potentialMissingTests: [],
  findings: [],
  warnings: [],
  blockers: [],
  unknowns: [],
  risk: "LOW",
  riskReasons: [],
  evidenceCount: 0,
  createdAt: "2026-08-16T00:00:00.000Z"
});

describe("change observation provenance", () => {
  it("creates a canonical immutable manifest without retaining patch content", () => {
    const files = [
      {
        path: "z.ts",
        status: "modified" as const,
        additions: 1,
        deletions: 0,
        patch: "+const secret = 'not retained';"
      },
      {
        path: "a.ts",
        status: "renamed" as const,
        previousPath: "old.ts",
        additions: 0,
        deletions: 0
      }
    ];
    const input = {
      organisationId: "27e32c13-4941-465d-b84a-ad1027d8f0f7",
      sessionId: "45f7bc67-6f80-4215-a0a1-a7ae79154721",
      contextId: "2d7969cb-09fe-46f8-a421-88eb016375b3",
      contextRevision: 2,
      report: report(files)
    };
    const observation = createChangeObservation(input);
    const reordered = createChangeObservation({ ...input, report: report([...files].reverse()) });

    expect(isUuid(observation.id)).toBe(true);
    expect(observation.files.map((file) => file.path)).toEqual(["a.ts", "z.ts"]);
    expect(observation.files[1]?.patchHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(observation.files)).not.toContain("not retained");
    expect(reordered.contentHash).toBe(observation.contentHash);
  });
});
