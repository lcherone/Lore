<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="github.md"><strong>GitHub</strong></a> ·
  <a href="mcp.md"><strong>MCP</strong></a>
</p>

# Full local installation

This is the recommended way to use Lore every day. It is the complete product—not a reduced demo—and keeps every published port on `127.0.0.1`.

It includes:

- your GitHub-backed profile;
- multiple private Lore organisations and roles;
- every GitHub repository the PAT can read;
- automatic merged-PR evidence and recurring sync;
- real OpenAI candidate extraction;
- PostgreSQL data persistence;
- persistent Redis jobs and schedulers;
- the production-built React application, API, and worker;
- CLI and MCP agent integration;
- automatic start at macOS login and database backups.

## Prerequisites

- Node.js 22 or newer and npm.
- Docker Desktop or Colima.
- one GitHub PAT in `GITHUB_TOKEN`;
- one OpenAI API key in `OPENAI_API_KEY`.

No GitHub OAuth App, callback, GitHub App, private key, installation ID, local user ID, or local organisation ID is required.

## 1. Configure

```bash
cd /Users/dev/Lore
npm run local
```

This guided command prompts for the PAT without echoing it, writes the owner-only `.env`, preserves the existing OpenAI key, generates the local session secret, verifies providers, builds, migrates, and starts the complete stack. If you prefer separate setup and start steps, run `npm run local:setup`, edit `.env`, then run `npm run local:up`.

The only local values you may need to add manually are:

```dotenv
GITHUB_TOKEN=github_pat_...
OPENAI_API_KEY=sk-proj-...
```

`local:setup` safely sets full local mode, generates a strong session secret, chooses `AI_PROVIDER=openai` when a key exists, and defaults to `gpt-4.1-mini`. It preserves credentials and never prints them. Do not configure repository names in `.env`; repository selection belongs to each Lore organisation and is managed in the application.

The local configuration surface is intentionally small. See `.env.saas.example` only when designing an external shared deployment.

## 2. Verify credentials independently

```bash
npm run setup:check -- --docker --github --ai
npm run ai:check
# Optional: diagnose permissions for one repository
npm run github:check -- OWNER/REPOSITORY
```

The checks prove:

- the GitHub token and AI settings needed by the live stack are present;
- the optional targeted check can read PRs, reviews, comments, commits, and changed files for the named repository;
- Lore selected the OpenAI adapter rather than its mock;
- the OpenAI Responses API returned schema-validated structured output;
- no secret value is printed.

## 3. Start the complete stack (when using separate steps)

```bash
npm run local:up
```

This one command preflights credentials, builds production images, applies database migrations, starts PostgreSQL, persistent Redis, API, worker, and web proxy, then waits for readiness.

