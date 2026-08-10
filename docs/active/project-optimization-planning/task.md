# Task

## Current status

六条规划、三条执行线、跨 worktree 整合与统一本地发布门均已完成。A/B/C 交付已作为四个 Lore 提交整合到本地 `main`，统一候选的整合修复已提交为 `5f8f526`。最终 `npm run ci:release` exit 0；当前仅缺 push 后的远端 Actions/Pages 证据，因 push 会触发生产部署，本任务未越权执行。

## Checklist

- [x] 定义六条独立规划轨道与所有权边界。
- [x] 为每条轨道指定只读规划、证据要求和统一 handoff 合同。
- [x] 请求创建六个隔离 Codex project tasks。
- [x] 记录六个正式 thread ID 和运行位置。
- [x] 确认六个 task 均处于 `active` 且已开始读取证据。
- [x] 监督 P0 数据可信度与时间语义计划。
- [x] 监督 CI 发布门禁与文档治理计划。
- [x] 监督 Known Route 与 Diary UI 收口计划。
- [x] 监督代码架构、状态与性能演进计划。
- [x] 监督新增产品能力与官方对标计划。
- [x] 监督 Local-first 与生产化边界计划。
- [x] 对六份计划执行去重、冲突与依赖复核。
- [x] 形成总体执行路线图和推荐首批实施切片。
- [x] 创建 execution A：Crime 数据可信度 + Evidence Bundle v1。
- [x] 创建 execution B：Known Route / Diary 体验 + local-first 收口。
- [x] 创建 execution C：状态架构 + CI/Pages 工程底座。
- [x] 确认三个 execution task 均已进入真实实现，不只是复述规划。
- [x] 监督 focused tests、共享非浏览器短测试 ownership 与三线交付包。
- [x] 对 ready-for-integration 交付执行跨 worktree 盘点、Lore 提交与 A → B → C 顺序整合。
- [x] 解决重叠文件语义、统一候选发布门与视觉稳定性问题。
- [x] 完成 npm ci、audit、coverage、full validate、bundle、browser smoke 与 visual gate。
- [x] 提交整合修复并同步中央任务记录。
- [ ] 获得外部生产授权后 push，并核验 GitHub Actions、Pages 与远端保护设置。

## Planning tasks

| Track | Status | Client thread ID | Formal thread ID |
| --- | --- | --- | --- |
| P0 数据可信度与时间语义 | Completed | `client-new-thread:66891e5f-a010-4a0a-9044-6c3fe18fdfae` | `019fe70e-97d2-7fd2-b971-ac61e3198cc3` (`worktrees/42ab`) |
| CI 发布门禁与文档治理 | Completed via local read-only recovery | `client-new-thread:9af4a1aa-869d-4603-99fd-df8e36e5b0e9` failed to register; local recovery used | `019fe97a-156e-77c0-b6e0-7cdde2e75410` (saved project, read-only) |
| Known Route 与 Diary UI 收口 | Completed | `client-new-thread:4dba1ee6-87e6-469a-9afc-ea905a4f4a07` | `019fe70e-c714-7680-aff7-0177c2edd384` (`worktrees/f90d`) |
| 代码架构、状态与性能演进 | Completed after recreation | `client-new-thread:2567b37a-2613-431e-8f6a-091dedc8d03f` | `019fe976-ff92-7413-ae10-4ae24ac0ec1a` (`worktrees/c20a`) |
| 新增产品能力与官方对标 | Completed | `client-new-thread:08dfe339-5f7e-449a-a0e2-9464f06428af` | `019fe70e-dc1e-78a2-a0ff-75f03c698f46` (`worktrees/4c4f`) |
| Local-first 与生产化边界 | Completed | `client-new-thread:d55f8665-9e9e-4b4b-b4d6-4b683ba8b20e` | `019fe70e-e749-7aa0-8e01-ae367f208719` (`worktrees/3595`) |

## Execution tasks

