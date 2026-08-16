<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="github.md"><strong>GitHub integration</strong></a> ·
  <a href="saas-readiness.md"><strong>SaaS readiness</strong></a>
</p>

# Authentication, profiles, and organisations

Lore has the same account, profile, organisation, role, and settings model locally and in SaaS. The deployment mode changes how GitHub proves identity; it does not remove product features.

## Local identity: the existing PAT

A loopback-only local installation uses the same `GITHUB_TOKEN` needed for repository access:

```dotenv
LORE_DEPLOYMENT_MODE=local
GITHUB_TOKEN=github_pat_...
```

No OAuth App or callback is needed. On the first request, Lore:

1. validates that the configured application URL is loopback-only;
2. calls GitHub’s authenticated-user endpoint with the PAT;
3. reads the profile and a verified email where available;
4. links the stable GitHub numeric ID to a durable Lore user;
5. seeds name, avatar, login, profile URL, bio, company, location, and website;
6. automatically creates `<GitHub name>'s Workspace` if the user has no organisations;
7. keeps every repository, setting, evidence item, and knowledge record scoped to the selected Lore organisation.

The PAT remains in the API/worker environment. The browser never receives it. Local API access is accepted without a second Lore API token only because the complete Docker stack publishes its ports on `127.0.0.1` and verifies a loopback `APP_URL`.

The local user can still create several organisations—for example **Personal**, **Acme Engineering**, and **Soho Home**—and keep their repositories and knowledge separate.

## SaaS/shared identity: GitHub OAuth

A remote multi-user service cannot safely treat one server PAT as every visitor. `LORE_DEPLOYMENT_MODE=saas` therefore requires a GitHub OAuth App:

```dotenv
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=
GITHUB_OAUTH_CALLBACK_URL=https://lore.example.com/api/auth/github/callback
```

The SaaS login uses an authorization code, signed state, PKCE, and an exact callback; reads the user profile and verified email; discards the GitHub OAuth access token; and issues a random Lore session whose hash, expiry, last-seen time, revocation state, user, and active organisation are stored server-side.

OAuth identifies the human. A GitHub App supplies repository installation authority and signed webhooks. The complete advanced configuration is isolated in [`.env.saas.example`](../.env.saas.example).

## Personal profiles

Open the avatar or **Your profile**. A user can edit:

- display name;
- job title and company;
- location and timezone;
- website;
- bio.

GitHub login, profile URL, and identity email are provider-backed fields. User-edited profile fields are preserved when the PAT profile refreshes or the user signs in again through OAuth.

The **Account security** section lists real browser sessions in SaaS mode and lets a user revoke other sessions. Local single-user authentication is derived from the workstation PAT, so signing out cannot revoke GitHub access; revoke or rotate the PAT to remove that authority.

## Organisations and privacy

A user can:

- create a private organisation and become its owner;
- create several organisations under one personal account;
- switch organisations from the top bar;
- accept an invitation sent to the GitHub identity email;
- invite colleagues and assign least privilege in shared mode;
- maintain separate repository, evidence, knowledge, retention, automation, and MCP settings per organisation.

The active organisation comes from server-side authentication state, not an arbitrary tenant ID supplied by a browser. Every product request validates current membership. An organisation-scoped agent token cannot switch into another organisation.

### Roles

| Role | Read organisation data | Change engineering memory | Connect repositories | Invite/manage members | Change organisation settings |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Owner** | Yes | Yes | Yes | Yes | Yes |
| **Admin** | Yes | Yes | Yes | Yes, except ownership | Yes |
| **Member** | Yes | Yes | Configurable per organisation | No | No |
| **Viewer** | Yes | No | No | No | No |

An owner cannot be demoted or removed through member management. Ownership transfer and organisation deletion require a deliberate recovery design before SaaS launch.

### Invitations

