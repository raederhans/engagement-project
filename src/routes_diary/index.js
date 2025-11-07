/**
 * Route Safety Diary - Main Orchestrator
 *
 * Responsibilities implemented for M1 U0/U1:
 *  - Load demo segments/routes when the diary flag is on
 *  - Log dataset counts (for preflight validation)
 *  - Mount the baseline segments layer with hover affordances
 *
 * Remaining TODOs (Recorder dock, modal wiring, etc.) stay below for the next packet.
 */

import { mountSegmentsLayer, updateSegmentsData, removeSegmentsLayer } from '../map/segments_layer.js';
import { drawRouteOverlay, clearRouteOverlay } from '../map/routing_overlay.js';
import { openRatingModal, closeRatingModal } from './form_submit.js';
import { weightFor, bayesianShrink, effectiveN, clampMean } from '../utils/decay.js';

const SEGMENT_SOURCE_ID = 'diary-segments';
const ROUTE_OVERLAY_SOURCE_ID = 'diary-route-overlay';
const ALT_ROUTE_SOURCE_ID = 'diary-alt-route';
const SEGMENT_URL_CANDIDATES = [
  '/data/segments_phl.demo.geojson',
  new URL('../../data/segments_phl.demo.geojson', import.meta.url).href,
];
const ROUTE_URL_CANDIDATES = [
  '/data/routes_phl.demo.geojson',
  new URL('../../data/routes_phl.demo.geojson', import.meta.url).href,
];

const DEFAULT_SEGMENT_PROPS = {
  decayed_mean: 3,
  n_eff: 1,
  delta_30d: 0,
  top_tags: [],
};

const segmentLookup = new Map();

let cachedSegments = null;
let cachedRoutes = null;
let mapRef = null;
let layerMounted = false;
let lastLoadedSegments = null;
let lastLoadedRoutes = null;
let routesRef = null;
let routeById = new Map();
let diaryPanelEl = null;
let routeSelectEl = null;
let summaryStripEl = null;
let rateButtonEl = null;
let altToggleEl = null;
let altSummaryEl = null;
let currentRoute = null;
let toastEl = null;
let toastTimer = null;
const USER_HASH_KEY = 'diary_demo_user_hash';
let cachedUserHash = null;
const localAgg = new Map();
let baseSegmentsFC = null;
const HALF_LIFE_DAYS = 21;
const PRIOR_MEAN = 3.0;
const PRIOR_N = 5;
const LOW_RATING_THRESHOLD = 2.6;

const clone = (obj) => (typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));

async function fetchJsonWithFallback(label, urls) {
  let lastError;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) {
        throw new Error(`${label} request failed (${res.status})`);
      }
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error(`${label} data unavailable`);
}

function ensureFeatureCollection(payload, label) {
  if (!payload || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw new Error(`[Diary] Invalid ${label} file — expected FeatureCollection`);
  }
  return payload;
}

function normalizeTopTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => {
      if (typeof tag === 'string') return { tag, p: 1 };
      if (tag && typeof tag.tag === 'string') {
        return { tag: tag.tag, p: Number.isFinite(tag.p) ? Number(tag.p) : 0 };
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeSegmentsCollection(collection) {
  const fc = clone(collection);
  fc.features = (fc.features || []).map((feature, idx) => {
    const f = clone(feature);
    const props = { ...(f.properties || {}) };
    const segmentId = typeof props.segment_id === 'string' && props.segment_id.trim() ? props.segment_id.trim() : `seg_demo_${idx + 1}`;
    const decayedMean = Number.isFinite(props.decayed_mean) ? props.decayed_mean : DEFAULT_SEGMENT_PROPS.decayed_mean;
    const nEff = Number.isFinite(props.n_eff) ? props.n_eff : DEFAULT_SEGMENT_PROPS.n_eff;
    const delta30d = Number.isFinite(props.delta_30d) ? props.delta_30d : DEFAULT_SEGMENT_PROPS.delta_30d;
    const topTags = normalizeTopTags(props.top_tags ?? DEFAULT_SEGMENT_PROPS.top_tags);
    f.properties = {
      ...props,
      segment_id: segmentId,
      street: props.street || 'Unknown',
      decayed_mean: Math.min(5, Math.max(1, decayedMean)),
      n_eff: Math.max(0, nEff),
      delta_30d: delta30d,
      top_tags: topTags,
    };
    return f;
  });
  return fc;
}

function normalizeRoutesCollection(collection) {
  const fc = clone(collection);
  fc.features = (fc.features || []).map((feature, idx) => {
    const f = clone(feature);
    const props = { ...(f.properties || {}) };
    const ids = Array.isArray(props.segment_ids) ? props.segment_ids.map((id) => String(id)) : [];
    if (ids.length === 0) {
      throw new Error(`[Diary] Route feature at index ${idx} is missing segment_ids array.`);
    }
    f.properties = {
      route_id: typeof props.route_id === 'string' ? props.route_id : `route_demo_${idx + 1}`,
      name: props.name || 'Demo route',
      mode: props.mode || 'walk',
      from: props.from || 'Unknown',
      to: props.to || 'Unknown',
      length_m: Number(props.length_m) || 0,
      duration_min: Number(props.duration_min) || 0,
      segment_ids: ids,
    };
    return f;
  });
  return fc;
}

function logMissingSegments(routes, segments) {
  const segmentIds = new Set((segments.features || []).map((f) => f?.properties?.segment_id));
  const issues = [];
  for (const route of routes.features || []) {
    const missing = route.properties.segment_ids.filter((id) => !segmentIds.has(id));
    if (missing.length) {
      issues.push(`${route.properties.route_id}: ${missing.join(', ')}`);
    }
  }
  if (issues.length) {
    console.warn('[Diary] Route seed references missing segments:', issues.join(' | '));
  }
}

function buildSegmentLookup(collection) {
  segmentLookup.clear();
  if (!collection || !Array.isArray(collection.features)) return;
  collection.features.forEach((feature) => {
    const id = feature?.properties?.segment_id;
    if (id) {
      segmentLookup.set(id, feature);
    }
  });
}

function ensureRouteIndex(routes) {
  routeById = new Map();
  if (!routes || !Array.isArray(routes.features)) return;
  routes.features.forEach((feature) => {
    const id = feature?.properties?.route_id;
    if (id) {
      routeById.set(id, feature);
    }
  });
}

function initLocalAggFromSegments(featureCollection) {
  localAgg.clear();
  baseSegmentsFC = clone(featureCollection);
  if (!featureCollection || !Array.isArray(featureCollection.features)) return;
  featureCollection.features.forEach((feature) => {
    const props = feature.properties || {};
    const id = props.segment_id;
    if (!id) return;
    const mean = Number.isFinite(props.decayed_mean) ? props.decayed_mean : 3;
    const nEff = Number.isFinite(props.n_eff) ? props.n_eff : 1;
    const delta = Number.isFinite(props.delta_30d) ? props.delta_30d : 0;
    const tags = Array.isArray(props.top_tags) ? props.top_tags : [];
    localAgg.set(id, {
      mean,
      sumW: Math.max(0, nEff),
      n_eff: Math.max(0, nEff),
      top_tags: tags,
      tagCounts: toCounts(tags),
      updated: new Date().toISOString(),
      win30: { sum: mean * Math.max(1, nEff), w: Math.max(1, nEff) },
      delta_30d: delta,
    });
  });
}

function toCounts(tagPairs) {
  const map = Object.create(null);
  for (const pair of tagPairs) {
    if (!pair || !pair.tag) continue;
    map[pair.tag] = Math.max(1, map[pair.tag] || 0);
  }
  return map;
}

function diaryFlagOff() {
  console.warn('[Diary] Feature flag is OFF. Set VITE_FEATURE_DIARY=1 to enable.');
}

function ensureMap(message) {
  if (!mapRef) {
    throw new Error(message || '[Diary] Map instance missing');
  }
  return mapRef;
}

function ensureDiaryPanel(routes) {
  if (typeof document === 'undefined') return;
  if (!routes) return;

  if (!diaryPanelEl) {
    const panel = document.createElement('div');
    panel.id = 'diary-route-panel';
    panel.style.position = 'absolute';
    panel.style.top = '88px';
    panel.style.left = '24px';
    panel.style.width = '280px';
    panel.style.zIndex = '20';
    panel.style.background = 'rgba(255,255,255,0.95)';
    panel.style.border = '1px solid #e5e7eb';
    panel.style.borderRadius = '12px';
    panel.style.boxShadow = '0 10px 30px rgba(15,23,42,0.08)';
    panel.style.padding = '16px';
    panel.style.font = '13px/1.4 "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    panel.style.color = '#0f172a';

    const title = document.createElement('div');
    title.textContent = 'Route Safety Diary (demo)';
    title.style.fontWeight = '600';
    title.style.fontSize = '14px';
    title.style.marginBottom = '8px';
    panel.appendChild(title);

    const selectLabel = document.createElement('label');
    selectLabel.textContent = 'Choose a demo route';
    selectLabel.style.display = 'block';
    selectLabel.style.fontSize = '12px';
    selectLabel.style.textTransform = 'uppercase';
    selectLabel.style.letterSpacing = '0.05em';
    selectLabel.style.color = '#64748b';
    selectLabel.style.marginBottom = '4px';
    panel.appendChild(selectLabel);

    routeSelectEl = document.createElement('select');
    routeSelectEl.style.width = '100%';
    routeSelectEl.style.border = '1px solid #cbd5f5';
    routeSelectEl.style.borderRadius = '8px';
    routeSelectEl.style.padding = '6px 10px';
    routeSelectEl.style.marginBottom = '12px';
    routeSelectEl.style.fontSize = '13px';
    routeSelectEl.addEventListener('change', (event) => {
      const routeId = event.target.value;
      if (routeId) {
        selectRoute(routeId, { fitBounds: true });
      }
    });
    panel.appendChild(routeSelectEl);

    summaryStripEl = document.createElement('div');
    summaryStripEl.id = 'diary-route-summary';
    summaryStripEl.style.borderRadius = '10px';
    summaryStripEl.style.background = '#f8fafc';
    summaryStripEl.style.border = '1px solid #e2e8f0';
    summaryStripEl.style.padding = '10px';
    summaryStripEl.style.minHeight = '72px';
    summaryStripEl.style.display = 'flex';
    summaryStripEl.style.flexDirection = 'column';
    summaryStripEl.style.gap = '4px';
    summaryStripEl.textContent = 'Select a route to see its details.';
    panel.appendChild(summaryStripEl);

    const altToggleRow = document.createElement('label');
    altToggleRow.style.display = 'flex';
    altToggleRow.style.alignItems = 'center';
    altToggleRow.style.gap = '8px';
    altToggleRow.style.marginTop = '12px';
    altToggleRow.style.fontSize = '12px';
    altToggleRow.style.color = '#475569';
    altToggleEl = document.createElement('input');
    altToggleEl.type = 'checkbox';
    altToggleEl.style.cursor = 'pointer';
    altToggleEl.addEventListener('change', () => {
      updateAlternativeRoute();
    });
    const altToggleText = document.createElement('span');
    altToggleText.textContent = 'Show alternative route';
    altToggleRow.appendChild(altToggleEl);
    altToggleRow.appendChild(altToggleText);
    panel.appendChild(altToggleRow);

    altSummaryEl = document.createElement('div');
    altSummaryEl.style.marginTop = '8px';
    altSummaryEl.style.borderRadius = '10px';
    altSummaryEl.style.background = '#f1f5f9';
    altSummaryEl.style.border = '1px solid #dbeafe';
    altSummaryEl.style.padding = '10px';
    altSummaryEl.style.fontSize = '12px';
    altSummaryEl.style.color = '#334155';
    altSummaryEl.textContent = 'Toggle the switch to compare safer detours.';
    panel.appendChild(altSummaryEl);

    rateButtonEl = document.createElement('button');
    rateButtonEl.type = 'button';
    rateButtonEl.textContent = 'Rate this route';
    rateButtonEl.style.marginTop = '12px';
    rateButtonEl.style.width = '100%';
    rateButtonEl.style.padding = '10px 12px';
    rateButtonEl.style.border = 'none';
    rateButtonEl.style.borderRadius = '8px';
    rateButtonEl.style.fontWeight = '600';
    rateButtonEl.style.fontSize = '13px';
    rateButtonEl.style.background = '#0f172a';
    rateButtonEl.style.color = '#fff';
    rateButtonEl.style.cursor = 'pointer';
    rateButtonEl.disabled = true;
    rateButtonEl.style.opacity = '0.6';
    rateButtonEl.addEventListener('click', () => {
      if (!rateButtonEl.disabled) {
        openRouteRating();
      }
    });
    panel.appendChild(rateButtonEl);

    document.body.appendChild(panel);
    diaryPanelEl = panel;
  }

  populateRouteOptions(routes);
}

function populateRouteOptions(routes) {
  if (!routeSelectEl || !routes?.features) return;
  const previous = routeSelectEl.value;
  routeSelectEl.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a route';
  routeSelectEl.appendChild(placeholder);
  routes.features.forEach((feature) => {
    const props = feature.properties || {};
    const option = document.createElement('option');
    option.value = props.route_id;
    option.textContent = props.name || props.route_id;
    routeSelectEl.appendChild(option);
  });
  if (previous) {
    routeSelectEl.value = previous;
  }
}

function renderRouteSummary(route) {
  if (!summaryStripEl) return;
  if (!route) {
    summaryStripEl.textContent = 'Select a route to see its details.';
    return;
  }
  const props = route.properties || {};
  const pieces = [
    `<strong>${props.from || 'Start'}</strong> → <strong>${props.to || 'Destination'}</strong>`,
    `Mode: ${props.mode || 'walk'}`,
    `Length: ${(props.length_m || 0).toLocaleString()} m`,
    `Duration: ${props.duration_min || 0} min`,
  ];
  summaryStripEl.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:#0f172a;">${props.name || props.route_id}</div>
    <div style="font-size:12px;color:#334155;">${pieces[0]}</div>
    <div style="font-size:12px;color:#475569;display:flex;gap:8px;flex-wrap:wrap;">
      <span>${pieces[1]}</span>
      <span>${pieces[2]}</span>
      <span>${pieces[3]}</span>
    </div>`;
}

function selectRoute(routeId, { fitBounds = false } = {}) {
  if (!routeId || !routeById.has(routeId)) return;
  const feature = routeById.get(routeId);
  currentRoute = feature;
  renderRouteSummary(feature);
  if (routeSelectEl && routeSelectEl.value !== routeId) {
    routeSelectEl.value = routeId;
  }
  if (rateButtonEl) {
    rateButtonEl.disabled = false;
    rateButtonEl.style.opacity = '1';
  }
  if (mapRef) {
    drawRouteOverlay(mapRef, ROUTE_OVERLAY_SOURCE_ID, feature, { color: '#312e81', width: 5, dasharray: [0.3, 1], opacity: 0.85 });
    if (fitBounds) {
      fitMapToRoute(feature);
    }
  }
  updateAlternativeRoute();
}

function fitMapToRoute(route) {
  if (!mapRef || typeof mapRef.fitBounds !== 'function') return;
  const coordinates = extractLineCoordinates(route?.geometry);
  if (!coordinates.length) return;
  let minLng = coordinates[0][0];
  let maxLng = coordinates[0][0];
  let minLat = coordinates[0][1];
  let maxLat = coordinates[0][1];
  coordinates.forEach(([lng, lat]) => {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });
  if (Number.isFinite(minLng) && Number.isFinite(maxLng) && Number.isFinite(minLat) && Number.isFinite(maxLat)) {
    mapRef.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 80, duration: 650 }
    );
  }
}

function extractLineCoordinates(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') {
    return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  }
  if (geometry.type === 'MultiLineString') {
    return (geometry.coordinates || []).flat();
  }
  return [];
}

function openRouteRating() {
  if (!currentRoute) return;
  openRatingModal({
    routeFeature: currentRoute,
    segmentLookup,
    userHash: getUserHash(),
    onSuccess: ({ payload, response }) => {
      handleDiarySubmissionSuccess(payload, response);
    },
  });
}

function handleDiarySubmissionSuccess(payload, response) {
  if (!payload) return;
  applyDiarySubmissionToAgg(payload);
  const refreshed = buildSegmentsFCFromBase();
  if (refreshed && mapRef) {
    updateSegmentsData(mapRef, SEGMENT_SOURCE_ID, refreshed);
    lastLoadedSegments = refreshed;
  }
  updateAlternativeRoute({ refreshOnly: true });
  showToast('Thanks — your feedback has been recorded for this demo.');
  console.info('[Diary] submit payload', payload);
  console.info('[Diary] stub response', response);
}

function applyDiarySubmissionToAgg(payload) {
  if (!payload || !Array.isArray(payload.segment_ids)) return;
  const now = Date.now();
  const overall = Number(payload.overall_rating);
  const tags = Array.isArray(payload.tags) ? payload.tags : [];
  const overrides = normalizeOverrides(payload.segment_overrides);
  for (const segId of payload.segment_ids) {
    const rating = overrides.has(segId) ? overrides.get(segId) : overall;
    if (!Number.isFinite(rating)) continue;
    if (!localAgg.has(segId)) {
      localAgg.set(segId, {
        mean: 3,
        sumW: 0,
        n_eff: 0,
        top_tags: [],
        tagCounts: Object.create(null),
        updated: new Date(now).toISOString(),
        win30: { sum: 0, w: 0 },
        delta_30d: 0,
      });
    }
    const record = localAgg.get(segId);
    decayAggRecord(record, now);
    const wNew = 1;
    const sumW = record.sumW + wNew;
    const meanRaw = (record.mean * record.sumW + rating * wNew) / Math.max(1e-6, sumW);
    const shrunk = clampMean(bayesianShrink(meanRaw, sumW, PRIOR_MEAN, PRIOR_N));
    const prevWinMean = record.win30.w > 0 ? record.win30.sum / record.win30.w : record.mean;
    record.sumW = sumW;
    record.mean = shrunk;
    record.n_eff = effectiveN(sumW);
    record.updated = new Date(now).toISOString();
    for (const tag of tags) {
      if (!record.tagCounts[tag]) record.tagCounts[tag] = 0;
      record.tagCounts[tag] += 1;
    }
    const totalTag = Object.values(record.tagCounts).reduce((sum, val) => sum + val, 0);
    record.top_tags = totalTag > 0
      ? Object.entries(record.tagCounts)
          .map(([tag, count]) => ({ tag, p: Number((count / totalTag).toFixed(2)) }))
          .sort((a, b) => b.p - a.p)
          .slice(0, 5)
      : [];
    record.win30.sum = record.win30.sum + shrunk;
    record.win30.w = Math.min(100, record.win30.w + 1);
    record.delta_30d = Number((shrunk - prevWinMean).toFixed(2));
  }
}

function decayAggRecord(record, now) {
  if (!record) return;
  const last = Date.parse(record.updated || now);
  const factor = weightFor(last || now, now, HALF_LIFE_DAYS);
  if (Number.isFinite(factor) && factor > 0 && factor <= 1) {
    record.sumW *= factor;
    record.win30.sum *= factor;
    record.win30.w *= factor;
  }
}

function buildSegmentsFCFromBase() {
  if (!baseSegmentsFC) return null;
  const fc = clone(baseSegmentsFC);
  fc.features = fc.features.map((feature) => {
    const f = clone(feature);
    const props = { ...(f.properties || {}) };
    const agg = localAgg.get(props.segment_id);
    if (agg) {
      props.decayed_mean = agg.mean;
      props.n_eff = agg.n_eff;
      props.top_tags = agg.top_tags;
      props.delta_30d = agg.delta_30d;
      props.updated = agg.updated;
    }
    f.properties = props;
    return f;
  });
  return fc;
}

function normalizeOverrides(list) {
  const map = new Map();
  if (!list) return map;
  if (Array.isArray(list)) {
    list.forEach((entry) => {
      if (!entry || !entry.segment_id) return;
      const value = Number(entry.rating);
      if (!Number.isFinite(value)) return;
      map.set(entry.segment_id, value);
    });
    return map;
  }
  if (typeof list === 'object') {
    Object.entries(list).forEach(([segmentId, rating]) => {
      const value = Number(rating);
      if (segmentId && Number.isFinite(value)) {
        map.set(segmentId, value);
      }
    });
  }
  return map;
}

function updateAlternativeRoute({ refreshOnly = false } = {}) {
  if (!mapRef) return;
  if (!currentRoute) {
    clearRouteOverlay(mapRef, ALT_ROUTE_SOURCE_ID);
    renderAltSummary(null, { reason: 'no-route' });
    return;
  }
  const shouldShow = altToggleEl?.checked;
  const altInfo = resolveAlternativeForRoute(currentRoute);
  if (!shouldShow) {
    clearRouteOverlay(mapRef, ALT_ROUTE_SOURCE_ID);
    renderAltSummary(currentRoute, null);
    return;
  }
  if (!altInfo) {
    clearRouteOverlay(mapRef, ALT_ROUTE_SOURCE_ID);
    renderAltSummary(currentRoute, null);
    return;
  }
  if (!refreshOnly) {
    drawRouteOverlay(mapRef, ALT_ROUTE_SOURCE_ID, altInfo.feature, {
      color: '#0ea5e9',
      width: 4,
      opacity: 0.7,
      dasharray: [0.5, 1],
    });
  }
  renderAltSummary(currentRoute, altInfo);
}

function resolveAlternativeForRoute(routeFeature) {
  if (!routeFeature) return null;
  const props = routeFeature.properties || {};
  const altIds = Array.isArray(props.alt_segment_ids) && props.alt_segment_ids.length > 0 ? props.alt_segment_ids : props.segment_ids || [];
  const altLength = Number.isFinite(props.alt_length_m) ? props.alt_length_m : props.length_m;
  const altDuration = Number.isFinite(props.alt_duration_min) ? props.alt_duration_min : props.duration_min;
  let geometry = props.alt_geometry;
  if (!geometry && altIds.length > 0) {
    geometry = buildGeometryFromSegments(altIds);
  }
  if (!geometry) return null;
  return {
    feature: {
      type: 'Feature',
      geometry,
      properties: {
        route_id: `${props.route_id || 'route'}_alt`,
      },
    },
    meta: {
      segment_ids: altIds,
      alt_length_m: Number(altLength),
      alt_duration_min: Number(altDuration),
    },
  };
}

function buildGeometryFromSegments(segmentIds) {
  if (!segmentIds || segmentIds.length === 0) return null;
  const coords = [];
  segmentIds.forEach((id, idx) => {
    const feature = segmentLookup.get(id);
    if (!feature || !feature.geometry) {
      console.warn('[Diary] Missing geometry for alt segment', id);
      return;
    }
    const lineCoords = extractLineCoordinates(feature.geometry);
    if (lineCoords.length === 0) return;
    if (coords.length === 0) {
      coords.push(...lineCoords);
    } else {
      const last = coords[coords.length - 1];
      const first = lineCoords[0];
      if (last && first && last[0] === first[0] && last[1] === first[1]) {
        coords.push(...lineCoords.slice(1));
      } else {
        coords.push(...lineCoords);
      }
    }
  });
  return coords.length >= 2 ? { type: 'LineString', coordinates: coords } : null;
}

function renderAltSummary(route, altInfo) {
  if (!altSummaryEl) return;
  if (!route) {
    altSummaryEl.textContent = 'Select a route to compare alternatives.';
    return;
  }
  if (!altToggleEl || !altToggleEl.checked) {
    altSummaryEl.textContent = 'Toggle the switch to compare safer detours.';
    return;
  }
  if (!altInfo) {
    altSummaryEl.textContent = 'Current route is best for now.';
    return;
  }
  const summary = summarizeAltBenefit(route, altInfo.meta);
  if (!summary) {
    altSummaryEl.textContent = 'Alternative data unavailable.';
    return;
  }
  const avoided = summary.pLow - summary.aLow;
  if (avoided <= 0) {
    altSummaryEl.textContent = 'Current route is best for now.';
    return;
  }
  const deltaLabel = summary.deltaMin > 0 ? `+${summary.deltaMin} min` : `${summary.deltaMin} min`;
  const pctLabel = `≈${summary.overheadPct.toFixed(1)}%`;
  altSummaryEl.innerHTML = `
    <div style="font-weight:600;color:#0f172a;font-size:12px;">Alternative benefit</div>
    <div style="font-size:12px;color:#334155;">${deltaLabel}, ${pctLabel}, avoids ${avoided} low-rated segment${avoided === 1 ? '' : 's'}.</div>
  `;
}

function summarizeAltBenefit(primaryRoute, altMeta) {
  if (!primaryRoute || !altMeta) return null;
  const primaryIds = primaryRoute.properties?.segment_ids || [];
  const altIds = altMeta.segment_ids || [];
  const primaryLow = countLowRated(primaryIds);
  const altLow = countLowRated(altIds);
  const primaryLength = Number(primaryRoute.properties?.length_m) || 0;
  const altLength = Number(altMeta.alt_length_m ?? primaryLength) || primaryLength;
  const primaryDuration = Number(primaryRoute.properties?.duration_min) || 0;
  const altDuration = Number(altMeta.alt_duration_min ?? primaryDuration) || primaryDuration;
  const overheadPct = primaryLength > 0 ? ((altLength - primaryLength) / primaryLength) * 100 : 0;
  const deltaMin = Number((altDuration - primaryDuration).toFixed(1));
  return {
    pLow: primaryLow,
    aLow: altLow,
    overheadPct,
    deltaMin,
  };
}

function countLowRated(segmentIds) {
  if (!segmentIds) return 0;
  return segmentIds.reduce((sum, id) => {
    const rating = getCurrentSegmentMean(id);
    return sum + (rating < LOW_RATING_THRESHOLD ? 1 : 0);
  }, 0);
}

function getCurrentSegmentMean(segId) {
  if (localAgg.has(segId)) {
    return localAgg.get(segId).mean;
  }
  const feature = segmentLookup.get(segId);
  const props = feature?.properties || {};
  return Number.isFinite(props.decayed_mean) ? props.decayed_mean : 3;
}

function getUserHash() {
  if (cachedUserHash) return cachedUserHash;
  try {
    const existing = window?.sessionStorage?.getItem(USER_HASH_KEY);
    if (existing) {
      cachedUserHash = existing;
      return cachedUserHash;
    }
  } catch {}
  cachedUserHash = `demo_${Math.random().toString(36).slice(2, 10)}`;
  try {
    window?.sessionStorage?.setItem(USER_HASH_KEY, cachedUserHash);
  } catch {}
  return cachedUserHash;
}

function showToast(message, duration = 2600) {
  if (typeof document === 'undefined') return;
  if (toastEl) {
    toastEl.remove();
    toastEl = null;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  }
  const wrapper = document.createElement('div');
  wrapper.textContent = message;
  wrapper.style.position = 'fixed';
  wrapper.style.top = '24px';
  wrapper.style.left = '50%';
  wrapper.style.transform = 'translateX(-50%)';
  wrapper.style.background = '#0f172a';
  wrapper.style.color = '#fff';
  wrapper.style.padding = '10px 16px';
  wrapper.style.borderRadius = '999px';
  wrapper.style.boxShadow = '0 12px 30px rgba(15,23,42,0.25)';
  wrapper.style.font = '13px/1.4 "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  wrapper.style.zIndex = '2000';
  document.body.appendChild(wrapper);
  toastEl = wrapper;
  toastTimer = setTimeout(() => {
    wrapper.remove();
    toastEl = null;
    toastTimer = null;
  }, duration);
}

export async function loadDemoSegments({ force = false } = {}) {
  if (cachedSegments && !force) {
    return clone(cachedSegments);
  }
  const payload = await fetchJsonWithFallback('segments', SEGMENT_URL_CANDIDATES);
  cachedSegments = normalizeSegmentsCollection(ensureFeatureCollection(payload, 'segments'));
  return clone(cachedSegments);
}

export async function loadDemoRoutes({ force = false } = {}) {
  if (cachedRoutes && !force) {
    return clone(cachedRoutes);
  }
  const payload = await fetchJsonWithFallback('routes', ROUTE_URL_CANDIDATES);
  cachedRoutes = normalizeRoutesCollection(ensureFeatureCollection(payload, 'routes'));
  return clone(cachedRoutes);
}

/**
 * Initialize Route Safety Diary mode
 * @param {MapLibreMap} map - MapLibre GL map instance
 */
export async function initDiaryMode(map) {
  const stats = { segmentsCount: 0, routesCount: 0 };
  if (import.meta?.env?.VITE_FEATURE_DIARY !== '1') {
    diaryFlagOff();
    return stats;
  }

  if (!map) {
    console.warn('[Diary] initDiaryMode called without a MapLibre instance.');
    return stats;
  }

  mapRef = map;

  try {
    const [segments, routes] = await Promise.all([loadDemoSegments(), loadDemoRoutes()]);
    lastLoadedSegments = hydratedSegments;
    lastLoadedRoutes = routes;
    stats.segmentsCount = segments.features.length;
    stats.routesCount = routes.features.length;
    console.info('[Diary] segments loaded:', stats.segmentsCount);
    console.info('[Diary] routes loaded:', stats.routesCount);
    logMissingSegments(routes, segments);
    buildSegmentLookup(segments);
    ensureRouteIndex(routes);
    initLocalAggFromSegments(segments);
    const hydratedSegments = buildSegmentsFCFromBase() || segments;

    if (layerMounted) {
      updateSegmentsData(mapRef, SEGMENT_SOURCE_ID, hydratedSegments);
    } else {
      mountSegmentsLayer(mapRef, SEGMENT_SOURCE_ID, hydratedSegments);
      layerMounted = true;
    }

    routesRef = routes;
    ensureDiaryPanel(routes);
    const defaultRoute = routes.features?.[0];
    if (defaultRoute?.properties?.route_id) {
      if (routeSelectEl) {
        routeSelectEl.value = defaultRoute.properties.route_id;
      }
      selectRoute(defaultRoute.properties.route_id, { fitBounds: false });
    }
  } catch (err) {
    console.error('Demo data missing; please ensure files exist under /data/*.demo.geojson.', err);
  }

  return stats;
}

/**
 * Teardown diary mode (cleanup)
 * @param {MapLibreMap} map - MapLibre GL map instance
 */
export function teardownDiaryMode(map) {
  const targetMap = map || mapRef;
  if (!targetMap) return;
  removeSegmentsLayer(targetMap, SEGMENT_SOURCE_ID);
  clearRouteOverlay(targetMap, ROUTE_OVERLAY_SOURCE_ID);
  clearRouteOverlay(targetMap, ALT_ROUTE_SOURCE_ID);
  layerMounted = false;
  closeRatingModal();
  if (diaryPanelEl) {
    diaryPanelEl.remove();
    diaryPanelEl = null;
    routeSelectEl = null;
    summaryStripEl = null;
    rateButtonEl = null;
    altToggleEl = null;
    altSummaryEl = null;
  }
  currentRoute = null;
  if (toastEl) {
    toastEl.remove();
    toastEl = null;
  }
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  console.info('[Diary] Teardown complete.');
}

/**
 * Create RecorderDock UI (floating bottom-right)
 * @returns {HTMLElement} Dock element
 */
function createRecorderDock() {
  // TODO: Create floating div with 3 buttons (Start/Pause/Finish)
  // TODO: Wire event handlers
  // TODO: Inject CSS
  // See: docs/SCENARIO_MAPPING.md (Scenario 1, RecorderDock)
}

/**
 * Create mode selector (optional TopBar extension)
 * @returns {HTMLElement} Mode selector element
 */
function createModeSelector() {
  // TODO: Create mode switcher with 3 buttons (Crime/Diary/Tracts)
  // TODO: Wire mode switch handlers
  // See: docs/SCENARIO_MAPPING.md (Scenario 1, TopBar)
}

/**
 * Create diary controls in LeftPanel
 */
function createDiaryControls() {
  // TODO: Extend existing left panel with diary buttons
  // TODO: Plan route (disabled), Record trip, My routes (disabled), Legend
  // See: docs/SCENARIO_MAPPING.md (Scenario 1, LeftPanel)
}

/**
 * Initialize insights panel (RightPanel placeholders)
 */
function initInsightsPanel() {
  // TODO: Add 3 placeholder boxes (Trend, Tags, Heatmap)
  // TODO: Replace placeholders with Chart.js canvases after first rating
  // See: docs/SCENARIO_MAPPING.md (Scenario 3, Insights)
}

/**
 * Populate insights panel with real data
 * @param {Array} updatedSegments - Segments with new ratings
 */
function populateInsightsPanel(updatedSegments) {
  // TODO: Render trend chart (8-week sparkline)
  // TODO: Render top tags chart (3 horizontal bars)
  // TODO: Render 7x24 heatmap
  // See: docs/DIARY_EXEC_PLAN_M1.md (Phase 4)
}

/**
 * Handle segment click event
 * @param {string} segmentId - Segment ID
 * @param {object} lngLat - Click coordinates {lng, lat}
 */
function onSegmentClick(segmentId, lngLat) {
  // TODO: Fetch segment details (mock data for M1)
  // TODO: Create floating SegmentCard near click point
  // TODO: Wire action buttons (Agree, Feels safer, View insights)
  // See: docs/SCENARIO_MAPPING.md (Scenario 4, SegmentCard)
}

/**
 * Close segment card
 */
function closeSegmentCard() {
  // TODO: Remove SegmentCard from DOM
}

/**
 * Open community details modal
 * @param {string} segmentId - Segment ID
 */
function openCommunityDetailsModal(segmentId) {
  // TODO: Fetch full segment analytics (mock data for M1)
  // TODO: Create full-screen modal with backdrop
  // TODO: Render 7 sections (overview, trend, distribution, tags, timeline, privacy)
  // TODO: Wire close handlers (X button, backdrop click)
  // See: docs/SCENARIO_MAPPING.md (Scenario 4, CommunityDetailsModal)
}

/**
 * Close community details modal
 */
function closeCommunityDetailsModal() {
  // TODO: Remove modal from DOM
}

// GPS Recording state machine
let recordingState = 'idle'; // 'idle' | 'recording' | 'paused' | 'finished'
let mockGPSTrace = [];
let gpsInterval = null;

/**
 * Handle "Start" button click
 */
function onStartRecording() {
  // TODO: Set state to 'recording'
  // TODO: Start mock GPS generation (1 point/sec)
  // TODO: Update button states
  // See: docs/DIARY_EXEC_PLAN_M1.md (Phase 2)
}

/**
 * Handle "Pause" button click
 */
function onPauseRecording() {
  // TODO: Set state to 'paused'
  // TODO: Stop GPS generation (clear interval)
  // TODO: Update button states
}

/**
 * Handle "Finish" button click
 */
function onFinishRecording() {
  // TODO: Set state to 'finished'
  // TODO: Stop GPS generation
  // TODO: Open RatingModal with mockGPSTrace
  // TODO: Reset state after modal closed
  // See: docs/DIARY_EXEC_PLAN_M1.md (Phase 3)
}

/**
 * Generate mock GPS point (interpolate along seed segments)
 * @returns {object} {lat, lng, timestamp}
 */
function generateMockGPSPoint() {
  // TODO: Interpolate along seed segment LineStrings
  // TODO: Add random noise (±5m)
  // TODO: Return {lat, lng, timestamp}
}

/**
 * Update RecorderDock button states based on recordingState
 */
function updateRecorderButtons() {
  // TODO: Enable/disable buttons based on current state
  // TODO: Update colors (green/yellow/red)
}
