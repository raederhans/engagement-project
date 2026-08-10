/** Load the controller only after the app-level Known Route trigger. */
export async function loadRouteCorridorUiRuntime({
  readCanonicalSnapshot,
  getMap = () => null,
} = {}) {
  const controller = await import('./route_corridor_ui_controller.js');
  return {
    initRouteCorridorUi(options = {}) {
      return controller.initRouteCorridorUi({
        ...options,
        ...createRouteCorridorRuntimePorts({
          mount: options.mount,
          readCanonicalSnapshot,
          getMap,
        }),
      });
    },
  };
}

function createRouteCorridorRuntimePorts({ mount, readCanonicalSnapshot, getMap }) {
  let requestModulePromise = null;
  let hinUiPromise = null;
  let hinGeneration = 0;
  const reviewHin = (routeInput) => {
    const requestGeneration = ++hinGeneration;
    const root = mount?.querySelector?.('[data-route-hin-context]');
    if (!root) return;
    hinUiPromise ||= import('./hin_2025_ui.js')
      .then((module) => module.initHin2025Ui({ root }));
    void hinUiPromise
      .then((ui) => (requestGeneration === hinGeneration ? ui.review(routeInput) : null))
      .catch(() => {
        if (requestGeneration !== hinGeneration) return;
        hinUiPromise = null;
        root.dataset.hinStatus = 'unavailable';
        root.textContent = 'HIN unavailable; not zero.';
      });
  };
  return {
    map: createOptionalRouteMapPort(getMap),
    async requestRouteCorridor(options) {
      reviewHin(options?.routeInput);
      requestModulePromise ||= import('./route_corridor_crime_coordinator.js');
      const module = await requestModulePromise;
      return module.request(readCanonicalSnapshot, true, options);
    },
    clearRouteCorridor() {
      hinGeneration += 1;
      void hinUiPromise?.then((ui) => ui.clear()).catch(() => {});
      requestModulePromise?.then((module) => module.clear(), Boolean);
    },
  };
}

export function createOptionalRouteMapPort(getMap = () => null) {
  let boundMap = null;
  const listeners = new Map();
  const applyListeners = (map, method) => {
    for (const [event, handlers] of listeners) {
      for (const handler of handlers) map?.[method]?.(event, handler);
    }
  };
  const resolve = () => {
    const nextMap = getMap() || null;
    if (nextMap === boundMap) return boundMap;
    applyListeners(boundMap, 'off');
    boundMap = nextMap;
    applyListeners(boundMap, 'on');
    return boundMap;
  };
  const port = {
    isAvailable: () => Boolean(resolve()),
    on(event, handler) {
      const previousMap = boundMap;
      const handlers = listeners.get(event) || new Set();
      handlers.add(handler);
      listeners.set(event, handlers);
      const currentMap = resolve();
      if (currentMap && currentMap === previousMap) currentMap.on?.(event, handler);
    },
    off(event, handler) {
      resolve()?.off?.(event, handler);
      listeners.get(event)?.delete(handler);
    },
  };
  for (const method of [
    'getStyle',
    'addSource',
    'addLayer',
    'getLayer',
    'removeLayer',
    'getSource',
    'removeSource',
  ]) {
    port[method] = (...args) => resolve()?.[method]?.(...args);
  }
  return port;
}
