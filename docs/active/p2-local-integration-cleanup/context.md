# Context

## Current truth

- Remote and local `origin/main` resolve to `0236f2424afafecd057191b11f1f817869759577` before this reconciliation.
- Local `main@784b81285148d9dd623abf82f8825dcd5b666906` is a clean ancestor and is 26 commits behind.
- The primary worktree is `codex/bilingual-localization@65ac92f` with user-owned `M .gitignore` and `?? .playwright-mcp/`.
- Seven auxiliary worktrees have been removed; only the protected primary worktree and the transient cleanup worktree remain.
- PRs #56-#58 are merged. PRs #49-#51, #53, and #55 are closed after semantic replay into #56. PRs #44-#48 remain open and their branches must stay local and remote.
- No remote branch deletion is authorized.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-04 | Direct ancestry proves the three P2 delivery branches are contained in `origin/main`. | Their worktrees and local branches can be removed normally. |
| 2026-08-04 | Archived P2 evidence says five closed stack PRs were semantically replayed and verified by PR #56; each remote branch still exists at its exact local SHA. | Their clean local worktrees and branches can be removed while preserving remote recovery. |
| 2026-08-04 | Five QoL PRs #44-#48 are still open and have unique commits. | Keep their local and remote branches; they are not cleanup residue. |
| 2026-08-04 | The primary bilingual worktree is dirty. | Keep it untouched and do not use it for integration. |

## Local branch recovery ledger

Remote refs remain untouched. These exact tips are the recovery boundary for local branch deletion:

| Local branch | Tip | Recovery basis |
| --- | --- | --- |
| `codex/chart-studio` | `a1eea91e90500caddfb439d3cbbebb5c6ad73b7c` | Matching remote ref; closed PR #50; semantically replayed by #56. |
| `codex/comparison-detail-menu` | `20eda9bf483fd6162956298495151f2fc313e405` | Matching remote ref; closed PR #49; semantically replayed by #56. |
| `codex/crime-summary-insights` | `aecec62da3e8aeb8a7119fb65d8f2e6b0fc98906` | Matching remote ref; closed PR #53; semantically replayed by #56. |
| `codex/custom-buffer-radius` | `ffdf3515a34814109f1e6db78c2e53c5a0d5184e` | Matching remote ref; closed PR #55; semantically replayed by #56. |
| `codex/incident-point-details` | `8f78a61b0dd285272c6301ddd18cf53bd5fa7bea` | Matching remote ref; closed PR #51; semantically replayed by #56. |
| `codex/p2-product-completion` | `c1e02b5863d96dfc9d144ee9aa1ba0379007357d` | Matching remote ref and direct ancestor of `origin/main`; merged PR #56. |
| `codex/p2-result-meta-hotfix` | `505d28e5cca88f523c68ea8d5059f4edcbc4c133` | Matching remote ref and direct ancestor of `origin/main`; merged PR #57. |
| `codex/p2-product-closeout` | `ce18caba03ef208d3ab97ffb932c95e039ee859e` | Matching remote ref and direct ancestor of `origin/main`; merged PR #58. |
| `codex/p1-5-8-accessibility-design-ci` | `8ebd69a16c9b1b9a4f07fd341970d0ac69868d89` | Matching remote ref and direct ancestor of `origin/main`; merged PR #52. |
| `codex/p1-5-8-closeout` | `aa0ad48d7d9d034ba693480a586c8d9c22083c51` | Matching remote ref and direct ancestor of `origin/main`; merged PR #54. |
| `codex/p1-localization-closeout` | `4da6e62c842d533cdd3b1b96c274dd3616aa1bc4` | Matching remote ref and direct ancestor of `origin/main`; merged PR #43. |
| `codex/p1-ui` | `f21e48264e2693137f2f93abaeff6667031e0d26` | Matching remote ref and direct ancestor of `origin/main`; merged PR #41. |
| `codex/ui-p0-redesign` | `d35ce35d296f07e3852f11d06d5e4034b77106a5` | Matching remote ref and direct ancestor of `origin/main`; merged PR #39. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| PR CI and final main CI/Pages monitoring | root agent | GitHub Actions run pages | pending |

## Handoff

The root agent is the sole integration and cleanup owner. Read-only auditors may inspect facts but may not modify refs, worktrees, index, or remote state.

## Next step

Publish and merge the documentation-only reconciliation, synchronize local `main`, then remove the transient cleanup worktree and local branch.
