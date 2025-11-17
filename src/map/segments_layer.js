import maplibregl from 'maplibre-gl';

/**
 * Route Safety Diary - Segments Layer
 *
 * Purpose: Render street segments with rating colors and confidence widths.
 */

const COLOR_BINS = [
  { max: 1.8, color: '#d73027' },
  { max: 2.6, color: '#fc8d59' },
  { max: 3.4, color: '#fee08b' },
  { max: 4.2, color: '#91cf60' },
  { max: Infinity, color: '#1a9850' },
];

const hoverRegistrations = new Map();
const clickRegistrations = new Map();
let activePinnedPopup = null;
let activePinnedSegmentId = null;
let hoverActionHandler = null;

export function registerSegmentActionHandler(handler) {
  hoverActionHandler = handler;
}

/**
 * Mount segments layer on map (MapLibre vector layer)
 */
export function mountSegmentsLayer(map, sourceId, data) {
  if (!map) return;
  const prepared = prepareFeatureCollection(data);
  ensureSource(map, sourceId, prepared);
  const layerId = `${sourceId}-line`;
  const hitLayerId = `${sourceId}-hit`;
  ensureLineLayer(map, hitLayerId, sourceId, {
    'line-opacity': 0.05,
    'line-color': '#0f172a',
    'line-width': 12,
    'line-blur': 0,
  });
  ensureLineLayer(map, layerId, sourceId, {
    'line-opacity': 0.85,
    'line-color': buildColorExpression(),
    'line-width': ['coalesce', ['get', 'line_width_px'], buildWidthExpression()],
    'line-blur': 0.15,
  });

  registerClickHandlers(map, hitLayerId);
}

/**
 * Update segment data after new ratings submitted
 */
