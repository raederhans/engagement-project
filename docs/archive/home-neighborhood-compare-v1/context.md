# Context

## Current truth

- 2026-08-21 M3 起点是
  `C:/Users/raede/.codex/worktrees/d7da/engagement_project`，detached、clean，exact
  `HEAD=9e8ff7ea24b1237a7322a59de602603f2786df5f`；parent 为
  `5bcd52e0f741f702bc22991756cf48e46e54a227`。本任务只拥有 `d7da`。
- 本地 `main` 与未 fetch 的 `origin/main` 都记录为
  `f300cfe2658375add6542b86c20267c63c56ec4a`；merge-base 与 main 相同，M0/M1/M2
  cumulative candidate 正好 ahead 7。没有发生 fetch、push、merge/rebase 或 ref change。
- 适用仓库指令为 workspace instructions 与 `docs/AGENTS.md`。本目录此前不存在
  `home-neighborhood-compare-v1` 等价记录；已完成的
  `data-foundation-external-validity-v1` 保持原样，只作为 M0–M2 历史事实源。
- M1 strict-read-only root 初始 inventory：1,495 files、49 child directories、
  9,940,613,544 bytes；root mtime `2026-08-21T07:01:26.7070453Z`，latest file
  `backfill-checkpoint.json` mtime `2026-08-21T07:01:26.7038367Z`。warehouse manifest
  mtime `2026-08-21T07:00:19.9666942Z`，21 scopes、3,583,548 active rows、64
  partitions、coverage `[2006-01-01, 2026-08-22)`、`serving_eligible:false`。
- M2 strict-read-only root 初始 inventory：4,171 files、70 child directories、
  1,546,732,384 bytes；root mtime `2026-08-21T07:51:45.1522225Z`，latest file
  `evaluation/checkpoint.json` mtime `2026-08-21T07:53:40.8278193Z`。evaluation
  serving artifact 为 `not-promoted`；historical evidence `available`；forecast
  `unavailable`/`model-did-not-exceed-predefined-seasonal-baseline`/empty predictions。
- M3 task-owned raw/cache/mart/checkpoint/output 位于 ignored
  `.dfev1/home-neighborhood-compare/m3-v1/`；live logs 位于 ignored
  `.dfev1/home-neighborhood-compare/m3-v1/logs/`。tracked 输出只允许 code、contracts、
  manifest templates、machine-readable privacy-safe reports 与小型 serving artifact。
- M3 feature commit 为 `86550a6c4aa6b9d96756bf02e75a3c2b9c228c55`；其 exact parent 是
  starting candidate `9e8ff7ea24b1237a7322a59de602603f2786df5f`。最终 cumulative candidate
  是包含本记录与 privacy disclosure regression 的后续 commit；以交接时 `git rev-parse HEAD` 为准。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-21 | M2 tracked 与 ignored serving artifacts 一致表达 no-promotion；forecast predictions 为空。 | M3 所有 projection/UI/share state 必须继承这一状态，不允许权重或地址 compare 生成 forecast。 |
| 2026-08-21 | 上游 roots 的首次检查只读取目录元数据、小型 manifest/report，没有读取或复制事件级记录。 | 后续 ingest 只从已授权安全 aggregate/manifest 投影消费；任何真实 source smoke 写入 task-owned ignored root。 |
| 2026-08-21 | `docs/active/data-foundation-external-validity-v1` 是已完成历史记录。 | 新 M3 使用唯一独立三件套，不重开或改写 M0–M2 结论。 |
| 2026-08-21 | 官方 bounded smoke 于 `2026-08-21T12:02:37.076Z` 观察 9 个合同均为 `partial`；semantic identity `sha256:e12612443cc0011c7c750cbad51ce6529fab31bd98516598b338f8b215b2f201`；exact rerun idempotent、mtime 不变。 | row count/schema/vintage 仅是时间戳证据；tracked safe report 位于 `reports/home-compare/official-source-smoke.v1.json`。 |
| 2026-08-21 | OPA assessment 最大 tax year 为 2027；L&I license 存在 `3200-12-31` sentinel。 | 前者标记 source-vintage review；后者从 source-as-of 计算排除并保留 DQ，不把未来日期称作 freshness。 |
| 2026-08-21 | City public route service 不满足 travel-time/isochrone authority，且仓库无 admitted local routing engine。 | road/transit commute 均 unavailable；不使用直线距离或 synthetic graph。 |
| 2026-08-21 | Final browser 首次复核发现 synthetic L&I fixture 仍返回旧 `open_count`，而生产合同已使用 `not_closed_count`。 | 同步 synthetic fixture 后 focused/browser/standard gates 全部重跑通过；没有放宽 production fail-closed 或 browser 断言。 |
| 2026-08-21 | Final privacy disclosure audit 发现初版 intro 把临时官方 API 查询误写成完全 browser-only。 | 英中 UI 现明确地址/坐标/parcel 会临时查询列出的官方来源，目的地不发送，且所有私人输入均不进入 comparison artifact/share state；focused/browser assertions 锁定该边界。 |

## Live process ownership

| Process | Owner | Command / resources / log | State |
| --- | --- | --- | --- |
| M3 official smoke | `/root` primary agent | bounded foreground command；output/checkpoint=`.dfev1/home-neighborhood-compare/m3-v1/official-smoke/manifest.json` | completed; no process/port remains |
| M3 locked dependency materialization | `/root` primary agent | `npm ci --no-audit --no-fund`; exact existing lockfile; cache/log under `.dfev1/home-neighborhood-compare/m3-v1/`; no package-lock edit | completed; no process remains |
| M3 production build and bundle | `/root` primary agent | cwd=`d7da`; output=`dist`; final task log=`.dfev1/home-neighborhood-compare/m3-v1/logs/validate-final-privacy-disclosure.log`; success=exit 0 plus existing unchanged ceilings | completed; final non-VRE headroom 46,868 bytes |
| M3 browser smoke | `/root` primary agent | unique port `4189`; final task log=`.dfev1/home-neighborhood-compare/m3-v1/logs/browser-smoke-final-privacy-disclosure.log`; synthetic intercepted fixtures only; success=desktop/mobile, keyboard, truthful privacy disclosure, zero console/page errors | completed against final production dist; port/browser cleaned |
| M3 full validate | `/root` primary agent | cwd=`d7da`; final task log=`.dfev1/home-neighborhood-compare/m3-v1/logs/validate-final-privacy-disclosure.log`; no shared cache/output beyond repo-standard `dist` | completed exit 0; generated query logs moved into task-owned ignored logs; no process remains |

## Handoff

`/root` primary agent 已完成实现、live process、Git index/commit 与最终验证；所有登记进程和
端口均已清理。三个只读 reviewer 的 P0–P2 findings 均已解决；残余仅为非阻塞的 canonical
dimension 命名和未来 revision binding 设计风险。

## Next step

交接 verified ready-for-integration 的 exact cumulative candidate；不在本任务中 push、merge、
rebase、fetch、部署或清理 worktree topology。remote/CI/deploy/user research 继续明确未运行。
