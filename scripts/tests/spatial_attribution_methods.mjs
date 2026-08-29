import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as spatialAttribution from '../lib/spatial_attribution_methods.mjs';
import { partitionForSourceId } from '../lib/crime_event_source.mjs';

const {
  DEFAULT_SPATIAL_ATTRIBUTION_TOLERANCE,
  SPATIAL_ATTRIBUTION_ACCUMULATOR_SCHEMA,
  SPATIAL_ATTRIBUTION_CANDIDATE_WEIGHTS_SCHEMA,
  SPATIAL_ATTRIBUTION_COMPARISON_SCHEMA,
  SPATIAL_ATTRIBUTION_FOOTPRINT_REFERENCE_SCHEMA,
  SPATIAL_ATTRIBUTION_METHOD_CONFIG_SCHEMA,
  SPATIAL_ATTRIBUTION_METHOD_CONFIGS,
  SPATIAL_ATTRIBUTION_METHOD_RESULT_SCHEMA,
  SpatialAttributionContractError,
  addSpatialAttributionEligibleRow,
  admitSpatialAttributionComparison,
  compareSpatialAttributionMethods,
  createSpatialAttributionAccumulator,
  createSpatialAttributionCandidateWeights,
  createSpatialAttributionMethodConfigs,
  finalizeSpatialAttributionAccumulator,
} = spatialAttribution;

const publishedSchema = JSON.parse(await readFile(
  new URL('../data/spatial_attribution_methods.schema.json', import.meta.url),
  'utf8',
));
const TRACT_A = '42101000101';
const TRACT_B = '42101000102';
const TRACT_C = '42101000103';

test('public v2 method configs freeze four separate methods and all authority boundaries', () => {
  assert.deepEqual(Object.keys(spatialAttribution).sort(), [
    'DEFAULT_SPATIAL_ATTRIBUTION_TOLERANCE',
    'SPATIAL_ATTRIBUTION_ACCUMULATOR_SCHEMA',
    'SPATIAL_ATTRIBUTION_CANDIDATE_WEIGHTS_SCHEMA',
    'SPATIAL_ATTRIBUTION_COMPARISON_SCHEMA',
    'SPATIAL_ATTRIBUTION_FOOTPRINT_REFERENCE_SCHEMA',
    'SPATIAL_ATTRIBUTION_METHOD_CONFIG_SCHEMA',
    'SPATIAL_ATTRIBUTION_METHOD_CONFIGS',
    'SPATIAL_ATTRIBUTION_METHOD_RESULT_SCHEMA',
    'SpatialAttributionContractError',
    'addSpatialAttributionEligibleRow',
    'admitSpatialAttributionComparison',
    'compareSpatialAttributionMethods',
    'createSpatialAttributionAccumulator',
    'createSpatialAttributionCandidateWeights',
    'createSpatialAttributionMethodConfigs',
    'finalizeSpatialAttributionAccumulator',
  ].sort());
  assert.equal(DEFAULT_SPATIAL_ATTRIBUTION_TOLERANCE, 1e-9);
  assert.deepEqual(SPATIAL_ATTRIBUTION_METHOD_CONFIGS.map(({ method }) => method), [
    'tract-fail-closed', 'fixed-grid-500m', 'fractional', 'area-kernel',
  ]);
  for (const config of SPATIAL_ATTRIBUTION_METHOD_CONFIGS) {
    assert.equal(config.schema, SPATIAL_ATTRIBUTION_METHOD_CONFIG_SCHEMA);
    assert.equal(config.acs_weighting, 'forbidden');
    assert.equal(config.known_route_segment_kernel, 'not-area-attribution');
    assert.equal(config.integer_m2_mart_contract, 'independent-unchanged');
    assert.match(config.method_identity, /^sha256:[a-f0-9]{64}$/);
    assert.match(config.config_identity, /^sha256:[a-f0-9]{64}$/);
    assert.ok(Object.isFrozen(config));
  }
  const weighted = SPATIAL_ATTRIBUTION_METHOD_CONFIGS.filter(({ assignment }) => assignment === 'weighted');
  assert.equal(weighted.length, 2);
  for (const config of weighted) {
    assert.equal(config.input_artifact_identity, null);
    assert.equal(
      config.configured_unavailable_reason,
      'uncertainty-footprint-artifact-unavailable',
    );
  }
  assert.ok(Object.isFrozen(SPATIAL_ATTRIBUTION_METHOD_CONFIGS));
});

