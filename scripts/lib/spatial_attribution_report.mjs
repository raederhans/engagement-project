import { createHash } from 'node:crypto';

export const SPATIAL_ATTRIBUTION_AUDIT_SCHEMA =
  'engagement-spatial-attribution-audit/v2';
export const SPATIAL_ATTRIBUTION_METHOD_COMPARISON_SCHEMA =
  'engagement-spatial-attribution-method-comparison/v2';
export const SPATIAL_ATTRIBUTION_REPORT_SCHEMA =
  'engagement-spatial-attribution-comparison-report/v2';

export const SPATIAL_ATTRIBUTION_METHOD_IDS = Object.freeze([
  'tract-fail-closed',
  'fixed-grid-500m',
  'fractional',
  'area-kernel',
]);

const METHOD_RESULT_SCHEMA = 'engagement-spatial-attribution-method-result/v2';
const METHOD_CONFIG_SCHEMA = 'engagement-spatial-attribution-method-config/v2';
const SHA256_IDENTITY = /^sha256:[a-f0-9]{64}$/;
const TRACT_IDENTITY = /^\d{11}$/;
const GRID_IDENTITY = /^epsg3857-500m:-?\d+:-?\d+$/;
const TRACT_STATUSES = Object.freeze(['mapped', 'ambiguous', 'unmapped']);
const GRID_STATUSES = Object.freeze(['mapped', 'unavailable']);
const STRATA_DIMENSIONS = Object.freeze([
  'year',
  'normalized_category',
  'tract_status',
  'grid_status',
  'boundary_status',
  'acs_population_band',
  'acs_temporal_compatibility',
  'district',
  'psa',
  'road',
]);
const FORBIDDEN_OUTPUT_KEYS = new Set([
  'incidentrows',
  'incidents',
  'rows',
  'features',
  'sourcerecordid',
  'sourceids',
  'exactaddress',
  'location',
  'locationblock',
  'geometry',
  'coordinates',
  'lat',
  'lng',
  'raw',
]);
const BLOCKED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const METHOD_BLUEPRINTS = Object.freeze({
  'tract-fail-closed': Object.freeze({
    method_version: 'crime-event-tract-fail-closed/v1',
    unit_type: 'tract',
    assignment: 'integer',
    spatial_semantics:
      'canonical-spatial-tract-mapped-only-ambiguous-and-unmapped-excluded',
    weight_basis: 'canonical-unit-mass',
    candidate_weights: 'forbidden',
    candidate_weight_contract_identity: null,
  }),
  'fixed-grid-500m': Object.freeze({
    method_version: 'epsg3857-square-grid-v1',
    unit_type: 'fixed-grid',
    assignment: 'integer',
    spatial_semantics:
      'canonical-spatial-grid-mapped-only-epsg3857-square-grid-v1-500m',
    weight_basis: 'canonical-unit-mass',
    candidate_weights: 'forbidden',
    candidate_weight_contract_identity: null,
  }),
  fractional: Object.freeze({
    method_version: 'fractional-area-attribution/v2',
    unit_type: 'tract',
    assignment: 'weighted',
    spatial_semantics:
      'caller-supplied-admitted-uncertainty-footprint-and-normalized-tract-candidates',
    weight_basis: 'caller-supplied-fractional-area-overlap',
    candidate_weights: 'required',
    candidate_weight_contract_identity: spatialAttributionValueIdentity({
      schema: 'engagement-spatial-attribution-candidate-weights/v1',
      method: 'fractional',
      normalization: 'finite-nonnegative-sum-to-one',
      unit_type: 'tract',
      geometry_derivation: 'outside-comparator',
    }),
  }),
  'area-kernel': Object.freeze({
    method_version: 'area-kernel-attribution/v2',
    unit_type: 'tract',
    assignment: 'weighted',
    spatial_semantics:
      'caller-supplied-admitted-area-uncertainty-footprint-and-normalized-tract-kernel-mass',
    weight_basis: 'caller-supplied-area-kernel-mass',
    candidate_weights: 'required',
    candidate_weight_contract_identity: spatialAttributionValueIdentity({
      schema: 'engagement-spatial-attribution-candidate-weights/v1',
      method: 'area-kernel',
      normalization: 'finite-nonnegative-sum-to-one',
      unit_type: 'tract',
      geometry_derivation: 'outside-comparator',
      known_route_segment_kernel: 'forbidden',
    }),
  }),
});

/**
 * Validate and present two versioned aggregate producer artifacts. This builder
 * never reads event data and never runs an attribution algorithm.
 */
