# Lore implementation acceptance map

This document maps the original product brief to concrete, runnable Lore surfaces. It focuses on the desired first usable release and the ten MVP milestones; sections labelled “future” in the brief remain adapter boundaries or roadmap items.

## Closed-loop release

| Brief outcome | Shipped surface | How to prove it |
| --- | --- | --- |
| Connect a repository | Repository UI and `POST /api/repositories` | Connect a GitHub or local checkout from **Repositories** |
| Import 100–500 merged PRs | GitHub App adapter, bounded history job, BullMQ worker | Queue **Import history** with 100, 250, or 500 PRs |
| Preserve PR/review evidence | Idempotent evidence store and ingestion receipts | Repeat the same import; the second pass adds no duplicate evidence |
| Propose knowledge safely | Versioned, structured AI request and mock provider | Run the worker with `AI_PROVIDER=mock`; only validated candidates are created |
| Review candidates | Evidence, confidence, contradiction, edit, scope, class, merge, approve, and reject UI | Complete an action in **Candidates** and inspect the updated queue |
| Index local code/history | TypeScript and PHP AST analysis, safe Git adapter, co-change graph | Run `lore index` in a Git checkout |
| Prepare task context | Ranking, precedence, bounded impact, evidence, regressions, tests, unknowns | Run `lore prepare "task"` or use the dashboard |
| Observe agent changes | Allowlisted agent wrapper with two-second changed-path observation and context refresh | Run `lore agent codex "task"` |
| Verify independently | Diff, policy, impact, regression, rule, test, risk, and blocker evaluation | Run `lore verify`; blockers exit with code 2 |
| Learn from the resulting review | Signed, replay-safe GitHub webhook to evidence and extraction jobs | Send a valid subscribed review event and inspect the new candidate |

## MVP milestone coverage

1. **Core data model:** PostgreSQL/Prisma models, migration, tenant boundaries, evidence links, revisions, proposals, challenges, usage, sessions, reports, policies, and audit events.
2. **Local repository indexer:** local open/scan, language detection, TypeScript/PHP symbols, static relationships, bounded Git history, and statistically guarded co-change edges.
3. **GitHub import:** GitHub App installation flow, historical merged PRs, reviews, comments, commits, changed files, optional raw diff retention, bounded jobs, and idempotency.
4. **AI extraction:** replaceable provider contract, versioned prompts, untrusted-input separation, structured Zod output, deduplication/contradiction validation, scope suggestion, and server-side confidence.
5. **Knowledge review:** candidate search/filter, evidence, confidence explanation, contradictions, statement/scope/class editing, evidence-preserving merge, approve, reject, challenge, archive, and manual confirmation.
6. **Task context:** task concepts, candidate code, expanded impact, precedence-ranked knowledge, evidence, regressions, recommended tests, warnings, and explicit unknowns.
7. **MCP:** prepare, current context, search, symbol lookup, history, rules, decisions, impact, verification, explanation, and proposal validation tools over stdio.
8. **Change safety:** independent verification and persisted, human-readable safety reports with deterministic policy findings.
9. **Session observer:** session lifecycle, changed-file observation, progressive context refresh, and final verification.
10. **GitHub feedback loop:** HMAC validation, delivery replay protection, review evidence ingestion, and candidate extraction dispatch.

## Trust, privacy, and ownership

- AI cannot create policy, calculate enforcement authority, execute tools, or mutate the database directly.
- Evidence has stable source identity and remains attached through candidate approval and merge.
- Knowledge is typed, scoped, revisioned, explainable, confidence-labelled, challengeable, and decayed rather than silently overwritten.
- Repository retention controls independently govern summaries, review comments, raw PR diffs, and code snippets. Summary-only mode rejects contradictory raw-retention settings.
- Repository deletion requires the exact `owner/name`, cascades repository data, and challenges organisation-wide knowledge whose provenance was removed.
- Knowledge exports as JSON or Markdown. Imports accept JSON and Markdown files, including `AGENTS.md`, `CONTRIBUTING.md`, architecture documents, and ADRs, while recording the source name.
- Every persistent operation is organisation-scoped. Human writes, merges, retention changes, and destructive actions are audited.

## Operator acceptance commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:coverage
npm audit --omit=dev
docker compose config --quiet
```

For a real PostgreSQL boundary, run migrations and seed twice, then execute `npm run smoke:persistent`. The second seed must skip the existing demo organisation and the smoke script must prepare task context from persisted entities, evidence, candidates, and regressions.

For UI acceptance, verify the dashboard context modal, candidate scope/class/merge/approval flow, manual knowledge form, repository history/retention/delete controls, safety report, command palette, and mobile navigation. No browser console errors or warnings are expected.

## Deliberately extensible, not faked

The brief explicitly places these outside the first usable release: production SSO/membership administration, Slack/documentation sync, Jira/Linear provider implementations, GitHub Check and PR-comment publication, a hosted SaaS control plane, billing, and optional embeddings. Lore includes the relevant provider and service boundaries where they affect the core design, but does not present non-existent integrations as working features.

The only bundled AI provider is deterministic `mock`. A real provider requires an explicit adapter, credentials, evaluation fixtures, cost limits, and the same structured-output and no-direct-mutation guarantees.
