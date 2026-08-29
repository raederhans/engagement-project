#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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
  KNOWN_ROUTE_EVIDENCE_ALGORITHM_VERSION,
  createKnownRouteEvidenceCheckpoint,
  createKnownRouteEvidenceFinalHandoff,
  createSafeKnownRouteAggregateReport,
  identityOf,
  publishKnownRouteFinalArtifacts,
  restoreKnownRouteEvidenceAccumulator,
  validateKnownRouteEvidenceFinalHandoff,
} from '../lib/known_route_evidence_checkpoint.mjs';
import {
  runKnownRouteEvidenceBuild,
  validateKnownRouteWarehouseInput,
  validateM2Governance,
} from '../build_known_route_evidence.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

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

test('centerline admission and map matching enforce geometry and main-thread computation budgets', () => {
  const oversizedCoordinates = Array.from({ length: 5_001 }, (_, index) => [
    -75.17 + index * 0.000001,
    39.95,
  ]);
  assert.throws(
    () => catalog([feature({
      objectid: 1,
      segId: 1,
      from: 1,
      to: 2,
      coordinates: oversizedCoordinates,
    })]),
    /geometry is unsupported/i,
  );

  const denseCoordinates = Array.from({ length: 50 }, (_, index) => [
    -75.17 + index * 0.0004,
    39.95,
  ]);
  const denseFeatures = Array.from({ length: 500 }, (_, index) => feature({
    objectid: index + 1,
    segId: index + 1,
    from: index + 1,
    to: index + 2,
    coordinates: denseCoordinates,
  }));
  const result = matchKnownRouteToCenterline({
    normalizedRoute: admitKnownRouteEvidenceRequest(request()),
    catalog: catalog(denseFeatures),
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'matching-complexity-limit');
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
    warehouseIdentity: digest('warehouse'),
    warehouseReceiptDigest: digest('receipt-bytes'),
    warehouseManifestIdentity: digest('manifest-bytes'),
    partitionSetIdentity: digest('partition-set'),
    routeIdentity: identityOf({ sessionRouteIdentity: normalizedRoute.sessionRouteIdentity }),
    centerlineDataVersion: match.dataVersion,
    catalogIdentity: identityOf({ catalogIdentity: admittedCatalog.catalogIdentity }),
    corridorIdentity: match.corridorIdentity,
    algorithmVersion: KNOWN_ROUTE_EVIDENCE_ALGORITHM_VERSION,
    partitionCount: 2,
  };
  const verifiedPartitions = [0, 1].map((partition) => ({
    partition,
    path: `canonical/part-${String(partition).padStart(3, '0')}.jsonl`,
    rowCount: 1,
    bytes: 10 + partition,
    sha256: digest(`part-${partition}`),
  }));
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
    completedPartitionBindings: verifiedPartitions.slice(0, 1),
    accumulator: interrupted,
    startedAt: '2026-08-21T00:00:00.000Z',
  });
  assert.doesNotMatch(JSON.stringify(checkpoint.accumulator), /source_record|generalized_location|coordinates|\[-75\./i);
  const recovered = restoreKnownRouteEvidenceAccumulator(checkpoint, {
    matchedEdges: match.matchedEdges,
    expected,
    verifiedPartitions,
  });
  addCanonicalGeneralizedIncident(recovered, secondEvent);

  const uninterrupted = createGeneralizedIncidentAccumulator({ matchedEdges: match.matchedEdges });
  addCanonicalGeneralizedIncident(uninterrupted, firstEvent);
  addCanonicalGeneralizedIncident(uninterrupted, secondEvent);
  assert.deepEqual(finalizeGeneralizedIncidentAccumulator(recovered), finalizeGeneralizedIncidentAccumulator(uninterrupted));

  const warehouseReceipt = {
    schema: 'engagement-phl-crime-warehouse-receipt/v3',
    identity: expected.warehouseIdentity,
    serving_eligible: false,
    warehouse: { schema: 'engagement-phl-crime-event-warehouse/v1', current_snapshot_id: digest('snapshot') },
    counts: { canonical_partitions: 2, active_rows: 2 },
    coverage: { start: '2006-01-01', end_exclusive: '2026-08-28' },
  };
  const report = (accumulator, completedAt) => createSafeKnownRouteAggregateReport({
    warehouseReceipt,
    warehouseReceiptDigest: expected.warehouseReceiptDigest,
    warehouseManifestIdentity: expected.warehouseManifestIdentity,
    partitionSetIdentity: expected.partitionSetIdentity,
    routeIdentity: expected.routeIdentity,
    catalogIdentity: expected.catalogIdentity,
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
    containsRawRoute: false,
    containsRouteCoordinates: false,
    containsRouteEndpoints: false,
    containsCenterlineSourceEdgeIds: false,
  });
  assert.throws(() => restoreKnownRouteEvidenceAccumulator({
    ...checkpoint,
    accumulator: { ...checkpoint.accumulator, rowsRead: -1 },
  }, { matchedEdges: match.matchedEdges, expected, verifiedPartitions }), /invalid/i);
  assert.throws(() => restoreKnownRouteEvidenceAccumulator({
    ...checkpoint,
    schema: 'known-route-evidence-checkpoint/v1',
  }, { matchedEdges: match.matchedEdges, expected, verifiedPartitions }), /invalid/i);
  assert.throws(() => restoreKnownRouteEvidenceAccumulator(checkpoint, {
    matchedEdges: match.matchedEdges,
    expected: { ...expected, algorithmVersion: 'hostile-algorithm/v1' },
    verifiedPartitions,
  }), /algorithmVersion/i);
  for (const [key, value] of [
    ['warehouseIdentity', digest('other-receipt')],
    ['warehouseManifestIdentity', digest('other-manifest')],
    ['partitionSetIdentity', digest('other-parts')],
    ['routeIdentity', digest('other-route')],
    ['centerlineDataVersion', 'other-centerline-version'],
    ['catalogIdentity', digest('other-catalog')],
    ['corridorIdentity', 'other-corridor'],
  ]) {
    assert.throws(() => restoreKnownRouteEvidenceAccumulator(checkpoint, {
      matchedEdges: match.matchedEdges,
      expected: { ...expected, [key]: value },
      verifiedPartitions,
    }), new RegExp(key, 'i'));
  }
});

