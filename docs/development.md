# Development guide

## Prerequisites

- Node.js 22+
- npm 10+
- Git 2.40+
- Docker Desktop or another Docker Engine for the composed persistent stack

## Fastest start

```bash
npm install
npm run dev
```

Open `http://localhost:5173`; the API listens on `http://127.0.0.1:3001`. The repository default is explicit in-memory demo mode. The browser displays a disconnected state instead of fixture data if the API is unavailable.

## Persistent stack

```bash
cp .env.example .env
docker compose up --build
```

Compose runs PostgreSQL, Redis, migrations, the idempotent seed, API, worker, and production web assets. For native processes, set `DEMO_MODE=false`, configure `DATABASE_URL` and `REDIS_URL`, then run:

```bash
npm run db:migrate
npm run seed
npm run dev
npm run worker
```

`/healthz` proves the HTTP process is alive. `/readyz` checks its configured store and queue dependencies and returns 503 when either is unavailable.

## CLI and MCP development

```bash
npm run build
npm link
```

From a target Git checkout:

```bash
lore init --mode local --repository OWNER/NAME --organisation ORGANISATION
lore index
lore prepare "TICKET-123 task description"
lore verify
```

Use `lore connect --repository-id UUID --organisation-id UUID` for service authority, or `lore init --mode demo` for the bundled scenario. Repository configuration lives in owner-only `.lore/config.json`; secrets never do. `--json` belongs before a command, for example `lore --json prepare "task"`.

Run `npm run mcp` with `LORE_REPOSITORY_PATH` set to an initialised checkout. Run `lore agent codex "task"` for the verified interactive wrapper.

## Quality and acceptance

```bash
npm run db:generate
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
npm audit --omit=dev
docker compose config --quiet
```

`npm run smoke:persistent` requires a migrated, seeded PostgreSQL database with `DEMO_MODE=false`; it verifies ordinary runtime UUIDs, graph upload, knowledge/evidence writes, immutable context, linked reports, terminal sessions, and reconnect durability. Queue delivery is intentionally separate because the persistence smoke injects an in-memory dispatcher.

Run `REDIS_URL=redis://127.0.0.1:6379 npm run smoke:queue` against an isolated Redis instance to prove readiness, duplicate-job suppression, and worker delivery.

The tests use `tests/fixtures/demo-repo` and never require a live GitHub account or a real AI request. UI acceptance should cover desktop and mobile layouts, the connected workflow, and the honest disconnected state.
