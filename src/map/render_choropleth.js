import { updateLegend, hideLegend } from './legend.js';
import { computeBreaks, makePalette, toMapLibreStep } from '../utils/classify.js';
import { store } from '../state/store.js';

/**
 * Add or update a districts choropleth from merged GeoJSON.
 * @param {import('maplibre-gl').Map} map
 * @param {object} merged - FeatureCollection with properties.value on each feature
 * @returns {{breaks:number[], colors:string[]}}
 */
export function renderDistrictChoropleth(map, merged) {
  const values = (merged?.features || []).map((f) => Number(f?.properties?.value) || 0);
  const allZero = values.length === 0 || values.every((v) => v === 0);
  const breaks = allZero ? [] : computeBreaks(values, { method: store.classMethod, bins: store.classBins, custom: store.classCustomBreaks });
  const colors = makePalette(store.classPalette, (breaks.length || Math.max(1, store.classBins - 1)) + 1);

  // Update legend
  if (allZero || breaks.length === 0) {
    hideLegend();
  } else {
    updateLegend({ title: 'Districts', unit: '', breaks, colors });
  }

  // Build step expression from classifier
  const { paintProps } = toMapLibreStep(breaks, colors, { opacity: store.classOpacity });

  const sourceId = 'districts';
  const fillId = 'districts-fill';
  const lineId = 'districts-line';
  const labelId = 'districts-label';

  if (map.getSource(sourceId)) {
    map.getSource(sourceId).setData(merged);
  } else {
    map.addSource(sourceId, { type: 'geojson', data: merged });
  }

  if (!map.getLayer(fillId)) {
    map.addLayer({
      id: fillId,
      type: 'fill',
      source: sourceId,
      paint: allZero ? {
        'fill-color': '#e5e7eb', 'fill-opacity': 0.6,
      } : {
        'fill-color': paintProps['fill-color'],
        'fill-opacity': paintProps['fill-opacity'],
      },
    });
  } else {
    map.setPaintProperty(fillId, 'fill-color', allZero ? '#e5e7eb' : paintProps['fill-color']);
    map.setPaintProperty(fillId, 'fill-opacity', allZero ? 0.6 : paintProps['fill-opacity']);
  }

  if (!map.getLayer(lineId)) {
    map.addLayer({
      id: lineId,
      type: 'line',
      source: sourceId,
      paint: { 'line-color': '#333', 'line-width': 1 },
    });
  }

  if (allZero) {
    const pane = document.getElementById('charts') || document.body;
    const status = document.getElementById('charts-status') || (() => {
      const d = document.createElement('div');
      d.id = 'charts-status';
      d.style.cssText = 'position:absolute;right:16px;top:16px;padding:8px 12px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.1);background:#fff;font:14px/1.4 system-ui';
      pane.appendChild(d);
      return d;
    })();
    status.textContent = 'No incidents in selected window. Adjust the time range.';
  }

  if (!map.getLayer(labelId)) {
    map.addLayer({
      id: labelId,
      type: 'symbol',
      source: sourceId,
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ['get', 'DIST_NUMC']],
        'text-size': 12,
      },
      paint: { 'text-color': '#1f2937', 'text-halo-color': '#fff', 'text-halo-width': 1 }
    });
  }

  return { breaks, colors };
}
