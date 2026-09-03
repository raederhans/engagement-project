import { updateLegend, updateLegendMessage } from './legend.js';
import { computeBreaks, makePalette, toMapLibreStep } from '../utils/classify.js';
import { store } from '../state/store.js';
import { setTranslatedText, t } from '../i18n/index.js';
import { resolveCrimeDistrictFillOpacity } from '../state/crime_view_state.js';

/**
 * Add or update a districts choropleth from merged GeoJSON.
 * @param {import('maplibre-gl').Map} map
 * @param {object} merged - FeatureCollection with properties.value on each feature
 * @returns {{breaks:number[], colors:string[]}}
 */
export function renderDistrictChoropleth(map, merged, {
  status = 'ready',
  start = '',
  end = '',
} = {}) {
  const values = (merged?.features || []).map((f) => Number(f?.properties?.value) || 0);
  const available = status === 'ready';
  const allZero = available && (values.length === 0 || values.every((v) => v === 0));
  const breaks = allZero ? [] : computeBreaks(values, { method: store.classMethod, bins: store.classBins, custom: store.classCustomBreaks });
  const colors = makePalette(store.classPalette, (breaks.length || Math.max(1, store.classBins - 1)) + 1);

  // Update legend
  if (!available) {
    updateLegendMessage({
      title: 'map.districtContextLegend',
      message: status === 'loading'
        ? 'map.districtOverviewLoading'
        : 'map.districtOverviewUnavailable',
    });
  } else if (allZero || breaks.length === 0) {
    updateLegendMessage({
      title: 'map.districtContextLegend',
      message: 'crime.noIncidents',
    });
  } else {
    updateLegend({
      title: 'map.districtContextLegend',
      subtitleKey: 'map.districtLegendSubtitle',
      subtitleParams: { start, end },
      breaks,
      colors,
      swatchOpacity: resolveCrimeDistrictFillOpacity(store),
    });
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
      paint: !available ? {
        'fill-color': '#cbd5e1', 'fill-opacity': 0.08,
      } : allZero ? {
        'fill-color': '#e5e7eb', 'fill-opacity': 0.6,
      } : {
        'fill-color': paintProps['fill-color'],
        'fill-opacity': paintProps['fill-opacity'],
      },
    });
  } else {
    map.setPaintProperty(fillId, 'fill-color', !available
      ? '#cbd5e1'
      : allZero ? '#e5e7eb' : paintProps['fill-color']);
    map.setPaintProperty(fillId, 'fill-opacity', !available
      ? 0.08
      : allZero ? 0.6 : paintProps['fill-opacity']);
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
      d.className = 'chart-status';
      pane.appendChild(d);
      return d;
    })();
    setTranslatedText(status, 'crime.noIncidents');
  }

  if (!map.getLayer(labelId)) {
    map.addLayer({
      id: labelId,
      type: 'symbol',
      source: sourceId,
      layout: {
        'text-field': ['get', 'DIST_NUMC'],
        'text-size': 12,
      },
      paint: { 'text-color': '#1f2937', 'text-halo-color': '#fff', 'text-halo-width': 1 }
    });
  }

  return { breaks, colors };
}
