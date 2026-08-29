import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildHomeCompareCitywideSourceLifecycle,
  HOME_COMPARE_CITYWIDE_LIFECYCLE_SCHEMA,
  HOME_COMPARE_CITYWIDE_SOURCE_RECEIPT_SCHEMA,
  HOME_COMPARE_SOURCE_IDS,
  loadHomeCompareCitywideLifecycleInputs,
  validateHomeCompareCitywideSourceLifecycle,
  validateObservationManifest,
  writeHomeCompareCitywideSourceLifecycle,
} from '../lib/home_compare_citywide_source_lifecycle.mjs';

const registryText = await fs.readFile(new URL('../../public/data/home_compare_sources.v1.json', import.meta.url));
const registryValue = JSON.parse(registryText);
const GENERATED_AT = '2026-08-30T04:00:00.000Z';
const VALIDATION_CLOCK = '2026-08-30T05:00:00.000Z';

test('strict lifecycle schema fixes the complete ordered nine-source receipt contract', () => {
  const lifecycle = buildFixtureLifecycle();
  assert.equal(lifecycle.schema, HOME_COMPARE_CITYWIDE_LIFECYCLE_SCHEMA);
  assert.deepEqual(lifecycle.receipts.map(({ source_id: sourceId }) => sourceId), HOME_COMPARE_SOURCE_IDS);
  assert.ok(lifecycle.receipts.every(({ schema }) => schema === HOME_COMPARE_CITYWIDE_SOURCE_RECEIPT_SCHEMA));
  assert.equal(new Set(lifecycle.receipts.map(({ semantic_identity: id }) => id)).size, 9);
  assert.equal(new Set(lifecycle.receipts.map(({ receipt_identity: id }) => id)).size, 9);
  assert.deepEqual(validateHomeCompareCitywideSourceLifecycle(lifecycle), lifecycle);

  const unknown = structuredClone(lifecycle);
  unknown.receipts[0].unexpected = true;
  assert.throws(
    () => validateHomeCompareCitywideSourceLifecycle(unknown),
    /schema validation failed|additional properties/i,
  );
  const reordered = structuredClone(lifecycle);
  [reordered.receipts[0], reordered.receipts[1]] = [reordered.receipts[1], reordered.receipts[0]];
  assert.throws(
    () => validateHomeCompareCitywideSourceLifecycle(reordered),
    /schema validation failed|ordered nine-source/i,
  );
  const falsePromotion = structuredClone(lifecycle);
  falsePromotion.receipts[1].evidence_kind = 'hin-snapshot-receipt';
  assert.throws(
    () => validateHomeCompareCitywideSourceLifecycle(falsePromotion),
    /changed its evidence mapping/i,
  );
});

test('citywide geocoder is unavailable and mutable metadata cannot become a full snapshot', () => {
  const lifecycle = buildFixtureLifecycle();
  const geocoder = receipt(lifecycle, 'citygeo-address-locator');
  assert.equal(geocoder.status, 'unavailable');
  assert.equal(geocoder.coverage.status, 'unavailable');
  assert.equal(geocoder.coverage.row_count, null);
  assert.equal(geocoder.coverage.available_zero, false);
  assert.ok(geocoder.dq.flags.includes('citywide-geocoder-snapshot-unavailable'));

  for (const sourceId of HOME_COMPARE_SOURCE_IDS.slice(1, 7)) {
    const sourceReceipt = receipt(lifecycle, sourceId);
    assert.equal(sourceReceipt.evidence_kind, 'bounded-metadata-observation');
    assert.equal(sourceReceipt.status, 'partial');
    assert.equal(sourceReceipt.coverage.exact_payload, false);
    assert.equal(sourceReceipt.coverage.completeness_admitted, false);
    assert.equal(sourceReceipt.licence.redistribution_authority, false);
    assert.ok(sourceReceipt.dq.flags.includes(
      'mutable-row-count-is-not-monotonic-or-completeness-authority',
    ));
  }
});

