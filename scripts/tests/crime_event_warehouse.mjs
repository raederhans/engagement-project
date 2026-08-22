import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { main as acquireCrimeEvents } from '../acquire_crime_events.mjs';
import { main as backfillCrimeEventWarehouse, annualPeriods } from '../backfill_crime_event_warehouse.mjs';
import { main as ingestCrimeEvents } from '../ingest_crime_events.mjs';
import { createAcsPopulationIndex } from '../lib/crime_event_acs.mjs';
import {
  createTractSpatialIndex,
  fixedWebMercatorGridCell,
  validateSourceCoordinate,
} from '../lib/crime_event_spatial.mjs';
import {
  acquireCrimeSourceSnapshot,
  buildPageSql,
  partitionForSourceId,
  resolveIncrementalCrimeScope,
} from '../lib/crime_event_source.mjs';
import {
  classifyCrimeDataStatus,
  CRIME_WAREHOUSE_RECEIPT_SCHEMA,
  createCrimeWarehouseAdmissionReceipt,
  createWarehouseDependencies,
  ingestCrimeSourceSnapshot,
  validateCrimeWarehouseAdmissionReceipt,
} from '../lib/crime_event_warehouse.mjs';
import { assertTaskOwnedDfev1Path } from '../lib/dfev1_path.mjs';

const FIXTURE = await readJson('scripts/fixtures/data-foundation-m1/synthetic-revisions.json');
const EVENT_CONTRACT = await readJson('scripts/data/crime_event_contract.v1.json');
const SOURCE_CONTRACT = await readJson('scripts/data/crime_event_source_contract.json');
const TAXONOMY = await readJson('src/data/crime_taxonomy.v1.json');
const TRACTS = await readJson('public/data/tracts_phl.geojson');
const TRACT_REGISTRY = await readJson('scripts/data/tract_source_contract.json');
const ACS = await readJson('src/data/acs_tracts_2024_pa101.json');

test('official crime CLIs reject non-.dfev1, out-of-worktree, and linked paths before filesystem writes', async (context) => {
  const outside = path.join(os.tmpdir(), `dfev1-cli-boundary-${process.pid}-${Date.now()}`);
  const linkedRoot = path.join(process.cwd(), '.dfev1', `cli-boundary-link-${process.pid}-${Date.now()}`);
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(outside, 'sentinel.txt'), 'unchanged', 'utf8');
  await fs.mkdir(path.dirname(linkedRoot), { recursive: true });
  await fs.symlink(outside, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  context.after(async () => {
    await fs.unlink(linkedRoot);
    await fs.rm(outside, { recursive: true, force: true });
  });
  await assert.rejects(
    acquireCrimeEvents(['--start=2026-08-01', '--end=2026-08-02', `--output=${outside}`]),
    /task-owned \.dfev1 path inside the current worktree/i,
  );
  await assert.rejects(
    ingestCrimeEvents([`--snapshot=${outside}`, `--warehouse=${path.join(outside, 'warehouse')}`]),
    /task-owned \.dfev1 path inside the current worktree/i,
  );
  await assert.rejects(
    backfillCrimeEventWarehouse(['--through=2026-08-02', `--root=${outside}`]),
    /task-owned \.dfev1 path inside the current worktree/i,
  );
  await assert.rejects(
    backfillCrimeEventWarehouse(['--through=2026-08-02', '--root=.dfev1']),
    /task-owned \.dfev1 path inside the current worktree/i,
  );
  await assert.rejects(
    backfillCrimeEventWarehouse(['--through=2026-08-02', '--root=.']),
    /task-owned \.dfev1 path inside the current worktree/i,
  );
  await assert.rejects(
    acquireCrimeEvents([
      '--start=2026-08-01',
      '--end=2026-08-02',
      `--output=${path.join(linkedRoot, 'acquisition')}`,
    ]),
    /must not escape the current worktree through a symbolic link or junction/i,
  );
  assert.equal(
    await assertTaskOwnedDfev1Path('.dfev1/crime/allowed-cli-root'),
    path.join(process.cwd(), '.dfev1', 'crime', 'allowed-cli-root'),
  );
  assert.equal(await fs.readFile(path.join(outside, 'sentinel.txt'), 'utf8'), 'unchanged');
  assert.deepEqual(await fs.readdir(outside), ['sentinel.txt']);
});

test('synthetic revision fixture is isolated from official serving and Source Health', () => {
  assert.equal(FIXTURE.synthetic, true);
  assert.equal(FIXTURE.serving_eligible, false);
  assert.match(FIXTURE.description, /invented/i);
  assert.equal(EVENT_CONTRACT.artifact_policy.synthetic_fixture_runtime_policy, 'never-admitted-as-official');
});

test('quality vocabulary keeps unavailable, partial, stale, zero, and available distinct', () => {
  assert.equal(classifyCrimeDataStatus({ availability: 'unavailable' }), 'unavailable');
  assert.equal(classifyCrimeDataStatus({ availability: 'partial' }), 'partial');
  assert.equal(classifyCrimeDataStatus({
    availability: 'available', rowCount: 0, freshnessStatus: 'current-within-policy',
  }), 'zero');
  assert.equal(classifyCrimeDataStatus({
    availability: 'available', rowCount: 1, freshnessStatus: 'stale',
  }), 'stale');
  assert.equal(classifyCrimeDataStatus({
    availability: 'available', rowCount: 1, freshnessStatus: 'current-within-policy',
  }), 'available');
});

