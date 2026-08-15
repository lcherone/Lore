import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@lore/core": `${root}packages/core/src`,
      "@lore/shared": `${root}packages/shared/src`,
      "@lore/database": `${root}packages/database/src`,
      "@lore/git": `${root}packages/git/src`,
      "@lore/analysis": `${root}packages/analysis/src`,
      "@lore/knowledge": `${root}packages/knowledge/src`,
      "@lore/impact": `${root}packages/impact/src`,
      "@lore/policy": `${root}packages/policy/src`,
      "@lore/context": `${root}packages/context/src`,
      "@lore/reporting": `${root}packages/reporting/src`,
      "@lore/github": `${root}packages/github/src`,
      "@lore/ai": `${root}packages/ai/src`
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"]
    }
  }
});
