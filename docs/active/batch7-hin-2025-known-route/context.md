# Context

## Current truth

- Worktree is clean and detached at exact `19d27cfb808913d4fa5e120cb28204eb3405836e` before Batch 7 edits.
- Official recheck on 2026-08-10: 162 features; 6 `LineString`, 156 `MultiLineString`; fields `objectid`, `stname`, `length_ft`, `Shape__Length`; no GlobalID.
- Layer `lastEditDate`, `dataLastEditDate`, and `schemaLastEditDate` are all `2025-12-10T17:29:32.369Z`; item metadata modified is `2026-08-10T04:39:41.000Z`.
- Full official GeoJSON response measured 446,352 bytes. The committed tuple snapshot retains all four fields and six-decimal coordinates at 270,811 bytes.
- Current Known Route already owns explicit route admission, exact-route in-memory privacy, coarse Crime request disclosure, coverage proof, cancellation, and distinct unavailable/failure/zero states.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-10 | Use compact tuples `[snapshotObjectId, streetName, lengthFt, shapeLength, geometryCode, coordinates]`. | Retains official fields while meeting the 280,000-byte ceiling; runtime expands rows only in memory. |
| 2026-08-10 | Use an inclusive fixed 20 m local equirectangular segment-to-segment distance. | Supports `LineString`/`MultiLineString` without a dependency and requires explicit approximation/tolerance copy. |
| 2026-08-10 | Add a loader-injection seam returning only `ready`, `no-associated-streets`, or `unavailable`. | Batch 4 can adapt health later without duplicating its source-status model now. |
| 2026-08-10 | Keep HIN context text-first and omit a HIN map overlay. | MVP remains usable without MapLibre; optional overlay can be a later lazy enhancement. |
| 2026-08-10 | Move the existing Known Route lazy owner from map-only Crime initialization to a shared app adapter with an optional map port. | The same keyboard/file route surface works in list mode; map drawing remains available only when MapLibre exists. |
| 2026-08-10 | Keep HIN behind a nested lazy import and enforce a 3,500/1,500-byte app-adapter budget. | The existing 24,000/8,300-byte route UI ceiling remains unchanged and passes. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| None | Batch 7 owner | N/A | No dev server, browser, visual, or long/shared process authorized. |

## Handoff

Main supervisor owns cherry-pick/integration and all cross-worktree or remote actions. This worktree owner may edit, run short isolated checks, stage, and commit only.

## Handoff state

- Foundation implementation and short isolated validation are complete in this worktree.
- Batch 4 seam: `createHin2025ContextAdapter({ loadSnapshot })` accepts an injected no-argument local snapshot loader and returns only `ready`, `no-associated-streets`, or `unavailable`; it does not copy a source-health status model.
- The integration owner owns cherry-pick/integration, browser/visual/full-suite/release gates, and any conflict resolution.
