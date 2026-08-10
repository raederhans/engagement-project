# Task

## Current status

`ready-for-integration`：实现、targeted tests、相关 lint、diff/bug/第一性原理复核均完成；只待 integration owner 整合并运行禁止给本任务的长门禁。

## Checklist

- [x] 核验 HEAD、worktree 与无初始 WIP。
- [x] 阅读项目指导、相关中央 planning records 与四个指定 skills。
- [x] 建立本任务唯一 plan/context/task，不修改中央 planning records。
- [x] 列出并测试 Crime query/result/runtime/exception ownership。
- [x] 观察 action/port 与 coordinator contracts 在旧实现上 RED。
- [x] 收敛 panel 与 Crime map/controller mutation 写入口。
- [x] 抽出最窄 selection/query coordinator。
- [x] 运行 targeted tests、相关 lint、`git diff --check`。
- [x] 完成 diff review、bug review、第一性原理复核。
- [x] 创建并复核本地 Lore commit，进入 ready-for-integration。

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git status --short --branch`（改动前） | `## HEAD (no branch)`，clean |
| `git rev-parse HEAD`（改动前） | `9f585b9e86fc3ee4f2378647cba2ef49a0308ccb` |
| `git worktree list --porcelain` | 主工作树在 `main`；本任务 worktree detached at exact base；并行 worktrees 保留 |
| TDD RED: `node --test scripts/tests/architecture_ports.mjs` | exit 1；缺失 panel actions，且 panel direct assignment contract 失败 |
| TDD RED: coordinator contract | exit 1；`crime_map_selection_coordinator.js` 尚不存在 |
| Bug RED: cleared start month | exit 1；实际保留 `2025-01`，预期由 normalizer 变为 `2025-09` |
| `npm ci` | exit 0；395 packages installed，396 audited，0 vulnerabilities；lockfile 无 diff |
| `npm run test:architecture-ports` | exit 0；7/7 |
| `npm run test:ui-p0` | exit 0；102/102，含 Crime DOM/copy/URL contracts |
| `npm run test:crime-async` | exit 0；31/31 |
| `npm run test:product-integrity` | exit 0；65/65，含 URL/Evidence/data semantics |
| `npm run test:analysis-history` | exit 0；26/26 |
| `npm run test:p2-recovery` | exit 0；33/33，result/runtime owner contracts |
| `npm run test:crime-safety-foundation` | exit 0；10/10 |
| `npm run test:data-sources` | exit 0；32/32 |
| Scoped ESLint for 7 changed JS/test files | exit 0；0 warnings/errors |

## Open risks and remaining work

- Browser、visual、dev server、build、bundle、完整 validate/`ci:release` 未运行；由 integration owner 串行运行，本任务不覆盖这些运行时证据。
- Batch 1B 与本任务都改动 `scripts/tests/product_integrity_contracts.mjs` 的非重叠 hunk；整合时仍需保留两边并重跑共同 suite。
