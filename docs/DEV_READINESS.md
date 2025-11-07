# Route Safety Diary — DEV Readiness (M1 Discovery)

## Local bootstrap notes
- Repo path: `engagement-project` (Vite + MapLibre) with read-only access this cycle.
- Node/NPM not runnable under current WSL 1 sandbox (`node -v` → command missing, `npm -v` → "WSL 1 is not supported"); need Node 18+ on WSL2/Windows for dev/test.
- Package scripts exposed via `package.json`: `npm run dev` (Vite dev server), `npm run build`, `npm run preview`. No lint/test scripts yet.
- Feature gating: no references to `VITE_FEATURE_DIARY` anywhere in `src/`; diary work must live behind `import.meta.env.VITE_FEATURE_DIARY === 'true'` checks before touching runtime modules.
- Data bootstraps available: `public/data/police_districts.geojson`, `public/data/tracts_phl.geojson`, `src/data/acs_tracts_2023_pa101.json`, and offense grouping JSON. No diary-specific datasets checked in yet (no segment geometry, no prior diary submissions cache).
- Scripts folder already includes fetch/precompute helpers for ACS/tracts; nothing yet for diary ingestion (trip matcher, decay calculator, or API mocks).

## File inventory (diary-relevant paths)
| Path | Purpose | Status / Notes |
| --- | --- | --- |
| `src/main.js`, `src/ui/panel.js`, `src/ui/about.js` | Existing MapLibre dashboard bootstrap + controls | Present; must wrap diary mount points behind the feature flag (e.g., new `routes_diary/index.js` importer). |
| `src/api/{crime,acs,boundaries}.js` | Current data layer (CARTO + ACS) | Present; no diary endpoints (`api/diary.js` missing). Need HTTP helper `src/utils/http.js` for reuse. |
| `src/map/*` | MapLibre overlays (buffer, districts, tracts, points, selection) | Present; no segment-level layer yet. Future `segments_layer.js` and `routing_overlay.js` need to slot into this folder. |
| `src/state/store.js` | Central store for filters/radius/time window | Present; lacks diary fields (trip recording status, selected route, contribution stats). |
| `src/charts/*`, `src/compare/card.js` | Existing chart stack | Present; diaries may reuse chart infra for Insights panel once `VITE_FEATURE_DIARY` toggles it. |
| `src/utils/{classify,join,sql,...}` | Helper utilities (geo + SQL) | Present; no `match.js` (snap trips to segments) or `decay.js` (exponential decay) yet. |
| `src/data/*` | Cached lookup tables | Present but diary-specific lookup (segments catalog, tag taxonomy) missing. |
| `public/data/*` | GeoJSON caches consumed before live fetches | Districts & tracts present; need `segments_phl.geojson` (or similar) for diary mode. |
| `scripts/*` | Data ETL/precompute scripts | Crime/ACS scripts present; need diary ETL (segment atlas builder, ajv validator) later. |
| `docs/FILE_MAP_ENGAGEMENT.md`, `docs/KNOWN_ISSUES.md`, `docs/TODO.md` | Prior audits + task lists | Useful context; none mention diary implementation yet. |
| `Route Safety Diary UI/**` | Stand-alone Vite+React prototype for the four UI states | Present (React 18, Radix, Recharts, Tailwind). Serves as design reference only; not wired to main app yet. |
| `logs/` | Newly created for this cycle | `DEV_DISCOVERY_2025-11-07T154321.md` captures command log. |

_Missing directories/files called out above must be created next cycle once feature flag work begins._

