<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="features.md"><strong>Features</strong></a> ·
  <a href="onboarding.md"><strong>Setup</strong></a>
</p>

# GitHub integration

## Local setup: one token

A full local Lore installation needs one GitHub setting:

```dotenv
GITHUB_TOKEN=github_pat_...
```

That token is used server-side for all three local responsibilities:

1. Read your GitHub profile and create or refresh your private Lore account.
2. List every repository the token can read so the UI can offer an unrestricted repository picker.
3. Read merged pull requests and their evidence in the background worker.

Local mode does **not** need a GitHub OAuth App, callback URL, GitHub App ID, PEM/private key, installation ID, webhook secret, token file, `GITHUB_AUTH_MODE`, or fixed local user/organisation IDs. Those belong to shared/SaaS operation or advanced secret-management environments.

The token is loaded by the API and worker from the owner-only `.env` file. It is never returned to the browser, stored in PostgreSQL, placed in Redis job payloads, written under `.lore`, sent to OpenAI, or included in logs.

## Which PAT should I create?

Lore only reads GitHub. It never creates commits, changes repositories, posts comments, requests reviews, or modifies pull requests.

### One token across all repositories

A classic PAT with the `repo` scope can read all personal and organisation repositories your GitHub account can access. This is closest to local tools such as `gh`, but it is broad. GitHub recommends fine-grained tokens where possible.

### Least privilege

A fine-grained PAT can be limited to one resource owner and selected repositories. Give it:

- **Metadata: read-only** (GitHub supplies this automatically);
- **Pull requests: read-only**;
- **Issues: read-only**, because PR conversation comments use the Issues API.

Fine-grained tokens are intentionally constrained to the owner and repositories selected when the token is created. If you want Lore to discover repositories across several organisations with one local token, a classic PAT may be necessary; otherwise create a fine-grained token for the required owner and grant access to the repositories you want Lore to discover.

GitHub documents these boundaries in [Managing personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) and [List repositories for the authenticated user](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user).

## GitHub SSO is not Lore sign-in

There are two different ideas commonly called SSO:

- **Lore SaaS login** uses GitHub OAuth so multiple remote users can sign in safely.
- **GitHub organisation SAML SSO** is an organisation policy that may require your PAT to be authorised before it can read private organisation repositories.

