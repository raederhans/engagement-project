# Plan

## Goal

Expand the Crime buffer-radius control with useful presets and a bounded custom value while preserving URL/share state, map overlays, comparison queries, and bilingual accessibility.

## Scope

- Add presets for 200, 400, 800, 1200, 1600, and 2400 metres.
- Add a custom whole-metre radius input from 100 to 10,000 metres.
- Apply custom values on Enter or field change so typing does not trigger repeated analysis requests.
- Accept valid custom radii in encoded and decoded Crime view state.
- Cover English and Simplified Chinese UI copy and responsive layout.

## Sources of truth

- `src/state/crime_view_state.js` for URL/state validation.
- `src/ui/panel.js` for control synchronization and event handling.
- `index.html` and `src/style.css` for accessible markup and layout.
- Existing Crime UI, i18n, browser smoke, and full validation commands.

## Stages

- [x] Stage 1: Add failing state and UI contracts.
- [x] Stage 2: Implement the minimum radius state and control changes.
- [x] Stage 3: Run targeted and full validation plus live browser QA.
- [x] Stage 4: Review, commit, push, and open a stacked Draft PR.

## Acceptance criteria

- Six presets are directly selectable.
- Any integer custom radius from 100 through 10,000 metres can be applied.
- Invalid, fractional, or out-of-range URL values fall back safely to 400 metres.
- A custom value survives URL encode/decode and browser refresh.
- Typing does not trigger a refresh until Enter or leaving the field.
- The custom controls are labelled, bilingual, keyboard accessible, and mobile-safe.

## Non-goals

- Do not change spatial-query algorithms, units, comparison semantics, or dataset coverage.
- Do not add a new dependency or redesign unrelated filters.
- Do not merge or deploy the stacked P1 pull requests.

## Risks and constraints

- Larger radii can return more incidents, so the input is capped at 10 km.
- Preserve the user-owned `.gitignore` and `.playwright-mcp/` changes in the primary worktree.
- Port 5173 is the current preview and must not be replaced until the new branch passes isolated QA.
