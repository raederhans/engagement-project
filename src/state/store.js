/**
 * Minimal shared state placeholder for forthcoming controls and maps.
 */
import dayjs from 'dayjs';
import { expandGroupsToCodes } from '../utils/types.js';
import { fetchCoverage } from '../api/meta.js';

const qs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search || '') : new URLSearchParams('');
const path = typeof window !== 'undefined' ? window.location.pathname || '' : '';
const diaryFeatureOn = (typeof import.meta !== 'undefined' && import.meta?.env?.VITE_FEATURE_DIARY === '1')
  || (qs.get('mode') === 'diary')
  || path.includes('diary-demo');
if (typeof console !== 'undefined' && typeof console.info === 'function') {
  console.info('[Diary] store gating', { env: import.meta?.env?.VITE_FEATURE_DIARY, urlMode: qs.get('mode'), path, enabled: diaryFeatureOn });
}
const viewModeListeners = new Set();
const diaryStateListeners = new Set();
const PANEL_STATE_KEY = 'diary_panel_state';

function getDefaultPanelPrefs() {
  return {
    viewMode: 'crime',
    selectedRouteId: null,
    diaryAltEnabled: false,
    diaryViewMode: 'live',
    diarySelectedHistoryRouteId: null,
    diaryCommunityRadiusMeters: 1500,
    simState: { playing: false, progress: 0, routeId: null },
    simPlaybackSpeed: 1,
    diaryDemoPeriod: 'day',
    diaryTimeFilter: 'all',
  };
}

function loadPanelPrefs() {
  const defaults = getDefaultPanelPrefs();
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return defaults;
  }
  try {
    const raw = window.sessionStorage.getItem(PANEL_STATE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      ...defaults,
      ...parsed,
      simState: { ...defaults.simState, ...(parsed.simState || {}) },
    };
  } catch {
    return defaults;
  }
}

let panelPrefs = loadPanelPrefs();

function persistPanelPrefs() {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(PANEL_STATE_KEY, JSON.stringify(panelPrefs));
  } catch {}
}

/**
 * @typedef {object} Store
 * @property {string|null} addressA
 * @property {string|null} addressB
 * @property {number} radius
 * @property {number} timeWindowMonths
 * @property {string[]} selectedGroups
 * @property {string[]} selectedTypes
 * @property {string} adminLevel
 * @property {any} mapBbox
 * @property {[number,number]|null} center3857
 * @property {() => {start:string,end:string}} getStartEnd
 * @property {() => {start:string,end:string,types:string[],center3857:[number,number]|null,radiusM:number}} getFilters
 * @property {(lng:number,lat:number) => void} setCenterFromLngLat
 */

