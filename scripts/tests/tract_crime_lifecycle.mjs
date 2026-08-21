#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { mkdtemp, readFile, readdir, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createTractCrimeSnapshot,
  prepareTracts,
} from '../lib/tract_crime_snapshot.mjs';
import {
  createTractCrimeBundledReceipt,
  createTractCrimeReceipt,
  renderTractCrimeBundledReceiptModule,
  renderTractCrimeReceipt,
  validateTractCrimeBundledReceiptModule,
  validateTractCrimeReceipt,
  validateTractSourceRegistry,
  writeTractCrimeLifecycleAtomic,
} from '../lib/tract_crime_receipt.mjs';
import { runPrecompute } from '../precompute_tract_crime.mjs';

const sourceRegistry = JSON.parse(await readFile(
  new URL('../data/tract_source_contract.json', import.meta.url),
  'utf8',
));

const tractFeature = (geoid, offset = 0) => ({
  type: 'Feature',
  properties: { GEOID: geoid },
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-75.2 + offset, 39.9],
      [-75.1 + offset, 39.9],
      [-75.1 + offset, 40],
      [-75.2 + offset, 40],
      [-75.2 + offset, 39.9],
    ]],
  },
});

const tractCollection = {
  type: 'FeatureCollection',
  features: [
    tractFeature('42101000200', 0.01),
    tractFeature('42101000100'),
  ],
};
const preparedTracts = prepareTracts(tractCollection);

function snapshot({
  coverageDate = '2026-07-31',
  generatedAt = '2026-07-31T03:30:49.163Z',
  count = 1,
} = {}) {
  return createTractCrimeSnapshot({
    tracts: preparedTracts,
    counts: preparedTracts.map(({ geoid }) => ({
      geoid,
      offenses: [{ code: 'Reported offense', n: count }],
    })),
    coverageDate,
    generatedAt,
    sourceUrl: 'https://phl.carto.com/api/v2/sql',
    tractSource: 'public/data/tracts_phl.geojson',
  });
}

function receipt(candidate, retrievedAt = '2026-07-31T03:29:00.000Z') {
  return createTractCrimeReceipt({
    snapshot: candidate,
    tracts: preparedTracts,
    retrievedAt,
    registry: sourceRegistry,
  });
}

test('machine-readable tract registry preserves terms, clock semantics, freshness, and fail-closed states', () => {
  const registry = validateTractSourceRegistry(sourceRegistry);
  assert.equal(registry.registry_schema, 'engagement-tract-crime-source-registry/v1');
  assert.deepEqual(registry.claim_vocabulary.allowed, [
    'reported incidents',
    'historical evidence',
    'modeled exposure',
  ]);
  assert.deepEqual(registry.claim_vocabulary.forbidden, [
    'absolute safety',
    'victim probability',
    'safest route',
  ]);
  const derived = registry.sources.find(({ id }) => id === 'tract-crime-snapshot');
  assert.equal(derived.license.terms_url, 'https://opendataphilly.org/datasets/crime-incidents/');
  assert.equal(derived.retrieval.clock, 'receipt.clocks.retrievedAt');
  assert.equal(derived.build.clock, 'snapshot.meta.generated_at');
  assert.equal(derived.freshness.clock, 'receipt.clocks.sourceAsOf');
  assert.equal(derived.freshness.stale_after_days, 7);
  assert.equal(derived.fail_closed.status, 'unavailable');
  assert.equal(derived.fail_closed.record_count, null);
});

test('month-boundary snapshot changes machine-generate a matching validated receipt', () => {
  const august = snapshot({
    coverageDate: '2026-08-31',
    generatedAt: '2026-08-31T03:30:00.000Z',
  });
  const generated = receipt(august, '2026-08-31T03:29:00.000Z');
  assert.deepEqual(generated.clocks, {
    sourceAsOf: '2026-08-31',
    retrievedAt: '2026-08-31T03:29:00.000Z',
    builtAt: '2026-08-31T03:30:00.000Z',
    observedAt: null,
  });
  assert.deepEqual(generated.coverage, {
    geography: '408 Philadelphia census tracts',
    temporalStart: '2025-09-01',
    temporalEnd: '2026-09-01',
  });
  assert.equal(generated.artifact.recordCount, 2);
  assert.match(generated.artifact.identity, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(
    validateTractCrimeReceipt(generated, {
      snapshot: august,
      tracts: preparedTracts,
      registry: sourceRegistry,
    }),
    generated,
  );
});

test('failed receipt install rolls back every official lifecycle artifact without residue', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tract-crime-pair-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshotDestination = path.join(directory, 'snapshot.json');
  const receiptDestination = path.join(directory, 'receipt.json');
  const bundledReceiptDestination = path.join(directory, 'receipt.generated.js');
  const oldSnapshot = snapshot();
  const oldReceipt = receipt(oldSnapshot);
  await writeTractCrimeLifecycleAtomic({
    snapshotDestination,
    receiptDestination,
    bundledReceiptDestination,
    snapshot: oldSnapshot,
    receipt: oldReceipt,
    tracts: preparedTracts,
    registry: sourceRegistry,
  });
  const oldSnapshotText = await readFile(snapshotDestination, 'utf8');
  const oldReceiptText = await readFile(receiptDestination, 'utf8');
  const oldBundledReceiptText = await readFile(bundledReceiptDestination, 'utf8');
  const replacementSnapshot = snapshot({
    coverageDate: '2026-08-31',
    generatedAt: '2026-08-31T03:30:00.000Z',
    count: 2,
  });
  const replacementReceipt = receipt(replacementSnapshot, '2026-08-31T03:29:00.000Z');
  let injected = false;
  const fileSystem = {
    ...fs,
    async rename(source, destination) {
      if (!injected && source.endsWith('.tmp') && destination === receiptDestination) {
        injected = true;
        throw new Error('injected receipt install failure');
      }
      return fs.rename(source, destination);
    },
  };

  await assert.rejects(
    writeTractCrimeLifecycleAtomic({
      snapshotDestination,
      receiptDestination,
      bundledReceiptDestination,
      snapshot: replacementSnapshot,
      receipt: replacementReceipt,
      tracts: preparedTracts,
      registry: sourceRegistry,
      fileSystem,
    }),
    /injected receipt install failure/,
  );
  assert.equal(await readFile(snapshotDestination, 'utf8'), oldSnapshotText);
  assert.equal(await readFile(receiptDestination, 'utf8'), oldReceiptText);
  assert.equal(await readFile(bundledReceiptDestination, 'utf8'), oldBundledReceiptText);
  assert.deepEqual(
    (await readdir(directory)).sort(),
    ['receipt.generated.js', 'receipt.json', 'snapshot.json'],
  );
});

