<p align="center">
  <a href="../README.md"><img src="assets/lore-docs-header.svg" alt="Lore documentation — engineering memory, evidence, and governance" width="100%" /></a>
</p>

<p align="center">
  <a href="../README.md"><strong>Project home</strong></a> ·
  <a href="README.md"><strong>Documentation</strong></a> ·
  <a href="features.md"><strong>Features</strong></a> ·
  <a href="onboarding.md"><strong>Setup</strong></a>
</p>

# Lore brand system

Lore should feel like a calm technical archive: precise enough for engineers, editorial enough to make institutional memory tangible, and honest enough that every claim can point back to evidence.

## Brand idea

**Name:** Lore

**Primary line:** Engineering memory that can show its work.

**Product promise:** Lore remembers why—then shows the evidence.

**Positioning:** The evidence-backed context and governance layer around people and AI coding agents.

**Personality:** precise, calm, quietly confident, technically honest, useful before impressive, and comfortable saying “unknown.”

## The mark

The layered mark carries three meanings at once:

1. an open book for accumulated engineering knowledge;
2. repository and evidence strata beneath every decision;
3. a bounded graph whose relationships can be explained.

Do not rotate, fill, skew, add glow, recolour individual layers, or place the mark over a busy image. Keep at least one quarter of the mark’s width as clear space.

## Visual assets

| Asset | Use |
| --- | --- |
| [`lore-readme-hero.png`](assets/lore-readme-hero.png) | Primary GitHub/readme and launch hero |
| [`lore-lockup.svg`](assets/lore-lockup.svg) | Wide product identity and primary line |
| [`lore-docs-header.svg`](assets/lore-docs-header.svg) | Consistent header across every documentation page |
| [`lore-demo-terminal.svg`](assets/lore-demo-terminal.svg) | One-command setup and readiness proof |
| [`lore-mark.svg`](../apps/web/public/brand/lore-mark.svg) | Favicon, compact product mark, square placements |
| [`lore-wordmark.svg`](../apps/web/public/brand/lore-wordmark.svg) | Product wordmark on light surfaces |
| [`screenshots/`](assets/screenshots/) | Current working product views for docs and announcements |

The generated hero is a raster brand asset. The mark, lockups, headers, diagrams, controls, and icons remain production-quality vectors or code-native UI.

## Palette

| Role | Name | Hex | Meaning |
| --- | --- | --- | --- |
| Foundation | Archive ink | `#071522` | Trusted navigation, infrastructure, depth |
| Primary action | Signal coral | `#f04e3e` | Human decisions, current selection, primary action |
| Primary hover | Deep coral | `#d93e32` | Active control feedback |
| Evidence | Evidence teal | `#0b8f72` | Supported, verified, healthy |
| Evidence soft | Archive sage | `#9fcebd` | Provenance lines and quiet verified surfaces |
| Attention | Review brass | `#c98612` | Caution, contradiction, needs review |
| Blocker | Block red | `#dc3e43` | Failed or prohibited state |
| Canvas | Paper white | `#ffffff` | Main workspace; always true white |
| Wash | Cool wash | `#f7f9f9` | Secondary surfaces without warming the canvas |
| Text | Slate | `#17202b` | Primary copy |
| Muted | Evidence grey | `#66717d` | Supporting metadata |
| Border | Hairline | `#dfe4e7` | Structure without card-heavy framing |

Coral means an intentional decision or action, not generic decoration. Teal means evidence or health, not “AI magic.” Brass and red must retain their semantic meaning.

## Typography

- Product and documentation UI: Inter, Avenir Next, Segoe UI, then Arial/sans-serif.
- Source paths, commands, symbols, evidence IDs, and structured output: SFMono-Regular, Consolas, Liberation Mono, then monospace.
- Headings use compact tracking and sentence case.
- Buttons and controls have deliberate smaller UI typography; never fall back to browser defaults.
- Avoid all-caps prose. Small uppercase is reserved for a lockup line or compact metadata.

## UI composition

- Use one dark navigation foundation and a true-white working canvas.
- Prefer open panels, rails, tables, and evidence timelines over nested cards.
- Use hairline borders to expose structure; shadows belong mainly to modal elevation.
- Keep dense engineering data compact without making labels or controls microscopic.
- Use Lucide’s outline family consistently for controls and navigation.
- Motion should clarify entry, state change, or progress and must respect `prefers-reduced-motion`.

## Illustration language

The hero’s visual grammar is the canonical illustration direction:

- evidence enters from identifiable source/review/test objects;
- provenance stays visible through fine connector lines;
- Lore is a layered archive, never a brain or robot;
- verified outputs use restrained teal;
- risks use small brass accents;
- the background is archive ink with subtle blueprint structure;
- depth is precise and architectural, not neon cyberpunk.

Avoid generic AI brains, robot faces, magic sparkles, purple-dominant glows, bokeh orbs, fake metrics, and unreadable micro-code.

## Voice and terminology

Use language that distinguishes proof, inference, policy, and uncertainty.

| Prefer | Avoid |
| --- | --- |
| Evidence suggests | AI knows |
| Confirmed decision | Universal best practice |
| Candidate knowledge | Learned truth |
| Confidence factors | AI confidence score |
| Known unknown | Probably fine |
| Deterministic policy | AI guardrail |
| Human-approved | Automatically trusted |
| Available evidence | Complete understanding |

Write short headings, concrete verbs, and exact boundaries. Say when a path is simulated, local-only, optional, reserved, not implemented, or not production-approved.

## Screenshot rules

- Capture the real running product with realistic bundled data.
- Default documentation viewport: `1440 × 1000`; mobile: `390 × 844`.
- Show the feature in a meaningful state rather than an empty shell.
- Do not include browser chrome, unrelated desktop content, tokens, local paths, or customer information.
- Keep the complete app shell when it helps explain location and navigation.
- Use concise alt text that describes the feature state, not “screenshot.”
- Re-capture affected screens when data shape, navigation, typography, or visible behaviour changes.

## Documentation headers

Every Markdown guide uses `assets/lore-docs-header.svg`, followed by links to project home, documentation home, features, and setup. Page-specific titles remain real Markdown headings beneath the shared header so GitHub anchors, accessibility, and document structure remain useful.

## Design sources and verification

The dashboard and candidate-review concept images are retained under [`docs/design/`](design/). Current rendered screenshots live under [`docs/assets/screenshots/`](assets/screenshots/). Visual changes should be checked against both the design sources and the current brand tokens in [`apps/web/src/styles.css`](../apps/web/src/styles.css).