test('PPD and HIN reuse exact admission identities without creating live-table authority', () => {
  const inputs = fixtureInputs();
  const lifecycle = buildHomeCompareCitywideSourceLifecycle(inputs);
  const ppd = receipt(lifecycle, 'philadelphia-reported-crime');
  assert.equal(ppd.evidence_kind, 'm1-warehouse-admission-receipt');
  assert.equal(ppd.reuse.receipt_identity, inputs.m1Admission.receipt.identity);
  assert.equal(ppd.reuse.receipt_sha256, inputs.m1Admission.receipt_artifact.sha256);
  assert.equal(ppd.reuse.payload_sha256, inputs.m1Admission.receipt.artifacts.canonical.sha256);
  assert.equal(ppd.identity.source_revision, inputs.m1Admission.receipt.source.revision);
  assert.ok(ppd.dq.flags.includes('bounded-observation-source-revision-unavailable'));
  assert.ok(ppd.dq.flags.includes(
    'bounded-observation-count-differs-from-exact-m1-no-delta-claim',
  ));
  assert.equal(ppd.authority.product_authority, false);
  assert.equal(ppd.authority.publication_authority, false);

  const hin = receipt(lifecycle, 'vision-zero-hin-2025');
  assert.equal(hin.evidence_kind, 'hin-snapshot-receipt');
  assert.equal(hin.reuse.payload_sha256, inputs.hinAdmission.snapshot_artifact.sha256);
  assert.equal(hin.reuse.receipt_sha256, inputs.hinAdmission.receipt_artifact.sha256);
  assert.equal(hin.status, 'partial');
  assert.equal(hin.coverage.status, 'exact-receipt-review-incomplete');
  assert.equal(hin.coverage.completeness_admitted, false);
  assert.equal(hin.dq.status, 'partial');
  assert.ok(hin.dq.flags.includes('hin-lifecycle-review-incomplete'));
  assert.ok(hin.dq.flags.includes('hin-build-clock-not-recorded'));
  assert.ok(hin.dq.flags.includes('hin-review-clock-not-recorded'));
  assert.ok(hin.dq.flags.includes('not-raw-crash-data'));
  assert.ok(hin.dq.flags.includes('not-current-safety-evidence'));
  assert.equal(hin.dq.flags.includes('bounded-observation-source-revision-unavailable'), false);
  assert.equal(hin.dq.flags.includes(
    'bounded-observation-count-differs-from-exact-hin-no-delta-claim',
  ), false);
  assert.equal(hin.claims.raw_crash_data_claimed, false);
  assert.equal(hin.claims.current_safety_claimed, false);

  const reviewedInputs = fixtureInputs();
  reviewedInputs.hinAdmission.receipt.artifact.builtAt = '2026-08-20T00:00:00.000Z';
  reviewedInputs.hinAdmission.receipt.artifact.buildClockStatus = 'recorded-at-admitted-build';
  reviewedInputs.hinAdmission.receipt.review = {
    status: 'admitted-after-review',
    reviewedAt: '2026-08-20T01:00:00.000Z',
    reviewedBy: 'synthetic-test-reviewer',
    note: 'Synthetic reviewed fixture.',
  };
  const reviewedHin = receipt(
    buildHomeCompareCitywideSourceLifecycle(reviewedInputs),
    'vision-zero-hin-2025',
  );
  assert.equal(reviewedHin.status, 'available');
  assert.equal(reviewedHin.coverage.status, 'complete-exact-receipt');
  assert.equal(reviewedHin.coverage.completeness_admitted, true);
  assert.equal(reviewedHin.dq.status, 'pass');

  const wrongLayerInputs = fixtureInputs();
  wrongLayerInputs.hinAdmission.receipt.source.layerUrl = wrongLayerInputs.hinAdmission.receipt.source.layerUrl
    .replace('high_injury_network_2025', 'different_network');
  assert.throws(
    () => buildHomeCompareCitywideSourceLifecycle(wrongLayerInputs),
    /HIN admission source does not match/i,
  );
});

test('observation identity, source, schema, row-count, clocks, and finite numbers fail closed', () => {
  const manifest = observationManifest();
  const hostileCases = [
    (value) => { value.extra = true; },
    (value) => { value.observations[1].sourceId = 'wrong-source'; },
    (value) => { value.observations[1].schemaFields = []; },
    (value) => { value.observations[1].rowCount += 1; },
    (value) => { value.observations[1].rowCount = Number.NaN; },
    (value) => { value.observations[1].rowCount = Number.POSITIVE_INFINITY; },
    (value) => { value.observations[1].retrievedAt = '2026-08-31T00:00:00.000Z'; },
  ];
  for (const mutate of hostileCases) {
    const hostile = structuredClone(manifest);
    mutate(hostile);
    assert.throws(
      () => validateObservationManifest(hostile, registryValue, VALIDATION_CLOCK),
      /unknown|identity|schema|row count|finite|future|contract/i,
    );
  }
});

