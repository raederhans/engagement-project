import { DIARY_NETWORK_SOURCE_ID, DIARY_NETWORK_LAYER_ID } from '../routes_diary/map_ids.js';

let cachedData = null;

function classWidth(classValue, zoom = 12) {
  const cls = Number(classValue);
  const base =
    cls === 1 ? 3.2
      : cls === 2 ? 2.6
        : cls === 3 ? 2.0
          : 1.4;
  const zoomFactor = Math.min(1.8, 0.6 + (zoom - 10) * 0.1);
  return base * zoomFactor;
}

async function loadNetworkGeojson() {
  if (cachedData) return cachedData;
  try {
    const res = await fetch('/data/segments_phl.network.geojson', { cache: 'no-cache' });
    if (res.ok) {
      const raw = await res.json();
      if (Array.isArray(raw?.features) && raw.features.length > 15000) {
        const step = Math.ceil(raw.features.length / 15000);
        raw.features = raw.features.filter((_, idx) => idx % step === 0);
      }
      cachedData = raw;
      return cachedData;
    }
  } catch {}
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
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      'minzoom': 10,  // Lowered from 11 to make visible at route-viewing zoom
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

export async function addNetworkLayer(map) {
  if (!map) return;
  const data = await loadNetworkGeojson();
  if (data) {
    console.info(`[Diary] Network layer loaded: ${data.features?.length || 0} segments (throttled from network file)`);
  } else {
    console.warn('[Diary] Network layer: no data loaded');
  }
  ensureSource(map, data);
  ensureLayer(map);
  console.info(`[Diary] Network layer attached: source="${DIARY_NETWORK_SOURCE_ID}", layer="${DIARY_NETWORK_LAYER_ID}"`);
}

export function ensureNetworkLayer(map) {
  if (!map) return;
  if (!map.getSource(DIARY_NETWORK_SOURCE_ID)) return addNetworkLayer(map);
  ensureLayer(map);
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

export function isNetworkLayerPresent(map) {
  if (!map) return false;
  return !!map.getLayer(DIARY_NETWORK_LAYER_ID);
}
