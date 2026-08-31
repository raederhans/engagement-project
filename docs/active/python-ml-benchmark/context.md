# Python ML Benchmark Context

## Current truth

- 隔离工作树起始基线为干净 detached `cfb0af1cf0e00a7a6c23e07cacc8d7cc50e3d6a7`，现有任务分支为 `codex/python-ml-benchmark`。
- 默认检出 `C:/Users/raede/Desktop/dev/engagement_project` 和其他 worktree 属于受保护 WIP/证据面；本任务不修改、不清理。
- 持久 M2 root `C:/Users/raede/Desktop/dev/engagement_project-data-foundation/.dfev1/area-intelligence/m2-v2-persistent-20260829` 当前可读，manifest 声明 128 parts、1,611,918 rows、825,033,042 part bytes；只读扫描未发现覆盖该 mart 的 `ArtifactRegistry/v1` 文件。
- 因 registry admission 是模型读取的前置条件，当前 full-data benchmark 状态为 `unavailable`，除非后续发现或由有权 owner 提供 exact registry；manifest 自证不等同于 registry admission。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-31 | 核验 exact base 为 `cfb0af1...`，工作树干净。 | 从该 SHA 建立隔离分支，不吸收其他 WIP。 |
| 2026-08-31 | 采用 Python `>=3.12,<3.13` 与 `uv.lock`。 | Windows/Ubuntu CI 固定 Python 3.12；依赖由 lock 冻结。 |
| 2026-08-31 | 按 uv 官方 PyTorch 指南将 `cpu` / `cu130` 声明为互斥 extras，并分别绑定官方 PyTorch index。 | 普通 CI 显式选择 CPU；受控 Linux full workflow 可显式选择 CPU 或 CUDA 13.0，二者由同一 lock 冻结。 |
| 2026-08-31 | 现有 M2 persistent root 未发现 ArtifactRegistry/v1。 | fixture gate 可执行；full run 必须 fail closed 为 unavailable，不直接读 part。 |
| 2026-08-31 | 跨平台浮点/训练只记录边界，不声称字节等同。 | run receipt 记录 environment/hardware/device/seed 与 determinism flags。 |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Python dependency lock/sync | 本任务唯一 owner | `ml/.artifacts/local-validation/dependency-sync.log` | complete; `uv lock --check` and CPU sync passed |
| Ruff/mypy/pytest focused gate | 本任务唯一 owner | `ml/.artifacts/local-validation/focused-gates.log` | complete; Ruff + mypy + 17 non-full tests passed; no ports/databases remain |
| Full M2 conversion/training | 无 | n/a | unavailable pending exact ArtifactRegistry/v1 |

## Handoff

- 总协调对话保留 main 整合、push、部署与清理 authority。
- 如需让现有 full M2 数据可被 Python 消费，主线/数据 owner 必须提供覆盖 `manifest.json` 与全部 128 mart parts 的 exact `ArtifactRegistry/v1`，并保证 locations/basePath 可在执行机安全解析；本任务不会修改主线 registry producer。
- Python 不写 `public/data/area_intelligence_baseline.v2.json`，不调用 `publish_area_intelligence_evaluation.mjs`。

## Research references

- PyPA `pyproject.toml` / lock specifications: <https://packaging.python.org/en/latest/guides/writing-pyproject-toml/> and <https://packaging.python.org/en/latest/specifications/pylock-toml/>.
- uv PyTorch accelerator extras and explicit indexes: <https://docs.astral.sh/uv/guides/integration/pytorch/>.
- scikit-learn Poisson models: <https://scikit-learn.org/1.9/modules/generated/sklearn.linear_model.PoissonRegressor.html> and <https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.HistGradientBoostingRegressor.html>.
- PyTorch NB distribution and deterministic-algorithm limitations: <https://docs.pytorch.org/docs/stable/distributions.html> and <https://docs.pytorch.org/docs/main/generated/torch.use_deterministic_algorithms.html>.
- PyArrow deterministic write controls: <https://arrow.apache.org/docs/python/generated/pyarrow.parquet.write_table.html>.

## Next step

交还总协调对话；full benchmark 继续等待 exact ArtifactRegistry/v1。未授权 push、merge、deploy 或 worktree cleanup。
