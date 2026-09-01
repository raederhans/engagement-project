# ML M7 Governed Admission Task

## Current status

`complete / local-commits-only`：M7 governance、五份 schema、五 seed evidence、JS/Python parity 与 Node aggregate shadow bridge 已实现、复核并提交。full M2 exact registry 仍不可用；实际 admission 为 `no-promotion`，production forecast 与 shadow forecast 均 `unavailable`。

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

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git rev-parse HEAD` / `git rev-parse main` | both `dfb4bc8a8a02e211e4fb212db847487c9970318a` before branch creation |
| `git status --short --branch` | clean detached base before branch creation |
| `git worktree list --porcelain` | all retained worktrees identified; untouched |
| protocol/feature byte identities | v3 `13efc6...`, v2 `997aaf...`, FeatureSchema/v2 `1d502b...` |
| full M2 registry preflight | existing records show exact ArtifactRegistry/v1 unavailable; no full part read or training started |
| `uv lock --check` | exit 0；51 packages resolved，lock current |
| `uv run ruff check .` | exit 0；all checks passed |
| `uv run mypy src` | exit 0；16 source files clean |
| `uv run pytest -m "not full" -q` | exit 0；21 passed，含 synthetic five-seed、parity、protocol-drift 与 unavailable gates |
| `npm run test:ml-m7` | exit 0；2/2 passed，五 schema 编译、synthetic no-promotion、hostile lineage/authority/duplicate/fabricated-full 均符合预期 |
| focused ESLint | exit 0；M7 bridge/CLI/test 无 warning |
| `node --test scripts/tests/bundle_policy.mjs` | exit 0；1/1 passed，workflow action pins/counts 有效 |
| YAML parse | exit 0；`node-bridge-gate,cpu-gates,full-benchmark` 均存在 |
| LF-canonical identity check | identity-bound files are `eol=lf` in `.gitattributes`；normalized working bytes match staged Git bytes，Windows/Ubuntu checkout identity stable |
| Python/Node frozen-lineage comparison | exact match；feature `08cad8…be9b`、candidate/governance implementation `b7d68c…56e1`、environment lock `8661dd…96e5` |
| missing-registry Python preflight | expected exit 2；receipt `sha256:75c155e0f38f8e435b241c72b5d202b7a280734805a4b7ad9307ff9df14abad6`，`status=unavailable`、`decision=no-promotion`、registry null、production predictions 0 |
| Node projection of unavailable receipt | exit 0；artifact `sha256:6c79d97e7120f60caf85e7c2737976ed5ff8dd23de3c3ff7c54ba5994f6a6c26`，shadow unavailable/0 aggregates，production unavailable/0 predictions |
| `git diff --check` | exit 0；仅工作树换行转换 warning，无 whitespace error |
| bounded read-only reviewer recheck | PASS；protocol masquerade、v3 convergence/cap、fixture/full admission 三项 finding 均 CLOSED；LF identity 复核无自引用或跨平台问题，无新材料性问题 |
| implementation Lore commit | `8579abb1eb1c4232b67216aa3f79d0f7b5151f50`；27 files，3611 insertions / 51 deletions；完整 message/stat 已复核 |

## Integration handoff

1. 保留 coordination baseline `19118c6e6ce8d47c5d3645f5ff1ff18def5d0139`；它只新增 `docs/active/m7-product-closeout/**`，与本 lane 无路径冲突。
2. 串行应用 `8579abb1eb1c4232b67216aa3f79d0f7b5151f50`，再应用本记录的 closure commit。
3. 随后按 coordination plan 串行集成 public-product 与 private-validation lanes；`package.json`、workflow 或其他共享面由 combined owner 统一解冲突并在 exact combined tip 重跑 affected/combined gates。
4. push、remote CI、Pages、release、settings 与 worktree cleanup 均需独立授权；本 lane 未执行。

## Remaining risks

- full M2 run remains unavailable without an exact observed registry.
- v3 bounded search/selection 尚未执行；报告显式为 `fixed-reference-only`，这本身阻断 shadow admission。
- exact full ArtifactRegistry allowlist 当前为空；加入真实 identity 需要后续显式治理变更与独立 review。
- CUDA/full-data behavior 未测试，因为 exact full admission gate 在本 lane 不可用。
- 本地 `main` 在执行期间由其他 owner 前进；本 lane 保持 `dfb4bc8` 基线，不执行 merge/rebase/push。
