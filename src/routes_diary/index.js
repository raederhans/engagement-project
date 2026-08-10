/**
 * Route Safety Diary - Main Orchestrator
 *
 * Loads the deployable Diary demo data, mounts route and segment interactions,
 * runs the route simulator, and applies local rating/aggregation updates.
 */

import { closeSegmentPopup, mountSegmentsLayer, updateSegmentsData, removeSegmentsLayer, highlightSegments } from '../map/segments_layer.js';
import { addNetworkLayer, ensureNetworkLayer, removeNetworkLayer } from '../map/network_layer.js';
import { drawRouteOverlay, clearRouteOverlay, clearSimPoint } from '../map/routing_overlay.js';
import { HAS_DIARY_LIGHT_STYLE } from '../config.js';
import { openRatingModal, closeRatingModal, submitSegmentFeedback } from './form_submit.js';
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
  SEGMENT_ID_PROP,
  SCORE_PROP,
  ROUTE_SEG_IDS_PROP,
  ROUTE_ALT_SEG_IDS_PROP,
  ROUTE_NAME_PROP,
  ROUTE_FROM_PROP,
  ROUTE_TO_PROP,
  extractLineCoordinates,
} from './data_normalization.js';
import { renderLiveRoutePanel } from './ui_live_panel.js';
import { refreshMyRoutesDates, renderMyRoutesPanel } from './ui_my_routes_panel.js';
import { createSampleCommunityModel, renderCommunityPanel } from './ui_community_panel.js';
import { describeDiaryDataScope } from '../ui/data_scope.js';
import {
  createDiarySession,
  releaseOwnedReference,
  runCleanupSteps,
} from './diary_session.js';
import { loadOwnedDiaryData } from './demo_data_loader.js';
import '../i18n/diary_local.js';
import {
  createDiaryInsightsPort,
} from './diary_insights_port.js';
import { createDiaryAggregation } from './local_aggregation.js';
import { downloadTextFile } from '../utils/export_analysis.js';
import {
  describeAlternativeTradeoff,
  resolveAlternativeForRoute,
  summarizeAlternativeBenefit,
} from './alternative_route.js';
import { createDiarySimulator } from './diary_simulator.js';
import { applyTranslations, onLanguageChange, setTranslatedText, t } from '../i18n/index.js';
import { fitBoundsWithPanel, geometryBounds } from '../map/camera_fit.js';
import {
  createRouteSummaryModel,
  filterLocalDiaryEntries,
} from './diary_view_models.js';
import {
  loadDemoRoutes,
  loadDemoSegments,
  logMissingSegments,
} from './diary_seed_data.js';

export {
  createRouteSummaryModel,
  filterLocalDiaryEntries,
} from './diary_view_models.js';
export {
  loadDemoRoutes,
  loadDemoSegments,
} from './diary_seed_data.js';

function localizedDiaryError(error, fallbackKey) {
  const message = error?.message || String(error || '');
  const knownKeys = {
    'Diary backup is not valid JSON.': 'diary.backupInvalidJson',
    'Unsupported Diary backup schema.': 'diary.backupUnsupported',
    'Invalid Diary entry in backup.': 'diary.backupInvalidEntry',
    'Local Diary storage is unavailable in this browser.': 'diary.localStorageUnavailable',
  };
  return knownKeys[message] ? t(knownKeys[message]) : (message || t(fallbackKey));
}
const SAMPLE_COMMUNITY = createSampleCommunityModel();

const segmentLookup = new Map();

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
let networkStyleCleanup = null;
let currentDiarySession = null;
let currentDiaryOwnerIsCurrent = () => false;
let currentSimulator = null;
let currentInsightsPort = null;
let currentDiaryLocalLifecycle = null;
let localRepository = null;
let diaryStorageModule = null;
let diaryStorageModulePromise = null;
let localDiaryEntries = [];
let localDiarySnapshot = { entries: [], drafts: [], warnings: [] };
let localStorageWarning = null;
let diaryImportPlans = null;
let diaryImportPreview = null;
let diaryReplaceConfirm = false;
let diaryDeleteConfirmId = null;
let diaryDataStatus = null;
let diaryDataBusy = false;
let diaryDataFocusTarget = null;
let refreshDiaryPanel = null;
let refreshDiaryCopy = null;
const diaryQs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search || '') : new URLSearchParams('');
const diaryPath = typeof window !== 'undefined' ? window.location.pathname || '' : '';
const ROUTE_EXPERIENCE_RATING_EXPRESSION = [
  'case',
  ['>=', ['coalesce', ['get', 'overlay_safety'], 3], 4], '#7c3aed',
  ['>=', ['coalesce', ['get', 'overlay_safety'], 3], 2.5], '#3b82f6',
  '#64748b',
];
let historyPeriodFilter = '30d';
let historyModeFilter = 'all';

function diaryInsightsContext(mode = store.diaryViewMode, route = currentRoute) {
  return {
    mode,
    routeId: mode === 'live' ? route?.properties?.route_id ?? null : null,
  };
}

