# Context

## Current truth

- Worktree: `C:/Users/raede/.codex/worktrees/b1cf/engagement_project`。
- Baseline: clean detached `HEAD@1e9f91d8fbb59482985877ed7a6122e2959bac47`；提交前需创建本任务 `codex/` 分支。
- C1/C2 已在基线：`requestRouteCorridor(options)` 已暴露；route input 支持用户选取 GeoJSON LineString 与 caller-owned manual/drawing coordinates；原始 GPS map matching 仍未实现。
- 当前无 C3 用户 UI 调用者；`routeCorridorModulePromise ||= import(...)` 会永久缓存首次 rejected promise，是本任务需关闭的 Low。
- `docs/active/_worktree_registry.md` 只读；本任务不是 main/integration/remote owner。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-06 start | 用户要求先完成 C3-0，再按 admission 证据进入 UI | 不先写 UI；TDD 从固定虚构路线矩阵开始 |
| 2026-08-06 start | 根目录无 `AGENTS.md` 或 `lessons learned.md`；适用仓库指导为 `docs/AGENTS.md` | 不追加 lessons；遵守用户提供的顶层 AGENTS 合同与 docs 指导 |
| 2026-08-06 start | 当前代码是最终事实源，历史 C1/C2 记录只作决策背景 | 任何历史数字和描述需重新验证 |
| 2026-08-06 C3-0 | bundled police-district proof：短 Center City/100m 通过；同路线 500m、正常中长/跨区路线频繁失败 | single-district 不能作为通用 UI admission |
| 2026-08-06 C3-0 | 官方 OpenDataPhilly City Limits 明确是 City Standard Boundary；固定 ArcGIS GeoJSON 请求实测 HTTP 200、1 Polygon | 采用无新依赖的 `city-limit-interior` proof；固定 boundary 请求不包含 exact route；失败时保留原 single-district fail-closed fallback |
| 2026-08-06 C3-0 | 官方 City Limits matrix：Center short 100/500/1000m、Broad St 100/500/1000m、north 100/500/1000m 均通过；outside 全拒绝；部分靠河/市界的 medium/west-east 仍按 buffer+500m 拒绝 | 足以进入显式 corridor UI；不宣称所有市内路线可用，coverage unavailable 保持独立状态 |
| 2026-08-06 C3 | 首次 UI import rejected promise 已改为可清除并由用户 retry；I2 `sync` 端口异常已复现并返回具体 `incomplete/failedPort` | UI 不永久 pending，不把部分 canonical apply 说成完整成功 |
| 2026-08-06 bundle-1 | feature-enabled：Entry 893274/241125；Crime 39920/14074；C3 UI 11641/4610；route data 13237/4819 | Entry 未扩预算；先压缩 loader，随后按最小实测 ceiling admission Crime/C3 UI |
| 2026-08-06 visual | 首次无 update matrix 暴露次级入口把主 CTA 推出 half sheet；移动到末尾又造成 scroll anchoring | 未更新 baseline 掩盖回归；最终将短入口与 Suggested time windows 放在同一网格行，portrait/landscape 旧 baseline 保持不变 |
| 2026-08-06 visual | 逐图确认 desktop 新入口层级清楚且不遮挡后，仅更新 Crime analysis/help/incident 三张 baseline；阈值未变 | 最终无 update matrix 35 pass/10 configured skip |
| 2026-08-06 i18n | 动态 C3 query/evidence/fallback list 文案全部进入共享中英文 runtime；语言切换保留当前 result envelope | Route UI 独立 chunk 实测 `16359/6082`，ceiling `16600/6200`；Entry ceiling 不变 |
| 2026-08-06 review | 极点附近合法 LineString 会在 coverage 拒绝前产生异常大的米制 line width | TDD 加纬度缩放下限；不影响 Philadelphia 正常纬度精度 |
| 2026-08-06 final bundle | default Entry `893008/241051`、Crime `39939/14058`；feature Entry `893274/241123`、Crime `40145/14150`；共同 route data `13237/4819`、UI `16359/6082` | default/feature bundle policy 均 PASS，未提高 Entry ceiling |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| feature-enabled build/manifest/bundle | S3-C3 owner (this task) | `.tmp/s3-c3-route-corridor-ui/feature-build-final.log` | completed PASS；无进程/端口 |
| full validate | S3-C3 owner (this task) | `.tmp/s3-c3-route-corridor-ui/validate-final.log` | completed PASS；无进程/端口 |
| browser smoke | S3-C3 owner (this task), `127.0.0.1:4173` | `.tmp/s3-c3-route-corridor-ui/browser-smoke-final.log` | completed PASS；4173 已释放 |
| visual matrix | S3-C3 owner (this task), `127.0.0.1:4178` | `.tmp/s3-c3-route-corridor-ui/visual-final-verified.log` | completed PASS；4178 已释放；临时报告提交前删除 |

