import { isIP } from 'node:net';

import {
  boundedText,
  canonicalStringify,
  cloneData,
  contentIdentity,
  exactDataObject,
  exactTimestamp,
  fail,
  freezeData,
  nonNegativeSafeInteger,
} from './safe_data.mjs';
import { strictJsonParse } from './strict_json.mjs';

export const ARTIFACT_REGISTRY_PROTOCOL = 'ArtifactRegistry/v1';
export const ARTIFACT_INVENTORY_OBSERVATION_PROTOCOL = 'ArtifactRegistryInventoryObservation/v1';
export const ARTIFACT_INVENTORY_COMPARISON_PROTOCOL = 'ArtifactRegistryInventoryComparison/v1';
export const REQUIRED_DELETE_PREREQUISITES = Object.freeze([
  'artifact-integrity-rechecked',
  'downstream-dependencies-cleared',
  'explicit-owner-decision-recorded',
  'retention-period-satisfied',
]);

const CORE_KEYS = Object.freeze([
  'protocol',
  'artifactSetId',
  'sourceScope',
  'clocks',
  'versions',
  'locations',
  'objects',
  'partitionInventory',
  'retention',
  'authority',
]);
const REGISTRY_KEYS = Object.freeze([...CORE_KEYS, 'registryIdentity']);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,127}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const RELATIVE_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const LINE_ROW_MEDIA_TYPES = new Set([
  'application/jsonl',
  'application/ndjson',
  'application/x-ndjson',
]);
const SENSITIVE_LOCATION_PATTERN = /(?:^|[-_./])(api[-_]?keys?|credentials?|passwords?|private[-_]?keys?|secrets?|signatures?|tokens?)(?:$|[-_./])/i;
const MUTABLE_URL_TOKENS = new Set(['current', 'head', 'latest', 'live', 'main']);
const RETENTION_STATES = new Set(['hold', 'retained', 'review-required']);

export function createArtifactRegistry(value) {
  assertArgumentCount(arguments, 1, 'registry creation');
  const core = normalizeRegistryCore(value);
  return freezeData({ ...core, registryIdentity: contentIdentity(core) }, 'created artifact registry');
}

export function admitArtifactRegistry(value) {
  assertArgumentCount(arguments, 1, 'registry admission');
  const registry = exactDataObject(value, REGISTRY_KEYS, 'artifact registry');
  const core = normalizeRegistryCore(Object.fromEntries(CORE_KEYS.map((key) => [key, registry[key]])));
  assertDigest(registry.registryIdentity, 'registryIdentity');
  const expectedIdentity = contentIdentity(core);
  if (registry.registryIdentity !== expectedIdentity) {
    fail('registry-identity-drift', 'registryIdentity must equal the canonical SHA-256 identity of the complete registry core');
  }
  return freezeData({ ...core, registryIdentity: expectedIdentity }, 'admitted artifact registry');
}

export function parseArtifactRegistry(jsonText) {
  assertArgumentCount(arguments, 1, 'registry parsing');
  return admitArtifactRegistry(strictJsonParse(jsonText));
}

export function serializeArtifactRegistry(value) {
  assertArgumentCount(arguments, 1, 'registry serialization');
  return canonicalStringify(admitArtifactRegistry(value));
}

export function admitArtifactInventoryObservation(value) {
  assertArgumentCount(arguments, 1, 'inventory observation admission');
  const observation = exactDataObject(value, [
    'protocol', 'artifactSetId', 'registryIdentity', 'objects', 'partitionInventory',
  ], 'artifact inventory observation');
  if (observation.protocol !== ARTIFACT_INVENTORY_OBSERVATION_PROTOCOL) {
    fail('unsupported-observation-protocol', `inventory observation protocol must equal ${ARTIFACT_INVENTORY_OBSERVATION_PROTOCOL}`);
  }
  const artifactSetId = identifier(observation.artifactSetId, 'observation.artifactSetId');
  assertDigest(observation.registryIdentity, 'observation.registryIdentity');
  const objects = normalizeObjects(observation.objects, { observed: true });
  const partitionInventory = normalizePartitionInventory(observation.partitionInventory, objects);
  return freezeData({
    protocol: observation.protocol,
    artifactSetId,
    registryIdentity: observation.registryIdentity,
    objects,
    partitionInventory,
  }, 'admitted artifact inventory observation');
}

