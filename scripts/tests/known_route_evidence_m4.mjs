#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  KNOWN_ROUTE_EVIDENCE_SCHEMA,
  admitKnownRouteEvidenceRequest,
  createKnownRouteEvidenceRequest,
  createKnownRouteEvidenceShareState,
} from '../../src/routes_crime/known_route_evidence_contract.js';
import {
  admitCenterlineFeatureCollection,
  admitCenterlineMetadata,
  createCenterlineQueryDisclosure,
  matchKnownRouteToCenterline,
} from '../../src/routes_crime/known_route_centerline.js';
import {
  addCanonicalGeneralizedIncident,
  createGeneralizedIncidentAccumulator,
  finalizeGeneralizedIncidentAccumulator,
} from '../../src/routes_crime/known_route_contributions.js';
import {
  createManualRouteInput,
  parseRouteGeoJsonText,
} from '../../src/routes_crime/route_input.js';
import {
  createKnownRouteEvidenceCheckpoint,
  createSafeKnownRouteAggregateReport,
  restoreKnownRouteEvidenceAccumulator,
} from '../lib/known_route_evidence_checkpoint.mjs';

const routeInput = createManualRouteInput([
  [-75.170000, 39.950000],
  [-75.160000, 39.950000],
  [-75.150000, 39.950000],
]);

function request(overrides = {}) {
  return {
    schema: KNOWN_ROUTE_EVIDENCE_SCHEMA,
    routeInput,
    transportMode: 'walking',
    requestedDataVersion: 'current-observed',
    ...overrides,
  };
}

function metadata(overrides = {}) {
  const fields = [
    ['objectid', 'esriFieldTypeOID'],
    ['seg_id', 'esriFieldTypeInteger'],
    ['fnode_', 'esriFieldTypeInteger'],
    ['tnode_', 'esriFieldTypeInteger'],
    ['oneway', 'esriFieldTypeString'],
    ['class', 'esriFieldTypeSmallInteger'],
    ['streetlabe', 'esriFieldTypeString'],
    ['update_', 'esriFieldTypeDate'],
  ].map(([name, type]) => ({ name, type }));
  return {
    serviceItemId: 'c36d828494cd44b5bd8b038be696c839',
    name: 'Street_Centerline',
    type: 'Feature Layer',
    geometryType: 'esriGeometryPolyline',
    capabilities: 'Query',
    objectIdField: 'objectid',
    maxRecordCount: 2000,
    hasZ: false,
    hasM: false,
    supportedQueryFormats: 'JSON, geoJSON, PBF',
    editingInfo: { dataLastEditDate: Date.parse('2026-07-29T13:55:32.074Z') },
    fields,
    ...overrides,
  };
}

function feature({ objectid, segId, from, to, coordinates, street = 'PUBLIC TEST ST' }) {
  return {
    type: 'Feature',
    properties: {
      objectid,
      seg_id: segId,
      fnode_: from,
      tnode_: to,
      oneway: 'B',
      class: 3,
      streetlabe: street,
      update_: Date.parse('2026-07-01T00:00:00.000Z'),
    },
    geometry: { type: 'LineString', coordinates },
  };
}

function featureCollection(features = defaultFeatures()) {
  return { type: 'FeatureCollection', features };
}

function defaultFeatures() {
  return [
    feature({ objectid: 10, segId: 100, from: 1, to: 2, coordinates: [[-75.17, 39.95], [-75.16, 39.95]] }),
    feature({ objectid: 11, segId: 101, from: 2, to: 3, coordinates: [[-75.16, 39.95], [-75.15, 39.95]] }),
  ];
}

function catalog(features = defaultFeatures()) {
  const version = admitCenterlineMetadata(metadata());
  return admitCenterlineFeatureCollection(featureCollection(features), {
    expectedCount: features.length,
    sourceVersion: version,
  });
}

