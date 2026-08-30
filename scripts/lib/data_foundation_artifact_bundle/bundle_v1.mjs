import { createHash } from 'node:crypto';
import path from 'node:path';

import { createRegistryThrough } from './registry_adapter.mjs';

export const DATA_FOUNDATION_ARTIFACT_BUNDLE_PROTOCOL = 'DataFoundationArtifactBundle/v1';
export const M1_EXPECTED = Object.freeze({ acquisitions: 21, rawShards: 1_344, canonicalParts: 64 });
export const M2_EXPECTED = Object.freeze({ martParts: 128, evaluationArtifacts: 7 });

const FALSE_AUTHORITY = Object.freeze({ serving: false, promotion: false, deletion: false });
const DELETE_PREREQUISITES = Object.freeze([
  'artifact-integrity-rechecked',
  'downstream-dependencies-cleared',
  'explicit-owner-decision-recorded',
  'retention-period-satisfied',
]);
const M1_CONTROL_ROLES = Object.freeze([
  'warehouse_manifest',
  'backfill_checkpoint',
  'lineage_registry',
  'latest_quality_report',
  'latest_revision_report',
]);

export function materializeDataFoundationArtifactBundle({
  registryContract,
  createdAt,
  m1Locations,
  m2Locations,
  m1,
  m2,
}) {
  assertIndependentLocations(m1Locations, m2Locations);
  const m1Result = materializeM1ArtifactRegistry({ registryContract, locations: m1Locations, ...m1 });
  const m2Result = materializeM2ArtifactRegistry({ registryContract, locations: m2Locations, ...m2 });
  if (m2Result.declaration.lineage.m1ReceiptIdentity !== m1Result.declaration.lineage.receiptIdentity
    || m2Result.declaration.lineage.m1ReceiptSha256 !== m1Result.declaration.lineage.receiptSha256) {
    throw new Error('M2 exact lineage does not bind the materialized M1 receipt identity and bytes.');
  }
  return deepFreeze({
    protocol: DATA_FOUNDATION_ARTIFACT_BUNDLE_PROTOCOL,
    bundleId: contentIdentity({
      m1RegistryIdentity: m1Result.registry.registryIdentity,
      m2RegistryIdentity: m2Result.registry.registryIdentity,
    }),
    createdAt: exactTimestamp(createdAt, 'createdAt'),
    registryFiles: { m1: 'm1.registry.json', m2: 'm2.registry.json' },
    inventories: { m1: m1Result, m2: m2Result },
    restoreVerification: {
      status: 'not-observed',
      requiredObservationProtocol: 'ArtifactRegistryInventoryObservation/v1',
      meaning: 'Registry entries are producer declarations. Restored bytes become verified only after an independent observation is admitted and compared with ArtifactRegistry/v1.',
    },
    authority: FALSE_AUTHORITY,
  });
}

function assertIndependentLocations(m1Locations, m2Locations) {
  if (!Array.isArray(m1Locations) || !Array.isArray(m2Locations) || m1Locations.length === 0 || m2Locations.length === 0) {
    throw new Error('M1 and M2 each require an independent non-empty location inventory.');
  }
  for (const left of m1Locations) {
    for (const right of m2Locations) {
      if (left?.scheme === right?.scheme
        && ((left.scheme === 'file' && left.basePath === right.basePath)
          || (left.scheme === 'https' && left.baseUrl === right.baseUrl))) {
        throw new Error('M1 and M2 artifact registries cannot share the same physical base location.');
      }
    }
  }
}