export function buildSpatialAttributionReport({
  denominatorAudit,
  methodComparison,
  observedInputBytes = undefined,
} = {}) {
  const denominator = validateDenominatorAudit(denominatorAudit);
  const comparison = validateMethodComparison(methodComparison);
  assertSameValue(
    denominator.exact_input,
    comparison.exact_input,
    'Denominator audit and method comparison exact_input values do not match.',
  );
  assertComparatorMatchesDenominator(comparison, denominator);
  const observed = validateObservedInputBytes(observedInputBytes);

  const core = {
    schema: SPATIAL_ATTRIBUTION_REPORT_SCHEMA,
    status: 'local-attribution-audit-only',
    exact_inputs: {
      common: structuredClone(denominator.exact_input),
      denominator_audit: {
        schema: denominator.schema,
        audit_identity: denominator.audit_identity,
        value_identity: spatialAttributionValueIdentity(denominator),
        ...(observed ? { bytes_sha256: observed.denominator_audit } : {}),
      },
      method_comparison: {
        schema: comparison.schema,
        comparison_identity: comparison.comparison_identity,
        value_identity: spatialAttributionValueIdentity(comparison),
        ...(observed ? { bytes_sha256: observed.method_comparison } : {}),
      },
    },
    canonical_denominator: structuredClone(denominator.canonical_denominator),
    analysis_eligible_denominator: structuredClone(
      denominator.analysis_eligible_denominator,
    ),
    tract_grid_comparison: {
      tract_denominator: structuredClone(denominator.tract_denominator),
      grid_denominator: structuredClone(denominator.grid_denominator),
      spatial_status_matrix: structuredClone(denominator.spatial_status_matrix),
      mapped_set_relationship: structuredClone(denominator.mapped_set_relationship),
    },
    methods: comparison.methods.map(projectMethod),
    strata: projectStrata(denominator.strata),
    artifact_policy: {
      mode: 'aggregate-only',
      event_level_data_included: false,
      method_unit_aggregates_included: false,
      identity_meaning:
        'Artifact and input identity only; not truth, completeness, freshness, correctness, or authority.',
    },
    claim_boundary: {
      local_attribution_audit: true,
      causal_evidence: false,
      safety_evidence: false,
      individual_risk_evidence: false,
      product_serving_evidence: false,
      scientific_promotion_evidence: false,
    },
    limitations: [
      'Local aggregate attribution audit only.',
      'Unavailable, ambiguous, unmapped, partial, and stale states remain explicit and are not zero.',
      'This report is not causal, safety, individual-risk, product-serving, or scientific-promotion evidence.',
    ],
  };
  assertJsonCompatible(core, 'Spatial attribution report');
  assertNoForbiddenOutputKeys(core, 'Spatial attribution report');
  assertUnavailableNoTotal(core, 'Spatial attribution report');
  return deepFreeze({
    ...core,
    artifact_identity: spatialAttributionValueIdentity(core),
  });
}

export function validateDenominatorAudit(value) {
  assertRecord(value, 'Denominator audit');
  assertJsonCompatible(value, 'Denominator audit');
  assertExactKeys(value, [
    'schema',
    'exact_input',
    'method',
    'canonical_denominator',
    'analysis_eligible_denominator',
    'tract_denominator',
    'grid_denominator',
    'spatial_status_matrix',
    'mapped_set_relationship',
    'm2_aggregate_reconciliation',
    'strata',
    'district_psa_attribution',
    'artifact_policy',
    'authority',
    'audit_identity',
  ], 'Denominator audit');
  if (value.schema !== SPATIAL_ATTRIBUTION_AUDIT_SCHEMA) {
    throw new Error('Denominator audit schema is not Spatial Attribution Audit v2.');
  }
  const exact = validateExactInput(value.exact_input, 'Denominator audit exact_input');
  validateAuditMethod(value.method);
  validateDenominators(value, exact);
  validateSpatialMatrix(value.spatial_status_matrix, value);
  validateMappedSetRelationship(value.mapped_set_relationship, value);
  validateM2Reconciliation(value.m2_aggregate_reconciliation, exact);
  validateStrata(value.strata, exact.analysisEligible);
  validateDistrictPsaAttribution(value.district_psa_attribution, value, exact);
  validateAuditPolicy(value.artifact_policy);
  validateAuditAuthority(value.authority);
  validateProducerIdentity(value, 'audit_identity', 'Denominator audit');
  assertNoUnexpectedSensitiveKeys(value, 'Denominator audit');
  assertUnavailableNoTotal(value, 'Denominator audit');
  return value;
}

export function validateMethodComparison(value) {
  assertRecord(value, 'Method comparison');
  assertJsonCompatible(value, 'Method comparison');
  assertExactKeys(value, [
    'schema',
    'exact_input',
    'input_rows',
    'source_spatial_rows',
    'methods',
    'privacy',
    'governance',
    'comparison_identity',
  ], 'Method comparison');
  if (value.schema !== SPATIAL_ATTRIBUTION_METHOD_COMPARISON_SCHEMA) {
    throw new Error('Method comparison schema is not Spatial Attribution Method Comparison v2.');
  }
  const exact = validateExactInput(value.exact_input, 'Method comparison exact_input');
  assertCount(value.input_rows, 'Method comparison input_rows');
  if (value.input_rows !== exact.analysisEligible) {
    throw new Error('Method comparison input_rows does not equal the analysis-eligible denominator.');
  }
  validateSourceSpatialRows(value.source_spatial_rows, value.input_rows);
  validateMethods(value.methods, value.input_rows);
  validateMethodPrivacy(value.privacy);
  validateMethodGovernance(value.governance);
  validateProducerIdentity(value, 'comparison_identity', 'Method comparison');
  assertNoUnexpectedSensitiveKeys(value, 'Method comparison', {
    permittedAggregateRows: true,
  });
  return value;
}

export function spatialAttributionValueIdentity(value) {
  return `sha256:${createHash('sha256').update(stableSerialization(value)).digest('hex')}`;
}

export function stableSpatialAttributionSerialization(value) {
  return stableSerialization(value);
}