test('M4 route admission validates mode, bbox, length, jump, duplicate, precision, and self-intersection', () => {
  const admitted = admitKnownRouteEvidenceRequest(request());
  assert.equal(admitted.transportMode, 'walking');
  assert.equal(admitted.geometry.coordinates.length, 3);
  assert.ok(admitted.lengthM > 1_000);

  assert.throws(() => admitKnownRouteEvidenceRequest(request({ transportMode: 'hovercraft' })), /transport mode/i);
  assert.throws(() => admitKnownRouteEvidenceRequest(request({ transportMode: '<img src=x onerror=alert(1)>' })), /transport mode/i);
  assert.throws(() => admitKnownRouteEvidenceRequest(request({ requestedDataVersion: 'javascript:alert(1)' })), /data version/i);
  assert.throws(() => createKnownRouteEvidenceRequest({
    routeInput: createManualRouteInput([[-74.8, 39.95], [-74.79, 39.95]]),
    transportMode: 'walking',
  }), /Philadelphia area/i);
  assert.throws(() => createKnownRouteEvidenceRequest({
    routeInput: createManualRouteInput([[-75.17, 39.95], [-75.17, 39.95]]),
    transportMode: 'walking',
  }), /valid known route|duplicate|length/i);
  assert.throws(() => createKnownRouteEvidenceRequest({
    routeInput: createManualRouteInput([[-75.17, 39.95], [-75.1699, 39.95]]),
    transportMode: 'walking',
  }), /length/i);
  assert.throws(() => createKnownRouteEvidenceRequest({
    routeInput: createManualRouteInput(Array.from({ length: 257 }, (_, index) => [-75.17 + index / 1_000_000, 39.95])),
    transportMode: 'walking',
  }), /vertex|valid known route/i);
  assert.throws(() => admitKnownRouteEvidenceRequest(request({
    routeInput: {
      ...routeInput,
      geometry: { type: 'LineString', coordinates: [[-75.170000001, 39.95], [-75.16, 39.95]] },
    },
  })), /precision/i);
  assert.throws(() => createKnownRouteEvidenceRequest({
    routeInput: createManualRouteInput([[-75.25, 39.90], [-75.15, 39.90]]),
    transportMode: 'walking',
  }), /jump/i);
  assert.throws(() => createKnownRouteEvidenceRequest({
    routeInput: createManualRouteInput([
      [-75.17, 39.94], [-75.15, 39.96], [-75.17, 39.96], [-75.15, 39.94],
    ]),
    transportMode: 'walking',
  }), /self-intersects/i);
});

test('GeoJSON route parsing rejects dangerous keys, extra coordinate dimensions, and oversized input', () => {
  assert.throws(
    () => parseRouteGeoJsonText('{"type":"Feature","__proto__":{},"geometry":{"type":"LineString","coordinates":[[-75.17,39.95],[-75.16,39.95]]}}'),
    /valid GeoJSON JSON/i,
  );
  assert.throws(
    () => parseRouteGeoJsonText(JSON.stringify({ type: 'LineString', coordinates: [[-75.17, 39.95, 8], [-75.16, 39.95, 9]] })),
    /longitude and latitude/i,
  );
  assert.throws(() => parseRouteGeoJsonText(' '.repeat(256_001)), /too large/i);
  assert.equal({}.polluted, undefined);
});

