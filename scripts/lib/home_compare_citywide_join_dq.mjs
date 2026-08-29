import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { assertTaskOwnedDfev1Path } from './dfev1_path.mjs';
import { validateHomeCompareCitywideSourceLifecycle } from './home_compare_citywide_source_lifecycle.mjs';

export const HOME_COMPARE_CITYWIDE_JOIN_DQ_SCHEMA = 'engagement-home-compare-citywide-join-dq/v1';
export const HOME_COMPARE_CITYWIDE_LIFECYCLE_SCHEMA = 'engagement-home-compare-citywide-source-lifecycle/v1';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const AUTHORITY = Object.freeze({
  product_authority: false, publication_authority: false, redistribution_authority: false,
  safety_authority: false, routing_authority: false,
});
const PRIVACY = Object.freeze({
  aggregate_only: true, address_included: false, coordinates_included: false,
  parcel_join_authority: false, source_rows_included: false,
});
const DIMENSIONS = Object.freeze([
  ['geocoder_address_resolution', 'citygeo-address-locator'],
  ['property_current_assessment', 'opa-current-property'],
  ['assessment_history', 'opa-assessment-history'],
  ['transfers', 'real-estate-transfers'],
  ['requests_311', 'philly311-requests'],
  ['li_property_history', 'li-property-history'],
  ['vacancy', 'vacant-property-indicators'],
  ['reported_incidents', 'philadelphia-reported-crime'],
  ['hin_road_context', 'vision-zero-hin-2025'],
]);

export async function loadHomeCompareCitywideJoinDqInput({
  lifecyclePath, expectedLifecycleIdentity, expectedLifecycleSha256,
  lifecycleValidator = validateHomeCompareCitywideSourceLifecycle,
} = {}) {
  requireExpectedSha(expectedLifecycleIdentity, 'expected lifecycle identity');
  requireExpectedSha(expectedLifecycleSha256, 'expected lifecycle exact file SHA-256');
  if (typeof lifecyclePath !== 'string' || !lifecyclePath.trim()) {
    throw new Error('Citywide lifecycle path is required.');
  }
  const bytes = await fs.readFile(path.resolve(lifecyclePath));
  const sha256 = sha256Of(bytes);
  if (sha256 !== expectedLifecycleSha256) {
    throw new Error('Citywide lifecycle does not match the explicitly expected exact file SHA-256.');
  }
  let raw;
  try { raw = JSON.parse(bytes.toString('utf8')); } catch (error) {
    throw new Error(`Citywide lifecycle is not strict JSON: ${error.message}`);
  }
  const lifecycle = lifecycleValidator(raw);
  if (lifecycle.schema !== HOME_COMPARE_CITYWIDE_LIFECYCLE_SCHEMA
    || lifecycle.identity !== expectedLifecycleIdentity) {
    throw new Error('Citywide lifecycle does not match the explicitly expected lifecycle identity.');
  }
  return Object.freeze({ lifecycle, sha256, bytes: bytes.length });
}

export function buildHomeCompareCitywideJoinDq({ lifecycle, sha256, bytes } = {}) {
  requireExpectedSha(sha256, 'lifecycle exact file SHA-256');
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('Lifecycle byte count is invalid.');
  const admitted = validateHomeCompareCitywideSourceLifecycle(lifecycle);
  const dimensions = DIMENSIONS.map(([dimension, sourceId], ordinal) => {
    const receipt = admitted.receipts.find((candidate) => candidate.source_id === sourceId);
    if (!receipt) throw new Error(`Citywide lifecycle is missing required source receipt: ${sourceId}.`);
    const sourceReadiness = readinessOf(receipt);
    const reason = reasonOf(dimension, receipt, sourceReadiness);
    const evidence = {
      dimension, ordinal,
      required_source_receipt_identities: [receipt.receipt_identity],
      source_readiness: sourceReadiness,
      join_status: sourceReadiness === 'unavailable' ? 'unavailable' : 'not-admitted',
      admission_status: sourceReadiness === 'unavailable' ? 'unavailable' : 'not-admitted',
      reason,
      row_availability: 'unavailable', value_availability: 'unavailable', total: null,
      available_zero: false,
    };
    return Object.freeze({ ...evidence, identity: identityOf(evidence) });
  });
  const evidence = {
    schema: HOME_COMPARE_CITYWIDE_JOIN_DQ_SCHEMA,
    input: {
      schema: HOME_COMPARE_CITYWIDE_LIFECYCLE_SCHEMA,
      lifecycle_identity: admitted.identity,
      sha256,
      bytes,
    },
    status: dimensions.every(({ source_readiness: status }) => status === 'unavailable')
      ? 'unavailable' : 'partial',
    dimensions,
    privacy: { ...PRIVACY }, authority: { ...AUTHORITY },
    limitations: [
      'Aggregate lifecycle metadata is not an exact source payload, private address resolution, or parcel join authority.',
      'No bounded metadata row count establishes address-level zero, join coverage, or completeness.',
      'Reported incidents reuse only exact M1 receipt readiness; they do not admit event rows or address joins.',
      'Legacy partial HIN context is not raw crash data, current safety evidence, scoring, ranking, routing, travel-time, or isochrone authority.',
    ],
  };
  return validateHomeCompareCitywideJoinDq({ ...evidence, identity: identityOf(evidence) });
}

