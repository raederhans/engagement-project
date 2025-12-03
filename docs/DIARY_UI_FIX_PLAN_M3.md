# Diary UI Fix Plan - M3 Iteration

**Date:** 2025-11-17
**Status:** Ready for Implementation (Agent-I/Codex)
**Diagnosis:** See [logs/AGENTM_DIARY_UI_DIAGNOSIS_20251117T021840.md](../logs/AGENTM_DIARY_UI_DIAGNOSIS_20251117T021840.md)

---

## Overview

This plan addresses three UI issues in the Diary feature:

1. **Segment Detail Cards** - Convert from hover-based to click-based persistence with map focusing
2. **Rating Modal** - Fix z-index to make modal interactive
3. **Diary Panel Controls** - Add playback speed, demo period, and other controls

---

## Section 1: Segment Card Improvements

### Goal
Transform segment hover cards into persistent, interactive click-based cards with map centering and improved content layout.

### Current Behavior (Broken)
- Hover over segment → card appears
- Move mouse away → card disappears immediately
- Cannot click buttons in card
- No map focusing

### Target Behavior (Fixed)
- Click segment → card appears and stays open
- Map smoothly pans/zooms to center the segment
- Card remains open until:
  - User clicks close button (×), OR
  - User clicks map background, OR
  - User clicks another segment
- "Agree 👍" and "Feels safer ✨" buttons are clickable
- Content is bounded with scroll if needed

### Implementation Changes

**File:** [src/map/segments_layer.js](../src/map/segments_layer.js)

#### Task 1.1: Add Click Handler (Replace Hover)

**Location:** Lines 142-184 (`registerHoverHandlers` function)

**Current Code:**
```javascript
function registerHoverHandlers(map, layerId) {
  // ...
  const moveHandler = (event) => { /* ... */ };
  const leaveHandler = () => { /* ... */ };

  map.on('mousemove', layerId, moveHandler);
  map.on('mouseleave', layerId, leaveHandler);
}
```

**New Code:**
```javascript
function registerClickHandlers(map, layerId) {
  cleanupClickHandlers(map, layerId);
  if (!map || !layerId) return;

  let activePopup = null;
  let activeSegmentId = null;

  const clickHandler = (event) => {
    const feature = event.features && event.features[0];
    if (!feature) return;

    const props = feature.properties || {};
    const segmentId = props.segment_id;

    // If clicking same segment, do nothing (keep popup open)
    if (segmentId === activeSegmentId && activePopup) {
      return;
    }

    // Close existing popup if different segment
    if (activePopup) {
      activePopup.remove();
      activePopup = null;
      activeSegmentId = null;
    }

    // Focus on the segment (pan + zoom)
    focusSegment(map, feature);

    // Create new popup with close button
    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      className: 'diary-segment-card-pinned',
      offset: 12,
      maxWidth: '280px',
    });

    const html = buildSegmentCardHtml(props);
    popup.setLngLat(event.lngLat).setHTML(html).addTo(map);

    wirePopupInteractions(popup);

    activePopup = popup;
    activeSegmentId = segmentId;

    // Close popup when it's manually closed
    popup.on('close', () => {
      activePopup = null;
      activeSegmentId = null;
    });
  };

  // Close popup when clicking map background
  const mapClickHandler = (event) => {
    // Check if click hit the segment layer
    const features = map.queryRenderedFeatures(event.point, { layers: [layerId] });
    if (features.length === 0 && activePopup) {
      activePopup.remove();
      activePopup = null;
      activeSegmentId = null;
    }
  };

  map.on('click', layerId, clickHandler);
  map.on('click', mapClickHandler);

  clickRegistrations.set(layerId, { clickHandler, mapClickHandler, popup: () => activePopup });
}
```

**Changes:**
1. Rename function to `registerClickHandlers`
2. Replace `mousemove`/`mouseleave` with `click` events
3. Add state tracking: `activePopup`, `activeSegmentId`
4. Add map click handler to close popup when clicking background
5. Call `focusSegment()` to pan/zoom map
6. Set `closeButton: true` for built-in close button
7. Add `maxWidth: '280px'` to prevent overflow

