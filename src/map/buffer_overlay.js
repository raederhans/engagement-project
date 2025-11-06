import * as turf from '@turf/turf';

export function upsertBufferA(map, { centerLonLat, radiusM }) {
  if (!centerLonLat) return;
  const circle = turf.circle(centerLonLat, radiusM, { units: 'meters', steps: 64 });
  const srcId = 'buffer-a';
  if (map.getSource(srcId)) {
    map.getSource(srcId).setData(circle);
  } else {
    map.addSource(srcId, { type: 'geojson', data: circle });
    map.addLayer({ id: 'buffer-a-fill', type: 'fill', source: srcId, paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.15 } });
    map.addLayer({ id: 'buffer-a-line', type: 'line', source: srcId, paint: { 'line-color': '#0284c7', 'line-width': 1.5 } });
  }
}

export function clearBufferA(map) {
  const srcId = 'buffer-a';
  for (const id of ['buffer-a-fill', 'buffer-a-line']) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(srcId)) map.removeSource(srcId);
}

