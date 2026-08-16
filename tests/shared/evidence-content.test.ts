import { describe, expect, it } from "vitest";
import { createKnowledgeEvidenceView } from "@lore/shared/evidence-content.js";

describe("knowledge evidence view", () => {
  it("keeps the authored PR summary while removing template sections and the raw diff", () => {
    const view = createKnowledgeEvidenceView({
      type: "pull_request",
      content: `# Change Summary\n\nJira: https://jira.example.test/SS-1234\n\n*[ What have you changed and why? ]*\n\nThe importer rolls back unless live mode is explicitly confirmed.\n\n## Staging\nhttps://staging.example.test\n\n## Checks\n### Functional\n- [x] Pages load\n\n## SOX\n- [ ] Jira ticket must be ready to go live\n\n**NB:** Update the deployment changelog.\n\n## Links\n- [Code review process](https://example.test)\n\ndiff --git a/import.php b/import.php\n+runImporter();`
    });

    expect(view.text).toContain("importer rolls back unless live mode");
    expect(view.text).not.toContain("What have you changed");
    expect(view.text).not.toContain("staging.example.test");
    expect(view.text).not.toContain("jira.example.test");
    expect(view.text).not.toContain("Pages load");
    expect(view.text).not.toContain("deployment changelog");
    expect(view.text).not.toContain("diff --git");
    expect(view.omittedSourceContent).toBe(true);
  });

  it("leaves ordinary communication evidence intact", () => {
    const content = "We agreed that refund changes must retain independent address roles.";
    expect(createKnowledgeEvidenceView({ type: "communication", content })).toEqual({
      text: content,
      omittedSourceContent: false
    });
  });
});
