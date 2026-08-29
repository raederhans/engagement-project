import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

export const KNOWN_ROUTE_CRASH_ACCESSIBILITY_EVIDENCE_SCHEMA =
  'KnownRouteCrashAccessibilityEvidence/v1';
export const KNOWN_ROUTE_CRASH_ACCESSIBILITY_INPUT_SCHEMA =
  'KnownRouteCrashAccessibilityEvidenceInput/v1';

const SOURCE_ROLES = Object.freeze([
  'raw-crash',
  'accessibility',
  'hin-historical-planning',
]);
const REQUIRED_SOURCE_ROLES = Object.freeze(['raw-crash', 'accessibility']);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const ROUTE_IDENTITY = /^route:[a-f0-9]{16}$/;
const CORRIDOR_IDENTITY = /^known-route-corridor:[a-f0-9]{16}$/;
const CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const AUTHORITY = Object.freeze({
  raw_crash: false,
  accessibility: false,
  routing: false,
  safety: false,
});
const PRIVACY = Object.freeze({
  mode: 'aggregate-only',
  aggregate_only: true,
  event_rows_included: false,
  source_rows_included: false,
  event_ids_included: false,
  source_record_ids_included: false,
  coordinates_included: false,
  geometry_included: false,
  addresses_included: false,
});

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;
const evidenceSchema = JSON.parse(await fs.readFile(
  new URL('../data/known_route_crash_accessibility_evidence.schema.json', import.meta.url),
  'utf8',
));
const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
ajv.addSchema(evidenceSchema);
const validateEvidenceSchema = ajv.getSchema(evidenceSchema.$id);
const validateReceiptSchema = ajv.compile({
  $ref: `${evidenceSchema.$id}#/$defs/sourceReceipt`,
});

/**
 * Construct a receipt wrapper whose identity binds the source schema/version,
 * exact payload SHA, clocks, coverage, precision, and route/corridor identity.
 * The wrapper never contains source rows or row identifiers.
 */
export function createKnownRouteSourceReceipt(value = {}) {
  const receipt = structuredClone(value);
  delete receipt.semantic_identity;
  const candidate = {
    ...receipt,
    semantic_identity: identityOf(receipt),
  };
  return validateKnownRouteSourceReceipt(candidate);
}

export function validateKnownRouteSourceReceipt(value) {
  validateReceiptStructure(value);
  if (!validateReceiptSchema(value)) {
    throw new Error('Known Route source receipt schema validation failed.');
  }
  if (!SOURCE_ROLES.includes(value.role)) {
    throw new Error('Known Route source receipt role is unsupported.');
  }
  if (value.semantic_identity !== receiptIdentity(value)) {
    throw new Error('Known Route source receipt semantic identity drifted.');
  }
  validateClocks(value.clocks, value.status);
  validateCoverage(value.coverage, value.clocks.observed_at);
  if (value.status === 'exact') {
    if (value.coverage.status !== 'complete' || !value.coverage.verified
      || value.precision.status !== 'exact'
      || !Number.isSafeInteger(value.aggregate?.count) || value.aggregate.count < 0) {
      throw new Error('Exact Known Route source receipt lacks complete verified exact coverage.');
    }
  } else if (Object.hasOwn(value, 'aggregate')) {
    throw new Error('Partial or unavailable Known Route source receipt must omit aggregate.');
  }
  if (value.role === 'hin-historical-planning') {
    if (value.schema !== 'phl-hin-2025-receipt/v1'
      && value.schema !== 'phl-hin-2025-receipt-v1') {
      throw new Error('HIN historical context must bind the admitted HIN receipt schema.');
    }
    if (value.status !== 'partial' || value.coverage.status !== 'partial'
      || value.precision.status !== 'generalized'
      || !/historical planning context/i.test(value.reason)) {
      throw new Error('HIN receipt is partial historical planning context only.');
    }
  }
  return deepFreeze(structuredClone(value));
}