test('stale manifests are rejected and stale sources become unavailable, never current or zero', () => {
  assert.throws(
    () => validateObservationManifest(
      observationManifest(),
      registryValue,
      '2026-09-01T04:00:00.001Z',
    ),
    /stale or future-dated/i,
  );
  assert.throws(
    () => validateObservationManifest(
      observationManifest(),
      registryValue,
      '2026-08-30T03:59:59.999Z',
    ),
    /stale or future-dated/i,
  );

  const manifest = observationManifest();
  const transfers = manifest.observations[3];
  transfers.sourceAsOf = '2026-08-01T00:00:00.000Z';
  refreshManifestIdentity(manifest);
  const lifecycle = buildFixtureLifecycle({ manifest });
  const sourceReceipt = receipt(lifecycle, 'real-estate-transfers');
  assert.equal(sourceReceipt.freshness.status, 'stale');
  assert.equal(sourceReceipt.status, 'unavailable');
  assert.equal(sourceReceipt.coverage.row_count, null);
  assert.equal(sourceReceipt.coverage.available_zero, false);
});

test('semantic identity excludes observation clocks while receipt identity and freshness retain them', () => {
  const firstManifest = observationManifest();
  const secondManifest = structuredClone(firstManifest);
  secondManifest.generatedAt = '2026-08-30T05:00:00.000Z';
  for (const observed of secondManifest.observations) {
    if (observed.retrievedAt !== null) observed.retrievedAt = secondManifest.generatedAt;
  }
  refreshManifestIdentity(secondManifest);
  assert.equal(secondManifest.semanticIdentity, firstManifest.semanticIdentity);
  const first = buildFixtureLifecycle({ manifest: firstManifest });
  const second = buildFixtureLifecycle({ manifest: secondManifest });
  assert.deepEqual(
    second.receipts.map(({ semantic_identity: identity }) => identity),
    first.receipts.map(({ semantic_identity: identity }) => identity),
  );
  assert.notDeepEqual(
    second.receipts.map(({ receipt_identity: identity }) => identity),
    first.receipts.map(({ receipt_identity: identity }) => identity),
  );
});

test('HIN observation count drift is explicit and revision drift makes current admission unavailable', () => {
  const countDrift = observationManifest();
  countDrift.observations[8].rowCount = 163;
  refreshManifestIdentity(countDrift);
  const countReceipt = receipt(buildFixtureLifecycle({ manifest: countDrift }), 'vision-zero-hin-2025');
  assert.equal(countReceipt.status, 'partial');
  assert.ok(countReceipt.dq.flags.includes(
    'bounded-observation-count-differs-from-exact-hin-no-delta-claim',
  ));

  const revisionDrift = observationManifest();
  revisionDrift.observations[8].revision = 'arcgis-last-edit:1';
  refreshManifestIdentity(revisionDrift);
  const driftReceipt = receipt(buildFixtureLifecycle({ manifest: revisionDrift }), 'vision-zero-hin-2025');
  assert.equal(driftReceipt.status, 'unavailable');
  assert.equal(driftReceipt.coverage.row_count, null);
  assert.ok(driftReceipt.dq.flags.includes(
    'bounded-observation-revision-differs-from-exact-hin-fail-closed',
  ));
});

test('licence weakening fails closed and every admitted output keeps redistribution false', () => {
  const hostileRegistry = structuredClone(registryValue);
  hostileRegistry.terms.limitation = 'Public metadata.';
  const inputs = fixtureInputs();
  inputs.registry.value = hostileRegistry;
  assert.throws(
    () => buildHomeCompareCitywideSourceLifecycle(inputs),
    /redistribution licence boundary/i,
  );
  const lifecycle = buildFixtureLifecycle();
  assert.equal(lifecycle.authority.redistribution_authority, false);
  assert.ok(lifecycle.receipts.every(({ authority, licence }) => (
    authority.redistribution_authority === false
      && licence.redistribution_authority === false
  )));
});

