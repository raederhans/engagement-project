# Route Safety Diary - Development Environment Setup

**Date:** 2025-11-07
**Status:** M1 Prep Complete
**Target:** Codex implementation

---

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- Git

### Setup (Choose Your Platform)

**Option A: Bash (Mac/Linux/WSL):**
```bash
npm run setup:diary:sh
```

**Option B: PowerShell (Windows):**
```powershell
npm run setup:diary:ps
```

**Option C: Manual Setup:**
```bash
# 1. Install dependencies
npm install ajv dayjs @turf/turf --save

# 2. Create environment file
echo "VITE_FEATURE_DIARY=0" > .env.example

# 3. Generate seed data
# (Seed data already created in data/segments_phl.dev.geojson)
```

---

## Feature Flag Configuration

### Enable Diary Feature

**Development:**
```bash
# Create .env.local (gitignored)
echo "VITE_FEATURE_DIARY=1" > .env.local
```

**Production:**
```bash
# Set environment variable in hosting platform
VITE_FEATURE_DIARY=1
```

### Verify Flag Status

```javascript
// In browser console or code:
console.log('Diary flag:', import.meta.env.VITE_FEATURE_DIARY);
// Expected: '1' (enabled) or undefined (disabled)
```

---

## Directory Structure

After running setup scripts, you should have:

```
engagement-project/
├── .env.example              # Feature flag template
├── data/
│   └── segments_phl.dev.geojson  # 3 seed segments
├── docs/
│   ├── DIARY_EXEC_PLAN_M1.md     # Implementation plan
│   ├── ALGO_REQUIREMENTS_M1.md    # Algorithm specs
│   ├── SCENARIO_MAPPING.md        # React→Vanilla mapping
│   ├── API_DIARY.md               # API contracts
│   └── DEV_ENV_README.md          # This file
├── scripts/
│   ├── setup_diary_env.sh         # Bash setup
│   └── setup_diary_env.ps1        # PowerShell setup
├── src/
│   ├── routes_diary/
│   │   ├── index.js               # [TODO] Main diary orchestrator
│   │   ├── form_submit.js         # [TODO] Rating modal
│   │   └── my_routes.js           # [TODO] Saved routes (M3)
│   ├── map/
│   │   ├── segments_layer.js      # [TODO] Segment visualization
│   │   └── routing_overlay.js     # [TODO] Safer route overlay
│   ├── api/
│   │   └── diary.js               # [TODO] Diary API client
│   └── utils/
│       ├── match.js               # [TODO] GPS matching
│       └── decay.js               # [TODO] Time-decay calcs
└── server/
    └── api/diary/
        ├── submit.js              # [STUB] 501 response
        ├── segments.js            # [STUB] 501 response
        └── route.js               # [STUB] 501 response
```

---

## Development Workflow

### 1. Enable Feature Flag

```bash
echo "VITE_FEATURE_DIARY=1" > .env.local
```

### 2. Start Development Server

```bash
npm run dev
```

Expected output:
```
VITE v5.0.0  ready in 1234 ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
➜  press h + enter to show help

[Diary] Feature flag is ON — scaffolding present; implementation to be added by Codex (M1).
```

### 3. Verify Scaffolding

Open browser console and check for diary initialization:
```
[Diary] Feature flag is ON — scaffolding present; implementation to be added by Codex (M1).
```

If you see this message, scaffolding is correctly loaded.

### 4. Implement M1 Features

Follow task list in [docs/DIARY_EXEC_PLAN_M1.md](./DIARY_EXEC_PLAN_M1.md):

**Phase 1: Segment Visualization**
- [ ] Implement `src/map/segments_layer.js`
- [ ] Load seed data and mount layer
- [ ] Add hover/click handlers

**Phase 2: GPS Recording (Mock)**
- [ ] Implement RecorderDock UI
- [ ] Generate mock GPS points
- [ ] Match GPS to segments

**Phase 3: Rating Form**
- [ ] Implement RatingModal
- [ ] Form validation with AJV
- [ ] Submit to mock API

**Phase 4: Map Updates**
- [ ] Update segment colors/widths
- [ ] Show toast notification
- [ ] Populate insights panel

**Phase 5: Community Interaction**
- [ ] Implement SegmentCard
- [ ] Implement CommunityDetailsModal
- [ ] Wire "Agree" and "Feels safer" actions

### 5. Test with Flag OFF

```bash
# Remove .env.local or set flag to 0
echo "VITE_FEATURE_DIARY=0" > .env.local
npm run dev
```

Expected: No diary UI elements visible, no console messages, existing dashboard unaffected.

---

## Build & Deployment

