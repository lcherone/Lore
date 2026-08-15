import { describe, expect, it } from "vitest";
import { deterministicUuid, isUuid, newUuid } from "@lore/shared/ids.js";

describe("persistent identifiers", () => {
  it("creates valid random UUIDs", () => {
    expect(isUuid(newUuid())).toBe(true);
    expect(newUuid()).not.toBe(newUuid());
  });

  it("creates stable namespace-isolated UUIDs", () => {
    const first = deterministicUuid("lore.code.entity", "repo:a.ts:Widget");
    expect(isUuid(first)).toBe(true);
    expect(deterministicUuid("lore.code.entity", "repo:a.ts:Widget")).toBe(first);
    expect(deterministicUuid("lore.code.relationship", "repo:a.ts:Widget")).not.toBe(first);
    expect(deterministicUuid("lore.code.entity", "other-repo:a.ts:Widget")).not.toBe(first);
  });
});