test('real backfill producer publishes one official frozen receipt and validates hostile drift fail closed', async (context) => {
  const root = path.join(
    process.cwd(),
    '.dfev1',
    'crime',
    `receipt-contract-${process.pid}-${Date.now()}`,
  );
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const runtime = officialBackfillRuntime();
  const args = [
    '--start=2025-12-31',
    '--through=2026-01-02',
    `--root=${root}`,
    '--page-size=10',
    `--partitions=${EVENT_CONTRACT.default_partition_count}`,
  ];

  const published = await backfillCrimeEventWarehouse(args, runtime);
  const admitted = await validateCrimeWarehouseAdmissionReceipt(root);
  assert.equal(published.idempotent, false);
  assert.equal(admitted.receipt.schema, CRIME_WAREHOUSE_RECEIPT_SCHEMA);
  assert.equal(admitted.receipt.mode, 'official-local-candidate');
  assert.equal(admitted.receipt.serving_eligible, false);
  assert.equal(admitted.receipt.authority.integration_authority, false);
  assert.equal(admitted.receipt.authority.deletion_authority, false);
  assert.deepEqual(admitted.receipt.coverage, {
    start: '2025-12-31',
    end_exclusive: '2026-01-02',
    earliest_event_at: '2025-12-31T01:00:00.000Z',
    latest_event_at: '2026-01-01T03:00:00.000Z',
  });
  assert.equal(admitted.receipt.counts.acquired_rows, 2);
  assert.equal(admitted.receipt.counts.canonical_rows, 2);
  assert.equal(admitted.receipt.data_quality.status_semantics.unavailable_is_zero, false);
  assert.equal(admitted.receipt.data_quality.status_semantics.partial_is_current, false);
  assert.equal(admitted.receipt.data_quality.fixed_grid.unavailable, 1);
  assert.equal(admitted.receipt.data_quality.tract.unmapped, 1);
  assert.equal(admitted.receipt.artifacts.source_manifests.raw_shard_count, 128);
  assert.match(admitted.receipt.artifacts.source_manifests.raw_sha256, /^sha256:[a-f0-9]{64}$/);
  for (const name of [
    'warehouse_manifest', 'backfill_checkpoint', 'lineage_registry',
    'latest_quality_report', 'latest_revision_report', 'current_source_manifest',
  ]) {
    const artifact = admitted.receipt.artifacts[name];
    assert.doesNotMatch(artifact.path, /\\|(^|\/)\.\.?(\/|$)/);
    assert.match(artifact.sha256, /^sha256:[a-f0-9]{64}$/);
  }

  const receiptPath = path.join(root, 'receipt.json');
  const checkpointPath = path.join(root, 'backfill-checkpoint.json');
  const before = {
    bytes: await fs.readFile(receiptPath),
    mtimeMs: (await fs.stat(receiptPath)).mtimeMs,
    checkpointBytes: await fs.readFile(checkpointPath),
    checkpointMtimeMs: (await fs.stat(checkpointPath)).mtimeMs,
  };
  const rerun = await backfillCrimeEventWarehouse(args, runtime);
  assert.equal(rerun.idempotent, true);
  assert.deepEqual(await fs.readFile(receiptPath), before.bytes);
  assert.equal((await fs.stat(receiptPath)).mtimeMs, before.mtimeMs);
  assert.deepEqual(await fs.readFile(checkpointPath), before.checkpointBytes);
  assert.equal((await fs.stat(checkpointPath)).mtimeMs, before.checkpointMtimeMs);

  const receiptBytes = await fs.readFile(receiptPath);
  await fs.rm(receiptPath);
  const canonicalDirectory = path.join(root, 'warehouse', 'canonical');
  const populatedCanonicalName = `part-${String(
    partitionForSourceId(1, EVENT_CONTRACT.default_partition_count),
  ).padStart(3, '0')}.jsonl`;
  const populatedCanonicalPath = path.join(canonicalDirectory, populatedCanonicalName);
  await assertProducerBytesMutation(
    root,
    populatedCanonicalPath,
    (bytes) => Buffer.concat([Buffer.from('{invalid-json\n'), bytes]),
    /not valid JSON/i,
  );
  await assertProducerJsonLinesMutation(root, populatedCanonicalPath, (events) => {
    events[0].row_hash = `sha256:${'0'.repeat(64)}`;
    events[0].source_ids.objectid = '999999';
    events[0].raw_category.offense_label = 'Forged but valid label';
    events[0].generalized_location.value = '999 BLOCK FORGED ST';
  }, /drifted from its source row transforms/i);

  const currentSourceManifestPath = path.join(
    root,
    ...admitted.receipt.artifacts.current_source_manifest.path.split('/'),
  );
  await assertProducerJsonMutation(root, currentSourceManifestPath, (sourceManifest) => {
    sourceManifest.source_schema.cartodb_id = 'string';
  }, /source schema|approved source contract|manifest drifted/i);
  await assertProducerJsonMutation(root, currentSourceManifestPath, (sourceManifest) => {
    sourceManifest.snapshot_id = `sha256:${'0'.repeat(64)}`;
    sourceManifest.source_vintage.id = sourceManifest.snapshot_id;
  }, /identity|lineage source manifest drifted/i);

  const qualityPath = path.join(root, ...admitted.receipt.artifacts.latest_quality_report.path.split('/'));
  const revisionPath = path.join(root, ...admitted.receipt.artifacts.latest_revision_report.path.split('/'));
  await assertProducerJsonMutation(root, revisionPath, (revision) => {
    revision.counts.added += 1;
  }, /revision report counts drifted/i);
  await assertProducerJsonMutations(root, [revisionPath, qualityPath], ([revision, quality]) => {
    revision.counts.added -= 1;
    revision.counts.modified += 1;
    quality.revisions.added -= 1;
    quality.revisions.modified += 1;
  }, /mechanically recomputed source history/i);
  await assertProducerJsonMutation(root, checkpointPath, (checkpoint) => {
    checkpoint.periods[1].start = '2026-01-02';
  }, /exact continuous range/i);
  await assertProducerJsonMutation(root, checkpointPath, (checkpoint) => {
    checkpoint.periods[1].start = '2025-12-31';
  }, /exact continuous range/i);
  await assertProducerJsonMutation(root, currentSourceManifestPath, (sourceManifest) => {
    sourceManifest.scope.start = '2025-12-31';
  }, /scope|manifest drifted|identity/i);
  await fs.writeFile(receiptPath, receiptBytes);
  await createCrimeWarehouseAdmissionReceipt(root);

  const qualityBytes = await fs.readFile(qualityPath);
  const revisionBytes = await fs.readFile(revisionPath);
  await fs.appendFile(qualityPath, ' ', 'utf8');
  await assert.rejects(validateCrimeWarehouseAdmissionReceipt(root), /identity|drifted/i);
  await fs.writeFile(qualityPath, qualityBytes);
  await fs.rm(revisionPath);
  await assert.rejects(validateCrimeWarehouseAdmissionReceipt(root), /ENOENT|no such file/i);
  await fs.writeFile(revisionPath, revisionBytes);

  const currentSourceManifest = await readJson(currentSourceManifestPath);
  const rawShardPath = path.join(
    path.dirname(currentSourceManifestPath),
    ...currentSourceManifest.shards[0].path.split('/'),
  );
  const rawShardBytes = await fs.readFile(rawShardPath);
  await fs.appendFile(rawShardPath, ' ', 'utf8');
  await assert.rejects(validateCrimeWarehouseAdmissionReceipt(root), /identity does not match|raw shard bytes drifted/i);
  await fs.writeFile(rawShardPath, rawShardBytes);

  const driftedQuality = JSON.parse(qualityBytes.toString('utf8'));
  driftedQuality.schema = 'engagement-phl-crime-data-quality/drifted';
  await fs.writeFile(qualityPath, `${JSON.stringify(driftedQuality, null, 2)}\n`, 'utf8');
  await assert.rejects(validateCrimeWarehouseAdmissionReceipt(root), /companion schema drifted/i);
  await fs.writeFile(qualityPath, qualityBytes);

  await assertReceiptMutation(root, (receipt) => {
    receipt.mode = 'synthetic-test';
  }, /cannot admit synthetic/i);
  await assertReceiptMutation(root, (receipt) => {
    receipt.schema = 'engagement-phl-crime-warehouse-receipt/v2';
  }, /cannot admit synthetic|serving|integration|deletion authority/i);
  await assertReceiptMutation(root, (receipt) => {
    receipt.clocks.retrieved_at = '2026-08-22T12:00:00.000Z';
    receipt.clocks.built_at = '2026-08-22T11:00:00.000Z';
  }, /not finite and monotonic/i);
  await assertReceiptMutation(root, (receipt) => {
    receipt.artifacts.latest_quality_report.sha256 = `sha256:${'0'.repeat(64)}`;
  }, /fields drifted/i);
  await assertReceiptMutation(root, (receipt) => {
    receipt.source.revision = `sha256:${'0'.repeat(64)}`;
  }, /identity or source revision is invalid/i);
  await assertReceiptMutation(root, (receipt) => {
    receipt.coverage.latest_event_at = '2026-08-22T00:00:00.000Z';
  }, /not finite and monotonic/i);
  await assertReceiptMutation(root, (receipt) => {
    receipt.artifacts.latest_quality_report.path = 'warehouse/quality/../quality.json';
  }, /canonical safe relative path/i);
  await validateCrimeWarehouseAdmissionReceipt(root);
});

