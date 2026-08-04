import { DIARY_ROUTES_URL, DIARY_SEGMENTS_URL } from '../config.js';
import { publicUrl } from '../utils/public_url.js';
import {
  normalizeFeatureCollection,
  normalizeRouteFeature,
  normalizeSegmentFeature,
  ROUTE_ID_PROP,
  ROUTE_SEG_IDS_PROP,
  SEGMENT_ID_PROP,
  TAGS_PROP,
} from './data_normalization.js';
import { loadJsonFromCandidates } from './demo_data_loader.js';

const SEGMENT_URL_CANDIDATES = [
  DIARY_SEGMENTS_URL,
  new URL('../../data/segments_phl.demo.geojson', import.meta.url).href,
  publicUrl('data/segments_phl.demo.geojson'),
].filter(Boolean);
const ROUTE_URL_CANDIDATES = [
  DIARY_ROUTES_URL,
  new URL('../../data/routes_phl.demo.geojson', import.meta.url).href,
  publicUrl('data/routes_phl.demo.geojson'),
].filter(Boolean);

let cachedSegments = null;
let cachedRoutes = null;

const clone = (value) => (
  typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value))
);

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
  const featureCollection = normalizeFeatureCollection(collection, normalizeSegmentFeature);
  featureCollection.features = featureCollection.features.map((feature) => {
    const properties = { ...(feature.properties || {}) };
    return {
      ...feature,
      properties: {
        ...properties,
        top_tags: normalizeTopTags(properties[TAGS_PROP] || properties.top_tags),
      },
    };
  });
  return featureCollection;
}

function normalizeRoutesCollection(collection) {
  return normalizeFeatureCollection(collection, normalizeRouteFeature);
}

export function logMissingSegments(routes, segments) {
  const segmentIds = new Set((segments.features || []).map((feature) => (
    feature?.properties?.[SEGMENT_ID_PROP]
  )));
  const issues = [];
  for (const route of routes.features || []) {
    const missing = (route.properties?.[ROUTE_SEG_IDS_PROP] || []).filter((id) => !segmentIds.has(id));
    if (missing.length) {
      issues.push(`${route.properties?.[ROUTE_ID_PROP] || 'route'}: ${missing.join(', ')}`);
    }
  }
  if (issues.length) {
    console.warn('[Diary] Route seed references missing segments:', issues.join(' | '));
  }
}

export async function loadDemoSegments({ force = false, signal } = {}) {
  signal?.throwIfAborted();
  if (cachedSegments && !force) return clone(cachedSegments);
  const payload = await loadJsonFromCandidates('segments', SEGMENT_URL_CANDIDATES, { signal });
  signal?.throwIfAborted();
  cachedSegments = normalizeSegmentsCollection(ensureFeatureCollection(payload, 'segments'));
  return clone(cachedSegments);
}

export async function loadDemoRoutes({ force = false, signal } = {}) {
  signal?.throwIfAborted();
  if (cachedRoutes && !force) return clone(cachedRoutes);
  const payload = await loadJsonFromCandidates('routes', ROUTE_URL_CANDIDATES, { signal });
  signal?.throwIfAborted();
  cachedRoutes = normalizeRoutesCollection(ensureFeatureCollection(payload, 'routes'));
  const missingIds = (cachedRoutes.features || []).filter((feature) => {
    const ids = feature?.properties?.[ROUTE_SEG_IDS_PROP];
    return !Array.isArray(ids) || ids.length === 0;
  });
  if (missingIds.length) {
    console.warn(
      '[Diary] Some routes are missing segment references:',
      missingIds.map((feature) => feature?.properties?.[ROUTE_ID_PROP] || 'route').join(', '),
    );
  }
  return clone(cachedRoutes);
}
