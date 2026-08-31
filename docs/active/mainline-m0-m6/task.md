# Task

## Current status

`handoff-ready`：M0-M6 合同、文档、当前 fail-closed 报告、聚焦测试与完整
`npm run validate` 均已通过，三个有序实现 commits 已建立。远端集成、push、gate 与清理由
总协调对话保留。

## Checklist

- [x] 核验 HEAD/origin/main/merge-base、初始 status 与 worktree registry。
- [x] 创建独立 `codex/mainline-m0-m6` 分支和唯一 active task record。
- [x] M0 Portfolio v2 与治理 mutation plan。
- [x] M1 ArtifactRegistry/restore 运营闭环。
- [x] M2 UncertaintyFootprint/fractional/kernel aggregate comparison。
- [x] M3 Evaluation Protocol v3 冻结与 validator。
- [x] M4 Home Compare 三源 aggregate contract/admission。
- [x] M5 Known Route crash/accessibility/legality/calibration/sensitivity contracts。
- [x] M6 R7 go/no-go gate/report。
- [x] 聚焦验证与完整共享验证。
- [x] 分阶段 commits、最终 diff/status 检查与交接。

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git status --short --branch`（分支创建前） | clean detached HEAD |
| `git rev-parse HEAD/origin/main/merge-base` | all `cfb0af1cf0e00a7a6c23e07cacc8d7cc50e3d6a7` |
| `git worktree list --porcelain` | protected primary/data/RD6B/ML worktrees identified; untouched |
| `npm run test:mainline-m0-m6` | PASS，17/17，约 0.85 s（首次失败仅修正两处测试夹具/措辞断言） |
| focused `npx eslint ...` | PASS，新增/修改 JS 15 个目标，约 2.88 s |
| changed JSON parse + tracked report admission | PASS |
| Diary/i18n/UI truth contracts | PASS，44/44 |
| `crime_event_warehouse` final targeted retry | PASS，18/18，约 20.4 s；此前 Windows `EPERM` 为瞬时文件锁 |
| closeout `npm run validate` | PASS，exit 0，约 85 s；含 production build 与 bundle policy |

## Open risks and remaining work

- 真实对象存储、第二物理环境、scheduled observation、外部 source acquisition 和 GitHub mutation
  未获当前执行授权，相关状态必须保持 `unavailable` 或 plan-only。
- 附属 ML 对话可实现候选模型，但不得反向更改本轮冻结的 Protocol v3。
- 当前 tracked R7 报告保持 `NO-GO/UNAVAILABLE`；未生成路线候选、最安全路线、组合分数或
  routing authority。
