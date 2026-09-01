# Philadelphia Urban Evidence Lab（费城城市证据实验室）

中文 | [English](README.md)

[![CI](https://github.com/raederhans/engagement-project/actions/workflows/ci.yml/badge.svg)](https://github.com/raederhans/engagement-project/actions/workflows/ci.yml)
[![在线演示](https://img.shields.io/badge/在线演示-GitHub_Pages-0969da)](https://raederhans.github.io/engagement-project/)
[![Node.js 22](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)](package.json)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

这是一个证据优先、支持中英文的费城城市数据实验室。仓库把可复现数据工程、聚合空间分析、
模型准入和隐私受限的产品表面连接起来，但不会把初步公共记录包装成完整伤害、个人风险或安全结论。

当前已验证的数据基础 receipt 覆盖 **3,586,620 条 canonical reported-incident records**；其保留的
content-addressed 本地证据 bundle 约 **10.81 GB**。这两个数字只描述一个精确的本地候选 receipt，
不代表在线仓库、完整犯罪事实、模型晋级或 routing authority。

## 30 秒了解项目

- **[打开在线证据演示](https://raederhans.github.io/engagement-project/)**：双语历史 reported-incident
  探索，以及当前已部署的三个受边界约束产品表面。下述本地 M7 候选只有在 exact SHA 通过远端 CI
  与 Pages 验证后，才能视为已部署。
- **Area Intelligence**：展示已准入的历史聚合；冻结评估门未通过，因此 forecast 保持
  `not-promoted / unavailable`。
- **Home Compare**：聚合、隐私安全的多源比较；各数据源独立保留
  `available / partial / unavailable`，私人地址仅作会话内定位。
- **Known Route**：只分析用户提供的已知路线；reported incidents、raw crash、accessibility、
  legality、calibration 始终分开，不产生 combined safety score。
- **Public Route Scenarios（M7 本地候选）**：只展示 allowlist 内预计算的公共地标步行场景、
  距离/时间 trade-off 与不确定性；不接收私人端点、不调用运行时 router，也不选择 safest route。
- **Local Private Route companion（M7 开发者模式）**：可选 loopback/in-process 边界能在不把坐标写入
  URL、日志或 tracked artifact 的前提下生成候选；没有已准入本地 engine/evidence pack 时保持
  `unavailable`，并回退到 Known Route。
- **Diary / Sample Community**：仅浏览器本地的 demo，不是证据准入路线、社区后端或实时路况来源。

可维护的系统架构图、数据流图和模型晋级图见 [Portfolio v2](docs/PORTFOLIO_V2.md)；远端仓库设置
审计和待授权命令见 [远端治理 mutation plan](docs/REMOTE_GOVERNANCE_MUTATION_PLAN.md)。

## 证据数据流

```text
官方公共源快照
  -> revision-aware canonical warehouse
  -> ArtifactRegistry/v1 + content-hash inventory
  -> clean-room restore 与 exact receipt 校验
  -> tract / 500 m grid / 已准入 uncertainty comparison
  -> 冻结 evaluation protocol 与 no-promotion gate
  -> aggregate-only Area Intelligence、Home Compare、Known Route
```

项目明确对照 census tract 和 500 m fixed grid：tract 用于解释与 ACS denominator audit；只要
generalized-location sensitivity 未证明稳定，fixed grid 就继续作为预测主几何。weighted attribution
不会写回 canonical event。

## 模型准入，不是模型营销

候选模型只有在 final test-fold 结果之前冻结进 protocol 后才能参赛。参赛资格不等于晋级；必须同时
通过所有时间、空间、区间、收敛和 slice gate。任一失败都产出诚实的 no-promotion 结果。

M7 新增严格的 benchmark、calibration、model card、admission receipt 与 aggregate shadow artifact
合同。当前 exact-registry allowlist 为空，因此有证据支持的结果仍是 `no-promotion`；shadow 与
production forecast 都保持 `unavailable`。Forecast artifact 与路线排序隔离，不能授予 routing authority。

- 当前协议：[Evaluation Protocol v2](scripts/data/area_intelligence_evaluation_protocol.v2.json)
- 主线扩展：Evaluation Protocol v3 冻结更多 baseline、sklearn 和 PyTorch 候选 identity，同时保持
  no-promotion 边界。
- 模型证据：[Area Intelligence model card](reports/area-intelligence/model-card.md)
- Lineage：[数据 lineage 摘要](reports/area-intelligence/data-lineage-summary.v1.json)

## 可复现验证

安装锁定依赖并运行核心门：

```bash
npm ci
npm run validate
```

轻量 fixture gate 与授权 full-data rebuild/restore 分开：

```bash
npm run test:mainline-m0-m6
npm run test:ml-m7
npm run test:mainline-m7
```

完整的物化、镜像、恢复、第二环境、定时观察与灾备演练命令见
[Data Foundation operations runbook](docs/DATA_FOUNDATION_OPERATIONS_RUNBOOK.md)。

canonical warehouse 绝不使用短期 Actions artifact 冒充。`ArtifactRegistry/v1` 绑定 source scope、
四类 clocks、producer/schema/transform version、每个对象的 hash/bytes、partition、retention，以及全为
false 的 serving/promotion/deletion authority。clean-room 流程只从 exact `file` 或 immutable `https`
位置恢复，并在下游使用前重新观测完整 inventory。

CI 在 Windows 执行 core gate、在 Linux 执行 release gate，并把同一 main exact SHA 部署到 GitHub
Pages。本地测试绿色不等于 CI、部署、发布或生产 serving 已完成。

## 仓库结构

```text
src/                 产品表面与严格浏览器投影
scripts/lib/         数据、证据、restore、evaluation 与 gate contracts
scripts/data/        版本化 schema 和冻结 protocol
scripts/tests/       轻量 contract/hostile-input fixtures
public/data/         仅存小型、已准入 serving artifacts
reports/             小型 aggregate reports 与 model/lineage evidence
docs/                架构、runbook、active records 与治理计划
.github/workflows/   Windows/Linux CI、exact-SHA Pages 与 maintenance workflow
```

## 数据和结论边界

- “Reported incidents”指报给 Philadelphia Police Department 的来源记录，不是完整犯罪或伤害事实。
- Generalized location 与 uncertainty method 是分析假设，不是对精确地点的重建。
- `unavailable`、`partial`、`ambiguous`、`unmapped` 绝不填成零。
- 私人地址、路线 geometry、Diary 文本和精确地点不进入 tracked artifact、URL、telemetry 或 share state。
- 项目不提供 safest route、safest area、combined safety score、个人受害概率、因果效应或实时保证。

完整边界见 [Portfolio v2](docs/PORTFOLIO_V2.md)、[部署证据要求](docs/DEPLOY.md) 和
[参与贡献说明](CONTRIBUTING.md)。

## 许可证

项目原创软件采用 [MIT License](LICENSE)。第三方数据继续受各自 provider 的条款、许可、保留和再发布规则约束。
