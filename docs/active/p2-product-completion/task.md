# Task

## Current status

P2 execution is active. Comparison details and adaptive drilldown rows have been semantically replayed on current main without regressing the P1 class-based and accessibility contracts.

## Checklist

- [x] Verify `origin/main`, all worktrees, branch heads, dirt, and user-owned WIP.
- [x] Create the isolated P2 integration worktree and branch.
- [x] Integrate and verify PR #49 comparison details.
- [ ] Integrate and verify PR #50 chart studio.
- [ ] Integrate and verify PR #51 incident details.
- [ ] Integrate and verify PR #53 summary insights.
- [ ] Integrate and verify PR #55 custom radius.
- [ ] Split CSS and Diary ownership with behavior locks.
- [ ] Implement task flow and map/list dual-channel analysis.
- [ ] Implement recoverable data states and result-level provenance.
- [ ] Complete Diary local lifecycle and unified artifacts.
- [ ] Extend WebGL, Axe, cross-platform, data, and performance gates.
- [ ] Run independent review, full verification, integration, deployment, and production smoke.
- [ ] Archive records after GitHub and Pages state match evidence.

## Validation evidence

| Command or check | Result |
| --- | --- |
| Remote truth | `origin/main` and GitHub `main` both resolve to `e32e3426c3db75d5429d07e678ca65c48b2d734c`. |
| Worktree audit | Primary WIP preserved; five stacked P2 worktrees are clean and track their remote branches. |
| Existing PR CI | PRs #49, #50, #51, #53, and #55 each report a successful `validate` check on their current head. |
| P2 worktree | Clean `codex/p2-product-completion` created from current `origin/main`. |
| Comparison integration | Detailed A/B metrics, truthful unavailable states, preserved disclosure state, and adaptive native drilldown rows pass `test:ui-p0`, `test:i18n`, and `test:p1-ui`; dynamic bars use class-owned native progress elements. |

## Open risks and remaining work

- The five deliveries form a dependency stack and cannot be merged independently onto current main without resolving P1 semantic overlap.
- The exact final browser/visual resource owner and port will be recorded before long verification begins.
- Later product phases remain pending until the existing stacked functionality is admitted on current main.