#### Task 1.2: Implement Focus Function

**Location:** Add new function before `registerClickHandlers`

**New Code:**
```javascript
/**
 * Focus map on a segment (pan + zoom)
 * @param {MapLibreMap} map - MapLibre map instance
 * @param {GeoJSONFeature} feature - Segment feature
 */
function focusSegment(map, feature) {
  if (!map || !feature || !feature.geometry) return;

  const geometry = feature.geometry;

  if (geometry.type === 'LineString' && geometry.coordinates.length > 0) {
    // Calculate bounds of the line
    const coords = geometry.coordinates;
    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);

    const bounds = [
      [Math.min(...lngs), Math.min(...lats)], // Southwest
      [Math.max(...lngs), Math.max(...lats)], // Northeast
    ];

    // Fit bounds with padding
    map.fitBounds(bounds, {
      padding: { top: 100, bottom: 100, left: 100, right: 100 },
      maxZoom: 16,
      duration: 600,
    });
  } else if (geometry.type === 'Point') {
    // Center on point
    map.flyTo({
      center: geometry.coordinates,
      zoom: 16,
      duration: 600,
    });
  }
}
```

**Purpose:** Smoothly pan and zoom map to center the clicked segment.

#### Task 1.3: Update Popup HTML Builder

**Location:** Lines 219-259 (`buildHoverHtml` function)

**Changes:**
1. Rename to `buildSegmentCardHtml`
2. Add `max-height` and `overflow-y` for content scrolling
3. Keep existing structure (street, metrics, tags, CTAs)

**Updated Code:**
```javascript
function buildSegmentCardHtml(props) {
  // ... existing metric calculations (lines 220-225) ...

  return `
    <div style="max-width:280px;max-height:400px;overflow-y:auto;font:12px/1.4 system-ui;color:#111;">
      <div style="font-weight:600;margin-bottom:4px;position:sticky;top:0;background:#fff;padding-bottom:4px;">${street}</div>
      <!-- ... rest of existing HTML unchanged ... -->
    </div>
  `;
}
```

**Changes:**
- Add `max-width: 280px` (prevents excessive width)
- Add `max-height: 400px` (prevents tall cards on small screens)
- Add `overflow-y: auto` (scrollable if content exceeds max-height)
- Make street name sticky (stays visible while scrolling)

#### Task 1.4: Update Cleanup Function

**Location:** Lines 187-194 (`cleanupHoverHandlers` function)

**Changes:**
1. Rename to `cleanupClickHandlers`
2. Update to remove click handlers
3. Update registrations map name

**Updated Code:**
```javascript
const clickRegistrations = new Map(); // Replace hoverRegistrations

function cleanupClickHandlers(map, layerId) {
  const entry = clickRegistrations.get(layerId);
  if (!entry || !map) return;

  map.off('click', layerId, entry.clickHandler);
  map.off('click', entry.mapClickHandler);

  const popup = entry.popup?.();
  if (popup) popup.remove();

  clickRegistrations.delete(layerId);
}
```

#### Task 1.5: Update Mount Function Call

**Location:** Line 46 (`mountSegmentsLayer` function)

**Change:**
```javascript
// OLD:
registerHoverHandlers(map, hitLayerId);

// NEW:
registerClickHandlers(map, hitLayerId);
```

#### Task 1.6: Update Remove Function Call

**Location:** Line 80 (`removeSegmentsLayer` function)

**Change:**
```javascript
// OLD:
cleanupHoverHandlers(map, hitLayerId);

// NEW:
cleanupClickHandlers(map, hitLayerId);
```

### Acceptance Criteria - Segment Cards

- [ ] Clicking a segment opens a persistent card
- [ ] Map smoothly pans/zooms to center the segment (600ms animation)
- [ ] Card stays open until user closes it (X button, background click, or new segment click)
- [ ] "Agree 👍" and "Feels safer ✨" buttons are clickable
- [ ] Card has close button (built-in MapLibre × button)
- [ ] Card respects max-width (280px) and max-height (400px)
- [ ] Long content scrolls instead of overflowing
- [ ] Clicking another segment closes current card and opens new one
- [ ] Clicking map background closes active card
- [ ] No console errors

