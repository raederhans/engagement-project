import maplibregl from 'maplibre-gl';
import { escapeHtml } from '../utils/html.js';
import { t } from '../i18n/index.js';
import {
  DIARY_SEGMENTS_SOURCE_ID,
  DIARY_SEGMENTS_LAYER_ID,
  DIARY_SEGMENTS_HIT_LAYER_ID,
  DIARY_SEGMENTS_HIGHLIGHT_SOURCE_ID,
  DIARY_SEGMENTS_HIGHLIGHT_LAYER_ID,
} from '../routes_diary/map_ids.js';
import {
  normalizeFeatureCollection,
  normalizeSegmentFeature,
  SEGMENT_ID_PROP,
  SCORE_PROP,
  NEFF_PROP,
  STREET_NAME_PROP,
  TAGS_PROP,
  CLASS_PROP,
} from '../routes_diary/data_normalization.js';

/**
 * Route Safety Diary - Segments Layer
 *
 * Purpose: Render demonstration street segments and static illustrative cards.
 */

const COLOR_BINS = [
  { max: 2.5, color: '#64748b' },     // low experience rating
  { max: 3.4, color: '#3b82f6' },     // middle experience rating
  { max: 4.25, color: '#7c3aed' },    // high experience rating
  { max: Infinity, color: '#5b21b6' } // highest experience rating
];

const clickRegistrations = new Map();
let activePinnedPopup = null;
let activePinnedSegmentId = null;
let highlightCleanup = null;

/**
 * Mount segments layer on map (MapLibre vector layer)
 */
export function mountSegmentsLayer(map, sourceId, data, ownership = {}) {
  if (!map) return;
  const sid = sourceId || DIARY_SEGMENTS_SOURCE_ID;
  const prepared = prepareFeatureCollection(data);
  ensureSource(map, sid, prepared);
  const layerId = DIARY_SEGMENTS_LAYER_ID;
  const hitLayerId = DIARY_SEGMENTS_HIT_LAYER_ID;
  ensureLineLayer(map, hitLayerId, sid, {
    'line-opacity': 0.05,
    'line-color': '#0f172a',
    'line-width': 12,
    'line-blur': 0,
  });
  ensureLineLayer(map, layerId, sid, {
    'line-opacity': 0.9,
    'line-color': buildColorExpression(),
    'line-width': ['coalesce', ['get', 'line_width_px'], buildWidthExpression()],
    'line-blur': 0.05,
  });

  registerClickHandlers(map, hitLayerId, ownership);
}

export function closeSegmentPopup() {
  closePinnedPopup();
}

/**
 * Update segment data after new ratings submitted
 */
export function updateSegmentsData(map, sourceId, featureCollection) {
  if (!map) return;
  const sid = sourceId || DIARY_SEGMENTS_SOURCE_ID;
  const source = map.getSource(sid);
  if (!source) {
    console.warn('[Diary] segments source missing; update skipped.', sid);
    return;
  }
  source.setData(prepareFeatureCollection(featureCollection));
}

/**
 * Animate segment glow effect (placeholder for future phases)
 */
function glowSegment(map, sourceId, segmentId, duration = 2000) {
  void map;
  void sourceId;
  void segmentId;
  void duration;
  // TODO (Phase 3+): Implement glow animation using requestAnimationFrame
}

/**
 * Remove segments layer from map
 */
export function removeSegmentsLayer(map, sourceId) {
  if (!map) return;
  cleanupSegmentHighlight(map);
  const sid = sourceId || DIARY_SEGMENTS_SOURCE_ID;
  const layerId = DIARY_SEGMENTS_LAYER_ID;
  const hitLayerId = DIARY_SEGMENTS_HIT_LAYER_ID;
  cleanupClickHandlers(map, hitLayerId);
  for (const id of [layerId, hitLayerId]) {
    if (map.getLayer(id)) {
      map.removeLayer(id);
    } else {
      console.info('[Diary] removeSegmentsLayer: layer not found', id);
    }
  }
  if (map.getSource(sid)) {
    map.removeSource(sid);
  } else {
    console.info('[Diary] removeSegmentsLayer: source not found', sid);
  }
}

export function colorForMean(mean) {
  const value = Number.isFinite(mean) ? mean : 3;
  for (const bin of COLOR_BINS) {
    if (value <= bin.max) {
      return bin.color;
    }
  }
  return COLOR_BINS[COLOR_BINS.length - 1].color;
}

