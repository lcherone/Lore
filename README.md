<p align="center">
  <img src="apps/web/public/brand/lore-mark.svg" alt="Lore mark" width="72" height="72" />
</p>

<h1 align="center">Lore</h1>

<p align="center"><strong>Engineering memory that can show its work.</strong></p>

Lore is an evidence-backed engineering memory and governance platform for developers and coding agents. It turns repository structure, Git history, pull requests, review feedback, tickets, regressions, and human decisions into scoped context before a change—and an independent safety report afterwards.

Lore does not ask a model to decide policy or invent certainty. Static analysis establishes structure, Git establishes history, evidence establishes credibility, humans establish policy, and AI may propose narrowly scoped candidates for review.

## Why Lore

Important engineering intent is usually scattered across old PRs, closed tickets, review comments, and the memories of people who may have left. That makes deliberate behaviour look accidental, makes regressions repeat, and gives coding agents too little context.

Lore preserves answers to questions such as:

- Why does this code exist?
- What else consumes it?
- Which decisions and rules apply here?
- What failed the last time this area changed?
- Which tests and reviewers are relevant?
- What evidence supports each answer?

It stays quiet when nothing matters and specific when something does.

## The closed loop

```mermaid
flowchart LR
  GH[GitHub history and reviews] --> EV[Immutable evidence]
  EV --> CP[AI proposals]
  CP --> HV[Human candidate review]
  HV --> KB[Scoped knowledge]
  SRC[Local AST and Git analysis] --> GRAPH[Impact graph]
  KB --> CTX[Task context]
  GRAPH --> CTX
  CTX --> CHANGE[Code change]
  CHANGE --> VERIFY[Deterministic verification]
  VERIFY --> REPORT[Safety report]
  REPORT --> GH
```

## Architecture

Lore is a strict-TypeScript modular monolith with explicit adapters. It can run entirely on one machine while retaining boundaries suitable for a future private-node/control-plane split.

```mermaid
flowchart TB
  UI[React web app] --> API[Fastify API]
  CLI[CLI] --> LOCAL[Trusted local repository runtime]
  MCP[MCP server] --> LOCAL
  LOCAL -->|sanitised graph and change envelopes| API
  API --> CORE[Context, knowledge, policy, reporting services]
  WORKER[BullMQ worker] --> CORE
  CORE --> PG[(PostgreSQL / Prisma)]
  API --> REDIS[(Redis / BullMQ)]
  WORKER --> REDIS
  WORKER --> GITHUB[GitHub App adapter]
  LOCAL --> GIT[Safe Git argv adapter]
  LOCAL --> AST[TypeScript and PHP AST analyzers]
  AST --> GRAPH[Bounded impact graph]
  GIT --> GRAPH
  WORKER --> AI[Validated AI provider boundary]
```

Key design choices:

- PostgreSQL is the source of truth; JSON fields hold bounded metadata, not the whole graph.
- Repository access is local. The browser never selects a server path; service mode uploads a sanitised symbol/relationship graph, not a source checkout.
- Every knowledge item retains scope, evidence, confidence, classification, health, and provenance.
- AI output is schema-validated and becomes a proposal or candidate—not a direct database mutation.
- Policies are explicit, human-owned, deterministic detectors.
- Impact traversal has confidence, depth, and node limits.
- All persistent access is organisation-scoped and provider webhooks are routed from trusted repository identity.

See [architecture](docs/architecture.md), [knowledge model](docs/knowledge-model.md), and [impact engine](docs/impact-engine.md).

## Quick start: explore in 60 seconds

Prerequisites: Node.js 22+, npm 10+, and Git.

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The default `DEMO_MODE=true` uses a realistic in-memory organisation, repository, knowledge graph, candidate queue, reviewer profiles, and safety reports. No database, GitHub account, or AI key is required.

Useful first clicks:

1. On **Dashboard**, prepare the pre-filled SS-6160 task.
2. Open **Candidates** and inspect evidence, contradictions, and confidence factors.
3. Edit, merge, approve, or reject a candidate.
4. Open **Safety reports** to inspect the prior Avalara refund regression.
5. Press <kbd>⌘K</kbd> or <kbd>Ctrl K</kbd> to navigate quickly.

## Full Docker setup

Prerequisites: Docker Engine with Compose v2.24+.

```bash
cp .env.example .env
docker compose up --build
```