test('first metadata publication recovers every pre-manifest boundary without orphan lineage', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfev1-metadata-recovery-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const warehouseDir = path.join(root, 'warehouse');
  const snapshotDir = path.join(root, 'snapshot');
  await writeSyntheticSnapshot(snapshotDir, FIXTURE.vintages[0]);
  const dependencies = await createWarehouseDependencies({
    eventContract: EVENT_CONTRACT,
    sourceContract: SOURCE_CONTRACT,
    taxonomy: TAXONOMY,
    tractGeoJson: TRACTS,
    tractSourceRegistry: TRACT_REGISTRY,
    acsSnapshot: ACS,
    corridorRegistry: FIXTURE.corridor_registry,
  });

  for (const stage of ['quality', 'revision', 'lineage']) {
    await assert.rejects(ingestCrimeSourceSnapshot({
      snapshotDir,
      warehouseDir,
      dependencies,
      allowSynthetic: true,
      now: () => new Date(FIXTURE.vintages[0].retrieved_at),
      failAfterPublishMetadata: stage,
    }), new RegExp(`Injected metadata publish failure after ${stage}`));
    assert.equal(await pathExists(path.join(warehouseDir, 'manifest.json')), false);
    assert.equal(await pathExists(path.join(warehouseDir, 'lineage', 'registry.json')), false);
    assert.deepEqual(await directoryNames(path.join(warehouseDir, 'quality')), []);
    assert.deepEqual(await directoryNames(path.join(warehouseDir, 'revisions')), []);
    assert.deepEqual(await directoryNames(path.join(warehouseDir, 'canonical')), []);
    assert.deepEqual(await directoryNames(path.join(warehouseDir, '.transactions')), []);
  }

  await assert.rejects(ingestCrimeSourceSnapshot({
    snapshotDir,
    warehouseDir,
    dependencies,
    allowSynthetic: true,
    now: () => new Date(FIXTURE.vintages[0].retrieved_at),
    failAfterPublishMetadata: 'manifest',
  }), /Injected metadata publish failure after manifest/);
  const committedManifest = await readJson(path.join(warehouseDir, 'manifest.json'));
  const committedLineage = await readJson(path.join(warehouseDir, 'lineage', 'registry.json'));
  assert.deepEqual(committedManifest.applied_snapshot_ids, [committedManifest.current_snapshot_id]);
  assert.deepEqual(
    committedLineage.source_snapshots.map(({ snapshot_id: snapshotId }) => snapshotId),
    [committedManifest.current_snapshot_id],
  );
  assert.deepEqual(await directoryNames(path.join(warehouseDir, '.transactions')), []);

  const rerun = await ingestCrimeSourceSnapshot({
    snapshotDir,
    warehouseDir,
    dependencies,
    allowSynthetic: true,
    now: () => new Date('2026-08-17T12:00:00.000Z'),
  });
  assert.equal(rerun.idempotent, true);
  assert.deepEqual(
    (await readJson(path.join(warehouseDir, 'lineage', 'registry.json')))
      .source_snapshots.map(({ snapshot_id: snapshotId }) => snapshotId),
    [committedManifest.current_snapshot_id],
  );
});

