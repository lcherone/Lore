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

Use Docker mode to exercise PostgreSQL, migrations, seed data, Redis, queued jobs, API, worker, and the production-built web assets.

```bash
cp .env.example .env
npm run setup:check -- --docker
docker compose up --build
```

Use a native persistent mode when you already run PostgreSQL and Redis locally. Set `DEMO_MODE=false`, configure the two URLs, run migrations and seed, then start `npm run dev` and `npm run worker` in separate terminals.

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

To connect the local config to an API repository record:

```bash
lore connect \
  --repository-id REPOSITORY_ID \
  --organisation-id ORGANISATION_ID \
  --api-url http://127.0.0.1:3001
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

Choose one authentication mode before connecting a provider repository:

- `GITHUB_AUTH_MODE=token` for a fine-grained, selected-repository PAT during the first local evaluation.
- `GITHUB_AUTH_MODE=app` for repository installations and signed live webhooks.

The secret stays in the worker environment. Token mode does not ask for an installation ID. App mode records the installation ID on the repository, so jobs and webhook routing cannot switch installations per request. Follow the complete [GitHub integration guide](github.md), including organisation approval and SSO notes.

Start with 100 merged PRs. Expand to 250–1,000 after checking retention and evidence quality, or use `"all"` deliberately for the entire available merged history.

```bash
curl -X POST http://127.0.0.1:3001/api/repositories/REPOSITORY_ID/github-import \
  -H 'content-type: application/json' \
  -d '{"limit":100}'
```

For a mature repository, `{"limit":"all"}` paginates every merged PR plus its submitted reviews, inline and conversation comments, commits, and files. It can take a long time and consume substantial GitHub API quota, so bounded batches are the safer first run.

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

The local bundled extractor is deterministic and does not call an external AI service. That makes the first evaluation safe to run without an API key, but its language recognition is deliberately narrower than a production model. Before configuring any future hosted model, complete the provider data-retention, training, region, subprocessor, DPA, and incident-response review in [SaaS readiness](saas-readiness.md).

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

Run the worker and `npm run setup:check`. In token mode, confirm the token path, owner-only permissions, selected repository, Pull requests/Issues read permissions, organisation approval, and SAML access. In App mode, check the App ID/private key and installation access. Inspect structured `job.failed` output without printing any credential.

### A candidate remains weak

One comment is an observation, not an organisation-wide rule. Import more independent PRs, narrow the scope, or explicitly confirm the item as human knowledge.

### Docker bootstrap has stale demo data

The seed is idempotent and skips an existing organisation. To intentionally replace only the demo organisation, run `SEED_FORCE=true npm run seed` against the configured database.
