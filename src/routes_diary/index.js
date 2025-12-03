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

import { mountSegmentsLayer, updateSegmentsData, removeSegmentsLayer, registerSegmentActionHandler } from '../map/segments_layer.js';
import { addNetworkLayer, ensureNetworkLayer, removeNetworkLayer } from '../map/network_layer.js';
import { drawRouteOverlay, clearRouteOverlay, drawSimPoint, clearSimPoint } from '../map/routing_overlay.js';
import { HAS_DIARY_LIGHT_STYLE } from '../config.js';
import { openRatingModal, closeRatingModal } from './form_submit.js';
import { weightFor, bayesianShrink, effectiveN, clampMean } from '../utils/decay.js';
import { store, setSelectedRouteId, setDiaryAltEnabled, setSimPanelState, setSimPlaybackSpeed, setDiaryDemoPeriod, setDiaryTimeFilter, setDiaryViewMode, setDiarySelectedHistoryRouteId, setDiaryCommunityRadiusMeters } from '../state/store.js';

const SEGMENT_SOURCE_ID = 'diary-segments';
const ROUTE_OVERLAY_SOURCE_ID = 'diary-route-overlay';
const ALT_ROUTE_SOURCE_ID = 'diary-alt-route';
const SIM_POINT_SOURCE_ID = 'diary-sim-point';
const SIM_INTERVAL_MS = 400;
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

const MOCK_HISTORY_ROUTES = [
  { id: 'hist_001', date: 'Nov 24', label: 'Penn Campus → 9th & Christian', mode: 'bike', score: 3.5 },
  { id: 'hist_002', date: 'Nov 20', label: '30th St Station → Art Museum', mode: 'bike', score: 4.2 },
  { id: 'hist_003', date: 'Nov 15', label: 'South St → Market St', mode: 'walk', score: 2.6 },
  { id: 'hist_004', date: 'Nov 10', label: 'Rittenhouse → Passyunk', mode: 'bike', score: 4.6 },
];

const MOCK_COMMUNITY_SEGMENTS = [
  { id: 'seg_c1', name: 'South St Bridge (westbound)', score: 1.8, tags: 'poor lighting, aggressive drivers' },
  { id: 'seg_c2', name: '34th & Walnut (eastbound)', score: 2.2, tags: 'construction, potholes' },
  { id: 'seg_c3', name: 'Chestnut St (river to 34th)', score: 2.9, tags: 'heavy traffic' },
];

const MOCK_COMMENTS = [
  { id: 'c1', user: 'SarahK', ago: '2h ago', text: 'South St Bridge feels unsafe at night.' },
  { id: 'c2', user: 'BikePhilly', ago: '5h ago', text: 'Watch for cars edging into bike lane near 34th.' },
  { id: 'c3', user: 'TrailRunner', ago: '1d ago', text: 'Pine St detour is calmer this week.' },
];

const segmentLookup = new Map();

let cachedSegments = null;
let cachedRoutes = null;
let mapRef = null;
let layerMounted = false;
let lastLoadedSegments = null;
let lastLoadedRoutes = null;
let routesRef = null;
let routeById = new Map();
let diaryPanelEl = null;
let routeSelectEl = null;
let summaryStripEl = null;
let rateButtonEl = null;
let altToggleEl = null;
let altSummaryEl = null;
let panelNoticeEl = null;
let panelNoticeTimer = null;
let diaryPanelFloating = false;
let playButtonEl = null;
let pauseButtonEl = null;
let finishButtonEl = null;
let currentRoute = null;
let toastEl = null;
let toastTimer = null;
const USER_HASH_KEY = 'diary_demo_user_hash';
let cachedUserHash = null;
const localAgg = new Map();
let baseSegmentsFC = null;
let perfLastSubmit = { ms: null, at: null };
const nowMs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const HALF_LIFE_DAYS = 21;
const PRIOR_MEAN = 3.0;
const PRIOR_N = 5;
const LOW_RATING_THRESHOLD = 2.6;
const CTA_KINDS = ['agree', 'safer'];
const CTA_VOTE_PREFIX = 'diary:voted';
const ctaSessionFlags = new Map();
const sim = {
  routeId: null,
  coords: [],
  idx: 0,
  timer: null,
  active: false,
  paused: true,
  hasStarted: false,
  playedOnce: false,
};
const simLifecycleFlags = { visibility: false, pagehide: false };
const simCleanupFns = new Set();
let networkStyleCleanup = null;
let muteNoticeLogged = false;
const diaryQs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search || '') : new URLSearchParams('');
const diaryPath = typeof window !== 'undefined' ? window.location.pathname || '' : '';
const ROUTE_SAFETY_EXPRESSION = [
  'case',
  ['>=', ['coalesce', ['get', 'overlay_safety'], 3], 4], '#34d399',
  ['>=', ['coalesce', ['get', 'overlay_safety'], 3], 2.5], '#fbbf24',
  '#f87171',
];
let historyPeriodFilter = '30d';
let historyModeFilter = 'all';

function diaryFeatureEnabled() {
  if (store?.diaryFeatureOn) return true;
  if (import.meta?.env?.VITE_FEATURE_DIARY === '1') return true;
  if (diaryQs.get('mode') === 'diary') return true;
  if (diaryPath.includes('diary-demo')) return true;
  return false;
}

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

function ensureNetworkOverlayLifecycle(map) {
  if (!map || typeof map.on !== 'function' || typeof networkStyleCleanup === 'function') return;
  const handleStyleRefresh = () => {
    Promise.resolve(ensureNetworkLayer(map)).catch((err) => {
      console.warn('[Diary] Network layer refresh skipped after styledata event.', err);
    });
  };
  map.on('styledata', handleStyleRefresh);
  networkStyleCleanup = () => {
    if (typeof map.off === 'function') {
      map.off('styledata', handleStyleRefresh);
    }
    networkStyleCleanup = null;
  };
}

function cleanupNetworkOverlayLifecycle() {
  if (typeof networkStyleCleanup === 'function') {
    networkStyleCleanup();
  }
}

function setDiaryMapSkin(map, enabled) {
  const container = map && typeof map.getContainer === 'function' ? map.getContainer() : null;
  if (!container) return;
  const shouldMute = !!enabled && !HAS_DIARY_LIGHT_STYLE;
  container.classList.toggle('diary-map-muted', shouldMute);
  if (shouldMute && !muteNoticeLogged) {
    console.info('[Diary] MapTiler key missing, falling back to muted OSM basemap.');
    muteNoticeLogged = true;
  }
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
    const altIds = Array.isArray(props.alt_segment_ids) ? props.alt_segment_ids.map((id) => String(id)).filter(Boolean) : [];
    const altLength = Number(props.alt_length_m);
    const altDuration = Number(props.alt_duration_min);
    const altGeometry = props.alt_geometry && typeof props.alt_geometry === 'object' ? clone(props.alt_geometry) : null;
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
      alt_segment_ids: altIds,
      alt_length_m: Number.isFinite(altLength) ? altLength : undefined,
      alt_duration_min: Number.isFinite(altDuration) ? altDuration : undefined,
    };
    if (altGeometry) {
      f.properties.alt_geometry = altGeometry;
    }
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

function buildSegmentLookup(collection) {
  segmentLookup.clear();
  if (!collection || !Array.isArray(collection.features)) return;
  collection.features.forEach((feature) => {
    const id = feature?.properties?.segment_id;
    if (id) {
      segmentLookup.set(id, feature);
    }
  });
}

function ensureRouteIndex(routes) {
  routeById = new Map();
  if (!routes || !Array.isArray(routes.features)) return;
  routes.features.forEach((feature) => {
    const id = feature?.properties?.route_id;
    if (id) {
      routeById.set(id, feature);
    }
  });
}

function buildRouteOverlayCollection(routeFeature, idsKey = 'segment_ids') {
  if (!routeFeature) return null;
  const props = routeFeature.properties || {};
  const ids = Array.isArray(props[idsKey]) ? props[idsKey] : [];
  if (!ids.length) return routeFeature;
  const features = [];
  ids.forEach((id, idx) => {
    const seg = segmentLookup.get(id);
    if (!seg?.geometry) return;
    const segProps = seg.properties || {};
    const safety = Number(segProps.decayed_mean);
    features.push({
      type: 'Feature',
      geometry: clone(seg.geometry),
      properties: {
        overlay_safety: Number.isFinite(safety) ? safety : 3,
        overlay_seq: idx,
      },
    });
  });
  return features.length ? { type: 'FeatureCollection', features } : routeFeature;
}