export function materializeM1ArtifactRegistry({ registryContract, locations, receipt, controls, acquisitions }) {
  assertObject(receipt?.value, 'M1 receipt');
  if (receipt.value.schema !== 'engagement-phl-crime-warehouse-receipt/v3'
    || receipt.value.serving_eligible !== false
    || receipt.value.authority?.serving_authority !== false
    || receipt.value.authority?.integration_authority !== false
    || receipt.value.authority?.deletion_authority !== false) {
    throw new Error('M1 receipt is not the fail-closed official local candidate required by P1.');
  }
  assertDigest(receipt.value.identity, 'M1 receipt identity');
  const receiptCore = structuredClone(receipt.value);
  delete receiptCore.identity;
  if (contentIdentity(receiptCore) !== receipt.value.identity) {
    throw new Error('M1 receipt semantic identity drifted from its declared content.');
  }
  const receiptFile = normalizeFile(receipt.file, { expectedPath: 'receipt.json', role: 'receipt' });
  const controlByRole = new Map((controls || []).map((entry) => [entry.role, entry]));
  if (controlByRole.size !== M1_CONTROL_ROLES.length
    || M1_CONTROL_ROLES.some((role) => !controlByRole.has(role))) {
    throw new Error(`M1 controls must contain exactly: ${M1_CONTROL_ROLES.join(', ')}.`);
  }
  const controlObjects = M1_CONTROL_ROLES.map((role) => {
    const entry = controlByRole.get(role);
    const declared = receipt.value.artifacts?.[role];
    const file = normalizeFile(entry.file, { expectedPath: declared?.path, role });
    if (file.bytes !== declared?.bytes || file.sha256 !== declared?.sha256 || entry.value?.schema !== declared?.schema) {
      throw new Error(`M1 ${role} bytes, hash, path, or schema drifted from the receipt.`);
    }
    return objectFromFile(`m1:control:${role}`, file, null);
  });
  const lineage = controlByRole.get('lineage_registry').value;
  const warehouseManifest = controlByRole.get('warehouse_manifest').value;
  const backfillCheckpoint = controlByRole.get('backfill_checkpoint').value;
  const qualityReport = controlByRole.get('latest_quality_report').value;
  const revisionReport = controlByRole.get('latest_revision_report').value;
  const lineageEntries = lineage?.source_snapshots;
  if (!Array.isArray(acquisitions) || acquisitions.length !== M1_EXPECTED.acquisitions
    || !Array.isArray(lineageEntries) || lineageEntries.length !== acquisitions.length) {
    throw new Error(`M1 must declare exactly ${M1_EXPECTED.acquisitions} acquisition periods in lineage order.`);
  }
  if (warehouseManifest.current_snapshot_id !== receipt.value.warehouse.current_snapshot_id
    || qualityReport.snapshot_id !== warehouseManifest.current_snapshot_id
    || revisionReport.snapshot_id !== warehouseManifest.current_snapshot_id
    || qualityReport.lineage?.source_snapshot_id !== warehouseManifest.current_snapshot_id
    || backfillCheckpoint.final_quality?.acquired_rows !== receipt.value.counts.acquired_rows) {
    throw new Error('M1 warehouse/checkpoint/quality/revision current lineage drifted from the receipt.');
  }
  const sourceManifestBindings = [];
  const rawBindings = [];
  const acquisitionObjects = [];
  let acquiredRows = 0;
  acquisitions.forEach((acquisition, acquisitionIndex) => {
    const manifest = acquisition.manifest?.value;
    const checkpoint = acquisition.checkpoint?.value;
    assertObject(manifest, `M1 acquisition ${acquisitionIndex} manifest`);
    assertObject(checkpoint, `M1 acquisition ${acquisitionIndex} checkpoint`);
    const manifestFile = normalizeFile(acquisition.manifest.file, { role: `acquisition-${acquisitionIndex}-manifest` });
    const checkpointFile = normalizeFile(acquisition.checkpoint.file, { role: `acquisition-${acquisitionIndex}-checkpoint` });
    const lineageEntry = lineageEntries[acquisitionIndex];
    const portableManifestPath = portableAcquisitionManifestPath(lineageEntry);
    if (lineageEntry.snapshot_id !== manifest.snapshot_id
      || manifestFile.relativePath !== portableManifestPath
      || !declaredPathMatches(lineageEntry.manifest_path, portableManifestPath)
      || checkpoint.snapshot_id !== manifest.snapshot_id
      || checkpoint.complete !== true
      || manifest.acquisition?.checkpoint_path !== path.posix.basename(checkpointFile.relativePath)
      || path.posix.dirname(checkpointFile.relativePath) !== path.posix.dirname(manifestFile.relativePath)) {
      throw new Error(`M1 acquisition ${acquisitionIndex} manifest/checkpoint/lineage seam drifted.`);
    }
    if (!Array.isArray(manifest.shards) || manifest.shards.length !== 64 || manifest.partition_count !== 64) {
      throw new Error(`M1 acquisition ${acquisitionIndex} must declare exactly 64 raw shards.`);
    }
    sourceManifestBindings.push({
      path: manifestFile.relativePath,
      bytes: manifestFile.bytes,
      sha256: manifestFile.sha256,
      revision: manifest.snapshot_id,
    });
    acquisitionObjects.push(
      objectFromFile(`m1:acquisition:${pad(acquisitionIndex, 2)}:manifest`, manifestFile, null),
      objectFromFile(`m1:acquisition:${pad(acquisitionIndex, 2)}:checkpoint`, checkpointFile, null),
    );
    let manifestRows = 0;
    manifest.shards.forEach((shard, partition) => {
      const expectedShardPath = `rows/part-${pad(partition, 3)}.jsonl`;
      if (shard.partition !== partition || shard.path !== expectedShardPath) {
        throw new Error(`M1 acquisition ${acquisitionIndex} raw shard order or path drifted.`);
      }
      assertCount(shard.row_count, 'M1 raw shard row_count');
      assertCount(shard.bytes, 'M1 raw shard bytes');
      assertDigest(shard.identity, 'M1 raw shard identity');
      const relativePath = `${path.posix.dirname(manifestFile.relativePath)}/${shard.path}`;
      rawBindings.push({ path: relativePath, bytes: shard.bytes, sha256: shard.identity });
      acquisitionObjects.push({
        objectId: `m1:raw:${pad(acquisitionIndex, 2)}:${pad(partition, 3)}`,
        relativePath,
        mediaType: 'application/x-ndjson',
        bytes: shard.bytes,
        sha256: shard.identity,
        rowCount: shard.row_count,
      });
      manifestRows += shard.row_count;
    });
    if (manifestRows !== manifest.row_count || manifestRows !== checkpoint.row_count) {
      throw new Error(`M1 acquisition ${acquisitionIndex} declared raw rows do not reconcile.`);
    }
    acquiredRows += manifestRows;
  });
  const sourceAggregate = receipt.value.artifacts?.source_manifests;
  if (sourceAggregate?.count !== sourceManifestBindings.length
    || sourceAggregate.bytes !== sum(sourceManifestBindings, 'bytes')
    || sourceAggregate.sha256 !== contentIdentity(sourceManifestBindings)
    || sourceAggregate.raw_shard_count !== rawBindings.length
    || sourceAggregate.raw_bytes !== sum(rawBindings, 'bytes')
    || sourceAggregate.raw_sha256 !== contentIdentity(rawBindings)
    || rawBindings.length !== M1_EXPECTED.rawShards
    || acquiredRows !== receipt.value.counts?.acquired_rows) {
    throw new Error('M1 source manifest/raw-shard counts, bytes, hashes, or receipt aggregates drifted.');
  }
  const canonicalDeclaration = receipt.value.artifacts?.canonical;
  const canonicalBindings = canonicalDeclaration?.partition_bindings;
  if (!Array.isArray(canonicalBindings) || canonicalBindings.length !== M1_EXPECTED.canonicalParts
    || canonicalDeclaration.partition_count !== canonicalBindings.length) {
    throw new Error(`M1 receipt must declare exactly ${M1_EXPECTED.canonicalParts} canonical partitions.`);
  }
  const canonicalObjects = canonicalBindings.map((binding, partition) => {
    const expectedPath = `canonical/part-${pad(partition, 3)}.jsonl`;
    if (binding.partition !== partition || binding.path !== expectedPath) {
      throw new Error('M1 canonical partition order or path drifted.');
    }
    return {
      objectId: `m1:canonical:${pad(partition, 3)}`,
      relativePath: `warehouse/${binding.path}`,
      mediaType: 'application/x-ndjson',
      bytes: count(binding.bytes),
      sha256: digest(binding.identity),
      rowCount: count(binding.row_count),
    };
  });
  const canonicalAggregateBindings = canonicalObjects.map(({ relativePath, bytes, sha256 }) => ({
    path: relativePath,
    bytes,
    sha256,
  }));
  if (canonicalDeclaration.bytes !== sum(canonicalObjects, 'bytes')
    || canonicalDeclaration.sha256 !== contentIdentity(canonicalAggregateBindings)
    || receipt.value.counts.canonical_rows !== sum(canonicalObjects, 'rowCount')) {
    throw new Error('M1 canonical counts, bytes, or hash aggregate drifted from the receipt.');
  }
  const objects = [objectFromFile('m1:receipt', receiptFile, null), ...controlObjects, ...acquisitionObjects, ...canonicalObjects];
  const partitions = [
    ...acquisitionObjects.filter((object) => object.objectId.includes(':raw:')).map((object) => ({
      partitionId: object.objectId.replace('m1:raw:', 'm1:raw-partition:'), objectIds: [object.objectId], rowCount: object.rowCount,
    })),
    ...canonicalObjects.map((object) => ({
      partitionId: object.objectId.replace('m1:canonical:', 'm1:canonical-partition:'), objectIds: [object.objectId], rowCount: object.rowCount,
    })),
  ];
  const partitionedIds = new Set(partitions.flatMap(({ objectIds }) => objectIds));
  const registry = createRegistryThrough(registryContract, registryCore({
    artifactSetId: `artifact-set:m1:${stripDigest(receipt.value.identity)}`,
    sourceId: receipt.value.source.dataset_id,
    scopeId: `${receipt.value.coverage.start}_${receipt.value.coverage.end_exclusive}`,
    revision: stripDigest(receipt.value.source.revision),
    clocks: receipt.value.clocks,
    versions: {
      producer: { name: 'crime-event-warehouse', version: safeVersion(receipt.value.warehouse.schema) },
      schema: { name: 'crime-warehouse-receipt', version: safeVersion(receipt.value.schema) },
      transform: { name: 'crime-event', version: safeVersion(receipt.value.warehouse.event_schema) },
    },
    locations,
    objects,
    partitions,
    unpartitionedObjectIds: objects.filter(({ objectId }) => !partitionedIds.has(objectId)).map(({ objectId }) => objectId),
  }));
  return deepFreeze({
    registry,
    declaration: {
      basis: 'producer-declared-with-control-byte-observations',
      lineage: { receiptIdentity: receipt.value.identity, receiptSha256: receiptFile.sha256 },
      expectedShape: M1_EXPECTED,
      groups: {
        controlFiles: 6,
        acquisitionManifests: acquisitions.length,
        acquisitionCheckpoints: acquisitions.length,
        rawShards: rawBindings.length,
        canonicalParts: canonicalObjects.length,
      },
      excluded: ['transactions', 'logs', 'cache'],
    },
    restoreVerification: unobservedVerification(),
  });
}

