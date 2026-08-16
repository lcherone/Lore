<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="capabilities.md"><strong>Current capabilities</strong></a> ·
  <a href="acceptance.md"><strong>Acceptance</strong></a>
</p>

# `.ideas2` compatibility review and delivery roadmap

This page turns `.ideas2` into an actionable backlog without treating the planning file as an override. Every proposal was checked against the current source, Prisma schema, API, worker, CLI, MCP, web application, tests, and documentation on 2026-08-16.

## How to read the status

- **Shipped:** present in the current tree with focused automated proof.
- **Partial:** a useful implementation exists, but one or more acceptance boundaries remain open.
- **Planned:** compatible with Lore, but not implemented.
- **Deferred:** compatible only after its listed dependency or product gate.
- **Rejected:** conflicts with a current non-negotiable product or trust boundary.
- **Stale:** the observation in `.ideas2` no longer describes this Git worktree.

Documentation and smoke scripts count as evidence of intent or an executed path only when their required infrastructure is actually run. A passing in-memory test is not proof of PostgreSQL, Redis, GitHub, browser, or agent-process behaviour.

## Review conclusions

The proposal remains directionally compatible with Lore. It does not require a rewrite or a merge with DailyReport/StokerAPI. The current tree has already completed parts of the original Phase 0, Phase 1, Phase 2, Phase 3, and Phase 5 suggestions. Work should continue as bounded vertical slices around the existing `LoreStore`, `JobDispatcher`, `LoreClient`, graph, context, and verification contracts.

The following suggestions are intentionally not adopted:

1. Evidence volume may never auto-promote knowledge. Human approval remains mandatory.
2. Browser requests may never choose an arbitrary server path. Use a trusted root or local graph upload.
3. Lore will not expose a generic shell or Stoker operation runner.
4. Lore will not copy DailyReport's mutable JSON stores or become a broad Mission Control dashboard.
5. A real AI provider and additional source providers will not precede durable ingestion, lineage, budgets, and review gates.
6. Persistent failures will never fall back to demo data or fabricated write success.
7. External SaaS or regulated-data use will not be presented as approved before the security and governance gates pass.

## Actionable compatibility matrix

### Foundation and runtime truth

| ID  | Suggestion                                              | Current implementation and compatibility                                                                                                         | Status                | Action and acceptance                                                                                 |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------- |
| F01 | Establish a Git baseline before phase work              | Lore now has `.git`; the no-worktree observation is obsolete. Existing uncommitted work still requires preservation.                             | Stale                 | Keep pre-edit `git status`/diff checks; never initialise or reset Git as part of this plan.           |
| F02 | Make demo, local, and service explicit                  | API demo/service and CLI local/demo/service authorities exist; the web fails disconnected instead of loading fixtures.                           | Shipped               | Keep mode labels and add regression coverage whenever an adapter is added.                            |
| F03 | Maintain route, job, mode, and visible-capability truth | Routes and jobs existed but had no mechanically checked inventory.                                                                               | Shipped in this slice | Maintain [capabilities](capabilities.md); `capability-inventory.test.ts` must fail on drift.          |
| F04 | Record core architecture decisions                      | `docs/decisions.md` records ID, trust topology, authority, evidence, policy, sessions, operations, and auth boundaries.                          | Shipped               | Split into numbered ADRs only when a decision needs alternatives, migration, or supersession history. |
| F05 | Keep a modular monolith plus worker/local node          | Current packages and executables already follow this shape.                                                                                      | Shipped               | Do not introduce microservices until measured scaling/isolation needs justify them.                   |
| F06 | Distinguish proven, inferred, recommended, and unknown  | Context/report types expose confidence, relationship sources, recommended tests, warnings, and unknowns; language is not yet uniform everywhere. | Partial               | Add a shared proof classification and render it consistently in API, CLI, MCP, reports, and UI.       |

### Identity, persistence, jobs, and lifecycle

