# MCP integration

Lore exposes the same bounded context and verification semantics used by the CLI as a local stdio MCP server.

Build the workspace, initialise the target checkout, then run:

```bash
npm run build
cd /absolute/path/to/repository
lore init --mode local
lore index
lore-mcp
```

Or configure an MCP client:

```json
{
  "mcpServers": {
    "lore": {
      "command": "lore-mcp",
      "args": [],
      "env": {
        "LORE_REPOSITORY_PATH": "/absolute/path/to/repository"
      }
    }
  }
}
```

The server reads `.lore/config.json`, so its authority is explicit:

- `local` uses only that checkout's locally indexed graph and Git history;
- `demo` uses the bundled scenario only after `lore init --mode demo`;
- `service` uses the configured Lore API for knowledge, context, evidence, sessions, and reports.

Lore never substitutes fixture data when a service is unavailable. Service errors are returned as tool errors with no fabricated result.

Available tools are `lore_prepare_task`, `lore_get_context`, `lore_search`, `lore_lookup_symbol`, `lore_find_history`, `lore_get_rules`, `lore_get_decisions`, `lore_get_impact`, `lore_verify_change`, `lore_explain`, and `lore_propose_knowledge`. Responses separate mandatory, high-priority, advisory, warnings, provenance, and unknowns.

`lore_propose_knowledge` validates a proposal against the local fixture only in explicit demo mode. In service mode, proposals enter through the evidence/extraction worker and human review workflow; MCP cannot directly mutate active knowledge.

MCP is a deeper-query surface, not the enforcement boundary. Use `lore agent codex "task"` for the verified interactive wrapper, or have another agent call prepare before edits and verify before completion.

