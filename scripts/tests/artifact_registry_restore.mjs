import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setImmediate as waitImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  assertVerifiedInventory,
  inspectTargetInventory,
  mapBounded,
  parseRestoreRegistry,
  projectRestoreRegistry,
  promoteDirectoryAtomic,
  stageFromLocation,
} from '../lib/artifact_restore/index.mjs';
import { main, parseArguments } from '../restore_data_artifacts.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = path.resolve(testDirectory, '../fixtures/artifact-registry-restore');
const fixtureRegistryPath = path.join(fixtureDirectory, 'registry-valid.json');
const contractUrl = process.env.ARTIFACT_REGISTRY_CONTRACT_URL
  ?? new URL('../lib/artifact_registry/index.mjs', import.meta.url).href;
const artifactContract = await import(contractUrl);
const fixtureRegistryText = await fs.readFile(fixtureRegistryPath, 'utf8');
const admittedFixture = artifactContract.parseArtifactRegistry(fixtureRegistryText);

test('CLI is explicit and fail closed before registry or target I/O', () => {
  assert.throws(() => parseArguments([]), matchesCode('MODE_REQUIRED'));
  assert.throws(
    () => parseArguments(['restore', '--registry=x.json', '--target=y', '--unknown=z']),
    matchesCode('INVALID_ARGUMENT'),
  );
  assert.throws(
    () => parseArguments(['restore', '--registry=x.json', '--target=y', '--concurrency=0']),
    matchesCode('INVALID_CONCURRENCY'),
  );
  assert.throws(
    () => parseArguments(['plan', '--registry=x.json', '--target=y', '--replace-existing']),
    matchesCode('INVALID_ARGUMENT'),
  );
  assert.throws(
    () => parseArguments(['restore', '--registry=x.json', '--target=y', '--replace-existing=true']),
    matchesCode('INVALID_ARGUMENT'),
  );
});

test('registry byte and canonical identity pins are checked at the CLI read boundary', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const metadata = await copyFixtureMetadata(workspace);
  const target = path.join(workspace, 'restored');
  const registryBytes = await fs.readFile(metadata.registry);
  const registrySha256 = createHash('sha256').update(registryBytes).digest('hex');

  await runMain([
    'plan', `--registry=${metadata.registry}`, `--target=${target}`, '--location=file',
    `--registry-sha256=${registrySha256}`,
    `--registry-identity=${admittedFixture.registryIdentity}`,
  ]);
  await assert.rejects(
    runMain([
      'plan', `--registry=${metadata.registry}`, `--target=${target}`, '--location=file',
      `--registry-sha256=${'0'.repeat(64)}`,
      `--registry-identity=${admittedFixture.registryIdentity}`,
    ]),
    matchesCode('REGISTRY_SHA256_MISMATCH'),
  );
  await assert.rejects(
    runMain([
      'plan', `--registry=${metadata.registry}`, `--target=${target}`, '--location=file',
      `--registry-sha256=${registrySha256}`,
      `--registry-identity=sha256:${'0'.repeat(64)}`,
    ]),
    matchesCode('REGISTRY_IDENTITY_MISMATCH'),
  );
});

test('restore adapter uses the public ArtifactRegistry/v1 parser and projects optional rowCount', async () => {
  let parserCalls = 0;
  const projected = await parseRestoreRegistry(
    fixtureRegistryText,
    { locationScheme: 'file' },
    {
      parseArtifactRegistry(text) {
        parserCalls += 1;
        return artifactContract.parseArtifactRegistry(text);
      },
    },
  );
  assert.equal(parserCalls, 1);
  assert.equal(projected.artifact_set_id, 'artifact-set:synthetic-clean-room-v1');
  assert.equal(projected.objects.length, 2);
  assert.deepEqual(projected.objects[0].expected, {
    bytes: 24,
    sha256: 'sha256:ea53e302cfffc8c76d7fdb7a9c80005c40a81ae2a2043f8650c0fdea6761cc8e',
  });
  assert.equal(projected.objects[1].expected.row_count, 2);

  const partial = JSON.stringify({ ...JSON.parse(fixtureRegistryText), objects: [] });
  await assert.rejects(
    parseRestoreRegistry(partial, { locationScheme: 'file' }, {
      parseArtifactRegistry: artifactContract.parseArtifactRegistry,
    }),
    matchesCode('REGISTRY_CONTRACT_REJECTED'),
  );
});