export function materializeM2ArtifactRegistry({
  registryContract,
  locations,
  protocol,
  martManifest,
  martCheckpoint,
  evaluationManifest,
  evaluationCheckpoint,
}) {
  const protocolFile = normalizeFile(protocol.file, { role: 'M2 protocol' });
  if (!Buffer.isBuffer(protocol.bytes)
    || protocol.bytes.includes(0x0d)
    || !protocol.bytes.length
    || protocol.bytes.at(-1) !== 0x0a
    || sha256(protocol.bytes) !== protocolFile.sha256) {
    throw new Error('M2 tracked protocol bytes must be exact LF-only bytes with one final LF and their declared SHA-256.');
  }
  const protocolValue = protocol.value;
  const mart = martManifest.value;
  const evaluation = evaluationManifest.value;
  const martManifestFile = normalizeFile(martManifest.file, { role: 'M2 mart manifest' });
  const martCheckpointFile = normalizeFile(martCheckpoint.file, { role: 'M2 mart checkpoint' });
  const evaluationManifestFile = normalizeFile(evaluationManifest.file, { role: 'M2 evaluation manifest' });
  const evaluationCheckpointFile = normalizeFile(evaluationCheckpoint.file, { role: 'M2 evaluation checkpoint' });
  const protocolPlain = stripDigest(protocolFile.sha256);
  const martManifestPlain = stripDigest(martManifestFile.sha256);
  let parsedProtocol;
  try {
    parsedProtocol = JSON.parse(protocol.bytes.toString('utf8'));
  } catch {
    throw new Error('M2 tracked protocol bytes are not valid JSON.');
  }
  if (stableSerialization(parsedProtocol) !== stableSerialization(protocolValue)) {
    throw new Error('M2 protocol value drifted from the tracked raw bytes.');
  }
  if (mart.protocol?.sha256 !== protocolPlain
    || mart.exact_input?.receipt_identity == null
    || mart.exact_input?.receipt_sha256 == null
    || evaluation.protocol_sha256 !== protocolPlain
    || evaluation.mart_manifest_sha256 !== martManifestPlain
    || evaluation.mart_artifact_identity !== mart.artifact_identity
    || evaluation.lineage_seam?.protocol?.sha256 !== protocolPlain
    || evaluation.lineage_seam?.mart?.manifest_sha256 !== martManifestPlain
    || evaluation.lineage_seam?.mart?.artifact_identity !== mart.artifact_identity
    || evaluation.lineage_seam?.m1_receipt?.identity !== mart.exact_input.receipt_identity
    || evaluation.lineage_seam?.m1_receipt?.sha256 !== mart.exact_input.receipt_sha256) {
    throw new Error('M2 protocol -> M1 receipt -> mart -> evaluation exact lineage drifted.');
  }
  if (evaluation.promotion?.status !== 'not-promoted'
    || evaluation.availability !== 'unavailable'
    || evaluation.lineage_seam?.outcome?.promotion_status !== 'not-promoted'
    || evaluation.lineage_seam?.outcome?.availability !== 'unavailable') {
    throw new Error('P1 M2 registry must preserve not-promoted/unavailable without serving authority.');
  }
  if (!Array.isArray(mart.parts) || mart.parts.length !== M2_EXPECTED.martParts
    || evaluation.lineage_seam?.mart?.part_count !== mart.parts.length
    || mart.row_count !== sum(mart.parts, 'row_count')
    || mart.bytes !== sum(mart.parts, 'bytes')) {
    throw new Error(`M2 mart must declare exactly ${M2_EXPECTED.martParts} parts with reconciling rows and bytes.`);
  }
  const expectedPartBindingIdentity = contentIdentity(mart.parts.map((part) => ({
    path: part.path,
    unit_type: part.unit_type,
    partition: part.partition,
    row_count: part.row_count,
    bytes: part.bytes,
    sha256: part.sha256,
  })));
  if (mart.part_bindings_identity !== expectedPartBindingIdentity
    || evaluation.lineage_seam?.mart?.part_bindings_identity !== expectedPartBindingIdentity
    || evaluation.lineage_seam?.mart?.row_count !== mart.row_count
    || evaluation.lineage_seam?.mart?.bytes !== mart.bytes) {
    throw new Error('M2 mart count, byte, or part-binding hash aggregate drifted.');
  }
  const martCore = structuredClone(mart);
  delete martCore.artifact_identity;
  delete martCore.generated_at;
  if (contentIdentity(martCore) !== mart.artifact_identity) {
    throw new Error('M2 mart artifact identity drifted from its manifest core.');
  }
  const seamParts = evaluation.lineage_seam.mart.parts;
  if (stableSerialization(seamParts) !== stableSerialization(mart.parts.map((part) => ({
    path: part.path,
    unit_type: part.unit_type,
    partition: part.partition,
    row_count: part.row_count,
    bytes: part.bytes,
    sha256: part.sha256,
  })))) {
    throw new Error('M2 evaluation lineage seam mart inventory drifted from the mart manifest.');
  }
  const martObjects = mart.parts.map((part, index) => ({
    objectId: `m2:mart:${pad(index, 3)}`,
    relativePath: normalizeRelative(part.path),
    mediaType: 'application/x-ndjson',
    bytes: count(part.bytes),
    sha256: digest(part.sha256),
    rowCount: count(part.row_count),
  }));
  if (!Array.isArray(evaluation.artifacts) || evaluation.artifacts.length !== M2_EXPECTED.evaluationArtifacts) {
    throw new Error(`M2 evaluation must declare exactly ${M2_EXPECTED.evaluationArtifacts} artifacts.`);
  }
  const evaluationObjects = evaluation.artifacts.map((artifact, index) => ({
    objectId: `m2:evaluation:${pad(index, 2)}`,
    relativePath: normalizeRelative(`evaluation/${artifact.name}`),
    mediaType: artifact.name.endsWith('.md') ? 'text/markdown' : 'application/json',
    bytes: count(artifact.bytes),
    sha256: digest(artifact.sha256),
    rowCount: null,
  }));
  const controlObjects = [
    objectFromFile('m2:protocol', protocolFile, null),
    objectFromFile('m2:mart-manifest', martManifestFile, null),
    objectFromFile('m2:mart-checkpoint', martCheckpointFile, null),
    objectFromFile('m2:evaluation-manifest', evaluationManifestFile, null),
    objectFromFile('m2:evaluation-checkpoint', evaluationCheckpointFile, null),
  ];
  const objects = [...controlObjects, ...martObjects, ...evaluationObjects];
  const partitions = martObjects.map((object) => ({
    partitionId: object.objectId.replace('m2:mart:', 'm2:mart-partition:'), objectIds: [object.objectId], rowCount: object.rowCount,
  }));
  const registry = createRegistryThrough(registryContract, registryCore({
    artifactSetId: `artifact-set:m2:${stripDigest(mart.artifact_identity)}`,
    sourceId: 'area-intelligence',
    scopeId: `${mart.source_coverage.earliest_scope_start}_${mart.source_coverage.latest_scope_end_exclusive}`,
    revision: stripDigest(mart.artifact_identity),
    clocks: {
      source_as_of: mart.source_coverage.latest_event_at,
      retrieved_at: mart.exact_input.clocks?.retrieved_at || mart.source_coverage.latest_event_at,
      built_at: mart.generated_at,
      observed_at: evaluation.generated_at,
    },
    versions: {
      producer: { name: 'area-intelligence-mart', version: safeVersion(mart.schema) },
      schema: { name: 'area-intelligence-evaluation', version: safeVersion(evaluation.schema) },
      transform: { name: 'evaluation-protocol', version: safeVersion(protocolValue.schema) },
    },
    locations,
    objects,
    partitions,
    unpartitionedObjectIds: [...controlObjects, ...evaluationObjects].map(({ objectId }) => objectId),
  }));
  return deepFreeze({
    registry,
    declaration: {
      basis: 'producer-declared-with-control-byte-observations',
      lineage: {
        protocolSha256: protocolFile.sha256,
        m1ReceiptIdentity: mart.exact_input.receipt_identity,
        m1ReceiptSha256: digest(mart.exact_input.receipt_sha256),
        martManifestSha256: martManifestFile.sha256,
        martArtifactIdentity: digest(mart.artifact_identity),
      },
      expectedShape: M2_EXPECTED,
      groups: { controlFiles: 5, martParts: martObjects.length, evaluationArtifacts: evaluationObjects.length },
      outcome: { promotionStatus: 'not-promoted', availability: 'unavailable' },
      excluded: ['staging'],
    },
    restoreVerification: unobservedVerification(),
  });
}

