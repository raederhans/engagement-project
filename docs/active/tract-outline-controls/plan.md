# Plan

## Goal

Add simple, bilingual census tract outline controls that update the map immediately and survive shared-view URL round trips.

## Scope

- Keep the existing show/hide tract-boundary checkbox.
- Add line-width and line-opacity controls with visible values.
- Persist non-default values in the Crime view query string.
- Update the existing MapLibre outline layer without refetching tract data.
- Extend existing state, map, UI, and localization contract tests.

## Sources of truth

- `src/map/tracts_layers.js` for outline paint defaults and updates.
- `src/state/store.js` and `src/state/crime_view_state.js` for view state and URL sharing.
- `src/ui/panel.js` and `index.html` for Crime filter controls.
- Existing `scripts/tests/*contracts.mjs` suites for supported validation entry points.

## Stages

- [x] Stage 1: Protect unrelated worktrees, record the live-process owner, and create an isolated branch from `origin/main`.
- [x] Stage 2: Add failing state, map, UI, and i18n contract tests.
- [x] Stage 3: Implement the smallest compatible control path.
- [x] Stage 4: Run targeted and full validation, browser smoke, visual QA, bundle policy, and audit.
- [x] Stage 5: Review, commit, push, and open an independent PR.

## Acceptance criteria

- Users can change tract outline width and opacity while the overlay is enabled.
- Map paint changes immediately without a data reload.
- Controls are disabled when tract boundaries are hidden.
- English and Chinese labels and value announcements are complete.
- Shared URLs restore valid values, omit defaults, and clamp invalid input.
- Existing default appearance remains `0.5px` width and `0.9` opacity.
- Project validation and local browser checks pass with the requested feature flags.

## Non-goals

- Outline color customization.
- Changes to census tract data, crime classification, MapLibre version, or bundle budgets.
- Merging or deploying other open P1 pull requests.

## Risks and constraints

- Other worktrees contain user-owned WIP and must remain untouched.
- Port 5173 is a shared live resource and has one owner at a time.
- The controls must not trigger network refreshes for paint-only changes.