export const store = /** @type {Store} */ ({
  addressA: null,
  addressB: null,
  radius: 400,
  timeWindowMonths: 6,
  startMonth: null,
  durationMonths: 6,
  selectedGroups: [],
  selectedTypes: [],
  selectedDrilldownCodes: [], // Child offense codes (overrides parent groups when set)
  adminLevel: 'districts',
  selectMode: 'idle',
  centerLonLat: null,
  centerBLonLat: null,
  centerB3857: null,
  selectTarget: 'A',
 per10k: false,
  mapBbox: null,
  center3857: null,
  coverageMin: null,
  coverageMax: null,
  coverageStatus: 'idle',
  coverageError: null,
  coverageNotice: null,
  // Query mode and selections
  queryMode: 'buffer', // 'buffer' | 'district' | 'tract'
  selectedDistrictCode: null,
  selectedTractGEOID: null,
  overlayTractsLines: false, // Show tract boundaries overlay in district mode
  didAutoAlignAdmin: false, // One-time auto-align flag for Tract mode → adminLevel 'tracts'
  // [DIARY_FLAG] Route Safety Diary placeholder state (M1 prep, no behavior yet)
  diaryMode: false,        // Whether diary mode is active
  diaryFeatureOn,
  viewMode: panelPrefs.viewMode,
  diaryViewMode: panelPrefs.diaryViewMode || 'live', // 'live' | 'history' | 'community'
  diarySelectedHistoryRouteId: panelPrefs.diarySelectedHistoryRouteId || null,
  diaryCommunityRadiusMeters: panelPrefs.diaryCommunityRadiusMeters || 1500,
  selectedRouteId: panelPrefs.selectedRouteId,
  diaryAltEnabled: panelPrefs.diaryAltEnabled,
  simState: { ...panelPrefs.simState },
  simPlaybackSpeed: panelPrefs.simPlaybackSpeed || 1,
  diaryDemoPeriod: panelPrefs.diaryDemoPeriod || 'day',
  diaryTimeFilter: panelPrefs.diaryTimeFilter || 'all',
  userHash: null,          // Anonymous user hash (M2)
  myRoutes: [],            // Saved routes (M3)
  // Choropleth classification
  classMethod: 'quantile',
  classBins: 5,
  classPalette: 'Blues',
  classOpacity: 0.75,
  classCustomBreaks: [],
  getStartEnd() {
    if (this.startMonth && this.durationMonths) {
      const startD = dayjs(`${this.startMonth}-01`).startOf('month');
      const endD = startD.add(this.durationMonths, 'month').startOf('month');
      return { start: startD.format('YYYY-MM-DD'), end: endD.format('YYYY-MM-DD') };
    }
    throw new Error(this.coverageError || 'Crime coverage is unavailable; select a verified date range.');
  },
  getFilters() {
    const { start, end } = this.getStartEnd();
    const resolvedOffenseCodes = (this.selectedDrilldownCodes && this.selectedDrilldownCodes.length)
      ? this.selectedDrilldownCodes.slice()
      : ((this.selectedTypes && this.selectedTypes.length)
        ? this.selectedTypes.slice()
        : expandGroupsToCodes(this.selectedGroups || []));
    return {
      start,
      end,
      types: resolvedOffenseCodes,
      resolvedOffenseCodes,
      drilldownCodes: this.selectedDrilldownCodes || [],
      center3857: this.center3857,
      centerB3857: this.centerB3857,
      radiusM: this.radius,
      queryMode: this.queryMode,
      selectedDistrictCode: this.selectedDistrictCode,
      selectedTractGEOID: this.selectedTractGEOID,
      adminLevel: this.adminLevel,
      per10k: this.per10k,
      addressA: this.addressA,
      addressB: this.addressB,
    };
  },
  setCenterFromLngLat(lng, lat) {
    this.setComparisonPoint('A', lng, lat);
  },
  setComparisonPoint(target, lng, lat, label) {
    const R = 6378137;
    const x = R * (lng * Math.PI / 180);
    const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
    if (String(target).toUpperCase() === 'B') {
      this.centerB3857 = [x, y];
      this.centerBLonLat = [lng, lat];
      if (label) this.addressB = label;
    } else {
      this.center3857 = [x, y];
      this.centerLonLat = [lng, lat];
      if (label) this.addressA = label;
    }
  },
});

export function setAnalysisMode(mode) {
  const normalized = ['buffer', 'district', 'tract'].includes(mode) ? mode : 'buffer';
  store.queryMode = normalized;
  store.adminLevel = normalized === 'tract' ? 'tracts' : 'districts';
  if (normalized !== 'tract') store.per10k = false;
  if (normalized !== 'district') store.selectedDistrictCode = null;
  if (normalized !== 'tract') store.selectedTractGEOID = null;
  return normalized;
}

export function clearCrimeAnalysisSelection(state = store) {
  state.selectedDistrictCode = null;
  state.selectedTractGEOID = null;
  if (state.queryMode === 'buffer') {
    state.center3857 = null;
    state.centerLonLat = null;
    state.centerB3857 = null;
    state.centerBLonLat = null;
    state.addressA = '';
    state.addressB = '';
  }
  state.selectMode = 'idle';
  state.selectTarget = 'A';
  return state;
}

