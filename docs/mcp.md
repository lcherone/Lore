<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="features.md"><strong>Features</strong></a> ·
  <a href="onboarding.md"><strong>Setup</strong></a>
</p>

# MCP setup

Lore’s MCP server gives Codex, Claude, Cursor, and other MCP clients the same evidence-backed context, rules, decisions, impact analysis, and change verification as the CLI. It uses stdio, so it does not open another network port.

For a task-by-task walkthrough with copyable prompts, expected tool calls, project configuration, and an `AGENTS.md` policy, follow [Use Lore with Codex](codex-tutorial.md).

## Full local setup

The local path does not need a Lore API token. The loopback-only Lore service already uses your single `GITHUB_TOKEN` identity.

First, start Lore and connect the GitHub repository in the browser:

```bash
cd /Users/dev/Lore
npm run local:up
open http://localhost:5173/#repositories
```

Select the repository from the token-backed repository picker. Lore immediately queues the configured initial PR import and recurring sync.

Then connect the local checkout and build its code graph:

```bash
cd /absolute/path/to/commerce-platform
node /Users/dev/Lore/dist/cli.js connect OWNER/REPOSITORY
node /Users/dev/Lore/dist/cli.js index
```

`connect` discovers the active organisation and repository IDs from the local service. It writes private, mode-600 files under `.lore/` and adds `.lore/` to the checkout’s local Git exclude. Nothing needs to be copied into `.env`.

Every subsequent CLI/MCP request sends the organisation recorded in that checkout's config. Local Lore validates that your GitHub-backed account is still a member before using it, so different checkouts can safely target different local organisations without depending on whichever organisation is open in the browser.

Verify the real MCP protocol end to end:

```bash
cd /Users/dev/Lore
npm run mcp:check -- /absolute/path/to/commerce-platform
```

The check launches the built stdio server through the official MCP client SDK, lists its tools, calls `lore_search`, confirms that the result came from persistent service authority, and verifies that `lore_find_history` returns object-backed structured content.

## Client configuration

Build Lore once after installing or updating it:

```bash
cd /Users/dev/Lore
npm run build
```

### Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.lore]
command = "node"
args = ["/Users/dev/Lore/dist/mcp.js"]
required = true
startup_timeout_sec = 20
tool_timeout_sec = 120

[mcp_servers.lore.env]
LORE_REPOSITORY_PATH = "/absolute/path/to/commerce-platform"
```

### Claude Desktop or Cursor

Add this server to the client’s MCP JSON configuration:

```json
{
  "mcpServers": {
    "lore": {
      "command": "node",
      "args": ["/Users/dev/Lore/dist/mcp.js"],
      "env": {
        "LORE_REPOSITORY_PATH": "/absolute/path/to/commerce-platform"
      }
    }
  }
}
```

Use absolute paths. Restart the MCP client after changing its configuration.

Lore advertises server-wide instructions asking Codex to prepare context before edits and verify the final change before completion. This makes the intended workflow discoverable to Codex; add the project `AGENTS.md` policy from the [Codex tutorial](codex-tutorial.md#5-make-lore-mandatory-for-the-project) when the workflow must be an explicit repository rule.

## Copyable setup prompt

Paste this into an agent that can edit its own MCP configuration:

```text
Set up the Lore MCP server for this repository.

Lore is installed at /Users/dev/Lore and its local service is at
http://127.0.0.1:3001. Use node /Users/dev/Lore/dist/mcp.js as a stdio MCP
server and set LORE_REPOSITORY_PATH to the absolute path of this checkout.

Before editing, call lore_prepare_task with the complete task and inspect all
mandatory rules, high-priority decisions, regressions, tests, provenance, and
unknowns. Use lore_search, lore_get_rules, lore_get_decisions,
lore_lookup_symbol, lore_find_history, and lore_get_impact when needed. Before
claiming completion, call lore_verify_change and resolve or clearly report every
blocker. Never treat advisory knowledge as a mandatory policy, and never invent
context when Lore reports an unknown or service error.
```

## Available tools

| Tool | Purpose |
| --- | --- |
| `lore_prepare_task` | Rank relevant code, evidence, rules, decisions, regressions, and tests before work starts. |
| `lore_get_context` | Read the latest prepared context with priority and provenance preserved. |
| `lore_search` | Search active knowledge, evidence, and indexed symbols. |
| `lore_lookup_symbol` | Resolve files and symbols from the deterministic local graph. |
| `lore_find_history` | Read bounded local Git history without shell interpolation. Structured results contain `path`, `count`, and `commits`. |
| `lore_get_rules` | Return active rules and explicit policies separately from preferences. |
| `lore_get_decisions` | Return evidence-backed decisions and their scope. |
| `lore_get_impact` | Traverse bounded downstream relationships with confidence and depth limits. |
| `lore_verify_change` | Inspect the current diff against context, policies, impact, regressions, and tests. |
| `lore_explain` | Explain a file or symbol from code, history, consumers, tests, and evidence. |
| `lore_propose_knowledge` | Validate a proposal; it never bypasses human review or directly activates knowledge. |

## Remote/SaaS service mode

A shared deployment must not trust anonymous loopback traffic. Create an organisation-scoped token in **Settings → Agent & MCP access**, save it once to a mode-600 file, then connect explicitly:

```bash
chmod 600 ~/.config/lore/token
node /path/to/lore/dist/cli.js connect \
  --api-url https://lore.example.com \
  --organisation-id <organisation-id> \
  --repository-id <repository-id> \
  --token-file ~/.config/lore/token
```

The token is bound to its user and organisation, can be revoked in Settings, and cannot manage the account that created it.

## Troubleshooting

- `not connected`: start Lore with `npm run local:start`, then run `connect` again from the target checkout.
- `repository is not connected`: add it through the browser’s token-backed picker first.
- `MCP tool error`: run `npm run local:check`, then inspect `npm run local:logs`.
- `structuredContent returned an array instead of an object`: rebuild with `npm run build`, restart the MCP client so it launches the new server bundle, then run `npm run mcp:check -- /absolute/path/to/checkout`.
- `service-backed structured content` check fails: rebuild with `npm run build` and confirm `.lore/config.json` says `"mode": "service"`.
- empty symbol results: run `node /Users/dev/Lore/dist/cli.js index` from the checkout.
- GitHub history is empty: the PAT may not have repository access, organisation approval, or SAML SSO authorisation; run `npm run github:check -- OWNER/REPOSITORY`.

MCP is a context and verification surface, not the enforcement boundary. Active knowledge still requires governed ingestion, schema validation, evidence linkage, and human review.
