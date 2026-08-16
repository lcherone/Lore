<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="features.md"><strong>Features</strong></a> ·
  <a href="onboarding.md"><strong>Setup</strong></a>
</p>

# Lore onboarding

This guide takes a new developer from an empty checkout to useful task context and a safety report.

## Choose a mode

Use demo mode for UI and workflow exploration. It is in-memory, needs no infrastructure, and resets when the API restarts.

```bash
npm run demo
```

The demo wrapper installs dependencies when they are missing, forces the safe in-memory mode, and prints the URL. Use `npm run demo:check` for a temporary automated API/web readiness proof.

Use full local Docker mode for everyday use: one GitHub PAT supplies profile identity, repository discovery, and evidence; PostgreSQL and persistent Redis run the real API, worker, AI extraction, CLI, MCP, and production-built web assets.

```bash
npm run local
```

The guided command securely prompts for the PAT when needed, preserves the configured OpenAI key, verifies both integrations, and starts the persistent production-built stack. Use `local:setup` plus `local:up` only when you prefer separate steps.

Follow [Run Lore locally like production](local-production.md) for the complete repository-discovery, import, AI, persistence, and MCP workflow.

Use native persistent mode when you already run PostgreSQL and Redis locally. Set `DEMO_MODE=false`, `LORE_DEPLOYMENT_MODE=local`, the two URLs, `GITHUB_TOKEN`, and the AI settings; run migrations, then start `npm run dev` and `npm run worker` in separate terminals. Seed only when you explicitly want demo fixtures.

The CLI has its own explicit authority mode:

- `local` (default) uses only the checkout's graph and Git history. It contains no organisational or fixture knowledge.
- `demo` is an explicit opt-in to the bundled Soho scenario: `lore init --mode demo`.
- `service` uses the Fastify API as the authority for knowledge, sessions, context, and reports. `lore connect` selects it automatically.

Lore never falls back between these modes.

## Connect a local checkout

From the Lore repository:

```bash
npm run build
npm link
```

From the target Git repository:

```bash
lore init --repository OWNER/NAME --organisation ORGANISATION_SLUG
lore index
```

The generated `.lore/config.json` contains identifiers, the API URL, the default agent, and trusted test commands. Do not add credentials. Lore adds `.lore/` to the checkout's local `.git/info/exclude` and always omits it from verification, so private state is neither tracked nor mistaken for a product change. Add `.lore/` to the shared `.gitignore` only when the whole team should inherit that convention.

For full local service authority, connect by GitHub name; Lore discovers the active organisation and repository IDs:

```bash
lore connect OWNER/REPOSITORY
```

Running `lore index` in service mode uploads a bounded, sanitised entity/relationship graph. It does not upload a source checkout, and the browser cannot submit a local path.

## First task

```bash
lore prepare "TICKET-123 concise task description"
```

Read:

- candidate files and symbols;
- mandatory policies and high-priority decisions;
- historical regressions and related reviews;
- recommended tests;
- unknowns Lore could not prove.

The same package is written to `.lore/context.json` and `.lore/LORE_CONTEXT.md` for agents.

After editing:

```bash
lore verify
```

Verification reads the Git diff, traverses bounded impact, evaluates deterministic policies, checks historical regressions, and identifies related tests that were not changed. Resolve blocker findings before completion. Treat warnings as evidence to investigate, not automatic failure.

## Agent workflow

For explicit control, call Lore tools from the agent before and after edits. For enforcement in a local interactive session:

```bash
lore agent codex "TICKET-123 concise task description"
```

Lore currently has one verified interactive adapter: Codex. It passes initial context directly in the Codex prompt and writes the same content to `.lore/LORE_CONTEXT.md`, observes changed file paths every two seconds, refreshes persisted context when the working set expands, and verifies the final diff. Use Lore MCP for other agents. Failed Codex processes are retained as abandoned sessions rather than reported as complete.

## GitHub history

