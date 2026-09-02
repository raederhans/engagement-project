import {
  admitArtifactRegistry,
} from './artifact_registry/index.mjs';
import {
  boundedText,
  cloneData,
  contentIdentity,
  exactDataObject,
  exactTimestamp,
  freezeData,
  nonNegativeSafeInteger,
} from './artifact_registry/safe_data.mjs';

export const ARTIFACT_OBJECT_CATALOG_PROTOCOL = 'ArtifactObjectCatalog/v1';
export const DATA_FOUNDATION_OPERATION_RECEIPT_PROTOCOL = 'DataFoundationOperationReceipt/v1';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const ENVIRONMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OPERATIONS = new Set([
  'clean-room-restore',
  'manual-rebuild',
  'scheduled-rebuild',
  'disaster-drill',
]);
const OBSERVATION_STATES = new Set(['observed', 'unavailable']);
const VERIFICATION_STATES = new Set(['passed', 'failed', 'unavailable']);

export function createArtifactObjectCatalog(registryValue) {
  const registry = admitArtifactRegistry(registryValue);
  const core = {
    protocol: ARTIFACT_OBJECT_CATALOG_PROTOCOL,
    registry_identity: registry.registryIdentity,
    artifact_set_id: registry.artifactSetId,
    key_template: 'objects/sha256/{first-two-hex}/{full-hex}',
    locations: registry.locations.map((location) => ({
      scheme: location.scheme,
      base: location.scheme === 'file' ? location.basePath : location.baseUrl,
    })),
    objects: registry.objects.map((object) => {
      const digest = object.sha256.slice('sha256:'.length);
      return {
        object_id: object.objectId,
        sha256: object.sha256,
        bytes: object.bytes,
        content_key: `objects/sha256/${digest.slice(0, 2)}/${digest}`,
      };
    }),
    registry_contains_secrets: false,
    provider_credentials_included: false,
    authority: { serving: false, promotion: false, deletion: false },
  };
  return admitArtifactObjectCatalog({ ...core, catalog_identity: contentIdentity(core) });
}

export function admitArtifactObjectCatalog(value) {
  const catalog = exactDataObject(value, [
    'protocol', 'registry_identity', 'artifact_set_id', 'key_template', 'locations', 'objects',
    'registry_contains_secrets', 'provider_credentials_included', 'authority', 'catalog_identity',
  ], 'artifact object catalog');
  if (catalog.protocol !== ARTIFACT_OBJECT_CATALOG_PROTOCOL) {
    throw new TypeError('Unsupported artifact object catalog protocol.');
  }
  requireDigest(catalog.registry_identity, 'registry_identity');
  boundedText(catalog.artifact_set_id, 'artifact_set_id', { max: 128 });
  if (catalog.key_template !== 'objects/sha256/{first-two-hex}/{full-hex}') {
    throw new TypeError('Artifact object catalog key template drifted.');
  }
  const locations = cloneData(catalog.locations, 'locations');
  if (!Array.isArray(locations) || locations.length < 1 || locations.length > 2) {
    throw new TypeError('Artifact object catalog requires one or two locations.');
  }
  const schemes = new Set();
  for (const [index, location] of locations.entries()) {
    const admitted = exactDataObject(location, ['scheme', 'base'], `locations[${index}]`);
    if (!['file', 'https'].includes(admitted.scheme) || schemes.has(admitted.scheme)) {
      throw new TypeError('Artifact object catalog location scheme is invalid or duplicated.');
    }
    boundedText(admitted.base, `locations[${index}].base`, { max: 2048 });
    schemes.add(admitted.scheme);
  }
  const objects = cloneData(catalog.objects, 'objects');
  if (!Array.isArray(objects) || objects.length === 0) {
    throw new TypeError('Artifact object catalog requires objects.');
  }
  const ids = new Set();
  const keys = new Set();
  for (const [index, object] of objects.entries()) {
    const admitted = exactDataObject(object, [
      'object_id', 'sha256', 'bytes', 'content_key',
    ], `objects[${index}]`);
    boundedText(admitted.object_id, `objects[${index}].object_id`, { max: 128 });
    requireDigest(admitted.sha256, `objects[${index}].sha256`);
    nonNegativeSafeInteger(admitted.bytes, `objects[${index}].bytes`);
    const digest = admitted.sha256.slice('sha256:'.length);
    if (admitted.content_key !== `objects/sha256/${digest.slice(0, 2)}/${digest}`) {
      throw new TypeError('Artifact object content key is not derived from its exact SHA-256.');
    }
    if (ids.has(admitted.object_id) || keys.has(admitted.content_key)) {
      throw new TypeError('Artifact object catalog identifiers and content keys must be unique.');
    }
    ids.add(admitted.object_id);
    keys.add(admitted.content_key);
  }
  if (catalog.registry_contains_secrets !== false || catalog.provider_credentials_included !== false) {
    throw new TypeError('Artifact object catalogs cannot contain registry secrets or provider credentials.');
  }
  assertAuthorityFalse(catalog.authority);
  requireDigest(catalog.catalog_identity, 'catalog_identity');
  const core = structuredClone(catalog);
  delete core.catalog_identity;
  if (catalog.catalog_identity !== contentIdentity(core)) {
    throw new TypeError('Artifact object catalog identity drifted.');
  }
  return freezeData(structuredClone(catalog), 'artifact object catalog');
}

