#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as crimeApi from '../../src/api/crime.js';
import {
  createTractSummaryFetchers,
  resolveSelectedTractGeometry,
  updateAllCharts,
} from '../../src/charts/index.js';
import { getLastComparisonSnapshot, updateCompare } from '../../src/compare/card.js';
import * as refreshContract from '../../src/routes_crime/crime_refresh_owner.js';
import {
  classifyDistrictBoundaryRefresh,
  loadTractOutlineResult,
  planCrimeRefresh,
  normalizeCrimeRefreshScope,
  runPublicCrimeCameraNavigation,
} from '../../src/routes_crime/index.js';
import { estimatePopInBuffer } from '../../src/utils/pop_buffer.js';
import { joinDistrictCountsToGeoJSON } from '../../src/utils/join.js';

const { createCrimeRefreshOwner } = refreshContract;
const { fetchPoints } = crimeApi;

test('Crime external response admission rejects malformed HTTP 200 payloads and preserves admitted zero', () => {
  assert.equal(typeof crimeApi.admitCrimeResponse, 'function');

  assert.deepEqual(crimeApi.admitCrimeResponse('monthly', { rows: [] }), { rows: [] });
  assert.deepEqual(crimeApi.admitCrimeResponse('count', { rows: [{ n: 0 }] }), { rows: [{ n: 0 }] });
  assert.throws(() => crimeApi.admitCrimeResponse('monthly', {}), /rows/i);
  assert.throws(() => crimeApi.admitCrimeResponse('monthly', { rows: [{ m: '2026-13-01', n: 1 }] }), /month/i);
  assert.throws(() => crimeApi.admitCrimeResponse('monthly', { rows: [{ m: '2026-01-01', n: Number.NaN }] }), /count/i);
  assert.throws(() => crimeApi.admitCrimeResponse('count', { rows: [] }), /count/i);
  assert.throws(() => crimeApi.admitCrimeResponse('count', { rows: [{ n: 'NaN' }] }), /count/i);
  assert.throws(() => crimeApi.admitCrimeResponse('heat', { rows: [{ dow: 7, hr: 3, n: 1 }] }), /day-of-week/i);
  assert.throws(() => crimeApi.admitCrimeResponse('heat', { rows: [{ dow: 1, hr: 24, n: 1 }] }), /hour/i);
  assert.throws(() => crimeApi.admitCrimeResponse('district', { rows: [{ dc_dist: 'not-a-district', n: 1 }] }), /district/i);
  assert.throws(() => crimeApi.admitCrimeResponse('top', { rows: [{ text_general_code: '', n: 1 }] }), /offense/i);
  assert.throws(() => crimeApi.admitCrimeResponse('codes', { rows: [{ text_general_code: null }] }), /offense/i);
});

test('Crime point admission rejects malformed GeoJSON instead of normalizing it to an empty result', () => {
  assert.equal(typeof crimeApi.admitCrimeResponse, 'function');
  assert.deepEqual(
    crimeApi.admitCrimeResponse('points', { type: 'FeatureCollection', features: [] }),
    { type: 'FeatureCollection', features: [] },
  );
  assert.throws(() => crimeApi.admitCrimeResponse('points', { type: 'FeatureCollection' }), /features/i);
  assert.throws(() => crimeApi.admitCrimeResponse('points', {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [Number.NaN, 39.9] }, properties: {} }],
  }), /coordinates/i);
});

test('district joins preserve missing-district zero but reject malformed admitted rows', () => {
  const districts = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { DIST_NUMC: '01' }, geometry: null },
      { type: 'Feature', properties: { DIST_NUMC: '02' }, geometry: null },
    ],
  };
  const joined = joinDistrictCountsToGeoJSON(districts, [{ dc_dist: '01', n: 3 }]);
  assert.deepEqual(joined.features.map(({ properties }) => properties.value), [3, 0]);
  assert.throws(() => joinDistrictCountsToGeoJSON(districts, [{ dc_dist: '01', n: Number.NaN }]), /count/i);
  assert.throws(() => joinDistrictCountsToGeoJSON(districts, [{ dc_dist: 'invalid', n: 3 }]), /district/i);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function queryPresetFixture() {
  return {
    queryMode: 'tract',
    startMonth: '2024-01',
    durationMonths: 12,
    radius: 800,
    selectedGroups: ['violent'],
    selectedDrilldownCodes: ['0300'],
    selectedDistrictCode: null,
    selectedTractGEOID: '42101000100',
    overlayTractsLines: true,
    centerLonLat: null,
    centerBLonLat: null,
    addressA: null,
    addressB: null,
    per10k: true,
    classMethod: 'equal',
    classBins: 7,
    classPalette: 'OrRd',
    classOpacity: 0.6,
    classCustomBreaks: [1, 4, 9],
  };
}