Open [http://localhost:5173](http://localhost:5173). Compose starts PostgreSQL, Redis, the migration and idempotent seed jobs, API, worker, and Nginx-hosted web app. The bundled local-auth mode is restricted to a loopback `APP_URL`; do not enable it in a shared environment.

Inspect the stack:

```bash
docker compose ps
curl http://127.0.0.1:3001/healthz
curl http://127.0.0.1:3001/readyz
```

The seed job skips an existing demo organisation. To deliberately rebuild only the demo data:

```bash
SEED_FORCE=true npm run seed
```

That command replaces the seeded `acme-engineering` organisation, so do not use it against a database where that slug contains wanted changes.

## Persistent local setup without Docker apps

Run PostgreSQL and Redis yourself, then:

```bash
cp .env.example .env
# Set DEMO_MODE=false and verify DATABASE_URL / REDIS_URL in .env
npm run db:migrate
npm run seed
npm run dev
npm run worker
```

`npm run dev` starts API and web. Run the worker in a second terminal when using queued indexing, GitHub import, extraction, or health jobs.

## GitHub App setup

Create a GitHub App owned by the intended organisation or account.

Repository permissions:

- Metadata: read
- Contents: read
- Pull requests: read
- Issues: read, if ticket references should be available

Subscribe to:

- Pull request
- Pull request review
- Pull request review comment

Configure:

```text
Setup URL:   http://127.0.0.1:3001/api/github/callback
Webhook URL: https://YOUR-REACHABLE-HOST/api/github/webhook
```

Set these values in `.env`:

```bash
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=your-lore-app
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=replace-with-a-long-random-secret
```

Start installation by requesting `GET /api/github/install`, follow the returned URL, then retain the resulting installation ID. Store that ID when connecting the repository; later imports use the repository's registered installation rather than accepting one per job:

```bash
curl -X POST http://127.0.0.1:3001/api/repositories \
  -H 'content-type: application/json' \
  -d '{"provider":"github","owner":"acme","name":"commerce","defaultBranch":"main","providerInstallationId":"12345678"}'

curl -X POST http://127.0.0.1:3001/api/repositories/REPOSITORY_ID/github-import \
  -H 'content-type: application/json' \
  -d '{"limit":250}'
```

The worker imports PRs, commits, changed paths, reviews, and review comments as idempotent evidence, then schedules structured candidate extraction. Configure per-repository retention in the UI before import when raw diffs, review comments, or summary-only storage need different handling. Webhooks validate their HMAC signature and GitHub delivery ID before ingestion. See [GitHub integration](docs/github.md).

## AI provider setup

The runnable prototype ships with the deterministic `mock` provider:

```bash
AI_PROVIDER=mock
```

It is enough to demonstrate the full candidate pipeline without network calls or credentials. Provider choice happens once at the worker composition root through `AIProvider`; domain services never call a vendor SDK directly. To add a provider, implement `generateStructured`, register it in the worker provider map, keep source text in `untrustedSourceContent`, and validate every response with the task’s Zod schema.

`OPENAI_API_KEY` and `OPENAI_MODEL` are reserved configuration fields; no real provider call is enabled by this repository. Core indexing, graph traversal, confidence, permissions, policies, and verification never depend on AI. See [AI safety](docs/ai-safety.md).

## Analyse a local repository

Build and link the CLI once:

```bash
npm run build
npm link
```

Then choose an explicit CLI authority inside a Git repository. `local` is the default and never injects fixture knowledge:

```bash
lore init --repository acme/commerce --organisation acme-engineering
lore index
lore prepare "SS-6160 Update Avalara ShipFrom and ShipTo addresses"
lore context
lore impact AddressCode::fromRole
lore explain AddressCode::fromRole
lore verify
```

For the bundled scenario, opt in with `lore init --mode demo`. To use PostgreSQL-backed organisational knowledge, connect the checkout to an existing service repository and re-index; indexing keeps source local and uploads the sanitised graph:

```bash
lore connect --repository-id UUID --organisation-id UUID --api-url http://127.0.0.1:3001
lore index
lore prepare "TICKET-123 task description"
```

`lore init` creates `.lore/config.json`, a small static agent instruction file, and a repository-local Git exclusion for `.lore/`. `lore index` parses TypeScript/JavaScript and PHP ASTs, reads bounded Git history, calculates statistically supported co-change relationships, and stores the local graph under `.lore/`. Lore state is always omitted from verification and secrets are never stored there.

For scripts, put `--json` before the command:

```bash
lore --json prepare "Update refund address mapping"
lore --json verify
```

Session and knowledge commands:

```bash
lore session start "Update refund address mapping" --agent codex
lore session status
lore session stop

lore knowledge list
lore knowledge show KNOWLEDGE_UUID
lore knowledge export --format markdown --output lore-knowledge.md
lore knowledge import AGENTS.md
lore knowledge import docs/adr/0007-tax-boundary.md
```

Run an agent under Lore’s prepare/observe/verify wrapper:

```bash
lore agent codex "SS-6160 Update Avalara ShipFrom and ShipTo addresses"
```

The interactive wrapper currently supports Codex and passes initial context in Codex's prompt as well as `.lore/LORE_CONTEXT.md`. Other agents consume the same service contracts through MCP. Git discovery includes staged, unstaged, renamed, deleted, and untracked files; context refreshes when the working set expands, the final diff is verified, and non-zero agent exits are retained as abandoned sessions. Shell interpolation is never used.

See [onboarding](docs/onboarding.md) for configuration and troubleshooting.

## MCP setup

Build first, then add Lore as a stdio MCP server in your agent configuration:

```json
{
  "mcpServers": {
    "lore": {
      "command": "node",
      "args": ["/absolute/path/to/lore/dist/mcp.js"],
      "env": {
        "LORE_REPOSITORY_PATH": "/absolute/path/to/your/repository"
      }
    }
  }
}
```

Available tools:

- `lore_prepare_task`
- `lore_get_context`
- `lore_search`
- `lore_lookup_symbol`
- `lore_find_history`
- `lore_get_rules`
- `lore_get_decisions`
- `lore_get_impact`
- `lore_verify_change`
- `lore_explain`
- `lore_propose_knowledge` (validation only; it cannot mutate knowledge)

Use Lore before edits for task context and again before completion for independent verification. See [MCP guide](docs/mcp.md).

## Knowledge model

Lore distinguishes facts, decisions, rules, preferences, inferences, regressions, warnings, and explicit policies. It also distinguishes lifecycle:

```mermaid
stateDiagram-v2
  [*] --> Evidence
  Evidence --> Proposal: extraction
  Proposal --> Candidate: deterministic validation
  Candidate --> Active: human approval
  Candidate --> Rejected: human rejection
  Active --> Challenged: contradictory evidence
  Challenged --> Active: confirmed or narrowed
  Challenged --> Superseded: replacement approved
  Active --> Archived: no longer applicable
```

Confidence is calculated server-side from independent observations, PRs, reviewers, recency, explicitness, source reliability, contradictions, human confirmation, scope stability, and whether the code still matches. Old or contradicted knowledge is downgraded, not silently deleted. Narrow symbol/path rules outrank broad preferences.

## Security model

- Signed, HTTP-only session cookies; CSRF protection for non-demo production writes.
- Active membership is revalidated before authenticated API routes.
- GitHub OAuth state and webhook HMAC validation.
- Organisation and repository checks at every store boundary.
- Immutable evidence identities and ingestion receipts for replay protection.
- Structured logging with token, key, cookie, and credential redaction.
- Git runs through argument arrays with `shell: false`; revisions are validated and change collection is NUL-delimited and bounded.
- Local `.lore` state is owner-only, symlink-resistant, size-bounded, and atomically replaced.
- Repository, ticket, review, and documentation text is untrusted AI input.
- AI cannot create policy, calculate authority, execute tools, or write database rows directly.
- Explicit policy detectors inspect only changed paths and added patch lines.

Read [security](docs/security.md) and [AI safety](docs/ai-safety.md) before a shared deployment.

## Development

```bash
npm run dev          # API + Vite web app
npm run worker       # BullMQ worker
npm run mcp          # stdio MCP server
npm run cli -- help  # unlinked CLI
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
npm run db:generate
npm run db:migrate
npm run db:seed
```

The fixture repository lives at `tests/fixtures/demo-repo` and contains PHP source, tests, Git-history records, and PR/review history. Tests never require a live GitHub account or real AI request.

See [development](docs/development.md), the [REST API reference](docs/api.md), and the [implementation acceptance map](docs/acceptance.md).

## Repository map

```text
apps/api       Fastify HTTP boundary, auth, metrics, static production host
apps/worker    queued indexing, GitHub import, extraction, health evaluation
apps/cli       local developer workflow and agent wrapper
apps/mcp       deterministic stdio tools for coding agents
apps/web       responsive React operations and review UI
packages/*     composable domain and adapter modules
prisma         PostgreSQL schema, migration, and idempotent demo seed
prompts        versioned prompt contracts
tests          unit, integration, webhook, fixture, and vertical-slice tests
docs           architecture, security, operations, and onboarding detail
```

## Roadmap

The current usable release implements the core vertical slice. Next sensible steps are:

1. Production identity-provider login and membership administration.
2. A real opt-in AI adapter with cost budgets and evaluation fixtures.
3. GitHub Check publication and configurable, low-noise PR summaries.
4. Jira/Linear work-item adapters and hosted documentation sync.
5. Optional PostgreSQL vector search after deterministic retrieval proves insufficient.
6. Private Lore nodes connected to a separate SaaS control plane.

Billing, broad chat integrations, and autonomous policy creation are intentionally outside this prototype.

## Brand

Lore’s voice is calm, specific, and evidence-led. The midnight ink, signal coral, and evidence teal system—and reusable SVG mark/wordmark—are documented in [brand guidelines](docs/brand.md). Product copy should prefer “evidence suggests” or “confirmed decision” over unexplained authority.

---

**Lore:** AI understands meaning. Static analysis understands structure. Git understands history. Evidence establishes credibility. Policies establish boundaries. Humans remain in control.
