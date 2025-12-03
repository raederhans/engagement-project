# Agent-M Diagnosis Log: Diary UI Issues

**Date:** 2025-11-17T02:18:40Z
**Branch:** feat/diary-phase4-cta-state
**Agent:** Agent-M (Manager-Fixes-Allowed Mode)
**Task:** Diagnose segment card and rating modal UI issues

---

## Executive Summary

Three primary issues identified in the Diary UI:

1. **Segment Detail Cards:** Disappear on mouse move due to hover-based implementation instead of click-based persistence
2. **Rating Modal:** Non-interactive due to missing z-index causing backdrop to cover modal
3. **Panel Controls:** Current panel lacks additional controls specified in requirements (playback speed, period selector, history entry point)

All issues have clear root causes and straightforward fixes.

---

## Issue 1: Segment Detail Card Disappearing Behavior

### Current Behavior

**Symptom:**
- User hovers over a segment → hover card appears
- User moves mouse away from segment → card immediately disappears
- Card does not persist, cannot be interacted with
- No segment focusing or map centering occurs

### Root Cause Analysis

**File:** [src/map/segments_layer.js](../src/map/segments_layer.js)

**Lines 142-184:** Hover handler registration

```javascript
function registerHoverHandlers(map, layerId) {
  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'diary-hover-card',
    offset: 12,
  });

  let popupVisible = false;

  const moveHandler = (event) => {
    // Shows popup on mouse move
    const feature = event.features && event.features[0];
    if (!feature) return;
    const html = buildHoverHtml(props);
    if (!popupVisible) {
      popup.addTo(map);
      popupVisible = true;
    }
    popup.setLngLat(event.lngLat).setHTML(html);
    map.getCanvas().style.cursor = 'pointer';
  };

  const leaveHandler = () => {
    // PROBLEM: Removes popup immediately on mouse leave
    if (popupVisible) {
      popup.remove();
      popupVisible = false;
    }
    map.getCanvas().style.cursor = '';
  };

  map.on('mousemove', layerId, moveHandler);   // ← Hover-based
  map.on('mouseleave', layerId, leaveHandler); // ← Destroys on leave
}
```

**Root Cause Breakdown:**

1. **Hover-Based Trigger (Line 181):** Popup is shown/updated on `mousemove` event
2. **Immediate Teardown (Line 182):** `mouseleave` event removes popup instantly
3. **No Persistence:** No mechanism to pin the popup on click
4. **No Focusing:** No map centering or segment highlighting
5. **Content Limitations:** Uses `min-width: 240px` but no `max-width`, potential overflow

**Why This Happens:**
When the mouse cursor moves from the segment line to the popup itself, the cursor has left the segment layer, triggering `leaveHandler` which immediately calls `popup.remove()`. The popup disappears before the user can interact with the "Agree" or "Feels safer" buttons.

### Content Overflow Analysis