### Test Build (Flag OFF)

```bash
# Ensure flag is OFF
rm .env.local
npm run build
```

Expected: Build succeeds, no diary code in bundle.

### Test Build (Flag ON)

```bash
echo "VITE_FEATURE_DIARY=1" > .env.local
npm run build
```

Expected: Build succeeds, diary code included, bundle size increases by ~50-100KB.

### Preview Production Build

```bash
npm run preview
```

Test both flag states to ensure proper gating.

---

## Debugging

### Flag Not Working

**Symptom:** Diary UI not showing even with `VITE_FEATURE_DIARY=1`

**Checklist:**
1. Check `.env.local` exists and contains `VITE_FEATURE_DIARY=1`
2. Restart dev server (`Ctrl+C` then `npm run dev`)
3. Clear browser cache (hard refresh: `Ctrl+Shift+R`)
4. Check console for import errors

**Verify in code:**
```javascript
console.log('Flag value:', import.meta.env.VITE_FEATURE_DIARY);
console.log('Flag type:', typeof import.meta.env.VITE_FEATURE_DIARY);
// Should be: '1', string
```

### Module Import Errors

**Symptom:** `Cannot find module './routes_diary/index.js'`

**Fix:** Check that all scaffolding files exist with at least a header comment:
```bash
ls src/routes_diary/
# Should show: index.js, form_submit.js, my_routes.js
```

If missing, run setup script again:
```bash
npm run setup:diary:sh  # or setup:diary:ps
```

### MapLibre Layer Errors

**Symptom:** `Map#addLayer: layer with id "segments-line" already exists`

**Fix:** Segments layer being added multiple times. Check teardown logic:
```javascript
// src/routes_diary/index.js
export function teardownDiaryMode(map) {
  if (map.getLayer('segments-line')) {
    map.removeLayer('segments-line');
  }
  if (map.getSource('segments')) {
    map.removeSource('segments');
  }
}
```

### AJV Validation Errors

**Symptom:** `Validation error: data/overall_rating must be integer`

**Fix:** Check form data collection:
```javascript
// Ensure rating is number, not string
const formData = {
  overall_rating: parseInt(ratingState.overall_rating, 10),  // ← Parse to int
  tags: ratingState.tags.filter(t => t.length > 0),
  travel_mode: ratingState.travel_mode
};
```

---

## Seed Data Reference

### segments_phl.dev.geojson

3 mock segments for M1 testing:

| Segment ID | Location | Length | Mock Rating | Mock n_eff |
|------------|----------|--------|-------------|------------|
| seg_001 | Main St (39.9520) | 120m | 3.5 | 30 |
| seg_002 | Main St (39.9525) | 180m | 2.8 | 20 |
| seg_003 | Side St (39.9515) | 95m | 4.2 | 45 |

**Extend seed data:**
```javascript
// scripts/extend_seed_data.js
const seed = require('../data/segments_phl.dev.geojson');

seed.features.forEach(f => {
  f.properties.rating = Math.random() * 4 + 1; // 1-5
  f.properties.n_eff = Math.random() * 80 + 10; // 10-90
  f.properties.top_tags = ['poor lighting', 'low foot traffic'].slice(0, Math.floor(Math.random() * 3));
});

fs.writeFileSync('data/segments_phl.dev.geojson', JSON.stringify(seed, null, 2));
```

---

## Dependency Management

### Installed Dependencies

After setup, verify these are in `package.json`:

```json
{
  "dependencies": {
    "ajv": "^8.12.0",
    "dayjs": "^1.11.10",
    "@turf/turf": "^7.0.0"
  }
}
```

### Dependency Purpose

| Package | Size | Purpose |
|---------|------|---------|
| `ajv` | 120 KB | JSON schema validation for rating submissions |
| `dayjs` | 2 KB | Timestamp parsing, date math for decay calculations |
| `@turf/turf` | 350 KB | Geospatial operations (nearestPointOnLine, bearing, distance) |

**Total Added:** ~472 KB (minified)

### Optional Dependencies (M2)

```json
{
  "devDependencies": {
    "vitest": "^1.0.0",  // Unit testing
    "playwright": "^1.40.0"  // E2E testing
  }
}
```

---

## Testing Strategy

### Manual Testing (M1)

**Scenario 1: Initial State**
1. Start dev server with flag ON
2. Verify 3 segments visible on map
3. Hover segment → cursor changes
4. Click segment → log segment ID to console

**Scenario 2: Rating Modal**
1. Click "Record trip" button
2. Wait 5 seconds (mock GPS)
3. Click "Finish"
4. Verify modal opens
5. Select 4 stars
6. Select 2 tags
7. Click "Submit"
8. Verify toast appears
9. Verify modal closes