test('revision-aware warehouse preserves event lifecycle, lineage, crosswalk, spatial, and ACS semantics', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dfev1-event-warehouse-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const warehouseDir = path.join(root, 'warehouse');
  const firstDir = path.join(root, 'snapshot-1');
  const secondDir = path.join(root, 'snapshot-2');
  await writeSyntheticSnapshot(firstDir, FIXTURE.vintages[0]);
  await writeSyntheticSnapshot(secondDir, FIXTURE.vintages[1]);
  const dependencies = await createWarehouseDependencies({
    eventContract: EVENT_CONTRACT,
    sourceContract: SOURCE_CONTRACT,
    taxonomy: TAXONOMY,
    tractGeoJson: TRACTS,
    tractSourceRegistry: TRACT_REGISTRY,
    acsSnapshot: ACS,
    corridorRegistry: FIXTURE.corridor_registry,
  });

  const first = await ingestCrimeSourceSnapshot({
    snapshotDir: firstDir,
    warehouseDir,
    dependencies,
    allowSynthetic: true,
    now: () => new Date(FIXTURE.vintages[0].retrieved_at),
  });
  assert.equal(first.idempotent, false);
  assert.equal(first.manifest.mode, 'synthetic-test');
  assert.equal(first.manifest.serving_eligible, false);
  assert.equal(first.manifest.canonical_row_count, 5);
  assert.equal(first.quality.revisions.added, 5);
  assert.deepEqual(first.quality.labels.unknown_observed, ['Synthetic Unknown Label']);

  const beforeFailedPublish = await warehouseEvidence(warehouseDir);
  await assert.rejects(
    ingestCrimeSourceSnapshot({
      snapshotDir: secondDir,
      warehouseDir,
      dependencies,
      allowSynthetic: true,
      now: () => new Date(FIXTURE.vintages[1].retrieved_at),
      failAtPublishPartition: 2,
    }),
    /Injected publish failure/,
  );
  assert.deepEqual(await warehouseEvidence(warehouseDir), beforeFailedPublish);

  const second = await ingestCrimeSourceSnapshot({
    snapshotDir: secondDir,
    warehouseDir,
    dependencies,
    allowSynthetic: true,
    now: () => new Date(FIXTURE.vintages[1].retrieved_at),
  });
  assert.equal(second.manifest.canonical_row_count, 7);
  assert.equal(second.manifest.active_row_count, 6);
  assert.equal(second.manifest.removal_candidate_count, 1);
  assert.deepEqual(second.quality.revisions, {
    added: 1,
    'late-arriving': 1,
    modified: 1,
    reclassified: 1,
    unchanged: 2,
    reappeared: 0,
    'removal-candidate': 1,
    'transformation-updated': 0,
  });

  const events = await readCanonicalEvents(warehouseDir);
  const byId = new Map(events.map((event) => [event.source_record_id, event]));
  const unchanged = byId.get('cartodb:101');
  const reclassified = byId.get('cartodb:102');
  const modified = byId.get('cartodb:103');
  const removed = byId.get('cartodb:104');
  const unknown = byId.get('cartodb:105');
  const late = byId.get('cartodb:106');
  const added = byId.get('cartodb:107');
  assert.equal(unchanged.first_seen_at, FIXTURE.vintages[0].retrieved_at);
  assert.equal(unchanged.last_seen_at, FIXTURE.vintages[1].retrieved_at);
  assert.equal(removed.first_seen_at, FIXTURE.vintages[0].retrieved_at);
  assert.equal(removed.last_seen_at, FIXTURE.vintages[0].retrieved_at);
  assert.equal(removed.lifecycle.state, 'removal-candidate');
  assert.equal(removed.lifecycle.first_missing_at, FIXTURE.vintages[1].retrieved_at);
  assert.equal(removed.lifecycle.last_missing_snapshot_id, second.manifest.current_snapshot_id);
  assert.equal(removed.source_vintage.snapshot_id, first.manifest.current_snapshot_id);
  assert.equal(removed.lineage.source_snapshot_id, first.manifest.current_snapshot_id);
  assert.notEqual(
    reclassified.row_hash,
    beforeFailedPublish.events.find((event) => event.source_record_id === 'cartodb:102').row_hash,
  );
  assert.equal(reclassified.normalized_category.offense_code, 'Robbery No Firearm');
  assert.equal(modified.generalized_location.value, '350 BLOCK SYNTHETIC ST');
  assert.equal(unknown.normalized_category.status, 'unknown-label');
  assert.equal(unknown.normalized_category.offense_code, null);
  assert.equal(late.first_seen_at, FIXTURE.vintages[1].retrieved_at);
  assert.equal(added.first_seen_at, FIXTURE.vintages[1].retrieved_at);
  assert.equal(unchanged.generalized_location.exact_sidewalk_or_street_segment, false);
  assert.equal(unchanged.coordinate.exact_location_claim, false);
  assert.equal(unchanged.spatial.tract.status, 'mapped');
  assert.equal(unchanged.spatial.grid.status, 'mapped');
  assert.equal(unchanged.spatial.route_corridor.status, 'available');
  assert.ok(unchanged.spatial.route_corridor.matches.every(({ relation }) => relation === 'reported-point-near-route'));
  assert.equal(unchanged.acs.status, 'incompatible-vintage');
  assert.equal(unchanged.acs.valueStatus, 'available');
  assert.equal(unchanged.acs.modelInputEligible, false);
  assert.equal(unchanged.acs.estimate.variable, 'B01003_001E');
  assert.equal(unchanged.acs.moe90.variable, 'B01003_001M');
  assert.notEqual(unchanged.acs.estimate.variable, unchanged.acs.moe90.variable);
  assert.equal(unchanged.lineage.source_snapshot_id, second.manifest.current_snapshot_id);

  const manifestPath = path.join(warehouseDir, 'manifest.json');
  const canonicalPath = path.join(
    warehouseDir,
    'canonical',
    `part-${String(partitionForSourceId(101, EVENT_CONTRACT.default_partition_count)).padStart(3, '0')}.jsonl`,
  );
  const manifestBefore = await fs.readFile(manifestPath, 'utf8');
  const canonicalBefore = await fs.stat(canonicalPath);
  const idempotent = await ingestCrimeSourceSnapshot({
    snapshotDir: secondDir,
    warehouseDir,
    dependencies,
    allowSynthetic: true,
    now: () => new Date('2026-08-17T12:00:00.000Z'),
  });
  assert.equal(idempotent.idempotent, true);
  assert.equal(await fs.readFile(manifestPath, 'utf8'), manifestBefore);
  assert.equal((await fs.stat(canonicalPath)).mtimeMs, canonicalBefore.mtimeMs);
});