test('mutable row-count decreases remain partial observations rather than deletion or error claims', () => {
  const earlier = observationManifest();
  earlier.observations[2].rowCount = 7_478_949;
  refreshManifestIdentity(earlier);
  const current = observationManifest();
  current.observations[2].rowCount = 7_478_382;
  refreshManifestIdentity(current);
  const priorReceipt = receipt(buildFixtureLifecycle({ manifest: earlier }), 'opa-assessment-history');
  const currentReceipt = receipt(buildFixtureLifecycle({ manifest: current }), 'opa-assessment-history');
  assert.equal(currentReceipt.status, 'partial');
  assert.equal(currentReceipt.coverage.row_count, 7_478_382);
  assert.notEqual(currentReceipt.semantic_identity, priorReceipt.semantic_identity);
  assert.ok(currentReceipt.dq.flags.includes(
    'mutable-row-count-is-not-monotonic-or-completeness-authority',
  ));
  assert.doesNotMatch(JSON.stringify(currentReceipt), /delet(?:e|ion)|append-only|complete snapshot/i);
});

test('available-zero requires exact complete evidence; bounded zero and unavailable remain distinct', () => {
  const manifest = observationManifest();
  manifest.observations[4].rowCount = 0;
  manifest.observations[5] = {
    ...manifest.observations[5],
    status: 'unavailable',
    retrievedAt: null,
    sourceAsOf: null,
    revision: null,
    rowCount: null,
    schemaFields: [],
    missingFields: [...registryValue.sources[5].expected_fields],
    dq: ['source-observation-failed-closed'],
  };
  refreshManifestIdentity(manifest);
  const inputs = fixtureInputs({ manifest });
  inputs.m1Admission.receipt.counts.canonical_rows = 0;
  const lifecycle = buildHomeCompareCitywideSourceLifecycle(inputs);
  const boundedZero = receipt(lifecycle, 'philly311-requests');
  const unavailable = receipt(lifecycle, 'li-property-history');
  const exactZero = receipt(lifecycle, 'philadelphia-reported-crime');
  assert.equal(boundedZero.status, 'partial');
  assert.equal(boundedZero.coverage.row_count, 0);
  assert.equal(boundedZero.coverage.available_zero, false);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.coverage.row_count, null);
  assert.equal(exactZero.status, 'available-zero');
  assert.equal(exactZero.coverage.row_count, 0);
  assert.equal(exactZero.coverage.available_zero, true);
});

