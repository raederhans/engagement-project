import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { validateTractCrimeSnapshot } from './tract_crime_snapshot.mjs';

export const TRACT_CRIME_RECEIPT_SCHEMA = 'engagement-tract-crime-source-health-receipt/v1';
export const TRACT_CRIME_RECEIPT_MAX_BYTES = 12_000;
export const TRACT_SOURCE_REGISTRY_SCHEMA = 'engagement-tract-crime-source-registry/v1';
export const TRACT_CRIME_BUNDLED_RECEIPT_EXPORT = 'TRACT_CRIME_BUNDLED_RECEIPT';

const REQUIRED_SOURCE_IDS = Object.freeze([
  'philadelphia-reported-crime',
  'census-tract-boundaries',
  'tract-crime-snapshot',
]);
const ALLOWED_CLAIMS = Object.freeze([
  'reported incidents',
  'historical evidence',
  'modeled exposure',
]);
const FORBIDDEN_CLAIMS = Object.freeze([
  'absolute safety',
  'victim probability',
  'safest route',
]);
const RECEIPT_KEYS = new Set([
  'schema', 'source', 'clocks', 'artifact', 'coverage', 'freshness', 'failClosed',
]);
const SOURCE_KEYS = new Set([
  'sourceId', 'upstreamSourceIds', 'dataSemantics', 'sourceUrl', 'tractSource',
]);
const CLOCK_KEYS = new Set(['sourceAsOf', 'retrievedAt', 'builtAt', 'observedAt']);
const ARTIFACT_KEYS = new Set([
  'schemaVersion', 'version', 'identity', 'canonicalization', 'canonicalBytes', 'recordCount',
]);
const COVERAGE_KEYS = new Set(['geography', 'temporalStart', 'temporalEnd']);
const FRESHNESS_KEYS = new Set(['clock', 'staleAfterDays', 'statusIfMissing']);
const FAIL_CLOSED_KEYS = new Set([
  'status', 'recordCount', 'unavailableIsZero', 'unknownIsCurrent', 'partialIsCurrent',
  'staleIsCurrent',
]);

export function validateTractSourceRegistry(value) {
  if (!isPlainObject(value) || value.registry_schema !== TRACT_SOURCE_REGISTRY_SCHEMA) {
    throw new Error('Tract source registry schema is unsupported.');
  }
  if (value.schema_version !== 1 || !Array.isArray(value.sources)) {
    throw new Error('Tract source registry must preserve the v1 tract audit contract and sources array.');
  }
  if (!isPlainObject(value.claim_vocabulary)
    || JSON.stringify(value.claim_vocabulary.allowed) !== JSON.stringify(ALLOWED_CLAIMS)
    || JSON.stringify(value.claim_vocabulary.forbidden) !== JSON.stringify(FORBIDDEN_CLAIMS)) {
    throw new Error('Tract source registry claim vocabulary drifted.');
  }
  const sourceById = new Map();
  for (const source of value.sources) {
    if (!isPlainObject(source) || typeof source.id !== 'string' || sourceById.has(source.id)) {
      throw new Error('Tract source registry source ids must be non-empty and unique.');
    }
    for (const [field, maximum] of [
      ['role', 120], ['data_semantics', 500], ['canonical_url', 2048],
    ]) boundedText(source[field], `source ${source.id} ${field}`, maximum);
    exactHttpsUrl(source.canonical_url, `source ${source.id} canonical_url`);
    validateLicense(source.license, source.id);
    validateClockSemantics(source.retrieval, source.id, 'retrieval');
    validateClockSemantics(source.build, source.id, 'build');
    validateFreshness(source.freshness, source.id);
    validateFailClosed(source.fail_closed, source.id);
    sourceById.set(source.id, source);
  }
  if (JSON.stringify([...sourceById.keys()].sort()) !== JSON.stringify([...REQUIRED_SOURCE_IDS].sort())) {
    throw new Error('Tract source registry must contain the exact M0 source set.');
  }
  const derived = sourceById.get('tract-crime-snapshot');
  if (derived.retrieval.clock !== 'receipt.clocks.retrievedAt'
    || derived.build.clock !== 'snapshot.meta.generated_at'
    || derived.freshness.clock !== 'receipt.clocks.sourceAsOf'
    || derived.freshness.stale_after_days !== 7
    || derived.freshness.status_if_missing !== 'unavailable'
    || derived.fail_closed.status !== 'unavailable'
    || derived.fail_closed.record_count !== null) {
    throw new Error('Derived tract snapshot lifecycle policy drifted.');
  }
  return structuredClone(value);
}