export function createDataFoundationOperationReceipt(input) {
  const value = exactDataObject(input, [
    'registry_identity', 'object_catalog_identity', 'operation', 'environment', 'observation',
    'verification', 'metrics', 'disaster_drill', 'limitations',
  ], 'data foundation operation receipt input');
  requireDigest(value.registry_identity, 'registry_identity');
  requireDigest(value.object_catalog_identity, 'object_catalog_identity');
  if (!OPERATIONS.has(value.operation)) throw new TypeError('Unsupported data foundation operation.');

  const environment = normalizeEnvironment(value.environment);
  const observation = normalizeObservation(value.observation);
  const verification = normalizeVerification(value.verification, observation.status);
  const metrics = normalizeMetrics(value.metrics, observation, verification);
  const disasterDrill = normalizeDisasterDrill(value.disaster_drill, value.operation, observation.status);
  const limitations = normalizeLimitations(value.limitations);
  const core = {
    protocol: DATA_FOUNDATION_OPERATION_RECEIPT_PROTOCOL,
    registry_identity: value.registry_identity,
    object_catalog_identity: value.object_catalog_identity,
    operation: value.operation,
    environment,
    observation,
    verification,
    metrics,
    disaster_drill: disasterDrill,
    limitations,
    authority: { serving: false, promotion: false, deletion: false },
  };
  return freezeData({ ...core, receipt_identity: contentIdentity(core) }, 'data foundation operation receipt');
}

export function admitDataFoundationOperationReceipt(value) {
  const receipt = exactDataObject(value, [
    'protocol', 'registry_identity', 'object_catalog_identity', 'operation', 'environment',
    'observation', 'verification', 'metrics', 'disaster_drill', 'limitations', 'authority',
    'receipt_identity',
  ], 'data foundation operation receipt');
  if (receipt.protocol !== DATA_FOUNDATION_OPERATION_RECEIPT_PROTOCOL) {
    throw new TypeError('Unsupported data foundation operation receipt protocol.');
  }
  const rebuilt = createDataFoundationOperationReceipt({
    registry_identity: receipt.registry_identity,
    object_catalog_identity: receipt.object_catalog_identity,
    operation: receipt.operation,
    environment: receipt.environment,
    observation: receipt.observation,
    verification: receipt.verification,
    metrics: receipt.metrics,
    disaster_drill: receipt.disaster_drill,
    limitations: receipt.limitations,
  });
  assertAuthorityFalse(receipt.authority);
  requireDigest(receipt.receipt_identity, 'receipt_identity');
  if (receipt.receipt_identity !== rebuilt.receipt_identity) {
    throw new TypeError('Data foundation operation receipt identity drifted.');
  }
  return freezeData(structuredClone(receipt), 'data foundation operation receipt');
}

function normalizeEnvironment(value) {
  const environment = exactDataObject(value, [
    'environment_id', 'platform', 'runner_class', 'physical_environment_observed',
  ], 'operation environment');
  if (!ENVIRONMENT_ID.test(environment.environment_id)) {
    throw new TypeError('Operation environment identity is invalid.');
  }
  return {
    environment_id: environment.environment_id,
    platform: boundedText(environment.platform, 'environment.platform', { max: 128 }),
    runner_class: boundedText(environment.runner_class, 'environment.runner_class', { max: 128 }),
    physical_environment_observed: Boolean(environment.physical_environment_observed),
  };
}

function normalizeObservation(value) {
  const observation = exactDataObject(value, [
    'status', 'started_at', 'completed_at', 'reason',
  ], 'operation observation');
  if (!OBSERVATION_STATES.has(observation.status)) {
    throw new TypeError('Operation observation status is invalid.');
  }
  const reason = boundedText(observation.reason, 'observation.reason', { max: 500 });
  if (observation.status === 'unavailable') {
    if (observation.started_at !== null || observation.completed_at !== null) {
      throw new TypeError('Unavailable operation observation cannot contain execution clocks.');
    }
    return { status: 'unavailable', started_at: null, completed_at: null, reason };
  }
  const startedAt = exactTimestamp(observation.started_at, 'observation.started_at');
  const completedAt = exactTimestamp(observation.completed_at, 'observation.completed_at');
  if (completedAt < startedAt) throw new TypeError('Operation completion precedes start.');
  return { status: 'observed', started_at: startedAt, completed_at: completedAt, reason };
}