export function applyCoverageToState(state, { min, max }) {
  if (!max) throw new Error('Crime coverage is unavailable: maximum date is missing.');
  const maxDate = dayjs(max);
  if (!maxDate.isValid()) throw new Error(`Crime coverage is unavailable: invalid maximum date ${max}.`);
  const endMonth = maxDate.add(1, 'month').startOf('month');
  state.coverageMin = min || null;
  state.coverageMax = max;
  state.coverageStatus = 'ready';
  state.coverageError = null;
  state.coverageNotice = null;
  if (!state.startMonth) {
    state.durationMonths = 12;
  }
  normalizeCoverageWindow(state);
  return state.getStartEnd?.() ?? {
    start: `${state.startMonth}-01`,
    end: endMonth.format('YYYY-MM-DD'),
  };
}

export function normalizeCoverageWindow(state) {
  if (state.coverageStatus !== 'ready' || !state.coverageMax) return false;
  const duration = Number(state.durationMonths) || 12;
  const coverageEnd = dayjs(state.coverageMax).add(1, 'month').startOf('month');
  const coverageStart = state.coverageMin ? dayjs(state.coverageMin).startOf('month') : null;
  const selectedStart = state.startMonth ? dayjs(`${state.startMonth}-01`).startOf('month') : null;
  const selectedEnd = selectedStart?.isValid()
    ? selectedStart.add(duration, 'month').startOf('month')
    : null;
  const outsideCoverage = !selectedStart?.isValid()
    || !selectedEnd?.isValid()
    || selectedEnd.isAfter(coverageEnd)
    || (coverageStart?.isValid() && selectedStart.isBefore(coverageStart));
  if (!outsideCoverage) {
    state.coverageNotice = null;
    return false;
  }
  const latestStart = coverageEnd.subtract(duration, 'month');
  if (coverageStart?.isValid() && latestStart.isBefore(coverageStart)) {
    throw new Error(`Crime coverage is shorter than the selected ${duration}-month duration.`);
  }
  state.startMonth = latestStart.format('YYYY-MM');
  state.coverageNotice = `The requested date range was outside live coverage and was reset to the latest ${duration} months.`;
  return true;
}

export function applyCoverageFailure(state, error) {
  state.coverageStatus = 'error';
  state.coverageNotice = null;
  state.coverageError = `Crime coverage is unavailable: ${error?.message || error || 'unknown error'}`;
  return state.coverageError;
}

export function setViewMode(mode, { silent = false } = {}) {
  let normalized = mode === 'diary' ? 'diary' : 'crime';
  if (normalized === 'diary' && !diaryFeatureOn) {
    normalized = 'crime';
  }
  if (store.viewMode === normalized) {
    store.diaryMode = normalized === 'diary';
    return normalized;
  }
  store.viewMode = normalized;
  store.diaryMode = normalized === 'diary';
  panelPrefs.viewMode = normalized;
  persistPanelPrefs();
  if (!silent) {
    for (const listener of viewModeListeners) {
      try {
        listener(normalized);
      } catch (err) {
        console.warn('[store] viewMode listener failed:', err);
      }
    }
  }
  return normalized;
}

export function onViewModeChange(listener) {
  if (typeof listener !== 'function') return () => {};
  viewModeListeners.add(listener);
  return () => viewModeListeners.delete(listener);
}

export function setSelectedRouteId(routeId) {
  store.selectedRouteId = routeId || null;
  panelPrefs.selectedRouteId = store.selectedRouteId;
  persistPanelPrefs();
  for (const listener of diaryStateListeners) {
    try {
      listener('route', store.selectedRouteId);
    } catch (err) {
      console.warn('[store] diary route listener failed:', err);
    }
  }
}

export function setDiaryAltEnabled(enabled) {
  store.diaryAltEnabled = !!enabled;
  panelPrefs.diaryAltEnabled = store.diaryAltEnabled;
  persistPanelPrefs();
  for (const listener of diaryStateListeners) {
    try {
      listener('alt', store.diaryAltEnabled);
    } catch (err) {
      console.warn('[store] diary alt listener failed:', err);
    }
  }
}

export function onDiaryStateChange(listener) {
  if (typeof listener !== 'function') return () => {};
  diaryStateListeners.add(listener);
  return () => diaryStateListeners.delete(listener);
}