function validateExactInput(value, label) {
  assertRecord(value, label);
  assertExactKeys(value, ['protocol', 'm1', 'm2'], label);

  assertExactKeys(value.protocol, ['schema', 'sha256'], `${label}.protocol`);
  if (value.protocol.schema !== 'engagement-spatial-attribution-protocol/v2') {
    throw new Error(`${label}.protocol schema is invalid.`);
  }
  assertDigest(value.protocol.sha256, `${label}.protocol.sha256`);

  assertExactKeys(value.m1, [
    'receipt_schema',
    'receipt_identity',
    'receipt_sha256',
    'warehouse_schema',
    'warehouse_current_snapshot_id',
    'canonical',
  ], `${label}.m1`);
  if (value.m1.receipt_schema !== 'engagement-phl-crime-warehouse-receipt/v3'
    || value.m1.warehouse_schema !== 'engagement-phl-crime-event-warehouse/v1') {
    throw new Error(`${label}.m1 schemas are invalid.`);
  }
  for (const name of ['receipt_identity', 'receipt_sha256', 'warehouse_current_snapshot_id']) {
    assertDigest(value.m1[name], `${label}.m1.${name}`);
  }
  assertExactKeys(value.m1.canonical, [
    'partition_count', 'row_count', 'bytes', 'sha256',
  ], `${label}.m1.canonical`);
  assertCount(value.m1.canonical.partition_count, `${label}.m1.canonical.partition_count`);
  if (value.m1.canonical.partition_count < 1) {
    throw new Error(`${label}.m1.canonical.partition_count must be positive.`);
  }
  assertCount(value.m1.canonical.row_count, `${label}.m1.canonical.row_count`);
  assertCount(value.m1.canonical.bytes, `${label}.m1.canonical.bytes`);
  assertDigest(value.m1.canonical.sha256, `${label}.m1.canonical.sha256`);

  assertExactKeys(value.m2, [
    'mart_schema',
    'manifest_sha256',
    'artifact_identity',
    'part_bindings_identity',
    'part_count',
    'row_count',
    'bytes',
    'admission',
    'artifact_policy',
  ], `${label}.m2`);
  if (value.m2.mart_schema !== 'engagement-area-intelligence-feature-mart/v2') {
    throw new Error(`${label}.m2 mart schema is invalid.`);
  }
  for (const name of ['manifest_sha256', 'artifact_identity', 'part_bindings_identity']) {
    assertDigest(value.m2[name], `${label}.m2.${name}`);
  }
  for (const name of ['part_count', 'row_count', 'bytes']) {
    assertCount(value.m2[name], `${label}.m2.${name}`);
  }
  if (value.m2.part_count < 1) {
    throw new Error(`${label}.m2.part_count must be positive.`);
  }
  assertExactKeys(value.m2.artifact_policy, [
    'event_level_data_included',
  ], `${label}.m2.artifact_policy`);
  if (value.m2.artifact_policy.event_level_data_included !== false) {
    throw new Error(`${label}.m2 must exclude event-level data.`);
  }
  const admission = validateM2Admission(value.m2.admission, label);
  if (value.m1.canonical.row_count !== admission.canonical) {
    throw new Error(`${label} canonical row identities do not reconcile.`);
  }
  return admission;
}

function validateM2Admission(value, label) {
  assertExactKeys(value, [
    'canonical_rows_seen',
    'tract',
    'fixed-grid',
    'unknown_category',
    'invalid_event_time',
    'non_active',
  ], `${label}.m2.admission`);
  assertExactKeys(value.tract, [
    'admitted', 'ambiguous_excluded', 'unmapped_excluded',
  ], `${label}.m2.admission.tract`);
  assertExactKeys(value['fixed-grid'], [
    'admitted', 'unavailable_excluded',
  ], `${label}.m2.admission.fixed-grid`);
  const counts = [
    value.canonical_rows_seen,
    value.tract.admitted,
    value.tract.ambiguous_excluded,
    value.tract.unmapped_excluded,
    value['fixed-grid'].admitted,
    value['fixed-grid'].unavailable_excluded,
    value.unknown_category,
    value.invalid_event_time,
    value.non_active,
  ];
  counts.forEach((count, index) => assertCount(count, `${label}.m2.admission count ${index}`));
  const exclusions = value.non_active + value.invalid_event_time + value.unknown_category;
  const eligible = value.canonical_rows_seen - exclusions;
  if (eligible < 0
    || value.tract.admitted + value.tract.ambiguous_excluded
      + value.tract.unmapped_excluded !== eligible
    || value['fixed-grid'].admitted + value['fixed-grid'].unavailable_excluded !== eligible) {
    throw new Error(`${label}.m2 admission does not conserve canonical and eligible denominators.`);
  }
  return {
    canonical: value.canonical_rows_seen,
    analysisEligible: eligible,
    exclusions,
    admission: structuredClone(value),
  };
}

function validateAuditMethod(value) {
  assertExactKeys(value, [
    'version',
    'canonical_event_denominator',
    'analysis_eligibility',
    'tract_grid_relationship',
    'source_join',
    'acs_population_bands',
  ], 'Denominator audit method');
  assertExactKeys(value.source_join, [
    'cardinality', 'missing_value_policy',
  ], 'Denominator audit method.source_join');
  assertExactKeys(value.acs_population_bands, [
    'low_upper_exclusive', 'medium_upper_exclusive',
  ], 'Denominator audit method.acs_population_bands');
  if (value.version !== 'spatial-attribution-denominator-audit/v2'
    || value.canonical_event_denominator !== 'canonical_rows'
    || value.analysis_eligibility
      !== 'active-and-valid-event-time-and-mapped-normalized-category'
    || value.tract_grid_relationship !== 'parallel-overlapping-event-sets'
    || value.source_join.cardinality
      !== 'exactly-one-source-record-per-canonical-event-and-lineage-snapshot'
    || value.source_join.missing_value_policy !== 'null-is-unavailable'
    || value.acs_population_bands.low_upper_exclusive !== 2500
    || value.acs_population_bands.medium_upper_exclusive !== 4500) {
    throw new Error('Denominator audit method contract is invalid.');
  }
}

function validateDenominators(value, exact) {
  assertExactKeys(value.canonical_denominator, [
    'name', 'total',
  ], 'Canonical denominator');
  if (value.canonical_denominator.name !== 'canonical_rows'
    || value.canonical_denominator.total !== exact.canonical) {
    throw new Error('Canonical denominator does not match exact_input.');
  }
  assertExactKeys(value.analysis_eligible_denominator, [
    'name', 'parent', 'total', 'exclusions',
  ], 'Analysis-eligible denominator');
  assertExactKeys(value.analysis_eligible_denominator.exclusions, [
    'non_active', 'invalid_event_time', 'unknown_category',
  ], 'Analysis-eligible exclusions');
  if (value.analysis_eligible_denominator.name !== 'analysis_eligible_rows'
    || value.analysis_eligible_denominator.parent !== 'canonical_rows'
    || value.analysis_eligible_denominator.total !== exact.analysisEligible) {
    throw new Error('Analysis-eligible denominator does not match exact_input.');
  }
  assertSameValue(
    value.analysis_eligible_denominator.exclusions,
    {
      non_active: value.exact_input.m2.admission.non_active,
      invalid_event_time: value.exact_input.m2.admission.invalid_event_time,
      unknown_category: value.exact_input.m2.admission.unknown_category,
    },
    'Analysis-eligible exclusions do not match exact_input.',
  );
  validateSpatialDenominator(value.tract_denominator, {
    label: 'Tract denominator',
    name: 'tract_status_rows',
    statuses: TRACT_STATUSES,
    expected: {
      mapped: value.exact_input.m2.admission.tract.admitted,
      ambiguous: value.exact_input.m2.admission.tract.ambiguous_excluded,
      unmapped: value.exact_input.m2.admission.tract.unmapped_excluded,
    },
    eligible: exact.analysisEligible,
  });
  validateSpatialDenominator(value.grid_denominator, {
    label: 'Grid denominator',
    name: 'grid_status_rows',
    statuses: GRID_STATUSES,
    expected: {
      mapped: value.exact_input.m2.admission['fixed-grid'].admitted,
      unavailable: value.exact_input.m2.admission['fixed-grid'].unavailable_excluded,
    },
    eligible: exact.analysisEligible,
  });
}