## Parent integration revalidation (2026-08-09)

- Owner: `/root` integration owner only.
- Candidate: `d15c425a45544e21558c82395ba611f2d1f203ef` in this worktree.
- Commands, sequentially: focused route/Crime tests; `npm run validate`;
  `VITE_TRACT_CRIME_SNAPSHOT=1 VITE_FEATURE_DIARY=1 npm run build:manifest`
  plus bundle policy and browser smoke on 4173; visual/a11y matrix on 4178.
- Shared resources: this worktree's `dist/`, `.tmp/s3-c3-integration/`,
  `test-results/`, and `playwright-report/` only. Ports 4173 and 4178 were free
  at admission; the user-owned 5173 listener is explicitly out of scope.
- Logs: `.tmp/s3-c3-integration/*.log`; success requires exit 0, expected test
  counts, zero browser console/page errors, and an unchanged-baseline visual
  pass. Only `/root` may start, poll, retry, stop, or interpret these runs.
- Result: focused Route UI 7/7, Route data 20/20, Crime async 28/28, and Crime
  UI 48/48 passed; full `npm run validate` exited 0; feature bundle passed at
  Entry 893274/241129, Crime 40145/14150, Route data 13237/4819, and Route UI
  16383/6093; browser smoke passed with zero console/page errors; unchanged
  visual/a11y matrix passed 35 with 10 configured skips. Ports 4173/4178 were
  released and 5173 retained its original owner.
- Evidence correction: the first browser-smoke attempt enabled the tract
  snapshot but omitted `VITE_FEATURE_DIARY=1`, so the standard Diary button was
  correctly disabled and the smoke timed out there. No product code changed;
  the corrected two-flag build passed on the single retry.
- Task-owned `.tmp/s3-c3-integration`, Playwright report/results, and the one
  generated query log were removed after the results above were recorded.

## Post-push CI dependency gate repair (2026-08-09)

- Local/remote main first synchronized at `16cb8ce`; Pages run `31309413233`
  passed, but CI run `31309413231` failed on both Ubuntu and Windows before any
  product test because `npm audit --audit-level=high` found
  `GHSA-2v37-7h3g-55p8` in transitive `nanoid@3.3.16`.
- Root path: `vite@8.1.5 -> postcss@8.5.25 -> nanoid@3.3.16`. The upstream
  advisory marks `3.3.17` as the first patched 3.x release; PostCSS declares
  `nanoid ^3.3.16`, so the smallest repair is a lockfile-only resolution to
  `3.3.18`, not a Vite/PostCSS/package.json upgrade or audit suppression.
- RED: local `npm audit --audit-level=high` reproduced one high vulnerability.
  GREEN: `npm audit fix --package-lock-only` changed only the two lock entries
  for nanoid; a clean `npm ci` plus audit reported zero vulnerabilities.
- Fresh CI reproduction owner: `/root`; no port. Command sequence:
  `npm ci`, `npm audit --audit-level=high`, then `npm run validate`, all exit 0.
  Bundle remained Entry 893008/241051, Crime 39939/14054, Route data
  13237/4819, and Route UI 16383/6093. The scoped `.tmp` log and generated
  `queries_2026-08-09T1056.log` are removed after this evidence is recorded.

## Remote visual baseline repair and final admission (2026-08-09)

- `fc999cc` repaired the high-severity audit gate and passed audit, full
  validation, and browser smoke on Ubuntu and Windows. Ubuntu visual run
  `31309619802` then exposed three deterministic desktop screenshot failures.
- CI artifacts showed that all three differences were the intentional Stage 6
  `Known route` entry. The Stage 6 product commit had updated Win32 baselines
  but omitted the corresponding Linux desktop baselines; no product assertion,
  CSS, or visual-diff threshold failed or changed.