export function compareArtifactRegistryInventoryObservation(registryValue, observationValue) {
  assertArgumentCount(arguments, 2, 'inventory observation comparison');
  const registry = admitArtifactRegistry(registryValue);
  const observation = admitArtifactInventoryObservation(observationValue);
  if (observation.artifactSetId !== registry.artifactSetId) {
    fail('artifact-set-drift', 'inventory observation artifactSetId does not match the registry');
  }
  if (observation.registryIdentity !== registry.registryIdentity) {
    fail('observation-registry-identity-drift', 'inventory observation is not bound to this registry identity');
  }
  if (observation.objects.length !== registry.objects.length) {
    fail('object-inventory-drift', 'inventory observation object count does not match the registry');
  }
  const observedById = new Map(observation.objects.map((object) => [object.objectId, object]));
  for (const expected of registry.objects) {
    const observed = observedById.get(expected.objectId);
    if (!observed) fail('object-inventory-drift', `inventory observation is missing object ${expected.objectId}`);
    if (observed.relativePath !== expected.relativePath) {
      fail('object-path-drift', `object ${expected.objectId} relativePath drifted`);
    }
    if (observed.bytes !== expected.bytes) fail('object-bytes-drift', `object ${expected.objectId} bytes drifted`);
    if (observed.sha256 !== expected.sha256) fail('object-hash-drift', `object ${expected.objectId} sha256 drifted`);
    if (observed.rowCount !== expected.rowCount) {
      fail('object-row-count-drift', `object ${expected.objectId} rowCount drifted`);
    }
  }
  if (canonicalStringify(observation.partitionInventory) !== canonicalStringify(registry.partitionInventory)) {
    fail('partition-inventory-drift', 'observed partition inventory does not match the registry');
  }
  return freezeData({
    protocol: ARTIFACT_INVENTORY_COMPARISON_PROTOCOL,
    artifactSetId: registry.artifactSetId,
    registryIdentity: registry.registryIdentity,
    matched: true,
    basis: 'caller-supplied-observation',
    objectCount: registry.objects.length,
    partitionCount: registry.partitionInventory.partitions.length,
    totalBytes: registry.partitionInventory.totalBytes,
    totalRowCount: registry.partitionInventory.totalRowCount,
    authority: registry.authority,
  }, 'artifact inventory observation comparison');
}

function normalizeRegistryCore(value) {
  const core = exactDataObject(value, CORE_KEYS, 'artifact registry core');
  if (core.protocol !== ARTIFACT_REGISTRY_PROTOCOL) {
    fail('unsupported-protocol', `artifact registry protocol must equal ${ARTIFACT_REGISTRY_PROTOCOL}`);
  }
  const artifactSetId = identifier(core.artifactSetId, 'artifactSetId');
  if (!artifactSetId.startsWith('artifact-set:')) {
    fail('invalid-artifact-set-id', 'artifactSetId must use the artifact-set: namespace');
  }
  const sourceScope = normalizeSourceScope(core.sourceScope);
  const clocks = normalizeClocks(core.clocks);
  const versions = normalizeVersions(core.versions);
  const locations = normalizeLocations(core.locations);
  const objects = normalizeObjects(core.objects);
  const partitionInventory = normalizePartitionInventory(core.partitionInventory, objects);
  const retention = normalizeRetention(core.retention);
  const authority = normalizeAuthority(core.authority);
  return {
    protocol: core.protocol,
    artifactSetId,
    sourceScope,
    clocks,
    versions,
    locations,
    objects,
    partitionInventory,
    retention,
    authority,
  };
}

function normalizeSourceScope(value) {
  const source = exactDataObject(value, [
    'sourceId', 'scopeId', 'revision', 'dataClassification',
  ], 'sourceScope');
  return {
    sourceId: identifier(source.sourceId, 'sourceScope.sourceId'),
    scopeId: identifier(source.scopeId, 'sourceScope.scopeId'),
    revision: identifier(source.revision, 'sourceScope.revision'),
    dataClassification: identifier(source.dataClassification, 'sourceScope.dataClassification'),
  };
}

function normalizeClocks(value) {
  const clocks = exactDataObject(value, [
    'sourceAsOf', 'retrievedAt', 'builtAt', 'observedAt',
  ], 'clocks');
  const normalized = {
    sourceAsOf: exactTimestamp(clocks.sourceAsOf, 'clocks.sourceAsOf'),
    retrievedAt: exactTimestamp(clocks.retrievedAt, 'clocks.retrievedAt'),
    builtAt: exactTimestamp(clocks.builtAt, 'clocks.builtAt'),
    observedAt: exactTimestamp(clocks.observedAt, 'clocks.observedAt'),
  };
  if (normalized.sourceAsOf > normalized.retrievedAt
    || normalized.retrievedAt > normalized.builtAt
    || normalized.builtAt > normalized.observedAt) {
    fail('clock-order', 'clocks must satisfy sourceAsOf <= retrievedAt <= builtAt <= observedAt');
  }
  return normalized;
}