test('explicit M1 and HIN paths must match exact validated bytes and identities', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'home-compare-p5-inputs-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const registryPath = path.join(directory, 'registry.json');
  const observationPath = path.join(directory, 'observation.json');
  const m1Root = path.join(directory, 'm1');
  const m1ReceiptPath = path.join(m1Root, 'receipt.json');
  const hinSnapshotPath = path.join(directory, 'hin.snapshot.json');
  const hinReceiptPath = path.join(directory, 'hin.receipt.json');
  await fs.mkdir(m1Root);
  await fs.writeFile(registryPath, registryText);
  const observationBytes = Buffer.from(`${JSON.stringify(observationManifest())}\n`);
  await fs.writeFile(observationPath, observationBytes);

  const m1Receipt = m1Admission().receipt;
  await fs.writeFile(m1ReceiptPath, `${JSON.stringify(m1Receipt)}\n`);
  const m1Bytes = await fs.readFile(m1ReceiptPath);
  const snapshot = { synthetic: true, aggregateFixture: true };
  const snapshotBytes = Buffer.from(`${JSON.stringify(snapshot)}\n`);
  await fs.writeFile(hinSnapshotPath, snapshotBytes);
  const hinReceipt = hinAdmission().receipt;
  hinReceipt.artifact.identity = sha256(snapshotBytes);
  hinReceipt.artifact.bytes = snapshotBytes.length;
  await fs.writeFile(hinReceiptPath, `${JSON.stringify(hinReceipt)}\n`);

  let m1Calls = 0;
  let hinSnapshotCalls = 0;
  let hinReceiptCalls = 0;
  const loaded = await loadHomeCompareCitywideLifecycleInputs({
    registryPath,
    observationPath,
    m1Root,
    m1ReceiptPath,
    hinSnapshotPath,
    hinReceiptPath,
    validationClock: VALIDATION_CLOCK,
    expectedObservationIdentity: observationManifest().semanticIdentity,
    expectedObservationSha256: sha256(observationBytes),
    m1Validator: async () => {
      m1Calls += 1;
      return {
        receipt: structuredClone(m1Receipt),
        path: m1ReceiptPath,
        bytes: m1Bytes.length,
        sha256: sha256(m1Bytes),
      };
    },
    hinSnapshotValidator: () => { hinSnapshotCalls += 1; },
    hinReceiptValidator: (value) => { hinReceiptCalls += 1; return structuredClone(value); },
  });
  assert.equal(m1Calls, 1);
  assert.equal(hinSnapshotCalls, 1);
  assert.equal(hinReceiptCalls, 1);
  assert.equal(loaded.m1Admission.receipt_artifact.sha256, sha256(m1Bytes));
  assert.equal(loaded.hinAdmission.snapshot_artifact.sha256, sha256(snapshotBytes));

  const relabelled = observationManifest();
  relabelled.generatedAt = '2026-08-30T05:00:00.000Z';
  for (const observed of relabelled.observations) {
    if (observed.retrievedAt !== null) observed.retrievedAt = relabelled.generatedAt;
  }
  refreshManifestIdentity(relabelled);
  assert.equal(relabelled.semanticIdentity, observationManifest().semanticIdentity);
  await fs.writeFile(observationPath, `${JSON.stringify(relabelled)}\n`);
  await assert.rejects(
    loadHomeCompareCitywideLifecycleInputs({
      registryPath,
      observationPath,
      m1Root,
      m1ReceiptPath,
      hinSnapshotPath,
      hinReceiptPath,
      validationClock: '2026-08-30T05:30:00.000Z',
      expectedObservationIdentity: observationManifest().semanticIdentity,
      expectedObservationSha256: sha256(observationBytes),
      m1Validator: async () => { throw new Error('M1 validator must not run after observation SHA drift.'); },
      hinSnapshotValidator: () => {},
      hinReceiptValidator: (value) => value,
    }),
    /expected exact file SHA-256/i,
  );
  await fs.writeFile(observationPath, observationBytes);

  await fs.appendFile(m1ReceiptPath, ' ');
  await assert.rejects(
    loadHomeCompareCitywideLifecycleInputs({
      registryPath,
      observationPath,
      m1Root,
      m1ReceiptPath,
      hinSnapshotPath,
      hinReceiptPath,
      validationClock: VALIDATION_CLOCK,
      expectedObservationIdentity: observationManifest().semanticIdentity,
      expectedObservationSha256: sha256(observationBytes),
      m1Validator: async () => ({
        receipt: structuredClone(m1Receipt),
        path: m1ReceiptPath,
        bytes: m1Bytes.length,
        sha256: sha256(m1Bytes),
      }),
      hinSnapshotValidator: () => {},
      hinReceiptValidator: (value) => value,
    }),
    /path, bytes, hash, or validated identity drifted/i,
  );
  await assert.rejects(
    loadHomeCompareCitywideLifecycleInputs({
      registryPath,
      observationPath,
      m1Root,
      m1ReceiptPath,
      hinSnapshotPath,
      hinReceiptPath,
      validationClock: VALIDATION_CLOCK,
      expectedObservationIdentity: identityOf('wrong-observation'),
      expectedObservationSha256: sha256(observationBytes),
      m1Validator: async () => ({
        receipt: structuredClone(m1Receipt),
        path: m1ReceiptPath,
        bytes: m1Bytes.length,
        sha256: sha256(m1Bytes),
      }),
      hinSnapshotValidator: () => {},
      hinReceiptValidator: (value) => value,
    }),
    /expected semantic identity/i,
  );
});

