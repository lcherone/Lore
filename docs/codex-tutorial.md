<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="mcp.md"><strong>MCP setup</strong></a> ·
  <a href="onboarding.md"><strong>Onboarding</strong></a>
</p>

# Use Lore with Codex: a complete example

This tutorial starts after Lore is running, the target checkout is connected and indexed, and the Lore MCP server has been added to Codex. It explains what “connected” means, how Codex decides to use Lore, the normal task workflow, and how to make that workflow a durable project rule.

Examples using the short `lore` terminal command assume the one-time installation below. MCP itself still runs `node /Users/dev/Lore/dist/mcp.js` and does not depend on the global CLI command.

```bash
cd /Users/dev/Lore
npm run cli:install
```

Lore does not replace Codex. Codex reads and changes the checkout; Lore supplies governed context, code-graph relationships, Git history, approved engineering knowledge, and an independent final-change check.

## The workflow in one minute

```text
Your task
   ↓
Codex calls lore_prepare_task
   ↓
Codex inspects rules, decisions, evidence, history, symbols, and impact
   ↓
Codex implements and tests the change
   ↓
Codex calls lore_verify_change
   ↓
Codex resolves blockers and reports evidence, warnings, and unknowns
```

Connecting MCP makes the tools available. Lore also advertises server instructions telling Codex to prepare before editing and verify before completion. A direct prompt or project `AGENTS.md` rule makes the workflow explicit and repeatable.

