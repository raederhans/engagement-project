# Context

## Current truth

- Worktree `C:/Users/raede/.codex/worktrees/9ca3/engagement_project` remains detached and is ready for integration from required base `9f585b9e86fc3ee4f2378647cba2ef49a0308ccb`.
- The physical repository root has no `AGENTS.md`; the delegated root instructions in the task message and `docs/AGENTS.md` are active.
- The 2023 snapshot remains unchanged at 45,336 bytes. The new 2024 snapshot is a separate 62,449-byte file with 408 official rows, so old path consumers are not silently overwritten.
- Canonical ACS rows retain legacy `pop` and add `population.{estimate,moe90,vintage,source,retrievedAt,status}`. Missing estimates remain null.
- Configured Census normalization requires `B01003_001E` and `B01003_001M`; Census Reporter maps its `estimate` and `error` structures to the same contract.
- Analysis History writes strict schema v2 population objects and still reads strict v1 artifacts. Evidence Bundle v1 and the legacy JSON/CSV export retain their prior schema and omit the new object rather than silently widening v1.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-10 | Census 2024 ACS 5-year documentation identifies the release as 2020-2024 and B01003 as Total Population. | Snapshot and UI use vintage `2024` plus period `2020-2024`; no single-year interpretation. |
| 2026-08-10 | Official B01003 metadata labels `B01003_001E` as Estimate and `B01003_001M` as Margin of Error. | Both values are mandatory adapter fields; annotated/sentinel unavailable values normalize to null. |
| 2026-08-10 | Census states ACS publishes MOEs at its standard 90% confidence level. | Field name is `moe90`; UI does not generalize it to total uncertainty. |
| 2026-08-10 | Official API examples now require a key, and neither `CENSUS_API_KEY` nor `VITE_CENSUS_API_KEY` is present. | Use the official keyless table-based Summary File for the committed 2024 snapshot; keep configured official API support for runtime callers. |
| 2026-08-10 | Official Summary File B01003 data uses `GEO_ID|B01003_E001|B01003_M001`; Census Reporter uses `data[geoid].B01003.estimate/error.B01003001`. | One canonical normalization boundary accepts both shapes and preserves provider/release metadata. |
| 2026-08-10 | Existing circular population uses centroid-in-buffer whole-tract sums. | Continue point-estimate-only rates; buffer MOE remains unavailable and is never synthesized by summing tract MOEs. |
| 2026-08-10 | A per-10k tract with a missing denominator previously fell through to the raw count. | Per-10k values now fail closed to null when the point-estimate denominator is missing or non-positive. |
| 2026-08-10 | Evidence Bundle and legacy JSON are already published strict v1 shapes. | Keep them byte-shape compatible; only Analysis History advances to schema v2 for structured population evidence. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Official-source metadata/API probes | Batch 2 owner | Codex command evidence | Completed; no persistent process |
| Targeted node tests and snapshot verification | Batch 2 owner | Command output / task.md | Completed; no persistent process |

## Handoff

- This worktree may create local Lore commits only. It must not push, integrate, update refs in other worktrees, clean worktrees, or edit central planning records.
- Batch 1A/B are not integrated and are not dependencies. Any eventual conflict must be resolved by the integration owner.
- Code Lore commit: `dc9a86fb407d924d9bc96350bf6d3702386f7aa9`.
- No forbidden file or central planning record was changed; no cross-scope follow-up is required.
- Potential integration hotspots with other batches are `src/i18n/messages.js`, `src/analysis/analysis_artifact.js`, and `scripts/tests/product_integrity_contracts.mjs`; these are scope-based risks, not a verified overlapping diff.

## Next step

Integration owner should review and integrate the local commits without re-running snapshot generation unless intentionally refreshing `retrievedAt`; then run the repository's integration gates in the single shared validation lane.
