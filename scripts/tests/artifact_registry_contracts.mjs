import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as artifactRegistry from '../lib/artifact_registry/index.mjs';

const {
  ARTIFACT_INVENTORY_COMPARISON_PROTOCOL,
  ARTIFACT_REGISTRY_PROTOCOL,
  REQUIRED_DELETE_PREREQUISITES,
  admitArtifactInventoryObservation,
  admitArtifactRegistry,
  compareArtifactRegistryInventoryObservation,
  createArtifactRegistry,
  parseArtifactRegistry,
  serializeArtifactRegistry,
} = artifactRegistry;

const fixtureRoot = new URL('../fixtures/artifact-registry-contracts/', import.meta.url);
const fileRegistryText = await readFile(new URL('valid-file-registry.json', fixtureRoot), 'utf8');
const httpsRegistryText = await readFile(new URL('valid-https-registry.json', fixtureRoot), 'utf8');
const observationText = await readFile(new URL('valid-inventory-observation.json', fixtureRoot), 'utf8');
const registrySchema = JSON.parse(await readFile(new URL('../data/artifact_registry.schema.json', import.meta.url), 'utf8'));
const fileRegistry = JSON.parse(fileRegistryText);
const httpsRegistry = JSON.parse(httpsRegistryText);
const observation = JSON.parse(observationText);

test('public ArtifactRegistry/v1 export surface is frozen', () => {
  assert.deepEqual(Object.keys(artifactRegistry).sort(), [
    'ARTIFACT_INVENTORY_OBSERVATION_PROTOCOL',
    'ARTIFACT_INVENTORY_COMPARISON_PROTOCOL',
    'ARTIFACT_REGISTRY_PROTOCOL',
    'ArtifactRegistryContractError',
    'REQUIRED_DELETE_PREREQUISITES',
    'admitArtifactInventoryObservation',
    'admitArtifactRegistry',
    'compareArtifactRegistryInventoryObservation',
    'createArtifactRegistry',
    'parseArtifactRegistry',
    'serializeArtifactRegistry',
  ].sort());
});

