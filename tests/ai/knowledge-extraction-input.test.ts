import { describe, expect, it } from "vitest";
import { KnowledgeExtractionService, MockAIProvider } from "@lore/ai/index.js";
import type { EvidenceRecord } from "@lore/shared/types.js";

describe("knowledge extraction input", () => {
  it("sends a bounded authored PR view instead of the retained template and raw diff", async () => {
    let received = "";
    const provider = new MockAIProvider((request) => {
      received = request.untrustedSourceContent;
      return { candidates: [] };
    });
    const evidence: EvidenceRecord = {
      id: "evidence-1",
      organisationId: "organisation",
      repositoryId: "repository",
      type: "pull_request",
      provider: "github",
      externalId: "owner/repository:pr:123",
      title: "PR #123: Safe importer",
      content: `# Change Summary\n\nThe importer rolls back unless live mode is confirmed.\n\n## Checks\n- [x] Tested locally\n\n## SOX\n- [ ] Update the deployment changelog\n\ndiff --git a/import.php b/import.php\n+runImporter();`,
      occurredAt: "2026-08-16T00:00:00.000Z",
      metadata: { retention: { rawDiffRetained: true } }
    };

    await new KnowledgeExtractionService(provider).extract([evidence]);

    const sent = JSON.parse(received) as Array<{ content: string; metadata: Record<string, unknown> }>;
    expect(sent[0]!.content).toBe("The importer rolls back unless live mode is confirmed.");
    expect(sent[0]!.metadata).toMatchObject({
      extractionView: { rawSourceRetained: true, sourceContentOmitted: true }
    });
  });
});