function registryCore({ artifactSetId, sourceId, scopeId, revision, clocks, versions, locations, objects, partitions, unpartitionedObjectIds }) {
  const normalizedObjects = [...objects].sort((left, right) => left.objectId.localeCompare(right.objectId));
  return {
    protocol: 'ArtifactRegistry/v1',
    artifactSetId,
    sourceScope: { sourceId: safeId(sourceId), scopeId: safeId(scopeId), revision: safeId(revision), dataClassification: 'restricted-local-artifact' },
    clocks: {
      sourceAsOf: exactTimestamp(clocks.source_as_of, 'sourceAsOf'),
      retrievedAt: exactTimestamp(clocks.retrieved_at, 'retrievedAt'),
      builtAt: exactTimestamp(clocks.built_at, 'builtAt'),
      observedAt: exactTimestamp(clocks.observed_at, 'observedAt'),
    },
    versions,
    locations,
    objects: normalizedObjects,
    partitionInventory: {
      partitions,
      unpartitionedObjectIds,
      totalObjectCount: normalizedObjects.length,
      totalBytes: sum(normalizedObjects, 'bytes'),
      totalRowCount: sum(normalizedObjects, 'rowCount'),
    },
    retention: { state: 'hold', decisionOwner: 'data-foundation-owner', deletePrerequisites: [...DELETE_PREREQUISITES] },
    authority: FALSE_AUTHORITY,
  };
}