function validateSpatialDenominator(value, {
  label, name, statuses, expected, eligible,
}) {
  assertExactKeys(value, ['name', 'parent', 'total', 'statuses'], label);
  assertExactKeys(value.statuses, statuses, `${label}.statuses`);
  for (const status of statuses) assertCount(value.statuses[status], `${label}.${status}`);
  if (value.name !== name
    || value.parent !== 'analysis_eligible_rows'
    || value.total !== eligible
    || Object.values(value.statuses).reduce((sum, count) => sum + count, 0) !== eligible) {
    throw new Error(`${label} does not conserve the analysis-eligible denominator.`);
  }
  assertSameValue(value.statuses, expected, `${label} does not match the M2 admission baseline.`);
}

function validateSpatialMatrix(value, audit) {
  assertExactKeys(value, ['denominator', 'total', 'cells'], 'Spatial status matrix');
  if (value.denominator !== 'analysis_eligible_rows'
    || value.total !== audit.analysis_eligible_denominator.total
    || !Array.isArray(value.cells) || value.cells.length !== 6) {
    throw new Error('Spatial status matrix header is invalid.');
  }
  const cells = new Map();
  const expectedOrder = TRACT_STATUSES.flatMap((tractStatus) => (
    GRID_STATUSES.map((gridStatus) => ({ tractStatus, gridStatus }))
  ));
  for (const [index, cell] of value.cells.entries()) {
    assertExactKeys(cell, [
      'tract_status', 'grid_status', 'count',
    ], `Spatial status matrix cell ${index}`);
    if (!TRACT_STATUSES.includes(cell.tract_status)
      || !GRID_STATUSES.includes(cell.grid_status)) {
      throw new Error('Spatial status matrix contains an unsupported status.');
    }
    if (cell.tract_status !== expectedOrder[index].tractStatus
      || cell.grid_status !== expectedOrder[index].gridStatus) {
      throw new Error('Spatial status matrix cells are not in the frozen 3x2 order.');
    }
    assertCount(cell.count, `Spatial status matrix cell ${index}.count`);
    const key = `${cell.tract_status}|${cell.grid_status}`;
    if (cells.has(key)) throw new Error('Spatial status matrix contains duplicate/conflicting cells.');
    cells.set(key, cell.count);
  }
  for (const tract of TRACT_STATUSES) {
    for (const grid of GRID_STATUSES) {
      if (!cells.has(`${tract}|${grid}`)) {
        throw new Error('Spatial status matrix is missing a frozen 3x2 cell.');
      }
    }
  }
  const total = [...cells.values()].reduce((sum, count) => sum + count, 0);
  const tract = audit.tract_denominator.statuses;
  const grid = audit.grid_denominator.statuses;
  if (total !== value.total
    || cells.get('mapped|mapped') + cells.get('mapped|unavailable') !== tract.mapped
    || cells.get('ambiguous|mapped') + cells.get('ambiguous|unavailable')
      !== tract.ambiguous
    || cells.get('unmapped|mapped') + cells.get('unmapped|unavailable') !== tract.unmapped
    || cells.get('mapped|mapped') + cells.get('ambiguous|mapped')
      + cells.get('unmapped|mapped') !== grid.mapped
    || cells.get('mapped|unavailable') + cells.get('ambiguous|unavailable')
      + cells.get('unmapped|unavailable') !== grid.unavailable) {
    throw new Error('Spatial status matrix does not conserve its tract/grid margins.');
  }
}

function validateMappedSetRelationship(value, audit) {
  assertExactKeys(value, [
    'denominator',
    'total',
    'tract_mapped',
    'grid_mapped',
    'intersection_mapped',
    'tract_only_mapped',
    'grid_only_mapped',
    'neither_mapped',
    'union_mapped',
    'combination_policy',
  ], 'Mapped set relationship');
  for (const name of [
    'total',
    'tract_mapped',
    'grid_mapped',
    'intersection_mapped',
    'tract_only_mapped',
    'grid_only_mapped',
    'neither_mapped',
    'union_mapped',
  ]) assertCount(value[name], `Mapped set relationship.${name}`);
  const matrix = new Map(audit.spatial_status_matrix.cells.map((cell) => [
    `${cell.tract_status}|${cell.grid_status}`,
    cell.count,
  ]));
  const expected = {
    denominator: 'analysis_eligible_rows',
    total: audit.analysis_eligible_denominator.total,
    tract_mapped: audit.tract_denominator.statuses.mapped,
    grid_mapped: audit.grid_denominator.statuses.mapped,
    intersection_mapped: matrix.get('mapped|mapped'),
    tract_only_mapped: matrix.get('mapped|unavailable'),
    grid_only_mapped: matrix.get('ambiguous|mapped') + matrix.get('unmapped|mapped'),
    neither_mapped:
      matrix.get('ambiguous|unavailable') + matrix.get('unmapped|unavailable'),
    combination_policy: 'never-sum-parallel-denominators-as-unique-events',
  };
  expected.union_mapped = expected.intersection_mapped
    + expected.tract_only_mapped + expected.grid_only_mapped;
  if (value.union_mapped + value.neither_mapped !== value.total) {
    throw new Error('Mapped set relationship does not conserve the eligible denominator.');
  }
  assertSameValue(value, expected, 'Mapped set relationship conflicts with the 3x2 matrix.');
}

