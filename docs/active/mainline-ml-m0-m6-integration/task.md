# Task

## Current status

`complete-local-preflight`：主线 M0-M6 与附属 ML0-ML6 的本地整合、release gate、report-only coverage 和远端只读核查均已完成；M7、push、部署与 GitHub 治理写入继续排除。

## Checklist

- [x] 核验 target/source HEAD、status、base 与 `origin/main`。
- [x] 计算两个交付包的 changed-path intersection（0）。
- [x] 整合主线 M0-M6 四个提交。
- [x] 整合附属 ML0-ML6 三个提交。
- [x] 将 MA4 限定为 diagnostic-only，保持 Protocol v3 正式候选资格不变。
- [x] 运行联合验证并保存 owner、日志、退出码。
- [x] 更新 registry、提交整合记录并报告远端未执行项。
- [x] 运行本地 `ci:release` 与 report-only coverage，并记录远端治理只读事实。

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git fetch origin` + `rev-list --left-right --count HEAD...origin/main` | `0 0` |
| source status | 两个 source worktree 均 clean |
| changed-path intersection | `0`（mainline 34，ML 33） |
| serial cherry-pick | 主线 4 commits 与 ML 3 commits 无冲突整合；本地 `main` 相对远端 ahead 8 |
| `npm run test:mainline-m0-m6` | 首次发现 fresh Windows CRLF 漂移；精确 LF 属性修复后 17/17 PASS |
| MA4/v3 semantic check | v3 冻结候选不含 `moving-average-4w`；README 与聚焦测试显式断言其仅为 v2 diagnostic/reference baseline |
| ML `uv lock --check` | PASS；fresh integration checkout lock 可解析 |
| ML `ruff check .` | PASS |
| ML `mypy` | PASS；13 source files |
| ML `pytest -m "not full" -q` | PASS；17/17 |
| `npm ci` | PASS；按 lock 安装 395 packages，audit 0 vulnerabilities |
| `npm run verify:bundle`（供应链修复后） | PASS；ML workflow actions 全部固定为批准的 40-hex SHA |
| final `npm run validate` | PASS / exit 0；全仓测试、生产 build、bundle policy 全通过 |
| final remote drift check | `git fetch origin` 后 local code tip `5c2c25c...`、`origin/main@cfb0af1...`、ahead/behind `9/0` |
| post-integration supervisor audit | `git cherry` 显示主线 4 commits 与 ML 3 commits 全部 patch-equivalent；tracked R7 为 `NO-GO/UNAVAILABLE` 且 `generated=false`；ML status 为 research-only/no-authority；v3 明确排除 MA4；workflow action refs 与 bundle allowlist 一致 |
| first `npm run ci:release` | audit、lint、core 与 5 组 browser gates PASS；visual 33 passed / 10 skipped / 2 failed，仅为两张 Win32 基线失配 |
| visual root-cause audit | Crime desktop 测试已在 `6c08005` 改为 District 06，但旧基线仍是地址 buffer；Diary landscape 旧基线仍是 M0 前 `PHL Explorer`。无路由、评分或响应式行为回归证据 |
| targeted visual verification | Crime desktop 1/1 PASS；Diary landscape 1/1 PASS；只更新两张精确基线，未放宽 `0.005` 差异预算 |
| final `npm run ci:release` | PASS / exit 0；audit 0 vulnerabilities，lint/core/browser gates 全绿，visual 35 passed / 10 expected skipped |
| `npm run coverage:report` | PASS / exit 0；76/76 tests；lines 56.47%，branches 71.33%，functions 59.95%（report-only，无强制阈值） |
| GitHub read-only preflight | main 未 protected；rulesets `[]`；Actions 允许 all 且未强制 SHA pin；Pages 使用 workflow；最后成功 main run 为 `33291985358@cfb0af1` |
| final port audit | 4173/4178/4189/4194/4198 无残留 listener |

## Open risks and remaining work

- Full M2 benchmark 仍缺 exact ArtifactRegistry admission，保持 unavailable；未读取 full mart part 或运行 full training。
- 本地提交尚未 push，因此远端 CI/Pages 仍只反映 `origin/main@cfb0af1...`；deployment、ruleset、release 与 object storage 未执行。
- Full M2 benchmark 仍缺 exact registry admission，不可用相邻 fixture gate 替代。
- 未授权 push、deploy、ruleset/permission、release、云凭据或删除类操作。
