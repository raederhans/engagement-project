#!/usr/bin/env node
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addCanonicalGeneralizedIncident,
  createGeneralizedIncidentAccumulator,
} from '../../src/routes_crime/known_route_contributions.js';
import { deterministicIdentity } from '../../src/routes_crime/known_route_evidence_contract.js';
import {
  createKnownRouteEvidenceP6Projection,
  createKnownRouteEvidenceSensitivityScenario,
  runKnownRouteEvidenceSensitivity,
  validateKnownRouteEvidenceP6Projection,
} from '../../src/routes_crime/known_route_evidence_p6_projection.js';
import {
  createKnownRouteEvidenceCheckpoint,
  createKnownRouteEvidenceP6Checkpoint,
  createSafeKnownRouteAggregateReport,
  createSafeKnownRouteAggregateReportV3,
  identityOf,
  validateKnownRouteEvidenceAggregateReport,
  validateKnownRouteEvidenceAggregateReportV3,
  validateKnownRouteEvidenceP6ArtifactSet,
  validateKnownRouteEvidenceP6Checkpoint,
} from '../lib/known_route_evidence_checkpoint.mjs';

const routeIdentity = deterministicIdentity('known-route-session', { route: 'fixture' });
const aggregateRouteIdentity = identityOf({ sessionRouteIdentity: routeIdentity });
const corridorIdentity = deterministicIdentity('known-route-corridor', { corridor: 'fixture' });
const centerlineIdentity = deterministicIdentity('centerline-catalog', { catalog: 'fixture' });
const aggregateCatalogIdentity = identityOf({ catalogIdentity: centerlineIdentity });
const centerlineDataVersion = 'city-street-centerline:2026-07-29T13:55:32.074Z';
const crashProducerIdentity = identityOf({ producer: 'crash-accessibility' });
const modeProducerIdentity = identityOf({ producer: 'mode-legality-quality' });

test('P6 projection keeps dimensions separate, stable, conservative, and unavailable-not-zero', () => {
  const aggregate = aggregateFixture();
  const first = createProjection({ aggregate });
  const second = createProjection({ aggregate: structuredClone(aggregate) });
  assert.equal(validateKnownRouteEvidenceP6Projection(first), first);
  assert.equal(first.projectionIdentity, second.projectionIdentity);
  assert.deepEqual(first.dimensions.generalizedReportedPpdIncidents.segments.map((segment) => (
    segment.analysisSegmentId
  )), ['segment-001', 'segment-002']);
  assert.equal(first.dimensions.generalizedReportedPpdIncidents.route.contributionUnits, 0.666667);
  assert.equal(first.dimensions.generalizedReportedPpdIncidents.segments
    .reduce((sum, segment) => round(sum + segment.contributionUnits), 0), 0.666667);
  for (const segment of first.dimensions.generalizedReportedPpdIncidents.segments) {
    assert.equal(segment.categories.reduce((sum, category) => (
      round(sum + category.contributionUnits)
    ), 0), segment.contributionUnits);
  }
  assert.equal(first.sensitivity.status, 'unavailable');
  assert.match(first.sensitivity.reason, /No caller-provided/i);
  assert.deepEqual(first.sensitivity.comparisons, []);
  assert.ok(Object.values(first.authority).every((value) => value === false));
  assert.ok(Object.values(first.privacy).every((value) => value === false));
  assert.deepEqual(Object.keys(first.dimensions.modeLegality), ['walking', 'cycling', 'driving', 'transit']);
  assert.equal(first.dimensions.rawCrash.status, 'unavailable');
  assert.match(first.dimensions.rawCrash.unavailableReason, /was acquired/i);
  assert.equal(first.dimensions.accessibility.status, 'unavailable');
  assert.match(first.dimensions.accessibility.unavailableReason, /not validated/i);
  assert.equal('total' in first.dimensions, false);
});