function validateM2Reconciliation(value, exact) {
  assertExactKeys(value, [
    'status',
    'analysis_eligible_rows',
    'canonical_rows_seen',
    'tract',
    'fixed-grid',
    'unknown_category',
    'invalid_event_time',
    'non_active',
  ], 'M2 aggregate reconciliation');
  if (value.status !== 'matched' || value.analysis_eligible_rows !== exact.analysisEligible) {
    throw new Error('M2 aggregate reconciliation is not explicitly matched.');
  }
  const actualAdmission = structuredClone(value);
  delete actualAdmission.status;
  delete actualAdmission.analysis_eligible_rows;
  assertSameValue(
    actualAdmission,
    exact.admission,
    'M2 aggregate reconciliation does not match exact_input.',
  );
}

function validateStrata(value, eligible) {
  assertExactKeys(value, STRATA_DIMENSIONS, 'Denominator audit strata');
  for (const dimension of STRATA_DIMENSIONS) {
    const stratum = value[dimension];
    assertRecord(stratum, `Strata ${dimension}`);
    if (dimension === 'road') {
      validateUnavailableDimension(stratum, dimension);
      if (stratum.reason !== 'versioned-road-geometry-binding-unavailable') {
        throw new Error('Road stratum must remain unavailable without a versioned road binding.');
      }
      continue;
    }
    if (stratum.status === 'unavailable') {
      if (!['district', 'psa'].includes(dimension)) {
        throw new Error(`Strata ${dimension} cannot be wholly unavailable.`);
      }
      validateUnavailableDimension(stratum, dimension);
      continue;
    }
    assertExactKeys(stratum, [
      'status', 'denominator', 'total', 'values',
    ], `Strata ${dimension}`);
    if (stratum.status !== 'available'
      || stratum.denominator !== 'analysis_eligible_rows'
      || stratum.total !== eligible
      || !Array.isArray(stratum.values)) {
      throw new Error(`Strata ${dimension} header is invalid.`);
    }
    const seen = new Set();
    let total = 0;
    for (const [index, entry] of stratum.values.entries()) {
      assertExactKeys(entry, ['value', 'count'], `Strata ${dimension}.values[${index}]`);
      validateStratumValue(dimension, entry.value, index);
      if (!Number.isSafeInteger(entry.count) || entry.count <= 0) {
        throw new Error(`Strata ${dimension}.values[${index}].count must be positive.`);
      }
      const identity = stableSerialization(entry.value);
      if (seen.has(identity)) {
        throw new Error(`Strata ${dimension} contains duplicate/conflicting values.`);
      }
      seen.add(identity);
      total += entry.count;
    }
    if (total !== eligible) {
      throw new Error(`Strata ${dimension} does not conserve the analysis-eligible denominator.`);
    }
  }
}

function validateUnavailableDimension(value, dimension) {
  assertExactKeys(value, ['status', 'reason'], `Strata ${dimension}`);
  if (value.status !== 'unavailable'
    || typeof value.reason !== 'string'
    || value.reason.length > 160
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.reason)) {
    throw new Error(`Strata ${dimension} unavailable state is invalid.`);
  }
}

function validateStratumValue(dimension, value, index) {
  const invalid = () => {
    throw new Error(`Strata ${dimension}.values[${index}].value is invalid.`);
  };
  if (dimension === 'year') {
    if (!Number.isSafeInteger(value) || value < 1000 || value > 9999) invalid();
    return;
  }
  if (['district', 'psa'].includes(dimension)) {
    if (value !== null && !nonemptyString(value)) invalid();
    return;
  }
  const allowed = {
    tract_status: TRACT_STATUSES,
    grid_status: GRID_STATUSES,
    boundary_status: [
      'inside-single-tract',
      'ambiguous-tract-boundary',
      'outside-admitted-tract-geometries',
      'unavailable-coordinate-missing',
      'unavailable-coordinate-invalid',
      'unavailable-coordinate-outside-city-bounds',
      'unavailable-other',
    ],
    acs_population_band: ['low', 'medium', 'high', 'unavailable'],
    acs_temporal_compatibility: [
      'within-acs-period', 'outside-acs-period', 'unavailable',
    ],
  };
  if (dimension === 'normalized_category') {
    if (!nonemptyString(value)) invalid();
    return;
  }
  if (!allowed[dimension]?.includes(value)) invalid();
}

function validateDistrictPsaAttribution(value, audit, exact) {
  assertRecord(value, 'District/PSA attribution');
  const district = audit.strata.district;
  const psa = audit.strata.psa;
  if (value.status === 'unavailable') {
    assertExactKeys(value, ['status', 'reason'], 'District/PSA attribution');
    if (!nonemptyString(value.reason)
      || district.status !== 'unavailable'
      || psa.status !== 'unavailable'
      || district.reason !== value.reason
      || psa.reason !== value.reason) {
      throw new Error('District/PSA unavailable status is inconsistent.');
    }
    return;
  }
  assertExactKeys(value, [
    'status', 'total', 'joined_events', 'district_missing', 'psa_missing',
  ], 'District/PSA attribution');
  for (const name of ['total', 'joined_events', 'district_missing', 'psa_missing']) {
    assertCount(value[name], `District/PSA attribution.${name}`);
  }
  if (value.status !== 'available'
    || value.total !== exact.canonical
    || value.joined_events !== exact.canonical
    || value.district_missing > exact.canonical
    || value.psa_missing > exact.canonical
    || district.status !== 'available'
    || psa.status !== 'available'
    || nullStratumCount(district) !== value.district_missing
    || nullStratumCount(psa) !== value.psa_missing) {
    throw new Error('District/PSA available attribution is inconsistent.');
  }
}

