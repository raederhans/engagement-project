#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { fetchPoints } from '../../src/api/crime.js';
import { updateAllCharts } from '../../src/charts/index.js';
import { getLastComparisonSnapshot, updateCompare } from '../../src/compare/card.js';
import * as refreshContract from '../../src/routes_crime/crime_refresh_owner.js';
import {
  classifyDistrictBoundaryRefresh,
  loadTractOutlineResult,
  planCrimeRefresh,
  normalizeCrimeRefreshScope,
} from '../../src/routes_crime/index.js';
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

test('an external coordinator signal aborts and releases the owned Crime refresh', async () => {
  const coordinator = new AbortController();
  let downstreamSignal;
  const owner = createCrimeRefreshOwner({
    readSnapshot: () => ({ mode: 'crime' }),
    runRefresh: (_snapshot, context) => {
      downstreamSignal = context.signal;
      return new Promise((resolve) => context.signal.addEventListener(
        'abort',
        () => resolve({ applied: true }),
        { once: true },
      ));
    },
  });

  const refresh = owner.refresh({ signal: coordinator.signal });
  coordinator.abort(new DOMException('Diary owns the next schedule.', 'AbortError'));

  assert.equal(downstreamSignal.aborted, true);
  assert.deepEqual(await refresh, { applied: false });
});

test('a result-only retry keeps one generation and passes its scope to the owned refresh', async () => {
  const contexts = [];
  const owner = createCrimeRefreshOwner({
    readSnapshot: () => ({ mode: 'crime' }),
    runRefresh: async (_snapshot, context) => {
      contexts.push(context);
      return { applied: true };
    },
  });

  assert.deepEqual(await owner.refresh({ scope: 'charts' }), { applied: true });
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].scope, 'charts');
  assert.equal(contexts[0].isCurrent(), true);
});

test('a scoped retry cannot cancel an in-flight full Crime refresh', async () => {
  const runs = [];
  const owner = createCrimeRefreshOwner({
    readSnapshot: () => ({ mode: 'crime' }),
    runRefresh: async (_snapshot, context) => {
      const gate = deferred();
      runs.push({ context, gate });
      return gate.promise;
    },
  });

  const fullRefresh = owner.refresh({ scope: 'all' });
  assert.equal(runs.length, 1);
  const scopedRetry = await owner.refresh({ scope: 'charts' });

  assert.deepEqual(scopedRetry, {
    applied: false,
    status: 'busy',
    reason: 'full-refresh-active',
  });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].context.signal.aborted, false);
  assert.equal(runs[0].context.isCurrent(), true);

  runs[0].gate.resolve({ applied: true, status: 'live' });
  assert.deepEqual(await fullRefresh, { applied: true, status: 'live' });
});

test('observed Crime result jobs publish as each surface settles, not in input order', async () => {
  assert.equal(typeof refreshContract.observeCrimeRefreshJob, 'function');
  const boundary = deferred();
  const charts = deferred();
  const settled = [];
  const observe = (name, promise) => refreshContract.observeCrimeRefreshJob({ name, promise }, {
    isCurrent: () => true,
    onSettled: (entry) => settled.push(entry.name),
  });

  const trackedBoundary = observe('boundary', boundary.promise);
  const trackedCharts = observe('charts', charts.promise);
  charts.resolve({ applied: true, status: 'success' });
  await trackedCharts;
  assert.deepEqual(settled, ['charts']);

  boundary.resolve({ applied: true, status: 'success' });
  await trackedBoundary;
  assert.deepEqual(settled, ['charts', 'boundary']);
});

test('optional tract outline failure only makes a requested overlay partial', () => {
  assert.deepEqual(classifyDistrictBoundaryRefresh({
    featureCount: 22,
    overlayRequested: false,
    outlineResult: { applied: true, status: 'failed', error: 'offline' },
  }), {
    applied: true,
    status: 'success',
    featureCount: 22,
  });
  assert.deepEqual(classifyDistrictBoundaryRefresh({
    featureCount: 22,
    overlayRequested: true,
    outlineResult: { applied: true, status: 'failed', error: 'offline' },
  }), {
    applied: true,
    status: 'partial',
    featureCount: 22,
    succeeded: ['districts'],
    failed: ['tracts-outline'],
  });
  assert.deepEqual(classifyDistrictBoundaryRefresh({
    featureCount: 22,
    overlayRequested: true,
    outlineResult: { applied: false, status: 'superseded' },
  }), { applied: false, status: 'superseded' });
});

test('tract outline resolution consults the metadata-aware source on every refresh', async () => {
  const resolvedSources = [];
  let calls = 0;
  const fetchTracts = async ({ onSourceResolved }) => {
    calls += 1;
    onSourceResolved({
      dataset: 'census-tract-boundaries',
      kind: 'live',
      provider: 'Official tract boundary API',
      cacheHit: calls > 1,
    });
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: null }],
    };
  };
  const options = {
    fetchTracts,
    isCurrent: () => true,
    onSourceResolved: (metadata) => resolvedSources.push(metadata),
  };

  const first = await loadTractOutlineResult(options);
  const second = await loadTractOutlineResult(options);

  assert.equal(calls, 2);
  assert.equal(first.status, 'success');
  assert.equal(second.status, 'success');
  assert.deepEqual(resolvedSources.map(({ cacheHit }) => cacheHit), [false, true]);
});