test('tract boundary, fixed grid, and coordinate mapping fail closed', () => {
  const tracts = {
    type: 'FeatureCollection',
    features: [
      squareTract('42101000101', 0, 0, 1, 1),
      squareTract('42101000102', 1, 0, 2, 1),
    ],
  };
  const index = createTractSpatialIndex(tracts, {
    sourceId: 'synthetic-boundaries',
    geographyDefinition: 'synthetic-only',
  });
  assert.equal(index.mapPoint([0.5, 0.5]).status, 'mapped');
  assert.equal(index.mapPoint([1, 0.5]).status, 'ambiguous');
  assert.equal(index.mapPoint([3, 3]).status, 'unmapped');
  assert.equal(validateSourceCoordinate([null, null], [-1, -1, 1, 1]).reason, 'coordinate-missing');
  assert.equal(validateSourceCoordinate([20, 20], [-1, -1, 1, 1]).reason, 'coordinate-outside-city-bounds');
  assert.equal(fixedWebMercatorGridCell([-75.16, 39.95]).gridId, fixedWebMercatorGridCell([-75.16, 39.95]).gridId);
});

test('ACS estimate/MOE admission rejects geography-definition drift', () => {
  const geoids = TRACTS.features.map((feature) => feature.properties.GEOID).sort();
  const index = createAcsPopulationIndex(ACS, {
    contract: EVENT_CONTRACT.acs,
    tractGeoids: geoids,
    tractGeographyDefinition: EVENT_CONTRACT.acs.geography_definition,
  });
  const withinPeriod = index.mapTract(geoids[0], { eventAt: '2024-06-01T00:00:00.000Z' });
  const outsidePeriod = index.mapTract(geoids[0], { eventAt: '2026-06-01T00:00:00.000Z' });
  assert.equal(withinPeriod.status, 'available');
  assert.equal(withinPeriod.modelInputEligible, true);
  assert.equal(outsidePeriod.status, 'incompatible-vintage');
  assert.equal(outsidePeriod.valueStatus, 'available');
  assert.equal(outsidePeriod.modelInputEligible, false);
  assert.throws(() => createAcsPopulationIndex(ACS, {
    contract: EVENT_CONTRACT.acs,
    tractGeoids: geoids,
    tractGeographyDefinition: '2010-census-tracts',
  }), /does not match tract definition/);
});