function initLocalAggFromSegments(featureCollection) {
  localAgg.clear();
  baseSegmentsFC = clone(featureCollection);
  if (!featureCollection || !Array.isArray(featureCollection.features)) return;
  featureCollection.features.forEach((feature) => {
    const props = feature.properties || {};
    const id = props.segment_id;
    if (!id) return;
    const mean = Number.isFinite(props.decayed_mean) ? props.decayed_mean : 3;
    const nEff = Number.isFinite(props.n_eff) ? props.n_eff : 1;
    const delta = Number.isFinite(props.delta_30d) ? props.delta_30d : 0;
    const tags = Array.isArray(props.top_tags) ? props.top_tags : [];
    localAgg.set(id, {
      mean,
      sumW: Math.max(0, nEff),
      n_eff: Math.max(0, nEff),
      top_tags: tags,
      tagCounts: toCounts(tags),
      updated: new Date().toISOString(),
      win30: { sum: mean * Math.max(1, nEff), w: Math.max(1, nEff) },
      delta_30d: delta,
    });
  });
}

function toCounts(tagPairs) {
  const map = Object.create(null);
  for (const pair of tagPairs) {
    if (!pair || !pair.tag) continue;
    map[pair.tag] = Math.max(1, map[pair.tag] || 0);
  }
  return map;
}

function voteStorageKey(segmentId, kind) {
  return `${CTA_VOTE_PREFIX}:${kind}:${segmentId}`;
}

function getVoteFlag(segmentId, kind) {
  if (!segmentId || !kind) return null;
  try {
    return window?.sessionStorage?.getItem(voteStorageKey(segmentId, kind)) || null;
  } catch {
    return null;
  }
}

function setVoteFlag(segmentId, kind) {
  if (!segmentId || !kind) return;
  try {
    window?.sessionStorage?.setItem(voteStorageKey(segmentId, kind), new Date().toISOString());
  } catch {}
  hydrateCtaState(segmentId);
}

function hydrateCtaState(segmentId) {
  if (!segmentId) return;
  const entry = ctaSessionFlags.get(segmentId) || { agree: null, safer: null };
  CTA_KINDS.forEach((kind) => {
    entry[kind] = getVoteFlag(segmentId, kind);
  });
  ctaSessionFlags.set(segmentId, entry);
}

function getCtaState(segmentId) {
  if (!segmentId) {
    return { agreeDisabled: false, saferDisabled: false, agreeTimestamp: null, saferTimestamp: null };
  }
  if (!ctaSessionFlags.has(segmentId)) {
    hydrateCtaState(segmentId);
  }
  const entry = ctaSessionFlags.get(segmentId) || {};
  return {
    agreeDisabled: Boolean(entry.agree),
    saferDisabled: Boolean(entry.safer),
    agreeTimestamp: entry.agree || null,
    saferTimestamp: entry.safer || null,
  };
}

function isThrottled(segmentId, kind) {
  const state = getCtaState(segmentId);
  return kind === 'agree' ? state.agreeDisabled : state.saferDisabled;
}

function exposeCtaHelpers() {
  if (typeof window === 'undefined') return;
  window.__diary_hydrateCtaState = hydrateCtaState;
  window.__diary_getCtaState = (segmentId) => getCtaState(segmentId);
}

function exposeDebugAPI() {
  if (typeof window === 'undefined') return;
  exposeCtaHelpers();
  window.__diary_debug = Object.freeze({
    segmentProps: (segmentId) => {
      if (!segmentId) return null;
      const agg = localAgg.get(segmentId);
      return agg ? JSON.parse(JSON.stringify(agg)) : null;
    },
    listSources: () => captureMapState().sources,
    listLayers: () => captureMapState().layers,
    simState: () =>
      JSON.parse(
        JSON.stringify({
          routeId: sim.routeId,
          idx: sim.idx,
          coords: sim.coords.length,
          active: sim.active,
          paused: sim.paused,
          hasStarted: sim.hasStarted,
          playedOnce: sim.playedOnce,
          stored: store.simState || {},
        })
      ),
    runP3IdempotenceCycles: (opts) => runP3IdempotenceCycles(opts),
    runP4Stress: (opts) => runP4Stress(opts),
    getPerfSnapshot: () => ({ ...getPerfSnapshot() }),
  });
}

function diaryFlagOff() {
  console.warn('[Diary] Feature flag is OFF. Enable via VITE_FEATURE_DIARY=1 or load with ?mode=diary/diary-demo.');
}

function ensureMap(message) {
  if (!mapRef) {
    throw new Error(message || '[Diary] Map instance missing');
  }
  return mapRef;
}

function ensureDiaryPanel(routes, options = {}) {
  if (typeof document === 'undefined') return;
  if (!routes) return;
  const mountTarget = options?.mountInto || null;

  if (mountTarget && diaryPanelEl !== mountTarget) {
    diaryPanelEl = mountTarget;
    diaryPanelFloating = false;
  }

  if (!diaryPanelEl) {
    const panel = mountTarget || document.createElement('div');
    if (!mountTarget) {
      panel.id = 'diary-route-panel';
      panel.style.position = 'absolute';
      panel.style.top = '88px';
      panel.style.left = '24px';
      panel.style.width = '280px';
      panel.style.zIndex = '20';
      panel.style.background = 'rgba(255,255,255,0.95)';
      panel.style.border = '1px solid #e5e7eb';
      panel.style.borderRadius = '12px';
      panel.style.boxShadow = '0 10px 30px rgba(15,23,42,0.08)';
      panel.style.padding = '16px';
      panel.style.font = '13px/1.4 "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      panel.style.color = '#0f172a';
      panel.setAttribute('data-diary-floating', 'true');
      document.body.appendChild(panel);
      diaryPanelFloating = true;
    } else {
      panel.style.position = 'relative';
      panel.style.background = '#fff';
      panel.style.border = '1px solid #e2e8f0';
      panel.style.borderRadius = '12px';
      panel.style.padding = '16px';
      panel.style.boxShadow = 'inset 0 0 0 1px rgba(148,163,184,0.2)';
      panel.style.minHeight = '220px';
      diaryPanelFloating = false;
    }
    diaryPanelEl = panel;
  }

  diaryPanelEl.innerHTML = '';
  diaryPanelEl.classList.add('diary-panel-shell');

  const title = document.createElement('div');
  title.style.display = 'flex';
  title.style.flexDirection = 'column';
  title.style.gap = '2px';
  const titleText = document.createElement('h3');
  titleText.textContent = 'Route Safety Diary (demo)';
  const subtitle = document.createElement('div');
  subtitle.textContent = 'Philadelphia • demo data';
  subtitle.style.color = '#6b7280';
  subtitle.style.fontSize = '12px';
  title.appendChild(titleText);
  title.appendChild(subtitle);
  diaryPanelEl.appendChild(title);

  const viewSwitcher = document.createElement('div');
  viewSwitcher.className = 'diary-view-switch';
  const makePill = (label, mode) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.className = 'diary-view-pill';
    btn.addEventListener('click', () => {
      setDiaryViewMode(mode);
      renderActivePanel();
    });
    return { btn, mode };
  };
  const pills = [
    makePill('Live route', 'live'),
    makePill('My routes', 'history'),
    makePill('Community', 'community'),
  ];
  pills.forEach((p) => viewSwitcher.appendChild(p.btn));
  diaryPanelEl.appendChild(viewSwitcher);

  const body = document.createElement('div');
  diaryPanelEl.appendChild(body);

  const syncPills = () => {
    pills.forEach((p) => {
      p.btn.classList.toggle('is-active', store.diaryViewMode === p.mode);
    });
  };

  const renderActivePanel = () => {
    syncPills();
    body.innerHTML = '';
    if (store.diaryViewMode === 'history') {
      renderHistoryPanel(body);
    } else if (store.diaryViewMode === 'community') {
      renderCommunityPanel(body);
    } else {
      renderLiveRoutePanel(body, routes);
    }
  };

  renderActivePanel();
}

function styleSimButton(btn) {
  btn.style.flex = '1';
  btn.style.padding = '10px 12px';
  btn.style.borderRadius = '10px';
  btn.style.border = '1px solid #e2e8f0';
  btn.style.background = '#fff';
  btn.style.cursor = 'pointer';
  btn.style.fontSize = '13px';
  btn.style.fontWeight = '700';
}

function populateRouteOptions(routes) {
  if (!routeSelectEl || !routes?.features) return;
  const previous = routeSelectEl.value;
  routeSelectEl.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a route';
  routeSelectEl.appendChild(placeholder);
  routes.features.forEach((feature) => {
    const props = feature.properties || {};
    const option = document.createElement('option');
    option.value = props.route_id;
    option.textContent = props.name || props.route_id;
    routeSelectEl.appendChild(option);
  });
  const desired = store.selectedRouteId || previous;
  if (desired) {
    routeSelectEl.value = desired;
  }
}

