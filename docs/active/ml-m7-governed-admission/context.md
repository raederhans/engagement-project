# ML M7 Governed Admission Context

## Current truth

- Worktree: `C:/Users/raede/.codex/worktrees/a593/engagement_project`。
- Exact base: 从 clean detached `main@dfb4bc8a8a02e211e4fb212db847487c9970318a` 建立任务分支 `codex/ml-m7-governed-admission`；本分支仍以该 SHA 为基线。执行期间本地 `main` 已由其他 owner 前进，当前 lane 未跟随、未改动该 ref。
- 其他 checkout/worktree 属于受保护 WIP/证据面，本 lane 不修改、不清理。
- ML0-ML6 已在基线：research-only aggregate bridge、strict ArtifactRegistry admission、FeatureSchema/v2、sklearn baselines/count regressors、单-seed NB2、16 primary slices、isolated ML CI。
- 既有 persistent full M2 inventory 没有覆盖 manifest 与全部 parts 的 exact `ArtifactRegistry/v1`；当前 full evaluation 不可用。

## Frozen evidence and decisions

| Date | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-09-01 | `HEAD=main=dfb4bc8...`，status clean；`docs/AGENTS.md` 已读取。 | 从 exact base 建立唯一任务分支。 |
| 2026-09-01 | Protocol v3 raw SHA-256 为 `sha256:13efc6cdcedbf3f4dd839f5af802c04d72696baaf02efa5c5588d56066b06534`；v2 raw SHA-256 为 `sha256:997aaf5389ab401d0a87e74b749ab4079e26315d4bb8787ad4e1b7051b457dde`。 | M7 只引用，不改写冻结协议。 |
| 2026-09-01 | FeatureSchema/v2 LF-canonical repository bytes identity 为 `sha256:08cad80f5015e710fdd107c67eedee63e4b787d1420c9faf82e6cf4cc1cebe9b`。 | feature policy 与 schema 规范字节双重绑定，Windows/Ubuntu 不因 checkout EOL 漂移。 |
| 2026-09-01 | v3 candidates 不含 MA4 与 JS Poisson；JS NB 是 optional reference。 | M7 将 MA4 标为 diagnostic，JS Poisson 标为 reference-only/no-v3-gate，避免静默更改 protocol。 |
| 2026-09-01 | full M2 exact registry 仍缺失。 | actual admission 只能 `no-promotion`；不读 full mart parts，不跑 full training。 |
| 2026-09-01 | LF-canonical candidate/governance implementation identity `sha256:b7d68cf94003e5efdb58b581c39c04953b3a7e686af519bb89469dbc114e56e1`；gate policy identity `sha256:1a0f89111b53bfaafe0c18bcfb6b7236e5d388429880ef03309bcc286131978e`；environment lock identity `sha256:8661dd51b73e23c3097941bb1d0794f0cb677fec916e5a8cdfff7c93f95496e5`。 | Node 静态复核全部非动态 frozen lineage；任何实现/门槛漂移 fail closed。 |
| 2026-09-01 | Frozen v2 caller path 与 dataset manifest source 均在训练前复核；Poisson `lbfgs`、HGB external early stopping、Torch clip `1`，convergence 与 prediction cap 均进入 eligibility。 | 关闭 protocol masquerade 与 v3 配置/门槛漂移。 |
| 2026-09-01 | exact full registry allowlist 为空。 | fixture/synthetic 不可能获得 shadow admission；生产预测仍固定 unavailable。 |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Focused ML/Node validation | 本 lane `/root` | ignored `ml/.artifacts/m7-preflight-final2/` 与当前测试输出 | complete |
| Full M2 conversion/training | 无 | n/a | unavailable pending exact ArtifactRegistry/v1 |

## Handoff boundaries

- 本 lane 可创建本地结构化提交；main 整合、push、deploy、远端治理与 worktree cleanup 保留给上游 owner。
- Python 只产 research/admission JSON evidence，不调用 `publish_area_intelligence_evaluation.mjs`，不写 production serving JSON。
- Node shadow bridge 输出必须由调用者提供 task-owned 路径；bridge 明确拒绝 `public/**`/production target 与非 JSON model payload。

## Next step

上游 combined integration owner 从当前 coordination baseline `main@19118c6` 串行应用 implementation commit `8579abb1eb1c4232b67216aa3f79d0f7b5151f50` 与随后记录提交，再继续 public/private route lanes 和 combined gate。本 lane 不执行 merge/push/deploy/cleanup。
