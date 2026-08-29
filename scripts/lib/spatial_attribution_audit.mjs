import { createHash } from 'node:crypto';

import { populationBand } from './area_intelligence_model.mjs';

export const SPATIAL_ATTRIBUTION_AUDIT_SCHEMA = 'engagement-spatial-attribution-audit/v2';

const ACCUMULATOR_SCHEMA = 'engagement-spatial-attribution-audit-accumulator/v2';
const TRACT_STATUSES = ['mapped', 'ambiguous', 'unmapped'];
const GRID_STATUSES = ['mapped', 'unavailable'];
const CORE_STRATA = [
  'year',
  'normalized_category',
  'tract_status',
  'grid_status',
  'boundary_status',
  'acs_population_band',
  'acs_temporal_compatibility',
];
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

/** Exact M2 stageCanonicalPartition admission predicate. */
export function isSpatialAttributionAnalysisEligible(event) {
  return event?.lifecycle?.state === 'active'
    && typeof event.event_at === 'string'
    && Number.isFinite(Date.parse(event.event_at))
    && event?.normalized_category?.status === 'mapped'
    && typeof event.normalized_category.theme_id === 'string';
}

/**
 * Pure streaming state for a runner that already owns the exact warehouse
 * admission pass. The accumulator retains counts only, never canonical events,
 * source records, identifiers, locations, or coordinates.
 */
export function createSpatialAttributionAuditAccumulator({ exact_input } = {}) {
  validateExactInput(exact_input);
  return {
    schema: ACCUMULATOR_SCHEMA,
    exactInput: canonicalExactInput(exact_input),
    counters: {
      canonical: 0,
      eligible: 0,
      exclusions: { non_active: 0, invalid_event_time: 0, unknown_category: 0 },
      tract: { mapped: 0, ambiguous: 0, unmapped: 0 },
      grid: { mapped: 0, unavailable: 0 },
      matrix: createStatusMatrix(),
    },
    strata: Object.fromEntries([...CORE_STRATA, 'district', 'psa'].map((name) => [name, new Map()])),
    districtPsa: {
      status: 'available',
      reason: null,
      joined: 0,
      districtMissing: 0,
      psaMissing: 0,
    },
  };
}

/** Add one admission-validated canonical row and its exact source projection. */
export function addSpatialAttributionAuditRow(accumulator, {
  canonical_event,
  raw_dimensions,
} = {}) {
  assertAccumulator(accumulator);
  const event = canonical_event;
  const classification = classifyEvent(event);
  const projection = classifyRawDimensions(event, raw_dimensions);
  const counters = accumulator.counters;
  counters.canonical += 1;

  if (!classification.eligible) {
    counters.exclusions[classification.exclusion] += 1;
  } else {
    const {
      year, category, tractStatus, gridStatus,
    } = classification;
    counters.eligible += 1;
    counters.tract[tractStatus] += 1;
    counters.grid[gridStatus] += 1;
    counters.matrix[tractStatus][gridStatus] += 1;
    incrementStratum(accumulator.strata.year, year);
    incrementStratum(accumulator.strata.normalized_category, category);
    incrementStratum(accumulator.strata.tract_status, tractStatus);
    incrementStratum(accumulator.strata.grid_status, gridStatus);
    incrementStratum(accumulator.strata.boundary_status, boundaryStatus(event.spatial?.tract));
    incrementStratum(accumulator.strata.acs_population_band, eligiblePopulationBand(event.acs));
    incrementStratum(
      accumulator.strata.acs_temporal_compatibility,
      acsTemporalBand(event.acs?.temporalAlignment),
    );
  }

  addDistrictPsaProjection(accumulator, projection, classification.eligible);
}