function objectFromFile(objectId, file, rowCount) {
  return { objectId, relativePath: file.relativePath, mediaType: file.mediaType || mediaType(file.relativePath), bytes: file.bytes, sha256: file.sha256, rowCount };
}

function normalizeFile(value, { expectedPath = null, role }) {
  assertObject(value, `${role} file`);
  const relativePath = normalizeRelative(value.relativePath);
  if (expectedPath != null && relativePath !== normalizeRelative(expectedPath)) throw new Error(`${role} path drifted.`);
  return { relativePath, bytes: count(value.bytes), sha256: digest(value.sha256), mediaType: value.mediaType || mediaType(relativePath) };
}

function unobservedVerification() {
  return { status: 'not-observed', verified: false, observation: null };
}

function mediaType(relativePath) {
  if (relativePath.endsWith('.jsonl')) return 'application/x-ndjson';
  if (relativePath.endsWith('.md')) return 'text/markdown';
  return 'application/json';
}

function normalizeRelative(value) {
  if (typeof value !== 'string') throw new Error('Artifact path must be a string.');
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..') || path.posix.normalize(normalized) !== normalized) {
    throw new Error(`Artifact path must be safe and relative: ${value}`);
  }
  return normalized;
}

function declaredPathMatches(declared, expectedRelative) {
  if (typeof declared !== 'string') return false;
  const normalized = declared.replaceAll('\\', '/');
  return normalized === expectedRelative || normalized.endsWith(`/${expectedRelative}`);
}