The [official OpenAI MCP documentation](https://developers.openai.com/codex/mcp/) explains that Codex reads MCP server instructions and supports project-scoped `.codex/config.toml` in trusted projects.

## 1. Confirm the connection

From a terminal, check that Codex knows about the server:

```bash
codex mcp list
```

Inside the Codex terminal UI, run:

```text
/mcp
```

You should see an enabled server named `lore`. In the Codex desktop app or IDE extension, open **Settings → MCP servers** and confirm Lore is enabled.

For Lore's local stdio transport, an `Auth` value such as `Unsupported` is expected: Codex starts a local process rather than performing MCP OAuth. Lore authenticates its loopback API requests from the connected checkout and local GitHub identity.

Then prove Lore itself against the checkout:

```bash
cd /Users/dev/Lore
npm run mcp:check -- /absolute/path/to/checkout
```

Expected result:

```text
✓ MCP handshake completed for /absolute/path/to/checkout
✓ Lore workflow instructions advertised to the MCP client
✓ 11 Lore tools advertised
✓ lore_search returned service-backed structured content
✓ lore_find_history returned 2 commit(s) as object-backed structured content
```

If configuration changed, restart Codex or reconnect the MCP server. A running Codex session can otherwise retain the old stdio process.

## 2. Understand the project-scoped configuration

A trusted repository can contain `.codex/config.toml`:

```toml
[mcp_servers.lore]
command = "node"
args = ["/Users/dev/Lore/dist/mcp.js"]
required = true
startup_timeout_sec = 20
tool_timeout_sec = 120

[mcp_servers.lore.env]
LORE_REPOSITORY_PATH = "/absolute/path/to/checkout"
```

Use an absolute checkout path. `required = true` makes Codex startup fail visibly if Lore cannot initialize instead of silently working without it. The checkout’s `.lore/config.json` selects the connected Lore organisation and repository; secrets do not belong in `.codex/config.toml`.

For a personal configuration shared by all Codex clients on the same machine, put the same server table in `~/.codex/config.toml`. A fixed `LORE_REPOSITORY_PATH` represents one checkout, so use a project-scoped configuration when working across many repositories.

## 3. Give Codex a real task

Open Codex from the target checkout and use a prompt like this:

```text
Use Lore for this task.

Investigate checkout performance regressions in the current checkout. Before
editing, prepare Lore context for the complete task and inspect relevant code,
history, decisions, rules, evidence, regressions, tests, and unknowns. Implement
the smallest evidence-backed fix, run the focused and relevant broader tests,
then use Lore to verify the final change. Resolve blockers and clearly report
any remaining warnings or unknowns.
```

This is intentionally a normal engineering request. You do not need to list every MCP call. Codex should select the relevant Lore tools from their descriptions and the server instructions.

## 4. What you should see Codex do

### Prepare before editing

Codex starts with:

```text
lore_prepare_task({
  "task": "Investigate checkout performance regressions in the current checkout"
})
```

The response can include:

- mandatory rules and policies;
- high-priority decisions and regressions;
- advisory knowledge;
- relevant code entities and relationships;
- tests and historical evidence;
- provenance and confidence;
- warnings and explicit unknowns.

“No stored rules” or “no search matches” is not an MCP failure. It means Lore has not yet acquired or approved that kind of knowledge for the selected repository. Codex can still use the code graph and bounded local Git history and should report the gap rather than inventing context.

### Investigate with targeted tools

Codex may then call only what the task needs:

```text
lore_search({ "query": "checkout performance regression" })
lore_lookup_symbol({ "symbol": "ProductRepository" })
lore_find_history({ "path": "src/ProductRepository.php", "limit": 20 })
lore_get_rules({})
lore_get_decisions({ "query": "cache performance" })
lore_get_impact({ "symbols": ["ProductRepository"], "maxDepth": 3 })
lore_explain({ "target": "src/ProductRepository.php" })
```

These calls answer different questions:

| Question | Lore tool |
| --- | --- |
| What does Lore already know about this task? | `lore_prepare_task`, `lore_search` |
| Is there a mandatory constraint? | `lore_get_rules` |
| Why was an approach chosen previously? | `lore_get_decisions`, `lore_find_history` |
| Where is the relevant code? | `lore_lookup_symbol`, `lore_explain` |
| What could this change affect? | `lore_get_impact` |
| What context was most recently prepared? | `lore_get_context` |

Lore results guide the investigation; they do not replace reading the current source, running tests, or checking runtime behavior.

### Implement and test normally

Codex edits the checkout and runs the repository’s normal focused tests. Lore does not automatically approve a change merely because it matches old evidence. Current code and runtime proof still matter.

### Verify before completion

Before claiming the task is complete, Codex calls:

```text
lore_verify_change({
  "task": "Investigate checkout performance regressions in the current checkout"
})
```

Lore independently inspects the final Git change against prepared context, bounded impact, rules, policies, regressions, and related tests. Codex should fix blocker findings, investigate warnings, and include unresolved unknowns in its final handoff.

## 5. Make Lore mandatory for the project

MCP server instructions encourage the workflow for every client. For an explicit repository policy, add this to the target repository’s `AGENTS.md`:

```markdown
## Lore workflow

For every code change:

1. Call `lore_prepare_task` with the complete task before editing.
2. Inspect applicable rules, decisions, evidence, regressions, tests, provenance,
   warnings, and unknowns. Use the other Lore tools when relevant.
3. Do not invent missing Lore context or treat advisory knowledge as policy.
4. Run the repository's normal tests and runtime checks.
5. Call `lore_verify_change` before claiming completion.
6. Resolve blocker findings and report unresolved warnings or unknowns.

Knowledge proposals never become active without human review in Lore.
```

`AGENTS.md` is useful when the repository should enforce the same expectation for everyone. Keep machine-specific paths in `.codex/config.toml`, not in `AGENTS.md`.

## 6. A shorter everyday prompt

Once the server instructions or `AGENTS.md` rule is in place, a normal prompt is enough:

```text
Fix the checkout performance regression. Use Lore before editing and for final verification. Explain which
evidence, decisions, impact paths, and tests affected your implementation.
```

For read-only investigation:

```text
Use Lore and the current source to explain why ProductRepository behaves this
way. Include relevant history, decisions, evidence, consumers, tests, and any
unknowns. Do not change files.
```

For a review:

```text
Review the current diff. Use Lore to retrieve applicable rules, decisions,
regressions, impact, and tests, then run lore_verify_change. Return only concrete
findings with file references and evidence; do not edit files.
```

## 7. MCP workflow versus the Codex wrapper

There are two supported ways to combine Lore and Codex:

| Approach | Best for | Behavior |
| --- | --- | --- |
| Codex with Lore MCP | Normal interactive work | Codex chooses Lore tools from the task, server instructions, and project guidance. |
| `lore agent codex "task"` | A locally supervised change session | Lore prepares context, starts Codex with that context, observes changed paths, refreshes persisted context, and runs final verification. |

Use MCP for everyday flexibility. Use the wrapper when you want Lore to own the beginning-to-end session lifecycle:

```bash
cd /absolute/path/to/checkout
lore agent codex \
  "Investigate and fix the checkout performance regression"
```

## 8. Troubleshooting

### Lore appears in `/mcp`, but Codex does not call it

- Begin the prompt with `Use Lore for this task`.
- Confirm the new server instructions with `npm run mcp:check -- /path/to/checkout`.
- Add the `AGENTS.md` workflow above for a durable project requirement.
- Restart Codex after rebuilding Lore so the stdio server reloads.

### Codex reports that Lore is unavailable

```bash
cd /Users/dev/Lore
npm run local:check
npm run mcp:check -- /absolute/path/to/checkout
```

Then confirm that `LORE_REPOSITORY_PATH` points to the checkout containing the expected `.lore/config.json`.

### Lore returns no rules, decisions, or ticket match

That is an honest empty result. Review imported candidates in Lore, approve only well-supported knowledge, add applicable policies, or submit ad-hoc communication evidence. Re-run `lore_prepare_task` afterward.

### The wrong organisation or repository appears

Reconnect from the intended checkout:

```bash
cd /absolute/path/to/checkout
lore connect OWNER/REPOSITORY
```

The resulting `.lore/config.json` is the authority used by both CLI and MCP requests.

## Next steps

- [MCP configuration and tool reference](mcp.md)
- [Connect and index a checkout](onboarding.md)
- [Complete local production setup](local-production.md)
- [Knowledge and evidence model](knowledge-model.md)
- [Impact engine](impact-engine.md)
