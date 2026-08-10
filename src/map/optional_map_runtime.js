export function createOptionalMapRuntime({
  loadMap,
  onStatusChange = () => {},
} = {}) {
  if (typeof loadMap !== 'function') throw new TypeError('Optional map runtime requires loadMap.');
  let map = null;
  let pending = null;
  let status = Object.freeze({ phase: 'idle', error: null });

  const publish = (phase, error = null) => {
    status = Object.freeze({ phase, error });
    onStatusChange(status);
  };

  const ensureMap = () => {
    if (map) return Promise.resolve(map);
    if (pending) return pending;
    publish('loading');
    let owned;
    owned = Promise.resolve()
      .then(loadMap)
      .then((nextMap) => {
        if (!nextMap) throw new Error('Map runtime did not return a map instance.');
        map = nextMap;
        publish('ready');
        return map;
      })
      .catch((error) => {
        publish('failed', error);
        throw error;
      })
      .finally(() => {
        if (pending === owned) pending = null;
      });
    pending = owned;
    return pending;
  };

  return Object.freeze({
    ensureMap,
    getMap: () => map,
    getStatus: () => status,
  });
}

const MAPLIBRE_CSS_URL = new URL(
  '../../node_modules/maplibre-gl/dist/maplibre-gl.css',
  import.meta.url,
).href;

function loadMapStylesheet(documentRef = globalThis.document) {
  const existing = documentRef?.querySelector?.('[data-maplibre-runtime-style]');
  if (existing?.dataset.loaded === 'true') return Promise.resolve();
  if (existing?.__loadPromise) return existing.__loadPromise;
  if (!documentRef?.createElement || !documentRef?.head) {
    return Promise.reject(new Error('Map stylesheet cannot load without a document.'));
  }
  const link = existing || documentRef.createElement('link');
  link.rel = 'stylesheet';
  link.href = MAPLIBRE_CSS_URL;
  link.dataset.maplibreRuntimeStyle = '';
  link.__loadPromise = new Promise((resolve, reject) => {
    link.addEventListener('load', () => {
      link.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    link.addEventListener('error', () => reject(new Error('Map stylesheet failed to load.')), { once: true });
  });
  if (!existing) documentRef.head.appendChild(link);
  return link.__loadPromise;
}

export async function loadOptionalMapRuntime(options, { documentRef = globalThis.document } = {}) {
  await loadMapStylesheet(documentRef);
  const module = await import('./initMap.js');
  return module.initMap(options);
}