| ID  | Suggestion                                     | Current implementation and compatibility                                                                                                                                                                                                                        | Status            | Action and acceptance                                                                                                                                                          |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P01 | Canonical persistent UUID policy               | `newUuid` and namespace-isolated deterministic UUIDs exist; runtime graph uploads validate UUIDs. Demo fixtures still use friendly IDs and seed translation.                                                                                                    | Partial           | Migrate fixtures/store conformance to the production ID contract or make fixture-only IDs impossible to cross persistence. Prove all durable writes parse as UUIDs.            |
| P02 | One store contract for memory and Prisma       | Both adapters implement `LoreStore`; only focused memory tenant tests and an environment smoke cover persistence.                                                                                                                                               | Partial           | Create a reusable conformance suite for both adapters covering lifecycle, tenancy, replay, constraints, and restart. Infrastructure absence must report **not run**, not pass. |
| P03 | PostgreSQL restart lifecycle proof             | `smoke:persistent` exercises runtime IDs, graph upload, manual knowledge, context, report, completion, reconnect, and readback.                                                                                                                                 | Partial           | Extend it to import → proposal → candidate → approval and run it in CI against disposable PostgreSQL.                                                                          |
| P04 | Durable `JobRun` and `JobEvent`                | BullMQ transport has retry/idempotent job IDs, and readiness pings Redis. No durable product job record exists.                                                                                                                                                 | Planned, P0       | Add schema/store/service state for queued, running, progress, retrying, succeeded, failed, cancelled, dead-letter, and reconciliation. Prove terminal state after restart.     |
| P05 | Transactional outbox                           | Webhook receipt is deliberately saved after dispatch to prefer replay over loss, but persistence and dispatch are not one transaction.                                                                                                                          | Planned, P0       | Persist business event plus outbox atomically; dispatch idempotently; prove crash/replay and unavailable-queue recovery.                                                       |
| P06 | Separate bounded job lanes                     | One worker uses configurable concurrency; repository-local and external work are not isolated/locked.                                                                                                                                                           | Planned           | Add named lanes and repository locks after durable job state, then test concurrent imports and local mutations.                                                                |
| P07 | Real dependency readiness and clean shutdown   | Store and dispatcher health are called by `/readyz`; API closes the dispatcher; worker closes queue/Redis.                                                                                                                                                      | Shipped           | Add bounded timeout/error-code tests and make database closure ownership explicit.                                                                                             |
| P08 | Session state machine                          | Preparing, active, verifying, completed, and abandoned types plus guarded terminal operations exist. Failed/ready states, optimistic revisions, and idempotency keys do not.                                                                                    | Partial           | Centralise transitions, add revision/idempotency, retain failure/interruption outcomes, and table-test every valid/invalid edge.                                               |
| P09 | Immutable context revisions and session events | Both stores persist context records and append lifecycle events; API exposes events.                                                                                                                                                                            | Shipped with gaps | Add stable input hash/idempotency and concurrency-safe sequence allocation. Prove repeated refresh has the intended effect.                                                    |
| P10 | Observation and report provenance              | Verification now creates a first-class bounded `ChangeObservation`, stores only patch hashes in its manifest, links explicit observation/context revision/base/current columns to the report in the completion transaction, and exposes tenant-scoped readback. | Shipped with gaps | Add retry idempotency and include observation readback in the shared memory/Prisma conformance suite.                                                                          |

### Authentication, tenancy, local trust, and state

| ID  | Suggestion                                          | Current implementation and compatibility                                                                                                                                        | Status      | Action and acceptance                                                                                                      |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| S01 | Browser cannot select arbitrary filesystem paths    | Repository input omits `localPath`; server indexing requires a stored path under configured trusted roots; CLI can upload a bounded graph.                                      | Shipped     | Add negative traversal/root/ownership tests around registration and worker execution.                                      |
| S02 | Trusted local node topology                         | CLI owns checkout parsing and service graph upload; a separately authenticated node protocol does not exist.                                                                    | Partial     | Define scoped `LocalNode` identity and envelope version only after API token/session foundations.                          |
| S03 | Loopback by default and explicit network/TLS opt-in | Development binds loopback. The production server currently defaults to all interfaces, so the stronger rule is not yet true.                                                   | Partial, P0 | Make non-loopback bind explicit and validate TLS/proxy assumptions; preserve deployment-specific work while changing this. |
| S04 | Exact Host and Origin validation                    | CORS uses configured origins; exact request Host/Origin enforcement is not complete.                                                                                            | Planned, P0 | Add allowlist validation and negative tests for forged/missing values while preserving health checks and trusted proxies.  |
| S05 | Opaque revocable auth sessions                      | Current signed cookie contains user/organisation/name. Membership is revalidated, but token material is not opaque/server-side.                                                 | Planned, P0 | Add `AuthSession` with hashed token, expiry, revocation, last-seen, rotation, and logout.                                  |
| S06 | Scoped CLI/MCP/local-node tokens                    | CLI reads `LORE_API_TOKEN`, but no durable hashed token model or scope enforcement exists.                                                                                      | Planned, P0 | Add `ApiToken` scopes and tenant/repository checks; never store bearer material in `.lore`.                                |
| S07 | CSRF for browser mutations                          | Bootstrap exists and production cookie writes use the Fastify guard; the production identity flow is not complete.                                                              | Partial     | Prove browser cookie mutations reject missing/invalid tokens and bearer requests use a separate rule.                      |
| S08 | Tenant-coherent associations                        | Membership and many repository/session lookups are organisation scoped; broad store conformance and composite constraints are incomplete.                                       | Partial, P0 | Add negative cross-tenant store/API matrix for every related ID and installation routing.                                  |
| S09 | Private, atomic local state                         | Owner/mode/symlink/size checks, `0700`/`0600`, fsync and atomic rename exist. Retention, directory ownership, schema bounds for every artifact, and corruption recovery remain. | Partial     | Add bounded history retention and explicit quarantine/recovery tests without silently discarding corrupt state.            |
| S10 | No secrets/raw source in logs                       | Logger redaction and worker-only GitHub credential loading exist. Systematic content logging tests/DLP do not.                                                                  | Partial     | Add log-capture tests, pre-ingestion secret/DLP policy, and customer-controlled quarantine before external deployment.     |