test('cancelling a query preset preview has no canonical or refresh side effects', async () => {
  const { createQueryPresetController } = await import('../../src/routes_crime/query_preset_controller.js');
  const current = queryPresetFixture();
  const sideEffects = [];
  const controller = createQueryPresetController({
    readCanonical: () => current,
    readCoverage: () => ({ status: 'ready', min: '2020-01', max: '2026-06' }),
    replaceCanonical: () => sideEffects.push('replace'),
    syncControls: () => sideEffects.push('sync'),
    writeCanonicalUrl: () => sideEffects.push('url'),
    clearCurrentArtifact: () => sideEffects.push('clear'),
    requestSingleCrimeRefresh: () => sideEffects.push('refresh'),
  });

  assert.equal(controller.previewPreset('latest-6-months').status, 'preview');
  assert.deepEqual(controller.cancelPreview(), { status: 'cancelled' });
  assert.equal(controller.getPreview(), null);
  assert.deepEqual(sideEffects, []);
});

test('query preset confirmation fails closed when canonical state or coverage basis is stale', async () => {
  const { createQueryPresetController } = await import('../../src/routes_crime/query_preset_controller.js');

  for (const staleSource of ['canonical', 'coverage']) {
    let current = queryPresetFixture();
    let coverage = { status: 'ready', min: '2020-01', max: '2026-06' };
    const sideEffects = [];
    const controller = createQueryPresetController({
      readCanonical: () => current,
      readCoverage: () => coverage,
      replaceCanonical: () => sideEffects.push('replace'),
      syncControls: () => sideEffects.push('sync'),
      writeCanonicalUrl: () => sideEffects.push('url'),
      clearCurrentArtifact: () => sideEffects.push('clear'),
      requestSingleCrimeRefresh: () => sideEffects.push('refresh'),
    });
    assert.equal(controller.previewPreset('latest-24-months').status, 'preview');

    if (staleSource === 'canonical') current = { ...current, radius: 1200 };
    else coverage = { ...coverage, max: '2026-07' };

    assert.deepEqual(await controller.confirmPreview(), { status: 'stale' });
    assert.equal(controller.getPreview(), null);
    assert.deepEqual(sideEffects, []);
  }
});

test('query preset reports exact zero, one, or two-field diffs and a no-op has no side effects', async () => {
  const { createQueryPresetController, createQueryPresetPreview } = await import('../../src/routes_crime/query_preset_controller.js');
  const coverage = { status: 'ready', min: '2020-01', max: '2026-06' };
  const exact = { ...queryPresetFixture(), startMonth: '2026-01', durationMonths: 6 };
  const oneField = { ...exact, startMonth: '2025-12' };
  const twoFields = queryPresetFixture();

  const unchanged = createQueryPresetPreview({ presetId: 'latest-6-months', currentState: exact, coverage });
  assert.equal(unchanged.status, 'unchanged');
  assert.deepEqual(unchanged.changes, []);
  assert.deepEqual(
    createQueryPresetPreview({ presetId: 'latest-6-months', currentState: oneField, coverage }).changes.map(({ field }) => field),
    ['startMonth'],
  );
  assert.deepEqual(
    createQueryPresetPreview({ presetId: 'latest-6-months', currentState: twoFields, coverage }).changes.map(({ field }) => field),
    ['startMonth', 'durationMonths'],
  );

  const sideEffects = [];
  const controller = createQueryPresetController({
    readCanonical: () => exact,
    readCoverage: () => coverage,
    replaceCanonical: () => sideEffects.push('replace'),
    syncControls: () => sideEffects.push('sync'),
    writeCanonicalUrl: () => sideEffects.push('url'),
    clearCurrentArtifact: () => sideEffects.push('clear'),
    requestSingleCrimeRefresh: () => sideEffects.push('refresh'),
  });
  assert.equal(controller.previewPreset('latest-6-months').status, 'unchanged');
  assert.deepEqual(await controller.confirmPreview(), { status: 'unchanged' });
  assert.deepEqual(sideEffects, []);
  assert.equal(controller.canUndo(), false);
});

