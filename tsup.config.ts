import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    api: "apps/api/src/server.ts",
    cli: "apps/cli/src/index.ts",
    mcp: "apps/mcp/src/index.ts",
    worker: "apps/worker/src/index.ts"
  },
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  splitting: false,
  sourcemap: true,
  clean: true,
  banner: {
    js: "#!/usr/bin/env node"
  }
});
