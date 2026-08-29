# Phase 2 P1-P6 Task

## Current status

Scope and isolated integration base frozen. P1 and P2 are complete through local clean-room reconstruction, exact M1/M2 validation, deterministic aggregate-only Spatial Attribution v2 evidence, and explicit no-authority boundaries. P3 is next.

## Checklist

- [x] 读取用户指定对话并提取最新第二阶段主线。
- [x] 将第二阶段 P1-P6 明确映射为对话 R1-R6，排除 R0/R7。
- [x] 检查 primary、local main、persistent DFEV1 candidate、worktrees 和 dirty ownership。
- [x] 建立 `codex/phase2-p1-p6@122bba9` 隔离 integration worktree。
- [x] 创建单一可恢复 task record。
- [x] P1 DataOps / versioned evidence registry。
- [x] P2 Spatial Attribution v2。
- [ ] P3 Evaluation Protocol v2。
- [ ] P4 Area Intelligence productization。
- [ ] P5 Home Compare real-data product。
- [ ] P6 Known Route evidence completion。
- [ ] 最终串行整合、扩大验证与边界复核。

## User-visible task budget

| Phase | New task limit | Created task IDs | State |
| --- | --- | --- | --- |
| P1 | <= 3 | `01a04d53-45e8-74b0-b767-6283715ea189` registry; `01a04d53-455b-7281-96e9-efba48a81de2` restore; `01a04d53-455b-7281-96e9-efdf919cc1d6` workflow | 3/3 completed and integrated |
| P2 | <= 3 effective | `01a04da8-d5d1-7d53-a1df-a2abbeba157b` denominator; `01a04da8-d5f9-78d1-bef7-ba427a4dc90d` methods; `01a04da8-d60c-7c92-b782-81658da4a116` report | 3/3 completed and integrated; duplicate `01a04da9-3ebd-7d20-987e-abde654de7a0` was stopped and archived before any integration |
| P3 | <= 3 | none | not started |
| P4 | <= 3 | none | not started |
| P5 | <= 3 | none | not started |
| P6 | <= 3 | none | not started |

## Validation evidence

| Command or check | Result |
| --- | --- |
| Browser read of linked conversation | Current branch contains latest R1-R6 serial plan; no browser mutation or message send |
| `git status --short --branch` on primary | tracked clean; user-owned untracked logs/output preserved |
| `git status` on persistent DFEV1 worktree | clean at `122bba9` |
| `git merge-base --is-ancestor main 122bba9` | exit 0; candidate is a descendant of local main |
| `git worktree add -b codex/phase2-p1-p6 ... 122bba9` | exit 0 |
| P1 artifact inventory | M1 stable/preservation whitelist and M2 stable/resume whitelist frozen; legacy absolute lineage path found |
| `node --test scripts/tests/artifact_registry_contracts.mjs` | 20/20 PASS in integration worktree |
| Ajv strict compile of `artifact_registry.schema.json` | PASS using the repository's existing dependency installation |
| Real `materialize_data_artifact_registry.mjs` against persistent M1/M2 controls | PASS; bundle `c254caf...86c5e`, M1 1,456 objects / 9,984,857,453 bytes, M2 140 objects / 827,041,387 bytes; restore status `not-observed` |
| Official GitHub action commit/release lookup | checkout `3d3c42e` = v7.0.1, setup-node `8207627` = v7.0.0, upload-artifact `043fb46` = v7.0.1 |
| P1 local mirror session `60979` | exit 0; result `DataFoundationArtifactMirrorResult/v1`, 1,596 files / 10,811,898,840 bytes / 8,785,158 rows, bundle `c254caf...86c5e`, authority all false |
| Combined P1 implementation and lineage tests | 82 total: 81 PASS, 1 Windows file-symlink permission SKIP, 0 FAIL (equivalent full set plus final registry/restore compatibility regression) |
| `node --test scripts/tests/crime_event_warehouse.mjs` | 17/17 PASS, including relative lineage, safe legacy relocation, drift and path-escape rejection |
| Ajv strict schema compile | PASS for `ArtifactRegistry/v1` |
| `js-yaml` workflow parse | PASS for `.github/workflows/data-foundation-maintenance.yml` |
| P1 security/final-diff review and remediation | Initial security P2=4 fixed; final staged review P2=1 fixed; focused re-review PASS with no new P0-P2 |
| P1 clean-room restore and independent verify | M1 1,456/1,456 objects and 9,984,857,453 bytes; M2 140/140 objects and 827,041,387 bytes; all exit 0 |
| Restored M1 exact admission | PASS at receipt `bc439541...e315`; 3,586,620 canonical rows / 8,741,798,048 canonical bytes |
| Restored M2 and evaluation exact admission | PASS at artifact `be26fcab...6d76`; 128 parts / 1,611,918 rows / 825,033,042 bytes; evaluation idempotent, `unavailable` and `not-promoted` |
| P1 post-restore portability repair | `1288ae1`; M2 no longer reopens a stale producer path after authoritative M1 admission; 8/8 target tests, ESLint, and focused review PASS with no P0-P2 |
| Clean-room registry identity reproduction | `bundle.json`, `m1.registry.json`, and `m2.registry.json` are byte-identical to the originals; bundle remains `c254caf...86c5e` |
| P2 implementation commits | `36d943b`, `e1ef453`, `88e211d`, `1b6ec10`, `56e975d`, `7ca9e7b`, `dd36428`, `8352292`, `b75aeff`; final protocol `sha256:ab57e1d387a30b538952c49aa816773cf1c745a353b505ff0f57a46de9ea8658` |
| P2 complete focused suite | 119/119 PASS across exact warehouse, denominator audit, four-method comparator, report and evidence runner |
| P2 exact real-data A/B run | Both runs completed at bundle `sha256:28598f2721d16d22ca338125227ba9d0eb37f2e10848be6b9d1f1d0768b8042a`; identical file set, lengths, SHA-256 values and bytes for all four published files |
| P2 exact denominator result | 3,586,620 canonical/eligible rows; tract 2,972,905 mapped, 549,598 ambiguous, 64,117 unmapped; grid 3,530,212 mapped, 56,408 unavailable; tract/grid remain parallel, never additive |
| P2 method result | tract and fixed-grid are `partial`; fractional and area-kernel are honestly `unavailable` with `uncertainty-footprint-artifact-unavailable` and null weighted mass; report is aggregate-only and all authority flags remain false |

## Open risks and remaining work

- 尚未选择或获权使用外部对象存储；P1 必须将 provider-neutral 实现、本地 clean-room 验证与跨机器发布权限分开。
- P1 workflow 仅通过本地静态/契约验证，未推送或触发远端 CI。
- P1 已证明本机隔离路径上的恢复与身份复现；未证明外部对象存储、跨机器传输或灾备演练。
- P2 没有 identity-bound uncertainty footprint 或 versioned road geometry artifact；fractional、area-kernel 和 road attribution 因此保持 unavailable，而不是补零或强制归属。
- 不得把本地候选称为远端 main、CI、Pages、产品发布、scientific promotion 或 routing authority。
