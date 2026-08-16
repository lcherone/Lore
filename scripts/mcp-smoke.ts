import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repositoryPath = resolve(process.argv[2] ?? process.env.LORE_REPOSITORY_PATH ?? process.cwd());
const serverPath = resolve(process.cwd(), "dist/mcp.js");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, LORE_REPOSITORY_PATH: repositoryPath },
  stderr: "pipe"
});
const client = new Client({ name: "lore-mcp-smoke", version: "0.1.0" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const required = new Set(["lore_prepare_task", "lore_search", "lore_get_rules", "lore_find_history", "lore_verify_change"]);
  const missing = [...required].filter((name) => !tools.tools.some((tool) => tool.name === name));
  if (missing.length) throw new Error(`MCP tools missing: ${missing.join(", ")}`);
  const result = await client.callTool({ name: "lore_search", arguments: { query: "engineering" } });
  if (result.isError) {
    const content = Array.isArray(result.content) ? result.content : [];
    const detail = content
      .flatMap((item: unknown) =>
        item && typeof item === "object" && "type" in item && item.type === "text" && "text" in item && typeof item.text === "string"
          ? [item.text]
          : []
      )
      .join(" ")
      .slice(0, 500);
    throw new Error(`lore_search returned an MCP tool error${detail ? `: ${detail}` : ""}`);
  }
  const structured = result.structuredContent as Record<string, unknown> | undefined;
  if (structured?.mode !== "service") throw new Error("lore_search did not report persistent service authority");
  const historyResult = await client.callTool({ name: "lore_find_history", arguments: { limit: 2 } });
  if (historyResult.isError) throw new Error("lore_find_history returned an MCP tool error");
  if (!historyResult.structuredContent || Array.isArray(historyResult.structuredContent)) {
    throw new Error("lore_find_history structuredContent must be an object");
  }
  const history = historyResult.structuredContent as Record<string, unknown>;
  if (!Array.isArray(history.commits) || typeof history.count !== "number" || history.count !== history.commits.length) {
    throw new Error("lore_find_history did not return the documented commits/count contract");
  }
  process.stdout.write(`✓ MCP handshake completed for ${repositoryPath}\n`);
  process.stdout.write(`✓ ${tools.tools.length} Lore tools advertised\n`);
  process.stdout.write("✓ lore_search returned service-backed structured content\n");
  process.stdout.write(`✓ lore_find_history returned ${history.count} commit(s) as object-backed structured content\n`);
} finally {
  await client.close();
}
