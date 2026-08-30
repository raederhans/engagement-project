import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  addSpatialAttributionAuditRow,
  buildSpatialAttributionAudit,
  createSpatialAttributionAuditAccumulator,
  finalizeSpatialAttributionAuditAccumulator,
  isSpatialAttributionAnalysisEligible,
  serializeSpatialAttributionAudit,
} from '../lib/spatial_attribution_audit.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const auditSchema = JSON.parse(await fs.readFile(
  path.join(repoRoot, 'scripts/data/spatial_attribution_audit.schema.json'),
  'utf8',
));
const validateAuditSchema = (value) => validateSchemaNode(value, auditSchema);

test('streaming audit separates canonical and eligible denominators and conserves every eligible stratum', () => {
  const rows = primaryRows();
  const exactInput = exactInputFor({
    canonical: 9,
    exclusions: { non_active: 1, invalid_event_time: 1, unknown_category: 1 },
    tract: { admitted: 2, ambiguous_excluded: 2, unmapped_excluded: 2 },
    grid: { admitted: 3, unavailable_excluded: 3 },
  });
  const first = streamAudit(exactInput, rows);
  const second = streamAudit(reverseKeyOrder(exactInput), [...rows].reverse());

  assert.equal(validateAuditSchema(first), true, JSON.stringify(validateAuditSchema.errors));
  assert.deepEqual(second, first);
  assert.equal(serializeSpatialAttributionAudit(second), serializeSpatialAttributionAudit(first));
  assert.equal(serializeSpatialAttributionAudit(first).endsWith('\n'), true);
  assert.deepEqual(first.canonical_denominator, { name: 'canonical_rows', total: 9 });
  assert.deepEqual(first.analysis_eligible_denominator, {
    name: 'analysis_eligible_rows',
    parent: 'canonical_rows',
    total: 6,
    exclusions: { non_active: 1, invalid_event_time: 1, unknown_category: 1 },
  });
  assert.deepEqual(first.tract_denominator.statuses, {
    mapped: 2,
    ambiguous: 2,
    unmapped: 2,
  });
  assert.deepEqual(first.grid_denominator.statuses, { mapped: 3, unavailable: 3 });
  assert.deepEqual(first.spatial_status_matrix.cells, [
    { tract_status: 'mapped', grid_status: 'mapped', count: 1 },
    { tract_status: 'mapped', grid_status: 'unavailable', count: 1 },
    { tract_status: 'ambiguous', grid_status: 'mapped', count: 1 },
    { tract_status: 'ambiguous', grid_status: 'unavailable', count: 1 },
    { tract_status: 'unmapped', grid_status: 'mapped', count: 1 },
    { tract_status: 'unmapped', grid_status: 'unavailable', count: 1 },
  ]);
  assert.deepEqual(first.mapped_set_relationship, {
    denominator: 'analysis_eligible_rows',
    total: 6,
    tract_mapped: 2,
    grid_mapped: 3,
    intersection_mapped: 1,
    tract_only_mapped: 1,
    grid_only_mapped: 2,
    neither_mapped: 2,
    union_mapped: 4,
    combination_policy: 'never-sum-parallel-denominators-as-unique-events',
  });
  for (const name of [
    'year',
    'normalized_category',
    'tract_status',
    'grid_status',
    'boundary_status',
    'acs_population_band',
    'acs_temporal_compatibility',
    'district',
    'psa',
  ]) {
    assert.equal(first.strata[name].status, 'available', name);
    assert.equal(first.strata[name].total, 6, name);
    assert.equal(sumValues(first.strata[name]), 6, name);
  }
  assert.deepEqual(first.strata.road, {
    status: 'unavailable',
    reason: 'versioned-road-geometry-binding-unavailable',
  });
  assert.equal(Object.hasOwn(first.strata.road, 'total'), false);
  assert.deepEqual(first.district_psa_attribution, {
    status: 'available',
    total: 9,
    joined_events: 9,
    district_missing: 1,
    psa_missing: 1,
  });
  assert.deepEqual(first.m2_aggregate_reconciliation, {
    status: 'matched',
    analysis_eligible_rows: 6,
    ...exactInput.m2.admission,
  });
});

