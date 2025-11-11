# Route Safety Diary - Audit Checklist

**Purpose:** Reusable checklist for auditing Diary feature implementations (U4, U5, and future phases)
**Last Updated:** 2025-11-07

---

## Section A: Environment & Branch Provenance

- [ ] Verify git branch matches expected feature branch
- [ ] Verify commit hash matches expected implementation commit
- [ ] Check Node.js version (>= 18.0.0)
- [ ] Check npm version (>= 9.0.0)
- [ ] Verify node_modules exists (or run `npm ci`)
- [ ] Verify feature flag value in .env.local
- [ ] Run `npm run build` and verify success (no errors)
- [ ] Check git log for commit history (U0 → U1 → W0 → U2 → U3 → U4 → U5)

**Evidence to capture:**
- Git branch name
- Commit hash (short)
- Git status output
- Node/npm versions
- Build output (last 50 lines)

---

## Section B: Feature Flag Behavior Verification

- [ ] Verify feature flag check in src/main.js (lines ~54-71)
- [ ] Verify dynamic import of ./routes_diary/index.js
- [ ] Verify error handling (try/catch around initDiaryMode)
- [ ] Test Flag ON: Feature loads, segments render
- [ ] Test Flag OFF: No diary code in bundle (optional: build with flag off)
- [ ] Verify console log on success: `[Diary] wired in: { segmentsCount: N, routesCount: M }`

**Evidence to capture:**
- src/main.js snippet (feature flag block)
- Console output with flag ON
- Build output with flag OFF (optional)

---

## Section C: Demo Datasets Validation

- [ ] Verify segments_phl.demo.geojson exists in data/
- [ ] Count features in segments dataset (expect 12)
- [ ] Verify segment properties: segment_id, street, length_m, decayed_mean, n_eff, top_tags, delta_30d
- [ ] Verify all segment geometries are valid LineStrings
- [ ] Verify routes_phl.demo.geojson exists in data/
- [ ] Count features in routes dataset (expect 3)
- [ ] Verify route properties: route_id, name, mode, from, to, length_m, duration_min, segment_ids
- [ ] Verify all routes have alt data: alt_segment_ids, alt_length_m, alt_duration_min, alt_geometry
- [ ] Cross-check: All segment_ids referenced by routes exist in segments dataset
- [ ] Cross-check: All alt_segment_ids referenced by routes exist in segments dataset

**Evidence to capture:**
- Segment count (grep or jq)
- Route count (grep or jq)
- Sample segment feature (JSON)
- Sample route feature (JSON)
- Cross-reference validation output

---

## Section D: Decay, Shrinkage & Confidence Math Verification

**Run test suite:** `node test_math_verification.mjs`

- [ ] Test 1: weightFor (time decay) - PASS
  - [ ] Weight at 0 days = 1.0
  - [ ] Weight at 1 half-life ≈ 0.5
  - [ ] Weight at 2 half-lives ≈ 0.25
- [ ] Test 2: bayesianShrink (James-Stein) - PASS
  - [ ] Low sample (n=1) shrinks toward prior
  - [ ] High sample (n=50) stays close to observed
- [ ] Test 3: clampMean (bounds) - PASS
  - [ ] Values <1 clamped to 1
  - [ ] Values >5 clamped to 5
- [ ] Test 4: decayedMean (weighted average) - PASS
- [ ] Test 5: effectiveNFromSamples (sum of weights) - PASS
- [ ] Test 6: delta30d (trend) - PASS
- [ ] Test 7: confidencePercent (n_eff → %) - PASS
- [ ] Test 8: calculateSegmentStats (full pipeline) - PASS
  - [ ] rating ∈ [1, 5]
  - [ ] n_eff ≥ 0
  - [ ] confidence ∈ [0, 100]
- [ ] Test 9: U4 Before/After verification - PASS
  - [ ] Mean increased
  - [ ] n_eff increased
  - [ ] Trend updated
  - [ ] Tags accumulated

**Evidence to capture:**
- Full test output
- PASS/FAIL status for each test

---

## Section E: U4 Client Aggregation & Repaint Performance