export function buildKnownRouteCrashAccessibilityEvidence({
  schema = KNOWN_ROUTE_CRASH_ACCESSIBILITY_INPUT_SCHEMA,
  route_identity: routeIdentity,
  corridor_identity: corridorIdentity,
  source_receipts: sourceReceipts,
} = {}) {
  if (schema !== KNOWN_ROUTE_CRASH_ACCESSIBILITY_INPUT_SCHEMA) {
    throw new Error('Known Route crash/accessibility input schema is unsupported.');
  }
  if (!ROUTE_IDENTITY.test(routeIdentity || '')
    || !CORRIDOR_IDENTITY.test(corridorIdentity || '')) {
    throw new Error('Known Route route and corridor semantic identities are required.');
  }
  if (!Array.isArray(sourceReceipts)) {
    throw new Error('Known Route source_receipts must be an array.');
  }

  const receipts = sourceReceipts.map(validateKnownRouteSourceReceipt);
  const roles = new Set();
  const identities = new Set();
  for (const receipt of receipts) {
    if (roles.has(receipt.role)) {
      throw new Error(`Duplicate Known Route source receipt role: ${receipt.role}.`);
    }
    if (identities.has(receipt.semantic_identity)) {
      throw new Error('Duplicate Known Route source receipt semantic identity.');
    }
    roles.add(receipt.role);
    identities.add(receipt.semantic_identity);
    if (receipt.route_identity !== routeIdentity
      || receipt.corridor_identity !== corridorIdentity) {
      throw new Error('Known Route source receipt route or corridor identity drifted.');
    }
  }
  for (const role of REQUIRED_SOURCE_ROLES) {
    if (!roles.has(role)) throw new Error(`Missing Known Route source receipt role: ${role}.`);
  }
  if (receipts.length !== roles.size || receipts.length < 2 || receipts.length > 3) {
    throw new Error('Known Route source receipt inventory is invalid.');
  }

  receipts.sort(compareReceipts);
  const rawCrash = receipts.find(({ role }) => role === 'raw-crash');
  const accessibilityReceipt = receipts.find(({ role }) => role === 'accessibility');
  const crash = dimensionFromReceipt(rawCrash);
  const accessibility = dimensionFromReceipt(accessibilityReceipt);
  const evidence = {
    schema: KNOWN_ROUTE_CRASH_ACCESSIBILITY_EVIDENCE_SCHEMA,
    status: combinedStatus(crash.status, accessibility.status),
    route_identity: routeIdentity,
    corridor_identity: corridorIdentity,
    source_receipts: receipts.map((receipt) => structuredClone(receipt)),
    crash,
    accessibility,
    authority: { ...AUTHORITY },
    privacy: { ...PRIVACY },
  };
  return validateKnownRouteCrashAccessibilityEvidence({
    ...evidence,
    semantic_identity: identityOf(evidence),
  });
}