test('P6 fails closed on A/B route, corridor, producer, and validator boundaries', () => {
  const aggregate = aggregateFixture();
  const crash = crashAccessibilityFixture();
  crash.route_identity = identityOf({ route: 'other' });
  assert.throws(() => createProjection({ aggregate, crash }), /A\/B route/i);

  const mode = modeLegalityFixture();
  mode.corridor_identity = deterministicIdentity('known-route-corridor', { corridor: 'other' });
  assert.throws(() => createProjection({ aggregate, mode }), /does not match.*corridor/i);

  const centerlineDrift = modeLegalityFixture();
  centerlineDrift.centerline_identity = deterministicIdentity('centerline-catalog', { catalog: 'other' });
  assert.throws(() => createProjection({ aggregate, mode: centerlineDrift }), /A\/B route, centerline/i);

  const versionDrift = modeLegalityFixture();
  versionDrift.match_quality.source_version = 'city-street-centerline:2026-08-30T00:00:00.000Z';
  assert.throws(() => createProjection({ aggregate, mode: versionDrift }), /corridor and data version/i);

  assert.throws(() => createKnownRouteEvidenceP6Projection({
    aggregateReport: aggregate,
    validateAggregateReport: validateAggregateFixture,
    crashAccessibilityEvidence: crashAccessibilityFixture(),
    modeLegalityQualityEvidence: modeLegalityFixture(),
    validateModeLegalityQualityEvidence: validateModeFixture,
  }), /requires its producer validator/i);

  const hostileProducer = crashAccessibilityFixture();
  hostileProducer.semantic_identity = '';
  assert.throws(() => createProjection({ aggregate, crash: hostileProducer }), /identity is invalid/i);

  const promotedCrash = crashAccessibilityFixture();
  promotedCrash.crash = {
    status: 'partial',
    reason: 'Historical planning context cannot supply raw crash evidence.',
  };
  assert.throws(() => createProjection({ aggregate, crash: promotedCrash }), /refuses to promote/i);

  const promotedMode = modeLegalityFixture();
  promotedMode.match_quality.match_status = 'unavailable';
  promotedMode.mode_legality.walking = {
    status: 'available',
    reason: 'must-not-pass',
    source_receipt: { source_version: centerlineDataVersion },
  };
  assert.throws(() => createProjection({ aggregate, mode: promotedMode }), /every mode.*unavailable/i);
});

test('sensitivity compares only explicit identity-bound different scenarios and detects config drift', () => {
  const projection = createProjection({ aggregate: aggregateFixture() });
  const baseline = createKnownRouteEvidenceSensitivityScenario({
    kind: 'generalization',
    configIdentity: deterministicIdentity('generalization-config', { name: 'baseline-explicit' }),
    identity: projection.identity,
    reportedIncidentEvidence: projection.dimensions.generalizedReportedPpdIncidents,
  });
  const variantEvidence = structuredClone(projection.dimensions.generalizedReportedPpdIncidents);
  variantEvidence.route.contributionUnits = 0.5;
  variantEvidence.segments[0].contributionUnits = 0.25;
  variantEvidence.segments[0].categories = [{ category: 'reported-person', contributionUnits: 0.25 }];
  variantEvidence.segments[1].contributionUnits = 0.25;
  variantEvidence.segments[1].categories = [{ category: 'reported-property', contributionUnits: 0.25 }];
  const variant = createKnownRouteEvidenceSensitivityScenario({
    kind: 'generalization',
    configIdentity: deterministicIdentity('generalization-config', { name: 'caller-variant' }),
    identity: projection.identity,
    reportedIncidentEvidence: variantEvidence,
  });
  const result = runKnownRouteEvidenceSensitivity({ baselineScenario: baseline, variants: [variant] });
  assert.equal(result.status, 'available');
  assert.equal(result.comparisons.length, 1);
  assert.equal(result.comparisons[0].deltaFromBaseline, -0.166667);
  assert.ok(Object.values(result.authority).every((value) => value === false));

  const drifted = structuredClone(variant);
  drifted.configIdentity = deterministicIdentity('generalization-config', { name: 'drifted' });
  assert.throws(() => runKnownRouteEvidenceSensitivity({
    baselineScenario: baseline,
    variants: [drifted],
  }), /identity or config drifted/i);

  const mismatchedProducer = createKnownRouteEvidenceSensitivityScenario({
    kind: 'generalization',
    configIdentity: deterministicIdentity('generalization-config', { name: 'mismatch' }),
    identity: { ...projection.identity, crashAccessibilityProducerIdentity: identityOf({ producer: 'other' }) },
    reportedIncidentEvidence: variantEvidence,
  });
  assert.throws(() => runKnownRouteEvidenceSensitivity({
    baselineScenario: baseline,
    variants: [mismatchedProducer],
  }), /producer or corridor identity drifted/i);
});

