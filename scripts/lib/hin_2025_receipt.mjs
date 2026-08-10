import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  HIN_2025_CRASH_DATA_PERIOD,
  HIN_2025_EXPECTED_FIELDS,
  HIN_2025_EXPECTED_GEOMETRY_COUNTS,
  HIN_2025_ITEM_ID,
  HIN_2025_ITEM_URL,
  HIN_2025_LAYER_ID,
  HIN_2025_LAYER_URL,
  HIN_2025_NETWORK_VINTAGE,
  HIN_2025_TIME_SEMANTICS_URL,
  renderHin2025Snapshot,
  validateHin2025Snapshot,
} from './hin_2025_snapshot.mjs';

export const HIN_2025_RECEIPT_SCHEMA = 'phl-hin-2025-receipt-v1';
export const HIN_2025_RECEIPT_MAX_BYTES = 12_000;
export const HIN_2025_SOURCE_ID = 'hin-2025';

const RECEIPT_KEYS = new Set(['schema', 'source', 'artifact', 'review']);
const SOURCE_KEYS = new Set([
  'sourceId', 'itemId', 'itemUrl', 'itemType', 'layerId', 'layerUrl', 'layerName',
  'geometryType', 'fields', 'sourceAsOf', 'sourceAsOfMeaning', 'crashDataPeriod',
  'networkVintage', 'officialContext',
]);
const ARTIFACT_KEYS = new Set([
  'schema', 'identity', 'bytes', 'retrievedAt', 'builtAt', 'buildClockStatus',
  'featureCount', 'geometryTypes', 'geometryCounts', 'coordinatePrecision',
]);
const REVIEW_KEYS = new Set(['status', 'reviewedAt', 'reviewedBy', 'note']);
const REVIEW_STATUSES = new Set(['legacy-admitted', 'admitted-after-review']);

export function snapshotIdentity(snapshot) {
  const { text, bytes } = renderHin2025Snapshot(snapshot);
  const digest = createHash('sha256').update(text, 'utf8').digest('hex');
  return Object.freeze({ identity: `sha256:${digest}`, bytes });
}

export function createHin2025Receipt({
  snapshot,
  builtAt = null,
  review = {},
} = {}) {
  validateHin2025Snapshot(snapshot);
  const { identity, bytes } = snapshotIdentity(snapshot);
  const status = review.status || 'legacy-admitted';
  const receipt = {
    schema: HIN_2025_RECEIPT_SCHEMA,
    source: {
      sourceId: HIN_2025_SOURCE_ID,
      itemId: HIN_2025_ITEM_ID,
      itemUrl: HIN_2025_ITEM_URL,
      itemType: 'Feature Service',
      layerId: HIN_2025_LAYER_ID,
      layerUrl: HIN_2025_LAYER_URL,
      layerName: 'high_injury_network_2025',
      geometryType: 'esriGeometryPolyline',
      fields: HIN_2025_EXPECTED_FIELDS.map(([name, type]) => ({ name, type })),
      sourceAsOf: snapshot.meta.layerDataEditedAt,
      sourceAsOfMeaning: 'ArcGIS layer dataLastEditDate; not the crash-data period, retrieval, build, or observation time.',
      crashDataPeriod: [...HIN_2025_CRASH_DATA_PERIOD],
      networkVintage: HIN_2025_NETWORK_VINTAGE,
      officialContext: HIN_2025_TIME_SEMANTICS_URL,
    },
    artifact: {
      schema: snapshot.schema,
      identity,
      bytes,
      retrievedAt: snapshot.meta.retrievedAt,
      builtAt,
      buildClockStatus: builtAt === null ? 'not-recorded-in-legacy-snapshot' : 'recorded-at-admitted-build',
      featureCount: snapshot.meta.featureCount,
      geometryTypes: Object.keys(snapshot.meta.geometryCounts).sort(),
      geometryCounts: { ...snapshot.meta.geometryCounts },
      coordinatePrecision: snapshot.meta.coordinatePrecision,
    },
    review: {
      status,
      reviewedAt: review.reviewedAt ?? null,
      reviewedBy: review.reviewedBy ?? null,
      note: review.note || (status === 'legacy-admitted'
        ? 'Snapshot admitted by the Batch 7 contract; a distinct lifecycle review clock was not recorded.'
        : 'Upstream change reviewed and admitted before the local artifact was replaced.'),
    },
  };
  return validateHin2025Receipt(receipt, { snapshot });
}

