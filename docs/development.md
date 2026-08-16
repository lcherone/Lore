<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="features.md"><strong>Features</strong></a> ·
  <a href="onboarding.md"><strong>Setup</strong></a>
</p>

# Development guide

## Prerequisites

- Node.js 22+
- npm 10+
- Git 2.40+
- Docker Desktop or another Docker Engine for the composed persistent stack

## Fastest start

```bash
npm run demo
```

Open `http://localhost:5173`, choose **Explore Lore**, then **Explore the demo account**; the API listens on `http://127.0.0.1:3001`. The wrapper installs dependencies only when missing and forces explicit in-memory demo mode. Use `npm run demo:check` to start both processes temporarily, prove their readiness, and stop them again. The browser displays a disconnected state instead of fixture data if the API is unavailable.

## Persistent stack

```bash
npm run local          # guided setup plus start
# Or use separate steps:
npm run local:setup
npm run local:up
```

Compose runs PostgreSQL, AOF-persistent Redis, migrations, API, worker, and production web assets. Persistent mode is the normal runtime; demo seeding is opt-in through the `demo-data` Compose profile, and `DEMO_MODE=true` is accepted only in development. Full local mode uses one `GITHUB_TOKEN`; repository choices are made in the app, while OAuth/App variables and `LORE_ALLOWED_HOSTS` are SaaS-only. The API remains reachable only through host loopback: Compose's `0.0.0.0` setting applies inside the container and is not a public host bind. For native processes, set `LORE_DEPLOYMENT_MODE=local`, `DATABASE_URL`, `REDIS_URL`, and `GITHUB_TOKEN`, then run:

```bash
npm run db:migrate
npm run dev
npm run worker
```

`/healthz` proves the HTTP process is alive. `/readyz` checks its configured store and queue dependencies and returns 503 when either is unavailable.

## CLI and MCP development

```bash
npm run cli:install
npm run cli:check
```

From a target Git checkout:

```bash
lore init --mode local --repository OWNER/NAME --organisation ORGANISATION
lore index
lore prepare "TICKET-123 task description"
lore verify
```

Use `lore connect OWNER/REPOSITORY` for local service authority; it discovers persistent IDs without another token. Remote/SaaS service mode uses explicit IDs and `--token-file`. Use `lore init --mode demo` for the bundled scenario. Repository configuration lives in owner-only `.lore/config.json`; secrets never do. `--json` belongs before a command, for example `lore --json prepare "task"`.

Run `npm run mcp` with `LORE_REPOSITORY_PATH` set to an initialised checkout. Run `lore agent codex "task"` for the verified interactive wrapper.

## Quality and acceptance

```bash
npm run db:generate
npm run setup:check
npm run github:check -- OWNER/REPOSITORY
npm run ai:check
npm run mcp:check -- /absolute/path/to/checkout
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run smoke:evidence
npm run smoke:jobs
npm run build
npm audit --omit=dev
docker compose config --quiet
```

`npm run smoke:persistent` requires a migrated, seeded PostgreSQL database with `DEMO_MODE=false`; it verifies ordinary runtime UUIDs, graph upload, knowledge/evidence writes, immutable context, linked reports, terminal sessions, and reconnect durability. Queue delivery is intentionally separate because the persistence smoke injects an in-memory dispatcher.

`npm run smoke:evidence` needs only the migrated PostgreSQL database. It creates a disposable organisation, proves create/unchanged/edit behaviour through `PrismaLoreStore`, verifies two immutable revisions and the latest snapshot, then removes its test data.

`npm run smoke:jobs` deliberately dispatches while its transport is unavailable, disconnects the Prisma client, reconnects, reconciles the retained outbox intent, records worker completion, verifies the ordered event history, and removes its disposable organisation.

Run `REDIS_URL=redis://127.0.0.1:6379 npm run smoke:queue` against an isolated Redis instance to prove readiness, duplicate-job suppression, and worker delivery.

The tests use `tests/fixtures/demo-repo` and never require a live GitHub account or a real AI request. UI acceptance should cover desktop and mobile layouts, the connected workflow, and the honest disconnected state.