| Lane | Status | Formal thread ID | Ownership summary |
| --- | --- | --- | --- |
| A: Crime data trust + Evidence Bundle v1 | Integrated locally as `b5aac49` | `019fe99d-2029-7663-9255-3f834bc8cba6` (`worktrees/1b4f`) | fail-closed admission、immutable tract enrichment、真实 provenance 与固定 aggregate v1 schema 已进入本地 main |
| B: Known Route / Diary UX + local-first boundary | Integrated locally as `0e73b80` | `019fe99d-caa6-7180-bde1-8a48861b693d` (`worktrees/f614`) | responsive route surface、hidden drawing ownership、local-only Diary 与个人/示例语言已进入本地 main |
| C: State architecture + CI/Pages foundation | Integrated locally as `6899576` + `1cd340b` | `019fe99d-3fae-7610-92d1-c630fa28ed77` (`worktrees/d1e0`) | explicit ports、中性 palette、lint/coverage、same-SHA release workflow 与 concurrency contracts 已进入本地 main |

## Validation evidence

| Command or check | Result |
| --- | --- |
| Codex project discovery | `engagement project` project ID `e794a55b-89c3-4da7-b1eb-ec2a8dfa4c54`，Git repository |
| Six `create_thread` requests | 全部接受并返回独立 client thread ID；正式 thread ID 等待 setup |
| 2026-08-10 existing task restart | 4 个既有 `notLoaded` task 均接受启动消息并变为 `active` |
| 2026-08-10 failed setup recovery | 架构/性能成功重建为 worktree task；CI/发布 worktree 只生成 `d35d` 但未注册 task，改用 saved project 本地只读独立 task 恢复 |
| Scope conflict check | 六条主范围互斥；Known Route/provenance/state 交叉点明确交由主监督整合 |
| Three execution task creation | A/B/C 均获得正式 task ID、独立 detached worktree，且全部处于 active |
| First execution snapshot | A 已进入 task records/TDD/dependency install；B 已进入 baseline/RED contracts；C 已进入 baseline/task records |
| A implementation update | A1 malformed/count/dimension admission、district join、tract immutable、Philadelphia timezone、chart malformed-unavailable 五组 RED→GREEN |
| B implementation update | B3 正在用 RED contracts 锁定 local-only Diary、移除 live 501 endpoint、双语个人/示例语言与中性视觉 |
| C implementation update | C1 state/Diary port seam 与 C3 exact-artifact workflow 已完成首轮实现；architecture_ports 4/4、release_workflow_contracts 4/4 |
| C expected dependency blocker | package.json 已加入 ESLint 9.39.5、Stylelint 17.14.1 与 lint/coverage/ci scripts；lock 尚未同步，因此授权前的 npm ci 阻塞不是产品回归 |
| Live-test ownership handoff | A 的 npm ci exit 0、0 vulnerabilities 且 scoped process 已结束；dependency/install + 非浏览器质量槽已正式授予 C；B 继续等待；browser/visual/full validate 暂无 owner |
| C slot acceptance | C 已确认按 7 条授权命令串行执行、每条写入 `.tmp/execution-c/`；当前首条命令运行中，未扩大到浏览器、visual、完整 validate、bundle 或远端 Actions |
| C slot completion | package-lock-only 0；npm ci 0；audit 0 high；contracts 8/8；lint JS/CSS 双 0；coverage 58/58 非空，report-only，50.41% lines / 73.58% branches / 52.46% functions；无 scoped node/npm；slot released |
| C lint scope adjustment | 保留首次失败与最终成功日志；移除两条针对既有 concise Promise executor / layered duplicate selectors 的结构性高噪声规则，未修改 A/B 文件；integration review 必须复核此调整没有削弱必要 correctness gate |
| C integration review finding | 首次 `ready-for-integration` 未通过主监督复核：workflow 顶层与 deploy job 均为 `cancel-in-progress: true`，可取消正在运行的 main/Pages 发布，且 release contract 未锁定安全语义；已退回 C 做最小修复与 targeted/YAML/diff 重验 |
| C finding closure | 顶层改为仅 PR 可取消，deploy Pages concurrency 为布尔 `false`；release contract RED 4/5 → GREEN 5/5；主监督复读表达式、YAML 类型、文档、refs、diff 和 scoped process 后接受第二次 `ready-for-integration` |
| B slot grant | B 已获 12 步 dependency/install + 非浏览器 targeted-test 槽；日志 `.tmp/execution-b/`；A/C 禁止重复安装；browser/visual/full validate/build仍无 owner |
| A integration review finding | Evidence Bundle 把 export time 伪作 source `retrievedAt`；v1 denylist 可被未知键绕过；第 4 个动态按钮仍处于 three-column grid。已退回 A 做真实时间/null、固定 schema allowed-key、布局与回归测试修复；B 释放前 A 不运行 node/npm 验证 |
| B slot release / A grant | B 最终 scoped node/npm=0 并释放 dependency/non-browser 槽；A 获授权使用现有 node_modules 串行运行 Evidence Bundle 修复相关短测试，仍禁止 install/build/browser/visual/full validate |
| B/C cross-lane review finding | B 的 reader copy/CSS 已中性化，但真实地图仍由 C-owned 文件输出红黄绿安全分级；`diary-demo.html` 静态 title 仍旧。已分别退回 C 做 palette contract、B 做 title contract；A 释放前两者只编辑不测试 |
| B controller/truth review finding | `hideSurface()` 未停用 `active`，关闭 drawing surface 后仍可截获地图点击；`persisted:false` response 却声称 durable local save。已退回 B 修复 active lifecycle、诚实 message 与直接 contracts |
| A review closure | Evidence Bundle 使用匹配 comparison snapshot 的 `generatedAt` 作为可证明 retrieval evidence，无匹配快照则为 `null`；固定 v1 schema 拒绝未知键；第四按钮独占下一整行。修复后 targeted suites 全绿，A 正式释放槽并恢复 `ready-for-integration` |
| B review closure | route UI 11/11、Diary truth 4/4、data sources、product integrity、i18n、UI P0 六组共 217/217；`git diff --check` 0，基线三者一致，scoped node/npm 0。B 已释放槽，交给 C 最后验证 palette |
| C test discovery closure | C 作为 package owner 新增 `test:diary-truth` 并加入 aggregate；`test:diary-palette` 也在 aggregate。B 测试文件尚未在 C worktree，故 diary-truth 必须在整合候选中执行 |