### Open Questions

1. **Hover Preview:** Should we keep a lightweight hover preview in addition to click-to-pin?
   - **Option A:** Remove hover entirely, click-only
   - **Option B:** Keep hover for street name tooltip, click for full card
   - **Recommendation:** Option A (simpler, less conflicting behavior)

2. **Multiple Cards:** Should users be able to open multiple segment cards at once?
   - **Option A:** Only one card at a time (current plan)
   - **Option B:** Allow multiple, each with its own close button
   - **Recommendation:** Option A (cleaner, less cluttered)

---

## Section 2: Rating Modal Interactivity

### Goal
Fix z-index stacking order so the rating modal is interactive and all form elements respond to user input.

### Current Behavior (Broken)
- Click "Rate this route" → modal appears
- Modal looks correct but is completely non-interactive
- Clicking stars, tags, dropdowns does nothing
- Screen is heavily dimmed
- **Root Cause:** Backdrop (z-index: 2500) covers modal (z-index: auto/0)

### Target Behavior (Fixed)
- Click "Rate this route" → modal appears, fully interactive
- Light dim overlay behind modal (rgba(15, 23, 42, 0.32) is fine)
- User can:
  - Click stars (1-5) to rate
  - Click tag chips to select/deselect (up to 3)
  - Use "More tags" dropdown to add tags
  - Check segment override boxes
  - Change segment override ratings
  - Type in notes textarea
  - Click "Submit rating" or "Cancel"
  - Click × to close
  - Press ESC to close

### Implementation Changes

**File:** [src/routes_diary/form_submit.js](../src/routes_diary/form_submit.js)

#### Task 2.1: Fix Modal Z-Index (CRITICAL - 1 Line Change)

**Location:** Lines 78-92 (`.diary-modal-card` CSS in `injectModalStyles()`)

**Current Code:**
```javascript
.diary-modal-card {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 30px 70px rgba(15, 23, 42, 0.35);
  border: 1px solid #e2e8f0;
  width: min(540px, 92vw);
  max-height: 82vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 24px;
  font: 14px/1.45 "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #0f172a;
  position: relative;
}
```

**Fixed Code:**
```javascript
.diary-modal-card {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 30px 70px rgba(15, 23, 42, 0.35);
  border: 1px solid #e2e8f0;
  width: min(540px, 92vw);
  max-height: 82vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 24px;
  font: 14px/1.45 "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #0f172a;
  position: relative;
  z-index: 2501;  /* ← ADD THIS LINE */
}
```

**Change:** Add `z-index: 2501;` on line 92 (after `position: relative;`)

**Why This Works:**
- Backdrop has `z-index: 2500` (line 76)
- Modal now has `z-index: 2501` (higher than backdrop)
- Modal will render above backdrop, making all elements clickable
- Backdrop still catches clicks outside modal to dismiss (line 131)

**Impact:** Immediately fixes all modal interactivity issues.

### Acceptance Criteria - Rating Modal

- [ ] Modal appears centered and fully interactive
- [ ] Clicking stars changes rating (stars turn gold)
- [ ] Clicking tag chips toggles selection (background changes black/white)
- [ ] Tag chip selection respects 3-tag limit (error message if exceeded)
- [ ] "More tags" dropdown is clickable and adds tags to selection
- [ ] Segment override checkboxes enable/disable rating dropdowns
- [ ] Segment override rating dropdowns change values
- [ ] Notes textarea accepts typed input
- [ ] "Submit rating" button submits form (console logs payload)
- [ ] "Cancel" button closes modal
- [ ] × close button works
- [ ] ESC key closes modal
- [ ] Clicking backdrop (outside modal) closes modal
- [ ] No console errors
- [ ] Build passes: `npm run build`

### Testing Steps