function nullStratumCount(stratum) {
  return stratum.values.find((entry) => entry.value === null)?.count || 0;
}

function validateAuditPolicy(value) {
  const expected = {
    aggregate_only: true,
    event_level_data_included: false,
    source_records_included: false,
    source_identifiers_included: false,
    coordinates_included: false,
    generalized_locations_included: false,
  };
  assertExactKeys(value, Object.keys(expected), 'Denominator audit artifact_policy');
  assertSameValue(value, expected, 'Denominator audit artifact_policy is not aggregate-only.');
}

function validateAuditAuthority(value) {
  const expected = { serving: false, promotion: false, forecast: false, receipt: false };
  assertExactKeys(value, Object.keys(expected), 'Denominator audit authority');
  assertSameValue(value, expected, 'Denominator audit authority boundary is invalid.');
}

function validateSourceSpatialRows(value, eligible) {
  assertExactKeys(value, ['tract', 'fixed_grid'], 'Method source_spatial_rows');
  assertExactKeys(value.tract, [
    'mapped', 'ambiguous', 'unmapped', 'invalid',
  ], 'Method source_spatial_rows.tract');
  assertExactKeys(value.fixed_grid, [
    'mapped', 'unavailable', 'invalid',
  ], 'Method source_spatial_rows.fixed_grid');
  for (const count of [...Object.values(value.tract), ...Object.values(value.fixed_grid)]) {
    assertCount(count, 'Method source spatial count');
  }
  if (value.tract.invalid !== 0 || value.fixed_grid.invalid !== 0
    || Object.values(value.tract).reduce((sum, count) => sum + count, 0) !== eligible
    || Object.values(value.fixed_grid).reduce((sum, count) => sum + count, 0) !== eligible) {
    throw new Error('Method source spatial rows are invalid or do not conserve eligible rows.');
  }
}

function validateMethods(value, eligible) {
  if (!Array.isArray(value) || value.length !== SPATIAL_ATTRIBUTION_METHOD_IDS.length) {
    throw new Error('Method comparison must contain exactly four methods.');
  }
  value.forEach((method, index) => {
    if (method?.method !== SPATIAL_ATTRIBUTION_METHOD_IDS[index]) {
      throw new Error('Method comparison method IDs/order are not the frozen v2 set.');
    }
    validateMethod(method, eligible);
  });
}

function validateMethod(value, eligible) {
  const label = `Attribution method ${String(value?.method)}`;
  assertExactKeys(value, [
    'schema',
    'method',
    'method_version',
    'unit_type',
    'assignment',
    'availability',
    'weight_basis',
    'candidate_weight_contract_identity',
    'input_artifact_identity',
    'unavailable_reason',
    'acs_weighting',
    'known_route_segment_kernel',
    'integer_m2_mart_contract',
    'method_identity',
    'config_identity',
    'input_rows',
    'assigned_rows',
    'excluded_rows',
    'weighted_mass',
    'tolerance',
    'exclusions',
    'aggregates',
    'result_identity',
  ], label);
  const blueprint = METHOD_BLUEPRINTS[value.method];
  if (!blueprint || value.schema !== METHOD_RESULT_SCHEMA
    || value.method_version !== blueprint.method_version
    || value.unit_type !== blueprint.unit_type
    || value.assignment !== blueprint.assignment
    || value.weight_basis !== blueprint.weight_basis
    || value.candidate_weight_contract_identity
      !== blueprint.candidate_weight_contract_identity
    || (value.input_artifact_identity !== null
      && !SHA256_IDENTITY.test(value.input_artifact_identity || ''))
    || (blueprint.assignment === 'integer' && value.input_artifact_identity !== null)
    || value.acs_weighting !== 'forbidden'
    || value.known_route_segment_kernel !== 'not-area-attribution'
    || value.integer_m2_mart_contract !== 'independent-unchanged') {
    throw new Error(`${label} contract fields are invalid.`);
  }
  for (const name of ['method_identity', 'config_identity', 'result_identity']) {
    assertDigest(value[name], `${label}.${name}`);
  }
  assertCount(value.input_rows, `${label}.input_rows`);
  assertCount(value.assigned_rows, `${label}.assigned_rows`);
  assertCount(value.excluded_rows, `${label}.excluded_rows`);
  if (value.input_rows !== eligible
    || value.assigned_rows + value.excluded_rows !== eligible) {
    throw new Error(`${label} row mass does not conserve eligible rows.`);
  }
  const expectedAvailability = eligible > 0 && value.assigned_rows === eligible
    ? 'available'
    : value.assigned_rows > 0 ? 'partial' : 'unavailable';
  if (value.availability !== expectedAvailability
    || (value.availability === 'unavailable'
      && (value.assigned_rows !== 0 || value.excluded_rows !== eligible
        || value.weighted_mass !== null || !nonemptyString(value.unavailable_reason)))
    || (value.availability !== 'unavailable'
      && (value.unavailable_reason !== null
        || value.weighted_mass !== value.assigned_rows))) {
    throw new Error(`${label} availability contradicts its admitted/excluded mass.`);
  }
  if (value.unavailable_reason !== null
    && (!nonemptyString(value.unavailable_reason) || value.unavailable_reason.length > 128)) {
    throw new Error(`${label} unavailable_reason is invalid.`);
  }
  if (!Number.isFinite(value.tolerance)
    || value.tolerance < 1e-12 || value.tolerance > 1e-6) {
    throw new Error(`${label} tolerance is outside the producer v2 contract.`);
  }
  validateMethodIdentity(value, blueprint, label);
  validateMethodExclusions(value.exclusions, value.excluded_rows, label);
  validateMethodAggregates(value.aggregates, value, blueprint, label);
  validateObjectIdentity(value, 'result_identity', label);
}