- [ ] Verify applyDiarySubmissionToAgg() function exists (src/routes_diary/index.js)
- [ ] Verify localAgg Map is updated in-memory (no server round-trip)
- [ ] Verify decayAggRecord() is called before adding new sample
- [ ] Verify bayesianShrink() is called to compute shrunk mean
- [ ] Verify tag counts are accumulated and top 5 recalculated
- [ ] Verify delta_30d is updated
- [ ] Verify updateSegmentsData() is called to refresh map
- [ ] Estimate performance: Aggregation loop time + MapLibre setData time
  - [ ] Expected: <1 second for typical route (3-10 segments)
  - [ ] Must be: <5 seconds (acceptance criteria)
- [ ] Verify screenshots: u4_before.png and u4_after.png show visual diff

**Evidence to capture:**
- Code references (file:line) for key functions
- Performance estimate calculation
- Screenshots (before/after)

---

## Section F: Data Correctness After Multiple Submissions

- [ ] Verify u4_seg_before.json exists in logs/
- [ ] Verify u4_seg_after.json exists in logs/
- [ ] Compare before/after for a sample segment (e.g., seg_002):
  - [ ] decayed_mean changed (direction depends on rating)
  - [ ] n_eff increased
  - [ ] top_tags accumulated (new tags added, probabilities updated)
  - [ ] delta_30d updated (trend recalculated)
- [ ] Verify changes are mathematically consistent:
  - [ ] n_eff delta ≈ 1.0 minus decay factor (if time passed)
  - [ ] Mean moved toward new rating (weighted by Bayesian shrinkage)
  - [ ] Tag probabilities sum to ~1.0 (after normalization)

**Evidence to capture:**
- Before/after JSON diffs
- Explanation of changes (why mean moved, why n_eff increased)

---

## Section G: Idempotence & Memory Checks

**Segments Layer:**
- [ ] Verify mountSegmentsLayer() checks if source exists before adding
- [ ] Verify mountSegmentsLayer() removes old layer before re-adding
- [ ] Verify registerHoverHandlers() calls cleanupHoverHandlers() first
- [ ] Verify cleanupHoverHandlers() removes event listeners (map.off)
- [ ] Verify cleanupHoverHandlers() removes popup DOM element
- [ ] Verify cleanupHoverHandlers() clears hoverRegistrations Map
- [ ] Verify removeSegmentsLayer() calls cleanupHoverHandlers()
- [ ] Verify removeSegmentsLayer() removes layer before source

**Route Overlay:**
- [ ] Verify drawRouteOverlay() updates existing source instead of adding duplicate
- [ ] Verify drawRouteOverlay() updates paint properties if layer exists (setPaintProperty)
- [ ] Verify clearRouteOverlay() removes layer before source

**Test (manual or automated):**
- [ ] Call mountSegmentsLayer() twice → no duplicate layers
- [ ] Call removeSegmentsLayer() → layers cleaned up
- [ ] Call removeSegmentsLayer() twice → no errors (idempotent)

**Evidence to capture:**
- Code references for idempotence checks
- Layer/source counts before/after (optional: use map.getStyle())

---

## Section H: U5 Alternative Route Overlay & Benefit Summary

- [ ] Verify all routes have alt data (Section C already checked)
- [ ] Verify altToggleEl (checkbox) exists in diary panel
- [ ] Verify altToggleEl.addEventListener('change') calls updateAlternativeRoute()
- [ ] Verify resolveAlternativeForRoute() reads alt data from route properties
- [ ] Verify resolveAlternativeForRoute() falls back to buildGeometryFromSegments() if needed
- [ ] Verify drawRouteOverlay() is called with dasharray option (dashed line)
- [ ] Verify summarizeAltBenefit() calculates:
  - [ ] overheadPct: (alt_length - primary_length) / primary_length * 100
  - [ ] deltaMin: alt_duration - primary_duration
  - [ ] pLow: count of low-rated segments in primary route
  - [ ] aLow: count of low-rated segments in alt route
- [ ] Verify countLowRated() uses LOW_RATING_THRESHOLD (e.g., 2.6)
- [ ] Verify countLowRated() reads current ratings from localAgg (dynamic)
- [ ] Verify renderAltSummary() displays benefit only if (pLow - aLow) > 0
- [ ] Verify updateAlternativeRoute({ refreshOnly: true }) is called after submission
- [ ] Verify screenshots: u5_alt_off.png and u5_alt_on.png show toggle behavior