export function widthForNEff(nEff) {
  const value = Math.max(0, Number.isFinite(nEff) ? nEff : 0);
  const px = 1 + 0.15 * Math.sqrt(value);
  return Math.max(1, Math.min(4, px));
}

export function highlightSegments(map, segmentFeatures, {
  durationMs = 1500,
  scheduler = globalThis,
  addCleanup,
} = {}) {
  if (!map || !Array.isArray(segmentFeatures)) return;
  cleanupSegmentHighlight(map);

  const fc = {
    type: 'FeatureCollection',
    features: segmentFeatures.filter(Boolean),
  };

  map.addSource(DIARY_SEGMENTS_HIGHLIGHT_SOURCE_ID, { type: 'geojson', data: fc });
  map.addLayer({
    id: DIARY_SEGMENTS_HIGHLIGHT_LAYER_ID,
    type: 'line',
    source: DIARY_SEGMENTS_HIGHLIGHT_SOURCE_ID,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['+', ['coalesce', ['get', 'line_width_px'], 3], 2],
      'line-opacity': 0.9,
      'line-blur': 0.2,
    },
  });

  console.info('[Diary] Highlighting', segmentFeatures.length, 'segments for', durationMs, 'ms');
  let cleaned = false;
  let timeoutId = null;
  let ownedCleanup = null;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timeoutId != null) scheduler.clearTimeout(timeoutId);
    if (map.getLayer(DIARY_SEGMENTS_HIGHLIGHT_LAYER_ID)) {
      try { map.removeLayer(DIARY_SEGMENTS_HIGHLIGHT_LAYER_ID); } catch {}
    }
    if (map.getSource(DIARY_SEGMENTS_HIGHLIGHT_SOURCE_ID)) {
      try { map.removeSource(DIARY_SEGMENTS_HIGHLIGHT_SOURCE_ID); } catch {}
    }
    if (highlightCleanup === ownedCleanup) highlightCleanup = null;
    console.info('[Diary] Removed highlight layer');
  };
  ownedCleanup = typeof addCleanup === 'function' ? addCleanup(cleanup) : cleanup;
  highlightCleanup = ownedCleanup;
  timeoutId = scheduler.setTimeout(() => ownedCleanup(), durationMs);
}

function cleanupSegmentHighlight(map) {
  if (typeof highlightCleanup === 'function') {
    highlightCleanup();
    return;
  }
  if (map.getLayer(DIARY_SEGMENTS_HIGHLIGHT_LAYER_ID)) {
    try { map.removeLayer(DIARY_SEGMENTS_HIGHLIGHT_LAYER_ID); } catch {}
  }
  if (map.getSource(DIARY_SEGMENTS_HIGHLIGHT_SOURCE_ID)) {
    try { map.removeSource(DIARY_SEGMENTS_HIGHLIGHT_SOURCE_ID); } catch {}
  }
}

function classWidth(classValue) {
  const cls = Number(classValue);
  if (cls === 1) return 3.8;
  if (cls === 2) return 3.0;
  if (cls === 3) return 2.2;
  return 1.5;
}

function prepareFeatureCollection(collection) {
  const fc = normalizeFeatureCollection(collection, normalizeSegmentFeature);
  fc.features = fc.features.map((f) => {
    const props = f.properties || {};
    const nEff = Number.isFinite(props[NEFF_PROP]) ? props[NEFF_PROP] : 0;
    const cls = Number.isFinite(props[CLASS_PROP]) ? props[CLASS_PROP] : 3;
    return {
      ...f,
      properties: {
        ...props,
        line_width_px: Math.min(4, widthForNEff(nEff) + (classWidth(cls) - 1.5)),
        class: cls,
      },
    };
  });
  return fc;
}

function buildColorExpression() {
  const expression = ['step', ['coalesce', ['get', SCORE_PROP], 3], COLOR_BINS[0].color];
  for (let i = 0; i < COLOR_BINS.length - 1; i += 1) {
    expression.push(COLOR_BINS[i].max, COLOR_BINS[i + 1].color);
  }
  return expression;
}

function buildWidthExpression() {
  return ['min', 4, ['max', 1.5, ['+', 1, ['*', 0.15, ['sqrt', ['max', ['coalesce', ['get', NEFF_PROP], 0], 0]]]]]];
}

