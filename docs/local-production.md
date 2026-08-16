<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="authentication-and-organisations.md"><strong>Accounts</strong></a> ·
  <a href="github.md"><strong>GitHub</strong></a>
</p>

# Run Lore locally like production

This is the recommended end-to-end evaluation mode. It uses production-built web assets, secure GitHub login, PostgreSQL persistence, Redis queues, database migrations, and the real worker. It does not use demo records or the local identity bypass.

All published ports bind to `127.0.0.1`; this workflow is for one trusted workstation, not internet exposure.

## What you need

- Node.js 22 or newer and npm.
- Docker Desktop or Colima with the Docker daemon running.
- A GitHub OAuth App for signing people into Lore.
- A fine-grained GitHub PAT allowed to read `D3R/soho-home`.
- Organisation approval and SAML SSO authorisation if D3R requires them.

GitHub login and GitHub repository access are deliberately separate. The OAuth App identifies you. The selected-repository PAT is available only to the worker and reads pull-request history.

## 1. Prepare the environment

```bash
npm run local:setup
```

This command:

- creates `.env` from `.env.example` when needed;
- changes the local runtime switches to production/persistent mode;
- disables `LOCAL_DEV_AUTH`;
- creates a cryptographically random `SESSION_SECRET` when the current value is missing or a placeholder;
- preserves existing GitHub credentials;
- restricts `.env` to the current user on Unix.

It never prints a secret.

## 2. Create the GitHub OAuth App

Open **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App** and enter exactly:

```text
Application name:              Lore local
Homepage URL:                  http://localhost:5173
Authorization callback URL:   http://localhost:5173/api/auth/github/callback
```

Add the resulting values to `.env`:

```dotenv
GITHUB_OAUTH_CLIENT_ID=your-client-id
GITHUB_OAUTH_CLIENT_SECRET=your-client-secret
GITHUB_OAUTH_CALLBACK_URL=http://localhost:5173/api/auth/github/callback
```

Use `localhost` consistently in the browser. The login token is used only to read your GitHub identity and verified email; Lore discards it after login.

## 3. Create the selected-repository PAT

Create a fine-grained personal access token with:

- **Resource owner:** `D3R`.
- **Repository access:** only `soho-home`.
- **Pull requests:** read-only.
- **Issues:** read-only, because PR conversation comments use the Issues API.
- A short evaluation expiry.

If D3R controls PAT approval or SAML SSO, complete those steps before continuing. Do not add Contents write, Administration, Actions, or organisation-management permissions.

Store the token outside this repository:

```bash
mkdir -p "$HOME/.config/lore"
touch "$HOME/.config/lore/github-token"
chmod 600 "$HOME/.config/lore/github-token"
```

Paste only the token into that file, then configure its absolute host path:

```dotenv
GITHUB_AUTH_MODE=token
GITHUB_TOKEN_FILE=/Users/YOU/.config/lore/github-token
LORE_TEST_REPOSITORY=D3R/soho-home
LORE_GITHUB_PREFLIGHT=true
```

Do not use `$HOME` inside `.env`; dotenv does not expand it.

## 4. Prove GitHub access before importing

```bash
npm run github:check -- D3R/soho-home
```

The check reads the token without printing it and proves access to repository metadata, pull requests, submitted reviews, inline review comments, PR conversation comments, commits, and changed files. A `404` for this private repository normally means the token selected the wrong resource owner/repository or still needs organisation/SSO approval.

## 5. Start everything

```bash
npm run local:up
```

That single command runs the strict preflight, repeats the GitHub access proof, validates Compose, builds the images, applies migrations, starts PostgreSQL, Redis, API, worker, and Nginx, and waits for both the API dependencies and built web application to become ready.

Open [http://localhost:5173](http://localhost:5173).

Useful lifecycle commands:

```bash
npm run local:check
npm run local:status
npm run local:logs
npm run local:down
```

`local:down` preserves PostgreSQL data. Normal starts never seed the demo organisation.

## 6. Sign in and create the workspace

1. Choose **Continue with GitHub**.
2. Authorise the Lore local OAuth App.
3. Create an organisation such as **Soho Home Engineering** with slug `soho-home-engineering`.
4. Open **Repositories → Connect repository**.
5. Paste `https://github.com/D3R/soho-home`.
6. Set the default branch to `master`.
7. Connect the repository.

<p align="center">
  <img src="assets/screenshots/lore-connect-repository.png" alt="Lore repository connection form filled with the D3R Soho Home GitHub URL and master branch" width="100%" />
</p>

The organisation is private. Creating the Lore organisation does not create or modify anything on GitHub.

## 7. Choose retention before the first import

Open the repository's **Retention** action before importing:

- Start with raw pull-request diffs disabled.
- Keep review comments only if they are approved for local processing.
- Use summary-only mode if PR bodies may contain data you should not retain.
- Do not import customer data, cardholder data, credentials, or production payloads merely because the repository is accessible.

## 8. Import in a bounded batch

Choose **Import history**, select **50**, and queue the import. Follow the real worker:

```bash
npm run local:logs
```

Wait for `job.completed` for `github.import`, followed by `knowledge.extract`. Then refresh Lore and inspect:

- **Candidates** for extracted suggestions;
- **Knowledge** for approved decisions and rules;
- **Reviewers** for observed review evidence;
- **Dashboard** for updated counts.

Approve, edit, merge, or reject candidates manually. Once the first 50 records look correct, use 100–1,000. Use **All merged PRs** only deliberately: `soho-home` is mature, and each PR can require several paginated GitHub calls. Imports are evidence-idempotent, but a large run can still consume time and API quota.

## Troubleshooting

### The preflight says GitHub login is missing

The account OAuth App and repository PAT are different. Add both `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`; a PAT cannot sign a browser user into Lore.

### Docker is installed but unavailable

Start Docker Desktop, or run `colima start`, and retry `npm run local:up`.

### GitHub access returns 403 or 404

Check PAT expiry, `D3R` as resource owner, `soho-home` selection, Pull requests/Issues read permissions, D3R approval, and SAML SSO. The secret-safe check is:

```bash
npm run github:check -- D3R/soho-home
```

### Import remains queued

```bash
npm run local:status
npm run local:logs
```

Confirm the worker is running and Redis is ready. The worker log reports an HTTP/permission failure without printing the PAT.

### Login redirects but does not create a session

Use `http://localhost:5173`, not `127.0.0.1`, and confirm the OAuth App callback matches exactly. Clear localhost cookies after changing the callback or session secret.

### Start from a clean database

Stopping with `npm run local:down` preserves data. Removing the `lore-postgres` volume permanently deletes local Lore accounts, organisations, evidence, and knowledge. Back up anything important and use the explicit Docker volume-removal command only when that deletion is intentional.

## Deployment boundary

This is production-shaped local execution, not approval for public SaaS deployment. It intentionally remains loopback-only and uses workstation-managed credentials. Complete the controls and governance in [SaaS readiness](saas-readiness.md) before processing regulated/customer data or exposing Lore outside the machine.
