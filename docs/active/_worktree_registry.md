# Worktree Registry

| Worktree / path | Task | Base branch / commit | Current branch / HEAD | Goal | State | Hotspots | Tests | Overlap | Order | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C:/Users/raede/Desktop/dev/engagement_project-p1-5-8 | UI P1-5 through P1-8 closeout | origin/main@784b812 | codex/p1-5-8-accessibility-design-ci@784b812 | Accessibility, design-system/CSS consolidation, mobile feedback details, and visual/experience CI | in-progress | index.html, src/style.css, map/UI accessibility, i18n messages, browser and visual tests, CI | baseline audit in progress | Red overlap with chart-drawer-sizing in index.html, src/style.css, browser_smoke, and ui_shell_contracts | integrate after QoL ownership review | Add failing contracts, then implement P1-5 through P1-8 in small verified batches. |
| C:/Users/raede/Desktop/dev/engagement_project-p1-ui | QoL chart drawer sizing (separately owned) | origin/main@784b812 | codex/chart-drawer-sizing@784b812 plus uncommitted WIP | Ongoing quality-of-life layout work owned by another task | in-progress | index.html, src/style.css, scripts/tests/browser_smoke.mjs, scripts/tests/ui_shell_contracts.mjs | pending in owner task | Red overlap with P1-6 and P1-8; do not overwrite | owner branch first or semantic reconciliation | Preserve current WIP and wait for an integration-ready delivery package. |
| C:/Users/raede/Desktop/dev/engagement_project-p1-ui | UI P1-1 through P1-4 and bilingual localization | origin/main@f956ab2 | runtime merged by PR #41 as main@5985b71; closeout on codex/p1-localization-closeout | Crime map clarity, result linkage, data trust, Diary hierarchy, and complete bilingual UI/docs | integrated | archived task records, Git refs, CI, Pages, public Crime/Diary | PR exact-head CI, main CI `30797232222`, Pages `30797232104`, public desktop/mobile bilingual smoke, bundle policy, and audit passed | PR #42 merged localization as `b4168d6`; PR #41 merged the combined head as `5985b71` | complete | Preserve the separate user-owned `.gitignore`; MapLibre 6 PR #10 remains out of scope. |
| C:/Users/raede/Desktop/dev/engagement_project | UI P0 redesign | main@6272bd6 | merged by PR #39 as main@8ac7001 | Implement the validated task-first shell, responsive sheet, mode boundaries, and staged Diary rating flow | integrated | index.html, src/style.css, src/main.js, src/ui/, src/routes_diary/, browser smoke tests | exact staged snapshot, 36 P0 contracts, bundle policy, dependency audit, responsive browser matrix, keyboard flow, two independent reviews, PR/main CI, Pages, and public Crime/Diary smoke passed | Bilingual localization remained unstaged and outside both P0 commits; MapLibre 6 remains out of scope | complete | Complete; see the latest P1/localization row for the current baseline. |
| `C:/Users/raede/Desktop/dev/engagement_project` | Repository integration and dependency maintenance | `main@014499d` | `main@7b202b5` before this registry-only sync | Keep one verified worktree and align local and remote `main` | integrated | Git refs, npm lockfile, Actions, Pages | current PR CI, main CI, Pages, browser smoke, bundle policy, and dependency audit passed | Day.js #8, Vite replacement #35, Turf replacement #36, Actions replacement #37 | complete | Keep MapLibre 6 PR #10 open until its bundle and WebGL2 migration is designed and verified. |

States: `in-progress`, `blocked`, `ready-for-review`, `ready-for-integration`, `integrated`, `abandoned`.

## Last completed task

- Owner: root agent.
- Task records: `docs/archive/ui-p1-map-results-trust-diary/` and `docs/archive/app-bilingual-localization/`.
- Runtime commits: P1 `966ffaa`, localization review fix `65ac92f`, layered merge `b4168d6`, and main merge `5985b71` through PRs #42 and #41.
- Constraint: no framework, localization dependency, backend, bundle-limit increase, history rewrite, or MapLibre major-version change.
- Integration state: main CI `30797232222`, Pages `30797232104`, and public English/Chinese Crime/Diary desktop/mobile smoke passed; user-owned `.gitignore` remained untouched.

## Previous delivery package

- Summary: removed 14 remote branches already contained in `main`; merged Day.js #8; replaced and closed stale Vite #11 with #35; replaced and closed stale Turf #9 with #36; replaced and closed Actions #20-#24 with atomic upgrade #37.
- Files: dependency manifests, pinned workflow references, the immutable Action SHA policy, and this registry.
- Commit and branch state: one local branch and one worktree remain after integration; local `main` and `origin/main` both pointed to `7b202b5` before this registry-only synchronization commit.
- Divergence from main: none for completed deliveries.
- Overlap and conflict risk: only Dependabot MapLibre 6 PR #10 remains open; its branch is intentionally retained.
- Validation evidence: exact `npm ci`, full validate, bundle policy, dependency audit, local browser smoke, PR CI, final main CI, and Pages build/deploy passed.
- Remaining risk: MapLibre 6 requires ESM import changes and WebGL2, and the verified experiment increased the entry from about `859 kB / 230 kB gzip` to `1,020 kB / 269 kB gzip`, exceeding both current bundle budgets.
- Recommended integration method: keep `main` as the single local worktree; address #10 as a dedicated map-runtime and performance migration rather than raising bundle limits.
