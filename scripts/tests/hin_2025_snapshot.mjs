#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  acquireOfficialHin2025,
  HIN_2025_ARTIFACT_MAX_BYTES,
  HIN_2025_FEATURE_COUNT,
  normalizeHin2025Snapshot,
  renderHin2025Snapshot,
  validateHin2025Snapshot,
  validateOfficialHin2025Contract,
  validateOfficialHin2025TimeSemantics,
} from '../lib/hin_2025_snapshot.mjs';
import {
  compareHin2025SemanticSnapshots,
  createHin2025Receipt,
  renderHin2025Receipt,
  validateHin2025Receipt,
  writeHin2025LifecycleAtomic,
} from '../lib/hin_2025_receipt.mjs';

const item = {
  id: '7e416319784a463fa0d8b528d7ccf511',
  type: 'Feature Service',
  access: 'public',
  modified: Date.parse('2026-08-10T04:39:41.000Z'),
  licenseInfo: '<p>The City of Philadelphia makes no representation about accuracy; data is provided as is and without Warranty.</p>',
};
const layer = {
  name: 'high_injury_network_2025',
  geometryType: 'esriGeometryPolyline',
  objectIdField: 'objectid',
  globalIdField: '',
  fields: [
    { name: 'objectid', type: 'esriFieldTypeOID' },
    { name: 'stname', type: 'esriFieldTypeString' },
    { name: 'length_ft', type: 'esriFieldTypeDouble' },
    { name: 'Shape__Length', type: 'esriFieldTypeDouble' },
  ],
  editingInfo: {
    lastEditDate: Date.parse('2025-12-10T17:29:32.369Z'),
    dataLastEditDate: Date.parse('2025-12-10T17:29:32.369Z'),
    schemaLastEditDate: Date.parse('2025-12-10T17:29:32.369Z'),
  },
};

function feature(objectid) {
  const line = [[-75.2 + objectid / 1_000_000, 39.9], [-75.19 + objectid / 1_000_000, 39.91]];
  const multi = objectid > 6;
  return {
    type: 'Feature',
    id: objectid,
    properties: {
      objectid,
      stname: `STREET ${String(objectid).padStart(3, '0')}`,
      length_ft: objectid * 10.25,
      Shape__Length: objectid * 9.75,
    },
    geometry: {
      type: multi ? 'MultiLineString' : 'LineString',
      coordinates: multi ? [line] : line,
    },
  };
}

const geojson = {
  type: 'FeatureCollection',
  features: Array.from({ length: HIN_2025_FEATURE_COUNT }, (_, index) => feature(index + 1)),
};

test('official admission requires the exact current schema, count, no GlobalID, and mixed geometry', () => {
  assert.deepEqual(validateOfficialHin2025Contract({
    item,
    layer,
    countResult: { count: HIN_2025_FEATURE_COUNT },
    geojson,
  }), {
    featureCount: 162,
    geometryCounts: { LineString: 6, MultiLineString: 156 },
  });
  assert.throws(() => validateOfficialHin2025Contract({
    item,
    layer: { ...layer, globalIdField: 'GlobalID' },
    countResult: { count: 162 },
    geojson,
  }), /identity or geometry contract/i);
  assert.throws(() => validateOfficialHin2025Contract({
    item,
    layer,
    countResult: { count: 161 },
    geojson,
  }), /count must be 162/i);
  assert.throws(() => validateOfficialHin2025Contract({
    item,
    layer: { ...layer, fields: layer.fields.slice(0, 3) },
    countResult: { count: 162 },
    geojson,
  }), /field schema changed/i);
});