export function validateKnownRouteCrashAccessibilityEvidence(value) {
  validateEvidenceStructure(value);
  if (!validateEvidenceSchema(value)) {
    throw new Error('Known Route crash/accessibility evidence schema validation failed.');
  }
  if (value.schema !== KNOWN_ROUTE_CRASH_ACCESSIBILITY_EVIDENCE_SCHEMA
    || stable(value.authority) !== stable(AUTHORITY)
    || stable(value.privacy) !== stable(PRIVACY)) {
    throw new Error('Known Route crash/accessibility authority or privacy boundary drifted.');
  }

  const roles = new Set();
  const identities = new Set();
  for (const [index, source] of value.source_receipts.entries()) {
    const receipt = validateKnownRouteSourceReceipt(source);
    if (roles.has(receipt.role) || identities.has(receipt.semantic_identity)) {
      throw new Error('Known Route evidence contains duplicate source receipts.');
    }
    roles.add(receipt.role);
    identities.add(receipt.semantic_identity);
    if (receipt.route_identity !== value.route_identity
      || receipt.corridor_identity !== value.corridor_identity) {
      throw new Error('Known Route evidence source binding drifted.');
    }
    if (index > 0 && compareReceipts(value.source_receipts[index - 1], receipt) >= 0) {
      throw new Error('Known Route source receipt ordering drifted.');
    }
  }
  for (const role of REQUIRED_SOURCE_ROLES) {
    if (!roles.has(role)) throw new Error(`Known Route evidence is missing ${role}.`);
  }

  const rawCrash = value.source_receipts.find(({ role }) => role === 'raw-crash');
  const accessibilityReceipt = value.source_receipts.find(({ role }) => role === 'accessibility');
  const expectedCrash = dimensionFromReceipt(rawCrash);
  const expectedAccessibility = dimensionFromReceipt(accessibilityReceipt);
  if (stable(value.crash) !== stable(expectedCrash)
    || stable(value.accessibility) !== stable(expectedAccessibility)) {
    throw new Error('Known Route crash/accessibility status, coverage, precision, or aggregate drifted.');
  }
  if (value.status !== combinedStatus(value.crash.status, value.accessibility.status)) {
    throw new Error('Known Route crash/accessibility top-level status drifted.');
  }

  const copy = structuredClone(value);
  delete copy.semantic_identity;
  if (value.semantic_identity !== identityOf(copy)) {
    throw new Error('Known Route crash/accessibility semantic identity drifted.');
  }
  rejectPrivatePayloadKeys(value);
  return deepFreeze(structuredClone(value));
}

/**
 * Formal A/B/C seam: a consumer may admit a Mode Legality Quality (B) or
 * segment-report binding only when its existing route and deterministic
 * centerline-corridor identities are byte-for-byte equal to A.
 */
export function assertKnownRouteCrashAccessibilityCrossBinding(value, counterpart) {
  const evidence = validateKnownRouteCrashAccessibilityEvidence(value);
  if (!counterpart || typeof counterpart !== 'object' || Array.isArray(counterpart)
    || !ROUTE_IDENTITY.test(counterpart.route_identity || '')
    || !CORRIDOR_IDENTITY.test(counterpart.corridor_identity || '')) {
    throw new Error('Known Route counterpart route/corridor binding is invalid.');
  }
  if (counterpart.route_identity !== evidence.route_identity
    || counterpart.corridor_identity !== evidence.corridor_identity) {
    throw new Error('Known Route A/B route or deterministic centerline corridor identity mismatch.');
  }
  return evidence;
}

export function serializeKnownRouteCrashAccessibilityEvidence(value) {
  return `${JSON.stringify(validateKnownRouteCrashAccessibilityEvidence(value), null, 2)}\n`;
}

export async function loadKnownRouteCrashAccessibilityInput(
  inputPath,
  expectedSha256,
  { fileSystem = fs } = {},
) {
  if (!SHA256.test(expectedSha256 || '')) {
    throw new Error('Expected Known Route input SHA-256 is required.');
  }
  const bytes = await fileSystem.readFile(path.resolve(inputPath));
  if (hash(bytes) !== expectedSha256) {
    throw new Error('Known Route input file SHA-256 mismatch.');
  }
  let value;
  try {
    value = JSON.parse(bytes);
  } catch {
    throw new Error('Known Route input is not strict JSON.');
  }
  exactKeys(value, ['schema', 'route_identity', 'corridor_identity', 'source_receipts'], 'input');
  const evidence = buildKnownRouteCrashAccessibilityEvidence(value);
  return deepFreeze({ evidence, input_sha256: expectedSha256, input_bytes: bytes.length });
}

