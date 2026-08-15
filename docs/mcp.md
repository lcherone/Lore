# MCP integration

Run the local stdio server with:

```bash
npm run mcp
```

Or after installing the CLI:

```json
{
  "mcpServers": {
    "lore": {
      "command": "lore-mcp",
      "args": [],
      "env": { "LORE_REPOSITORY_PATH": "/absolute/path/to/repository" }
    }
  }
}
```

Tools are intentionally narrow: `lore_prepare_task`, `lore_get_context`, `lore_search`, `lore_explain`, `lore_get_impact`, `lore_get_rules`, and `lore_verify_change`. Responses separate mandatory, high-priority, advisory, warnings, provenance, and unknowns.

MCP is a deeper-query surface, not the enforcement boundary. The CLI/session wrapper prepares context before an agent starts and runs verification at completion.

