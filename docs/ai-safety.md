<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="features.md"><strong>Features</strong></a> ·
  <a href="onboarding.md"><strong>Setup</strong></a>
</p>

# AI safety

The governing rule is: **AI proposes. Deterministic systems discover and enforce. Evidence determines what becomes knowledge.**

AI is appropriate for classifying review comments, summarising reasoning, suggesting scope, explaining impact, identifying possible contradictions, and recommending how a person should review a candidate backlog. AI is not used for Git operations, graph traversal, permissions, tenant isolation, confidence calculation, database constraints, policy enforcement, evidence lookup, or performing candidate actions.

All provider responses pass a Zod schema. A malformed extraction creates no partial knowledge; triage checkpoints only complete validated batches, allowing durable retry without losing earlier recommendations. Prompts are versioned and split into system instructions, application instructions, and explicitly labelled untrusted source content. The provider has no database handle; it can only return a `KnowledgeProposal` or `CandidateTriageRecommendation` for deterministic validation.

Bulk review is a separate human-only API action. A candidate is eligible for bulk approval only when the recommendation is durable, unchanged, at least 90% confident, supported by at least two evidence records, has Lore confidence of at least 72%, and has no contradiction. Bulk ignore is limited to high-confidence one-off/situational items with no policy signal or contradiction. The server revalidates freshness and eligibility at mutation time. Possible policies, edits, duplicates, conflicts, and ambiguous items stay in individual review.

The proposal validator verifies evidence ownership, repository relevance, plausible scope, duplicates, contradictions, provenance, and operation permissions. A proposal that attempts to create policy is rejected unless it carries explicit human provenance.
