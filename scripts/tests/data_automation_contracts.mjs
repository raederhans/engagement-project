#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildTractSourceAudit,
  isCadenceDue,
} from '../lib/data_automation.mjs';

const contract = {
  schema_version: 1,
  service_url: 'https://example.test/MapServer',
  current_layer_id: 0,
  expected_current_vintage: 2025,
  expected_geoid_count: 2,
  required_fields: ['STATE', 'COUNTY', 'TRACT', 'GEOID', 'NAME'],
};

const localTracts = featureCollection(['42101000100', '42101000200']);
const remoteTracts = featureCollection(['42101000200', '42101000100']);
const serviceMetadata = {
  layers: [
    { id: 3, name: 'ACS 2025', parentLayerId: -1 },
    { id: 4, name: 'Census Tracts', parentLayerId: 3 },
  ],
};
const layerMetadata = {
  id: 0,
  name: 'Census Tracts',
  description: 'Census Tracts; January 1, 2025 vintage',
  fields: contract.required_fields.map((name) => ({ name })),
};

test('the anchored schedule runs exactly every 14 UTC days', () => {
  assert.equal(isCadenceDue('2026-08-03', { anchor: '2026-08-03' }), true);
  assert.equal(isCadenceDue('2026-08-10', { anchor: '2026-08-03' }), false);
  assert.equal(isCadenceDue('2026-08-17', { anchor: '2026-08-03' }), true);
  assert.equal(isCadenceDue('2026-09-14', { anchor: '2026-08-03' }), true);
  assert.equal(isCadenceDue('2026-08-02', { anchor: '2026-08-03' }), false);
});

test('the anchored schedule rejects ambiguous or invalid dates', () => {
  assert.throws(() => isCadenceDue('2026-08-03T00:00:00Z'), /YYYY-MM-DD/);
  assert.throws(() => isCadenceDue('2026-02-30'), /valid/);
  assert.throws(() => isCadenceDue('2026-08-03', { anchor: 'bad-date' }), /YYYY-MM-DD/);
});

test('tract audit stays stable when vintage, schema, count, and GEOIDs match', () => {
  const report = buildTractSourceAudit({
    contract,
    localTracts,
    remoteTracts,
    serviceMetadata,
    layerMetadata,
    checkedAt: '2026-07-31T00:00:00.000Z',
  });

  assert.equal(report.status, 'stable');
  assert.deepEqual(report.reasons, []);
  assert.equal(report.latest_acs_vintage, 2025);
  assert.equal(report.current_layer_vintage, 2025);
  assert.equal(report.local_geoid_count, 2);
  assert.equal(report.remote_geoid_count, 2);
});

test('tract audit reports new vintages, schema drift, and GEOID drift together', () => {
  const report = buildTractSourceAudit({
    contract,
    localTracts,
    remoteTracts: featureCollection(['42101000100', '42101000300']),
    serviceMetadata: {
      layers: [{ id: 20, name: 'ACS 2026', parentLayerId: -1 }],
    },
    layerMetadata: {
      ...layerMetadata,
      description: 'Census Tracts; January 1, 2026 vintage',
      fields: layerMetadata.fields.filter(({ name }) => name !== 'TRACT'),
    },
    checkedAt: '2026-07-31T00:00:00.000Z',
  });

  assert.equal(report.status, 'drift');
  assert.deepEqual(report.added_geoids, ['42101000300']);
  assert.deepEqual(report.removed_geoids, ['42101000200']);
  assert.deepEqual(report.missing_fields, ['TRACT']);
  assert.match(report.reasons.join('\n'), /ACS 2026/);
  assert.match(report.reasons.join('\n'), /vintage 2026/);
});

test('refresh and source-audit workflows preserve review and permission boundaries', async () => {
  const [refresh, audit] = await Promise.all([
    readFile(new URL('../../.github/workflows/refresh-tract-data.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../.github/workflows/audit-tract-source.yml', import.meta.url), 'utf8'),
  ]);

  assert.match(refresh, /cron:\s*['"]23 6 \* \* 1['"]/);
  assert.match(refresh, /check_data_refresh_due\.mjs/);
  assert.match(refresh, /npm run data:refresh:tract-crime/);
  assert.match(refresh, /npm run validate/);
  assert.match(refresh, /contents:\s*write/);
  assert.match(refresh, /pull-requests:\s*write/);
  assert.match(refresh, /gh pr create/);
  assert.doesNotMatch(refresh, /push origin (?:HEAD:)?main/);
  assert.doesNotMatch(refresh, /peter-evans\/create-pull-request/);
  assert.match(refresh, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(refresh, /actions\/setup-node@[0-9a-f]{40}/);

  assert.match(audit, /cron:\s*['"]41 7 2 1,4,7,10 \*['"]/);
  assert.match(audit, /contents:\s*read/);
  assert.match(audit, /issues:\s*write/);
  assert.match(audit, /audit_tract_source\.mjs/);
  assert.match(audit, /gh issue (?:create|comment)/);
  assert.match(audit, /actions\/checkout@[0-9a-f]{40}/);
});

function featureCollection(geoids) {
  return {
    type: 'FeatureCollection',
    features: geoids.map((geoid) => ({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[-75.2, 39.9], [-75.1, 39.9], [-75.1, 40], [-75.2, 40], [-75.2, 39.9]]],
      },
      properties: { GEOID: geoid },
    })),
  };
}