- RED: Linux `crime-analysis`, `crime-incident-results`, and
  `crime-help-data-details` differed by 3%-4% from pre-Stage-6 expectations.
  GREEN: commit `74d68a5` used the exact Ubuntu captures for those three Linux
  expectations, retained the 0.5% default and 0.8% incident budgets, and passed
  visual baseline policy for all 66 platform-specific images.
- Exact remote result: CI run `31310028016` passed Ubuntu and Windows, including
  audit, full validate, Ubuntu browser smoke, and the unchanged-threshold visual
  matrix. Pages run `31310027990` passed build and deploy for the same SHA.
- The downloaded CI diagnostics under `.tmp/s3-c3-ci-visual` were deleted after
  the expected/actual/diff review and are not part of repository state.

## Handoff

- 本任务拥有：S3-C3 产品/测试与 `docs/active/s3-c3-route-corridor-ui/`。
- 禁止：main/remote/registry 整合、其他 worktree、外部进程、无关 WIP。
- 目标终态：本分支 exact SHA、验证证据、bundle、残余风险、`ready-for-integration`。

## Pre-cleanup recovery ledger (2026-08-09)

The integration owner recorded every ref below before deletion. Recovery is by
exact SHA through Git object retention or the linked merged/closed pull request;
no open pull-request head is included in the deletion set.

### Local branches contained by `main@74d68a5`

| Branch | Recorded tip | Remote evidence |
| --- | --- | --- |
| `codex/s3-c3-route-corridor-ui` | `16cb8ce4a8a6950cb13b287a54abe59f3a840958` | Stage 6 product + admission record, fast-forwarded into main |
| `codex/bilingual-localization` | `65ac92fb6dbd137f92604f84312e2b8bf0ebcf86` | merged PR #42 |
| `codex/crime-product-integration` | `1e5a73ce9973958dd0b857e797f590957bf18bdb` | merged PR #62 |
| `codex/crime-product-integration-closeout` | `86d7515178e85ebfe997448ab5707b9a95f18d9e` | merged PR #63 |
| `codex/incident-status-ownership` | `dc9bf4dd6c9bceaaa8c6be909ee8bf3e7e2c45b7` | merged PR #64 |

### Remote branches with merged PR recovery

`codex/ui-p0-redesign@d35ce35d` (#39), `codex/p1-ui@f21e4826`
(#41), `codex/bilingual-localization@65ac92fb` (#42),
`codex/p1-localization-closeout@4da6e62c` (#43),
`codex/p1-5-8-accessibility-design-ci@8ebd69a1` (#52),
`codex/p1-5-8-closeout@aa0ad48d` (#54),
`codex/p2-product-completion@c1e02b58` (#56),
`codex/p2-result-meta-hotfix@505d28e5` (#57),
`codex/p2-product-closeout@ce18caba` (#58),
`codex/local-worktree-cleanup@66b3154e` (#59),
`codex/local-worktree-cleanup-closeout@ff3c9d12` (#60),
`codex/local-worktree-cleanup-archive@8190b6da` (#61),
`codex/crime-product-integration@1e5a73ce` (#62),
`codex/crime-product-integration-closeout@86d75151` (#63), and
`codex/incident-status-ownership@dc9bf4dd` (#64).

### Remote closed stacked heads superseded by merged P2 delivery

`codex/comparison-detail-menu@20eda9bf` (#49),
`codex/chart-studio@a1eea91e` (#50),
`codex/incident-point-details@8f78a61b` (#51),
`codex/crime-summary-insights@aecec62d` (#53), and
`codex/custom-buffer-radius@ffdf3515` (#55) were closed stacked development
heads. Their delivered behavior is represented by merged P2 PRs #56-#58 and
the current passing product/integration gates; their exact tips remain recorded
here for recovery.

### Explicit retain set

Local/remote open QoL PR heads #44-#48 and remote Dependabot heads #65-#67 are
not Stage 6 dependencies and are retained without merge or deletion. The
filesystem path `C:/Users/raede/.codex/worktrees/9188/engagement_project` is not
a registered Git worktree; it is retained because the current Codex/OMX session
still owns live state there.

## Next step

把路线走廊能力保持为显式、按需、历史记录查询；下一阶段先做真实用户场景与
coverage 失败率验证，再决定是否扩展离线市界 proof、候选数量体验或另立隐私/
provider 契约的 GPS matching 工作流。开放 QoL 与依赖 PR 继续独立评估。
