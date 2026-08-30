import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  materializeDataFoundationArtifactBundle,
  materializeBundleFromFilesystem,
  materializeM2ArtifactRegistry,
  relocateLineageManifestPath,
  writeMaterializedBundleDirectory,
} from '../lib/data_foundation_artifact_bundle/index.mjs';
import { loadArtifactRegistryContract } from '../lib/data_foundation_artifact_bundle/registry_adapter.mjs';

const FIXTURE = JSON.parse(await fs.readFile(
  path.resolve(import.meta.dirname, '..', 'fixtures', 'data-foundation-artifact-bundle', 'production-shape.json'),
  'utf8',
));
const registryContract = await loadArtifactRegistryContract();

test('materializes exact production-shape M1 and M2 declarations without claiming restore verification', () => {
  const input = fixtureInput();
  const bundle = materializeDataFoundationArtifactBundle({ registryContract, ...input });
  assert.equal(bundle.protocol, 'DataFoundationArtifactBundle/v1');
  assert.match(bundle.bundleId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(bundle.restoreVerification.status, 'not-observed');
  assert.deepEqual(bundle.authority, { serving: false, promotion: false, deletion: false });
  assert.equal(bundle.inventories.m1.declaration.groups.acquisitionManifests, 21);
  assert.equal(bundle.inventories.m1.declaration.groups.acquisitionCheckpoints, 21);
  assert.equal(bundle.inventories.m1.declaration.groups.rawShards, 1_344);
  assert.equal(bundle.inventories.m1.declaration.groups.canonicalParts, 64);
  assert.equal(bundle.inventories.m1.registry.objects.length, 1 + 5 + 21 + 21 + 1_344 + 64);
  assert.deepEqual(bundle.inventories.m1.declaration.excluded, ['transactions', 'logs', 'cache']);
  assert.equal(bundle.inventories.m2.declaration.groups.martParts, 128);
  assert.equal(bundle.inventories.m2.declaration.groups.evaluationArtifacts, 7);
  assert.equal(bundle.inventories.m2.registry.objects.length, 5 + 128 + 7);
  assert.deepEqual(bundle.inventories.m2.declaration.outcome, { promotionStatus: 'not-promoted', availability: 'unavailable' });
  assert.deepEqual(bundle.inventories.m2.declaration.excluded, ['staging']);
  assert.deepEqual(bundle.inventories.m2.registry.authority, { serving: false, promotion: false, deletion: false });
  assert.deepEqual(bundle.inventories.m1.registry.locations, [{ scheme: 'file', basePath: 'm1-preservation' }]);
  assert.deepEqual(bundle.inventories.m2.registry.locations, [{ scheme: 'file', basePath: 'm2-stable-resume' }]);
  assert.deepEqual(bundle.registryFiles, { m1: 'm1.registry.json', m2: 'm2.registry.json' });
});

test('rejects protocol CRLF bytes before materializing M2', () => {
  const input = fixtureInput();
  input.m2.protocol.bytes = Buffer.from('{}\r\n');
  input.m2.protocol.file.bytes = input.m2.protocol.bytes.length;
  input.m2.protocol.file.sha256 = hashBytes(input.m2.protocol.bytes);
  input.m2.protocol.value = {};
  assert.throws(
    () => materializeM2ArtifactRegistry({ registryContract, locations: input.m2Locations, ...input.m2 }),
    /LF-only/,
  );
});

test('rejects a shared physical base even though M1 and M2 locations are separate arguments', () => {
  const input = fixtureInput();
  input.m2Locations = structuredClone(input.m1Locations);
  assert.throws(
    () => materializeDataFoundationArtifactBundle({ registryContract, ...input }),
    /cannot share the same physical base location/,
  );
});

test('rejects promoted M2 outcome and cross-layer M1 receipt drift', () => {
  const promoted = fixtureInput();
  promoted.m2.evaluationManifest.value.promotion.status = 'promoted';
  assert.throws(
    () => materializeM2ArtifactRegistry({ registryContract, locations: promoted.m2Locations, ...promoted.m2 }),
    /not-promoted\/unavailable/,
  );

  const drifted = fixtureInput();
  drifted.m2.martManifest.value.exact_input.receipt_identity = hash('other-receipt');
  const driftedMartCore = structuredClone(drifted.m2.martManifest.value);
  delete driftedMartCore.artifact_identity;
  delete driftedMartCore.generated_at;
  drifted.m2.martManifest.value.artifact_identity = identity(driftedMartCore);
  drifted.m2.evaluationManifest.value.mart_artifact_identity = drifted.m2.martManifest.value.artifact_identity;
  drifted.m2.evaluationManifest.value.lineage_seam.mart.artifact_identity = drifted.m2.martManifest.value.artifact_identity;
  drifted.m2.evaluationManifest.value.lineage_seam.m1_receipt.identity = drifted.m2.martManifest.value.exact_input.receipt_identity;
  assert.throws(
    () => materializeDataFoundationArtifactBundle({ registryContract, ...drifted }),
    /does not bind the materialized M1 receipt/,
  );
});

test('writes bundle and both standalone registries through a no-overwrite staging directory', async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'data-foundation-bundle-'));
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const outputDir = path.join(temporary, 'materialized');
  const bundle = materializeDataFoundationArtifactBundle({ registryContract, ...fixtureInput() });
  const written = await writeMaterializedBundleDirectory({ outputDir, bundle, registryContract });
  assert.deepEqual(written.files, ['bundle.json', 'm1.registry.json', 'm2.registry.json']);
  const names = (await fs.readdir(outputDir)).sort();
  assert.deepEqual(names, written.files);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(outputDir, 'm1.registry.json'), 'utf8')), bundle.inventories.m1.registry);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(outputDir, 'm2.registry.json'), 'utf8')), bundle.inventories.m2.registry);
  await assert.rejects(
    writeMaterializedBundleDirectory({ outputDir, bundle, registryContract }),
    /already exists/,
  );
});

