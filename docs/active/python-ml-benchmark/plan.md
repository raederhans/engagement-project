# Python ML Benchmark Plan

## Goal

在独立的 `ml/` 附属模块中完成 ML0–ML6：以 exact ArtifactRegistry admission 后的 aggregate-only M2 mart 为唯一数据入口，提供可复现的 scikit-learn 基准、PyTorch NB2 MLP、FeatureSchema/v2、统一时空评估与分层 CI。所有结果永久保持 `research_only=true`、`serving_authority=false`、`promotion_authority=false`。

## Scope

- 唯一产品代码写入面：`ml/**`。
- 唯一工程记录写入面：`docs/active/python-ml-benchmark/**`。
- 可选独立 CI 写入面：`.github/workflows/ml-ci.yml`。
- 从 `main@cfb0af1cf0e00a7a6c23e07cacc8d7cc50e3d6a7` 的干净隔离工作树执行；不读取或修改默认检出的未归属 WIP。
- 大型转换、checkpoint、模型与完整报告只写入 ignored、task-owned artifact root；Git 只提交合同、代码、小 fixture、manifest 与小报告。

## Sources of truth

- `docs/AGENTS.md`
- `docs/active/_worktree_registry.md`
- `scripts/lib/artifact_registry/**` 与 `scripts/data/artifact_registry.schema.json`
- `scripts/lib/area_intelligence_{mart,model,evaluation,evaluation_protocol}.mjs`
- `scripts/data/area_intelligence_evaluation_protocol.v2.json`
- 当前 exact M2 mart 的 `manifest.json` 与 registry admission；manifest 或路径本身不替代 registry admission。

## Stages

- [x] ML0：Python 3.12 工程、CPU/CUDA 互斥 accelerator extras 的单一 lock、MLResearchRun/v1 与权限边界。
- [x] ML1：ArtifactRegistry-bound JSONL→partitioned Parquet、MLDatasetManifest/v1、六特征 JS/Python parity、排序/切分/no-leakage。
- [x] ML2：seasonal naive、MA4、MA13、EWMA、PoissonRegressor、HistGradientBoostingRegressor(poisson)，全部对简单时间基线。
- [x] ML3：torch-negative-binomial-mlp-v1，stable NB2 NLL、CPU/GPU device、early stopping、gradient clipping、state_dict、training-only calibration 与数值/synthetic recovery 测试。
- [x] ML4：六特征 parity gate 后启用 FeatureSchema/v2；所有特征声明定义、availability、missing policy、cutoff、lineage，禁止 test fold 调参。
- [x] ML5：4 rolling folds × 2 unit types × 2 holdout slices 的 16 primary slices/model，统一指标、training/validation-only interval calibration 与审计 slices。
- [x] ML6：Windows/Ubuntu CPU PR CI；full benchmark 仅受控 dispatch/self-hosted Linux 执行，CPU/CUDA lock 可选，exact admission 失败则输出 unavailable receipt。

## Acceptance criteria

- 错误/恶意 identity、SHA/bytes/rows/order drift、future leakage、split drift 均 fail closed。
- MLResearchRun/v1 严格拒绝任何 serving/promotion authority 或非 research-only 值。
- JS/Python 六特征、基础预测、指标和 holdout assignment 在 fixture 上逐项一致。
- sklearn 点模型预测非负，并逐 slice 与 seasonal-naive-52w 比较。
- NB2 analytical mean/variance、手工 NLL 与 `torch.distributions.NegativeBinomial.log_prob` 一致；CPU smoke 与 synthetic recovery 通过。
- FeatureSchema/v2 只使用预测周之前的数据；正式全局 NB 候选不含 unit ID embedding。
- CI 不恢复 10.8 GB 仓库、不执行 full training；full workflow 不调用 production publisher。
- 完整数据不存在 exact ArtifactRegistry/v1 或资源不足时，明确记录 `unavailable`，不伪造 full run。

## Non-goals

- ML7、R7/M7、Adaptive Alternatives。
- FastAPI、在线服务、ONNX、MLflow、Kubernetes、production publisher、`public/**` 或 `src/**` 修改。
- LSTM、Transformer、GNN。
- 模型发布、科学 promotion、生产 serving、部署、push、main 整合或云资源变更。

## Risks and constraints

- 当前保留的 M2 mart 约 1,611,918 rows / 825 MB；若缺少覆盖 manifest 与全部 parts 的 exact ArtifactRegistry/v1，必须在读取任何 part 前停止。
- 浮点/训练结果只承诺同软件、同硬件、同 device 环境内的确定性努力；不保证跨 OS、CPU/GPU 或 PyTorch release 字节相同。
- PyTorch CPU wheel 必须显式来自官方 CPU index；GPU full run 只能由受控 self-hosted owner 选择 device。
- Protocol、M1 receipt、M2 manifest、part inventory、transformation 和 feature schema identities 必须全部进入 dataset/run lineage。
