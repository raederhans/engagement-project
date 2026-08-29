import assert from 'node:assert/strict';
import test from 'node:test';
import {
  admitKnownRouteEvidenceRequest,
} from '../../src/routes_crime/known_route_evidence_contract.js';
import {
  admitCenterlineFeatureCollection,
  admitCenterlineMetadata,
  matchKnownRouteToCenterline,
} from '../../src/routes_crime/known_route_centerline.js';
import {
  KNOWN_ROUTE_MODE_LEGALITY_QUALITY_SCHEMA,
  KNOWN_ROUTE_MODE_RESTRICTION_EVIDENCE_SCHEMA,
  createKnownRouteModeRestrictionReceipt,
} from '../../src/routes_crime/known_route_mode_legality_quality.js';
import {
  buildKnownRouteModeLegalityQualityEvidence,
  knownRouteModeLegalityQualityEvidenceSchema,
  validateKnownRouteModeLegalityQualityEvidence,
} from '../lib/known_route_mode_legality_quality_evidence.mjs';

const SOURCE_ID = 'synthetic-encoded-mode-restrictions';
const ENCODED = Object.freeze({
  mode_restrictions: true,
  oneway: true,
  access: true,
  temporal: true,
  turn: true,
  boundary: true,
});

test('exports a stable aggregate-only identity with per-mode legality and no authority', () => {
  const firstInputs = admittedInputs();
  const secondInputs = admittedInputs([...defaultFeatures()].reverse());
  const first = buildKnownRouteModeLegalityQualityEvidence(firstInputs);
  const second = buildKnownRouteModeLegalityQualityEvidence(secondInputs);

  assert.equal(first.schema, KNOWN_ROUTE_MODE_LEGALITY_QUALITY_SCHEMA);
  assert.equal(first.semantic_identity, second.semantic_identity);
  assert.equal(first.route_identity, second.route_identity);
  assert.equal(first.corridor_identity, second.corridor_identity);
  assert.equal(first.centerline_identity, second.centerline_identity);
  assert.deepEqual(first.authority, { mode: false, routing: false, safety: false });
  assert.deepEqual(first.privacy, {
    aggregate_only: true,
    route_coordinates_included: false,
    geometry_included: false,
    edge_ids_included: false,
    raw_rows_included: false,
    private_fields_included: false,
  });
  assert.deepEqual(
    Object.values(first.mode_legality).map(({ status }) => status),
    ['unavailable', 'unavailable', 'unavailable', 'unavailable'],
  );
  assert.equal(first.match_quality.status, 'unavailable');
  assert.equal(first.match_quality.calibration_status, 'uncalibrated');
  assert.equal(first.match_quality.reason, 'uncalibrated-deterministic-candidate');
  assert.doesNotMatch(
    JSON.stringify(first),
    /"coordinates"|"geometry"|"sourceEdgeKey"|"edge_id"|"raw_rows"|"private_fields"\s*:/i,
  );
});

test('admits complete version-bound encoded restrictions independently per mode', () => {
  const inputs = admittedInputs();
  const walking = restrictionReceipt(inputs, 'walking');
  const cycling = clone(restrictionReceipt(inputs, 'cycling'));
  cycling.encoded_evidence.turn = false;
  const evidence = buildKnownRouteModeLegalityQualityEvidence({
    ...inputs,
    modeRestrictionEvidence: restrictionEnvelope(inputs, { walking, cycling }),
  });

  assert.equal(evidence.mode_legality.walking.status, 'available');
  assert.equal(
    evidence.mode_legality.walking.source_receipt.receipt_identity,
    walking.receipt_identity,
  );
  assert.deepEqual(evidence.mode_legality.cycling, {
    status: 'unavailable',
    reason: 'incomplete-mode-restriction-evidence',
  });
  assert.equal(evidence.mode_legality.driving.status, 'unavailable');
  assert.equal(evidence.mode_legality.transit.status, 'unavailable');
  assert.equal(evidence.authority.mode, false);
});

