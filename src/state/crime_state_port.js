import {
  CRIME_STATE_ACTIONS as CRIME_VIEW_STATE_ACTIONS,
  decodeCrimeViewState,
  encodeCrimeViewState,
  mutateCrimeViewState,
} from './crime_view_state.js';
import {
  CRIME_QUERY_ACTIONS,
  isCrimeQueryAction,
  mutateCrimeQueryState,
} from './crime_query_actions.js';

export const CRIME_STATE_ACTIONS = Object.freeze({
  ...CRIME_VIEW_STATE_ACTIONS,
  ...CRIME_QUERY_ACTIONS,
});

/**
 * Query state is the only state this port owns. Result/runtime state belongs to
 * the Crime refresh owner, Diary session preferences belong to store.js,
 * private Diary/history records belong to their IndexedDB repositories, and
 * MapLibre objects remain owned by route/map controllers.
 */
export function createCrimeStatePort({
  state,
  setMode,
  normalizeCoverage,
  clearSelection,
} = {}) {
  if (!state) throw new TypeError('Crime state port requires a state target.');
  return Object.freeze({
    readSnapshot() {
      return decodeCrimeViewState(encodeCrimeViewState(state));
    },
    mutate(action, payload) {
      const options = { setMode, normalizeCoverage, clearSelection };
      return isCrimeQueryAction(action)
        ? mutateCrimeQueryState(state, action, payload, options)
        : mutateCrimeViewState(state, action, payload, options);
    },
  });
}
