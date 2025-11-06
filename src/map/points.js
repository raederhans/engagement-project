import { CARTO_SQL_BASE } from '../config.js';
import { fetchJson } from '../utils/http.js';
import { buildCrimePointsSQL } from '../utils/sql.js';
import { categoryColorPairs } from '../utils/types.js';

function project3857(lon, lat) {
  const R = 6378137;
  const x = R * (lon * Math.PI / 180);
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
  return [x, y];
}

function mapBboxTo3857(map) {
  const b = map.getBounds();
  const [xmin, ymin] = project3857(b.getWest(), b.getSouth());
  const [xmax, ymax] = project3857(b.getEast(), b.getNorth());
  return { xmin, ymin, xmax, ymax };
}

function ensureSourcesAndLayers(map) {
  const srcId = 'crime-points';
  const clusterId = 'clusters';
  const clusterCountId = 'cluster-count';
  const unclusteredId = 'unclustered';

  return { srcId, clusterId, clusterCountId, unclusteredId };
}

function unclusteredColorExpression() {
  // Build a match expression on text_general_code with fallbacks
  const pairs = categoryColorPairs();
  const expr = ['match', ['get', 'text_general_code']];
  for (const [key, color] of pairs) {
    expr.push(key, color);
  }
  expr.push('#999999');
  return expr;
}

/**
 * Fetch GeoJSON points limited by time window and bbox, and render clusters/unclustered.
 * @param {import('maplibre-gl').Map} map
 * @param {{start:string,end:string,types?:string[]}} params
 */
const MAX_UNCLUSTERED = 20000;

export async function refreshPoints(map, { start, end, types, queryMode, selectedDistrictCode } = {}) {
  const { srcId, clusterId, clusterCountId, unclusteredId } = ensureSourcesAndLayers(map);

  const bbox = mapBboxTo3857(map);
  const dc_dist = queryMode === 'district' && selectedDistrictCode ? selectedDistrictCode : undefined;
  const sql = buildCrimePointsSQL({ start, end, types, bbox, dc_dist });
  const url = `${CARTO_SQL_BASE}?format=GeoJSON&q=${encodeURIComponent(sql)}`;

  const geo = await fetchJson(url, { cacheTTL: 30_000 });
  const count = Array.isArray(geo?.features) ? geo.features.length : 0;

  // Add or update source
  if (map.getSource(srcId)) {
    map.getSource(srcId).setData(geo);
  } else {
    map.addSource(srcId, {
      type: 'geojson',
      data: geo,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 40,
    });
  }

  // Cluster circles
  if (!map.getLayer(clusterId)) {
    map.addLayer({
      id: clusterId,
      type: 'circle',
      source: srcId,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step',
          ['get', 'point_count'],
          '#9cdcf6',
          10, '#52b5e9',
          50, '#2f83c9',
          100, '#1f497b'
        ],
        'circle-radius': [
          'step',
          ['get', 'point_count'],
          14,
          10, 18,
          50, 24,
          100, 30
        ],
        'circle-opacity': 0.85
      }
    });
  }

  // Cluster count labels
  if (!map.getLayer(clusterCountId)) {
    map.addLayer({
      id: clusterCountId,
      type: 'symbol',
      source: srcId,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['to-string', ['get', 'point_count']],
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
        'text-size': 12
      },
      paint: {
        'text-color': '#112'
      }
    });
  }

  // Unclustered single points
  const tooMany = count > MAX_UNCLUSTERED;
  const existsUnclustered = !!map.getLayer(unclusteredId);
  if (tooMany) {
    if (existsUnclustered) map.removeLayer(unclusteredId);
    ensureBanner('Too many points — zoom in to see details.');
  } else {
    if (count === 0) {
      ensureBanner('No incidents for selected filters — try expanding time window or offense groups');
      if (existsUnclustered) map.removeLayer(unclusteredId);
      return;
    }
    hideBanner();
    if (!existsUnclustered) {
      map.addLayer({
        id: unclusteredId,
        type: 'circle',
        source: srcId,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': 5,
          'circle-color': unclusteredColorExpression(),
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 0.8,
          'circle-opacity': 0.85
        }
      });
    }
  }
}

export function clearCrimePoints(map) {
  const srcId = 'crime-points';
  for (const id of ['unclustered','cluster-count','clusters']) {
    if (map.getLayer(id)) {
      try { map.removeLayer(id); } catch {}
    }
  }
  if (map.getSource(srcId)) {
    try { map.removeSource(srcId); } catch {}
  }
}

function ensureBanner(text) {
  let el = document.getElementById('banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'banner';
    Object.assign(el.style, {
      position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(255, 247, 233, 0.95)', color: '#7c2d12', padding: '8px 12px',
      border: '1px solid #facc15', borderRadius: '6px', zIndex: 30, font: '13px/1.4 system-ui, sans-serif'
    });
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = 'block';
}

function hideBanner() {
  const el = document.getElementById('banner');
  if (el) el.style.display = 'none';
}