test('same or missing variants remain unavailable and never fabricate distance bands', () => {
  const projection = createProjection({ aggregate: aggregateFixture() });
  const baseline = createKnownRouteEvidenceSensitivityScenario({
    kind: 'generalization',
    configIdentity: deterministicIdentity('generalization-config', { same: true }),
    identity: projection.identity,
    reportedIncidentEvidence: projection.dimensions.generalizedReportedPpdIncidents,
  });
  const missing = runKnownRouteEvidenceSensitivity({ baselineScenario: baseline, variants: [] });
  const same = runKnownRouteEvidenceSensitivity({ baselineScenario: baseline, variants: [baseline] });
  assert.equal(missing.status, 'unavailable');
  assert.equal(same.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify([missing, same]), /100\s*m|300\s*m/i);
  assert.match(projection.limitations.join(' '), /hundred-block generalized report points near a route/i);
  assert.match(projection.limitations.join(' '), /not raw crash evidence.*exact street-segment fact/i);
});

test('P6 artifacts use v3 wrappers while legacy v2 validation remains strict', () => {
  const { checkpoint: legacyCheckpoint, report: legacyReport } = realLegacyArtifacts();
  const projection = createProjection({ aggregate: legacyReport });
  const checkpoint = createKnownRouteEvidenceP6Checkpoint({ legacyCheckpoint, projection });
  const report = createSafeKnownRouteAggregateReportV3({ legacyReport, projection });
  assert.equal(validateKnownRouteEvidenceP6Checkpoint(checkpoint, { legacyCheckpoint, projection }), checkpoint);
  assert.equal(validateKnownRouteEvidenceAggregateReportV3(report, { legacyReport, projection }), report);
  assert.deepEqual(validateKnownRouteEvidenceP6ArtifactSet({
    legacyCheckpoint, legacyReport, projection, checkpoint, report,
  }), { checkpoint, report });
  assert.equal(checkpoint.schema, 'known-route-evidence-checkpoint/v3');
  assert.equal(report.schema, 'known-route-corridor-aggregate/v3');

  const legacyWithP6Field = structuredClone(legacyReport);
  legacyWithP6Field.p6 = projection;
  assert.throws(() => validateKnownRouteEvidenceAggregateReport(legacyWithP6Field), /closed schema/i);

  const driftedCheckpoint = structuredClone(checkpoint);
  driftedCheckpoint.crashAccessibilityProducerIdentity = identityOf({ producer: 'drifted' });
  driftedCheckpoint.identity = identityOf(Object.fromEntries(
    Object.entries(driftedCheckpoint).filter(([key]) => key !== 'identity'),
  ));
  assert.throws(() => validateKnownRouteEvidenceP6Checkpoint(
    driftedCheckpoint,
    { legacyCheckpoint, projection },
  ), /identity or authority binding/i);
});

test('P6 serialized output excludes private full-text fields and cross-dimensional product claims', () => {
  const text = JSON.stringify(createProjection({ aggregate: aggregateFixture() }));
  assert.doesNotMatch(text, /"(?:address|coordinates|eventRow|eventRows|generalized_location|latitude|longitude|matchedEdges|rawRoute|routeGeometry|routeInput|source_record_id|sourceRecordId)"\s*:/i);
  assert.doesNotMatch(text, /\b(?:rank(?:ed|ing)?|safest|winner)\b|\brecommend(?:ation|ed|ing)?\b/i);
  assert.doesNotMatch(text, /safety[_-]?score|crossDimensionTotal|overallValue/i);
  assert.match(text, /sourceAsOf/);
  assert.match(text, /precision/);
  assert.match(text, /unavailableReason/);
});