test('analysis eligibility is exactly M2-compatible and exclusions are mutually exclusive by priority', () => {
  const rows = primaryRows();
  assert.equal(isSpatialAttributionAnalysisEligible(rows[6].canonical_event), false);
  assert.equal(isSpatialAttributionAnalysisEligible(rows[7].canonical_event), false);
  assert.equal(isSpatialAttributionAnalysisEligible(rows[8].canonical_event), false);

  const emptyTheme = event({ id: 40, snapshot: snapshot('empty-theme'), theme: '' });
  assert.equal(isSpatialAttributionAnalysisEligible(emptyTheme), true);
  assert.equal(isSpatialAttributionAnalysisEligible({
    ...emptyTheme,
    event_at: 1704067200000,
  }), false);

  const exactInput = exactInputFor({
    canonical: 1,
    tract: { admitted: 1, ambiguous_excluded: 0, unmapped_excluded: 0 },
    grid: { admitted: 1, unavailable_excluded: 0 },
  });
  const audit = streamAudit(exactInput, [{
    canonical_event: emptyTheme,
    raw_dimensions: dimensions({ snapshotId: emptyTheme.lineage.source_snapshot_id }),
  }]);
  assert.deepEqual(audit.strata.normalized_category.values, [{ value: '', count: 1 }]);
  assert.equal(validateAuditSchema(audit), true, JSON.stringify(validateAuditSchema.errors));
});

test('raw dimensions use the frozen projection, preserve nulls, and do not collapse cross-snapshot IDs', () => {
  const exactInput = exactInputFor({
    canonical: 9,
    exclusions: { non_active: 1, invalid_event_time: 1, unknown_category: 1 },
    tract: { admitted: 2, ambiguous_excluded: 2, unmapped_excluded: 2 },
    grid: { admitted: 3, unavailable_excluded: 3 },
  });
  const audit = streamAudit(exactInput, primaryRows());
  const districts = new Map(audit.strata.district.values.map(({ value, count }) => [value, count]));
  const psas = new Map(audit.strata.psa.values.map(({ value, count }) => [value, count]));

  // cartodb_id=1 is present in two lineage snapshots and must remain two exact projections.
  assert.equal(districts.get('09'), 1);
  assert.equal(districts.get('99'), 1);
  assert.equal(districts.get(null), 1);
  assert.equal(psas.get(null), 1);
  assert.equal(districts.has(0), false);
  assert.equal(psas.has(0), false);
});

test('snapshot mismatch and invalid source projection fail district and PSA closed without a zero total', () => {
  const canonical = event({ id: 1, snapshot: snapshot('canonical') });
  const exactInput = exactInputFor({
    canonical: 1,
    tract: { admitted: 1, ambiguous_excluded: 0, unmapped_excluded: 0 },
    grid: { admitted: 1, unavailable_excluded: 0 },
  });
  const mismatch = streamAudit(exactInput, [{
    canonical_event: canonical,
    raw_dimensions: dimensions({ snapshotId: snapshot('different') }),
  }]);
  assert.deepEqual(mismatch.district_psa_attribution, {
    status: 'unavailable',
    reason: 'canonical-source-lineage-snapshot-mismatch',
  });
  assert.deepEqual(mismatch.strata.district, {
    status: 'unavailable',
    reason: 'canonical-source-lineage-snapshot-mismatch',
  });
  assert.equal(Object.hasOwn(mismatch.district_psa_attribution, 'total'), false);
  assert.equal(Object.hasOwn(mismatch.strata.district, 'total'), false);
  assert.equal(validateAuditSchema(mismatch), true, JSON.stringify(validateAuditSchema.errors));

  const invalid = streamAudit(exactInput, [{
    canonical_event: canonical,
    raw_dimensions: {
      ...dimensions({ snapshotId: canonical.lineage.source_snapshot_id }),
      dc_dist: {},
    },
  }]);
  assert.deepEqual(invalid.district_psa_attribution, {
    status: 'unavailable',
    reason: 'raw-dimensions-invalid',
  });
  assert.equal(Object.hasOwn(invalid.district_psa_attribution, 'total'), false);

  const numericZero = streamAudit(exactInput, [{
    canonical_event: canonical,
    raw_dimensions: {
      ...dimensions({ snapshotId: canonical.lineage.source_snapshot_id }),
      dc_dist: 0,
    },
  }]);
  assert.deepEqual(numericZero.district_psa_attribution, {
    status: 'unavailable',
    reason: 'raw-dimensions-invalid',
  });

  const untrimmed = streamAudit(exactInput, [{
    canonical_event: canonical,
    raw_dimensions: {
      ...dimensions({ snapshotId: canonical.lineage.source_snapshot_id }),
      psa: ' 1 ',
    },
  }]);
  assert.deepEqual(untrimmed.district_psa_attribution, {
    status: 'unavailable',
    reason: 'raw-dimensions-invalid',
  });
});

