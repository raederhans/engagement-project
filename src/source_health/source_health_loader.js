/** Owns the explicit lazy boundary for the text-first Data Status surface. */
export function createSourceHealthLoader({
  mount,
  loadUi,
  getRuntimeEvidence = () => ({}),
  warn = (...args) => console.warn(...args),
} = {}) {
  const host = mount?.querySelector?.('[data-source-health-host]');
  const status = mount?.querySelector?.('[data-source-health-loader-status]');
  const retry = mount?.querySelector?.('[data-source-health-retry]');
  let promise = null;
  let controller = null;

  const setState = (state, message = '') => {
    if (mount?.dataset) mount.dataset.sourceHealthLoader = state;
    if (status) {
      status.hidden = !message;
      status.textContent = message;
    }
    if (retry) retry.hidden = state !== 'unavailable';
    if (host) host.setAttribute?.('aria-busy', String(state === 'loading'));
  };

  const load = () => {
    if (controller) {
      controller.refresh?.(getRuntimeEvidence());
      return Promise.resolve(controller);
    }
    if (!promise) {
      setState('loading', 'Loading source evidence…／正在加载来源证据……');
      promise = loadUi()
        .then((module) => {
          controller = module.initSourceHealthSurface({
            host,
            getRuntimeEvidence,
          });
          setState('ready');
          return controller;
        })
        .catch((error) => {
          promise = null;
          setState('unavailable', 'Source evidence could not load. Retry when ready.／来源证据加载失败，请重试。');
          warn('Data Status surface is unavailable:', error);
          return null;
        });
    }
    return promise;
  };

  const onToggle = () => {
    if (mount?.open) void load();
  };
  const onRetry = () => { void load(); };
  mount?.addEventListener?.('toggle', onToggle);
  retry?.addEventListener?.('click', onRetry);
  setState('idle');

  return Object.freeze({
    open() {
      if (mount) mount.open = true;
      return load();
    },
    whenIdle: () => promise || Promise.resolve(controller),
    refresh: () => controller?.refresh?.(getRuntimeEvidence()),
    dispose() {
      controller?.dispose?.();
      mount?.removeEventListener?.('toggle', onToggle);
      retry?.removeEventListener?.('click', onRetry);
    },
  });
}