1. Open **Organisation → Invite a colleague**.
2. Enter the work email and choose admin, member, or viewer.
3. Copy the generated link and send it through an approved channel.
4. The recipient signs in through GitHub OAuth on the shared deployment.
5. Lore shows the invitation only when the verified GitHub email matches.
6. Accepting creates membership and selects the organisation.

The link is routing, not authority. Invitations expire after seven days and can be revoked. Lore does not yet send transactional email. In a strictly local install, other people cannot reach the loopback URL, but the organisation and invitation model is still present for product parity and later migration.

## User and organisation settings

**Settings → Your preferences** stores settings against the user:

- start page;
- default manual import limit;
- theme;
- onboarding guidance;
- in-app import/candidate notices.

**Settings → Organisation defaults** stores settings only against the active organisation:

- automatic GitHub import;
- initial PR limit and recurring sync interval;
- automatic AI extraction;
- ad-hoc communication evidence;
- whether members can connect repositories;
- MCP/API-token access;
- default evidence retention for new repositories.

Only owners/admins can edit organisation defaults. Changing automatic-sync settings updates schedulers for existing repositories in that organisation.

## Agent and MCP authentication

Local MCP uses the loopback service and needs no second token. Shared/SaaS agents use a Lore token created in **Settings → Agent & MCP access**.

The full token is shown once. Lore stores only its SHA-256 hash plus name, prefix, user, organisation, scopes, expiry, last-used time, revocation, and creation time. Tokens cannot manage the account that created them and are rejected when organisation MCP access is disabled.

## Session and request security

- SaaS session tokens contain no user ID, role, email, or organisation data.
- Only session/API-token hashes are stored in PostgreSQL.
- Sessions expire after `AUTH_SESSION_TTL_HOURS` (1–720; default 24).
- SaaS session tokens rotate after login, organisation creation/switch, and invitation acceptance.
- Removed membership immediately stops tenant access.
- Cookies are `HttpOnly`, `SameSite=Lax`, signed, and `Secure` in production.
- Cookie-authenticated production mutations use CSRF protection.
- Viewer writes fail at the API boundary.
- Sensitive headers, cookies, keys, tokens, and API keys are redacted from structured logs.
- The local PAT fallback fails if `APP_URL` is not localhost/loopback.

## Quick setup

```bash
cd /Users/dev/Lore
npm run local:setup
# Set GITHUB_TOKEN and OPENAI_API_KEY in .env
npm run local:up
```

Open [http://localhost:5173](http://localhost:5173). Your profile and first private workspace appear automatically.

## Troubleshooting

### Local mode asks for OAuth or fixed IDs

Those values are obsolete for the normal local path. Ensure `LORE_DEPLOYMENT_MODE=local`, set `GITHUB_TOKEN`, rerun `npm run local:setup`, and remove blank OAuth/App/local-ID lines.

### Profile email is a GitHub noreply address

Some PATs cannot read `/user/emails`, and the GitHub profile may hide its public email. Lore then uses the stable GitHub noreply form for the local account. For SaaS invitation matching, use OAuth with verified-email scope.

### Another person cannot open the local invitation

Expected: every published local port is loopback-only. Use a reviewed shared deployment only after the [SaaS readiness](saas-readiness.md) gates are complete.

### SaaS callback is invalid or expired

Restart from Lore, finish within ten minutes, use the same browser, and keep the public hostname consistent. A second login, cleared cookie, or host change invalidates the first transaction.

### A user cannot see an invitation

Compare the invitation email with the verified email returned by GitHub OAuth. Revoke and recreate an incorrectly addressed invitation; link possession cannot bypass the match.

## External deployment boundary

The account and organisation foundation is implemented, but it does not by itself approve a SaaS launch. Enterprise OIDC/SAML, MFA enforcement, SCIM, support access, installation-ownership binding, immutable audit export, cryptographic tenant isolation, deletion/export, monitoring, incident response, legal documents, DPIA, PCI scope decisions, and independent penetration testing remain launch gates in [SaaS readiness](saas-readiness.md).
