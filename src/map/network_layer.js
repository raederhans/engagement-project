import * as turf from '@turf/turf';

const SOURCE_ID = 'diary-network';
const LAYER_ID = 'diary-network-line';
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
  if (map.getSource(SOURCE_ID)) {
    if (data) map.getSource(SOURCE_ID).setData(data);
    return;
  }
  map.addSource(SOURCE_ID, { type: 'geojson', data: data || { type: 'FeatureCollection', features: [] } });
}

function ensureLayer(map) {
  if (map.getLayer(LAYER_ID)) return;
  map.addLayer({
    id: LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#cbd5e1',
      'line-opacity': 0.4,
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        ['case',
          ['==', ['get', 'class'], 1], 3.4,
          ['==', ['get', 'class'], 2], 2.8,
          ['==', ['get', 'class'], 3], 2.0,
          1.5],
        14,
        ['case',
          ['==', ['get', 'class'], 1], 4.2,
          ['==', ['get', 'class'], 2], 3.4,
          ['==', ['get', 'class'], 3], 2.4,
          1.6],
      ],
    },
  });
}

export async function addNetworkLayer(map) {
  if (!map) return;
  const data = await loadNetworkGeojson();
  ensureSource(map, data);
  ensureLayer(map);
}

export function ensureNetworkLayer(map) {
  if (!map) return;
  if (!map.getSource(SOURCE_ID)) return addNetworkLayer(map);
  ensureLayer(map);
}

export function removeNetworkLayer(map) {
  if (!map) return;
  if (map.getLayer(LAYER_ID)) {
    try { map.removeLayer(LAYER_ID); } catch {}
  }
  if (map.getSource(SOURCE_ID)) {
    try { map.removeSource(SOURCE_ID); } catch {}
  }
}

export function isNetworkLayerPresent(map) {
  if (!map) return false;
  return !!map.getLayer(LAYER_ID);
}