test('ACS population bands use canonical valueStatus and preserve thresholds and unavailable states', () => {
  const snapshotId = snapshot('acs');
  const rows = [
    event({ id: 1, snapshot: snapshotId, population: 2499 }),
    event({ id: 2, snapshot: snapshotId, population: 2500 }),
    event({ id: 3, snapshot: snapshotId, population: 4499 }),
    event({ id: 4, snapshot: snapshotId, population: 4500 }),
    event({ id: 5, snapshot: snapshotId, population: 100, acsStatus: 'partial', valueStatus: 'partial', modelInputEligible: false }),
    event({ id: 6, snapshot: snapshotId, population: 100, acsStatus: 'incompatible-vintage', valueStatus: 'available', temporal: 'outside-acs-period', modelInputEligible: false }),
    event({ id: 7, snapshot: snapshotId, population: null, acsStatus: 'unavailable', valueStatus: 'unavailable', temporal: 'unavailable', modelInputEligible: false }),
  ].map((canonicalEvent) => ({
    canonical_event: canonicalEvent,
    raw_dimensions: dimensions({ snapshotId }),
  }));
  const exactInput = exactInputFor({
    canonical: 7,
    tract: { admitted: 7, ambiguous_excluded: 0, unmapped_excluded: 0 },
    grid: { admitted: 7, unavailable_excluded: 0 },
  });
  const audit = streamAudit(exactInput, rows);

  assert.deepEqual(audit.strata.acs_population_band.values, [
    { value: 'high', count: 1 },
    { value: 'low', count: 1 },
    { value: 'medium', count: 2 },
    { value: 'unavailable', count: 3 },
  ]);
  assert.deepEqual(audit.strata.acs_temporal_compatibility.values, [
    { value: 'outside-acs-period', count: 1 },
    { value: 'unavailable', count: 1 },
    { value: 'within-acs-period', count: 5 },
  ]);
});

test('exact input and final M2 comparison reject denominator drift', () => {
  const canonicalMismatch = exactInputFor({
    canonical: 1,
    tract: { admitted: 1, ambiguous_excluded: 0, unmapped_excluded: 0 },
    grid: { admitted: 1, unavailable_excluded: 0 },
  });
  canonicalMismatch.m2.admission.canonical_rows_seen = 2;
  assert.throws(
    () => createSpatialAttributionAuditAccumulator({ exact_input: canonicalMismatch }),
    /denominators do not reconcile/i,
  );

  const exactInput = exactInputFor({
    canonical: 1,
    tract: { admitted: 1, ambiguous_excluded: 0, unmapped_excluded: 0 },
    grid: { admitted: 1, unavailable_excluded: 0 },
  });
  const accumulator = createSpatialAttributionAuditAccumulator({ exact_input: exactInput });
  const canonical = event({ id: 1, snapshot: snapshot('m2-drift'), tract: 'ambiguous' });
  addSpatialAttributionAuditRow(accumulator, {
    canonical_event: canonical,
    raw_dimensions: dimensions({ snapshotId: canonical.lineage.source_snapshot_id }),
  });
  assert.throws(
    () => finalizeSpatialAttributionAuditAccumulator(accumulator),
    /drifted from the exact M2 admission baseline/i,
  );

  const matrixInput = exactInputFor({
    canonical: 9,
    exclusions: { non_active: 1, invalid_event_time: 1, unknown_category: 1 },
    tract: { admitted: 2, ambiguous_excluded: 2, unmapped_excluded: 2 },
    grid: { admitted: 3, unavailable_excluded: 3 },
  });
  const matrixAccumulator = createSpatialAttributionAuditAccumulator({ exact_input: matrixInput });
  for (const row of primaryRows()) addSpatialAttributionAuditRow(matrixAccumulator, row);
  matrixAccumulator.counters.matrix.mapped.mapped += 1;
  assert.throws(
    () => finalizeSpatialAttributionAuditAccumulator(matrixAccumulator),
    /status matrix tract margins do not reconcile/i,
  );
});

