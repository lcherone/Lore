<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="features.md"><strong>Features</strong></a> ·
  <a href="onboarding.md"><strong>Setup</strong></a>
</p>

# GitHub repository integration

This page covers permission to read repositories. Lore supports two repository credential modes: use a fine-grained personal access token (PAT) for the first local import; use a GitHub App when installations must be managed independently or live webhook feedback is required.

GitHub **login is separate**. `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` identify a person and populate their Lore profile; they never authorise repository imports. Configure accounts first with [Authentication, profiles, and organisations](authentication-and-organisations.md), then return here to connect repositories.

| Capability                        | Local fine-grained PAT | GitHub App                                           |
| --------------------------------- | ---------------------- | ---------------------------------------------------- |
| Historical merged-PR import       | Yes                    | Yes                                                  |
| Import every available merged PR  | Yes                    | Yes                                                  |
| Live review webhooks              | No                     | Yes                                                  |
| Credential represents             | One GitHub user        | One repository installation                          |
| Browser receives secret           | Never                  | Never                                                |
| Recommended for multi-tenant SaaS | No                     | Yes, after the production identity and tenancy gates |

The importer reads merged PR titles and bodies, submitted review bodies, inline review comments, PR conversation comments, commit SHAs, changed paths, and bounded patch text. The list and every child collection are paginated. Lore creates idempotent evidence records, then queues structured candidate extraction. It does not import open or unmerged PRs because accepted history is the evidence source for this workflow.

Before either setup, choose retention under **Repositories → Retention**. Summary-only mode excludes PR bodies and raw diffs. Review-comment retention controls submitted reviews, inline comments, and PR conversation comments together. Raw patch retention is opt-in and bounded to 2 MB per PR.

## Recommended first run: local fine-grained PAT

This is the shortest path when Lore, PostgreSQL, Redis, and the worker all run on your machine. The token is read only by the worker. It is never submitted by the browser, written to PostgreSQL, saved under `.lore`, or included in the BullMQ job payload.

### 1. Create the token

In GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.

Configure it as follows:

1. Give it a short expiration date that matches the local evaluation period.
2. Choose the user or organisation that owns the repositories as **Resource owner**.
3. Choose **Only select repositories** and select only the repositories Lore may read.
4. Under repository permissions, grant **Pull requests: Read-only** and **Issues: Read-only**. GitHub grants read-only metadata automatically. Issues read access is needed for PR conversation comments because GitHub exposes those through the issues API.
5. Do not grant write or administration permissions.

GitHub documents the fine-grained token flow and permission model in [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) and the exact REST mapping in [Permissions required for fine-grained personal access tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).

An organisation may require an owner to approve the token before it can read private resources. Fine-grained tokens are authorised for SAML SSO during creation; classic tokens require a separate SSO authorisation. A `403` or a misleading `404` on a private repository often means approval, SSO, resource-owner, or selected-repository access is incomplete. See GitHub's [organisation token approval](https://docs.github.com/en/enterprise-cloud@latest/organizations/managing-programmatic-access-to-your-organization/managing-requests-for-personal-access-tokens-in-your-organization) and [SAML token authorisation](https://docs.github.com/en/enterprise-cloud@latest/authentication/authenticating-with-single-sign-on/authorizing-a-personal-access-token-for-use-with-single-sign-on) guidance.

### 2. Store it outside the repository

Prefer an owner-only file over an inline `.env` value. Create an empty file, restrict it, then paste the token into it with a text editor:

```bash
mkdir -p "$HOME/.config/lore"
touch "$HOME/.config/lore/github-token"
chmod 600 "$HOME/.config/lore/github-token"
```

The file must contain only the token, optionally followed by one newline. Lore rejects symlinks, group/world-readable files, malformed tokens, and files larger than 16 KB.

Set an absolute path in `.env`; dotenv does not expand `$HOME` inside values:

```dotenv
DEMO_MODE=false
GITHUB_AUTH_MODE=token
GITHUB_TOKEN_PATH=/Users/YOU/.config/lore/github-token
```

