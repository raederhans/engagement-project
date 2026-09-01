# Task

## Current status

`handoff-ready`：实现、focused gates、二轮复审和两个产品提交均已完成。真实 OSRM/graph、独立
OS outbound-deny observation 与人工双人 QA 仍 unavailable，因此 formal benchmark、threshold 和 QA
promotion 的 `available` admission 继续机械关闭。

## Checklist

- [x] 核验 `HEAD/main/merge-base=dfb4bc8…` 与初始 clean status。
- [x] 读取 `docs/AGENTS.md`、M5/M6 gate 和相关 memory evidence。
- [x] 创建 `codex/mainline-m7-private-validation` 与唯一 active task record。
- [x] 映射并复用 OSRM/route graph/candidate/evidence/privacy/authority contracts。
- [x] 冻结 local companion、privacy observation、validation receipt 与 threshold schemas。
- [x] 建立 40 个公开 Philadelphia OD pairs 与 identity-bound 100-segment QA sampling/adjudication contract。
- [x] 实现 Windows PowerShell/CLI、loopback-only service 与可靠 process lifecycle。
- [x] 实现 in-process local OSRM seam、bounded candidate、independent enrichment 与 Known Route fallback。
- [x] 运行 no-runtime baseline preflight，生成 `unavailable` receipt；真实 baseline 不存在，因此正式门槛不冻结。
- [x] 运行 unit/privacy/loopback/process-lifecycle/benchmark-validator focused checks。
- [x] 检查 diff/status、完成二轮只读 review、建立结构化 commits 并准备 handoff。

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git status --short --branch`（分支创建前） | clean detached HEAD |
| `git rev-parse HEAD; git rev-parse main` | both `dfb4bc8a8a02e211e4fb212db847487c9970318a` |
| `git switch -c codex/mainline-m7-private-validation` | PASS；branch 创建于 exact base |
| `git merge-base HEAD main` | `dfb4bc8a8a02e211e4fb212db847487c9970318a` |
| `npm run test:mainline-m7` | PASS；47/47 tests，pack validator valid |
| `node --test scripts/tests/route_generation_candidate_search.mjs scripts/tests/mainline_m5_m6_known_route_gate.mjs` | PASS；28/28 tests |
| scoped `eslint` | PASS；local companion、validation runner 与五个 M7 focused test files，0 warnings |
| PowerShell parser | PASS；`start-local-route-companion.ps1` |
| Ajv 2020-12 fixture validation | PASS；7/7 static artifact definitions compile and admit matching tracked fixtures |
| final read-only diff review | PASS；benchmark、threshold、coverage 与 QA provenance findings 均闭合 |
| baseline receipt | `unavailable`；`sha256:d037ae09d83a89ac223c90cb6f19b0f4bbdff4496698fd3ad2feb09109494d49` |
| threshold artifact | `unavailable`, `frozen=false`；`sha256:93541c98cecd5ab9edd8755612d84326b41afe5ef1f798d0aee157c938282d2e` |
| QA sample/receipt | universe/sample unavailable；双人完成 false；未伪造 counts |
| runtime commit | `67eceed1c2387e60cb0dd52abd364b5f6ca037f7` |
| validation commit | `5e546a46f618e8366cc2ea1d1ff241ed633a4e67` |

## Open risks and remaining work

- 当前尚未证明本机存在可用 OSRM engine 或 exact Philadelphia graph；在实际观察前不得声称可用或测得性能。
- Node attempt observer 不是 OS 级零外传证明；没有独立 outbound-deny observation 时正式 receipt 强制 unavailable。
- 仓库尚无 verifier-bound OS observation artifact contract；因此自报 observer SHA 不能启用 benchmark，且
  threshold/QA 也必须绑定成功 admission 的 benchmark provenance。当前 formal `available` 路径有意不可达。
- 100-segment pack 尚无两名独立人工 reviewer；只能交付样本与 adjudication 机制，完成状态保持 unavailable。
- AbortSignal 能可靠结束 HTTP/runner 等待，但不能强制终止不协作的 native OSRM work；正式运行仍需隔离 worker/process supervisor。
- caller-selected in-process adapter 具有当前 Node process 的完整权限，仍可自行记录、存储或联网；它只属于
  明示的 caller-trusted/unverified seam，不能单独支撑 formal receipt。
- 未运行任何长 benchmark、full validate、远端 CI、浏览器矩阵、push 或 deployment。