test('schema fixes all matrix cells and each versioned stratum value domain', () => {
  const exactInput = exactInputFor({
    canonical: 9,
    exclusions: { non_active: 1, invalid_event_time: 1, unknown_category: 1 },
    tract: { admitted: 2, ambiguous_excluded: 2, unmapped_excluded: 2 },
    grid: { admitted: 3, unavailable_excluded: 3 },
  });
  const audit = streamAudit(exactInput, primaryRows());
  const duplicateCombination = structuredClone(audit);
  duplicateCombination.spatial_status_matrix.cells[0] = {
    tract_status: 'unmapped',
    grid_status: 'unavailable',
    count: 999,
  };
  assert.equal(validateAuditSchema(duplicateCombination), false);

  const hostileValues = {
    year: '2025',
    normalized_category: null,
    tract_status: 'other',
    grid_status: null,
    boundary_status: 'custom-boundary',
    acs_population_band: 'custom-band',
    acs_temporal_compatibility: 'custom-temporal',
    district: 0,
    psa: 0,
  };
  for (const [name, value] of Object.entries(hostileValues)) {
    const hostile = structuredClone(audit);
    hostile.strata[name].values[0].value = value;
    assert.equal(validateAuditSchema(hostile), false, `${name} value domain must be closed`);
  }
  const untrimmedDistrict = structuredClone(audit);
  untrimmedDistrict.strata.district.values[0].value = ' 10 ';
  assert.equal(validateAuditSchema(untrimmedDistrict), false);
});

test('zero available aggregates remain distinct from unavailable aggregates', () => {
  const audit = finalizeSpatialAttributionAuditAccumulator(
    createSpatialAttributionAuditAccumulator({ exact_input: exactInputFor({ canonical: 0 }) }),
  );
  assert.deepEqual(audit.district_psa_attribution, {
    status: 'available',
    total: 0,
    joined_events: 0,
    district_missing: 0,
    psa_missing: 0,
  });
  assert.equal(audit.strata.district.status, 'available');
  assert.equal(audit.strata.district.total, 0);
  assert.deepEqual(audit.strata.district.values, []);
  assert.equal(Object.hasOwn(audit.strata.road, 'total'), false);
  assert.equal(validateAuditSchema(audit), true, JSON.stringify(validateAuditSchema.errors));
});

test('artifact and schema reject event-level fields and serialized output contains no identifiers', () => {
  const rows = primaryRows();
  const exactInput = exactInputFor({
    canonical: 9,
    exclusions: { non_active: 1, invalid_event_time: 1, unknown_category: 1 },
    tract: { admitted: 2, ambiguous_excluded: 2, unmapped_excluded: 2 },
    grid: { admitted: 3, unavailable_excluded: 3 },
  });
  const audit = streamAudit(exactInput, rows);
  const forbidden = [
    'incidentRows',
    'incidents',
    'rows',
    'features',
    'source_record_id',
    'source_ids',
    'exactAddress',
    'location',
    'geometry',
    'coordinates',
    'lat',
    'lng',
    'raw',
  ];
  const forbiddenKey = new RegExp(`"(?:${forbidden.join('|')})"\\s*:`, 'i');
  const serialized = JSON.stringify(audit);
  assert.doesNotMatch(serialized, forbiddenKey);
  assert.doesNotMatch(serialized, /cartodb:1|SYNTHETIC BLOCK|-75\.1|39\.9/);
  for (const { canonical_event: canonicalEvent } of rows) {
    assert.doesNotMatch(serialized, new RegExp(canonicalEvent.lineage.source_snapshot_id));
  }

  for (const key of forbidden) {
    const hostile = structuredClone(audit);
    hostile[key] = [];
    assert.equal(validateAuditSchema(hostile), false, `${key} must not be schema-admitted`);

    const nested = structuredClone(audit);
    nested.strata.year[key] = [];
    assert.equal(validateAuditSchema(nested), false, `${key} must not be nested in a stratum`);

    const accumulator = createSpatialAttributionAuditAccumulator({ exact_input: exactInputFor({
      canonical: 1,
      tract: { admitted: 1, ambiguous_excluded: 0, unmapped_excluded: 0 },
      grid: { admitted: 1, unavailable_excluded: 0 },
    }) });
    const canonicalEvent = event({ id: 1, snapshot: snapshot(`hostile-${key}`) });
    assert.throws(() => addSpatialAttributionAuditRow(accumulator, {
      canonical_event: canonicalEvent,
      raw_dimensions: {
        ...dimensions({ snapshotId: canonicalEvent.lineage.source_snapshot_id }),
        [key]: [],
      },
    }), /non-whitelisted field/i);
  }

  const hostileInput = structuredClone(exactInput);
  hostileInput.m1.raw = [];
  assert.throws(
    () => createSpatialAttributionAuditAccumulator({ exact_input: hostileInput }),
    /identities are invalid/i,
  );
});

