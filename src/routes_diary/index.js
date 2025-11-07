/**
 * Route Safety Diary - Main Orchestrator
 *
 * Responsibilities implemented for M1 U0/U1:
 *  - Load demo segments/routes when the diary flag is on
 *  - Log dataset counts (for preflight validation)
 *  - Mount the baseline segments layer with hover affordances
 *
 * Remaining TODOs (Recorder dock, modal wiring, etc.) stay below for the next packet.
 */

import { mountSegmentsLayer, updateSegmentsData, removeSegmentsLayer } from '../map/segments_layer.js';

const SEGMENT_SOURCE_ID = 'diary-segments';
const SEGMENT_URL_CANDIDATES = [
  '/data/segments_phl.demo.geojson',
  new URL('../../data/segments_phl.demo.geojson', import.meta.url).href,
];
const ROUTE_URL_CANDIDATES = [
  '/data/routes_phl.demo.geojson',
  new URL('../../data/routes_phl.demo.geojson', import.meta.url).href,
];

const DEFAULT_SEGMENT_PROPS = {
  decayed_mean: 3,
  n_eff: 1,
  delta_30d: 0,
  top_tags: [],
};

let cachedSegments = null;
let cachedRoutes = null;
let mapRef = null;
let layerMounted = false;
let lastLoadedSegments = null;
let lastLoadedRoutes = null;

const clone = (obj) => (typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));

async function fetchJsonWithFallback(label, urls) {
  let lastError;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) {
        throw new Error(`${label} request failed (${res.status})`);
      }
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error(`${label} data unavailable`);
}

function ensureFeatureCollection(payload, label) {
  if (!payload || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw new Error(`[Diary] Invalid ${label} file — expected FeatureCollection`);
  }
  return payload;
}

function normalizeTopTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => {
      if (typeof tag === 'string') return { tag, p: 1 };
      if (tag && typeof tag.tag === 'string') {
        return { tag: tag.tag, p: Number.isFinite(tag.p) ? Number(tag.p) : 0 };
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeSegmentsCollection(collection) {
  const fc = clone(collection);
  fc.features = (fc.features || []).map((feature, idx) => {
    const f = clone(feature);
    const props = { ...(f.properties || {}) };
    const segmentId = typeof props.segment_id === 'string' && props.segment_id.trim() ? props.segment_id.trim() : `seg_demo_${idx + 1}`;
    const decayedMean = Number.isFinite(props.decayed_mean) ? props.decayed_mean : DEFAULT_SEGMENT_PROPS.decayed_mean;
    const nEff = Number.isFinite(props.n_eff) ? props.n_eff : DEFAULT_SEGMENT_PROPS.n_eff;
    const delta30d = Number.isFinite(props.delta_30d) ? props.delta_30d : DEFAULT_SEGMENT_PROPS.delta_30d;
    const topTags = normalizeTopTags(props.top_tags ?? DEFAULT_SEGMENT_PROPS.top_tags);
    f.properties = {
      ...props,
      segment_id: segmentId,
      street: props.street || 'Unknown',
      decayed_mean: Math.min(5, Math.max(1, decayedMean)),
      n_eff: Math.max(0, nEff),
      delta_30d: delta30d,
      top_tags: topTags,
    };
    return f;
  });
  return fc;
}

function normalizeRoutesCollection(collection) {
  const fc = clone(collection);
  fc.features = (fc.features || []).map((feature, idx) => {
    const f = clone(feature);
    const props = { ...(f.properties || {}) };
    const ids = Array.isArray(props.segment_ids) ? props.segment_ids.map((id) => String(id)) : [];
    if (ids.length === 0) {
      throw new Error(`[Diary] Route feature at index ${idx} is missing segment_ids array.`);
    }
    f.properties = {
      route_id: typeof props.route_id === 'string' ? props.route_id : `route_demo_${idx + 1}`,
      name: props.name || 'Demo route',
      mode: props.mode || 'walk',
      from: props.from || 'Unknown',
      to: props.to || 'Unknown',
      length_m: Number(props.length_m) || 0,
      duration_min: Number(props.duration_min) || 0,
      segment_ids: ids,
    };
    return f;
  });
  return fc;
}

function logMissingSegments(routes, segments) {
  const segmentIds = new Set((segments.features || []).map((f) => f?.properties?.segment_id));
  const issues = [];
  for (const route of routes.features || []) {
    const missing = route.properties.segment_ids.filter((id) => !segmentIds.has(id));
    if (missing.length) {
      issues.push(`${route.properties.route_id}: ${missing.join(', ')}`);
    }
  }
  if (issues.length) {
    console.warn('[Diary] Route seed references missing segments:', issues.join(' | '));
  }
}

function diaryFlagOff() {
  console.warn('[Diary] Feature flag is OFF. Set VITE_FEATURE_DIARY=1 to enable.');
}

function ensureMap(message) {
  if (!mapRef) {
    throw new Error(message || '[Diary] Map instance missing');
  }
  return mapRef;
}

export async function loadDemoSegments({ force = false } = {}) {
  if (cachedSegments && !force) {
    return clone(cachedSegments);
  }
  const payload = await fetchJsonWithFallback('segments', SEGMENT_URL_CANDIDATES);
  cachedSegments = normalizeSegmentsCollection(ensureFeatureCollection(payload, 'segments'));
  return clone(cachedSegments);
}

export async function loadDemoRoutes({ force = false } = {}) {
  if (cachedRoutes && !force) {
    return clone(cachedRoutes);
  }
  const payload = await fetchJsonWithFallback('routes', ROUTE_URL_CANDIDATES);
  cachedRoutes = normalizeRoutesCollection(ensureFeatureCollection(payload, 'routes'));
  return clone(cachedRoutes);
}

/**
 * Initialize Route Safety Diary mode
 * @param {MapLibreMap} map - MapLibre GL map instance
 */
export async function initDiaryMode(map) {
  const stats = { segmentsCount: 0, routesCount: 0 };
  if (import.meta?.env?.VITE_FEATURE_DIARY !== '1') {
    diaryFlagOff();
    return stats;
  }

  if (!map) {
    console.warn('[Diary] initDiaryMode called without a MapLibre instance.');
    return stats;
  }

  mapRef = map;

  try {
    const [segments, routes] = await Promise.all([loadDemoSegments(), loadDemoRoutes()]);
    lastLoadedSegments = segments;
    lastLoadedRoutes = routes;
    stats.segmentsCount = segments.features.length;
    stats.routesCount = routes.features.length;
    console.info('[Diary] segments loaded:', stats.segmentsCount);
    console.info('[Diary] routes loaded:', stats.routesCount);
    logMissingSegments(routes, segments);

    if (layerMounted) {
      updateSegmentsData(mapRef, SEGMENT_SOURCE_ID, segments);
    } else {
      mountSegmentsLayer(mapRef, SEGMENT_SOURCE_ID, segments);
      layerMounted = true;
    }
  } catch (err) {
    console.error('Demo data missing; please ensure files exist under /data/*.demo.geojson.', err);
  }

  return stats;
}

/**
 * Teardown diary mode (cleanup)
 * @param {MapLibreMap} map - MapLibre GL map instance
 */
export function teardownDiaryMode(map) {
  const targetMap = map || mapRef;
  if (!targetMap) return;
  removeSegmentsLayer(targetMap, SEGMENT_SOURCE_ID);
  layerMounted = false;
  console.info('[Diary] Teardown complete.');
}

/**
 * Create RecorderDock UI (floating bottom-right)
 * @returns {HTMLElement} Dock element
 */
function createRecorderDock() {
  // TODO: Create floating div with 3 buttons (Start/Pause/Finish)
  // TODO: Wire event handlers
  // TODO: Inject CSS
  // See: docs/SCENARIO_MAPPING.md (Scenario 1, RecorderDock)
}

/**
 * Create mode selector (optional TopBar extension)
 * @returns {HTMLElement} Mode selector element
 */
function createModeSelector() {
  // TODO: Create mode switcher with 3 buttons (Crime/Diary/Tracts)
  // TODO: Wire mode switch handlers
  // See: docs/SCENARIO_MAPPING.md (Scenario 1, TopBar)
}

/**
 * Create diary controls in LeftPanel
 */
function createDiaryControls() {
  // TODO: Extend existing left panel with diary buttons
  // TODO: Plan route (disabled), Record trip, My routes (disabled), Legend
  // See: docs/SCENARIO_MAPPING.md (Scenario 1, LeftPanel)
}

/**
 * Initialize insights panel (RightPanel placeholders)
 */
function initInsightsPanel() {
  // TODO: Add 3 placeholder boxes (Trend, Tags, Heatmap)
  // TODO: Replace placeholders with Chart.js canvases after first rating
  // See: docs/SCENARIO_MAPPING.md (Scenario 3, Insights)
}

/**
 * Populate insights panel with real data
 * @param {Array} updatedSegments - Segments with new ratings
 */
function populateInsightsPanel(updatedSegments) {
  // TODO: Render trend chart (8-week sparkline)
  // TODO: Render top tags chart (3 horizontal bars)
  // TODO: Render 7x24 heatmap
  // See: docs/DIARY_EXEC_PLAN_M1.md (Phase 4)
}

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {number} duration - Duration in ms (default: 2000)
 */
function showToast(message, duration = 2000) {
  // TODO: Create toast div (top-center, fixed position)
  // TODO: Fade-in animation
  // TODO: Auto-dismiss after duration
  // TODO: Fade-out and remove from DOM
  // See: docs/SCENARIO_MAPPING.md (Scenario 3, Toast)
}

/**
 * Handle segment click event
 * @param {string} segmentId - Segment ID
 * @param {object} lngLat - Click coordinates {lng, lat}
 */
function onSegmentClick(segmentId, lngLat) {
  // TODO: Fetch segment details (mock data for M1)
  // TODO: Create floating SegmentCard near click point
  // TODO: Wire action buttons (Agree, Feels safer, View insights)
  // See: docs/SCENARIO_MAPPING.md (Scenario 4, SegmentCard)
}

/**
 * Close segment card
 */
function closeSegmentCard() {
  // TODO: Remove SegmentCard from DOM
}

/**
 * Open community details modal
 * @param {string} segmentId - Segment ID
 */
function openCommunityDetailsModal(segmentId) {
  // TODO: Fetch full segment analytics (mock data for M1)
  // TODO: Create full-screen modal with backdrop
  // TODO: Render 7 sections (overview, trend, distribution, tags, timeline, privacy)
  // TODO: Wire close handlers (X button, backdrop click)
  // See: docs/SCENARIO_MAPPING.md (Scenario 4, CommunityDetailsModal)
}

/**
 * Close community details modal
 */
function closeCommunityDetailsModal() {
  // TODO: Remove modal from DOM
}

// GPS Recording state machine
let recordingState = 'idle'; // 'idle' | 'recording' | 'paused' | 'finished'
let mockGPSTrace = [];
let gpsInterval = null;

/**
 * Handle "Start" button click
 */
function onStartRecording() {
  // TODO: Set state to 'recording'
  // TODO: Start mock GPS generation (1 point/sec)
  // TODO: Update button states
  // See: docs/DIARY_EXEC_PLAN_M1.md (Phase 2)
}

/**
 * Handle "Pause" button click
 */
function onPauseRecording() {
  // TODO: Set state to 'paused'
  // TODO: Stop GPS generation (clear interval)
  // TODO: Update button states
}

/**
 * Handle "Finish" button click
 */
function onFinishRecording() {
  // TODO: Set state to 'finished'
  // TODO: Stop GPS generation
  // TODO: Open RatingModal with mockGPSTrace
  // TODO: Reset state after modal closed
  // See: docs/DIARY_EXEC_PLAN_M1.md (Phase 3)
}

/**
 * Generate mock GPS point (interpolate along seed segments)
 * @returns {object} {lat, lng, timestamp}
 */
function generateMockGPSPoint() {
  // TODO: Interpolate along seed segment LineStrings
  // TODO: Add random noise (±5m)
  // TODO: Return {lat, lng, timestamp}
}

/**
 * Update RecorderDock button states based on recordingState
 */
function updateRecorderButtons() {
  // TODO: Enable/disable buttons based on current state
  // TODO: Update colors (green/yellow/red)
}