function normalizeVersions(value) {
  const versions = exactDataObject(value, ['producer', 'schema', 'transform'], 'versions');
  return {
    producer: normalizeVersionDescriptor(versions.producer, 'versions.producer'),
    schema: normalizeVersionDescriptor(versions.schema, 'versions.schema'),
    transform: normalizeVersionDescriptor(versions.transform, 'versions.transform'),
  };
}

function normalizeVersionDescriptor(value, label) {
  const descriptor = exactDataObject(value, ['name', 'version'], label);
  return {
    name: identifier(descriptor.name, `${label}.name`),
    version: boundedText(descriptor.version, `${label}.version`, { max: 128, pattern: VERSION_PATTERN }),
  };
}

function normalizeLocations(value) {
  const locations = cloneData(value, 'locations');
  if (!Array.isArray(locations) || locations.length === 0 || locations.length > 2) {
    fail('location-inventory', 'locations must contain one or two strict location descriptions');
  }
  const schemes = new Set();
  const normalized = locations.map((location, index) => {
    if (!location || typeof location !== 'object' || Array.isArray(location)) {
      fail('object-required', `locations[${index}] must be a plain data object`);
    }
    if (location.scheme !== 'file' && location.scheme !== 'https') {
      fail('unsupported-location-scheme', 'ArtifactRegistry/v1 supports only file and https location schemes');
    }
    const generic = exactDataObject(location, location.scheme === 'file'
      ? ['scheme', 'basePath']
      : ['scheme', 'baseUrl'], `locations[${index}]`);
    if (schemes.has(generic.scheme)) fail('duplicate-location-scheme', `location scheme ${generic.scheme} is duplicated`);
    schemes.add(generic.scheme);
    if (generic.scheme === 'file') {
      return { scheme: 'file', basePath: safeRelativePath(generic.basePath, `locations[${index}].basePath`) };
    }
    return { scheme: 'https', baseUrl: safeImmutableHttpsBase(generic.baseUrl, `locations[${index}].baseUrl`) };
  });
  return normalized.sort((left, right) => left.scheme.localeCompare(right.scheme));
}

function normalizeObjects(value, { observed = false } = {}) {
  const objects = cloneData(value, observed ? 'observation.objects' : 'objects');
  if (!Array.isArray(objects) || objects.length === 0) fail('object-inventory', 'objects must be a non-empty array');
  const ids = new Set();
  const paths = new Set();
  const hashes = new Set();
  const normalized = objects.map((valueAtIndex, index) => {
    const label = `${observed ? 'observation.objects' : 'objects'}[${index}]`;
    const object = exactDataObject(valueAtIndex, observed
      ? ['objectId', 'relativePath', 'bytes', 'sha256', 'rowCount']
      : ['objectId', 'relativePath', 'mediaType', 'bytes', 'sha256', 'rowCount'], label);
    const objectId = identifier(object.objectId, `${label}.objectId`);
    const relativePath = safeRelativePath(object.relativePath, `${label}.relativePath`);
    assertDigest(object.sha256, `${label}.sha256`);
    nonNegativeSafeInteger(object.bytes, `${label}.bytes`);
    if (object.rowCount !== null) nonNegativeSafeInteger(object.rowCount, `${label}.rowCount`);
    if (ids.has(objectId)) fail('duplicate-object-id', `objectId ${objectId} is duplicated`);
    if (paths.has(relativePath)) fail('duplicate-object-path', `relativePath ${relativePath} is duplicated`);
    if (hashes.has(object.sha256)) fail('duplicate-object-hash', `sha256 ${object.sha256} is duplicated`);
    ids.add(objectId);
    paths.add(relativePath);
    hashes.add(object.sha256);
    const common = { objectId, relativePath };
    if (!observed) {
      common.mediaType = boundedText(object.mediaType, `${label}.mediaType`, { max: 127, pattern: MEDIA_TYPE_PATTERN });
      if (object.rowCount !== null
        && !LINE_ROW_MEDIA_TYPES.has(common.mediaType)
        && !relativePath.endsWith('.jsonl')
        && !relativePath.endsWith('.ndjson')) {
        fail(
          'row-count-verifier-unavailable',
          `${label}.rowCount is supported only for line-delimited JSON artifacts in ArtifactRegistry/v1`,
        );
      }
    }
    return { ...common, bytes: object.bytes, sha256: object.sha256, rowCount: object.rowCount };
  });
  return normalized.sort((left, right) => left.objectId.localeCompare(right.objectId));
}

