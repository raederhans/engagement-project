import {
  DEFAULT_HALF_LIFE_DAYS,
  bayesianShrink,
  clampMean,
  effectiveN,
  weightFor,
} from '../utils/decay.js';
import {
  NEFF_PROP,
  SCORE_PROP,
  SEGMENT_ID_PROP,
} from './data_normalization.js';

const PRIOR_MEAN = 3;
const PRIOR_N = 5;

const clone = (value) => (
  value == null
    ? value
    : typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value))
);

export function createDiaryAggregation({
  now = () => Date.now(),
  getCtaState = () => ({
    agreeDisabled: false,
    saferDisabled: false,
    agreeTimestamp: null,
    saferTimestamp: null,
  }),
} = {}) {
  const records = new Map();
  let baseSegments = null;

  function reset(featureCollection) {
    records.clear();
    baseSegments = clone(featureCollection);
    for (const feature of featureCollection?.features || []) {
      const props = feature.properties || {};
      const segmentId = props[SEGMENT_ID_PROP];
      if (!segmentId) continue;
      const mean = Number.isFinite(props[SCORE_PROP]) ? props[SCORE_PROP] : PRIOR_MEAN;
      const nEff = Number.isFinite(props[NEFF_PROP]) ? props[NEFF_PROP] : 1;
      const tags = Array.isArray(props.top_tags) ? props.top_tags : [];
      records.set(segmentId, {
        mean,
        sumW: Math.max(0, nEff),
        n_eff: Math.max(0, nEff),
        top_tags: tags,
        tagCounts: tagCountsFrom(tags),
        updated: new Date(now()).toISOString(),
        win30: { sum: mean * Math.max(1, nEff), w: Math.max(1, nEff) },
        delta_30d: Number.isFinite(props.delta_30d) ? props.delta_30d : 0,
      });
    }
  }

  function applySubmission(payload) {
    if (!payload || !Array.isArray(payload.segment_ids)) return;
    const timestamp = now();
    const overall = Number(payload.overall_rating);
    const tags = Array.isArray(payload.tags) ? payload.tags : [];
    const overrides = normalizeOverrides(payload.segment_overrides);
    for (const segmentId of payload.segment_ids) {
      const rating = overrides.has(segmentId) ? overrides.get(segmentId) : overall;
      if (!Number.isFinite(rating)) continue;
      const record = ensureRecord(segmentId, timestamp);
      decayRecord(record, timestamp);
      const sumW = record.sumW + 1;
      const meanRaw = (record.mean * record.sumW + rating) / Math.max(1e-6, sumW);
      const shrunk = clampMean(bayesianShrink(meanRaw, sumW, PRIOR_MEAN, PRIOR_N));
      const previousWindowMean = record.win30.w > 0
        ? record.win30.sum / record.win30.w
        : record.mean;
      record.sumW = sumW;
      record.mean = shrunk;
      record.n_eff = effectiveN(sumW);
      record.updated = new Date(timestamp).toISOString();
      for (const tag of tags) record.tagCounts[tag] = (record.tagCounts[tag] || 0) + 1;
      record.top_tags = topTagsFrom(record.tagCounts);
      record.win30.sum += shrunk;
      record.win30.w = Math.min(100, record.win30.w + 1);
      record.delta_30d = Number((shrunk - previousWindowMean).toFixed(2));
    }
  }

  function bumpConfidence(segmentId) {
    const timestamp = now();
    const record = ensureRecord(segmentId, timestamp);
    if (!record) return false;
    record.sumW = Math.min(50, (record.sumW || 0) + 0.3);
    record.n_eff = Math.min(50, record.sumW);
    record.updated = new Date(timestamp).toISOString();
    return true;
  }

  function nudgeSafer(segmentId) {
    const timestamp = now();
    const record = ensureRecord(segmentId, timestamp);
    if (!record) return false;
    const base = Math.max(0.5, record.sumW || 1);
    record.mean = clampMean(bayesianShrink(record.mean + 0.1, base, PRIOR_MEAN, PRIOR_N));
    record.delta_30d = Number((record.delta_30d + 0.03).toFixed(2));
    record.updated = new Date(timestamp).toISOString();
    return true;
  }

  function buildFeatureCollection() {
    if (!baseSegments) return null;
    const collection = clone(baseSegments);
    collection.features = collection.features.map((feature) => {
      const props = { ...(feature.properties || {}) };
      const segmentId = props[SEGMENT_ID_PROP];
      const record = records.get(segmentId);
      if (record) {
        props[SCORE_PROP] = record.mean;
        props[NEFF_PROP] = record.n_eff;
        props.top_tags = record.top_tags;
        props.delta_30d = record.delta_30d;
        props.updated = record.updated;
      }
      const cta = getCtaState(segmentId) || {};
      props.__diaryVotes = {
        agreeDisabled: Boolean(cta.agreeDisabled),
        saferDisabled: Boolean(cta.saferDisabled),
        agreeTimestamp: cta.agreeTimestamp || null,
        saferTimestamp: cta.saferTimestamp || null,
      };
      feature.properties = props;
      return feature;
    });
    return collection;
  }

  function meanFor(segmentId, segmentLookup) {
    const record = records.get(segmentId);
    if (record) return record.mean;
    const value = segmentLookup?.get(segmentId)?.properties?.[SCORE_PROP];
    return Number.isFinite(value) ? value : PRIOR_MEAN;
  }

  function countLowRated(segmentIds, segmentLookup, threshold) {
    return (segmentIds || []).reduce(
      (count, segmentId) => count + (meanFor(segmentId, segmentLookup) < threshold ? 1 : 0),
      0,
    );
  }

  function ensureRecord(segmentId, timestamp) {
    if (!segmentId) return null;
    if (!records.has(segmentId)) {
      records.set(segmentId, {
        mean: PRIOR_MEAN,
        sumW: 0,
        n_eff: 0,
        top_tags: [],
        tagCounts: Object.create(null),
        updated: new Date(timestamp).toISOString(),
        win30: { sum: 0, w: 0 },
        delta_30d: 0,
      });
    }
    return records.get(segmentId);
  }

  return {
    reset,
    applySubmission,
    bumpConfidence,
    nudgeSafer,
    buildFeatureCollection,
    meanFor,
    countLowRated,
  };
}

function decayRecord(record, timestamp) {
  const last = Date.parse(record.updated || timestamp);
  const factor = weightFor(last || timestamp, timestamp, DEFAULT_HALF_LIFE_DAYS);
  if (!Number.isFinite(factor) || factor <= 0 || factor > 1) return;
  record.sumW *= factor;
  record.win30.sum *= factor;
  record.win30.w *= factor;
}

function normalizeOverrides(entries) {
  const overrides = new Map();
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const rating = Number(entry?.rating);
      if (entry?.segment_id && Number.isFinite(rating)) overrides.set(entry.segment_id, rating);
    }
  } else if (entries && typeof entries === 'object') {
    for (const [segmentId, rawRating] of Object.entries(entries)) {
      const rating = Number(rawRating);
      if (segmentId && Number.isFinite(rating)) overrides.set(segmentId, rating);
    }
  }
  return overrides;
}

function tagCountsFrom(tags) {
  const counts = Object.create(null);
  for (const entry of tags) {
    if (entry?.tag) counts[entry.tag] = Math.max(1, counts[entry.tag] || 0);
  }
  return counts;
}

function topTagsFrom(counts) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (!total) return [];
  return Object.entries(counts)
    .map(([tag, count]) => ({ tag, p: Number((count / total).toFixed(2)) }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 5);
}
