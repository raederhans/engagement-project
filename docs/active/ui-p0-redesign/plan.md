# Plan

## Goal

Implement every P0 UI issue validated by the 2026-08-01 rendered-site design audit while preserving the current backend-free Vite and MapLibre product behavior.

## Scope

- Establish a visible product shell with a concise app bar and mode-specific orientation.
- Reorganize Crime around location, quick filters, summary results, and optional advanced analysis.
- Keep the map usable on desktop, tablet, mobile portrait, mobile landscape, and low-height screens.
- Replace permanent mobile panels with a three-state bottom sheet.
- Make charts, comparison, advanced filters, and layer styling progressive rather than default.
- Keep one primary Crime analytical layer visible by default and expose map controls explicitly.
- Give Crime and Diary separate loading, Help, URL, and data-status semantics.
- Convert Diary rating into a short staged flow with a sticky submit action.
- Apply one restrained typography, spacing, color, focus, and target-size system.
- Add deterministic behavior contracts before each production change and browser acceptance after the implementation.

## Sources of truth

- Rendered-site audit: C:/Users/raede/.gstack/projects/raederhans-engagement-project/designs/design-audit-20260801/design-audit-engagement-project.md
- Current behavior: repository source and tests at main@6272bd6.
- Existing product contracts: docs/archive/p0-p1-product-integrity/.
- Public deployment contract: GitHub Pages static output with no required private credentials or writable backend.

## Visual thesis

A calm civic map workbench: a muted full-canvas map, one clear task surface, restrained blue-teal action color, and result detail that appears only after the user asks for it.

## Content plan

1. App bar: product identity, mode, data state, Share, Help.
2. Task surface: one mode-specific goal and the minimum controls to begin.
3. Map: the primary spatial workspace and selected-object feedback.
4. Result surface: concise summary first, charts and advanced analysis second.
5. Context surfaces: Layers, data details, Help, and Diary persistence boundaries.

## Interaction thesis

- Mode changes and lazy features immediately reveal a skeleton before data is ready.
- Desktop result drawers and mobile bottom sheets use short, spatial transitions that preserve map context.
- Map selection produces one visible halo, clears stale errors, and offers Clear or Undo without opening unrelated popups.

## Stages

- [x] Stage 0: Capture current contracts, create failing P0 UI tests, and record baseline evidence.
- [x] Stage 1: Build the global shell, tokens, app bar, map controls, and progressive result surfaces.
- [x] Stage 2: Implement the responsive bottom sheet and one-panel tablet behavior.
- [x] Stage 3: Reorder the Crime task flow and default to one primary analytical layer.
- [x] Stage 4: Separate Crime and Diary loading, Help, URL, and status semantics.
- [x] Stage 5: Replace the Diary rating modal with a staged mobile-first flow.
- [ ] Stage 6: Run full validation, browser acceptance, independent review, GitHub integration, and public Pages verification.

## Acceptance criteria

- P0-C1: At 390x844, 844x390, and 360x640, the default sheet leaves the map usable and does not hide primary controls.
- P0-C2: Pick on map gives visible feedback within 500 ms, clears stale errors, and does not open an unrelated district popup.
- P0-C3: A completed Crime analysis shows total, top offenses, time range, and data-through date before charts are opened.
- P0-M1: Three rapid Crime/Diary switches settle on the final mode with its own skeleton, Help, URL, and panel content.
- P0-D1: A normal route rating can be submitted without expanding segment details and with the primary submit action always visible.
- P0-R1: Mobile portrait, landscape, and low-height screens have no horizontal page scroll or fixed-panel overlap.
- P0-V1: Crime initial state has one primary statistical layer; choropleth, incident points, and permanent charts do not compete by default.
- All existing data, local Diary, bundle, CI, and Pages contracts remain green.

## Non-goals

- No new framework, UI library, map SDK, external font dependency, or backend.
- No shared Diary accounts, moderation, or cross-device sync.
- No dark mode, visual storytelling presets, or full P1 map/list synchronization in this phase.
- No MapLibre major-version migration or bundle-budget increase.

## Risks and constraints

- index.html currently owns substantial inline layout and control markup; moving it must preserve element IDs consumed by existing controllers.
- Crime and Diary share the side panel and map instance; responsive work can expose ownership races already protected by current mode controllers.
- The app must keep production lazy boundaries for Crime, Diary, Charts, and Diary Insights.
- External APIs make timing nondeterministic; automated P0 contracts must assert visible state transitions, not arbitrary network completion.
- The design audit dimensions are initial targets and must be validated on portrait, landscape, and low-height screens before being locked.