test('missing or mismatched source version and incomplete restrictions fail closed', () => {
  const inputs = admittedInputs();
  const walking = restrictionReceipt(inputs, 'walking');
  const missingVersion = restrictionEnvelope(inputs, { walking });
  missingVersion.source_version = undefined;
  const missing = buildKnownRouteModeLegalityQualityEvidence({
    ...inputs,
    modeRestrictionEvidence: missingVersion,
  });
  assert.equal(
    missing.mode_legality.walking.reason,
    'mode-restriction-source-version-missing',
  );

  const mismatchedVersion = restrictionEnvelope(inputs, { walking });
  mismatchedVersion.source_version = 'city-street-centerline:2025-01-01T00:00:00.000Z';
  const mismatched = buildKnownRouteModeLegalityQualityEvidence({
    ...inputs,
    modeRestrictionEvidence: mismatchedVersion,
  });
  assert.equal(
    mismatched.mode_legality.walking.reason,
    'mode-restriction-source-version-mismatch',
  );

  const partial = clone(walking);
  delete partial.encoded_evidence.boundary;
  const incomplete = buildKnownRouteModeLegalityQualityEvidence({
    ...inputs,
    modeRestrictionEvidence: restrictionEnvelope(inputs, { walking: partial }),
  });
  assert.equal(
    incomplete.mode_legality.walking.reason,
    'incomplete-mode-restriction-evidence',
  );
});

test('current centerline, OSM walking candidate, and M5 are not legality receipts', () => {
  const inputs = admittedInputs();
  for (const sourceId of [
    'philadelphia-street-centerline',
    'osm-walking-strict-candidate-v1',
    'm5-route-alternatives',
  ]) {
    const walking = clone(restrictionReceipt(inputs, 'walking'));
    walking.source_id = sourceId;
    const envelope = restrictionEnvelope(inputs, { walking });
    envelope.source_id = sourceId;
    const evidence = buildKnownRouteModeLegalityQualityEvidence({
      ...inputs,
      modeRestrictionEvidence: envelope,
    });
    assert.equal(
      evidence.mode_legality.walking.reason,
      'mode-restriction-source-insufficient',
    );
  }
});

test('ambiguous, off-network, and disconnected map matches remain bounded and unavailable', () => {
  const ambiguousInputs = admittedInputs([
    ...defaultFeatures(),
    feature({
      objectid: 12,
      segId: 102,
      from: 4,
      to: 5,
      coordinates: [[-75.17, 39.950005], [-75.15, 39.950005]],
    }),
  ]);
  assert.equal(ambiguousInputs.match.reason, 'multiple-candidate-ambiguity');
  const ambiguous = buildKnownRouteModeLegalityQualityEvidence(ambiguousInputs);
  assert.equal(ambiguous.match_quality.reason, 'ambiguous-map-match-candidate');
  assert.equal(ambiguous.match_quality.ambiguity_count, 1);
  assert.equal(ambiguous.match_quality.status, 'unavailable');

  const offNetworkInputs = admittedInputs(defaultFeatures().map((entry) => ({
    ...entry,
    geometry: {
      ...entry.geometry,
      coordinates: entry.geometry.coordinates.map(([lon, lat]) => [lon, lat + 0.01]),
    },
  })));
  assert.equal(offNetworkInputs.match.reason, 'off-network');
  const offNetwork = buildKnownRouteModeLegalityQualityEvidence(offNetworkInputs);
  assert.equal(offNetwork.match_quality.reason, 'off-network-map-match-candidate');
  assert.equal(offNetwork.match_quality.off_network_count, 1);
  assert.equal(offNetwork.match_quality.status, 'unavailable');

  const disconnectedFeatures = defaultFeatures();
  disconnectedFeatures[1] = feature({
    objectid: 11,
    segId: 101,
    from: 9,
    to: 10,
    coordinates: [[-75.16, 39.95], [-75.15, 39.95]],
  });
  const disconnectedInputs = admittedInputs(disconnectedFeatures);
  assert.equal(disconnectedInputs.match.reason, 'disconnected-centerline-chain');
  const disconnected = buildKnownRouteModeLegalityQualityEvidence(disconnectedInputs);
  assert.equal(disconnected.match_quality.reason, 'disconnected-map-match-candidate');
  assert.equal(disconnected.match_quality.disconnect_count, 1);
  assert.equal(disconnected.match_quality.status, 'unavailable');
});

