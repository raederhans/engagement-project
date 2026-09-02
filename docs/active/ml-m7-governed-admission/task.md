# ML M7 Governed Admission Task

## Current status

`complete / local-commits-only`：M7 已实现、提交，并关闭后续独立 review 的 Python forged-admission 与任意 full-output 写入 blocker。full M2 exact registry 仍不可用；实际 admission 为 `no-promotion`，production forecast 与 shadow forecast 均 `unavailable`。

## Checklist

- [x] 核验 `main@dfb4bc8`、HEAD/status/worktree 与 `docs/AGENTS.md`。
- [x] 读取 python benchmark 与 mainline integration 记录。
- [x] 盘点 ML0-ML6、ArtifactRegistry、production serving 与 publisher 边界。
- [x] 建立 `codex/ml-m7-governed-admission` 与本任务三份记录。
- [x] 冻结 M7 governance identities 与候选角色。
- [x] 新增五类 schema/validator/builder。
- [x] 新增 static JS/Python parity fixture 与 hostile cases。
- [x] 新增五 seed torch stability 与 runtime-memory evidence。
- [x] 新增 Node aggregate shadow bridge 与 tests。
- [x] 更新 ML workflow 的 focused/full governed gates。
- [x] 运行最窄充分验证并记录命令/exit。
- [x] 审查 diff/status，创建 Lore commit(s)，更新 handoff。
- [x] 修复 Python exact allowlist/完整 evidence chain、fresh ignored output root 与 workflow dispatch/upload 边界； hostile regression 与独立复核通过。

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git rev-parse HEAD` / `git rev-parse main` | both `dfb4bc8a8a02e211e4fb212db847487c9970318a` before branch creation |
| `git status --short --branch` | clean detached base before branch creation |
| `git worktree list --porcelain` | all retained worktrees identified; untouched |
| protocol/feature byte identities | v3 `13efc6...`, v2 `997aaf...`, FeatureSchema/v2 `08cad8...` |
| full M2 registry preflight | existing records show exact ArtifactRegistry/v1 unavailable; no full part read or training started |
| `uv lock --check` | exit 0；51 packages resolved，lock current |
| `uv run ruff check .` | exit 0；all checks passed |
| `uv run mypy src` | exit 0；17 source files clean |
| `uv run pytest -m "not full" -q` | exit 0；23 passed / 1 skipped；skip 仅为本机 WinError 1314 无 live symlink 创建权限，synthetic reparse attribute gate 已通过 |
| `npm run test:ml-m7` | exit 0；2/2 passed，五 schema 编译、synthetic no-promotion、hostile lineage/authority/duplicate/fabricated-full 均符合预期 |
| focused ESLint | exit 0；M7 bridge/CLI/test 无 warning |
| `node --test scripts/tests/bundle_policy.mjs` | exit 0；1/1 passed，workflow action pins/counts 有效 |
| YAML parse | exit 0；`node-bridge-gate,cpu-gates,full-benchmark` 均存在 |
| LF-canonical identity check | identity-bound files are `eol=lf` in `.gitattributes`；normalized working bytes match staged Git bytes，Windows/Ubuntu checkout identity stable |
| Python/Node frozen-lineage comparison | 14 identities exact match；feature `08cad8…be9b`、candidate/governance implementation `8282b0…7f6fc`、environment lock `8661dd…96e5` |
| missing-registry Python preflight | expected exit 2；fresh guarded root `ml/.artifacts/m7-review-fix-final-20260901125858/`；receipt `sha256:a19242b5db1dd22b52d123008967a51444919bb3fb235758c70f7c7b1b1d8d22`，`decision=no-promotion`、registry null、production predictions 0 |
| Node projection of unavailable receipt | exit 0；artifact `sha256:727bcf330d58b7a39f9e6a29924f3b7980c2c4efc92c5256f6fcf2f1f3113a94`，shadow unavailable/0 aggregates，production unavailable/0 predictions |
| `git diff --check` | exit 0；仅工作树换行转换 warning，无 whitespace error |
| bounded read-only reviewer recheck | PASS；protocol masquerade、v3 convergence/cap、fixture/full admission 三项 finding 均 CLOSED；LF identity 复核无自引用或跨平台问题，无新材料性问题 |
| implementation Lore commit | `8579abb1eb1c4232b67216aa3f79d0f7b5151f50`；27 files，3611 insertions / 51 deletions；完整 message/stat 已复核 |
| review-remediation reviewers | PASS；exact allowlist、frozen lineage、benchmark/calibration/model-card 重算与 cross-binding，以及 path/workflow authority 均无材料性 finding |
| review-remediation Lore commit | `471e3c03377ba0c62d3e121c8477dad7223ef79b`；9 files，622 insertions / 114 deletions；完整 message/stat 已复核 |

## Integration handoff

1. 保留 coordination baseline `19118c6e6ce8d47c5d3645f5ff1ff18def5d0139`；它只新增 `docs/active/m7-product-closeout/**`，与本 lane 无路径冲突。
2. 按拓扑顺序串行应用 `8579abb1eb1c4232b67216aa3f79d0f7b5151f50`、`9bf297f214e8ae4d413fa581765161fa46e89f92`、`471e3c03377ba0c62d3e121c8477dad7223ef79b` 与本次最终 handoff commit。
3. 随后按 coordination plan 串行集成 public-product 与 private-validation lanes；`.github/workflows/ml-ci.yml`、`package.json` 或其他共享面由 combined owner 统一解冲突并在 exact combined tip 重跑 affected/combined gates。
4. push、remote CI、Pages、release、settings 与 worktree cleanup 均需独立授权；本 lane 未执行。

## Remaining risks

- full M2 run remains unavailable without an exact observed registry.
- v3 bounded search/selection 尚未执行；报告显式为 `fixed-reference-only`，这本身阻断 shadow admission。
- exact full ArtifactRegistry allowlist 当前为空；加入真实 identity 需要后续显式治理变更与独立 review。
- CUDA/full-data behavior 未测试，因为 exact full admission gate 在本 lane 不可用。
- live Windows symlink case 因本机权限被 skip；Windows reparse attribute 的 deterministic regression 已通过。portable Python 仍有准入后同权限 hostile-writer TOCTOU，未宣称 handle-level no-follow 防护。
- 本地 `main` 在执行期间由其他 owner 前进；本 lane 保持 `dfb4bc8` 基线，不执行 merge/rebase/push。
