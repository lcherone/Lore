import { describe, expect, it } from "vitest";
import { parseGitHubRepositoryReference } from "../../apps/web/src/github-repository.js";

describe("GitHub repository references", () => {
  it.each([
    ["example-org/commerce-platform", { owner: "example-org", name: "commerce-platform" }],
    ["https://github.com/example-org/commerce-platform", { owner: "example-org", name: "commerce-platform" }],
    ["https://github.com/example-org/commerce-platform.git/", { owner: "example-org", name: "commerce-platform" }]
  ])("parses %s", (value, expected) => {
    expect(parseGitHubRepositoryReference(value)).toEqual(expected);
  });

  it.each(["", "example-org", "https://example.com/example-org/commerce-platform", "example-org/commerce-platform/extra"])(
    "rejects %s",
    (value) => expect(() => parseGitHubRepositoryReference(value)).toThrow()
  );
});