Open [http://localhost:5173](http://localhost:5173). The API uses the PAT to refresh your GitHub profile and automatically creates your first private local workspace if you have no Lore organisations yet.

Useful commands:

```bash
npm run local:start   # fast start from existing images
npm run local:check
npm run local:status
npm run local:logs
npm run local:down    # stops services; does not delete data
```

## 4. Choose repositories in Lore

Open **Repositories → Connect repositories**. The picker shows every repository GitHub reports for the authenticated PAT across personal, collaborator, and organisation memberships. Search by owner, name, or description; select one repository, all filtered results, or any combination; then connect the selection. Lore handles up to 500 repositories per action, so an account with a larger result set can connect it in batches. Already-connected and repeated selections are skipped safely.

The active organisation controls where imported evidence and knowledge are stored. Switch or create organisations in Lore, then make a separate repository selection for each workspace. Nothing is locked to a repository name, owner, demo fixture, or startup environment value.

Connection automatically:

1. applies the active organisation’s retention defaults;
2. queues the initial import (all merged PRs by default);
3. installs the hourly latest-100-PR sync scheduler;
4. stores deterministic evidence for every new PR/review/comment;
5. sends only new or upstream-edited evidence through real AI extraction while preserving immutable revisions;
6. creates candidates that still require human approval.

Use **Settings → Organisation defaults** to change the initial limit, interval, retention, or automatic extraction before connecting.

## 5. Connect the local checkout and MCP

Install the short global command once:

```bash
cd /Users/dev/Lore
npm run cli:install
```

Then use it from any Git checkout:

```bash
cd /absolute/path/to/repository
lore connect OWNER/REPOSITORY
lore index

cd /Users/dev/Lore
npm run mcp:check -- /absolute/path/to/repository
```

If you deliberately do not want a global command, `node /Users/dev/Lore/dist/cli.js ...` remains the equivalent explicit form.

No extra Lore API token is needed locally. See [MCP setup](mcp.md) for Codex, Claude Desktop, Cursor, the copyable agent prompt, and remote/SaaS token setup.

## 6. Persist and start on login

Docker volumes persist both authoritative data and queued/scheduled work:

- `lore-postgres` stores accounts, organisations, repositories, evidence, candidates, knowledge, sessions, reports, and settings;
- `lore-redis` stores BullMQ jobs and recurring schedulers with AOF persistence.

All long-running containers use `restart: unless-stopped`. Install the macOS login service once so Docker/Colima and Lore start after login:

```bash
npm run local:install
```

The LaunchAgent is written to `~/Library/LaunchAgents/dev.lore.local.plist`; logs go to `~/Library/Logs/Lore/`. It starts Colima when available, otherwise launches Docker Desktop, waits for Docker, and starts existing Lore images without rebuilding.

Remove only the login service with:

```bash
npm run local:uninstall
```

This does not remove containers, volumes, `.env`, or backups.

## 7. Back up

```bash
npm run local:backup
```

This creates a timestamped, mode-600 PostgreSQL custom-format dump under `backups/`. Keep copies outside the workstation according to your organisation’s approved backup policy. The command never exports the GitHub or OpenAI credentials because those are not stored in PostgreSQL.

## Data-loss rules

- `local:down` is safe and preserves both volumes.
- normal image rebuilds and migrations preserve data.
- do not run `docker compose down --volumes` unless permanent deletion is intentional.
- removing the repository directory does not remove Docker volumes, but it removes `.env` and the boot script target; back up first.
- revoke a PAT or OpenAI key at its provider if exposed; database backups do not contain either secret.

## Troubleshooting

### Preflight asks for many GitHub values

It should not. In local mode, only `GITHUB_TOKEN` is required. Remove stale OAuth/App/local-ID settings and rerun `npm run local:setup`.

### Repository is missing from the picker

Run `npm run github:check -- OWNER/REPOSITORY`. The token may lack owner/repository selection, organisation approval, classic `repo` scope, or SAML SSO authorisation.

### AI appears inactive

Run `npm run ai:check`. Settings should show `openai · gpt-4.1-mini`. If the key exists but `AI_PROVIDER=mock`, rerun `npm run local:setup`.

### Candidate triage is taking time

Open **Activity** and find **AI candidate triage**. Lore checks obvious source-history, duplicate, conflict, and possible-policy cases locally, then sends the remaining candidates to OpenAI in batches of ten. Recommendations are checkpointed after every batch and the browser refreshes them about every ten seconds. A backlog of hundreds can therefore be reviewed progressively; do not restart it merely because it is still running. If the worker stops, the durable job retries and skips recommendations whose candidate/evidence fingerprint is already current.

If a run reaches dead letter, inspect its safe error in **Activity**, correct the OpenAI configuration, and choose **Triage with AI** again. Leave **Re-analyse current recommendations** off so current results are reused. Turn it on only after evidence or the triage approach has materially changed.

### Docker is not running

Start Docker Desktop or run `colima start`, then retry `npm run local:start`.

### Import is queued but not completing

```bash
npm run local:status
npm run local:logs
```

Confirm the worker and Redis are healthy. Worker logs report safe error details without credentials.

### MCP cannot connect

Run `npm run local:check`, rebuild with `npm run build`, reconnect the checkout, then run `npm run mcp:check -- /absolute/path/to/checkout`.

## Public deployment boundary

This stack is production-shaped but loopback-only. It is not approval to process regulated/customer data or expose Lore publicly. Complete [SaaS readiness](saas-readiness.md), legal review, data mapping, tenant-isolation testing, incident response, deletion/export controls, subprocessors, and any PCI/customer contractual review first.