export function renderTractCrimeSnapshot(snapshot, tracts) {
  validateTractCrimeSnapshot(snapshot, tracts);
  const text = `${JSON.stringify(snapshot)}\n`;
  return Object.freeze({ text, bytes: Buffer.byteLength(text) });
}

export function tractCrimeSnapshotIdentity(snapshot, tracts) {
  const { text, bytes } = renderTractCrimeSnapshot(snapshot, tracts);
  return Object.freeze({
    identity: `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`,
    bytes,
  });
}

export function createTractCrimeReceipt({
  snapshot,
  tracts,
  retrievedAt = null,
  registry,
} = {}) {
  const admittedRegistry = validateTractSourceRegistry(registry);
  validateTractCrimeSnapshot(snapshot, tracts);
  nullableTimestamp(retrievedAt, 'retrievedAt');
  const builtAt = exactTimestamp(snapshot.meta.generated_at, 'snapshot generated_at');
  if (retrievedAt && Date.parse(retrievedAt) > Date.parse(builtAt)) {
    throw new Error('Tract crime retrieval clock must not be later than the build clock.');
  }
  const sourceAsOf = exactDate(snapshot.meta.coverage_date, 'snapshot coverage_date');
  if (sourceAsOf > builtAt.slice(0, 10)) {
    throw new Error('Tract crime source clock must not be later than the build date.');
  }
  const derived = admittedRegistry.sources.find(({ id }) => id === 'tract-crime-snapshot');
  const { identity, bytes } = tractCrimeSnapshotIdentity(snapshot, tracts);
  const receipt = {
    schema: TRACT_CRIME_RECEIPT_SCHEMA,
    source: {
      sourceId: derived.id,
      upstreamSourceIds: [
        'philadelphia-reported-crime',
        'census-tract-boundaries',
      ],
      dataSemantics: derived.data_semantics,
      sourceUrl: snapshot.meta.source_url,
      tractSource: snapshot.meta.tract_source,
    },
    clocks: {
      sourceAsOf,
      retrievedAt,
      builtAt,
      observedAt: null,
    },
    artifact: {
      schemaVersion: snapshot.meta.schema_version,
      version: `tract crime snapshot schema v${snapshot.meta.schema_version}`,
      identity,
      canonicalization: 'canonical compact JSON with LF terminator',
      canonicalBytes: bytes,
      recordCount: snapshot.meta.row_count,
    },
    coverage: {
      geography: derived.coverage.geography,
      temporalStart: snapshot.meta.start,
      temporalEnd: snapshot.meta.end,
    },
    freshness: {
      clock: derived.freshness.clock,
      staleAfterDays: derived.freshness.stale_after_days,
      statusIfMissing: derived.freshness.status_if_missing,
    },
    failClosed: {
      status: derived.fail_closed.status,
      recordCount: derived.fail_closed.record_count,
      unavailableIsZero: false,
      unknownIsCurrent: false,
      partialIsCurrent: false,
      staleIsCurrent: false,
    },
  };
  return validateTractCrimeReceipt(receipt, { snapshot, tracts, registry: admittedRegistry });
}

