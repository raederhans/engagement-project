import { fetchPoints } from '../api/crime.js';
import { categoryColorPairs } from '../utils/types.js';
import { onLanguageChange, setTranslatedText, t } from '../i18n/index.js';
import { formatLocalizedDate } from '../i18n/date.js';
import { escapeHtml } from '../utils/html.js';
import maplibregl from 'maplibre-gl';
import { prefersReducedMotion as defaultPrefersReducedMotion } from './camera_fit.js';

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

export function clusterTextColorExpression() {
  return [
    'step',
    ['get', 'point_count'],
    '#112',
    100,
    '#fff',
  ];
}

export function attachClusterExpansion(map, {
  sourceId = 'crime-points',
  layerId = 'clusters',
  isActive = () => true,
  runMapMove = async (action) => { action(); return true; },
  refresh = async () => {},
  getGeneration = () => 0,
  prefersReducedMotion: motionPreference = defaultPrefersReducedMotion,
  onError = (error) => console.warn('Cluster expansion failed:', error),
} = {}) {
  const onClick = async (event) => {
    const feature = event?.features?.[0];
    const clusterId = Number(feature?.properties?.cluster_id);
    const center = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
    const source = map.getSource?.(sourceId);
    const generation = getGeneration();
    const isCurrent = () => isActive() && getGeneration() === generation;
    if (!isActive() || !Number.isFinite(clusterId) || !Array.isArray(center)
      || typeof source?.getClusterExpansionZoom !== 'function') return;
    try {
      const zoom = await source.getClusterExpansionZoom(clusterId);
      if (!isCurrent() || !Number.isFinite(zoom)) return;
      const completed = await runMapMove(() => {
        if (isCurrent()) {
          map.easeTo({ center, zoom, duration: motionPreference() ? 0 : 350 });
        }
      });
      if (completed && isCurrent()) await refresh();
    } catch (error) {
      if (isCurrent() && error?.name !== 'AbortError') onError(error);
    }
  };
  const onEnter = () => {
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = 'pointer';
  };
  const onLeave = () => {
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = '';
  };
  map.on('click', layerId, onClick);
  map.on('mouseenter', layerId, onEnter);
  map.on('mouseleave', layerId, onLeave);
  return () => {
    map.off('click', layerId, onClick);
    map.off('mouseenter', layerId, onEnter);
    map.off('mouseleave', layerId, onLeave);
    onLeave();
  };
}

function incidentDetailRow(labelKey, value) {
  return `<div><dt>${escapeHtml(t(labelKey))}</dt><dd>${escapeHtml(value || t('summary.metricUnavailable'))}</dd></div>`;
}

function incidentDetailsHtml(properties = {}) {
  const occurred = formatLocalizedDate(properties.dispatch_date_time) || t('summary.metricUnavailable');
  return `<article><h3>${escapeHtml(t('map.incidentDetails'))}</h3><dl>${incidentDetailRow('map.incidentOffense', properties.text_general_code)}${incidentDetailRow('map.incidentOccurred', occurred)}${incidentDetailRow('map.incidentLocation', properties.location_block)}${incidentDetailRow('map.incidentDistrict', properties.dc_dist)}</dl></article>`;
}

export function attachIncidentDetails(map, {
  layerId = 'unclustered',
  createPopup = () => new maplibregl.Popup({ closeButton: true }),
} = {}) {
  let popup = null;
  let latestProperties = null;
  const closePopup = () => {
    popup?.remove();
    popup = null;
  };
  const releaseLanguage = onLanguageChange(() => {
    if (popup && latestProperties) popup.setHTML(incidentDetailsHtml(latestProperties));
  });
  const onClick = (event) => {
    const feature = event?.features?.[0];
    const coordinates = feature?.geometry?.type === 'Point'
      ? feature.geometry.coordinates?.slice()
      : null;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return;
    while (Math.abs(Number(event?.lngLat?.lng) - coordinates[0]) > 180) {
      coordinates[0] += Number(event.lngLat.lng) > coordinates[0] ? 360 : -360;
    }
    latestProperties = feature.properties || {};
    closePopup();
    popup = createPopup()
      .setLngLat(coordinates)
      .setHTML(incidentDetailsHtml(latestProperties))
      .addTo(map);
  };
  const onEnter = () => {
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = 'pointer';
  };
  const onLeave = () => {
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = '';
  };
  map.on('click', layerId, onClick);
  map.on('mouseenter', layerId, onEnter);
  map.on('mouseleave', layerId, onLeave);
  const cleanup = () => {
    map.off('click', layerId, onClick);
    map.off('mouseenter', layerId, onEnter);
    map.off('mouseleave', layerId, onLeave);
    onLeave();
    closePopup();
    releaseLanguage();
  };
  cleanup.closePopup = closePopup;
  return cleanup;
}

/**
 * Fetch GeoJSON points limited by time window and bbox, and render clusters/unclustered.
 * @param {import('maplibre-gl').Map} map
 * @param {{start:string,end:string,types?:string[]}} params
 */
const MAX_UNCLUSTERED = 20000;

export async function refreshPoints(map, {
  start,
  end,
  types,
  queryMode,
  selectedDistrictCode,
  signal,
  fetchPointsImpl = fetchPoints,
  shouldApply = () => true,
} = {}) {
  const { srcId, clusterId, clusterCountId, unclusteredId } = ensureSourcesAndLayers(map);

  const bbox = mapBboxTo3857(map);
  const dc_dist = queryMode === 'district' && selectedDistrictCode ? selectedDistrictCode : undefined;
  if (signal?.aborted) return { applied: false };
  const geo = await fetchPointsImpl({ start, end, types, bbox, dc_dist, signal });
  if (signal?.aborted || !shouldApply()) return { applied: false };
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
        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
        'text-size': 12
      },
      paint: {
        'text-color': clusterTextColorExpression()
      }
    });
  }

  // Unclustered single points
  const tooMany = count > MAX_UNCLUSTERED;
  const existsUnclustered = !!map.getLayer(unclusteredId);
  if (tooMany) {
    if (existsUnclustered) map.removeLayer(unclusteredId);
    ensureBanner('map.tooManyPoints');
  } else {
    if (count === 0) {
      ensureBanner('map.noPointIncidents');
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
  hideBanner();
}

function ensureBanner(key) {
  let el = document.getElementById('banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'banner';
    Object.assign(el.style, {
      background: 'rgba(255, 247, 233, 0.95)', color: '#7c2d12', padding: '8px 12px',
      border: '1px solid #facc15', borderRadius: '6px', zIndex: 30, font: '13px/1.4 system-ui, sans-serif'
    });
    document.body.appendChild(el);
  }
  setTranslatedText(el, key);
  el.style.display = 'block';
}

function hideBanner() {
  const el = document.getElementById('banner');
  if (el) el.style.display = 'none';
}