function syncDiaryInsightsContext(mode = store.diaryViewMode) {
  currentInsightsPort?.setViewContext(diaryInsightsContext(mode));
}

function clearDiaryTimeout(id) {
  if (id == null) return;
  if (currentDiarySession) {
    currentDiarySession.clearTimeout(id);
  } else {
    clearTimeout(id);
  }
}

function diarySessionIsCurrent(session = currentDiarySession, ownerIsCurrent = currentDiaryOwnerIsCurrent) {
  return Boolean(session?.isActive() && ownerIsCurrent?.());
}

function createOwnedSimulator(session, ownerIsCurrent, map) {
  let ownedSimulator = null;
  ownedSimulator = createDiarySimulator({
    getRoute: () => currentRoute,
    getMap: () => map,
    getSession: () => session,
    isCurrent: () => diarySessionIsCurrent(session, ownerIsCurrent),
    getDocument: () => globalThis.document,
    getWindow: () => globalThis.window,
    persistState: setSimPanelState,
    onStateChange: () => {
      if (currentSimulator === ownedSimulator) updateSimButtons();
    },
    onFinish: () => {
      if (currentSimulator === ownedSimulator) openRouteRating();
    },
    onPageHide: () => teardownDiaryTransient(map, {
      silent: true,
      simulator: ownedSimulator,
    }),
  });
  return ownedSimulator;
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
    const label = props[ROUTE_NAME_PROP] || `${props[ROUTE_FROM_PROP] || t('diary.start')} → ${props[ROUTE_TO_PROP] || t('diary.destination')}`;
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

function applyLocalDiarySnapshot(snapshot = {}) {
  localDiarySnapshot = {
    entries: Array.isArray(snapshot.entries) ? snapshot.entries : [],
    drafts: Array.isArray(snapshot.drafts) ? snapshot.drafts : [],
    warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings : [],
  };
  localDiaryEntries = localDiarySnapshot.entries;
  localStorageWarning = localDiarySnapshot.warnings.length
    ? t('diary.storageRowsSkipped', { count: localDiarySnapshot.warnings.length })
    : null;
  store.myRoutes = localDiaryEntries;
  currentInsightsPort?.setEntries(localDiaryEntries);
  currentInsightsPort?.refresh();
}

function clearDiaryImportPreview() {
  diaryImportPlans = null;
  diaryImportPreview = null;
  diaryReplaceConfirm = false;
}

function loadDiaryStorageModule() {
  if (diaryStorageModule) return Promise.resolve(diaryStorageModule);
  if (!diaryStorageModulePromise) {
    const request = import('./diary_storage.js');
    diaryStorageModulePromise = request
      .then((module) => {
        diaryStorageModule = module;
        return module;
      })
      .catch((error) => {
        if (diaryStorageModulePromise) {
          diaryStorageModulePromise = null;
          diaryStorageModule = null;
        }
        throw error;
      });
  }
  return diaryStorageModulePromise;
}

async function prepareDiaryBackupImport(file, render) {
  if (!file || diaryDataBusy) return;
  const session = currentDiarySession;
  const ownerIsCurrent = currentDiaryOwnerIsCurrent;
  const lifecycle = currentDiaryLocalLifecycle;
  if (!lifecycle) return;
  diaryDataBusy = true;
  diaryDataStatus = { key: 'diary.backupPreparing' };
  diaryDataFocusTarget = 'data-status';
  render();
  try {
    if (Number(file.size) > 10 * 1024 * 1024) throw new Error('Diary backup is too large.');
    const text = await file.text();
    if (!diarySessionIsCurrent(session, ownerIsCurrent)) return;
    const snapshot = await lifecycle.snapshot();
    if (!diarySessionIsCurrent(session, ownerIsCurrent)) return;
    const { createDiaryBackupPlan } = await loadDiaryStorageModule();
    if (!diarySessionIsCurrent(session, ownerIsCurrent)) return;
    const merge = createDiaryBackupPlan(snapshot, text, { mode: 'merge' });
    const replace = createDiaryBackupPlan(snapshot, text, { mode: 'replace' });
    diaryImportPlans = { merge, replace };
    diaryImportPreview = {
      fileName: file.name || '',
      migratedFrom: merge.source.migratedFrom,
      mergeSummary: merge.summary,
      replaceSummary: replace.summary,
    };
    diaryReplaceConfirm = false;
    diaryDataStatus = { key: 'diary.backupReady' };
    diaryDataFocusTarget = 'import-preview';
  } catch (error) {
    if (!diarySessionIsCurrent(session, ownerIsCurrent)) return;
    clearDiaryImportPreview();
    diaryDataStatus = {
      key: 'diary.backupOperationFailed',
      params: { message: localizedDiaryError(error, 'diary.importFailed') },
      tone: 'error',
    };
    diaryDataFocusTarget = 'data-status';
  } finally {
    if (diarySessionIsCurrent(session, ownerIsCurrent)) {
      diaryDataBusy = false;
      render();
    }
  }
}

async function applyDiaryBackupImport(strategy, render) {
  if (diaryDataBusy || !diaryImportPlans?.[strategy]) return;
  const session = currentDiarySession;
  const ownerIsCurrent = currentDiaryOwnerIsCurrent;
  const lifecycle = currentDiaryLocalLifecycle;
  const prepared = diaryImportPlans[strategy];
  if (!lifecycle) return;
  diaryDataBusy = true;
  diaryDataStatus = { key: 'diary.backupImporting' };
  diaryDataFocusTarget = 'data-status';
  render();
  try {
    const result = await lifecycle.applyImport(prepared, {
      strategy,
      confirmReplace: strategy === 'replace',
    });
    if (!result.applied || !diarySessionIsCurrent(session, ownerIsCurrent)) return;
    applyLocalDiarySnapshot(result.snapshot);
    clearDiaryImportPreview();
    diaryDataStatus = {
      key: strategy === 'replace' ? 'diary.backupReplaced' : 'diary.backupMerged',
      params: {
        entries: localDiarySnapshot.entries.length,
        drafts: localDiarySnapshot.drafts.length,
      },
    };
    diaryDataFocusTarget = 'data-status';
  } catch (error) {
    if (!diarySessionIsCurrent(session, ownerIsCurrent)) return;
    if (error?.code === 'DIARY_BACKUP_PREVIEW_STALE') {
      clearDiaryImportPreview();
      diaryDataStatus = { key: 'diary.backupPreviewStale', tone: 'error' };
    } else {
      diaryDataStatus = {
        key: 'diary.backupOperationFailed',
        params: { message: localizedDiaryError(error, 'diary.importFailed') },
        tone: 'error',
      };
    }
    diaryDataFocusTarget = 'data-status';
  } finally {
    if (diarySessionIsCurrent(session, ownerIsCurrent)) {
      diaryDataBusy = false;
      render();
    }
  }
}

async function exportDiaryPrivateBackup(render) {
  if (diaryDataBusy) return;
  const session = currentDiarySession;
  const ownerIsCurrent = currentDiaryOwnerIsCurrent;
  const lifecycle = currentDiaryLocalLifecycle;
  if (!lifecycle) return;
  diaryDataBusy = true;
  diaryDataStatus = { key: 'diary.backupExporting' };
  diaryDataFocusTarget = 'data-status';
  render();
  try {
    const snapshot = await lifecycle.snapshot();
    if (!diarySessionIsCurrent(session, ownerIsCurrent)) return;
    applyLocalDiarySnapshot(snapshot);
    const { serializeDiaryPrivateBackup } = await loadDiaryStorageModule();
    if (!diarySessionIsCurrent(session, ownerIsCurrent)) return;
    const backup = serializeDiaryPrivateBackup(snapshot);
    downloadTextFile(
      `engagement-diary-private-${new Date().toISOString().slice(0, 10)}.json`,
      `${JSON.stringify(backup, null, 2)}\n`,
      'application/json',
    );
    diaryDataStatus = { key: 'diary.backupExported' };
    diaryDataFocusTarget = 'data-status';
  } catch (error) {
    if (!diarySessionIsCurrent(session, ownerIsCurrent)) return;
    diaryDataStatus = {
      key: 'diary.backupOperationFailed',
      params: { message: localizedDiaryError(error, 'diary.localStorageUnavailable') },
      tone: 'error',
    };
    diaryDataFocusTarget = 'data-status';
  } finally {
    if (diarySessionIsCurrent(session, ownerIsCurrent)) {
      diaryDataBusy = false;
      render();
    }
  }
}

async function deleteLocalDiaryEntry(item, render) {
  if (!item?.id || diaryDataBusy) return;
  const session = currentDiarySession;
  const ownerIsCurrent = currentDiaryOwnerIsCurrent;
  const lifecycle = currentDiaryLocalLifecycle;
  if (!lifecycle) return;
  diaryDataBusy = true;
  diaryDataStatus = {
    key: 'diary.routeDeleting',
    params: { label: item.label || t('diary.untitledRoute') },
  };
  diaryDataFocusTarget = 'data-status';
  render();
  try {
    const result = await lifecycle.deleteEntry(item.id);
    if (!result.applied || !diarySessionIsCurrent(session, ownerIsCurrent)) return;
    applyLocalDiarySnapshot({
      ...localDiarySnapshot,
      entries: localDiarySnapshot.entries.filter((entry) => entry.id !== item.id),
    });
    clearDiaryImportPreview();
    if (store.diarySelectedHistoryRouteId === item.id) setDiarySelectedHistoryRouteId(null);
    diaryDeleteConfirmId = null;
    diaryDataStatus = {
      key: 'diary.routeDeleted',
      params: { label: item.label || t('diary.untitledRoute') },
    };
    diaryDataFocusTarget = 'history-title';
  } catch (error) {
    if (!diarySessionIsCurrent(session, ownerIsCurrent)) return;
    diaryDataStatus = {
      key: 'diary.routeDeleteFailed',
      params: { message: localizedDiaryError(error, 'diary.localStorageUnavailable') },
      tone: 'error',
    };
    diaryDataFocusTarget = 'data-status';
  } finally {
    if (diarySessionIsCurrent(session, ownerIsCurrent)) {
      diaryDataBusy = false;
      render();
    }
  }
}

function ensureDiaryPanel(routes, options = {}) {
  if (typeof document === 'undefined') return;
  if (!routes) return;
  const mountTarget = options?.mountInto || null;
  const onScopeChange = typeof options?.onScopeChange === 'function'
    ? options.onScopeChange
    : () => {};

  if (mountTarget && diaryPanelEl !== mountTarget) {
    diaryPanelEl = mountTarget;
    diaryPanelFloating = false;
  }

  if (!diaryPanelEl) {
    const panel = mountTarget || document.createElement('div');
    if (!mountTarget) {
      panel.id = 'diary-route-panel';
      panel.className = 'diary-panel-shell diary-panel-shell--floating';
      panel.setAttribute('data-diary-floating', 'true');
      document.body.appendChild(panel);
      diaryPanelFloating = true;
    } else {
      panel.classList.add('diary-panel-shell', 'diary-panel-shell--embedded');
      diaryPanelFloating = false;
    }
    diaryPanelEl = panel;
  }

  diaryPanelEl.innerHTML = '';
  diaryPanelEl.classList.add('diary-panel-shell');

  const title = document.createElement('div');
  title.className = 'diary-panel-heading';
  const titleText = document.createElement('h3');
  setTranslatedText(titleText, 'diary.demoTitle');
  const subtitle = document.createElement('div');
  subtitle.className = 'diary-panel-subtitle';
  setTranslatedText(subtitle, 'diary.demoSubtitle');
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
  const makePill = (key, mode) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    setTranslatedText(btn, key);
    btn.className = 'diary-view-pill';
    btn.addEventListener('click', ownPanelHandler(() => {
      setDiaryViewMode(mode);
      renderActivePanel();
    }));
    return { btn, mode };
  };
  const pills = [
    makePill('diary.tab.live', 'live'),
    makePill('diary.tab.history', 'history'),
    makePill('diary.tab.community', 'community'),
  ];
  pills.forEach((p) => viewSwitcher.appendChild(p.btn));
  diaryPanelEl.appendChild(viewSwitcher);

  const body = document.createElement('div');
  diaryPanelEl.appendChild(body);

  const syncPills = () => {
    pills.forEach((p) => {
      const selected = store.diaryViewMode === p.mode;
      p.btn.classList.toggle('is-active', selected);
      p.btn.setAttribute('aria-pressed', String(selected));
    });
  };

  const renderActivePanel = () => {
    onScopeChange(describeDiaryDataScope(store.diaryViewMode));
    syncPills();
    if (store.diaryViewMode !== 'live') clearLiveDiaryMapState();
    body.innerHTML = '';
    clearLiveRefs();
    if (store.diaryViewMode === 'history') {
      syncDiaryInsightsContext('history');
      const focusTarget = diaryDataFocusTarget;
      diaryDataFocusTarget = null;
      renderMyRoutesPanel(
        body,
        {
          period: historyPeriodFilter,
          mode: historyModeFilter,
          routes: filterLocalDiaryEntries(localDiaryEntries, {
            period: historyPeriodFilter,
            mode: historyModeFilter,
          }),
          hasPrivateData: localDiarySnapshot.entries.length > 0 || localDiarySnapshot.drafts.length > 0,
          storageWarnings: localDiarySnapshot.warnings,
          importPreview: diaryImportPreview,
          replaceConfirm: diaryReplaceConfirm,
          deleteConfirmId: diaryDeleteConfirmId,
          dataStatus: diaryDataStatus,
          busy: diaryDataBusy,
          focusTarget,
        },
        {
          onPeriodChange: ownPanelHandler((val) => {
            historyPeriodFilter = val;
            diaryDataFocusTarget = 'period-filter';
            renderActivePanel();
          }),
          onModeChange: ownPanelHandler((val) => {
            historyModeFilter = val;
            diaryDataFocusTarget = 'mode-filter';
            renderActivePanel();
          }),
          onOpen: ownPanelHandler((item) => {
            setDiarySelectedHistoryRouteId(item.id);
            focusHistoryRouteOnMap(item);
          }),
          onDeleteIntent: ownPanelHandler((item) => {
            diaryDeleteConfirmId = item.id;
            diaryDataStatus = null;
            diaryDataFocusTarget = `delete-confirm:${item.id}`;
            renderActivePanel();
          }),
          onDeleteConfirm: ownPanelHandler((item) => {
            void deleteLocalDiaryEntry(item, renderActivePanel);
          }),
          onDeleteCancel: ownPanelHandler((item) => {
            diaryDeleteConfirmId = null;
            diaryDataFocusTarget = `delete-action:${item.id}`;
            renderActivePanel();
          }),
          onExport: ownPanelHandler(() => {
            void exportDiaryPrivateBackup(renderActivePanel);
          }),
          onImport: ownPanelHandler((file) => {
            void prepareDiaryBackupImport(file, renderActivePanel);
          }),
          onImportMerge: ownPanelHandler(() => {
            void applyDiaryBackupImport('merge', renderActivePanel);
          }),
          onImportReplaceIntent: ownPanelHandler(() => {
            diaryReplaceConfirm = true;
            diaryDataStatus = null;
            diaryDataFocusTarget = 'replace-confirm';
            renderActivePanel();
          }),
          onImportReplaceConfirm: ownPanelHandler(() => {
            void applyDiaryBackupImport('replace', renderActivePanel);
          }),
          onImportCancel: ownPanelHandler(() => {
            clearDiaryImportPreview();
            diaryDataStatus = { key: 'diary.backupCancelled' };
            diaryDataFocusTarget = 'choose-backup';
            renderActivePanel();
          }),
        }
      );
    } else if (store.diaryViewMode === 'community') {
      syncDiaryInsightsContext('community');
      renderCommunityPanel(
        body,
        SAMPLE_COMMUNITY
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
          onPlay: ownPanelHandler(() => currentSimulator?.start()),
          onPause: ownPanelHandler(() => currentSimulator?.pause()),
          onFinish: ownPanelHandler(() => currentSimulator?.finish({ openModal: true })),
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
      if (panelNoticeEl) {
        panelNoticeEl.classList.add('diary-panel-notice');
        panelNoticeEl.setAttribute('role', 'status');
        panelNoticeEl.setAttribute('aria-live', 'polite');
        panelNoticeEl.setAttribute('aria-atomic', 'true');
      }
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
        selectRoute(desiredRouteId, { fitBounds: true });
      } else {
        syncDiaryInsightsContext('live');
      }
      applyAltToggleState(store.diaryAltEnabled, { update: false });
      currentSimulator?.hydrate(store.simState || {});
    }
  };

  currentInsightsPort?.setEntries(localDiaryEntries);
  refreshDiaryCopy = () => {
    onScopeChange(describeDiaryDataScope(store.diaryViewMode));
    applyTranslations(diaryPanelEl);
    refreshMyRoutesDates(diaryPanelEl);
    if (store.diaryViewMode === 'live') {
      renderRouteSummary(currentRoute);
      updateAlternativeRoute({ refreshOnly: true });
      updateSimButtons();
    }
    currentInsightsPort?.refresh();
  };
  refreshDiaryPanel = renderActivePanel;
  renderActivePanel();
}