### Git, analysis, context, and agent workflow

| ID  | Suggestion                                | Current implementation and compatibility                                                                                                                                                                                          | Status            | Action and acceptance                                                                                                                                                                  |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 | One `LoreClient` authority for CLI/MCP    | HTTP client and explicit local/demo/service config exist; MCP reuses CLI runtime.                                                                                                                                                 | Shipped with gaps | Add contract/process tests proving API, CLI, MCP return the same service context and never inject fixture knowledge.                                                                   |
| C02 | Complete Git change discovery             | Porcelain-v2/NUL status plus bounded staged, unstaged, renamed, deleted, and untracked patch collection exists with a real-repository test.                                                                                       | Shipped           | Add binary, conflict, submodule, unusual-name, base-revision, and combined staged/unstaged edge cases.                                                                                 |
| C03 | Overlay changed graph before verification | Verification uses the stored pre-change graph; new/deleted/changed symbols are not overlaid.                                                                                                                                      | Planned, P0       | Incrementally analyse the bounded change set, remove deleted entities, then report graph freshness and unknowns.                                                                       |
| C04 | AgentAdapter with one proven integration  | `lore agent codex` passes initial context in the Codex prompt, watches Git, refreshes a file, and runs terminal verification. It has no adapter interface/process test and cannot inject refreshed context into the active child. | Partial, P0       | Extract `AgentAdapter`, prove Codex invocation/help contract in a fake process harness, record every outcome, and label refresh as file-based until a supported live mechanism exists. |
| C05 | Mandatory lifecycle closure               | Successful wrapper runs verify; non-zero exits abandon. Signals, spawn failure, verification failure, and stale local/service session reconciliation are incomplete.                                                              | Partial           | Add success/failure/signal/verification-error/abandon tests and make terminal state idempotent.                                                                                        |
| C06 | True/false/unknown scope semantics        | Missing required path/symbol/context dimensions now fail matching, and tests cover leakage.                                                                                                                                       | Shipped with gaps | Either supply reliable team/framework/ticket dimensions or remove them from public creation schemas. Add full dimension tables.                                                        |
| C07 | Deterministic ranking and context budgets | Specificity/confidence/relevance/tie-breaking and item caps exist; there is no token budget or omission explanation.                                                                                                              | Partial           | Score mandatory policies separately, add deterministic token/entry budgets, provenance quality/recency/challenge factors, and explain omissions.                                       |
| C08 | Actionable rendered context               | CLI context includes statements, inclusion reason, confidence, evidence excerpt, tests, regressions, and unknowns.                                                                                                                | Shipped           | Keep parity in MCP/web and redact excerpts according to retention.                                                                                                                     |
| C09 | Realistic TypeScript/PHP analyzer proof   | PHP fixture indexing and graph tests exist; TypeScript/PHP multi-file alias/namespace/duplicate-name precision/recall fixtures do not.                                                                                            | Partial           | Add labelled repositories and measure claimed relationships; leave dynamic/ambiguous edges explicitly unknown.                                                                         |
| C10 | Safe, source-aware policy evaluation      | Creation bounds/validates patterns; evaluator scans added lines and reports target source lines; adversarial coverage is limited.                                                                                                 | Shipped with gaps | Expand pathological regex/large-patch/rename tests or adopt a linear-time engine before external untrusted policy creation.                                                            |
| C11 | Executed versus recommended tests         | Reports expose tests changed/recommended/missing but do not execute tests or carry a formal proof state.                                                                                                                          | Partial           | Add explicit `not_run`, `passed`, `failed`, `recommended`, and `unavailable` evidence; never infer execution from a changed test file.                                                 |