function clearLiveRefs() {
  routeSelectEl = null;
  summaryStripEl = null;
  rateButtonEl = null;
  altToggleEl = null;
  altSummaryEl = null;
  panelNoticeEl = null;
  playButtonEl = null;
  pauseButtonEl = null;
  finishButtonEl = null;
}

function renderLiveRoutePanel(root, routes) {
  clearLiveRefs();
  const routeCard = document.createElement('div');
  routeCard.className = 'diary-section-card';
  const routeLabel = document.createElement('div');
  routeLabel.className = 'diary-section-label';
  routeLabel.textContent = 'Route selector';
  routeCard.appendChild(routeLabel);

  routeSelectEl = document.createElement('select');
  routeSelectEl.className = 'diary-select';
  routeSelectEl.addEventListener('change', (event) => {
    const routeId = event.target.value;
    if (routeId) {
      selectRoute(routeId, { fitBounds: true });
    }
  });
  routeCard.appendChild(routeSelectEl);

  summaryStripEl = document.createElement('div');
  summaryStripEl.id = 'diary-route-summary';
  summaryStripEl.className = 'diary-muted-card';
  summaryStripEl.style.minHeight = '72px';
  summaryStripEl.style.display = 'flex';
  summaryStripEl.style.flexDirection = 'column';
  summaryStripEl.style.gap = '4px';
  summaryStripEl.textContent = 'Select a route to see its details.';
  summaryStripEl.style.marginTop = '10px';
  routeCard.appendChild(summaryStripEl);
  root.appendChild(routeCard);

  const actionsCard = document.createElement('div');
  actionsCard.className = 'diary-section-card';
  const actionsHeader = document.createElement('div');
  actionsHeader.className = 'diary-section-header';
  const actionsLabel = document.createElement('div');
  actionsLabel.className = 'diary-section-label';
  actionsLabel.textContent = 'Comparison';
  actionsHeader.appendChild(actionsLabel);
  actionsCard.appendChild(actionsHeader);

  const altToggleRow = document.createElement('label');
  altToggleRow.style.display = 'flex';
  altToggleRow.style.alignItems = 'center';
  altToggleRow.style.gap = '8px';
  altToggleRow.style.fontSize = '13px';
  altToggleRow.style.color = '#475569';
  altToggleEl = document.createElement('input');
  altToggleEl.type = 'checkbox';
  altToggleEl.style.cursor = 'pointer';
  altToggleEl.addEventListener('change', () => {
    applyAltToggleState(altToggleEl.checked);
  });
  const altToggleText = document.createElement('span');
  altToggleText.textContent = 'Show alternative route';
  altToggleRow.appendChild(altToggleEl);
  altToggleRow.appendChild(altToggleText);
  actionsCard.appendChild(altToggleRow);

  altSummaryEl = document.createElement('div');
  altSummaryEl.className = 'diary-muted-card';
  altSummaryEl.style.marginTop = '8px';
  altSummaryEl.style.fontSize = '12px';
  altSummaryEl.style.color = '#334155';
  altSummaryEl.textContent = 'Toggle the switch to compare safer detours.';
  actionsCard.appendChild(altSummaryEl);

  panelNoticeEl = document.createElement('div');
  panelNoticeEl.style.marginTop = '8px';
  panelNoticeEl.style.borderRadius = '8px';
  panelNoticeEl.style.padding = '8px 10px';
  panelNoticeEl.style.fontSize = '12px';
  panelNoticeEl.style.display = 'none';
  panelNoticeEl.style.background = '#ecfdf5';
  panelNoticeEl.style.color = '#065f46';
  actionsCard.appendChild(panelNoticeEl);

  const rateWrap = document.createElement('div');
  rateWrap.style.marginTop = '10px';
  rateButtonEl = document.createElement('button');
  rateButtonEl.type = 'button';
  rateButtonEl.textContent = 'Rate this route';
  rateButtonEl.className = 'diary-primary-btn';
  rateButtonEl.style.width = '100%';
  rateButtonEl.style.padding = '12px 14px';
  rateButtonEl.style.fontSize = '14px';
  rateButtonEl.disabled = true;
  rateButtonEl.style.opacity = '0.7';
  rateButtonEl.addEventListener('click', () => {
    if (!rateButtonEl.disabled) {
      openRouteRating();
    }
  });
  rateWrap.appendChild(rateButtonEl);
  actionsCard.appendChild(rateWrap);

  const hint = document.createElement('div');
  hint.textContent = 'Zoom closer (levels 10–14) to see the gray road grid that powers Diary routes.';
  hint.style.fontSize = '11px';
  hint.style.color = '#475569';
  hint.style.marginTop = '8px';
  hint.style.lineHeight = '1.4';
  actionsCard.appendChild(hint);

  root.appendChild(actionsCard);

  const simCard = document.createElement('div');
  simCard.className = 'diary-section-card';
  const simLabel = document.createElement('div');
  simLabel.className = 'diary-section-label';
  simLabel.textContent = 'Simulator';
  simCard.appendChild(simLabel);

  const simControls = document.createElement('div');
  simControls.style.display = 'flex';
  simControls.style.gap = '8px';
  simControls.style.marginTop = '10px';

  playButtonEl = document.createElement('button');
  styleSimButton(playButtonEl);
  playButtonEl.textContent = 'Play';
  playButtonEl.addEventListener('click', () => startSim());
  simControls.appendChild(playButtonEl);

  pauseButtonEl = document.createElement('button');
  styleSimButton(pauseButtonEl);
  pauseButtonEl.textContent = 'Pause';
  pauseButtonEl.addEventListener('click', () => pauseSim());
  simControls.appendChild(pauseButtonEl);

  finishButtonEl = document.createElement('button');
  styleSimButton(finishButtonEl);
  finishButtonEl.textContent = 'Finish → Rate';
  finishButtonEl.addEventListener('click', () => finishSim({ openModal: true }));
  simControls.appendChild(finishButtonEl);

  simCard.appendChild(simControls);

  const playbackLabel = document.createElement('div');
  playbackLabel.className = 'diary-label';
  playbackLabel.style.marginTop = '12px';
  playbackLabel.textContent = 'Playback speed';
  simCard.appendChild(playbackLabel);

  const playbackRow = document.createElement('div');
  playbackRow.style.display = 'flex';
  playbackRow.style.gap = '6px';
  const speeds = [0.5, 1, 2];
  const speedButtons = [];
  speeds.forEach((value) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${value}×`;
    btn.style.flex = '1';
    btn.className = 'diary-pill-btn';
    const sync = () => {
      const active = store.simPlaybackSpeed === value;
      btn.classList.toggle('is-active', active);
    };
    btn.addEventListener('click', () => {
      setSimPlaybackSpeed(value);
      speedButtons.forEach((b) => b.sync());
    });
    btn.sync = sync;
    speedButtons.push(btn);
    playbackRow.appendChild(btn);
  });
  speedButtons.forEach((b) => b.sync());
  simCard.appendChild(playbackRow);

  root.appendChild(simCard);

  const filterCard = document.createElement('div');
  filterCard.className = 'diary-section-card';
  const filterLabel = document.createElement('div');
  filterLabel.className = 'diary-section-label';
  filterLabel.textContent = 'Filters';
  filterCard.appendChild(filterLabel);

  const periodLabel = document.createElement('div');
  periodLabel.className = 'diary-label';
  periodLabel.textContent = 'Demo period';
  periodLabel.style.marginTop = '8px';
  filterCard.appendChild(periodLabel);

  const periodSelect = document.createElement('select');
  periodSelect.className = 'diary-select';
  [
    { value: 'day', label: 'Single day' },
    { value: 'week', label: 'Last 7 days' },
    { value: 'month', label: 'Last 30 days' },
  ].forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    periodSelect.appendChild(option);
  });
  periodSelect.value = store.diaryDemoPeriod || 'day';
  periodSelect.addEventListener('change', () => {
    setDiaryDemoPeriod(periodSelect.value);
  });
  filterCard.appendChild(periodSelect);

  const timeLabel = document.createElement('div');
  timeLabel.className = 'diary-label';
  timeLabel.textContent = 'Time of day';
  timeLabel.style.marginTop = '10px';
  filterCard.appendChild(timeLabel);

  const timeSelect = document.createElement('select');
  timeSelect.className = 'diary-select';
  [
    { value: 'all', label: 'All hours' },
    { value: 'day', label: 'Daytime' },
    { value: 'evening', label: 'Evening' },
    { value: 'night', label: 'Night' },
  ].forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    timeSelect.appendChild(option);
  });
  timeSelect.value = store.diaryTimeFilter || 'all';
  timeSelect.addEventListener('change', () => {
    setDiaryTimeFilter(timeSelect.value);
  });
  filterCard.appendChild(timeSelect);

  const historyBtn = document.createElement('button');
  historyBtn.type = 'button';
  historyBtn.textContent = 'My routes and history (coming soon)';
  historyBtn.style.marginTop = '10px';
  historyBtn.style.width = '100%';
  historyBtn.className = 'diary-pill-btn';
  historyBtn.style.borderStyle = 'dashed';
  historyBtn.style.cursor = 'not-allowed';
  historyBtn.disabled = true;
  historyBtn.addEventListener('click', () => {
    console.info('[Diary] My routes and history is not available yet.');
  });
  filterCard.appendChild(historyBtn);

  root.appendChild(filterCard);

  populateRouteOptions(routes);
  updateSimButtons();
  let desiredRouteId = store.selectedRouteId || null;
  if (!desiredRouteId) {
    const first = routes.features?.[0]?.properties?.route_id;
    if (first) {
      desiredRouteId = first;
    }
  }
  if (desiredRouteId && routeById.has(desiredRouteId)) {
    if (routeSelectEl) {
      routeSelectEl.value = desiredRouteId;
    }
    selectRoute(desiredRouteId, { fitBounds: false });
  }
  applyAltToggleState(store.diaryAltEnabled, { update: true });
  hydrateSimulatorFromPrefs();
}

function renderHistoryPanel(root) {
  const filters = document.createElement('div');
  filters.style.display = 'flex';
  filters.style.gap = '8px';
  filters.style.marginBottom = '10px';

  const periodSelect = document.createElement('select');
  periodSelect.className = 'diary-select';
  ['30d', '7d', 'all'].forEach((value) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value === '30d' ? 'Last 30 days' : value === '7d' ? 'Last 7 days' : 'All time';
    periodSelect.appendChild(opt);
  });
  periodSelect.value = historyPeriodFilter;
  periodSelect.addEventListener('change', () => {
    historyPeriodFilter = periodSelect.value;
    console.info('[Diary] History period', historyPeriodFilter);
    renderHistoryList();
  });
  filters.appendChild(periodSelect);

  const modeSelect = document.createElement('select');
  modeSelect.className = 'diary-select';
  [
    { value: 'all', label: 'All modes' },
    { value: 'walk', label: 'Walk' },
    { value: 'bike', label: 'Bike' },
  ].forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    modeSelect.appendChild(option);
  });
  modeSelect.value = historyModeFilter;
  modeSelect.addEventListener('change', () => {
    historyModeFilter = modeSelect.value;
    console.info('[Diary] History mode', historyModeFilter);
    renderHistoryList();
  });
  filters.appendChild(modeSelect);
  root.appendChild(filters);

  const historyCard = document.createElement('div');
  historyCard.className = 'diary-section-card';
  const header = document.createElement('div');
  header.className = 'diary-section-label';
  header.textContent = 'Route history';
  historyCard.appendChild(header);

  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '8px';
  historyCard.appendChild(list);

  function scoreBadge(score) {
    const pill = document.createElement('div');
    pill.className = 'diary-score-pill';
    pill.textContent = score.toFixed(1);
    if (score > 4) pill.classList.add('is-good');
    else if (score >= 2.5) pill.classList.add('is-mid');
    else pill.classList.add('is-bad');
    return pill;
  }

  function renderHistoryList() {
    list.innerHTML = '';
    const filtered = MOCK_HISTORY_ROUTES.filter((item) => {
      if (historyModeFilter !== 'all' && item.mode !== historyModeFilter) return false;
      return true;
    });
    filtered.forEach((item) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'diary-history-item';
      row.setAttribute('data-id', item.id);
      row.addEventListener('click', () => {
        setDiarySelectedHistoryRouteId(item.id);
        console.info('[Diary] History route selected:', item.id, item.label);
        focusHistoryRouteOnMap(item);
      });
      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.flexDirection = 'column';
      left.style.gap = '2px';
      const date = document.createElement('div');
      date.style.fontSize = '12px';
      date.style.color = '#6b7280';
      date.textContent = item.date;
      const label = document.createElement('div');
      label.style.fontSize = '13px';
      label.style.fontWeight = '600';
      label.style.color = '#0f172a';
      label.textContent = item.label;
      const mode = document.createElement('div');
      mode.style.fontSize = '12px';
      mode.style.color = '#475569';
      mode.textContent = item.mode === 'bike' ? '🚲 Bike' : '🚶 Walk';
      left.appendChild(date);
      left.appendChild(label);
      left.appendChild(mode);

      const right = document.createElement('div');
      right.appendChild(scoreBadge(item.score));

      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    });
  }

  renderHistoryList();
  root.appendChild(historyCard);
}

function renderCommunityPanel(root) {
  const areaCard = document.createElement('div');
  areaCard.className = 'diary-section-card';
  const header = document.createElement('div');
  header.className = 'diary-section-label';
  header.textContent = 'Area focus';
  areaCard.appendChild(header);
  const subtitle = document.createElement('div');
  subtitle.className = 'diary-community-subtitle';
  subtitle.textContent = 'Radius around map center';
  areaCard.appendChild(subtitle);
  const radiusLabel = document.createElement('div');
  radiusLabel.style.fontSize = '12px';
  radiusLabel.style.color = '#475569';
  const updateRadiusLabel = (val) => {
    radiusLabel.textContent = `Radius: ${(val / 1000).toFixed(2)} km`;
  };
  updateRadiusLabel(store.diaryCommunityRadiusMeters || 1500);
  areaCard.appendChild(radiusLabel);
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = 500;
  slider.max = 3000;
  slider.step = 250;
  slider.value = store.diaryCommunityRadiusMeters || 1500;
  slider.style.width = '100%';
  slider.addEventListener('input', () => {
    const val = Number(slider.value);
    updateRadiusLabel(val);
  });
  slider.addEventListener('change', () => {
    const val = Number(slider.value);
    setDiaryCommunityRadiusMeters(val);
    console.info('[Diary] Community radius changed:', val, 'm');
    // TODO: Draw map buffer around center using turf.circle
  });
  areaCard.appendChild(slider);
  root.appendChild(areaCard);

  const segmentsCard = document.createElement('div');
  segmentsCard.className = 'diary-section-card';
  const segHeader = document.createElement('div');
  segHeader.className = 'diary-section-label';
  segHeader.textContent = 'High concern segments';
  segmentsCard.appendChild(segHeader);
  const segList = document.createElement('div');
  segList.style.display = 'flex';
  segList.style.flexDirection = 'column';
  segList.style.gap = '8px';
  MOCK_COMMUNITY_SEGMENTS.forEach((seg) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'diary-history-item';
    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.fontSize = '13px';
    title.textContent = seg.name;
    const meta = document.createElement('div');
    meta.style.display = 'flex';
    meta.style.justifyContent = 'space-between';
    meta.style.alignItems = 'center';
    const tags = document.createElement('div');
    tags.style.fontSize = '12px';
    tags.style.color = '#475569';
    tags.textContent = `Tags: ${seg.tags}`;
    const badge = document.createElement('div');
    badge.className = 'diary-score-pill';
    badge.classList.add(seg.score < 2.5 ? 'is-bad' : seg.score < 4 ? 'is-mid' : 'is-good');
    badge.textContent = seg.score.toFixed(1);
    meta.appendChild(tags);
    meta.appendChild(badge);
    btn.appendChild(title);
    btn.appendChild(meta);
    btn.addEventListener('click', () => {
      console.info('[Diary] Focus high-concern segment:', seg.id, seg.name);
      // TODO: pan/zoom to this segment on the map
    });
    segList.appendChild(btn);
  });
  segmentsCard.appendChild(segList);
  root.appendChild(segmentsCard);

  const commentsCard = document.createElement('div');
  commentsCard.className = 'diary-section-card';
  const cHeader = document.createElement('div');
  cHeader.className = 'diary-section-label';
  cHeader.textContent = 'Community comments';
  commentsCard.appendChild(cHeader);
  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '6px';
  MOCK_COMMENTS.forEach((c) => {
    const row = document.createElement('div');
    row.style.borderBottom = '1px solid #e5e7eb';
    row.style.paddingBottom = '6px';
    row.style.fontSize = '12px';
    row.innerHTML = `<strong style="color:#0f172a;">${c.user}</strong> <span style="color:#94a3b8;">${c.ago}</span><div style="margin-top:2px;color:#111827;">${c.text}</div>`;
    list.appendChild(row);
  });
  commentsCard.appendChild(list);
  const form = document.createElement('form');
  form.style.display = 'flex';
  form.style.gap = '8px';
  form.style.marginTop = '8px';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Add a comment...';
  input.className = 'diary-select';
  input.style.flex = '1';
  const postBtn = document.createElement('button');
  postBtn.type = 'submit';
  postBtn.textContent = 'Post';
  postBtn.className = 'diary-primary-btn';
  postBtn.style.padding = '8px 12px';
  form.appendChild(input);
  form.appendChild(postBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = (input.value || '').trim();
    if (!val) return;
    console.info('[Diary] Post community comment:', val);
    input.value = '';
  });
  commentsCard.appendChild(form);
  root.appendChild(commentsCard);
}

function focusHistoryRouteOnMap(route) {
  void route;
  // TODO: hook up map fit to history geometry when data is available
}

function renderRouteSummary(route) {
  if (!summaryStripEl) return;
  if (!route) {
    summaryStripEl.textContent = 'Select a route to see its details.';
    return;
  }
  const props = route.properties || {};
  const pieces = [
    `<div style="font-weight:700;color:#0f172a;">${props.from || 'Start'}</div>`,
    `<div style="color:#94a3b8;font-weight:600;font-size:12px;">to</div>`,
    `<div style="font-weight:700;color:#0f172a;">${props.to || 'Destination'}</div>`,
  ];
  summaryStripEl.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:#0f172a;">${props.name || props.route_id}</div>
    <div style="display:flex;align-items:center;gap:6px;">${pieces.join('')}</div>
    <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
      <span class="diary-chip" style="border-color:#e2e8f0;">${(props.mode || 'walk').toUpperCase()}</span>
      <span class="diary-chip" style="border-color:#e2e8f0;">${(props.length_m || 0).toLocaleString()} m</span>
      <span class="diary-chip" style="border-color:#e2e8f0;">${props.duration_min || 0} min</span>
    </div>`;
}

function selectRoute(routeId, { fitBounds = false } = {}) {
  if (!routeId || !routeById.has(routeId)) return;
  if (!currentRoute || currentRoute.properties?.route_id !== routeId) {
    teardownDiaryTransient(mapRef, { silent: true });
  }
  const feature = routeById.get(routeId);
  currentRoute = feature;
  // TODO: docs/M3_ROUTE_BOUNDARY_INTEGRATION.md — compute route boundary context (districts/tracts) before we render or submit.
  setSelectedRouteId(routeId);
  setSimPanelState({ playing: false, progress: 0, routeId });
  renderRouteSummary(feature);
  if (routeSelectEl && routeSelectEl.value !== routeId) {
    routeSelectEl.value = routeId;
  }
  if (rateButtonEl) {
    rateButtonEl.disabled = false;
    rateButtonEl.style.opacity = '1';
  }
  if (mapRef) {
    const isCommunity = store.diaryViewMode === 'community';
    const overlayData = buildRouteOverlayCollection(feature, 'segment_ids') || feature;
    drawRouteOverlay(mapRef, ROUTE_OVERLAY_SOURCE_ID, overlayData, {
      lineColorExpression: ROUTE_SAFETY_EXPRESSION,
      width: 7,
      opacity: isCommunity ? 0.7 : 0.95,
    });
    if (fitBounds) {
      fitMapToRoute(feature);
    }
  }
  updateAlternativeRoute();
  updateSimButtons();
}

function fitMapToRoute(route) {
  if (!mapRef || typeof mapRef.fitBounds !== 'function') return;
  const coordinates = extractLineCoordinates(route?.geometry);
  if (!coordinates.length) return;
  let minLng = coordinates[0][0];
  let maxLng = coordinates[0][0];
  let minLat = coordinates[0][1];
  let maxLat = coordinates[0][1];
  coordinates.forEach(([lng, lat]) => {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });
  if (Number.isFinite(minLng) && Number.isFinite(maxLng) && Number.isFinite(minLat) && Number.isFinite(maxLat)) {
    mapRef.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 80, duration: 650 }
    );
  }
}

