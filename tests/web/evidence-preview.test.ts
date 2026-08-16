import { describe, expect, it } from "vitest";
import { createEvidencePreview } from "../../apps/web/src/evidence-preview.js";

describe("candidate evidence previews", () => {
  it("selects the source passage most relevant to the candidate", () => {
    const source = [
      "Navigation and release notes changed in this pull request.",
      "The checkout service must keep refund tax address roles independent.",
      "Documentation screenshots were refreshed for the release."
    ].join("\n\n");

    const preview = createEvidencePreview(
      `${source}\n\n${"Unrelated implementation detail. ".repeat(30)}`,
      "Refund tax addresses must use independent roles",
      180
    );

    expect(preview.truncated).toBe(true);
    expect(preview.text).toContain("refund tax address roles independent");
    expect(preview.text).not.toContain("Unrelated implementation detail");
  });

  it("removes scraped page markup and bounds the default view", () => {
    const source = `<html><head><style>.hidden { display: none }</style></head><body>
      <nav>Large navigation shell</nav>
      <main><p>Repository interfaces define the service boundary.</p>${"<p>Boilerplate content.</p>".repeat(80)}</main>
      <script>window.untrusted = true</script>
    </body></html>`;

    const preview = createEvidencePreview(source, "repository interfaces service boundary", 160);

    expect(preview.truncated).toBe(true);
    expect(preview.text).toContain("Repository interfaces define the service boundary");
    expect(preview.text).not.toContain("<main>");
    expect(preview.text).not.toContain("window.untrusted");
    expect(preview.text.length).toBeLessThanOrEqual(160);
  });

  it("keeps short retained evidence intact", () => {
    expect(createEvidencePreview("A concise reviewer decision.", "reviewer decision")).toEqual({
      text: "A concise reviewer decision.",
      truncated: false
    });
  });
});
