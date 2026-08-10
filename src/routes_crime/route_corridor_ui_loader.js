/** Owns only the explicit second-level lazy boundary and retryable import state. */
export function createRouteCorridorUiLoader({
  mount,
  loadUi,
  ports = {},
  warn = (...args) => console.warn(...args),
} = {}) {
  const open = mount?.querySelector?.('[data-route-corridor-open]');
  const retry = mount?.querySelector?.('[data-route-corridor-retry]');
  const status = mount?.querySelector?.('[data-route-corridor-loader-status]');
  const host = mount?.ownerDocument?.querySelector?.('[data-route-corridor-host]')
    || mount?.querySelector?.('[data-route-corridor-host]');
  const translate = ports.translate || ((key) => ({
    'route.loader.loading': 'Loading route review…',
    'route.loader.unavailable': 'Route review could not load. Retry when ready.',
  })[key] || key);
  let promise = null;
  let controller = null;
  open?.setAttribute?.('aria-expanded', 'false');
  const state = (value, message = '') => {
    mount.dataset.routeCorridorLoader = value;
    status.hidden = !message;
    status.textContent = message;
    retry.hidden = value !== 'unavailable';
    open.disabled = value === 'loading';
  };
  const loadAndOpen = () => {
    if (controller) {
      controller.open?.();
      return Promise.resolve(controller);
    }
    if (!promise) {
      state('loading', translate('route.loader.loading'));
      promise = loadUi()
        .then((module) => {
          controller = module.initRouteCorridorUi({ mount, host, returnFocus: open, ...ports });
          state('ready');
          controller.open?.();
          return controller;
        })
        .catch((error) => {
          promise = null;
          state('unavailable', translate('route.loader.unavailable'));
          warn('Route corridor UI is unavailable:', error);
          return null;
        });
    }
    return promise;
  };
  const onOpen = () => { void loadAndOpen(); };
  open?.addEventListener?.('click', onOpen);
  retry?.addEventListener?.('click', onOpen);
  state('idle');
  return {
    open: loadAndOpen,
    whenIdle: () => promise || Promise.resolve(controller),
    clear: () => controller?.clear?.(),
    syncCanonical: () => controller?.syncCanonical?.(),
    setActive(active) {
      if (mount) mount.hidden = !active;
      controller?.setActive?.(Boolean(active));
    },
    dispose() {
      controller?.dispose?.();
      open?.removeEventListener?.('click', onOpen);
      retry?.removeEventListener?.('click', onOpen);
    },
  };
}