function extractLineCoordinates(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') {
    return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  }
  if (geometry.type === 'MultiLineString') {
    return (geometry.coordinates || []).flat();
  }
  return [];
}

function openRouteRating() {
  if (!currentRoute) return;
  openRatingModal({
    routeFeature: currentRoute,
    segmentLookup,
    userHash: getUserHash(),
    onSuccess: ({ payload, response }) => {
      handleDiarySubmissionSuccess(payload, response);
    },
  });
}

function handleDiarySubmissionSuccess(payload, response) {
  if (!payload) return;
  const perfStart = nowMs();
  applyDiarySubmissionToAgg(payload);
  const refreshed = buildSegmentsFCFromBase();
  if (refreshed && mapRef) {
    updateSegmentsData(mapRef, SEGMENT_SOURCE_ID, refreshed);
    lastLoadedSegments = refreshed;
  }
  updateAlternativeRoute({ refreshOnly: true });
  showToast('Thanks — your feedback has been recorded for this demo.');
  const affectedCount = new Set(payload.segment_ids || []).size || 1;
  showPanelNotice(`Thanks — your rating improved confidence on ${affectedCount} segment${affectedCount === 1 ? '' : 's'}.`);
  perfLastSubmit = { ms: Math.max(0, Math.round(nowMs() - perfStart)), at: new Date().toISOString() };
  console.info('[Diary] repaint latency (ms):', perfLastSubmit.ms);
  console.info('[Diary] submit payload', payload);
  console.info('[Diary] stub response', response);
}