/** Finalize and compare all eligible counts with the exact bound M2 admission. */
export function finalizeSpatialAttributionAuditAccumulator(accumulator) {
  assertAccumulator(accumulator);
  const { counters, exactInput } = accumulator;
  const canonicalExpected = exactInput.m1.canonical.row_count;
  const exclusionTotal = Object.values(counters.exclusions).reduce((sum, count) => sum + count, 0);
  if (counters.canonical !== canonicalExpected
    || counters.canonical !== exactInput.m2.admission.canonical_rows_seen
    || counters.eligible + exclusionTotal !== counters.canonical) {
    throw new Error('Spatial attribution canonical and analysis-eligible denominators do not reconcile.');
  }
  assertStatusTotal(counters.tract, counters.eligible, 'tract');
  assertStatusTotal(counters.grid, counters.eligible, 'grid');
  assertStatusMatrix(counters);
  for (const name of CORE_STRATA) assertStratumTotal(accumulator.strata[name], counters.eligible, name);

  const observedM2 = {
    canonical_rows_seen: counters.canonical,
    tract: {
      admitted: counters.tract.mapped,
      ambiguous_excluded: counters.tract.ambiguous,
      unmapped_excluded: counters.tract.unmapped,
    },
    'fixed-grid': {
      admitted: counters.grid.mapped,
      unavailable_excluded: counters.grid.unavailable,
    },
    unknown_category: counters.exclusions.unknown_category,
    invalid_event_time: counters.exclusions.invalid_event_time,
    non_active: counters.exclusions.non_active,
  };
  if (stableSerialization(observedM2) !== stableSerialization(exactInput.m2.admission)) {
    throw new Error('Spatial attribution eligible rows drifted from the exact M2 admission baseline.');
  }

  const districtPsa = finalizeDistrictPsa(accumulator);
  const strata = Object.fromEntries(CORE_STRATA.map((name) => [
    name,
    availableStratum(accumulator.strata[name], counters.eligible),
  ]));
  if (districtPsa.status === 'available') {
    assertStratumTotal(accumulator.strata.district, counters.eligible, 'district');
    assertStratumTotal(accumulator.strata.psa, counters.eligible, 'psa');
    strata.district = availableStratum(accumulator.strata.district, counters.eligible);
    strata.psa = availableStratum(accumulator.strata.psa, counters.eligible);
  } else {
    strata.district = { status: 'unavailable', reason: districtPsa.reason };
    strata.psa = { status: 'unavailable', reason: districtPsa.reason };
  }
  strata.road = {
    status: 'unavailable',
    reason: 'versioned-road-geometry-binding-unavailable',
  };

  const matrix = statusMatrixCells(counters.matrix);
  const evidence = {
    schema: SPATIAL_ATTRIBUTION_AUDIT_SCHEMA,
    exact_input: structuredClone(exactInput),
    method: {
      version: 'spatial-attribution-denominator-audit/v2',
      canonical_event_denominator: 'canonical_rows',
      analysis_eligibility: 'active-and-valid-event-time-and-mapped-normalized-category',
      tract_grid_relationship: 'parallel-overlapping-event-sets',
      source_join: {
        cardinality: 'exactly-one-source-record-per-canonical-event-and-lineage-snapshot',
        missing_value_policy: 'null-is-unavailable',
      },
      acs_population_bands: {
        low_upper_exclusive: 2500,
        medium_upper_exclusive: 4500,
      },
    },
    canonical_denominator: {
      name: 'canonical_rows',
      total: counters.canonical,
    },
    analysis_eligible_denominator: {
      name: 'analysis_eligible_rows',
      parent: 'canonical_rows',
      total: counters.eligible,
      exclusions: { ...counters.exclusions },
    },
    tract_denominator: {
      name: 'tract_status_rows',
      parent: 'analysis_eligible_rows',
      total: counters.eligible,
      statuses: { ...counters.tract },
    },
    grid_denominator: {
      name: 'grid_status_rows',
      parent: 'analysis_eligible_rows',
      total: counters.eligible,
      statuses: { ...counters.grid },
    },
    spatial_status_matrix: {
      denominator: 'analysis_eligible_rows',
      total: counters.eligible,
      cells: matrix,
    },
    mapped_set_relationship: mappedSetRelationship(counters.matrix, counters.eligible),
    m2_aggregate_reconciliation: {
      status: 'matched',
      analysis_eligible_rows: counters.eligible,
      ...observedM2,
    },
    strata,
    district_psa_attribution: districtPsa,
    artifact_policy: {
      aggregate_only: true,
      event_level_data_included: false,
      source_records_included: false,
      source_identifiers_included: false,
      coordinates_included: false,
      generalized_locations_included: false,
    },
    authority: {
      serving: false,
      promotion: false,
      forecast: false,
      receipt: false,
    },
  };
  return Object.freeze({ ...evidence, audit_identity: identityOf(evidence) });
}

