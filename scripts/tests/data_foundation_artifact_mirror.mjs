import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createArtifactRegistry, serializeArtifactRegistry } from '../lib/artifact_registry/index.mjs';
import {
  DATA_FOUNDATION_ARTIFACT_MIRROR_RESULT_PROTOCOL,
  mirrorDataFoundationArtifacts,
} from '../lib/data_foundation_artifact_mirror/index.mjs';

test('mirrors exact M1 and M2 objects into independent registry bases', async () => {
  await withFixture(async (fixture) => {
    const result = await mirrorDataFoundationArtifacts(fixture.options);
    assert.equal(result.protocol, DATA_FOUNDATION_ARTIFACT_MIRROR_RESULT_PROTOCOL);
    assert.equal(result.status, 'mirrored');
    assert.equal(result.objectCount, 6);
    assert.equal(result.rowCount, 4);
    assert.deepEqual(result.authority, { serving: false, promotion: false, deletion: false });
    assert.equal(await fs.readFile(path.join(fixture.mirrorRoot, 'artifact-sets/m1-v1/rows/data.jsonl'), 'utf8'), '{"id":1}\n{"id":2}\n');
    assert.equal(await fs.readFile(path.join(fixture.mirrorRoot, 'artifact-sets/m2-v1/protocol.json'), 'utf8'), '{"schema":"protocol/v1"}\n');
    assert.equal(await fs.readFile(path.join(fixture.mirrorRoot, 'artifact-sets/m2-v1/evaluation/report.json'), 'utf8'), '{"status":"unavailable"}\n');
  });
});

test('source exceeding declared bytes stops at the hard limit and removes staging without promotion', async () => {
  await withFixture(async (fixture) => {
    await fs.writeFile(path.join(fixture.m1Root, 'z-last.json'), Buffer.alloc(1024 * 1024, 0x61));
    await assert.rejects(() => mirrorDataFoundationArtifacts(fixture.options), hasCode('object-bytes-limit'));
    await assertNoPromotion(fixture);
  });
});

test('unsafe registry totalBytes is rejected before destination staging', async () => {
  await withFixture(async (fixture) => {
    const registryPath = path.join(fixture.bundleDir, 'm1.registry.json');
    const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
    registry.partitionInventory.totalBytes = Number.MAX_SAFE_INTEGER + 1;
    await fs.writeFile(registryPath, `${JSON.stringify(registry)}\n`);
    await assert.rejects(() => mirrorDataFoundationArtifacts(fixture.options), hasCode('invalid-registry'));
    await assertNoPromotion(fixture);
  });
});

test('insufficient destination capacity fails before staging', async () => {
  await withFixture(async (fixture) => {
    await assert.rejects(
      () => mirrorDataFoundationArtifacts(fixture.options, {
        statfs: async () => ({ bsize: 4096n, bavail: 1n }),
      }),
      hasCode('insufficient-destination-space'),
    );
    await assertNoPromotion(fixture);
  });
});

test('unavailable destination capacity fails closed before staging', async () => {
  await withFixture(async (fixture) => {
    await assert.rejects(
      () => mirrorDataFoundationArtifacts(fixture.options, {
        statfs: async () => { throw Object.assign(new Error('unsupported'), { code: 'ENOSYS' }); },
      }),
      hasCode('free-space-unavailable'),
    );
    await assertNoPromotion(fixture);
  });
});

test('existing mirror target is never overwritten', async () => {
  await withFixture(async (fixture) => {
    await fs.mkdir(fixture.mirrorRoot);
    await fs.writeFile(path.join(fixture.mirrorRoot, 'owner.txt'), 'keep');
    await assert.rejects(() => mirrorDataFoundationArtifacts(fixture.options), hasCode('target-exists'));
    assert.equal(await fs.readFile(path.join(fixture.mirrorRoot, 'owner.txt'), 'utf8'), 'keep');
  });
});

test('M2 protocol can only come from the exact explicit protocol source', async () => {
  await withFixture(async (fixture) => {
    const wrong = path.join(fixture.root, 'wrong-protocol.json');
    await fs.writeFile(wrong, '{"schema":"protocoL/v1"}\n');
    await assert.rejects(
      () => mirrorDataFoundationArtifacts({ ...fixture.options, protocolSource: wrong }),
      hasCode('object-hash-drift'),
    );
    await assertNoPromotion(fixture);
  });
});

test('path escape in a standalone registry is rejected by public ArtifactRegistry/v1 admission', async () => {
  await withFixture(async (fixture) => {
    const registryPath = path.join(fixture.bundleDir, 'm1.registry.json');
    const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
    registry.objects[0].relativePath = '../escape.json';
    await fs.writeFile(registryPath, `${JSON.stringify(registry)}\n`);
    await assert.rejects(() => mirrorDataFoundationArtifacts(fixture.options), hasCode('invalid-registry'));
    await assertNoPromotion(fixture);
  });
});

test('symlinked source objects are rejected without promotion', async (t) => {
  await withFixture(async (fixture) => {
    const declared = path.join(fixture.m1Root, 'control.json');
    const real = path.join(fixture.root, 'outside-control.json');
    await fs.writeFile(real, await fs.readFile(declared));
    await fs.rm(declared);
    try {
      await fs.symlink(real, declared, 'file');
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        t.skip('This Windows host does not permit creation of a test symlink.');
        return;
      }
      throw error;
    }
    await assert.rejects(() => mirrorDataFoundationArtifacts(fixture.options), hasCode('source-link-forbidden'));
    await assertNoPromotion(fixture);
  });
});

