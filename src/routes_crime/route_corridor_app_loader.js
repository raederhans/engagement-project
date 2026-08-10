import { createRouteCorridorUiLoader } from './route_corridor_ui_loader.js';

/**
 * Shared Crime presentation entry. The runtime ports remain a second-level
 * lazy boundary until the user explicitly opens Known Route.
 */
export function createRouteCorridorAppLoader({
  mount,
  readCanonicalSnapshot,
  getMap = () => null,
  translate,
} = {}) {
  return createRouteCorridorUiLoader({
    mount,
    loadUi: () => import('./route_corridor_app_runtime.js')
      .then((module) => module.loadRouteCorridorUiRuntime({
        getMap,
        readCanonicalSnapshot,
      })),
    ports: {
      readCanonicalSnapshot,
      translate,
    },
  });
}
