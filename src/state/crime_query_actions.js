import { expandGroupsToCodes } from '../utils/types.js';
import { decodeCrimeViewState, encodeCrimeViewState } from './crime_view_state.js';

export const CRIME_QUERY_ACTIONS = Object.freeze({
  SET_MODE: 'crime.query.set-mode',
  SET_TIME_WINDOW: 'crime.query.set-time-window',
  SET_RADIUS: 'crime.query.set-radius',
  SET_OFFENSE_GROUPS: 'crime.query.set-offense-groups',
  SET_OFFENSE_HIGHLIGHTS: 'crime.query.set-offense-highlights',
  SET_RATE: 'crime.query.set-rate',
  SET_TRACT_OVERLAY: 'crime.query.set-tract-overlay',
  SET_CLASSIFICATION: 'crime.query.set-classification',
  CLEAR_COMPARISON: 'crime.query.clear-comparison',
  CLEAR_SELECTION: 'crime.query.clear-selection',
  BEGIN_MAP_SELECTION: 'crime.map.begin-selection',
});

const CRIME_QUERY_ACTION_SET = new Set(Object.values(CRIME_QUERY_ACTIONS));

export function isCrimeQueryAction(action) {
  return CRIME_QUERY_ACTION_SET.has(action);
}

function assignCanonicalQueryFields(target, patch, fields) {
  const canonical = decodeCrimeViewState(encodeCrimeViewState({ ...target, ...patch }));
  for (const field of fields) target[field] = canonical[field];
  return target;
}

export function mutateCrimeQueryState(target, action, payload, options = {}) {
  switch (action) {
    case CRIME_QUERY_ACTIONS.SET_MODE: {
      const canonical = decodeCrimeViewState(encodeCrimeViewState({
        ...target,
        queryMode: payload?.mode,
      }));
      if (options.setMode) options.setMode(canonical.queryMode);
      else target.queryMode = canonical.queryMode;
      if (canonical.queryMode !== 'buffer') target.selectMode = 'idle';
      return target;
    }
    case CRIME_QUERY_ACTIONS.SET_TIME_WINDOW: {
      const nextWindow = payload || {};
      assignCanonicalQueryFields(target, {
        startMonth: Object.hasOwn(nextWindow, 'startMonth')
          ? nextWindow.startMonth
          : target.startMonth,
        durationMonths: Object.hasOwn(nextWindow, 'durationMonths')
          ? nextWindow.durationMonths
          : target.durationMonths,
      }, ['startMonth', 'durationMonths']);
      options.normalizeCoverage?.(target);
      return target;
    }
    case CRIME_QUERY_ACTIONS.SET_RADIUS:
      return assignCanonicalQueryFields(target, { radius: payload?.radius }, ['radius']);
    case CRIME_QUERY_ACTIONS.SET_OFFENSE_GROUPS:
      assignCanonicalQueryFields(target, { selectedGroups: payload?.groups }, ['selectedGroups']);
      target.selectedTypes = expandGroupsToCodes(target.selectedGroups);
      if (payload?.resetHighlights) target.selectedDrilldownCodes = [];
      return target;
    case CRIME_QUERY_ACTIONS.SET_OFFENSE_HIGHLIGHTS:
      return assignCanonicalQueryFields(
        target,
        { selectedDrilldownCodes: payload?.codes },
        ['selectedDrilldownCodes'],
      );
    case CRIME_QUERY_ACTIONS.SET_RATE:
      return assignCanonicalQueryFields(target, { per10k: payload?.per10k }, ['per10k']);
    case CRIME_QUERY_ACTIONS.SET_TRACT_OVERLAY:
      return assignCanonicalQueryFields(
        target,
        { overlayTractsLines: payload?.visible },
        ['overlayTractsLines'],
      );
    case CRIME_QUERY_ACTIONS.SET_CLASSIFICATION:
      return assignCanonicalQueryFields(target, payload, [
        'classMethod',
        'classBins',
        'classPalette',
        'classOpacity',
        'classCustomBreaks',
      ]);
    case CRIME_QUERY_ACTIONS.CLEAR_COMPARISON: {
      const selectedTarget = payload?.target === 'A' ? 'A' : 'B';
      if (selectedTarget === 'A') {
        target.centerLonLat = null;
        target.center3857 = null;
        target.addressA = '';
      } else {
        target.centerBLonLat = null;
        target.centerB3857 = null;
        target.addressB = '';
      }
      if (target.selectTarget === selectedTarget) target.selectMode = 'idle';
      return target;
    }
    case CRIME_QUERY_ACTIONS.CLEAR_SELECTION:
      if (!options.clearSelection) {
        throw new TypeError('Crime state port requires a clear-selection owner.');
      }
      return options.clearSelection(target);
    case CRIME_QUERY_ACTIONS.BEGIN_MAP_SELECTION:
      target.selectMode = 'point';
      target.selectTarget = payload?.target === 'B' ? 'B' : 'A';
      return target;
    default:
      throw new TypeError(`Unknown Crime query action: ${action}`);
  }
}