test('writer is task-owned, byte-idempotent, no-overwrite, and privacy aggregate-only', async (context) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'home-compare-p5-output-'));
  context.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const output = '.dfev1/home-compare-p5/lifecycle.json';
  const lifecycle = buildFixtureLifecycle();
  const first = await writeHomeCompareCitywideSourceLifecycle(output, lifecycle, { workspace });
  const firstStat = await fs.stat(first.outputPath);
  const second = await writeHomeCompareCitywideSourceLifecycle(output, lifecycle, { workspace });
  const secondStat = await fs.stat(second.outputPath);
  assert.equal(first.status, 'published');
  assert.equal(second.status, 'idempotent');
  assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
  assert.deepEqual(
    await fs.readdir(path.dirname(first.outputPath)),
    ['lifecycle.json'],
    'successful publication leaves no staging residue',
  );
  await assert.rejects(
    writeHomeCompareCitywideSourceLifecycle(
      output,
      buildFixtureLifecycle({ manifest: observationManifest({ rowOffset: 1 }) }),
      { workspace },
    ),
    /refusing overwrite/i,
  );
  await assert.rejects(
    writeHomeCompareCitywideSourceLifecycle('outside.json', lifecycle, { workspace }),
    /task-owned \.dfev1/i,
  );

  const serialized = await fs.readFile(first.outputPath, 'utf8');
  assert.doesNotMatch(serialized, /100 TEST ST|-75\.16|39\.95|parcel-123|owner-test|case-123|document-123/i);
  assert.equal(JSON.parse(serialized).privacy.source_rows_included, false);
});

test('lifecycle writer rejects concurrent replacement and surfaces staging cleanup failure', async (context) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'home-compare-p5-writer-race-'));
  context.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const firstLifecycle = buildFixtureLifecycle();
  const secondLifecycle = buildFixtureLifecycle({
    manifest: observationManifest({ rowOffset: 1 }),
  });
  const raceOutput = '.dfev1/home-compare-p5/race.json';
  const outcomes = await Promise.allSettled([
    writeHomeCompareCitywideSourceLifecycle(raceOutput, firstLifecycle, { workspace }),
    writeHomeCompareCitywideSourceLifecycle(raceOutput, secondLifecycle, { workspace }),
  ]);
  assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(({ status }) => status === 'rejected').length, 1);
  assert.match(outcomes.find(({ status }) => status === 'rejected').reason.message, /refusing overwrite/i);
  assert.deepEqual(
    await fs.readdir(path.join(workspace, '.dfev1/home-compare-p5')),
    ['race.json'],
  );

  const fileSystem = {
    ...fs,
    async rm(target, options) {
      if (String(target).endsWith('.tmp')) throw new Error('synthetic lifecycle cleanup failure');
      return fs.rm(target, options);
    },
  };
  await assert.rejects(
    writeHomeCompareCitywideSourceLifecycle(
      '.dfev1/home-compare-p5/cleanup.json',
      firstLifecycle,
      { workspace, fileSystem },
    ),
    /lifecycle cleanup failure/i,
  );
  assert.ok(
    (await fs.readdir(path.join(workspace, '.dfev1/home-compare-p5')))
      .some((name) => name.endsWith('.tmp')),
  );
});

function buildFixtureLifecycle({ manifest = observationManifest() } = {}) {
  return buildHomeCompareCitywideSourceLifecycle(fixtureInputs({ manifest }));
}

function fixtureInputs({ manifest = observationManifest() } = {}) {
  return {
    registry: {
      value: structuredClone(registryValue),
      sha256: sha256(registryText),
      bytes: registryText.length,
    },
    observation: {
      value: structuredClone(manifest),
      sha256: sha256(Buffer.from(JSON.stringify(manifest))),
      bytes: Buffer.byteLength(JSON.stringify(manifest)),
    },
    m1Admission: m1Admission(),
    hinAdmission: hinAdmission(),
  };
}

