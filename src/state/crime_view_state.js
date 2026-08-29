import { normalizeHighlightedOffenses } from '../utils/types.js';

const MODES = new Set(['buffer', 'district', 'tract']);
const CLASS_METHODS = new Set(['quantile', 'equal', 'custom']);
const CLASS_PALETTES = new Set(['Blues', 'YlGnBu', 'OrRd', 'PuBuGn', 'Greens', 'Purples', 'BuGn', 'BuPu', 'GnBu', 'YlOrRd', 'RdBu']);
const DURATION_OPTIONS = new Set([3, 6, 12, 24]);
const RADIUS_MIN = 100;
const RADIUS_MAX = 10_000;
const CRIME_REFRESH_SCOPES = Object.freeze(['boundary', 'incidents', 'charts', 'summary']);
const CRIME_REFRESH_SCOPE_SET = new Set(['all', ...CRIME_REFRESH_SCOPES]);
export const CRIME_STATE_ACTIONS = Object.freeze({
  RESTORE_URL: 'crime.url.restore',
  REPLACE_PRESET: 'crime.preset.replace',
  RESTORE_HISTORY: 'crime.history.restore',
  SELECT_TRACT: 'crime.map.select-tract',
  SELECT_DISTRICT: 'crime.map.select-district',
  SELECT_POINT: 'crime.map.select-point',
  END_MAP_SELECTION: 'crime.map.end-selection',
});
export const CRIME_VIEW_QUERY_KEYS = new Set([
  'analysis', 'start', 'months', 'radius', 'groups', 'codes', 'district', 'tract',
  'tractLines', 'a', 'b', 'labelA', 'labelB', 'rate', 'class', 'bins', 'palette',
  'opacity', 'breaks',
]);
export const PRIVATE_CRIME_VIEW_QUERY_KEYS = new Set(['a', 'b', 'labelA', 'labelB']);

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

function canonicalPublicFields(state = {}) {
  const queryMode = MODES.has(state.queryMode) ? state.queryMode : 'buffer';
  const startMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(state.startMonth || '')
    ? state.startMonth
    : null;
  return {
    queryMode,
    startMonth,
    durationMonths: optionNumber(state.durationMonths, DURATION_OPTIONS, 12),
    radius: boundedInteger(state.radius, 400, RADIUS_MIN, RADIUS_MAX),
    selectedGroups: list(Array.isArray(state.selectedGroups) ? state.selectedGroups.join('|') : state.selectedGroups),
    selectedDrilldownCodes: normalizeHighlightedOffenses(state.selectedDrilldownCodes || []),
    selectedDistrictCode: queryMode === 'district' && /^\d{2}$/.test(state.selectedDistrictCode || '')
      ? state.selectedDistrictCode
      : null,
    selectedTractGEOID: queryMode === 'tract' && /^\d{11}$/.test(state.selectedTractGEOID || '')
      ? state.selectedTractGEOID
      : null,
    overlayTractsLines: Boolean(state.overlayTractsLines),
    per10k: queryMode === 'tract' && Boolean(state.per10k),
    classMethod: CLASS_METHODS.has(state.classMethod) ? state.classMethod : 'quantile',
    classBins: boundedInteger(state.classBins, 5, 2, 9),
    classPalette: CLASS_PALETTES.has(state.classPalette) ? state.classPalette : 'Blues',
    classOpacity: boundedNumber(state.classOpacity, 0.75, 0.1, 1),
    classCustomBreaks: numericList(
      Array.isArray(state.classCustomBreaks) ? state.classCustomBreaks.join('|') : state.classCustomBreaks,
    ),
  };
}

export function projectCrimeViewStateForPublic(state = {}) {
  return canonicalPublicFields(state);
}

export function canonicalizeCrimeRuntimeState(state = {}) {
  return {
    ...canonicalPublicFields(state),
    centerLonLat: point(state.centerLonLat),
    centerBLonLat: point(state.centerBLonLat),
    addressA: label(state.addressA),
    addressB: label(state.addressB),
  };
}

export function hasCrimeViewState(value) {
  const params = value instanceof URLSearchParams ? value : new URLSearchParams(String(value || '').replace(/^\?/, ''));
  return [...CRIME_VIEW_QUERY_KEYS].some((key) => params.has(key));
}

