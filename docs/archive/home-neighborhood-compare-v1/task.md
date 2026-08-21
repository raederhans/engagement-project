# Task

## Current status

`verified ready-for-integration`。Exact starting candidate、M1/M2 read-only roots、官方 source
registry/address/serving/privacy contracts、bounded official smoke、三级 lazy boundary、focused/
browser/standard validation 与 final review 均已完成；feature commit 为
`86550a6c4aa6b9d96756bf02e75a3c2b9c228c55`；最终 cumulative candidate 包含后续任务记录与
privacy disclosure regression，以交接时 HEAD 为准。

## Checklist

- [x] 核对 exact `HEAD=9e8ff7ea24b...`、parent、clean、detached、main ancestry 与 worktrees。
- [x] 完整读取三个用户指定 Skills、适用 `docs/AGENTS.md` 和任务记录模板。
- [x] 查重并建立唯一 `home-neighborhood-compare-v1` 三件套；不改 M0–M2 历史记录。
- [x] 记录 M1/M2 roots 的初始 identity/mtime/inventory 与 strict-read-only boundary。
- [x] 映射现有 compare/address/search/share-state/Source Health/Area Intelligence/UI/test/bundle seam。
- [x] 核验 OPA/assessment、transfers、311、L&I、vacancy、crash/HIN 与 routing 第一方来源。
- [x] 实现 source/manifest/revision/DQ、address admission、privacy/share-state contracts。
- [x] 实现 comparison mart/serving projection 与 2–4 地址 UI、weights sensitivity/drill-down。
- [x] 运行 bounded official source smoke，报告真实 row/coverage/DQ 和 unavailable sources。
- [x] 运行 focused tests、lint、build/bundle、browser smoke 与 `npm run validate`。
- [x] 复核 M1/M2 upstream 未写入、隐私字段排除、diff/overlap；commit 后复核 clean。
- [x] 使用 Lore protocol 创建本地 commits，并报告 exact cumulative candidate。

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git rev-parse HEAD` / `git status --short --branch` | exact `9e8ff7ea24b1237a7322a59de602603f2786df5f`; detached; initial clean。 |
| `git merge-base main HEAD` / `git rev-list --left-right --count main...HEAD` | merge-base `f300cfe2658375add6542b86c20267c63c56ec4a`; `0 7`。 |
| M1 root inventory | 1,495 files / 49 dirs / 9,940,613,544 bytes；manifest 表达 21 scopes、3,583,548 rows、64 partitions、`serving_eligible:false`。 |
| M2 root inventory | 4,171 files / 70 dirs / 1,546,732,384 bytes；serving artifact 明确 historical available、forecast unavailable、not-promoted。 |
| Initial upstream access | 只读目录元数据和小型 manifest/report；未读取、复制或写入事件级 coordinates/address/source IDs。 |
| `npm run test:home-compare` | 13/13 pass；覆盖 2/3/4 profile、地址/parcel fail-closed、schema/revision drift、known/unknown count、future assessment tax year、partial/unavailable、隐私/share state、M2 no-promotion、权重与双语/HTML escaping。 |
| `node scripts/smoke_home_compare_sources.mjs --output=.../manifest.json` ×2 | 9 个第一方 source contract 均为 partial；retrieval `2026-08-21T12:02:37.076Z`，identity `sha256:e12612443cc0011c7c750cbad51ce6529fab31bd98516598b338f8b215b2f201`；第二次 semantic idempotent 且 mtime 不变；road/transit routing unavailable。 |
| Focused ESLint | Home Compare、geocoder 与 source-smoke files 通过，0 warning。 |
| `npm run validate` | final exact working tree exit 0；标准 data pipeline 已触达 M3 focused tests，随后 production manifest build 与原 bundle gate 全部通过；最终日志 `validate-final-privacy-disclosure.log`。此前既有 M2 test 一次 Windows `EPERM rename`，targeted rerun 及后续 full validate 均通过。 |
| Final bundle gate | Home Compare loader `1,033/597` raw/gzip、controller `53,386/17,950`、source registry `4,471/1,733`、styles `4,120/1,071`；non-VRE dist `3,953,132/4,000,000`，剩余 46,868 bytes；Source Health catalog `14,924/15,000`，所有 ceiling 未提高。 |
| Final `npm run test:home-compare-browser` | 对 final production dist 验证 2/3/4、partial/unavailable、M2 no-promotion、commute unavailable、safe share-state、双语、键盘和 390px mobile；0 console/page errors；4189 已清理。最终复核先捕获旧 L&I synthetic fixture field，修正 fixture 后重跑通过。 |
| Public-landmark runtime smoke | 仅公开市政地标；地址/parcel/coordinates 未输出或 tracked；八个维度 runtime path 可达。单点不是 citywide coverage/external validity。 |
| `npm ci` prerequisite | 395 个 lockfile-pinned packages 安装到本 worktree；npm cache/log task-local；package-lock 无 diff，无全局安装或上游 node_modules 写入。 |
| Final M1/M2 upstream inventory | 与初始完全一致：M1 `1,495/49/9,940,613,544`、root/latest mtimes 不变；M2 `4,171/70/1,546,732,384`、root/latest mtimes 不变。 |
| Privacy/diff audit | safe report/share projection 不含地址、目的地、坐标、parcel/source record value；测试只有显式 synthetic fixture；`git diff --check`、focused ESLint、package-lock no-diff 均通过。 |
| Privacy disclosure regression | 英中 UI 明确地址/坐标/parcel 仅临时用于列出的官方 API 查询，目的地不发送，且私人输入不进入 comparison artifact/share state；focused/browser tests 均有断言。 |

## Open risks and remaining work

- Source Health catalog 未扩展；M3 使用自己的 registry/drill-down。两级 lazy UI 和
  build-only GeoJSON projection 已通过原 bundle gate，没有提高 ceiling。
- 官方来源均只能声称 bounded `partial`；assessment 出现 2027 tax year，L&I 存在未来
  sentinel date；routing 仍 unavailable，不能声明 commute time/isochrone。
- 未 fetch 远端；remote/CI/deploy/user research 明确不在本任务权限和本地验证范围。

## Integration closeout

- Final cumulative candidate: `d1630d0f6c44f7ff0908e4a1792d7020c10a7f82`; local `main` was strictly fast-forwarded and `origin/main` was not changed.
- Independent final review had zero blockers. The share controller now strips unrelated query parameters and fragments, and the browser regression proves that only schema, weights, and dimensions are shared.
- Exact-tip `npm run validate` and `npm run test:home-compare-browser` passed; English/Chinese, 2-4 profiles, partial/unavailable sources, no-promoted forecast, unavailable commute, responsive layout, and zero browser errors were verified.
- Product truth: Home and Neighborhood Compare is integrated, but its official-source coverage remains bounded `partial`/`unavailable`; commute/routing remains `unavailable`, not zero.
- Deferred gates: no push, remote CI, deployment, live scheduled refresh, citywide external-validity claim, or user research was run.
