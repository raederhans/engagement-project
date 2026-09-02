# Python ML Benchmark Task

## Current status

ML0–ML6 implementation, focused local validation, and isolated branch commits complete。full-data preflight 为 `unavailable`（缺 exact ArtifactRegistry/v1）；未读取 full mart part，也未执行 full training。

## Checklist

- [x] 核验 exact base、工作树所有权、`docs/AGENTS.md` 与 registry。
- [x] 读取 ArtifactRegistry、M1/M2 mart、协议、六特征、模型和评估合同。
- [x] 检查持久 M2 root 是否已有 exact ArtifactRegistry/v1；当前未发现。
- [x] ML0 Python 工程、CPU/CUDA mutually-exclusive lock、MLResearchRun/v1。
- [x] ML1 registry admission、bridge、MLDatasetManifest/v1、parity/no-leakage。
- [x] ML2 sklearn baselines 与 count regressors。
- [x] ML3 PyTorch NB2 MLP 与数值/训练测试。
- [x] ML4 FeatureSchema/v2 与 feature gate。
- [x] ML5 统一 16-slice evaluator、metrics/calibration/audit slices。
- [x] ML6 PR CI、controlled CPU/CUDA full workflow、unavailable receipt。
- [x] 目标 lock/lint/typecheck/pytest/synthetic training/JS parity 通过。
- [x] 审查相对 base diff 并创建结构化 commits；不 push/merge/deploy。

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git status --short --branch` / `git rev-parse HEAD` | clean detached base `cfb0af1...` before branch creation |
| `git worktree list --porcelain` | default checkout and all retained evidence worktrees identified; untouched |
| read-only persistent M2 inventory | manifest present; 1,611,918 rows / 825,033,042 part bytes; no ArtifactRegistry/v1 found |
| `uv lock --check` | passed; one lock resolves mutually exclusive `cpu` and `cu130` extras |
| `uv export --locked --extra cpu/cu130` | CPU selects `torch==2.13.0+cpu`; CUDA selects `torch==2.13.0+cu130` on Linux |
| `uv run --locked --extra cpu ruff check .` | passed |
| `uv run --locked --extra cpu mypy` | passed; 13 source files |
| `uv run --locked --extra cpu pytest -m "not full" -q` | passed; 17 tests in 9.46s |
| isolated PyYAML parse of `.github/workflows/ml-ci.yml` | passed; `cpu-gates` and `full-benchmark` jobs found |

## Local commits

- `80e2bf7` — research-only contracts, aggregate bridge, features, models, evaluator, tests, and lock.
- `84a0b46` — isolated Windows/Ubuntu CPU CI and controlled CPU/CUDA full workflow.

## Open risks and remaining work

- Full M2 benchmark cannot run without exact ArtifactRegistry/v1 even though mart files are locally readable.
- CUDA lock resolution was checked, but no GPU hardware run was performed.
- Cross-platform and CPU/GPU numerical identity will remain explicitly unguaranteed.
