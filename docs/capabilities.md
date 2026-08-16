<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="features.md"><strong>Features</strong></a> ·
  <a href="roadmap.md"><strong>Roadmap</strong></a>
</p>

# Runtime capability inventory

This is the source-of-truth inventory for Lore's executable surfaces. It records what the current tree can do; it is not a list of intended features. The contract test in `tests/contracts/capability-inventory.test.ts` fails when an API route or worker job changes without this page changing with it.

Last reviewed: 2026-08-16.

## Runtime modes

| Authority          | Selected by                              | Data source                                         | Behaviour when unavailable                                    |
| ------------------ | ---------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| Web/API demo       | `DEMO_MODE=true`                         | Seeded in-process store and simulated job responses | Does not contact PostgreSQL, Redis, GitHub, or an AI provider |
| Persistent service | `DEMO_MODE=false`                        | PostgreSQL plus Redis/BullMQ                        | Readiness fails; it does not fall back to fixtures            |
| CLI/MCP local      | `.lore/config.json` with `mode: local`   | Local AST/Git index and no organisational knowledge | Returns empty organisational knowledge until connected        |
| CLI/MCP demo       | `.lore/config.json` with `mode: demo`    | Bundled fixture graph and knowledge                 | Explicitly labelled demo authority                            |
| CLI/MCP service    | `.lore/config.json` with `mode: service` | Lore HTTP API plus local source analysis            | Requests fail visibly if the service or token is unavailable  |

## API routes

### Runtime and authentication

| Route                   | Current capability                                    |
| ----------------------- | ----------------------------------------------------- |
| `GET /healthz`          | Process liveness                                      |
| `GET /readyz`           | Store and job-transport readiness                     |
| `GET /metrics`          | Bounded Prometheus text metrics                       |
| `POST /api/auth/demo`   | Explicit demo cookie sign-in                          |
| `GET /api/auth/session` | Current local/demo session context                    |
| `GET /api/auth/csrf`    | CSRF bootstrap when production cookie auth enables it |
| `GET /api/bootstrap`    | Organisation-scoped dashboard snapshot                |
| `GET /api/onboarding`   | Current onboarding completion state                   |

### Repositories and analysis

| Route                                      | Current capability                                                  |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `POST /api/repositories`                   | Connect repository metadata; browser input cannot set `localPath`   |
| `POST /api/repositories/:id/index`         | Queue trusted-root server indexing or return a truthful demo result |
| `PUT /api/repositories/:id/analysis`       | Accept a bounded, tenant-checked local graph upload                 |
| `POST /api/repositories/:id/github-import` | Queue bounded or complete merged-PR history import                  |
| `DELETE /api/repositories/:id`             | Confirmed repository deletion and dependent-knowledge challenge     |
| `PATCH /api/repositories/:id/retention`    | Update evidence-retention controls                                  |
| `GET /api/repositories/:id/entities`       | Read the repository entity graph                                    |
| `GET /api/repositories/:id/relationships`  | Read the repository relationship graph                              |

### Context, sessions, and verification

| Route                                    | Current capability                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `POST /api/tasks/prepare`                | Calculate bounded context without creating a session                         |
| `POST /api/sessions`                     | Create a preparing session                                                   |
| `GET /api/sessions/:id`                  | Read a tenant-scoped session                                                 |
| `GET /api/sessions/:id/events`           | Read ordered lifecycle events                                                |
| `POST /api/sessions/:id/abandon`         | Record an explicit abandoned terminal state                                  |
| `POST /api/sessions/:id/refresh-context` | Persist the next immutable context revision                                  |
| `POST /api/sessions/:id/verify`          | Verify a bounded change set and atomically complete the session/report write |
| `GET /api/observations/:id`              | Read the immutable bounded manifest linked to a verification report          |

### Knowledge and policy

| Route                                        | Current capability                                               |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `GET /api/knowledge`                         | List active and lifecycle knowledge                              |
| `GET /api/evidence`                          | List retained evidence                                           |
| `POST /api/evidence/communications`          | Retain and analyse an authorised note or transcript              |
| `GET /api/search`                            | Search knowledge, evidence, and indexed entities                 |
| `GET /api/knowledge-export`                  | Export organisation knowledge as JSON or Markdown                |
| `POST /api/knowledge`                        | Create explicitly human-confirmed knowledge and evidence         |
| `POST /api/knowledge-import`                 | Import bounded JSON or Markdown knowledge through a human action |
| `GET /api/knowledge/:id`                     | Read one knowledge item with provenance                          |
| `POST /api/knowledge/:id/challenge`          | Challenge an active item without deleting history                |
| `POST /api/knowledge/:id/archive`            | Archive an item with audit rationale                             |
| `GET /api/knowledge-candidates`              | List review candidates                                           |
| `POST /api/knowledge-candidates/:id/approve` | Edit and approve a candidate                                     |
| `POST /api/knowledge/:id/approve`            | Compatibility approval route for a candidate ID                  |
| `POST /api/knowledge-candidates/:id/reject`  | Reject a candidate while retaining evidence                      |
| `POST /api/knowledge-candidates/:id/merge`   | Merge candidate evidence into an existing item                   |
| `GET /api/policies`                          | List human-owned deterministic policies                          |
| `POST /api/policies`                         | Create a bounded, validated policy                               |
| `GET /api/reports/:id`                       | Read a persisted safety report                                   |

### GitHub

| Route                      | Current capability                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `GET /api/github/install`  | Start configured GitHub App installation flow                                          |
| `GET /api/github/status`   | Report token/App/demo readiness without returning credentials                          |
| `GET /api/github/callback` | Validate signed setup state and return installation metadata                           |
| `POST /api/github/webhook` | Verify HMAC, route by installation/repository, ingest evidence, and request extraction |

## Worker jobs

| Job                 | Current executor                                                                     |
| ------------------- | ------------------------------------------------------------------------------------ |
| `repository.index`  | Validates a configured trusted root, indexes AST/Git history, and persists the graph |
| `github.import`     | Resolves worker-only PAT/App credentials, imports evidence, then queues extraction   |
| `knowledge.extract` | Runs the deterministic validated extractor and creates review candidates             |
| `knowledge.health`  | Recalculates current knowledge health signals                                        |

BullMQ supplies transport retries and deterministic job IDs. Durable `JobRun`, progress, cancellation, dead-letter review, and transactional outbox state are planned work, not current capabilities.

## Human control surface

The React application currently exposes dashboard context preparation, repository connection/import/retention/deletion, ad-hoc communication evidence capture, transcript analysis with comparison outcomes, candidate review and merge, knowledge creation/challenge/archive, policy creation, reviewer views, sessions, safety reports, onboarding help, keyboard navigation, and explicit disconnected/loading states.

The following are not shipped: production SSO or membership administration, a durable GitHub installation ownership model, Jira/Linear/Slack/Stoker connectors, a real AI provider, billing, hosted multi-tenant SaaS, job administration, GitHub Check publication, or automatic policy/knowledge approval.

## Maintenance rule

When adding or removing a route or worker job:

1. Update this inventory in the same change.
2. Update `docs/api.md` when the external contract changes.
3. Update `docs/features.md` only when the capability is usable by a person.
4. Add behavioural proof; inventory presence is not implementation proof.
