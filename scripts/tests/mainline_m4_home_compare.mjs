import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  admitHomeCompareThreeSourceAggregate,
  buildHomeCompareThreeSourceAggregate,
  createHomeCompareAggregateSourceReceipt,
} from '../lib/home_compare_three_source_aggregate.mjs';

const reportPath = new URL('../../reports/home-compare/three-source-aggregate-readiness.v1.json', import.meta.url);
const digest = (character) => `sha256:${character.repeat(64)}`;

test('M4 tracked three-source report preserves absent payload, revision, coverage, join, and DQ as unavailable', async () => {
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const admitted = admitHomeCompareThreeSourceAggregate(report);
  assert.equal(admitted.status, 'unavailable');
  assert.deepEqual(Object.keys(admitted.aggregates), [
    'reported-incidents', 'service-requests-311', 'li-vacancy',
  ]);
  assert.ok(Object.values(admitted.aggregates).every((value) => value === null));
  assert.ok(admitted.source_receipts.every((source) => (
    source.snapshot_identity === null
      && source.coverage_status === 'unavailable'
      && source.join_status === 'unavailable'
      && source.data_quality_status === 'unavailable'
  )));
  assert.equal(admitted.privacy.private_addresses_persisted, false);
});

test('M4 admits aggregates only after all three independent exact source receipts pass', () => {
  const sources = ['reported-incidents', 'service-requests-311', 'li-vacancy'];
  const receipts = sources.map((sourceId, index) => availableReceipt(sourceId, String(index + 1)));
  const report = buildHomeCompareThreeSourceAggregate({
    observed_at: '2026-08-31T00:00:01.000Z',
    source_receipts: receipts,
  });
  assert.equal(report.status, 'available');
  assert.ok(report.source_receipts.every(({ status }) => status === 'available'));
  assert.ok(Object.values(report.aggregates).every((aggregate) => aggregate.tracts.length === 1));
  assert.equal(report.optional_sources.property_assessment.status, 'unavailable');
  assert.equal(report.optional_sources.ownership_transfer.status, 'unavailable');
  assert.ok(Object.values(report.authority).every((value) => value === false));
});

test('M4 fails closed when an unavailable source carries inferred values or private keys', () => {
  const unavailable = unavailableReceipt('reported-incidents');
  const hostile = structuredClone(unavailable);
  hostile.snapshot.identity = digest('a');
  assert.throws(() => createHomeCompareAggregateSourceReceipt(hostile), /Unavailable Home Compare snapshot/);

  const sources = ['reported-incidents', 'service-requests-311', 'li-vacancy'];
  const receipts = sources.map((sourceId, index) => availableReceipt(sourceId, String(index + 1)));
  receipts[0] = structuredClone(receipts[0]);
  receipts[0].aggregates.tracts[0].address = 'forbidden';
  assert.throws(() => buildHomeCompareThreeSourceAggregate({
    observed_at: '2026-08-31T00:00:01.000Z', source_receipts: receipts,
  }));
});

function unavailableReceipt(sourceId) {
  return {
    source_id: sourceId,
    status: 'unavailable',
    observed_at: '2026-08-31T00:00:00.000Z',
    snapshot: { identity: null, payload_sha256: null, revision_id: null, revision_status: 'unavailable' },
    coverage: {
      status: 'unavailable', start: null, end_exclusive: null, geography: 'philadelphia',
      row_count: null, completeness_admitted: false,
    },
    join: {
      status: 'unavailable', geography_level: 'tract-neighborhood', matched_rows: null,
      unmatched_rows: null, coverage_rate: null,
    },
    data_quality: { status: 'unavailable', checks: [] },
    aggregates: null,
    reason: 'No exact admitted receipt.',
  };
}

function availableReceipt(sourceId, character) {
  return createHomeCompareAggregateSourceReceipt({
    source_id: sourceId,
    status: 'available',
    observed_at: '2026-08-31T00:00:00.000Z',
    snapshot: {
      identity: digest(character), payload_sha256: digest(character),
      revision_id: `revision-${character}`, revision_status: 'exact',
    },
    coverage: {
      status: 'complete', start: '2025-01-01', end_exclusive: '2026-01-01',
      geography: 'philadelphia', row_count: 1, completeness_admitted: true,
    },
    join: {
      status: 'pass', geography_level: 'tract-neighborhood', matched_rows: 1,
      unmatched_rows: 0, coverage_rate: 1,
    },
    data_quality: { status: 'pass', checks: ['schema', 'coverage', 'join'] },
    aggregates: {
      tracts: [{ unit_id: 'tract-1', count: 1 }],
      neighborhoods: [{ unit_id: 'neighborhood-1', count: 1 }],
    },
    reason: 'Exact aggregate fixture.',
  });
}
