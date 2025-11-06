/**
 * Highlight helpers for selected polygons (districts/tracts).
 */

export function upsertSelectedDistrict(map, code) {
  const srcId = 'districts';
  if (!map.getSource(srcId) || !code) return;
  const fillId = 'districts-selected-fill';
  const lineId = 'districts-selected-line';
  const filter = ['==', ['to-string', ['get', 'DIST_NUMC']], String(code).padStart(2, '0')];
  if (!map.getLayer(fillId)) {
    map.addLayer({ id: fillId, type: 'fill', source: srcId, filter, paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.25 } });
  } else {
    map.setFilter(fillId, filter);
  }
  if (!map.getLayer(lineId)) {
    map.addLayer({ id: lineId, type: 'line', source: srcId, filter, paint: { 'line-color': '#16a34a', 'line-width': 2 } });
  } else {
    map.setFilter(lineId, filter);
  }
}

export function clearSelectedDistrict(map) {
  for (const id of ['districts-selected-line', 'districts-selected-fill']) {
    if (map.getLayer(id)) try { map.removeLayer(id); } catch {}
  }
}

export function upsertSelectedTract(map, geoid) {
  const srcId = 'tracts';
  if (!map.getSource(srcId) || !geoid) return;
  const tractce = String(geoid).slice(-6); // last 6 digits
  const filter = ['==', ['to-string', ['get', 'TRACT_FIPS']], tractce];
  const fillId = 'tracts-selected-fill';
  const lineId = 'tracts-selected-line';
  if (!map.getLayer(fillId)) {
    map.addLayer({ id: fillId, type: 'fill', source: srcId, filter, paint: { 'fill-color': '#a78bfa', 'fill-opacity': 0.25 } });
  } else {
    map.setFilter(fillId, filter);
  }
  if (!map.getLayer(lineId)) {
    map.addLayer({ id: lineId, type: 'line', source: srcId, filter, paint: { 'line-color': '#7c3aed', 'line-width': 2 } });
  } else {
    map.setFilter(lineId, filter);
  }
}

export function clearSelectedTract(map) {
  for (const id of ['tracts-selected-line', 'tracts-selected-fill']) {
    if (map.getLayer(id)) try { map.removeLayer(id); } catch {}
  }
}