export function validateHomeCompareCitywideJoinDq(value) {
  exactObject(value, ['schema', 'input', 'status', 'dimensions', 'privacy', 'authority', 'limitations', 'identity'], 'citywide join DQ');
  if (value.schema !== HOME_COMPARE_CITYWIDE_JOIN_DQ_SCHEMA || !['partial', 'unavailable'].includes(value.status)
    || !Array.isArray(value.dimensions) || value.dimensions.length !== DIMENSIONS.length
    || !Array.isArray(value.limitations) || value.limitations.length !== 4 || !SHA256.test(value.identity || '')) {
    throw new Error('Citywide join DQ schema contract is invalid.');
  }
  exactObject(value.input, ['schema', 'lifecycle_identity', 'sha256', 'bytes'], 'citywide join DQ input');
  if (value.input.schema !== HOME_COMPARE_CITYWIDE_LIFECYCLE_SCHEMA
    || !SHA256.test(value.input.lifecycle_identity || '') || !SHA256.test(value.input.sha256 || '')
    || !positiveInteger(value.input.bytes)) throw new Error('Citywide join DQ input identity is invalid.');
  if (stableStringify(value.authority) !== stableStringify(AUTHORITY)
    || stableStringify(value.privacy) !== stableStringify(PRIVACY)) {
    throw new Error('Citywide join DQ authority or privacy boundary drifted.');
  }
  if (new Set(value.dimensions.map(({ identity }) => identity)).size !== value.dimensions.length) {
    throw new Error('Each citywide join DQ dimension requires an independent identity.');
  }
  for (const [ordinal, dimension] of value.dimensions.entries()) {
    const [expectedName] = DIMENSIONS[ordinal];
    exactObject(dimension, ['dimension', 'ordinal', 'required_source_receipt_identities', 'source_readiness', 'join_status', 'admission_status', 'reason', 'row_availability', 'value_availability', 'total', 'available_zero', 'identity'], `dimension ${ordinal}`);
    if (dimension.dimension !== expectedName || dimension.ordinal !== ordinal
      || !Array.isArray(dimension.required_source_receipt_identities) || dimension.required_source_receipt_identities.length !== 1
      || !SHA256.test(dimension.required_source_receipt_identities[0] || '') || !SHA256.test(dimension.identity || '')
      || !['exact-receipt-ready', 'partial', 'unavailable'].includes(dimension.source_readiness)
      || !['not-admitted', 'partial', 'unavailable'].includes(dimension.join_status)
      || !['not-admitted', 'partial', 'unavailable'].includes(dimension.admission_status)
      || typeof dimension.reason !== 'string' || !dimension.reason.trim()) throw new Error(`Dimension contract is invalid: ${expectedName}.`);
    const evidence = structuredClone(dimension);
    delete evidence.identity;
    if (dimension.identity !== identityOf(evidence)) throw new Error(`Dimension identity drifted: ${dimension.dimension}.`);
    if (dimension.total !== null || dimension.available_zero !== false
      || dimension.row_availability !== 'unavailable' || dimension.value_availability !== 'unavailable') {
      throw new Error(`Dimension ${dimension.dimension} conflates unavailable joins with values or zero.`);
    }
    if (dimension.source_readiness === 'unavailable'
      && (dimension.join_status !== 'unavailable' || dimension.admission_status !== 'unavailable')) {
      throw new Error(`Unavailable source readiness must fail closed: ${dimension.dimension}.`);
    }
  }
  const evidence = structuredClone(value);
  delete evidence.identity;
  if (value.identity !== identityOf(evidence)) throw new Error('Citywide join DQ identity drifted.');
  assertNoPrivateOrDecisionFields(value);
  return Object.freeze(structuredClone(value));
}