/** Synthetic/compatibility helper; production runners should stream directly. */
export function buildSpatialAttributionAudit({ exact_input, rows = [] } = {}) {
  if (!Array.isArray(rows)) throw new Error('Spatial attribution compatibility rows must be an array.');
  const accumulator = createSpatialAttributionAuditAccumulator({ exact_input });
  for (const row of rows) addSpatialAttributionAuditRow(accumulator, row);
  return finalizeSpatialAttributionAuditAccumulator(accumulator);
}

export function serializeSpatialAttributionAudit(audit) {
  return `${JSON.stringify(audit, null, 2)}\n`;
}

function validateExactInput(value) {
  const protocol = value?.protocol;
  const m1 = value?.m1;
  const m2 = value?.m2;
  if (!hasExactKeys(value, ['m1', 'm2', 'protocol'])
    || !hasExactKeys(protocol, ['schema', 'sha256'])
    || !hasExactKeys(m1, [
      'canonical', 'receipt_identity', 'receipt_schema', 'receipt_sha256',
      'warehouse_current_snapshot_id', 'warehouse_schema',
    ])
    || !hasExactKeys(m1?.canonical, ['bytes', 'partition_count', 'row_count', 'sha256'])
    || !hasExactKeys(m2, [
      'admission', 'artifact_identity', 'artifact_policy', 'bytes', 'manifest_sha256',
      'mart_schema', 'part_bindings_identity', 'part_count', 'row_count',
    ])
    || !hasExactKeys(m2?.artifact_policy, ['event_level_data_included'])
    || protocol?.schema !== 'engagement-spatial-attribution-protocol/v2'
    || !SHA256_PATTERN.test(protocol.sha256 || '')
    || m1?.receipt_schema !== 'engagement-phl-crime-warehouse-receipt/v3'
    || !SHA256_PATTERN.test(m1.receipt_identity || '')
    || !SHA256_PATTERN.test(m1.receipt_sha256 || '')
    || m1.warehouse_schema !== 'engagement-phl-crime-event-warehouse/v1'
    || !SHA256_PATTERN.test(m1.warehouse_current_snapshot_id || '')
    || !validCount(m1.canonical?.partition_count) || m1.canonical.partition_count < 1
    || !validCount(m1.canonical?.row_count)
    || !validCount(m1.canonical?.bytes)
    || !SHA256_PATTERN.test(m1.canonical?.sha256 || '')
    || m2?.mart_schema !== 'engagement-area-intelligence-feature-mart/v2'
    || !SHA256_PATTERN.test(m2.manifest_sha256 || '')
    || !SHA256_PATTERN.test(m2.artifact_identity || '')
    || !SHA256_PATTERN.test(m2.part_bindings_identity || '')
    || !validCount(m2.part_count) || !validCount(m2.row_count) || !validCount(m2.bytes)
    || m2.artifact_policy?.event_level_data_included !== false) {
    throw new Error('Spatial attribution exact_input identities are invalid.');
  }
  validateM2Admission(m2.admission);
  const admission = m2.admission;
  const canonical = m1.canonical.row_count;
  const excluded = admission.non_active
    + admission.invalid_event_time
    + admission.unknown_category;
  const eligible = canonical - excluded;
  if (canonical !== admission.canonical_rows_seen || eligible < 0
    || admission.tract.admitted
      + admission.tract.ambiguous_excluded
      + admission.tract.unmapped_excluded !== eligible
    || admission['fixed-grid'].admitted
      + admission['fixed-grid'].unavailable_excluded !== eligible) {
    throw new Error('Spatial attribution exact_input denominators do not reconcile.');
  }
}

