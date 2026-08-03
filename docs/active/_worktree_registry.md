# Worktree Registry

| Worktree / path | Task | Base branch / commit | Current branch / HEAD | Goal | State | Hotspots | Tests | Overlap | Order | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C:/Users/raede/Desktop/dev/engagement_project | UI P0 redesign | main@6272bd6 | codex/ui-p0-redesign at PR #39 | Implement the validated task-first shell, responsive sheet, mode boundaries, and staged Diary rating flow | ready-for-integration | index.html, src/style.css, src/main.js, src/ui/, src/routes_diary/, browser smoke tests | exact staged snapshot passed full validate, 36 P0 contracts, bundle policy, dependency audit, responsive browser matrix, keyboard flow, two independent reviews, and exact-env browser smoke | Unfinished bilingual localization remains unstaged in the same checkout; MapLibre 6 is explicitly out of scope | first | Push the browser-smoke contract fix, rerun CI, then merge and verify Pages. |
| `C:/Users/raede/Desktop/dev/engagement_project` | Repository integration and dependency maintenance | `main@014499d` | `main@7b202b5` before this registry-only sync | Keep one verified worktree and align local and remote `main` | integrated | Git refs, npm lockfile, Actions, Pages | current PR CI, main CI, Pages, browser smoke, bundle policy, and dependency audit passed | Day.js #8, Vite replacement #35, Turf replacement #36, Actions replacement #37 | complete | Keep MapLibre 6 PR #10 open until its bundle and WebGL2 migration is designed and verified. |

States: `in-progress`, `blocked`, `ready-for-review`, `ready-for-integration`, `integrated`, `abandoned`.

## Current task

- Owner: root agent.
- Task records: docs/active/ui-p0-redesign/.
- Branch: codex/ui-p0-redesign from main@6272bd6.
- Constraint: no framework, dependency, backend, or MapLibre major-version change.
- Integration state: P0-only index isolated and fully validated; no remote change yet.

## Previous delivery package

- Summary: removed 14 remote branches already contained in `main`; merged Day.js #8; replaced and closed stale Vite #11 with #35; replaced and closed stale Turf #9 with #36; replaced and closed Actions #20-#24 with atomic upgrade #37.
- Files: dependency manifests, pinned workflow references, the immutable Action SHA policy, and this registry.
- Commit and branch state: one local branch and one worktree remain after integration; local `main` and `origin/main` both pointed to `7b202b5` before this registry-only synchronization commit.
- Divergence from main: none for completed deliveries.
- Overlap and conflict risk: only Dependabot MapLibre 6 PR #10 remains open; its branch is intentionally retained.
- Validation evidence: exact `npm ci`, full validate, bundle policy, dependency audit, local browser smoke, PR CI, final main CI, and Pages build/deploy passed.
- Remaining risk: MapLibre 6 requires ESM import changes and WebGL2, and the verified experiment increased the entry from about `859 kB / 230 kB gzip` to `1,020 kB / 269 kB gzip`, exceeding both current bundle budgets.
- Recommended integration method: keep `main` as the single local worktree; address #10 as a dedicated map-runtime and performance migration rather than raising bundle limits.