export async function writeKnownRouteCrashAccessibilityEvidence(
  outputPath,
  evidence,
  {
    workspace = process.cwd(),
    fileSystem = fs,
    beforeLink,
  } = {},
) {
  const target = resolveOwnedOutput(outputPath, workspace);
  const content = Buffer.from(serializeKnownRouteCrashAccessibilityEvidence(evidence));
  try {
    const current = await fileSystem.readFile(target);
    if (current.equals(content)) {
      return deepFreeze({ status: 'idempotent', output_path: target, bytes: current.length });
    }
    throw new Error('Known Route evidence output exists with different bytes; refusing overwrite.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await fileSystem.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}-${randomUUID()}.tmp`;
  let result;
  let primaryError;
  try {
    await fileSystem.writeFile(temporary, content, { flag: 'wx' });
    if (beforeLink) await beforeLink({ temporary, target, content });
    try {
      await fileSystem.link(temporary, target);
      result = deepFreeze({ status: 'published', output_path: target, bytes: content.length });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const current = await fileSystem.readFile(target);
      if (!current.equals(content)) {
        throw new Error('Known Route evidence output exists with different bytes; refusing overwrite.');
      }
      result = deepFreeze({ status: 'idempotent', output_path: target, bytes: current.length });
    }
  } catch (error) {
    primaryError = error;
  }

  let cleanupError;
  try {
    await fileSystem.rm(temporary, { force: true });
  } catch (error) {
    cleanupError = error;
  }
  if (primaryError && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      'Known Route evidence publication and staging cleanup both failed.',
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupError) {
    throw new AggregateError([cleanupError], 'Known Route evidence staging cleanup failed.');
  }
  return result;
}

function dimensionFromReceipt(receipt) {
  if (receipt.status === 'exact') {
    return {
      status: receipt.aggregate.count === 0 ? 'admitted-zero' : 'available',
      reason: receipt.reason,
      coverage: structuredClone(receipt.coverage),
      precision: structuredClone(receipt.precision),
      aggregate: structuredClone(receipt.aggregate),
    };
  }
  return {
    status: receipt.status,
    reason: receipt.reason,
    coverage: structuredClone(receipt.coverage),
    precision: structuredClone(receipt.precision),
  };
}

function combinedStatus(crashStatus, accessibilityStatus) {
  return crashStatus === accessibilityStatus ? crashStatus : 'partial';
}

function validateClocks(clocks, status) {
  for (const [key, value] of Object.entries(clocks)) {
    if (value !== null && (!CLOCK.test(value) || new Date(value).toISOString() !== value)) {
      throw new Error(`Known Route source receipt ${key} clock is invalid.`);
    }
  }
  if (status === 'exact'
    && Object.values(clocks).some((value) => value === null)) {
    throw new Error('Exact Known Route source receipt requires all four clocks.');
  }
  const observed = Date.parse(clocks.observed_at);
  for (const key of ['source_as_of', 'retrieved_at', 'built_at']) {
    if (clocks[key] !== null && Date.parse(clocks[key]) > observed) {
      throw new Error('Known Route source receipt clock is later than observed_at.');
    }
  }
  if (clocks.source_as_of !== null && clocks.retrieved_at !== null
    && Date.parse(clocks.source_as_of) > Date.parse(clocks.retrieved_at)) {
    throw new Error('Known Route source_as_of is later than retrieved_at.');
  }
  if (clocks.retrieved_at !== null && clocks.built_at !== null
    && Date.parse(clocks.retrieved_at) > Date.parse(clocks.built_at)) {
    throw new Error('Known Route retrieved_at is later than built_at.');
  }
}

function validateCoverage(coverage, observedAt) {
  if (coverage.status === 'complete' || coverage.status === 'partial') {
    if ((coverage.start === null) !== (coverage.end_exclusive === null)) {
      throw new Error('Known Route coverage clocks must be both present or both absent.');
    }
    if (coverage.start !== null) {
      if (!validTimestamp(coverage.start) || !validTimestamp(coverage.end_exclusive)
        || Date.parse(coverage.start) >= Date.parse(coverage.end_exclusive)
        || Date.parse(coverage.end_exclusive) > Date.parse(observedAt)) {
        throw new Error('Known Route source receipt coverage interval is invalid.');
      }
    } else if (coverage.status === 'complete') {
      throw new Error('Complete Known Route coverage requires an exact interval.');
    }
  }
}

function receiptIdentity(receipt) {
  const copy = structuredClone(receipt);
  delete copy.semantic_identity;
  return identityOf(copy);
}

function compareReceipts(left, right) {
  const roleDifference = SOURCE_ROLES.indexOf(left.role) - SOURCE_ROLES.indexOf(right.role);
  return roleDifference || left.semantic_identity.localeCompare(right.semantic_identity);
}

function resolveOwnedOutput(outputPath, workspace) {
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('Known Route evidence output path is required.');
  }
  const root = path.resolve(workspace);
  const target = path.resolve(root, outputPath);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Known Route evidence output must remain inside the caller-owned workspace.');
  }
  return target;
}