test('M1 receipt/v3 preflight binds every companion and exact 64-part rows, bytes, SHA-256, and name set', async (t) => {
  const fixture = await createM1ReceiptFixture();
  t.after(async () => fs.rm(fixture.testRoot, { recursive: true, force: true }));
  const admitted = await validateKnownRouteWarehouseInput({
    warehouseRoot: fixture.root,
    expectedReceiptIdentity: fixture.receipt.identity,
  });
  assert.equal(admitted.partitions.length, 64);
  assert.equal(admitted.summary.canonicalRows, 64);
  assert.equal(admitted.receipt.identity, fixture.receipt.identity);

  await withRestoredFile(fixture.receiptPath, async (bytes) => {
    const hostile = JSON.parse(bytes);
    hostile.identity = digest('forged-receipt');
    await fs.writeFile(fixture.receiptPath, `${JSON.stringify(hostile, null, 2)}\n`);
    await assert.rejects(
      validateKnownRouteWarehouseInput({ warehouseRoot: fixture.root, expectedReceiptIdentity: fixture.receipt.identity }),
      /receipt\/v3 identity/i,
    );
  });
  await withRestoredFile(fixture.receiptPath, async (bytes) => {
    const hostile = JSON.parse(bytes);
    hostile.clocks.retrieved_at = '2026-08-26T00:00:00.000Z';
    delete hostile.identity;
    hostile.identity = identityOf(hostile);
    await fs.writeFile(fixture.receiptPath, `${JSON.stringify(hostile, null, 2)}\n`);
    await assert.rejects(
      validateKnownRouteWarehouseInput({ warehouseRoot: fixture.root, expectedReceiptIdentity: hostile.identity }),
      /binding drifted|four-clock|source coverage/i,
    );
  });

  await withRestoredFile(fixture.manifestPath, async (bytes) => {
    await fs.writeFile(fixture.manifestPath, Buffer.concat([bytes, Buffer.from(' ')]));
    await assert.rejects(
      validateKnownRouteWarehouseInput({ warehouseRoot: fixture.root, expectedReceiptIdentity: fixture.receipt.identity }),
      /warehouse_manifest bytes, SHA-256/i,
    );
  });

  const part = path.join(fixture.root, 'warehouse', 'canonical', 'part-000.jsonl');
  await withRestoredFile(part, async (bytes) => {
    const hostile = Buffer.from(bytes);
    hostile[hostile.indexOf(0x30)] = 0x39;
    await fs.writeFile(part, hostile);
    await assert.rejects(
      validateKnownRouteWarehouseInput({ warehouseRoot: fixture.root, expectedReceiptIdentity: fixture.receipt.identity }),
      /rows, bytes, or SHA-256 drifted/i,
    );
  });
  await withRestoredFile(part, async (bytes) => {
    await fs.writeFile(part, Buffer.concat([bytes, bytes]));
    await assert.rejects(
      validateKnownRouteWarehouseInput({ warehouseRoot: fixture.root, expectedReceiptIdentity: fixture.receipt.identity }),
      /rows, bytes, or SHA-256 drifted/i,
    );
  });

  const extra = path.join(path.dirname(part), 'part-999.jsonl');
  await fs.writeFile(extra, '{"partition":999}\n');
  await assert.rejects(
    validateKnownRouteWarehouseInput({ warehouseRoot: fixture.root, expectedReceiptIdentity: fixture.receipt.identity }),
    /extra, missing, renamed/i,
  );
  await fs.rm(extra);
  const renamed = `${part}.renamed`;
  await fs.rename(part, renamed);
  await assert.rejects(
    validateKnownRouteWarehouseInput({ warehouseRoot: fixture.root, expectedReceiptIdentity: fixture.receipt.identity }),
    /extra, missing, renamed/i,
  );
  await fs.rename(renamed, part);
});