function validateM2Admission(value) {
  if (!hasExactKeys(value, [
    'canonical_rows_seen', 'fixed-grid', 'invalid_event_time', 'non_active',
    'tract', 'unknown_category',
  ])
    || !hasExactKeys(value?.tract, ['admitted', 'ambiguous_excluded', 'unmapped_excluded'])
    || !hasExactKeys(value?.['fixed-grid'], ['admitted', 'unavailable_excluded'])) {
    throw new Error('Spatial attribution exact M2 admission baseline is invalid.');
  }
  const counts = [
    value?.canonical_rows_seen,
    value?.tract?.admitted,
    value?.tract?.ambiguous_excluded,
    value?.tract?.unmapped_excluded,
    value?.['fixed-grid']?.admitted,
    value?.['fixed-grid']?.unavailable_excluded,
    value?.unknown_category,
    value?.invalid_event_time,
    value?.non_active,
  ];
  if (counts.some((count) => !validCount(count))) {
    throw new Error('Spatial attribution exact M2 admission baseline is invalid.');
  }
}

function assertAccumulator(value) {
  if (value?.schema !== ACCUMULATOR_SCHEMA || !value.counters || !value.strata) {
    throw new Error('Spatial attribution accumulator is invalid.');
  }
}

function addDistrictPsaProjection(accumulator, projection, eligible) {
  const state = accumulator.districtPsa;
  if (projection.status === 'unavailable') {
    if (state.status === 'unavailable') return;
    state.status = 'unavailable';
    state.reason = projection.reason;
    return;
  }
  if (state.status === 'unavailable') return;
  state.joined += 1;
  if (projection.district == null) state.districtMissing += 1;
  if (projection.psa == null) state.psaMissing += 1;
  if (eligible) {
    incrementStratum(accumulator.strata.district, projection.district);
    incrementStratum(accumulator.strata.psa, projection.psa);
  }
}

function classifyEvent(event) {
  const eligible = isSpatialAttributionAnalysisEligible(event);
  if (event?.lifecycle?.state !== 'active') return { eligible: false, exclusion: 'non_active' };
  const year = eventYear(event?.event_at);
  if (year == null) return { eligible: false, exclusion: 'invalid_event_time' };
  const category = event?.normalized_category;
  if (category?.status !== 'mapped'
    || typeof category.theme_id !== 'string') {
    return { eligible: false, exclusion: 'unknown_category' };
  }
  if (!eligible) throw new Error('Spatial attribution eligibility predicate drifted from M2.');
  const tractStatus = event?.spatial?.tract?.status;
  const gridStatus = event?.spatial?.grid?.status;
  if (!TRACT_STATUSES.includes(tractStatus) || !GRID_STATUSES.includes(gridStatus)) {
    throw new Error('Spatial attribution eligible row has an unsupported tract or grid status.');
  }
  return {
    eligible: true,
    year,
    category: category.theme_id,
    tractStatus,
    gridStatus,
  };
}

function classifyRawDimensions(event, value) {
  if (value == null) {
    return { status: 'unavailable', reason: 'canonical-source-join-unavailable' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'unavailable', reason: 'raw-dimensions-invalid' };
  }
  const allowed = ['dc_dist', 'location_block_available', 'psa', 'source_snapshot_id'];
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key))) {
    throw new Error('Spatial attribution raw_dimensions contains a non-whitelisted field.');
  }
  if (!hasExactKeys(value, allowed)
    || typeof value.source_snapshot_id !== 'string' || !value.source_snapshot_id
    || typeof value.location_block_available !== 'boolean'
    || !validSourceDimension(value.dc_dist)
    || !validSourceDimension(value.psa)) {
    return { status: 'unavailable', reason: 'raw-dimensions-invalid' };
  }
  const canonicalSnapshotId = event?.lineage?.source_snapshot_id;
  if (typeof canonicalSnapshotId !== 'string' || !canonicalSnapshotId) {
    return { status: 'unavailable', reason: 'canonical-source-lineage-snapshot-unavailable' };
  }
  if (value.source_snapshot_id !== canonicalSnapshotId) {
    return { status: 'unavailable', reason: 'canonical-source-lineage-snapshot-mismatch' };
  }
  return {
    status: 'available',
    district: value.dc_dist,
    psa: value.psa,
  };
}

