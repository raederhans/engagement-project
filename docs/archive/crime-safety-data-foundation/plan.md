# Plan

## Goal

在同一套 Crime 产品界面内建立可扩展的数据基础：使用完整且版本化的三级犯罪分类，向普通用户只展示少量清晰口径，补充有用的时间趋势，并增加一个面向购房判断的犯罪稳定性子板块。

## Scope

- 将官方 Crime Incidents 分类整理为三级：风险主题、UCR 层、官方具体犯罪名称。
- 保留默认的简洁使用路径，同时允许用户下钻到具体犯罪。
- 明确并筛选用户可见口径：默认展示记录数；在数据说明中解释记录、唯一案件编号、可定位记录的差异，不把所有技术字段同时放入主界面。
- 修正覆盖日期的费城本地时区口径。
- 优化时间分析：近期趋势、去年同期、类别贡献与完整周期提示，优先复用现有图表与比较卡。
- 在现有 Crime 界面中增加“购房稳定性”子板块；本阶段只使用犯罪数据，不接入步行路线或外部房屋数据。
- 建立数据集、字段、指标三级元数据定义，为后续 Shooting、L&I、Vacancy、ACS 等数据模块预留一致契约。

## Sources of truth

- Official source: Philadelphia Crime Incidents / `incidents_part1_part2`.
- Runtime query boundary: `src/utils/sql.js`, `src/api/crime.js`, `src/api/meta.js`.
- Current product boundary: `index.html`, `src/ui/panel.js`, `src/charts/`, `src/compare/card.js`.
- Existing contracts under `scripts/tests/`.
- Current dirty worktree and `docs/active/_worktree_registry.md`; unrelated WIP must be preserved.

## Stages

- [x] Stage 1: Capture the official taxonomy and define failing contracts for taxonomy, metric metadata, local-date coverage, and the residential-stability view model.
- [x] Stage 2: Implement the versioned taxonomy and metadata/metric foundation.
- [x] Stage 3: Implement selected time metrics and the unified Crime UI with a residential-stability subsection.
- [x] Stage 4: Run targeted contracts, build/bundle validation, review, and browser smoke if the shared live server can be used safely.

## Acceptance criteria

- Every currently observed official offense label is represented by one versioned taxonomy leaf and maps to an explicit UCR layer and top-level theme.
- The default UI stays concise; users can progressively drill from theme to official offense rather than facing dozens of fields at once.
- User-facing counts have one stable default definition, while technical provenance exposes the alternate count and geocoding definitions.
- Coverage dates are computed in `America/New_York` and partial periods are identified.
- The residential-stability subsection shows a small, explainable set of crime-only signals and never claims that a place is definitively safe.
- New data/metric contracts have automated tests that fail before implementation and pass afterward.
- Existing help/localization WIP is preserved and unrelated behavior remains green.

## Non-goals

- No pedestrian safe-routing implementation.
- No predictive-policing or demographic risk scoring.
- No ingestion of Shooting, L&I, vacancy, property, ACS, SEPTA, 311, or environmental datasets in this first iteration.
- No opaque single “safety score” that hides its inputs.
- No commit, push, deployment, branch rewrite, or worktree cleanup unless separately requested and safe with the existing WIP.

## Risks and constraints

- Official incidents are preliminary, can be reclassified, and locations are generalized to the hundred block.
- `dc_key` semantics and duplicate causes are not fully documented; alternate counts must be labeled conservatively.
- Historic UCR/category labels may change; taxonomy version and unknown-label fallback are required.
- Existing uncommitted help/localization changes overlap some UI and test files; edits must be narrow and additive.
