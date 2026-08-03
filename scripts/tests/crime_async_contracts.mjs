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

test('manual cancellation aborts the active Crime refresh without starting another generation', async () => {
  const gate = deferred();
  let snapshotReads = 0;
  let activeSignal = null;
  const owner = createCrimeRefreshOwner({
    readSnapshot: () => ({ sequence: ++snapshotReads }),
    runRefresh: (_snapshot, context) => {
      activeSignal = context.signal;
      return gate.promise;
    },
  });

  const refresh = owner.refresh();
  assert.equal(typeof owner.cancel, 'function');
  owner.cancel();

  assert.equal(activeSignal.aborted, true);
  assert.equal(snapshotReads, 1);
  gate.resolve({ applied: true });
  assert.deepEqual(await refresh, { applied: false });
});

test('marker dragging updates position immediately and refreshes once after the final settle delay', async () => {
  const { wireSettledMarkerDrag } = await import('../../src/routes_crime/index.js');
  assert.equal(typeof wireSettledMarkerDrag, 'function');

  const listeners = new Map();
  const marker = {
    position: { lng: -75.16, lat: 39.95 },
    on(event, listener) { listeners.set(event, listener); return this; },
    off(event, listener) {
      if (listeners.get(event) === listener) listeners.delete(event);
      return this;
    },
    getLngLat() { return this.position; },
  };
  const timers = new Map();
  const waits = [];
  let nextTimerId = 1;
  const scheduler = {
    setTimeout(callback, wait) {
      const id = nextTimerId++;
      timers.set(id, callback);
      waits.push(wait);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  const dragStarts = [];
  const moves = [];
  const settled = [];
  const dispose = wireSettledMarkerDrag(marker, {
    scheduler,
    onDragStart: () => dragStarts.push('start'),
    onMove: (position) => moves.push(position),
    onSettled: (position) => settled.push(position),
  });

  listeners.get('dragstart')();
  marker.position = { lng: -75.17, lat: 39.96 };
  listeners.get('drag')();
  listeners.get('dragend')();
  assert.deepEqual(dragStarts, ['start']);
  assert.deepEqual(moves, [{ lng: -75.17, lat: 39.96 }]);
  assert.deepEqual(settled, []);
  assert.deepEqual(waits, [350]);
  assert.equal(timers.size, 1);

  listeners.get('dragstart')();
  assert.equal(timers.size, 0);
  marker.position = { lng: -75.18, lat: 39.97 };
  listeners.get('drag')();
  listeners.get('dragend')();
  const [timerId, callback] = timers.entries().next().value;
  timers.delete(timerId);
  callback();

  assert.deepEqual(moves, [
    { lng: -75.17, lat: 39.96 },
    { lng: -75.18, lat: 39.97 },
  ]);
  assert.deepEqual(settled, [{ lng: -75.18, lat: 39.97 }]);
  dispose();
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0);
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

test('pending, aborted, and failed refreshes retain the last successful matching comparison snapshot', async () => {
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

  await updateCompare(filters, {
    fetchers: { ...successfulFetchers, fetchCountBuffer: async () => { throw new Error('upstream failed'); } },
    view,
  });
  assert.deepEqual(getLastComparisonSnapshot(filters), successful);
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
