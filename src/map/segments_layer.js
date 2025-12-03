import maplibregl from 'maplibre-gl';
import { submitSegmentFeedback } from '../routes_diary/form_submit.js';

/**
 * Route Safety Diary - Segments Layer
 *
 * Purpose: Render street segments with rating colors and confidence widths.
 */

const COLOR_BINS = [
  { max: 2.5, color: '#f87171' },    // risky
  { max: 3.4, color: '#fbbf24' },    // caution
  { max: 4.25, color: '#34d399' },   // safer
  { max: Infinity, color: '#10b981' } // safest
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
    'line-opacity': 0.9,
    'line-color': buildColorExpression(),
    'line-width': ['coalesce', ['get', 'line_width_px'], buildWidthExpression()],
    'line-blur': 0.05,
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
    const html = buildSegmentCardHtml(props, { mode: 'view' });
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

    const state = { mode: 'view', rating: 0, selectedTags: new Set(), thankYou: false };
    const render = () => {
      const html = buildSegmentCardHtml(props, state);
      popup.setLngLat(event.lngLat).setHTML(html).addTo(map);
      wirePopupInteractions(popup);
      wireSegmentCardBehavior(popup, props, state, render);
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
  if (!content) return;
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

function deriveTitle(props) {
  const name = props.street_name || props.name || props.street || props.segment_id || props.id || 'Segment';
  const dir = (props.direction || props.dir || props.oneway || '').toString().toUpperCase();
  let dirLabel = '';
  if (dir === 'B' || dir === 'BOTH') dirLabel = '';
  else if (dir === 'WB') dirLabel = 'Westbound';
  else if (dir === 'EB') dirLabel = 'Eastbound';
  else if (dir === 'NB') dirLabel = 'Northbound';
  else if (dir === 'SB') dirLabel = 'Southbound';
  const titled = dirLabel ? `${name} (${dirLabel})` : name;
  return titled;
}

function riskDescriptor(mean) {
  if (mean < 2.5) return { label: 'High risk', color: '#b91c1c' };
  if (mean < 4) return { label: 'Moderate risk', color: '#92400e' };
  return { label: 'Generally safe', color: '#15803d' };
}

function confidenceLabel(nEff) {
  if (nEff >= 50) return 'high confidence';
  if (nEff >= 10) return 'medium confidence';
  return 'low confidence';
}

function renderStars(value, { editable = false } = {}) {
  const stars = [];
  for (let i = 1; i <= 5; i += 1) {
    const filled = value >= i;
    stars.push(`<button type="button" class="diary-star ${filled ? 'filled' : ''} ${editable ? '' : 'readonly'}" data-role="star" data-value="${i}" ${editable ? '' : 'tabindex="-1" aria-hidden="true"'}>★</button>`);
  }
  return stars.join('');
}

function tagLabel(id) {
  const map = {
    aggressive_drivers: 'Aggressive drivers',
    poor_lighting: 'Poor lighting',
    construction: 'Construction',
    potholes: 'Potholes / road damage',
    missing_sidewalk: 'Missing sidewalk / bike lane',
    poor_signage: 'Poor signage',
    blind_spots: 'Blind spots',
    flooding: 'Flooding / ice',
    speeding: 'Speeding traffic',
    illegal_parking: 'Illegal parking',
    crime_risk: 'Feels personally unsafe',
  };
  return map[id] || id.replace(/_/g, ' ');
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
    tags.push({ id: 'aggressive_drivers', count: 85 });
    tags.push({ id: 'poor_lighting', count: 42 });
    tags.push({ id: 'construction', count: 12 });
  }
  return tags.slice(0, 3);
}

const ISSUE_TAGS = {
  infrastructure: [
    { id: 'potholes', label: tagLabel('potholes') },
    { id: 'missing_sidewalk', label: tagLabel('missing_sidewalk') },
    { id: 'poor_signage', label: tagLabel('poor_signage') },
    { id: 'construction', label: tagLabel('construction') },
  ],
  environment: [
    { id: 'poor_lighting', label: tagLabel('poor_lighting') },
    { id: 'blind_spots', label: tagLabel('blind_spots') },
    { id: 'flooding', label: tagLabel('flooding') },
  ],
  behavior: [
    { id: 'aggressive_drivers', label: tagLabel('aggressive_drivers') },
    { id: 'speeding', label: tagLabel('speeding') },
    { id: 'illegal_parking', label: tagLabel('illegal_parking') },
    { id: 'crime_risk', label: tagLabel('crime_risk') },
  ],
};

const RATING_COPY = {
  1: 'Very unsafe – I would avoid this segment if possible.',
  2: 'Unsafe – I felt clearly at risk here.',
  3: 'Average – I needed to stay alert.',
  4: 'Safe – only minor issues.',
  5: 'Very safe – comfortable and stress-free.',
};

function buildSegmentCardHtml(props, state = {}) {
  const mean = Number(props.decayed_mean ?? props.mean ?? 0) || 0;
  const nEff = Number(props.n_eff ?? props.N_EFF ?? 0) || 0;
  const topIssues = deriveTopIssues(props);
  const segmentId = props.segment_id || props.id || '';
  const title = deriveTitle(props);
  const agreeDisabled = props.__diaryVotes?.agreeDisabled;
  const saferDisabled = props.__diaryVotes?.saferDisabled;
  const mode = state.mode || 'view';
  const selectedTags = Array.from(state.selectedTags || []);
  const rating = state.rating || 0;
  const thankYou = !!state.thankYou;
  const risk = riskDescriptor(mean);
  const confidence = confidenceLabel(nEff);
  const scoreDisplay = mean ? mean.toFixed(1) : '—';
  const ratingCopy = rating ? RATING_COPY[rating] : 'Select how safe you felt on this segment.';
  const readonlyStars = renderStars(Math.round(mean), { editable: false });
  const editableStars = renderStars(rating, { editable: true });
  const topIssuesHtml = topIssues.length
    ? topIssues
      .map((t) => `<span class="diary-chip ${tagCategory(t.id)}">${tagLabel(t.id)}${t.count ? ` (${t.count})` : ''}</span>`)
      .join('')
    : '<div class="diary-muted-text">No issues reported yet.</div>';

  const thankYouLine = thankYou ? '<div class="diary-muted-text" style="margin-top:6px;">Thanks for your feedback — it will appear in the aggregate soon.</div>' : '';

  const inputTags = Object.entries(ISSUE_TAGS).map(([cat, items]) => {
    return `
      <div style="margin-top:6px;">
        <div class="diary-muted-text" style="text-transform:capitalize;">${cat}</div>
        <div class="diary-chip-group">
          ${items
            .map((item) => {
              const active = selectedTags.includes(item.id);
              return `<button type="button" class="diary-chip ${tagCategory(item.id)} ${active ? 'is-active' : ''}" data-role="tag" data-tag="${item.id}">${item.label}</button>`;
            })
            .join('')}
        </div>
      </div>
    `;
  }).join('');

  if (segmentId && typeof window !== 'undefined' && typeof window.__diary_hydrateCtaState === 'function') {
    try {
      window.__diary_hydrateCtaState(segmentId);
    } catch {}
  }

  const saferBtn = `<button data-diary-action="safer" data-segment-id="${segmentId}" ${saferDisabled ? 'disabled' : ''} aria-disabled="${saferDisabled}" class="diary-chip" style="border-style:dashed;align-self:flex-start;">Feels safer ✨</button>`;

  if (mode === 'input') {
    return `
      <div class="diary-segment-card">
        <div class="diary-segment-header">
          <div class="diary-segment-title">${title}</div>
          <button class="diary-segment-close" data-role="close" aria-label="Close">×</button>
        </div>
        <div class="diary-segment-stars" style="margin-bottom:4px;">${editableStars}</div>
        <div class="diary-muted-text">${ratingCopy}</div>
        <div style="margin-top:10px;font-weight:700;font-size:12px;">What were the main issues?</div>
        ${inputTags}
        <div class="diary-segment-actions" style="justify-content:flex-end;">
          <button type="button" class="diary-chip secondary" data-role="cancel-feedback">Cancel</button>
          <button type="button" class="diary-chip primary" data-role="submit-feedback" ${rating < 1 ? 'disabled' : ''}>Submit rating</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="diary-segment-card">
      <div class="diary-segment-header">
        <div class="diary-segment-title">${title}</div>
        <button class="diary-segment-close" data-role="close" aria-label="Close">×</button>
      </div>
      <div class="diary-segment-score-row">
        <div class="diary-segment-score">${scoreDisplay}</div>
        <div>
          <div class="diary-segment-stars">${readonlyStars}</div>
          <div class="diary-segment-risk-label"><span style="color:${risk.color};font-weight:700;">${risk.label}</span> — Based on ${nEff || 'few'} reports (${confidence})</div>
          ${thankYouLine}
        </div>
      </div>
      <div style="margin-top:8px;">
        <div class="diary-muted-text" style="font-weight:700;color:#0f172a;">Top issues</div>
        <div class="diary-chip-group" style="margin-top:4px;">${topIssuesHtml}</div>
      </div>
      <div class="diary-segment-actions">
        <button data-diary-action="agree" data-segment-id="${segmentId}" class="diary-chip secondary" ${agreeDisabled ? 'disabled' : ''}>Agree</button>
        <button data-role="enter-edit" class="diary-chip primary">Add Feedback</button>
      </div>
      <div style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">${saferBtn}</div>
    </div>
  `;
}

function wireSegmentCardBehavior(popup, props, state, rerender) {
  const el = popup.getElement();
  const card = el?.querySelector('.diary-segment-card');
  if (!card) return;
  const segmentId = props.segment_id || props.id;
  card.querySelectorAll('[data-role="close"]').forEach((btn) => {
    btn.addEventListener('click', () => popup.remove());
  });
  const enter = card.querySelector('[data-role="enter-edit"]');
  if (enter) {
    enter.addEventListener('click', () => {
      state.mode = 'input';
      if (!state.rating) state.rating = Math.max(1, Math.round(Number(props.decayed_mean ?? props.mean ?? 3)));
      rerender();
    });
  }
  card.querySelectorAll('[data-role="star"]').forEach((star) => {
    star.addEventListener('click', () => {
      const val = Number(star.getAttribute('data-value')) || 0;
      state.rating = val;
      rerender();
    });
  });
  card.querySelectorAll('[data-role="tag"]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const id = chip.getAttribute('data-tag');
      if (!state.selectedTags) state.selectedTags = new Set();
      if (state.selectedTags.has(id)) state.selectedTags.delete(id);
      else state.selectedTags.add(id);
      rerender();
    });
  });
  const cancel = card.querySelector('[data-role="cancel-feedback"]');
  if (cancel) {
    cancel.addEventListener('click', () => {
      state.mode = 'view';
      state.rating = 0;
      state.selectedTags = new Set();
      state.thankYou = false;
      rerender();
    });
  }
  const submit = card.querySelector('[data-role="submit-feedback"]');
  if (submit) {
    submit.addEventListener('click', () => {
      if (!state.rating) return;
      const payload = {
        segmentId,
        rating: state.rating,
        tags: Array.from(state.selectedTags || []),
      };
      submitSegmentFeedback(payload);
      state.mode = 'view';
      state.thankYou = true;
      rerender();
    });
  }
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
