<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="features.md"><strong>Features</strong></a> ·
  <a href="onboarding.md"><strong>Setup</strong></a>
</p>

# REST API

All product routes use `/api`. Full local mode derives one trusted workstation identity from `GITHUB_TOKEN` and only accepts that fallback for a loopback `APP_URL`. Shared/SaaS human access uses a random opaque session cookie backed by a hashed, expiring, revocable `AuthSession` after GitHub OAuth.

## Accounts and organisations

```text
POST   /api/auth/demo
GET    /api/auth/github?returnTo=/%23profile
GET    /api/auth/github/callback
GET    /api/auth/session
POST   /api/auth/logout
GET    /api/auth/sessions
DELETE /api/auth/sessions/others
GET    /api/account/profile
PATCH  /api/account/profile
GET    /api/settings
PATCH  /api/settings/user
PATCH  /api/settings/organisation
POST   /api/account/tokens
DELETE /api/account/tokens/:id
GET    /api/organisations
POST   /api/organisations
GET    /api/organisations/:id
PATCH  /api/organisations/:id
POST   /api/organisations/:id/switch
POST   /api/organisations/:id/invitations
DELETE /api/organisations/:id/invitations/:invitationId
POST   /api/invitations/:id/accept
PATCH  /api/organisations/:id/members/:userId
DELETE /api/organisations/:id/members/:userId
```

`GET /api/auth/session` is intentionally public and always returns `200`. Check `authenticated` before reading its optional `user` and `activeOrganisation` fields. It also reports organisation memberships, invitations matching the verified email, demo mode, and whether GitHub login is configured. No access token or session token is returned in JSON.

For a terminal-only demo, keep an owner-only cookie jar:

```bash
curl -c /tmp/lore-demo.cookies -X POST http://127.0.0.1:3001/api/auth/demo
curl -b /tmp/lore-demo.cookies http://127.0.0.1:3001/api/auth/session
```

In local mode, no login call is needed: the first request reads the GitHub identity through the configured PAT and creates the user/workspace when necessary. In SaaS mode, GitHub login is a browser redirect; Lore validates state and PKCE, reads the verified identity server-side, discards the OAuth token, sets the Lore cookie, and redirects to the UI.

A trusted local CLI/MCP client sends `x-lore-organisation-id` from `.lore/config.json`. Lore honours it only when falling back to the loopback local identity and revalidates that identity's current membership. Browser sessions and SaaS API tokens keep using their opaque session/token organisation and cannot be overridden by this header.

Create an organisation after login:

```bash
curl -b /tmp/lore-demo.cookies -c /tmp/lore-demo.cookies \
  -H 'content-type: application/json' \
  -d '{"name":"Acme Engineering","slug":"acme-engineering"}' \
  http://127.0.0.1:3001/api/organisations
```

The creation, switch, and invitation-acceptance responses rotate the Lore cookie. A browser handles this automatically; a command-line client must use `-c` as well as `-b` to save the replacement. Production mutations also require the token from `GET /api/auth/csrf` in the `csrf-token` header.

See [Authentication, profiles, and organisations](authentication-and-organisations.md) for local PAT identity, SaaS OAuth, settings, roles, invitations, agent tokens, and security boundaries.

## Health and bootstrap

```text
GET  /healthz
GET  /readyz
GET  /metrics
GET  /api/auth/session
GET  /api/auth/csrf
GET  /api/bootstrap
GET  /api/onboarding
```

## Repositories and ingestion

```text
GET  /api/github/repositories
POST /api/repositories
POST /api/repositories/batch
POST /api/repositories/:id/index
PUT  /api/repositories/:id/analysis
POST /api/repositories/:id/github-import
POST /api/repositories/:id/knowledge-extraction
PATCH /api/repositories/:id/retention
DELETE /api/repositories/:id?confirm=OWNER%2FNAME
GET  /api/repositories/:id/entities?search=QUERY&type=TYPE&page=1&pageSize=50
GET  /api/repositories/:id/relationships?search=QUERY&entityId=ENTITY_ID&page=1&pageSize=50
GET  /api/github/install
GET  /api/github/status
GET  /api/github/callback
POST /api/github/webhook
```

Worker-backed index and import requests return `202` with a job ID. Demo mode labels these responses `simulated`; it never claims an in-memory job was executed. The trusted local CLI uses `PUT /analysis` to upload a bounded sanitised graph, while browser requests cannot register filesystem paths.

`POST /api/repositories/:id/knowledge-extraction` queues AI extraction from evidence already stored in PostgreSQL, so correcting an AI configuration or schema failure does not require another GitHub crawl. By default, evidence already linked to a candidate or approved knowledge item is skipped. Send `{ "includeProcessed": true }` only for an intentional full re-evaluation. Evidence is divided into bounded batches before jobs are queued.

The graph routes are paginated and return `{ items, count, total, page, pageSize, hasMore }`. Relationship items include bounded source and target entity summaries. The product UI exposes the same search, type filter, related-entity focus, and paging controls through **Repositories → Browse graph**.

## Knowledge

```text
GET  /api/knowledge
GET  /api/evidence
GET  /api/evidence/:id/revisions
GET  /api/jobs?limit=100
POST /api/evidence/communications
POST /api/knowledge
GET  /api/knowledge/:id
POST /api/knowledge/:id/approve
POST /api/knowledge/:id/challenge
POST /api/knowledge/:id/archive
GET  /api/knowledge-candidates
POST /api/knowledge-candidates/:id/approve
POST /api/knowledge-candidates/:id/reject
POST /api/knowledge-candidates/:id/merge
GET  /api/knowledge-export
POST /api/knowledge-import
GET  /api/search?q=QUERY&repositoryId=REPOSITORY_ID
```

