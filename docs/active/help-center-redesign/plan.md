# Plan

## Goal

Replace the current compact Help popover with an accessible, readable Help Center that explains how to use the active mode, where its data comes from, how its calculations work, and what its results cannot prove.

## Scope

- Redesign the global Help surface and its open/close interaction.
- Provide complete Crime-mode guidance for workflow, data sources, calculations, parameter meanings, and limitations.
- Preserve Diary-mode help with mode-specific content and local-data caveats.
- Keep bilingual English and Simplified Chinese coverage.
- Extend existing UI/accessibility tests before changing production code.

## Sources of truth

- `src/ui/about.js` for Help behavior and structure.
- `src/i18n/messages.js` for reader-facing bilingual copy.
- `src/style.css` and existing design tokens for presentation.
- `src/config.js`, `src/api/`, `src/utils/`, and Crime map/chart modules for source and calculation claims.
- Existing UI and browser tests under `scripts/tests/`.

## Stages

- [x] Stage 1: Audit current Help behavior, data lineage, calculations, and test contracts.
- [x] Stage 2: Add failing behavior/content tests for the redesigned Help Center.
- [x] Stage 3: Implement the new structure, interaction, copy, and responsive styling.
- [x] Stage 4: Run targeted tests, build checks, and browser accessibility/visual verification.
- [x] Stage 5: Review for correctness, simplicity, and remaining risk.

## Acceptance criteria

- Help opens as a substantial centered modal on desktop and a viewport-contained centered panel on small screens, without hiding behind a tiny popover.
- Keyboard focus enters the panel, Escape closes it, focus returns to the trigger, and the page behind it is not an accidental interaction target.
- Crime Help clearly documents reported-incident, boundary, population, and basemap sources, including live/fallback behavior where applicable.
- Crime Help explains Buffer, District, Tract, time-window inclusion, offense filtering, per-10k rates, classification methods, clustering, and known limitations.
- Diary Help remains accurate and clearly distinguishes local records from demo/community sample data.
- English and Simplified Chinese copy both render through the existing i18n system.
- Targeted contract tests and production build pass; browser verification finds no blocking accessibility regression.

## Non-goals

- Changing Crime query logic, datasets, map rendering, or analysis results.
- Adding a new documentation framework, dependency, or remote content service.
- Reworking unrelated controls or the Diary product flow.

## Risks and constraints

- Help copy must not overstate source freshness, completeness, precision, or causal meaning.
- Existing user work in `.gitignore` and `.playwright-mcp/` must remain untouched.
- The active preview on `127.0.0.1:5173` is a shared live surface and has a single owner.
