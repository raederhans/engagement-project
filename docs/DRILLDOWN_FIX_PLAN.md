# Drilldown Fix Plan — Codex-Ready Implementation

**Status**: Ready for Codex execution
**Priority**: P0 (Critical bug, feature completely broken)
**Related Diagnosis**: [logs/DRILLDOWN_DIAG_20251020_194408.md](../logs/DRILLDOWN_DIAG_20251020_194408.md)

---

## P0: Fix Critical Typo (1-character change)

### Root Cause
**File**: [src/api/crime.js:223](../src/api/crime.js#L223)
**Bug**: `endIso` is assigned to `start` instead of `end`, creating zero-length time window.

### Patch

**File**: `src/api/crime.js`
**Line**: 223

```diff
  // Build SQL to get distinct codes with incidents in time window
  const startIso = Q.dateFloorGuard(start);
- const endIso = start; // Use raw value for end (ensured in sanitizeTypes)
+ const endIso = end;
  const sanitized = Q.sanitizeTypes(expandedCodes);
```

**Rationale**: `endIso` must use the `end` parameter, not `start`. Current code creates query with `WHERE ... >= '2024-01-01' AND ... < '2024-01-01'` (impossible condition).

---

## P1: Add Fallback "Show All Sub-Codes" Option

### Goal
When time-window query returns 0 codes (legitimately empty window, not bug), offer user option to see all codes for selected groups **without** time filter (list-only, filters still honor time window).

### Implementation

**File**: `src/ui/panel.js`
**Location**: Inside `groupSel` event handler after `fetchAvailableCodesForGroups` returns empty array

```diff
  if (availableCodes.length === 0) {
-   fineSel.innerHTML = '<option disabled>No sub-codes in this window</option>';
+   fineSel.innerHTML = '<option disabled>No sub-codes in this window</option>';
+   // Add fallback option to show all codes (ignoring time window filter)
+   const allCodes = getCodesForGroups(values); // From utils/types.js, no time filter
+   if (allCodes.length > 0) {
+     const hint = document.createElement('option');
+     hint.disabled = true;
+     hint.textContent = '── Show all (ignoring time) ──';
+     fineSel.appendChild(hint);
+     for (const c of allCodes) {
+       const opt = document.createElement('option');
+       opt.value = c;
+       opt.textContent = c + ' (any time)';
+       fineSel.appendChild(opt);
+     }
+   }
  }
```

**User Flow**:
1. User selects "Vehicle" group with narrow 3-month window
2. API returns 0 codes (no vehicle thefts in that specific 3 months)
3. Drilldown shows:
   ```
   No sub-codes in this window
   ── Show all (ignoring time) ──
   Motor Vehicle Theft (any time)
   Theft from Vehicle (any time)
   ```
4. User can select "Motor Vehicle Theft (any time)" to filter data (data query still respects time window, only the list source is unfiltered)

---

## P1: Add Helpful CTA for Empty Results

### Goal
When drilldown returns 0 codes, suggest user action to fix.

### Patch

**File**: `src/ui/panel.js`
**Location**: Line 98 (empty state message)

```diff
  if (availableCodes.length === 0) {
-   fineSel.innerHTML = '<option disabled>No sub-codes in this window</option>';
+   fineSel.innerHTML = '<option disabled>No sub-codes in this window. Try expanding time range.</option>';
  }
```

**Rationale**: Users may not realize their 3-month window is too narrow. This hint guides them to widen the time window.

---

## P1: Guarantee Drilldown Override Consistency

### Goal
Ensure all 8 SQL builders use `drilldownCodes` when present (already implemented, verify).

### Verification Checklist

**File**: `src/utils/sql.js`

All builders updated in previous implementation:
- ✅ `buildCrimePointsSQL` (line 72)
- ✅ `buildMonthlyCitySQL` (line 100)
- ✅ `buildMonthlyBufferSQL` (line 124-130)
- ✅ `buildHeatmap7x24SQL` (line 189-195)
- ✅ `buildByDistrictSQL` (line 220)
- ✅ `buildTopTypesDistrictSQL` (line 237)
- ✅ `buildHeatmap7x24DistrictSQL` (line 255)
- ✅ `buildCountBufferSQL` (line 289)

**Base Function**: [sql.js:353-374](../src/utils/sql.js#L353-L374)
```javascript
function baseTemporalClauses(startIso, endIso, types, { includeTypes = true, drilldownCodes } = {}) {
  const clauses = [
    "WHERE dispatch_date_time >= '2015-01-01'",
    `  AND dispatch_date_time >= '${startIso}'`,
    `  AND dispatch_date_time < '${endIso}'`,
  ];

  if (includeTypes) {
    // Drilldown codes override parent group types
    const codes = (drilldownCodes && drilldownCodes.length > 0) ? drilldownCodes : types;
    const sanitizedTypes = sanitizeTypes(codes);
    if (sanitizedTypes.length > 0) {
      clauses.push(
        `  AND text_general_code IN (${sanitizedTypes
          .map((value) => `'${value}'`)
          .join(", ")})`
      );
    }
  }
  return clauses;
}
```

**Status**: ✅ Already implemented correctly. No changes needed.

---

## P1: Add Distinct Error vs. Empty States

### Goal
Distinguish between network errors and legitimately empty results.

### Current State (Already Correct)

**File**: [panel.js:105-108](../src/ui/panel.js#L105-L108)
```javascript
catch (err) {
  console.warn('Failed to fetch available codes:', err);
  fineSel.innerHTML = '<option disabled>Error loading codes</option>';
}
```

**Empty Result**: "No sub-codes in this window"
**Network Error**: "Error loading codes"

**Status**: ✅ Already implemented. No changes needed.

---

## P2: Add Visual Indicator for Drilldown Override

### Goal
Show user when drilldown is active (overriding parent groups).

### Patch

**File**: `src/ui/panel.js`
**Location**: After drilldown selection (line 112-117)

```diff
  fineSel?.addEventListener('change', () => {
    const codes = Array.from(fineSel.selectedOptions).map((o) => o.value);
    store.selectedDrilldownCodes = codes; // Drilldown overrides parent groups
+   // Add visual indicator near group select
+   const groupLabel = document.querySelector('label[for="groupSel"]');
+   if (groupLabel && codes.length > 0) {
+     groupLabel.innerHTML = `Offense Groups <span style="color:#3b82f6;font-size:11px;">(${codes.length} drilldown active)</span>`;
+   } else if (groupLabel) {
+     groupLabel.textContent = 'Offense Groups';
+   }
    onChange();
  });
```

**Also update group change handler** to clear indicator:
```diff
  groupSel?.addEventListener('change', async () => {
    const values = Array.from(groupSel.selectedOptions).map((o) => o.value);
    store.selectedGroups = values;
    store.selectedDrilldownCodes = []; // Clear drilldown when parent groups change
+   // Clear drilldown indicator
+   const groupLabel = document.querySelector('label[for="groupSel"]');
+   if (groupLabel) groupLabel.textContent = 'Offense Groups';

    // ... rest of handler
  });
```

**Result**: Label shows "Offense Groups (2 drilldown active)" when drilldown codes are selected.

---

## Acceptance Tests

### Test 1: Basic Drilldown Population ✅

**Steps**:
1. Open dashboard, ensure no offense groups selected
2. Drilldown shows: "Select a group first" (disabled)
3. Select "Vehicle" group
4. Wait ~1s (API call)
5. Drilldown populates with 2 options: "Motor Vehicle Theft", "Theft from Vehicle"

**Expected**: ✅ List populated with available codes

**SQL Verification**:
```sql
SELECT DISTINCT text_general_code
FROM incidents_part1_part2
WHERE dispatch_date_time >= '2024-01-01'
  AND dispatch_date_time < '2025-01-01'
  AND text_general_code IN ('Motor Vehicle Theft', 'Theft from Vehicle')
ORDER BY text_general_code
```

**Expected Response**: 2 rows (assuming data exists in 2024)

---

### Test 2: Drilldown Filters Data ✅

**Steps**:
1. Select "Vehicle" group (2 codes)
2. From drilldown, select only "Motor Vehicle Theft"
3. Observe map points, choropleth, and charts

**Expected**: All data views show **only** Motor Vehicle Theft incidents (Theft from Vehicle excluded)

**SQL Sample** (points):
```sql
SELECT the_geom, dispatch_date_time, text_general_code
FROM incidents_part1_part2
WHERE dispatch_date_time >= '2024-01-01'
  AND dispatch_date_time < '2025-01-01'
  AND text_general_code IN ('Motor Vehicle Theft')  -- Drilldown overrides parent group
```

---

### Test 3: Empty Window Handling ✅

**Steps**:
1. Set time window to very narrow range (e.g., 2025-01-01 to 2025-01-31)
2. Select any offense group
3. Observe drilldown list

**Expected**: Shows "No sub-codes in this window. Try expanding time range."

**With Fallback (P1 implemented)**:
```
No sub-codes in this window. Try expanding time range.
── Show all (ignoring time) ──
Aggravated Assault Firearm (any time)
Aggravated Assault No Firearm (any time)
```

---

### Test 4: Cache Invalidation ✅

**Steps**:
1. Select "Property" group (drilldown populates)
2. Change time window to different range
3. Observe drilldown list

**Expected**: List **does NOT auto-refresh** (requires re-selecting parent group)

**Workaround**: Clear `store.selectedDrilldownCodes` when time window changes

**Optional Enhancement** (not required for P0):
```diff
  startMonth?.addEventListener('change', () => {
    store.startMonth = startMonth.value || null;
+   store.selectedDrilldownCodes = []; // Clear drilldown on time change
+   if (store.selectedGroups.length > 0) {
+     // Trigger drilldown refresh by re-firing group change event
+     groupSel.dispatchEvent(new Event('change'));
+   }
    onChange();
  });
```

---

### Test 5: Drilldown Override Verified Across All Charts ✅

**Steps**:
1. Select "Vehicle" group
2. From drilldown, select "Motor Vehicle Theft"
3. Check SQL for all charts:
   - Monthly line (city + buffer)
   - Top-N bar
   - 7×24 heatmap

**Expected**: All SQL queries use `IN ('Motor Vehicle Theft')`, **not** `IN ('Motor Vehicle Theft', 'Theft from Vehicle')`

**Verification**: Check browser dev console network tab or logs/queries_*.log for SQL containing `text_general_code IN`

---

## Pseudo-Diff Summary

### P0: Critical Fix (REQUIRED)

**src/api/crime.js:223**
```diff
- const endIso = start;
+ const endIso = end;
```

### P1: Enhanced UX (RECOMMENDED)

**src/ui/panel.js:98** (empty state message)
```diff
- fineSel.innerHTML = '<option disabled>No sub-codes in this window</option>';
+ fineSel.innerHTML = '<option disabled>No sub-codes in this window. Try expanding time range.</option>';
```

**src/ui/panel.js:98-110** (fallback option)
```diff
  if (availableCodes.length === 0) {
    fineSel.innerHTML = '<option disabled>No sub-codes in this window. Try expanding time range.</option>';
+   const allCodes = getCodesForGroups(values);
+   if (allCodes.length > 0) {
+     const hint = document.createElement('option');
+     hint.disabled = true;
+     hint.textContent = '── Show all (ignoring time) ──';
+     fineSel.appendChild(hint);
+     for (const c of allCodes) {
+       const opt = document.createElement('option');
+       opt.value = c;
+       opt.textContent = c + ' (any time)';
+       fineSel.appendChild(opt);
+     }
+   }
  }
```

### P2: Visual Indicator (OPTIONAL)

**src/ui/panel.js:115** (drilldown change handler)
```diff
  fineSel?.addEventListener('change', () => {
    const codes = Array.from(fineSel.selectedOptions).map((o) => o.value);
    store.selectedDrilldownCodes = codes;
+   const groupLabel = document.querySelector('label[for="groupSel"]');
+   if (groupLabel && codes.length > 0) {
+     groupLabel.innerHTML = `Offense Groups <span style="color:#3b82f6;font-size:11px;">(${codes.length} drilldown active)</span>`;
+   } else if (groupLabel) {
+     groupLabel.textContent = 'Offense Groups';
+   }
    onChange();
  });
```

**src/ui/panel.js:80** (group change handler)
```diff
  store.selectedDrilldownCodes = [];
+ const groupLabel = document.querySelector('label[for="groupSel"]');
+ if (groupLabel) groupLabel.textContent = 'Offense Groups';
```

---

## Files to Modify

| File | Changes | Lines | Priority |
|------|---------|-------|----------|
| **src/api/crime.js** | Fix typo: `endIso = end` | 223 | P0 |
| **src/ui/panel.js** | Enhanced empty states + fallback | 98-110 | P1 |
| **src/ui/panel.js** | Visual indicator for drilldown | 80, 115 | P2 |

---

## Estimated Effort

- **P0 Fix**: 1 minute (1-character change)
- **P1 Enhancements**: 15 minutes (empty state messages + fallback option)
- **P2 Visual Indicator**: 10 minutes (label updates)

**Total**: ~25 minutes for full implementation

---

## Post-Fix Verification

### Quick Smoke Test

1. Clear browser cache / sessionStorage (to invalidate cached empty results)
2. Select "Vehicle" group
3. Confirm drilldown shows: "Motor Vehicle Theft", "Theft from Vehicle"
4. Select "Motor Vehicle Theft" only
5. Verify map points show only motor vehicle thefts (not regular thefts)

### Full Acceptance

Run all 5 acceptance tests listed above. All should pass.

---

## Rollback Plan

If P1/P2 enhancements cause issues, rollback is simple:
```bash
git revert <commit-hash>
```

P0 fix has **zero risk** — it's a simple typo correction with no side effects.

---

## Related Issues

- **Cache TTL**: Consider reducing `cacheTTL` from 60s to 30s in crime.js:241 for more responsive list updates
- **Time Window Auto-Refresh**: Currently drilldown list doesn't auto-refresh when time window changes (requires re-selecting parent group)

See [docs/KNOWN_ISSUES.md](KNOWN_ISSUES.md) for tracking.
