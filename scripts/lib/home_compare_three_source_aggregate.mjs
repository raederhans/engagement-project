import { createHash } from 'node:crypto';

export const HOME_COMPARE_AGGREGATE_SOURCE_RECEIPT_SCHEMA =
  'HomeCompareAggregateSourceReceipt/v1';
export const HOME_COMPARE_THREE_SOURCE_AGGREGATE_SCHEMA =
  'HomeCompareThreeSourceAggregate/v1';

const SOURCE_IDS = Object.freeze([
  'reported-incidents',
  'service-requests-311',
  'li-vacancy',
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UNIT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PRIVACY = Object.freeze({
  aggregate_only: true,
  private_addresses_persisted: false,
  source_rows_included: false,
  source_record_ids_included: false,
  coordinates_included: false,
  geometry_included: false,
});
const AUTHORITY = Object.freeze({
  completeness: false,
  property_assessment: false,
  ownership_transfer: false,
  safety: false,
  routing: false,
});

export function createHomeCompareAggregateSourceReceipt(input = {}) {
  exactKeys(input, [
    'source_id', 'status', 'observed_at', 'snapshot', 'coverage', 'join',
    'data_quality', 'aggregates', 'reason',
  ], 'Home Compare source receipt input');
  const core = normalizeSourceReceipt({
    schema: HOME_COMPARE_AGGREGATE_SOURCE_RECEIPT_SCHEMA,
    ...structuredClone(input),
    privacy: { ...PRIVACY },
  });
  return admitHomeCompareAggregateSourceReceipt({
    ...core,
    receipt_identity: identity(core),
  });
}

export function admitHomeCompareAggregateSourceReceipt(value) {
  exactKeys(value, [
    'schema', 'source_id', 'status', 'observed_at', 'snapshot', 'coverage',
    'join', 'data_quality', 'aggregates', 'reason', 'privacy', 'receipt_identity',
  ], 'Home Compare source receipt');
  const core = normalizeSourceReceipt(value);
  requireDigest(value.receipt_identity, 'receipt_identity');
  if (value.receipt_identity !== identity(core)) {
    throw new TypeError('Home Compare source receipt identity drifted.');
  }
  return deepFreeze(structuredClone(value));
}

export function buildHomeCompareThreeSourceAggregate({
  observed_at: observedAt,
  source_receipts: sourceReceipts,
} = {}) {
  timestamp(observedAt, 'observed_at');
  if (!Array.isArray(sourceReceipts) || sourceReceipts.length !== SOURCE_IDS.length) {
    throw new TypeError('Home Compare aggregate requires exactly three source receipts.');
  }
  const receipts = sourceReceipts.map(admitHomeCompareAggregateSourceReceipt)
    .sort((left, right) => SOURCE_IDS.indexOf(left.source_id) - SOURCE_IDS.indexOf(right.source_id));
  if (stable(receipts.map(({ source_id: sourceId }) => sourceId)) !== stable(SOURCE_IDS)) {
    throw new TypeError('Home Compare aggregate source inventory drifted.');
  }
  if (receipts.some(({ observed_at: receiptClock }) => receiptClock > observedAt)) {
    throw new TypeError('Home Compare aggregate cannot precede a source observation.');
  }
  const statuses = receipts.map(({ status }) => status);
  const status = statuses.every((entry) => entry === 'available')
    ? 'available'
    : statuses.every((entry) => entry === 'unavailable') ? 'unavailable' : 'partial';
  const core = {
    schema: HOME_COMPARE_THREE_SOURCE_AGGREGATE_SCHEMA,
    status,
    observed_at: observedAt,
    source_receipts: receipts.map((receipt) => ({
      source_id: receipt.source_id,
      status: receipt.status,
      receipt_identity: receipt.receipt_identity,
      snapshot_identity: receipt.snapshot.identity,
      revision_status: receipt.snapshot.revision_status,
      coverage_status: receipt.coverage.status,
      join_status: receipt.join.status,
      data_quality_status: receipt.data_quality.status,
      reason: receipt.reason,
    })),
    aggregates: Object.fromEntries(receipts.map((receipt) => [
      receipt.source_id,
      receipt.status === 'available' ? structuredClone(receipt.aggregates) : null,
    ])),
    optional_sources: {
      property_assessment: { status: 'unavailable', reason: 'No exact admitted receipt.' },
      ownership_transfer: { status: 'unavailable', reason: 'No exact admitted receipt.' },
    },
    privacy: { ...PRIVACY },
    authority: { ...AUTHORITY },
  };
  return admitHomeCompareThreeSourceAggregate({ ...core, aggregate_identity: identity(core) });
}

export function admitHomeCompareThreeSourceAggregate(value) {
  exactKeys(value, [
    'schema', 'status', 'observed_at', 'source_receipts', 'aggregates',
    'optional_sources', 'privacy', 'authority', 'aggregate_identity',
  ], 'Home Compare three-source aggregate');
  if (value.schema !== HOME_COMPARE_THREE_SOURCE_AGGREGATE_SCHEMA
    || !['available', 'partial', 'unavailable'].includes(value.status)
    || !Array.isArray(value.source_receipts)
    || value.source_receipts.length !== SOURCE_IDS.length
    || stable(value.privacy) !== stable(PRIVACY)
    || stable(value.authority) !== stable(AUTHORITY)) {
    throw new TypeError('Home Compare aggregate schema or boundary drifted.');
  }
  timestamp(value.observed_at, 'observed_at');
  exactKeys(value.aggregates, SOURCE_IDS, 'Home Compare aggregate values');
  const statuses = [];
  for (const [index, source] of value.source_receipts.entries()) {
    exactKeys(source, [
      'source_id', 'status', 'receipt_identity', 'snapshot_identity', 'revision_status',
      'coverage_status', 'join_status', 'data_quality_status', 'reason',
    ], `source_receipts[${index}]`);
    if (source.source_id !== SOURCE_IDS[index]
      || !['available', 'unavailable'].includes(source.status)
      || !['exact', 'unavailable'].includes(source.revision_status)
      || !['complete', 'unavailable'].includes(source.coverage_status)
      || !['pass', 'unavailable'].includes(source.join_status)
      || !['pass', 'unavailable'].includes(source.data_quality_status)) {
      throw new TypeError('Home Compare aggregate source summary drifted.');
    }
    requireDigest(source.receipt_identity, 'source receipt_identity');
    statuses.push(source.status);
    if (source.status === 'available') {
      requireDigest(source.snapshot_identity, 'source snapshot_identity');
      normalizeAggregates(value.aggregates[source.source_id]);
      if (source.revision_status !== 'exact' || source.coverage_status !== 'complete'
        || source.join_status !== 'pass' || source.data_quality_status !== 'pass') {
        throw new TypeError('Available Home Compare source lacks exact lineage, coverage, join, or DQ.');
      }
    } else if (source.snapshot_identity !== null
      || value.aggregates[source.source_id] !== null
      || ![source.revision_status, source.coverage_status, source.join_status,
        source.data_quality_status].every((entry) => entry === 'unavailable')) {
      throw new TypeError('Unavailable Home Compare source contains inferred identity or aggregate values.');
    }
  }
  const expectedStatus = statuses.every((entry) => entry === 'available')
    ? 'available'
    : statuses.every((entry) => entry === 'unavailable') ? 'unavailable' : 'partial';
  if (value.status !== expectedStatus) throw new TypeError('Home Compare aggregate status drifted.');
  exactKeys(value.optional_sources, ['property_assessment', 'ownership_transfer'], 'optional sources');
  for (const source of Object.values(value.optional_sources)) {
    exactKeys(source, ['status', 'reason'], 'optional source');
    if (source.status !== 'unavailable' || !nonempty(source.reason)) {
      throw new TypeError('Optional Home Compare source must remain unavailable without a receipt.');
    }
  }
  const copy = structuredClone(value);
  delete copy.aggregate_identity;
  requireDigest(value.aggregate_identity, 'aggregate_identity');
  if (value.aggregate_identity !== identity(copy)) {
    throw new TypeError('Home Compare aggregate identity drifted.');
  }
  rejectPrivateKeys(value);
  return deepFreeze(structuredClone(value));
}

function normalizeSourceReceipt(value) {
  if (value.schema !== HOME_COMPARE_AGGREGATE_SOURCE_RECEIPT_SCHEMA
    || !SOURCE_IDS.includes(value.source_id)
    || !['available', 'unavailable'].includes(value.status)) {
    throw new TypeError('Home Compare source receipt schema, source, or status is invalid.');
  }
  timestamp(value.observed_at, 'observed_at');
  if (stable(value.privacy) !== stable(PRIVACY)) {
    throw new TypeError('Home Compare source privacy boundary drifted.');
  }
  normalizeSnapshot(value.snapshot, value.status);
  normalizeCoverage(value.coverage, value.status);
  normalizeJoin(value.join, value.status);
  normalizeDataQuality(value.data_quality, value.status);
  if (!nonempty(value.reason)) throw new TypeError('Home Compare source reason is required.');
  if (value.status === 'available') normalizeAggregates(value.aggregates);
  else if (value.aggregates !== null) {
    throw new TypeError('Unavailable Home Compare source cannot contain aggregate values.');
  }
  return {
    schema: HOME_COMPARE_AGGREGATE_SOURCE_RECEIPT_SCHEMA,
    source_id: value.source_id,
    status: value.status,
    observed_at: value.observed_at,
    snapshot: structuredClone(value.snapshot),
    coverage: structuredClone(value.coverage),
    join: structuredClone(value.join),
    data_quality: structuredClone(value.data_quality),
    aggregates: structuredClone(value.aggregates),
    reason: value.reason,
    privacy: { ...PRIVACY },
  };
}

function normalizeSnapshot(value, status) {
  exactKeys(value, ['identity', 'payload_sha256', 'revision_id', 'revision_status'], 'snapshot');
  if (status === 'available') {
    requireDigest(value.identity, 'snapshot.identity');
    requireDigest(value.payload_sha256, 'snapshot.payload_sha256');
    if (!nonempty(value.revision_id) || value.revision_status !== 'exact') {
      throw new TypeError('Available Home Compare snapshot requires an exact revision.');
    }
  } else if (value.identity !== null || value.payload_sha256 !== null
    || value.revision_id !== null || value.revision_status !== 'unavailable') {
    throw new TypeError('Unavailable Home Compare snapshot must not infer identity or revision.');
  }
}

function normalizeCoverage(value, status) {
  exactKeys(value, [
    'status', 'start', 'end_exclusive', 'geography', 'row_count', 'completeness_admitted',
  ], 'coverage');
  if (value.geography !== 'philadelphia') throw new TypeError('Coverage geography drifted.');
  if (status === 'available') {
    if (value.status !== 'complete' || value.completeness_admitted !== true
      || !DATE.test(value.start || '') || !DATE.test(value.end_exclusive || '')
      || value.start >= value.end_exclusive
      || !Number.isSafeInteger(value.row_count) || value.row_count < 0) {
      throw new TypeError('Available Home Compare source lacks complete exact coverage.');
    }
  } else if (value.status !== 'unavailable' || value.start !== null
    || value.end_exclusive !== null || value.row_count !== null
    || value.completeness_admitted !== false) {
    throw new TypeError('Unavailable Home Compare coverage must remain unknown.');
  }
}

function normalizeJoin(value, status) {
  exactKeys(value, [
    'status', 'geography_level', 'matched_rows', 'unmatched_rows', 'coverage_rate',
  ], 'join');
  if (value.geography_level !== 'tract-neighborhood') {
    throw new TypeError('Home Compare join must be aggregate tract/neighborhood only.');
  }
  if (status === 'available') {
    if (value.status !== 'pass'
      || !Number.isSafeInteger(value.matched_rows) || value.matched_rows < 0
      || !Number.isSafeInteger(value.unmatched_rows) || value.unmatched_rows < 0
      || !Number.isFinite(value.coverage_rate) || value.coverage_rate < 0
      || value.coverage_rate > 1) {
      throw new TypeError('Available Home Compare join evidence is invalid.');
    }
  } else if (value.status !== 'unavailable' || value.matched_rows !== null
    || value.unmatched_rows !== null || value.coverage_rate !== null) {
    throw new TypeError('Unavailable Home Compare join must not infer coverage.');
  }
}

function normalizeDataQuality(value, status) {
  exactKeys(value, ['status', 'checks'], 'data quality');
  if (!Array.isArray(value.checks)) throw new TypeError('Data-quality checks must be an array.');
  if (status === 'available') {
    if (value.status !== 'pass' || value.checks.length < 1
      || value.checks.some((check) => !nonempty(check))) {
      throw new TypeError('Available Home Compare source requires passing DQ checks.');
    }
  } else if (value.status !== 'unavailable' || value.checks.length !== 0) {
    throw new TypeError('Unavailable Home Compare source cannot claim DQ checks.');
  }
}

function normalizeAggregates(value) {
  exactKeys(value, ['tracts', 'neighborhoods'], 'aggregates');
  for (const [label, rows] of Object.entries(value)) {
    if (!Array.isArray(rows)) throw new TypeError(`${label} aggregates must be an array.`);
    const units = new Set();
    for (const row of rows) {
      exactKeys(row, ['unit_id', 'count'], `${label} aggregate row`);
      if (!UNIT_ID.test(row.unit_id || '') || units.has(row.unit_id)
        || !Number.isSafeInteger(row.count) || row.count < 0) {
        throw new TypeError(`${label} aggregate row is invalid or duplicated.`);
      }
      units.add(row.unit_id);
    }
  }
  return value;
}

function rejectPrivateKeys(value) {
  const prohibited = /(^|_)(address|coordinate|latitude|longitude|geometry|source_record_id|event_id)(_|$)/i;
  const visit = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    for (const [key, child] of Object.entries(entry)) {
      if (prohibited.test(key)) throw new TypeError(`Private Home Compare key is forbidden: ${key}.`);
      visit(child);
    }
  };
  visit(value.aggregates);
}

function identity(value) {
  return `sha256:${createHash('sha256').update(stable(value)).digest('hex')}`;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || stable(Object.keys(value).sort()) !== stable([...keys].sort())) {
    throw new TypeError(`${label} keys drifted.`);
  }
}

function timestamp(value, label) {
  if (!CLOCK.test(value || '') || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} must be an exact UTC timestamp.`);
  }
  return value;
}

function requireDigest(value, label) {
  if (!SHA256.test(value || '')) throw new TypeError(`${label} must be a SHA-256 identity.`);
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
