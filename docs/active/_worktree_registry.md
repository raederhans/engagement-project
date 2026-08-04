# Worktree Registry

| Worktree / path | Task | Base branch / commit | Current branch / HEAD | Goal | State | Hotspots | Tests | Overlap | Order | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C:/Users/raede/Desktop/dev/engagement_project | Bilingual localization and user-owned local work | main lineage | codex/bilingual-localization@65ac92f | Preserve the user's active localization branch and unrelated local tooling state | in-progress | `.gitignore`, `.playwright-mcp/`, localization branch | Not part of P2 closeout validation | User-owned `M .gitignore` and `?? .playwright-mcp/`; never reset, delete, stage, or rewrite | independent owner | Leave untouched; coordinate with its owner before any future integration. |
| C:/Users/raede/Desktop/dev/engagement_project-p2-closeout | Local cleanup closeout | origin/main@50402aa | codex/local-worktree-cleanup-closeout | Land final closeout evidence, then remove this self-hosting worktree without creating another local worktree | in-progress | active cleanup records and worktree registry | PR #59/main CI/Pages passed; closeout CI pending | No runtime overlap; primary bilingual WIP remains protected | remove after closeout merge | Merge and verify this closeout, then remove the worktree/local branch before final remote-only archival. |
| Historical delivery: UI P1-1 through P1-4 and bilingual localization | UI P1-1 through P1-4 and bilingual localization | origin/main@f956ab2 | runtime merged by PR #41 as main@5985b71; closeout on codex/p1-localization-closeout | Crime map clarity, result linkage, data trust, Diary hierarchy, and complete bilingual UI/docs | integrated | archived task records, Git refs, CI, Pages, public Crime/Diary | PR exact-head CI, main CI `30797232222`, Pages `30797232104`, public desktop/mobile bilingual smoke, bundle policy, and audit passed | PR #42 merged localization as `b4168d6`; PR #41 merged the combined head as `5985b71` | complete | Historical record; current live worktree state is listed separately above. |
| Historical delivery: UI P0 redesign | UI P0 redesign | main@6272bd6 | merged by PR #39 as main@8ac7001 | Implement the validated task-first shell, responsive sheet, mode boundaries, and staged Diary rating flow | integrated | index.html, src/style.css, src/main.js, src/ui/, src/routes_diary/, browser smoke tests | exact staged snapshot, 36 P0 contracts, bundle policy, dependency audit, responsive browser matrix, keyboard flow, two independent reviews, PR/main CI, Pages, and public Crime/Diary smoke passed | Bilingual localization remained unstaged and outside both P0 commits; MapLibre 6 remains out of scope | complete | Historical record; see the current live worktree and latest P2 rows above. |
| Historical delivery: repository integration and dependency maintenance | Repository integration and dependency maintenance | `main@014499d` | `main@7b202b5` before its registry-only sync | Keep one verified worktree and align local and remote `main` | integrated | Git refs, npm lockfile, Actions, Pages | current PR CI, main CI, Pages, browser smoke, bundle policy, and dependency audit passed | Day.js #8, Vite replacement #35, Turf replacement #36, Actions replacement #37 | complete | Historical record; MapLibre 6 remains a separate migration decision. |

States: `in-progress`, `blocked`, `ready-for-review`, `ready-for-integration`, `integrated`, `abandoned`.

## Retained local branches without worktrees

- `codex/chart-drawer-sizing@19901a5` — open PR #46.
- `codex/dataset-anchored-time-window@aef83d7` — open PR #44.
- `codex/draggable-crime-points@ba34204` — open PR #45.
- `codex/filter-relative-crime-clusters@8548021` — open PR #47.
- `codex/tract-outline-controls@e5a84c6` — open PR #48.

All other local P0/P1/P2 delivery branches were removed after direct-merge or semantic-supersession checks. Their remote branches remain unchanged.

## Latest completed milestone

- Owner: root agent.
- Task record: `docs/active/p2-local-integration-cleanup/`.
- Reconciliation: commit `66b3154`, merged by PR #59 as `50402aa8`.
- Constraint: no runtime changes, remote-branch deletion, open-PR integration, history rewrite, or alteration of user-owned primary-worktree WIP.
- Integration state: PR CI `30894920337`, main CI `30895223572`, and Pages `30895223269` passed; local `main` was fast-forwarded to the reconciliation merge before final closeout.

## Previous delivery package

- Summary: removed 14 remote branches already contained in `main`; merged Day.js #8; replaced and closed stale Vite #11 with #35; replaced and closed stale Turf #9 with #36; replaced and closed Actions #20-#24 with atomic upgrade #37.
- Files: dependency manifests, pinned workflow references, the immutable Action SHA policy, and this registry.
- Commit and branch state: one local branch and one worktree remain after integration; local `main` and `origin/main` both pointed to `7b202b5` before this registry-only synchronization commit.
- Divergence from main: none for completed deliveries.
- Overlap and conflict risk: only Dependabot MapLibre 6 PR #10 remains open; its branch is intentionally retained.
- Validation evidence: exact `npm ci`, full validate, bundle policy, dependency audit, local browser smoke, PR CI, final main CI, and Pages build/deploy passed.
- Remaining risk: MapLibre 6 requires ESM import changes and WebGL2, and the verified experiment increased the entry from about `859 kB / 230 kB gzip` to `1,020 kB / 269 kB gzip`, exceeding both current bundle budgets.
- Recommended integration method: keep `main` as the single local worktree; address #10 as a dedicated map-runtime and performance migration rather than raising bundle limits.