`POST /api/knowledge` is explicitly human-authored. Lore creates a `manual_confirmation` evidence record, revision, and audit event in the same transaction. Import accepts up to 500 items through the same path. AI proposals cannot use this boundary.

`POST /api/knowledge-import` accepts either `{ "items": [...] }` JSON or `{ "format": "markdown", "content": "...", "sourceName": "AGENTS.md", "repositoryId": "..." }`. Markdown headings become individually scoped, human-confirmed items and retain their source name as provenance. Candidate merge supersedes the duplicate, links its evidence to the target, and records both a proposal and an audit event.

### Communication evidence

`POST /api/evidence/communications` accepts one short note or a complete standup, meeting, call, Slack, email, or in-person transcript. The original text is retained as `communication` evidence with its source type, participants, submitter, optional reference/URL, occurrence time, content hash, and repository scope. `authorityConfirmed` must be the literal `true`; clients should require the submitter to confirm that they may retain the communication and have removed secrets, payment data, and unnecessary customer data.

```bash
curl -X POST http://127.0.0.1:3001/api/evidence/communications \
  -H 'content-type: application/json' \
  -d '{
    "repositoryId":"repo_soho_ecom",
    "sourceType":"standup",
    "title":"Payments standup · 16 August",
    "participants":["Alex","Sam","Priya"],
    "sourceReference":"#payments-eng",
    "authorityConfirmed":true,
    "content":"Alex: We agreed that refund tax changes must include RefundTaxTransactionTest.\nSam: The team prefers repository interfaces at application service boundaries."
  }'
```

The response returns the stored evidence plus extracted review candidates. Each candidate has one comparison outcome:

| Outcome | Meaning | Review action |
| --- | --- | --- |
| `new` | No close approved knowledge was found | Check wording and scope, then approve or reject |
| `already_added` | Equivalent knowledge is already recorded | Merge the new evidence or reject the duplicate wording |
| `supports_existing` | Similar approved knowledge exists | Review it as additional support and merge where appropriate |
| `conflicts` | The statement appears to oppose active knowledge | Investigate and create an explicit challenge; do not silently replace either side |

Exact resubmissions reuse the same stable evidence identity and return `evidenceAdded: false`; they do not add another candidate. Distinct communications remain separate evidence even when they support the same decision. Demo mode and automated tests use the bundled deterministic extractor. Full local mode uses the configured schema-validated OpenAI provider when `AI_PROVIDER=openai`; model output remains an untrusted proposal and never bypasses review. Ordinary standup status updates should be retained without being promoted when no explicit decision, rule, preference, warning, or regression is present.

Filter retained evidence with `GET /api/evidence?type=communication&repositoryId=REPOSITORY_ID&limit=50`. Supported filters are `type`, `provider`, `repositoryId`, and `limit` (1–1,000); results are newest first and include `total` plus `truncated`.

`GET /api/evidence/:id/revisions` returns every immutable snapshot for that evidence item in version order. GitHub imports commit each completed PR and queue its new/changed evidence for extraction immediately. The retained GitHub update version lets a restarted crawl skip unchanged PR detail collections. Upstream edits append a revision and re-run extraction; an unchanged re-import creates neither a revision nor AI work.

`GET /api/jobs` returns organisation-scoped durable job runs newest first. Each run includes its name, queued/dispatched/running/retrying/succeeded/dead-letter state, attempts, bounded error/result summary, and ordered lifecycle events. It never returns GitHub/OpenAI credentials or the outbox payload. When Redis is unavailable, enqueue responses use `status: "dispatch_pending"`; PostgreSQL retains the intent and the API reconciles it after transport recovery. Worker startup also reconciles active PostgreSQL rows against BullMQ, closing terminal, stalled, completed, or missing transport jobs instead of leaving false `running` state.

Retention settings are applied before GitHub evidence is written. Summary-only mode cannot also retain raw diffs or snippets. Repository deletion requires the exact `owner/name`; repository-scoped rows cascade, while organisation-wide knowledge backed by removed evidence is challenged for reconfirmation.

GitHub import accepts `limit` values `50`, `100`, `250`, `500`, `1000`, or `"all"`. `/api/github/status` exposes only authentication mode and readiness booleans; it never returns a token, private key, or webhook secret.

## Tasks, sessions, policies, and reports

```text
POST /api/tasks/prepare
POST /api/sessions
GET  /api/sessions/:id
GET  /api/sessions/:id/events
POST /api/sessions/:id/refresh-context
POST /api/sessions/:id/verify
POST /api/sessions/:id/abandon
GET  /api/observations/:id
GET  /api/policies
POST /api/policies
GET  /api/reports/:id
```

Session context revisions are immutable records. Verification requires a persisted context revision and creates a first-class `ChangeObservation`: a bounded file manifest with patch hashes, base/current commits, context revision, and its own content hash. Raw patch content is not duplicated into the observation. Observation creation, report creation, lifecycle events, and the terminal session update share one store transaction; the returned report includes `observationId` and `contextRevision`.

Every body is validated with Zod. Errors use:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "requestId": "..."
}
```

`LoreError` subclasses provide stable error codes and HTTP statuses. Unhandled errors are logged structurally and returned without stack traces or secrets.

## Example task preparation

```bash
curl -X POST http://127.0.0.1:3001/api/tasks/prepare \
  -H 'content-type: application/json' \
  -d '{
    "repositoryId":"repo_soho_ecom",
    "task":"SS-6160 Update Avalara ShipFrom and ShipTo addresses",
    "paths":["src/Tax/Avalara/AddressCode.php"]
  }'
```

The response includes ranked candidate code, policies, rules, decisions, preferences, regressions, evidence, recommended tests, warnings, and explicit unknowns.
