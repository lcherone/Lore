import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("disconnected product recovery", () => {
  it("keeps production recovery instructions separate from development mode", async () => {
    const source = await readFile("apps/web/src/app.tsx", "utf8");

    expect(source).toContain("import.meta.env.DEV");
    expect(source).toContain("npm run local:check");
    expect(source).toContain("npm run local:start");
  });
});
