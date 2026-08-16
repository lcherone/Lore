import { describe, expect, it } from "vitest";
import { createLoreStore, InMemoryLoreStore } from "@lore/database/index.js";

describe("runtime store selection", () => {
  it("uses fixtures only when demo mode is explicitly enabled", () => {
    expect(createLoreStore({ DEMO_MODE: "true", NODE_ENV: "development" })).toBeInstanceOf(InMemoryLoreStore);
  });

  it("refuses demo fixtures in production", () => {
    expect(() => createLoreStore({ DEMO_MODE: "true", NODE_ENV: "production" }))
      .toThrow("Demo fixtures cannot be used by the production Lore runtime");
  });

  it("fails closed instead of silently falling back to demo storage", () => {
    expect(() => createLoreStore({})).toThrow("DATABASE_URL is required for the persistent Lore runtime");
  });
});