export function validateTractCrimeReceipt(receipt, { snapshot, tracts, registry } = {}) {
  const admittedRegistry = validateTractSourceRegistry(registry);
  validateTractCrimeSnapshot(snapshot, tracts);
  exactObject(receipt, RECEIPT_KEYS, 'tract crime receipt');
  exactObject(receipt.source, SOURCE_KEYS, 'tract crime receipt source');
  exactObject(receipt.clocks, CLOCK_KEYS, 'tract crime receipt clocks');
  exactObject(receipt.artifact, ARTIFACT_KEYS, 'tract crime receipt artifact');
  exactObject(receipt.coverage, COVERAGE_KEYS, 'tract crime receipt coverage');
  exactObject(receipt.freshness, FRESHNESS_KEYS, 'tract crime receipt freshness');
  exactObject(receipt.failClosed, FAIL_CLOSED_KEYS, 'tract crime receipt failClosed');
  if (receipt.schema !== TRACT_CRIME_RECEIPT_SCHEMA) {
    throw new Error('Tract crime receipt schema is unsupported.');
  }

  const derived = admittedRegistry.sources.find(({ id }) => id === 'tract-crime-snapshot');
  if (receipt.source.sourceId !== derived.id
    || JSON.stringify(receipt.source.upstreamSourceIds) !== JSON.stringify([
      'philadelphia-reported-crime', 'census-tract-boundaries',
    ])
    || receipt.source.dataSemantics !== derived.data_semantics
    || receipt.source.sourceUrl !== snapshot.meta.source_url
    || receipt.source.tractSource !== snapshot.meta.tract_source) {
    throw new Error('Tract crime receipt source contract drifted.');
  }

  exactDate(receipt.clocks.sourceAsOf, 'receipt sourceAsOf');
  nullableTimestamp(receipt.clocks.retrievedAt, 'receipt retrievedAt');
  exactTimestamp(receipt.clocks.builtAt, 'receipt builtAt');
  if (receipt.clocks.observedAt !== null) {
    throw new Error('Committed tract crime receipt must not invent an observation clock.');
  }
  if (receipt.clocks.sourceAsOf !== snapshot.meta.coverage_date
    || receipt.clocks.builtAt !== snapshot.meta.generated_at
    || (receipt.clocks.retrievedAt
      && Date.parse(receipt.clocks.retrievedAt) > Date.parse(receipt.clocks.builtAt))) {
    throw new Error('Tract crime receipt clock semantics drifted.');
  }

  const expectedIdentity = tractCrimeSnapshotIdentity(snapshot, tracts);
  if (receipt.artifact.schemaVersion !== snapshot.meta.schema_version
    || receipt.artifact.version !== `tract crime snapshot schema v${snapshot.meta.schema_version}`
    || receipt.artifact.identity !== expectedIdentity.identity
    || receipt.artifact.canonicalization !== 'canonical compact JSON with LF terminator'
    || receipt.artifact.canonicalBytes !== expectedIdentity.bytes
    || receipt.artifact.recordCount !== snapshot.meta.row_count) {
    throw new Error('Tract crime receipt does not identify the supplied snapshot.');
  }
  if (receipt.coverage.geography !== derived.coverage.geography
    || receipt.coverage.temporalStart !== snapshot.meta.start
    || receipt.coverage.temporalEnd !== snapshot.meta.end) {
    throw new Error('Tract crime receipt coverage drifted.');
  }
  if (receipt.freshness.clock !== derived.freshness.clock
    || receipt.freshness.staleAfterDays !== derived.freshness.stale_after_days
    || receipt.freshness.statusIfMissing !== derived.freshness.status_if_missing) {
    throw new Error('Tract crime receipt freshness policy drifted.');
  }
  if (receipt.failClosed.status !== derived.fail_closed.status
    || receipt.failClosed.recordCount !== null
    || receipt.failClosed.unavailableIsZero !== false
    || receipt.failClosed.unknownIsCurrent !== false
    || receipt.failClosed.partialIsCurrent !== false
    || receipt.failClosed.staleIsCurrent !== false) {
    throw new Error('Tract crime receipt fail-closed policy drifted.');
  }
  return structuredClone(receipt);
}

export function compareTractCrimeSemanticSnapshots(current, candidate, tracts) {
  validateTractCrimeSnapshot(current, tracts);
  validateTractCrimeSnapshot(candidate, tracts);
  return semanticSnapshotText(current) === semanticSnapshotText(candidate);
}

export function renderTractCrimeReceipt(receipt, options = {}) {
  const admitted = validateTractCrimeReceipt(receipt, options);
  const text = `${JSON.stringify(admitted)}\n`;
  const bytes = Buffer.byteLength(text);
  if (bytes > TRACT_CRIME_RECEIPT_MAX_BYTES) {
    throw new Error(`Tract crime receipt exceeds ${TRACT_CRIME_RECEIPT_MAX_BYTES} bytes: ${bytes}.`);
  }
  return Object.freeze({ text, bytes });
}

