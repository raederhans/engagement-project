# Task

## Status

In progress: auditing current coverage and parallel-worktree overlap before production edits.

## Checklist

- [ ] Record a complete P1-5 through P1-8 coverage matrix.
- [ ] Protect primary-worktree and QoL-worktree WIP.
- [ ] Add failing accessibility and keyboard/focus contracts.
- [ ] Add failing design-system and mobile-detail contracts.
- [ ] Add failing deterministic screenshot and experience contracts.
- [ ] Implement and verify P1-5.
- [ ] Implement and verify P1-6.
- [ ] Implement and verify P1-7.
- [ ] Implement and verify P1-8.
- [ ] Run targeted tests, full validation, audit, bundle checks, and diff review.
- [ ] Run independent code, architecture, accessibility, and visual reviews.
- [ ] Reconcile the parallel QoL worktree without losing its changes.
- [ ] Commit, push, create PR, verify CI, integrate, and verify Pages.
- [ ] Archive records only after external state matches evidence.

## Evidence log

| Check | Result |
| --- | --- |
| Branch baseline | Clean worktree created from `origin/main@784b812`. |
| Protected WIP | Primary `.gitignore` modification and QoL worktree's four modified files remain untouched. |
| P1-5 baseline | Partial: reduced-motion and some live regions exist; complete semantics, automated axe, zoom, focus-obscured, and non-map flow proof are missing. |
| P1-6 baseline | Missing as a completed scope: three `:root` blocks, two font systems, inline styles, and broad `!important` use remain. |
| P1-7 baseline | Partial: “Pick on map” and compact title exist; “Buffer”, passive density warning, small controls, and feedback hierarchy remain. |
| P1-8 baseline | Partial: one deterministic browser smoke covers behavior; stable screenshot baselines and the full viewport/state matrix are absent. |

## Open integration risks

- `index.html`, `src/style.css`, and browser tests overlap uncommitted QoL work.
- Open remote branches `codex/dataset-anchored-time-window` and `codex/draggable-crime-points` may affect time labels, markers, and browser-smoke assertions.
