export const PANEL_STATE_KEY = 'diary_panel_state';

export const DEFAULT_PANEL_SESSION_STATE = Object.freeze({
  viewMode: 'crime',
  selectedRouteId: null,
  diaryAltEnabled: false,
  diaryViewMode: 'live',
  diarySelectedHistoryRouteId: null,
  diaryCommunityRadiusMeters: 1500,
  simState: Object.freeze({ playing: false, progress: 0, routeId: null }),
  simPlaybackSpeed: 1,
  diaryDemoPeriod: 'day',
  diaryTimeFilter: 'all',
});

function defaultSnapshot() {
  return {
    ...DEFAULT_PANEL_SESSION_STATE,
    simState: { ...DEFAULT_PANEL_SESSION_STATE.simState },
  };
}

export function createPanelSessionState({ windowRef = globalThis.window } = {}) {
  const load = () => {
    const defaults = defaultSnapshot();
    if (!windowRef?.sessionStorage) return defaults;
    try {
      const raw = windowRef.sessionStorage.getItem(PANEL_STATE_KEY);
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
  };

  let snapshot = load();

  const persist = () => {
    if (!windowRef?.sessionStorage) return;
    try {
      windowRef.sessionStorage.setItem(PANEL_STATE_KEY, JSON.stringify(snapshot));
    } catch {}
  };

  return {
    getSnapshot() {
      return { ...snapshot, simState: { ...snapshot.simState } };
    },
    update(partial = {}) {
      snapshot = {
        ...snapshot,
        ...partial,
        ...(partial.simState
          ? { simState: { ...snapshot.simState, ...partial.simState } }
          : {}),
      };
      persist();
      return this.getSnapshot();
    },
  };
}