test('source acquisition is keyset-bounded and rejects schema drift before publication', async (context) => {
  assert.deepEqual(annualPeriods('2006-01-01', '2007-02-03'), [
    { start: '2006-01-01', end_exclusive: '2007-01-01' },
    { start: '2007-01-01', end_exclusive: '2007-02-03' },
  ]);
  assert.deepEqual(resolveIncrementalCrimeScope({
    coverage: { latest_event_at: '2026-08-20T03:47:00.000Z' },
  }, { end: '2026-08-22', overlapDays: 45 }), {
    start: '2026-07-06',
    end: '2026-08-22',
    mode: 'overlap-incremental',
    overlapDays: 45,
  });
  const sql = buildPageSql(SOURCE_CONTRACT, {
    start: '2026-08-20',
    end: '2026-08-21',
    lastSourceId: 123,
    pageSize: 500,
  });
  assert.match(sql, /dispatch_date_time >= '2026-08-20'/);
  assert.match(sql, /dispatch_date_time < '2026-08-21'/);
  assert.match(sql, /cartodb_id > 123/);
  assert.match(sql, /ORDER BY cartodb_id ASC/);

  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfev1-schema-drift-'));
  context.after(() => fs.rm(outputDir, { recursive: true, force: true }));
  const request = async (input) => {
    const query = new URL(input).searchParams.get('q');
    if (query.startsWith('SELECT COUNT(*)')) {
      return jsonResponse({
        rows: [{
          row_count: 1,
          distinct_source_ids: 1,
          distinct_dc_keys: 1,
          min_event_at: '2026-08-20T01:00:00Z',
          max_event_at: '2026-08-20T01:00:00Z',
        }],
        fields: {},
      });
    }
    return jsonResponse({
      rows: [{ cartodb_id: 1 }],
      fields: { cartodb_id: { type: 'number' } },
    });
  };
  await assert.rejects(acquireCrimeSourceSnapshot({
    outputDir,
    start: '2026-08-20',
    end: '2026-08-21',
    pageSize: 10,
    partitionCount: EVENT_CONTRACT.default_partition_count,
    sourceContract: SOURCE_CONTRACT,
    request,
    now: () => new Date('2026-08-21T00:00:00.000Z'),
  }), /schema drifted/);
  assert.equal(await pathExists(path.join(outputDir, 'manifest.json')), false);
});

test('source acquisition resumes its exact checkpoint without duplicating committed pages', async (context) => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfev1-source-resume-'));
  context.after(() => fs.rm(outputDir, { recursive: true, force: true }));
  const fields = Object.fromEntries(
    Object.entries(SOURCE_CONTRACT.expected_query_schema).map(([name, type]) => [name, { type }]),
  );
  const summary = {
    rows: [{
      row_count: 3,
      distinct_source_ids: 3,
      distinct_dc_keys: 3,
      min_event_at: '2026-08-20T01:00:00Z',
      max_event_at: '2026-08-20T03:00:00Z',
    }],
    fields: {},
  };
  const firstRequest = async (input) => {
    const query = new URL(input).searchParams.get('q');
    if (query.startsWith('SELECT COUNT(*)')) return jsonResponse(summary);
    if (query.includes('cartodb_id > 0')) {
      return jsonResponse({ rows: [sourceRow(1), sourceRow(2)], fields });
    }
    throw new Error('synthetic interrupted transport');
  };
  await assert.rejects(acquireCrimeSourceSnapshot({
    outputDir,
    start: '2026-08-20',
    end: '2026-08-21',
    pageSize: 2,
    partitionCount: 4,
    sourceContract: SOURCE_CONTRACT,
    request: firstRequest,
    now: () => new Date('2026-08-21T00:00:00.000Z'),
  }), /failed after 3 attempts/);
  const interruptedCheckpoint = await readJson(path.join(outputDir, 'checkpoint.json'));
  assert.equal(interruptedCheckpoint.row_count, 2);
  assert.equal(interruptedCheckpoint.last_source_id, 2);
  assert.equal(interruptedCheckpoint.complete, false);

  const resumeRequest = async (input) => {
    const query = new URL(input).searchParams.get('q');
    if (query.startsWith('SELECT COUNT(*)')) return jsonResponse(summary);
    assert.match(query, /cartodb_id > 2/);
    return jsonResponse({ rows: [sourceRow(3)], fields });
  };
  const resumed = await acquireCrimeSourceSnapshot({
    outputDir,
    start: '2026-08-20',
    end: '2026-08-21',
    pageSize: 2,
    partitionCount: 4,
    sourceContract: SOURCE_CONTRACT,
    request: resumeRequest,
    now: () => new Date('2026-08-21T00:05:00.000Z'),
  });
  assert.equal(resumed.idempotent, false);
  assert.equal(resumed.manifest.row_count, 3);
  assert.equal(resumed.manifest.acquisition.pages_completed, 2);
  assert.equal(resumed.manifest.acquisition.count_complete, true);
});

