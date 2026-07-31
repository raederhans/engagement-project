/**
 * Route Safety Diary - Main Orchestrator
 *
 * Loads the deployable Diary demo data, mounts route and segment interactions,
 * runs the route simulator, and applies local rating/aggregation updates.
 */

import { mountSegmentsLayer, updateSegmentsData, removeSegmentsLayer, highlightSegments } from '../map/segments_layer.js';
import { addNetworkLayer, ensureNetworkLayer, removeNetworkLayer } from '../map/network_layer.js';
import { drawRouteOverlay, clearRouteOverlay, drawSimPoint, clearSimPoint } from '../map/routing_overlay.js';
import { DIARY_ROUTES_URL, DIARY_SEGMENTS_URL, HAS_DIARY_LIGHT_STYLE } from '../config.js';
import { openRatingModal, closeRatingModal } from './form_submit.js';
import {
  DEFAULT_HALF_LIFE_DAYS,
  weightFor,
  bayesianShrink,
  effectiveN,
  clampMean,
} from '../utils/decay.js';
import { escapeHtml } from '../utils/html.js';
import { store, setSelectedRouteId, setDiaryAltEnabled, setSimPanelState, setSimPlaybackSpeed, setDiaryDemoPeriod, setDiaryTimeFilter, setDiaryViewMode, setDiarySelectedHistoryRouteId, setDiaryCommunityRadiusMeters } from '../state/store.js';
import {
  DIARY_SEGMENTS_SOURCE_ID,
  DIARY_ROUTE_PRIMARY_SOURCE_ID,
  DIARY_ROUTE_ALT_SOURCE_ID,
  DIARY_SIM_POINT_SOURCE_ID,
  DIARY_NETWORK_SOURCE_ID,
  DIARY_NETWORK_LAYER_ID,
} from './map_ids.js';
import {
  normalizeFeatureCollection,
  normalizeSegmentFeature,
  normalizeRouteFeature,
  SEGMENT_ID_PROP,
  SCORE_PROP,
  NEFF_PROP,
  ROUTE_SEG_IDS_PROP,
  ROUTE_ALT_SEG_IDS_PROP,
  ROUTE_NAME_PROP,
  ROUTE_FROM_PROP,
  ROUTE_TO_PROP,
  ROUTE_ID_PROP,
  TAGS_PROP,
} from './data_normalization.js';
import { renderLiveRoutePanel } from './ui_live_panel.js';
import { renderMyRoutesPanel } from './ui_my_routes_panel.js';
import { renderCommunityPanel } from './ui_community_panel.js';
import { publicUrl } from '../utils/public_url.js';
import {
  createDiarySession,
  releaseOwnedReference,
  runCleanupSteps,
} from './diary_session.js';
import { loadJsonFromCandidates, loadOwnedDiaryData } from './demo_data_loader.js';
import {
  createDiaryInsightsPort,
  installOwnedDebugGlobal,
} from './diary_insights_port.js';

const SIM_INTERVAL_MS = 400;
const SEGMENT_URL_CANDIDATES = [
  DIARY_SEGMENTS_URL,
  new URL('../../data/segments_phl.demo.geojson', import.meta.url).href,
  publicUrl('data/segments_phl.demo.geojson'),
].filter(Boolean);
const ROUTE_URL_CANDIDATES = [
  DIARY_ROUTES_URL,
  new URL('../../data/routes_phl.demo.geojson', import.meta.url).href,
  publicUrl('data/routes_phl.demo.geojson'),
].filter(Boolean);

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
let currentDiarySession = null;
let currentDiaryOwnerIsCurrent = () => false;
let currentInsightsPort = null;
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

function clearDiaryTimeout(id) {
  if (id == null) return;
  if (currentDiarySession) {
    currentDiarySession.clearTimeout(id);
  } else {
    clearTimeout(id);
  }
}

function clearDiaryInterval(id) {
  if (id == null) return;
  if (currentDiarySession) {
    currentDiarySession.clearInterval(id);
  } else {
    clearInterval(id);
  }
}

function diarySessionIsCurrent(session = currentDiarySession, ownerIsCurrent = currentDiaryOwnerIsCurrent) {
  return Boolean(session?.isActive() && ownerIsCurrent?.());
}