function applyDiarySubmissionToAgg(payload) {
  if (!payload || !Array.isArray(payload.segment_ids)) return;
  const now = Date.now();
  const overall = Number(payload.overall_rating);
  const tags = Array.isArray(payload.tags) ? payload.tags : [];
  const overrides = normalizeOverrides(payload.segment_overrides);
  for (const segId of payload.segment_ids) {
    const rating = overrides.has(segId) ? overrides.get(segId) : overall;
    if (!Number.isFinite(rating)) continue;
    if (!localAgg.has(segId)) {
      localAgg.set(segId, {
        mean: 3,
        sumW: 0,
        n_eff: 0,
        top_tags: [],
        tagCounts: Object.create(null),
        updated: new Date(now).toISOString(),
        win30: { sum: 0, w: 0 },
        delta_30d: 0,
      });
    }
    const record = localAgg.get(segId);
    decayAggRecord(record, now);
    const wNew = 1;
    const sumW = record.sumW + wNew;
    const meanRaw = (record.mean * record.sumW + rating * wNew) / Math.max(1e-6, sumW);
    const shrunk = clampMean(bayesianShrink(meanRaw, sumW, PRIOR_MEAN, PRIOR_N));
    const prevWinMean = record.win30.w > 0 ? record.win30.sum / record.win30.w : record.mean;
    record.sumW = sumW;
    record.mean = shrunk;
    record.n_eff = effectiveN(sumW);
    record.updated = new Date(now).toISOString();
    for (const tag of tags) {
      if (!record.tagCounts[tag]) record.tagCounts[tag] = 0;
      record.tagCounts[tag] += 1;
    }
    const totalTag = Object.values(record.tagCounts).reduce((sum, val) => sum + val, 0);
    record.top_tags = totalTag > 0
      ? Object.entries(record.tagCounts)
          .map(([tag, count]) => ({ tag, p: Number((count / totalTag).toFixed(2)) }))
          .sort((a, b) => b.p - a.p)
          .slice(0, 5)
      : [];
    record.win30.sum = record.win30.sum + shrunk;
    record.win30.w = Math.min(100, record.win30.w + 1);
    record.delta_30d = Number((shrunk - prevWinMean).toFixed(2));
  }
}

function bumpConfidenceLocal(segmentId) {
  const record = ensureAggRecord(segmentId);
  if (!record) return false;
  record.sumW = Math.min(50, (record.sumW || 0) + 0.3);
  record.n_eff = Math.min(50, record.sumW);
  record.updated = new Date().toISOString();
  return true;
}

function nudgeMeanSaferLocal(segmentId) {
  const record = ensureAggRecord(segmentId);
  if (!record) return false;
  const base = Math.max(0.5, record.sumW || 1);
  record.mean = clampMean(bayesianShrink(record.mean + 0.1, base, PRIOR_MEAN, PRIOR_N));
  record.delta_30d = Number((record.delta_30d + 0.03).toFixed(2));
  record.updated = new Date().toISOString();
  return true;
}

function refreshAfterCta(message) {
  const refreshed = buildSegmentsFCFromBase();
  if (refreshed && mapRef) {
    updateSegmentsData(mapRef, SEGMENT_SOURCE_ID, refreshed);
    lastLoadedSegments = refreshed;
  }
  updateAlternativeRoute({ refreshOnly: true });
  if (message) {
    showToast(message);
  }
  exposeDebugAPI();
}

async function onAgreeClick(segmentId) {
  if (!segmentId) return;
  if (isThrottled(segmentId, 'agree')) {
    showToast('Recorded for this session');
    return;
  }
  const updated = bumpConfidenceLocal(segmentId);
  if (!updated) return;
  setVoteFlag(segmentId, 'agree');
  refreshAfterCta('Thanks — confidence increased');
}