export function updateSegmentsData(map, sourceId, featureCollection) {
  if (!map) return;
  const source = map.getSource(sourceId);
  if (!source) {
    console.warn('[Diary] segments source missing; update skipped.');
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
  const layerId = `${sourceId}-line`;
  const hitLayerId = `${sourceId}-hit`;
  cleanupHoverHandlers(map, hitLayerId);
  cleanupClickHandlers(map, hitLayerId);
  for (const id of [layerId, hitLayerId]) {
    if (map.getLayer(id)) {
      map.removeLayer(id);
    }
  }
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
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

function classWidth(classValue) {
  const cls = Number(classValue);
  if (cls === 1) return 3.8;
  if (cls === 2) return 3.0;
  if (cls === 3) return 2.2;
  return 1.5;
}

function prepareFeatureCollection(collection) {
  const base = collection && collection.type === 'FeatureCollection' ? clone(collection) : { type: 'FeatureCollection', features: [] };
  base.features = (base.features || []).map((feature, idx) => {
    const f = clone(feature);
    const props = { ...(f.properties || {}) };
    const mean = Number.isFinite(props.decayed_mean) ? props.decayed_mean : 3;
    const nEff = Number.isFinite(props.n_eff) ? props.n_eff : 1;
    const delta = Number.isFinite(props.delta_30d) ? props.delta_30d : 0;
    const tags = Array.isArray(props.top_tags) ? props.top_tags : [];
    f.properties = {
      ...props,
      segment_id: typeof props.segment_id === 'string' ? props.segment_id : `seg_${idx + 1}`,
      decayed_mean: Math.min(5, Math.max(1, mean)),
      n_eff: Math.max(0, nEff),
      delta_30d: delta,
      top_tags: tags,
      line_width_px: Math.min(4, widthForNEff(nEff) + (classWidth(props.class) - 1.5)),
      class: props.class ?? 3,
    };
    return f;
  });
  return base;
}

function buildColorExpression() {
  const expression = ['step', ['coalesce', ['get', 'decayed_mean'], 3], COLOR_BINS[0].color];
  for (let i = 0; i < COLOR_BINS.length - 1; i += 1) {
    expression.push(COLOR_BINS[i].max, COLOR_BINS[i + 1].color);
  }
  return expression;
}

function buildWidthExpression() {
  return ['min', 4, ['max', 1.5, ['+', 1, ['*', 0.15, ['sqrt', ['max', ['coalesce', ['get', 'n_eff'], 0], 0]]]]]];
}

function registerHoverHandlers(map, layerId) {
  cleanupHoverHandlers(map, layerId);
  if (!map || !layerId) return;

  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'diary-hover-card',
    offset: 12,
  });
  wirePopupInteractions(popup);

  let popupVisible = false;

  const moveHandler = (event) => {
    const feature = event.features && event.features[0];
    if (!feature) return;
    const props = feature.properties || {};
    const html = buildSegmentCardHtml(props);
    if (!popupVisible) {
      popup.addTo(map);
      popupVisible = true;
    }
    popup.setLngLat(event.lngLat).setHTML(html);
    if (map.getCanvas()) {
      map.getCanvas().style.cursor = 'pointer';
    }
  };

  const leaveHandler = () => {
    if (popupVisible) {
      popup.remove();
      popupVisible = false;
    }
    if (map.getCanvas()) {
      map.getCanvas().style.cursor = '';
    }
  };

  map.on('mousemove', layerId, moveHandler);
  map.on('mouseleave', layerId, leaveHandler);

  hoverRegistrations.set(layerId, { moveHandler, leaveHandler, popup });
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

function registerClickHandlers(map, layerId) {
  cleanupClickHandlers(map, layerId);
  if (!map || !layerId) return;

  const clickHandler = (event) => {
    const feature = event.features && event.features[0];
    if (!feature) return;
    const props = feature.properties || {};
    const segmentId = props.segment_id;

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

    const html = buildSegmentCardHtml(props);
    popup.setLngLat(event.lngLat).setHTML(html).addTo(map);
    wirePopupInteractions(popup);
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

function cleanupHoverHandlers(map, layerId) {
  const entry = hoverRegistrations.get(layerId);
  if (!entry || !map) return;
  map.off('mousemove', layerId, entry.moveHandler);
  map.off('mouseleave', layerId, entry.leaveHandler);
  entry.popup?.remove();
  hoverRegistrations.delete(layerId);
}

function wirePopupInteractions(popup) {
  if (!popup || !popup.getElement) return;
  const el = popup.getElement();
  const content = el?.querySelector('.maplibregl-popup-content');
  if (!content || content.__diaryBound) return;
  content.__diaryBound = true;
  content.addEventListener('click', (event) => {
    const target = event.target.closest('[data-diary-action]');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const disabled = target.hasAttribute('disabled');
    if (disabled) return;
    const action = target.getAttribute('data-diary-action');
    const segmentId = target.getAttribute('data-segment-id');
    target.setAttribute('disabled', 'disabled');
    target.style.cursor = 'not-allowed';
    if (typeof hoverActionHandler === 'function' && action && segmentId) {
      hoverActionHandler({ action, segmentId });
    }
  });
}

function buildSegmentCardHtml(props) {
  const mean = Number(props.decayed_mean ?? 3).toFixed(1);
  const nEff = Number(props.n_eff ?? 1).toFixed(1);
  const delta = Number(props.delta_30d ?? 0).toFixed(2);
  const tags = formatTags(props.top_tags);
  const street = props.street || props.segment_id || 'Segment';
  const segmentId = props.segment_id || '';
  if (segmentId && typeof window !== 'undefined' && typeof window.__diary_hydrateCtaState === 'function') {
    try {
      window.__diary_hydrateCtaState(segmentId);
    } catch {}
  }
  let ctaState = props.__diaryVotes || {};
  if (segmentId && typeof window !== 'undefined' && typeof window.__diary_getCtaState === 'function') {
    try {
      const latest = window.__diary_getCtaState(segmentId);
      if (latest) ctaState = latest;
    } catch {}
  }
  const agreeDisabled = ctaState.agreeDisabled;
  const saferDisabled = ctaState.saferDisabled;
  const agreeTitle = agreeDisabled ? 'Recorded for this session' : 'Agree with this rating';
  const saferTitle = saferDisabled ? 'Recorded for this session' : 'Flag as feeling safer';
  const hint = agreeDisabled || saferDisabled ? '<div style="margin-top:6px;font-size:10px;color:#94a3b8;">Recorded for this session</div>' : '';
  return `
    <div style="min-width:240px;max-width:320px;max-height:400px;overflow-y:auto;font:12px/1.4 system-ui;color:#111;padding-right:2px;">
      <div style="font-weight:600;margin-bottom:4px;">${street}</div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;font-size:11px;">
        <div><div style="color:#6b7280;text-transform:uppercase;font-size:10px;">Mean</div><div style="font-size:16px;font-weight:600;color:${colorForMean(Number(props.decayed_mean))};">${mean}</div></div>
        <div><div style="color:#6b7280;text-transform:uppercase;font-size:10px;">n_eff</div><div style="font-size:16px;font-weight:600;">${nEff}</div></div>
        <div><div style="color:#6b7280;text-transform:uppercase;font-size:10px;">Δ30d</div><div style="font-size:13px;font-weight:600;color:${Number(delta) >= 0 ? '#059669' : '#b91c1c'};">${delta}</div></div>
      </div>
      <div style="margin-top:6px;font-size:11px;color:#374151;">Top tags: ${tags}</div>
      <div style="margin-top:8px;display:flex;gap:8px;">
        <button data-diary-action="agree" data-segment-id="${segmentId}" ${agreeDisabled ? 'disabled' : ''} aria-disabled="${agreeDisabled}" title="${agreeTitle}" style="flex:1;padding:6px 8px;border-radius:999px;border:1px solid #cbd5f5;background:${agreeDisabled ? '#e2e8f0' : '#fff'};cursor:${agreeDisabled ? 'not-allowed' : 'pointer'};font-size:11px;font-weight:600;">Agree 👍</button>
        <button data-diary-action="safer" data-segment-id="${segmentId}" ${saferDisabled ? 'disabled' : ''} aria-disabled="${saferDisabled}" title="${saferTitle}" style="flex:1;padding:6px 8px;border-radius:999px;border:1px solid #cbd5f5;background:${saferDisabled ? '#e2e8f0' : '#fff'};cursor:${saferDisabled ? 'not-allowed' : 'pointer'};font-size:11px;font-weight:600;">Feels safer ✨</button>
      </div>
      ${hint}
      <div style="margin-top:4px;font-size:10px;color:#6b7280;">Community perception (unverified)</div>
    </div>
  `;
}

function formatTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return 'none';
  return tags
    .slice(0, 4)
    .map((tag) => {
      if (typeof tag === 'string') return `${tag}(1.00)`;
      const label = tag?.tag || 'unknown';
      const prob = Number.isFinite(tag?.p) ? Number(tag.p) : 0;
      return `${label}(${prob.toFixed(2)})`;
    })
    .join(', ');
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
