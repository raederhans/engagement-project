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
import { escapeHtml } from '../utils/html.js';
import { store, setSelectedRouteId, setDiaryAltEnabled, setSimPanelState, setSimPlaybackSpeed, setDiaryDemoPeriod, setDiaryTimeFilter, setDiaryViewMode, setDiarySelectedHistoryRouteId } from '../state/store.js';
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
  ROUTE_SEG_IDS_PROP,
  ROUTE_ALT_SEG_IDS_PROP,
  ROUTE_NAME_PROP,
  ROUTE_FROM_PROP,
  ROUTE_TO_PROP,
  ROUTE_ID_PROP,
  TAGS_PROP,
  extractLineCoordinates,
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
} from './diary_insights_port.js';
import { createDiaryAggregation } from './local_aggregation.js';
import {
  createDiaryEntry,
  diaryLocalRepository,
  parseDiaryBackup,
  serializeDiaryBackup,
} from './local_repository.js';
import { downloadTextFile } from '../utils/export_analysis.js';
import { resolveAlternativeForRoute, summarizeAlternativeBenefit } from './alternative_route.js';
import { buildSimulationCoordinates } from './route_simulator.js';

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

const DEMO_COMMUNITY_SEGMENTS = [
  { id: 'seg_c1', name: 'South St Bridge (westbound)', score: 1.8, tags: 'poor lighting, aggressive drivers' },
  { id: 'seg_c2', name: '34th & Walnut (eastbound)', score: 2.2, tags: 'construction, potholes' },
  { id: 'seg_c3', name: 'Chestnut St (river to 34th)', score: 2.9, tags: 'heavy traffic' },
];

const DEMO_COMMENTS = [
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
let localRepository = diaryLocalRepository;
let localDiaryEntries = [];
let localStorageWarning = null;
let refreshDiaryPanel = null;
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

const aggregation = createDiaryAggregation({ getCtaState });

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
    makePill('Sample community', 'community'),
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
          routes: filterLocalDiaryEntries(localDiaryEntries, {
            period: historyPeriodFilter,
            mode: historyModeFilter,
          }),
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
          onExport: ownPanelHandler(() => {
            const backup = serializeDiaryBackup(localDiaryEntries);
            downloadTextFile(
              `engagement-diary-${new Date().toISOString().slice(0, 10)}.json`,
              `${JSON.stringify(backup, null, 2)}\n`,
              'application/json',
            );
          }),
          onImport: ownPanelHandler(async (file) => {
            try {
              const entries = parseDiaryBackup(await file.text());
              localDiaryEntries = await localRepository.replace(entries);
              store.myRoutes = localDiaryEntries;
              currentInsightsPort?.setEntries(localDiaryEntries);
              currentInsightsPort?.refresh();
              renderActivePanel();
              showToast(`Imported ${localDiaryEntries.length} local Diary entr${localDiaryEntries.length === 1 ? 'y' : 'ies'}.`);
            } catch (error) {
              showToast(error?.message || 'Diary backup could not be imported.');
            }
          }),
        }
      );
    } else if (store.diaryViewMode === 'community') {
      renderCommunityPanel(
        body,
        {
          segments: DEMO_COMMUNITY_SEGMENTS,
          comments: DEMO_COMMENTS,
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
          onOpenHistory: ownPanelHandler(() => {
            setDiaryViewMode('history');
            currentInsightsPort?.setViewContext('history');
            renderActivePanel();
          }),
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
  currentInsightsPort?.setEntries(localDiaryEntries);
  refreshDiaryPanel = renderActivePanel;
  renderActivePanel();
}

export function filterLocalDiaryEntries(entries = [], { period = '30d', mode = 'all', now = Date.now() } = {}) {
  const days = period === '7d' ? 7 : period === '30d' ? 30 : null;
  const cutoff = days == null ? null : now - days * 24 * 60 * 60 * 1000;
  return entries
    .filter((entry) => mode === 'all' || entry.mode === mode)
    .filter((entry) => cutoff == null || new Date(entry.createdAt).getTime() >= cutoff)
    .map((entry) => ({
      ...entry,
      date: new Date(entry.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    }));
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
  const routeId = route?.routeId || route?.route_id;
  if (routeId && routeById.has(routeId)) {
    selectRoute(routeId, { fitBounds: true });
    return;
  }
  if (!mapRef || !route?.routeGeometry) return;
  const feature = {
    type: 'Feature',
    geometry: structuredClone(route.routeGeometry),
    properties: { route_id: routeId || route.id, name: route.label, source_version: route.routeSourceVersion },
  };
  drawRouteOverlay(mapRef, DIARY_ROUTE_PRIMARY_SOURCE_ID, feature, {
    lineColorExpression: '#2563eb',
    width: 7,
    opacity: 0.95,
  });
  fitMapToRoute(feature);
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
      handleDiarySubmissionSuccess({ payload, response });
    }, session, ownerIsCurrent),
  });
}