export function setDiaryViewMode(mode) {
  const allowed = ['live', 'history', 'community'];
  const next = allowed.includes(mode) ? mode : 'live';
  if (store.diaryViewMode === next) return;
  store.diaryViewMode = next;
  panelPrefs.diaryViewMode = next;
  persistPanelPrefs();
  if (typeof console !== 'undefined' && console.info) {
    console.info('[Diary] view mode', next);
  }
  for (const listener of diaryStateListeners) {
    try {
      listener('viewMode', next);
    } catch (err) {
      console.warn('[store] diary view mode listener failed:', err);
    }
  }
}

export function setDiarySelectedHistoryRouteId(id) {
  store.diarySelectedHistoryRouteId = id || null;
  panelPrefs.diarySelectedHistoryRouteId = store.diarySelectedHistoryRouteId;
  persistPanelPrefs();
  for (const listener of diaryStateListeners) {
    try {
      listener('historyRoute', store.diarySelectedHistoryRouteId);
    } catch (err) {
      console.warn('[store] diary history route listener failed:', err);
    }
  }
}

export function setDiaryCommunityRadiusMeters(radius) {
  const clamped = Math.min(3000, Math.max(500, Number(radius) || 1500));
  store.diaryCommunityRadiusMeters = clamped;
  panelPrefs.diaryCommunityRadiusMeters = clamped;
  persistPanelPrefs();
  if (typeof console !== 'undefined' && console.info) {
    console.info('[Diary] community radius', clamped, 'm');
  }
  for (const listener of diaryStateListeners) {
    try {
      listener('communityRadius', clamped);
    } catch (err) {
      console.warn('[store] diary community radius listener failed:', err);
    }
  }
}

export function setSimPlaybackSpeed(speed) {
  const allowed = [0.5, 1, 2];
  const next = allowed.includes(Number(speed)) ? Number(speed) : 1;
  store.simPlaybackSpeed = next;
  panelPrefs.simPlaybackSpeed = next;
  persistPanelPrefs();
  if (typeof console !== 'undefined' && console.info) {
    console.info('[Diary] playback speed', next);
  }
  for (const listener of diaryStateListeners) {
    try {
      listener('playback', next);
    } catch (err) {
      console.warn('[store] diary playback listener failed:', err);
    }
  }
}

export function setDiaryDemoPeriod(period) {
  const allowed = ['day', 'week', 'month'];
  const next = allowed.includes(period) ? period : 'day';
  store.diaryDemoPeriod = next;
  panelPrefs.diaryDemoPeriod = next;
  persistPanelPrefs();
  if (typeof console !== 'undefined' && console.info) {
    console.info('[Diary] demo period', next);
  }
  for (const listener of diaryStateListeners) {
    try {
      listener('demoPeriod', next);
    } catch (err) {
      console.warn('[store] diary demo period listener failed:', err);
    }
  }
}

export function setDiaryTimeFilter(filter) {
  const allowed = ['all', 'day', 'evening', 'night'];
  const next = allowed.includes(filter) ? filter : 'all';
  store.diaryTimeFilter = next;
  panelPrefs.diaryTimeFilter = next;
  persistPanelPrefs();
  if (typeof console !== 'undefined' && console.info) {
    console.info('[Diary] time filter', next);
  }
  for (const listener of diaryStateListeners) {
    try {
      listener('timeFilter', next);
    } catch (err) {
      console.warn('[store] diary time filter listener failed:', err);
    }
  }
}

export function setSimPanelState(partial = {}) {
  panelPrefs.simState = { ...panelPrefs.simState, ...partial };
  store.simState = { ...panelPrefs.simState };
  persistPanelPrefs();
}

/**
 * Probe coverage and set default window to last 12 months ending at coverage max.
 */
export async function initCoverageAndDefaults({ fetchCoverageImpl = fetchCoverage } = {}) {
  try {
    const coverage = await fetchCoverageImpl();
    applyCoverageToState(store, coverage);
    return coverage;
  } catch (e) {
    applyCoverageFailure(store, e);
    throw e;
  }
}