**Quick Verification (2 minutes):**
1. Start dev server: `npm run dev`
2. Visit `http://localhost:5173/?mode=diary`
3. Select a demo route (e.g., "Route A")
4. Click "Rate this route" button
5. **Test interactivity:**
   - Click star 4 → all stars 1-4 should turn gold
   - Click "poor_lighting" chip → should turn black background, white text
   - Click "poor_lighting" again → should turn white background, black text
   - Open "More tags" dropdown → should show remaining tags
   - Select "speeding_cars" from dropdown → should add to chips
   - Check first segment override checkbox → rating dropdown should enable
   - Change segment override rating to 5★ → dropdown should show 5★
   - Type "Test note" in notes textarea → text should appear
6. Click "Cancel" → modal should close
7. Repeat test with "Submit rating" → should see console log with payload

**Expected Console Output:**
```
[Diary] submit payload {route_id: "route_a", segment_ids: [...], overall_rating: 4, tags: ["poor_lighting", "speeding_cars"], ...}
[Diary] stub response {success: true, message: "Diary submission received (demo mode)"}
```

### Open Questions

**None** - This is a straightforward z-index fix with no tradeoffs.

---

## Section 3: New Diary Panel Controls

### Goal
Add new controls to the Diary panel for playback speed, demo period selection, and future features, without wiring to backend yet.

### Current Panel State

**File:** [src/routes_diary/index.js](../src/routes_diary/index.js) - Lines 354-452

**Existing Controls:**
1. Title: "Route Safety Diary (demo)"
2. Route picker dropdown (5 demo routes)
3. Summary strip (route details)
4. Alternative route toggle
5. Alternative summary strip
6. Simulator controls (Play/Pause/Finish)
7. Rate button

**Missing:**
- Playback speed selector
- Demo period/time window selector
- History & saved routes entry point
- Additional contextual controls

### New Controls Specification

#### Control 3.1: Playback Speed Selector

**Label:** "Playback speed"
**Type:** Segmented button group (3 options)
**Options:**
- 0.5× (half speed)
- 1× (normal speed, default)
- 2× (double speed)

**Visual:**
```
Playback speed
[0.5×] [1×] [2×]  ← buttons side by side, active one has dark background
```

**State:** `store.simPlaybackSpeed` (number: 0.5, 1, or 2)
**Default:** 1
**Behavior:** Click button → update store, log to console
**No Backend:** Just update state for now

**Implementation:**
```javascript
// After simulator controls section
const speedLabel = document.createElement('div');
speedLabel.textContent = 'Playback speed';
speedLabel.style.fontSize = '12px';
speedLabel.style.textTransform = 'uppercase';
speedLabel.style.letterSpacing = '0.05em';
speedLabel.style.color = '#64748b';
speedLabel.style.marginTop = '12px';
speedLabel.style.marginBottom = '4px';
diaryPanelEl.appendChild(speedLabel);

const speedGroup = document.createElement('div');
speedGroup.style.display = 'flex';
speedGroup.style.gap = '6px';

const speeds = [0.5, 1, 2];
const speedButtons = speeds.map((speed) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = `${speed}×`;
  btn.style.flex = '1';
  btn.style.padding = '6px 10px';
  btn.style.border = '1px solid #cbd5e1';
  btn.style.borderRadius = '8px';
  btn.style.fontSize = '13px';
  btn.style.cursor = 'pointer';
  btn.style.background = speed === (store.simPlaybackSpeed || 1) ? '#0f172a' : '#fff';
  btn.style.color = speed === (store.simPlaybackSpeed || 1) ? '#fff' : '#0f172a';

  btn.addEventListener('click', () => {
    store.simPlaybackSpeed = speed;
    console.info('[Diary] playback speed changed:', speed);
    speedButtons.forEach((b, idx) => {
      b.style.background = speeds[idx] === speed ? '#0f172a' : '#fff';
      b.style.color = speeds[idx] === speed ? '#fff' : '#0f172a';
    });
  });

  speedGroup.appendChild(btn);
  return btn;
});

diaryPanelEl.appendChild(speedGroup);
```

#### Control 3.2: Demo Period Selector