function validateMethodIdentity(value, blueprint, label) {
  const methodEvidence = {
    schema: METHOD_RESULT_SCHEMA,
    method: value.method,
    method_version: blueprint.method_version,
    unit_type: blueprint.unit_type,
    assignment: blueprint.assignment,
    spatial_semantics: blueprint.spatial_semantics,
    weight_basis: blueprint.weight_basis,
  };
  if (value.method_identity !== spatialAttributionValueIdentity(methodEvidence)) {
    throw new Error(`${label} method_identity drifted from the frozen method contract.`);
  }
  const config = {
    schema: METHOD_CONFIG_SCHEMA,
    method: value.method,
    ...blueprint,
    input_artifact_identity: value.input_artifact_identity,
    configured_unavailable_reason:
      blueprint.assignment === 'weighted' && value.input_artifact_identity === null
        ? 'uncertainty-footprint-artifact-unavailable'
        : null,
    tolerance: value.tolerance,
    acs_weighting: 'forbidden',
    known_route_segment_kernel: 'not-area-attribution',
    integer_m2_mart_contract: 'independent-unchanged',
    method_identity: value.method_identity,
  };
  if (value.config_identity !== spatialAttributionValueIdentity(config)) {
    throw new Error(`${label} config_identity drifted from the frozen method configuration.`);
  }
}

function validateMethodExclusions(value, expected, label) {
  if (!Array.isArray(value)) throw new Error(`${label}.exclusions must be an array.`);
  let total = 0;
  let previous = null;
  for (const [index, exclusion] of value.entries()) {
    assertExactKeys(exclusion, ['reason', 'rows'], `${label}.exclusions[${index}]`);
    if (typeof exclusion.reason !== 'string'
      || exclusion.reason.length > 128
      || !/^[a-z][a-z0-9-]*$/.test(exclusion.reason)
      || exclusion.reason <= (previous || '')
      || !Number.isSafeInteger(exclusion.rows) || exclusion.rows <= 0) {
      throw new Error(`${label}.exclusions contains duplicate/conflicting or invalid strata.`);
    }
    previous = exclusion.reason;
    total += exclusion.rows;
  }
  if (total !== expected) throw new Error(`${label}.exclusions does not conserve excluded rows.`);
}

function validateMethodAggregates(value, method, blueprint, label) {
  if (!Array.isArray(value)) throw new Error(`${label}.aggregates must be an array.`);
  if (method.assigned_rows === 0) {
    if (value.length !== 0 || method.weighted_mass !== null) {
      throw new Error(`${label} unavailable weighted mass must remain null.`);
    }
    return;
  }
  if (value.length === 0) throw new Error(`${label}.aggregates cannot be empty when rows are assigned.`);
  const masses = [];
  let previous = null;
  for (const [index, aggregate] of value.entries()) {
    assertExactKeys(aggregate, [
      'unit_id', 'contributing_rows', 'weighted_mass',
    ], `${label}.aggregates[${index}]`);
    const validUnit = blueprint.unit_type === 'fixed-grid'
      ? GRID_IDENTITY.test(aggregate.unit_id || '')
      : TRACT_IDENTITY.test(aggregate.unit_id || '');
    if (!validUnit || aggregate.unit_id <= (previous || '')
      || !Number.isSafeInteger(aggregate.contributing_rows)
      || aggregate.contributing_rows <= 0
      || aggregate.contributing_rows > method.assigned_rows
      || !Number.isFinite(aggregate.weighted_mass)
      || aggregate.weighted_mass <= 0) {
      throw new Error(`${label}.aggregates contains duplicate/conflicting or invalid units.`);
    }
    previous = aggregate.unit_id;
    masses.push(aggregate.weighted_mass);
  }
  const aggregateMass = stableNumberSum(masses);
  const allowedDrift = method.tolerance * Math.max(1, method.assigned_rows);
  if (Math.abs(aggregateMass - method.weighted_mass) > allowedDrift) {
    throw new Error(`${label} weighted mass does not conserve assigned rows.`);
  }
}

function stableNumberSum(values) {
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const adjusted = value - compensation;
    const next = sum + adjusted;
    compensation = (next - sum) - adjusted;
    sum = next;
  }
  return sum;
}

function validateMethodPrivacy(value) {
  const expected = {
    aggregate_only: true,
    coordinates_included: false,
    generalized_locations_included: false,
    raw_events_included: false,
    source_record_ids_included: false,
    uncertainty_footprints_included: false,
  };
  assertExactKeys(value, Object.keys(expected), 'Method comparison privacy');
  assertSameValue(value, expected, 'Method comparison privacy boundary is invalid.');
}

function validateMethodGovernance(value) {
  const expected = {
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
  };
  assertExactKeys(value, Object.keys(expected), 'Method comparison governance');
  assertSameValue(value, expected, 'Method comparison governance boundary is invalid.');
}

function validateProducerIdentity(value, key, label) {
  validateObjectIdentity(value, key, label);
}

function validateObjectIdentity(value, key, label) {
  assertDigest(value[key], `${label}.${key}`);
  const evidence = structuredClone(value);
  delete evidence[key];
  if (value[key] !== spatialAttributionValueIdentity(evidence)) {
    throw new Error(`${label} ${key} drifted from its aggregate fields.`);
  }
}

function assertComparatorMatchesDenominator(comparison, denominator) {
  const source = comparison.source_spatial_rows;
  assertSameValue(source.tract, {
    ...denominator.tract_denominator.statuses,
    invalid: 0,
  }, 'Method tract source rows do not match the denominator audit.');
  assertSameValue(source.fixed_grid, {
    ...denominator.grid_denominator.statuses,
    invalid: 0,
  }, 'Method grid source rows do not match the denominator audit.');
}

