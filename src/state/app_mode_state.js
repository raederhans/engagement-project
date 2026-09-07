export function resolveDiaryFeatureOn({
  search = globalThis.window?.location?.search || '',
  pathname = globalThis.window?.location?.pathname || '',
  envEnabled = import.meta.env?.VITE_FEATURE_DIARY === '1',
  developmentEnabled = import.meta.env?.DEV === true && import.meta.env?.VITE_FEATURE_DIARY !== '0',
} = {}) {
  const params = new URLSearchParams(search);
  return Boolean(envEnabled || developmentEnabled || params.get('mode') === 'diary' || pathname.includes('diary-demo'));
}

export function createAppModeState({ store, preferences, diaryFeatureOn }) {
  const listeners = new Set();

  return {
    setViewMode(mode, { silent = false } = {}) {
      let normalized = mode === 'diary' ? 'diary' : 'crime';
      if (normalized === 'diary' && !diaryFeatureOn) normalized = 'crime';
      if (store.viewMode === normalized) {
        store.diaryMode = normalized === 'diary';
        return normalized;
      }
      store.viewMode = normalized;
      store.diaryMode = normalized === 'diary';
      preferences.update({ viewMode: normalized });
      if (!silent) {
        for (const listener of listeners) {
          try {
            listener(normalized);
          } catch (error) {
            console.warn('[store] viewMode listener failed:', error);
          }
        }
      }
      return normalized;
    },
    onViewModeChange(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