test('official acquisition is sequential and fails closed when City period semantics drift', async () => {
  const officialText = '<p>The updated High Injury Network was released. The updated HIN is based on crash data from 2019 to 2023.</p>';
  assert.deepEqual(validateOfficialHin2025TimeSemantics(officialText), {
    crashDataPeriod: [2019, 2023],
    networkVintage: 2025,
    officialContext: 'https://www.phila.gov/2025-11-25-city-of-philadelphia-releases-vision-zero-action-plan-2030/',
  });
  assert.throws(
    () => validateOfficialHin2025TimeSemantics('The updated HIN uses a different period.'),
    /period semantics changed or are unavailable/i,
  );

  const responses = [item, layer, { count: 162 }, geojson, officialText];
  let active = 0;
  let maximumActive = 0;
  const requested = [];
  const acquired = await acquireOfficialHin2025({
    request: async (url) => {
      requested.push(url);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const value = responses[requested.length - 1];
      await Promise.resolve();
      active -= 1;
      return typeof value === 'string'
        ? { ok: true, text: async () => value }
        : { ok: true, json: async () => structuredClone(value) };
    },
  });
  assert.equal(maximumActive, 1, 'ArcGIS and official context reads remain sequential');
  assert.equal(requested.length, 5);
  assert.equal(acquired.geojson.features.length, 162);
});

test('normalization is deterministic, retains all official fields, and keeps source timestamps separate', () => {
  const input = {
    item,
    layer,
    retrievedAt: '2026-08-10T10:29:36.678Z',
  };
  const forward = normalizeHin2025Snapshot({ ...input, geojson });
  const reversed = normalizeHin2025Snapshot({
    ...input,
    geojson: { ...geojson, features: [...geojson.features].reverse() },
  });
  assert.equal(renderHin2025Snapshot(forward).text, renderHin2025Snapshot(reversed).text);
  assert.deepEqual(forward.rows[0].slice(0, 5), [1, 'STREET 001', 10.25, 9.75, 'L']);
  assert.equal(forward.meta.retrievedAt, '2026-08-10T10:29:36.678Z');
  assert.equal(forward.meta.itemMetadataModifiedAt, '2026-08-10T04:39:41.000Z');
  assert.equal(forward.meta.layerDataEditedAt, '2025-12-10T17:29:32.369Z');
  assert.equal(forward.meta.layerSchemaEditedAt, '2025-12-10T17:29:32.369Z');
  assert.equal(forward.meta.objectIdScope, 'snapshot-local-only');
  assert.notEqual(forward.meta.itemMetadataModifiedAt, forward.meta.layerDataEditedAt);
});

test('committed snapshot is valid and stays below the hard artifact ceiling', async () => {
  const text = await readFile(new URL('../../public/data/hin_2025.snapshot.json', import.meta.url), 'utf8');
  const snapshot = JSON.parse(text);
  assert.deepEqual(validateHin2025Snapshot(snapshot), {
    featureCount: 162,
    geometryCounts: { LineString: 6, MultiLineString: 156 },
  });
  assert.equal(renderHin2025Snapshot(snapshot).text, text);
  assert.ok(Buffer.byteLength(text) <= HIN_2025_ARTIFACT_MAX_BYTES);
  assert.match(snapshot.meta.licenseAndWarranty, /without Warranty/i);
  assert.equal(snapshot.meta.coordinatePrecision, 6);
  assert.equal(snapshot.meta.objectIdScope, 'snapshot-local-only');
});

test('sidecar receipt identifies exact committed bytes and does not invent legacy clocks', async () => {
  const snapshot = JSON.parse(await readFile(new URL('../../public/data/hin_2025.snapshot.json', import.meta.url), 'utf8'));
  const receiptText = await readFile(new URL('../../public/data/hin_2025.receipt.json', import.meta.url), 'utf8');
  const receipt = JSON.parse(receiptText);
  assert.deepEqual(validateHin2025Receipt(receipt, { snapshot }), receipt);
  assert.equal(renderHin2025Receipt(receipt, { snapshot }).text, receiptText);
  assert.equal(receipt.artifact.identity, 'sha256:b518f8b370c6375f5d3188ec2ec487ed834b7b7c25cb51f5f5e554285749e250');
  assert.equal(receipt.artifact.builtAt, null);
  assert.equal(receipt.review.reviewedAt, null);
  assert.equal(receipt.review.reviewedBy, null);
  assert.match(receipt.source.sourceAsOfMeaning, /not the crash-data period, retrieval, build, or observation time/i);

  const drifted = structuredClone(receipt);
  drifted.source.fields[1].type = 'esriFieldTypeDouble';
  assert.throws(() => validateHin2025Receipt(drifted, { snapshot }), /source contract drifted/i);
  const falseClock = structuredClone(receipt);
  falseClock.artifact.builtAt = falseClock.artifact.retrievedAt;
  assert.throws(() => validateHin2025Receipt(falseClock, { snapshot }), /build-clock semantics|legacy receipt/i);
});

