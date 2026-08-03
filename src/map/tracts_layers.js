/**
 * Census tract layer management: outlines overlay + fill (choropleth when active)
 */
import { store } from '../state/store.js';
import { normalizeTractOutlineStyle } from '../state/crime_view_state.js';

/**
 * Add or update tract outline layer (thin dark-gray, always visible)
 * @param {import('maplibre-gl').Map} map
 * @param {object} fc - GeoJSON FeatureCollection
 * @param {{lineWidth?:number,lineOpacity?:number}} [styleProps]
 */
export function upsertTractsOutline(map, fc, styleProps = {}) {
  if (!fc || !fc.features || fc.features.length === 0) {
    console.warn('upsertTractsOutline: empty or invalid FeatureCollection');
    return;
  }

  const sourceId = 'tracts-outline';
  const layerId = 'tracts-outline-line';
  const style = normalizeTractOutlineStyle({
    lineWidth: styleProps.lineWidth ?? store.tractWidth,
    lineOpacity: styleProps.lineOpacity ?? store.tractOpacity,
  });

  // Add or update source
  if (map.getSource(sourceId)) {
    map.getSource(sourceId).setData(fc);
  } else {
    map.addSource(sourceId, {
      type: 'geojson',
      data: fc,
    });
  }

  // Add line layer if not present (default hidden; initial sync to store)
  if (!map.getLayer(layerId)) {
    // Insert above districts-fill, below districts-label (correct z-order)
    let beforeId = 'districts-label'; // Try to place before district labels
    if (!map.getLayer(beforeId)) {
      beforeId = 'districts-line'; // Fallback: before district lines
    }
    if (!map.getLayer(beforeId)) {
      beforeId = 'clusters'; // Fallback: before clusters/points
    }
    if (!map.getLayer(beforeId)) {
      beforeId = undefined; // No reference layer, add on top
    }

    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      layout: { visibility: 'none' },
      paint: {
        'line-color': '#555',
        'line-width': style.lineWidth,
        'line-opacity': style.lineOpacity,
      },
    }, beforeId);

    // One-time visibility sync based on store (overlay checkbox)
    try {
      const vis = store.overlayTractsLines ? 'visible' : 'none';
      map.setLayoutProperty(layerId, 'visibility', vis);
    } catch {}
  } else {
    setTractsOutlineStyle(map, style);
  }
}

/**
 * Update only the existing tract outline paint. This does not refetch or replace data.
 * @param {import('maplibre-gl').Map} map
 * @param {{lineWidth?:number,lineOpacity?:number}} styleProps
 */
export function setTractsOutlineStyle(map, styleProps = {}) {
  const layerId = 'tracts-outline-line';
  if (!map?.getLayer?.(layerId) || typeof map.setPaintProperty !== 'function') return false;
  const style = normalizeTractOutlineStyle(styleProps);
  map.setPaintProperty(layerId, 'line-width', style.lineWidth);
  map.setPaintProperty(layerId, 'line-opacity', style.lineOpacity);
  return true;
}

/**
 * Add or update tract fill layer for choropleth (invisible by default)
 * @param {import('maplibre-gl').Map} map
 * @param {object} fc - GeoJSON FeatureCollection with properties.value
 * @param {{fillColor:any,fillOpacity:number}} [styleProps] - MapLibre paint properties
 */
export function upsertTractsFill(map, fc, styleProps = {}) {
  if (!fc || !fc.features || fc.features.length === 0) {
    console.warn('upsertTractsFill: empty or invalid FeatureCollection');
    return;
  }

  const sourceId = 'tracts-fill';
  const layerId = 'tracts-fill';

  // Add or update source
  if (map.getSource(sourceId)) {
    map.getSource(sourceId).setData(fc);
  } else {
    map.addSource(sourceId, {
      type: 'geojson',
      data: fc,
    });
  }

  // Add fill layer if not present
  if (!map.getLayer(layerId)) {
    // Insert above districts-fill, below outline
    let beforeId = 'tracts-outline-line';
    if (!map.getLayer(beforeId)) {
      beforeId = 'clusters';
    }
    if (!map.getLayer(beforeId)) {
      beforeId = undefined;
    }

    map.addLayer({
      id: layerId,
      type: 'fill',
      source: sourceId,
      layout: {},
      paint: {
        'fill-color': styleProps.fillColor || '#ccc',
        'fill-opacity': styleProps.fillOpacity ?? 0, // Invisible by default
      },
    }, beforeId);
  } else {
    // Update paint properties
    if (styleProps.fillColor) {
      map.setPaintProperty(layerId, 'fill-color', styleProps.fillColor);
    }
    if (styleProps.fillOpacity !== undefined) {
      map.setPaintProperty(layerId, 'fill-opacity', styleProps.fillOpacity);
    }
  }
}

/**
 * Show tract choropleth (set non-zero fill-opacity)
 * @param {import('maplibre-gl').Map} map
 */
export function showTractsFill(map) {
  if (map.getLayer('tracts-fill')) {
    map.setPaintProperty('tracts-fill', 'fill-opacity', 0.7);
  }
}

/**
 * Hide tract choropleth (set fill-opacity to 0, keep outlines visible)
 * @param {import('maplibre-gl').Map} map
 */
export function hideTractsFill(map) {
  if (map.getLayer('tracts-fill')) {
    map.setPaintProperty('tracts-fill', 'fill-opacity', 0);
  }
}

/**
 * Remove tract layers (cleanup)
 * @param {import('maplibre-gl').Map} map
 */
export function removeTractsLayers(map) {
  for (const layerId of ['tracts-fill', 'tracts-outline-line']) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }
  for (const sourceId of ['tracts-fill', 'tracts-outline']) {
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
  }
}
