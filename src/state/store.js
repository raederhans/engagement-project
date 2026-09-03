/**
 * Public shared-state facade. Internal domain ownership lives in focused modules;
 * existing imports continue to use this file.
 */
import { fetchCoverage } from '../api/meta.js';
import {
  applyCrimeCoverage,
  applyCrimeCoverageFailure,
  clearCrimeSelection,
  createCrimeQueryState,
  normalizeCrimeCoverageWindow,
  setCrimeAnalysisMode,
} from './crime_query_state.js';
import { createPanelSessionState } from './panel_session_state.js';
import { createAppModeState, resolveDiaryFeatureOn } from './app_mode_state.js';
import {
  createDiaryPreferences,
  createDiaryPreferenceState,
} from './diary_preferences_state.js';

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

const panelSession = createPanelSessionState();
const panelSnapshot = panelSession.getSnapshot();
const diaryFeatureOn = resolveDiaryFeatureOn();

export const store = /** @type {Store} */ ({
  ...createCrimeQueryState(),
  diaryMode: false,
  diaryFeatureOn,
  ...createDiaryPreferenceState(panelSnapshot),
  userHash: null,
  myRoutes: [],
});

const appMode = createAppModeState({
  store,
  preferences: panelSession,
  diaryFeatureOn,
});
const diaryPreferences = createDiaryPreferences({
  store,
  preferences: panelSession,
});

export function setAnalysisMode(mode) {
  return setCrimeAnalysisMode(store, mode);
}

export function clearCrimeAnalysisSelection(state = store) {
  return clearCrimeSelection(state);
}

export function applyCoverageToState(state, coverage) {
  return applyCrimeCoverage(state, coverage);
}

export function normalizeCoverageWindow(state) {
  return normalizeCrimeCoverageWindow(state);
}

export function applyCoverageFailure(state, error) {
  return applyCrimeCoverageFailure(state, error);
}

export function setViewMode(mode, options) {
  return appMode.setViewMode(mode, options);
}

export function onViewModeChange(listener) {
  return appMode.onViewModeChange(listener);
}

export function setSelectedRouteId(routeId) {
  return diaryPreferences.setSelectedRouteId(routeId);
}

export function setDiaryAltEnabled(enabled) {
  return diaryPreferences.setDiaryAltEnabled(enabled);
}

export function onDiaryStateChange(listener) {
  return diaryPreferences.onDiaryStateChange(listener);
}

export function setDiaryViewMode(mode) {
  return diaryPreferences.setDiaryViewMode(mode);
}

export function setDiarySelectedHistoryRouteId(id) {
  return diaryPreferences.setDiarySelectedHistoryRouteId(id);
}

export function setDiaryCommunityRadiusMeters(radius) {
  return diaryPreferences.setDiaryCommunityRadiusMeters(radius);
}

export function setSimPlaybackSpeed(speed) {
  return diaryPreferences.setSimPlaybackSpeed(speed);
}

export function setDiaryDemoPeriod(period) {
  return diaryPreferences.setDiaryDemoPeriod(period);
}

export function setDiaryTimeFilter(filter) {
  return diaryPreferences.setDiaryTimeFilter(filter);
}

export function setSimPanelState(partial = {}) {
  return diaryPreferences.setSimPanelState(partial);
}

/**
 * Probe coverage and set default window to last 12 months ending at coverage max.
 */
export async function initCoverageAndDefaults({ fetchCoverageImpl = fetchCoverage } = {}) {
  try {
    const coverage = await fetchCoverageImpl();
    applyCoverageToState(store, coverage);
    return coverage;
  } catch (error) {
    applyCoverageFailure(store, error);
    throw error;
  }
}