export function validateHin2025Receipt(receipt, { snapshot } = {}) {
  exactObject(receipt, RECEIPT_KEYS, 'HIN 2025 receipt');
  exactObject(receipt.source, SOURCE_KEYS, 'HIN 2025 receipt source');
  exactObject(receipt.artifact, ARTIFACT_KEYS, 'HIN 2025 receipt artifact');
  exactObject(receipt.review, REVIEW_KEYS, 'HIN 2025 receipt review');
  if (receipt.schema !== HIN_2025_RECEIPT_SCHEMA) throw new Error('HIN 2025 receipt schema is unsupported.');

  const source = receipt.source;
  if (source.sourceId !== HIN_2025_SOURCE_ID
    || source.itemId !== HIN_2025_ITEM_ID
    || source.itemUrl !== HIN_2025_ITEM_URL
    || source.itemType !== 'Feature Service'
    || source.layerId !== HIN_2025_LAYER_ID
    || source.layerUrl !== HIN_2025_LAYER_URL
    || source.layerName !== 'high_injury_network_2025'
    || source.geometryType !== 'esriGeometryPolyline'
    || JSON.stringify(source.fields) !== JSON.stringify(HIN_2025_EXPECTED_FIELDS.map(([name, type]) => ({ name, type })))
    || JSON.stringify(source.crashDataPeriod) !== JSON.stringify(HIN_2025_CRASH_DATA_PERIOD)
    || source.networkVintage !== HIN_2025_NETWORK_VINTAGE
    || source.officialContext !== HIN_2025_TIME_SEMANTICS_URL
    || !/not the crash-data period, retrieval, build, or observation time/i.test(source.sourceAsOfMeaning || '')) {
    throw new Error('HIN 2025 receipt source contract drifted.');
  }
  exactTimestamp(source.sourceAsOf, 'receipt sourceAsOf');

  const artifact = receipt.artifact;
  if (artifact.schema !== 'phl-hin-2025-v1'
    || !/^sha256:[0-9a-f]{64}$/.test(artifact.identity || '')
    || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0
    || artifact.featureCount !== 162
    || JSON.stringify(artifact.geometryTypes) !== JSON.stringify(['LineString', 'MultiLineString'])
    || JSON.stringify(artifact.geometryCounts) !== JSON.stringify(HIN_2025_EXPECTED_GEOMETRY_COUNTS)
    || artifact.coordinatePrecision !== 6) {
    throw new Error('HIN 2025 receipt artifact contract drifted.');
  }
  exactTimestamp(artifact.retrievedAt, 'receipt retrievedAt');
  nullableTimestamp(artifact.builtAt, 'receipt builtAt');
  const expectedBuildStatus = artifact.builtAt === null
    ? 'not-recorded-in-legacy-snapshot' : 'recorded-at-admitted-build';
  if (artifact.buildClockStatus !== expectedBuildStatus) {
    throw new Error('HIN 2025 receipt build-clock semantics are invalid.');
  }

  const review = receipt.review;
  if (!REVIEW_STATUSES.has(review.status) || typeof review.note !== 'string' || !review.note.trim()) {
    throw new Error('HIN 2025 receipt review disposition is invalid.');
  }
  nullableTimestamp(review.reviewedAt, 'receipt reviewedAt');
  if (review.reviewedBy !== null && (typeof review.reviewedBy !== 'string' || !review.reviewedBy.trim())) {
    throw new Error('HIN 2025 receipt reviewedBy is invalid.');
  }
  if (review.status === 'admitted-after-review'
    && (!review.reviewedAt || !review.reviewedBy || !artifact.builtAt)) {
    throw new Error('HIN 2025 reviewed replacement requires reviewer, review time, and build time.');
  }
  if (review.status === 'legacy-admitted'
    && (review.reviewedAt !== null || review.reviewedBy !== null || artifact.builtAt !== null)) {
    throw new Error('HIN 2025 legacy receipt must not invent review or build clocks.');
  }

  if (snapshot) {
    validateHin2025Snapshot(snapshot);
    const expected = snapshotIdentity(snapshot);
    if (artifact.identity !== expected.identity || artifact.bytes !== expected.bytes
      || artifact.schema !== snapshot.schema
      || artifact.retrievedAt !== snapshot.meta.retrievedAt
      || artifact.featureCount !== snapshot.meta.featureCount
      || JSON.stringify(artifact.geometryCounts) !== JSON.stringify(snapshot.meta.geometryCounts)
      || artifact.coordinatePrecision !== snapshot.meta.coordinatePrecision
      || source.sourceAsOf !== snapshot.meta.layerDataEditedAt
      || JSON.stringify(source.crashDataPeriod) !== JSON.stringify(snapshot.meta.crashDataPeriod)
      || source.networkVintage !== snapshot.meta.networkVintage) {
      throw new Error('HIN 2025 receipt does not identify the supplied snapshot.');
    }
  }
  return Object.freeze(structuredClone(receipt));
}

