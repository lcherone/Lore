import { describe, expect, it } from "vitest";
import { parseGitHubRepositoryReference } from "../../apps/web/src/github-repository.js";

describe("GitHub repository references", () => {
  it.each([
    ["D3R/soho-home", { owner: "D3R", name: "soho-home" }],
    ["https://github.com/D3R/soho-home", { owner: "D3R", name: "soho-home" }],
    ["https://github.com/D3R/soho-home.git/", { owner: "D3R", name: "soho-home" }]
  ])("parses %s", (value, expected) => {
    expect(parseGitHubRepositoryReference(value)).toEqual(expected);
  });

  it.each(["", "D3R", "https://example.com/D3R/soho-home", "D3R/soho-home/extra"])(
    "rejects %s",
    (value) => expect(() => parseGitHubRepositoryReference(value)).toThrow()
  );
});
