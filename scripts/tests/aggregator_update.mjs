#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDiaryAggregation } from '../../src/routes_diary/local_aggregation.js';

const baseSegments = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        segment_id: 'seg-1',
        decayed_mean: 2.5,
        n_eff: 2,
        top_tags: [{ tag: 'lighting', p: 1 }],
      },
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    },
    {
      type: 'Feature',
      properties: { segment_id: 'seg-2', decayed_mean: 3.5, n_eff: 1 },
      geometry: { type: 'LineString', coordinates: [[1, 1], [2, 2]] },
    },
  ],
};

test('aggregation reset hydrates cloned feature data and CTA state', () => {
  const aggregation = createDiaryAggregation({
    now: () => Date.parse('2026-07-31T00:00:00Z'),
    getCtaState: (segmentId) => ({
      agreeDisabled: segmentId === 'seg-1',
      saferDisabled: false,
      agreeTimestamp: segmentId === 'seg-1' ? 'saved' : null,
      saferTimestamp: null,
    }),
  });

  aggregation.reset(baseSegments);
  const hydrated = aggregation.buildFeatureCollection();

  assert.notEqual(hydrated, baseSegments);
  assert.equal(hydrated.features[0].properties.decayed_mean, 2.5);
  assert.deepEqual(hydrated.features[0].properties.__diaryVotes, {
    agreeDisabled: true,
    saferDisabled: false,
    agreeTimestamp: 'saved',
    saferTimestamp: null,
  });
  assert.equal(baseSegments.features[0].properties.__diaryVotes, undefined);
});

test('submission updates real aggregation records with overrides and tags', () => {
  const aggregation = createDiaryAggregation({
    now: () => Date.parse('2026-07-31T00:00:00Z'),
  });
  aggregation.reset(baseSegments);

  aggregation.applySubmission({
    overall_rating: 2,
    segment_ids: ['seg-1', 'seg-2'],
    tags: ['dogs'],
    segment_overrides: [{ segment_id: 'seg-2', rating: 5 }],
  });

  const updated = aggregation.buildFeatureCollection();
  const first = updated.features[0].properties;
  const second = updated.features[1].properties;
  assert.ok(first.n_eff > 2);
  assert.ok(second.decayed_mean > first.decayed_mean);
  assert.ok(first.top_tags.some((entry) => entry.tag === 'dogs'));
  assert.ok(second.top_tags.some((entry) => entry.tag === 'dogs'));
});

test('local CTA updates and low-rating counts share the same records', () => {
  const aggregation = createDiaryAggregation({
    now: () => Date.parse('2026-07-31T00:00:00Z'),
  });
  aggregation.reset(baseSegments);
  const lookup = new Map(baseSegments.features.map((feature) => [feature.properties.segment_id, feature]));

  const confidenceBefore = aggregation.buildFeatureCollection().features[0].properties.n_eff;
  assert.equal(aggregation.bumpConfidence('seg-1'), true);
  assert.ok(aggregation.buildFeatureCollection().features[0].properties.n_eff > confidenceBefore);
  assert.equal(aggregation.countLowRated(['seg-1', 'seg-2'], lookup, 2.6), 1);

  const meanBefore = aggregation.meanFor('seg-1', lookup);
  assert.equal(aggregation.nudgeSafer('seg-1'), true);
  assert.ok(aggregation.meanFor('seg-1', lookup) > meanBefore);
});