test('compatibility wrapper delegates to the streaming accumulator', () => {
  const rows = primaryRows();
  const exactInput = exactInputFor({
    canonical: 9,
    exclusions: { non_active: 1, invalid_event_time: 1, unknown_category: 1 },
    tract: { admitted: 2, ambiguous_excluded: 2, unmapped_excluded: 2 },
    grid: { admitted: 3, unavailable_excluded: 3 },
  });
  assert.deepEqual(
    buildSpatialAttributionAudit({ exact_input: exactInput, rows }),
    streamAudit(exactInput, rows),
  );
});

function streamAudit(exactInput, rows) {
  const accumulator = createSpatialAttributionAuditAccumulator({ exact_input: exactInput });
  for (const row of rows) addSpatialAttributionAuditRow(accumulator, row);
  return finalizeSpatialAttributionAuditAccumulator(accumulator);
}

function primaryRows() {
  const snapshotA = snapshot('source-a');
  const snapshotB = snapshot('source-b');
  const eligible = [
    [event({ id: 1, snapshot: snapshotA, tract: 'mapped', grid: 'mapped', population: 2499 }), dimensions({ snapshotId: snapshotA, district: '09', psa: '1' })],
    [event({ id: 2, snapshot: snapshotA, tract: 'mapped', grid: 'unavailable', population: 2500 }), dimensions({ snapshotId: snapshotA, district: null, psa: '1' })],
    [event({ id: 3, snapshot: snapshotA, tract: 'ambiguous', grid: 'mapped', population: 4499 }), dimensions({ snapshotId: snapshotA, district: '11', psa: null })],
    [event({ id: 1, snapshot: snapshotB, tract: 'ambiguous', grid: 'unavailable', population: 4500 }), dimensions({ snapshotId: snapshotB, district: '99', psa: '2' })],
    [event({ id: 4, snapshot: snapshotB, tract: 'unmapped', grid: 'mapped', population: 100, acsStatus: 'incompatible-vintage', temporal: 'outside-acs-period', modelInputEligible: false }), dimensions({ snapshotId: snapshotB, district: '10', psa: '2' })],
    [event({ id: 5, snapshot: snapshotB, tract: 'unmapped', grid: 'unavailable', population: null, acsStatus: 'unavailable', temporal: 'unavailable', modelInputEligible: false }), dimensions({ snapshotId: snapshotB, district: '10', psa: '3' })],
  ];
  const excluded = [
    [event({ id: 6, snapshot: snapshotB, lifecycle: 'superseded', eventAt: 'invalid', categoryStatus: 'unknown', theme: null }), dimensions({ snapshotId: snapshotB, district: '10', psa: '3' })],
    [event({ id: 7, snapshot: snapshotB, eventAt: 'invalid', categoryStatus: 'unknown', theme: null }), dimensions({ snapshotId: snapshotB, district: '10', psa: '3' })],
    [event({ id: 8, snapshot: snapshotB, categoryStatus: 'unknown', theme: null }), dimensions({ snapshotId: snapshotB, district: '10', psa: '3' })],
  ];
  return [...eligible, ...excluded].map(([canonicalEvent, rawDimensions]) => ({
    canonical_event: canonicalEvent,
    raw_dimensions: rawDimensions,
  }));
}

function exactInputFor({
  canonical,
  exclusions = { non_active: 0, invalid_event_time: 0, unknown_category: 0 },
  tract = { admitted: 0, ambiguous_excluded: 0, unmapped_excluded: 0 },
  grid = { admitted: 0, unavailable_excluded: 0 },
}) {
  return {
    protocol: {
      schema: 'engagement-spatial-attribution-protocol/v2',
      sha256: digest('protocol'),
    },
    m1: {
      receipt_schema: 'engagement-phl-crime-warehouse-receipt/v3',
      receipt_identity: digest('receipt-identity'),
      receipt_sha256: digest('receipt-bytes'),
      warehouse_schema: 'engagement-phl-crime-event-warehouse/v1',
      warehouse_current_snapshot_id: digest('warehouse-snapshot'),
      canonical: {
        partition_count: 1,
        row_count: canonical,
        bytes: canonical * 100,
        sha256: digest(`canonical-${canonical}`),
      },
    },
    m2: {
      mart_schema: 'engagement-area-intelligence-feature-mart/v2',
      manifest_sha256: digest('m2-manifest'),
      artifact_identity: digest('m2-artifact'),
      part_bindings_identity: digest('m2-parts'),
      part_count: canonical === 0 ? 0 : 1,
      row_count: canonical === 0 ? 0 : 7,
      bytes: canonical === 0 ? 0 : 700,
      admission: {
        canonical_rows_seen: canonical,
        tract: { ...tract },
        'fixed-grid': { ...grid },
        unknown_category: exclusions.unknown_category,
        invalid_event_time: exclusions.invalid_event_time,
        non_active: exclusions.non_active,
      },
      artifact_policy: { event_level_data_included: false },
    },
  };
}