test('semantic comparison ignores transport retrieval/item metadata but reports actual feature change', () => {
  const current = normalizeHin2025Snapshot({
    item,
    layer,
    geojson,
    retrievedAt: '2026-08-10T10:29:36.678Z',
  });
  const candidate = normalizeHin2025Snapshot({
    item: { ...item, modified: Date.parse('2026-08-11T00:00:00.000Z') },
    layer,
    geojson,
    retrievedAt: '2026-08-11T00:01:00.000Z',
  });
  assert.deepEqual(compareHin2025SemanticSnapshots(current, candidate), { changed: false, reasons: [] });

  const changed = structuredClone(candidate);
  changed.rows[0][1] = 'REVIEW REQUIRED';
  assert.deepEqual(compareHin2025SemanticSnapshots(current, changed), {
    changed: true,
    reasons: ['feature-content'],
  });
  const reviewed = createHin2025Receipt({
    snapshot: changed,
    builtAt: '2026-08-11T00:02:00.000Z',
    review: {
      status: 'admitted-after-review',
      reviewedAt: '2026-08-11T00:02:00.000Z',
      reviewedBy: 'test reviewer',
    },
  });
  assert.equal(reviewed.review.status, 'admitted-after-review');
});

test('reviewed snapshot and receipt are staged and replaced as one validated lifecycle pair', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hin-2025-lifecycle-'));
  try {
    const snapshot = normalizeHin2025Snapshot({
      item,
      layer,
      geojson,
      retrievedAt: '2026-08-11T00:01:00.000Z',
    });
    const receipt = createHin2025Receipt({
      snapshot,
      builtAt: '2026-08-11T00:02:00.000Z',
      review: {
        status: 'admitted-after-review',
        reviewedAt: '2026-08-11T00:02:00.000Z',
        reviewedBy: 'test reviewer',
      },
    });
    const snapshotDestination = path.join(directory, 'hin_2025.snapshot.json');
    const receiptDestination = path.join(directory, 'hin_2025.receipt.json');
    const written = await writeHin2025LifecycleAtomic({
      snapshotDestination,
      receiptDestination,
      snapshot,
      receipt,
    });
    assert.equal(JSON.parse(await readFile(snapshotDestination, 'utf8')).meta.retrievedAt, snapshot.meta.retrievedAt);
    assert.deepEqual(
      validateHin2025Receipt(JSON.parse(await readFile(receiptDestination, 'utf8')), { snapshot }),
      receipt,
    );
    assert.equal(written.snapshot.bytes, renderHin2025Snapshot(snapshot).bytes);
    assert.equal(written.receipt.bytes, renderHin2025Receipt(receipt, { snapshot }).bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('snapshot-local identities cannot be reordered or presented as a cross-version key', () => {
  const snapshot = normalizeHin2025Snapshot({
    item,
    layer,
    geojson,
    retrievedAt: '2026-08-10T10:29:36.678Z',
  });
  assert.throws(() => validateHin2025Snapshot({
    ...snapshot,
    rows: [snapshot.rows[1], snapshot.rows[0], ...snapshot.rows.slice(2)],
  }), /snapshot-local object identities must be unique and sorted/i);
  assert.equal(snapshot.meta.objectIdScope, 'snapshot-local-only');
  assert.equal('globalId' in snapshot.meta, false);
});