test('restore projection rejects traversal, canonical duplicates, and file-directory prefix conflicts', () => {
  const traversal = structuredClone(admittedFixture);
  traversal.locations = [{ scheme: 'file', basePath: '../source' }];
  assert.throws(
    () => projectRestoreRegistry(traversal, { locationScheme: 'file' }),
    matchesCode('UNSAFE_ARTIFACT_PATH'),
  );

  const duplicate = structuredClone(admittedFixture);
  duplicate.objects[1].relativePath = 'ALPHA.txt';
  assert.throws(
    () => projectRestoreRegistry(duplicate, { locationScheme: 'file', platform: 'win32' }),
    matchesCode('DUPLICATE_TARGET'),
  );

  const prefix = structuredClone(admittedFixture);
  prefix.objects[0].relativePath = 'rows.ndjson/child';
  assert.throws(
    () => projectRestoreRegistry(prefix, { locationScheme: 'file' }),
    matchesCode('TARGET_PREFIX_CONFLICT'),
  );
});

test('plan is read-only for a clean checkout with a missing target', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const metadata = await copyFixtureMetadata(workspace);
  const target = path.join(workspace, 'restored');
  const { result } = await runMain([
    'plan', `--registry=${metadata.registry}`, `--target=${target}`, '--location=file',
  ]);
  assert.equal(result.mode, 'plan');
  assert.equal(result.target_state, 'missing');
  assert.equal(result.counts.pending, 2);
  await assert.rejects(fs.lstat(target), { code: 'ENOENT' });
  assert.deepEqual(await restoreResidue(workspace, target), []);
});

test('explicit file-location-root separates metadata from artifact bytes', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const metadata = path.join(workspace, 'metadata');
  const mirror = path.join(workspace, 'mirror');
  const target = path.join(workspace, 'restored');
  await fs.mkdir(metadata);
  await fs.mkdir(path.join(mirror, 'source'), { recursive: true });
  await fs.copyFile(fixtureRegistryPath, path.join(metadata, 'registry.json'));
  await copyFixtureSources(path.join(mirror, 'source'));

  const { result } = await runMain([
    'restore',
    `--registry=${path.join(metadata, 'registry.json')}`,
    `--target=${target}`,
    '--location=file',
    `--file-location-root=${mirror}`,
    '--concurrency=2',
  ]);
  assert.equal(result.counts.restored, 2);
  assert.equal(result.counts.reused, 0);
  assert.equal(result.counts.promoted, true);
  assert.equal(await fs.readFile(path.join(target, 'alpha.txt'), 'utf8'), 'portable artifact alpha\n');
  assert.equal((await fs.readFile(path.join(target, 'rows.ndjson'), 'utf8')).split('\n').filter(Boolean).length, 2);
  assert.deepEqual(await restoreResidue(workspace, target), []);
});