test('official centerline metadata and catalog bind source version, exact count, schema, and deterministic identity', () => {
  const version = admitCenterlineMetadata(metadata());
  assert.equal(version.dataVersion, 'city-street-centerline:2026-07-29T13:55:32.074Z');
  const first = catalog();
  const second = catalog([...defaultFeatures()].reverse());
  assert.equal(first.catalogIdentity, second.catalogIdentity);
  assert.throws(() => admitCenterlineMetadata(metadata({ serviceItemId: 'caller-claimed' })), /drifted/i);
  assert.throws(() => admitCenterlineFeatureCollection(featureCollection(), {
    expectedCount: 3,
    sourceVersion: version,
  }), /incomplete/i);
  const polluted = featureCollection();
  polluted.features[0].properties = JSON.parse(`${JSON.stringify(polluted.features[0].properties).slice(0, -1)},"__proto__":{}}`);
  assert.throws(() => admitCenterlineFeatureCollection(polluted, {
    expectedCount: 2,
    sourceVersion: version,
  }), /blocked property/i);
  const injectedLabel = featureCollection();
  injectedLabel.features[0].properties.streetlabe = '<img src=x onerror=alert(1)>';
  assert.throws(() => admitCenterlineFeatureCollection(injectedLabel, {
    expectedCount: 2,
    sourceVersion: version,
  }), /unsafe/i);
});

test('deterministic map match yields the same edge chain and corridor identity for the same route and data version', () => {
  const normalizedRoute = admitKnownRouteEvidenceRequest(request());
  const first = matchKnownRouteToCenterline({ normalizedRoute, catalog: catalog() });
  const second = matchKnownRouteToCenterline({ normalizedRoute, catalog: catalog([...defaultFeatures()].reverse()) });
  assert.equal(first.status, 'matched');
  assert.deepEqual(first.matchedEdges.map((edge) => edge.streetLabel), ['PUBLIC TEST ST', 'PUBLIC TEST ST']);
  assert.equal(first.corridorIdentity, second.corridorIdentity);
  assert.deepEqual(first, second);
});

test('map match fails closed for off-network, multiple candidates, disconnected topology, and missing data version', () => {
  const normalizedRoute = admitKnownRouteEvidenceRequest(request());
  const far = defaultFeatures().map((entry) => ({
    ...entry,
    geometry: { ...entry.geometry, coordinates: entry.geometry.coordinates.map(([lon, lat]) => [lon, lat + 0.01]) },
  }));
  assert.equal(matchKnownRouteToCenterline({ normalizedRoute, catalog: catalog(far) }).reason, 'off-network');

  const parallel = feature({
    objectid: 12,
    segId: 102,
    from: 4,
    to: 5,
    coordinates: [[-75.17, 39.950005], [-75.15, 39.950005]],
    street: 'PARALLEL TEST ST',
  });
  assert.equal(
    matchKnownRouteToCenterline({ normalizedRoute, catalog: catalog([...defaultFeatures(), parallel]) }).reason,
    'multiple-candidate-ambiguity',
  );

  const disconnected = defaultFeatures();
  disconnected[1] = feature({
    objectid: 11, segId: 101, from: 9, to: 10, coordinates: [[-75.16, 39.95], [-75.15, 39.95]],
  });
  assert.equal(
    matchKnownRouteToCenterline({ normalizedRoute, catalog: catalog(disconnected) }).reason,
    'disconnected-centerline-chain',
  );

  const pinned = admitKnownRouteEvidenceRequest(request({
    requestedDataVersion: 'city-street-centerline:2025-01-01T00:00:00.000Z',
  }));
  assert.throws(() => matchKnownRouteToCenterline({ normalizedRoute: pinned, catalog: catalog() }), /data version/i);
});