function cleanupClickHandlers(map, layerId) {
  const entry = clickRegistrations.get(layerId);
  if (!entry || !map) return;
  map.off('click', layerId, entry.clickHandler);
  map.off('click', entry.mapClickHandler);
  if (activePinnedPopup) {
    activePinnedPopup.remove();
    activePinnedPopup = null;
    activePinnedSegmentId = null;
  }
  clickRegistrations.delete(layerId);
}

function closePinnedPopup() {
  if (activePinnedPopup) {
    activePinnedPopup.remove();
    activePinnedPopup = null;
    activePinnedSegmentId = null;
  }
}

function focusSegment(map, feature) {
  if (!map || !feature || !feature.geometry) return;
  const geometry = feature.geometry;
  const coords = geometry.type === 'LineString'
    ? geometry.coordinates
    : geometry.type === 'MultiLineString'
      ? geometry.coordinates.flat()
      : [];
  if (coords.length >= 2) {
    const lngs = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    const bounds = [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ];
    map.fitBounds(bounds, { padding: 100, maxZoom: 16, duration: 600 });
    return;
  }
  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    map.easeTo({ center: geometry.coordinates, zoom: Math.max(map.getZoom() || 12, 15), duration: 600 });
  }
}

function registerClickHandlers(map, layerId, {
  signal,
  isCurrent = () => true,
  canInteract = () => true,
} = {}) {
  cleanupClickHandlers(map, layerId);
  if (!map || !layerId) return;
  const ownerIsCurrent = () => !signal?.aborted && isCurrent();
  const interactionIsCurrent = () => ownerIsCurrent() && canInteract();

  const clickHandler = (event) => {
    if (!interactionIsCurrent()) return;
    const feature = event.features && event.features[0];
    if (!feature) return;
    const props = feature.properties || {};
    const segmentId = props[SEGMENT_ID_PROP];

    if (segmentId && segmentId === activePinnedSegmentId && activePinnedPopup) {
      return;
    }

    closePinnedPopup();
    focusSegment(map, feature);

    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      className: 'diary-hover-card diary-segment-card-pinned',
      offset: 12,
      maxWidth: '320px',
    });

    const state = { submissionResult: null };
    const render = () => {
      if (!interactionIsCurrent()) return;
      const html = buildSegmentCardHtml(props, state);
      popup.setLngLat(event.lngLat).setHTML(html).addTo(map);
      wireSegmentCardBehavior(popup);
    };
    render();
    activePinnedPopup = popup;
    activePinnedSegmentId = segmentId || null;

    popup.on('close', () => {
      closePinnedPopup();
    });
  };

  const mapClickHandler = (event) => {
    if (event.originalEvent && event.originalEvent.target && event.originalEvent.target.closest('.maplibregl-popup')) {
      return;
    }
    const features = map.queryRenderedFeatures(event.point, { layers: [layerId] });
    if ((!features || features.length === 0) && activePinnedPopup) {
      closePinnedPopup();
    }
  };

  map.on('click', layerId, clickHandler);
  map.on('click', mapClickHandler);
  clickRegistrations.set(layerId, { clickHandler, mapClickHandler });
}

function deriveTitle(props) {
  const name = props[STREET_NAME_PROP] || props.name || props.street || props[SEGMENT_ID_PROP] || props.id || t('segment.name');
  const dir = (props.direction || props.dir || props.oneway || '').toString().toUpperCase();
  let dirLabel = '';
  if (dir === 'B' || dir === 'BOTH') dirLabel = '';
  else if (dir === 'WB') dirLabel = t('segment.westbound');
  else if (dir === 'EB') dirLabel = t('segment.eastbound');
  else if (dir === 'NB') dirLabel = t('segment.northbound');
  else if (dir === 'SB') dirLabel = t('segment.southbound');
  const titled = dirLabel ? `${name} (${dirLabel})` : name;
  return titled;
}

function tagLabel(id) {
  const key = `tag.${id}`;
  const translated = t(key);
  return translated === key ? id.replace(/_/g, ' ') : translated;
}

function tagCategory(id) {
  const infra = ['potholes', 'missing_sidewalk', 'poor_signage', 'construction'];
  const env = ['poor_lighting', 'blind_spots', 'flooding'];
  if (infra.includes(id)) return 'is-infra';
  if (env.includes(id)) return 'is-env';
  return 'is-behavior';
}

