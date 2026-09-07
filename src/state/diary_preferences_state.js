export function createDiaryPreferenceState(snapshot) {
  return {
    viewMode: snapshot.viewMode,
    diaryViewMode: snapshot.diaryViewMode || 'live',
    diarySelectedHistoryRouteId: snapshot.diarySelectedHistoryRouteId || null,
    diaryCommunityRadiusMeters: snapshot.diaryCommunityRadiusMeters || 1500,
    selectedRouteId: snapshot.selectedRouteId,
    diaryAltEnabled: snapshot.diaryAltEnabled,
    simState: { ...snapshot.simState },
    simPlaybackSpeed: snapshot.simPlaybackSpeed || 1,
    diaryDemoPeriod: snapshot.diaryDemoPeriod || 'day',
    diaryTimeFilter: snapshot.diaryTimeFilter || 'all',
  };
}

export function createDiaryPreferences({ store, preferences }) {
  const listeners = new Set();
  const notify = (kind, value, warningLabel) => {
    for (const listener of listeners) {
      try {
        listener(kind, value);
      } catch (error) {
        console.warn(`[store] ${warningLabel} listener failed:`, error);
      }
    }
  };
  const update = (partial) => preferences.update(partial);

  return {
    onDiaryStateChange(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSelectedRouteId(routeId) {
      store.selectedRouteId = routeId || null;
      update({ selectedRouteId: store.selectedRouteId });
      notify('route', store.selectedRouteId, 'diary route');
    },
    setDiaryAltEnabled(enabled) {
      store.diaryAltEnabled = !!enabled;
      update({ diaryAltEnabled: store.diaryAltEnabled });
      notify('alt', store.diaryAltEnabled, 'diary alt');
    },
    setDiaryViewMode(mode) {
      const allowed = ['live', 'history', 'community'];
      const next = allowed.includes(mode) ? mode : 'live';
      if (store.diaryViewMode === next) return;
      store.diaryViewMode = next;
      update({ diaryViewMode: next });
      notify('viewMode', next, 'diary view mode');
    },
    setDiarySelectedHistoryRouteId(id) {
      store.diarySelectedHistoryRouteId = id || null;
      update({ diarySelectedHistoryRouteId: store.diarySelectedHistoryRouteId });
      notify('historyRoute', store.diarySelectedHistoryRouteId, 'diary history route');
    },
    setDiaryCommunityRadiusMeters(radius) {
      const clamped = Math.min(3000, Math.max(500, Number(radius) || 1500));
      store.diaryCommunityRadiusMeters = clamped;
      update({ diaryCommunityRadiusMeters: clamped });
      notify('communityRadius', clamped, 'diary community radius');
    },
    setSimPlaybackSpeed(speed) {
      const allowed = [0.5, 1, 2];
      const next = allowed.includes(Number(speed)) ? Number(speed) : 1;
      store.simPlaybackSpeed = next;
      update({ simPlaybackSpeed: next });
      notify('playback', next, 'diary playback');
    },
    setDiaryDemoPeriod(period) {
      const allowed = ['day', 'week', 'month'];
      const next = allowed.includes(period) ? period : 'day';
      store.diaryDemoPeriod = next;
      update({ diaryDemoPeriod: next });
      notify('demoPeriod', next, 'diary demo period');
    },
    setDiaryTimeFilter(filter) {
      const allowed = ['all', 'day', 'evening', 'night'];
      const next = allowed.includes(filter) ? filter : 'all';
      store.diaryTimeFilter = next;
      update({ diaryTimeFilter: next });
      notify('timeFilter', next, 'diary time filter');
    },
    setSimPanelState(partial = {}) {
      const snapshot = update({ simState: partial });
      store.simState = { ...snapshot.simState };
    },
  };
}
