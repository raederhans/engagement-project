# Task

## Current status

`complete-local`：主线 M0-M6 与附属 ML0-ML6（明确不含 M7）已整合到本地 `main`，跨模块与全仓联合验证通过；远端保持未修改。

## Checklist

- [x] 核验 target/source HEAD、status、base 与 `origin/main`。
- [x] 计算两个交付包的 changed-path intersection（0）。
- [x] 整合主线 M0-M6 四个提交。
- [x] 整合附属 ML0-ML6 三个提交。
- [x] 将 MA4 限定为 diagnostic-only，保持 Protocol v3 正式候选资格不变。
- [x] 运行联合验证并保存 owner、日志、退出码。
- [x] 更新 registry、提交整合记录并报告远端未执行项。

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

## Open risks and remaining work

- Full M2 benchmark 仍缺 exact ArtifactRegistry admission，保持 unavailable；未读取 full mart part 或运行 full training。
- 远端 CI、Pages、deployment、ruleset/release 与 object storage 未执行。
- Full M2 benchmark 仍缺 exact registry admission，不可用相邻 fixture gate 替代。
- 未授权 push、deploy、ruleset/permission、release、云凭据或删除类操作。