export function handleDiarySubmissionSuccess({ payload, response }, {
  aggregationModel = aggregation,
  map = mapRef,
  updateSegments = updateSegmentsData,
  refreshAlternativeRoute = () => updateAlternativeRoute({ refreshOnly: true }),
  notify = showToast,
  notifyPanel = showPanelNotice,
  highlightSegments = onRouteRatingSuccess,
  onSegmentsRefreshed,
  repository = localRepository,
  routeFeature = currentRoute,
  onLocalSaved,
} = {}) {
  if (!payload) return;
  aggregationModel.applySubmission(payload);
  const refreshed = aggregationModel.buildFeatureCollection();
  if (refreshed && map) {
    updateSegments(map, DIARY_SEGMENTS_SOURCE_ID, refreshed);
    if (onSegmentsRefreshed) onSegmentsRefreshed(refreshed);
    else lastLoadedSegments = refreshed;
  }
  refreshAlternativeRoute();
  const persisted = response?.persisted !== false && response?.mode !== 'demo';
  notify(persisted
    ? 'Thanks — your feedback has been saved.'
    : 'Thanks — your feedback was applied to this browser demo only.');
  const affectedSegmentIds = deriveAffectedSegmentIds(payload);
  const affectedCount = affectedSegmentIds.size || 1;
  notifyPanel(`Thanks — your rating improved confidence on ${affectedCount} segment${affectedCount === 1 ? '' : 's'}.`);
  highlightSegments(Array.from(affectedSegmentIds));
  const entry = createDiaryEntry({ payload, routeFeature });
  const owningSession = currentDiarySession;
  void repository.save(entry).then(() => {
    if (onLocalSaved) {
      onLocalSaved(entry);
      return;
    }
    if (owningSession && currentDiarySession !== owningSession) return;
    localDiaryEntries = [entry, ...localDiaryEntries.filter((item) => item.id !== entry.id)];
    store.myRoutes = localDiaryEntries;
    currentInsightsPort?.setEntries(localDiaryEntries);
    currentInsightsPort?.refresh();
    if (store.diaryViewMode === 'history') refreshDiaryPanel?.();
    notify('Saved locally on this device.');
  }).catch((error) => {
    console.warn('[Diary] Local save failed:', error);
    if (owningSession && currentDiarySession !== owningSession) return;
    notify(`Rating applied for this session, but it was not saved locally: ${error?.message || error}`);
    notifyPanel('Local storage failed. Export is unavailable until a rating can be saved.');
  });
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
  const refreshed = aggregation.buildFeatureCollection();
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
  const updated = aggregation.bumpConfidence(segmentId);
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
  const updated = aggregation.nudgeSafer(segmentId);
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

function updateAlternativeRoute({ refreshOnly = false } = {}) {
  if (!mapRef) return;
  if (!currentRoute) {
    clearRouteOverlay(mapRef, DIARY_ROUTE_ALT_SOURCE_ID);
    renderAltSummary(null, { reason: 'no-route' });
    return;
  }
  const shouldShow = !!store.diaryAltEnabled;
  const altInfo = resolveAlternativeForRoute(currentRoute, {
    getSegment: (id) => segmentLookup.get(id),
  });
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
  const summary = summarizeAlternativeBenefit(route, altInfo.meta, { countLowRated });
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

function countLowRated(segmentIds) {
  return aggregation.countLowRated(
    segmentIds,
    segmentLookup,
    LOW_RATING_THRESHOLD,
  );
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
  sim.coords = buildSimulationCoordinates(route.geometry);
  sim.idx = 0;
  sim.routeId = route.properties?.route_id || null;
  sim.active = false;
  sim.paused = true;
  sim.hasStarted = false;
  sim.playedOnce = false;
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
      removeNetworkLayer(targetMap);
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
  const stats = { status: 'cancelled', segmentsCount: 0, routesCount: 0 };
  if (options?.signal?.aborted) return stats;
  currentDiarySession?.dispose();
  if (typeof console !== 'undefined' && typeof console.info === 'function') {
    console.info('[Diary] initDiaryMode called', { hasMount: !!mountTarget, mountId: mountTarget?.id || 'none' });
  }
  if (!diaryFeatureEnabled()) {
    diaryFlagOff();
    return { ...stats, status: 'failed' };
  }

  if (!map) {
    console.warn('[Diary] initDiaryMode called without a MapLibre instance.');
    return { ...stats, status: 'failed' };
  }

  const session = createDiarySession({ ownerSignal: options?.signal });
  if (!session.isActive()) return stats;
  const ownerIsCurrent = typeof options?.isCurrent === 'function' ? options.isCurrent : () => true;
  const isCurrent = () => diarySessionIsCurrent(session, ownerIsCurrent);
  const insightsPort = createDiaryInsightsPort(options?.insights);
  localRepository = options?.localRepository || diaryLocalRepository;
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
    aggregation.reset(segments);
    const hydratedSegments = aggregation.buildFeatureCollection() || segments;
    lastLoadedSegments = hydratedSegments;
    lastLoadedRoutes = routes;
    try {
      localDiaryEntries = await localRepository.list();
      localStorageWarning = null;
    } catch (error) {
      console.warn('[Diary] Local history unavailable:', error);
      localDiaryEntries = [];
      localStorageWarning = error?.message || 'Local Diary storage is unavailable.';
    }
    if (!isCurrent()) {
      disposeDiarySession(session);
      return stats;
    }
    store.myRoutes = localDiaryEntries;
    insightsPort.setEntries(localDiaryEntries);

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
    if (localStorageWarning) showToast(localStorageWarning, 5000);
    const defaultRoute = routes.features?.[0];
    if (defaultRoute?.properties?.route_id) {
      if (routeSelectEl) {
        routeSelectEl.value = defaultRoute.properties.route_id;
      }
      selectRoute(defaultRoute.properties.route_id, { fitBounds: false });
    }
    return { ...stats, status: 'ready' };
  } catch (err) {
    if (!isCurrent()) {
      disposeDiarySession(session);
      return stats;
    }
    console.error('Demo data missing; please ensure files exist under /data/*.demo.geojson.', err);
    disposeDiarySession(session);
    return { ...stats, status: 'failed' };
  }
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
      refreshDiaryPanel = null;
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