**Label:** "Demo time window"
**Type:** Dropdown/select
**Options:**
- "Single day" (default)
- "Last 7 days"
- "Last 30 days"

**Visual:**
```
Demo time window
[Single day ▼]  ← dropdown
```

**State:** `store.diaryDemoPeriod` (string: "day", "week", "month")
**Default:** "day"
**Behavior:** Change selection → update store, log to console
**Purpose:** Simulate different rating aggregation time windows

**Implementation:**
```javascript
const periodLabel = document.createElement('div');
periodLabel.textContent = 'Demo time window';
periodLabel.style.fontSize = '12px';
periodLabel.style.textTransform = 'uppercase';
periodLabel.style.letterSpacing = '0.05em';
periodLabel.style.color = '#64748b';
periodLabel.style.marginTop = '12px';
periodLabel.style.marginBottom = '4px';
diaryPanelEl.appendChild(periodLabel);

const periodSelect = document.createElement('select');
periodSelect.style.width = '100%';
periodSelect.style.padding = '6px 10px';
periodSelect.style.border = '1px solid #cbd5e1';
periodSelect.style.borderRadius = '8px';
periodSelect.style.fontSize = '13px';

const periods = [
  { value: 'day', label: 'Single day' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
];

periods.forEach((period) => {
  const option = document.createElement('option');
  option.value = period.value;
  option.textContent = period.label;
  if (period.value === (store.diaryDemoPeriod || 'day')) {
    option.selected = true;
  }
  periodSelect.appendChild(option);
});

periodSelect.addEventListener('change', () => {
  store.diaryDemoPeriod = periodSelect.value;
  console.info('[Diary] demo period changed:', periodSelect.value);
});

diaryPanelEl.appendChild(periodSelect);
```

#### Control 3.3: Time-of-Day Filter (Optional)

**Label:** "Filter by time of day"
**Type:** Dropdown/select
**Options:**
- "All hours" (default)
- "Daytime (6am-6pm)"
- "Evening (6pm-10pm)"
- "Night (10pm-6am)"

**State:** `store.diaryTimeFilter` (string: "all", "day", "evening", "night")
**Default:** "all"
**Purpose:** Filter segment ratings by time context

**Implementation:** (Similar to period selector above)

#### Control 3.4: History & Routes Entry Point

**Label:** None (just button text)
**Type:** Button (disabled for now)
**Text:** "My routes & history"
**Icon:** Optional (e.g., 📁 or folder icon)

**Visual:**
```
[📁 My routes & history] ← grayed out, disabled
```

**State:** None (just a placeholder button)
**Behavior:** Disabled (`disabled` attribute)
**Title:** "Coming soon - view your saved routes"
**Future:** Links to My Routes view (M4+ scope)

**Implementation:**
```javascript
const historyBtn = document.createElement('button');
historyBtn.type = 'button';
historyBtn.textContent = '📁 My routes & history';
historyBtn.disabled = true;
historyBtn.title = 'Coming soon - view your saved routes';
historyBtn.style.width = '100%';
historyBtn.style.padding = '10px 12px';
historyBtn.style.border = '1px solid #e2e8f0';
historyBtn.style.borderRadius = '8px';
historyBtn.style.background = '#f8fafc';
historyBtn.style.color = '#94a3b8';
historyBtn.style.cursor = 'not-allowed';
historyBtn.style.fontSize = '13px';
historyBtn.style.marginTop = '12px';
diaryPanelEl.appendChild(historyBtn);
```

### Panel Layout

**Recommended Structure:**
```
[Existing - Top]
- Title: "Route Safety Diary (demo)"
- Route picker dropdown
- Summary strip
- Alt toggle + alt summary

[Separator]

[New Controls Section]
- Playback speed (inline buttons)
- Demo period dropdown
- Time filter dropdown (optional)

[Separator]

[Existing - Bottom]
- Simulator controls (Play/Pause/Finish)
- Rate button

[Separator]

[New Entry Point]
- History & routes button (disabled)
```

**Visual Separators:**
```javascript
const separator = document.createElement('div');
separator.style.height = '1px';
separator.style.background = '#e2e8f0';
separator.style.margin = '12px 0';
diaryPanelEl.appendChild(separator);
```