function normalizePartitionInventory(value, objects) {
  const inventory = exactDataObject(value, [
    'partitions', 'unpartitionedObjectIds', 'totalObjectCount', 'totalBytes', 'totalRowCount',
  ], 'partitionInventory');
  const partitions = cloneData(inventory.partitions, 'partitionInventory.partitions');
  const unpartitioned = cloneData(inventory.unpartitionedObjectIds, 'partitionInventory.unpartitionedObjectIds');
  if (!Array.isArray(partitions) || !Array.isArray(unpartitioned)) {
    fail('partition-inventory', 'partitionInventory arrays are required');
  }
  const objectsById = new Map(objects.map((object) => [object.objectId, object]));
  const assigned = new Set();
  const partitionIds = new Set();
  const normalizedPartitions = partitions.map((valueAtIndex, index) => {
    const label = `partitionInventory.partitions[${index}]`;
    const partition = exactDataObject(valueAtIndex, ['partitionId', 'objectIds', 'rowCount'], label);
    const partitionId = identifier(partition.partitionId, `${label}.partitionId`);
    if (partitionIds.has(partitionId)) fail('duplicate-partition-id', `partitionId ${partitionId} is duplicated`);
    partitionIds.add(partitionId);
    const objectIds = cloneData(partition.objectIds, `${label}.objectIds`);
    if (!Array.isArray(objectIds) || objectIds.length === 0) {
      fail('partition-inventory', `partition ${partitionId} must contain at least one objectId`);
    }
    let expectedRows = 0;
    const normalizedIds = objectIds.map((objectId, objectIndex) => {
      const id = identifier(objectId, `${label}.objectIds[${objectIndex}]`);
      if (assigned.has(id)) fail('duplicate-inventory-object', `objectId ${id} appears more than once in partition inventory`);
      const object = objectsById.get(id);
      if (!object) fail('unknown-inventory-object', `partition inventory refers to unknown objectId ${id}`);
      if (object.rowCount === null) {
        fail('partition-row-count-unavailable', `partitioned object ${id} must declare rowCount`);
      }
      assigned.add(id);
      expectedRows += object.rowCount;
      if (!Number.isSafeInteger(expectedRows)) fail('invalid-count', `partition ${partitionId} rowCount sum is unsafe`);
      return id;
    }).sort();
    nonNegativeSafeInteger(partition.rowCount, `${label}.rowCount`);
    if (partition.rowCount !== expectedRows) fail('partition-row-count-drift', `partition ${partitionId} rowCount drifted`);
    return { partitionId, objectIds: normalizedIds, rowCount: partition.rowCount };
  }).sort((left, right) => left.partitionId.localeCompare(right.partitionId));
  const normalizedUnpartitioned = unpartitioned.map((objectId, index) => {
    const id = identifier(objectId, `partitionInventory.unpartitionedObjectIds[${index}]`);
    if (assigned.has(id)) fail('duplicate-inventory-object', `objectId ${id} appears more than once in partition inventory`);
    if (!objectsById.has(id)) fail('unknown-inventory-object', `partition inventory refers to unknown objectId ${id}`);
    assigned.add(id);
    return id;
  }).sort();
  if (assigned.size !== objects.length) {
    const missing = objects.filter(({ objectId }) => !assigned.has(objectId)).map(({ objectId }) => objectId);
    fail('incomplete-partition-inventory', `partition inventory is missing objectIds: ${missing.join(',')}`);
  }
  const totals = objects.reduce((result, object) => ({
    totalBytes: result.totalBytes + object.bytes,
    totalRowCount: result.totalRowCount + (object.rowCount ?? 0),
  }), { totalBytes: 0, totalRowCount: 0 });
  if (!Number.isSafeInteger(totals.totalBytes) || !Number.isSafeInteger(totals.totalRowCount)) {
    fail('invalid-count', 'partition inventory totals exceed the safe integer range');
  }
  nonNegativeSafeInteger(inventory.totalObjectCount, 'partitionInventory.totalObjectCount');
  nonNegativeSafeInteger(inventory.totalBytes, 'partitionInventory.totalBytes');
  nonNegativeSafeInteger(inventory.totalRowCount, 'partitionInventory.totalRowCount');
  if (inventory.totalObjectCount !== objects.length) fail('inventory-object-count-drift', 'partitionInventory.totalObjectCount drifted');
  if (inventory.totalBytes !== totals.totalBytes) fail('inventory-bytes-drift', 'partitionInventory.totalBytes drifted');
  if (inventory.totalRowCount !== totals.totalRowCount) fail('inventory-row-count-drift', 'partitionInventory.totalRowCount drifted');
  return {
    partitions: normalizedPartitions,
    unpartitionedObjectIds: normalizedUnpartitioned,
    totalObjectCount: inventory.totalObjectCount,
    totalBytes: inventory.totalBytes,
    totalRowCount: inventory.totalRowCount,
  };
}

