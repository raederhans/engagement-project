import { createRouteCorridorUiLoader } from './route_corridor_ui_loader.js';

/**
 * Shared Crime presentation adapter. It keeps Known Route available in both
 * map and no-map/list presentations while preserving one request owner.
 */
export function createRouteCorridorAppLoader({
  mount,
  readCanonicalSnapshot,
  getMap = () => null,
  translate,
} = {}) {
  let requestModulePromise = null;
  let hinUiPromise = null;
  let hinGeneration = 0;
  const map = createOptionalRouteMapPort(getMap);
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
  const requestRouteCorridor = async (options) => {
    reviewHin(options?.routeInput);
    requestModulePromise ||= import('./route_corridor_crime_coordinator.js');
    const module = await requestModulePromise;
    return module.request(readCanonicalSnapshot, true, options);
  };
  const clearRouteCorridor = () => {
    hinGeneration += 1;
    void hinUiPromise?.then((ui) => ui.clear()).catch(() => {});
    requestModulePromise?.then((module) => module.clear(), Boolean);
  };

  return createRouteCorridorUiLoader({
    mount,
    loadUi: () => import('./route_corridor_ui_controller.js'),
    ports: {
      map,
      requestRouteCorridor,
      clearRouteCorridor,
      readCanonicalSnapshot,
      translate,
    },
  });
}

export function createOptionalRouteMapPort(getMap = () => null) {
  let boundMap = null;
  const listeners = new Map();
  const resolve = () => {
    const nextMap = getMap() || null;
    if (nextMap === boundMap) return boundMap;
    for (const [event, handlers] of listeners) {
      for (const handler of handlers) boundMap?.off?.(event, handler);
    }
    boundMap = nextMap;
    for (const [event, handlers] of listeners) {
      for (const handler of handlers) boundMap?.on?.(event, handler);
    }
    return boundMap;
  };
  const call = (method, ...args) => resolve()?.[method]?.(...args);
  return {
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
    getStyle: () => call('getStyle'),
    addSource: (...args) => call('addSource', ...args),
    addLayer: (...args) => call('addLayer', ...args),
    getLayer: (...args) => call('getLayer', ...args),
    removeLayer: (...args) => call('removeLayer', ...args),
    getSource: (...args) => call('getSource', ...args),
    removeSource: (...args) => call('removeSource', ...args),
  };
}