`GITHUB_TOKEN=` is supported for CI or an existing secret injector, but a file is easier to protect during local development. Never commit either the token or its file. `.secrets/`, `*.pem`, and `.env` are ignored by this repository, but GitHub revocation remains the recovery action if a token is exposed.

### 3. Run persistent local mode

A real import needs PostgreSQL, Redis, the API, and the worker. Demo mode only simulates a queued import.

For native Node processes with PostgreSQL and Redis already running, use the signed-in account and active organisation configured in [Authentication and organisations](authentication-and-organisations.md). If you are working on API internals without a browser, the loopback-only development bypass remains available:

```dotenv
LOCAL_DEV_AUTH=true
LOCAL_ORGANISATION_ID=6f4f5ce6-9038-4ad2-b45e-f6de814555dd
LOCAL_USER_ID=df9f1efc-1dfe-4df7-b02d-ce228da36e07
```

Then run:

```bash
npm run setup:check
npm run db:migrate
npm run seed
npm run dev
```

In a second terminal:

```bash
npm run worker
```

For the full Docker stack, put the host token path in `.env` as `GITHUB_TOKEN_FILE`, then apply the token overlay:

```dotenv
GITHUB_AUTH_MODE=token
GITHUB_TOKEN_FILE=/absolute/host/path/to/github-token
```

```bash
npm run setup:check -- --docker
docker compose -f docker-compose.yml -f docker-compose.github-token.yml up --build
```

The overlay mounts the file read-only into the worker. The API sees only readiness metadata, not the token contents.

### 4. Connect and import

