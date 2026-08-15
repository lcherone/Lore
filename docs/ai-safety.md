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

AI is appropriate for classifying review comments, summarising reasoning, suggesting scope, explaining impact, and identifying possible contradictions. AI is not used for Git operations, graph traversal, permissions, tenant isolation, confidence calculation, database constraints, policy enforcement, or evidence lookup.

All provider responses pass a Zod schema. A malformed response fails atomically and creates no partial knowledge. Prompts are versioned and split into system instructions, application instructions, and explicitly labelled untrusted source content. The provider has no database handle; it can only return a `KnowledgeProposal` for validation.

The proposal validator verifies evidence ownership, repository relevance, plausible scope, duplicates, contradictions, provenance, and operation permissions. A proposal that attempts to create policy is rejected unless it carries explicit human provenance.
