import * as turf from '@turf/turf';

export function upsertBufferA(map, { centerLonLat, radiusM }) {
  return upsertBuffer(map, { id: 'buffer-a', centerLonLat, radiusM, color: '#0284c7' });
}

export function upsertBufferB(map, { centerLonLat, radiusM }) {
  return upsertBuffer(map, { id: 'buffer-b', centerLonLat, radiusM, color: '#dc2626' });
}

function upsertBuffer(map, { id, centerLonLat, radiusM, color }) {
  if (!centerLonLat) return;
  const circle = turf.circle(centerLonLat, radiusM, { units: 'meters', steps: 64 });
  const srcId = id;
  if (map.getSource(srcId)) {
    map.getSource(srcId).setData(circle);
  } else {
    map.addSource(srcId, { type: 'geojson', data: circle });
    map.addLayer({ id: `${id}-fill`, type: 'fill', source: srcId, paint: { 'fill-color': color, 'fill-opacity': 0.12 } });
    map.addLayer({ id: `${id}-line`, type: 'line', source: srcId, paint: { 'line-color': color, 'line-width': 2 } });
  }
}

export function clearBufferA(map) {
  clearBuffer(map, 'buffer-a');
}

export function clearBufferB(map) {
  clearBuffer(map, 'buffer-b');
}

function clearBuffer(map, srcId) {
  for (const id of [`${srcId}-fill`, `${srcId}-line`]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(srcId)) map.removeSource(srcId);
}

