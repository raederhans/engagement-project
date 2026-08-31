# Context

## Current truth

- Integration target: `C:/Users/raede/.codex/worktrees/phase1-main/engagement_project`，`main@cfb0af1...`，与 `origin/main` 一致且初始干净。
- Mainline source: `codex/mainline-m0-m6@3d4c126c8ced0f68f504c93bce49d669c889a85e`，4 commits，34 paths，clean。
- ML source: `codex/python-ml-benchmark@06c4c20b9e74bf51426991d0cbd9450ca9f4c418`，3 commits，33 paths，clean。
- 两源均基于 `cfb0af1...`，changed-path intersection 为 0；默认检出和其他 worktree 未触碰。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-31 | 两执行任务均已正常完成并进入 idle，不是运行异常。 | 总协调对话恢复并承担 integration owner。 |
| 2026-08-31 | `git fetch origin` 后 `HEAD...origin/main = 0/0`。 | 可从当前本地 main 串行整合，无需先解决远端漂移。 |
| 2026-08-31 | 两分支 67 个 changed paths，交集为 0。 | 文本冲突风险低；重点检查 Protocol v3/ML 候选语义。 |
| 2026-08-31 | 主线四提交与 ML 三提交均已无冲突 cherry-pick；本地 `main` 相对 `origin/main` ahead 8（含 LF 修复）。 | 两交付包已进入同一整合树；远端仍未改变。 |
| 2026-08-31 | 主线聚焦测试在 fresh Windows checkout 首次发现 v3 spatial protocol 被检出为 CRLF。 | 以 exact `.gitattributes` 规则固定该文件为 LF；未泛化或改写历史 v2 字节。 |
| 2026-08-31 | ML 仍严格加载 Evaluation Protocol v2；MA4 是 v2 诊断/参考基线，v3 validator 的冻结候选集合不含 MA4。 | README 与 v3 聚焦测试增加显式边界，不让 ML 实现反向扩大 v3 资格。 |
| 2026-08-31 | fresh integration checkout 首次 `npm run validate` 因未安装 `node_modules` 在首个依赖导入处停止。 | `npm ci` 按 lock 安装 395 packages、audit 0 vulnerabilities；这是环境准备，不记为产品回归。 |
| 2026-08-31 | 安装依赖后的首轮全仓测试与 build 已通过，bundle policy 发现 ML workflow 使用浮动 action tags。 | checkout/upload-artifact 使用仓库既有批准 SHA，setup-uv 固定为官方 v6 tag commit 并纳入允许集与精确计数。 |
| 2026-08-31 | 最终 `npm run validate` exit 0。 | 联合本地代码、测试、生产 build 与 bundle policy gate 完成；不等价于远端 CI、Pages 或 deployment。 |
| 2026-08-31 | 本地 integration code tip `5c2c25c5a5f10eac7f349a2861dc9a9ad83a6b7c`；再次 fetch 后 `HEAD...origin/main = 9/0`、`origin/main@cfb0af1...`。 | 本地整合完成且远端未漂移；记录 closeout commit 可跟随，但不得将其冒充已 push。 |
| 2026-08-31 | 总监督重新唤醒主线与 ML 原任务做 post-integration audit；两者约 4.5 分钟后 completed，但均无可读取 assistant message。 | 不把无正文的 delegated turn 计为验收证据；总监督直接核验两个 source delivery 共 7 commits 全部 patch-equivalent，并复查 M7 排除、R7 NO-GO、ML authority、MA4/v3 与 workflow SHA 边界。 |
| 2026-08-31 | 用户要求继续工作；`docs/DEPLOY.md` 将本地发布预检定义为 `npm run ci:release` 加 `npm run coverage:report`。 | 新增 Stage 6；只运行本地验证与远端只读检查，不推送或部署。 |
| 2026-08-31 | GitHub 只读预检：main 未 protected、rulesets 为空、Actions 允许 all 且不强制 SHA pin；Pages 为 workflow source，最后成功主线 run 为 `33291985358@cfb0af1`。 | M0 治理变更仍是远端待授权项；本地 workflow 自身继续强制批准 SHA，不把平台设置误报为已配置。 |
| 2026-08-31 | 首轮 `npm run ci:release` 在 visual 阶段以 33 passed / 10 skipped / 2 failed 结束；其余 release steps 全通过。 | 继续按根因门禁调查，不更新全部快照，也不放宽视觉差异阈值。 |
| 2026-08-31 | Crime desktop 基线遗漏 `6c08005` 的 District 06 场景变更；Diary landscape 基线遗漏 M0 已批准的 `PHL Evidence` 品牌变化。两条失败均连续复现且实际图像字节稳定。 | 仅替换 `win32/desktop/crime-analysis.png` 与 `win32/landscape/diary-rating-step-2.png`；不修改产品代码或 `maxDiffPixelRatio`。 |
| 2026-08-31 | 两条定向视觉用例分别 1/1 PASS；最终 `npm run ci:release` exit 0，visual 35 passed / 10 expected skipped。 | 本地 release gate 完整通过；仍不等价于远端 CI、Pages 或部署。 |
| 2026-08-31 | `npm run coverage:report` exit 0，76/76；lines 56.47%、branches 71.33%、functions 59.95%。 | 报告型覆盖率完成；项目没有把这些百分比定义为强制 release threshold。 |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| ML fresh-checkout gates | 当前总协调对话 `/root` | 当前任务输出；仅 `.venv` cache 落于 ignored `ml/.venv` | complete / PASS |
| 全仓 `npm run validate` | 当前总协调对话 `/root` | `.tmp/integration/npm-validate-final.log` | complete / PASS / exit 0 |
| 首轮本地 `npm run ci:release` | 当前总协调对话 `/root` | `.tmp/integration/ci-release.log` | complete / expected diagnostic FAIL / visual 33 pass, 10 skip, 2 stale baselines |
| 定向视觉复核 | 当前总协调对话 `/root` | `.tmp/integration/crime-visual-targeted.log`; `.tmp/integration/diary-visual-targeted.log` | complete / PASS / 1+1 |
| 最终本地 `npm run ci:release` | 当前总协调对话 `/root` | `.tmp/integration/ci-release-after-baselines.log` | complete / PASS / exit 0 / visual 35 pass, 10 skip |
| 本地 `npm run coverage:report` | 当前总协调对话 `/root` | `.tmp/integration/coverage-report.log` | complete / PASS / exit 0 / 76 tests |

## Handoff

本对话是最终本地 integration owner。执行任务不再修改各自交付分支；push、部署、GitHub 治理和外部存储继续由显式授权闸门控制。

## Next step

本地 integration 与 Stage 6 预检已收口。远端仍保持 `origin/main@cfb0af1...`；只有收到明确授权后才可 push，并由远端 CI/Pages 对新的精确 SHA 重新给出证据。
