# ML M7 Governed Admission Plan

## Goal

在 `main@dfb4bc8a8a02e211e4fb212db847487c9970318a` 的隔离分支上完成 ML M7：冻结模型评估与准入身份，以严格 JSON 合同产出 benchmark、calibration、admission、model card，并由 Node 在重新核验 exact lineage、privacy 与 authority 后投影 aggregate-only shadow artifact。决策只允许 `no-promotion` 或 `shadow-admitted`；production forecast 永远 `unavailable`。

## Scope and ownership

- 主要写入面：`ml/**`。
- 允许的窄共享写入面：M7 专属 schema/Node bridge/test/workflow，以及本目录三份记录。
- 本 lane 是 `codex/ml-m7-governed-admission` 的唯一 integration owner，可创建职责清晰的本地提交。
- 不修改路线/UI、全局 README、`docs/active/_worktree_registry.md` 或既有 M0-M6 记录。
- 不 merge 到 `main`、push、deploy、修改远端设置或清理任何 worktree。

## Frozen sources of truth

- `docs/AGENTS.md`
- `docs/active/python-ml-benchmark/**`
- `docs/active/mainline-ml-m0-m6-integration/**`
- `scripts/data/area_intelligence_evaluation_protocol.v2.json`
- `scripts/data/area_intelligence_evaluation_protocol.v3.json`
- `ml/contracts/feature_schema.v2.json`
- `scripts/lib/artifact_registry/**` 与 `ml/src/engagement_ml/{registry,bridge}.py`

## Stages

- [x] M7-0：核验 exact base、工作树、适用指令、ML0-ML6 与 ArtifactRegistry/Node 边界。
- [x] M7-1：冻结 M1/M2/registry/protocol/feature/split/candidate/search-space/seed/preprocessing/early-stop/calibration/gate/runtime-memory identity。
- [x] M7-2：增加独立 JS/Python parity fixture，覆盖 features、baselines、split、metrics 与 JS Poisson/NB reference vectors。
- [x] M7-3：增加固定至少五 seed 的 PyTorch stability evidence，报告 median、worst、std、failed、instability、epoch、environment 与 runtime-memory。
- [x] M7-4：实现并验证 `ModelBenchmarkReport/v1`、`CalibrationReport/v1`、`ModelAdmissionReceipt/v1`、`ModelCard/v1`。
- [x] M7-5：实现 Node-only `ShadowForecastArtifact/v1` 投影；只消费严格 JSON aggregate receipts，不消费 checkpoint。
- [x] M7-6：运行最窄充分的 lock/lint/type/pytest/synthetic/parity/Node bridge gate；仅在 exact registry admission 存在时运行 full data。
- [x] M7-7：更新记录、审查相对 exact base diff、创建 Lore 提交并形成 integration handoff。
- [x] M7-8：关闭独立 review 的 forged Python admission 与任意 full-output 写入 blocker，补 hostile regression、受控 workflow root，并重跑 affected gates。

## Acceptance criteria

- 所有 M7 artifact strict exact-key、content-identity-bound、aggregate-only、authority false；未知字段或 identity drift fail closed。
- 冻结正式 gate candidates 为 seasonal naive、MA13、EWMA、sklearn Poisson、sklearn HistGradientBoosting Poisson、PyTorch NB2；JS Poisson/NB 保留为明确 reference catalog，JS NB 可保持 v3 optional，JS Poisson 不静默获得 v3 gate eligibility；MA4 仅 diagnostic。
- PyTorch 使用至少五个固定 seed；stability 输出包含每 seed 状态与 median/worst/std/failed/instability/epoch/environment/runtime-memory。
- admission decision enum 仅 `no-promotion|shadow-admitted`；fixture/synthetic 永远 `no-promotion`，full exact-lineage gate 未满足也永远 `no-promotion`。
- Python `shadow-admitted` 必须读取 frozen exact-registry allowlist，并重新验证 benchmark primary evidence、calibration 重算、model-card selected candidate 与完整 lineage；缺任一 evidence 都 fail closed。
- Node 只在 exact lineage、privacy、authority、calibration/model-card/report cross-binding 全部通过后写 task-owned shadow artifact；production forecast 固定 `unavailable` 且 predictions 为空。
- Python `full-benchmark` 只允许新建 `repo/ml/.artifacts/<run-id>`；路径准入失败零写入，workflow 自行派生该 root，不接受 caller-controlled output/upload path。
- M7 ingress 不使用 pickle/joblib/`torch.load`，不消费 `.pt` checkpoint；Python 不调用或覆盖 production publisher/serving JSON。
- 缺 exact `ArtifactRegistry/v1` 时，在读取 full mart part 前 fail closed；synthetic/fixture 证据明确标为非 full evaluation。

## Non-goals

- production serving、publisher、`public/**`、`src/**` UI/路线改动。
- 模型科学 promotion、production forecast、online inference、pickle/joblib checkpoint loading。
- main 整合、push、deploy、GitHub 设置、云资源或外部数据写入。

## Risks and controls

- v3 只列 optional JS NB，而任务要求 JS Poisson/NB references：通过 role/eligibility 显式区分，不改冻结 v3。
- v2 历史协议仍含 MA4 与 JS Poisson/NB：保留历史/诊断语义，但 M7 gate candidate set 不扩大。
- full M2 当前缺 exact registry：只执行 fixture/synthetic 和 unavailable preflight，不启动长 full-data owner。
- checkpoint 由 PyTorch 内部写出但不进入 M7 admission/bridge allowlist，M7 不提供反序列化路径。
- 当前 `admission_registry.exact_full_artifact_registry_identities=[]`；因此即使构造自洽的 full fixture，Python 也只能 `no-promotion`，Node 会拒绝 `shadow-admitted`。未来加入真实 identity 必须是显式治理变更。
- portable Python path API 无法完全消除准入后同权限 hostile writer 替换目录的 TOCTOU；以 fresh exclusive root、link/reparse 检查与受控 self-hosted runner 收敛，不宣称 handle-level no-follow 保证。
