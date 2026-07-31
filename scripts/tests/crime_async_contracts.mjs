#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { fetchPoints } from '../../src/api/crime.js';
import { updateAllCharts } from '../../src/charts/index.js';
import { updateCompare } from '../../src/compare/card.js';
import * as refreshContract from '../../src/routes_crime/crime_refresh_owner.js';
import { estimatePopInBuffer } from '../../src/utils/pop_buffer.js';

const { createCrimeRefreshOwner } = refreshContract;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('each refresh reads one snapshot and superseding aborts the previous generation', async () => {
  let snapshotReads = 0;
  const runs = [];
  const owner = createCrimeRefreshOwner({
    readSnapshot: () => ({ sequence: ++snapshotReads }),
    runRefresh: (snapshot, context) => {
      const gate = deferred();
      runs.push({ snapshot, context, gate });
      return gate.promise;
    },
  });

  const first = owner.refresh();
  const second = owner.refresh();

  assert.equal(snapshotReads, 2);
  assert.deepEqual(runs.map((run) => run.snapshot), [{ sequence: 1 }, { sequence: 2 }]);
  assert.equal(runs[0].context.signal.aborted, true);
  assert.equal(runs[0].context.isCurrent(), false);
  assert.equal(runs[1].context.signal.aborted, false);
  assert.equal(runs[1].context.isCurrent(), true);

  runs[0].gate.resolve({ applied: true });
  runs[1].gate.resolve({ applied: true });
  assert.deepEqual(await first, { applied: false });
  assert.deepEqual(await second, { applied: true });
});

test('deactivation invalidates work and reactivation uses a fresh signal', async () => {
  const runs = [];
  const owner = createCrimeRefreshOwner({
    readSnapshot: () => ({ mode: 'crime' }),
    runRefresh: (_snapshot, context) => {
      const gate = deferred();
      runs.push({ context, gate });
      return gate.promise;
    },
  });

  const first = owner.refresh();
  owner.setActive(false);
  assert.equal(runs[0].context.signal.aborted, true);
  assert.equal(runs[0].context.isCurrent(), false);
  assert.deepEqual(await owner.refresh(), { applied: false });

  owner.setActive(true);
  const second = owner.refresh();
  assert.equal(runs.length, 2);
  assert.notEqual(runs[0].context.signal, runs[1].context.signal);
  assert.equal(runs[1].context.signal.aborted, false);
  assert.equal(runs[1].context.isCurrent(), true);

  runs[0].gate.resolve({ applied: true });
  runs[1].gate.resolve({ applied: true });
  assert.deepEqual(await first, { applied: false });
  assert.deepEqual(await second, { applied: true });
});

test('crime snapshots clone mutable filter and center values', () => {
  assert.equal(typeof refreshContract.readCrimeSnapshot, 'function');
  const types = ['A'];
  const drilldownCodes = ['B'];
  const center3857 = [1, 2];
  const centerLonLat = [-75, 40];
  const source = {
    centerLonLat,
    adminLevel: 'tracts',
    per10k: true,
    timeWindowMonths: 12,
    getFilters: () => ({
      start: '2026-01-01',
      end: '2026-02-01',
      types,
      drilldownCodes,
      center3857,
      radiusM: 400,
      queryMode: 'buffer',
    }),
  };

  const snapshot = refreshContract.readCrimeSnapshot(source);
  types.push('changed');
  drilldownCodes.push('changed');
  center3857[0] = 99;
  centerLonLat[0] = 99;

  assert.deepEqual(snapshot.types, ['A']);
  assert.deepEqual(snapshot.drilldownCodes, ['B']);
  assert.deepEqual(snapshot.center3857, [1, 2]);
  assert.deepEqual(snapshot.centerLonLat, [-75, 40]);
  assert.equal(snapshot.adminLevel, 'tracts');
  assert.equal(snapshot.per10k, true);
  assert.deepEqual(snapshot.resolvedOffenseCodes, ['A']);
});

function createChartSinks() {
  const calls = [];
  return {
    calls,
    status: (message) => calls.push(['status', message]),
    monthly: (...args) => calls.push(['monthly', ...args]),
    top: (...args) => calls.push(['top', ...args]),
    heat: (...args) => calls.push(['heat', ...args]),
    error: (error) => calls.push(['error', error]),
  };
}

test('stale chart success does not write any chart or status sink', async () => {
  const gate = deferred();
  const controller = new AbortController();
  const sinks = createChartSinks();
  let receivedSignal;
  const updating = updateAllCharts(
    { start: '2026-01-01', end: '2026-02-01', queryMode: 'city' },
    {
      signal: controller.signal,
      shouldApply: () => !controller.signal.aborted,
      fetchers: {
        fetchMonthlySeriesCity: (params) => {
          receivedSignal = params.signal;
          return gate.promise;
        },
      },
      sinks,
    },
  );

  controller.abort();
  gate.resolve({ rows: [{ m: '2026-01-01', n: 4 }] });

  assert.deepEqual(await updating, { applied: false });
  assert.equal(receivedSignal, controller.signal);
  assert.deepEqual(sinks.calls, []);
});

