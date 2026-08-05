import { fetchPoints } from '../api/crime.js';
import {
  buildOffenseColorExpression,
  buildOffenseHighlights,
} from '../utils/types.js';
import { makePalette } from '../utils/classify.js';
import { setTranslatedText } from '../i18n/index.js';
import { prefersReducedMotion as defaultPrefersReducedMotion } from './camera_fit.js';

const noticeActionHandlers = new WeakMap();
const pointSourceClusterModes = new WeakMap();

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

export function incidentResultKey(feature, { generation = 0, index = 0 } = {}) {
  if (feature?.id != null) return String(feature.id);
  const sourceRow = feature?.properties?.cartodb_id;
  if (sourceRow != null) return `carto:${sourceRow}`;
  return `result:${generation}:${index}`;
}

export function prepareIncidentGeoJson(geo, generation = 0) {
  const source = geo?.type === 'FeatureCollection' ? geo : { type: 'FeatureCollection', features: [] };
  const features = Array.isArray(source.features)
    ? source.features.map((feature, index) => {
      const key = incidentResultKey(feature, { generation, index });
      return {
        ...feature,
        id: key,
      };
    })
    : [];
  return { ...source, features };
}

/**
 * Fetch GeoJSON points limited by time window, bbox, and buffer radius, then render them.
 * @param {import('maplibre-gl').Map} map
 * @param {{start:string,end:string,types?:string[]}} params
 */
const MAX_UNCLUSTERED = 20000;

export async function refreshPoints(map, {
  start,
  end,
  types,
  center3857,
  radiusM,
  drilldownCodes,
  classPalette = 'Blues',
  queryMode = 'buffer',
  selectedDistrictCode,
  selectedTractGEOID,
  signal,
  resultGeneration = 0,
  fetchPointsImpl = fetchPoints,
  resolveTractGeometryImpl,
  shouldApply = () => true,
} = {}) {
  const { srcId, clusterId, clusterCountId, unclusteredId } = ensureSourcesAndLayers(map);

  const bbox = mapBboxTo3857(map);
  const dc_dist = queryMode === 'district' && selectedDistrictCode ? selectedDistrictCode : undefined;
  const bufferCenter = queryMode === 'buffer' ? center3857 : undefined;
  const bufferRadius = queryMode === 'buffer' ? radiusM : undefined;
  let tractGeometry;
  if (queryMode === 'tract' && selectedTractGEOID) {
    const resolver = resolveTractGeometryImpl
      || (await import('../charts/index.js')).resolveSelectedTractGeometry;
    tractGeometry = await resolver({ selectedTractGEOID, signal });
  }
  if (signal?.aborted || !shouldApply()) return { applied: false };
  const sourceGeo = await fetchPointsImpl({
    start,
    end,
    types,
    bbox,
    center3857: bufferCenter,
    radiusM: bufferRadius,
    dc_dist,
    queryMode,
    selectedTractGEOID,
    tractGeometry,
    signal,
  });
  if (signal?.aborted || !shouldApply()) return { applied: false };
  const geo = prepareIncidentGeoJson(sourceGeo, resultGeneration);
  const count = Array.isArray(geo?.features) ? geo.features.length : 0;
  const highlights = buildOffenseHighlights(drilldownCodes, makePalette(classPalette, 5));
  const tooMany = count > MAX_UNCLUSTERED;
  const shouldCluster = highlights.length === 0 || tooMany;
  const pointColorExpression = buildOffenseColorExpression(highlights);
  const pointStrokeColor = highlights.length ? '#172033' : '#fff';

  // Add or update source
  const existingSource = map.getSource(srcId);
  if (existingSource) {
    if (pointSourceClusterModes.get(existingSource) !== shouldCluster) {
      existingSource.setClusterOptions({ cluster: shouldCluster });
      pointSourceClusterModes.set(existingSource, shouldCluster);
    }
    existingSource.setData(geo);
  } else {
    map.addSource(srcId, {
      type: 'geojson',
      data: geo,
      cluster: shouldCluster,
      clusterMaxZoom: 14,
      clusterRadius: 40,
    });
    pointSourceClusterModes.set(map.getSource(srcId), shouldCluster);
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
  const existsUnclustered = map.getLayer(unclusteredId);
  if (tooMany) {
    if (existsUnclustered) map.removeLayer(unclusteredId);
    ensurePointsNotice({ map, key: 'map.tooManyPoints' });
  } else {
    if (count === 0) {
      ensurePointsNotice({ map, key: 'map.noPointIncidents' });
      if (existsUnclustered) map.removeLayer(unclusteredId);
      return {
        applied: true,
        generation: resultGeneration,
        status: 'empty',
        geo,
        count,
        tooMany,
      };
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
          'circle-color': pointColorExpression,
          'circle-stroke-color': pointStrokeColor,
          'circle-stroke-width': 0.8,
          'circle-opacity': 0.85,
        },
      });
    } else {
      map.setPaintProperty(unclusteredId, 'circle-color', pointColorExpression);
      map.setPaintProperty(unclusteredId, 'circle-stroke-color', pointStrokeColor);
    }
  }
  return {
    applied: true,
    generation: resultGeneration,
    status: tooMany ? 'dense' : 'ready',
    geo,
    count,
    tooMany,
  };
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

export function ensurePointsNotice({
  documentRef = globalThis.document,
  map,
  key,
  prefersReducedMotion: motionPreference = defaultPrefersReducedMotion,
} = {}) {
  let el = documentRef?.getElementById?.('banner');
  if (!el) {
    el = documentRef?.createElement?.('div');
    if (!el) return null;
    el.id = 'banner';
    el.className = 'points-notice';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    const message = documentRef.createElement('span');
    message.className = 'points-notice__message';
    el.appendChild(message);

    const action = documentRef.createElement('button');
    action.type = 'button';
    action.className = 'points-notice__action';
    setTranslatedText(action, 'map.zoomIn');
    el.appendChild(action);
    documentRef.body?.appendChild?.(el);
  }

  const message = el.querySelector?.('.points-notice__message');
  setTranslatedText(message, key);
  const action = el.querySelector?.('.points-notice__action');
  const actionable = key === 'map.tooManyPoints' && typeof map?.zoomIn === 'function';
  if (action) {
    action.hidden = !actionable;
    const previousHandler = noticeActionHandlers.get(action);
    if (previousHandler) action.removeEventListener('click', previousHandler);
    if (actionable) {
      const clickHandler = () => map.zoomIn({ duration: motionPreference() ? 0 : 300 });
      noticeActionHandlers.set(action, clickHandler);
      action.addEventListener('click', clickHandler);
    } else {
      noticeActionHandlers.delete(action);
    }
  }
  el.style.display = 'block';
  return el;
}

function hideBanner() {
  const el = globalThis.document?.getElementById?.('banner');
  if (el) el.style.display = 'none';
}
