# Plan

## Goal

Complete the original UI report's remaining P1 scope: accessibility governance, design-system and CSS consolidation, mobile feedback details, and deterministic visual/experience regression coverage.

## Scope

- P1-5: fix marker and attribution semantics, complete keyboard and focus behavior, expose non-map summaries, announce asynchronous states, support 200% zoom and reduced motion, and add automated accessibility checks.
- P1-6: consolidate product tokens and typography, introduce shared component classes, migrate high-value inline styles, remove superseded CSS and reduce `!important` dependence without changing product behavior.
- P1-7: replace visible GIS jargon with task language, unify map-picking copy, improve compact live status, add an actionable density warning, keep transient feedback below the app bar, combine mobile search actions, and enforce touch-target sizes.
- P1-8: add deterministic visual baselines and behavioral assertions for representative Crime, Diary, help, data, empty, fallback, language, desktop, portrait-mobile, and landscape-mobile states.
- Reconcile the final branch with the separately owned QoL worktree without overwriting its uncommitted changes.

## Stages

- [ ] Stage 1: Audit `origin/main` and the parallel QoL branch against P1-5 through P1-8.
- [ ] Stage 2: Add failing accessibility, design-system, mobile, and visual-regression contracts.
- [ ] Stage 3: Implement P1-5 accessibility and non-map information improvements.
- [ ] Stage 4: Implement P1-6 design tokens, shared component styles, and high-value inline-style migration.
- [ ] Stage 5: Implement P1-7 mobile copy, density feedback, search, toast, and touch-target improvements.
- [ ] Stage 6: Implement P1-8 deterministic visual and experience CI.
- [ ] Stage 7: Run independent review, reconcile parallel work, validate, publish through PR, verify CI/Pages, and archive.

## Acceptance criteria

- Automated accessibility scan reports no critical or serious violations on representative Crime and Diary pages.
- Keyboard-only tests complete one Crime analysis and one Diary rating; focus is not obscured by the sheet or fixed footer.
- 200% zoom has no page-level horizontal overflow or lost primary content.
- Reduced-motion mode avoids forced camera and marker animation.
- Loading, success, failure, fallback, and empty states are announced through accessible live regions.
- A selected Crime area has a textual summary that does not require reading the map.
- One product token set and one product font stack own color, typography, spacing, radius, elevation, motion, control, panel, and sheet dimensions.
- New UI uses shared component classes; high-value inline styles are migrated and obsolete override blocks are removed.
- Visible copy uses “Around a point” and “Pick on map”; the density warning explains the next action and exposes a Zoom in control.
- Touch targets are at least 44 by 44 CSS pixels where the user must tap or click.
- Stable screenshots cover the agreed desktop/mobile Crime and Diary states, help/data details, empty/fallback states, and both English and Chinese.
- Behavioral CI checks no horizontal overflow, visible primary actions, correct sheet focus/padding/URL restoration, no Crime API on direct Diary load, and zero unexpected console/page errors.
- Existing standard validation, dependency audit, browser smoke, and bundle policy pass.
- Parallel QoL work remains recoverable and is integrated only after explicit file/semantic conflict review.

## Non-goals

- No backend, framework migration, dependency replacement, MapLibre major upgrade, or product-data redesign.
- No broad visual redesign beyond the approved P1 report.
- No rewriting or discarding the unrelated `.gitignore` or QoL worktree changes.
- No raising bundle budgets to hide regressions.

## Risks

- `index.html`, `src/style.css`, and browser-test files overlap the active QoL worktree and require semantic conflict review.
- Screenshot tests can become flaky if fonts, map tiles, animation, clocks, random IDs, or external APIs are not fully deterministic.
- Removing legacy overrides can expose hidden cascade dependencies; changes need small batches plus desktop/mobile visual verification.
- Accessibility fixes can alter focus order or map keyboard handling and therefore require behavior-level tests.