function normalizeRetention(value) {
  const retention = exactDataObject(value, [
    'state', 'decisionOwner', 'deletePrerequisites',
  ], 'retention');
  if (!RETENTION_STATES.has(retention.state)) {
    fail('unsupported-retention-state', 'retention.state must remain hold, retained, or review-required');
  }
  const prerequisites = cloneData(retention.deletePrerequisites, 'retention.deletePrerequisites');
  if (!Array.isArray(prerequisites) || prerequisites.length === 0) {
    fail('delete-prerequisites', 'retention.deletePrerequisites must be non-empty');
  }
  const normalizedPrerequisites = prerequisites.map((entry, index) => (
    identifier(entry, `retention.deletePrerequisites[${index}]`)
  ));
  if (new Set(normalizedPrerequisites).size !== normalizedPrerequisites.length) {
    fail('duplicate-delete-prerequisite', 'retention.deletePrerequisites must be unique');
  }
  for (const required of REQUIRED_DELETE_PREREQUISITES) {
    if (!normalizedPrerequisites.includes(required)) {
      fail('delete-prerequisites', `retention.deletePrerequisites must include ${required}`);
    }
  }
  return {
    state: retention.state,
    decisionOwner: identifier(retention.decisionOwner, 'retention.decisionOwner'),
    deletePrerequisites: normalizedPrerequisites.sort(),
  };
}

function normalizeAuthority(value) {
  const authority = exactDataObject(value, ['serving', 'promotion', 'deletion'], 'authority');
  for (const [name, granted] of Object.entries(authority)) {
    if (granted !== false) fail('authority-forbidden', `authority.${name} must be exactly false in ArtifactRegistry/v1`);
  }
  return { serving: false, promotion: false, deletion: false };
}

function identifier(value, label) {
  return boundedText(value, label, { max: 128, pattern: IDENTIFIER_PATTERN });
}

function assertDigest(value, label) {
  boundedText(value, label, { max: 71, pattern: SHA256_PATTERN });
}

function safeRelativePath(value, label) {
  const path = boundedText(value, label, { max: 512, pattern: RELATIVE_PATH_PATTERN });
  if (SENSITIVE_LOCATION_PATTERN.test(path)) {
    fail('sensitive-location-value', `${label} must not embed credential or private-key material`);
  }
  return path;
}

function safeImmutableHttpsBase(value, label) {
  const baseUrl = boundedText(value, label, { max: 2_048 });
  if (baseUrl.includes('%')) fail('non-canonical-location-url', `${label} must not contain percent-encoded path material`);
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    fail('invalid-location-url', `${label} must be an absolute HTTPS URL`);
  }
  if (parsed.protocol !== 'https:') fail('unsupported-location-scheme', `${label} must use https`);
  if (parsed.username || parsed.password) fail('embedded-location-credential', `${label} must not contain user info`);
  if (parsed.search || parsed.hash) fail('embedded-location-credential', `${label} must not contain query or fragment material`);
  const hostname = parsed.hostname.toLowerCase();
  const ipCandidate = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (isIP(ipCandidate) || hostname === 'localhost' || hostname.endsWith('.localhost')
    || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    fail('private-location-host', `${label} must not embed a private or local host`);
  }
  if (!parsed.pathname.endsWith('/')) fail('invalid-location-url', `${label} must end with a slash`);
  const segments = parsed.pathname.split('/').filter(Boolean).map((segment) => segment.toLowerCase());
  if (segments.some((segment) => segment.split(/[-_.]/).some((token) => MUTABLE_URL_TOKENS.has(token)))) {
    fail('mutable-location-url', `${label} must not contain a mutable latest/current/head/live/main path token`);
  }
  if (SENSITIVE_LOCATION_PATTERN.test(parsed.pathname)) {
    fail('sensitive-location-value', `${label} must not embed credential or private-key material`);
  }
  if (parsed.href !== baseUrl) fail('non-canonical-location-url', `${label} must use canonical URL serialization`);
  return baseUrl;
}

function assertArgumentCount(args, expected, label) {
  if (args.length !== expected) fail('arguments', `${label} accepts exactly ${expected} argument${expected === 1 ? '' : 's'}`);
}
