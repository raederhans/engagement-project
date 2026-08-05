# Worktree Registry

| Worktree / path | Task | Base branch / commit | Current branch / HEAD | Goal | State | Hotspots | Tests | Overlap | Order | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C:/Users/raede/Desktop/dev/engagement_project | Primary worktree and user-owned local work | synchronized `main` / `origin/main` lineage | `main` after Crime closeout; protected WIP remains | Keep the primary worktree synchronized while preserving unrelated local work | in-progress | `.gitignore`, `src/style.css`, `.playwright-mcp/`, `docs/active/ui-role-experience-audit/`, logs and output | Crime product PR/main CI, browser smoke, and Pages are tracked in the completed milestone below | User-owned or unfinished items remain unstaged; never reset, delete, stage, or rewrite | independent owner | Keep protected WIP untouched; continue the separate UI/UX audit only under its own task. |
| C:/Users/raede/.codex/worktrees/9188/engagement_project | S3-C2 route-corridor real-data admission, scheme B stages 1-5 | `main@cf191aaf` | `codex/s3-c2-route-corridor-data`; C1 `751b5ef`; reviewed C2 handoff | Keep exact routes browser-local while admitting complete historic incident candidates through a coarse envelope and the canonical Crime snapshot | ready-for-integration | new route input/request/coordinator modules, `src/api/route_corridor.js`, `src/utils/sql.js`, bundle policy, one lazy method in `src/routes_crime/index.js` | C1 12/12; C2 19/19; final `npm run validate` exit 0; architecture `CLEAR`; code review `APPROVE` | Manual overlap in `src/routes_crime/index.js` and `scripts/tests/bundle_policy.mjs`; primary S3-I1/I2 WIP owns shared UI/main/panel/HTML/CSS and must be reconciled by integration owner | integrate after I1/I2 interface reconciliation and combined bundle remeasurement | Preserve both lazy feature imports and all manifest assertions, rebuild the combined tree without raising budgets, then implement the separate accessible UI stage. |
| Historical delivery: Crime product expansion and integration audit | Help Center, versioned taxonomy/metadata, offense highlighting, tract recovery, incident-panel simplification, localization, and incident focus | `origin/main@f4be752b` | product merged by PR #62 as `main@5184c901`; record closeout followed on `codex/crime-product-integration-closeout` | Deliver the reviewed Crime experience and synchronize local, remote, CI, Pages, and records | integrated | Crime runtime, Help, taxonomy/metadata, charts, incident results, responsive baselines, task records | Local `npm run validate`; PR #62 CI `30983733787` passed on Windows and Ubuntu, including Chromium smoke and 36 visual tests | `.gitignore`, `src/style.css`, `.playwright-mcp/`, logs/output, and the incomplete UI/UX audit stayed outside every commit | complete | Historical record; completed task records are archived under `docs/archive/`. |
| Historical delivery: P2 product completion and local cleanup | P2 product completion, reconciliation, and repository cleanup | origin/main@0236f24 | runtime merged through PRs #56-#58; cleanup merged through PRs #59-#60 | Complete P2, synchronize Git, and remove obsolete local branches and worktrees without disturbing user WIP | integrated | runtime, task records, Git refs, worktree registry | P2 PR/main CI and Pages passed; cleanup PR/main CI and Pages passed | Five open QoL PR branches and the primary bilingual WIP remain intentionally separate | complete | Historical record; see `docs/archive/p2-local-integration-cleanup/`. |
| Historical delivery: UI P1-1 through P1-4 and bilingual localization | UI P1-1 through P1-4 and bilingual localization | origin/main@f956ab2 | runtime merged by PR #41 as main@5985b71; closeout on codex/p1-localization-closeout | Crime map clarity, result linkage, data trust, Diary hierarchy, and complete bilingual UI/docs | integrated | archived task records, Git refs, CI, Pages, public Crime/Diary | PR exact-head CI, main CI `30797232222`, Pages `30797232104`, public desktop/mobile bilingual smoke, bundle policy, and audit passed | PR #42 merged localization as `b4168d6`; PR #41 merged the combined head as `5985b71` | complete | Historical record; current live worktree state is listed separately above. |
| Historical delivery: UI P0 redesign | UI P0 redesign | main@6272bd6 | merged by PR #39 as main@8ac7001 | Implement the validated task-first shell, responsive sheet, mode boundaries, and staged Diary rating flow | integrated | index.html, src/style.css, src/main.js, src/ui/, src/routes_diary/, browser smoke tests | exact staged snapshot, 36 P0 contracts, bundle policy, dependency audit, responsive browser matrix, keyboard flow, two independent reviews, PR/main CI, Pages, and public Crime/Diary smoke passed | Bilingual localization remained unstaged and outside both P0 commits; MapLibre 6 remains out of scope | complete | Historical record; see the current live worktree above. |
| Historical delivery: repository integration and dependency maintenance | Repository integration and dependency maintenance | `main@014499d` | `main@7b202b5` before its registry-only sync | Keep one verified worktree and align local and remote `main` | integrated | Git refs, npm lockfile, Actions, Pages | current PR CI, main CI, Pages, browser smoke, bundle policy, and dependency audit passed | Day.js #8, Vite replacement #35, Turf replacement #36, Actions replacement #37 | complete | Historical record; MapLibre 6 remains a separate migration decision. |

States: `in-progress`, `blocked`, `ready-for-review`, `ready-for-integration`, `integrated`, `abandoned`.

## Retained local branches without worktrees

- `codex/bilingual-localization@65ac92f` — protected historical/localization branch; not integrated or deleted by this closeout.
- `codex/chart-drawer-sizing@19901a5` — open PR #46.
- `codex/dataset-anchored-time-window@aef83d7` — open PR #44.
- `codex/draggable-crime-points@ba34204` — open PR #45.
- `codex/filter-relative-crime-clusters@8548021` — open PR #47.
- `codex/tract-outline-controls@e5a84c6` — open PR #48.

Local branches now consist only of `main`, the protected bilingual branch, and these five open-PR branches. No remote branch was deleted; both cleanup recovery refs remain available.

## Latest completed milestone

- Owner: root agent.
- Task record: `docs/archive/crime-product-integration-closeout/`.
- Product delivery: PR #62 merged as `5184c901` after five reviewed Lore commits.
- Verification: local `npm run validate`; PR #62 CI `30983733787` passed on Windows and Ubuntu, including Chromium browser smoke and all 36 visual-experience tests.
- Local result: `main` was fast-forwarded to `origin/main`; the single-worktree topology and retained independent branches were preserved.
- Constraint honored: no alteration of `.gitignore`, `src/style.css`, `.playwright-mcp/`, logs/output, the unfinished UI/UX audit, remote history, or unrelated open PRs.

## Previous delivery package

- Summary: removed 14 remote branches already contained in `main`; merged Day.js #8; replaced and closed stale Vite #11 with #35; replaced and closed stale Turf #9 with #36; replaced and closed Actions #20-#24 with atomic upgrade #37.
- Files: dependency manifests, pinned workflow references, the immutable Action SHA policy, and this registry.
- Divergence from main: none for completed deliveries.
- Remaining risk: MapLibre 6 requires ESM import changes and WebGL2, and the verified experiment increased the entry from about `859 kB / 230 kB gzip` to `1,020 kB / 269 kB gzip`, exceeding both current bundle budgets.
- Recommended integration method: keep `main` as the single local worktree; address #10 as a dedicated map-runtime and performance migration rather than raising bundle limits.