test('published schema is strict, aggregate-only, M2-independent, and forbids ACS weighting', () => {
  assert.equal(publishedSchema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(publishedSchema.additionalProperties, false);
  assert.match(publishedSchema.$comment, /does not admit uncertainty geometry/i);
  assert.equal(publishedSchema.properties.schema.const, SPATIAL_ATTRIBUTION_COMPARISON_SCHEMA);
  const result = publishedSchema.definitions.methodResult;
  assert.equal(result.additionalProperties, false);
  assert.ok(result.required.includes('input_artifact_identity'));
  assert.ok(result.required.includes('unavailable_reason'));
  assert.equal(result.properties.acs_weighting.const, 'forbidden');
  assert.equal(result.properties.known_route_segment_kernel.const, 'not-area-attribution');
  assert.equal(result.properties.integer_m2_mart_contract.const, 'independent-unchanged');
  assert.equal(publishedSchema.definitions.exactInput.additionalProperties, false);
  assert.deepEqual(publishedSchema.definitions.exactInput.required, [
    'protocol',
    'm1',
    'm2',
  ]);
  assert.deepEqual(publishedSchema.definitions.governance.properties, {
    integer_m2_mart_contract: { const: 'independent-unchanged' },
    evaluation_contract: { const: 'unchanged' },
    serving_contract: { const: 'unchanged' },
    forecast_contract: { const: 'unchanged' },
    acs_weighting: { const: 'forbidden' },
    demographic_ranking_authority: { const: false },
    serving_authority: { const: false },
    forecast_authority: { const: false },
    promotion_authority: { const: false },
    known_route_segment_kernel: { const: 'not-area-attribution' },
  });
});

test('canonical tract and EPSG:3857 500m grid semantics remain fail closed', () => {
  const rows = canonicalRows();
  const result = compareEligible({ rows });
  assert.equal(result.schema, SPATIAL_ATTRIBUTION_COMPARISON_SCHEMA);
  assert.equal(result.input_rows, 3);
  assert.deepEqual(result.source_spatial_rows, {
    tract: { mapped: 1, ambiguous: 1, unmapped: 1, invalid: 0 },
    fixed_grid: { mapped: 2, unavailable: 1, invalid: 0 },
  });

  const tract = methodResult(result, 'tract-fail-closed');
  assert.equal(tract.schema, SPATIAL_ATTRIBUTION_METHOD_RESULT_SCHEMA);
  assert.equal(tract.availability, 'partial');
  assert.equal(tract.assigned_rows, 1);
  assert.equal(tract.excluded_rows, 2);
  assert.equal(tract.weighted_mass, 1);
  assert.deepEqual(tract.exclusions, [
    { reason: 'tract-ambiguous', rows: 1 },
    { reason: 'tract-unmapped', rows: 1 },
  ]);
  assert.deepEqual(tract.aggregates, [
    { unit_id: TRACT_A, contributing_rows: 1, weighted_mass: 1 },
  ]);

  const grid = methodResult(result, 'fixed-grid-500m');
  assert.equal(grid.availability, 'partial');
  assert.equal(grid.assigned_rows, 2);
  assert.equal(grid.excluded_rows, 1);
  assert.equal(grid.weighted_mass, 2);
  assert.deepEqual(grid.exclusions, [{ reason: 'grid-unavailable', rows: 1 }]);
  assert.deepEqual(grid.aggregates, [
    { unit_id: 'epsg3857-500m:-16732:9710', contributing_rows: 1, weighted_mass: 1 },
    { unit_id: 'epsg3857-500m:-16733:9710', contributing_rows: 1, weighted_mass: 1 },
  ]);
});

test('streaming accumulator binds exact lineage and reconciles methods only to eligible rows', () => {
  const rows = canonicalRows();
  const methodConfigs = identityBoundConfigs();
  const candidateInputs = candidateSet(rows, methodConfigs);
  const byKey = new Map(candidateInputs.map((value) => [
    `${value.row_identity}:${value.method}`, value,
  ]));
  const exact = exactInput(rows, {
    nonActive: 1,
    invalidEventTime: 1,
    categoryUnmapped: 1,
  });
  const accumulator = createSpatialAttributionAccumulator({ exactInput: exact, methodConfigs });
  assert.deepEqual(accumulator, { schema: SPATIAL_ATTRIBUTION_ACCUMULATOR_SCHEMA });
  for (const row of warehouseScanOrder(rows, exact.m1.canonical.partition_count)) {
    addSpatialAttributionEligibleRow(accumulator, row, {
      fractional: byKey.get(`${row.source_record_id}:fractional`),
      areaKernel: byKey.get(`${row.source_record_id}:area-kernel`),
    });
  }
  const streamed = finalizeSpatialAttributionAccumulator(accumulator);
  assert.deepEqual(streamed.exact_input, exact);
  assert.equal(streamed.exact_input.m1.canonical.row_count, 6);
  assert.equal(streamed.exact_input.m2.admission.canonical_rows_seen, 6);
  assert.deepEqual({
    non_active: streamed.exact_input.m2.admission.non_active,
    invalid_event_time: streamed.exact_input.m2.admission.invalid_event_time,
    unknown_category: streamed.exact_input.m2.admission.unknown_category,
  }, { non_active: 1, invalid_event_time: 1, unknown_category: 1 });
  for (const method of streamed.methods) {
    assert.equal(method.input_rows, 3);
    assert.equal(method.assigned_rows + method.excluded_rows, 3);
  }
  const batched = compareSpatialAttributionMethods({
    exactInput: exact,
    rows: rows.toReversed(),
    candidateInputs: candidateInputs.toReversed(),
    methodConfigs,
  });
  assert.deepEqual(streamed, batched);
  assert.throws(
    () => addSpatialAttributionEligibleRow(accumulator, rows[0]),
    hasCode('accumulator-finalized'),
  );
});

test('streaming add rejects rows outside active, valid-time, mapped-category eligibility', () => {
  for (const mutate of [
    (row) => { row.lifecycle.state = 'removal-candidate'; },
    (row) => { row.event_at = 'not-a-time'; },
    (row) => { row.event_at = 0; },
    (row) => { row.normalized_category = { status: 'unmapped', theme_id: null }; },
    (row) => { row.normalized_category.theme_id = null; },
  ]) {
    const accumulator = createSpatialAttributionAccumulator({ exactInput: exactInput(1) });
    const row = structuredClone(canonicalRows()[0]);
    mutate(row);
    assert.throws(
      () => addSpatialAttributionEligibleRow(accumulator, row),
      hasCode('row-not-analysis-eligible'),
    );
    assert.throws(
      () => finalizeSpatialAttributionAccumulator(accumulator),
      hasCode('eligible-denominator-mismatch'),
    );
  }

  const accumulator = createSpatialAttributionAccumulator({ exactInput: exactInput(1) });
  const emptyThemeId = structuredClone(canonicalRows()[0]);
  emptyThemeId.normalized_category.theme_id = '';
  addSpatialAttributionEligibleRow(accumulator, emptyThemeId);
  assert.equal(finalizeSpatialAttributionAccumulator(accumulator).input_rows, 1);
});

test('streaming and batch follow warehouse partition/numeric order and reject hostile identities', () => {
  const numericRows = [
    canonicalRow('cartodb:2', {
      tract: mappedTract(TRACT_A),
      grid: mappedGrid('epsg3857-500m:2:2'),
    }),
    canonicalRow('cartodb:10', {
      tract: mappedTract(TRACT_B),
      grid: mappedGrid('epsg3857-500m:10:10'),
    }),
  ];
  const duplicate = createSpatialAttributionAccumulator({ exactInput: exactInput(numericRows) });
  addSpatialAttributionEligibleRow(duplicate, numericRows[0]);
  assert.throws(
    () => addSpatialAttributionEligibleRow(duplicate, numericRows[0]),
    hasCode('row-order-invalid'),
  );
  addSpatialAttributionEligibleRow(duplicate, numericRows[1]);
  assert.equal(finalizeSpatialAttributionAccumulator(duplicate).input_rows, 2);

  const numericReverse = createSpatialAttributionAccumulator({
    exactInput: exactInput(numericRows),
  });
  addSpatialAttributionEligibleRow(numericReverse, numericRows[1]);
  assert.throws(
    () => addSpatialAttributionEligibleRow(numericReverse, numericRows[0]),
    hasCode('row-order-invalid'),
  );
  assert.equal(compareEligible({ rows: numericRows.toReversed() }).input_rows, 2);

  assert.equal(partitionForSourceId(168, 64), 0);
  assert.equal(partitionForSourceId(60, 64), 1);
  const crossPartitionRows = [
    canonicalRow('cartodb:168', {
      tract: mappedTract(TRACT_A),
      grid: mappedGrid('epsg3857-500m:168:168'),
    }),
    canonicalRow('cartodb:60', {
      tract: mappedTract(TRACT_B),
      grid: mappedGrid('epsg3857-500m:60:60'),
    }),
  ];
  const crossPartitionExact = exactInput(crossPartitionRows, { partitionCount: 64 });
  const crossPartition = createSpatialAttributionAccumulator({
    exactInput: crossPartitionExact,
  });
  addSpatialAttributionEligibleRow(crossPartition, crossPartitionRows[0]);
  addSpatialAttributionEligibleRow(crossPartition, crossPartitionRows[1]);
  assert.equal(finalizeSpatialAttributionAccumulator(crossPartition).input_rows, 2);
  assert.equal(compareSpatialAttributionMethods({
    exactInput: crossPartitionExact,
    rows: crossPartitionRows.toReversed(),
  }).input_rows, 2);

  const reverse = createSpatialAttributionAccumulator({ exactInput: crossPartitionExact });
  addSpatialAttributionEligibleRow(reverse, crossPartitionRows[1]);
  assert.throws(
    () => addSpatialAttributionEligibleRow(reverse, crossPartitionRows[0]),
    hasCode('row-order-invalid'),
  );

  for (const sourceRecordId of ['synthetic:1', 'cartodb:0', 'cartodb:9007199254740992']) {
    const invalidIdentity = createSpatialAttributionAccumulator({ exactInput: exactInput(1) });
    const row = structuredClone(numericRows[0]);
    row.source_record_id = sourceRecordId;
    assert.throws(
      () => addSpatialAttributionEligibleRow(invalidIdentity, row),
      hasCode('row-identity-invalid'),
    );
  }
});

test('exact input rejects M1/M2 canonical and eligible admission drift before rows', () => {
  const denominatorDrift = exactInput(canonicalRows(), { nonActive: 1 });
  denominatorDrift.m1.canonical.row_count += 1;
  assert.throws(
    () => createSpatialAttributionAccumulator({ exactInput: denominatorDrift }),
    hasCode('producer-denominator-mismatch'),
  );

  const m2Drift = exactInput(canonicalRows(), { categoryUnmapped: 1 });
  m2Drift.m2.admission.unknown_category += 1;
  assert.throws(
    () => createSpatialAttributionAccumulator({ exactInput: m2Drift }),
    hasCode('eligibility-denominator-mismatch'),
  );
});

test('current real-data default cannot activate fractional or kernel from runtime weights', () => {
  const rows = canonicalRows();
  const exactSyntheticConfigs = identityBoundConfigs();
  const candidateInputs = candidateSet(rows, exactSyntheticConfigs);
  const result = compareEligible({ rows, candidateInputs });
  for (const method of ['fractional', 'area-kernel']) {
    const weighted = methodResult(result, method);
    assert.equal(weighted.availability, 'unavailable');
    assert.equal(weighted.input_artifact_identity, null);
    assert.equal(
      weighted.unavailable_reason,
      'uncertainty-footprint-artifact-unavailable',
    );
    assert.equal(weighted.assigned_rows, 0);
    assert.equal(weighted.excluded_rows, rows.length);
    assert.equal(weighted.weighted_mass, null);
    assert.deepEqual(weighted.exclusions, [
      { reason: 'uncertainty-footprint-artifact-unavailable', rows: rows.length },
    ]);
    assert.deepEqual(weighted.aggregates, []);
  }
});

test('identity-bound synthetic footprints enable conserved fractional and area-kernel aggregates', () => {
  const rows = canonicalRows();
  const methodConfigs = identityBoundConfigs();
  const candidateInputs = candidateSet(rows, methodConfigs);
  const result = compareEligible({ rows, candidateInputs, methodConfigs });

  const fractional = methodResult(result, 'fractional');
  assert.equal(fractional.availability, 'available');
  assert.equal(fractional.assigned_rows, 3);
  assert.equal(fractional.excluded_rows, 0);
  assert.equal(fractional.weighted_mass, 3);
  assert.equal(fractional.input_artifact_identity, digest('fractional-weight-artifact'));
  assert.equal(fractional.unavailable_reason, null);
  assert.deepEqual(fractional.aggregates, [
    { unit_id: TRACT_A, contributing_rows: 2, weighted_mass: 1.25 },
    { unit_id: TRACT_B, contributing_rows: 2, weighted_mass: 1.35 },
    { unit_id: TRACT_C, contributing_rows: 1, weighted_mass: 0.4 },
  ]);
  assert.equal(sumMass(fractional.aggregates), fractional.weighted_mass);

  const kernel = methodResult(result, 'area-kernel');
  assert.equal(kernel.availability, 'available');
  assert.equal(kernel.assigned_rows, 3);
  assert.equal(kernel.weighted_mass, 3);
  assert.equal(kernel.input_artifact_identity, digest('area-kernel-weight-artifact'));
  assert.deepEqual(kernel.aggregates, [
    { unit_id: TRACT_A, contributing_rows: 2, weighted_mass: 1.5 },
    { unit_id: TRACT_B, contributing_rows: 2, weighted_mass: 0.7 },
    { unit_id: TRACT_C, contributing_rows: 1, weighted_mass: 0.8 },
  ]);
  assert.equal(sumMass(kernel.aggregates), kernel.weighted_mass);
});

test('method comparison identities and aggregate order are stable across row and candidate order', () => {
  const rows = canonicalRows();
  const methodConfigs = identityBoundConfigs();
  const candidateInputs = candidateSet(rows, methodConfigs);
  const first = compareEligible({ rows, candidateInputs, methodConfigs });
  const reversedInputs = candidateInputs.toReversed().map((input) => ({
    ...structuredClone(input),
    candidate_weights: structuredClone(input.candidate_weights).reverse(),
  }));
  const second = compareEligible({
    rows: rows.toReversed(),
    candidateInputs: reversedInputs,
    methodConfigs: methodConfigs.toReversed(),
  });
  assert.deepEqual(second, first);
  assert.equal(second.comparison_identity, first.comparison_identity);
});

test('missing footprint stays unavailable even when an exact input artifact is configured', () => {
  const methodConfigs = identityBoundConfigs();
  const result = compareEligible({ rows: canonicalRows(), methodConfigs });
  for (const method of ['fractional', 'area-kernel']) {
    const weighted = methodResult(result, method);
    assert.equal(weighted.availability, 'unavailable');
    assert.equal(weighted.unavailable_reason, 'uncertainty-footprint-artifact-unavailable');
    assert.deepEqual(weighted.exclusions, [
      { reason: 'uncertainty-footprint-artifact-unavailable', rows: 3 },
    ]);
  }
});

test('NaN, Infinity, negative, over-mass, and duplicate-unit inputs fail closed without mass', () => {
  const methodConfigs = identityBoundConfigs();
  const row = canonicalRows()[0];
  const base = createCandidate({
    row,
    method: 'fractional',
    weights: [{ unit_id: TRACT_A, weight: 1 }],
    methodConfigs,
  });
  const cases = [
    ['invalid-weight', (value) => { value.candidate_weights[0].weight = Number.NaN; }],
    ['invalid-weight', (value) => { value.candidate_weights[0].weight = Number.POSITIVE_INFINITY; }],
    ['invalid-weight', (value) => { value.candidate_weights[0].weight = -0.1; }],
    ['mass-not-conserved', (value) => { value.candidate_weights[0].weight = 1.01; }],
    ['duplicate-unit', (value) => {
      value.candidate_weights.push({ unit_id: TRACT_A, weight: 0 });
    }],
  ];
  for (const [reason, mutate] of cases) {
    const hostile = structuredClone(base);
    mutate(hostile);
    const result = compareEligible({
      rows: [row],
      candidateInputs: [hostile],
      methodConfigs,
    });
    const fractional = methodResult(result, 'fractional');
    assert.equal(fractional.availability, 'unavailable');
    assert.equal(fractional.weighted_mass, null);
    assert.deepEqual(fractional.aggregates, []);
    assert.deepEqual(fractional.exclusions, [{ reason, rows: 1 }]);
  }
});

test('wrong method config, ACS basis, and Known Route segment kernel cannot enter area attribution', () => {
  const rows = canonicalRows();
  const methodConfigs = identityBoundConfigs();
  const wrongConfigSet = structuredClone(methodConfigs);
  wrongConfigSet[2].tolerance = 1e-8;
  assert.throws(
    () => compareEligible({ rows, methodConfigs: wrongConfigSet }),
    hasCode('method-config-identity-drift'),
  );

  const valid = createCandidate({
    row: rows[0],
    method: 'fractional',
    weights: [{ unit_id: TRACT_A, weight: 1 }],
    methodConfigs,
  });
  for (const [reason, mutate] of [
    ['method-config-mismatch', (value) => { value.method_config_identity = digest('wrong-config'); }],
    ['input-artifact-identity-mismatch', (value) => {
      value.input_artifact_identity = digest('wrong-input-artifact');
    }],
    ['forbidden-weight-basis', (value) => {
      value.weight_basis = 'acs-population-weighted';
      value.acs_weighting = 'required';
    }],
    ['known-route-segment-kernel-forbidden', (value) => {
      value.known_route_segment_kernel_used = true;
    }],
  ]) {
    const hostile = structuredClone(valid);
    mutate(hostile);
    const result = compareEligible({
      rows: [rows[0]],
      candidateInputs: [hostile],
      methodConfigs,
    });
    assert.deepEqual(methodResult(result, 'fractional').exclusions, [{ reason, rows: 1 }]);
  }
});

test('ambiguous and unmapped rows cannot become deterministic or invented area assignments', () => {
  const rows = canonicalRows();
  const methodConfigs = identityBoundConfigs();
  const ambiguousSingleton = createCandidate({
    row: rows[1],
    method: 'fractional',
    weights: [{ unit_id: TRACT_A, weight: 1 }],
    methodConfigs,
  });
  const unmappedSingleton = createCandidate({
    row: rows[2],
    method: 'fractional',
    weights: [{ unit_id: TRACT_B, weight: 1 }],
    methodConfigs,
  });
  const result = compareEligible({
    rows: rows.slice(1),
    candidateInputs: [ambiguousSingleton, unmappedSingleton],
    methodConfigs,
  });
  const fractional = methodResult(result, 'fractional');
  assert.equal(fractional.availability, 'unavailable');
  assert.equal(fractional.assigned_rows, 0);
  assert.equal(fractional.weighted_mass, null);
  assert.deepEqual(fractional.exclusions, [
    { reason: 'non-probabilistic-uncertain-row', rows: 2 },
  ]);

  const mismatchedCandidates = createCandidate({
    row: rows[1],
    method: 'area-kernel',
    weights: [
      { unit_id: TRACT_A, weight: 0.5 },
      { unit_id: TRACT_C, weight: 0.5 },
    ],
    methodConfigs,
  });
  const mismatch = compareEligible({
    rows: [rows[1]],
    candidateInputs: [mismatchedCandidates],
    methodConfigs,
  });
  assert.deepEqual(methodResult(mismatch, 'area-kernel').exclusions, [
    { reason: 'ambiguous-candidate-mismatch', rows: 1 },
  ]);
});

test('comparison output is aggregate-only and semantic admission rejects identity or mass drift', () => {
  const rows = canonicalRows().map((row, index) => ({
    ...row,
    coordinate: { status: 'available', value: [-75.16 - index / 100, 39.95] },
    generalized_location: { value: `SECRET BLOCK ${index}` },
  }));
  const result = compareEligible({ rows });
  const text = JSON.stringify(result);
  for (const forbidden of [
    'cartodb:', 'SECRET BLOCK', '-75.16', '39.95',
  ]) assert.equal(text.includes(forbidden), false);
  assert.deepEqual(result.privacy, {
    aggregate_only: true,
    coordinates_included: false,
    generalized_locations_included: false,
    raw_events_included: false,
    source_record_ids_included: false,
    uncertainty_footprints_included: false,
  });
  assert.deepEqual(result.governance, {
    integer_m2_mart_contract: 'independent-unchanged',
    evaluation_contract: 'unchanged',
    serving_contract: 'unchanged',
    forecast_contract: 'unchanged',
    acs_weighting: 'forbidden',
    demographic_ranking_authority: false,
    serving_authority: false,
    forecast_authority: false,
    promotion_authority: false,
    known_route_segment_kernel: 'not-area-attribution',
  });

  const identityDrift = structuredClone(result);
  identityDrift.input_rows += 1;
  assert.throws(
    () => admitSpatialAttributionComparison(identityDrift),
    hasCode('eligible-denominator-mismatch'),
  );
  const massDrift = structuredClone(result);
  massDrift.methods[0].weighted_mass += 0.5;
  assert.throws(
    () => admitSpatialAttributionComparison(massDrift),
    hasCode('method-mass-not-conserved'),
  );
});

function compareEligible({ rows, candidateInputs = [], methodConfigs = SPATIAL_ATTRIBUTION_METHOD_CONFIGS }) {
  return compareSpatialAttributionMethods({
    exactInput: exactInput(rows),
    rows,
    candidateInputs,
    methodConfigs,
  });
}

function exactInput(rowsOrEligibleCount, {
  nonActive = 0,
  invalidEventTime = 0,
  categoryUnmapped = 0,
  partitionCount = 1,
} = {}) {
  const rows = Array.isArray(rowsOrEligibleCount) ? rowsOrEligibleCount : null;
  const analysisEligibleDenominator = rows?.length ?? rowsOrEligibleCount;
  const canonicalDenominator = analysisEligibleDenominator
    + nonActive + invalidEventTime + categoryUnmapped;
  const tract = rows == null
    ? { admitted: analysisEligibleDenominator, ambiguous_excluded: 0, unmapped_excluded: 0 }
    : {
        admitted: rows.filter(({ spatial }) => spatial?.tract?.status === 'mapped').length,
        ambiguous_excluded: rows.filter(({ spatial }) => spatial?.tract?.status === 'ambiguous').length,
        unmapped_excluded: rows.filter(({ spatial }) => spatial?.tract?.status === 'unmapped').length,
      };
  const fixedGrid = rows == null
    ? { admitted: analysisEligibleDenominator, unavailable_excluded: 0 }
    : {
        admitted: rows.filter(({ spatial }) => spatial?.grid?.status === 'mapped').length,
        unavailable_excluded: rows.filter(({ spatial }) => spatial?.grid?.status === 'unavailable').length,
      };
  return {
    protocol: {
      schema: 'engagement-spatial-attribution-protocol/v2',
      sha256: digest('spatial-attribution-protocol-v2'),
    },
    m1: {
      receipt_schema: 'engagement-phl-crime-event-warehouse-receipt/v3',
      receipt_identity: digest('synthetic-m1-receipt'),
      receipt_sha256: digest('synthetic-m1-receipt-bytes'),
      warehouse_schema: 'engagement-phl-crime-event-warehouse/v1',
      warehouse_current_snapshot_id: digest('synthetic-m1-warehouse-snapshot'),
      canonical: {
        partition_count: partitionCount,
        row_count: canonicalDenominator,
        bytes: canonicalDenominator * 10,
        sha256: digest(`synthetic-m1-canonical:${canonicalDenominator}`),
      },
    },
    m2: {
      mart_schema: 'engagement-area-intelligence-mart/v2',
      manifest_sha256: digest('synthetic-m2-manifest-bytes'),
      artifact_identity: digest('synthetic-m2-artifact'),
      part_bindings_identity: digest('synthetic-m2-part-bindings'),
      part_count: 1,
      row_count: analysisEligibleDenominator * 2,
      bytes: analysisEligibleDenominator * 20,
      admission: {
        canonical_rows_seen: canonicalDenominator,
        tract,
        'fixed-grid': fixedGrid,
        unknown_category: categoryUnmapped,
        invalid_event_time: invalidEventTime,
        non_active: nonActive,
      },
      artifact_policy: {
        event_level_data_included: false,
      },
    },
  };
}

function canonicalRows() {
  return [
    canonicalRow('cartodb:003', {
      tract: mappedTract(TRACT_A),
      grid: mappedGrid('epsg3857-500m:-16733:9710'),
    }),
    canonicalRow('cartodb:001', {
      tract: ambiguousTract([TRACT_A, TRACT_B]),
      grid: mappedGrid('epsg3857-500m:-16732:9710'),
    }),
    canonicalRow('cartodb:002', {
      tract: unmappedTract(),
      grid: unavailableGrid(),
    }),
  ];
}

function warehouseScanOrder(rows, partitionCount) {
  return [...rows].sort((left, right) => {
    const leftId = Number(left.source_record_id.slice('cartodb:'.length));
    const rightId = Number(right.source_record_id.slice('cartodb:'.length));
    return partitionForSourceId(leftId, partitionCount)
      - partitionForSourceId(rightId, partitionCount)
      || leftId - rightId;
  });
}

function canonicalRow(sourceRecordId, spatial) {
  return {
    source_record_id: sourceRecordId,
    lifecycle: { state: 'active' },
    event_at: '2026-08-20T01:00:00.000Z',
    normalized_category: { status: 'mapped', theme_id: 'reported-theft' },
    spatial,
  };
}

function mappedTract(geoid) {
  return { status: 'mapped', geoid, candidates: [geoid] };
}

function ambiguousTract(candidates) {
  return { status: 'ambiguous', geoid: null, candidates };
}

function unmappedTract() {
  return { status: 'unmapped', geoid: null, candidates: [] };
}

function mappedGrid(gridId) {
  return {
    status: 'mapped', gridId, scheme: 'epsg3857-square-grid-v1', projectedCellSizeM: 500,
  };
}

function unavailableGrid() {
  return {
    status: 'unavailable', gridId: null, scheme: 'epsg3857-square-grid-v1', projectedCellSizeM: 500,
  };
}

function identityBoundConfigs() {
  return createSpatialAttributionMethodConfigs({
    fractionalInputArtifactIdentity: digest('fractional-weight-artifact'),
    areaKernelInputArtifactIdentity: digest('area-kernel-weight-artifact'),
  });
}

function candidateSet(rows, methodConfigs) {
  const byId = new Map(rows.map((row) => [row.source_record_id, row]));
  return [
    createCandidate({
      row: byId.get('cartodb:003'),
      method: 'fractional',
      weights: [{ unit_id: TRACT_A, weight: 1 }],
      methodConfigs,
    }),
    createCandidate({
      row: byId.get('cartodb:001'),
      method: 'fractional',
      weights: [
        { unit_id: TRACT_A, weight: 0.25 },
        { unit_id: TRACT_B, weight: 0.75 },
      ],
      methodConfigs,
    }),
    createCandidate({
      row: byId.get('cartodb:002'),
      method: 'fractional',
      weights: [
        { unit_id: TRACT_B, weight: 0.6 },
        { unit_id: TRACT_C, weight: 0.4 },
      ],
      methodConfigs,
    }),
    createCandidate({
      row: byId.get('cartodb:003'),
      method: 'area-kernel',
      weights: [{ unit_id: TRACT_A, weight: 1 }],
      methodConfigs,
    }),
    createCandidate({
      row: byId.get('cartodb:001'),
      method: 'area-kernel',
      weights: [
        { unit_id: TRACT_A, weight: 0.5 },
        { unit_id: TRACT_B, weight: 0.5 },
      ],
      methodConfigs,
    }),
    createCandidate({
      row: byId.get('cartodb:002'),
      method: 'area-kernel',
      weights: [
        { unit_id: TRACT_B, weight: 0.2 },
        { unit_id: TRACT_C, weight: 0.8 },
      ],
      methodConfigs,
    }),
  ];
}

function createCandidate({ row, method, weights, methodConfigs }) {
  return createSpatialAttributionCandidateWeights({
    rowIdentity: row.source_record_id,
    method,
    uncertaintyFootprintIdentity: digest(`${row.source_record_id}:${method}:footprint`),
    candidateWeights: weights,
    methodConfigs,
  });
}

function methodResult(comparison, method) {
  return comparison.methods.find((value) => value.method === method);
}

function sumMass(aggregates) {
  return aggregates.reduce((sum, value) => sum + value.weighted_mass, 0);
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function hasCode(code) {
  return (error) => error instanceof SpatialAttributionContractError && error.code === code;
}
