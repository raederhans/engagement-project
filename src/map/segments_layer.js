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
  const source = map.getSource(sourceId);
  if (!source) {
    map.addSource(sourceId, { type: 'geojson', data: prepared });
  } else {
    source.setData(prepared);
  }

  const layerId = `${sourceId}-line`;
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId);
  }

  map.addLayer({
    id: layerId,
    type: 'line',
    source: sourceId,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-opacity': 0.85,
      'line-color': buildColorExpression(),
      'line-width': ['coalesce', ['get', 'line_width_px'], buildWidthExpression()],
      'line-blur': 0.4,
    },
  });

  registerHoverHandlers(map, layerId);
}

/**
 * Update segment data after new ratings submitted
 */
export function updateSegmentsData(map, sourceId, featureCollection) {
  if (!map) return;
  const source = map.getSource(sourceId);
  if (!source) {
    mountSegmentsLayer(map, sourceId, featureCollection);
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
  cleanupHoverHandlers(map, layerId);
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId);
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
      line_width_px: widthForNEff(nEff),
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
  return ['min', 4, ['max', 1, ['+', 1, ['*', 0.15, ['sqrt', ['max', ['coalesce', ['get', 'n_eff'], 0], 0]]]]]];
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
    const html = buildHoverHtml(props);
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

function buildHoverHtml(props) {
  const mean = Number(props.decayed_mean ?? 3).toFixed(1);
  const nEff = Number(props.n_eff ?? 1).toFixed(1);
  const delta = Number(props.delta_30d ?? 0).toFixed(2);
  const tags = formatTags(props.top_tags);
  const street = props.street || props.segment_id || 'Segment';
  const votes = props.__diaryVotes || {};
  const segmentId = props.segment_id || '';
  const agreeDisabled = votes.agreeDisabled ? 'disabled' : '';
  const saferDisabled = votes.saferDisabled ? 'disabled' : '';
  const agreeTitle = votes.agreeDisabled ? 'Thanks for your feedback' : 'Agree with this rating';
  const saferTitle = votes.saferDisabled ? 'Thanks for your feedback' : 'Flag as feeling safer';
  return `
    <div style="min-width:240px;font:12px/1.4 system-ui;color:#111;">
      <div style="font-weight:600;margin-bottom:4px;">${street}</div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;font-size:11px;">
        <div><div style="color:#6b7280;text-transform:uppercase;font-size:10px;">Mean</div><div style="font-size:16px;font-weight:600;color:${colorForMean(Number(props.decayed_mean))};">${mean}</div></div>
        <div><div style="color:#6b7280;text-transform:uppercase;font-size:10px;">n_eff</div><div style="font-size:16px;font-weight:600;">${nEff}</div></div>
        <div><div style="color:#6b7280;text-transform:uppercase;font-size:10px;">Δ30d</div><div style="font-size:13px;font-weight:600;color:${Number(delta) >= 0 ? '#059669' : '#b91c1c'};">${delta}</div></div>
      </div>
      <div style="margin-top:6px;font-size:11px;color:#374151;">Top tags: ${tags}</div>
      <div style="margin-top:8px;display:flex;gap:8px;">
        <button data-diary-action="agree" data-segment-id="${segmentId}" ${agreeDisabled} title="${agreeTitle}" style="flex:1;padding:6px 8px;border-radius:999px;border:1px solid #cbd5f5;background:${votes.agreeDisabled ? '#e2e8f0' : '#fff'};cursor:${votes.agreeDisabled ? 'not-allowed' : 'pointer'};font-size:11px;font-weight:600;">Agree</button>
        <button data-diary-action="safer" data-segment-id="${segmentId}" ${saferDisabled} title="${saferTitle}" style="flex:1;padding:6px 8px;border-radius:999px;border:1px solid #cbd5f5;background:${votes.saferDisabled ? '#e2e8f0' : '#fff'};cursor:${votes.saferDisabled ? 'not-allowed' : 'pointer'};font-size:11px;font-weight:600;">Feels safer</button>
      </div>
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

const clone = (obj) => (typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));