async function onFeelsSaferClick(segmentId) {
  if (!segmentId) return;
  if (isThrottled(segmentId, 'safer')) {
    showToast('Recorded for this session');
    return;
  }
  const updated = nudgeMeanSaferLocal(segmentId);
  if (!updated) return;
  setVoteFlag(segmentId, 'safer');
  refreshAfterCta('Noted — feels safer now');
}

function decayAggRecord(record, now) {
  if (!record) return;
  const last = Date.parse(record.updated || now);
  const factor = weightFor(last || now, now, HALF_LIFE_DAYS);
  if (Number.isFinite(factor) && factor > 0 && factor <= 1) {
    record.sumW *= factor;
    record.win30.sum *= factor;
    record.win30.w *= factor;
  }
}

function buildSegmentsFCFromBase() {
  if (!baseSegmentsFC) return null;
  const fc = clone(baseSegmentsFC);
  fc.features = fc.features.map((feature) => {
    const f = clone(feature);
    const props = { ...(f.properties || {}) };
    const agg = localAgg.get(props.segment_id);
    if (agg) {
      props.decayed_mean = agg.mean;
      props.n_eff = agg.n_eff;
      props.top_tags = agg.top_tags;
      props.delta_30d = agg.delta_30d;
      props.updated = agg.updated;
    }
    const cta = getCtaState(props.segment_id);
    props.__diaryVotes = {
      agreeDisabled: cta.agreeDisabled,
      saferDisabled: cta.saferDisabled,
      agreeTimestamp: cta.agreeTimestamp,
      saferTimestamp: cta.saferTimestamp,
    };
    f.properties = props;
    return f;
  });
  return fc;
}

function normalizeOverrides(list) {
  const map = new Map();
  if (!list) return map;
  if (Array.isArray(list)) {
    list.forEach((entry) => {
      if (!entry || !entry.segment_id) return;
      const value = Number(entry.rating);
      if (!Number.isFinite(value)) return;
      map.set(entry.segment_id, value);
    });
    return map;
  }
  if (typeof list === 'object') {
    Object.entries(list).forEach(([segmentId, rating]) => {
      const value = Number(rating);
      if (segmentId && Number.isFinite(value)) {
        map.set(segmentId, value);
      }
    });
  }
  return map;
}

function ensureAggRecord(segmentId) {
  if (!segmentId) return null;
  if (!localAgg.has(segmentId)) {
    localAgg.set(segmentId, {
      mean: 3,
      sumW: 0,
      n_eff: 0,
      top_tags: [],
      tagCounts: Object.create(null),
      updated: new Date().toISOString(),
      win30: { sum: 0, w: 0 },
      delta_30d: 0,
    });
  }
  return localAgg.get(segmentId);
}

function updateAlternativeRoute({ refreshOnly = false } = {}) {
  if (!mapRef) return;
  if (!currentRoute) {
    clearRouteOverlay(mapRef, ALT_ROUTE_SOURCE_ID);
    renderAltSummary(null, { reason: 'no-route' });
    return;
  }
  const shouldShow = !!store.diaryAltEnabled;
  const altInfo = resolveAlternativeForRoute(currentRoute);
  renderAltSummary(currentRoute, altInfo || null);
  if (!shouldShow || !altInfo) {
    clearRouteOverlay(mapRef, ALT_ROUTE_SOURCE_ID);
    return;
  }
  if (!refreshOnly) {
    const altOverlay = buildRouteOverlayCollection(
      altInfo.feature,
      altInfo.feature?.properties?.alt_segment_ids?.length ? 'alt_segment_ids' : 'segment_ids'
    ) || altInfo.feature;
    drawRouteOverlay(mapRef, ALT_ROUTE_SOURCE_ID, altOverlay, {
      color: '#2563eb',
      width: 4,
      opacity: store.diaryViewMode === 'community' ? 0.6 : 0.75,
      dasharray: [0.6, 0.9],
    });
  }
}

function resolveAlternativeForRoute(routeFeature) {
  if (!routeFeature) return null;
  const props = routeFeature.properties || {};
  const altIds = Array.isArray(props.alt_segment_ids) && props.alt_segment_ids.length > 0 ? props.alt_segment_ids : props.segment_ids || [];
  const altLength = Number.isFinite(props.alt_length_m) ? props.alt_length_m : props.length_m;
  const altDuration = Number.isFinite(props.alt_duration_min) ? props.alt_duration_min : props.duration_min;
  let geometry = props.alt_geometry;
  if (!geometry && altIds.length > 0) {
    geometry = buildGeometryFromSegments(altIds);
  }
  if (!geometry) return null;
  return {
    feature: {
      type: 'Feature',
      geometry,
      properties: {
        route_id: `${props.route_id || 'route'}_alt`,
      },
    },
    meta: {
      segment_ids: altIds,
      alt_length_m: Number(altLength),
      alt_duration_min: Number(altDuration),
    },
  };
}

function buildGeometryFromSegments(segmentIds) {
  if (!segmentIds || segmentIds.length === 0) return null;
  const coords = [];
  segmentIds.forEach((id, idx) => {
    const feature = segmentLookup.get(id);
    if (!feature || !feature.geometry) {
      console.warn('[Diary] Missing geometry for alt segment', id);
      return;
    }
    const lineCoords = extractLineCoordinates(feature.geometry);
    if (lineCoords.length === 0) return;
    if (coords.length === 0) {
      coords.push(...lineCoords);
    } else {
      const last = coords[coords.length - 1];
      const first = lineCoords[0];
      if (last && first && last[0] === first[0] && last[1] === first[1]) {
        coords.push(...lineCoords.slice(1));
      } else {
        coords.push(...lineCoords);
      }
    }
  });
  return coords.length >= 2 ? { type: 'LineString', coordinates: coords } : null;
}

function renderAltSummary(route, altInfo) {
  if (!altSummaryEl) return;
  if (!route) {
    altSummaryEl.textContent = 'Select a route to compare alternatives.';
    return;
  }
  if (!altInfo) {
    altSummaryEl.textContent = 'Alternative data unavailable.';
    return;
  }
  const summary = summarizeAltBenefit(route, altInfo.meta);
  if (!summary) {
    altSummaryEl.textContent = 'Alternative data unavailable.';
    return;
  }
  const avoided = Math.max(0, summary.pLow - summary.aLow);
  const deltaLabel = summary.deltaMin > 0 ? `+${summary.deltaMin.toFixed(1)} min` : `${summary.deltaMin.toFixed(1)} min`;
  const pctLabel = `≈${summary.overheadPct.toFixed(1)}% distance`;
  let reason = 'Current route is best for now.';
  if (avoided > 0) {
    reason = `avoids ${avoided} low-rated segment${avoided === 1 ? '' : 's'} tonight`;
  } else if (summary.overheadPct <= 0) {
    reason = 'No distance penalty tonight';
  }
  altSummaryEl.innerHTML = `
    <div style="font-weight:600;color:#0f172a;font-size:12px;">Alternative comparison</div>
    <div style="font-size:12px;color:#334155;margin-top:2px;">${deltaLabel} • ${pctLabel}</div>
    <div style="font-size:12px;color:#475569;margin-top:4px;">${reason}</div>
  `;
}

function applyAltToggleState(enabled, { update = true } = {}) {
  const next = !!enabled;
  if (altToggleEl) {
    altToggleEl.checked = next;
  }
  setDiaryAltEnabled(next);
  if (update) {
    updateAlternativeRoute({ refreshOnly: false });
  } else {
    updateAlternativeRoute({ refreshOnly: true });
  }
}

function summarizeAltBenefit(primaryRoute, altMeta) {
  if (!primaryRoute || !altMeta) return null;
  const primaryIds = primaryRoute.properties?.segment_ids || [];
  const altIds = altMeta.segment_ids || [];
  const primaryLow = countLowRated(primaryIds);
  const altLow = countLowRated(altIds);
  const primaryLength = Number(primaryRoute.properties?.length_m) || 0;
  const altLength = Number(altMeta.alt_length_m ?? primaryLength) || primaryLength;
  const primaryDuration = Number(primaryRoute.properties?.duration_min) || 0;
  const altDuration = Number(altMeta.alt_duration_min ?? primaryDuration) || primaryDuration;
  const overheadPct = primaryLength > 0 ? ((altLength - primaryLength) / primaryLength) * 100 : 0;
  const deltaMin = Number((altDuration - primaryDuration).toFixed(1));
  return {
    pLow: primaryLow,
    aLow: altLow,
    overheadPct,
    deltaMin,
  };
}

const delay = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

function captureMapState() {
  if (!mapRef || typeof mapRef.getStyle !== 'function') {
    return { sources: [], layers: [] };
  }
  const style = mapRef.getStyle() || {};
  return {
    sources: Object.keys(style.sources || {}),
    layers: (style.layers || []).map((layer) => layer.id),
  };
}

