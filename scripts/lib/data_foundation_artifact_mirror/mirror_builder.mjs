import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  parseArtifactRegistry,
  serializeArtifactRegistry,
} from '../artifact_registry/index.mjs';

export const DATA_FOUNDATION_ARTIFACT_MIRROR_RESULT_PROTOCOL = 'DataFoundationArtifactMirrorResult/v1';
const BUNDLE_PROTOCOL = 'DataFoundationArtifactBundle/v1';
const FALSE_AUTHORITY = Object.freeze({ serving: false, promotion: false, deletion: false });

export class DataFoundationArtifactMirrorError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'DataFoundationArtifactMirrorError';
    this.code = code;
  }
}

export async function mirrorDataFoundationArtifacts({
  bundleDir,
  m1SourceRoot,
  m2SourceRoot,
  protocolSource,
  mirrorRoot,
}, { statfs = fs.statfs } = {}) {
  for (const [name, value] of Object.entries({ bundleDir, m1SourceRoot, m2SourceRoot, protocolSource, mirrorRoot })) {
    if (typeof value !== 'string' || !value) fail('missing-option', `${name} is required.`);
  }
  const finalRoot = path.resolve(mirrorRoot);
  assertNonRoot(finalRoot, 'mirror-root');
  if (await lstatMaybe(finalRoot)) fail('target-exists', 'Mirror target already exists.');
  const parent = path.dirname(finalRoot);
  await assertRealDirectory(parent, 'mirror-parent');

  const admitted = await admitInputs(path.resolve(bundleDir));
  const plans = buildPlans({ ...admitted, m1SourceRoot, m2SourceRoot, protocolSource, finalRoot });
  const declaredBytes = declaredRegistryBytes(admitted);
  await assertDestinationCapacity(parent, plans, declaredBytes, statfs);
  const staging = path.join(parent, `.${path.basename(finalRoot)}.staging-${randomUUID()}`);
  try {
    if (await lstatMaybe(staging)) fail('staging-exists', 'Generated staging directory already exists.');
    await fs.mkdir(staging, { recursive: false });
    let copiedBytes = 0;
    let copiedRows = 0;
    for (const plan of plans) {
      const source = plan.protocol
        ? await assertExactFile(path.resolve(protocolSource), 'protocol-source')
        : await resolveSafeSource(plan.sourceRoot, plan.object.relativePath);
      const destination = resolveContained(staging, plan.targetRelativePath, 'target-path-escape');
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const observation = await copyAndObserve(source, destination, plan.object.bytes, plan.object.rowCount !== null);
      verifyObservation(plan.object, observation);
      copiedBytes += observation.bytes;
      copiedRows += observation.rowCount ?? 0;
    }
    if (await lstatMaybe(finalRoot)) fail('target-exists', 'Mirror target appeared before promotion.');
    await fs.rename(staging, finalRoot);
    return Object.freeze({
      protocol: DATA_FOUNDATION_ARTIFACT_MIRROR_RESULT_PROTOCOL,
      status: 'mirrored',
      bundleId: admitted.bundle.bundleId,
      registries: Object.freeze({
        m1: admitted.m1.registryIdentity,
        m2: admitted.m2.registryIdentity,
      }),
      objectCount: plans.length,
      bytes: copiedBytes,
      rowCount: copiedRows,
      authority: FALSE_AUTHORITY,
    });
  } catch (error) {
    let cleanupError;
    try {
      await fs.rm(staging, { recursive: true, force: true });
    } catch (candidate) {
      cleanupError = candidate;
    }
    if (cleanupError) {
      throw new DataFoundationArtifactMirrorError(
        'staging-cleanup-failed',
        'Artifact mirror failed and its private staging directory could not be removed.',
        { cause: new AggregateError([error, cleanupError]) },
      );
    }
    throw asMirrorError(error);
  }
}

