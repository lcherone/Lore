<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="features.md"><strong>Features</strong></a> ·
  <a href="onboarding.md"><strong>Setup</strong></a>
</p>

# Security model

Lore treats source, tickets, comments, and documents as untrusted data.

- Tenant context is established from authenticated membership; organisation IDs from clients are never trusted alone.
- Membership is revalidated for authenticated API routes; persistent local-development IDs must correspond to a real membership row.
- Session cookies are secure, HTTP-only, same-site, and paired with CSRF protection for state-changing browser requests.
- GitHub webhooks use a constant-time HMAC validation before parsing or processing events.
- GitHub deliveries and provider object IDs are idempotency keys.
- GitHub PATs and App private keys are resolved only by the worker. Queue payloads carry an authentication mode and installation ID when applicable, never a secret.
- Native secret files must be regular, non-symlink files with owner-only permissions. The browser-visible integration status contains readiness booleans only.
- Local Git uses `spawn`/`execFile` argument arrays. Remote text never becomes a shell command.
- The API binds to `127.0.0.1` by default. Non-loopback deployments must opt in with `API_HOST` and terminate HTTPS at the proxy.
- Browsers cannot submit local checkout paths. The CLI uploads a sanitised graph; optional single-node path indexing requires `LORE_ALLOWED_REPOSITORY_ROOTS` and owner/path validation.
- Private `.lore` directories/files use 0700/0600 permissions, reject symlinked or foreign-owned state, enforce size limits, and use atomic replacement.
- Secrets are redacted from structured logs and are never stored in repository configuration.
- Policy and knowledge mutations produce audit events with before/after snapshots.
- Rate limiting is enabled at the API boundary.
- Raw diffs and source snippets have configurable retention; the long-term private-node design keeps source local.

Production deployments must provide a 32+ character `SESSION_SECRET`, HTTPS at the proxy, restricted database credentials, Redis authentication, and vault/KMS-backed storage for GitHub private keys and installation tokens. A local PAT is a bootstrap credential, not a multi-tenant credential model. GitHub OAuth login, hashed/revocable sessions, profiles, organisations, invitations, and baseline roles are shipped for the loopback local-production evaluation. Enterprise OIDC/SAML, MFA policy enforcement, SCIM, the final privileged role model, and managed secret infrastructure remain external-deployment gates.

This prototype is not approved for internet exposure, customer-data processing, or PCI-connected use. The required identity, tenant-isolation, privacy, DLP, operational, assurance, and PCI-scope work is tracked explicitly in [SaaS readiness](saas-readiness.md).