### Panel Height Management

**Current:** `minHeight: '220px'` (line 400)
**With New Controls:** Estimated ~400-500px

**Solutions:**
1. **Add scrolling:** `max-height: 80vh; overflow-y: auto;`
2. **Compact layout:** Smaller gaps, tighter spacing
3. **Collapsible sections:** (Advanced, M4+ scope)

**Recommended:**
```javascript
// Update panel styles (line 394-402)
panel.style.maxHeight = '82vh';
panel.style.overflowY = 'auto';
```

### Store Changes Required

**File:** [src/state/store.js](../src/state/store.js)

Add new properties to store initialization:

```javascript
// Add after existing Diary state properties
simPlaybackSpeed: 1,           // 0.5, 1, or 2
diaryDemoPeriod: 'day',        // 'day', 'week', 'month'
diaryTimeFilter: 'all',        // 'all', 'day', 'evening', 'night'
```

**No persistence needed yet** - these are in-memory only for M3.

### Acceptance Criteria - Panel Controls

- [ ] Playback speed selector renders with 3 buttons (0.5×, 1×, 2×)
- [ ] Clicking speed button updates `store.simPlaybackSpeed` and logs to console
- [ ] Active speed button has dark background, inactive buttons have white
- [ ] Demo period dropdown renders with 3 options
- [ ] Changing period updates `store.diaryDemoPeriod` and logs to console
- [ ] Time filter dropdown renders (optional)
- [ ] History button renders, is disabled, and shows "Coming soon" tooltip
- [ ] Controls are separated by visual dividers (horizontal lines)
- [ ] Panel scrolls if content exceeds viewport height
- [ ] Panel does not break on small screens (768p)
- [ ] Crime mode unaffected (controls only appear in Diary mode)
- [ ] No console errors
- [ ] Build passes: `npm run build`

### Testing Steps

1. Start dev server: `npm run dev`
2. Visit `http://localhost:5173/?mode=diary`
3. Open browser DevTools console
4. **Test playback speed:**
   - Click "0.5×" → console should show `[Diary] playback speed changed: 0.5`
   - Button should have dark background, others white
   - Click "2×" → console should show `[Diary] playback speed changed: 2`
5. **Test demo period:**
   - Change dropdown to "Last 7 days" → console should show `[Diary] demo period changed: week`
6. **Test history button:**
   - Hover over button → tooltip should show "Coming soon - view your saved routes"
   - Click button → nothing happens (disabled)
7. **Test panel scroll:**
   - Resize browser to 768px height
   - Panel should scroll if content exceeds height
8. **Test Crime mode:**
   - Switch to Crime mode
   - New controls should not appear (only in Diary panel)

### Open Questions

1. **Icon Libraries:** Should we use Lucide icons or stick with emojis?
   - **Option A:** Emojis (no dependency, current approach)
   - **Option B:** Lucide icons (cleaner, but adds dependency)
   - **Recommendation:** Option A for M3 (avoid new deps)

2. **Playback Speed Application:** Should speed changes apply to active simulator?
   - **Option A:** Only apply on next Play press
   - **Option B:** Apply immediately to running simulator
   - **Recommendation:** Option B (better UX, but requires simulator refactor)
   - **M3 Scope:** Option A (simpler, no backend changes)

3. **Panel Collapsing:** Should controls be grouped into collapsible sections?
   - **Option A:** All controls always visible (current plan)
   - **Option B:** Collapsible "Advanced settings" section
   - **Recommendation:** Option A for M3, Option B for M4 if panel gets too tall

---

## Implementation Priority

### P0 - Critical (Must fix immediately)
1. **Rating Modal Z-Index** (Section 2, Task 2.1)
   - Effort: 5 minutes
   - Impact: Unblocks rating submissions
   - Risk: None

### P1 - High (Should fix next)
2. **Segment Card Click-to-Pin** (Section 1, All Tasks)
   - Effort: 1-2 hours
   - Impact: Makes segment CTAs usable
   - Risk: Low (isolated change)

