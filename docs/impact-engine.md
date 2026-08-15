<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="features.md"><strong>Features</strong></a> ·
  <a href="onboarding.md"><strong>Setup</strong></a>
</p>

# Impact engine

Lore combines deterministic code structure with historical signals instead of treating semantic similarity as dependency.

```mermaid
flowchart TD
  T[Task terms / changed symbols] --> M[Entity matches]
  M --> S[Static edges]
  M --> G[Git co-change]
  M --> P[PR and ticket history]
  S --> B[Bounded traversal]
  G --> B
  P --> B
  B --> K[Scoped knowledge + regressions]
  K --> R[Ranked context / safety report]
```

Static calls, imports, inheritance, and test links receive the strongest weight. Well-sampled co-change relationships are medium/high. Shared tickets and AI-inferred semantics are supporting signals only.

Traversal always applies `maxDepth`, `maxNodes`, a minimum confidence, and optional relationship filters. A one-of-one co-change is deliberately weak; Wilson scoring prevents tiny samples from appearing certain.

Verification calculates risk from affected entities, public interfaces, policies, regressions, missing related tests, high-risk integrations, and graph distance. The returned level is `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`, with human-readable reasons.
