# Development guide

## Prerequisites

- Node.js 22+
- npm 10+
- Docker Desktop or compatible Docker engine for the full local stack
- Git 2.40+

## Fastest start

```bash
npm install
npm run dev
```

The web app runs at `http://localhost:5173`; the API runs at `http://127.0.0.1:3001`. Demo mode is enabled when no database URL is configured.

## Full stack

```bash
cp .env.example .env
docker compose up --build
```

Then run migrations and seed data:

```bash
npm run db:migrate
npm run db:seed
```

## Quality commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Local CLI workflow

From a repository you want Lore to analyse:

```bash
lore init
lore index
lore prepare "SS-6160 Update Avalara ShipFrom and ShipTo addresses"
lore verify
```

Use `--json` on read commands for scripts and agent integrations. Repository configuration lives in `.lore/config.json`; secrets never do.