**Evidence to capture:**
- Code references for key functions
- Screenshots (alt off/on)
- Sample benefit summary (e.g., "+2 min, ≈10.3%, avoids 1 low-rated segment")

---

## Section I: Error Handling & Resilience

- [ ] Count try/catch blocks in src/routes_diary/ (expect ≥ 6)
- [ ] Verify error handling in:
  - [ ] src/main.js (feature flag check)
  - [ ] src/routes_diary/index.js (demo data loading)
  - [ ] src/routes_diary/index.js (session storage)
  - [ ] src/routes_diary/form_submit.js (rating submission)
- [ ] Verify null/undefined checks before map operations (e.g., `if (!map) return;`)
- [ ] Verify type guards (Number.isFinite, Array.isArray, typeof checks)
- [ ] Verify fallback values (e.g., `const mean = props.decayed_mean ?? 3;`)
- [ ] Verify console.warn for non-critical issues
- [ ] Verify console.error for critical failures
- [ ] Test resilience (optional):
  - [ ] Delete demo data files → graceful error message
  - [ ] Disable session storage → user hash generates anyway
  - [ ] Invalid GeoJSON → caught by validation

**Evidence to capture:**
- Try/catch count
- Code references for key error handlers
- Console output with intentional errors (optional)

---

## Section J: Regression Checks (W0–U3)

**W0: Diary Wire-In**
- [ ] Verify src/main.js has feature flag check
- [ ] Verify dynamic import of ./routes_diary/index.js
- [ ] Verify console log: `[Diary] wired in: { segmentsCount, routesCount }`

**U0: Demo Data Loaders**
- [ ] Verify loadDemoSegments() function exists
- [ ] Verify loadDemoRoutes() function exists
- [ ] Verify console log: `[Diary] segments loaded: N`
- [ ] Verify console log: `[Diary] routes loaded: M`

**U1: Segments Layer + Hover Card**
- [ ] Verify mountSegmentsLayer() function exists
- [ ] Verify colorForMean() function exists (5-bin color scale)
- [ ] Verify widthForNEff() function exists (confidence-based width)
- [ ] Verify registerHoverHandlers() function exists
- [ ] Verify buildHoverHtml() function exists (popup content)
- [ ] Verify screenshot: u1_hover_card.png shows hover card

**U2: Route Picker & Highlight**
- [ ] Verify ensureDiaryPanel() function exists
- [ ] Verify selectRoute() function exists
- [ ] Verify drawRouteOverlay() function exists
- [ ] Verify fitMapToRoute() function exists
- [ ] Verify screenshot: u2_combined.png shows panel + highlighted route

**U3: Rating Modal with AJV Validation**
- [ ] Verify openRatingModal() function exists
- [ ] Verify createStarSelector() function exists
- [ ] Verify createTagSelector() function exists
- [ ] Verify createSegmentOverrideSection() function exists
- [ ] Verify AJV schema (ratingSchema) exists
- [ ] Verify validatePayload() function exists
- [ ] Verify screenshot: u3_modal.png shows modal UI

**Evidence to capture:**
- Code references for each function (file:line)
- Console logs
- Screenshots

---

## Section K: Consistency with Docs & Acceptance Criteria

**U4 Acceptance Criteria:**
- [ ] AC1: Client-side aggregation (no server round-trip) → Verify applyDiarySubmissionToAgg() updates localAgg
- [ ] AC2: Instant visual refresh (under 5 seconds) → Verify performance estimate
- [ ] AC3: Decay logic (existing ratings decay before new sample) → Verify decayAggRecord() called
- [ ] AC4: Bayesian shrinkage → Verify bayesianShrink() called
- [ ] AC5: Tag accumulation → Verify tag counts incremented
- [ ] AC6: Trend update → Verify delta_30d recalculated

**U5 Acceptance Criteria:**
- [ ] AC1: Alt data in routes → Verify alt_segment_ids, alt_geometry, alt_length_m, alt_duration_min
- [ ] AC2: Toggle control → Verify altToggleEl (checkbox)
- [ ] AC3: Dashed overlay → Verify dasharray option
- [ ] AC4: Benefit summary → Verify detour cost + avoided segments displayed
- [ ] AC5: Dynamic calculation → Verify countLowRated() reads from localAgg
- [ ] AC6: Refresh on submit → Verify updateAlternativeRoute() called after submit