function rejectPrivatePayloadKeys(value) {
  const serialized = JSON.stringify(value);
  if (/(?:"event_id"|"event_ids"|"source_id"|"source_ids"|"source_record_id"|"source_record_ids"|"coordinates"|"coordinate"|"geometry"|"address"|"addresses"|"latitude"|"longitude"|"lat"|"lng"|"rows"|"events")\s*:/i.test(serialized)) {
    throw new Error('Known Route evidence violates the aggregate-only privacy contract.');
  }
}

function validateEvidenceStructure(value) {
  exactKeys(value, [
    'schema', 'semantic_identity', 'status', 'route_identity', 'corridor_identity',
    'source_receipts', 'crash', 'accessibility', 'authority', 'privacy',
  ], 'evidence');
  if (value.schema !== KNOWN_ROUTE_CRASH_ACCESSIBILITY_EVIDENCE_SCHEMA
    || !SHA256.test(value.semantic_identity || '')
    || !['available', 'admitted-zero', 'partial', 'unavailable'].includes(value.status)
    || !ROUTE_IDENTITY.test(value.route_identity || '')
    || !CORRIDOR_IDENTITY.test(value.corridor_identity || '')
    || !Array.isArray(value.source_receipts)
    || value.source_receipts.length < 2 || value.source_receipts.length > 3) {
    throw new Error('Known Route crash/accessibility evidence schema validation failed.');
  }
  validateDimensionStructure(value.crash, 'crash');
  validateDimensionStructure(value.accessibility, 'accessibility');
  exactKeys(value.authority, ['raw_crash', 'accessibility', 'routing', 'safety'], 'authority');
  exactKeys(value.privacy, [
    'mode', 'aggregate_only', 'event_rows_included', 'source_rows_included',
    'event_ids_included', 'source_record_ids_included', 'coordinates_included',
    'geometry_included', 'addresses_included',
  ], 'privacy');
}