test('published JSON schema freezes the v1 protocol, strict objects, locations, and all authority false', () => {
  assert.equal(registrySchema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(registrySchema.additionalProperties, false);
  assert.match(registrySchema.$comment, /MUST run admitArtifactRegistry/);
  assert.equal(registrySchema.properties.protocol.const, ARTIFACT_REGISTRY_PROTOCOL);
  assert.ok(registrySchema.required.includes('partitionInventory'));
  assert.ok(registrySchema.required.includes('registryIdentity'));
  assert.equal(registrySchema.properties.locations.allOf.length, 2);
  assert.equal(registrySchema.properties.objects.uniqueItems, true);
  assert.equal(registrySchema.definitions.sourceScope.additionalProperties, false);
  assert.equal(registrySchema.definitions.artifactObject.additionalProperties, false);
  assert.equal(registrySchema.definitions.artifactObject.allOf.length, 1);
  assert.equal(registrySchema.definitions.fileLocation.properties.scheme.const, 'file');
  assert.equal(registrySchema.definitions.httpsLocation.properties.scheme.const, 'https');
  assert.equal(registrySchema.definitions.httpsLocation.properties.baseUrl.allOf.length, 2);
  assert.deepEqual(registrySchema.definitions.authority.properties, {
    serving: { const: false },
    promotion: { const: false },
    deletion: { const: false },
  });
});

test('ArtifactRegistry/v1 admits both supported location schemes and freezes all authority false', () => {
  for (const text of [fileRegistryText, httpsRegistryText]) {
    const registry = parseArtifactRegistry(text);
    assert.equal(registry.protocol, ARTIFACT_REGISTRY_PROTOCOL);
    assert.match(registry.registryIdentity, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(registry.authority, { serving: false, promotion: false, deletion: false });
    assert.ok(Object.isFrozen(registry));
    assert.ok(Object.isFrozen(registry.objects));
    assert.ok(Object.isFrozen(registry.partitionInventory.partitions));
    assert.throws(() => { registry.authority.serving = true; }, TypeError);
  }
});

test('canonical identity and serialization are stable across key and set-order changes', () => {
  const core = coreOf(fileRegistry);
  core.objects.reverse();
  core.partitionInventory.partitions.reverse();
  core.partitionInventory.unpartitionedObjectIds.reverse();
  core.retention.deletePrerequisites.reverse();
  const rebuilt = createArtifactRegistry(reverseObjectKeys(core));
  assert.equal(rebuilt.registryIdentity, fileRegistry.registryIdentity);
  assert.equal(serializeArtifactRegistry(rebuilt), serializeArtifactRegistry(fileRegistry));
});

test('registry identity binds source scope, four clocks, versions, locations, objects, inventory, retention, and authority', () => {
  for (const mutate of [
    (value) => { value.sourceScope.revision = 'synthetic-revision-20260821'; },
    (value) => { value.clocks.observedAt = '2026-08-24T00:00:00.000Z'; },
    (value) => { value.versions.transform.version = '1.0.1'; },
    (value) => { value.locations[0].basePath = 'artifact-sets/synthetic-area-intelligence-v2'; },
    (value) => { value.objects[0].bytes += 1; value.partitionInventory.totalBytes += 1; },
    (value) => { value.retention.state = 'hold'; },
  ]) {
    const changed = structuredClone(fileRegistry);
    mutate(changed);
    assert.throws(() => admitArtifactRegistry(changed), hasCode('registry-identity-drift'));
  }
});

test('strict parser rejects duplicate JSON keys before ordinary JSON parsing can erase them', () => {
  const duplicateProtocol = fileRegistryText.replace(
    '"protocol": "ArtifactRegistry/v1",',
    '"protocol": "ArtifactRegistry/v1",\n  "protocol": "ArtifactRegistry/v1",',
  );
  assert.throws(() => parseArtifactRegistry(duplicateProtocol), hasCode('duplicate-json-key'));
});

test('direct object ingress rejects Proxy and accessor values without executing getters', () => {
  assert.throws(() => admitArtifactRegistry(new Proxy(fileRegistry, {})), hasCode('proxy-object'));
  const hostile = structuredClone(fileRegistry);
  let getterExecutions = 0;
  Object.defineProperty(hostile, 'artifactSetId', {
    enumerable: true,
    get() {
      getterExecutions += 1;
      return fileRegistry.artifactSetId;
    },
  });
  assert.throws(() => admitArtifactRegistry(hostile), hasCode('accessor-property'));
  assert.equal(getterExecutions, 0);
});

test('unknown protocols and unknown fields fail closed at every strict boundary', () => {
  const future = structuredClone(fileRegistry);
  future.protocol = 'ArtifactRegistry/v2';
  assert.throws(() => admitArtifactRegistry(future), hasCode('unsupported-protocol'));

  const unknownTop = structuredClone(fileRegistry);
  unknownTop.provider = 'coupled-provider';
  assert.throws(() => admitArtifactRegistry(unknownTop), hasCode('schema-mismatch'));

  const unknownNested = structuredClone(fileRegistry);
  unknownNested.locations[0].credentialRef = 'secret-store';
  assert.throws(() => admitArtifactRegistry(unknownNested), hasCode('schema-mismatch'));

  const futureObservation = structuredClone(observation);
  futureObservation.protocol = 'ArtifactRegistryInventoryObservation/v2';
  assert.throws(() => admitArtifactInventoryObservation(futureObservation), hasCode('unsupported-observation-protocol'));
});

test('relative artifact and file-base paths reject traversal, absolute, drive, UNC, backslash, and non-canonical forms', () => {
  for (const unsafePath of [
    '../escape.json',
    'parts/../escape.json',
    '/absolute.json',
    'C:/private/artifact.json',
    '\\\\server\\share\\artifact.json',
    'parts\\artifact.json',
    'parts//artifact.json',
    './artifact.json',
  ]) {
    const changed = coreOf(fileRegistry);
    changed.objects[0].relativePath = unsafePath;
    assert.throws(() => createArtifactRegistry(changed), hasCode('invalid-text'), unsafePath);
  }
  for (const unsafeBase of ['../artifacts', '/artifacts', 'C:/artifacts', 'artifact-sets\\private']) {
    const changed = coreOf(fileRegistry);
    changed.locations[0].basePath = unsafeBase;
    assert.throws(() => createArtifactRegistry(changed), hasCode('invalid-text'), unsafeBase);
  }
});

test('duplicate object identity, path, and hash bindings are rejected', () => {
  for (const [code, mutate] of [
    ['duplicate-object-id', (copy) => {
      copy.objectId = 'manifest';
      copy.relativePath = 'metadata/second.json';
      copy.sha256 = digest('4');
    }],
    ['duplicate-object-path', (copy) => {
      copy.objectId = 'second-manifest';
      copy.sha256 = digest('4');
    }],
    ['duplicate-object-hash', (copy) => {
      copy.objectId = 'second-manifest';
      copy.relativePath = 'metadata/second.json';
    }],
  ]) {
    const changed = coreOf(fileRegistry);
    const copy = structuredClone(changed.objects[0]);
    mutate(copy);
    changed.objects.push(copy);
    assert.throws(() => createArtifactRegistry(changed), hasCode(code));
  }
});

test('complete partition inventory is mandatory and every object is assigned exactly once', () => {
  const missingInventory = coreOf(fileRegistry);
  delete missingInventory.partitionInventory;
  assert.throws(() => createArtifactRegistry(missingInventory), hasCode('schema-mismatch'));

  const incomplete = coreOf(fileRegistry);
  incomplete.partitionInventory.unpartitionedObjectIds = [];
  assert.throws(() => createArtifactRegistry(incomplete), hasCode('incomplete-partition-inventory'));

  const duplicate = coreOf(fileRegistry);
  duplicate.partitionInventory.unpartitionedObjectIds.push('part-000');
  assert.throws(() => createArtifactRegistry(duplicate), hasCode('duplicate-inventory-object'));

  const unknown = coreOf(fileRegistry);
  unknown.partitionInventory.unpartitionedObjectIds[0] = 'unknown-object';
  assert.throws(() => createArtifactRegistry(unknown), hasCode('unknown-inventory-object'));

  const unavailableRows = coreOf(fileRegistry);
  unavailableRows.objects.find(({ objectId }) => objectId === 'part-000').rowCount = null;
  assert.throws(() => createArtifactRegistry(unavailableRows), hasCode('partition-row-count-unavailable'));
});

test('partition and aggregate count or byte drift is rejected before identity creation', () => {
  for (const [code, mutate] of [
    ['partition-row-count-drift', (value) => { value.partitionInventory.partitions[0].rowCount += 1; }],
    ['inventory-object-count-drift', (value) => { value.partitionInventory.totalObjectCount += 1; }],
    ['inventory-bytes-drift', (value) => { value.partitionInventory.totalBytes += 1; }],
    ['inventory-row-count-drift', (value) => { value.partitionInventory.totalRowCount += 1; }],
  ]) {
    const changed = coreOf(fileRegistry);
    mutate(changed);
    assert.throws(() => createArtifactRegistry(changed), hasCode(code));
  }
});

test('rowCount is admitted only when restore v1 has a line-delimited verifier', () => {
  const unsupported = coreOf(fileRegistry);
  const manifest = unsupported.objects.find(({ mediaType }) => mediaType === 'application/json');
  manifest.rowCount = 1;
  unsupported.partitionInventory.totalRowCount += 1;
  assert.throws(
    () => createArtifactRegistry(unsupported),
    hasCode('row-count-verifier-unavailable'),
  );
});

test('https locations are immutable, canonical, public descriptions without embedded credentials', () => {
  for (const [code, baseUrl] of [
    ['mutable-location-url', 'https://artifacts.example.invalid/latest/synthetic-area-intelligence-v1/'],
    ['mutable-location-url', 'https://artifacts.example.invalid/immutable/model-latest/'],
    ['mutable-location-url', 'https://artifacts.example.invalid/immutable/latest.json/'],
    ['mutable-location-url', 'https://artifacts.example.invalid/immutable/main/'],
    ['embedded-location-credential', 'https://user:password@artifacts.example.invalid/immutable/set-v1/'],
    ['embedded-location-credential', 'https://artifacts.example.invalid/immutable/set-v1/?token=secret'],
    ['embedded-location-credential', 'https://artifacts.example.invalid/immutable/set-v1/#secret'],
    ['private-location-host', 'https://localhost/immutable/set-v1/'],
    ['private-location-host', 'https://127.0.0.1/immutable/set-v1/'],
    ['private-location-host', 'https://[::1]/immutable/set-v1/'],
    ['private-location-host', 'https://[fc00::1]/immutable/set-v1/'],
    ['private-location-host', 'https://[fe80::1]/immutable/set-v1/'],
    ['non-canonical-location-url', 'https://ARTIFACTS.example.invalid/immutable/set-v1/'],
  ]) {
    const changed = coreOf(httpsRegistry);
    changed.locations[0].baseUrl = baseUrl;
    assert.throws(() => createArtifactRegistry(changed), hasCode(code), baseUrl);
  }
  const insecure = coreOf(httpsRegistry);
  insecure.locations[0].baseUrl = 'http://artifacts.example.invalid/immutable/set-v1/';
  assert.throws(() => createArtifactRegistry(insecure), hasCode('unsupported-location-scheme'));
});

test('location inventory supports at most one descriptor per supported scheme', () => {
  const duplicateFile = coreOf(fileRegistry);
  duplicateFile.locations.push({ scheme: 'file', basePath: 'artifact-sets/second-v1' });
  assert.throws(() => createArtifactRegistry(duplicateFile), hasCode('duplicate-location-scheme'));

  const both = coreOf(fileRegistry);
  both.locations.push(structuredClone(httpsRegistry.locations[0]));
  const created = createArtifactRegistry(both);
  assert.deepEqual(created.locations.map(({ scheme }) => scheme), ['file', 'https']);
});

test('four clocks require exact UTC timestamps and provenance order', () => {
  const malformed = coreOf(fileRegistry);
  malformed.clocks.builtAt = '2026-08-22';
  assert.throws(() => createArtifactRegistry(malformed), hasCode('invalid-clock'));

  const reversed = coreOf(fileRegistry);
  reversed.clocks.retrievedAt = '2026-08-24T00:00:00.000Z';
  assert.throws(() => createArtifactRegistry(reversed), hasCode('clock-order'));
});

test('producer, schema, and transform versions are all mandatory exact bindings', () => {
  for (const component of ['producer', 'schema', 'transform']) {
    const missing = coreOf(fileRegistry);
    delete missing.versions[component];
    assert.throws(() => createArtifactRegistry(missing), hasCode('schema-mismatch'));
  }
  const unknown = coreOf(fileRegistry);
  unknown.versions.producer.commit = 'unbound-extra-version';
  assert.throws(() => createArtifactRegistry(unknown), hasCode('schema-mismatch'));
});

test('retention requires an explicit owner and every deletion prerequisite while granting no deletion authority', () => {
  assert.deepEqual(fileRegistry.retention.deletePrerequisites, [...REQUIRED_DELETE_PREREQUISITES]);
  for (const prerequisite of REQUIRED_DELETE_PREREQUISITES) {
    const missing = coreOf(fileRegistry);
    missing.retention.deletePrerequisites = missing.retention.deletePrerequisites.filter((entry) => entry !== prerequisite);
    assert.throws(() => createArtifactRegistry(missing), hasCode('delete-prerequisites'));
  }
  const unsupportedState = coreOf(fileRegistry);
  unsupportedState.retention.state = 'delete-approved';
  assert.throws(() => createArtifactRegistry(unsupportedState), hasCode('unsupported-retention-state'));
  for (const authority of ['serving', 'promotion', 'deletion']) {
    const granted = coreOf(fileRegistry);
    granted.authority[authority] = true;
    assert.throws(() => createArtifactRegistry(granted), hasCode('authority-forbidden'));
  }
});

test('inventory comparison matches caller observation without claiming artifact verification or reading locations', () => {
  const result = compareArtifactRegistryInventoryObservation(fileRegistry, observation);
  assert.equal(result.protocol, ARTIFACT_INVENTORY_COMPARISON_PROTOCOL);
  assert.equal(result.matched, true);
  assert.equal(result.basis, 'caller-supplied-observation');
  assert.equal(Object.hasOwn(result, 'verified'), false);
  assert.equal(result.objectCount, 3);
  assert.equal(result.partitionCount, 2);
  assert.equal(result.totalBytes, 768);
  assert.equal(result.totalRowCount, 5);
  assert.deepEqual(result.authority, { serving: false, promotion: false, deletion: false });
  assert.ok(Object.isFrozen(result));
});

test('inventory comparison rejects missing objects and path, bytes, hash, count, or partition drift', () => {
  const missing = structuredClone(observation);
  missing.objects = missing.objects.filter(({ objectId }) => objectId !== 'part-001');
  missing.partitionInventory.partitions = missing.partitionInventory.partitions.filter(({ partitionId }) => partitionId !== 'partition-001');
  missing.partitionInventory.totalObjectCount -= 1;
  missing.partitionInventory.totalBytes -= 384;
  missing.partitionInventory.totalRowCount -= 3;
  assert.throws(() => compareArtifactRegistryInventoryObservation(fileRegistry, missing), hasCode('object-inventory-drift'));

  const pathDrift = structuredClone(observation);
  pathDrift.objects[0].relativePath = 'metadata/renamed-manifest.json';
  assert.throws(() => compareArtifactRegistryInventoryObservation(fileRegistry, pathDrift), hasCode('object-path-drift'));

  const bytesDrift = structuredClone(observation);
  bytesDrift.objects[0].bytes += 1;
  bytesDrift.partitionInventory.totalBytes += 1;
  assert.throws(() => compareArtifactRegistryInventoryObservation(fileRegistry, bytesDrift), hasCode('object-bytes-drift'));

  const hashDrift = structuredClone(observation);
  hashDrift.objects[0].sha256 = digest('4');
  assert.throws(() => compareArtifactRegistryInventoryObservation(fileRegistry, hashDrift), hasCode('object-hash-drift'));

  const countDrift = structuredClone(observation);
  const observedPart = countDrift.objects.find(({ objectId }) => objectId === 'part-000');
  observedPart.rowCount += 1;
  countDrift.partitionInventory.partitions.find(({ partitionId }) => partitionId === 'partition-000').rowCount += 1;
  countDrift.partitionInventory.totalRowCount += 1;
  assert.throws(() => compareArtifactRegistryInventoryObservation(fileRegistry, countDrift), hasCode('object-row-count-drift'));

  const partitionDrift = structuredClone(observation);
  partitionDrift.partitionInventory.partitions[0].partitionId = 'partition-renamed';
  assert.throws(() => compareArtifactRegistryInventoryObservation(fileRegistry, partitionDrift), hasCode('partition-inventory-drift'));
});

test('inventory observation cannot be replayed against another registry identity or artifact set', () => {
  const wrongIdentity = structuredClone(observation);
  wrongIdentity.registryIdentity = httpsRegistry.registryIdentity;
  assert.throws(
    () => compareArtifactRegistryInventoryObservation(fileRegistry, wrongIdentity),
    hasCode('observation-registry-identity-drift'),
  );
  const wrongSet = structuredClone(observation);
  wrongSet.artifactSetId = 'artifact-set:another-synthetic-set';
  assert.throws(() => compareArtifactRegistryInventoryObservation(fileRegistry, wrongSet), hasCode('artifact-set-drift'));
});

function coreOf(registry) {
  const core = structuredClone(registry);
  delete core.registryIdentity;
  return core;
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, nested]) => [key, reverseObjectKeys(nested)]));
}

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function hasCode(code) {
  return (error) => error?.code === code;
}