function deriveTopIssues(props) {
  const tags = [];
  if (Array.isArray(props.top_tags)) {
    props.top_tags.forEach((t) => {
      if (typeof t === 'string') tags.push({ id: t, count: null });
      else if (t?.tag) tags.push({ id: t.tag, count: t.p });
    });
  } else if (props.tag_counts && typeof props.tag_counts === 'object') {
    Object.entries(props.tag_counts).forEach(([id, count]) => tags.push({ id, count }));
  }
  if (!tags.length) {
    tags.push({ id: 'aggressive_drivers', count: null });
    tags.push({ id: 'poor_lighting', count: null });
    tags.push({ id: 'construction', count: null });
  }
  return tags.slice(0, 3);
}

export function buildSegmentCardHtml(props, state = {}) {
  const topIssues = deriveTopIssues(props);
  const title = escapeHtml(deriveTitle(props));
  const submissionResult = state.submissionResult;
  const boundary = escapeHtml(t('segment.sampleBoundary'));
  const topIssuesHtml = topIssues.length
    ? topIssues
      .map((t) => {
        const label = escapeHtml(tagLabel(String(t.id || '')));
        return `<span class="diary-chip ${tagCategory(t.id)}">${label}</span>`;
      })
      .join('')
    : `<div class="diary-muted-text">${escapeHtml(t('segment.noIssues'))}</div>`;

  const submissionLine = submissionResult
    ? `<div class="diary-muted-text diary-segment-feedback-status">${segmentSubmissionMessage(submissionResult)}</div>`
    : '';
  return `
    <div class="diary-segment-card" role="group" aria-label="${boundary}" title="${boundary}" data-sample-status="static-invented-read-only" data-sample-disclosure="${boundary}">
      <div class="diary-segment-header">
        <div class="diary-segment-title">${title}</div>
        <button class="diary-segment-close" data-role="close" aria-label="${escapeHtml(t('segment.close'))}">×</button>
      </div>
      <div class="diary-muted-text diary-segment-heading">${escapeHtml(t('segment.communityScore'))}</div>
      <p class="diary-muted-text diary-segment-sample-boundary">${boundary}</p>
      ${submissionLine}
      <div class="diary-segment-issues-summary">
        <div class="diary-muted-text diary-segment-heading">${escapeHtml(t('segment.topIssues'))}</div>
        <div class="diary-chip-group diary-chip-group--compact">${topIssuesHtml}</div>
      </div>
    </div>
  `;
}

function wireSegmentCardBehavior(popup) {
  const el = popup.getElement();
  const card = el?.querySelector('.diary-segment-card');
  if (!card) return;
  card.querySelectorAll('[data-role="close"]').forEach((btn) => {
    btn.addEventListener('click', () => popup.remove());
  });
}

export async function submitSegmentCardFeedback({
  props,
  state,
  rerender = () => {},
  submitFeedback,
  signal,
  isCurrent = () => true,
}) {
  if (!state?.rating || signal?.aborted || !isCurrent()) return null;
  if (typeof submitFeedback !== 'function') {
    throw new TypeError('Diary segment feedback submit port is required.');
  }
  const segmentId = props?.[SEGMENT_ID_PROP] || props?.id;
  const response = await submitFeedback({
    segmentId,
    rating: state.rating,
    tags: Array.from(state.selectedTags || []),
  }, { signal });
  if (signal?.aborted || !isCurrent()) return null;
  state.mode = 'view';
  state.submissionResult = response;
  state.submissionError = '';
  rerender();
  return response;
}

function segmentSubmissionMessage() {
  return t('segment.publicWriteUnavailable');
}

function ensureSource(map, id, data) {
  if (!map || !id) return null;
  const normalized = Array.isArray(data?.features) ? data : prepareFeatureCollection(data);
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
  const basePaint = {
    'line-opacity': 0.85,
    'line-color': '#0ea5e9',
    'line-width': 2,
    'line-blur': 0,
    ...paint,
  };
  if (map.getLayer(layerId)) {
    Object.entries(basePaint).forEach(([key, value]) => {
      map.setPaintProperty(layerId, key, value);
    });
    return;
  }
  map.addLayer({
    id: layerId,
    type: 'line',
    source: sourceId,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: basePaint,
  });
}

const clone = (obj) => (typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));