function event({
  id,
  snapshot: snapshotId,
  year = 2025,
  eventAt = `${year}-01-01T12:00:00.000Z`,
  lifecycle = 'active',
  categoryStatus = 'mapped',
  theme = 'person',
  tract = 'mapped',
  grid = 'mapped',
  population = 1000,
  acsStatus = 'available',
  valueStatus = acsStatus === 'incompatible-vintage' ? 'available' : acsStatus,
  temporal = 'within-acs-period',
  modelInputEligible = true,
}) {
  return {
    source_record_id: `cartodb:${id}`,
    source_ids: { cartodb_id: String(id) },
    event_at: eventAt,
    lifecycle: { state: lifecycle },
    normalized_category: { status: categoryStatus, theme_id: theme },
    spatial: {
      tract: {
        status: tract,
        reason: tract === 'ambiguous'
          ? 'point-on-or-across-tract-boundary'
          : tract === 'unmapped'
            ? id % 2 === 0 ? 'point-outside-admitted-tract-geometries' : 'coordinate-missing'
            : null,
      },
      grid: { status: grid },
      coordinates: [-75.1, 39.9],
    },
    acs: {
      status: acsStatus,
      valueStatus,
      estimate: { value: population },
      temporalAlignment: temporal,
      modelInputEligible,
    },
    lineage: { source_snapshot_id: snapshotId },
    location: '100 SYNTHETIC BLOCK',
  };
}

function dimensions({ snapshotId, district = '10', psa = '1', locationBlockAvailable = true }) {
  return {
    source_snapshot_id: snapshotId,
    dc_dist: district,
    psa,
    location_block_available: locationBlockAvailable,
  };
}

function sumValues(stratum) {
  return stratum.values.reduce((sum, { count }) => sum + count, 0);
}

function snapshot(label) {
  return digest(`snapshot-${label}`);
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function reverseKeyOrder(value) {
  if (Array.isArray(value)) return value.map(reverseKeyOrder);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).reverse().map(([key, child]) => [key, reverseKeyOrder(child)]),
  );
}

function validateSchemaNode(value, schema) {
  if (schema.$ref) {
    const segments = schema.$ref.replace(/^#\//, '').split('/');
    const resolved = segments.reduce((current, segment) => current[segment], auditSchema);
    return validateSchemaNode(value, resolved);
  }
  if (schema.allOf && !schema.allOf.every((candidate) => validateSchemaNode(value, candidate))) {
    return false;
  }
  if (schema.oneOf) {
    return schema.oneOf.filter((candidate) => validateSchemaNode(value, candidate)).length === 1;
  }
  if (schema.anyOf && !schema.anyOf.some((candidate) => validateSchemaNode(value, candidate))) {
    return false;
  }
  if (Object.hasOwn(schema, 'const') && !deepEqual(value, schema.const)) return false;
  if (schema.enum && !schema.enum.some((candidate) => deepEqual(value, candidate))) return false;
  if (schema.type && !matchesType(value, schema.type)) return false;
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) return false;
    if (schema.maximum != null && value > schema.maximum) return false;
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) return false;
    if (schema.maxLength != null && value.length > schema.maxLength) return false;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) return false;
    if (schema.maxItems != null && value.length > schema.maxItems) return false;
    if (schema.uniqueItems
      && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) return false;
    if (Array.isArray(schema.items)) {
      if (value.some((item, index) => (
        index < schema.items.length
          ? !validateSchemaNode(item, schema.items[index])
          : schema.additionalItems === false
      ))) return false;
    } else if (schema.items
      && value.some((item) => !validateSchemaNode(item, schema.items))) return false;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.required?.some((key) => !Object.hasOwn(value, key))) return false;
    const known = new Set(Object.keys(schema.properties || {}));
    if (schema.additionalProperties === false
      && Object.keys(value).some((key) => !known.has(key))) return false;
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key) && !validateSchemaNode(value[key], childSchema)) return false;
    }
  }
  return true;
}

function matchesType(value, type) {
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isSafeInteger(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