function declaredRegistryBytes({ m1, m2 }) {
  let combined = 0n;
  for (const [name, registry] of [['m1', m1], ['m2', m2]]) {
    const declared = registry?.partitionInventory?.totalBytes;
    if (!Number.isSafeInteger(declared) || declared < 0) {
      fail('registry-bytes-unsafe', `${name} registry totalBytes must be a non-negative safe integer.`);
    }
    let observed = 0;
    for (const object of registry.objects) {
      if (!Number.isSafeInteger(object.bytes) || object.bytes < 0 || !Number.isSafeInteger(observed + object.bytes)) {
        fail('registry-bytes-unsafe', `${name} registry object bytes exceed the safe-integer range.`);
      }
      observed += object.bytes;
    }
    if (observed !== declared) fail('registry-bytes-drift', `${name} registry totalBytes does not reconcile with its objects.`);
    combined += BigInt(declared);
  }
  return combined;
}

async function assertDestinationCapacity(parent, plans, declaredBytes, statfs) {
  if (typeof statfs !== 'function') fail('free-space-unavailable', 'Destination free space cannot be measured on this runtime.');
  let capacity;
  try {
    capacity = await statfs(parent, { bigint: true });
  } catch (error) {
    throw new DataFoundationArtifactMirrorError('free-space-unavailable', 'Destination free space could not be measured.', { cause: error });
  }
  const { bavail, bsize } = capacity || {};
  if (typeof bavail !== 'bigint' || typeof bsize !== 'bigint' || bavail < 0n || bsize <= 0n) {
    fail('free-space-unavailable', 'Destination free-space measurement was not a valid BigInt statfs result.');
  }
  const availableBytes = bavail * bsize;
  let requiredBytes = bsize;
  let plannedBytes = 0n;
  const directories = new Set();
  for (const plan of plans) {
    const objectBytes = BigInt(plan.object.bytes);
    plannedBytes += objectBytes;
    const dataBlocks = objectBytes === 0n ? 0n : (objectBytes + bsize - 1n) / bsize;
    requiredBytes += (dataBlocks + 1n) * bsize;
    const segments = path.posix.dirname(plan.targetRelativePath).split('/');
    let directory = '';
    for (const segment of segments) {
      if (!segment || segment === '.') continue;
      directory = directory ? `${directory}/${segment}` : segment;
      directories.add(directory);
    }
  }
  requiredBytes += BigInt(directories.size) * bsize;
  if (plannedBytes !== declaredBytes) fail('registry-bytes-drift', 'Combined registry totalBytes does not reconcile with the mirror plan.');
  if (requiredBytes > availableBytes) {
    fail('insufficient-destination-space', 'Destination does not have enough available space for the declared mirror and conservative allocation overhead.');
  }
}

async function admitInputs(bundleDir) {
  await assertRealDirectory(bundleDir, 'bundle-dir');
  const bundlePath = await resolveSafeSource(bundleDir, 'bundle.json');
  const bundle = await readJson(bundlePath, 'invalid-bundle-json');
  requireExactKeys(bundle, ['protocol', 'bundleId', 'createdAt', 'registryFiles', 'inventories', 'restoreVerification', 'authority'], 'bundle');
  if (bundle.protocol !== BUNDLE_PROTOCOL) fail('unsupported-bundle-protocol', `Bundle protocol must equal ${BUNDLE_PROTOCOL}.`);
  if (!sameAuthority(bundle.authority)) fail('authority-forbidden', 'Bundle authority must be exactly false.');
  requireExactKeys(bundle.registryFiles, ['m1', 'm2'], 'bundle.registryFiles');
  if (bundle.registryFiles.m1 !== 'm1.registry.json' || bundle.registryFiles.m2 !== 'm2.registry.json') {
    fail('registry-file-drift', 'Bundle registry filenames drifted from their exact standalone names.');
  }
  requireExactKeys(bundle.inventories, ['m1', 'm2'], 'bundle.inventories');
  const m1Path = await resolveSafeSource(bundleDir, bundle.registryFiles.m1);
  const m2Path = await resolveSafeSource(bundleDir, bundle.registryFiles.m2);
  let m1;
  let m2;
  try {
    [m1, m2] = await Promise.all([
      fs.readFile(m1Path, 'utf8').then(parseArtifactRegistry),
      fs.readFile(m2Path, 'utf8').then(parseArtifactRegistry),
    ]);
  } catch (error) {
    throw new DataFoundationArtifactMirrorError('invalid-registry', 'Standalone ArtifactRegistry/v1 admission failed.', { cause: error });
  }
  for (const [name, inventory, registry] of [['m1', bundle.inventories.m1, m1], ['m2', bundle.inventories.m2, m2]]) {
    if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) fail('bundle-inventory-drift', `Bundle ${name} inventory is invalid.`);
    if (!inventory.registry || serializeArtifactRegistry(inventory.registry) !== serializeArtifactRegistry(registry)) {
      fail('bundle-registry-drift', `Bundle ${name} registry does not exactly match its standalone registry.`);
    }
    if (!sameAuthority(registry.authority)) fail('authority-forbidden', `${name} registry authority must be exactly false.`);
  }
  const expectedBundleId = contentIdentity({ m1RegistryIdentity: m1.registryIdentity, m2RegistryIdentity: m2.registryIdentity });
  if (bundle.bundleId !== expectedBundleId) fail('bundle-identity-drift', 'Bundle identity does not bind the standalone registry identities.');
  return { bundle, m1, m2 };
}