test('Crime refresh planning skips selection-bound work until a real analysis target exists', () => {
  assert.equal(normalizeCrimeRefreshScope('charts'), 'charts');
  assert.equal(normalizeCrimeRefreshScope('invented-result'), null);

  const idle = planCrimeRefresh({ queryMode: 'buffer', centerLonLat: null }, 'all');
  assert.deepEqual(idle, {
    valid: true,
    requested: ['boundary'],
    inactive: ['incidents', 'charts', 'summary'],
  });

  const district = planCrimeRefresh({ queryMode: 'district', selectedDistrictCode: '07' }, 'all');
  assert.deepEqual(district, {
    valid: true,
    requested: ['boundary', 'charts', 'summary'],
    inactive: ['incidents'],
  });

  assert.deepEqual(planCrimeRefresh({ queryMode: 'buffer' }, 'invented-result'), {
    valid: false,
    requested: [],
    inactive: [],
  });
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

test('A-only Crime snapshots preserve canonical null labels for comparison persistence', async () => {
  const filters = {
    start: '2026-01-01',
    end: '2026-02-01',
    types: [],
    center3857: [1, 2],
    centerB3857: null,
    radiusM: 400,
    adminLevel: 'districts',
    per10k: false,
    addressA: null,
    addressB: null,
  };
  const snapshot = refreshContract.readCrimeSnapshot({
    ...filters,
    centerLonLat: [-75, 40],
    centerBLonLat: null,
    getFilters: () => filters,
  });

  assert.equal(snapshot.addressA, null);
  assert.equal(snapshot.addressB, null);
  await updateCompare(snapshot, {
    fetchers: {
      fetchCountBuffer: async () => 12,
      fetchTopTypesBuffer: async () => ({ rows: [] }),
    },
    view: { pending() {}, success() {}, error(error) { throw error; } },
  });
  const saved = getLastComparisonSnapshot(filters);
  assert.ok(saved);
  assert.equal(saved.comparison.a.label, 'Point A');
  assert.equal(saved.comparison.b, null);
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

test('pending and aborted refreshes retain exports, while applied partial results disable them until recovery', async () => {
  const filters = {
    start: '2026-03-01', end: '2026-04-01', types: [],
    center3857: [9, 10], centerB3857: null, radiusM: 400,
    adminLevel: 'districts', per10k: false, addressA: null, addressB: null,
  };
  const view = createCompareView();
  const successfulFetchers = {
    fetchCountBuffer: async () => 12,
    fetchTopTypesBuffer: async () => ({ rows: [] }),
  };
  await updateCompare(filters, { fetchers: successfulFetchers, view });
  const successful = getLastComparisonSnapshot(filters);
  assert.ok(successful);

  const gate = deferred();
  const controller = new AbortController();
  const pending = updateCompare(filters, {
    signal: controller.signal,
    shouldApply: () => !controller.signal.aborted,
    fetchers: { ...successfulFetchers, fetchCountBuffer: () => gate.promise },
    view,
  });
  assert.deepEqual(getLastComparisonSnapshot(filters), successful);
  controller.abort(new DOMException('Cancelled by test', 'AbortError'));
  gate.reject(controller.signal.reason);
  assert.deepEqual(await pending, { applied: false });
  assert.deepEqual(getLastComparisonSnapshot(filters), successful);

  const partial = await updateCompare(filters, {
    fetchers: { ...successfulFetchers, fetchCountBuffer: async () => { throw new Error('upstream failed'); } },
    view,
  });
  assert.equal(partial.status, 'partial');
  assert.equal(getLastComparisonSnapshot(filters), null);

  await updateCompare(filters, { fetchers: successfulFetchers, view });
  assert.ok(getLastComparisonSnapshot(filters));
});

test('population estimation forwards the owning signal and resolved-source callback to both data sources', async () => {
  const controller = new AbortController();
  const sourceSignals = [];
  const resolvedSources = [];
  const onSourceResolved = (metadata) => resolvedSources.push(metadata);
  await estimatePopInBuffer({
    center3857: [0, 0],
    radiusM: 100,
    signal: controller.signal,
    onSourceResolved,
    fetchTracts: async (options) => {
      sourceSignals.push(options?.signal);
      assert.equal(options?.onSourceResolved, onSourceResolved);
      options.onSourceResolved({ dataset: 'census-tract-boundaries', kind: 'live' });
      return { type: 'FeatureCollection', features: [] };
    },
    fetchStats: async (options) => {
      sourceSignals.push(options?.signal);
      assert.equal(options?.onSourceResolved, onSourceResolved);
      options.onSourceResolved({ dataset: 'census-tract-statistics', kind: 'fallback' });
      return [];
    },
  });

  assert.deepEqual(sourceSignals, [controller.signal, controller.signal]);
  assert.deepEqual(resolvedSources, [
    { dataset: 'census-tract-boundaries', kind: 'live' },
    { dataset: 'census-tract-statistics', kind: 'fallback' },
  ]);
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
