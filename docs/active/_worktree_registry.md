# Worktree Registry

| Worktree / path | Task | Base branch / commit | Current branch / HEAD | Goal | State | Hotspots | Tests | Overlap | Order | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C:/Users/raede/Desktop/dev/engagement_project-p1-ui | UI P1-1 through P1-4 | origin/main@f956ab2 | codex/p1-ui@614e88c; runtime@966ffaa; Draft PR #41 | Crime map clarity, result linkage, data trust, and Diary hierarchy | ready-for-review | index.html, src/style.css, src/routes_crime/, src/map/, src/ui/, src/routes_diary/, UI/browser tests | Full validate, audit, bundle policy, desktop/mobile browser matrix, final smoke, and architecture/code/design reviews passed | Reconciled by codex/bilingual-localization@541cb1d; layered Draft PR #42 CI run 30793889757 passed | before final localization integration | Review PR #42; keep PR #41 Draft and do not merge or deploy Pages yet. |
| C:/Users/raede/Desktop/dev/engagement_project | UI P0 redesign | main@6272bd6 | merged by PR #39 as main@8ac7001 | Implement the validated task-first shell, responsive sheet, mode boundaries, and staged Diary rating flow | integrated | index.html, src/style.css, src/main.js, src/ui/, src/routes_diary/, browser smoke tests | exact staged snapshot, 36 P0 contracts, bundle policy, dependency audit, responsive browser matrix, keyboard flow, two independent reviews, PR/main CI, Pages, and public Crime/Diary smoke passed | Bilingual localization remained unstaged and outside both P0 commits; MapLibre 6 remains out of scope | complete | Continue bilingual localization from the merged P0 baseline. |
| `C:/Users/raede/Desktop/dev/engagement_project` | Repository integration and dependency maintenance | `main@014499d` | `main@7b202b5` before this registry-only sync | Keep one verified worktree and align local and remote `main` | integrated | Git refs, npm lockfile, Actions, Pages | current PR CI, main CI, Pages, browser smoke, bundle policy, and dependency audit passed | Day.js #8, Vite replacement #35, Turf replacement #36, Actions replacement #37 | complete | Keep MapLibre 6 PR #10 open until its bundle and WebGL2 migration is designed and verified. |

States: `in-progress`, `blocked`, `ready-for-review`, `ready-for-integration`, `integrated`, `abandoned`.

## Last completed task

- Owner: root agent.
- Task records: docs/archive/ui-p0-redesign/.
- Runtime commits: 4229d95 and d35ce35, merged by PR #39 as 8ac7001.
- Constraint: no framework, dependency, backend, or MapLibre major-version change.
- Integration state: main CI `30781936454`, Pages `30781936413`, and public responsive Crime/Diary smoke passed; the translation WIP remained uncommitted.

## Previous delivery package

- Summary: removed 14 remote branches already contained in `main`; merged Day.js #8; replaced and closed stale Vite #11 with #35; replaced and closed stale Turf #9 with #36; replaced and closed Actions #20-#24 with atomic upgrade #37.
- Files: dependency manifests, pinned workflow references, the immutable Action SHA policy, and this registry.
- Commit and branch state: one local branch and one worktree remain after integration; local `main` and `origin/main` both pointed to `7b202b5` before this registry-only synchronization commit.
- Divergence from main: none for completed deliveries.
- Overlap and conflict risk: only Dependabot MapLibre 6 PR #10 remains open; its branch is intentionally retained.
- Validation evidence: exact `npm ci`, full validate, bundle policy, dependency audit, local browser smoke, PR CI, final main CI, and Pages build/deploy passed.
- Remaining risk: MapLibre 6 requires ESM import changes and WebGL2, and the verified experiment increased the entry from about `859 kB / 230 kB gzip` to `1,020 kB / 269 kB gzip`, exceeding both current bundle budgets.
- Recommended integration method: keep `main` as the single local worktree; address #10 as a dedicated map-runtime and performance migration rather than raising bundle limits.