function buildPlans({ m1, m2, m1SourceRoot, m2SourceRoot, protocolSource, finalRoot }) {
  const m1Base = exactFileBase(m1, 'm1');
  const m2Base = exactFileBase(m2, 'm2');
  const bases = [m1Base, m2Base];
  assertNoPrefixCollision(bases, 'artifact-base-prefix-collision');
  const protocolObjects = m2.objects.filter(({ objectId }) => objectId === 'm2:protocol');
  if (protocolObjects.length !== 1) fail('protocol-object-drift', 'M2 registry must contain exactly one m2:protocol object.');
  const plans = [
    ...m1.objects.map((object) => planObject('m1', m1Base, m1SourceRoot, object, false)),
    ...m2.objects.map((object) => planObject('m2', m2Base, m2SourceRoot, object, object.objectId === 'm2:protocol')),
  ];
  assertNoPrefixCollision(plans.map(({ targetRelativePath }) => targetRelativePath), 'object-prefix-collision');
  for (const plan of plans) resolveContained(finalRoot, plan.targetRelativePath, 'target-path-escape');
  if (typeof protocolSource !== 'string' || !protocolSource) fail('missing-option', 'protocolSource is required.');
  return plans;
}

function planObject(set, base, sourceRoot, object, protocol) {
  return {
    set,
    sourceRoot: path.resolve(sourceRoot),
    protocol,
    object,
    targetRelativePath: path.posix.join(base, object.relativePath),
  };
}

function exactFileBase(registry, name) {
  const locations = registry.locations.filter(({ scheme }) => scheme === 'file');
  if (locations.length !== 1) fail('file-base-drift', `${name} registry must contain exactly one file base.`);
  return locations[0].basePath;
}

async function copyAndObserve(source, destination, expectedBytes, countRows) {
  const before = await fs.stat(source);
  const input = createReadStream(source);
  const output = await fs.open(destination, 'wx');
  const hash = createHash('sha256');
  let bytes = 0;
  let rowCount = 0;
  let lineLength = 0;
  let lastByte = null;
  try {
    for await (const chunk of input) {
      if (bytes + chunk.length > expectedBytes) {
        fail('object-bytes-limit', 'Source exceeded its registry-declared byte limit while it was being mirrored.');
      }
      hash.update(chunk);
      bytes += chunk.length;
      if (countRows) {
        let start = 0;
        for (;;) {
          const newline = chunk.indexOf(0x0a, start);
          if (newline === -1) {
            const length = chunk.length - start;
            if (length) lastByte = chunk.at(-1);
            lineLength += length;
            break;
          }
          const length = newline - start;
          if (length) lastByte = chunk[newline - 1];
          lineLength += length;
          if (lineLength - (lastByte === 0x0d ? 1 : 0) > 0) rowCount += 1;
          lineLength = 0;
          lastByte = null;
          start = newline + 1;
        }
      }
      await writeAll(output, chunk);
    }
    if (countRows && lineLength - (lastByte === 0x0d ? 1 : 0) > 0) rowCount += 1;
  } catch (error) {
    input.destroy();
    throw error;
  } finally {
    await output.close();
  }
  const after = await fs.stat(source);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
    fail('source-mutated', 'Source changed while it was being mirrored.');
  }
  return { bytes, sha256: `sha256:${hash.digest('hex')}`, rowCount: countRows ? rowCount : null };
}

async function writeAll(handle, chunk) {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
    if (bytesWritten <= 0) fail('mirror-write-failed', 'Mirror destination stopped accepting bytes.');
    offset += bytesWritten;
  }
}

