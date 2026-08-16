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
- Membership is revalidated for authenticated API routes; local identity comes from the configured GitHub PAT rather than caller-supplied fixed IDs.
- Session cookies are HTTP-only and same-site. HTTPS deployments set `Secure`; loopback HTTP intentionally does not so local sessions work. State-changing cookie requests require both an exact configured Origin and a valid CSRF token.
- GitHub webhooks use a constant-time HMAC validation before parsing or processing events.
- GitHub deliveries and provider object IDs are idempotency keys.
- The local PAT is resolved only by the API and worker for identity, repository discovery, and history. Queue payloads and browser responses never carry it. SaaS App private keys remain server-side.
- Background-job errors redact GitHub/OpenAI/Bearer credential shapes before persistence; result summaries retain scalar counts/status only rather than raw provider objects.
- Native secret files must be regular, non-symlink files with owner-only permissions. The browser-visible integration status contains readiness booleans only.
- Local Git uses `spawn`/`execFile` argument arrays. Remote text never becomes a shell command.
- The API binds to `127.0.0.1` by default in development and production. Non-loopback deployments must opt in with `API_HOST` and terminate HTTPS at the proxy. Full production validates the request Host against `APP_URL`, `WEB_ORIGIN`, and optional SaaS-only `LORE_ALLOWED_HOSTS`; only liveness/readiness/metrics permit an internal loopback Host.
- Browsers cannot submit local checkout paths. The CLI uploads a sanitised graph; optional single-node path indexing requires `LORE_ALLOWED_REPOSITORY_ROOTS` and owner/path validation.
- Private `.lore` directories/files use 0700/0600 permissions, reject symlinked or foreign-owned state, enforce size limits, and use atomic replacement.
- Secrets are redacted from structured logs and are never stored in repository configuration.
- Policy and knowledge mutations produce audit events with before/after snapshots.
- Rate limiting is enabled at the API boundary.
- Raw diffs and source snippets have configurable retention; the long-term private-node design keeps source local.

Full local mode requires a 32+ character `SESSION_SECRET`, owner-only `.env`, loopback bindings, and one PAT belonging to the workstation user. It is not a multi-tenant credential model. It does not require `LORE_ALLOWED_HOSTS`, OAuth callbacks, a GitHub App, PEM files, or token-file variables. Shared production additionally requires HTTPS, restricted database credentials, Redis authentication, OAuth identity, GitHub App installations, and vault/KMS-backed secrets. Enterprise OIDC/SAML, MFA policy enforcement, SCIM, the final privileged role model, and managed secret infrastructure remain external-deployment gates.

This prototype is not approved for internet exposure, customer-data processing, or PCI-connected use. The required identity, tenant-isolation, privacy, DLP, operational, assurance, and PCI-scope work is tracked explicitly in [SaaS readiness](saas-readiness.md).