test('existing partial targets fail closed unless replacement is explicitly authorized', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const metadata = await copyFixtureMetadata(workspace);
  const target = path.join(workspace, 'restored');
  await fs.mkdir(target);
  await fs.copyFile(path.join(metadata.directory, 'source', 'alpha.txt'), path.join(target, 'alpha.txt'));

  const before = await fs.readFile(path.join(target, 'alpha.txt'));
  await assert.rejects(
    runMain([
      'restore', `--registry=${metadata.registry}`, `--target=${target}`, '--location=file',
    ]),
    (error) => error?.code === 'TARGET_REPLACEMENT_NOT_AUTHORIZED'
      && error?.details?.registry_deletion_authority === false,
  );
  assert.deepEqual(await fs.readFile(path.join(target, 'alpha.txt')), before);
  await assert.rejects(fs.lstat(path.join(target, 'rows.ndjson')), { code: 'ENOENT' });
  assert.deepEqual(await restoreResidue(workspace, target), []);

  const first = await runMain([
    'restore', `--registry=${metadata.registry}`, `--target=${target}`, '--location=file',
    '--replace-existing',
  ]);
  assert.equal(first.result.counts.reused, 1);
  assert.equal(first.result.counts.restored, 1);
  assert.equal(first.result.target_state, 'complete');
  assert.equal(first.result.backup_cleanup, 'pending');
  const replacementResidue = await restoreResidue(workspace, target);
  const replacementBackups = replacementResidue.filter((name) => name.includes('.artifact-restore-backup-'));
  assert.equal(replacementBackups.length, 1);
  assert.deepEqual(
    await fs.readFile(path.join(workspace, replacementBackups[0], 'alpha.txt')),
    before,
  );

  const verified = await runMain([
    'verify', `--registry=${metadata.registry}`, `--target=${target}`, '--location=file',
  ]);
  assert.equal(verified.result.counts.verified, 2);
  const completedTimes = await fileTimes(target);
  const second = await runMain([
    'restore', `--registry=${metadata.registry}`, `--target=${target}`, '--location=file',
  ]);
  assert.equal(second.result.counts.no_op, true);
  assert.equal(second.result.counts.reused, 2);
  assert.equal(second.result.counts.restored, 0);
  assert.deepEqual(await fileTimes(target), completedTimes);
  assert.deepEqual(await restoreResidue(workspace, target), replacementResidue);
});

test('source corruption and row-count drift leave a missing target untouched', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const metadata = await copyFixtureMetadata(workspace);
  const corruptTarget = path.join(workspace, 'corrupt-target');
  await fs.writeFile(path.join(metadata.directory, 'source', 'alpha.txt'), 'corrupted source\n');
  await assert.rejects(
    runMain([
      'restore', `--registry=${metadata.registry}`, `--target=${corruptTarget}`, '--location=file',
    ]),
    matchesCode('ARTIFACT_INTEGRITY_MISMATCH'),
  );
  await assert.rejects(fs.lstat(corruptTarget), { code: 'ENOENT' });
  assert.deepEqual(await restoreResidue(workspace, corruptTarget), []);

  const rowWorkspace = await temporaryWorkspace(t);
  const rowMetadata = await copyFixtureMetadata(rowWorkspace);
  const core = registryCore();
  core.objects.find(({ objectId }) => objectId === 'rows').rowCount = 3;
  core.partitionInventory.partitions[0].rowCount = 3;
  core.partitionInventory.totalRowCount = 3;
  const rowRegistry = artifactContract.createArtifactRegistry(core);
  await fs.writeFile(rowMetadata.registry, `${JSON.stringify(rowRegistry)}\n`);
  const rowTarget = path.join(rowWorkspace, 'row-target');
  await assert.rejects(
    runMain([
      'restore', `--registry=${rowMetadata.registry}`, `--target=${rowTarget}`, '--location=file',
    ]),
    (error) => error?.code === 'ARTIFACT_INTEGRITY_MISMATCH'
      && error.details?.mismatches?.includes('row_count'),
  );
  await assert.rejects(fs.lstat(rowTarget), { code: 'ENOENT' });
});

test('verify reports corruption without repairing or rewriting it', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const metadata = await copyFixtureMetadata(workspace);
  const target = path.join(workspace, 'restored');
  await runMain([
    'restore', `--registry=${metadata.registry}`, `--target=${target}`, '--location=file',
  ]);
  await fs.writeFile(path.join(target, 'alpha.txt'), 'target corruption\n');
  const corruptBytes = await fs.readFile(path.join(target, 'alpha.txt'));
  await assert.rejects(
    runMain([
      'verify', `--registry=${metadata.registry}`, `--target=${target}`, '--location=file',
    ]),
    matchesCode('TARGET_NOT_VERIFIED'),
  );
  assert.deepEqual(await fs.readFile(path.join(target, 'alpha.txt')), corruptBytes);
});

