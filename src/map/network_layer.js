import { DIARY_NETWORK_SOURCE_ID, DIARY_NETWORK_LAYER_ID } from '../routes_diary/map_ids.js';
import { publicUrl } from '../utils/public_url.js';
import { DIARY_NETWORK_DATA_ENABLED } from '../config.js';

let cachedData = null;
let disabledNoticeLogged = false;

async function loadNetworkGeojson({ signal, shouldApply = () => true } = {}) {
  signal?.throwIfAborted();
  if (cachedData) return cachedData;
  try {
    const res = await fetch(publicUrl('data/segments_phl.network.geojson'), {
      cache: 'no-cache',
      signal,
    });
    if (res.ok) {
      const raw = await res.json();
      signal?.throwIfAborted();
      if (!shouldApply()) return null;
      if (Array.isArray(raw?.features) && raw.features.length > 15000) {
        const step = Math.ceil(raw.features.length / 15000);
        raw.features = raw.features.filter((_, idx) => idx % step === 0);
      }
      cachedData = raw;
      return cachedData;
    }
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
  }
  return null;
}

function ensureSource(map, data) {
  if (map.getSource(DIARY_NETWORK_SOURCE_ID)) {
    if (data) map.getSource(DIARY_NETWORK_SOURCE_ID).setData(data);
    return;
  }
  map.addSource(DIARY_NETWORK_SOURCE_ID, { type: 'geojson', data: data || { type: 'FeatureCollection', features: [] } });
}

function ensureLayer(map) {
  if (map.getLayer(DIARY_NETWORK_LAYER_ID)) return;
  map.addLayer({
    id: DIARY_NETWORK_LAYER_ID,
    type: 'line',
    source: DIARY_NETWORK_SOURCE_ID,
    minzoom: 10,  // Lowered from 11 to make visible at route-viewing zoom
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': '#94a3b8',
      'line-opacity': 0.6,
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        ['case',
          ['==', ['get', 'class'], 1], 4.5,  // Slightly wider
          ['==', ['get', 'class'], 2], 3.5,
          ['==', ['get', 'class'], 3], 2.6,
          2.0],
        14,
        ['case',
          ['==', ['get', 'class'], 1], 5.5,
          ['==', ['get', 'class'], 2], 4.5,
          ['==', ['get', 'class'], 3], 3.0,
          2.2],
      ],
    },
  });
}

export async function addNetworkLayer(map, {
  enabled = DIARY_NETWORK_DATA_ENABLED,
  signal,
  shouldApply = () => true,
  loadNetworkGeojsonImpl = loadNetworkGeojson,
} = {}) {
  if (!map) return { applied: false, reason: 'missing-map' };
  signal?.throwIfAborted();
  if (!enabled) {
    if (!disabledNoticeLogged) {
      console.info('[Diary] Optional network dataset is not enabled in this build.');
      disabledNoticeLogged = true;
    }
    return { applied: false, reason: 'disabled' };
  }
  const data = await loadNetworkGeojsonImpl({ signal, shouldApply });
  signal?.throwIfAborted();
  if (!shouldApply()) return { applied: false, reason: 'stale' };
  if (data) {
    console.info(`[Diary] Network layer loaded: ${data.features?.length || 0} segments (throttled from network file)`);
  } else {
    console.warn('[Diary] Network layer: no data loaded');
  }
  const sourceExisted = Boolean(map.getSource(DIARY_NETWORK_SOURCE_ID));
  const layerExisted = Boolean(map.getLayer(DIARY_NETWORK_LAYER_ID));
  ensureSource(map, data);
  const ownedSource = sourceExisted ? null : map.getSource(DIARY_NETWORK_SOURCE_ID);
  try {
    ensureLayer(map);
  } catch (error) {
    if (ownedSource && map.getSource(DIARY_NETWORK_SOURCE_ID) === ownedSource) {
      const partialOwnedLayer = layerExisted ? null : map.getLayer(DIARY_NETWORK_LAYER_ID);
      if (partialOwnedLayer && map.getLayer(DIARY_NETWORK_LAYER_ID) === partialOwnedLayer) {
        try { map.removeLayer(DIARY_NETWORK_LAYER_ID); } catch {}
      }
      if (
        map.getSource(DIARY_NETWORK_SOURCE_ID) === ownedSource
        && !map.getLayer(DIARY_NETWORK_LAYER_ID)
      ) {
        try { map.removeSource(DIARY_NETWORK_SOURCE_ID); } catch {}
      }
    }
    throw error;
  }
  console.info(`[Diary] Network layer attached: source="${DIARY_NETWORK_SOURCE_ID}", layer="${DIARY_NETWORK_LAYER_ID}"`);
  return { applied: true };
}

export function ensureNetworkLayer(map, options = {}) {
  const {
    enabled = DIARY_NETWORK_DATA_ENABLED,
    signal,
    shouldApply = () => true,
  } = options;
  if (!map || !enabled) return { applied: false, reason: !map ? 'missing-map' : 'disabled' };
  signal?.throwIfAborted();
  if (!shouldApply()) return { applied: false, reason: 'stale' };
  if (!map.getSource(DIARY_NETWORK_SOURCE_ID)) return addNetworkLayer(map, options);
  ensureLayer(map);
  return { applied: true };
}

export function removeNetworkLayer(map) {
  if (!map) return;
  if (map.getLayer(DIARY_NETWORK_LAYER_ID)) {
    try { map.removeLayer(DIARY_NETWORK_LAYER_ID); } catch {}
  } else {
    console.info('[Diary] removeNetworkLayer: layer not found', DIARY_NETWORK_LAYER_ID);
  }
  if (map.getSource(DIARY_NETWORK_SOURCE_ID)) {
    try { map.removeSource(DIARY_NETWORK_SOURCE_ID); } catch {}
  } else {
    console.info('[Diary] removeNetworkLayer: source not found', DIARY_NETWORK_SOURCE_ID);
  }
}
