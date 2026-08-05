import { normalizeHighlightedOffenses } from '../utils/types.js';

const MODES = new Set(['buffer', 'district', 'tract']);
const CLASS_METHODS = new Set(['quantile', 'equal', 'custom']);
const CLASS_PALETTES = new Set(['Blues', 'YlGnBu', 'OrRd', 'PuBuGn', 'Greens', 'Purples', 'BuGn', 'BuPu', 'GnBu', 'YlOrRd', 'RdBu']);
const DURATION_OPTIONS = new Set([3, 6, 12, 24]);
const RADIUS_MIN = 100;
const RADIUS_MAX = 10_000;
const CRIME_REFRESH_SCOPES = Object.freeze(['boundary', 'incidents', 'charts', 'summary']);
const CRIME_REFRESH_SCOPE_SET = new Set(['all', ...CRIME_REFRESH_SCOPES]);
export const CRIME_VIEW_QUERY_KEYS = new Set([
  'analysis', 'start', 'months', 'radius', 'groups', 'codes', 'district', 'tract',
  'tractLines', 'a', 'b', 'labelA', 'labelB', 'rate', 'class', 'bins', 'palette',
  'opacity', 'breaks',
]);

export function hasActiveIncidentSelection(state) {
  return state?.queryMode === 'buffer'
    ? Array.isArray(state.centerLonLat) && state.centerLonLat.length >= 2
    : state?.queryMode === 'tract' && /^\d{11}$/.test(state.selectedTractGEOID || '');
}

export function crimeSelectionKey(state) {
  if (state?.queryMode === 'district' && state.selectedDistrictCode) {
    return `district:${String(state.selectedDistrictCode).padStart(2, '0')}`;
  }
  if (state?.queryMode === 'tract' && state.selectedTractGEOID) {
    return `tract:${state.selectedTractGEOID}`;
  }
  if (!hasActiveIncidentSelection(state)) return null;
  const centerB = Array.isArray(state.centerBLonLat) ? `|${state.centerBLonLat.join(',')}` : '';
  return `buffer:${state.centerLonLat.join(',')}${centerB}|${Number(state.radiusM ?? state.radius) || 400}`;
}

export function normalizeCrimeRefreshScope(scope = 'all') {
  return CRIME_REFRESH_SCOPE_SET.has(scope) ? scope : null;
}

export function planCrimeRefresh(snapshot, scope = 'all') {
  const normalizedScope = normalizeCrimeRefreshScope(scope);
  if (!normalizedScope) return { valid: false, requested: [], inactive: [] };
  const candidates = normalizedScope === 'all' ? CRIME_REFRESH_SCOPES : [normalizedScope];
  const hasAnalysisSelection = Boolean(crimeSelectionKey(snapshot));
  const requested = candidates.filter((name) => (
    name === 'boundary'
    || (name === 'incidents' ? hasActiveIncidentSelection(snapshot) : hasAnalysisSelection)
  ));
  return {
    valid: true,
    requested,
    inactive: candidates.filter((name) => !requested.includes(name)),
  };
}

export function resolveCrimePrimaryLayer(state) {
  if (state?.queryMode === 'district') return 'districts';
  if (state?.queryMode === 'tract') return 'tracts';
  return 'incidents';
}

export function resolveCrimeLayerVisibility(layerId, state) {
  const primaryLayer = resolveCrimePrimaryLayer(state);
  if (layerId === 'tracts-outline-line') return state?.overlayTractsLines ? 'visible' : 'none';
  if (layerId === 'tracts-fill' || layerId.startsWith('tracts-selected-')) {
    return primaryLayer === 'tracts' ? 'visible' : 'none';
  }
  if (layerId.startsWith('districts-')) return primaryLayer === 'districts' ? 'visible' : 'none';
  if (layerId === 'clusters' || layerId === 'cluster-count' || layerId === 'unclustered') {
    return primaryLayer === 'incidents' && hasActiveIncidentSelection(state) ? 'visible' : 'none';
  }
  if (layerId.startsWith('buffer-a-')) {
    return state?.queryMode === 'buffer' && state?.centerLonLat ? 'visible' : 'none';
  }
  if (layerId.startsWith('buffer-b-')) {
    return state?.queryMode === 'buffer' && state?.centerBLonLat ? 'visible' : 'none';
  }
  return 'visible';
}

