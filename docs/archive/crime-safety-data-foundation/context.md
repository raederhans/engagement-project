# Context

## Current truth

- The current worktree is `C:/Users/raede/Desktop/dev/engagement_project`, branch `main`, with unrelated help-center/localization WIP already present.
- Current point SQL selects seven incident fields; detail UI presents offense, dispatch time, generalized block, and district.
- Current selectable taxonomy contains six groups and eleven official labels, while the live source exposes thirty-two labels and twenty-six UCR values.
- Current aggregate metrics primarily use `COUNT(*)`; `delta30` exists in the compare artifact but is not populated.
- `src/api/meta.js` derives coverage dates directly from timestamptz values instead of Philadelphia local calendar dates.
- ACS normalization already includes population, renter, income, and poverty, but the current Crime map mainly consumes population.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-04 | User wants one product interface with separate data semantics, not two separate products. | Crime and residential views remain inside the same Crime surface. |
| 2026-08-04 | User asked to focus on Crime before pedestrian routing. | Route safety and street-network work are excluded. |
| 2026-08-04 | Detailed data is useful for drill-down but harmful as the default. | Progressive disclosure: concise primary metrics, details in metadata/source views. |
| 2026-08-04 | External housing/building inputs are valuable but not yet selected. | First residential subsection is crime-only; future composite indices require explicit component/version contracts. |
| 2026-08-04 | `$project-development` targets LLM systems rather than deterministic data products. | Its LLM pipeline guidance is not used. |
| 2026-08-04 | Live CARTO inspection returned 32 official offense labels and 26 UCR values. | Taxonomy version `2026-08-04` covers every observed leaf exactly once under six themes. |
| 2026-08-04 | A single composite safety score would hide assumptions and false precision. | Residential output stays descriptive: recent direction, monthly variation, evidence strength, and explicit method disclosure. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Vite listener on `127.0.0.1:5173` (PID 38872 at discovery) | Existing/user-owned process | Unknown | Preserve; do not restart or stop without a live-test ownership check. |
| Full validation (`npm test`) | Root agent | `C:/Users/raede/AppData/Local/Temp/engagement_project-crime-safety-final-test.log` | Finished; every suite passed until one pre-existing Help disclosure contract rejected the current centered `role=dialog` design. |
| Browser verification on existing 5173 listener | Root agent for browser session; server remains user-owned | Browser evidence reported in task record | Finished without restarting or stopping PID 38872. |

## Handoff

- Preserve `.gitignore`, `.playwright-mcp/`, help-center task records, help UI/i18n/style changes, and their test edits.
- Do not infer that row count equals incident count; label `COUNT(*)` as records and `COUNT(DISTINCT dc_key)` as unique case keys until official semantics are confirmed.
- Keep residential results descriptive and uncertainty-aware.

## Next step

If the Help redesign is retained as a centered modal, update its legacy P1 contract in the Help task rather than changing this Crime work. External housing/building modules and any composite index remain a separate evidence-and-weighting phase.