function createProjection({ aggregate, crash = crashAccessibilityFixture(), mode = modeLegalityFixture() }) {
  return createKnownRouteEvidenceP6Projection({
    aggregateReport: aggregate,
    validateAggregateReport: validateAggregateFixture,
    crashAccessibilityEvidence: crash,
    validateCrashAccessibilityEvidence: validateCrashFixture,
    modeLegalityQualityEvidence: mode,
    validateModeLegalityQualityEvidence: validateModeFixture,
  });
}

function aggregateFixture() {
  return {
    schema: 'known-route-corridor-aggregate/v2',
    publicRoute: { sessionIdentity: aggregateRouteIdentity },
    centerline: {
      corridorIdentity,
      catalogIdentity: aggregateCatalogIdentity,
      dataVersion: centerlineDataVersion,
    },
    warehouse: { coverage: { latest_event_at: '2026-08-27T00:00:00.000Z' } },
    reportedIncidentEvidence: reportedIncidentFixture(),
    hin: {
      status: 'partial', networkVintage: 2025, crashDataPeriod: [2019, 2023],
      meaning: 'Historical planning-network context remains a separate evidence dimension.',
    },
    dimensionsCombinedIntoSafetyScore: false,
    semanticIdentity: identityOf({ aggregate: 'fixture' }),
  };
}

function reportedIncidentFixture() {
  return {
    schema: 'known-route-generalized-incident-contribution/v1',
    status: 'partial',
    method: {
      schema: 'known-route-generalized-incident-contribution/v1',
      maximumDistanceM: 200,
      nonAdjacentAmbiguityDifferenceM: 5,
      contribution: 'triangular kernel declining from 1 at 0 m to 0 at 200 m; distributed across adjacent candidate analysis segments',
      precision: 'hundred-block-generalized source points; not precise sidewalk or street-segment locations',
    },
    route: { contributionUnits: 0.666667, contributingRows: 2, rowsRead: 2, eligibleGeneralizedRows: 2 },
    excluded: {
      nonActive: 0, coordinateUnavailable: 0, precisionUnavailable: 0, categoryUnavailable: 0,
      outsideUncertaintyCorridor: 0, ambiguousNonAdjacent: 0, malformed: 0,
    },
    segments: [
      {
        analysisSegmentId: 'segment-002', streetLabel: 'PUBLIC TEST B', contributionUnits: 0.333334,
        contributingRows: 1,
        categories: [{ category: 'reported-property', contributionUnits: 0.333334 }],
      },
      {
        analysisSegmentId: 'segment-001', streetLabel: 'PUBLIC TEST A', contributionUnits: 0.333333,
        contributingRows: 1,
        categories: [{ category: 'reported-person', contributionUnits: 0.333333 }],
      },
    ],
  };
}

function crashAccessibilityFixture() {
  return {
    schema: 'KnownRouteCrashAccessibilityEvidence/v1',
    semantic_identity: crashProducerIdentity,
    route_identity: routeIdentity,
    corridor_identity: corridorIdentity,
    centerline_identity: centerlineIdentity,
    data_version: centerlineDataVersion,
    source_receipts: [
      producerReceipt('raw-crash'),
      producerReceipt('accessibility'),
    ],
    crash: { status: 'unavailable', reason: 'No validated raw crash aggregate was acquired.' },
    accessibility: { status: 'unavailable', reason: 'Sidewalk and curb-ramp continuity was not validated.' },
  };
}

function modeLegalityFixture() {
  return {
    schema: 'KnownRouteModeLegalityQualityEvidence/v1',
    semantic_identity: modeProducerIdentity,
    route_identity: routeIdentity,
    corridor_identity: corridorIdentity,
    centerline_identity: centerlineIdentity,
    mode_legality: Object.fromEntries(['walking', 'cycling', 'driving', 'transit'].map((mode) => [
      mode,
      { status: 'unavailable', reason: `${mode}-mode-restriction-source-unavailable` },
    ])),
    match_quality: {
      status: 'unavailable',
      reason: 'uncalibrated-deterministic-candidate',
      source_version: centerlineDataVersion,
      match_status: 'matched',
    },
  };
}

