# Batch 8–10 unified integration

Status: complete

## Goal

Integrate the Evidence Bundle v2 product path, complete-tract ACS VRE workflow,
and HIN 2025 lifecycle work onto `main`, then prove the combined candidate with
the repository release gates before pushing and cleaning its isolated worktrees.

## Acceptance

- P8, P9, and P10 remain separate auditable commits on top of the P0 baseline.
- ACS VRE and HIN feature observations reach the generic Source Health registry
  only after their explicit product workflows load admitted evidence.
- Evidence Bundle v2 remains the strict `public-crime-analysis/v1` schema; ACS
  and HIN contribution seams do not silently widen that recovery contract.
- Bundle policy covers the new lazy graph, focused chunks, VRE source artifact,
  non-VRE dist ceiling, and transparent total dist ceiling.
- Targeted contracts, lint, build, bundle, browser, visual, and full release
  validation pass on one combined revision, or any unrun gate is recorded.
- The exact pushed revision completes remote CI and Pages before integration
  worktrees are removed.

## Completion

- Product and central integration commit: `8bf9651`.
- Linux visual baseline follow-up: `8d6c420`.
- GitHub Actions run `31396682634` passed core, coverage, release, and deploy.
- GitHub Pages deployment `5833634422` published exact revision `8d6c420`.
- The completed P0, P8, P9, and P10 isolated worktrees were removed only after
  the exact remote deployment succeeded.

## Non-goals

- No new Evidence Bundle schema version for ACS or HIN.
- No ACS spatial weighting, route-buffer estimate, or map-derived tract set.
- No HIN snapshot rewrite without reviewed semantic change.
- No production deployment outside the existing GitHub Pages workflow.