function populateRouteOptions(routes) {
  if (!routeSelectEl || !routes?.features) return;
  const previous = routeSelectEl.value;
  routeSelectEl.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  setTranslatedText(placeholder, 'diary.selectRoute');
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
    setTranslatedText(summaryStripEl, 'diary.selectRouteDetails');
    return;
  }
  const model = createRouteSummaryModel(route);
  const pieces = [
    `<div class="diary-route-summary__place">${escapeHtml(model.from)}</div>`,
    `<div class="diary-route-summary__separator">${escapeHtml(t('diary.to'))}</div>`,
    `<div class="diary-route-summary__place">${escapeHtml(model.to)}</div>`,
  ];
  summaryStripEl.innerHTML = `
    <div class="diary-route-summary__path">${pieces.join('')}</div>
    <div class="diary-route-summary__meta">
      <span class="diary-chip diary-chip--neutral">${escapeHtml(model.mode)}</span>
      <span class="diary-chip diary-chip--neutral">${escapeHtml(model.distance)}</span>
      <span class="diary-chip diary-chip--neutral">${escapeHtml(model.duration)}</span>
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
  if (store.diaryViewMode === 'live') syncDiaryInsightsContext('live');
  setSimPanelState({ playing: false, progress: 0, routeId });
  renderRouteSummary(feature);
  if (routeSelectEl && routeSelectEl.value !== routeId) {
    routeSelectEl.value = routeId;
  }
  if (rateButtonEl) {
    setDisabledState(rateButtonEl, false);
  }
  if (mapRef) {
    const isCommunity = store.diaryViewMode === 'community';
    const overlayData = buildRouteOverlayCollection(feature, ROUTE_SEG_IDS_PROP) || feature;
    drawRouteOverlay(mapRef, DIARY_ROUTE_PRIMARY_SOURCE_ID, overlayData, {
      lineColorExpression: ROUTE_EXPERIENCE_RATING_EXPRESSION,
      width: 7,
      opacity: isCommunity ? 0.7 : 0.95,
    });
    if (fitBounds && !store.diaryAltEnabled) {
      fitMapToRoute(feature);
    }
  }
  currentInsightsPort?.refresh();
  updateAlternativeRoute();
  updateSimButtons();
}

function fitMapToRoute(route) {
  return fitMapToRoutes(route);
}

function fitMapToRoutes(...routes) {
  if (!mapRef || !diarySessionIsCurrent()) return false;
  const features = routes.filter(Boolean);
  const bounds = geometryBounds({ type: 'FeatureCollection', features });
  return fitBoundsWithPanel(mapRef, bounds);
}

export function fitCurrentDiarySelection() {
  if (store.diaryViewMode !== 'live') return false;
  const alt = store.diaryAltEnabled && currentRoute
    ? resolveAlternativeForRoute(currentRoute, { getSegment: (id) => segmentLookup.get(id) })
    : null;
  return fitMapToRoutes(currentRoute, alt?.feature);
}

async function openRouteRating() {
  if (!currentRoute) return;
  const routeFeature = currentRoute;
  const routeId = String(routeFeature.properties?.route_id || '');
  const session = currentDiarySession;
  const ownerIsCurrent = currentDiaryOwnerIsCurrent;
  const lifecycle = currentDiaryLocalLifecycle;
  if (!routeId || !lifecycle) return;

  let storedDraft = null;
  try {
    const result = await lifecycle.loadDraft(routeId);
    if (!result.applied || !diarySessionIsCurrent(session, ownerIsCurrent)) return;
    if (currentRoute?.properties?.route_id !== routeId) return;
    storedDraft = result.draft;
  } catch (error) {
    if (!diarySessionIsCurrent(session, ownerIsCurrent)) return;
    showToast(localizedDiaryError(error, 'diary.localStorageUnavailable'));
    return;
  }

  const opened = openRatingModal({
    routeFeature,
    segmentLookup,
    userHash: getUserHash(),
    initialDraft: storedDraft ? {
      step: storedDraft.step,
      overallRating: storedDraft.rating,
      tags: storedDraft.tags,
      notes: storedDraft.notes,
      overrides: Object.entries(storedDraft.overrides || {}),
    } : null,
    onDraftChange: (draft) => {
      clearDiaryImportPreview();
      return lifecycle.persistDraft(routeId, draft, {
        routeSourceVersion: routeFeature.properties?.source_version,
      });
    },
    onCommit: guardDiaryCommit(({ payload, response }) => (
      handleDiarySubmissionSuccess({ payload, response }, {
        localLifecycle: lifecycle,
        routeFeature,
      })
    ), session, ownerIsCurrent),
    signal: session?.signal,
  });
  if (opened && storedDraft) showToast(t('diary.draftRestored'));
}

export async function handleDiarySubmissionSuccess({ payload, response }, {
  aggregationModel = aggregation,
  map = mapRef,
  updateSegments = updateSegmentsData,
  refreshAlternativeRoute = () => updateAlternativeRoute({ refreshOnly: true }),
  notify = showToast,
  notifyPanel = showPanelNotice,
  highlightSegments = onRouteRatingSuccess,
  onSegmentsRefreshed,
  repository = localRepository,
  localLifecycle = currentDiaryLocalLifecycle,
  routeFeature = currentRoute,
  createLocalEntry,
  onLocalSaved,
} = {}) {
  if (!payload) return { applied: false, reason: 'invalid' };
  const entryFactory = createLocalEntry
    || (await loadDiaryStorageModule()).createDiaryEntry;
  const entry = entryFactory({ payload, routeFeature });
  let commitResult;
  if (localLifecycle) {
    commitResult = await localLifecycle.commitEntry(entry, entry.routeId || payload.route_id);
  } else if (repository?.commitEntry) {
    const saved = await repository.commitEntry(entry, { draftRouteId: entry.routeId || payload.route_id });
    commitResult = { applied: true, entry: saved };
  } else {
    const saved = await repository.save(entry);
    commitResult = { applied: true, entry: saved };
  }
  if (commitResult?.applied === false) return commitResult;
  clearDiaryImportPreview();

  aggregationModel.applySubmission(payload);
  const refreshed = aggregationModel.buildFeatureCollection();
  if (refreshed && map) {
    updateSegments(map, DIARY_SEGMENTS_SOURCE_ID, refreshed);
    if (onSegmentsRefreshed) onSegmentsRefreshed(refreshed);
    else lastLoadedSegments = refreshed;
  }
  refreshAlternativeRoute();
  const persisted = response?.persisted !== false && response?.mode !== 'demo';
  notify(persisted ? t('diary.feedbackSaved') : t('diary.feedbackDemoOnly'));
  const affectedSegmentIds = deriveAffectedSegmentIds(payload);
  const affectedCount = affectedSegmentIds.size || 1;
  notifyPanel(t('diary.confidenceImproved', { count: affectedCount }));
  highlightSegments(Array.from(affectedSegmentIds));
  if (onLocalSaved) {
    await onLocalSaved(entry);
  } else {
    localDiaryEntries = [entry, ...localDiaryEntries.filter((item) => item.id !== entry.id)];
    localDiarySnapshot = {
      ...localDiarySnapshot,
      entries: localDiaryEntries,
      drafts: localDiarySnapshot.drafts.filter((draft) => draft.routeId !== entry.routeId),
    };
    store.myRoutes = localDiaryEntries;
    currentInsightsPort?.setEntries(localDiaryEntries);
    currentInsightsPort?.refresh();
    if (store.diaryViewMode === 'history') refreshDiaryPanel?.();
    notify(t('diary.savedLocally'));
  }
  return { applied: true, entry, commitResult };
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
  if (!segmentId || store.diaryViewMode !== 'live') return;
  if (isThrottled(segmentId, 'agree')) {
    showToast(t('diary.recordedSession'));
    return;
  }
  const updated = aggregation.bumpConfidence(segmentId);
  if (!updated) return;
  setVoteFlag(segmentId, 'agree');
  refreshAfterCta(t('diary.confidenceIncreased'));
}

async function onFeelsSaferClick(segmentId) {
  if (!segmentId || store.diaryViewMode !== 'live') return;
  if (isThrottled(segmentId, 'safer')) {
    showToast(t('diary.recordedSession'));
    return;
  }
  const updated = aggregation.nudgeSafer(segmentId);
  if (!updated) return;
  setVoteFlag(segmentId, 'safer');
  refreshAfterCta(t('diary.feelsSaferNoted'));
}

function handleSegmentAction(payload) {
  if (store.diaryViewMode !== 'live' || !payload || !payload.action || !payload.segmentId) return;
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
    fitMapToRoutes(currentRoute, altInfo.feature);
  }
}

function clearLiveDiaryMapState() {
  closeRatingModal();
  closeSegmentPopup();
  currentSimulator?.teardown({ silent: true });
  if (!mapRef) return;
  clearRouteOverlay(mapRef, DIARY_ROUTE_PRIMARY_SOURCE_ID);
  clearRouteOverlay(mapRef, DIARY_ROUTE_ALT_SOURCE_ID);
  clearSimPoint(mapRef, DIARY_SIM_POINT_SOURCE_ID);
}

function renderAltSummary(route, altInfo) {
  if (!altSummaryEl) return;
  if (!route) {
    setTranslatedText(altSummaryEl, 'diary.selectAlternative');
    return;
  }
  if (!altInfo) {
    setTranslatedText(altSummaryEl, 'diary.alternativeUnavailable');
    return;
  }
  const summary = summarizeAlternativeBenefit(route, altInfo.meta, { countLowRated });
  if (!summary) {
    setTranslatedText(altSummaryEl, 'diary.alternativeUnavailable');
    return;
  }
  const tradeoff = describeAlternativeTradeoff(summary);
  altSummaryEl.replaceChildren();
  const benefit = document.createElement('div');
  benefit.className = 'diary-alternative-summary__benefit';
  benefit.textContent = tradeoff.benefit;
  const cost = document.createElement('div');
  cost.className = 'diary-alternative-summary__cost';
  cost.textContent = tradeoff.cost;
  const caveat = document.createElement('div');
  caveat.className = 'diary-alternative-summary__caveat';
  caveat.textContent = tradeoff.caveat;
  altSummaryEl.append(benefit, cost, caveat);
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

export function teardownDiaryTransient(
  map = mapRef,
  { silent = false, removeNetworkOverlay = true, simulator = currentSimulator } = {},
) {
  const targetMap = map || mapRef;
  simulator?.teardown({ silent: true });
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
  const simState = currentSimulator?.getState() || {
    active: false,
    paused: true,
    hasStarted: false,
  };
  if (playButtonEl) {
    setDisabledState(playButtonEl, !hasRoute || (simState.active && !simState.paused));
  }
  if (pauseButtonEl) {
    setDisabledState(pauseButtonEl, !hasRoute || !simState.hasStarted || simState.paused);
  }
  if (finishButtonEl) {
    setDisabledState(finishButtonEl, !hasRoute || !simState.hasStarted);
  }
  if (rateButtonEl) {
    setDisabledState(rateButtonEl, !hasRoute);
  }
}

function setDisabledState(element, disabled) {
  if (!element) return;
  element.disabled = Boolean(disabled);
  element.classList?.toggle?.('is-disabled', element.disabled);
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
  wrapper.className = 'toast diary-toast';
  wrapper.setAttribute('role', 'status');
  wrapper.setAttribute('aria-live', 'polite');
  wrapper.setAttribute('aria-atomic', 'true');
  wrapper.textContent = message;
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
  panelNoticeEl.classList.remove('is-error', 'is-info', 'is-success');
  panelNoticeEl.classList.add(`is-${tone === 'error' || tone === 'info' ? tone : 'success'}`);
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

/**
 * Initialize Route Safety Diary mode
 * @param {MapLibreMap} map - MapLibre GL map instance
 */
export async function initDiaryMode(map, options = {}) {
  const mountTarget = options?.mountInto || null;
  const stats = { status: 'cancelled', segmentsCount: 0, routesCount: 0 };
  if (options?.signal?.aborted) return stats;
  currentDiarySession?.dispose();
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
  let storageModule;
  try {
    storageModule = await loadDiaryStorageModule();
    if (!isCurrent()) {
      disposeDiarySession(session);
      return stats;
    }
  } catch (error) {
    console.error('[Diary] Local storage module unavailable:', error);
    disposeDiarySession(session);
    return { ...stats, status: 'failed' };
  }
  localRepository = options?.localRepository || storageModule.diaryLocalRepository;
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
    const ownedLocalLifecycle = storageModule.createDiaryLocalLifecycle({
      repository: localRepository,
      isCurrent,
    });
    currentDiaryLocalLifecycle = ownedLocalLifecycle;
    const ownedSimulator = createOwnedSimulator(session, ownerIsCurrent, map);
    currentSimulator = ownedSimulator;
    session.addCleanup(onLanguageChange(() => {
      if (!isCurrent()) return;
      if (refreshDiaryCopy) refreshDiaryCopy();
      else currentInsightsPort?.refresh();
    }));
    session.addCleanup(() => {
      ownedLocalLifecycle.dispose();
      currentDiaryLocalLifecycle = releaseOwnedReference(
        currentDiaryLocalLifecycle,
        ownedLocalLifecycle,
      );
    });
    session.addCleanup(() => cleanupDiaryMode(
      map,
      insightsPort,
      ownerIsCurrent,
      ownedSimulator,
      mountTarget,
      false,
      ownedLocalLifecycle,
    ));
    cleanupNetworkOverlayLifecycle();
    if (mountTarget) mountTarget.setAttribute('data-diary-mounted', 'true');
    setDiaryMapSkin(mapRef, true);
    ensureNetworkOverlayLifecycle(mapRef, session, ownerIsCurrent);

    logMissingSegments(routes, segments);
    buildSegmentLookup(segments);
    ensureRouteIndex(routes);
    aggregation.reset(segments);
    const hydratedSegments = aggregation.buildFeatureCollection() || segments;
    lastLoadedSegments = hydratedSegments;
    lastLoadedRoutes = routes;
    try {
      localDiarySnapshot = localRepository.snapshot
        ? await localRepository.snapshot()
        : {
          entries: await localRepository.list(),
          drafts: [],
          warnings: [],
        };
      localDiaryEntries = localDiarySnapshot.entries;
      localStorageWarning = localDiarySnapshot.warnings.length
        ? t('diary.storageRowsSkipped', { count: localDiarySnapshot.warnings.length })
        : null;
    } catch (error) {
      console.warn('[Diary] Local history unavailable:', error);
      localDiaryEntries = [];
      localDiarySnapshot = { entries: [], drafts: [], warnings: [] };
      localStorageWarning = localizedDiaryError(error, 'diary.localStorageUnavailable');
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
        canInteract: () => store.diaryViewMode === 'live',
        onAction: guardDiaryCommit(handleSegmentAction, session, ownerIsCurrent),
        submitFeedback: submitSegmentFeedback,
      });
      layerMounted = true;
    }

    routesRef = routes;
    const publishScope = typeof options?.onScopeChange === 'function'
      ? guardDiaryCommit(options.onScopeChange, session, ownerIsCurrent)
      : () => {};
    ensureDiaryPanel(routes, {
      mountInto: mountTarget,
      onScopeChange: publishScope,
    });
    if (localStorageWarning) showToast(localStorageWarning, 5000);
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
  ownedSimulator = currentSimulator,
  ownedMountTarget = null,
  removeNetworkOverlay = true,
  ownedLocalLifecycle = currentDiaryLocalLifecycle,
) {
  const targetMap = map || mapRef;
  runCleanupSteps([
    () => {
      if (targetMap) removeSegmentsLayer(targetMap, DIARY_SEGMENTS_SOURCE_ID);
    },
    () => teardownDiaryTransient(targetMap, {
      silent: true,
      removeNetworkOverlay,
      simulator: ownedSimulator,
    }),
    () => { layerMounted = false; },
    () => closeRatingModal({ force: true }),
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
      refreshDiaryCopy = null;
      diaryImportPlans = null;
      diaryImportPreview = null;
      diaryReplaceConfirm = false;
      diaryDeleteConfirmId = null;
      diaryDataStatus = null;
      diaryDataBusy = false;
      diaryDataFocusTarget = null;
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
    () => {
      currentSimulator = releaseOwnedReference(currentSimulator, ownedSimulator);
    },
    () => {
      ownedLocalLifecycle?.dispose();
      currentDiaryLocalLifecycle = releaseOwnedReference(
        currentDiaryLocalLifecycle,
        ownedLocalLifecycle,
      );
    },
    () => { mapRef = releaseOwnedReference(mapRef, targetMap); },
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