Open [http://localhost:5173/#repositories](http://localhost:5173/#repositories), select **Connect repository**, and enter the GitHub owner and repository name. Token mode deliberately has no installation-ID field.

Choose **Import history**. Start with 100 to validate access and retention. Choose **All merged PRs** only after the first import succeeds. “All” can make thousands of GitHub API requests on a mature repository and may take a long time; the job is idempotent, so rerunning it will not duplicate existing evidence.

The equivalent API request is:

```bash
curl -X POST http://127.0.0.1:3001/api/repositories/REPOSITORY_ID/github-import \
  -H 'content-type: application/json' \
  -d '{"limit":"all"}'
```

Accepted limits are `50`, `100`, `250`, `500`, `1000`, and `"all"`.

### 5. Revoke after evaluation

When the local evaluation finishes, revoke or rotate the PAT in GitHub and remove the token file. Existing Lore evidence remains subject to the repository retention and deletion controls. Deleting a repository in Lore requires typing `owner/name` and removes repository-scoped records.

## GitHub App mode

GitHub Apps provide repository-scoped installations, short-lived installation tokens, explicit organisation approval, and signed webhook delivery. That makes an App the correct GitHub credential boundary for a shared or future SaaS deployment. A GitHub App alone does not make this repository production-ready; complete the gates in [SaaS readiness](saas-readiness.md).

### 1. Register the App

Create a private GitHub App owned by the intended user or organisation. GitHub's official [registration guide](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app) describes every field.

For this local Vite/API layout use:

```text
Homepage URL: http://localhost:5173
Setup URL:    http://localhost:5173/api/github/callback
Webhook URL:  https://YOUR-PUBLIC-PROXY/api/github/webhook
```

The setup URL may be local because GitHub redirects the user's browser. Only the webhook receiver needs a public HTTPS address. Keep `localhost` consistent—do not mix it with `127.0.0.1`—so the signed state cookie returns to the same host. GitHub distinguishes this repository App setup URL (`/api/github/callback`) from Lore's user-login OAuth callback (`/api/auth/github/callback`). They are separate flows and credentials.

Repository permissions:

- Metadata: read-only (automatic)
- Pull requests: read-only
- Issues: read-only, for PR conversation comments

Subscribe to:

- Pull request
- Pull request review
- Pull request review comment

Generate a private key from the App settings and download it once. Generate a separate webhook secret locally:

```bash
openssl rand -hex 32
```

### 2. Store the App credentials

Keep the downloaded PEM outside the repository and run `chmod 600 /absolute/path/to/key.pem`. Then configure:

```dotenv
GITHUB_AUTH_MODE=app
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=your-lore-app
GITHUB_PRIVATE_KEY_PATH=/absolute/path/to/lore-app.private-key.pem
GITHUB_WEBHOOK_SECRET=replace-with-the-generated-random-value
```

`GITHUB_PRIVATE_KEY=` accepts an inline PEM with literal `\n` separators for a real secret manager or CI system. Do not flatten a PEM manually if a file can be mounted instead.

For Docker, set `GITHUB_PRIVATE_KEY_FILE` to the absolute host PEM path and use:

```bash
npm run setup:check -- --docker
docker compose -f docker-compose.yml -f docker-compose.github.yml up --build
```

### 3. Receive local webhooks

GitHub cannot deliver to `localhost`. Use an HTTPS tunnel or a webhook relay such as [Smee](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/testing-webhooks). The relay must forward the unmodified body and GitHub signature headers to:

```text
http://localhost:5173/api/github/webhook
```

Use the relay's public URL in the GitHub App's webhook URL. A tunnel or relay can observe source-derived content, so it must be approved for the repository's data classification. Do not use a public relay for customer or PCI-sensitive repositories without written security approval.

### 4. Install and connect

Open **Repositories → Connect repository → Install GitHub App**. GitHub returns to Lore, and the installation ID is prefilled. Install the App only on repositories Lore is authorised to process.

The callback uses a short-lived, signed state value. In this local release it does not bind the returned installation to a production identity-provider authorisation. GitHub warns that an `installation_id` received through a setup redirect must be verified against the authorised user before it is trusted in a multi-user service. That production binding is a mandatory SaaS gate, not a claimed feature here. See GitHub's [setup URL guidance](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url).

Each connected repository stores the installation ID. Import jobs cannot substitute another installation. Webhook routing additionally requires the signed payload's installation ID, provider repository ID, and owner/name to match the stored repository.

## Integrity, replay, and secret boundaries

- PAT/App credentials are loaded by the worker at job execution; queue payloads contain only `authMode`, repository identity, installation ID when applicable, and limit.
- Secret files must be regular non-symlink files with owner-only permissions on Unix.
- The API status endpoint returns mode/readiness booleans only.
- App webhook bodies are verified with constant-time HMAC before JSON processing.
- A delivery ID is persisted after deterministic extraction dispatch. BullMQ job IDs and evidence IDs make retries idempotent; this is not a database/Redis transactional outbox claim.
- GitHub text is untrusted evidence. It is never executed as shell, policy, or an AI tool instruction.
- Structured logs redact credentials, cookies, and authorisation headers.

## Troubleshooting

Run the secret-safe configuration check first:

```bash
npm run setup:check
curl http://localhost:5173/api/github/status
curl http://127.0.0.1:3001/readyz
```

The status response never contains a token or key.

### Import stays queued

Run `npm run worker`, confirm Redis is reachable, and inspect worker logs for the job failure. Demo mode does not run the real queue.

### GitHub returns 403 or 404 in PAT mode

Check the token's resource owner, selected repository, expiry, organisation approval, SAML authorisation, and read-only Pull requests/Issues permissions. GitHub may intentionally return `404` for a private repository the credential cannot see.

### App installation button is unavailable

Set `GITHUB_AUTH_MODE=app` and `GITHUB_APP_SLUG`, restart the API, and rerun `npm run setup:check`.

### Callback reports invalid state

Start the installation from Lore, finish within ten minutes, use the same browser, and keep the host exactly `localhost`. Cookie clearing, host changes, or a second install attempt invalidate the first state.

### Webhook signature fails

Confirm GitHub and Lore use the same webhook secret and that the tunnel forwards the raw request body without rewriting it. Redeliver a GitHub webhook after correcting the secret.

### “All” takes too long

Cancel the worker cleanly and rerun a bounded import. A future production importer should checkpoint pages and enforce per-tenant quotas; this local implementation keeps a single import in memory before writing evidence, so bounded batches are safer for very large histories.