## Scenario mapping (UI stub → planned modules)
| Scenario (ref file) | Stage / Flow | UI controls present | Data / mocks used | Planned modules behind VITE flag |
| --- | --- | --- | --- | --- |
| Ready to Begin — `Route Safety Diary UI/src/App.tsx`, `TopBar.tsx`, `LeftPanel.tsx` | Plan → Walk prep view (Diary tab active, legend toggle, recorder dock idle, Insights placeholders) | Mode switch, time window select, filter chips, legend toggle, Recorder Start button | Mock layout only; no map data besides empty canvas grid | `routes_diary/index.js` to mount panel + wire store, `my_routes.js` for future “My routes”, `segments_layer.js` idle state, `routing_overlay.js` disabled |
| Recording Complete — `Route Safety Diary UI/src/components/RatingModal.tsx` | Record → Rate form modal immediately after Finish | 1–5 star rating, tag chips + other field, per-segment overrides (max2), travel mode picker, Save as My Route toggle, privacy note | `availableTags`, `mockSegments` arrays, local React state | `form_submit.js` (modal controller + validations), `api/diary.js` (POST), `utils/match.js` (segment override list), `utils/decay.js` (calc next decayed mean preview) |
| Post-Submit — `Route Safety Diary UI/src/components/MapCanvas.tsx` (post-submit branch) | Rate → Alternative surfacing | Map glow (color=rating, width=confidence), snackbar “Thanks — updating map”, safer alternative strip with thumb-up, Recorder dock finished state | `streetSegments` mock array with rating/confidence improvements when `isPostSubmit`, `incidents` scatter | `segments_layer.js` (line styling & glow), `routing_overlay.js` (alternative path), `routes_diary/index.js` (snackbar + state), `api/diary.js` (fetch updated aggregates) |
| Community Interaction — `Route Safety Diary UI/src/components/SegmentCard.tsx` + `CommunityDetailsModal.tsx` | Ongoing community view (post-submit + hover/click) | Segment card actions (Agree / Feels safer), View community insights link, alternative route feedback, Insights sidebar charts | Mock tags per segment, trend/randomized stats, modal arrays (`recentActivity`, `tagHistory`, etc.) | `segments_layer.js` (click handlers), `api/diary.js` (GET stats, patch agrees/improvements), `utils/decay.js` (update n_eff + decayed mean), `my_routes.js` (persist user’s saved routes), `routes_diary/index.js` (panel integration) |

## Risks & blockers
- **Local runtime unavailable:** Node/NPM blocked by WSL1 restriction → cannot run Vite dev server or build. Upgrade to WSL2 or run commands via Windows shell before implementation.
- **Feature flag missing:** No `VITE_FEATURE_DIARY` wiring yet; need env guard scaffolding plus default `false` fallback to avoid regressions.
- **Diary data model undefined:** No `segments_phl.geojson`, no diary submission schema, no `api/diary.js`; will need to design AJV schema + persistence handshake before integrating UI controls.
- **Map layer gap:** Existing MapLibre stack only handles districts/tracts/points; diary requires polyline or segment overlay plus route planning (A* with safety penalty) not present.
- **UI tech mismatch:** Reference scenarios built with React/Radix while live app is vanilla JS + imperative DOM; need integration strategy (micro-frontend mount, or translate components into existing framework) before M1.
- **Confidence math TBD:** Requirements mention decayed mean (1–5) and `n_eff` confidence, but no decay utility or prior data to validate calculations; adds risk to Insights accuracy.

## M1 readiness checklist
| Item | Status | Notes |
| --- | --- | --- |
| Node 18+/npm available locally | 🔴 Red | Commands fail under WSL1; cannot run dev server or tests yet. |
| `VITE_FEATURE_DIARY` guard + config plumbing | 🔴 Red | No env var usage; needs `.env` template + code gating before ship. |
| Scenario specs & assets captured | 🟢 Green | Four UI states documented via `WORKFLOW_SPECS.md` + component stubs. |
| Segment geometry + diary datasets accessible | 🟡 Yellow | District/tract caches exist, but no segment atlas or diary history yet. |
| Planned modules stubbed (`routes_diary/*`, `api/diary.js`, utils) | 🔴 Red | None created; will add once implementation cycle starts. |
| Map/charts baseline stable | 🟢 Green | Existing crime dashboard modules intact; ready for flag-protected extensions. |
| Tooling scripts for diary ingestion | 🟡 Yellow | `scripts/` covers ACS/crime only; diary ETL scripts still pending design. |

_M1 cannot start until Node runtime + feature flag scaffolding are in place; once unblocked, proceed with implementing the new modules under `src/routes_diary/**` behind the diary-specific Vite env flag._