test('injected promotion failure rolls the prior target back without residue', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const metadata = await copyFixtureMetadata(workspace);
  const target = path.join(workspace, 'restored');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'alpha.txt'), 'old alpha\n');
  await fs.writeFile(path.join(target, 'rows.ndjson'), '{"old":true}\n');
  const before = await readTargetBytes(target);
  let renameCalls = 0;
  const failingFileSystem = new Proxy(fs, {
    get(fileSystem, property) {
      if (property !== 'rename') return Reflect.get(fileSystem, property);
      return async (source, destination) => {
        renameCalls += 1;
        if (renameCalls === 2) {
          const error = new Error('injected stage promotion failure');
          error.code = 'EIO';
          throw error;
        }
        return fs.rename(source, destination);
      };
    },
  });
  await assert.rejects(
    runMain([
      'restore', `--registry=${metadata.registry}`, `--target=${target}`, '--location=file',
      '--replace-existing',
    ], {
      promote: (options) => promoteDirectoryAtomic({ ...options, fileSystem: failingFileSystem }),
    }),
    matchesCode('PROMOTION_FAILED'),
  );
  assert.deepEqual(await readTargetBytes(target), before);
  assert.deepEqual(await restoreResidue(workspace, target), []);
});

test('file-location-root rejects HTTPS misuse and symlink or junction roots', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const metadata = path.join(workspace, 'metadata');
  const realMirror = path.join(workspace, 'real-mirror');
  const linkedMirror = path.join(workspace, 'linked-mirror');
  await fs.mkdir(metadata);
  await fs.mkdir(path.join(realMirror, 'source'), { recursive: true });
  await copyFixtureSources(path.join(realMirror, 'source'));

  const httpsCore = registryCore();
  httpsCore.locations = [{
    scheme: 'https',
    baseUrl: 'https://artifacts.example.com/immutable/fixture-r1/',
  }];
  const httpsRegistry = artifactContract.createArtifactRegistry(httpsCore);
  const httpsPath = path.join(metadata, 'https-registry.json');
  await fs.writeFile(httpsPath, `${JSON.stringify(httpsRegistry)}\n`);
  await assert.rejects(
    runMain([
      'plan', `--registry=${httpsPath}`, `--target=${path.join(workspace, 'https-target')}`,
      '--location=https', `--file-location-root=${realMirror}`,
    ]),
    matchesCode('FILE_LOCATION_ROOT_FORBIDDEN'),
  );

  const filePath = path.join(metadata, 'file-registry.json');
  await fs.copyFile(fixtureRegistryPath, filePath);
  try {
    await fs.symlink(realMirror, linkedMirror, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) {
      t.skip(`directory link creation unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(
    runMain([
      'plan', `--registry=${filePath}`, `--target=${path.join(workspace, 'linked-target')}`,
      '--location=file', `--file-location-root=${linkedMirror}`,
    ]),
    matchesCode('SYMLINK_OR_REPARSE'),
  );
});

test('HTTPS transport rejects cross-origin and downgrade redirects without network access', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const stage = path.join(workspace, 'stage');
  await fs.mkdir(stage);
  const alpha = await fs.readFile(path.join(fixtureDirectory, 'source', 'alpha.txt'));
  const expected = {
    bytes: alpha.length,
    sha256: `sha256:${createHash('sha256').update(alpha).digest('hex')}`,
  };
  const common = {
    location: { scheme: 'https', url: 'https://artifacts.example.com/immutable/r1/alpha.txt' },
    destinationRoot: stage,
    destinationPath: 'alpha.txt',
    expected,
  };
  await assert.rejects(
    stageFromLocation({
      ...common,
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { location: 'https://other.example.com/immutable/r1/alpha.txt' },
      }),
    }),
    matchesCode('HTTPS_REDIRECT_ORIGIN'),
  );
  await assert.rejects(
    stageFromLocation({
      ...common,
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { location: 'http://artifacts.example.com/immutable/r1/alpha.txt' },
      }),
    }),
    matchesCode('UNSAFE_HTTPS_LOCATION'),
  );
  let calls = 0;
  const result = await stageFromLocation({
    ...common,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response(null, { status: 302, headers: { location: '/immutable/r1/blob-alpha' } })
        : new Response(alpha, { status: 200 });
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.bytes, alpha.length);
});

test('HTTPS staging stops at the byte budget and removes an oversized partial file', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const stage = path.join(workspace, 'stage');
  await fs.mkdir(stage);
  const alpha = await fs.readFile(path.join(fixtureDirectory, 'source', 'alpha.txt'));
  let pulls = 0;
  const oversizedBody = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          pulls += 1;
          if (pulls === 1) return { value: Buffer.concat([alpha, Buffer.from('!')]), done: false };
          return { done: true };
        },
      };
    },
  };

  await assert.rejects(stageFromLocation({
    location: { scheme: 'https', url: 'https://artifacts.example.com/immutable/r1/alpha.txt' },
    destinationRoot: stage,
    destinationPath: 'alpha.txt',
    expected: {
      bytes: alpha.length,
      sha256: `sha256:${createHash('sha256').update(alpha).digest('hex')}`,
    },
    fetchImpl: async () => ({ status: 200, body: oversizedBody }),
  }));
  assert.equal(pulls, 1, 'the transport must reject the first chunk that exceeds expected.bytes');
  await assert.rejects(fs.lstat(path.join(stage, 'alpha.txt')), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(stage), []);
});

test('explicit replacement retains the prior target for owner-approved cleanup', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const metadata = await copyFixtureMetadata(workspace);
  const target = path.join(workspace, 'restored');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'alpha.txt'), 'old corrupt alpha\n');
  await fs.writeFile(path.join(target, 'rows.ndjson'), '{"old":true}\n');

  const restored = await runMain([
    'restore', `--registry=${metadata.registry}`, `--target=${target}`, '--location=file',
    '--replace-existing',
  ]);
  assert.equal(restored.result.backup_cleanup, 'pending');
  assert.equal(restored.result.counts.promoted, true);
  const verified = await runMain([
    'verify', `--registry=${metadata.registry}`, `--target=${target}`, '--location=file',
  ]);
  assert.equal(verified.result.counts.verified, 2);
  const residue = await restoreResidue(workspace, target);
  assert.equal(residue.filter((name) => name.includes('.artifact-restore-stage-')).length, 0);
  assert.equal(residue.filter((name) => name.includes('.artifact-restore-backup-')).length, 1);
  assert.equal(
    await fs.readFile(path.join(workspace, residue[0], 'alpha.txt'), 'utf8'),
    'old corrupt alpha\n',
  );
});

test('a corrupt target changed during HTTPS staging is not replaced at promotion', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const metadata = await copyFixtureMetadata(workspace);
  const httpsCore = registryCore();
  httpsCore.locations = [{
    scheme: 'https',
    baseUrl: 'https://artifacts.example.com/immutable/fixture-r1/',
  }];
  const httpsRegistry = artifactContract.createArtifactRegistry(httpsCore);
  await fs.writeFile(metadata.registry, `${JSON.stringify(httpsRegistry)}\n`);
  const target = path.join(workspace, 'restored');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'alpha.txt'), 'initial corrupt alpha\n');
  await fs.writeFile(path.join(target, 'rows.ndjson'), '{"initial":"corrupt"}\n');
  const concurrentAlpha = 'concurrent corrupt alpha\n';
  const concurrentRows = '{"concurrent":"corrupt"}\n';
  let changed = false;

  await assert.rejects(
    runMain([
      'restore', `--registry=${metadata.registry}`, `--target=${target}`, '--location=https',
      '--replace-existing',
    ], {
      fetchImpl: async (url) => {
        if (!changed) {
          changed = true;
          await fs.writeFile(path.join(target, 'alpha.txt'), concurrentAlpha);
          await fs.writeFile(path.join(target, 'rows.ndjson'), concurrentRows);
        }
        const body = url.pathname.endsWith('/alpha.txt')
          ? await fs.readFile(path.join(fixtureDirectory, 'source', 'alpha.txt'))
          : await fs.readFile(path.join(fixtureDirectory, 'source', 'rows.ndjson'));
        return new Response(body, { status: 200 });
      },
    }),
    matchesCode('TARGET_CHANGED_BEFORE_PROMOTION'),
  );
  assert.equal(changed, true);
  assert.equal(await fs.readFile(path.join(target, 'alpha.txt'), 'utf8'), concurrentAlpha);
  assert.equal(await fs.readFile(path.join(target, 'rows.ndjson'), 'utf8'), concurrentRows);
  assert.deepEqual(await restoreResidue(workspace, target), []);
});

test('unregistered backup content injected before install causes rollback through the operations inventory callback', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const metadata = await copyFixtureMetadata(workspace);
  const registry = await parseRestoreRegistry(fixtureRegistryText, { locationScheme: 'file' }, {
    parseArtifactRegistry: artifactContract.parseArtifactRegistry,
  });
  const target = path.join(workspace, 'restored');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'alpha.txt'), 'old corrupt alpha\n');
  await fs.writeFile(path.join(target, 'rows.ndjson'), '{"old":true}\n');
  let backupInjected = false;
  const injectingFileSystem = new Proxy(fs, {
    get(fileSystem, property) {
      if (property !== 'rename') return Reflect.get(fileSystem, property);
      return async (source, destination) => {
        const result = await fileSystem.rename(source, destination);
        if (path.resolve(source) === target
          && path.basename(destination).includes('.artifact-restore-backup-')) {
          backupInjected = true;
          await fileSystem.writeFile(path.join(destination, 'unregistered-race.txt'), 'race content\n');
        }
        return result;
      };
    },
  });
  let inventoryVerifierObserved = false;

  await assert.rejects(
    runMain([
      'restore', `--registry=${metadata.registry}`, `--target=${target}`, '--location=file',
      '--replace-existing',
    ], {
      fileSystem: injectingFileSystem,
      promote: async (options) => {
        assert.equal(typeof options.verifyBackupBeforeInstall, 'function');
        return promoteDirectoryAtomic({
          ...options,
          verifyBackupBeforeInstall: async (backupRoot) => {
            inventoryVerifierObserved = true;
            await options.verifyBackupBeforeInstall(backupRoot);
            await assertVerifiedInventory(await inspectTargetInventory({
              registry,
              targetRoot: backupRoot,
              fileSystem: injectingFileSystem,
            }));
          },
        });
      },
    }),
    matchesCode('PROMOTION_FAILED'),
  );
  assert.equal(backupInjected, true);
  assert.equal(inventoryVerifierObserved, true);
  assert.equal(await fs.readFile(path.join(target, 'alpha.txt'), 'utf8'), 'old corrupt alpha\n');
  assert.equal(await fs.readFile(path.join(target, 'rows.ndjson'), 'utf8'), '{"old":true}\n');
  assert.equal(await fs.readFile(path.join(target, 'unregistered-race.txt'), 'utf8'), 'race content\n');
  assert.deepEqual(await restoreResidue(workspace, target), []);
});

test('backup drift after install is preserved and reported instead of recursively deleted', async (t) => {
  const workspace = await temporaryWorkspace(t);
  const metadata = await copyFixtureMetadata(workspace);
  const target = path.join(workspace, 'restored');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'alpha.txt'), 'old corrupt alpha\n');
  await fs.writeFile(path.join(target, 'rows.ndjson'), '{"old":true}\n');
  let injected = false;
  const injectingFileSystem = new Proxy(fs, {
    get(fileSystem, property) {
      if (property !== 'rename') return Reflect.get(fileSystem, property);
      return async (source, destination) => {
        const result = await fileSystem.rename(source, destination);
        if (path.resolve(destination) === target
          && path.basename(source).includes('.artifact-restore-stage-')) {
          const backupName = (await fileSystem.readdir(workspace)).find((name) => (
            name.includes('.artifact-restore-backup-')
          ));
          assert.ok(backupName);
          injected = true;
          await fileSystem.writeFile(
            path.join(workspace, backupName, 'late-race.txt'),
            'late concurrent content\n',
          );
        }
        return result;
      };
    },
  });

  const restored = await runMain([
    'restore', `--registry=${metadata.registry}`, `--target=${target}`, '--location=file',
    '--replace-existing',
  ], { fileSystem: injectingFileSystem });
  assert.equal(injected, true);
  assert.equal(restored.result.backup_cleanup, 'pending');
  assert.equal(restored.result.stage_cleanup, 'complete');
  const residue = await restoreResidue(workspace, target);
  const backups = residue.filter((name) => name.includes('.artifact-restore-backup-'));
  assert.equal(backups.length, 1);
  assert.equal(
    await fs.readFile(path.join(workspace, backups[0], 'late-race.txt'), 'utf8'),
    'late concurrent content\n',
  );
  const verified = await runMain([
    'verify', `--registry=${metadata.registry}`, `--target=${target}`, '--location=file',
  ]);
  assert.equal(verified.result.counts.verified, 2);
});

test('bounded concurrency never exceeds the configured worker count', async () => {
  let active = 0;
  let maximum = 0;
  const results = await mapBounded([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await waitImmediate();
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
  assert.equal(maximum, 2);
});

async function runMain(args, overrides = {}) {
  const output = [];
  const result = await main(args, {
    parseArtifactRegistry: artifactContract.parseArtifactRegistry,
    stdout: { write: (chunk) => output.push(String(chunk)) },
    ...overrides,
  });
  return { result, output: output.join('') };
}

async function temporaryWorkspace(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-registry-restore-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function copyFixtureMetadata(workspace) {
  const directory = path.join(workspace, 'metadata');
  const source = path.join(directory, 'source');
  await fs.mkdir(source, { recursive: true });
  const registry = path.join(directory, 'registry.json');
  await fs.copyFile(fixtureRegistryPath, registry);
  await copyFixtureSources(source);
  return { directory, registry };
}

async function copyFixtureSources(destination) {
  await fs.copyFile(path.join(fixtureDirectory, 'source', 'alpha.txt'), path.join(destination, 'alpha.txt'));
  await fs.copyFile(path.join(fixtureDirectory, 'source', 'rows.ndjson'), path.join(destination, 'rows.ndjson'));
}

function registryCore() {
  const core = structuredClone(admittedFixture);
  delete core.registryIdentity;
  return core;
}

function matchesCode(code) {
  return (error) => error?.code === code;
}

async function fileTimes(target) {
  const [alpha, rows] = await Promise.all([
    fs.stat(path.join(target, 'alpha.txt')),
    fs.stat(path.join(target, 'rows.ndjson')),
  ]);
  return { alpha: alpha.mtimeMs, rows: rows.mtimeMs };
}

async function readTargetBytes(target) {
  const [alpha, rows] = await Promise.all([
    fs.readFile(path.join(target, 'alpha.txt')),
    fs.readFile(path.join(target, 'rows.ndjson')),
  ]);
  return { alpha, rows };
}

async function restoreResidue(parent, target) {
  const base = path.basename(target);
  return (await fs.readdir(parent)).filter((name) => (
    name.startsWith(`.${base}.artifact-restore-stage-`)
    || name.startsWith(`.${base}.artifact-restore-backup-`)
  )).sort();
}