Set one `GITHUB_TOKEN`. The searchable repository picker lists everything the token can read and lets you connect one or many repositories to the active organisation. A batch accepts up to 500 repositories and safely skips duplicates or already-connected entries. Every connection immediately queues the organisation’s initial import (`all` by default) and an hourly latest-100-PR sync. `{"limit":"all"}` paginates every merged PR plus submitted reviews, inline/conversation comments, commits, and files. Deterministic evidence IDs prevent duplicates, and only newly added evidence is sent to AI.

Change the initial limit, interval, retention, or automatic extraction under **Settings → Organisation defaults** before connecting when a mature or sensitive repository needs a bounded first run. Follow the [GitHub integration guide](github.md), including classic/fine-grained PAT reach, organisation approval, and GitHub SAML SSO.

Open the Candidates screen. Approve only statements whose evidence, class, and scope are accurate. Edit over-broad scope before approval. Reject noisy inferences with a reason; the audit trail records both decisions.

## Import existing engineering guidance

In `service` mode, import JSON exports, Markdown, `AGENTS.md`, `CONTRIBUTING.md`, architecture notes, or ADRs from a configured checkout:

```bash
lore knowledge import AGENTS.md
lore knowledge import docs/adr/0007-tax-boundary.md
lore knowledge import previous-lore-export.json --organisation-wide
```

Markdown headings become separate knowledge items. `AGENTS.md` and contributing conventions are classified as rules; ADR and architecture sections are classified as decisions. Every item records its source filename and enters as an explicit human confirmation. Review the imported scope in the Knowledge screen after import.

## Add a Slack note, call, or standup transcript

Open **Add evidence** in the web application. Choose the source type, optionally scope it to a repository, paste the communication, and confirm the retention/privacy acknowledgement. **Use example transcript** fills a safe sample so you can try the complete flow without real company data.

Lore retains the source and shows extracted suggestions underneath the form. Review the four outcome groups—new, already added, supporting, and conflicting—then choose **Review candidates**. Correct wording, class, and scope before approval; merge duplicate/supporting evidence into an existing item; reject noise. No suggestion becomes active merely because a model extracted it.

Demo uses a deterministic bundled extractor. Full local mode uses the real schema-validated OpenAI adapter when `AI_PROVIDER=openai`; `npm run ai:check` proves it without sending repository/customer data. Before processing sensitive company communications, complete the provider data-retention, training, region, subprocessor, DPA, and incident-response review in [SaaS readiness](saas-readiness.md).

For API use, see the copy-ready `curl` request and outcome contract in [REST API](api.md#communication-evidence).

## Privacy and repository removal

Use **Repositories → Retention** before importing GitHub history. Summary-only mode omits raw PR bodies/diffs and disables code snippet retention. Review comments can be retained or discarded independently.

Deleting a repository requires typing its exact `owner/name`. Lore deletes repository-scoped entities, relationships, evidence, sessions, reports, policies, candidates, and knowledge. Organisation-wide knowledge that relied on its evidence is challenged instead of silently removed.

## Common problems

### The UI says Lore is disconnected

Lore never substitutes fixtures after an API failure. Start `npm run dev`, then confirm both `curl http://127.0.0.1:3001/healthz` and `curl http://127.0.0.1:3001/readyz`.

### Indexing reports no Git history

AST indexing still succeeds outside a Git checkout, but commit, diff, and co-change features need a real Git worktree with readable history.

### The worker has no database or Redis

The worker intentionally refuses an in-memory production path. Set `DATABASE_URL`, `REDIS_URL`, and `DEMO_MODE=false`, or use Docker Compose.

### GitHub import is queued but nothing changes

Run `npm run local:status`, `npm run local:logs`, and `npm run github:check -- OWNER/REPOSITORY`. Confirm PAT reach, Pull requests/Issues read permissions, organisation approval, and SAML access. Inspect structured `job.failed` output without printing any credential.

### A candidate remains weak

One comment is an observation, not an organisation-wide rule. Import more independent PRs, narrow the scope, or explicitly confirm the item as human knowledge.

### Docker bootstrap has stale demo data

The seed is idempotent and skips an existing organisation. To intentionally replace only the demo organisation, run `SEED_FORCE=true npm run seed` against the configured database.