**Scenario 3: Post-Submit**
1. After modal submission
2. Verify toast "Thanks — updating map."
3. Verify segments update (colors/widths change)
4. Verify insights panel populates with 3 charts

**Scenario 4: Community**
1. Click any segment on map
2. Verify SegmentCard appears near click point
3. Click "Agree" → toast appears, card closes
4. Click segment again
5. Click "View community insights"
6. Verify CommunityDetailsModal opens (full-screen)
7. Verify 7 sections rendered
8. Click close (X) → modal closes

### Automated Testing (M2)

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e
```

---

## Performance Monitoring

### Bundle Size

**Before Diary Feature:**
```
dist/assets/index-abc123.js  245.67 kB
```

**After Diary Feature (Flag ON):**
```
dist/assets/index-def456.js  295.34 kB  (+49.67 kB)
```

**Expected Increase:** 50-100 KB (depends on implementation)

### Runtime Performance

**Metrics to Monitor:**
- Segment layer render time: < 100ms (3 segments)
- GPS matching: < 50ms (100 points)
- Modal open animation: 60fps
- Chart rendering: < 200ms (3 charts)

**Browser DevTools:**
```
Performance tab → Record → Interact → Stop
Look for:
  - Long tasks (> 50ms)
  - Layout thrashing
  - Excessive repaints
```

---

## Environment Variables Reference

### VITE_FEATURE_DIARY

**Type:** String (`'0'`, `'1'`, or `undefined`)
**Default:** `undefined` (disabled)

**Values:**
- `'1'` or `'true'` → Diary feature enabled
- `'0'` or `'false'` or `undefined` → Diary feature disabled

**Example Usage:**
```javascript
// src/main.js
if (import.meta.env.VITE_FEATURE_DIARY === '1') {
  initDiaryMode(map);
}
```

**Note:** Vite only injects `import.meta.env.*` variables starting with `VITE_`. Do NOT use `process.env` (not available in browser).

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Feature flag not recognized" | `.env.local` missing | Run `npm run setup:diary:sh` |
| "Cannot find module" | Scaffolding files missing | Check `src/routes_diary/` exists |
| "Segments not visible" | GeoJSON not loaded | Verify `data/segments_phl.dev.geojson` exists |
| "Modal won't open" | RecorderDock not initialized | Check `createRecorderDock()` called in `initDiaryMode()` |
| "Build fails with flag ON" | Syntax error in TODO files | Check all files have valid JS syntax (even if just comments) |

### Debug Checklist

1. [ ] Node version >= 18.0.0 (`node -v`)
2. [ ] Dependencies installed (`npm install` ran successfully)
3. [ ] `.env.local` exists with `VITE_FEATURE_DIARY=1`
4. [ ] Dev server restarted after changing `.env.local`
5. [ ] Browser cache cleared (hard refresh)
6. [ ] Console shows no import errors
7. [ ] Scaffolding files exist and have valid syntax
8. [ ] Seed data file exists at `data/segments_phl.dev.geojson`

---

## Next Steps

1. **Read Documentation:**
   - [DIARY_EXEC_PLAN_M1.md](./DIARY_EXEC_PLAN_M1.md) - Task list and acceptance criteria
   - [ALGO_REQUIREMENTS_M1.md](./ALGO_REQUIREMENTS_M1.md) - Algorithm specifications
   - [SCENARIO_MAPPING.md](./SCENARIO_MAPPING.md) - React→Vanilla mapping
   - [API_DIARY.md](./API_DIARY.md) - API contracts

2. **Start Implementation:**
   - Begin with Phase 1 (Segment Visualization)
   - Follow task list sequentially
   - Mark TODOs as complete
   - Test after each phase

3. **Capture Evidence:**
   - Screenshot UI elements
   - Log console outputs
   - Document acceptance test results
   - Store in `logs/M1_IMPL_PHASE<N>_<timestamp>.md`

4. **Commit Regularly:**
   ```bash
   git add .
   git commit -m "feat(diary): implement Phase 1 - segment visualization"
   git push
   ```

---

## Support

**Questions?** Check documentation first:
- Execution plan: [DIARY_EXEC_PLAN_M1.md](./DIARY_EXEC_PLAN_M1.md)
- Algorithms: [ALGO_REQUIREMENTS_M1.md](./ALGO_REQUIREMENTS_M1.md)
- API contracts: [API_DIARY.md](./API_DIARY.md)

**Found a bug?** Check existing issues or create new one.

---

**Status:** Environment ready for M1 implementation
**Last Updated:** 2025-11-07
