/** Draw and clear Diary route lines and simulator points on a MapLibre map. */

export function drawRouteOverlay(map, sourceId, lineFeature, opts = {}) {
  if (!map || !lineFeature) return;
  const geojson = normalizeFeature(lineFeature);
  ensureSource(map, sourceId, geojson);
  const layerId = `${sourceId}-line`;
  const paint = {
    'line-color': opts.lineColorExpression || opts.color || '#0ea5e9',
    'line-width': opts.width || 4,
    'line-opacity': typeof opts.opacity === 'number' ? opts.opacity : 0.9,
    'line-blur': typeof opts.blur === 'number' ? opts.blur : 0.2,
  };
  if (opts.dasharray) {
    paint['line-dasharray'] = opts.dasharray;
  }
  ensureLineLayer(map, layerId, sourceId, paint);
}

export function clearRouteOverlay(map, sourceId) {
  if (!map) return;
  const layerId = `${sourceId}-line`;
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId);
  } else {
    console.info('[Diary] clearRouteOverlay: layer not found', layerId);
  }
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  } else {
    console.info('[Diary] clearRouteOverlay: source not found', sourceId);
  }
}

export function drawSimPoint(map, sourceId, coord, opts = {}) {
  if (!map || !coord) return;
  const feature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: coord },
    properties: {},
  };
  ensureSource(map, sourceId, feature);
  const layerId = `${sourceId}-circle`;
  const paint = {
    'circle-radius': opts.radius || 6,
    'circle-color': opts.color || '#22d3ee',
    'circle-stroke-width': opts.strokeWidth || 1,
    'circle-stroke-color': opts.strokeColor || '#ffffff',
    'circle-opacity': typeof opts.opacity === 'number' ? opts.opacity : 0.9,
  };
  ensureCircleLayer(map, layerId, sourceId, paint);
}

export function clearSimPoint(map, sourceId) {
  if (!map) return;
  const layerId = `${sourceId}-circle`;
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId);
  } else {
    console.info('[Diary] clearSimPoint: layer not found', layerId);
  }
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  } else {
    console.info('[Diary] clearSimPoint: source not found', sourceId);
  }
}

function normalizeFeature(feature) {
  if (!feature) {
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} };
  }
  if (feature.type === 'FeatureCollection') {
    return feature;
  }
  if (feature.type === 'Feature') {
    return feature;
  }
  if (feature.type && feature.coordinates) {
    return { type: 'Feature', geometry: feature, properties: {} };
  }
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} };
}

function ensureSource(map, id, data) {
  if (!map || !id) return null;
  const normalized = data?.type ? data : { type: 'FeatureCollection', features: [] };
  const existing = map.getSource(id);
  if (existing) {
    existing.setData(normalized);
    return existing;
  }
  map.addSource(id, { type: 'geojson', data: normalized });
  return map.getSource(id);
}

function ensureLineLayer(map, layerId, sourceId, paint = {}) {
  if (!map || !layerId || !sourceId) return;
  const layout = {
    'line-cap': 'round',
    'line-join': 'round',
  };
  if (map.getLayer(layerId)) {
    Object.entries(paint).forEach(([key, value]) => map.setPaintProperty(layerId, key, value));
    return;
  }
  map.addLayer({
    id: layerId,
    type: 'line',
    source: sourceId,
    layout,
    paint,
  });
}

function ensureCircleLayer(map, layerId, sourceId, paint = {}) {
  if (!map || !layerId || !sourceId) return;
  if (map.getLayer(layerId)) {
    Object.entries(paint).forEach(([key, value]) => map.setPaintProperty(layerId, key, value));
    return;
  }
  map.addLayer({
    id: layerId,
    type: 'circle',
    source: sourceId,
    paint,
  });
}