function producerReceipt(role) {
  return {
    role,
    status: 'unavailable',
    clocks: {
      source_as_of: null,
      observed_at: '2026-08-29T00:00:00.000Z',
    },
    precision: { status: 'unavailable', unit: null },
  };
}

function validateAggregateFixture(value) {
  assert.equal(value?.schema, 'known-route-corridor-aggregate/v2');
  return value;
}

function validateCrashFixture(value) {
  assert.equal(value?.schema, 'KnownRouteCrashAccessibilityEvidence/v1');
  return value;
}

function validateModeFixture(value) {
  assert.equal(value?.schema, 'KnownRouteModeLegalityQualityEvidence/v1');
  return value;
}

function realLegacyArtifacts() {
  const matchedEdges = [
    { analysisSegmentId: 'segment-001', streetLabel: 'PUBLIC TEST A', coordinates: [[-75.17, 39.95], [-75.16, 39.95]] },
    { analysisSegmentId: 'segment-002', streetLabel: 'PUBLIC TEST B', coordinates: [[-75.16, 39.95], [-75.15, 39.95]] },
  ];
  const accumulator = createGeneralizedIncidentAccumulator({ matchedEdges });
  addCanonicalGeneralizedIncident(accumulator, {
    lifecycle: { state: 'active' },
    coordinate: { status: 'available', value: [-75.165, 39.95], exact_location_claim: false },
    generalized_location: { exact_sidewalk_or_street_segment: false },
    normalized_category: { status: 'mapped', theme_id: 'reported-property' },
  });
  const completion = {
    state: 'complete', completedAt: '2026-08-29T01:01:00.000Z', durationMs: 60_000,
    maximumRssBytes: 1, resumedPartitions: 0,
  };
  const checkpoint = createKnownRouteEvidenceCheckpoint({
    warehouseIdentity: identityOf({ warehouse: 'fixture' }),
    warehouseReceiptDigest: identityOf({ receipt: 'fixture' }),
    warehouseManifestIdentity: identityOf({ manifest: 'fixture' }),
    partitionSetIdentity: identityOf({ parts: 'fixture' }),
    routeIdentity: aggregateRouteIdentity,
    centerlineDataVersion,
    catalogIdentity: aggregateCatalogIdentity,
    corridorIdentity,
    completedPartitions: 1,
    completedPartitionBindings: [{
      partition: 0, path: 'canonical/part-000.jsonl', rowCount: 1, bytes: 1,
      sha256: identityOf({ part: 'fixture' }),
    }],
    partitionCount: 1,
    accumulator,
    startedAt: '2026-08-29T01:00:00.000Z',
    completion,
  });
  const report = createSafeKnownRouteAggregateReport({
    warehouseReceipt: {
      schema: 'engagement-phl-crime-warehouse-receipt/v3',
      identity: checkpoint.warehouseIdentity,
      warehouse: {
        schema: 'engagement-phl-crime-event-warehouse/v1',
        current_snapshot_id: identityOf({ snapshot: 'fixture' }),
      },
      counts: { canonical_partitions: 1, active_rows: 1 },
      coverage: {
        start: '2026-01-01', end_exclusive: '2026-08-28',
        earliest_event_at: '2026-01-01T00:00:00.000Z', latest_event_at: '2026-08-27T00:00:00.000Z',
      },
      serving_eligible: false,
    },
    warehouseReceiptDigest: checkpoint.warehouseReceiptDigest,
    warehouseManifestIdentity: checkpoint.warehouseManifestIdentity,
    partitionSetIdentity: checkpoint.partitionSetIdentity,
    routeIdentity: aggregateRouteIdentity,
    catalogIdentity: checkpoint.catalogIdentity,
    match: {
      dataVersion: centerlineDataVersion,
      corridorIdentity,
      sourceAsOf: '2026-07-29T13:55:32.074Z',
      matchedEdges,
      maximumMatchDistanceM: 2,
      method: 'deterministic reference-topology fixture',
      transportSemantics: 'none',
    },
    catalogFeatureCount: 2,
    accumulator,
    completion,
  });
  return { checkpoint, report };
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}