test('query preset confirmation commits once in canonical transaction order and awaits one refresh', async () => {
  const { createQueryPresetController } = await import('../../src/routes_crime/query_preset_controller.js');
  let current = queryPresetFixture();
  const trace = [];
  const syncGate = deferred();
  const refreshGate = deferred();
  const controller = createQueryPresetController({
    readCanonical: () => current,
    readCoverage: () => ({ status: 'ready', min: '2020-01', max: '2026-06' }),
    replaceCanonical: (next) => {
      trace.push('replace');
      current = structuredClone(next);
    },
    syncControls: () => {
      trace.push('sync');
      return syncGate.promise;
    },
    writeCanonicalUrl: () => trace.push('url'),
    clearCurrentArtifact: () => trace.push('clear'),
    requestSingleCrimeRefresh: () => {
      trace.push('refresh');
      return refreshGate.promise;
    },
  });
  const preview = controller.previewPreset('latest-6-months');
  const confirming = controller.confirmPreview();
  let settled = false;
  confirming.then(() => { settled = true; });

  assert.deepEqual(trace, ['replace', 'sync']);
  assert.equal(settled, false);
  assert.equal(controller.getPreview(), null);
  assert.deepEqual(current, preview.after);

  syncGate.resolve();
  await Promise.resolve();
  assert.deepEqual(trace, ['replace', 'sync', 'url', 'clear', 'refresh']);
  assert.equal(settled, false);

  refreshGate.resolve({ applied: true, status: 'live' });
  assert.deepEqual(await confirming, {
    status: 'applied',
    refresh: { applied: true, status: 'live' },
  });
  assert.deepEqual(trace, ['replace', 'sync', 'url', 'clear', 'refresh']);
});

test('query preset undo restores the full prior canonical snapshot through one refresh', async () => {
  const { createQueryPresetController } = await import('../../src/routes_crime/query_preset_controller.js');
  const before = queryPresetFixture();
  let current = structuredClone(before);
  const trace = [];
  const controller = createQueryPresetController({
    readCanonical: () => current,
    readCoverage: () => ({ status: 'ready', min: '2020-01', max: '2026-06' }),
    replaceCanonical: (next) => {
      trace.push('replace');
      current = structuredClone(next);
    },
    syncControls: () => trace.push('sync'),
    writeCanonicalUrl: () => trace.push('url'),
    clearCurrentArtifact: () => trace.push('clear'),
    requestSingleCrimeRefresh: async () => {
      trace.push('refresh');
      return { applied: true, status: 'live' };
    },
  });

  controller.previewPreset('latest-24-months');
  await controller.confirmPreview();
  assert.equal(controller.canUndo(), true);
  assert.notDeepEqual(current, before);

  assert.deepEqual(await controller.undo(), {
    status: 'undone',
    refresh: { applied: true, status: 'live' },
  });
  assert.deepEqual(current, before);
  assert.equal(controller.canUndo(), false);
  assert.deepEqual(trace, [
    'replace', 'sync', 'url', 'clear', 'refresh',
    'replace', 'sync', 'url', 'clear', 'refresh',
  ]);
});