function finiteNumber(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function point(value) {
  if (!value) return null;
  const parts = Array.isArray(value) ? value : String(value).split(',');
  if (parts.length !== 2) return null;
  const lng = finiteNumber(parts[0]);
  const lat = finiteNumber(parts[1]);
  if (lng == null || lat == null || lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return [lng, lat];
}

function list(value) {
  if (!value) return [];
  return String(value).split('|').slice(0, 32).map((item) => item.trim().slice(0, 120)).filter(Boolean);
}

function numericList(value) {
  return list(value).slice(0, 8).map(Number).filter((number) => Number.isFinite(number) && Math.abs(number) <= 1_000_000_000);
}

function optionNumber(value, options, fallback) {
  const number = finiteNumber(value, fallback);
  return options.has(number) ? number : fallback;
}

function boundedInteger(value, fallback, min, max) {
  const number = finiteNumber(value, fallback);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function boundedNumber(value, fallback, min, max) {
  const number = finiteNumber(value, fallback);
  return number >= min && number <= max ? number : fallback;
}

function label(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 160) : null;
}

export function hasCrimeViewState(value) {
  const params = value instanceof URLSearchParams ? value : new URLSearchParams(String(value || '').replace(/^\?/, ''));
  return [...CRIME_VIEW_QUERY_KEYS].some((key) => params.has(key));
}

export function encodeCrimeViewState(state) {
  const params = new URLSearchParams();
  params.set('analysis', MODES.has(state.queryMode) ? state.queryMode : 'buffer');
  if (state.startMonth) params.set('start', state.startMonth);
  params.set('months', String(optionNumber(state.durationMonths, DURATION_OPTIONS, 12)));
  params.set('radius', String(boundedInteger(state.radius, 400, RADIUS_MIN, RADIUS_MAX)));
  if (state.selectedGroups?.length) params.set('groups', state.selectedGroups.join('|'));
  const highlightedOffenses = normalizeHighlightedOffenses(state.selectedDrilldownCodes);
  if (highlightedOffenses.length) params.set('codes', highlightedOffenses.join('|'));
  if (state.selectedDistrictCode) params.set('district', state.selectedDistrictCode);
  if (state.selectedTractGEOID) params.set('tract', state.selectedTractGEOID);
  if (state.overlayTractsLines) params.set('tractLines', '1');
  if (point(state.centerLonLat)) params.set('a', point(state.centerLonLat).join(','));
  if (point(state.centerBLonLat)) params.set('b', point(state.centerBLonLat).join(','));
  if (state.addressA) params.set('labelA', state.addressA);
  if (state.addressB) params.set('labelB', state.addressB);
  if (state.per10k) params.set('rate', 'per10k');
  params.set('class', CLASS_METHODS.has(state.classMethod) ? state.classMethod : 'quantile');
  params.set('bins', String(boundedInteger(state.classBins, 5, 2, 9)));
  params.set('palette', CLASS_PALETTES.has(state.classPalette) ? state.classPalette : 'Blues');
  params.set('opacity', String(boundedNumber(state.classOpacity, 0.75, 0.1, 1)));
  if (state.classCustomBreaks?.length) params.set('breaks', state.classCustomBreaks.join('|'));
  return params.toString();
}

export function decodeCrimeViewState(value) {
  const params = value instanceof URLSearchParams ? value : new URLSearchParams(String(value || '').replace(/^\?/, ''));
  const queryMode = MODES.has(params.get('analysis')) ? params.get('analysis') : 'buffer';
  const startMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('start') || '') ? params.get('start') : null;
  return {
    queryMode,
    startMonth,
    durationMonths: optionNumber(params.get('months'), DURATION_OPTIONS, 12),
    radius: boundedInteger(params.get('radius'), 400, RADIUS_MIN, RADIUS_MAX),
    selectedGroups: list(params.get('groups')),
    selectedDrilldownCodes: normalizeHighlightedOffenses(list(params.get('codes'))),
    selectedDistrictCode: queryMode === 'district' && /^\d{2}$/.test(params.get('district') || '') ? params.get('district') : null,
    selectedTractGEOID: queryMode === 'tract' && /^\d{11}$/.test(params.get('tract') || '') ? params.get('tract') : null,
    overlayTractsLines: params.get('tractLines') === '1',
    centerLonLat: point(params.get('a')),
    centerBLonLat: point(params.get('b')),
    addressA: label(params.get('labelA')),
    addressB: label(params.get('labelB')),
    per10k: queryMode === 'tract' && params.get('rate') === 'per10k',
    classMethod: CLASS_METHODS.has(params.get('class')) ? params.get('class') : 'quantile',
    classBins: boundedInteger(params.get('bins'), 5, 2, 9),
    classPalette: CLASS_PALETTES.has(params.get('palette')) ? params.get('palette') : 'Blues',
    classOpacity: boundedNumber(params.get('opacity'), 0.75, 0.1, 1),
    classCustomBreaks: numericList(params.get('breaks')),
  };
}

export function applyCrimeViewState(target, decoded, { setMode } = {}) {
  if (!decoded) return target;
  Object.assign(target, decoded);
  setMode?.(decoded.queryMode);
  if (decoded.centerLonLat) target.setComparisonPoint?.('A', ...decoded.centerLonLat, decoded.addressA);
  if (decoded.centerBLonLat) target.setComparisonPoint?.('B', ...decoded.centerBLonLat, decoded.addressB);
  return target;
}

export function replaceCrimeViewState(target, decoded, { setMode } = {}) {
  const canonical = decodeCrimeViewState(encodeCrimeViewState(decoded || {}));
  Object.assign(target, {
    centerLonLat: null,
    center3857: null,
    centerBLonLat: null,
    centerB3857: null,
    addressA: null,
    addressB: null,
    selectedTypes: [],
    selectedGroups: [],
    selectedDrilldownCodes: [],
    selectedDistrictCode: null,
    selectedTractGEOID: null,
    selectMode: 'idle',
    selectTarget: 'A',
  });
  Object.assign(target, canonical);
  setMode?.(canonical.queryMode);
  if (canonical.centerLonLat) {
    target.setComparisonPoint?.('A', ...canonical.centerLonLat, canonical.addressA);
  }
  if (canonical.centerBLonLat) {
    target.setComparisonPoint?.('B', ...canonical.centerBLonLat, canonical.addressB);
  }
  return target;
}