test('M2 governance stays order-only and final handoff rejects hostile lineage, clocks, consent, and authority', async (t) => {
  const m2 = await createM2Fixture();
  t.after(async () => fs.rm(m2.testRoot, { recursive: true, force: true }));
  const governance = await validateM2Governance({
    evidenceRoot: m2.root,
    expectedMartIdentity: m2.martIdentity,
    implementationTip: commit('implementation'),
    executionRecordTip: commit('execution'),
    cumulativeTip: commit('cumulative'),
    expectedM1ReceiptIdentity: m2.m1ReceiptIdentity,
    expectedM1Revision: m2.m1Revision,
    expectedM1Coverage: m2.coverage,
    expectedM1Rows: 64,
    validateMart: async () => m2.martGate,
    verifyTips: async () => {},
  });
  assert.equal(governance.dqRechecked, true);
  assert.equal(governance.routeEvidenceAuthority, false);
  assert.deepEqual(governance.outcome, {
    promotionStatus: 'not-promoted', selectedModel: null, availability: 'unavailable',
  });

  await withRestoredFile(m2.reportPath, async (bytes) => {
    const hostile = JSON.parse(bytes);
    hostile.data.admission.tract.admitted -= 1;
    await fs.writeFile(m2.reportPath, `${JSON.stringify(hostile, null, 2)}\n`);
    await assert.rejects(validateM2Governance({
      evidenceRoot: m2.root,
      expectedMartIdentity: m2.martIdentity,
      implementationTip: commit('implementation'),
      executionRecordTip: commit('execution'),
      cumulativeTip: commit('cumulative'),
      expectedM1ReceiptIdentity: m2.m1ReceiptIdentity,
      expectedM1Revision: m2.m1Revision,
      expectedM1Coverage: m2.coverage,
      expectedM1Rows: 64,
      validateMart: async () => m2.martGate,
      verifyTips: async () => {},
    }), /artifact binding|DQ recheck/i);
  });
  await withRestoredFile(m2.evaluationPath, async (bytes) => {
    const hostile = JSON.parse(bytes);
    hostile.lineage_seam.m1_receipt.identity = digest('other-m1-receipt');
    await fs.writeFile(m2.evaluationPath, `${JSON.stringify(hostile, null, 2)}\n`);
    await assert.rejects(validateM2Governance({
      evidenceRoot: m2.root,
      expectedMartIdentity: m2.martIdentity,
      implementationTip: commit('implementation'),
      executionRecordTip: commit('execution'),
      cumulativeTip: commit('cumulative'),
      expectedM1ReceiptIdentity: m2.m1ReceiptIdentity,
      expectedM1Revision: m2.m1Revision,
      expectedM1Coverage: m2.coverage,
      expectedM1Rows: 64,
      validateMart: async () => m2.martGate,
      verifyTips: async () => {},
    }), /lineage/i);
  });

  const { match, admittedCatalog, normalizedRoute } = matchedFixture();
  const accumulator = createGeneralizedIncidentAccumulator({ matchedEdges: match.matchedEdges });
  const eventRow = {
    lifecycle: { state: 'active' },
    coordinate: { status: 'available', value: [-75.166, 39.9505], exact_location_claim: false },
    generalized_location: { exact_sidewalk_or_street_segment: false },
    normalized_category: { status: 'mapped', theme_id: 'reported-theft' },
  };
  addCanonicalGeneralizedIncident(accumulator, eventRow);
  const part = { partition: 0, path: 'canonical/part-000.jsonl', rowCount: 1, bytes: 10, sha256: digest('part') };
  const checkpoint = createKnownRouteEvidenceCheckpoint({
    warehouseIdentity: m2.m1ReceiptIdentity,
    warehouseReceiptDigest: digest('m1-receipt-bytes'),
    warehouseManifestIdentity: digest('m1-manifest'),
    partitionSetIdentity: digest('m1-parts'),
    routeIdentity: identityOf({ sessionRouteIdentity: normalizedRoute.sessionRouteIdentity }),
    centerlineDataVersion: match.dataVersion,
    catalogIdentity: identityOf({ catalogIdentity: admittedCatalog.catalogIdentity }),
    corridorIdentity: match.corridorIdentity,
    completedPartitions: 1,
    completedPartitionBindings: [part],
    partitionCount: 1,
    accumulator,
    startedAt: '2026-08-29T01:00:00.000Z',
    completion: {
      state: 'complete', completedAt: '2026-08-29T01:01:00.000Z', durationMs: 60_000,
      maximumRssBytes: 1, resumedPartitions: 0,
    },
  });
  const warehouseReceipt = {
    clocks: { source_as_of: '2026-08-28T00:00:00.000Z', retrieved_at: '2026-08-28T01:00:00.000Z' },
  };
  const handoff = createKnownRouteEvidenceFinalHandoff({
    checkpoint, warehouseReceipt, m2Governance: governance, publicCenterlineRequest: true,
  });
  assert.equal(validateKnownRouteEvidenceFinalHandoff(handoff), handoff);
  assert.doesNotMatch(JSON.stringify(handoff), /source_record_id|"coordinates"|routeInput|matchedEdges/i);
  for (const mutate of [
    (value) => { value.consent.publicCenterlineRequest = false; },
    (value) => { value.clocks.observedAt = '2026-08-27T00:00:00.000Z'; },
    (value) => { value.lineage.catalogIdentity = digest('hostile-catalog'); },
    (value) => { value.governance.m2.dqRechecked = false; },
    (value) => { value.authority.routing = true; },
  ]) {
    const hostile = structuredClone(handoff);
    mutate(hostile);
    hostile.identity = identityOf(Object.fromEntries(Object.entries(hostile).filter(([key]) => key !== 'identity')));
    assert.throws(() => validateKnownRouteEvidenceFinalHandoff(hostile), /invalid/i);
  }
});