function officialBackfillRuntime() {
  const rows = [
    {
      ...sourceRow(1),
      dispatch_date_time: '2025-12-31T01:00:00.000Z',
      dispatch_date: '2025-12-31',
    },
    {
      ...sourceRow(2),
      dispatch_date_time: '2026-01-01T03:00:00.000Z',
      dispatch_date: '2026-01-01',
      dispatch_time: '03:00:00',
      hour: 3,
      point_x: null,
      point_y: null,
    },
  ];
  const fields = Object.fromEntries(
    Object.entries(SOURCE_CONTRACT.expected_query_schema).map(([name, type]) => [name, { type }]),
  );
  const request = async (input) => {
    const sql = new URL(input).searchParams.get('q');
    const start = sql.match(/dispatch_date_time >= '([^']+)'/)?.[1];
    const end = sql.match(/dispatch_date_time < '([^']+)'/)?.[1];
    const scopedRows = rows.filter((row) => row.dispatch_date_time >= start && row.dispatch_date_time < end);
    if (sql.startsWith('SELECT COUNT(*)')) {
      return jsonResponse({
        rows: [{
          row_count: scopedRows.length,
          distinct_source_ids: scopedRows.length,
          distinct_dc_keys: scopedRows.length,
          min_event_at: scopedRows[0]?.dispatch_date_time || null,
          max_event_at: scopedRows.at(-1)?.dispatch_date_time || null,
        }],
        fields: {},
      });
    }
    if (sql.includes('cartodb_id > 0')) return jsonResponse({ rows: scopedRows, fields });
    return jsonResponse({ rows: [], fields });
  };
  let clock = Date.parse('2026-08-22T10:30:00.000Z');
  return {
    now() {
      const value = new Date(clock);
      clock += 1_000;
      return value;
    },
    async inspectCrimeSourceHealth() {
      return {
        schema: 'engagement-phl-crime-source-health-observation/v1',
        observed_at: '2026-08-22T10:29:59.000Z',
        row_count: rows.length,
        date_scoped_row_count: rows.length,
        scope: { start: '2025-12-31', end_exclusive: '2026-01-02' },
        distinct_source_ids: rows.length,
        distinct_dc_keys: rows.length,
        duplicate_source_id_count: 0,
        suspected_duplicate_dc_key_excess: 0,
        event_time_missing: 0,
        source_id_missing: 0,
        coordinate_missing: 1,
        coordinate_outside_city_bounds: 0,
        min_event_at: rows[0].dispatch_date_time,
        max_event_at: rows[1].dispatch_date_time,
        meaning: 'Test transport observation; never official evidence.',
      };
    },
    acquireCrimeSourceSnapshot(options) {
      return acquireCrimeSourceSnapshot({ ...options, request });
    },
  };
}

async function assertReceiptMutation(root, mutate, pattern) {
  const receiptPath = path.join(root, 'receipt.json');
  const original = await fs.readFile(receiptPath);
  const value = JSON.parse(original.toString('utf8'));
  mutate(value);
  await fs.writeFile(receiptPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await assert.rejects(validateCrimeWarehouseAdmissionReceipt(root), pattern);
  } finally {
    await fs.writeFile(receiptPath, original);
  }
}

async function assertProducerJsonMutation(root, filePath, mutate, pattern) {
  const original = await fs.readFile(filePath);
  const value = JSON.parse(original.toString('utf8'));
  mutate(value);
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await assert.rejects(createCrimeWarehouseAdmissionReceipt(root), pattern);
  } finally {
    await fs.writeFile(filePath, original);
  }
}

async function assertProducerJsonMutations(root, filePaths, mutate, pattern) {
  const originals = await Promise.all(filePaths.map((filePath) => fs.readFile(filePath)));
  const values = originals.map((original) => JSON.parse(original.toString('utf8')));
  mutate(values);
  await Promise.all(filePaths.map((filePath, index) => (
    fs.writeFile(filePath, `${JSON.stringify(values[index], null, 2)}\n`, 'utf8')
  )));
  try {
    await assert.rejects(createCrimeWarehouseAdmissionReceipt(root), pattern);
  } finally {
    await Promise.all(filePaths.map((filePath, index) => fs.writeFile(filePath, originals[index])));
  }
}