export function encodeCrimeViewState(state) {
  const publicState = projectCrimeViewStateForPublic(state);
  const params = new URLSearchParams();
  params.set('analysis', publicState.queryMode);
  if (publicState.startMonth) params.set('start', publicState.startMonth);
  params.set('months', String(publicState.durationMonths));
  params.set('radius', String(publicState.radius));
  if (publicState.selectedGroups.length) params.set('groups', publicState.selectedGroups.join('|'));
  const highlightedOffenses = publicState.selectedDrilldownCodes;
  if (highlightedOffenses.length) params.set('codes', highlightedOffenses.join('|'));
  if (publicState.selectedDistrictCode) params.set('district', publicState.selectedDistrictCode);
  if (publicState.selectedTractGEOID) params.set('tract', publicState.selectedTractGEOID);
  if (publicState.overlayTractsLines) params.set('tractLines', '1');
  if (publicState.per10k) params.set('rate', 'per10k');
  params.set('class', publicState.classMethod);
  params.set('bins', String(publicState.classBins));
  params.set('palette', publicState.classPalette);
  params.set('opacity', String(publicState.classOpacity));
  if (publicState.classCustomBreaks.length) params.set('breaks', publicState.classCustomBreaks.join('|'));
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
    centerLonLat: null,
    centerBLonLat: null,
    addressA: null,
    addressB: null,
    per10k: queryMode === 'tract' && params.get('rate') === 'per10k',
    classMethod: CLASS_METHODS.has(params.get('class')) ? params.get('class') : 'quantile',
    classBins: boundedInteger(params.get('bins'), 5, 2, 9),
    classPalette: CLASS_PALETTES.has(params.get('palette')) ? params.get('palette') : 'Blues',
    classOpacity: boundedNumber(params.get('opacity'), 0.75, 0.1, 1),
    classCustomBreaks: numericList(params.get('breaks')),
  };
}

function applyDecodedCrimeViewState(target, decoded, { setMode } = {}) {
  if (!decoded) return target;
  Object.assign(target, decoded);
  setMode?.(decoded.queryMode);
  if (decoded.centerLonLat) target.setComparisonPoint?.('A', ...decoded.centerLonLat, decoded.addressA);
  if (decoded.centerBLonLat) target.setComparisonPoint?.('B', ...decoded.centerBLonLat, decoded.addressB);
  return target;
}

function replaceDecodedCrimeViewState(target, decoded, { setMode } = {}) {
  const canonical = projectCrimeViewStateForPublic(decoded || {});
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

function replacePresetCrimeViewState(target, decoded, { setMode } = {}) {
  const canonical = canonicalizeCrimeRuntimeState({ ...target, ...(decoded || {}) });
  Object.assign(target, {
    selectedTypes: [],
    selectMode: 'idle',
    selectTarget: 'A',
  });
  if (Object.hasOwn(decoded || {}, 'centerLonLat')) target.center3857 = null;
  if (Object.hasOwn(decoded || {}, 'centerBLonLat')) target.centerB3857 = null;
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

export function mutateCrimeViewState(target, action, payload, options = {}) {
  switch (action) {
    case CRIME_STATE_ACTIONS.RESTORE_URL:
      return applyDecodedCrimeViewState(
        target,
        typeof payload === 'string' || payload instanceof URLSearchParams
          ? decodeCrimeViewState(payload)
          : payload,
        options,
      );
    case CRIME_STATE_ACTIONS.REPLACE_PRESET:
      return replacePresetCrimeViewState(target, payload, options);
    case CRIME_STATE_ACTIONS.RESTORE_HISTORY:
      return replaceDecodedCrimeViewState(target, payload, options);
    case CRIME_STATE_ACTIONS.SELECT_TRACT:
      target.selectedTractGEOID = payload?.geoid || null;
      return target;
    case CRIME_STATE_ACTIONS.SELECT_DISTRICT:
      target.selectedDistrictCode = payload?.code || null;
      return target;
    case CRIME_STATE_ACTIONS.SELECT_POINT: {
      const selectedTarget = payload?.target === 'B' ? 'B' : 'A';
      target.setComparisonPoint?.(
        selectedTarget,
        payload?.lng,
        payload?.lat,
        payload?.label,
      );
      return target;
    }
    case CRIME_STATE_ACTIONS.END_MAP_SELECTION:
      target.selectMode = 'idle';
      return target;
    default:
      throw new TypeError(`Unknown Crime state action: ${action}`);
  }
}

export function applyCrimeViewState(target, decoded, { setMode } = {}) {
  return mutateCrimeViewState(
    target,
    CRIME_STATE_ACTIONS.RESTORE_URL,
    decoded,
    { setMode },
  );
}

export function replaceCrimeViewState(target, decoded, { setMode } = {}) {
  return mutateCrimeViewState(
    target,
    CRIME_STATE_ACTIONS.REPLACE_PRESET,
    decoded,
    { setMode },
  );
}