**File:** [src/map/segments_layer.js:243-259](../src/map/segments_layer.js#L243-L259)

The hover HTML builder uses inline styles:
```javascript
return `
  <div style="min-width:240px;font:12px/1.4 system-ui;color:#111;">
    <!-- Content -->
  </div>
`;
```

**Issues:**
- `min-width: 240px` but no `max-width` → Could grow indefinitely for long street names or tags
- No `overflow` handling → Long content will expand popup unbounded
- No `max-height` → Tall content (many tags) could exceed viewport

### Target Behavior

**Desired Flow:**
1. User clicks on a segment (not just hovers)
2. Map smoothly pans/zooms to center the segment
3. Popup appears and stays open ("pinned" state)
4. User can interact with buttons ("Agree 👍", "Feels safer ✨")
5. Popup remains open until:
   - User clicks the close button (X), OR
   - User clicks on the map background/another segment

**Content Constraints:**
- `max-width: 280px` (allows readability, prevents excessive width)
- `max-height: 400px` with `overflow-y: auto` (scrollable if content is tall)
- Flexible height grows to fit content within max

---

## Issue 2: Rating Modal Non-Interactive

### Current Behavior

**Symptom:**
- User clicks "Rate this route" button
- Screen dims (overlay appears)
- Modal appears but is completely non-interactive
- Clicking stars, tags, dropdowns, segment overrides does nothing
- Modal appears like a "frozen screenshot"
- Dimming looks heavier than spec

### Root Cause Analysis

**File:** [src/routes_diary/form_submit.js](../src/routes_diary/form_submit.js)

**Critical Z-Index Bug:**

**Lines 69-77:** Backdrop CSS
```javascript
.diary-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2500;  // ← Backdrop has explicit z-index
}
```

**Lines 78-92:** Modal CSS
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
  // ← NO z-index specified! Defaults to auto/0
}
```

**Lines 218-219:** DOM Structure
```javascript
document.body.appendChild(backdrop);  // z-index: 2500
document.body.appendChild(modal);      // z-index: auto (0)
```

**Root Cause:**
- Backdrop and modal are appended as **siblings** to `<body>`
- Backdrop has `z-index: 2500`
- Modal has `z-index: auto` (defaults to 0)
- **Result:** Backdrop renders ABOVE modal, covering all interactive elements
- All clicks hit the backdrop instead of modal content
- Line 131: `backdrop.addEventListener('click', closeRatingModal)` means any click closes the modal

**Why Interactions Fail:**
```
Stacking Order (bottom to top):
1. Page content (z-index: 0)
2. Modal (z-index: auto = 0) ← Should be on top!
3. Backdrop (z-index: 2500) ← Actually on top, blocks all clicks!
```

### Dim Overlay Analysis

**Line 72:** `background: rgba(15, 23, 42, 0.32);`

This is a fairly light dim (32% opacity of dark slate). The dimming itself is not the issue - the problem is that users cannot see through to interact because the backdrop is capturing all pointer events.

### Additional Issues Found

**Line 135:** `modal.addEventListener('click', (e) => e.stopPropagation());`

This prevents clicks on the modal from bubbling to the backdrop's click handler. **However**, since the backdrop is above the modal in the stacking order, clicks never reach the modal in the first place - they hit the backdrop directly and close the modal.

### Target Behavior

**Desired Flow:**
1. User clicks "Rate this route"
2. Light dim overlay appears (rgba(15, 23, 42, 0.32) is fine)
3. Modal appears centered and fully interactive
4. User can:
   - Click stars to rate (stars turn gold)
   - Click tag chips to select/deselect (chips toggle background)
   - Use "More tags" dropdown to add additional tags
   - Check segment override boxes and change their ratings
   - Type in notes textarea
   - Click "Submit rating" to submit
   - Click "Cancel" or "×" to close
   - Press ESC to close (already implemented)
5. Backdrop only catches clicks outside the modal to dismiss

---

## Issue 3: Diary Panel Missing Controls

### Current State

**File:** [src/routes_diary/index.js](../src/routes_diary/index.js) - `ensureDiaryPanel()` function

**Lines 354-452:** Current panel contains:
- Title: "Route Safety Diary (demo)"
- Route picker dropdown (5 demo routes)
- Summary strip (route details)
- Alternative route toggle
- Alternative summary strip
- Simulator controls (Play/Pause/Finish) - added in recent polish
- Rate button

**Missing Controls:**
- Playback speed selector (0.5×, 1×, 2×)
- Demo period selector (Single day, Last 7 days, Last 30 days)
- History & routes entry point (disabled placeholder)
- Additional contextual controls

### Reference UI Analysis

**File:** [Routesafetydiaryui/src/components/LeftPanel.tsx](../Routesafetydiaryui/src/components/LeftPanel.tsx)

Reference panel includes:
- "Plan route" button (with MapPin icon)
- "Record trip" button (with Circle icon)
- "My routes" button (with FolderOpen icon)
- Separator
- "Legend" toggle (with Eye icon)
- "Community actions" info box (explains Agree/Safer CTAs)

**Style Notes:**
- Clean button layout: icon + label, hover states
- Separators between logical groups
- Muted colors: neutral-400/600/700/900
- Info boxes with light background: bg-neutral-50, border-neutral-200
- 12px/13px font sizes

### Target Controls Spec

**New Controls to Add:**

1. **Playback Speed Selector**
   - Label: "Playback speed"
   - Options: 0.5×, 1×, 2× (radio buttons or segmented control)
   - Default: 1×
   - Updates: `store.simPlaybackSpeed` or similar
   - Visual: Inline button group with active state

2. **Demo Period Selector**
   - Label: "Demo time window"
   - Options: "Single day", "Last 7 days", "Last 30 days" (dropdown)
   - Default: "Single day"
   - Updates: `store.diaryDemoPeriod` or similar
   - Purpose: Simulate different rating aggregation periods

3. **History & Routes Entry Point**
   - Button: "My routes" or "History & saved routes"
   - Icon: Folder or List icon (if using lucide or similar)
   - State: Disabled for now (`disabled` attribute)
   - Title: "Coming soon - view your saved routes"
   - Visual: Grayed out, not-allowed cursor

4. **Time-of-Day Selector (Optional)**
   - Label: "Filter by time of day"
   - Options: "All hours", "Daytime (6am-6pm)", "Evening (6pm-10pm)", "Night (10pm-6am)"
   - Default: "All hours"
   - Purpose: Filter/weight segments by time context

5. **Legend Toggle (Optional)**
   - Button: "Toggle safety legend"
   - Action: Show/hide color scale explanation
   - Visual: Toggle button or checkbox

### Layout Constraints

**Panel Height Management:**
- Current panel uses `minHeight: '220px'` (line 400 in routes_diary/index.js)
- Adding 4-5 new controls could make panel ~400-500px tall
- Need to ensure panel doesn't overflow on smaller screens (768p)

**Solutions:**
1. Use `overflow-y: auto` on panel container
2. Group controls into collapsible sections (advanced)
3. Use compact layouts (inline selectors, smaller gaps)
4. Set `max-height: 80vh` with scroll

**Recommended Layout:**
```
[Existing]
- Title: "Route Safety Diary (demo)"
- Route picker
- Summary strip
- Alt toggle + alt summary

