# Design decisions

These decisions explain the product boundaries a new maintainer is most likely to question.

## One modular monolith first

The first usable release ships one TypeScript workspace with separate API, worker, web, CLI, and MCP processes. Package interfaces keep persistence, jobs, GitHub, AI, analysis, and domain logic replaceable without paying the operational cost of premature services.

## Source stays with the checkout

The trusted CLI owns repository paths and source parsing. Service mode uploads a bounded graph rather than the checkout. A browser cannot register a filesystem path. This prevents a control-plane request from turning into arbitrary server filesystem access and preserves a future private-node topology.

## Explicit authority, never fallback

Local, demo, and service are different trust and data authorities. They are persisted in `.lore/config.json` and surfaced in status output. An unavailable service is an error, not permission to answer with a fixture.

## Canonical UUIDs for durable identity

PostgreSQL UUID columns receive UUIDs on every normal runtime path. External provider identities are mapped to deterministic UUIDs where idempotency matters. The human-readable IDs in demo data are a presentation fixture, translated only at seed time.

## Evidence before knowledge

Ingestion creates immutable evidence and validated proposals. Only a human review or explicit human import creates active knowledge. Approval produces a revision and audit event; merge preserves evidence and updates proposal lineage; contradiction challenges rather than deletes.

## Deterministic enforcement

AI is useful for summarising and proposing meaning, but it cannot create policy or decide whether a change is safe. Policy patterns are validated before storage and scan only added diff lines with source line numbers. Impact bounds, confidence, precedence, and report outcomes are deterministic.

## Durable sessions, immutable context

A context package records what Lore told an agent at a point in time. Refresh creates a new revision. Append-only session events describe the lifecycle, and report creation completes the session in the same database transaction. Failed agent processes are abandoned explicitly.

## Honest operational states

Liveness and readiness are different. Readiness checks the configured database and queue. Demo jobs are labelled simulated. The web never mutates a local copy after an API failure and shows a disconnected screen until the API is reachable.

## Local auth is not production identity

The bundled signed session and loopback local-development identity make the release runnable and testable. Production SSO, user provisioning, and membership administration are deployment integrations still to be supplied; documentation and UI do not represent them as shipped.

