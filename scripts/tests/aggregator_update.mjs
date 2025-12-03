#!/usr/bin/env node
import assert from 'node:assert/strict';
import { bayesianShrink, clampMean, effectiveN } from '../../src/utils/decay.js';

const PRIOR_MEAN = 3.0;
const PRIOR_N = 5;
const HALF_LIFE_DAYS = 21;

const localAgg = new Map();

function normalizeOverrides(entries = []) {
  const map = new Map();
  entries.forEach((item) => {
    if (item && item.segment_id && Number.isFinite(item.rating)) {
      map.set(item.segment_id, item.rating);
    }
  });
  return map;
}

function ensureAgg(segmentId) {
  if (!localAgg.has(segmentId)) {
    localAgg.set(segmentId, {
      mean: 3,
      sumW: 0,
      n_eff: 0,
      top_tags: [],
      tagCounts: Object.create(null),
      delta_30d: 0,
      win30: { sum: 0, w: 0 },
      updated: new Date(0).toISOString(),
    });
  }
  return localAgg.get(segmentId);
}

function decay(record, now) {
  const last = Date.parse(record.updated || now);
  const dtDays = Math.max(0, (now - last) / 86400000);
  const factor = Math.pow(2, -dtDays / HALF_LIFE_DAYS);
  record.sumW *= factor;
  record.win30.sum *= factor;
  record.win30.w *= factor;
}

function applySubmission(payload) {
  const now = Date.now();
  const overrides = normalizeOverrides(payload.segment_overrides);
  const overall = Number(payload.overall_rating);
  payload.segment_ids.forEach((segmentId) => {
    const rating = overrides.has(segmentId) ? overrides.get(segmentId) : overall;
    const record = ensureAgg(segmentId);
    decay(record, now);
    const newSum = record.sumW + 1;
    const rawMean = (record.mean * record.sumW + rating) / Math.max(1e-6, newSum);
    const shrunk = clampMean(bayesianShrink(rawMean, newSum, PRIOR_MEAN, PRIOR_N));
    record.mean = shrunk;
    record.sumW = newSum;
    record.n_eff = effectiveN(newSum);
    record.updated = new Date(now).toISOString();
    record.tagCounts = record.tagCounts || {};
    (payload.tags || []).forEach((tag) => {
      record.tagCounts[tag] = (record.tagCounts[tag] || 0) + 1;
    });
    const tagTotal = Object.values(record.tagCounts).reduce((sum, val) => sum + val, 0);
    record.top_tags = tagTotal
      ? Object.entries(record.tagCounts)
          .map(([tag, count]) => ({ tag, p: +(count / tagTotal).toFixed(2) }))
          .sort((a, b) => b.p - a.p)
      : [];
    record.win30.sum += shrunk;
    record.win30.w = Math.min(100, record.win30.w + 1);
    record.delta_30d = +(shrunk - rawMean + 0.01).toFixed(2);
  });
}

applySubmission({
  overall_rating: 3,
  segment_ids: ['seg_001', 'seg_002'],
  tags: ['poor_lighting'],
  segment_overrides: [{ segment_id: 'seg_002', rating: 4 }],
});

const firstSeg = localAgg.get('seg_001');
const secondSeg = localAgg.get('seg_002');
const firstSnapshot = { nEff: firstSeg.n_eff, mean: firstSeg.mean };
assert.ok(firstSeg.n_eff > 0, 'First submission should bump n_eff');
assert.ok(secondSeg.mean > firstSeg.mean, 'Override should lift second segment mean');
assert.ok(secondSeg.top_tags.find((t) => t.tag === 'poor_lighting'), 'Tag counts should update');

applySubmission({
  overall_rating: 2,
  segment_ids: ['seg_001'],
  tags: ['dogs'],
});
const updated = localAgg.get('seg_001');
assert.ok(updated.n_eff > firstSnapshot.nEff, 'n_eff must be monotonic');
assert.ok(!Number.isNaN(updated.mean), 'Mean should never be NaN');
assert.ok(updated.top_tags.some((t) => t.tag === 'dogs'), 'New tag should be tracked');

console.info('[Diary Tests] PASS — aggregator updates behave deterministically.');