### P2 - Medium (Nice to have for M3)
3. **Panel Controls** (Section 3, All Tasks)
   - Effort: 2-3 hours
   - Impact: Enhanced testing/demo capabilities
   - Risk: Low (UI only, no backend)

---

## Testing Checklist

### After Each Section

**Section 1 - Segment Cards:**
- [ ] Click segment → card appears and stays
- [ ] Map centers on segment smoothly
- [ ] Card buttons ("Agree", "Feels safer") are clickable
- [ ] Close button (×) works
- [ ] Background click closes card
- [ ] New segment click closes old card, opens new

**Section 2 - Rating Modal:**
- [ ] Modal opens when "Rate this route" clicked
- [ ] All form elements interactive (stars, chips, dropdowns, checkboxes)
- [ ] Form validation works (tag limit, required fields)
- [ ] Submit logs payload to console
- [ ] Cancel/×/ESC closes modal

**Section 3 - Panel Controls:**
- [ ] Speed buttons toggle correctly
- [ ] Period dropdown updates state
- [ ] History button is disabled
- [ ] Console logs show state changes
- [ ] Panel scrolls on small screens

### Full Integration Test

After all sections complete:
- [ ] Start fresh dev server
- [ ] Visit Diary mode
- [ ] Select route → see summary
- [ ] Toggle alt route → see benefit
- [ ] Change speed → log shows change
- [ ] Change period → log shows change
- [ ] Click segment → card appears, map centers
- [ ] Click "Agree" in card → CTA recorded
- [ ] Click "Rate this route" → modal opens
- [ ] Fill form → submit → see console log
- [ ] Click Play simulator → route animates
- [ ] Switch to Crime mode → all Diary UI clears
- [ ] Switch back to Diary → all features work again
- [ ] No console errors at any point
- [ ] `npm run build` passes

---

## File Summary

### Files to Modify

1. **[src/map/segments_layer.js](../src/map/segments_layer.js)** - Section 1 (Segment Cards)
   - Replace hover handlers with click handlers
   - Add focus function
   - Update popup HTML
   - Update cleanup

2. **[src/routes_diary/form_submit.js](../src/routes_diary/form_submit.js)** - Section 2 (Modal Fix)
   - Add z-index to modal CSS (1 line)

3. **[src/routes_diary/index.js](../src/routes_diary/index.js)** - Section 3 (Panel Controls)
   - Add playback speed selector
   - Add demo period dropdown
   - Add time filter (optional)
   - Add history button

4. **[src/state/store.js](../src/state/store.js)** - Section 3 (Store State)
   - Add `simPlaybackSpeed`, `diaryDemoPeriod`, `diaryTimeFilter`

5. **[docs/CHANGELOG.md](../docs/CHANGELOG.md)** - All Sections
   - Add entry for M3 UI improvements

### Files to Read (Reference)

- **[Routesafetydiaryui/src/components/LeftPanel.tsx](../Routesafetydiaryui/src/components/LeftPanel.tsx)** - Panel layout reference
- **[logs/AGENTM_DIARY_UI_DIAGNOSIS_20251117T021840.md](../logs/AGENTM_DIARY_UI_DIAGNOSIS_20251117T021840.md)** - Detailed diagnosis

---

## Success Criteria

This implementation is successful when:

1. **Segment cards are fully functional:**
   - Click-based persistence
   - Map focusing works
   - CTAs are clickable
   - Close mechanisms work

2. **Rating modal is fully interactive:**
   - All form elements respond
   - Validation works
   - Submit succeeds
   - Console shows no errors

3. **Panel has new controls:**
   - Speed selector works
   - Period dropdown works
   - History button is visible (disabled)
   - Layout is clean and scrollable

4. **No regressions:**
   - Crime mode unaffected
   - Build passes
   - Existing Diary features work
   - Console has no errors

---

**Plan Approved By:** Agent-M (Manager-Fixes-Allowed Mode)
**Ready for:** Agent-I (Codex Implementation)
**Timestamp:** 2025-11-17T02:18:40Z
