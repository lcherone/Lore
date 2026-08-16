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
| Web/API demo       | `npm run demo` (`NODE_ENV=development`, `DEMO_MODE=true`) | Seeded in-process store and simulated job responses | Does not contact PostgreSQL, Redis, GitHub, or an AI provider |
| Persistent service | Normal API/local commands (`DEMO_MODE` absent or `false`) | PostgreSQL plus Redis/BullMQ                        | Readiness fails; it does not fall back to fixtures            |
| CLI/MCP local      | `.lore/config.json` with `mode: local`   | Local AST/Git index and no organisational knowledge | Returns empty organisational knowledge until connected        |
| CLI/MCP demo       | `.lore/config.json` with `mode: demo`    | Bundled fixture graph and knowledge                 | Explicitly labelled demo authority                            |
| CLI/MCP service    | `.lore/config.json` with `mode: service` | Lore HTTP API plus local source analysis            | Local loopback uses PAT identity; remote requests require a Lore token and fail visibly when unavailable |

Every native API mode defaults to `127.0.0.1`. In full production, the API enforces exact configured Host and Origin boundaries; cookie-authenticated writes additionally require CSRF. Compose explicitly listens on all interfaces inside its private container network but publishes the API only on host loopback.

## API routes

### Runtime and authentication

| Route                   | Current capability                                    |
| ----------------------- | ----------------------------------------------------- |
| `GET /healthz`          | Process liveness                                      |
| `GET /readyz`           | Store and job-transport readiness                     |
| `GET /metrics`          | Bounded Prometheus text metrics                       |
| `POST /api/auth/demo`   | Explicit demo cookie sign-in                          |
| `GET /api/auth/github` | Start GitHub OAuth with state and PKCE |
| `GET /api/auth/github/callback` | Verify GitHub identity and create an opaque Lore session |
| `GET /api/auth/session` | Account, active organisation, memberships, and invitations |
| `POST /api/auth/logout` | Revoke the current server-side session |
| `GET /api/auth/sessions` | List current revocable sessions |
| `DELETE /api/auth/sessions/others` | Revoke all other sessions |
| `GET /api/auth/csrf`    | CSRF bootstrap when production cookie auth enables it |
| `GET /api/account/profile` | Read the GitHub-seeded personal profile |
| `PATCH /api/account/profile` | Update editable personal profile fields |
| `GET /api/settings` | Read user, organisation, deployment, and agent-token settings |
| `PATCH /api/settings/user` | Update the current user's preferences |
| `PATCH /api/settings/organisation` | Update owner/admin organisation automation and retention defaults |
| `POST /api/account/tokens` | Create an organisation-scoped personal agent token and reveal it once |
| `DELETE /api/account/tokens/:id` | Revoke one of the current user's organisation tokens |
| `GET /api/organisations` | List the account's organisation memberships |
| `POST /api/organisations` | Create a private organisation and rotate into it |
| `GET /api/organisations/:id` | Read organisation members and pending invitations |
| `PATCH /api/organisations/:id` | Update owner/admin organisation settings |
| `POST /api/organisations/:id/switch` | Validate membership and rotate into another organisation |
| `POST /api/organisations/:id/invitations` | Create a verified-email invitation |
| `DELETE /api/organisations/:id/invitations/:invitationId` | Revoke a pending invitation |
| `POST /api/invitations/:id/accept` | Accept a matching invitation and rotate organisation context |
| `PATCH /api/organisations/:id/members/:userId` | Change a non-owner member role |
| `DELETE /api/organisations/:id/members/:userId` | Remove a non-owner member |
| `GET /api/bootstrap`    | Organisation-scoped dashboard snapshot                |
| `GET /api/onboarding`   | Current onboarding completion state                   |

### Repositories and analysis

