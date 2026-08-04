# Worktree Registry

| Worktree / path | Task | Base branch / commit | Current branch / HEAD | Goal | State | Hotspots | Tests | Overlap | Order | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C:/Users/raede/Desktop/dev/engagement_project | Bilingual localization and user-owned local work | main lineage | codex/bilingual-localization@65ac92f | Preserve the user's active localization branch and unrelated local tooling state | in-progress | `.gitignore`, `.playwright-mcp/`, localization branch | Not part of P2 closeout validation | User-owned `M .gitignore` and `?? .playwright-mcp/`; never reset, delete, stage, or rewrite | independent owner | Leave untouched; coordinate with its owner before any future integration. |
| Historical delivery: P2 product completion and local cleanup | P2 product completion, reconciliation, and repository cleanup | origin/main@0236f24 | runtime merged through PRs #56-#58; cleanup merged through PRs #59-#60 | Complete P2, synchronize Git, and remove obsolete local branches and worktrees without disturbing user WIP | integrated | runtime, task records, Git refs, worktree registry | P2 PR/main CI and Pages passed; cleanup PR/main CI and Pages passed | Five open QoL PR branches and the primary bilingual WIP remain intentionally separate | complete | Historical record; see `docs/archive/p2-local-integration-cleanup/`. |
| Historical delivery: UI P1-1 through P1-4 and bilingual localization | UI P1-1 through P1-4 and bilingual localization | origin/main@f956ab2 | runtime merged by PR #41 as main@5985b71; closeout on codex/p1-localization-closeout | Crime map clarity, result linkage, data trust, Diary hierarchy, and complete bilingual UI/docs | integrated | archived task records, Git refs, CI, Pages, public Crime/Diary | PR exact-head CI, main CI `30797232222`, Pages `30797232104`, public desktop/mobile bilingual smoke, bundle policy, and audit passed | PR #42 merged localization as `b4168d6`; PR #41 merged the combined head as `5985b71` | complete | Historical record; current live worktree state is listed separately above. |
| Historical delivery: UI P0 redesign | UI P0 redesign | main@6272bd6 | merged by PR #39 as main@8ac7001 | Implement the validated task-first shell, responsive sheet, mode boundaries, and staged Diary rating flow | integrated | index.html, src/style.css, src/main.js, src/ui/, src/routes_diary/, browser smoke tests | exact staged snapshot, 36 P0 contracts, bundle policy, dependency audit, responsive browser matrix, keyboard flow, two independent reviews, PR/main CI, Pages, and public Crime/Diary smoke passed | Bilingual localization remained unstaged and outside both P0 commits; MapLibre 6 remains out of scope | complete | Historical record; see the current live worktree above. |
| Historical delivery: repository integration and dependency maintenance | Repository integration and dependency maintenance | `main@014499d` | `main@7b202b5` before its registry-only sync | Keep one verified worktree and align local and remote `main` | integrated | Git refs, npm lockfile, Actions, Pages | current PR CI, main CI, Pages, browser smoke, bundle policy, and dependency audit passed | Day.js #8, Vite replacement #35, Turf replacement #36, Actions replacement #37 | complete | Historical record; MapLibre 6 remains a separate migration decision. |

States: `in-progress`, `blocked`, `ready-for-review`, `ready-for-integration`, `integrated`, `abandoned`.

## Retained local branches without worktrees

- `codex/chart-drawer-sizing@19901a5` — open PR #46.
- `codex/dataset-anchored-time-window@aef83d7` — open PR #44.
- `codex/draggable-crime-points@ba34204` — open PR #45.
- `codex/filter-relative-crime-clusters@8548021` — open PR #47.
- `codex/tract-outline-controls@e5a84c6` — open PR #48.

Local branches now consist only of `main`, the protected bilingual branch, and these five open-PR branches. No remote branch was deleted; both cleanup recovery refs remain available.

## Latest completed milestone

- Owner: root agent.
- Task record: `docs/archive/p2-local-integration-cleanup/`.
- Reconciliation: commit `66b3154`, merged by PR #59 as `50402aa8`.
- Closeout: commit `ff3c9d1`, merged by PR #60 as `4eb3ba4a`.
- Verification: PR #60 CI `30896447349`, main CI `30896743749`, and Pages `30896743598` passed.
- Local result: eight auxiliary worktrees and fifteen obsolete local branches were removed; only the protected primary worktree remains.
- Constraint honored: no runtime changes, remote-branch deletion, open-PR integration, history rewrite, or alteration of user-owned primary-worktree WIP.

## Previous delivery package

- Summary: removed 14 remote branches already contained in `main`; merged Day.js #8; replaced and closed stale Vite #11 with #35; replaced and closed stale Turf #9 with #36; replaced and closed Actions #20-#24 with atomic upgrade #37.
- Files: dependency manifests, pinned workflow references, the immutable Action SHA policy, and this registry.
- Divergence from main: none for completed deliveries.
- Remaining risk: MapLibre 6 requires ESM import changes and WebGL2, and the verified experiment increased the entry from about `859 kB / 230 kB gzip` to `1,020 kB / 269 kB gzip`, exceeding both current bundle budgets.
- Recommended integration method: keep `main` as the single local worktree; address #10 as a dedicated map-runtime and performance migration rather than raising bundle limits.
