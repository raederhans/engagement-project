import {
  CRIME_STATE_ACTIONS,
  decodeCrimeViewState,
  encodeCrimeViewState,
  mutateCrimeViewState,
} from './crime_view_state.js';

export { CRIME_STATE_ACTIONS } from './crime_view_state.js';

/**
 * Query state is the only state this port owns. Result/runtime state belongs to
 * the Crime refresh owner, Diary session preferences belong to store.js,
 * private Diary/history records belong to their IndexedDB repositories, and
 * MapLibre objects remain owned by route/map controllers.
 */
export function createCrimeStatePort({ state, setMode } = {}) {
  if (!state) throw new TypeError('Crime state port requires a state target.');
  return Object.freeze({
    readSnapshot() {
      return decodeCrimeViewState(encodeCrimeViewState(state));
    },
    mutate(action, payload) {
      return mutateCrimeViewState(state, action, payload, { setMode });
    },
  });
}