test('final artifact transaction rolls back failures and identical completed reruns preserve bytes and mtime', async (t) => {
  const outputRoot = path.join(repoRoot, '.dfev1', 'known-route-evidence-v1', `transaction-test-${process.pid}-${Date.now()}`);
  await fs.mkdir(outputRoot, { recursive: true });
  t.after(async () => fs.rm(outputRoot, { recursive: true, force: true }));
  const names = ['checkpoint.json', 'aggregate-report.json', 'final-handoff.json'];
  for (const name of names) await fs.writeFile(path.join(outputRoot, name), `${JSON.stringify({ state: 'before', name })}\n`);
  const before = new Map(await Promise.all(names.map(async (name) => [name, await fs.readFile(path.join(outputRoot, name))])));
  const artifacts = Object.fromEntries(names.map((name) => [name, { state: 'after', name }]));
  await assert.rejects(
    publishKnownRouteFinalArtifacts({ outputRoot, artifacts, failAfterPublish: 2 }),
    /Injected Known Route/i,
  );
  for (const name of names) assert.deepEqual(await fs.readFile(path.join(outputRoot, name)), before.get(name));

  const first = await publishKnownRouteFinalArtifacts({ outputRoot, artifacts });
  assert.equal(first.idempotent, false);
  const completed = new Map(await Promise.all(names.map(async (name) => [name, {
    bytes: await fs.readFile(path.join(outputRoot, name)),
    mtimeMs: (await fs.stat(path.join(outputRoot, name))).mtimeMs,
  }])));
  const rerun = await publishKnownRouteFinalArtifacts({ outputRoot, artifacts });
  assert.equal(rerun.idempotent, true);
  for (const name of names) {
    assert.deepEqual(await fs.readFile(path.join(outputRoot, name)), completed.get(name).bytes);
    assert.equal((await fs.stat(path.join(outputRoot, name))).mtimeMs, completed.get(name).mtimeMs);
  }
});