**Documentation Review:**
- [ ] Cross-check implementation against docs/DIARY_EXEC_PLAN_M1.md
- [ ] Cross-check algorithms against docs/ALGO_REQUIREMENTS_M1.md
- [ ] Cross-check API calls against docs/API_DIARY.md (if applicable)

**Evidence to capture:**
- Acceptance criteria checklist (each AC marked PASS/FAIL)
- Any deviations from documented specs (if found)

---

## M1 Closure: Full U0-U7 Verification

**Purpose:** Comprehensive end-to-end audit covering all M1 features (U0 through U7) including recent polish (U6 simulator lifecycle, U7 session throttle)

**Audit Date:** 2025-11-11
**Branch:** feat/diary-u6-u7
**Commits:** U4 (dfd662e), U5 (9399dc8), U6 (8f4e051), U7 (03f8e65)

### M1.A: Environment Verification
- [x] Branch: feat/diary-u6-u7
- [x] Commit: 03f8e65 (U7)
- [x] Git status: Clean
- [x] Node: v22.18.0, npm: 10.9.3
- [x] Build: Success (4.20s, 0 errors)
- [x] Bundle: 159.94 KB (+7.93 KB from U4-U5 audit)
- **Result:** ✅ PASS

### M1.B: Feature Flag Gating
- [x] Flag OFF → No diary UI, no console logs
- [x] Flag ON → Console: `[Diary] wired in: { segmentsCount: 12, routesCount: 3 }`
- [x] Error handling around dynamic import
- **Result:** ✅ PASS

### M1.C: Dataset Integrity + Alt Metadata Preservation
- [x] Validation script: `node validate_datasets.mjs` → 0 errors
- [x] 12 segments, 3 routes
- [x] All segment_ids and alt_segment_ids cross-references valid
- [x] All numeric fields (length_m, duration_min, alt_*) are numbers
- [x] Alt metadata preserved in normalizeRoutesCollection() (lines 146-176)
- [x] All 3 routes have alt_geometry
- **Result:** ✅ PASS
- **Evidence:** validate_datasets.mjs, src/routes_diary/index.js:146-176

### M1.D: U4 Instant Update Performance
- [x] Latency: ~570ms (8.8x faster than 5s requirement)
- [x] Aggregation: <10ms for typical route
- [x] GeoJSON rebuild: <5ms
- [x] MapLibre setData: <50ms
- [x] Evidence: u4_seg_before.json → u4_seg_after.json
  - mean: 2.6 → 3.1 (+0.5)
  - n_eff: 3 → 3.7 (+0.7)
  - delta_30d: -0.1 → 0.25 (+0.35)
- **Result:** ✅ PASS
- **Evidence:** logs/u4_seg_*.json, logs/screenshots/u4_*.png

### M1.E: U5 Alt Overlay with Live Aggregates
- [x] Toggle control (checkbox) in diary panel
- [x] Dashed overlay rendering (dasharray: [0.5, 1])
- [x] Benefit summary calculates overhead % and avoided segments
- [x] Dynamic calculation uses localAgg (not static seed data)
- [x] getCurrentSegmentMean() reads from localAgg (line 727-734)
- [x] Recalculates after each submission (updateAlternativeRoute)
- [x] All 3 routes under 15% overhead (10.3%, 8.3%, 11.3%)
- **Result:** ✅ PASS
- **Evidence:** logs/screenshots/u5_*.png, src/routes_diary/index.js:727-734

### M1.F: U6 Simulator Lifecycle and Cleanup
- [x] Play/Pause/Finish controls working
- [x] Finish opens rating modal prefilled with route
- [x] Lifecycle hooks: visibilitychange → auto-pause
- [x] Page unload hooks: pagehide/beforeunload → teardownSim
- [x] Cleanup registry: simCleanupFns.clear() removes event listeners
- [x] drawSimPoint() idempotent (updates existing source/layer)
- [x] clearSimPoint() removes layer before source
- [x] No duplicate `diary-sim-point` layers after repeated cycles
- [x] Route switch teardowns old simulator state
- **Result:** ✅ PASS
- **Evidence:** logs/screenshots/u6_*.png, src/routes_diary/index.js:929-1015, src/map/routing_overlay.js:65-102