test('stale chart error does not write an error sink or console error', async (t) => {
  const gate = deferred();
  const sinks = createChartSinks();
  let current = true;
  const originalConsoleError = console.error;
  let consoleErrors = 0;
  t.after(() => { console.error = originalConsoleError; });
  console.error = () => { consoleErrors += 1; };

  const updating = updateAllCharts(
    { start: '2026-01-01', end: '2026-02-01', queryMode: 'city' },
    {
      shouldApply: () => current,
      fetchers: { fetchMonthlySeriesCity: () => gate.promise },
      sinks,
    },
  );
  current = false;
  gate.reject(new Error('superseded chart request'));

  assert.deepEqual(await updating, { applied: false });
  assert.deepEqual(sinks.calls, []);
  assert.equal(consoleErrors, 0);
});

function createCompareView() {
  const calls = [];
  return {
    calls,
    pending: () => calls.push(['pending']),
    success: (result) => calls.push(['success', result]),
    error: (error) => calls.push(['error', error]),
  };
}

test('stale compare success may keep its active pending state but cannot commit a result', async () => {
  const gate = deferred();
  const controller = new AbortController();
  const view = createCompareView();
  const comparing = updateCompare(
    { types: [], center3857: [1, 2], radiusM: 400 },
    {
      signal: controller.signal,
      shouldApply: () => !controller.signal.aborted,
      fetchers: {
        fetchCountBuffer: (params) => {
          assert.equal(params.signal, controller.signal);
          return gate.promise;
        },
        fetchTopTypesBuffer: async () => ({ rows: [] }),
        estimatePopInBuffer: async () => ({ pop: 0 }),
      },
      view,
    },
  );

  controller.abort();
  gate.resolve(9);

  assert.deepEqual(await comparing, { applied: false });
  assert.deepEqual(view.calls, [['pending']]);
});

test('stale compare error cannot write a failure result', async () => {
  const gate = deferred();
  const view = createCompareView();
  let current = true;
  const comparing = updateCompare(
    { types: [], center3857: [1, 2], radiusM: 400 },
    {
      shouldApply: () => current,
      fetchers: {
        fetchCountBuffer: () => gate.promise,
        fetchTopTypesBuffer: async () => ({ rows: [] }),
        estimatePopInBuffer: async () => ({ pop: 0 }),
      },
      view,
    },
  );

  current = false;
  gate.reject(new Error('superseded compare request'));

  assert.deepEqual(await comparing, { applied: false });
  assert.deepEqual(view.calls, [['pending']]);
});

test('population estimation forwards the owning refresh signal to both data sources', async () => {
  const controller = new AbortController();
  const sourceSignals = [];
  await estimatePopInBuffer({
    center3857: [0, 0],
    radiusM: 100,
    signal: controller.signal,
    fetchTracts: async (options) => {
      sourceSignals.push(options?.signal);
      return { type: 'FeatureCollection', features: [] };
    },
    fetchStats: async (options) => {
      sourceSignals.push(options?.signal);
      return [];
    },
  });

  assert.deepEqual(sourceSignals, [controller.signal, controller.signal]);
});

test('the default fetchPoints chain propagates cancellation to the transport', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalCwd = process.cwd();
  const tempCwd = await mkdtemp(path.join(tmpdir(), 'engagement-crime-api-'));
  const enteredTransport = deferred();
  process.chdir(tempCwd);
  t.after(async () => {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    await rm(tempCwd, { recursive: true, force: true });
  });

  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    enteredTransport.resolve(options.signal);
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });

  const controller = new AbortController();
  const request = fetchPoints({
    start: '2099-01-01',
    end: '2099-02-01',
    types: [],
    bbox: [-8_400_000, 4_800_000, -8_300_000, 4_900_000],
    signal: controller.signal,
  });
  const transportSignal = await enteredTransport.promise;
  controller.abort(new DOMException('Cancelled by test', 'AbortError'));

  assert.equal(transportSignal.aborted, true);
  await assert.rejects(request, { name: 'AbortError' });
});

test('Crime synchronous UI actions require both controller and mode ownership', async () => {
  const { createCrimeSynchronousActions } = await import('../../src/routes_crime/index.js');
  assert.equal(typeof createCrimeSynchronousActions, 'function');
  let controllerActive = false;
  let modeActive = true;
  const mutations = [];
  const map = {
    getLayer: (id) => (id === 'tracts-outline-line' ? { id } : null),
    setLayoutProperty: (...args) => mutations.push(['tracts', ...args]),
  };
  const actions = createCrimeSynchronousActions({
    map,
    isControllerActive: () => controllerActive,
    isModeActive: () => modeActive,
    readBuffer: () => ({ centerLonLat: [-75.16, 39.95], radiusM: 400 }),
    upsertBuffer: (...args) => mutations.push(['buffer', ...args]),
  });

  assert.equal(actions.updateBuffer(), false);
  assert.equal(actions.setTractsOverlayVisible(true), false);
  controllerActive = true;
  modeActive = false;
  assert.equal(actions.updateBuffer(), false);
  assert.equal(actions.setTractsOverlayVisible(true), false);
  assert.deepEqual(mutations, []);

  modeActive = true;
  assert.equal(actions.updateBuffer(), true);
  assert.equal(actions.setTractsOverlayVisible(false), true);
  assert.equal(mutations[0][0], 'buffer');
  assert.deepEqual(mutations[1], [
    'tracts',
    'tracts-outline-line',
    'visibility',
    'none',
  ]);
});
