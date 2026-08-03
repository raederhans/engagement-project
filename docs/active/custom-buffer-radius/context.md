# Context

## Current truth

- Base: `codex/crime-summary-insights@aecec62da3e8aeb8a7119fb65d8f2e6b0fc98906` / Draft PR #53.
- Worktree: `C:/Users/raede/Desktop/dev/engagement_project-custom-radius`.
- Branch: `codex/custom-buffer-radius`.
- Existing UI and URL state accept only 400 or 800 metres.
- Buffer queries, map overlays, comparison logic, and exports already consume a numeric `store.radius`; no backend change is required.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-03 | Use six presets plus a committed custom value. | More useful choices without firing queries on every keystroke. |
| 2026-08-03 | Bound custom radii to integer 100–10,000 m and preserve 400 m fallback. | Prevents invalid or accidentally extreme shared URLs. |
| 2026-08-03 | Use a one-metre input step rather than restricting custom values to multiples of 50. | Keeps the user-requested custom control genuinely free-form while retaining integer validation. |
| 2026-08-03 | Use the number input's native change/Enter commit instead of a separate Apply button. | Preserves one-refresh behavior, improves bundle headroom, and removes redundant UI state. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Current Vite 5173 from summary branch | root agent | `%TEMP%/engagement-chart-height-20260803/vite-5173.out.log` | external to this task; preserved through isolated QA |
| Temporary Vite 4174 from custom-radius worktree | root agent | terminal session 14174 | stopped after bilingual live QA; listener verified absent |

## Handoff

- Only root agent may change Git refs, commit, push, or manage preview processes.
- Keep this PR stacked on `codex/crime-summary-insights` / PR #53.

## Delivery

- Product commit: `6a1ec2839db59d353c7d303b57a5db4f206c5899`.
- Draft PR: [#55](https://github.com/raederhans/engagement-project/pull/55), stacked on `codex/crime-summary-insights` / PR #53.
- Keep the PR Draft; do not merge or deploy until the stacked base chain is reviewed.