async function assertProducerJsonLinesMutation(root, filePath, mutate, pattern) {
  const original = await fs.readFile(filePath);
  const values = original.toString('utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  mutate(values);
  await fs.writeFile(filePath, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`, 'utf8');
  try {
    await assert.rejects(createCrimeWarehouseAdmissionReceipt(root), pattern);
  } finally {
    await fs.writeFile(filePath, original);
  }
}

async function assertProducerBytesMutation(root, filePath, mutate, pattern) {
  const original = await fs.readFile(filePath);
  await fs.writeFile(filePath, mutate(original));
  try {
    await assert.rejects(createCrimeWarehouseAdmissionReceipt(root), pattern);
  } finally {
    await fs.writeFile(filePath, original);
  }
}

async function directoryNames(directory) {
  try {
    return (await fs.readdir(directory)).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeSyntheticSnapshot(directory, vintage) {
  const partitionCount = EVENT_CONTRACT.default_partition_count;
  const rowsByPartition = Array.from({ length: partitionCount }, () => []);
  for (const row of vintage.rows) rowsByPartition[partitionForSourceId(row.cartodb_id, partitionCount)].push(row);
  const rowsDir = path.join(directory, 'rows');
  await fs.mkdir(rowsDir, { recursive: true });
  const shards = [];
  for (let partition = 0; partition < partitionCount; partition += 1) {
    rowsByPartition[partition].sort((left, right) => left.cartodb_id - right.cartodb_id);
    const text = rowsByPartition[partition].map((row) => JSON.stringify(row)).join('\n')
      + (rowsByPartition[partition].length ? '\n' : '');
    const shardPath = path.join(rowsDir, `part-${String(partition).padStart(3, '0')}.jsonl`);
    await fs.writeFile(shardPath, text, 'utf8');
    shards.push({
      partition,
      path: `rows/part-${String(partition).padStart(3, '0')}.jsonl`,
      row_count: rowsByPartition[partition].length,
      bytes: Buffer.byteLength(text),
      identity: sha256(text),
    });
  }
  const snapshotId = sha256(JSON.stringify({
    retrieved_at: vintage.retrieved_at,
    source_as_of: vintage.source_as_of,
    rows: vintage.rows,
  }));
  const countsByDate = {};
  const countsByCategory = {};
  for (const row of vintage.rows) {
    const date = row.dispatch_date_time.slice(0, 10);
    countsByDate[date] = (countsByDate[date] || 0) + 1;
    countsByCategory[row.text_general_code] = (countsByCategory[row.text_general_code] || 0) + 1;
  }
  await fs.writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify({
    schema: 'engagement-phl-crime-synthetic-snapshot/v1',
    source_kind: 'synthetic',
    synthetic_fixture: true,
    serving_eligible: false,
    snapshot_id: snapshotId,
    availability: 'available',
    scope: FIXTURE.scope,
    source_vintage: {
      id: snapshotId,
      source_as_of: vintage.source_as_of,
      retrieved_at: vintage.retrieved_at,
    },
    row_count: vintage.rows.length,
    partition_count: partitionCount,
    shards,
    quality: {
      schema_drift: false,
      duplicate_source_id_count: 0,
      suspected_duplicate_count: 0,
      suspected_duplicate_basis: 'synthetic fixture unique ids',
      counts_by_date: countsByDate,
      counts_by_category: countsByCategory,
    },
  }, null, 2)}\n`, 'utf8');
}

async function readCanonicalEvents(warehouseDir) {
  const entries = await fs.readdir(path.join(warehouseDir, 'canonical'));
  const events = [];
  for (const entry of entries.sort()) {
    const text = await fs.readFile(path.join(warehouseDir, 'canonical', entry), 'utf8');
    for (const line of text.split(/\r?\n/)) if (line) events.push(JSON.parse(line));
  }
  return events;
}

async function warehouseEvidence(warehouseDir) {
  const events = await readCanonicalEvents(warehouseDir);
  return {
    manifest: await fs.readFile(path.join(warehouseDir, 'manifest.json'), 'utf8'),
    events: events.sort((left, right) => left.source_record_id.localeCompare(right.source_record_id)),
  };
}

function squareTract(geoid, minX, minY, maxX, maxY) {
  return {
    type: 'Feature',
    properties: { GEOID: geoid },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY],
      ]],
    },
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sourceRow(id) {
  return {
    cartodb_id: id,
    objectid: 1000 + id,
    dc_dist: '9',
    psa: '1',
    dispatch_date_time: `2026-08-20T0${id}:00:00.000Z`,
    dispatch_date: '2026-08-20',
    dispatch_time: `0${id}:00:00`,
    hour: id,
    dc_key: 202609000000 + id,
    location_block: `${id}00 BLOCK SYNTHETIC RESUME ST`,
    ucr_general: '600',
    text_general_code: 'Thefts',
    point_x: -75.16,
    point_y: 39.95,
  };
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