test('builder completes from exact synthetic inputs and a completed same-input rerun performs zero writes', async (t) => {
  const m1 = await createM1ReceiptFixture();
  const m2 = await createM2Fixture({
    m1ReceiptIdentity: m1.receipt.identity,
    m1Revision: m1.receipt.warehouse.current_snapshot_id,
    coverage: m1.receipt.coverage,
  });
  t.after(async () => {
    await fs.rm(m1.testRoot, { recursive: true, force: true });
    await fs.rm(m2.testRoot, { recursive: true, force: true });
  });
  const routeFile = path.join(m1.testRoot, 'public-route.json');
  await fs.writeFile(routeFile, `${JSON.stringify({
    schema: 'known-route-public-smoke/v1',
    label: 'PUBLIC TEST ROUTE',
    disclosure: 'Public, non-private fixture for the bounded builder test.',
    routeInput,
  }, null, 2)}\n`);
  const outputRoot = path.join(m1.testRoot, 'completed-output');
  const options = {
    warehouse: m1.root,
    warehouseReceiptIdentity: m1.receipt.identity,
    m2EvidenceRoot: m2.root,
    m2MartIdentity: m2.martIdentity,
    m2ImplementationTip: commit('implementation'),
    m2ExecutionRecordTip: commit('execution'),
    m2CumulativeTip: commit('cumulative'),
    routeInput: routeFile,
    output: outputRoot,
    allowPublicCenterlineRequest: true,
  };
  const times = [new Date('2026-08-29T03:00:00.000Z'), new Date('2026-08-29T03:01:00.000Z')];
  const dependencies = {
    requestCatalog: async () => catalog(),
    validateMart: async () => m2.martGate,
    verifyTips: async () => {},
    now: () => times.shift(),
  };
  const first = await runKnownRouteEvidenceBuild(options, dependencies);
  assert.equal(first.idempotent, false);
  assert.equal(first.warehouseRowsRead, 64);
  const names = ['checkpoint.json', 'aggregate-report.json', 'final-handoff.json'];
  const before = new Map(await Promise.all(names.map(async (name) => [name, {
    bytes: await fs.readFile(path.join(outputRoot, name)),
    mtimeMs: (await fs.stat(path.join(outputRoot, name))).mtimeMs,
  }])));
  const rerun = await runKnownRouteEvidenceBuild(options, {
    ...dependencies,
    now: () => { throw new Error('completed rerun must not consume a new clock'); },
  });
  assert.equal(rerun.idempotent, true);
  assert.equal(rerun.restoredCompletedCheckpoint, true);
  for (const name of names) {
    assert.deepEqual(await fs.readFile(path.join(outputRoot, name)), before.get(name).bytes);
    assert.equal((await fs.stat(path.join(outputRoot, name))).mtimeMs, before.get(name).mtimeMs);
  }
  const handoff = JSON.parse(await fs.readFile(path.join(outputRoot, 'final-handoff.json'), 'utf8'));
  assert.equal(handoff.schema, 'engagement-known-route-evidence-handoff/v2');
  assert.equal(first.handoffIdentity, handoff.identity);
  assert.equal(handoff.governance.m2.routeEvidenceAuthority, false);
  assert.doesNotMatch(JSON.stringify(handoff), /source_record_id|"coordinates"|routeInput|matchedEdges/i);
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

function matchedFixture() {
  const normalizedRoute = admitKnownRouteEvidenceRequest(request());
  const admittedCatalog = catalog();
  const match = matchKnownRouteToCenterline({ normalizedRoute, catalog: admittedCatalog });
  return { normalizedRoute, admittedCatalog, match };
}

async function createM1ReceiptFixture() {
  const testRoot = path.join(repoRoot, '.dfev1', 'known-route-evidence-v1', `m1-test-${process.pid}-${Date.now()}`);
  const root = path.join(testRoot, 'm1');
  const canonicalRoot = path.join(root, 'warehouse', 'canonical');
  await fs.mkdir(canonicalRoot, { recursive: true });
  const bindings = [];
  for (let partition = 0; partition < 64; partition += 1) {
    const name = `part-${String(partition).padStart(3, '0')}.jsonl`;
    const bytes = Buffer.from(`${JSON.stringify({ partition })}\n`);
    await fs.writeFile(path.join(canonicalRoot, name), bytes);
    bindings.push({
      partition,
      path: `canonical/${name}`,
      row_count: 1,
      bytes: bytes.length,
      identity: rawDigest(bytes),
    });
  }
  const snapshot = digest('m1-snapshot');
  const latestQuality = `quality/${snapshot.slice(7)}.json`;
  const latestRevision = `revisions/${snapshot.slice(7)}.json`;
  const sourceManifest = 'acquisitions/current/manifest.json';
  const manifest = {
    schema: 'engagement-phl-crime-event-warehouse/v1',
    mode: 'official-local-candidate',
    serving_eligible: false,
    partition_count: 64,
    canonical_partitions: bindings,
    canonical_row_count: 64,
    active_row_count: 64,
    removal_candidate_count: 0,
    current_snapshot_id: snapshot,
    applied_snapshot_ids: [snapshot],
    coverage: {
      earliest_scope_start: '2026-01-01',
      latest_scope_end_exclusive: '2026-08-28',
      earliest_event_at: '2026-01-01T00:00:00.000Z',
      latest_event_at: '2026-08-27T00:00:00.000Z',
    },
    transforms: { event_schema: 'engagement-phl-crime-event/v1', corridor_registry_id: null },
    lineage_registry: 'lineage/registry.json',
    latest_quality_report: latestQuality,
    latest_revision_report: latestRevision,
    updated_at: '2026-08-28T01:00:00.000Z',
  };
  const checkpoint = {
    schema: 'engagement-phl-crime-backfill-checkpoint/v1',
    periods: [{ start: '2026-01-01', end_exclusive: '2026-08-28' }],
    completed: { current: { canonical_rows: 64 } },
    final_quality: {
      acquired_rows: 64,
      expected_date_scoped_rows: 64,
      date_scoped_count_complete: true,
      requested_scope: { start: '2026-01-01', end_exclusive: '2026-08-28' },
    },
    updated_at: '2026-08-28T02:00:00.000Z',
  };
  const lineage = {
    schema: 'engagement-phl-crime-lineage/v1',
    source_snapshots: [{ snapshot_id: snapshot, manifest_path: sourceManifest, row_count: 64 }],
    canonical_partitions: bindings,
    model_input_contract: { serving_status: 'not-published' },
  };
  const statusSemantics = {
    unavailable_is_zero: false, partial_is_current: false, stale_is_current: false, zero_requires_complete_query: true,
  };
  const quality = {
    schema: 'engagement-phl-crime-data-quality/v2', snapshot_id: snapshot,
    data_status: 'available', status_semantics: statusSemantics,
    coordinate: { available: 64, missing: 0, invalid: 0, outside_city_bounds: 0 },
    join_coverage: {
      tract: { mapped: 64, unmapped: 0, ambiguous: 0 },
      fixed_grid: { mapped: 64, unavailable: 0 },
      route_corridor: { available: 0, unavailable: 64, matches: 0 },
      acs_estimate_moe: { available: 64, partial: 0, unavailable: 0, 'incompatible-vintage': 0 },
    },
    labels: { unknown_observed: [] },
  };
  const revisionCounts = { added: 64, modified: 0 };
  const revision = { schema: 'engagement-phl-crime-revisions/v1', snapshot_id: snapshot, counts: revisionCounts };
  const currentSource = {
    schema: 'engagement-phl-crime-source-snapshot/v1',
    snapshot_id: snapshot,
    dataset_id: 'fixture-crime',
    provider: 'Fixture PPD',
    source_table: 'fixture_incidents',
    row_count: 64,
    source_vintage: {
      source_as_of: '2026-08-27T00:00:00.000Z',
      retrieved_at: '2026-08-28T00:00:00.000Z',
    },
  };
  const files = new Map([
    ['warehouse/manifest.json', manifest],
    ['backfill-checkpoint.json', checkpoint],
    ['warehouse/lineage/registry.json', lineage],
    [`warehouse/${latestQuality}`, quality],
    [`warehouse/${latestRevision}`, revision],
    [sourceManifest, currentSource],
  ]);
  for (const [relative, value] of files) {
    const file = path.join(root, ...relative.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  }
  const descriptor = async (relative, schema) => {
    const bytes = await fs.readFile(path.join(root, ...relative.split('/')));
    return { path: relative, bytes: bytes.length, sha256: rawDigest(bytes), schema };
  };
  const artifacts = {
    warehouse_manifest: await descriptor('warehouse/manifest.json', manifest.schema),
    backfill_checkpoint: await descriptor('backfill-checkpoint.json', checkpoint.schema),
    lineage_registry: await descriptor('warehouse/lineage/registry.json', lineage.schema),
    latest_quality_report: await descriptor(`warehouse/${latestQuality}`, quality.schema),
    latest_revision_report: await descriptor(`warehouse/${latestRevision}`, revision.schema),
    current_source_manifest: await descriptor(sourceManifest, currentSource.schema),
    source_manifests: { count: 1, bytes: 1, sha256: digest('source-manifests'), raw_shard_count: 64, raw_bytes: 64, raw_sha256: digest('raw') },
    canonical: {
      path: 'warehouse/canonical',
      partition_count: 64,
      bytes: bindings.reduce((sum, binding) => sum + binding.bytes, 0),
      sha256: identityOf(bindings.map((binding) => ({ path: `warehouse/${binding.path}`, bytes: binding.bytes, sha256: binding.identity }))),
      partition_bindings: bindings,
      revision_counts: revisionCounts,
    },
  };
  const receiptEvidence = {
    schema: 'engagement-phl-crime-warehouse-receipt/v3',
    mode: 'official-local-candidate',
    serving_eligible: false,
    source: {
      schema: currentSource.schema, revision: snapshot, dataset_id: currentSource.dataset_id,
      provider: currentSource.provider, source_table: currentSource.source_table,
    },
    warehouse: { schema: manifest.schema, event_schema: manifest.transforms.event_schema, current_snapshot_id: snapshot },
    coverage: {
      start: manifest.coverage.earliest_scope_start,
      end_exclusive: manifest.coverage.latest_scope_end_exclusive,
      earliest_event_at: manifest.coverage.earliest_event_at,
      latest_event_at: manifest.coverage.latest_event_at,
    },
    counts: {
      acquired_rows: 64, expected_date_scoped_rows: 64, canonical_rows: 64, active_rows: 64,
      removal_candidate_rows: 0, source_snapshots: 1, canonical_partitions: 64,
    },
    clocks: {
      source_as_of: currentSource.source_vintage.source_as_of,
      retrieved_at: currentSource.source_vintage.retrieved_at,
      built_at: '2026-08-28T01:00:00.000Z', observed_at: '2026-08-28T02:00:00.000Z',
    },
    data_quality: {
      status: 'available', status_semantics: statusSemantics,
      coordinate: { available: 64, missing: 0, invalid: 0, outside_city_bounds: 0 },
      tract: { mapped: 64, unmapped: 0, ambiguous: 0 },
      fixed_grid: { mapped: 64, unavailable: 0 },
      route_corridor: { available: 0, unavailable: 64, matches: 0 },
      acs_estimate_moe: { available: 64, partial: 0, unavailable: 0, 'incompatible-vintage': 0 },
      unknown_label_count: 0,
    },
    artifacts,
    authority: {
      producer_validated_local_candidate: true, integration_authority: false,
      serving_authority: false, deletion_authority: false,
    },
    limitations: ['fixture'],
  };
  const receipt = { ...receiptEvidence, identity: identityOf(receiptEvidence) };
  const receiptPath = path.join(root, 'receipt.json');
  await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { testRoot, root, receipt, receiptPath, manifestPath: path.join(root, 'warehouse', 'manifest.json') };
}

async function createM2Fixture(overrides = {}) {
  const testRoot = path.join(repoRoot, '.dfev1', 'known-route-evidence-v1', `m2-test-${process.pid}-${Date.now()}`);
  const root = path.join(testRoot, 'm2');
  const evaluationRoot = path.join(root, 'evaluation');
  await fs.mkdir(evaluationRoot, { recursive: true });
  const martIdentity = digest('m2-mart');
  const m1ReceiptIdentity = overrides.m1ReceiptIdentity || digest('m1-receipt');
  const m1Revision = overrides.m1Revision || digest('m1-revision');
  const coverage = overrides.coverage || {
    start: '2026-01-01', end_exclusive: '2026-08-28',
    earliest_event_at: '2026-01-01T00:00:00.000Z', latest_event_at: '2026-08-27T00:00:00.000Z',
  };
  const admission = {
    canonical_rows_seen: 64,
    tract: { admitted: 60, ambiguous_excluded: 2, unmapped_excluded: 2 },
    'fixed-grid': { admitted: 63, unavailable_excluded: 1 },
    unknown_category: 0, invalid_event_time: 0, non_active: 0,
  };
  const report = {
    schema: 'ModelEvaluationReport/v1',
    generated_at: '2026-08-29T00:00:00.000Z',
    protocol: {
      schema: 'engagement-area-intelligence-evaluation-protocol/v2', sha256: 'a'.repeat(64),
      frozen_at: '2026-08-28T00:00:00.000Z', frozen_before_model_performance: true,
    },
    data: {
      mart_artifact_identity: martIdentity,
      mart_manifest_sha256: 'b'.repeat(64),
      source_vintage: m1Revision,
      coverage: {
        earliest_scope_start: coverage.start,
        latest_scope_end_exclusive: coverage.end_exclusive,
        latest_event_at: coverage.latest_event_at,
      },
      admission,
    },
    metrics: {
      primary_by_fold_space_holdout: [{
        model: 'fixture', fold: 'fixture', mae: 1, poisson_deviance: 1,
        negative_binomial_deviance: 1, prediction_interval_90_coverage: 0.9,
        relative_mae_gain_vs_seasonal_naive: 0,
      }],
      by_category: [], by_data_volume: [],
    },
    promotion: { status: 'not-promoted', selected_model: null },
  };
  const reportPath = path.join(evaluationRoot, 'model-evaluation-report.json');
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const reportBytes = await fs.readFile(reportPath);
  const evaluation = {
    schema: 'engagement-area-intelligence-evaluation-run/v2',
    protocol_sha256: report.protocol.sha256,
    mart_manifest_sha256: report.data.mart_manifest_sha256,
    mart_artifact_identity: martIdentity,
    lineage_seam: {
      protocol: { sha256: report.protocol.sha256 },
      m1_receipt: { identity: m1ReceiptIdentity },
      mart: { artifact_identity: martIdentity },
      outcome: { promotion_status: 'not-promoted', selected_model: null, availability: 'unavailable' },
    },
    promotion: { status: 'not-promoted', selected_model: null },
    availability: 'unavailable',
    artifacts: [{ name: 'model-evaluation-report.json', bytes: reportBytes.length, sha256: rawDigest(reportBytes).slice(7) }],
  };
  const evaluationPath = path.join(evaluationRoot, 'manifest.json');
  await fs.writeFile(evaluationPath, `${JSON.stringify(evaluation, null, 2)}\n`);
  const martGate = {
    martManifest: { artifact_identity: martIdentity, row_count: 10, bytes: 20 },
    martInventory: { row_count: 10, bytes: 20 },
  };
  return { testRoot, root, reportPath, evaluationPath, martIdentity, m1ReceiptIdentity, m1Revision, coverage, martGate };
}

async function withRestoredFile(file, callback) {
  const bytes = await fs.readFile(file);
  try { await callback(bytes); } finally { await fs.writeFile(file, bytes); }
}

function rawDigest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function digest(seed) {
  return `sha256:${createHash('sha256').update(String(seed)).digest('hex')}`;
}

function commit(seed) {
  return createHash('sha1').update(String(seed)).digest('hex');
}
