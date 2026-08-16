<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="features.md"><strong>Features</strong></a> ·
  <a href="onboarding.md"><strong>Setup</strong></a>
</p>

# Lore implementation acceptance map

This document maps the original product brief to concrete, runnable Lore surfaces. It focuses on the desired first usable release and the ten MVP milestones; sections labelled “future” in the brief remain adapter boundaries or roadmap items.

## Closed-loop release

| Brief outcome                   | Shipped surface                                                                                                              | How to prove it                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Connect a repository            | GitHub repository UI/API plus trusted local CLI                                                                              | Connect GitHub from **Repositories**; use `lore connect` for a checkout without exposing its path to the browser |
| Import merged PR history        | Local PAT or GitHub App adapter, chosen-limit/all history job, BullMQ worker                                                  | Connect a repository for the default complete import, or queue 100, 250–1,000, or all merged PRs manually       |
| Preserve PR/review evidence     | Stable source identities, immutable evidence revisions, and ingestion receipts                                               | Repeat unchanged input for no duplicate; edit retained input and confirm a new revision                          |
| Capture communication evidence  | Authorised note/transcript form, stable evidence identity, structured extraction, comparison labels, and candidate handoff  | Use **Add evidence**, submit the example twice, and confirm one evidence record plus no duplicate candidate      |
| Propose knowledge safely        | Versioned, structured AI request with deterministic mock and real OpenAI Responses adapters                                  | Run tests with `AI_PROVIDER=mock`, then `npm run ai:check`; only schema-validated candidates are created          |
| Review candidates               | Evidence, confidence, contradiction, edit, scope, class, merge, approve, and reject UI                                       | Complete an action in **Candidates** and inspect the updated queue                                               |
| Index local code/history        | TypeScript and PHP AST analysis, safe Git adapter, co-change graph                                                           | Run `lore index` in a Git checkout                                                                               |
| Prepare task context            | Ranking, precedence, bounded impact, evidence, regressions, tests, unknowns                                                  | Run `lore prepare "task"` or use the dashboard                                                                   |
| Observe agent changes           | Codex adapter with prompt-delivered context, bounded Git status observation, persisted refresh, and abandoned-state handling | Run `lore agent codex "task"`                                                                                    |
| Verify independently            | Diff, policy, impact, regression, rule, test, risk, and blocker evaluation                                                   | Run `lore verify`; blockers exit with code 2                                                                     |
| Learn from the resulting review | Signed, replay-safe GitHub webhook to evidence and extraction jobs                                                           | Send a valid subscribed review event and inspect the new candidate                                               |

## MVP milestone coverage

1. **Core data model:** PostgreSQL/Prisma models, migrations, canonical UUIDs, membership boundaries, evidence links, revisions, proposals, challenges, usage, sessions, immutable context records, bounded change observations, append-only session events, linked reports, policies, and audit events.
2. **Local repository indexer:** local open/scan, language detection, TypeScript/PHP symbols, static relationships, bounded Git history, and statistically guarded co-change edges.
3. **GitHub import:** server-side PAT or GitHub App authentication, token-visible local repository discovery, installation-scoped SaaS App routing, paginated merged PRs, submitted reviews, inline and conversation comments, commits, changed files, optional raw diff retention, chosen-limit/all jobs, and idempotency.
4. **AI extraction:** replaceable provider contract, versioned prompts, untrusted-input separation, structured Zod output, deduplication/contradiction validation, scope suggestion, and server-side confidence.
5. **Knowledge review:** ad-hoc communication capture, transcript signal extraction, new/duplicate/support/conflict comparison, candidate search/filter, evidence, confidence explanation, contradictions, statement/scope/class editing, evidence-preserving merge, approve, reject, challenge, archive, and manual confirmation.
6. **Task context:** task concepts, candidate code, expanded impact, precedence-ranked knowledge, evidence, regressions, recommended tests, warnings, and explicit unknowns.
7. **MCP:** prepare, current context, search, symbol lookup, history, rules, decisions, impact, verification, explanation, and proposal validation tools over stdio.
8. **Change safety:** independent verification and persisted, human-readable safety reports with deterministic policy findings.
9. **Session observer:** durable session lifecycle, append-only events, staged/unstaged/renamed/deleted/untracked observation, progressive context revisions, final verification, and atomic report/session completion.
10. **GitHub feedback loop:** HMAC validation, delivery replay protection, review evidence ingestion, and candidate extraction dispatch.

## Trust, privacy, and ownership

- AI cannot create policy, calculate enforcement authority, execute tools, or mutate the database directly.
- Evidence has stable source identity and remains attached through candidate approval and merge.
- Knowledge is typed, scoped, revisioned, explainable, confidence-labelled, challengeable, and decayed rather than silently overwritten.
- Repository retention controls independently govern summaries, review comments, raw PR diffs, and code snippets. Summary-only mode rejects contradictory raw-retention settings.
- Repository deletion requires the exact `owner/name`, cascades repository data, and challenges organisation-wide knowledge whose provenance was removed.
- Knowledge exports as JSON or Markdown. Imports accept JSON and Markdown files, including `AGENTS.md`, `CONTRIBUTING.md`, architecture documents, and ADRs, while recording the source name.
- Every authenticated operation revalidates organisation membership. Human writes, merges, retention changes, and destructive actions are audited.
- Demo, local, service, disconnected, and loading states are explicit; an API failure cannot fabricate data or write success.

## Operator acceptance commands

```bash
npm run demo:check
npm run typecheck
npm run lint
npm test
npm run build
npm run test:coverage
npm run smoke:evidence
npm run smoke:jobs
npm audit --omit=dev
docker compose config --quiet
docker compose -f docker-compose.yml -f docker-compose.github-token.yml config --quiet
```

Documentation acceptance additionally requires every `docs/*.md` page to use the shared header, every local Markdown link/image to resolve, SVG assets to parse, and feature screenshots to be captured from the working demo at the documented desktop/mobile viewports. The current inventory and refresh rules are in the [brand guide](brand.md); the product walkthrough is in the [feature guide](features.md).

For a real PostgreSQL boundary, run migrations and seed twice, then execute `npm run smoke:persistent`. The second seed must skip the existing demo organisation. The smoke script exercises ordinary runtime UUID generation, a sanitised graph upload, manual evidence/knowledge writes, persisted context revision, bounded change observation, linked report and session completion, then reconnects with a new Prisma client and reads the durable state. Redis/worker delivery is a separate environment check: `npm run smoke:queue` proves readiness, idempotent dispatch, and consumption against an isolated Redis process. Persistence smoke deliberately injects the in-memory dispatcher so a missing Redis process cannot masquerade as a queue pass.

For UI acceptance, verify the dashboard context modal, Add evidence transcript flow and repeat-submit idempotence, candidate scope/class/merge/approval flow, manual knowledge form, repository history/retention/delete controls, safety report, command palette, and mobile navigation. No browser console errors or warnings are expected.

## Deliberately extensible, not faked

The brief explicitly places these outside the first usable release: enterprise SSO/SCIM, Slack/documentation sync, Jira/Linear provider implementations, GitHub Check and PR-comment publication, a hosted SaaS control plane, billing, and optional embeddings. Lore includes the relevant provider and service boundaries where they affect the core design, but does not present non-existent integrations as working features.

Demo and tests use the bundled deterministic `mock` provider. Full local mode ships an OpenAI Responses adapter with strict structured output, explicit credentials, `store: false`, and the same proposal-only/no-direct-mutation guarantees. Provider evaluation fixtures, organisation cost limits, and SaaS privacy approval remain external-deployment work.
