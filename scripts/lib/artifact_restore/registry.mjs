import { restoreError } from './errors.mjs';
import { canonicalTargetKey, validateRelativeArtifactPath } from './safe_paths.mjs';
import { validateHttpsLocation } from './transport.mjs';

export const ARTIFACT_REGISTRY_PROTOCOL = 'ArtifactRegistry/v1';
const LINE_ROW_MEDIA_TYPES = new Set([
  'application/jsonl',
  'application/ndjson',
  'application/x-ndjson',
]);

export async function parseRestoreRegistry(text, options = {}, {
  parseArtifactRegistry = undefined,
} = {}) {
  const parse = parseArtifactRegistry ?? await loadPublicContract('parseArtifactRegistry');
  let admitted;
  try {
    admitted = parse(text);
  } catch (error) {
    throw contractError(error);
  }
  return projectRestoreRegistry(admitted, options);
}

export async function admitRestoreRegistry(value, options = {}, {
  admitArtifactRegistry = undefined,
} = {}) {
  const admit = admitArtifactRegistry ?? await loadPublicContract('admitArtifactRegistry');
  let admitted;
  try {
    admitted = admit(value);
  } catch (error) {
    throw contractError(error);
  }
  return projectRestoreRegistry(admitted, options);
}

export function projectRestoreRegistry(registry, {
  locationScheme = undefined,
  platform = process.platform,
} = {}) {
  if (!registry || registry.protocol !== ARTIFACT_REGISTRY_PROTOCOL
    || typeof registry.artifactSetId !== 'string'
    || typeof registry.registryIdentity !== 'string'
    || !Array.isArray(registry.locations) || !Array.isArray(registry.objects)) {
    throw restoreError(
      'REGISTRY_PROJECTION_FAILED',
      'Public ArtifactRegistry/v1 admission did not return the frozen registry shape.',
    );
  }
  if (registry.authority?.serving !== false || registry.authority?.promotion !== false
    || registry.authority?.deletion !== false) {
    throw restoreError('AUTHORITY_FORBIDDEN', 'Registry authority must remain exactly all false.');
  }

  const location = selectLocation(registry.locations, locationScheme);
  const targetKeys = new Set();
  const paths = [];
  const objects = registry.objects.map((object) => {
    const relativePath = validateRelativeArtifactPath(object.relativePath, `${object.objectId} path`);
    const key = canonicalTargetKey(relativePath, platform);
    if (targetKeys.has(key)) {
      throw restoreError('DUPLICATE_TARGET', 'Registry contains duplicate canonical restore targets.');
    }
    targetKeys.add(key);
    paths.push(relativePath);
    const expected = {
      bytes: object.bytes,
      sha256: object.sha256,
      ...(object.rowCount === null ? {} : { row_count: object.rowCount }),
    };
    if (object.rowCount !== null && !LINE_ROW_MEDIA_TYPES.has(object.mediaType)
      && !relativePath.endsWith('.jsonl') && !relativePath.endsWith('.ndjson')) {
      throw restoreError(
        'ROW_COUNT_VERIFIER_UNAVAILABLE',
        'rowCount is supported only for line-delimited JSON artifacts in restore v1.',
      );
    }
    const source = location.scheme === 'file'
      ? {
          scheme: 'file',
          path: validateRelativeArtifactPath(
            `${location.basePath}/${relativePath}`,
            `${object.objectId} file location`,
          ),
        }
      : {
          scheme: 'https',
          url: validateHttpsLocation(new URL(relativePath, location.baseUrl).href).href,
        };
    return Object.freeze({
      object_id: object.objectId,
      path: relativePath,
      media_type: object.mediaType,
      expected: Object.freeze(expected),
      source: Object.freeze(source),
    });
  });
  rejectTargetPrefixConflicts(paths, platform);
  objects.sort((left, right) => left.path.localeCompare(right.path));

  return Object.freeze({
    protocol: registry.protocol,
    artifact_set_id: registry.artifactSetId,
    registry_identity: registry.registryIdentity,
    location_scheme: location.scheme,
    objects: Object.freeze(objects),
    partition_inventory: deepFreeze(structuredClone(registry.partitionInventory)),
    retention: deepFreeze(structuredClone(registry.retention)),
    authority: deepFreeze(structuredClone(registry.authority)),
  });
}

async function loadPublicContract(exportName) {
  let contract;
  try {
    contract = await import('../artifact_registry/index.mjs');
  } catch (error) {
    throw restoreError(
      'REGISTRY_CONTRACT_UNAVAILABLE',
      'Frozen ArtifactRegistry/v1 public contract is unavailable in this checkout.',
      undefined,
      { cause: error },
    );
  }
  if (typeof contract[exportName] !== 'function') {
    throw restoreError(
      'REGISTRY_CONTRACT_UNAVAILABLE',
      `Frozen ArtifactRegistry/v1 contract does not export ${exportName}.`,
    );
  }
  return contract[exportName];
}

function selectLocation(locations, requested) {
  if (requested !== undefined && requested !== 'file' && requested !== 'https') {
    throw restoreError('INVALID_LOCATION_SELECTION', 'Location selection must be file or https.');
  }
  if (requested === undefined && locations.length !== 1) {
    throw restoreError(
      'AMBIGUOUS_LOCATION_SELECTION',
      'Registry has multiple locations; select file or https explicitly.',
    );
  }
  const selected = requested === undefined
    ? locations[0]
    : locations.find(({ scheme }) => scheme === requested);
  if (!selected) {
    throw restoreError('LOCATION_UNAVAILABLE', 'Requested registry location is unavailable.');
  }
  return selected;
}

function rejectTargetPrefixConflicts(paths, platform) {
  const keys = new Set(paths.map((entry) => canonicalTargetKey(entry, platform)));
  for (const entry of paths) {
    const segments = entry.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      if (keys.has(canonicalTargetKey(segments.slice(0, index).join('/'), platform))) {
        throw restoreError(
          'TARGET_PREFIX_CONFLICT',
          'Registry target path is both a file and an ancestor directory.',
        );
      }
    }
  }
}

function contractError(error) {
  if (error?.code === 'REGISTRY_CONTRACT_UNAVAILABLE') return error;
  return restoreError(
    'REGISTRY_CONTRACT_REJECTED',
    'Frozen ArtifactRegistry/v1 contract rejected the registry.',
    typeof error?.code === 'string' ? { contract_code: error.code } : undefined,
    { cause: error },
  );
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