### GitHub, evidence, and knowledge lineage

| ID  | Suggestion                                     | Current implementation and compatibility                                                                                                        | Status               | Action and acceptance                                                                                                                      |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| G01 | PAT and App historical import                  | Both auth modes exist; all merged PRs and PR/review/comment/commit/file collections paginate; worker credentials stay out of payloads.          | Shipped              | Keep PAT local-only guidance and test rate-limit/retry behaviour with provider fixtures.                                                   |
| G02 | Installation/source ownership models           | Repository stores installation/provider IDs and webhook routing checks them, but callback ownership is not durably bound to an authorised user. | Planned, P0 for SaaS | Add `SourceConnection`, `GitHubInstallation`, and `RepositoryConnection`; verify installation access before linking.                       |
| G03 | Immutable `SourceEvent` and evidence revisions | Evidence is stable and idempotent by external ID, but edited content is skipped rather than versioned.                                          | Planned, P0          | Add artifact/revision identity, content hashes, supersession, minimal raw retention, and edit/replay tests.                                |
| G04 | Checkpointed, resumable bounded import         | Provider pagination exists; durable cursor/watermark/rate-limit state does not.                                                                 | Planned              | Add `SyncCheckpoint` after source connections and outbox; prove pause, restart, and resume.                                                |
| G05 | Import/webhook share extraction contract       | Both paths queue `knowledge.extract`; dispatch is not outbox-backed.                                                                            | Partial              | Route both through the same persisted source-event/outbox operation.                                                                       |
| G06 | Complete proposal → candidate → item lineage   | Candidates can link `proposalId`; approval/merge preserves evidence, revisions, and audit. Proposal terminal state is not consistently closed.  | Partial              | Make review transactionally update proposal/candidate/item/revision and retain reviewer rationale.                                         |
| G07 | Normalised regression evidence                 | Regression records exist, but several relationships remain JSON/payload based.                                                                  | Partial              | Link regression evidence/affected entities explicitly when lineage schema is introduced.                                                   |
| G08 | Knowledge usage and outcome feedback           | Context persistence writes `KnowledgeUsage`; later verification outcome is not attached.                                                        | Partial              | Store inclusion rank/reason/revision and terminal report outcome; use it for health only after evaluation.                                 |
| G09 | Human approval gate                            | AI proposes and cannot create policy; candidate approval is explicit.                                                                           | Shipped, invariant   | Reject any `.idea` suggestion that promotes knowledge solely from evidence count. Confidence may prioritise review, never grant authority. |
| G10 | Ad-hoc communication evidence                 | Web/API accept authorised notes and transcripts, retain provenance, extract explicit signals, compare with approved knowledge, and create review-only candidates. The bundled extractor is local and deterministic. | Shipped locally      | Add configurable redaction/raw-text retention and an evaluated real-provider adapter only after the SaaS privacy gates; keep human approval invariant. |

### Web, operations, AI, and future integrations