function normalizeVerification(value, observationStatus) {
  const verification = exactDataObject(value, [
    'status', 'object_count', 'registry_identity_matched', 'catalog_identity_matched',
  ], 'operation verification');
  if (!VERIFICATION_STATES.has(verification.status)) {
    throw new TypeError('Operation verification status is invalid.');
  }
  if (verification.object_count !== null) {
    nonNegativeSafeInteger(verification.object_count, 'verification.object_count');
  }
  if (observationStatus === 'unavailable') {
    if (verification.status !== 'unavailable' || verification.object_count !== null
      || verification.registry_identity_matched !== null
      || verification.catalog_identity_matched !== null) {
      throw new TypeError('Unavailable observation requires unavailable verification without inferred values.');
    }
  } else if (verification.status === 'passed') {
    if (verification.object_count === null || verification.registry_identity_matched !== true
      || verification.catalog_identity_matched !== true) {
      throw new TypeError('Passed verification requires exact object and identity observations.');
    }
  } else if (verification.status === 'unavailable') {
    throw new TypeError('Observed operation cannot use unavailable verification.');
  }
  return structuredClone(verification);
}

function normalizeMetrics(value, observation, verification) {
  const metrics = exactDataObject(value, [
    'duration_ms', 'downloaded_bytes', 'verified_bytes', 'verification_duration_ms',
    'peak_disk_bytes',
  ], 'operation metrics');
  for (const [name, metric] of Object.entries(metrics)) {
    if (metric !== null) nonNegativeSafeInteger(metric, `metrics.${name}`);
  }
  if (observation.status === 'unavailable') {
    if (Object.values(metrics).some((metric) => metric !== null)) {
      throw new TypeError('Unavailable observation cannot contain operational metrics.');
    }
  } else {
    if (Object.values(metrics).some((metric) => metric === null)) {
      throw new TypeError('Observed operation requires complete operational metrics.');
    }
    const observedDuration = Date.parse(observation.completed_at) - Date.parse(observation.started_at);
    if (metrics.duration_ms !== observedDuration) {
      throw new TypeError('Operation duration does not reconcile with observation clocks.');
    }
    if (verification.status === 'passed' && metrics.verified_bytes < metrics.downloaded_bytes) {
      throw new TypeError('Verified bytes cannot be less than downloaded bytes after a passed restore.');
    }
  }
  return structuredClone(metrics);
}

function normalizeDisasterDrill(value, operation, observationStatus) {
  if (value === null) {
    if (operation === 'disaster-drill' && observationStatus === 'observed') {
      throw new TypeError('Observed disaster drill requires missing and corrupted object outcomes.');
    }
    return null;
  }
  const drill = exactDataObject(value, [
    'missing_object', 'corrupted_object', 'downstream_build_started',
  ], 'disaster drill');
  for (const key of ['missing_object', 'corrupted_object']) {
    if (!['detected-and-blocked', 'unavailable'].includes(drill[key])) {
      throw new TypeError('Disaster drill outcome is invalid.');
    }
  }
  if (drill.downstream_build_started !== false) {
    throw new TypeError('Disaster drill must stop before downstream build.');
  }
  if (observationStatus === 'observed'
    && (drill.missing_object !== 'detected-and-blocked'
      || drill.corrupted_object !== 'detected-and-blocked')) {
    throw new TypeError('Observed disaster drill must detect and block both failure modes.');
  }
  return structuredClone(drill);
}

function normalizeLimitations(value) {
  const limitations = cloneData(value, 'limitations');
  if (!Array.isArray(limitations) || limitations.length === 0 || limitations.length > 16) {
    throw new TypeError('Operation receipt requires bounded limitations.');
  }
  return limitations.map((entry, index) => boundedText(entry, `limitations[${index}]`, { max: 500 }));
}

function assertAuthorityFalse(value) {
  const authority = exactDataObject(value, ['serving', 'promotion', 'deletion'], 'authority');
  if (Object.values(authority).some((entry) => entry !== false)) {
    throw new TypeError('Data foundation operational evidence grants no authority.');
  }
}

function requireDigest(value, label) {
  if (!SHA256.test(value || '')) throw new TypeError(`${label} must be a prefixed lowercase SHA-256.`);
}