## Open risks and remaining work

- 本地 `main` 已整合并验证，但尚未 push，因此不能声称 GitHub Actions 或 Pages 已运行，也不能声称生产已发布。
- `worktrees/d35d`、三个 execution worktree 和规划 worktree 均保留；本批次不做拓扑清理或删除证据。
- GitHub environment protection、required checks 与 Pages settings 仍需要远端权限核验。
- 用户既有 `.playwright-mcp/`、`logs/`、`output/` 等未跟踪内容未归属本批次，继续保留且不进入提交。

## Integrated validation evidence

| Gate | Final result |
| --- | --- |
| `npm ci` / production audit | exit 0；395 installed / 396 audited；0 vulnerabilities |
| `coverage:report` | 58/58；50.78% lines / 74.14% branches / 53.65% functions；report-only |
| `npm run ci:release` | `.tmp/integration-20260810/29-ci-release-admitted.status` = `EXIT_CODE=0` |
| JS/CSS lint | 0 errors / 0 warnings |
| Aggregate contracts | diary-truth、diary-palette、architecture ports、release workflow 等均通过标准 `npm test` 入口 |
| Bundle policy | dist 3,532,279 bytes；Entry、Crime、Evidence Bundle 与所有 lazy chunk 在预算内 |
| Browser smoke | PASS；consoleErrors=0；pageErrors=0；8 remote hosts deterministic mocked |
| Visual experience | 35 passed / 10 conditional skips / 0 failed；3 projects；单张 portrait baseline 经 expected/actual/diff 审查后更新并普通模式复验 |
| Final static ownership | `git diff --check` 0；package-lock 无差异；scoped node/npm 0；4173/4178 listener 0 |
