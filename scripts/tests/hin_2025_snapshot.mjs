#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  HIN_2025_ARTIFACT_MAX_BYTES,
  HIN_2025_FEATURE_COUNT,
  normalizeHin2025Snapshot,
  renderHin2025Snapshot,
  validateHin2025Snapshot,
  validateOfficialHin2025Contract,
} from '../lib/hin_2025_snapshot.mjs';

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
