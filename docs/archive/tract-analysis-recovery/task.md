# Task

## Current status

Complete: tract interaction, tract-scoped summary and incident loading are repaired and verified in the live application.

## Checklist

- [x] Verify live symptoms, snapshot validity, date-window mismatch and event refresh gating.
- [x] Establish task records and live-process ownership.
- [x] Add and observe failing tract-interaction contracts.
- [x] Add and observe failing tract-event contracts.
- [x] Implement the smallest production repair.
- [x] Run focused tests and regression suites.
- [x] Run build, bundle policy and browser smoke.
- [x] Complete review and first-principles simplification pass.

## Validation evidence

| Command or check | Result |
| --- | --- |
| `npm run data:check:tract-crime` | PASS; 408 tracts for `[2025-08-01, 2026-08-01)`. |
| Existing Crime UI contracts | PASS 30/30; currently codify incident layers as buffer-only. |
| Existing Crime async contracts | PASS 19/19; district refresh currently marks incidents inactive. |
| Port ownership check | No listener on 5173 or 4173 at task start. |
| RED Crime UI contracts | 2 expected failures: tract selection was not incident-active and unavailable snapshot created no `tracts-fill`. |
| RED Crime async contracts | 3 expected failures: tract refresh omitted incidents, summary used buffer fetchers, point SQL omitted the polygon. |
| RED runtime contracts | 1 expected failure: incident point SQL contained only the viewport envelope. |
| GREEN Crime UI contracts | PASS 31/31. |
| GREEN Crime async contracts | PASS 22/22 before the added direct tract-population coverage. |
| GREEN runtime contracts | PASS 15/15. |
| Focused regression | PASS: points 26/26, product integrity 57/57, partial-result contracts 29/29, syntax checks clean. |
| Final targeted regression | PASS 166/166 across Crime async/UI, runtime, points lifecycle, product integrity and partial-result contracts. |
| `npm run build:manifest` | PASS; 188 modules transformed and GeoJSON artifacts generated. |
| `npm run verify:bundle` | PASS; Entry 898540 bytes, Crime 37501 bytes, Charts 231959 bytes. |
| Browser smoke: selected zero tract | PASS; `tract=42101035602`, summary shows 0, incident list reports no visible events, and URL keeps the GEOID. |
| Browser smoke: selected positive tract | PASS; `tract=42101030100`, summary shows 6 Arson events and incident list shows 6/6. |
| Browser warnings after each final navigation | PASS; 0 new warning/error entries. |

## Open risks and remaining work

- No required work remains for this repair.
- Intentional limit: an unavailable/mismatched citywide snapshot uses a neutral selectable tract layer; it does not synthesize arbitrary-window citywide choropleth values.
- The local Vite server remains running on `127.0.0.1:5173` for user review.
