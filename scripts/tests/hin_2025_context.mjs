#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  HIN_2025_ASSOCIATION_RELATION,
  HIN_2025_ASSOCIATION_TOLERANCE_M,
  HIN_2025_LOCAL_SNAPSHOT_URL,
  associateKnownRouteWithHin2025,
  createHin2025ContextAdapter,
  loadHin2025Snapshot,
} from '../../src/routes_crime/hin_2025_context.js';
import {
  adaptHin2025SourceHealthObservation,
  createHin2025EvidenceContribution,
  HIN_2025_RECEIPT_URL,
  loadHin2025LifecycleReceipt,
} from '../../src/routes_crime/hin_2025_lifecycle.js';
import { createManualRouteInput } from '../../src/routes_crime/route_input.js';

const committedSnapshot = JSON.parse(await readFile(
  new URL('../../public/data/hin_2025.snapshot.json', import.meta.url),
  'utf8',
));
const committedReceipt = JSON.parse(await readFile(
  new URL('../../public/data/hin_2025.receipt.json', import.meta.url),
  'utf8',
));
const metresToLatitude = (metres) => metres / 6_371_008.8 * 180 / Math.PI;

function syntheticSnapshot({ geometryCode = 'M', distanceM = 0, streetName = 'TEST HIN' } = {}) {
  const snapshot = structuredClone(committedSnapshot);
  const y = 41 + metresToLatitude(distanceM);
  const targetIndex = geometryCode === 'L'
    ? snapshot.rows.findIndex((row) => row[4] === 'L')
    : snapshot.rows.findIndex((row) => row[4] === 'M');
  snapshot.rows[targetIndex] = [
    snapshot.rows[targetIndex][0],
    streetName,
    snapshot.rows[targetIndex][2],
    snapshot.rows[targetIndex][3],
    geometryCode,
    geometryCode === 'L'
      ? [[-75, y], [-74.99, y]]
      : [[[-75, y], [-74.99, y]]],
  ];
  return snapshot;
}

const route = createManualRouteInput([[-75, 41], [-74.99, 41]]);

test('pure association supports LineString and MultiLineString and emits only the bounded snapshot relation', () => {
  for (const geometryCode of ['L', 'M']) {
    const result = associateKnownRouteWithHin2025({
      routeInput: route,
      snapshot: syntheticSnapshot({ geometryCode }),
    });
    assert.equal(result.status, 'ready');
    assert.equal(result.relation, HIN_2025_ASSOCIATION_RELATION);
    assert.equal(result.matches[0].relation, HIN_2025_ASSOCIATION_RELATION);
    assert.equal(result.matches[0].streetName, 'TEST HIN');
    assert.equal(result.matches[0].snapshotObjectIds.length, 1);
    assert.equal(result.snapshot.objectIdScope, 'snapshot-local-only');
  }
});

test('fixed inclusive tolerance admits its boundary and distinguishes an admitted zero beyond it', () => {
  const boundary = associateKnownRouteWithHin2025({
    routeInput: route,
    snapshot: syntheticSnapshot({ distanceM: HIN_2025_ASSOCIATION_TOLERANCE_M }),
  });
  assert.equal(boundary.status, 'ready');
  assert.equal(boundary.toleranceM, 20);
  assert.ok(boundary.matches[0].minimumDistanceM <= 20.01);

  const outside = associateKnownRouteWithHin2025({
    routeInput: route,
    snapshot: syntheticSnapshot({ distanceM: HIN_2025_ASSOCIATION_TOLERANCE_M + 0.02 }),
  });
  assert.equal(outside.status, 'no-associated-streets');
  assert.deepEqual(outside.matches, []);
});

test('crossing segments intersect at zero distance and street names are aggregated deterministically', () => {
  const snapshot = syntheticSnapshot({ streetName: 'BROAD' });
  snapshot.rows[1] = [
    snapshot.rows[1][0],
    'BROAD',
    snapshot.rows[1][2],
    snapshot.rows[1][3],
    'M',
    [[[-74.995, 40.995], [-74.995, 41.005]]],
  ];
  const result = associateKnownRouteWithHin2025({ routeInput: route, snapshot });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.matches, [{
    streetName: 'BROAD',
    relation: HIN_2025_ASSOCIATION_RELATION,
    minimumDistanceM: 0,
    snapshotObjectIds: [1, 2],
  }]);
});

test('local loader requests only the versioned same-origin artifact and never receives exact route data', async () => {
  let observed;
  const loaded = await loadHin2025Snapshot({
    request: async (url, options) => {
      observed = { url, options };
      return { ok: true, json: async () => structuredClone(committedSnapshot) };
    },
  });
  assert.equal(loaded.meta.featureCount, 162);
  assert.equal(observed.url, HIN_2025_LOCAL_SNAPSHOT_URL);
  assert.doesNotMatch(observed.url, /arcgis|FeatureServer/i);
  assert.equal(JSON.stringify(observed).includes('-74.99'), false);
  assert.equal(observed.options.method, 'GET');
});