test('query preset undo expires without overwriting canonical state changed after apply', async () => {
  const { createQueryPresetController } = await import('../../src/routes_crime/query_preset_controller.js');
  let current = queryPresetFixture();
  const trace = [];
  const controller = createQueryPresetController({
    readCanonical: () => current,
    readCoverage: () => ({ status: 'ready', min: '2020-01', max: '2026-06' }),
    replaceCanonical: (next) => {
      trace.push('replace');
      current = structuredClone(next);
    },
    syncControls: () => trace.push('sync'),
    writeCanonicalUrl: () => trace.push('url'),
    clearCurrentArtifact: () => trace.push('clear'),
    requestSingleCrimeRefresh: async () => {
      trace.push('refresh');
      return { applied: true, status: 'live' };
    },
  });

  controller.previewPreset('latest-6-months');
  await controller.confirmPreview();
  current = { ...current, selectedGroups: ['property'] };

  assert.deepEqual(await controller.undo(), { status: 'stale' });
  assert.deepEqual(current.selectedGroups, ['property']);
  assert.equal(controller.canUndo(), false);
  assert.deepEqual(trace, ['replace', 'sync', 'url', 'clear', 'refresh']);
});

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

  const tract = planCrimeRefresh({
    queryMode: 'tract',
    selectedTractGEOID: '42101000100',
  }, 'all');
  assert.deepEqual(tract, {
    valid: true,
    requested: ['boundary', 'incidents', 'charts', 'summary'],
    inactive: [],
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

test('A-only private Crime snapshots are identified before comparison persistence', () => {
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
  assert.equal(refreshContract.isPrivateCrimeAnalysisSnapshot(snapshot), true);
  assert.deepEqual(refreshContract.privateCrimeUnavailableResult(), {
    status: 'unavailable',
    reason: 'private-location-analysis',
    succeeded: [],
    failed: [],
  });
});

test('tract summaries adapt tract count, offense, and population data to the shared summary card', async () => {
  const fetchers = createTractSummaryFetchers({
    tractGEOID: '42101000100',
    fetchMonthly: async ({ tractGEOID }) => {
      assert.equal(tractGEOID, '42101000100');
      return {
        rows: [
          { m: '2098-01-01', n: 4 },
          { m: '2098-02-01', n: 5 },
        ],
      };
    },
    fetchTop: async ({ tractGEOID }) => {
      assert.equal(tractGEOID, '42101000100');
      return { rows: [{ text_general_code: 'Arson', n: 9 }] };
    },
    fetchStats: async ({ onSourceResolved }) => {
      onSourceResolved({ dataset: 'census-tract-statistics', kind: 'fallback' });
      return [{ geoid: '42101000100', pop: 1000 }];
    },
  });
  const result = await updateCompare({
    start: '2098-01-01',
    end: '2098-02-01',
    types: ['Arson'],
    queryMode: 'tract',
    selectedTractGEOID: '42101000100',
    center3857: [0, 0],
    centerB3857: null,
    addressA: 'Census Tract 42101000100',
    radiusM: 1,
    adminLevel: 'tracts',
    per10k: true,
  }, {
    fetchers,
    view: { pending() {}, success() {}, error(error) { throw error; } },
  });

  assert.match(result.a.label, /42101000100/);
  assert.equal(result.a.total, 9);
  assert.equal(result.a.per10k, 90);
  assert.equal(result.b, null);
  assert.ok(getLastComparisonSnapshot({
    start: '2098-01-01',
    end: '2098-02-01',
    types: ['Arson'],
    queryMode: 'tract',
    selectedTractGEOID: '42101000100',
    center3857: [-1, -1],
    radiusM: 2400,
    adminLevel: 'tracts',
    per10k: true,
  }));
});

test('the lazy tract summary adapter exposes callable production defaults', () => {
  const fetchers = createTractSummaryFetchers({ tractGEOID: '42101000100' });
  assert.equal(typeof fetchers.fetchCountBuffer, 'function');
  assert.equal(typeof fetchers.fetchTopTypesBuffer, 'function');
  assert.equal(typeof fetchers.estimatePopInBuffer, 'function');
});

test('tract incident requests resolve the selected boundary before building point SQL', async (t) => {
  const originalFetch = globalThis.fetch;
  let sql = '';
  globalThis.fetch = async (_url, options) => {
    sql = new URLSearchParams(options.body).get('q') || '';
    return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const tractGeometry = await resolveSelectedTractGeometry({
    selectedTractGEOID: '42101000100',
    fetchTracts: async () => ({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { GEOID: '42101000100' },
        geometry: {
          type: 'Polygon',
          coordinates: [[[-75.2, 39.9], [-75.1, 39.9], [-75.1, 40], [-75.2, 39.9]]],
        },
      }],
    }),
  });
  await fetchPoints({
    start: '2098-03-01',
    end: '2098-04-01',
    types: ['Arson'],
    bbox: [-8_370_000, 4_850_000, -8_360_000, 4_860_000],
    tractGeometry,
  });

  assert.match(sql, /ST_Intersects\(the_geom, ST_SetSRID\(ST_GeomFromGeoJSON/);
  assert.doesNotMatch(sql, /ST_DWithin\(the_geom_webmercator/);
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
    enteredTransport.resolve(options);
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });

  const controller = new AbortController();
  const request = fetchPoints({
    start: '2099-01-01',
    end: '2099-02-01',
    types: [],
    bbox: [-8_400_000, 4_800_000, -8_300_000, 4_900_000],
    dc_dist: '05',
    signal: controller.signal,
  });
  const transportOptions = await enteredTransport.promise;
  const transportSignal = transportOptions.signal;
  const sql = new URLSearchParams(transportOptions.body).get('q');
  controller.abort(new DOMException('Cancelled by test', 'AbortError'));

  assert.equal(transportSignal.aborted, true);
  assert.match(sql, /ST_MakeEnvelope/);
  assert.doesNotMatch(sql, /ST_DWithin\(the_geom_webmercator,/);
  await assert.rejects(request, { name: 'AbortError' });
});

test('private buffer points fail before transport while public district points still fetch', async (t) => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(fetchPoints({
    start: '2099-01-01',
    end: '2099-02-01',
    center3857: [-8_365_000, 4_855_000],
    radiusM: 800,
  }), /unavailable/i);
  assert.equal(fetchCalls, 0);

  for (const request of [
    () => crimeApi.fetchMonthlySeriesBuffer({
      start: '2099-01-01', end: '2099-02-01', center3857: [-8_365_000, 4_855_000], radiusM: 800,
    }),
    () => crimeApi.fetchTopTypesBuffer({
      start: '2099-01-01', end: '2099-02-01', center3857: [-8_365_000, 4_855_000], radiusM: 800,
    }),
    () => crimeApi.fetch7x24Buffer({
      start: '2099-01-01', end: '2099-02-01', center3857: [-8_365_000, 4_855_000], radiusM: 800,
    }),
    () => crimeApi.fetchCountBuffer({
      start: '2099-01-01', end: '2099-02-01', center3857: [-8_365_000, 4_855_000], radiusM: 800,
    }),
  ]) {
    await assert.rejects(request(), /unavailable/i);
  }
  assert.equal(fetchCalls, 0);

  await fetchPoints({
    start: '2099-01-01',
    end: '2099-02-01',
    dc_dist: '05',
  });
  assert.equal(fetchCalls, 1);
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

test('Crime list refresh uses one snapshot for incidents, summary, charts, and provenance', async () => {
  const listModule = await import('../../src/routes_crime/list_mode_controller.js').catch(() => ({}));
  assert.equal(typeof listModule.createCrimeListController, 'function');
  const calls = [];
  const snapshot = {
    start: '2026-01-01',
    end: '2026-07-01',
    types: ['Thefts'],
    resolvedOffenseCodes: ['Thefts'],
    drilldownCodes: [],
    queryMode: 'district',
    selectedDistrictCode: '05',
    center3857: null,
    centerLonLat: null,
    centerB3857: null,
    centerBLonLat: null,
    addressA: null,
    addressB: null,
    radiusM: 400,
    adminLevel: 'districts',
    per10k: false,
    coverageDate: '2026-06-30',
    overlayTractsLines: false,
  };
  const view = {
    loading(scope) { calls.push(['loading', scope]); return scope; },
    incidents(payload) { calls.push(['incidents', payload]); },
    ready(scope, provenance) { calls.push(['ready', scope, provenance]); },
    failed(scope) { calls.push(['failed', scope]); },
    unavailable(scope) { calls.push(['unavailable', scope]); },
    clear(scope) { calls.push(['clear', scope]); },
    focusResults() { calls.push(['focus']); },
  };
  const controller = listModule.createCrimeListController({
    readSnapshot: () => structuredClone(snapshot),
    initializeCoverage: async () => {},
    fetchIncidents: async (value) => {
      assert.equal(value.selectedDistrictCode, '05');
      return { type: 'FeatureCollection', features: [{ properties: { cartodb_id: 1 } }] };
    },
    updateSummary: async (value) => {
      assert.equal(value.selectedDistrictCode, '05');
      return { applied: true, status: 'success', a: { status: 'success', total: 1 } };
    },
    updateCharts: async (value) => {
      assert.equal(value.selectedDistrictCode, '05');
      return { applied: true, status: 'success', succeeded: ['monthly', 'top', 'heat'], failed: [] };
    },
    createProvenance: ({ name, snapshot: value }) => {
      assert.deepEqual(value, snapshot);
      return Object.freeze({ name, selection: value.selectedDistrictCode });
    },
    view,
  });

  const result = await controller.requestRefresh();
  assert.equal(result.status, 'live');
  assert.deepEqual(result.succeeded.sort(), ['charts', 'incidents', 'summary']);
  assert.ok(calls.some(([kind, payload]) => kind === 'incidents' && payload.count === 1));
  assert.deepEqual(
    calls.filter(([kind]) => kind === 'ready').map(([, scope]) => scope).sort(),
    ['charts', 'incidents', 'summary'],
  );
  assert.equal(calls.at(-1)[0], 'focus');
});

test('Crime list private analysis returns unavailable before coverage or any fetch owner', async () => {
  const { createCrimeListController } = await import('../../src/routes_crime/list_mode_controller.js');
  const calls = [];
  const snapshot = {
    queryMode: 'buffer',
    centerLonLat: [-75.16, 39.95],
    center3857: [-8364000, 4855000],
    addressA: '1500 PRIVATE MARKET STREET',
  };
  const owner = async (name) => { calls.push(name); return { applied: true, status: 'success' }; };
  const view = {
    unavailable(scope) { calls.push(`unavailable:${scope}`); },
  };
  const controller = createCrimeListController({
    readSnapshot: () => structuredClone(snapshot),
    initializeCoverage: () => owner('coverage'),
    fetchIncidents: () => owner('incidents'),
    updateSummary: () => owner('summary'),
    updateCharts: () => owner('charts'),
    view,
  });

  const result = await controller.requestRefresh();
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(calls, [
    'unavailable:incidents',
    'unavailable:summary',
    'unavailable:charts',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|MARKET|75\.16|8364000/);
});

test('private buffer residue projects to a public district snapshot and runs district jobs', async () => {
  const { createCrimeListController } = await import('../../src/routes_crime/list_mode_controller.js');
  const privateToken = '1500 PRIVATE MARKET STREET';
  const source = {
    queryMode: 'district',
    selectedDistrictCode: '05',
    centerLonLat: [-75.16, 39.95],
    center3857: [-8364000, 4855000],
    centerBLonLat: [-75.17, 39.96],
    centerB3857: [-8365000, 4856000],
    addressA: privateToken,
    addressB: privateToken,
    adminLevel: 'districts',
    per10k: false,
    coverageMax: '2026-06-30',
    overlayTractsLines: false,
    getFilters() {
      return {
        start: '2026-01-01', end: '2026-07-01', types: [], queryMode: 'district',
        selectedDistrictCode: '05', center3857: this.center3857, centerB3857: this.centerB3857,
        addressA: this.addressA, addressB: this.addressB, radiusM: 400,
      };
    },
  };
  const calls = [];
  const record = (name) => (snapshot) => {
    calls.push(name);
    assert.equal(snapshot.queryMode, 'district');
    assert.equal(snapshot.selectedDistrictCode, '05');
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE|MARKET|75\.16|8364|8365/);
    return name === 'incidents'
      ? { type: 'FeatureCollection', features: [] }
      : { applied: true, status: 'success' };
  };
  const controller = createCrimeListController({
    readSnapshot: () => refreshContract.readCrimeSnapshot(source),
    initializeCoverage: async () => calls.push('coverage'),
    fetchIncidents: record('incidents'),
    updateSummary: record('summary'),
    updateCharts: record('charts'),
    view: { loading() {}, incidents() {}, ready() {}, clear() {}, unavailable() {} },
  });

  const result = await controller.requestRefresh();
  assert.equal(result.status, 'live');
  assert.deepEqual(calls.sort(), ['charts', 'coverage', 'incidents', 'summary']);
  assert.equal(refreshContract.isPrivateCrimeAnalysisSnapshot(source), false);
  assert.deepEqual(source.centerLonLat, [-75.16, 39.95]);
  assert.equal(source.addressA, privateToken);
});

test('private buffer residue projects to a public tract snapshot and runs tract jobs', async () => {
  const { createCrimeListController } = await import('../../src/routes_crime/list_mode_controller.js');
  const source = {
    queryMode: 'tract',
    selectedTractGEOID: '42101000100',
    centerLonLat: [-75.16, 39.95],
    center3857: [-8364000, 4855000],
    addressA: '1500 PRIVATE MARKET STREET',
    adminLevel: 'tracts',
    per10k: true,
    coverageMax: '2026-06-30',
    overlayTractsLines: false,
    getFilters() {
      return {
        start: '2026-01-01', end: '2026-07-01', types: [], queryMode: 'tract',
        selectedTractGEOID: this.selectedTractGEOID, center3857: this.center3857,
        addressA: this.addressA, radiusM: 400,
      };
    },
  };
  const calls = [];
  const record = (name) => (snapshot) => {
    calls.push(name);
    assert.equal(snapshot.queryMode, 'tract');
    assert.equal(snapshot.selectedTractGEOID, '42101000100');
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE|MARKET|75\.16|8364/);
    return name === 'incidents'
      ? { type: 'FeatureCollection', features: [] }
      : { applied: true, status: 'success' };
  };
  const controller = createCrimeListController({
    readSnapshot: () => refreshContract.readCrimeSnapshot(source),
    initializeCoverage: async () => calls.push('coverage'),
    fetchIncidents: record('incidents'),
    updateSummary: record('summary'),
    updateCharts: record('charts'),
    view: { loading() {}, incidents() {}, ready() {}, clear() {}, unavailable() {} },
  });

  const result = await controller.requestRefresh();
  assert.equal(result.status, 'live');
  assert.deepEqual(calls.sort(), ['charts', 'coverage', 'incidents', 'summary']);
  assert.equal(refreshContract.isPrivateCrimeAnalysisSnapshot(source), false);
  assert.deepEqual(source.centerLonLat, [-75.16, 39.95]);
  assert.equal(source.addressA, '1500 PRIVATE MARKET STREET');
});

test('private map points cause zero camera navigation while public districts still fit', async () => {
  assert.equal(refreshContract.containsPrivateCrimeLocation({ queryMode: 'buffer' }), false);
  assert.equal(refreshContract.isPrivateCrimeAnalysisSnapshot({ queryMode: 'buffer' }), true);
  assert.equal(refreshContract.containsActivePrivateCrimeLocation({
    queryMode: 'buffer', centerLonLat: [-75.16, 39.95],
  }), true);
  assert.equal(refreshContract.containsActivePrivateCrimeLocation({
    queryMode: 'district', centerLonLat: [-75.16, 39.95],
  }), false);
  assert.equal(refreshContract.isPrivateCrimeAnalysisSnapshot({
    queryMode: 'district', centerLonLat: [-75.16, 39.95], addressA: 'PRIVATE',
  }), false);
  const cameraCalls = [];
  const feature = {
    type: 'Feature',
    properties: { DIST_NUMC: '05' },
    geometry: {
      type: 'Polygon',
      coordinates: [[[-75.2, 39.9], [-75.1, 39.9], [-75.1, 40], [-75.2, 39.9]]],
    },
  };
  const runProgrammaticMapMove = async (action) => {
    cameraCalls.push('move');
    action();
    return true;
  };
  const fitBounds = () => cameraCalls.push('fit');

  const privateResult = await runPublicCrimeCameraNavigation({
    map: {},
    snapshot: { queryMode: 'buffer', centerLonLat: [-75.16, 39.95] },
    feature,
    runProgrammaticMapMove,
    fitBounds,
  });
  assert.equal(privateResult.status, 'unavailable');
  assert.deepEqual(cameraCalls, []);

  const publicResult = await runPublicCrimeCameraNavigation({
    map: {},
    snapshot: { queryMode: 'district', selectedDistrictCode: '05' },
    feature,
    runProgrammaticMapMove,
    fitBounds,
  });
  assert.equal(publicResult.status, 'applied');
  assert.deepEqual(cameraCalls, ['move', 'fit']);

  const [routeSource, mainSource] = await Promise.all([
    readFile(new URL('../../src/routes_crime/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/main.js', import.meta.url), 'utf8'),
  ]);
  const pointEnd = routeSource.match(/onPointSelectionEnded\(\)\s*\{([\s\S]*?)\n\s*\},/u)?.[1] || '';
  assert.match(pointEnd, /requestRefresh\(\)/u);
  assert.doesNotMatch(pointEnd, /fitCurrentSelection/u);
  assert.match(
    mainSource,
    /if \(containsActivePrivateCrimeLocation\(store\)\)[\s\S]*?throw new Error[\s\S]*?const map = await mapRuntime\.ensureMap\(\)/u,
  );
  assert.match(
    mainSource,
    /center: store\.queryMode === 'buffer' \? store\.centerLonLat \|\| undefined : undefined/u,
  );
});