const getPerfSnapshot = () => ({
  ms: perfLastSubmit.ms,
  at: perfLastSubmit.at,
  text: perfLastSubmit.ms == null ? 'n/a' : `${perfLastSubmit.ms} ms (submit → repaint)`,
});

async function runP3IdempotenceCycles({ cycles = 20, delayMs = 75 } = {}) {
  if (!mapRef) {
    return { stable: false, reason: 'map-not-ready', duplicates: [] };
  }
  const routeIds = Array.from(routeById.keys());
  if (!routeIds.length) {
    return { stable: false, reason: 'no-routes', duplicates: [] };
  }
  const duplicates = [];
  for (let i = 0; i < cycles; i += 1) {
    const routeId = routeIds[i % routeIds.length];
    selectRoute(routeId, { fitBounds: false });
    await delay(delayMs);
    applyAltToggleState(true);
    await delay(delayMs);
    applyAltToggleState(false);
    await delay(delayMs);
    const snapshot = captureMapState();
    if (new Set(snapshot.sources).size !== snapshot.sources.length) {
      duplicates.push({ cycle: i, type: 'sources', snapshot: snapshot.sources.slice() });
    }
    if (new Set(snapshot.layers).size !== snapshot.layers.length) {
      duplicates.push({ cycle: i, type: 'layers', snapshot: snapshot.layers.slice() });
    }
  }
  const finalSnapshot = captureMapState();
  return {
    stable: duplicates.length === 0,
    sources: finalSnapshot.sources,
    layers: finalSnapshot.layers,
    duplicates,
  };
}

async function runP4Stress({ cycles = 20, pick = 3, delayMs = 60 } = {}) {
  if (!currentRoute) {
    return { stable: false, reason: 'no-route', duplicates: [], throttledCount: 0, actedSegments: [], at: new Date().toISOString() };
  }
  const segmentIds = currentRoute.properties?.segment_ids || [];
  if (!segmentIds.length) {
    return { stable: false, reason: 'no-segments', duplicates: [], throttledCount: 0, actedSegments: [], at: new Date().toISOString() };
  }
  const duplicates = [];
  const acted = new Set();
  let throttled = 0;
  for (let i = 0; i < cycles; i += 1) {
    const picks = [];
    for (let j = 0; j < Math.min(pick, segmentIds.length); j += 1) {
      picks.push(segmentIds[(i + j) % segmentIds.length]);
    }
    for (const segId of picks) {
      if (!isThrottled(segId, 'agree')) {
        await onAgreeClick(segId);
        acted.add(`${segId}:agree`);
        await delay(delayMs);
      } else {
        throttled += 1;
      }
      if (!isThrottled(segId, 'safer')) {
        await onFeelsSaferClick(segId);
        acted.add(`${segId}:safer`);
        await delay(delayMs);
      } else {
        throttled += 1;
      }
    }
    applyAltToggleState(true);
    await delay(delayMs);
    applyAltToggleState(false);
    await delay(delayMs);
    const snapshot = captureMapState();
    if (new Set(snapshot.sources).size !== snapshot.sources.length) {
      duplicates.push({ cycle: i, type: 'sources', snapshot: snapshot.sources.slice() });
    }
    if (new Set(snapshot.layers).size !== snapshot.layers.length) {
      duplicates.push({ cycle: i, type: 'layers', snapshot: snapshot.layers.slice() });
    }
  }
  const finalSnapshot = captureMapState();
  return {
    stable: duplicates.length === 0,
    sources: finalSnapshot.sources,
    layers: finalSnapshot.layers,
    duplicates,
    throttledCount: throttled,
    actedSegments: Array.from(acted),
    at: new Date().toISOString(),
  };
}

function countLowRated(segmentIds) {
  if (!segmentIds) return 0;
  return segmentIds.reduce((sum, id) => {
    const rating = getCurrentSegmentMean(id);
    return sum + (rating < LOW_RATING_THRESHOLD ? 1 : 0);
  }, 0);
}

function getCurrentSegmentMean(segId) {
  if (localAgg.has(segId)) {
    return localAgg.get(segId).mean;
  }
  const feature = segmentLookup.get(segId);
  const props = feature?.properties || {};
  return Number.isFinite(props.decayed_mean) ? props.decayed_mean : 3;
}

function getSimProgressRatio() {
  if (!sim.coords || sim.coords.length <= 1) return 0;
  return Math.min(1, sim.idx / (sim.coords.length - 1));
}

function persistSimProgress(playing) {
  setSimPanelState({
    playing: !!playing,
    progress: getSimProgressRatio(),
    routeId: currentRoute?.properties?.route_id || null,
  });
}

function registerSimCleanup(fn) {
  if (typeof fn === 'function') {
    simCleanupFns.add(fn);
  }
}

function cleanupSimLifecycleHooks() {
  simCleanupFns.forEach((cleanup) => {
    try {
      cleanup();
    } catch (err) {
      console.warn('[Diary] Unable to remove simulator lifecycle hook', err);
    }
  });
  simCleanupFns.clear();
  simLifecycleFlags.visibility = false;
  simLifecycleFlags.pagehide = false;
}

function ensureSimLifecycleHooks() {
  if (typeof document !== 'undefined' && !simLifecycleFlags.visibility) {
    const handleVisibility = () => {
      if (document.hidden) {
        pauseSim();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    registerSimCleanup(() => {
      document.removeEventListener('visibilitychange', handleVisibility);
      simLifecycleFlags.visibility = false;
    });
    simLifecycleFlags.visibility = true;
  }
  if (typeof window !== 'undefined' && !simLifecycleFlags.pagehide) {
    const handlePageHide = () => {
      teardownDiaryTransient(mapRef, { silent: true });
    };
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);
    registerSimCleanup(() => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
      simLifecycleFlags.pagehide = false;
    });
    simLifecycleFlags.pagehide = true;
  }
}

function ensureSimCoords(route) {
  if (!route || !route.geometry) {
    sim.coords = [];
    return;
  }
  const base = extractLineCoordinates(route.geometry) || [];
  const result = [];
  for (let i = 0; i < base.length; i += 1) {
    const current = base[i];
    if (!current) continue;
    if (result.length === 0) {
      result.push(current);
      continue;
    }
    const prev = result[result.length - 1];
    const steps = Math.max(1, Math.ceil(distanceBetween(prev, current) / 0.0002));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const lng = prev[0] + (current[0] - prev[0]) * t;
      const lat = prev[1] + (current[1] - prev[1]) * t;
      result.push([lng, lat]);
    }
  }
  sim.coords = result;
  sim.idx = 0;
  sim.routeId = route.properties?.route_id || null;
  sim.active = false;
  sim.paused = true;
  sim.hasStarted = false;
  sim.playedOnce = false;
}

function distanceBetween(a, b) {
  if (!a || !b) return 0;
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const dy = b[1] - a[1];
  return Math.hypot(dx, dy);
}

function startSim() {
  if (!currentRoute || !mapRef) return;
  if (!sim.coords.length || sim.routeId !== currentRoute.properties?.route_id) {
    ensureSimCoords(currentRoute);
  }
  if (!sim.coords.length) return;
  if (sim.timer) {
    clearInterval(sim.timer);
  }
  ensureSimLifecycleHooks();
  sim.active = true;
  sim.paused = false;
  sim.hasStarted = true;
  sim.playedOnce = true;
  drawSimPoint(mapRef, SIM_POINT_SOURCE_ID, sim.coords[sim.idx], { color: '#22d3ee', radius: 5 });
  sim.timer = setInterval(stepSim, SIM_INTERVAL_MS);
  updateSimButtons();
  persistSimProgress(true);
}

function stepSim() {
  if (!sim.active || sim.paused) return;
  sim.idx += 1;
  if (sim.idx >= sim.coords.length) {
    finishSim({ openModal: true });
    return;
  }
  drawSimPoint(mapRef, SIM_POINT_SOURCE_ID, sim.coords[sim.idx], { color: '#22d3ee', radius: 5 });
  persistSimProgress(true);
}

function pauseSim() {
  if (!sim.hasStarted) return;
  if (sim.timer) {
    clearInterval(sim.timer);
    sim.timer = null;
  }
  sim.paused = true;
  sim.active = false;
  updateSimButtons();
  persistSimProgress(false);
}

function finishSim({ openModal = true } = {}) {
  if (!sim.hasStarted) return;
  pauseSim();
  sim.idx = 0;
  sim.hasStarted = false;
  clearSimPoint(mapRef, SIM_POINT_SOURCE_ID);
  updateSimButtons();
  persistSimProgress(false);
  if (openModal) {
    openRouteRating();
  }
}

