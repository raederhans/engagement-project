# Mainline M7 Public Product Context

## Current truth

- Worktree：`C:/Users/raede/.codex/worktrees/f50e/engagement_project`。
- Branch：`codex/mainline-m7-public-product`；从干净 detached `main@dfb4bc8` 创建。
- 分支创建前 `git status --short --branch` 仅显示 `## HEAD (no branch)`，tracked/untracked 均为空。
- 本 lane 是 M7 唯一 integration owner，但权限仅限本地任务分支；不 merge main、push、deploy、修改
  远端设置或清理其他 worktree。
- `docs/active/mainline-m0-m6/**` 已明确 M5 不继承 routing authority、M6 在证据不足时机械保持
  `NO-GO/UNAVAILABLE`；M7 必须保留该真实能力边界。
- 子任务已完成 fixture/unit、browser/Axe 和差异审查工作面；主任务独占
  集成写入、Git 与 live verification。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-09-01 | `HEAD=dfb4bc8` 且初始工作树干净；本地 `main` 指向同一提交。 | 从该 SHA 创建 `codex/mainline-m7-public-product`，不接触 main owner。 |
| 2026-09-01 | 用户明确要求 `plan/context/task`；`manage-task-records` 触发条件成立。 | 仅维护本目录一组 active records；完成前不归档。 |
| 2026-09-01 | Public Scenario Mode 仅允许预计算公开 landmark OD pair，且禁止任意公共 backend。 | 数据与交互都采用 allowlisted static fixture；任何非 allowlisted 输入 fail closed。 |
| 2026-09-01 | 用户禁止单一安全赢家和缺失值零填充。 | presenter 与 browser tests 将把文案禁区和 `Unavailable` 作为可执行合同。 |
| 2026-09-01 | `dfb4bc8` baseline non-VRE/total 为 `4,077,639/4,259,598` bytes；Pages-base M7 实测为 `4,140,607/4,322,566` bytes。 | 视觉阈值不变；聚合 bundle 上限窄调为 `4,141,000/4,323,000` bytes，fixture 独立上限 `21,000` bytes。 |
| 2026-09-01 | 首次 `npm run validate` 唯一失败是 product-integrity meta-test 仍锁定旧 bundle 上限。 | 同步 meta-contract 后 `npm run test:product-integrity` 80/80 PASS；最终源码收口后重跑全量 gate。 |
| 2026-09-01 | 差异审查指出 metric 语义验证、scenario focus 和完整文案 eager import 三项问题。 | 已补严格单位/值域/准入一致性校验、切换后聚焦新选项，并将完整文案保留在 nested-lazy UI chunk。 |
| 2026-09-01 | 第二次 `npm run validate` 唯一失败是 P1 stylesheet ownership 清单未登记 M7 样式。 | 将 `public-route-alternatives.css` 加入唯一级联顺序合同；`npm run test:p1-ui` 19/19 且 66 个现有视觉 baseline 全部 PASS，没有更改 baseline/阈值。 |
| 2026-09-01 | 最终 `npm run validate` exit 0，三项差异问题窄复审结果为 No findings / PASS。 | 实现达到 handoff-ready；Safari/Firefox 原生 dialog/select 聚焦行为未单独实测。 |
| 2026-09-01 | 实现提交 `53f90cac3f031f84d7c962a7418d8762651ab047`。 | 该提交是可独立验证的 M7 产品单元；本记录提交在其后。 |
| 2026-09-01 | 后续 bounded review 证明 fixture 可同时篡改 `artifactId/generatedAt/candidateId/edgeIds/metrics/labels` 后仍自我准入。 | 撤回 handoff-ready 结论；必须由代码侧独立版本化 manifest 绑定精确身份和内容摘要，并对权威/风险文案 fail closed。 |
| 2026-09-01 | 新增代码侧 `engagement-public-route-scenario-admission/v1`，固定 artifact/time/scenario/candidate/edge 顺序身份，并以 `sha256:33e1f289f3ccee8a143089302b92fe3eee25b96ddf96aa3e92618c8a83ec4103` 绑定整份规范化 JSON。 | label、metric、admission、runtime boundary 或其他内容的合法形态漂移也会在 UI 创建前 fail closed；loader 显式等待 Web Crypto。 |
| 2026-09-01 | manifest 初版使 normal non-VRE bundle 达 `4,141,124`，超过既有 `4,141,000` 上限 124 bytes。 | 未放宽预算；将逐层身份比较收敛为 exact identity projection，并只压缩 fixture JSON 的空白，规范内容摘要不变。 |
| 2026-09-01 | 复审发现 browser 文案正则漏掉 `recommendation/recommend/推荐路线/个人受害概率` 等词形。 | 建立测试侧统一 copy guard：仅移除四条精确批准的否定披露，再扫描完整英中禁区；hostile probes 与 browser 共同执行。复审最终 No findings / PASS。 |
| 2026-09-01 | remediation 实现提交 `79a62174af4ff05296e46179cc26ccbc2c17fd16`；全量与 Pages-base gate 通过。 | 恢复 handoff-ready；不据此扩大 M5/R7 authority、部署或发布范围。 |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| `npm run validate` | `/root` only | `C:/Users/raede/AppData/Local/Temp/engagement-m7-validate-final.log` | 已完成，exit 0；没有遗留 preview server 或共享长进程。 |
| M7 manifest remediation：`build:manifest` -> bundle -> normal/Pages browser -> `validate` | `/root` only | `C:/Users/raede/AppData/Local/Temp/engagement-m7-manifest-remediation.log`；Pages preview：`engagement-m7-pages-preview.log` | 已完成，所有最终 gate exit 0；preview 已停止且 port `4207` clear。首轮 bundle 超限 124 bytes 后优化通过；一次 browser 命令因共用日志锁未执行，拆分日志后实际重跑通过。 |

## Handoff

推荐整合顺序：

1. 先整合已完整验证的实现提交 `53f90cac3f031f84d7c962a7418d8762651ab047`。
2. 再整合初始 M7 active-record handoff 提交 `8d75065288a4f22cac244bd4a4eebf9756fc50d3`。
3. 再整合 manifest remediation 提交 `79a62174af4ff05296e46179cc26ccbc2c17fd16` 及随后的 active-record 收口提交。
4. 在目标整合分支上重跑 `npm run validate` 与 Pages-base M7 browser gate；只由总协调任务决定 main merge、push 和 deploy。

未准入边界：私人或任意 OD、网络路由、runtime candidate generation、实时路线评估、walking legality/
calibration、M5/R7 routing/safety authority 均仍不可用。单路线 fixture 不准入 accessibility 和
sensitivity；degraded fixture 不准入 incident exposure、crash、HIN、accessibility、map-match、freshness
和 sensitivity。complete fixture 也只是说明性预计算数据，不是实测或 production receipt。

文案边界：只允许 `Fastest`、`Lower historical exposure`、`Balanced`、有准入证据时的
`Accessibility-oriented` 和降级的 `Route`；历史报案暴露与 crash/HIN/accessibility/map-match/
freshness/uncertainty 始终分列。禁止 `Safest`、`Best route`、risk/safety score、个人受害概率、winner
或推荐；缺失证据为 `Unavailable`，不是 `0`。

## Next step

Handoff-ready：总协调任务可按上述顺序整合，并在目标分支复跑 gate；本 lane 不自行 merge、push、deploy 或提升真实路线 authority。