function validateReceiptStructure(value) {
  const base = [
    'schema', 'role', 'semantic_identity', 'sha256', 'version', 'status', 'reason',
    'route_identity', 'corridor_identity', 'clocks', 'coverage', 'precision',
  ];
  const exact = value?.status === 'exact';
  exactKeys(value, exact ? [...base, 'aggregate'] : base, 'source receipt');
  if (!/^[A-Za-z0-9._-]+\/v[1-9][0-9]*$/.test(value.schema || '')
    || !SOURCE_ROLES.includes(value.role)
    || !SHA256.test(value.semantic_identity || '') || !SHA256.test(value.sha256 || '')
    || typeof value.version !== 'string' || value.version.length < 1 || value.version.length > 160
    || !['exact', 'partial', 'unavailable'].includes(value.status)
    || typeof value.reason !== 'string' || value.reason.length < 1 || value.reason.length > 500
    || !ROUTE_IDENTITY.test(value.route_identity || '')
    || !CORRIDOR_IDENTITY.test(value.corridor_identity || '')) {
    throw new Error('Known Route source receipt schema validation failed.');
  }
  exactKeys(value.clocks, ['source_as_of', 'retrieved_at', 'built_at', 'observed_at'], 'source receipt clocks');
  exactKeys(value.coverage, ['status', 'scope', 'start', 'end_exclusive', 'verified'], 'source receipt coverage');
  exactKeys(value.precision, ['status', 'unit'], 'source receipt precision');
  if (value.coverage.scope !== 'bound-route-corridor') {
    throw new Error('Known Route source receipt coverage scope is invalid.');
  }
  if (value.status === 'exact') {
    exactKeys(value.aggregate, ['count'], 'source receipt aggregate');
    if (value.role === 'hin-historical-planning'
      || value.coverage.status !== 'complete' || value.coverage.verified !== true
      || value.precision.status !== 'exact' || value.precision.unit !== 'bound-route-corridor'
      || !Number.isSafeInteger(value.aggregate.count) || value.aggregate.count < 0) {
      throw new Error('Exact Known Route source receipt schema validation failed.');
    }
  } else if (value.status === 'partial') {
    if (value.coverage.status !== 'partial' || value.coverage.verified !== false
      || value.precision.status !== 'generalized'
      || typeof value.precision.unit !== 'string' || value.precision.unit.length < 1) {
      throw new Error('Partial Known Route source receipt schema validation failed.');
    }
  } else if (value.role === 'hin-historical-planning'
    || value.coverage.status !== 'unavailable' || value.coverage.verified !== false
    || value.coverage.start !== null || value.coverage.end_exclusive !== null
    || value.precision.status !== 'unavailable' || value.precision.unit !== null) {
    throw new Error('Unavailable Known Route source receipt schema validation failed.');
  }
}

function validateDimensionStructure(value, label) {
  const exact = value?.status === 'available' || value?.status === 'admitted-zero';
  exactKeys(value, exact
    ? ['status', 'reason', 'coverage', 'precision', 'aggregate']
    : ['status', 'reason', 'coverage', 'precision'], `${label} dimension`);
  if (!['available', 'admitted-zero', 'partial', 'unavailable'].includes(value.status)
    || typeof value.reason !== 'string' || value.reason.length < 1 || value.reason.length > 500) {
    throw new Error(`Known Route ${label} dimension schema validation failed.`);
  }
  exactKeys(value.coverage, ['status', 'scope', 'start', 'end_exclusive', 'verified'], `${label} coverage`);
  exactKeys(value.precision, ['status', 'unit'], `${label} precision`);
  if (value.coverage.scope !== 'bound-route-corridor') {
    throw new Error(`Known Route ${label} coverage scope is invalid.`);
  }
  if (exact) {
    exactKeys(value.aggregate, ['count'], `${label} aggregate`);
    if (value.coverage.status !== 'complete' || value.coverage.verified !== true
      || value.precision.status !== 'exact' || value.precision.unit !== 'bound-route-corridor'
      || !Number.isSafeInteger(value.aggregate.count)
      || (value.status === 'admitted-zero' && value.aggregate.count !== 0)
      || (value.status === 'available' && value.aggregate.count < 1)) {
      throw new Error(`Known Route ${label} exact evidence boundary is invalid.`);
    }
  } else if (value.status === 'partial') {
    if (value.coverage.status !== 'partial' || value.coverage.verified !== false
      || value.precision.status !== 'generalized'
      || typeof value.precision.unit !== 'string' || value.precision.unit.length < 1) {
      throw new Error(`Known Route ${label} partial evidence boundary is invalid.`);
    }
  } else if (value.coverage.status !== 'unavailable' || value.coverage.verified !== false
    || value.coverage.start !== null || value.coverage.end_exclusive !== null
    || value.precision.status !== 'unavailable' || value.precision.unit !== null) {
    throw new Error(`Known Route ${label} unavailable evidence boundary is invalid.`);
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || stable(Object.keys(value).sort()) !== stable([...keys].sort())) {
    throw new Error(`Known Route ${label} contains unknown or missing fields.`);
  }
}

function validTimestamp(value) {
  return typeof value === 'string' && CLOCK.test(value)
    && new Date(value).toISOString() === value;
}

function identityOf(value) {
  return hash(Buffer.from(stable(value)));
}

function hash(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stable(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