export async function writeHomeCompareCitywideJoinDq(outputPath, ledger, {
  workspace = process.cwd(),
  fileSystem = fs,
} = {}) {
  const target = await assertTaskOwnedDfev1Path(outputPath, {
    workspace, label: 'Home Compare citywide join DQ output',
  });
  const admitted = validateHomeCompareCitywideJoinDq(ledger);
  const text = `${JSON.stringify(admitted, null, 2)}\n`;
  const content = Buffer.from(text);
  try {
    const existing = await fileSystem.readFile(target);
    if (existing.equals(content)) return Object.freeze({ status: 'idempotent', outputPath: target, bytes: existing.length });
    throw new Error('Home Compare citywide join DQ output already exists with different bytes; refusing overwrite.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await fileSystem.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}-${randomUUID()}.tmp`;
  let result;
  try {
    await fileSystem.writeFile(temporary, content, { flag: 'wx' });
    try {
      await fileSystem.link(temporary, target);
      result = Object.freeze({ status: 'published', outputPath: target, bytes: content.length });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await fileSystem.readFile(target);
      if (!existing.equals(content)) {
        throw new Error('Home Compare citywide join DQ output already exists with different bytes; refusing overwrite.');
      }
      result = Object.freeze({ status: 'idempotent', outputPath: target, bytes: existing.length });
    }
  } finally {
    await fileSystem.rm(temporary, { force: true });
  }
  return result;
}

function readinessOf(receipt) {
  if (receipt.status === 'unavailable') return 'unavailable';
  if (receipt.source_id === 'philadelphia-reported-crime'
    && receipt.coverage.exact_payload && receipt.coverage.completeness_admitted) return 'exact-receipt-ready';
  return 'partial';
}

function reasonOf(dimension, receipt, readiness) {
  if (readiness === 'unavailable') return 'Required source receipt is unavailable; no join, rows, values, or zero claim is admitted.';
  if (dimension === 'hin_road_context') return 'Legacy partial HIN receipt is road context only; no raw crash, current safety, private join, or routing authority is admitted.';
  if (dimension === 'reported_incidents') return 'Exact M1 receipt readiness is reused, but no event payload, private address join key, coverage, or parcel authority is admitted.';
  return 'No exact payload, private address or parcel join authority, exact join key, coverage, or completeness is admitted.';
}

function assertNoPrivateOrDecisionFields(value) {
  const forbidden = new Set(['address', 'normalized_address', 'coordinates', 'coordinate', 'latitude', 'longitude', 'parcel', 'parcel_id', 'source_id', 'source_rows', 'score', 'safety_score', 'rank', 'winner', 'victim_probability', 'route', 'routing', 'travel_time', 'isochrone']);
  walk(value, (key) => {
    if (forbidden.has(key)) throw new Error(`Citywide join DQ contains forbidden private or decision field: ${key}.`);
  });
}

function walk(value, visit) {
  if (Array.isArray(value)) return value.forEach((item) => walk(item, visit));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) { visit(key); walk(child, visit); }
}

function requireExpectedSha(value, label) {
  if (!SHA256.test(value || '')) throw new Error(`${label} must be sha256:<64 lowercase hex>.`);
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  if (stableStringify(Object.keys(value).sort()) !== stableStringify([...keys].sort())) {
    throw new Error(`${label} contains unknown or missing fields.`);
  }
}

function positiveInteger(value) { return Number.isSafeInteger(value) && value > 0; }

function sha256Of(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function identityOf(value) { return sha256Of(Buffer.from(stableStringify(value))); }

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Undefined values cannot participate in identity.');
  return serialized;
}
