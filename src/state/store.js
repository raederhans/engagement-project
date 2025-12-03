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
 per10k: false,
  mapBbox: null,
  center3857: null,
  coverageMin: null,
  coverageMax: null,
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
      const endD = startD.add(this.durationMonths, 'month').endOf('month');
      return { start: startD.format('YYYY-MM-DD'), end: endD.format('YYYY-MM-DD') };
    }
    const end = dayjs().format('YYYY-MM-DD');
    const start = dayjs().subtract(this.timeWindowMonths || 6, 'month').format('YYYY-MM-DD');
    return { start, end };
  },
  getFilters() {
    const { start, end } = this.getStartEnd();
    const types = (this.selectedTypes && this.selectedTypes.length)
      ? this.selectedTypes.slice()
      : expandGroupsToCodes(this.selectedGroups || []);
    return {
      start,
      end,
      types,
      drilldownCodes: this.selectedDrilldownCodes || [],
      center3857: this.center3857,
      radiusM: this.radius,
      queryMode: this.queryMode,
      selectedDistrictCode: this.selectedDistrictCode,
      selectedTractGEOID: this.selectedTractGEOID,
    };
  },
  setCenterFromLngLat(lng, lat) {
    const R = 6378137;
    const x = R * (lng * Math.PI / 180);
    const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
    this.center3857 = [x, y];
    this.centerLonLat = [lng, lat];
  },
});

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
export async function initCoverageAndDefaults() {
  try {
    const { min, max } = await fetchCoverage();
    store.coverageMin = min;
    store.coverageMax = max;
    if (!store.startMonth && max) {
      const maxDate = new Date(max);
      const endMonth = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);
      const startMonth = new Date(endMonth.getFullYear(), endMonth.getMonth() - 12, 1);
      store.startMonth = `${startMonth.getFullYear()}-${String(startMonth.getMonth() + 1).padStart(2, '0')}`;
      store.durationMonths = 12;
    }
  } catch (e) {
    // leave defaults; fallback handled in README known issues
  }
}
