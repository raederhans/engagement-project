# Plan

## Goal

Turn the two-area Crime comparison from two repetitive count rows into an optional, bilingual detailed-analysis submenu without adding duplicate data requests.

## Scope

- Keep the compact A/B summary visible by default.
- Add a native expandable detail surface when both points exist.
- Compare total incidents, recent 30-day change, per-10k rates when available, and each area's top three categories.
- Preserve the expanded state across localization rerenders.
- Reuse the existing comparison result and saved-analysis contract.

## Sources of truth

- `src/compare/card.js` for comparison metrics, cached results, and rendering.
- `src/i18n/messages.js` for bilingual product copy.
- `src/style.css` for the current Crime summary hierarchy and responsive behavior.
- Existing Crime UI, product-integrity, i18n, and browser-smoke tests.

## Product direction

- Visual thesis: one calm analytical disclosure panel with restrained teal emphasis and proportional bars, not a grid of repeated cards.
- Content plan: compact summary, expandable difference overview, recent trend and rate metrics, top-category composition, historical-data caveat.
- Interaction thesis: native details disclosure, preserved open state during locale rerender, and subtle bar reveal that respects reduced motion.

## Stages

- [x] Stage 1: Protect unrelated worktrees, preserve PR #48, and create an independent branch from `origin/main`.
- [x] Stage 2: Add focused failing rendering and interaction contracts.
- [x] Stage 3: Implement the minimal detailed comparison submenu and bilingual styling.
- [x] Stage 4: Run targeted/full validation, browser smoke, and desktop/mobile bilingual QA.
- [x] Stage 5: Review, commit, push, and open an independent PR.

## Acceptance criteria

- A single-point analysis remains unchanged and shows no detailed comparison menu.
- A two-point analysis shows a compact summary plus one clearly named expandable menu.
- Expanded content explains absolute/relative total difference, recent trend, per-10k rates when available, and top-category composition.
- Missing rates or trend values render truthfully without fabricated zeroes.
- Expanding the menu never starts a new network request.
- English and Chinese copy are complete, keyboard accessible, and responsive without horizontal overflow.
- Saved comparisons render the same detailed surface from their existing result contract.

## Non-goals

- New crime queries, new chart dependencies, statistical significance claims, safety rankings, or predictive scores.
- Changes to comparison persistence schema, tract data, classification, MapLibre, or bundle limits.
- Merging or deploying PR #48 or unrelated P1 work.

## Risks and constraints

- Counts describe historical reports within equal-radius buffers; they are not live safety claims.
- The primary worktree and P1-5-8 worktree contain unrelated WIP and must remain untouched.
- Port 5173 is shared and must have one explicit owner.