export function createTractCrimeBundledReceipt(receipt, options = {}) {
  const admitted = validateTractCrimeReceipt(receipt, options);
  return Object.freeze({
    sourceId: admitted.source.sourceId,
    sourceAsOf: admitted.clocks.sourceAsOf,
    retrievedAt: admitted.clocks.retrievedAt,
    builtAt: admitted.clocks.builtAt,
    version: admitted.artifact.version,
    identity: admitted.artifact.identity,
    recordCount: admitted.artifact.recordCount,
    temporalStart: admitted.coverage.temporalStart,
    temporalEnd: admitted.coverage.temporalEnd,
  });
}

export function renderTractCrimeBundledReceiptModule(receipt, options = {}) {
  const bundledReceipt = createTractCrimeBundledReceipt(receipt, options);
  const text = `// Generated by scripts/precompute_tract_crime.mjs; do not edit by hand.\nexport const ${TRACT_CRIME_BUNDLED_RECEIPT_EXPORT} = Object.freeze(${JSON.stringify(bundledReceipt)});\n`;
  return Object.freeze({ text, bytes: Buffer.byteLength(text) });
}

export function validateTractCrimeBundledReceiptModule(text, receipt, options = {}) {
  if (typeof text !== 'string') throw new Error('Bundled tract crime receipt module must be text.');
  const expected = renderTractCrimeBundledReceiptModule(receipt, options).text;
  if (text.replace(/\r\n/g, '\n') !== expected) {
    throw new Error('Bundled tract crime receipt module does not match the validated receipt.');
  }
  return createTractCrimeBundledReceipt(receipt, options);
}

export async function writeTractCrimeLifecycleAtomic({
  snapshotDestination,
  receiptDestination,
  bundledReceiptDestination,
  snapshot,
  receipt,
  tracts,
  registry,
  fileSystem = fs,
} = {}) {
  const snapshotArtifact = renderTractCrimeSnapshot(snapshot, tracts);
  const receiptArtifact = renderTractCrimeReceipt(receipt, { snapshot, tracts, registry });
  const bundledReceiptArtifact = renderTractCrimeBundledReceiptModule(
    receipt,
    { snapshot, tracts, registry },
  );
  const artifacts = [
    { label: 'snapshot', destination: path.resolve(snapshotDestination), ...snapshotArtifact },
    { label: 'receipt', destination: path.resolve(receiptDestination), ...receiptArtifact },
    {
      label: 'bundledReceipt',
      destination: path.resolve(bundledReceiptDestination),
      ...bundledReceiptArtifact,
    },
  ];
  const roots = new Set(artifacts.map(({ destination }) => path.parse(destination).root));
  const destinations = new Set(artifacts.map(({ destination }) => destination));
  if (roots.size !== 1 || destinations.size !== artifacts.length) {
    throw new Error('Tract crime lifecycle artifacts must be distinct files on one filesystem root.');
  }
  const token = `${process.pid}-${Date.now()}`;
  for (const artifact of artifacts) {
    const directory = path.dirname(artifact.destination);
    artifact.temporary = path.join(
      directory,
      `.${path.basename(artifact.destination)}.${token}.tmp`,
    );
    artifact.backup = path.join(
      directory,
      `.${path.basename(artifact.destination)}.${token}.bak`,
    );
    artifact.exists = await fileExists(artifact.destination, fileSystem);
    artifact.backedUp = false;
    artifact.installed = false;
  }
  if (new Set(artifacts.map(({ exists }) => exists)).size !== 1) {
    throw new Error('Existing tract crime lifecycle is incomplete; refusing partial replacement.');
  }
  const replacing = artifacts[0].exists;
  await Promise.all(artifacts.map(({ destination }) => (
    fileSystem.mkdir(path.dirname(destination), { recursive: true })
  )));
  try {
    await Promise.all(artifacts.map(({ temporary, text }) => (
      fileSystem.writeFile(temporary, text, 'utf8')
    )));
    if (replacing) {
      for (const artifact of artifacts) {
        await fileSystem.rename(artifact.destination, artifact.backup);
        artifact.backedUp = true;
      }
    }
    for (const artifact of artifacts) {
      await fileSystem.rename(artifact.temporary, artifact.destination);
      artifact.installed = true;
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const artifact of [...artifacts].reverse()) {
      if (!artifact.installed) continue;
      await safely(
        () => fileSystem.rm(artifact.destination, { force: true }),
        rollbackErrors,
      );
    }
    for (const artifact of [...artifacts].reverse()) {
      if (!artifact.backedUp) continue;
      await safely(async () => {
        await fileSystem.rename(artifact.backup, artifact.destination);
        artifact.backedUp = false;
      }, rollbackErrors);
    }
    if (rollbackErrors.length) {
      throw new AggregateError([error, ...rollbackErrors], 'Tract crime lifecycle publish and rollback failed.');
    }
    throw error;
  } finally {
    await Promise.all(artifacts.flatMap(({ temporary, backup, backedUp }) => [
      fileSystem.rm(temporary, { force: true }).catch(() => {}),
      ...(!backedUp ? [fileSystem.rm(backup, { force: true }).catch(() => {})] : []),
    ]));
  }
  const cleanupErrors = [];
  for (const artifact of artifacts) {
    if (!artifact.backedUp) continue;
    try {
      await fileSystem.rm(artifact.backup, { force: true });
      artifact.backedUp = false;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, 'Tract crime lifecycle published but backup cleanup failed.');
  }
  return Object.freeze(Object.fromEntries(artifacts.map(({ label, destination, bytes }) => [
    label,
    Object.freeze({ destination, bytes }),
  ])));
}

