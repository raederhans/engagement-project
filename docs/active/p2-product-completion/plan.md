# Plan

## Goal

Advance the backend-free public project from a polished map demo into a recoverable, explainable, map-and-list analysis product while preserving the completed P1 accessibility, bilingual, responsive, visual, bundle, and data-truth contracts.

## Scope

- Semantically integrate the stacked comparison, chart, incident-detail, summary-insight, and custom-radius deliveries onto current `origin/main`.
- Reorganize Crime and Diary task flow without redesigning the brand or replacing the framework.
- Provide non-map selection and incident-result paths that stay synchronized with MapLibre.
- Make partial failures recoverable and bind provenance to the results users act on.
- Complete the local-only Diary data lifecycle and separate private backups from shareable artifacts.
- Split stylesheet and Diary orchestration ownership without changing behavior.
- Extend WebGL, accessibility, cross-platform, data, and performance verification.

## Sources of truth

- Current `origin/main` and the clean P2 integration worktree.
- `docs/archive/ui-p1-5-8-closeout/` for non-regression gates.
- Stacked deliveries in PRs #49, #50, #51, #53, and #55.
- Existing repository test, visual, bundle, audit, CI, Pages, and worktree-registry contracts.

## Stages

- [x] Stage 1: Protect existing worktrees and semantically integrate PRs #49, #50, #51, #53, and #55.
- [x] Stage 2: Split CSS and Diary ownership while locking current behavior and visuals.
- [x] Stage 3: Complete task-oriented navigation and map/list dual-channel analysis; custom radius is already admitted from Stage 1.
- [x] Stage 4: Add recoverable partial-failure states and result-level provenance.
- [x] Stage 5: Complete the local Diary lifecycle and unified artifact model.
- [x] Stage 6: Extend WebGL, Axe, cross-platform CI, data-contract, and performance gates.
- [ ] Stage 7: Run independent review, full verification, GitHub integration, Pages verification, and archive the record.

## Acceptance criteria

- Every stacked P2 delivery is preserved or explicitly superseded by a tested current-main implementation.
- P1 keyboard, focus, bilingual, responsive, touch-target, visual, bundle, and truthfulness gates remain green.
- Crime analysis can be completed through map or non-map controls with synchronized selection and details.
- Data-source failures preserve usable successful results and expose an actionable retry or truthful fallback state.
- Important summaries, comparisons, charts, routes, shares, and exports expose source, coverage, scope, and limitations.
- Diary drafts and local records can be restored, deleted, backed up, and imported without implying server persistence.
- Private backup and shareable artifact contracts are visibly and structurally distinct.
- Final CI, Pages, production assets, and representative Crime/Diary browser flows pass from the exact integrated commit.

## Non-goals

- No writable backend, account system, cross-device synchronization, shared community submissions, or live alert service.
- No GPS map matching, turn-by-turn navigation, arbitrary citywide routing, or fabricated route results.
- No framework migration, brand redesign, MapLibre major-version upgrade, or bundle-budget increase without separate evidence.
- No overwrite, reset, or cleanup of user-owned worktrees or uncommitted changes.

## Risks and constraints

- The stacked branches predate P1-5 through P1-8 and overlap heavily in CSS, Crime controllers, charts, translations, and tests.
- The custom-radius branch reports very little total-dist budget headroom, so semantic integration must recover or re-budget bytes through evidence rather than silently raising limits.
- Visual and browser verification share ports, `dist/`, Playwright output, and platform-specific baselines and must have one owner.
- Large local refactors can obscure behavior regressions; each extraction requires failing or behavior-locking tests before production edits.