function projectMethod(value) {
  return {
    method: value.method,
    method_version: value.method_version,
    availability: value.availability,
    unit_type: value.unit_type,
    assignment: value.assignment,
    weight_basis: value.weight_basis,
    candidate_weight_contract_identity: value.candidate_weight_contract_identity,
    input_artifact_identity: value.input_artifact_identity,
    unavailable_reason: value.unavailable_reason,
    method_identity: value.method_identity,
    config_identity: value.config_identity,
    result_identity: value.result_identity,
    input_rows: value.input_rows,
    assigned_rows: value.assigned_rows,
    excluded_rows: value.excluded_rows,
    weighted_mass: value.weighted_mass,
    tolerance: value.tolerance,
    exclusions: value.exclusions.map((entry) => ({
      reason: entry.reason,
      excluded_rows: entry.rows,
    })),
    aggregate_unit_count: value.aggregates.length,
  };
}

function projectStrata(value) {
  return Object.fromEntries(STRATA_DIMENSIONS.map((dimension) => {
    const stratum = value[dimension];
    if (stratum.status === 'unavailable') {
      return [dimension, structuredClone(stratum)];
    }
    return [dimension, {
      status: stratum.status,
      denominator: stratum.denominator,
      total: stratum.total,
      values: stratum.values.map((entry) => ({
        value: entry.value,
        count: entry.count,
        quality: stratumValueQuality(dimension, entry.value),
      })),
    }];
  }));
}

function stratumValueQuality(dimension, value) {
  if (value === null || value === 'unavailable'
    || (typeof value === 'string' && value.startsWith('unavailable-'))) {
    return { status: 'unavailable', reason: `${dimension}-missing-or-unavailable` };
  }
  if (value === 'ambiguous' || value === 'ambiguous-tract-boundary') {
    return { status: 'ambiguous', reason: 'tract-attribution-ambiguous' };
  }
  if (value === 'unmapped' || value === 'outside-admitted-tract-geometries') {
    return { status: 'unmapped', reason: 'tract-attribution-unmapped' };
  }
  if (value === 'outside-acs-period') {
    return { status: 'stale', reason: 'acs-vintage-outside-event-period' };
  }
  if (value === 'partial') {
    return { status: 'partial', reason: `${dimension}-partial` };
  }
  return { status: 'available' };
}

function validateObservedInputBytes(value) {
  if (value === undefined) return undefined;
  assertExactKeys(value, [
    'denominator_audit', 'method_comparison',
  ], 'Observed input byte identities');
  assertDigest(value.denominator_audit, 'Observed denominator audit bytes');
  assertDigest(value.method_comparison, 'Observed method comparison bytes');
  return value;
}

function assertNoUnexpectedSensitiveKeys(value, label, {
  permittedAggregateRows = false,
} = {}) {
  visit(value, (_entry, key, fieldPath) => {
    const normalized = normalizeKey(key);
    const permittedRows = permittedAggregateRows && key === 'rows'
      && /^\$\.methods\[\d+\]\.exclusions\[\d+\]\.rows$/.test(fieldPath);
    if (FORBIDDEN_OUTPUT_KEYS.has(normalized) && !permittedRows) {
      throw new Error(`${label} contains forbidden event-level field ${fieldPath}.`);
    }
  });
}

function assertNoForbiddenOutputKeys(value, label) {
  visit(value, (_entry, key, fieldPath) => {
    if (FORBIDDEN_OUTPUT_KEYS.has(normalizeKey(key))) {
      throw new Error(`${label} contains forbidden field ${fieldPath}.`);
    }
  });
}

function assertUnavailableNoTotal(value, label, path = '$', seen = new Set()) {
  if (value == null || typeof value !== 'object') return;
  if (seen.has(value)) throw new Error(`${label} contains a cyclic value at ${path}.`);
  seen.add(value);
  if (!Array.isArray(value) && value.status === 'unavailable') {
    if (Object.hasOwn(value, 'total')) {
      throw new Error(`${label} unavailable object ${path} must not carry total.`);
    }
    if (!nonemptyString(value.reason)) {
      throw new Error(`${label} unavailable object ${path} requires a reason.`);
    }
  }
  for (const [key, entry] of Object.entries(value)) {
    assertUnavailableNoTotal(entry, label, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function assertJsonCompatible(value, label, path = '$', seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error(`${label} contains an invalid JSON number at ${path}.`);
    }
    return;
  }
  if (typeof value !== 'object') {
    throw new Error(`${label} contains a non-JSON value at ${path}.`);
  }
  if (seen.has(value)) throw new Error(`${label} contains a cyclic value at ${path}.`);
  seen.add(value);
  for (const [key, entry] of Object.entries(value)) {
    if (BLOCKED_OBJECT_KEYS.has(key)) {
      throw new Error(`${label} contains a prohibited object key at ${path}.${key}.`);
    }
    assertJsonCompatible(entry, label, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function visit(value, callback, path = '$', seen = new Set()) {
  if (value == null || typeof value !== 'object') return;
  if (seen.has(value)) throw new Error(`Aggregate value contains a cycle at ${path}.`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      visit(entry, callback, `${path}[${index}]`, seen);
    });
  } else {
    for (const [key, entry] of Object.entries(value)) {
      const fieldPath = `${path}.${key}`;
      callback(entry, key, fieldPath);
      visit(entry, callback, fieldPath, seen);
    }
  }
  seen.delete(value);
}

function assertExactKeys(value, keys, label) {
  assertRecord(value, label);
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (stableSerialization(actual) !== stableSerialization(expected)) {
    throw new Error(`${label} contains missing or unknown schema fields.`);
  }
}

function assertRecord(value, label) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function assertDigest(value, label) {
  if (!SHA256_IDENTITY.test(value || '')) {
    throw new Error(`${label} must be an exact sha256 identity.`);
  }
}

function assertSameValue(left, right, message) {
  if (stableSerialization(left) !== stableSerialization(right)) throw new Error(message);
}

function nonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeKey(value) {
  return value.replaceAll('_', '').replaceAll('-', '').toLowerCase();
}

function stableSerialization(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialization).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableSerialization(value[key])}`
    )).join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Aggregate value contains a non-JSON value.');
  return serialized;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}