| ID  | Suggestion                                      | Current implementation and compatibility                                                                           | Status                       | Action and acceptance                                                                                                                                       |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O01 | Truthful web modes and capability gating        | Loading/disconnected states and mutation guards exist; job progress/freshness and capability metadata are limited. | Partial                      | Add typed capability/freshness payloads and terminal-job refresh after durable jobs exist.                                                                  |
| O02 | Real component/browser MVP proof                | Current unit/API tests do not run the complete browser journey.                                                    | Planned, P0 before MVP claim | Add component tests and a PostgreSQL/Redis/GitHub-fixture browser suite; forced API failure must never show fixture success.                                |
| O03 | Stable readers and terminal refresh             | App bootstrap is stable at page level; there is no durable event stream/job terminal refresh contract.             | Deferred                     | Implement after `JobRun`/`JobEvent`; clean up timers and in-flight requests in tests.                                                                       |
| O04 | Real AI provider                                | Only deterministic mock extraction ships, which matches the safety boundary.                                       | Deferred                     | Add one provider only after source lineage/outbox/budgets; validate output and record model, prompt, cost, latency, and evaluation version.                 |
| O05 | WorkItemProvider/DailyReport                    | Interface-level idea is compatible; no connector should copy its stores or broaden Lore.                           | Deferred                     | After the GitHub/local MVP, accept only task reference/text/status/compact memory and return compact session/report references.                             |
| O06 | Redacted Stoker outcome evidence                | A versioned evidence envelope is compatible; command execution is not.                                             | Deferred                     | After source-event lineage, ingest IDs/commit/environment/outcome/timestamps/reference only; reject credentials, commands, raw logs, and paths.             |
| O07 | Backup, restore, retention, export, deletion    | Knowledge export/repository deletion/retention exist; full tenant privacy lifecycle and backup propagation do not. | Planned, SaaS P0             | Add tenant export/deletion, backup restore tests, retention jobs, legal-hold rules, and audit evidence before hosting.                                      |
| O08 | OpenAPI and contract drift                      | Zod schemas and docs exist; no generated OpenAPI/drift gate.                                                       | Planned                      | Generate from route schemas or adopt a typed route registry after current contracts stabilise.                                                              |
| O09 | Metrics, reconciliation, dead-letter operations | Basic request/webhook metrics exist; product job and knowledge-quality metrics do not.                             | Deferred                     | Add after durable jobs and usage outcomes; metrics must not expose source/evidence content.                                                                 |
| O10 | Customer-managed node and external SaaS         | The topology is a compatible target, not a shipped deployment.                                                     | Deferred, governance-gated   | Follow [SaaS readiness](saas-readiness.md); require threat model, DPIA/DPA, PCI scope decision, DLP, KMS, incident/BCP, independent testing, and approvals. |
| O11 | Broader providers/dashboard/command runner      | More source providers may eventually be useful; a broad dashboard or generic runner conflicts with Lore's centre.  | Rejected for current roadmap | Keep GitHub first. Re-evaluate a provider only after the MVP and only through the same source-event contract.                                               |

## Delivery order and hard gates

The matrix is implemented in this dependency order. A later slice may be designed in parallel, but it must not be marketed or treated as complete before the earlier gate passes.

### Slice 0 — truthful baseline

Scope: F01–F06 and the current capability inventory.

Gate:

- unit tests, typecheck, lint, and build pass;
- route/job changes fail the inventory contract if docs drift;
- current versus planned claims are explicit;
- concurrent work is preserved.

### Slice 1 — persistent conformance and full report provenance

Scope: P01–P03, P08–P10, and S08.

Gate:

- the same store suite passes against memory and disposable PostgreSQL;
- context/session/report lifecycle survives restart;
- every report links the exact context revision and change observation;
- cross-tenant references fail;
- fixture identifiers cannot reach UUID columns.

### Slice 2 — durable asynchronous evidence pipeline

Scope: P04–P06 and G02–G06.

Gate:

- source event/evidence revision/outbox/job effects survive queue loss and restart;
- replay creates one business effect;
- edited evidence creates a revision;
- import resumes from a checkpoint;
- every approved item traces to immutable evidence and a human decision.

### Slice 3 — production-local trust and identity

Scope: S01–S10.

Gate:

- opaque/revocable sessions and scoped tokens exist;
- Host, Origin, CSRF, membership, tenant, path, symlink, permission, and payload negative tests fail closed;
- non-loopback exposure is explicit and protected;
- no secret or raw evidence appears in logs.

### Slice 4 — reliable local agent workflow

Scope: C01–C05 and C11.

Gate:

- API, CLI, and MCP return the same persisted service context;
- Codex adapter process tests cover success, non-zero exit, interruption, verification failure, and abandonment;
- graph overlay accounts for new/changed/deleted code;
- reports distinguish executed from recommended tests.

### Slice 5 — retrieval and analysis quality

Scope: C06–C10, G07–G08.

Gate:

- labelled retrieval fixtures meet an agreed relevance/noise threshold;
- token and item budgets are deterministic;
- multi-file TS/PHP fixtures support the claims shown to users;
- scope unknowns never leak knowledge;
- usage and outcomes are auditable, not hidden ranking feedback.

### Slice 6 — truthful web MVP

Scope: O01–O03.

Gate: one real browser journey completes import, review, context, session, verification, restart/readback, and replay without fixture fallback or fake success.

### Slice 7 — narrow integrations

Scope: O04–O06. Real AI, DailyReport, and Stoker are separate opt-in slices and may be disabled without weakening the GitHub/local product.

### Slice 8 — operations and external readiness

Scope: O07–O10. No external launch is approved by code completion alone; governance evidence and named approval remain mandatory.

## Next implementation slice

The next code change should continue **Slice 1 with the shared memory/Prisma store conformance suite and idempotent lifecycle writes**. First-class change observation/report provenance is now present; the next gate is proving identical behaviour, tenancy, retry, and restart semantics on both adapters. Do not start with another provider, dashboard section, or real AI adapter.