function guardDiaryCommit(commit, session = currentDiarySession, ownerIsCurrent = currentDiaryOwnerIsCurrent) {
  return (...args) => {
    if (!diarySessionIsCurrent(session, ownerIsCurrent)) return undefined;
    return commit(...args);
  };
}

function disposeDiarySession(session) {
  session?.dispose();
  if (currentDiarySession === session) currentDiarySession = null;
}

function ownMountedNetworkResources(session, map, before) {
  const ownedLayer = before.layer ? null : map.getLayer?.(DIARY_NETWORK_LAYER_ID);
  const ownedSource = before.source ? null : map.getSource?.(DIARY_NETWORK_SOURCE_ID);
  if (!ownedLayer && !ownedSource) return;
  let disposed = false;
  session.addCleanup(() => {
    if (disposed) return;
    disposed = true;
    if (ownedLayer && map.getLayer?.(DIARY_NETWORK_LAYER_ID) === ownedLayer) {
      try { map.removeLayer(DIARY_NETWORK_LAYER_ID); } catch {}
    }
    if (ownedSource && map.getSource?.(DIARY_NETWORK_SOURCE_ID) === ownedSource) {
      try { map.removeSource(DIARY_NETWORK_SOURCE_ID); } catch {}
    }
  });
}

function diaryFeatureEnabled() {
  if (store?.diaryFeatureOn) return true;
  if (import.meta?.env?.VITE_FEATURE_DIARY === '1') return true;
  if (diaryQs.get('mode') === 'diary') return true;
  if (diaryPath.includes('diary-demo')) return true;
  return false;
}

const clone = (obj) => (typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));

function ensureFeatureCollection(payload, label) {
  if (!payload || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw new Error(`[Diary] Invalid ${label} file — expected FeatureCollection`);
  }
  return payload;
}

function ensureNetworkOverlayLifecycle(
  map,
  session = currentDiarySession,
  ownerIsCurrent = currentDiaryOwnerIsCurrent,
) {
  if (!map || typeof map.on !== 'function' || typeof networkStyleCleanup === 'function') return;
  const canApply = () => diarySessionIsCurrent(session, ownerIsCurrent);
  const handleStyleRefresh = () => {
    if (!canApply()) return;
    Promise.resolve(ensureNetworkLayer(map, {
      signal: session?.signal,
      shouldApply: canApply,
    })).catch((err) => {
      if (!canApply()) return;
      console.warn('[Diary] Network layer refresh skipped after styledata event.', err);
    });
  };
  map.on('styledata', handleStyleRefresh);
  const cleanup = () => {
    if (typeof map.off === 'function') {
      map.off('styledata', handleStyleRefresh);
    }
    networkStyleCleanup = null;
  };
  networkStyleCleanup = session ? session.addCleanup(cleanup) : cleanup;
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
  const fc = normalizeFeatureCollection(collection, normalizeSegmentFeature);
  fc.features = fc.features.map((feature) => {
    const props = { ...(feature.properties || {}) };
    return {
      ...feature,
      properties: {
        ...props,
        top_tags: normalizeTopTags(props[TAGS_PROP] || props.top_tags),
      },
    };
  });
  return fc;
}

function normalizeRoutesCollection(collection) {
  return normalizeFeatureCollection(collection, normalizeRouteFeature);
}

