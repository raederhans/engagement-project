# Task

## Current status

`M2 active — integrated code gate PASS; unique data owner ready for GO (3/4 high tasks)`。

## Checklist

- [x] 完整读取用户指定规划对话并冻结 M1-M6 语义。
- [x] 核对 local main/current branch/worktrees/dirty state 和适用 `docs/AGENTS.md`。
- [x] 证明旧 M1/M2 ignored 重型数据已丢失、tracked pipeline 仍在。
- [x] 建立隔离监督 worktree 和唯一三件套。
- [x] 派发 M1-1 数据重建、M1-2 ingest 恢复、M1-3 空间/ACS/DQ 三个 high 任务。
- [x] 记录三个任务的真实 thread/worktree/HEAD；均从 `9d93df2` 干净起步。
- [x] 在监督 base 运行 M0/M1 聚焦基线并记录结果。
- [x] 接收 M1-2/M1-3 source-final commits，按顺序整合并通过联合回归。
- [x] 派发 M1-4 独立集成与数据门禁 reviewer；本阶段新任务达到 4/4。
- [x] 接收 M1-4 首轮代码门禁：REQUEST CHANGES；hostile overlap 复现确认 P1。
- [x] 整合 M1-2 补丁并让 M1-4 对修复后的精确 SHA 复审：PASS。
- [x] 由 M1-1 从全新根生成 full data receipt、exact rerun 与 validate-only。
- [x] 运行 M1 stage gate；记录 independent reviewer-channel 缺口并冻结 M2 exact input。
- [x] 派发 M2-1 protocol/integrity、M2-2 unique data owner、M2-3 serving/UI 三个 high 任务。
- [x] 整合 protocol-v2 和 serving source-final，运行中央代码门禁。
- [ ] 给 M2-2 精确数据 GO，完成 mart exact rerun 与 frozen evaluation。
- [ ] 创建 M2-4 最终 reviewer 并完成 M2 exact data/evaluation stage gate。
- [ ] M2 Area Intelligence stage gate。
- [ ] M3 Home and Neighborhood Compare stage gate。
- [ ] M4 Known Route Evidence stage gate。
- [ ] M5 Adaptive Route Alternatives stage gate。
- [ ] M6 Local Diary / closed Community Evidence stage gate。

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git status --short --branch` on primary | primary branch has only untracked logs/output; preserved. |
| `git status --short --branch` on phase1-main | clean local main, ahead of local origin/main by 93. |
| `.dfev1` inventory on phase1-main | `crime` directory contains 0 files. |
| known historical data roots `c180` and `fed9` | absent; no recovery shortcut available there. |
| `git worktree add -b codex/dfev1-m1-m6-supervisor ... main` | exit 0 at exact `9d93df2`. |
| `npm ci` | exit 0; 395 packages installed, 396 audited, 0 vulnerabilities. |
| `npm run test:data-pipeline` | exit 0; 66/66 M0-M3 pipeline/contract tests passed. |
| `npm run data:check:tract-crime` | exit 0; current 408-tract snapshot/full receipt/runtime projection pair valid for `[2025-08-01, 2026-08-01)`. |
| M1-2 source-final `3837512` | task tests 68/68; official one-day smoke 386 rows; rerun idempotent; integrated as `ffa8d45`. |
| M1-3 source-final `35c6cee` | task tests 67/67 plus focused 11/11; integrated as `5d1b0d8`. |
| `npm run test:data-pipeline` after both integrations | exit 0; 69/69 passed. |
| focused ESLint on M1 contract/source/warehouse/spatial/ACS/tests | exit 0. |
| `git diff --check` after both integrations | exit 0. |
| M1-1 source preflight | live count 3,586,621 for `[2006-01-01, 2026-08-28)`; no current warehouse receipt yet. |
| M1-4 review of `9d93df2..5d1b0d8` | REQUEST CHANGES; targeted 13/13, syntax, ESLint and JSON parse pass, but hostile overlap repro confirms canonical drift can be re-signed. |
| M1-1 sync to detached `4c9abe2` | code/contract tree equals supervisor `5d1b0d8`; 13/13 + ESLint + diff-check pass; new data root remains absent. |
| M1-2 repair source-final `34b90bd` | three new regressions red before fix; focused 6/6 and full task suite 71/71 after fix. |
| supervisor cherry-pick `037c615` | combined `npm run test:data-pipeline` 72/72; targeted ESLint and diff-check pass. |
| M1-4 re-review of `037c615` | PASS; independent hostile script now rejects before transaction; 16/16 targeted tests plus syntax/ESLint/JSON/diff-check pass. |
| M1-1 final sync | detached `8325842`; product tree equals supervisor `037c615`; formal source-final root and run1 ownership frozen. |
| M1 formal root | 10,061,298,932 bytes / 1,514 files; 21 manifests / 1,344 raw shards; 3,586,620 acquisition = canonical = active rows; 64 canonical partitions / 8,741,798,048 bytes. |
| M1 first backfill | exit 0; 4,507.311s; peak RSS 967,610,368 bytes; checkpoint 21/21. |
| M1 exact-command rerun | exit 0; 3,712.230s; all 21 acquisition/ingest phases idempotent; receipt bytes/mtime/identity unchanged. |
| M1 `--validate-only` | exit 0; 1,003.474s; frozen receipt and actual warehouse admission revalidated. |
| M1 receipt identity | declared `sha256:cd7585ae6de518cbbf57ab5c301073a69ef3c4d6543ec6d3acdadc253b3e16e4`; manifest/checkpoint/lineage/current quality/canonical bindings present. |
| bounded spatial/ACS/DQ gate | PASS; coordinate/tract/grid/corridor/ACS state sums each equal 3,586,620; unavailable is not zero; serving/integration remain false. |
| final delegated data-review follow-ups | M1-3 twice, M1-2 fallback once and M1-4 once completed with 0 items; no independent reviewer verdict may be claimed. |
| M2-1 source-final `5607949` / supervisor `285ede0` | protocol v2 SHA `d7d75ce0eb0aaf80b950aa87125e5a98742dca57db38d22938b3851fed048ff6`; exact 9.37 GiB M1 gate exit 0; 8/8 hostile tests and targeted ESLint pass. |
| M2-3 source-final `3c8b3d4` / supervisor `dcd31ce` | run/v2 + seam parts + coverage/source continuity + publication rollback integrated; no real publish or performance run. |
| central M2/publisher focused suite | exit 0; 21/21 PASS. |
| central i18n suite | exit 0; 11/11 PASS. |
| central targeted ESLint and commit diff-check | exit 0. |
| central `npm run build:manifest` | exit 0; production build complete. |
| central `npm run verify:bundle` | PASS; 3,999,977 / 4,000,000 bytes excluding declared ACS VRE source artifact. |
| central Area Intelligence browser | PASS; current-lineage promoted/not-promoted/invalid, responsive, zero console/page errors. |

## Open risks and remaining work

- M1 ignored root 约 9.37 GiB 且只存在于 retained `ac89` worktree；下游 M2-M4 完成前不得清理、移动或回收该 worktree。
- M1-1 的 50,000-row partial 明确无效且仍原样保留；任何下游不得发现后自动 fallback 到该旧根。
- 新 pre-ingest full scan is intentionally O(canonical bytes + rows)；exact rerun 观测到约 190.7 GiB
  机械扫描下界和 93,252,120 row inspections，后续增量性能需单独优化但不能削弱 fail-closed gate。
- 独立 final data reviewer 通道没有返回 evidence；M1 只能声明 local mechanical gate PASS，不能声明
  independent data-review PASS，也不能据此开放 serving/publish。
- 当前只有本地 evidence；remote CI、scheduled refresh、deployment 和 product liveness 均未运行。
- M2 历史结论为 honest `not-promoted`，本轮不得因追求功能而放松预注册 gate。
- M2-1 memory quick pass 意外暴露旧 performance 摘要；科学规则机械等同旧冻结 v1 且未读取
  本轮结果，因此没有结果驱动调参，但不得声称严格观察者盲态无污染，M2-4 必须独立评估。
- Bundle 只余 23 bytes；M3-M6 新 UI 不能提高 ceiling，需先做实际 code-splitting/体积收敛。
- M4/M5 的真实道路图 authority 和许可仍需从当前 main 的实际 contracts重新判定。
- M4 full builder 仍绑定旧 M1 row/date 常量；进入 M4 时必须迁移为本轮 receipt 驱动且复核
  canonical bindings，不能把旧数值换成新数值后继续硬编码。