function observationManifest({ rowOffset = 0 } = {}) {
  const observations = registryValue.sources.map((source, index) => ({
    sourceId: source.id,
    status: 'partial',
    dataset: source.dataset,
    transport: source.transport,
    retrievedAt: GENERATED_AT,
    sourceAsOf: source.id === 'citygeo-address-locator'
      || source.id === 'opa-assessment-history' ? null : '2026-08-29T00:00:00.000Z',
    revision: source.id === 'vacant-property-indicators'
      ? 'arcgis-last-edit:1787961600000'
      : source.id === 'vision-zero-hin-2025'
        ? `arcgis-last-edit:${Date.parse('2025-12-10T17:29:32.369Z')}`
        : null,
    rowCount: source.id === 'citygeo-address-locator'
      ? null
      : source.id === 'philadelphia-reported-crime'
        ? 3_587_700 + rowOffset
        : source.id === 'vision-zero-hin-2025'
          ? 162 + rowOffset
          : 1_000 + index + rowOffset,
    schemaFields: [...source.expected_fields].sort(),
    missingFields: [],
    dq: source.id === 'vacant-property-indicators'
      ? [] : ['source-owned-revision-unavailable'],
  }));
  const value = {
    schema: 'engagement-home-compare-source-smoke/v1',
    generatedAt: GENERATED_AT,
    status: 'partial',
    semanticIdentity: '',
    observations,
    routing: structuredClone(registryValue.routing),
    privacy: structuredClone(registryValue.privacy),
    limitations: [
      'This is bounded live source/schema evidence, not a complete download, source-owned immutable revision, accuracy guarantee, or product authority.',
      'No address, coordinate, parcel, owner, transaction party, case/document identifier, or source record row is retained.',
    ],
  };
  refreshManifestIdentity(value);
  return value;
}

function refreshManifestIdentity(value) {
  const semantic = {
    schema: value.schema,
    status: value.status,
    observations: value.observations.map(({ retrievedAt: _clock, ...observed }) => observed),
    routing: value.routing,
    privacy: value.privacy,
  };
  value.semanticIdentity = identityOf(semantic);
}

function m1Admission() {
  const revision = identityOf('synthetic-m1-revision');
  const receiptValue = {
    schema: 'engagement-phl-crime-warehouse-receipt/v3',
    identity: identityOf('synthetic-m1-receipt'),
    mode: 'official-local-candidate',
    serving_eligible: false,
    source: {
      source_table: 'incidents_part1_part2',
      revision,
    },
    warehouse: { current_snapshot_id: revision },
    coverage: {},
    counts: { canonical_rows: 3_586_620 },
    clocks: {
      source_as_of: '2026-08-29T00:00:00.000Z',
      retrieved_at: '2026-08-29T01:00:00.000Z',
      built_at: '2026-08-29T02:00:00.000Z',
      observed_at: '2026-08-29T03:00:00.000Z',
    },
    data_quality: {},
    artifacts: {
      canonical: {
        sha256: identityOf('synthetic-m1-canonical'),
        bytes: 2_500,
      },
      current_source_manifest: {
        sha256: identityOf('synthetic-m1-source-manifest'),
      },
    },
    authority: {
      serving_authority: false,
      integration_authority: false,
    },
  };
  return {
    receipt: receiptValue,
    receipt_artifact: {
      sha256: identityOf('synthetic-m1-receipt-file'),
      bytes: 1_200,
    },
  };
}

function hinAdmission() {
  const snapshotIdentity = identityOf('synthetic-hin-snapshot');
  return {
    receipt: {
      schema: 'phl-hin-2025-receipt-v1',
      source: {
        layerName: 'high_injury_network_2025',
        layerUrl: registryValue.sources[8].api_url.replace('/arcgis/', '/ArcGIS/'),
        sourceAsOf: '2025-12-10T17:29:32.369Z',
        fields: [
          { name: 'objectid', type: 'esriFieldTypeOID' },
          { name: 'stname', type: 'esriFieldTypeString' },
        ],
      },
      artifact: {
        identity: snapshotIdentity,
        bytes: 2_000,
        featureCount: 162,
        retrievedAt: '2026-08-10T10:29:36.678Z',
        builtAt: null,
        buildClockStatus: 'not-recorded-in-legacy-snapshot',
      },
      review: {
        status: 'legacy-admitted',
        reviewedAt: null,
        reviewedBy: null,
        note: 'Synthetic legacy fixture.',
      },
    },
    snapshot_artifact: { sha256: snapshotIdentity, bytes: 2_000 },
    receipt_artifact: { sha256: identityOf('synthetic-hin-receipt-file'), bytes: 900 },
  };
}

function receipt(lifecycle, sourceId) {
  return lifecycle.receipts.find(({ source_id: candidate }) => candidate === sourceId);
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function identityOf(value) {
  return sha256(Buffer.from(stableStringify(value)));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