function verifyObservation(expected, observed) {
  if (observed.bytes !== expected.bytes) fail('object-bytes-drift', `Object ${expected.objectId} byte count drifted.`);
  if (observed.sha256 !== expected.sha256) fail('object-hash-drift', `Object ${expected.objectId} hash drifted.`);
  if (observed.rowCount !== expected.rowCount) fail('object-row-count-drift', `Object ${expected.objectId} row count drifted.`);
}

async function resolveSafeSource(rootValue, relativePath) {
  const root = path.resolve(rootValue);
  await assertRealDirectory(root, 'source-root');
  const target = resolveContained(root, relativePath, 'source-path-escape');
  let cursor = root;
  for (const segment of relativePath.split('/')) {
    cursor = path.join(cursor, segment);
    const stat = await fs.lstat(cursor).catch((error) => {
      if (error?.code === 'ENOENT') fail('source-missing', 'A declared source object is missing.');
      throw error;
    });
    if (stat.isSymbolicLink()) fail('source-link-forbidden', 'Source object path contains a symlink or junction.');
    if (cursor === target ? !stat.isFile() : !stat.isDirectory()) fail('source-type-drift', 'Source object path has an unexpected filesystem type.');
  }
  const real = await fs.realpath(target);
  if (!samePath(real, target)) fail('source-link-forbidden', 'Source object resolves through a symlink or junction.');
  return target;
}

async function assertExactFile(target, label) {
  const stat = await fs.lstat(target).catch((error) => {
    if (error?.code === 'ENOENT') fail('source-missing', `${label} is missing.`);
    throw error;
  });
  if (!stat.isFile() || stat.isSymbolicLink()) fail('source-link-forbidden', `${label} must be an exact regular file.`);
  const real = await fs.realpath(target);
  if (!samePath(real, target)) fail('source-link-forbidden', `${label} resolves through a symlink or junction.`);
  return target;
}

async function assertRealDirectory(target, label) {
  const stat = await fs.lstat(target).catch((error) => {
    if (error?.code === 'ENOENT') fail('directory-missing', `${label} does not exist.`);
    throw error;
  });
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('directory-link-forbidden', `${label} must be a real directory.`);
  const real = await fs.realpath(target);
  if (!samePath(real, target)) fail('directory-link-forbidden', `${label} resolves through a symlink or junction.`);
}

function resolveContained(root, relativePath, code) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\\')) fail(code, 'Path is not canonical relative POSIX form.');
  const resolved = path.resolve(root, ...relativePath.split('/'));
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail(code, 'Path escaped its declared root.');
  return resolved;
}

function assertNoPrefixCollision(values, code) {
  const sorted = values.map((value) => value.toLowerCase()).sort();
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1] || sorted[index].startsWith(`${sorted[index - 1]}/`)) {
      fail(code, 'Artifact paths contain a duplicate or file/directory prefix collision.');
    }
  }
}

function requireExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('bundle-shape-drift', `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail('bundle-shape-drift', `${label} keys drifted.`);
}

function sameAuthority(value) {
  return value && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(['deletion', 'promotion', 'serving'])
    && value.serving === false && value.promotion === false && value.deletion === false;
}

function contentIdentity(value) {
  return `sha256:${createHash('sha256').update(stableSerialization(value)).digest('hex')}`;
}

function stableSerialization(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialization).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialization(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function readJson(target, code) {
  try { return JSON.parse(await fs.readFile(target, 'utf8')); } catch (error) { throw new DataFoundationArtifactMirrorError(code, 'JSON admission failed.', { cause: error }); }
}

function assertNonRoot(target, label) {
  if (target === path.parse(target).root) fail('unsafe-target', `${label} cannot be a filesystem root.`);
}

function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function lstatMaybe(target) {
  return fs.lstat(target).catch((error) => { if (error?.code === 'ENOENT') return null; throw error; });
}

function asMirrorError(error) {
  return error instanceof DataFoundationArtifactMirrorError
    ? error
    : new DataFoundationArtifactMirrorError('mirror-failed', 'Artifact mirror failed closed.', { cause: error });
}

function fail(code, message) {
  throw new DataFoundationArtifactMirrorError(code, message);
}