test('two refreshes with identical semantic input preserve official bytes and mtimes', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tract-crime-noop-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshotDestination = path.join(directory, 'snapshot.json');
  const receiptDestination = path.join(directory, 'receipt.json');
  const bundledReceiptDestination = path.join(directory, 'receipt.generated.js');
  let currentTime = '2026-07-31T03:30:00.000Z';
  const args = [
    '--as-of', '2026-07-31',
    '--tracts', 'virtual.geojson',
    '--output', snapshotDestination,
    '--receipt', receiptDestination,
    '--bundled-receipt', bundledReceiptDestination,
    '--concurrency', '1',
  ];
  const dependencies = {
    readFile: async () => JSON.stringify(tractCollection),
    requestRows: async () => [{ text_general_code: 'Reported offense', n: 1 }],
    now: () => new Date(currentTime),
    registry: sourceRegistry,
  };

  await runPrecompute(args, dependencies);
  const fixedTime = new Date('2026-08-01T00:00:00.000Z');
  await Promise.all([
    utimes(snapshotDestination, fixedTime, fixedTime),
    utimes(receiptDestination, fixedTime, fixedTime),
    utimes(bundledReceiptDestination, fixedTime, fixedTime),
  ]);
  const before = await lifecycleState(
    snapshotDestination,
    receiptDestination,
    bundledReceiptDestination,
  );
  currentTime = '2026-08-07T03:30:00.000Z';
  await runPrecompute(args, dependencies);
  const after = await lifecycleState(
    snapshotDestination,
    receiptDestination,
    bundledReceiptDestination,
  );
  assert.deepEqual(after, before);
});

test('committed receipt and runtime projection validate while legacy retrieval stays unknown', async () => {
  const [committedSnapshot, committedTractCollection, bundledReceiptModule] = await Promise.all([
    readFile(
      new URL('../../public/data/tract_crime_counts_last12m.json', import.meta.url),
      'utf8',
    ).then(JSON.parse),
    readFile(
      new URL('../../public/data/tracts_phl.geojson', import.meta.url),
      'utf8',
    ).then(JSON.parse),
    readFile(
      new URL('../../src/source_health/tract_crime_bundled_receipt.generated.js', import.meta.url),
      'utf8',
    ),
  ]);
  const committedTracts = prepareTracts(committedTractCollection);
  const committedReceiptText = await readFile(
    new URL('../../src/source_health/tract_crime_bundled_receipt.json', import.meta.url),
    'utf8',
  );
  const committedReceipt = JSON.parse(committedReceiptText);
  assert.deepEqual(
    validateTractCrimeReceipt(committedReceipt, {
      snapshot: committedSnapshot,
      tracts: committedTracts,
      registry: sourceRegistry,
    }),
    committedReceipt,
  );
  assert.equal(committedReceipt.clocks.retrievedAt, null);
  assert.equal(renderTractCrimeReceipt(committedReceipt, {
    snapshot: committedSnapshot,
    tracts: committedTracts,
    registry: sourceRegistry,
  }).text, committedReceiptText.replace(/\r\n/g, '\n'));
  assert.deepEqual(
    validateTractCrimeBundledReceiptModule(bundledReceiptModule, committedReceipt, {
      snapshot: committedSnapshot,
      tracts: committedTracts,
      registry: sourceRegistry,
    }),
    createTractCrimeBundledReceipt(committedReceipt, {
      snapshot: committedSnapshot,
      tracts: committedTracts,
      registry: sourceRegistry,
    }),
  );
  assert.equal(
    bundledReceiptModule.replace(/\r\n/g, '\n'),
    renderTractCrimeBundledReceiptModule(committedReceipt, {
      snapshot: committedSnapshot,
      tracts: committedTracts,
      registry: sourceRegistry,
    }).text,
  );
});

async function lifecycleState(snapshotDestination, receiptDestination, bundledReceiptDestination) {
  const [
    snapshotText,
    receiptText,
    bundledReceiptText,
    snapshotStat,
    receiptStat,
    bundledReceiptStat,
  ] = await Promise.all([
    readFile(snapshotDestination, 'utf8'),
    readFile(receiptDestination, 'utf8'),
    readFile(bundledReceiptDestination, 'utf8'),
    stat(snapshotDestination),
    stat(receiptDestination),
    stat(bundledReceiptDestination),
  ]);
  return {
    snapshotText,
    receiptText,
    bundledReceiptText,
    snapshotMtimeMs: snapshotStat.mtimeMs,
    receiptMtimeMs: receiptStat.mtimeMs,
    bundledReceiptMtimeMs: bundledReceiptStat.mtimeMs,
  };
}
