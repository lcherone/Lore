# Security model

Lore treats source, tickets, comments, and documents as untrusted data.

- Tenant context is established from authenticated membership; organisation IDs from clients are never trusted alone.
- Session cookies are secure, HTTP-only, same-site, and paired with CSRF protection for state-changing browser requests.
- GitHub webhooks use a constant-time HMAC validation before parsing or processing events.
- GitHub deliveries and provider object IDs are idempotency keys.
- Local Git uses `spawn`/`execFile` argument arrays. Remote text never becomes a shell command.
- Secrets are redacted from structured logs and are never stored in repository configuration.
- Policy and knowledge mutations produce audit events with before/after snapshots.
- Rate limiting is enabled at the API boundary.
- Raw diffs and source snippets have configurable retention; the long-term private-node design keeps source local.

Production deployments must provide a 32+ character `SESSION_SECRET`, HTTPS at the proxy, restricted database credentials, Redis authentication, and encrypted storage for GitHub private keys and installation tokens.