| Route                                      | Current capability                                                  |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `POST /api/repositories`                   | Connect repository metadata; browser input cannot set `localPath`   |
| `POST /api/repositories/batch`             | Idempotently connect up to 500 repositories and report skipped entries |
| `POST /api/repositories/:id/index`         | Queue trusted-root server indexing or return a truthful demo result |
| `PUT /api/repositories/:id/analysis`       | Accept a bounded, tenant-checked local graph upload                 |
| `POST /api/repositories/:id/github-import` | Queue bounded or complete merged-PR history import                  |
| `POST /api/repositories/:id/knowledge-extraction` | Replay stored repository evidence through bounded AI extraction batches |
| `DELETE /api/repositories/:id`             | Confirmed repository deletion and dependent-knowledge challenge     |
| `PATCH /api/repositories/:id/retention`    | Update evidence-retention controls                                  |
| `GET /api/repositories/:id/entities`       | Search and page through the repository entity graph                 |
| `GET /api/repositories/:id/relationships`  | Search and page through enriched source-to-target relationships     |

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
| `GET /api/evidence/:id/revisions`            | Read immutable source revisions in version order                 |
| `GET /api/jobs`                              | Read durable dispatch, retry, worker, and terminal job history   |
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
| `GET /api/github/repositories` | List every repository visible to the configured local PAT without exposing it |
| `GET /api/github/status`   | Report token/App/demo readiness without returning credentials                          |
| `GET /api/github/callback` | Validate signed setup state and return installation metadata                           |
| `POST /api/github/webhook` | Verify HMAC, route by installation/repository, ingest evidence, and request extraction |

## Worker jobs

| Job                 | Current executor                                                                     |
| ------------------- | ------------------------------------------------------------------------------------ |
| `repository.index`  | Validates a configured trusted root, indexes AST/Git history, and persists the graph |
| `github.import`     | Resolves PAT/App credentials, incrementally persists paginated evidence, skips unchanged per-PR checkpoints, versions edits, and immediately queues new/changed evidence for extraction |
| `knowledge.extract` | Runs the configured mock or real OpenAI structured-output provider and creates review candidates |
| `knowledge.health`  | Recalculates current knowledge health signals                                        |

BullMQ supplies transport retries and recurring job schedulers. Repository connect queues a fresh initial job and upserts the organisation-configured sync schedule. PostgreSQL stores each API dispatch intent, its outbox state, append-only lifecycle events, attempts, errors, and terminal result summary. A 30-second API reconciler replays due outbox entries after transport recovery. Worker startup reconciles completed, failed, stalled, or missing BullMQ jobs so PostgreSQL cannot remain falsely active, and scheduled retries reuse one durable run. Cancellation, operator replay controls, progress percentages, and atomic business-event-plus-outbox writes remain planned.

## Human control surface

The React application currently exposes PAT-backed automatic local identity, SaaS GitHub login, a demo login, GitHub-seeded editable profiles, active-session revocation, organisation creation/switching, role/member management, copyable verified-email invitations, personal and organisation settings, deployment/configuration status, SaaS agent-token management, searchable token-backed repository discovery and bulk connection, automatic/manual import, retention/deletion, durable background activity, ad-hoc communication evidence, transcript analysis, candidate review/merge, knowledge lifecycle, policy creation, reviewer views, sessions, safety reports, onboarding help, keyboard navigation, and explicit disconnected/loading states.

The following are not shipped: enterprise SSO/SAML, MFA policy enforcement, SCIM, ownership transfer/deletion recovery, email delivery, a durable GitHub installation ownership model, Jira/Linear/Slack/Stoker connectors, billing, hosted multi-tenant SaaS, job administration, GitHub Check publication, or automatic policy/knowledge approval.

## Maintenance rule

When adding or removing a route or worker job:

1. Update this inventory in the same change.
2. Update `docs/api.md` when the external contract changes.
3. Update `docs/features.md` only when the capability is usable by a person.
4. Add behavioural proof; inventory presence is not implementation proof.