async function withFixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-mirror-test-'));
  const bundleDir = path.join(root, 'bundle');
  const m1Root = path.join(root, 'm1-source');
  const m2Root = path.join(root, 'm2-source');
  const mirrorRoot = path.join(root, 'mirror-final');
  const protocolSource = path.join(root, 'tracked-protocol.json');
  await Promise.all([fs.mkdir(bundleDir), fs.mkdir(m1Root), fs.mkdir(m2Root)]);
  try {
    const m1Files = {
      'control.json': '{"control":true}\n',
      'rows/data.jsonl': '{"id":1}\n{"id":2}\n',
      'z-last.json': '{"last":true}\n',
    };
    const m2Files = {
      'parts/part-000.jsonl': '{"unit":"a"}\n{"unit":"b"}\n',
      'evaluation/report.json': '{"status":"unavailable"}\n',
    };
    await writeFiles(m1Root, m1Files);
    await writeFiles(m2Root, m2Files);
    await fs.writeFile(protocolSource, '{"schema":"protocol/v1"}\n');
    const m1 = registry('m1', 'artifact-sets/m1-v1', [
      object('m1:control', 'control.json', m1Files['control.json'], null),
      object('m1:rows', 'rows/data.jsonl', m1Files['rows/data.jsonl'], 2),
      object('m1:z-last', 'z-last.json', m1Files['z-last.json'], null),
    ]);
    const m2 = registry('m2', 'artifact-sets/m2-v1', [
      object('m2:protocol', 'protocol.json', '{"schema":"protocol/v1"}\n', null),
      object('m2:part', 'parts/part-000.jsonl', m2Files['parts/part-000.jsonl'], 2),
      object('m2:evaluation:00', 'evaluation/report.json', m2Files['evaluation/report.json'], null),
    ]);
    const bundle = {
      protocol: 'DataFoundationArtifactBundle/v1',
      bundleId: identity({ m1RegistryIdentity: m1.registryIdentity, m2RegistryIdentity: m2.registryIdentity }),
      createdAt: '2026-08-29T00:00:00.000Z',
      registryFiles: { m1: 'm1.registry.json', m2: 'm2.registry.json' },
      inventories: {
        m1: { registry: m1, declaration: {}, restoreVerification: {} },
        m2: { registry: m2, declaration: {}, restoreVerification: {} },
      },
      restoreVerification: {},
      authority: { serving: false, promotion: false, deletion: false },
    };
    await Promise.all([
      fs.writeFile(path.join(bundleDir, 'bundle.json'), `${JSON.stringify(bundle)}\n`),
      fs.writeFile(path.join(bundleDir, 'm1.registry.json'), `${serializeArtifactRegistry(m1)}\n`),
      fs.writeFile(path.join(bundleDir, 'm2.registry.json'), `${serializeArtifactRegistry(m2)}\n`),
    ]);
    await run({
      root, bundleDir, m1Root, m2Root, protocolSource, mirrorRoot,
      options: { bundleDir, m1SourceRoot: m1Root, m2SourceRoot: m2Root, protocolSource, mirrorRoot },
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function registry(name, basePath, objects) {
  const partitioned = objects.filter(({ rowCount }) => rowCount !== null);
  return createArtifactRegistry({
    protocol: 'ArtifactRegistry/v1',
    artifactSetId: `artifact-set:${name}:synthetic`,
    sourceScope: { sourceId: name, scopeId: 'synthetic', revision: 'v1', dataClassification: 'restricted-local-artifact' },
    clocks: {
      sourceAsOf: '2026-08-28T00:00:00.000Z', retrievedAt: '2026-08-28T01:00:00.000Z',
      builtAt: '2026-08-28T02:00:00.000Z', observedAt: '2026-08-28T03:00:00.000Z',
    },
    versions: {
      producer: { name: `${name}-producer`, version: 'v1' },
      schema: { name: `${name}-schema`, version: 'v1' },
      transform: { name: `${name}-transform`, version: 'v1' },
    },
    locations: [{ scheme: 'file', basePath }],
    objects,
    partitionInventory: {
      partitions: partitioned.map((entry, index) => ({ partitionId: `${name}-part-${index}`, objectIds: [entry.objectId], rowCount: entry.rowCount })),
      unpartitionedObjectIds: objects.filter(({ rowCount }) => rowCount === null).map(({ objectId }) => objectId),
      totalObjectCount: objects.length,
      totalBytes: objects.reduce((sum, entry) => sum + entry.bytes, 0),
      totalRowCount: objects.reduce((sum, entry) => sum + (entry.rowCount ?? 0), 0),
    },
    retention: {
      state: 'hold', decisionOwner: 'test-owner',
      deletePrerequisites: ['artifact-integrity-rechecked', 'downstream-dependencies-cleared', 'explicit-owner-decision-recorded', 'retention-period-satisfied'],
    },
    authority: { serving: false, promotion: false, deletion: false },
  });
}

function object(objectId, relativePath, contents, rowCount) {
  return {
    objectId, relativePath,
    mediaType: relativePath.endsWith('.jsonl') ? 'application/x-ndjson' : 'application/json',
    bytes: Buffer.byteLength(contents), sha256: identity(Buffer.from(contents)), rowCount,
  };
}

async function writeFiles(root, files) {
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, ...relative.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
}

async function assertNoPromotion(fixture) {
  await assert.rejects(() => fs.lstat(fixture.mirrorRoot), { code: 'ENOENT' });
  const leftovers = (await fs.readdir(fixture.root)).filter((name) => name.includes('.mirror-final.staging-'));
  assert.deepEqual(leftovers, []);
}

function identity(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(stableSerialization(value));
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function stableSerialization(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialization).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialization(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hasCode(code) {
  return (error) => error?.code === code;
}