export function compareHin2025SemanticSnapshots(current, candidate) {
  validateHin2025Snapshot(current);
  validateHin2025Snapshot(candidate);
  const reasons = [];
  if (current.schema !== candidate.schema) reasons.push('snapshot-schema');
  if (JSON.stringify(current.meta.crashDataPeriod) !== JSON.stringify(candidate.meta.crashDataPeriod)
    || current.meta.networkVintage !== candidate.meta.networkVintage) reasons.push('time-semantics');
  if (current.meta.layerDataEditedAt !== candidate.meta.layerDataEditedAt) reasons.push('layer-data-edit');
  if (current.meta.layerSchemaEditedAt !== candidate.meta.layerSchemaEditedAt) reasons.push('layer-schema-edit');
  if (current.meta.featureCount !== candidate.meta.featureCount) reasons.push('feature-count');
  if (JSON.stringify(current.meta.geometryCounts) !== JSON.stringify(candidate.meta.geometryCounts)) reasons.push('geometry-counts');
  for (const key of [
    'dataset', 'definition', 'sourceItem', 'sourceLayer', 'method',
    'licenseAndWarranty', 'coordinatePrecision', 'objectIdScope',
  ]) {
    if (current.meta[key] !== candidate.meta[key]) {
      reasons.push('source-contract');
      break;
    }
  }
  if (JSON.stringify(current.rows) !== JSON.stringify(candidate.rows)) reasons.push('feature-content');
  return Object.freeze({ changed: reasons.length > 0, reasons: Object.freeze(reasons) });
}

export function renderHin2025Receipt(receipt, { snapshot } = {}) {
  const admitted = validateHin2025Receipt(receipt, { snapshot });
  const text = `${JSON.stringify(admitted)}\n`;
  const bytes = Buffer.byteLength(text);
  if (bytes > HIN_2025_RECEIPT_MAX_BYTES) {
    throw new Error(`HIN 2025 receipt exceeds ${HIN_2025_RECEIPT_MAX_BYTES} bytes: ${bytes}.`);
  }
  return { text, bytes };
}

export async function writeHin2025ReceiptAtomic(destination, receipt, options = {}) {
  const { text, bytes } = renderHin2025Receipt(receipt, options);
  const resolved = path.resolve(destination);
  const directory = path.dirname(resolved);
  const temporary = path.join(directory, `.${path.basename(resolved)}.${process.pid}-${Date.now()}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporary, text, 'utf8');
    await fs.rename(temporary, resolved);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return { destination: resolved, bytes };
}

export async function writeHin2025LifecycleAtomic({
  snapshotDestination,
  receiptDestination,
  snapshot,
  receipt,
} = {}) {
  const snapshotArtifact = renderHin2025Snapshot(snapshot);
  const receiptArtifact = renderHin2025Receipt(receipt, { snapshot });
  const snapshotPath = path.resolve(snapshotDestination);
  const receiptPath = path.resolve(receiptDestination);
  if (path.dirname(snapshotPath) !== path.dirname(receiptPath)) {
    throw new Error('HIN 2025 snapshot and receipt must share one artifact directory.');
  }
  const directory = path.dirname(snapshotPath);
  const token = `${process.pid}-${Date.now()}`;
  const snapshotTemporary = path.join(directory, `.${path.basename(snapshotPath)}.${token}.tmp`);
  const receiptTemporary = path.join(directory, `.${path.basename(receiptPath)}.${token}.tmp`);
  const snapshotBackup = path.join(directory, `.${path.basename(snapshotPath)}.${token}.bak`);
  const receiptBackup = path.join(directory, `.${path.basename(receiptPath)}.${token}.bak`);
  let snapshotBackedUp = false;
  let receiptBackedUp = false;
  let snapshotInstalled = false;
  let receiptInstalled = false;
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(snapshotTemporary, snapshotArtifact.text, 'utf8');
    await fs.writeFile(receiptTemporary, receiptArtifact.text, 'utf8');
    if (await fileExists(snapshotPath)) {
      await fs.rename(snapshotPath, snapshotBackup);
      snapshotBackedUp = true;
    }
    if (await fileExists(receiptPath)) {
      await fs.rename(receiptPath, receiptBackup);
      receiptBackedUp = true;
    }
    await fs.rename(snapshotTemporary, snapshotPath);
    snapshotInstalled = true;
    await fs.rename(receiptTemporary, receiptPath);
    receiptInstalled = true;
    await fs.rm(snapshotBackup, { force: true });
    snapshotBackedUp = false;
    await fs.rm(receiptBackup, { force: true });
    receiptBackedUp = false;
  } catch (error) {
    if (snapshotInstalled) await fs.rm(snapshotPath, { force: true }).catch(() => {});
    if (receiptInstalled) await fs.rm(receiptPath, { force: true }).catch(() => {});
    if (snapshotBackedUp) {
      await fs.rename(snapshotBackup, snapshotPath);
      snapshotBackedUp = false;
    }
    if (receiptBackedUp) {
      await fs.rename(receiptBackup, receiptPath);
      receiptBackedUp = false;
    }
    throw error;
  } finally {
    for (const file of [snapshotTemporary, receiptTemporary]) {
      await fs.rm(file, { force: true }).catch(() => {});
    }
  }
  return Object.freeze({
    snapshot: Object.freeze({ destination: snapshotPath, bytes: snapshotArtifact.bytes }),
    receipt: Object.freeze({ destination: receiptPath, bytes: receiptArtifact.bytes }),
  });
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} schema is invalid.`);
  }
}

function exactTimestamp(value, label) {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())
    || new Date(value).toISOString() !== value) throw new Error(`HIN 2025 ${label} is invalid.`);
  return value;
}

function nullableTimestamp(value, label) {
  return value === null ? null : exactTimestamp(value, label);
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
