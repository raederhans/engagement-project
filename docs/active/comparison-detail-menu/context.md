# Context

## Current truth

- Implementation worktree: `C:/Users/raede/Desktop/dev/engagement_project-p1-ui`.
- Branch: `codex/comparison-detail-menu`, based on `origin/main@784b81285148d9dd623abf82f8825dcd5b666906`.
- PR #48 remains independently preserved on `codex/tract-outline-controls@e5a84c6` with passing CI.
- The comparison result contract already has `total`, nullable `per10k`, `top3`, and nullable `delta30` for each point.
- The current comparison renderer repeats two labels and totals but exposes no progressive detailed analysis.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-03 | Reuse the existing result contract instead of adding queries. | Expanding details is immediate, offline-capable for saved results, and has no network cost. |
| 2026-08-03 | Use one native `details` submenu inside the current summary. | Keeps default density low and provides keyboard/screen-reader behavior without a custom disclosure widget. |
| 2026-08-03 | Avoid a single “safer area” score. | Prevents unsupported safety claims from descriptive historical counts. |
| 2026-08-03 | Keep disclosure state inside one default compare-view instance. | Language rerenders preserve expansion while saved/live or newly initialized views cannot leak hidden UI state into each other. |
| 2026-08-03 | Independent architecture and code reviews returned CLEAR after touch-target and reduced-motion fixes. | No local review blocker remains. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Previous Vite `127.0.0.1:5173` | root | `C:/Users/raede/AppData/Local/Temp/codex-engagement-project/tract-outline-dev.*.log` | PID 64620 verified and stopped before branch switch. |
| Comparison-detail Vite preview | root | Codex exec session `71777` | Vite listener PID 63308 on `127.0.0.1:5173`; HTTP 200; keep running for user handoff. |

## Handoff

Only this task directory, the registry row, comparison rendering/localization/style files, and directly overlapping tests belong to this task. Do not stage `.gitignore`, PR #48 files, P1-5-8 changes, visual artifacts, or unrelated logs.

## Next step

Wait for exact-head CI on PR #49; do not merge or deploy in this task.