test('source, mode, route, corridor, and centerline receipt mismatches fail closed per mode', () => {
  const inputs = admittedInputs();
  const cases = [
    ['source_id', 'different-restriction-source', 'mode-restriction-source-mismatch'],
    ['mode', 'cycling', 'mode-restriction-mode-mismatch'],
    ['route_identity', 'route:0000000000000000', 'mode-restriction-route-mismatch'],
    ['corridor_identity', 'known-route-corridor:0000000000000000', 'mode-restriction-corridor-mismatch'],
    ['centerline_identity', 'centerline-catalog:0000000000000000', 'mode-restriction-centerline-mismatch'],
  ];
  for (const [field, value, reason] of cases) {
    const walking = clone(restrictionReceipt(inputs, 'walking'));
    walking[field] = value;
    const evidence = buildKnownRouteModeLegalityQualityEvidence({
      ...inputs,
      modeRestrictionEvidence: restrictionEnvelope(inputs, { walking }),
    });
    assert.equal(evidence.mode_legality.walking.reason, reason);
    assert.equal(evidence.mode_legality.cycling.status, 'unavailable');
  }
});

test('core route, source, centerline, and corridor mismatches cannot create an artifact', () => {
  const inputs = admittedInputs();
  const routeMismatch = clone(inputs.match);
  routeMismatch.normalizedRoute.sessionRouteIdentity = 'route:0000000000000000';
  assert.throws(
    () => buildKnownRouteModeLegalityQualityEvidence({ ...inputs, match: routeMismatch }),
    /binding mismatched/i,
  );

  const sourceMismatch = clone(inputs.match);
  sourceMismatch.dataVersion = 'city-street-centerline:2025-01-01T00:00:00.000Z';
  assert.throws(
    () => buildKnownRouteModeLegalityQualityEvidence({ ...inputs, match: sourceMismatch }),
    /binding mismatched/i,
  );

  const centerlineMismatch = clone(inputs.match);
  centerlineMismatch.catalogIdentity = 'centerline-catalog:0000000000000000';
  assert.throws(
    () => buildKnownRouteModeLegalityQualityEvidence({ ...inputs, match: centerlineMismatch }),
    /binding mismatched/i,
  );

  const corridorMismatch = clone(inputs.match);
  corridorMismatch.corridorIdentity = 'not-an-identity';
  assert.throws(
    () => buildKnownRouteModeLegalityQualityEvidence({ ...inputs, match: corridorMismatch }),
    /binding mismatched/i,
  );
});

test('strict validator rejects NaN, Infinity, unknown fields, privacy leakage, and authority drift', () => {
  const evidence = buildKnownRouteModeLegalityQualityEvidence(admittedInputs());
  const hostile = [
    mutate(evidence, (value) => { value.match_quality.maximum_distance_m = Number.NaN; }),
    mutate(evidence, (value) => { value.match_quality.candidate_margin_m = Number.POSITIVE_INFINITY; }),
    mutate(evidence, (value) => { value.match_quality.confidence = 0.99; }),
    mutate(evidence, (value) => { value.privacy.aggregate_only = false; }),
    mutate(evidence, (value) => { value.authority.routing = true; }),
    mutate(evidence, (value) => { value.coordinates = [[-75.17, 39.95]]; }),
  ];
  for (const value of hostile) {
    assert.throws(() => validateKnownRouteModeLegalityQualityEvidence(value));
  }

  const inputs = admittedInputs();
  const walking = clone(restrictionReceipt(inputs, 'walking'));
  walking.raw_rows = [];
  assert.throws(
    () => buildKnownRouteModeLegalityQualityEvidence({
      ...inputs,
      modeRestrictionEvidence: restrictionEnvelope(inputs, { walking }),
    }),
    /unknown fields/i,
  );
});