test('generalized hundred-block evidence uses uncertainty contributions, excludes ambiguous/unavailable rows, and adds to route total', () => {
  const normalizedRoute = admitKnownRouteEvidenceRequest(request());
  const match = matchKnownRouteToCenterline({ normalizedRoute, catalog: catalog() });
  const accumulator = createGeneralizedIncidentAccumulator({ matchedEdges: match.matchedEdges });
  const base = {
    lifecycle: { state: 'active' },
    coordinate: { status: 'available', value: [-75.166, 39.9505], exact_location_claim: false },
    generalized_location: { exact_sidewalk_or_street_segment: false },
    normalized_category: { status: 'mapped', theme_id: 'reported-theft' },
  };
  assert.equal(addCanonicalGeneralizedIncident(accumulator, base), true);
  assert.equal(addCanonicalGeneralizedIncident(accumulator, {
    ...base,
    coordinate: { status: 'unavailable', value: null, exact_location_claim: false },
  }), false);
  assert.equal(addCanonicalGeneralizedIncident(accumulator, {
    ...base,
    coordinate: { ...base.coordinate, exact_location_claim: true },
  }), false);
  const result = finalizeGeneralizedIncidentAccumulator(accumulator);
  const segmentSum = result.segments.reduce((sum, segment) => sum + segment.contributionUnits, 0);
  assert.equal(Number(segmentSum.toFixed(6)), result.route.contributionUnits);
  assert.equal(result.route.contributingRows, 1);
  assert.equal(result.excluded.coordinateUnavailable, 1);
  assert.equal(result.excluded.precisionUnavailable, 1);
  assert.match(result.method.precision, /hundred-block-generalized/i);
  assert.doesNotMatch(JSON.stringify(result), /source_record_id|generalized_location|\[-75\.|\[39\.95/i);
});

test('admitted zero stays distinct from unavailable sources and share state cannot contain route privacy fields', () => {
  const match = matchKnownRouteToCenterline({
    normalizedRoute: admitKnownRouteEvidenceRequest(request()),
    catalog: catalog(),
  });
  const empty = finalizeGeneralizedIncidentAccumulator(createGeneralizedIncidentAccumulator({ matchedEdges: match.matchedEdges }));
  assert.equal(empty.status, 'admitted-zero');
  assert.equal(empty.route.contributionUnits, 0);

  const share = createKnownRouteEvidenceShareState({
    language: 'zh',
    expandedEvidence: ['accessibility', 'reported-incidents'],
  });
  const text = JSON.stringify(share);
  assert.equal(share.exactRouteIncluded, false);
  assert.equal(share.transportModeIncluded, false);
  assert.doesNotMatch(text, /-75\.|39\.|coordinates|polyline|address|destination|walking|source_record/i);

  const disclosure = createCenterlineQueryDisclosure();
  assert.match(disclosure.endpoint, /^https:\/\/services\.arcgis\.com\//);
  assert.ok(disclosure.sentFields.some((value) => /bbox/i.test(value)));
  assert.ok(disclosure.notSent.some((value) => /polyline/i.test(value)));
});

test('checkpoint recovery is strict and yields the same additive aggregate and semantic identity', () => {
  const normalizedRoute = admitKnownRouteEvidenceRequest(request());
  const admittedCatalog = catalog();
  const match = matchKnownRouteToCenterline({ normalizedRoute, catalog: admittedCatalog });
  const expected = {
    warehouseIdentity: 'sha256:warehouse:sha256:snapshot',
    routeIdentity: normalizedRoute.sessionRouteIdentity,
    centerlineDataVersion: match.dataVersion,
    catalogIdentity: admittedCatalog.catalogIdentity,
    corridorIdentity: match.corridorIdentity,
    partitionCount: 2,
  };
  const firstEvent = {
    lifecycle: { state: 'active' },
    coordinate: { status: 'available', value: [-75.166, 39.9505], exact_location_claim: false },
    generalized_location: { exact_sidewalk_or_street_segment: false },
    normalized_category: { status: 'mapped', theme_id: 'reported-theft' },
  };
  const secondEvent = {
    ...firstEvent,
    coordinate: { ...firstEvent.coordinate, value: [-75.154, 39.9504] },
    normalized_category: { status: 'mapped', theme_id: 'reported-assault' },
  };
  const interrupted = createGeneralizedIncidentAccumulator({ matchedEdges: match.matchedEdges });
  addCanonicalGeneralizedIncident(interrupted, firstEvent);
  const checkpoint = createKnownRouteEvidenceCheckpoint({
    ...expected,
    completedPartitions: 1,
    accumulator: interrupted,
    startedAt: '2026-08-21T00:00:00.000Z',
  });
  assert.doesNotMatch(JSON.stringify(checkpoint.accumulator), /source_record|generalized_location|coordinates|\[-75\./i);
  const recovered = restoreKnownRouteEvidenceAccumulator(checkpoint, { matchedEdges: match.matchedEdges, expected });
  addCanonicalGeneralizedIncident(recovered, secondEvent);

  const uninterrupted = createGeneralizedIncidentAccumulator({ matchedEdges: match.matchedEdges });
  addCanonicalGeneralizedIncident(uninterrupted, firstEvent);
  addCanonicalGeneralizedIncident(uninterrupted, secondEvent);
  assert.deepEqual(finalizeGeneralizedIncidentAccumulator(recovered), finalizeGeneralizedIncidentAccumulator(uninterrupted));

  const warehouseManifest = {
    schema: 'engagement-phl-crime-event-warehouse/v1',
    serving_eligible: false,
    current_snapshot_id: 'sha256:snapshot',
    partition_count: 2,
    active_row_count: 2,
    coverage: { earliest_scope_start: '2006-01-01', latest_scope_end_exclusive: '2026-08-22' },
  };
  const report = (accumulator, completedAt) => createSafeKnownRouteAggregateReport({
    warehouseManifest,
    warehouseManifestIdentity: 'sha256:manifest',
    routeLabel: 'PUBLIC TEST ROUTE',
    match,
    catalogFeatureCount: admittedCatalog.featureCount,
    accumulator,
    completion: { completedAt, durationMs: 1, maximumRssBytes: 1, resumedPartitions: 1 },
  });
  const recoveredReport = report(recovered, '2026-08-21T00:01:00.000Z');
  const freshReport = report(uninterrupted, '2026-08-21T00:02:00.000Z');
  assert.equal(recoveredReport.semanticIdentity, freshReport.semanticIdentity);
  assert.doesNotMatch(JSON.stringify(recoveredReport), /source_record_id|generalized_location|\[-75\./i);
  assert.deepEqual(recoveredReport.privacy, {
    containsEventRows: false,
    containsEventCoordinates: false,
    containsGeneralizedLocations: false,
    containsAddresses: false,
    containsSourceRecordIds: false,
    containsRouteCoordinates: false,
    containsRouteEndpoints: false,
  });
  assert.throws(() => restoreKnownRouteEvidenceAccumulator({
    ...checkpoint,
    accumulator: { ...checkpoint.accumulator, rowsRead: -1 },
  }, { matchedEdges: match.matchedEdges, expected }), /invalid/i);
});

test('M4 lazy UI and build surfaces exclude persistence, share-route, console, and tracked public-route coordinates', async () => {
  const [ui, runtime, build, buildContract, smoke] = await Promise.all([
    readFile(new URL('../../src/routes_crime/known_route_evidence_ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_crime/route_corridor_app_runtime.js', import.meta.url), 'utf8'),
    readFile(new URL('../build_known_route_evidence.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../lib/known_route_evidence_checkpoint.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../smoke_known_route_evidence.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(runtime, /import\('\.\/known_route_evidence_ui\.js'\)/);
  assert.match(ui, /data-known-route-consent/);
  assert.match(ui, /textContent/);
  assert.match(ui, /No total safety score/i);
  assert.match(ui, /raw crash/i);
  assert.match(ui, /Accessibility evidence/i);
  assert.doesNotMatch(ui, /localStorage|sessionStorage|indexedDB|history\.(?:pushState|replaceState)|console\./);
  assert.doesNotMatch(`${build}\n${smoke}`, /\[-75\.\d+\s*,\s*39\.\d+\]/);
  assert.match(buildContract, /containsRouteCoordinates:\s*false/);
  assert.match(buildContract, /containsSourceRecordIds:\s*false/);
});