function logMissingSegments(routes, segments) {
  const segmentIds = new Set((segments.features || []).map((f) => f?.properties?.[SEGMENT_ID_PROP]));
  const issues = [];
  for (const route of routes.features || []) {
    const missing = (route.properties?.[ROUTE_SEG_IDS_PROP] || []).filter((id) => !segmentIds.has(id));
    if (missing.length) {
      issues.push(`${route.properties?.[ROUTE_ID_PROP] || 'route'}: ${missing.join(', ')}`);
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
    const id = feature?.properties?.[SEGMENT_ID_PROP];
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

function buildRouteOverlayCollection(routeFeature, idsKey = ROUTE_SEG_IDS_PROP) {
  if (!routeFeature) return null;
  const props = routeFeature.properties || {};
  const ids = Array.isArray(props[idsKey]) ? props[idsKey] : [];
  if (!ids.length) return routeFeature;
  const features = [];
  const missing = [];
  ids.forEach((id, idx) => {
    const seg = segmentLookup.get(id);
    if (!seg?.geometry) {
      missing.push(id);
      return;
    }
    const segProps = seg.properties || {};
    const safety = Number(segProps[SCORE_PROP]);
    features.push({
      type: 'Feature',
      geometry: clone(seg.geometry),
      properties: {
        overlay_safety: Number.isFinite(safety) ? safety : 3,
        overlay_seq: idx,
      },
    });
  });
  if (missing.length) {
    const label = props[ROUTE_NAME_PROP] || `${props[ROUTE_FROM_PROP] || 'Start'} → ${props[ROUTE_TO_PROP] || 'Destination'}`;
    console.warn(`[Diary] Route '${label}' skipped ${missing.length} missing segments: ${missing.join(', ')}`);
  }
  return features.length ? { type: 'FeatureCollection', features } : routeFeature;
}

function initLocalAggFromSegments(featureCollection) {
  localAgg.clear();
  baseSegmentsFC = clone(featureCollection);
  if (!featureCollection || !Array.isArray(featureCollection.features)) return;
  featureCollection.features.forEach((feature) => {
    const props = feature.properties || {};
    const id = props[SEGMENT_ID_PROP];
    if (!id) return;
    const mean = Number.isFinite(props[SCORE_PROP]) ? props[SCORE_PROP] : 3;
    const nEff = Number.isFinite(props[NEFF_PROP]) ? props[NEFF_PROP] : 1;
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

function exposeDebugAPI() {
  if (typeof window === 'undefined' || !import.meta?.env?.DEV) return null;
  const debugApi = Object.freeze({
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
  return installOwnedDebugGlobal(window, debugApi, currentDiarySession?.addCleanup);
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
  const panelSession = currentDiarySession;
  const panelOwnerIsCurrent = currentDiaryOwnerIsCurrent;
  const isPanelCurrent = () => diarySessionIsCurrent(panelSession, panelOwnerIsCurrent);
  const ownPanelHandler = (handler) => guardDiaryCommit(
    handler,
    panelSession,
    panelOwnerIsCurrent,
  );
  const makePill = (label, mode) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.className = 'diary-view-pill';
    btn.addEventListener('click', ownPanelHandler(() => {
      setDiaryViewMode(mode);
      currentInsightsPort?.setViewContext(mode);
      renderActivePanel();
    }));
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
    clearLiveRefs();
    if (store.diaryViewMode === 'history') {
      renderMyRoutesPanel(
        body,
        {
          period: historyPeriodFilter,
          mode: historyModeFilter,
          routes: MOCK_HISTORY_ROUTES.filter((item) => historyModeFilter === 'all' || item.mode === historyModeFilter),
        },
        {
          onPeriodChange: ownPanelHandler((val) => {
            historyPeriodFilter = val;
            renderActivePanel();
          }),
          onModeChange: ownPanelHandler((val) => {
            historyModeFilter = val;
            renderActivePanel();
          }),
          onSelect: ownPanelHandler((item) => {
            setDiarySelectedHistoryRouteId(item.id);
            console.info('[Diary] History route selected:', item.id, item.label);
            focusHistoryRouteOnMap(item);
          }),
        }
      );
    } else if (store.diaryViewMode === 'community') {
      renderCommunityPanel(
        body,
        {
          radiusMeters: store.diaryCommunityRadiusMeters || 1500,
          segments: MOCK_COMMUNITY_SEGMENTS,
          comments: MOCK_COMMENTS,
        },
        {
          isCurrent: isPanelCurrent,
          onRadiusChange: ownPanelHandler((val) => {
            setDiaryCommunityRadiusMeters(val);
            console.info('[Diary] Community radius changed:', val, 'm');
          }),
          onSelectSegment: ownPanelHandler((seg) => {
            console.info('[Diary] Focus high-concern segment:', seg.id, seg.name);
          }),
          onPostComment: ownPanelHandler((text) => {
            console.info('[Diary] Post community comment:', text);
          }),
        }
      );
    } else {
      const refs = renderLiveRoutePanel(
        body,
        {
          routes,
          selectedRouteId: store.selectedRouteId,
          altEnabled: store.diaryAltEnabled,
          demoPeriod: store.diaryDemoPeriod,
          timeFilter: store.diaryTimeFilter,
          playbackSpeed: store.simPlaybackSpeed,
          canRate: !!currentRoute,
        },
        {
          onRouteSelect: ownPanelHandler((routeId) => {
            if (routeId) selectRoute(routeId, { fitBounds: true });
          }),
          onToggleAlt: ownPanelHandler((checked) => applyAltToggleState(checked)),
          onRate: ownPanelHandler(() => openRouteRating()),
          onPlay: ownPanelHandler(() => startSim()),
          onPause: ownPanelHandler(() => pauseSim()),
          onFinish: ownPanelHandler(() => finishSim({ openModal: true })),
          onSpeedChange: ownPanelHandler((val) => {
            setSimPlaybackSpeed(val);
            if (refs.speedButtons) {
              refs.speedButtons.forEach((btn) => {
                const speed = Number(btn.dataset?.speed);
                btn.classList.toggle('is-active', speed === val);
              });
            }
            updateSimButtons();
          }),
          onDemoPeriodChange: ownPanelHandler((val) => setDiaryDemoPeriod(val)),
          onTimeFilterChange: ownPanelHandler((val) => setDiaryTimeFilter(val)),
        }
      );
      routeSelectEl = refs.routeSelectEl || null;
      summaryStripEl = refs.summaryEl || null;
      rateButtonEl = refs.rateButtonEl || null;
      altToggleEl = refs.altToggleEl || null;
      altSummaryEl = refs.altSummaryEl || null;
      panelNoticeEl = refs.panelNoticeEl || null;
      playButtonEl = refs.playButtonEl || null;
      pauseButtonEl = refs.pauseButtonEl || null;
      finishButtonEl = refs.finishButtonEl || null;
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
  };

  currentInsightsPort?.setViewContext(store.diaryViewMode);
  renderActivePanel();
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
    `<div style="font-weight:700;color:#0f172a;">${escapeHtml(props.from || 'Start')}</div>`,
    `<div style="color:#94a3b8;font-weight:600;font-size:12px;">to</div>`,
    `<div style="font-weight:700;color:#0f172a;">${escapeHtml(props.to || 'Destination')}</div>`,
  ];
  summaryStripEl.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:#0f172a;">${escapeHtml(props.name || props.route_id)}</div>
    <div style="display:flex;align-items:center;gap:6px;">${pieces.join('')}</div>
    <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
      <span class="diary-chip" style="border-color:#e2e8f0;">${escapeHtml(String(props.mode || 'walk').toUpperCase())}</span>
      <span class="diary-chip" style="border-color:#e2e8f0;">${Number(props.length_m || 0).toLocaleString()} m</span>
      <span class="diary-chip" style="border-color:#e2e8f0;">${Number(props.duration_min) || 0} min</span>
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
    const overlayData = buildRouteOverlayCollection(feature, ROUTE_SEG_IDS_PROP) || feature;
    drawRouteOverlay(mapRef, DIARY_ROUTE_PRIMARY_SOURCE_ID, overlayData, {
      lineColorExpression: ROUTE_SAFETY_EXPRESSION,
      width: 7,
      opacity: isCommunity ? 0.7 : 0.95,
    });
    if (fitBounds) {
      fitMapToRoute(feature);
    }
  }
  currentInsightsPort?.refresh();
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
  const session = currentDiarySession;
  const ownerIsCurrent = currentDiaryOwnerIsCurrent;
  openRatingModal({
    routeFeature: currentRoute,
    segmentLookup,
    userHash: getUserHash(),
    signal: session?.signal,
    onSuccess: guardDiaryCommit(({ payload, response }) => {
      handleDiarySubmissionSuccess(payload, response);
    }, session, ownerIsCurrent),
  });
}

function handleDiarySubmissionSuccess(payload, response) {
  if (!payload) return;
  const perfStart = nowMs();
  applyDiarySubmissionToAgg(payload);
  const refreshed = buildSegmentsFCFromBase();
  if (refreshed && mapRef) {
    updateSegmentsData(mapRef, DIARY_SEGMENTS_SOURCE_ID, refreshed);
    lastLoadedSegments = refreshed;
  }
  updateAlternativeRoute({ refreshOnly: true });
  const persisted = response?.persisted !== false && response?.mode !== 'demo';
  showToast(persisted
    ? 'Thanks — your feedback has been saved.'
    : 'Thanks — your feedback was applied to this browser demo only.');
  const affectedSegmentIds = deriveAffectedSegmentIds(payload);
  const affectedCount = affectedSegmentIds.size || 1;
  showPanelNotice(`Thanks — your rating improved confidence on ${affectedCount} segment${affectedCount === 1 ? '' : 's'}.`);
  onRouteRatingSuccess(Array.from(affectedSegmentIds));
  perfLastSubmit = { ms: Math.max(0, Math.round(nowMs() - perfStart)), at: new Date().toISOString() };
  console.info('[Diary] repaint latency (ms):', perfLastSubmit.ms);
  console.info('[Diary] submit payload', payload);
  console.info('[Diary] submit response', response);
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

function deriveAffectedSegmentIds(payload) {
  const ids = new Set(payload?.segment_ids || []);
  if (Array.isArray(payload?.segment_overrides)) {
    payload.segment_overrides.forEach((ovr) => {
      if (ovr?.segment_id) ids.add(ovr.segment_id);
    });
  }
  return ids;
}

function onRouteRatingSuccess(affectedSegmentIds) {
  if (!mapRef || !affectedSegmentIds) return;
  const list = Array.isArray(affectedSegmentIds) ? affectedSegmentIds : Array.from(affectedSegmentIds);
  const features = list
    .map((id) => segmentLookup.get(id))
    .filter((f) => f && f.geometry);
  if (features.length && typeof highlightSegments === 'function') {
    highlightSegments(mapRef, features, {
      durationMs: 1500,
      addCleanup: currentDiarySession?.addCleanup,
    });
  }
  console.info('[Diary] Route rating applied to %d segments', list.length || 0);
}

function refreshAfterCta(message) {
  const refreshed = buildSegmentsFCFromBase();
  if (refreshed && mapRef) {
    updateSegmentsData(mapRef, DIARY_SEGMENTS_SOURCE_ID, refreshed);
    lastLoadedSegments = refreshed;
  }
  updateAlternativeRoute({ refreshOnly: true });
  if (message) {
    showToast(message);
  }
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

function handleSegmentAction(payload) {
  if (!payload || !payload.action || !payload.segmentId) return;
  if (payload.action === 'agree') {
    void onAgreeClick(payload.segmentId);
  } else if (payload.action === 'safer') {
    void onFeelsSaferClick(payload.segmentId);
  }
}

function decayAggRecord(record, now) {
  if (!record) return;
  const last = Date.parse(record.updated || now);
  const factor = weightFor(last || now, now, DEFAULT_HALF_LIFE_DAYS);
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
    const segId = props[SEGMENT_ID_PROP];
    const agg = localAgg.get(segId);
    if (agg) {
      props[SCORE_PROP] = agg.mean;
      props[NEFF_PROP] = agg.n_eff;
      props.top_tags = agg.top_tags;
      props.delta_30d = agg.delta_30d;
      props.updated = agg.updated;
    }
    const cta = getCtaState(segId);
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
    clearRouteOverlay(mapRef, DIARY_ROUTE_ALT_SOURCE_ID);
    renderAltSummary(null, { reason: 'no-route' });
    return;
  }
  const shouldShow = !!store.diaryAltEnabled;
  const altInfo = resolveAlternativeForRoute(currentRoute);
  renderAltSummary(currentRoute, altInfo || null);
  if (!shouldShow || !altInfo) {
    clearRouteOverlay(mapRef, DIARY_ROUTE_ALT_SOURCE_ID);
    return;
  }
  if (!refreshOnly) {
    const altOverlay = buildRouteOverlayCollection(
      altInfo.feature,
      altInfo.feature?.properties?.[ROUTE_ALT_SEG_IDS_PROP]?.length ? ROUTE_ALT_SEG_IDS_PROP : ROUTE_SEG_IDS_PROP
    ) || altInfo.feature;
    drawRouteOverlay(mapRef, DIARY_ROUTE_ALT_SOURCE_ID, altOverlay, {
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
  const altIds = Array.isArray(props[ROUTE_ALT_SEG_IDS_PROP]) && props[ROUTE_ALT_SEG_IDS_PROP].length > 0
    ? props[ROUTE_ALT_SEG_IDS_PROP]
    : props[ROUTE_SEG_IDS_PROP] || [];
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
      [ROUTE_SEG_IDS_PROP]: altIds,
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
  const primaryIds = primaryRoute.properties?.[ROUTE_SEG_IDS_PROP] || [];
  const altIds = altMeta[ROUTE_SEG_IDS_PROP] || [];
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
  const segmentIds = currentRoute.properties?.[ROUTE_SEG_IDS_PROP] || [];
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
  return Number.isFinite(props[SCORE_PROP]) ? props[SCORE_PROP] : 3;
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
    const handleVisibility = guardDiaryCommit(() => {
      if (document.hidden) {
        pauseSim();
      }
    });
    const cleanup = currentDiarySession
      ? currentDiarySession.listen(document, 'visibilitychange', handleVisibility)
      : (() => {
          document.addEventListener('visibilitychange', handleVisibility);
          return () => document.removeEventListener('visibilitychange', handleVisibility);
        })();
    registerSimCleanup(() => {
      cleanup();
      simLifecycleFlags.visibility = false;
    });
    simLifecycleFlags.visibility = true;
  }
  if (typeof window !== 'undefined' && !simLifecycleFlags.pagehide) {
    const handlePageHide = guardDiaryCommit(() => {
      teardownDiaryTransient(mapRef, { silent: true });
    });
    const cleanupPageHide = currentDiarySession
      ? currentDiarySession.listen(window, 'pagehide', handlePageHide)
      : (() => {
          window.addEventListener('pagehide', handlePageHide);
          return () => window.removeEventListener('pagehide', handlePageHide);
        })();
    const cleanupBeforeUnload = currentDiarySession
      ? currentDiarySession.listen(window, 'beforeunload', handlePageHide)
      : (() => {
          window.addEventListener('beforeunload', handlePageHide);
          return () => window.removeEventListener('beforeunload', handlePageHide);
        })();
    registerSimCleanup(() => {
      cleanupPageHide();
      cleanupBeforeUnload();
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
    clearDiaryInterval(sim.timer);
  }
  ensureSimLifecycleHooks();
  sim.active = true;
  sim.paused = false;
  sim.hasStarted = true;
  sim.playedOnce = true;
  drawSimPoint(mapRef, DIARY_SIM_POINT_SOURCE_ID, sim.coords[sim.idx], { color: '#22d3ee', radius: 5 });
  const session = currentDiarySession;
  sim.timer = session
    ? session.setInterval(guardDiaryCommit(stepSim), SIM_INTERVAL_MS)
    : setInterval(stepSim, SIM_INTERVAL_MS);
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
  drawSimPoint(mapRef, DIARY_SIM_POINT_SOURCE_ID, sim.coords[sim.idx], { color: '#22d3ee', radius: 5 });
  persistSimProgress(true);
}

function pauseSim() {
  if (!sim.hasStarted) return;
  if (sim.timer) {
    clearDiaryInterval(sim.timer);
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
  clearSimPoint(mapRef, DIARY_SIM_POINT_SOURCE_ID);
  updateSimButtons();
  persistSimProgress(false);
  if (openModal) {
    openRouteRating();
  }
}

function teardownSim({ silent = false } = {}) {
  if (sim.timer) {
    clearDiaryInterval(sim.timer);
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
    clearSimPoint(mapRef, DIARY_SIM_POINT_SOURCE_ID);
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

export function teardownDiaryTransient(
  map = mapRef,
  { silent = false, removeNetworkOverlay = true } = {},
) {
  const targetMap = map || mapRef;
  stopAllTimersAndListeners({ silent: true });
  cleanupNetworkOverlayLifecycle();
  if (targetMap) {
    setDiaryMapSkin(targetMap, false);
    clearRouteOverlay(targetMap, DIARY_ROUTE_PRIMARY_SOURCE_ID);
    clearRouteOverlay(targetMap, DIARY_ROUTE_ALT_SOURCE_ID);
    clearSimPoint(targetMap, DIARY_SIM_POINT_SOURCE_ID);
    if (removeNetworkOverlay) {
      try { removeNetworkLayer(targetMap); } catch {}
    }
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
      clearDiaryTimeout(toastTimer);
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
  const session = currentDiarySession;
  const dismiss = () => {
    wrapper.remove();
    toastEl = null;
    toastTimer = null;
  };
  toastTimer = session
    ? session.setTimeout(guardDiaryCommit(dismiss), duration)
    : setTimeout(dismiss, duration);
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
    clearDiaryTimeout(panelNoticeTimer);
  }
  const session = currentDiarySession;
  const dismiss = () => hidePanelNotice();
  panelNoticeTimer = session
    ? session.setTimeout(guardDiaryCommit(dismiss), duration)
    : setTimeout(dismiss, duration);
}

function hidePanelNotice() {
  if (panelNoticeTimer) {
    clearDiaryTimeout(panelNoticeTimer);
    panelNoticeTimer = null;
  }
  if (panelNoticeEl) {
    panelNoticeEl.style.display = 'none';
  }
}

export async function loadDemoSegments({ force = false, signal } = {}) {
  signal?.throwIfAborted();
  if (cachedSegments && !force) {
    return clone(cachedSegments);
  }
  const payload = await loadJsonFromCandidates('segments', SEGMENT_URL_CANDIDATES, { signal });
  signal?.throwIfAborted();
  cachedSegments = normalizeSegmentsCollection(ensureFeatureCollection(payload, 'segments'));
  return clone(cachedSegments);
}

export async function loadDemoRoutes({ force = false, signal } = {}) {
  signal?.throwIfAborted();
  if (cachedRoutes && !force) {
    return clone(cachedRoutes);
  }
  const payload = await loadJsonFromCandidates('routes', ROUTE_URL_CANDIDATES, { signal });
  signal?.throwIfAborted();
  cachedRoutes = normalizeRoutesCollection(ensureFeatureCollection(payload, 'routes'));
  const missingIds = (cachedRoutes.features || []).filter((f) => {
    const ids = f?.properties?.[ROUTE_SEG_IDS_PROP];
    return !Array.isArray(ids) || ids.length === 0;
  });
  if (missingIds.length) {
    console.warn('[Diary] Some routes are missing segment references:', missingIds.map((f) => f?.properties?.[ROUTE_ID_PROP] || 'route').join(', '));
  }
  return clone(cachedRoutes);
}

/**
 * Initialize Route Safety Diary mode
 * @param {MapLibreMap} map - MapLibre GL map instance
 */
export async function initDiaryMode(map, options = {}) {
  const mountTarget = options?.mountInto || null;
  const stats = { segmentsCount: 0, routesCount: 0 };
  if (options?.signal?.aborted) return stats;
  currentDiarySession?.dispose();
  if (typeof console !== 'undefined' && typeof console.info === 'function') {
    console.info('[Diary] initDiaryMode called', { hasMount: !!mountTarget, mountId: mountTarget?.id || 'none' });
  }
  if (!diaryFeatureEnabled()) {
    diaryFlagOff();
    return stats;
  }

  if (!map) {
    console.warn('[Diary] initDiaryMode called without a MapLibre instance.');
    return stats;
  }

  const session = createDiarySession({ ownerSignal: options?.signal });
  if (!session.isActive()) return stats;
  const ownerIsCurrent = typeof options?.isCurrent === 'function' ? options.isCurrent : () => true;
  const isCurrent = () => diarySessionIsCurrent(session, ownerIsCurrent);
  const insightsPort = createDiaryInsightsPort(options?.insights);
  try {
    const addNetworkLayerImpl = options?.addNetworkLayerImpl || addNetworkLayer;
    const networkBefore = {
      source: map.getSource?.(DIARY_NETWORK_SOURCE_ID) || null,
      layer: map.getLayer?.(DIARY_NETWORK_LAYER_ID) || null,
    };
    const networkResult = await addNetworkLayerImpl(map, {
      signal: session.signal,
      shouldApply: isCurrent,
    });
    if (networkResult?.applied) ownMountedNetworkResources(session, map, networkBefore);
    if (!isCurrent()) {
      disposeDiarySession(session);
      return stats;
    }
  } catch (err) {
    if (!isCurrent()) {
      disposeDiarySession(session);
      return stats;
    }
    console.warn('[Diary] Network layer unavailable:', err);
  }

  try {
    const loaded = await loadOwnedDiaryData({
      signal: session.signal,
      isCurrent,
      loadSegments: options?.loadDemoSegmentsImpl || loadDemoSegments,
      loadRoutes: options?.loadDemoRoutesImpl || loadDemoRoutes,
    });
    if (!loaded.applied) {
      disposeDiarySession(session);
      return stats;
    }
    const { segments, routes } = loaded;
    stats.segmentsCount = segments.features.length;
    stats.routesCount = routes.features.length;

    currentDiarySession = session;
    currentDiaryOwnerIsCurrent = ownerIsCurrent;
    currentInsightsPort = insightsPort;
    mapRef = map;
    session.addCleanup(() => cleanupDiaryMode(
      map,
      insightsPort,
      ownerIsCurrent,
      mountTarget,
      false,
    ));
    cleanupNetworkOverlayLifecycle();
    if (mountTarget) mountTarget.setAttribute('data-diary-mounted', 'true');
    setDiaryMapSkin(mapRef, true);
    ensureNetworkOverlayLifecycle(mapRef, session, ownerIsCurrent);

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
      updateSegmentsData(mapRef, DIARY_SEGMENTS_SOURCE_ID, hydratedSegments);
    } else {
      mountSegmentsLayer(mapRef, DIARY_SEGMENTS_SOURCE_ID, hydratedSegments, {
        signal: session.signal,
        isCurrent,
        onAction: guardDiaryCommit(handleSegmentAction, session, ownerIsCurrent),
      });
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
    if (!isCurrent()) {
      disposeDiarySession(session);
      return stats;
    }
    console.error('Demo data missing; please ensure files exist under /data/*.demo.geojson.', err);
    disposeDiarySession(session);
  }

  return stats;
}

/**
 * Teardown diary mode (cleanup)
 * @param {MapLibreMap} map - MapLibre GL map instance
 */
function cleanupDiaryMode(
  map,
  ownedInsightsPort = currentInsightsPort,
  ownedOwnerIsCurrent = currentDiaryOwnerIsCurrent,
  ownedMountTarget = null,
  removeNetworkOverlay = true,
) {
  const targetMap = map || mapRef;
  runCleanupSteps([
    () => {
      if (targetMap) removeSegmentsLayer(targetMap, DIARY_SEGMENTS_SOURCE_ID);
    },
    () => teardownDiaryTransient(targetMap, { silent: true, removeNetworkOverlay }),
    () => { layerMounted = false; },
    () => closeRatingModal(),
    () => {
      if (!ownedMountTarget) return;
      ownedMountTarget.removeAttribute?.('data-diary-mounted');
      if (typeof ownedMountTarget.replaceChildren === 'function') ownedMountTarget.replaceChildren();
      else if ('innerHTML' in ownedMountTarget) ownedMountTarget.innerHTML = '';
    },
    () => {
      if (!diaryPanelEl) return;
      if (diaryPanelFloating) diaryPanelEl.remove();
      else diaryPanelEl.innerHTML = '';
    },
    () => hidePanelNotice(),
    () => {
      diaryPanelEl = null;
      diaryPanelFloating = false;
      currentRoute = null;
    },
    () => { if (toastEl) toastEl.remove(); },
    () => { if (toastTimer) clearDiaryTimeout(toastTimer); },
    () => { toastTimer = null; },
    () => {
      toastEl = null;
      clearLiveRefs();
    },
    () => {
      currentInsightsPort = releaseOwnedReference(currentInsightsPort, ownedInsightsPort);
    },
    () => {
      currentDiaryOwnerIsCurrent = releaseOwnedReference(
        currentDiaryOwnerIsCurrent,
        ownedOwnerIsCurrent,
      ) || (() => false);
    },
    () => { mapRef = releaseOwnedReference(mapRef, targetMap); },
    () => console.info('[Diary] Teardown complete.'),
  ]);
}

export function teardownDiaryMode(map) {
  const session = currentDiarySession;
  if (session) {
    session.dispose();
    if (currentDiarySession === session) currentDiarySession = null;
    return;
  }
  cleanupDiaryMode(map);
}
