# Mainline M7 Public Product Task

## Current status

`handoff-ready`：静态 fixture 的代码侧独立 identity/content binding 与英中 copy hostile guard 已完成；
最终 bounded rereview 为 No findings / PASS。

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
- [x] 新增独立版本化 manifest，绑定 exact artifact/time/scenario/candidate/edge 身份与 SHA-256 内容摘要。
- [x] 补 artifact/time/identity/metric/copy drift hostile 回归并重跑 unit/browser/Axe/bundle 与 `validate`。

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
| `npm run lint:js`（remediation） | PASS；最终 JS/MJS 工作面零 warning；仓库没有 `lint` 总脚本 |
| `npm run test:mainline-m7`（remediation） | PASS；14/14，含 artifact/time/candidate/edge/label/metric 摘要漂移及完整英中 copy hostile probes |
| normal build + bundle（remediation） | PASS；`4,140,517/4,322,476` non-VRE/total bytes；fixture `17,986` bytes；阈值未变 |
| normal M7 browser（remediation） | PASS；desktop/mobile、EN/ZH、Axe serious/critical 0、overflow 0、copy guard PASS |
| Pages-base build + bundle + M7 browser（remediation） | PASS；`/engagement-project/`，`4,140,954/4,322,913` non-VRE/total bytes；desktop/mobile/Axe/copy guard PASS |
| `npm run validate`（manifest 产品代码） | PASS；exit 0；log `C:/Users/raede/AppData/Local/Temp/engagement-m7-manifest-remediation.log`；随后仅增加测试侧 copy guard，并已由最终 lint/unit/browser 覆盖 |
| remediation bounded rereview | PASS；先发现 copy-regex 假绿并修复，最终 No findings；manifest/digest/async loader/copy guard 均无 material finding |
| remediation commit | `79a62174af4ff05296e46179cc26ccbc2c17fd16`；7 个 fixture/source/test 文件，未含 active records |

## Open risks and remaining work

- Safari/Firefox 原生 dialog/select 的聚焦行为未单独实测；Chromium 键盘和 Axe 路径已验证。
- Pages-base non-VRE budget 仅余 46 bytes、total budget 仅余 87 bytes；本次没有放宽上限，后续任何产品增量都必须重新测量。
- Public Scenario 全部是受控静态 fixture；不能将其 PASS 推导为 Philadelphia 全域、实时、实测或 production authority。
- main 整合、push、CI/release/Pages deploy 和目标分支回归未执行，仍属总协调任务。
