# Mainline M7 Public Product Task

## Current status

`handoff-ready`：M7 实现、审查收敛、聚焦验证、Pages-base browser/Axe 和最终全量 gate 均完成；
实现已保存为本地提交 `53f90cac3f031f84d7c962a7418d8762651ab047`。

## Checklist

- [x] 核验 `main@dfb4bc8`、初始 status 与适用 `docs/AGENTS.md`。
- [x] 创建独立 `codex/mainline-m7-public-product` 分支。
- [x] 建立唯一 `docs/active/mainline-m7-public-product/{plan,context,task}.md`。
- [x] 映射并选择可复用的 admitted route/candidate/evidence/map-match/sensitivity 合同。
- [x] 新增版本化 Public Scenario fixtures 与 fail-closed presenter/view model。
- [x] 完成 `src/main.js`、`src/style.css`、i18n 和页面 wiring。
- [x] 补齐双语、键盘、Axe、响应式与 Pages-base browser tests。
- [x] 运行最窄充分 Node/unit/lint/build/bundle/browser 验证。
- [x] 建立结构化本地提交并检查相对 base diff/status。
- [x] 更新 handoff、未准入维度、文案边界和推荐整合顺序。

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git rev-parse --short HEAD`（分支创建前） | `dfb4bc8` |
| `git status --short --branch`（分支创建前） | clean detached HEAD |
| `git switch -c codex/mainline-m7-public-product` | PASS；分支从 `dfb4bc8` 创建 |
| `Get-Content docs/AGENTS.md` | PASS；确认 `npm run validate` 核心 gate 与 fail-closed/所有权约束 |
| `npm run test:mainline-m7` | PASS；10/10，含错误单位、矛盾 map-match、未知 accessibility 枚举和四类 fail-closed gate |
| scoped `eslint` | PASS；M7 model/loader/messages/UI 与 unit/browser/bundle tests |
| scoped `stylelint` | PASS；`public-route-alternatives.css` 与样式入口 |
| `npm run build:manifest` | PASS；273 modules，Public Routes 保持 entry -> loader -> UI nested-lazy |
| `npm run verify:bundle` | PASS；普通 base `4,140,170/4,322,129` non-VRE/total bytes，fixture `20,505` bytes |
| `npm run test:product-integrity` | PASS；80/80 |
| `npm run test:p1-ui` | PASS；19/19；66 个现有视觉 baseline PASS，无 baseline/阈值变更 |
| `npm run test:mainline-m7-browser` | PASS；Chromium desktop `1440x900` + mobile `390x844`，EN/ZH，Axe serious/critical 0，overflow 0，Escape/focus return PASS |
| Pages-base build + bundle + M7 browser | PASS；`/engagement-project/`，`4,140,607/4,322,566` non-VRE/total bytes，fixture 和 lazy chunks 从 base path 加载 |
| 差异窄复审 | PASS；No findings；metric/admission、scenario focus、nested-lazy 三项均已收敛 |
| 最终 `npm run validate` | PASS；exit 0；log `C:/Users/raede/AppData/Local/Temp/engagement-m7-validate-final.log` |
| `git diff --cached --check` 与实现 commit 后核对 | PASS；`53f90ca` 仅含 16 个 M7 源码/fixture/test/wiring 文件 |

## Open risks and remaining work

- Safari/Firefox 原生 dialog/select 的聚焦行为未单独实测；Chromium 键盘和 Axe 路径已验证。
- Public Scenario 全部是受控静态 fixture；不能将其 PASS 推导为 Philadelphia 全域、实时、实测或 production authority。
- main 整合、push、CI/release/Pages deploy 和目标分支回归未执行，仍属总协调任务。
