# Data Pipeline Fix Plan

**Date:** 2025-10-20
**Purpose:** Minimal patches to resolve filter propagation issues identified in [DATA_PIPELINE_AUDIT.md](./DATA_PIPELINE_AUDIT.md)
**Target:** Codex implementation

---

## Priority Issues & Patches

### 🔴 P0: Charts Fail When Center Is Null on Load

**File:** [src/main.js](../src/main.js#L50-L64)

**Problem:** Initial call to `updateAllCharts` passes `center3857: null`, causing buffer-based queries to throw.

**Current Code (lines 50-64):**
```javascript
// Charts: use same 6-month window and a default buffer at map center
try {
  const { start, end, types, center3857, radiusM } = store.getFilters();
  await updateAllCharts({ start, end, types, center3857, radiusM });
} catch (err) {
  console.warn('Charts failed to render:', err);
  const pane = document.getElementById('charts') || document.body;
  const status = document.getElementById('charts-status') || (() => {
    const d = document.createElement('div');
    d.id = 'charts-status';
    d.style.cssText = 'position:absolute;right:16px;top:16px;padding:8px 12px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.1);background:#fff;font:14px/1.4 system-ui';
    pane.appendChild(d);
    return d;
  })();
  status.innerText = 'Charts unavailable: ' + (err.message || err);
}
```

**Patch:**
```diff
 // Charts: use same 6-month window and a default buffer at map center
 try {
   const { start, end, types, center3857, radiusM } = store.getFilters();
+  if (center3857) {
     await updateAllCharts({ start, end, types, center3857, radiusM });
+  } else {
+    const pane = document.getElementById('charts') || document.body;
+    const status = document.getElementById('charts-status') || (() => {
+      const d = document.createElement('div');
+      d.id = 'charts-status';
+      d.style.cssText = 'position:absolute;right:16px;top:16px;padding:8px 12px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.1);background:#fff;font:14px/1.4 system-ui';
+      pane.appendChild(d);
+      return d;
+    })();
+    status.innerText = 'Click "Select on map" to show buffer-based charts';
+  }
 } catch (err) {
   console.warn('Charts failed to render:', err);
   // ... existing error handler
```

**Expected Outcome:**
- On load, status message shows "Click 'Select on map'…" instead of error
- After user clicks map and sets center, `refreshAll()` calls `updateAllCharts` with valid `center3857`

---

### 🔴 P0: Default Time Window Has No Data

**File:** [src/state/store.js](../src/state/store.js#L28-L29)

**Problem:** `startMonth: null` defaults to last 6 months from "today" (e.g., 2025-04-20), but CARTO data ends before 2024.

**Current Code (lines 28-29):**
```javascript
startMonth: null,
durationMonths: 6,
```

**Patch:**
```diff
-startMonth: null,
-durationMonths: 6,
+startMonth: '2023-01',  // Known-good data range (adjust after verifying max date)
+durationMonths: 12,
```

**Verification Step (run once):**
Query CARTO to find actual max date:
```sql
SELECT MAX(dispatch_date_time) FROM incidents_part1_part2
```

Then set `startMonth` to a month within available data range (e.g., if max is 2023-12-31, use `'2022-12'` or `'2023-01'`).

**Expected Outcome:**
- Choropleth, points, and charts display data on initial load
- User can adjust time window via controls as needed

---

### 🟠 P1: Drilldown Overrides Groups Silently

**File:** [src/ui/panel.js](../src/ui/panel.js#L84-L88)

**Problem:** When user selects drilldown codes, `store.selectedTypes` is set directly, bypassing group expansion. If user later changes groups, no effect until drilldown is cleared.

**Current Code (lines 84-88):**
```javascript
fineSel?.addEventListener('change', () => {
  const codes = Array.from(fineSel.selectedOptions).map((o) => o.value);
  store.selectedTypes = codes; // override when present
  onChange();
});
```

**Patch A (Clear drilldown when groups change):**

**File:** [src/ui/panel.js](../src/ui/panel.js#L69-L82)

```diff
 groupSel?.addEventListener('change', () => {
   const values = Array.from(groupSel.selectedOptions).map((o) => o.value);
   store.selectedGroups = values;
+  // Clear drilldown to avoid silent override
+  if (fineSel) {
+    fineSel.selectedIndex = -1;  // Clear all drilldown selections
+  }
+  store.selectedTypes = [];  // Reset to use group expansion
   // populate drilldown options
   if (fineSel) {
     const codes = getCodesForGroups(values);
     fineSel.innerHTML = '';
     for (const c of codes) {
       const opt = document.createElement('option');
       opt.value = c; opt.textContent = c; fineSel.appendChild(opt);
     }
   }
   onChange();
 });
```

**Expected Outcome:**
- When user changes group selection, drilldown is cleared and group expansion takes effect
- Prevents confusion from stale drilldown overrides

---

### 🟠 P1: refreshAll Calls updateAllCharts Again (Redundant)

**File:** [src/main.js](../src/main.js#L85-L97)

**Problem:** `refreshAll()` also calls `updateAllCharts`, but doesn't guard against `null` center.

**Current Code (lines 85-97):**
```javascript
const f = store.getFilters();
updateAllCharts(f).catch((e) => {
  console.error(e);
  const pane = document.getElementById('charts') || document.body;
  const status = document.getElementById('charts-status') || (() => {
    const d = document.createElement('div');
    d.id = 'charts-status';
    d.style.cssText = 'position:absolute;right:16px;top:16px;padding:8px 12px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.1);background:#fff;font:14px/1.4 system-ui';
    pane.appendChild(d);
    return d;
  })();
  status.innerText = 'Charts unavailable: ' + (e.message || e);
});
```

**Patch:**
```diff
 const f = store.getFilters();
+if (f.center3857) {
   updateAllCharts(f).catch((e) => {
     console.error(e);
     const pane = document.getElementById('charts') || document.body;
     const status = document.getElementById('charts-status') || (() => {
       const d = document.createElement('div');
       d.id = 'charts-status';
       d.style.cssText = 'position:absolute;right:16px;top:16px;padding:8px 12px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.1);background:#fff;font:14px/1.4 system-ui';
       pane.appendChild(d);
       return d;
     })();
     status.innerText = 'Charts unavailable: ' + (e.message || e);
   });
+} else {
+  const pane = document.getElementById('charts') || document.body;
+  const status = document.getElementById('charts-status');
+  if (status) status.innerText = 'Click "Select on map" to show buffer-based charts';
+}
```

**Expected Outcome:**
- Charts don't attempt to render when center is unavailable
- User-friendly message persists until center is set

---

### 🟡 P2: Add Visual Feedback for Filter Changes

**File:** [src/ui/panel.js](../src/ui/panel.js#L31-L35)

**Problem:** No indication that filters are being processed; user may think app is frozen.

**Patch (add loading indicator):**

**Insert after line 35:**
```javascript
const onChange = debounce(() => {
  // Show loading indicator
  const indicator = document.getElementById('filter-loading') || (() => {
    const el = document.createElement('div');
    el.id = 'filter-loading';
    el.textContent = 'Updating…';
    Object.assign(el.style, {
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      background: 'rgba(0,0,0,0.8)', color: '#fff', padding: '12px 20px',
      borderRadius: '8px', zIndex: 100, fontSize: '14px'
    });
    document.body.appendChild(el);
    return el;
  })();
  indicator.style.display = 'block';

  // Derive selected offense codes from groups
  store.selectedTypes = expandGroupsToCodes(store.selectedGroups || []);

  // Call handler and hide indicator when done
  Promise.resolve(handlers.onChange?.()).finally(() => {
    indicator.style.display = 'none';
  });
}, 300);
```

**Expected Outcome:**
- "Updating…" overlay appears when user changes filters
- Disappears when `refreshAll()` completes

---

### 🟡 P2: Log Cache Stats for Debugging

**File:** [src/utils/http.js](../src/utils/http.js#L76-L79)

**Problem:** No visibility into cache hits/misses during development.

**Patch (add console.debug for cache hits):**

**Replace lines 76-79:**
```diff
 // memory/session cache
 const mem = lruGet(cacheKey);
-if (mem != null) return mem;
+if (mem != null) {
+  console.debug(`[Cache HIT] ${method} ${url.substring(0, 60)}…`);
+  return mem;
+}
 const ss = ssGet(cacheKey);
-if (ss != null) { lruSet(cacheKey, ss, cacheTTL); return ss; }
+if (ss != null) {
+  console.debug(`[SessionStorage HIT] ${method} ${url.substring(0, 60)}…`);
+  lruSet(cacheKey, ss, cacheTTL);
+  return ss;
+}
```

**Add after line 99:**
```javascript
console.debug(`[Cache MISS] ${method} ${url.substring(0, 60)}… (fetching from API)`);
```

**Expected Outcome:**
- Browser console shows `[Cache HIT]` vs `[Cache MISS]` for each fetch
- Developers can verify if filter changes trigger new API calls

---

## Test Plan

### Test Recipe 1: Offense Group Changes

**Steps:**
1. Open app in browser, open DevTools Console
2. Wait for initial load (districts should render with counts > 0)
3. Select "Property" in Offense Groups dropdown
4. Wait 300ms for debounce, observe:
   - Console shows `[Cache MISS] POST https://phl.carto.com/api/v2/sql…`
   - District colors change (counts should decrease)
   - Choropleth updates within 2 seconds
5. Select "Vehicle" (deselect "Property")
6. Observe:
   - New SQL generated (different `IN` clause)
   - Different row counts returned
   - Choropleth updates

**Expected Results:**
- ✅ District 01 count changes: All types → Property → Vehicle (e.g., 1251 → 331 → 222 for 2022 data)
- ✅ Console shows different cache keys for different groups
- ✅ Legend breaks adjust to new data distribution

---

### Test Recipe 2: Drilldown Override

**Steps:**
1. Select "Vehicle" in Offense Groups
2. Observe drilldown dropdown populates with "Motor Vehicle Theft", "Theft from Vehicle"
3. In drilldown, select ONLY "Motor Vehicle Theft"
4. Observe counts drop (now showing only one of two vehicle types)
5. Change Offense Groups to "Property"
6. **With fix:** Observe drilldown clears and counts switch to Property types
7. **Without fix (old behavior):** Counts don't change (still filtered to "Motor Vehicle Theft")

**Expected Result (with patch):**
- ✅ Group change clears drilldown and applies new group filter

---

### Test Recipe 3: Time Window Changes

**Steps:**
1. Note initial date range in URL/SQL (should be 2023-01-01 to 2024-01-01 after fix)
2. Change Start Month to "2022-06"
3. Change Duration to "6 months"
4. Observe:
   - New SQL generated with `dispatch_date_time >= '2022-06-01'` and `< '2022-12-01'`
   - District counts change (different 6-month period)

**Expected Result:**
- ✅ Date predicates update in SQL
- ✅ Different row counts returned

---

### Test Recipe 4: Charts Center Guard

**Steps:**
1. Reload app (fresh load, no center set)
2. Observe:
   - **With fix:** Charts panel shows "Click 'Select on map'…" message
   - **Without fix:** Charts panel shows "Charts unavailable: center3857 is required."
3. Click "Select on map" button
4. Click anywhere on map
5. Observe:
   - Marker appears
   - Buffer circle draws
   - Charts panel updates with monthly/topN/heatmap charts

**Expected Result:**
- ✅ No errors on initial load
- ✅ Charts render after center is set

---

### Test Recipe 5: Dataset Label Changes

**Steps:**
1. Set time window to 2023-01 (6 months)
2. Select "Property" offense group
3. Observe monthly chart x-axis labels (should show 2023-01, 2023-02, …, 2023-06)
4. Change time window to 2022-01 (12 months)
5. Observe:
   - Chart x-axis updates to show 2022-01 through 2022-12
   - Data series updates (different year)

**Expected Result:**
- ✅ Chart labels reflect new time range
- ✅ Chart data updates (not stale cached values)

---

## Acceptance Criteria

### Must Pass

- [ ] Charts do not throw errors on initial load when `center3857` is `null`
- [ ] Changing offense groups from [] → Property → Vehicle produces different district counts
- [ ] Changing time window updates date predicates in SQL and fetches new data
- [ ] Drilldown selections are cleared when user changes offense groups (no silent override)
- [ ] Console shows distinct cache keys for queries with different filters

### Should Pass

- [ ] "Updating…" loading indicator appears during filter changes
- [ ] Cache hit/miss logs appear in DevTools Console (debug mode)
- [ ] Charts update within 2 seconds of filter change (excluding cache TTL)

### Nice to Have

- [ ] "Last updated" timestamp displayed in charts panel
- [ ] Manual "Refresh" button to clear cache and force API refetch

---

## Rollback Plan

If patches cause regressions:

1. **Revert P0 patches first** (center guard, time window default)
2. **Test basic choropleth rendering** (districts should still render)
3. **Revert P1 patches** (drilldown clear, refreshAll guard)
4. **Keep P2 patches** (logging, loading indicator) unless they cause errors

**Rollback command:**
```bash
git checkout HEAD -- src/main.js src/state/store.js src/ui/panel.js src/utils/http.js
```

---

## Post-Implementation Verification

After codex applies patches, manager should:

1. Run `npm run dev` and test all 5 test recipes
2. Check browser console for:
   - No errors on load
   - Cache hit/miss logs appear
   - Different SQL generated for different filters
3. Open Network tab and verify:
   - CARTO API calls have different query params when filters change
   - Cached responses return instantly (no network delay)
4. Commit changes:
   ```bash
   git add src/main.js src/state/store.js src/ui/panel.js src/utils/http.js
   git commit -m "Fix data pipeline: guard charts against null center, set valid time window, clear drilldown on group change"
   ```

---

**Status:** ✅ READY FOR CODEX IMPLEMENTATION
**Estimated effort:** 15-20 minutes (5 file edits, straightforward patches)