function validSourceDimension(value) {
  return value == null
    || (typeof value === 'string' && value.length > 0 && value.trim() === value);
}

function finalizeDistrictPsa(accumulator) {
  const state = accumulator.districtPsa;
  if (state.status === 'unavailable') return { status: 'unavailable', reason: state.reason };
  if (state.joined !== accumulator.counters.canonical) {
    return { status: 'unavailable', reason: 'canonical-source-join-incomplete' };
  }
  return {
    status: 'available',
    total: accumulator.counters.canonical,
    joined_events: state.joined,
    district_missing: state.districtMissing,
    psa_missing: state.psaMissing,
  };
}

function incrementStratum(map, value) {
  const key = stableSerialization(value);
  const current = map.get(key);
  if (current) current.count += 1;
  else map.set(key, { value, count: 1 });
}

function availableStratum(map, total) {
  return {
    status: 'available',
    denominator: 'analysis_eligible_rows',
    total,
    values: [...map.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, entry]) => ({ ...entry })),
  };
}

function assertStratumTotal(map, expected, name) {
  const observed = [...map.values()].reduce((sum, entry) => sum + entry.count, 0);
  if (observed !== expected) {
    throw new Error(`Spatial attribution ${name} stratum does not reconcile to eligible rows.`);
  }
}

function createStatusMatrix() {
  return Object.fromEntries(TRACT_STATUSES.map((tract) => [
    tract,
    Object.fromEntries(GRID_STATUSES.map((grid) => [grid, 0])),
  ]));
}

function statusMatrixCells(matrix) {
  return TRACT_STATUSES.flatMap((tractStatus) => GRID_STATUSES.map((gridStatus) => ({
    tract_status: tractStatus,
    grid_status: gridStatus,
    count: matrix[tractStatus][gridStatus],
  })));
}

function mappedSetRelationship(matrix, total) {
  const intersection = matrix.mapped.mapped;
  const tractOnly = matrix.mapped.unavailable;
  const gridOnly = matrix.ambiguous.mapped + matrix.unmapped.mapped;
  const neither = matrix.ambiguous.unavailable + matrix.unmapped.unavailable;
  return {
    denominator: 'analysis_eligible_rows',
    total,
    tract_mapped: intersection + tractOnly,
    grid_mapped: intersection + gridOnly,
    intersection_mapped: intersection,
    tract_only_mapped: tractOnly,
    grid_only_mapped: gridOnly,
    neither_mapped: neither,
    union_mapped: intersection + tractOnly + gridOnly,
    combination_policy: 'never-sum-parallel-denominators-as-unique-events',
  };
}

function assertStatusTotal(statuses, expected, name) {
  const observed = Object.values(statuses).reduce((sum, count) => sum + count, 0);
  if (observed !== expected) {
    throw new Error(`Spatial attribution ${name} statuses do not reconcile to eligible rows.`);
  }
}