test('published JSON schema is closed and names the exact v1 contract', () => {
  const schema = knownRouteModeLegalityQualityEvidenceSchema();
  assert.equal(schema.title, KNOWN_ROUTE_MODE_LEGALITY_QUALITY_SCHEMA);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.schema.const, KNOWN_ROUTE_MODE_LEGALITY_QUALITY_SCHEMA);
  assert.equal(schema.properties.authority.properties.routing.const, false);
  assert.equal(schema.properties.privacy.properties.aggregate_only.const, true);
  assert.equal(schema.$defs.sourceReceipt.additionalProperties, false);
  assert.equal(schema.$defs.modeLegality.oneOf.length, 2);
});

function admittedInputs(features = defaultFeatures()) {
  const normalizedRoute = admitKnownRouteEvidenceRequest({
    schema: 'known-route-evidence-request/v1',
    routeInput: {
      inputKind: 'known-polyline',
      source: 'manual-draw',
      geometry: {
        type: 'LineString',
        coordinates: [[-75.17, 39.95], [-75.16, 39.95], [-75.15, 39.95]],
      },
    },
    transportMode: 'walking',
    requestedDataVersion: 'current-observed',
  });
  const version = admitCenterlineMetadata(metadata());
  const catalog = admitCenterlineFeatureCollection(featureCollection(features), {
    expectedCount: features.length,
    sourceVersion: version,
  });
  const match = matchKnownRouteToCenterline({ normalizedRoute, catalog });
  return { normalizedRoute, catalog, match };
}

function restrictionEnvelope(inputs, modes) {
  return {
    schema: KNOWN_ROUTE_MODE_RESTRICTION_EVIDENCE_SCHEMA,
    source_id: SOURCE_ID,
    source_version: inputs.catalog.source.dataVersion,
    modes,
  };
}

function restrictionReceipt(inputs, mode) {
  assert.equal(inputs.match.status, 'matched');
  return createKnownRouteModeRestrictionReceipt({
    sourceId: SOURCE_ID,
    sourceVersion: inputs.catalog.source.dataVersion,
    mode,
    routeIdentity: inputs.normalizedRoute.sessionRouteIdentity,
    corridorIdentity: inputs.match.corridorIdentity,
    centerlineIdentity: inputs.catalog.catalogIdentity,
    encodedEvidence: ENCODED,
  });
}

function metadata() {
  return {
    serviceItemId: 'c36d828494cd44b5bd8b038be696c839',
    name: 'Street_Centerline',
    type: 'Feature Layer',
    geometryType: 'esriGeometryPolyline',
    capabilities: 'Query',
    objectIdField: 'objectid',
    maxRecordCount: 2_000,
    hasZ: false,
    hasM: false,
    supportedQueryFormats: 'JSON, geoJSON',
    editingInfo: { dataLastEditDate: 1_754_054_132_074 },
    fields: [
      ['objectid', 'esriFieldTypeOID'],
      ['seg_id', 'esriFieldTypeInteger'],
      ['fnode_', 'esriFieldTypeInteger'],
      ['tnode_', 'esriFieldTypeInteger'],
      ['oneway', 'esriFieldTypeString'],
      ['class', 'esriFieldTypeSmallInteger'],
      ['streetlabe', 'esriFieldTypeString'],
      ['update_', 'esriFieldTypeDate'],
    ].map(([name, type]) => ({ name, type })),
  };
}

function defaultFeatures() {
  return [
    feature({
      objectid: 10,
      segId: 100,
      from: 1,
      to: 2,
      coordinates: [[-75.17, 39.95], [-75.16, 39.95]],
    }),
    feature({
      objectid: 11,
      segId: 101,
      from: 2,
      to: 3,
      coordinates: [[-75.16, 39.95], [-75.15, 39.95]],
    }),
  ];
}

function feature({ objectid, segId, from, to, coordinates }) {
  return {
    type: 'Feature',
    properties: {
      objectid,
      seg_id: segId,
      fnode_: from,
      tnode_: to,
      oneway: ' ',
      class: 5,
      streetlabe: 'SYNTHETIC TEST STREET',
      update_: null,
    },
    geometry: { type: 'LineString', coordinates },
  };
}

function featureCollection(features) {
  return {
    type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: 'EPSG:4326' } },
    features,
  };
}

function clone(value) {
  return structuredClone(value);
}

function mutate(value, mutation) {
  const copy = clone(value);
  mutation(copy);
  return copy;
}