test('admitted lifecycle metadata reaches text presentation without exposing snapshot rows', () => {
  const snapshot = syntheticSnapshot();
  snapshot.lifecycleReceipt = structuredClone(committedReceipt);
  const result = associateKnownRouteWithHin2025({ routeInput: route, snapshot });
  assert.equal(result.snapshot.snapshotIdentity, committedReceipt.artifact.identity);
  assert.equal(result.snapshot.builtAt, null);
  assert.equal(result.snapshot.buildClockStatus, 'not-recorded-in-legacy-snapshot');
  assert.equal(result.snapshot.sourceAsOf, committedReceipt.source.sourceAsOf);
  assert.deepEqual(result.snapshot.geometryTypes, ['LineString', 'MultiLineString']);
  assert.equal('rows' in result.snapshot, false);
});

test('lifecycle receipt loader is same-origin and feature adapter reports historical snapshot as partial', async () => {
  let observed;
  const receipt = await loadHin2025LifecycleReceipt({
    request: async (url, options) => {
      observed = { url, options };
      return { ok: true, json: async () => structuredClone(committedReceipt) };
    },
  });
  assert.equal(observed.url, HIN_2025_RECEIPT_URL);
  assert.doesNotMatch(observed.url, /arcgis|FeatureServer/i);
  assert.equal(observed.options.method, 'GET');
  const observation = adaptHin2025SourceHealthObservation({
    receipt,
    observedAt: '2026-08-10T12:00:00.000Z',
  });
  assert.equal(observation.sourceId, 'hin-2025');
  assert.equal(observation.status, 'partial');
  assert.equal(observation.statusReason, 'bundled-historical-planning-snapshot');
  assert.equal(observation.recordCount, 162);
  assert.equal(observation.clocks.sourceAsOf, '2025-12-10T17:29:32.369Z');
  assert.equal(observation.clocks.builtAt, null);
  assert.match(observation.snapshot.identity, /^sha256:[0-9a-f]{64}$/);

  const drifted = structuredClone(receipt);
  drifted.source.fields[0].name = 'silently_changed';
  const unavailable = adaptHin2025SourceHealthObservation({
    receipt: drifted,
    observedAt: '2026-08-10T12:00:00.000Z',
  });
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.statusReason, 'lifecycle-receipt-schema-drift');
  assert.equal(unavailable.recordCount, null);
});

test('Evidence handoff is aggregate-only and excludes route/snapshot identifying content', () => {
  const observation = adaptHin2025SourceHealthObservation({
    receipt: committedReceipt,
    observedAt: '2026-08-10T12:00:00.000Z',
  });
  const result = associateKnownRouteWithHin2025({
    routeInput: route,
    snapshot: syntheticSnapshot({ streetName: 'MUST NOT LEAK' }),
  });
  const contribution = createHin2025EvidenceContribution({
    result,
    sourceHealthObservation: observation,
  });
  assert.equal(contribution.context.status, 'ready');
  assert.equal(contribution.context.associatedStreetNameCount, 1);
  assert.equal(contribution.source.snapshot.identity, observation.snapshot.identity);
  assert.equal(Object.isFrozen(contribution), true);
  const serialized = JSON.stringify(contribution);
  assert.doesNotMatch(serialized, /MUST NOT LEAK|-75|snapshotObjectIds|coordinates|gpsTrace|routeGeometry|\[\[\[/i);

  const unavailable = createHin2025EvidenceContribution({
    result: { status: 'unavailable' },
    sourceHealthObservation: observation,
  });
  assert.equal(unavailable.context.associatedStreetNameCount, null);
  assert.equal(unavailable.context.admittedZero, false);
});

test('narrow adapter keeps exact route in memory and distinguishes snapshot unavailable from admitted zero', async () => {
  let argumentCount = -1;
  const readyAdapter = createHin2025ContextAdapter({
    loadSnapshot(...args) {
      argumentCount = args.length;
      return Promise.resolve(syntheticSnapshot({ distanceM: 25 }));
    },
  });
  const noMatch = await readyAdapter.request({ routeInput: route });
  assert.equal(argumentCount, 0, 'snapshot loader must not receive exact route input');
  assert.equal(noMatch.status, 'no-associated-streets');

  const unavailable = await createHin2025ContextAdapter({
    loadSnapshot: async () => { throw new Error('local artifact unavailable'); },
  }).request({ routeInput: route });
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.reason, 'snapshot-unavailable');
  assert.deepEqual(unavailable.matches, []);
});

test('runtime context has no ArcGIS, persistence, URL mutation, GPS matching, or network-route disclosure path', async () => {
  const source = await readFile(new URL('../../src/routes_crime/hin_2025_context.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /arcgis\.com|FeatureServer|localStorage|sessionStorage|indexedDB|history\.(?:pushState|replaceState)|navigator\.geolocation/);
  assert.doesNotMatch(source, /raw-gps|map.?match/i);
  assert.match(source, /Deliberately no arguments: exact route geometry stays in this call/);
  assert.doesNotMatch(HIN_2025_ASSOCIATION_RELATION, /belongs|incident|crash|safe|risk/i);
});