function portableAcquisitionManifestPath(entry) {
  const start = entry?.scope?.start;
  const end = entry?.scope?.end_exclusive;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '') || start >= end) {
    throw new Error('M1 lineage acquisition scope is missing, invalid, or reversed.');
  }
  return `acquisitions/${start}_${end}/manifest.json`;
}

function sum(items, key) {
  return items.reduce((total, item) => total + (item[key] ?? 0), 0);
}

function count(value) {
  assertCount(value, 'count');
  return value;
}

function assertCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`);
}

function digest(value) {
  const normalized = typeof value === 'string' && value.startsWith('sha256:') ? value : `sha256:${value}`;
  assertDigest(normalized, 'SHA-256');
  return normalized;
}

function assertDigest(value, label) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value || '')) throw new Error(`${label} must be a sha256: digest.`);
}

function stripDigest(value) {
  return digest(value).slice(7);
}

function safeId(value) {
  const normalized = String(value || '').replace(/[^A-Za-z0-9._:+/-]/g, '_').slice(0, 128);
  if (!normalized) throw new Error('Registry identifier is empty.');
  return normalized;
}

function safeVersion(value) {
  const normalized = String(value || '').replace(/[^A-Za-z0-9._+-]/g, '_').slice(0, 128);
  if (!normalized) throw new Error('Registry version is empty.');
  return normalized;
}

function exactTimestamp(value, label) {
  if (typeof value !== 'string' || new Date(value).toISOString() !== value) throw new Error(`${label} must be an exact ISO timestamp.`);
  return value;
}

function pad(value, width) {
  return String(value).padStart(width, '0');
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function contentIdentity(value) {
  return sha256(Buffer.from(stableSerialization(value)));
}

function stableSerialization(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialization).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialization(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