[Separator]

[New Controls Section]
- Playback speed (inline buttons: 0.5× | 1× | 2×)
- Demo period (dropdown)
- Time of day (dropdown)

[Separator]

[Existing Simulator]
- Play/Pause/Finish buttons
- Rate button

[Separator]

[New Entry Point]
- History & routes (disabled button)
```

---

## Summary of Root Causes

| Issue | Root Cause | Impact | Severity |
|-------|-----------|--------|----------|
| Segment card disappears | Hover-based (`mousemove`/`mouseleave`) instead of click-based | Cannot interact with CTAs, poor UX | High |
| Modal non-interactive | Missing z-index on modal, backdrop covers it | Cannot submit ratings, blocking feature | Critical |
| Panel missing controls | Not implemented yet | Limited configurability for testing | Medium |

---

## Files Requiring Changes

### Segment Card Fix
- [src/map/segments_layer.js](../src/map/segments_layer.js)
  - Lines 142-184: Replace hover handlers with click handlers
  - Lines 146-151: Add `closeButton: true` and click-to-pin logic
  - Lines 219-259: Update `buildHoverHtml()` to add max-width, max-height
  - New function: `focusSegment(map, segmentId, geometry)` to center map

### Rating Modal Fix
- [src/routes_diary/form_submit.js](../src/routes_diary/form_submit.js)
  - Lines 78-92: Add `z-index: 2501;` to `.diary-modal-card` CSS

### Panel Controls Addition
- [src/routes_diary/index.js](../src/routes_diary/index.js)
  - Lines 354-452: `ensureDiaryPanel()` function
  - Add new control elements after simulator section
  - Wire to store properties (add to store.js if needed)

- [src/state/store.js](../src/state/store.js)
  - Add new properties: `simPlaybackSpeed`, `diaryDemoPeriod`, `diaryTimeFilter`

---

## Proposed Solutions Summary

### Quick Fix: Rating Modal Z-Index (5 minutes)

**Change:** [src/routes_diary/form_submit.js:78-92](../src/routes_diary/form_submit.js#L78-L92)

Add one line to `.diary-modal-card` CSS:
```javascript
.diary-modal-card {
  // ... existing styles
  position: relative;
  z-index: 2501;  // ← ADD THIS LINE
}
```

**Impact:** Immediately fixes modal interactivity
**Risk:** None
**Testing:** Open modal, click stars/tags/dropdowns - should work

### Medium Fix: Segment Card Click-to-Pin (1-2 hours)

**Changes:** [src/map/segments_layer.js](../src/map/segments_layer.js)

1. Replace `mousemove`/`mouseleave` with `click` event
2. Add popup state management (track active popup)
3. Add close button to popup HTML
4. Add click-outside handler to close
5. Add `focusSegment()` function to pan/zoom map
6. Update popup HTML with `max-width`/`max-height`

**Impact:** Persistent, interactive segment cards
**Risk:** Low (isolated to segments layer)
**Testing:** Click segment → card stays, buttons work, close button works

### Larger Addition: Panel Controls (2-3 hours)

**Changes:** [src/routes_diary/index.js](../src/routes_diary/index.js), [src/state/store.js](../src/state/store.js)

1. Add playback speed selector (3 buttons)
2. Add demo period dropdown
3. Add time-of-day dropdown
4. Add history button (disabled)
5. Wire to store properties
6. Add console logging for value changes
7. Add separators for visual grouping

**Impact:** Enhanced panel with new controls
**Risk:** Low (UI only, no backend)
**Testing:** Click controls, check console logs, verify state changes

---

## Next Steps

See [docs/DIARY_UI_FIX_PLAN_M3.md](../docs/DIARY_UI_FIX_PLAN_M3.md) for detailed implementation plan with step-by-step tasks for Agent-I (Codex).

---

**Diagnosis Complete**
**Agent:** Agent-M
**Mode:** Manager-Fixes-Allowed
**Timestamp:** 2025-11-17T02:18:40Z