The first is not needed locally. The second is controlled by each GitHub organisation and can affect any private organisation repository. A classic PAT may need an explicit **Configure SSO** action; a fine-grained token is authorised for the resource owner during creation. See [GitHub’s SAML PAT guide](https://docs.github.com/en/enterprise-cloud@latest/authentication/authenticating-with-single-sign-on/authorizing-a-personal-access-token-for-use-with-single-sign-on).

## Start and prove access

The guided local command securely prompts for the token when it is missing:

```bash
npm run local
```

It never echoes the token and writes it only to the owner-readable `.env`. If you prefer manual configuration, set only the token:

```dotenv
GITHUB_TOKEN=github_pat_...
```

Then run the separate steps. The targeted check is optional and does not select or connect a repository:

```bash
npm run local:setup
npm run github:check -- OWNER/REPOSITORY
npm run local:up
```

The secret-safe access check proves that Lore can read:

- repository metadata and visibility;
- closed pull requests;
- submitted reviews;
- inline review comments;
- PR conversation comments;
- commits;
- changed files.

It never prints the token.

## Connect one, many, or all accessible repositories

Open [http://localhost:5173/#repositories](http://localhost:5173/#repositories) and choose **Connect repositories**. Lore loads all repositories returned by GitHub’s authenticated-user repository endpoint, including private, collaborator, and organisation-member repositories when the PAT can access them.

Search by owner, repository name, or description. Check any combination, or use **Select results** to select the current filtered set, then connect them together. A single action accepts up to 500 repositories—well above a 100-repository workspace—and can be repeated for larger accounts. Lore deduplicates the request and skips repositories already connected to the active organisation. Manual `OWNER/REPOSITORY` or full GitHub URL entry remains available if you know an accessible repository that is not in the current result.

Lore does not maintain an allowlist of repository owners or names. If a repository is absent or GitHub returns `404`, the constraint is the PAT, organisation policy, SAML authorisation, or your GitHub membership—not a Lore project lock.

The active Lore organisation is a private storage boundary only: it decides which workspace receives the imported evidence and knowledge. It does **not** filter GitHub discovery. You may connect any repository returned for the PAT into any Lore organisation you own or administer.

## What the worker gathers automatically

The organisation defaults are visible under **Settings → Organisation defaults**. Their initial values are:

| Setting | Default | Behaviour |
| --- | --- | --- |
| Automatically import GitHub history | On | Connecting a GitHub repository immediately queues an import. |
| Initial history import | All merged PRs | Paginates every merged PR visible to the token. |
| Sync interval | Hourly | Rechecks the latest 100 merged PRs. |
| Automatically extract candidates | On | Sends only newly added evidence through the configured schema-validated AI provider. |
| Review comment retention | On | Stores submitted review bodies, inline comments, and conversation comments. |
| Raw diff retention | Off | Does not retain pull-request patches unless explicitly enabled. |

For each merged PR, Lore gathers:

- title, body, author, merge time, number, and canonical URL;
- submitted review authors and non-empty review bodies;
- all paginated inline review comments;
- all paginated PR conversation comments;
- all commit SHAs;
- all changed file paths;
- bounded patch text only when raw-diff retention is enabled.

Evidence IDs are deterministic. Repeated imports update nothing when the evidence is unchanged. If a retained PR body or review comment changes upstream, Lore appends an immutable evidence revision, updates the current snapshot, and sends that evidence back through AI extraction. Only new or changed evidence IDs are analysed. A manual import always creates a fresh worker job; it is not silently suppressed by an old completed job ID.

The initial import and recurring scheduler live in Redis; PostgreSQL holds the resulting evidence and knowledge candidates. Both use persistent Docker volumes in local mode.

## Retention and sensitive repositories

Configure retention before connecting a repository if PR bodies or comments may contain customer, payment, credential, or incident data:

- **Summary-only** keeps the PR title and metadata, excluding its body and patches.
- **Review comments** controls review bodies, inline comments, and conversation comments together.
- **Raw pull-request diffs** is off by default.
- **Code snippets** is off by default.

Repository access is not data-processing approval. Review [Security](security.md) and [SaaS readiness](saas-readiness.md) before using Lore with PCI, customer, or otherwise regulated material.

## SaaS/shared deployment

SaaS is deliberately more complex because one workstation token must not impersonate multiple remote users. Copy `.env.saas.example` and configure:

- GitHub OAuth App credentials for user identity;
- a GitHub App ID, slug, private key, and webhook secret for repository installations;
- a public HTTPS callback and webhook URL;
- managed PostgreSQL, Redis, encryption, and secret storage.

GitHub App installations provide repository-scoped authority, short-lived installation tokens, signed webhooks, and explicit organisation approval. See [SaaS readiness](saas-readiness.md) for the legal, privacy, PCI, tenant-isolation, deletion, audit, and incident-response gates. Do not expose the local single-token mode to the internet.

## Troubleshooting

### Repository picker is empty

Run:

```bash
npm run github:check -- OWNER/REPOSITORY
```

For a fine-grained token, confirm the repository owner and repository are selected and the token is approved. For a classic token, confirm `repo` scope and SAML SSO authorisation. Organisation owners can also restrict PAT use completely.

### GitHub returns 403

Check token expiry, rate limit, organisation approval, SAML authorisation, and Pull requests/Issues read permissions.

### GitHub returns 404 for a private repository

GitHub commonly hides inaccessible private repositories behind `404`. Check the same access controls; Lore has no hidden repository allowlist.

### Import remains queued

```bash
npm run local:status
npm run local:logs
```

Confirm both Redis and the worker are healthy. A worker failure includes the GitHub status and safe hint, never the credential.

### “All” takes a long time

A mature repository can require several paginated API requests per PR. Leave the worker running. Evidence is idempotent, so retrying is safe; change the organisation’s initial-import default if you prefer a bounded first pass.