function semanticSnapshotText(snapshot) {
  const value = structuredClone(snapshot);
  delete value.meta.generated_at;
  return JSON.stringify(value);
}

function validateLicense(value, sourceId) {
  if (!isPlainObject(value)) throw new Error(`Source ${sourceId} license must be an object.`);
  boundedText(value.label, `source ${sourceId} license label`, 240);
  exactHttpsUrl(value.terms_url, `source ${sourceId} license terms_url`);
}

function validateClockSemantics(value, sourceId, label) {
  if (!isPlainObject(value)) throw new Error(`Source ${sourceId} ${label} must be an object.`);
  boundedText(value.mode, `source ${sourceId} ${label} mode`, 160);
  if (value.clock !== null) boundedText(value.clock, `source ${sourceId} ${label} clock`, 160);
  boundedText(value.meaning, `source ${sourceId} ${label} meaning`, 500);
}

function validateFreshness(value, sourceId) {
  if (!isPlainObject(value)) throw new Error(`Source ${sourceId} freshness must be an object.`);
  if (value.clock !== null) boundedText(value.clock, `source ${sourceId} freshness clock`, 160);
  if (value.stale_after_days !== null
    && (!Number.isInteger(value.stale_after_days) || value.stale_after_days < 1)) {
    throw new Error(`Source ${sourceId} freshness stale_after_days is invalid.`);
  }
  if (!['unknown', 'unavailable'].includes(value.status_if_missing)) {
    throw new Error(`Source ${sourceId} freshness missing-clock state must fail closed.`);
  }
}

function validateFailClosed(value, sourceId) {
  if (!isPlainObject(value) || !['unknown', 'unavailable'].includes(value.status)
    || value.record_count !== null) {
    throw new Error(`Source ${sourceId} fail-closed state must retain null record_count.`);
  }
  boundedText(value.reason, `source ${sourceId} fail-closed reason`, 500);
}

function exactObject(value, keys, label) {
  if (!isPlainObject(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} schema is invalid.`);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function boundedText(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`${label} must be bounded non-empty text.`);
  }
  return value;
}

function exactHttpsUrl(value, label) {
  boundedText(value, label, 2048);
  if (new URL(value).protocol !== 'https:') throw new Error(`${label} must use HTTPS.`);
}

function exactDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`Tract crime ${label} must be an exact calendar date.`);
  }
  return value;
}

function exactTimestamp(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw new Error(`Tract crime ${label} must be an exact ISO timestamp.`);
  }
  return value;
}

function nullableTimestamp(value, label) {
  return value === null ? null : exactTimestamp(value, label);
}

async function fileExists(file, fileSystem) {
  try {
    await fileSystem.access(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function safely(action, errors) {
  try {
    await action();
  } catch (error) {
    errors.push(error);
  }
}
