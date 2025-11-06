# Known Issues & Limitations

---

## 🔴 Active Blockers

(None — all critical blockers resolved as of 2025-10-20 11:07)

---

## ✅ Resolved Issues

### Vite Project Structure (RESOLVED 2025-10-20 11:01)
**Was:** `vite.config.js` had `root: 'public'`, HTML was in `/public/index.html`, script tag used relative path `../src/main.js`
**Now:**
- `/index.html` at project root (moved from public/)
- `vite.config.js` simplified to `{ build: { outDir: 'dist' } }` (no root override)
- Script tag uses absolute path `/src/main.js`

**Status:** ✅ FIXED
**Verification:**
- [logs/acc_build_20251020_110731.log](../logs/acc_build_20251020_110731.log) — Build succeeds
- [logs/acc_http_preview_20251020_110731_retry.log](../logs/acc_http_preview_20251020_110731_retry.log) — Preview serves correctly
**Impact:** Production builds now possible, deployment unblocked

### offense_groups.json Structure (RESOLVED 2025-10-15 16:13)
**Was:** `"Property": "Thefts"` (STRING)
**Now:** `"Property": ["Thefts"]` (ARRAY)
**Status:** ✅ FIXED via scripts/fix_offense_groups.mjs
**Verification:** [logs/fixes_already_applied_20251015_152614.md](../logs/fixes_already_applied_20251015_152614.md)

### Duplicate index.html (RESOLVED 2025-10-20 11:01)
**Was:** Both `/index.html` AND `/public/index.html` existed
**Now:** Only `/index.html` at root (public/ copy deleted)
**Status:** ✅ FULLY FIXED — Duplicate removed, correct location established

---

## ⚠️ Performance & Data Issues

### Tracts GeoJSON Cache Missing (2025-10-20)
- Local cache `public/data/tracts_phl.geojson` not present
- Runtime fallback to remote fetch adds 2-3s latency
- **Fix:** Run `node scripts/fetch_tracts.mjs` to create local cache
- **Workaround:** Use "Districts" mode for faster rendering

### Precomputed Tract Counts Missing (2025-10-20)
- Artifact `src/data/tract_counts_last12m.json` not present
- Live aggregation required for tract choropleth (slower for long windows)
- **Fix:** Run `node scripts/precompute_tract_counts.mjs` periodically
- **Workaround:** Accept slight delay on first tract view load

### API Rate Limits
- CARTO SQL API may rate-limit (429) and transiently fail (5xx)
- HTTP client includes retry with backoff and de-duplication
- Consider raising TTLs in production for fewer API calls

---

## ℹ️ Known Limitations

### Address Input (A) Not Functional
- Text input exists but no geocoding API integrated
- Only "Select on map" button works
- **Workaround:** Use map selection instead of address entry

### Compare B Not Implemented
- Compare card shows location A only
- No UI for setting second location (B)
- **Workaround:** Use single-location analysis with charts

### Browser Compatibility
- Requires modern browser with ES module support
- Chrome 61+, Firefox 60+, Safari 11+, Edge 79+
- Internet Explorer NOT supported

---

## 🔍 Live No-Data Triage (2025-10-20 11:48)

### Symptoms
- UI renders correctly with map, controls, charts panels
- Districts choropleth may appear empty or with zero values
- Point layer shows "No incidents for selected filters" banner
- Charts show "Charts failed to render" or remain blank
- CARTO API is reachable but returns empty result sets

### Root Causes Identified

#### Primary: Data Date Range Mismatch
**Issue:** Default store config uses last 6 months from "today" (e.g., 2025-04-20 → 2025-10-20), but CARTO dataset `incidents_part1_part2` does not contain recent data (likely ends before 2024).

**Evidence:**
- Direct test query for 2024 date range returns `{"features": []}` from CARTO
- [logs/diag_sql_points_20251020_114809.log](../logs/diag_sql_points_20251020_114809.log) shows empty GeoJSON
- Districts query succeeds (pre-aggregated) but with zero counts for out-of-range dates

**Files:**
- [src/state/store.js:28-29](../src/state/store.js#L28-L29): `startMonth: null` defaults to relative "last N months"
- [src/state/store.js:38-46](../src/state/store.js#L38-L46): `getStartEnd()` fallback computes from current date

#### Secondary: Charts Require Center Before User Interaction
**Issue:** Charts attempt to render buffer-based queries (monthly buffer, top types, heatmap) with `center3857: null` on page load, causing `ensureCenter()` to throw.

**Evidence:**
- [src/main.js:51](../src/main.js#L51): `store.getFilters()` returns `center3857: null` initially
- [src/utils/sql.js:316](../src/utils/sql.js#L316): `ensureCenter(center)` throws when center is null
- Charts catch block logs "Charts failed to render"

**Files:**
- [src/main.js:50-64](../src/main.js#L50-L64): No guard against null center before calling `updateAllCharts`
- [src/state/store.js:37](../src/state/store.js#L37): `center3857: null` until map click

### Quick Diagnostic Checks
1. **Browser DevTools Console:** Look for errors mentioning `ensureCenter`, `center3857`, or CARTO fetch failures
2. **Network Tab:** Check CARTO SQL API responses — if `rows: []` or `features: []`, verify time range in request
3. **Store State:** In console, run `store.getFilters()` or check `window.__dashboard` to see actual time range
4. **Direct SQL Test:** Copy SQL from network tab, modify date range to known-good period (e.g., 2022-01-01 → 2023-01-01), paste into `https://phl.carto.com/api/v2/sql?q=<SQL>&format=json`

### Minimal Fixes (For Codex)
See detailed patches in [logs/NO_DATA_ROOT_CAUSE_20251020_114809.md](../logs/NO_DATA_ROOT_CAUSE_20251020_114809.md):
1. Query max `dispatch_date_time` from CARTO to find data coverage
2. Set `startMonth` in [src/state/store.js:28](../src/state/store.js#L28) to valid date within data range
3. Add guard in [src/main.js:51-52](../src/main.js#L51-L52): `if (center3857)` before calling `updateAllCharts`
4. Add user message when center is null: "Click map to show buffer-based charts"

### Workarounds (Immediate)
- Manually set `store.startMonth = '2022-06'` in browser console
- Click "Select on map" and click map to set center3857 before charts render
- Use districts choropleth only (doesn't require center or types filter)

**Status:** ⚠️ DIAGNOSED — Requires time range adjustment & center guard
**Full Report:** [logs/NO_DATA_ROOT_CAUSE_20251020_114809.md](../logs/NO_DATA_ROOT_CAUSE_20251020_114809.md)

---

**Last updated:** 2025-10-20 11:48
**Acceptance Status:** ⚠️ PARTIAL — Build/preview work; data config needs tuning for CARTO dataset coverage

- 2025-10-20T12:09:49.5545629-04:00 Note: If coverage endpoint is unreachable, app falls back to last 12 months up to today; may be empty. Re-probe by reloading app or running scripts/probe_coverage.mjs. 