test('relocates only exact scope-bound legacy lineage paths and rejects wrong suffix or traversal', () => {
  const entry = {
    scope: { start: '2006-01-01', end_exclusive: '2007-01-01' },
    manifest_path: 'C:\\old-host\\evidence\\acquisitions\\2006-01-01_2007-01-01\\manifest.json',
  };
  assert.equal(relocateLineageManifestPath(entry), 'acquisitions/2006-01-01_2007-01-01/manifest.json');
  assert.equal(relocateLineageManifestPath({ ...entry, manifest_path: 'acquisitions/2006-01-01_2007-01-01/manifest.json' }), 'acquisitions/2006-01-01_2007-01-01/manifest.json');
  assert.throws(() => relocateLineageManifestPath({ ...entry, manifest_path: 'C:\\old-host\\acquisitions\\2007-01-01_2008-01-01\\manifest.json' }), /cannot be safely relocated/);
  assert.throws(() => relocateLineageManifestPath({ ...entry, manifest_path: 'acquisitions/../2006-01-01_2007-01-01/manifest.json' }), /cannot be safely relocated|traversal/);
});

test('filesystem materializer rejects a junction root before reading receipt bytes', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'data-foundation-bundle-link-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const outside = path.join(temporary, 'outside');
  const linkedRoot = path.join(temporary, 'linked-m1');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'receipt.json'), '{}\n');
  try {
    await fs.symlink(outside, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip('This host does not permit creation of a directory link.');
      return;
    }
    throw error;
  }
  await assert.rejects(
    materializeBundleFromFilesystem({
      registryContract,
      m1Root: linkedRoot,
      martRoot: outside,
      evaluationRoot: outside,
      protocolPath: path.join(outside, 'receipt.json'),
      m1Locations: [{ scheme: 'file', basePath: 'm1-preservation' }],
      m2Locations: [{ scheme: 'file', basePath: 'm2-stable-resume' }],
      createdAt: '2026-08-29T00:00:00.000Z',
    }),
    /symlink or junction/,
  );
});

