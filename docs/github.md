# GitHub App setup

Lore uses a GitHub App for bounded historical imports and signed review feedback. Each connected repository stores the App installation ID that is allowed to supply its data; import requests cannot substitute a different installation.

## Create the App

1. Create a GitHub App for the intended organisation or account.
2. Set its setup URL to `https://YOUR_HOST/api/github/callback`.
3. Set its webhook URL to `https://YOUR_HOST/api/github/webhook`.
4. Grant read access to metadata, contents, and pull requests. Grant issues read access only if ticket references are required.
5. Subscribe to `pull_request`, `pull_request_review`, and `pull_request_review_comment`.
6. Generate a private key and keep it outside this repository.
7. Set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET` in the runtime environment.
8. Install the App only on repositories Lore should read.

`GET /api/github/install` returns the installation URL. GitHub redirects to `/api/github/callback` with an installation ID. Record that ID when the repository is connected:

```bash
curl -X POST http://127.0.0.1:3001/api/repositories \
  -H 'content-type: application/json' \
  -d '{"provider":"github","owner":"acme","name":"commerce","defaultBranch":"main","providerInstallationId":"12345678"}'
```

The callback confirms the GitHub value; this first release does not include a production identity-provider flow that automatically assigns it to an organisation.

## Import history

Set retention on the repository before importing, then queue a bounded import:

```bash
curl -X POST http://127.0.0.1:3001/api/repositories/REPOSITORY_ID/github-import \
  -H 'content-type: application/json' \
  -d '{"limit":250}'
```

The limit must be 50, 100, 250, 500, or 1,000 merged pull requests. The worker uses the installation stored on the repository. Review-comment retention is independent; summary-only mode excludes raw bodies and raw diffs, and raw-diff retention is opt-in.

Demo mode returns an explicit `simulated` result and does not claim a worker ran. Persistent mode requires the API, PostgreSQL, Redis, and `npm run worker`.

## Webhook integrity and replay

Lore verifies the raw request body with the configured HMAC secret before parsing it. Routing requires the payload's installation ID, repository provider ID, and repository owner/name to match the connected record. A GitHub delivery ID is stored only after its deterministic extraction job is accepted. If dispatch fails the delivery can be replayed; if receipt persistence fails after dispatch, the deterministic BullMQ job ID prevents duplicate work.

PR IDs, review/comment IDs, and commit SHAs are stable evidence identities. This is replay-safe dispatch, not a claim of a database-and-Redis transactional outbox.

For local exploration, leave GitHub variables empty and run the explicit demo mode.

