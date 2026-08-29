#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANALYSIS_ARTIFACT_KIND,
  ANALYSIS_ARTIFACT_SCHEMA_VERSION,
  canSaveAnalysis,
  createAnalysisArtifact,
  validateAnalysisArtifact,
} from '../../src/analysis/analysis_artifact.js';
import {
  ANALYSIS_DB_NAME,
  ANALYSIS_DB_VERSION,
  ANALYSIS_STORE_NAME,
  ANALYSIS_UPDATED_AT_INDEX,
  createAnalysisRepository,
  createIndexedDbAnalysisAdapter,
} from '../../src/analysis/analysis_repository.js';

function artifact(id, updatedAt = '2026-07-31T08:00:00.000Z') {
  return createAnalysisArtifact({
    title: `Analysis ${id}`,
    viewState: {
      queryMode: 'district',
      startMonth: '2026-01',
      durationMonths: 6,
      radius: 400,
      selectedDistrictCode: '05',
    },
    provenance: { sources: ['crime-api'] },
  }, {
    createId: () => id,
    now: () => updatedAt,
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('repository module exposes the Stage 1 persistence contract', () => {
  assert.equal(typeof createAnalysisRepository, 'function');
  assert.equal(typeof createIndexedDbAnalysisAdapter, 'function');
  assert.equal(ANALYSIS_DB_NAME, 'engagement-analysis');
  assert.equal(ANALYSIS_DB_VERSION, 1);
  assert.equal(ANALYSIS_STORE_NAME, 'analysis_artifacts');
  assert.equal(ANALYSIS_UPDATED_AT_INDEX, 'updatedAt');
});

test('business repository validates writes and lists valid rows newest-first', async () => {
  const rows = new Map();
  const adapter = {
    async put(value) { rows.set(value.id, structuredClone(value)); },
    async get(id) { return rows.get(id) ?? null; },
    async getAll() { return [...rows.values()]; },
    async delete(id) { rows.delete(id); },
  };
  const repository = createAnalysisRepository({ adapter });
  const older = artifact('older', '2026-07-31T08:00:00.000Z');
  const newer = artifact('newer', '2026-07-31T09:00:00.000Z');

  await repository.save(older);
  await repository.save(newer);
  rows.set('corrupt', { id: 'corrupt', updatedAt: 'not-a-date' });

  await assert.rejects(
    () => repository.save({ ...newer, kind: 'wrong-kind' }),
    /artifact kind/i,
  );
  const result = await repository.list();
  assert.deepEqual(result.items.map((item) => item.id), ['newer', 'older']);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0].message, /invalid analysis artifact/i);
});

test('v1 validation rejects malformed external artifacts before repository writes', async () => {
  let writes = 0;
  const repository = createAnalysisRepository({
    adapter: {
      async put() { writes += 1; },
      async get() { return null; },
      async getAll() { return []; },
      async delete() {},
    },
  });
  const valid = artifact('strict-v1');
  const invalidArtifacts = [
    { ...valid, viewState: { ...valid.viewState, centerLonLat: [-181, 39.95] } },
    { ...valid, viewState: { ...valid.viewState, addressA: 'PRIVATE ADDRESS' } },
    { ...valid, viewState: { ...valid.viewState, queryMode: 'district', selectedDistrictCode: null } },
    { ...valid, viewState: { ...valid.viewState, unsupportedField: true } },
    { ...valid, unsupportedField: true },
    { ...valid, title: 12345 },
    { ...valid, resultSummary: { generatedAt: valid.updatedAt, comparison: { a: { total: 1, nested: { arbitrary: true } }, b: null } } },
    { ...valid, resultSummary: { generatedAt: valid.updatedAt, comparison: { a: null } } },
    { ...valid, provenance: { ...valid.provenance, arbitrary: { nested: ['payload'] } } },
    { ...valid, provenance: { coverage: { min: '2026-02-31', max: '2026-07-30' } } },
  ];

  for (const value of invalidArtifacts) {
    await assert.rejects(() => repository.save(value), /invalid analysis artifact/i);
  }
  assert.equal(writes, 0, 'invalid artifacts must never reach the storage adapter');
  assert.equal(canSaveAnalysis({ coverageStatus: 'ready', queryMode: 'buffer', centerLonLat: [-181, 39.95] }), false);
  assert.equal(canSaveAnalysis({ coverageStatus: 'ready', queryMode: 'buffer', centerLonLat: [-75.16, 91] }), false);
});

test('artifact creation rejects lossy view-state canonicalization', () => {
  const viewState = {
    queryMode: 'buffer',
    centerLonLat: [-75.16, 39.95],
  };

  assert.throws(
    () => createAnalysisArtifact({ viewState: { ...viewState, addressA: 'x'.repeat(161) } }),
    /invalid analysis artifact view state/i,
  );
  assert.throws(
    () => createAnalysisArtifact({ viewState: { ...viewState, addressB: 'x'.repeat(161) } }),
    /invalid analysis artifact view state/i,
  );
});

test('artifact creation ignores runtime-only store fields without persisting them', () => {
  const created = createAnalysisArtifact({
    viewState: {
      queryMode: 'district',
      selectedDistrictCode: '05',
      coverageStatus: 'ready',
    },
  });

  assert.equal(created.viewState.queryMode, 'district');
  assert.equal(Object.hasOwn(created.viewState, 'coverageStatus'), false);
});

test('v1 validation accepts the bounded comparison and tract provenance contract', () => {
  const valid = artifact('bounded-v1');
  const value = validateAnalysisArtifact({
    ...valid,
    resultSummary: {
      generatedAt: '2026-07-31T07:59:00.000Z',
      comparison: {
        a: {
          label: 'Point A',
          total: 12,
          per10k: 3.5,
          top3: [{ text_general_code: 'Thefts', n: 8 }],
          delta30: -0.25,
        },
        b: null,
      },
    },
    provenance: {
      coverage: { min: '2006-01-01', max: '2026-07-30' },
      sources: ['crime-carto', 'tract-snapshot'],
      tractSnapshot: {
        schemaVersion: 2,
        start: '2025-08-01',
        end: '2026-08-01',
        generatedAt: '2026-07-31T03:30:49.163Z',
        coverageDate: '2026-07-30',
        rowCount: 408,
        sourceDataset: 'incidents_part1_part2',
        tractSource: 'public/data/tracts_phl.geojson',
        geographyIdentity: 'fnv1a32:408:01234567',
      },
    },
  });
  assert.equal(value.resultSummary.comparison.a.top3[0].n, 8);
  assert.equal(value.provenance.tractSnapshot.rowCount, 408);
});

test('v1 validation rejects non-canonical or contradictory tract provenance before storage', async () => {
  const valid = artifact('tract-semantics');
  const tractSnapshot = {
    schemaVersion: 2,
    start: '2025-08-01',
    end: '2026-08-01',
    generatedAt: '2026-07-31T03:30:49.163Z',
    coverageDate: '2026-07-30',
    rowCount: 408,
    sourceDataset: 'incidents_part1_part2',
    tractSource: 'public/data/tracts_phl.geojson',
    geographyIdentity: 'fnv1a32:408:01234567',
  };
  const invalidSnapshots = [
    { ...tractSnapshot, generatedAt: '2026-07-31 03:30:49Z' },
    { ...tractSnapshot, start: tractSnapshot.end },
    { ...tractSnapshot, start: '2026-07-31' },
    { ...tractSnapshot, generatedAt: '2026-07-29T23:59:59.000Z' },
    { ...tractSnapshot, geographyIdentity: 'fnv1a32:408:ABCDEF12' },
    { ...tractSnapshot, geographyIdentity: 'fnv1a32:407:01234567' },
  ];
  let adapterWrites = 0;
  const repository = createAnalysisRepository({
    adapter: {
      async put() { adapterWrites += 1; },
      async getAll() { return []; },
    },
  });

  for (const snapshot of invalidSnapshots) {
    await assert.rejects(
      repository.save({ ...valid, provenance: { tractSnapshot: snapshot } }),
      /tract snapshot|timestamp|window|geography/i,
    );
  }
  assert.equal(adapterWrites, 0);
});

test('business repository gets, renames, and deletes without bypassing artifact validation', async () => {
  const rows = new Map([['saved', artifact('saved')]]);
  const adapter = {
    async put(value) { rows.set(value.id, structuredClone(value)); },
    async get(id) { return rows.get(id) ?? null; },
    async getAll() { return [...rows.values()]; },
    async delete(id) { rows.delete(id); },
  };
  const repository = createAnalysisRepository({ adapter });

  assert.equal((await repository.get('saved')).id, 'saved');
  const renamed = await repository.rename('saved', '  Safer route comparison  ', {
    now: () => '2026-07-31T10:00:00.000Z',
  });
  assert.equal(renamed.title, 'Safer route comparison');
  assert.equal(renamed.updatedAt, '2026-07-31T10:00:00.000Z');
  assert.equal((await repository.get('saved')).title, 'Safer route comparison');
  assert.equal(await repository.rename('missing', 'No row'), null);
  assert.equal(await repository.delete('saved'), true);
  assert.equal(await repository.get('saved'), null);
  await assert.rejects(() => repository.delete('   '), /artifact id/i);
});

test('IndexedDB adapter creates its independent v1 schema', async () => {
  let opened;
  const indexes = [];
  const store = {
    indexNames: { contains: () => false },
    createIndex: (...args) => indexes.push(args),
  };
  const db = {
    objectStoreNames: { contains: () => false },
    createObjectStore(name, options) {
      opened.createdStore = [name, options];
      return store;
    },
    transaction() { throw new Error('not used'); },
    close() {},
  };
  const adapter = createIndexedDbAnalysisAdapter({
    openDatabase: async (name, version, options) => {
      opened = { name, version, options };
      options.upgrade(db, 0, version, null);
      return db;
    },
  });

  await adapter.ready();
  assert.equal(opened.name, 'engagement-analysis');
  assert.equal(opened.version, 1);
  assert.deepEqual(opened.createdStore, ['analysis_artifacts', { keyPath: 'id' }]);
  assert.deepEqual(indexes, [['updatedAt', 'updatedAt']]);
});

test('IndexedDB writes do not resolve before transaction completion', async () => {
  const transactionDone = deferred();
  const putStarted = deferred();
  const writes = [];
  const tx = {
    store: {
      async put(value) {
        writes.push(['put', value.id]);
        putStarted.resolve();
      },
      async delete(id) { writes.push(['delete', id]); },
    },
    done: transactionDone.promise,
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => tx,
    get: async () => null,
    getAll: async () => [],
    close() {},
  };
  const adapter = createIndexedDbAnalysisAdapter({ openDatabase: async () => db });
  let settled = false;
  const write = adapter.put(artifact('tx')).then(() => { settled = true; });

  await putStarted.promise;
  assert.deepEqual(writes, [['put', 'tx']]);
  assert.equal(settled, false);
  transactionDone.resolve();
  await write;
  assert.equal(settled, true);
});

test('IndexedDB atomic imports abort the transaction instead of retaining a partial batch', async () => {
  const transactionDone = deferred();
  const writes = [];
  let aborted = false;
  const tx = {
    store: {
      async add(value) {
        writes.push(value.id);
        if (value.id === 'second') throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      },
    },
    done: transactionDone.promise,
    abort() {
      aborted = true;
      writes.length = 0;
      transactionDone.reject(new DOMException('Transaction aborted', 'AbortError'));
    },
  };
  const adapter = createIndexedDbAnalysisAdapter({
    openDatabase: async () => ({
      objectStoreNames: { contains: () => true },
      transaction: () => tx,
      close() {},
    }),
  });

  await assert.rejects(
    adapter.putManyAtomic([{ id: 'first' }, { id: 'second' }]),
    /quota/i,
  );
  assert.equal(aborted, true);
  assert.deepEqual(writes, []);
});

test('IndexedDB lifecycle events are nonfatal, observable, and reset stale connections', async () => {
  const statuses = [];
  const opened = [];
  let closes = 0;
  const makeDb = () => ({
    objectStoreNames: { contains: () => true },
    getAll: async () => [],
    get: async () => null,
    close() { closes += 1; },
  });
  const adapter = createIndexedDbAnalysisAdapter({
    onStatus: (status) => statuses.push(status),
    openDatabase: async (name, version, options) => {
      opened.push({ name, version, options });
      return makeDb();
    },
  });

  await adapter.getAll();
  opened[0].options.blocked(0, 1);
  assert.deepEqual(statuses.at(-1), {
    type: 'blocked',
    fatal: false,
    message: 'Analysis storage upgrade is blocked by another open tab.',
  });

  opened[0].options.blocking(1, 2);
  assert.equal(closes, 1);
  await adapter.getAll();
  assert.equal(opened.length, 2);
  assert.equal(statuses.at(-1).type, 'blocking');

  opened[1].options.terminated();
  assert.equal(closes, 2);
  await adapter.getAll();
  assert.equal(opened.length, 3);
  assert.equal(statuses.at(-1).type, 'terminated');
});

test('IndexedDB adapter surfaces quota and availability failures', async () => {
  const quotaError = new DOMException('Storage quota exceeded', 'QuotaExceededError');
  const tx = {
    store: { async put() { throw quotaError; } },
    done: Promise.resolve(),
  };
  const quotaAdapter = createIndexedDbAnalysisAdapter({
    openDatabase: async () => ({
      objectStoreNames: { contains: () => true },
      transaction: () => tx,
      close() {},
    }),
  });
  await assert.rejects(() => quotaAdapter.put(artifact('quota')), (error) => error === quotaError);

  const unavailable = new DOMException('IndexedDB disabled', 'InvalidStateError');
  const unavailableAdapter = createIndexedDbAnalysisAdapter({
    openDatabase: async () => { throw unavailable; },
  });
  await assert.rejects(() => unavailableAdapter.ready(), (error) => error === unavailable);
});

test('corrupt rows retain enough context for recovery warnings', async () => {
  const repository = createAnalysisRepository({
    adapter: {
      async put() {},
      async get() { return null; },
      async delete() {},
      async getAll() {
        return [{
          kind: ANALYSIS_ARTIFACT_KIND,
          schemaVersion: ANALYSIS_ARTIFACT_SCHEMA_VERSION + 1,
          id: 'future-row',
          title: 'Future row',
          createdAt: '2026-07-31T08:00:00.000Z',
          updatedAt: '2026-07-31T08:00:00.000Z',
          viewState: {},
        }];
      },
    },
  });

  const result = await repository.list();
  assert.deepEqual(result.items, []);
  assert.equal(result.warnings[0].id, 'future-row');
  assert.match(result.warnings[0].message, /unsupported.*schema version/i);
});

test('legacy private rows remain stored but are exposed only as legacy-unavailable metadata', async () => {
  const privateToken = '1500 PRIVATE MARKET STREET';
  const legacy = {
    kind: ANALYSIS_ARTIFACT_KIND,
    schemaVersion: 1,
    id: 'legacy-private',
    title: privateToken,
    createdAt: '2026-07-31T08:00:00.000Z',
    updatedAt: '2026-07-31T08:00:00.000Z',
    viewState: {
      queryMode: 'buffer',
      centerLonLat: [-75.16, 39.95],
      addressA: privateToken,
    },
    resultSummary: null,
    provenance: {},
  };
  const rows = new Map([[legacy.id, structuredClone(legacy)]]);
  let writes = 0;
  let deletes = 0;
  const repository = createAnalysisRepository({
    adapter: {
      async put() { writes += 1; },
      async get(id) { return rows.get(id) ?? null; },
      async getAll() { return [...rows.values()]; },
      async delete() { deletes += 1; },
    },
  });

  const item = await repository.get(legacy.id);
  assert.equal(item.availability, 'legacy-unavailable');
  assert.equal(item.canRestore, false);
  assert.equal(item.canShare, false);
  assert.doesNotMatch(JSON.stringify(item), /1500|75\.16|39\.95|MARKET/);
  const listed = await repository.list();
  assert.equal(listed.items[0].availability, 'legacy-unavailable');
  assert.equal(rows.has(legacy.id), true);
  assert.equal(writes, 0);
  assert.equal(deletes, 0);
  await assert.rejects(() => repository.rename(legacy.id, 'Recovered'), /invalid analysis artifact/i);
  assert.equal(writes, 0);
});