test('rejects producer-declared M1 aggregate drift instead of treating it as restored observation', () => {
  const input = fixtureInput();
  input.m1.receipt.value.artifacts.source_manifests.raw_bytes += 1;
  const receiptCore = structuredClone(input.m1.receipt.value);
  delete receiptCore.identity;
  input.m1.receipt.value.identity = identity(receiptCore);
  assert.throws(
    () => materializeDataFoundationArtifactBundle({ registryContract, ...input }),
    /source manifest\/raw-shard counts, bytes, hashes/,
  );
});

function fixtureInput() {
  const timestamps = {
    source_as_of: '2026-08-28T00:00:00.000Z',
    retrieved_at: '2026-08-28T01:00:00.000Z',
    built_at: '2026-08-28T02:00:00.000Z',
    observed_at: '2026-08-28T03:00:00.000Z',
  };
  const sourceRevision = hash(`snapshot-${FIXTURE.m1.acquisitions - 1}`);
  const controls = [
    control('warehouse_manifest', 'warehouse/manifest.json', 'engagement-phl-crime-event-warehouse/v1'),
    control('backfill_checkpoint', 'backfill-checkpoint.json', 'engagement-phl-crime-backfill-checkpoint/v1'),
    control('lineage_registry', 'warehouse/lineage/registry.json', 'engagement-phl-crime-lineage/v1'),
    control('latest_quality_report', 'warehouse/quality/current.json', 'engagement-phl-crime-data-quality/v2'),
    control('latest_revision_report', 'warehouse/revisions/current.json', 'engagement-phl-crime-revision/v1'),
  ];
  const acquisitions = [];
  const lineageEntries = [];
  const sourceManifestBindings = [];
  const rawBindings = [];
  let acquiredRows = 0;
  for (let acquisitionIndex = 0; acquisitionIndex < FIXTURE.m1.acquisitions; acquisitionIndex += 1) {
    const startYear = 2006 + acquisitionIndex;
    const start = `${startYear}-01-01`;
    const end = acquisitionIndex === FIXTURE.m1.acquisitions - 1 ? '2026-08-29' : `${startYear + 1}-01-01`;
    const base = `acquisitions/${start}_${end}`;
    const snapshotId = hash(`snapshot-${acquisitionIndex}`);
    const manifestFile = file(`${base}/manifest.json`, `source-manifest-${acquisitionIndex}`);
    const checkpointFile = file(`${base}/checkpoint.json`, `source-checkpoint-${acquisitionIndex}`);
    const shards = [];
    let rows = 0;
    for (let partition = 0; partition < FIXTURE.m1.rawShardsPerAcquisition; partition += 1) {
      const rowCount = 1 + ((acquisitionIndex + partition) % 3);
      const bytes = 100 + acquisitionIndex * 64 + partition;
      const relativePath = `${base}/rows/part-${pad(partition, 3)}.jsonl`;
      const identity = hash(`raw-${acquisitionIndex}-${partition}`);
      shards.push({ partition, path: `rows/part-${pad(partition, 3)}.jsonl`, row_count: rowCount, bytes, identity });
      rawBindings.push({ path: relativePath, bytes, sha256: identity });
      rows += rowCount;
    }
    const manifest = {
      schema: 'engagement-phl-crime-source-snapshot/v1',
      snapshot_id: snapshotId,
      partition_count: shards.length,
      row_count: rows,
      acquisition: { checkpoint_path: 'checkpoint.json' },
      shards,
    };
    const checkpoint = { schema: 'engagement-phl-crime-acquisition-checkpoint/v1', complete: true, snapshot_id: snapshotId, row_count: rows };
    acquisitions.push({ manifest: { value: manifest, file: manifestFile }, checkpoint: { value: checkpoint, file: checkpointFile } });
    lineageEntries.push({ snapshot_id: snapshotId, manifest_path: manifestFile.relativePath, scope: { start, end_exclusive: end } });
    sourceManifestBindings.push({ path: manifestFile.relativePath, bytes: manifestFile.bytes, sha256: manifestFile.sha256, revision: snapshotId });
    acquiredRows += rows;
  }
  controls.find(({ role }) => role === 'lineage_registry').value.source_snapshots = lineageEntries;
  controls.find(({ role }) => role === 'warehouse_manifest').value.current_snapshot_id = sourceRevision;
  controls.find(({ role }) => role === 'backfill_checkpoint').value.final_quality = { acquired_rows: acquiredRows };
  controls.find(({ role }) => role === 'latest_quality_report').value.snapshot_id = sourceRevision;
  controls.find(({ role }) => role === 'latest_quality_report').value.lineage = { source_snapshot_id: sourceRevision };
  controls.find(({ role }) => role === 'latest_revision_report').value.snapshot_id = sourceRevision;
  const canonicalBindings = [];
  for (let partition = 0; partition < FIXTURE.m1.canonicalParts; partition += 1) {
    canonicalBindings.push({
      partition,
      path: `canonical/part-${pad(partition, 3)}.jsonl`,
      row_count: 10 + partition,
      bytes: 1_000 + partition,
      identity: hash(`canonical-${partition}`),
    });
  }
  const canonicalAggregate = canonicalBindings.map((binding) => ({
    path: `warehouse/${binding.path}`,
    bytes: binding.bytes,
    sha256: binding.identity,
  }));
  const receiptValue = {
    schema: 'engagement-phl-crime-warehouse-receipt/v3',
    serving_eligible: false,
    source: { dataset_id: 'phl-crime', revision: sourceRevision },
    warehouse: {
      schema: 'engagement-phl-crime-event-warehouse/v1',
      event_schema: 'engagement-phl-crime-event/v1',
      current_snapshot_id: sourceRevision,
    },
    coverage: {
      start: '2006-01-01',
      end_exclusive: '2026-08-29',
      earliest_event_at: '2006-01-01T00:00:00.000Z',
      latest_event_at: timestamps.source_as_of,
    },
    counts: {
      acquired_rows: acquiredRows,
      canonical_rows: canonicalBindings.reduce((total, binding) => total + binding.row_count, 0),
    },
    clocks: timestamps,
    artifacts: {
      ...Object.fromEntries(controls.map(({ role, value, file: descriptor }) => [role, {
        path: descriptor.relativePath, bytes: descriptor.bytes, sha256: descriptor.sha256, schema: value.schema,
      }])),
      source_manifests: {
        count: sourceManifestBindings.length,
        bytes: total(sourceManifestBindings, 'bytes'),
        sha256: identity(sourceManifestBindings),
        raw_shard_count: rawBindings.length,
        raw_bytes: total(rawBindings, 'bytes'),
        raw_sha256: identity(rawBindings),
      },
      canonical: {
        path: 'warehouse/canonical',
        partition_count: canonicalBindings.length,
        bytes: total(canonicalBindings, 'bytes'),
        sha256: identity(canonicalAggregate),
        partition_bindings: canonicalBindings,
      },
    },
    authority: { producer_validated_local_candidate: true, integration_authority: false, serving_authority: false, deletion_authority: false },
  };
  receiptValue.identity = identity(receiptValue);
  const receiptIdentity = receiptValue.identity;
  const receiptFile = file('receipt.json', 'receipt-bytes');

  const protocolBytes = Buffer.from('{"schema":"engagement-area-intelligence-evaluation-protocol/v2"}\n');
  const protocolSha256 = hashBytes(protocolBytes);
  const martParts = Array.from({ length: FIXTURE.m2.martParts }, (_, partition) => ({
    path: `marts/${partition < 64 ? 'tract' : 'fixed-grid'}/part-${pad(partition % 64, 3)}.jsonl`,
    unit_type: partition < 64 ? 'tract' : 'fixed-grid',
    partition: partition % 64,
    row_count: 20 + partition,
    bytes: 2_000 + partition,
    sha256: strip(hash(`mart-${partition}`)),
  }));
  const martManifestFile = file('manifest.json', 'mart-manifest');
  const martManifestValue = {
    schema: 'engagement-area-intelligence-feature-mart/v2',
    protocol: { sha256: strip(protocolSha256) },
    exact_input: { receipt_identity: receiptIdentity, receipt_sha256: receiptFile.sha256 },
    source_coverage: { earliest_scope_start: '2006-01-01', latest_scope_end_exclusive: '2026-08-29', latest_event_at: timestamps.source_as_of },
    parts: martParts,
    row_count: total(martParts, 'row_count'),
    bytes: total(martParts, 'bytes'),
    part_bindings_identity: identity(martParts),
  };
  const martArtifactIdentity = identity(martManifestValue);
  martManifestValue.artifact_identity = martArtifactIdentity;
  martManifestValue.generated_at = '2026-08-28T04:00:00.000Z';
  const evaluationArtifacts = FIXTURE.m2.evaluationArtifacts.map((name, index) => ({ name, bytes: 300 + index, sha256: strip(hash(`evaluation-${index}`)) }));
  const evaluationValue = {
    schema: 'engagement-area-intelligence-evaluation-run/v2',
    protocol_sha256: strip(protocolSha256),
    mart_manifest_sha256: strip(martManifestFile.sha256),
    mart_artifact_identity: martArtifactIdentity,
    promotion: { status: 'not-promoted', selected_model: null },
    availability: 'unavailable',
    lineage_seam: {
      protocol: { sha256: strip(protocolSha256) },
      mart: {
        manifest_sha256: strip(martManifestFile.sha256),
        artifact_identity: martArtifactIdentity,
        part_bindings_identity: martManifestValue.part_bindings_identity,
        part_count: martParts.length,
        row_count: martManifestValue.row_count,
        bytes: martManifestValue.bytes,
        parts: martParts,
      },
      m1_receipt: { identity: receiptIdentity, sha256: receiptFile.sha256 },
      outcome: { promotion_status: 'not-promoted', availability: 'unavailable' },
    },
    artifacts: evaluationArtifacts,
    generated_at: '2026-08-28T05:00:00.000Z',
  };
  return {
    createdAt: '2026-08-28T06:00:00.000Z',
    m1Locations: [{ scheme: 'file', basePath: 'm1-preservation' }],
    m2Locations: [{ scheme: 'file', basePath: 'm2-stable-resume' }],
    m1: { receipt: { value: receiptValue, file: receiptFile }, controls, acquisitions },
    m2: {
      protocol: { value: { schema: 'engagement-area-intelligence-evaluation-protocol/v2' }, file: { relativePath: 'protocol/area_intelligence_evaluation_protocol.v2.json', bytes: protocolBytes.length, sha256: protocolSha256 }, bytes: protocolBytes },
      martManifest: { value: martManifestValue, file: martManifestFile },
      martCheckpoint: { value: { schema: 'engagement-area-intelligence-mart-checkpoint/v2' }, file: file('checkpoint.json', 'mart-checkpoint') },
      evaluationManifest: { value: evaluationValue, file: file('evaluation/manifest.json', 'evaluation-manifest') },
      evaluationCheckpoint: { value: { schema: 'engagement-area-intelligence-evaluation-checkpoint/v2' }, file: file('evaluation/checkpoint.json', 'evaluation-checkpoint') },
    },
  };
}

function control(role, relativePath, schema) {
  return { role, value: { schema }, file: file(relativePath, role) };
}

function file(relativePath, seed) {
  return { relativePath, bytes: 100 + seed.length, sha256: hash(`file-${seed}`) };
}

function hash(value) {
  return hashBytes(Buffer.from(value));
}

function hashBytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function strip(value) {
  return value.replace(/^sha256:/, '');
}

function total(items, key) {
  return items.reduce((sum, item) => sum + item[key], 0);
}

function identity(value) {
  return hashBytes(Buffer.from(stable(value)));
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function pad(value, width) {
  return String(value).padStart(width, '0');
}