function assertStatusMatrix(counters) {
  let total = 0;
  for (const tractStatus of TRACT_STATUSES) {
    const rowTotal = GRID_STATUSES.reduce((sum, gridStatus) => {
      const count = counters.matrix?.[tractStatus]?.[gridStatus];
      if (!validCount(count)) throw new Error('Spatial attribution status matrix is invalid.');
      return sum + count;
    }, 0);
    if (rowTotal !== counters.tract[tractStatus]) {
      throw new Error('Spatial attribution status matrix tract margins do not reconcile.');
    }
    total += rowTotal;
  }
  for (const gridStatus of GRID_STATUSES) {
    const columnTotal = TRACT_STATUSES.reduce(
      (sum, tractStatus) => sum + counters.matrix[tractStatus][gridStatus],
      0,
    );
    if (columnTotal !== counters.grid[gridStatus]) {
      throw new Error('Spatial attribution status matrix grid margins do not reconcile.');
    }
  }
  if (total !== counters.eligible) {
    throw new Error('Spatial attribution status matrix does not reconcile to eligible rows.');
  }
}

function boundaryStatus(tract) {
  if (tract?.status === 'mapped') return 'inside-single-tract';
  if (tract?.status === 'ambiguous') return 'ambiguous-tract-boundary';
  if (tract?.reason === 'point-outside-admitted-tract-geometries') {
    return 'outside-admitted-tract-geometries';
  }
  if (tract?.reason === 'coordinate-missing') return 'unavailable-coordinate-missing';
  if (tract?.reason === 'coordinate-invalid') return 'unavailable-coordinate-invalid';
  if (tract?.reason === 'coordinate-outside-city-bounds') {
    return 'unavailable-coordinate-outside-city-bounds';
  }
  return 'unavailable-other';
}

function acsTemporalBand(value) {
  return ['within-acs-period', 'outside-acs-period'].includes(value) ? value : 'unavailable';
}

function eligiblePopulationBand(acs) {
  if (acs?.valueStatus !== 'available'
    || acs.temporalAlignment !== 'within-acs-period'
    || acs.modelInputEligible !== true) {
    return 'unavailable';
  }
  return populationBand(acs.estimate?.value);
}

function eventYear(value) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCFullYear();
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function hasExactKeys(value, keys) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && stableSerialization(Object.keys(value).sort()) === stableSerialization([...keys].sort());
}

function canonicalExactInput(value) {
  return {
    protocol: {
      schema: value.protocol.schema,
      sha256: value.protocol.sha256,
    },
    m1: {
      receipt_schema: value.m1.receipt_schema,
      receipt_identity: value.m1.receipt_identity,
      receipt_sha256: value.m1.receipt_sha256,
      warehouse_schema: value.m1.warehouse_schema,
      warehouse_current_snapshot_id: value.m1.warehouse_current_snapshot_id,
      canonical: {
        partition_count: value.m1.canonical.partition_count,
        row_count: value.m1.canonical.row_count,
        bytes: value.m1.canonical.bytes,
        sha256: value.m1.canonical.sha256,
      },
    },
    m2: {
      mart_schema: value.m2.mart_schema,
      manifest_sha256: value.m2.manifest_sha256,
      artifact_identity: value.m2.artifact_identity,
      part_bindings_identity: value.m2.part_bindings_identity,
      part_count: value.m2.part_count,
      row_count: value.m2.row_count,
      bytes: value.m2.bytes,
      admission: {
        canonical_rows_seen: value.m2.admission.canonical_rows_seen,
        tract: {
          admitted: value.m2.admission.tract.admitted,
          ambiguous_excluded: value.m2.admission.tract.ambiguous_excluded,
          unmapped_excluded: value.m2.admission.tract.unmapped_excluded,
        },
        'fixed-grid': {
          admitted: value.m2.admission['fixed-grid'].admitted,
          unavailable_excluded: value.m2.admission['fixed-grid'].unavailable_excluded,
        },
        unknown_category: value.m2.admission.unknown_category,
        invalid_event_time: value.m2.admission.invalid_event_time,
        non_active: value.m2.admission.non_active,
      },
      artifact_policy: {
        event_level_data_included: value.m2.artifact_policy.event_level_data_included,
      },
    },
  };
}

function identityOf(value) {
  return `sha256:${createHash('sha256').update(stableSerialization(value)).digest('hex')}`;
}

function stableSerialization(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialization).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialization(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
