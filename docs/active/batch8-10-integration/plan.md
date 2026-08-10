# Batch 8–10 integration plan

1. Complete — rerun the three worktree-focused contracts and commit each lane.
2. Complete — cherry-pick P8, P9, then P10 onto the P0 main baseline.
3. Complete — wire ACS/HIN observations into Source Health without widening
   Evidence Bundle v2.
4. Complete — update bundle graph and source-artifact budgets from a fresh
   combined manifest.
5. Complete — targeted contracts, lint, build/bundle, shared and ACS browser,
   reviewed Windows visual baselines, and coverage pass on the combined tree.
6. Complete — central integration and Linux baseline follow-up were committed
   and pushed normally without rewriting history.
7. Complete — exact revision `8d6c420` passed remote core, coverage, release,
   and Pages deployment; only the clean P0/P8/P9/P10 worktrees were removed.

## Rollback

The feature commits and central wiring commit are intentionally separate.
Revert the central wiring first if the registry or bundle policy regresses; the
three feature commits can then be reverted independently in reverse order.