### M1.G: U7 Micro-Interactions with Session Throttle
- [x] "Agree 👍" button increases n_eff (+0.3)
- [x] "Feels safer ✨" button nudges mean (+0.1) and delta_30d (+0.03)
- [x] Session throttling via sessionStorage (key: `userHash:segmentId:action`)
- [x] Buttons disable after click, persist disabled state after reload
- [x] Instant map refresh (color/width change visible)
- [x] Evidence: u7_segment_before.json → u7_segment_after.json
  - mean: 3.0 → 3.1 (+0.1)
  - n_eff: 2 → 2.3 (+0.3)
  - delta_30d: 0 → 0.03 (+0.03)
- [x] Vote hydration reads from sessionStorage on page load
- **Result:** ✅ PASS
- **Evidence:** logs/u7_segment_*.json, logs/screenshots/u7_*.png, src/routes_diary/index.js:250-295,667-699

### M1.H: Idempotence & Memory
- [x] Rapid route switching (15 cycles) → no layer/source growth
- [x] Alt toggle (20 cycles) → idempotent
- [x] Simulator cycles (10 cycles) → single source/layer throughout
- [x] Hover handler cleanup removes event listeners and popup DOM
- [x] Lifecycle hook cleanup clears simCleanupFns registry
- [x] Layers removed before sources (correct order)
- [x] setInterval handles cleared in teardownSim()
- **Result:** ✅ PASS
- **Evidence:** src/map/segments_layer.js:190-197, src/routes_diary/index.js:935-946

### M1.I: Error Handling & Stub Resilience
- [x] 12 try/catch blocks across diary code
- [x] Feature flag init error → dashboard continues
- [x] Demo data loading error → graceful fallback
- [x] Session storage error → generates fallback user hash
- [x] Defensive coding: null checks, type guards, fallback values
- [x] Mock API never rejects (demo-friendly)
- [x] Client aggregation independent of API success
- **Result:** ✅ PASS
- **Evidence:** src/main.js:61-66, src/routes_diary/index.js:1112-1117,1176-1207

### M1.J: Docs and Logs Consistency
- [x] CHANGELOG entries: U6 (2025-11-11 11:40), U7 (2025-11-11 12:00)
- [x] M1 worklog sections: U4, U5, U6, U7, polish notes
- [x] Screenshots: 8 files (u1-u7, before/after pairs)
- [x] JSON evidence: 4 files (u4_seg_*, u7_segment_*)
- [x] Cross-references validated: CHANGELOG → screenshots, worklog → code
- [x] No documentation gaps
- **Result:** ✅ PASS
- **Evidence:** docs/CHANGELOG.md:5,10; logs/M1_DIARY_20251107T171518Z.md:100-127

### M1.K: M1 Acceptance Criteria
- [x] AC1: Instant update <5s → ✅ 570ms (8.8x margin)
- [x] AC2: Segments have expected fields → ✅ All present
- [x] AC3: Safer routes <15% overhead → ✅ All routes 8-11%
- [x] U0-U3: No regressions (data loaders, segments layer, picker, modal)
- [x] U4: Client aggregation verified
- [x] U5: Dynamic alt benefit calculation verified
- [x] U6: Simulator with lifecycle management verified
- [x] U7: Community interactions with session throttle verified
- [x] Build: Success (0 errors)
- [x] Memory: No leaks, idempotent layers
- **Result:** ✅ PASS - READY TO MERGE

### M1 Summary
- **Sections:** 11/11 PASS
- **Issues:** 0 blockers, 0 critical, 0 major, 0 minor
- **Performance:** All targets met or exceeded
- **Documentation:** Complete and consistent
- **Recommendation:** ✅ **MERGE to main** (No blocking risks)

**Audit Report:** logs/AGENTM_AUDIT_M1_CLOSURE_2025-11-11T122604.md

---

## Final Sign-Off

- [ ] All sections A-K completed
- [ ] All acceptance criteria met
- [ ] No critical issues found
- [ ] Audit report written and reviewed
- [ ] Evidence artifacts collected (screenshots, logs, test output)
- [ ] Recommendation: APPROVE / REJECT / NEEDS REVISION

**Auditor Signature:** ___________________________
**Date:** ___________________________

---

**End of Checklist**
