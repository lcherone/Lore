# REST API

All product routes use `/api`. In demo mode requests receive the built-in demo tenant. Persistent deployments require a signed session or explicitly loopback-restricted local development auth.

## Health and bootstrap

```text
GET  /healthz
GET  /readyz
GET  /metrics
GET  /api/auth/session
GET  /api/bootstrap
GET  /api/onboarding
```

## Repositories and ingestion

```text
POST /api/repositories
POST /api/repositories/:id/index
POST /api/repositories/:id/github-import
PATCH /api/repositories/:id/retention
DELETE /api/repositories/:id?confirm=OWNER%2FNAME
GET  /api/repositories/:id/entities
GET  /api/repositories/:id/relationships
GET  /api/github/install
GET  /api/github/callback
POST /api/github/webhook
```

Index and import requests return `202` with a job ID. They never perform expensive analysis inside the HTTP request.

## Knowledge

```text
GET  /api/knowledge
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

Retention settings are applied before GitHub evidence is written. Summary-only mode cannot also retain raw diffs or snippets. Repository deletion requires the exact `owner/name`; repository-scoped rows cascade, while organisation-wide knowledge backed by removed evidence is challenged for reconfirmation.

## Tasks, sessions, policies, and reports

```text
POST /api/tasks/prepare
POST /api/sessions
GET  /api/sessions/:id
POST /api/sessions/:id/refresh-context
POST /api/sessions/:id/verify
GET  /api/policies
POST /api/policies
GET  /api/reports/:id
```

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