function teardownSim({ silent = false } = {}) {
  if (sim.timer) {
    clearInterval(sim.timer);
    sim.timer = null;
  }
  sim.active = false;
  sim.paused = true;
  sim.hasStarted = false;
  sim.playedOnce = false;
  sim.coords = [];
  sim.routeId = null;
  sim.idx = 0;
  if (mapRef) {
    clearSimPoint(mapRef, SIM_POINT_SOURCE_ID);
  }
  cleanupSimLifecycleHooks();
  setSimPanelState({ playing: false, progress: 0, routeId: null });
  if (!silent) {
    updateSimButtons();
  }
}

function stopAllTimersAndListeners({ silent = false } = {}) {
  teardownSim({ silent: true });
  if (!silent) {
    updateSimButtons();
  }
}

export function teardownDiaryTransient(map = mapRef, { silent = false } = {}) {
  const targetMap = map || mapRef;
  stopAllTimersAndListeners({ silent: true });
  cleanupNetworkOverlayLifecycle();
  if (targetMap) {
    setDiaryMapSkin(targetMap, false);
    clearRouteOverlay(targetMap, ROUTE_OVERLAY_SOURCE_ID);
    clearRouteOverlay(targetMap, ALT_ROUTE_SOURCE_ID);
    clearSimPoint(targetMap, SIM_POINT_SOURCE_ID);
    try { removeNetworkLayer(targetMap); } catch {}
  }
  if (!silent) {
    updateSimButtons();
  }
}

function updateSimButtons() {
  const hasRoute = Boolean(currentRoute);
  if (playButtonEl) {
    playButtonEl.disabled = !hasRoute || (sim.active && !sim.paused);
    playButtonEl.style.opacity = playButtonEl.disabled ? '0.6' : '1';
  }
  if (pauseButtonEl) {
    pauseButtonEl.disabled = !hasRoute || !sim.hasStarted || sim.paused;
    pauseButtonEl.style.opacity = pauseButtonEl.disabled ? '0.6' : '1';
  }
  if (finishButtonEl) {
    finishButtonEl.disabled = !hasRoute || !sim.hasStarted;
    finishButtonEl.style.opacity = finishButtonEl.disabled ? '0.6' : '1';
  }
  if (rateButtonEl) {
    rateButtonEl.disabled = !hasRoute;
    rateButtonEl.style.opacity = rateButtonEl.disabled ? '0.6' : '1';
  }
}

function hydrateSimulatorFromPrefs() {
  const prefs = store.simState || {};
  const matchesRoute = currentRoute && prefs.routeId === currentRoute.properties?.route_id;
  if (!matchesRoute || !prefs.progress) {
    sim.hasStarted = false;
    sim.playedOnce = false;
    sim.active = false;
    sim.paused = true;
    sim.idx = 0;
    updateSimButtons();
    return;
  }
  sim.hasStarted = true;
  sim.playedOnce = true;
  sim.active = false;
  sim.paused = true;
  updateSimButtons();
}

function getUserHash() {
  if (cachedUserHash) return cachedUserHash;
  try {
    const existing = window?.sessionStorage?.getItem(USER_HASH_KEY);
    if (existing) {
      cachedUserHash = existing;
      return cachedUserHash;
    }
  } catch {}
  cachedUserHash = `demo_${Math.random().toString(36).slice(2, 10)}`;
  try {
    window?.sessionStorage?.setItem(USER_HASH_KEY, cachedUserHash);
  } catch {}
  return cachedUserHash;
}

function showToast(message, duration = 2600) {
  if (typeof document === 'undefined') return;
  if (toastEl) {
    toastEl.remove();
    toastEl = null;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  }
  const wrapper = document.createElement('div');
  wrapper.textContent = message;
  wrapper.style.position = 'fixed';
  wrapper.style.top = '24px';
  wrapper.style.left = '50%';
  wrapper.style.transform = 'translateX(-50%)';
  wrapper.style.background = '#0f172a';
  wrapper.style.color = '#fff';
  wrapper.style.padding = '10px 16px';
  wrapper.style.borderRadius = '999px';
  wrapper.style.boxShadow = '0 12px 30px rgba(15,23,42,0.25)';
  wrapper.style.font = '13px/1.4 "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  wrapper.style.zIndex = '2000';
  document.body.appendChild(wrapper);
  toastEl = wrapper;
  toastTimer = setTimeout(() => {
    wrapper.remove();
    toastEl = null;
    toastTimer = null;
  }, duration);
}

function showPanelNotice(message, tone = 'success', duration = 3000) {
  if (!panelNoticeEl) return;
  const palette = tone === 'error'
    ? { bg: '#fee2e2', fg: '#991b1b' }
    : tone === 'info'
      ? { bg: '#eff6ff', fg: '#1e3a8a' }
      : { bg: '#ecfdf5', fg: '#065f46' };
  panelNoticeEl.style.background = palette.bg;
  panelNoticeEl.style.color = palette.fg;
  panelNoticeEl.textContent = message;
  panelNoticeEl.style.display = 'block';
  if (panelNoticeTimer) {
    clearTimeout(panelNoticeTimer);
  }
  panelNoticeTimer = setTimeout(() => {
    hidePanelNotice();
  }, duration);
}

function hidePanelNotice() {
  if (panelNoticeTimer) {
    clearTimeout(panelNoticeTimer);
    panelNoticeTimer = null;
  }
  if (panelNoticeEl) {
    panelNoticeEl.style.display = 'none';
  }
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
export async function initDiaryMode(map, options = {}) {
  const mountTarget = options?.mountInto || null;
  const stats = { segmentsCount: 0, routesCount: 0 };
  if (typeof console !== 'undefined' && typeof console.info === 'function') {
    console.info('[Diary] initDiaryMode called', { hasMount: !!mountTarget, mountId: mountTarget?.id || 'none' });
  }
  if (mountTarget) {
    mountTarget.setAttribute('data-diary-mounted', 'true');
  }
  if (!diaryFeatureEnabled()) {
    diaryFlagOff();
    return stats;
  }

  if (!map) {
    console.warn('[Diary] initDiaryMode called without a MapLibre instance.');
    return stats;
  }

  mapRef = map;
  exposeCtaHelpers();
  cleanupNetworkOverlayLifecycle();
  setDiaryMapSkin(mapRef, true);
  try {
    await addNetworkLayer(mapRef);
    ensureNetworkOverlayLifecycle(mapRef);
  } catch (err) {
    console.warn('[Diary] Network layer unavailable:', err);
  }

  try {
    const [segments, routes] = await Promise.all([loadDemoSegments(), loadDemoRoutes()]);
    stats.segmentsCount = segments.features.length;
    stats.routesCount = routes.features.length;
    console.info('[Diary] segments loaded:', stats.segmentsCount);
    console.info('[Diary] routes loaded:', stats.routesCount);
    logMissingSegments(routes, segments);
    buildSegmentLookup(segments);
    ensureRouteIndex(routes);
    initLocalAggFromSegments(segments);
    exposeDebugAPI();
    const hydratedSegments = buildSegmentsFCFromBase() || segments;
    lastLoadedSegments = hydratedSegments;
    lastLoadedRoutes = routes;

    if (layerMounted) {
      updateSegmentsData(mapRef, SEGMENT_SOURCE_ID, hydratedSegments);
    } else {
      mountSegmentsLayer(mapRef, SEGMENT_SOURCE_ID, hydratedSegments);
      layerMounted = true;
    }

    routesRef = routes;
    ensureDiaryPanel(routes, { mountInto: mountTarget });
    const defaultRoute = routes.features?.[0];
    if (defaultRoute?.properties?.route_id) {
      if (routeSelectEl) {
        routeSelectEl.value = defaultRoute.properties.route_id;
      }
      selectRoute(defaultRoute.properties.route_id, { fitBounds: false });
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
  teardownDiaryTransient(targetMap, { silent: true });
  layerMounted = false;
  closeRatingModal();
  if (diaryPanelEl) {
    if (diaryPanelFloating) {
      diaryPanelEl.remove();
    } else {
      diaryPanelEl.innerHTML = '';
    }
    diaryPanelEl = null;
    routeSelectEl = null;
    summaryStripEl = null;
    rateButtonEl = null;
    altToggleEl = null;
    altSummaryEl = null;
    hidePanelNotice();
    panelNoticeEl = null;
    diaryPanelFloating = false;
  }
  currentRoute = null;
  if (toastEl) {
    toastEl.remove();
    toastEl = null;
  }
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  console.info('[Diary] Teardown complete.');
}

registerSegmentActionHandler((payload) => {
  if (!payload || !payload.action || !payload.segmentId) return;
  if (payload.action === 'agree') {
    onAgreeClick(payload.segmentId);
  } else if (payload.action === 'safer') {
    onFeelsSaferClick(payload.segmentId);
  }
});

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
