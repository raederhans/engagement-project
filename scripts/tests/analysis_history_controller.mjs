#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import '../../src/i18n/history.js';
import {
  buildAnalysisShareUrl,
  createAnalysisHistoryController,
} from '../../src/analysis/analysis_history_controller.js';
import { createModeCoordinator } from '../../src/mode_coordinator.js';
import * as compareCard from '../../src/compare/card.js';
import { createAnalysisHistoryView } from '../../src/ui/analysis_history_panel.js';

class FakeElement extends EventTarget {
  constructor() {
    super();
    this.children = [];
    this.className = '';
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.style = {};
    this.textContent = '';
    this.value = '';
  }

  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute() {}
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

function savedArtifact(overrides = {}) {
  return {
    kind: 'engagement-analysis-artifact',
    schemaVersion: 1,
    id: 'analysis-1',
    title: 'Night safety comparison',
    createdAt: '2026-07-31T08:00:00.000Z',
    updatedAt: '2026-07-31T08:00:00.000Z',
    viewState: {
      queryMode: 'buffer',
      startMonth: '2026-01',
      durationMonths: 6,
      radius: 400,
      centerLonLat: [-75.16, 39.95],
      addressA: 'City Hall',
    },
    resultSummary: null,
    provenance: { sources: ['crime-carto'] },
    ...overrides,
  };
}

function createHarness(overrides = {}) {
  const calls = [];
  const rows = new Map([['analysis-1', savedArtifact()]]);
  const repository = {
    async list() { return { items: [...rows.values()], warnings: [] }; },
    async save(value) { rows.set(value.id, value); calls.push(['save', value]); return value; },
    async get(id) { return rows.get(id) ?? null; },
    async rename(id, title) { calls.push(['rename', id, title]); return rows.get(id); },
    async delete(id) { rows.delete(id); calls.push(['delete', id]); return true; },
  };
  const view = {
    render(model) { calls.push(['render', model]); },
    showStatus(message, tone) { calls.push(['status', message, tone]); },
    showSnapshot(artifact) { calls.push(['snapshot', artifact.id]); },
    showSnapshotState(artifact, status) { calls.push(['snapshot-state', artifact, status]); },
    clearSnapshot() { calls.push(['snapshot-clear']); },
    setPending(value) { calls.push(['pending', value]); },
    clearDraft() { calls.push(['draft-clear']); },
  };
  const store = {
    coverageStatus: 'ready',
    coverageMin: '2006-01-01',
    coverageMax: '2026-07-30',
    queryMode: 'buffer',
    startMonth: '2026-01',
    durationMonths: 6,
    radius: 400,
    centerLonLat: [-75.16, 39.95],
    getFilters() {
      return {
        start: '2026-01-01',
        end: '2026-07-01',
        types: [],
        center3857: [-8360000, 4850000],
        centerB3857: null,
        radiusM: 400,
        adminLevel: 'districts',
        per10k: false,
        addressA: 'City Hall',
        addressB: null,
      };
    },
  };
  const controller = createAnalysisHistoryController({
    store,
    repository,
    view,
    createArtifact(input) {
      calls.push(['create', input]);
      return savedArtifact({ id: 'created', title: input.title, ...input });
    },
    getComparisonSnapshot: () => null,
    replaceViewState(target, value) { Object.assign(target, value); calls.push(['replace']); },
    setAnalysisMode: (mode) => calls.push(['analysis-mode', mode]),
    setViewMode: (mode, options) => calls.push(['view-mode', mode, options]),
    syncControls: () => calls.push(['sync-controls']),
    syncCanonicalUrl: () => calls.push(['sync-url']),
    scheduleCrime: async () => { calls.push(['schedule']); return { status: 'live' }; },
    renderSavedComparison: (summary) => calls.push(['render-comparison', summary]),
    copyText: async (value) => calls.push(['copy', value]),
    downloadArtifact: (artifact) => calls.push(['download', artifact.id]),
    confirmDelete: () => true,
    currentHref: () => 'https://example.test/app/?mode=crime&campaign=portfolio',
    ...overrides,
  });
  return { calls, controller, repository, rows, store, view };
}

test('canonical analysis share URL preserves unrelated parameters without artifact payload metadata', () => {
  const url = new URL(buildAnalysisShareUrl(
    savedArtifact({
      id: 'secret-id',
      title: 'Private title',
      resultSummary: { generatedAt: '2026-07-31T08:00:00.000Z', comparison: { a: { total: 7 } } },
    }),
    'https://example.test/app/?mode=diary&campaign=portfolio&artifact=old&title=old&result=old',
  ));

  assert.equal(url.searchParams.get('campaign'), 'portfolio');
  assert.equal(url.searchParams.get('mode'), 'crime');
  assert.equal(url.searchParams.get('analysis'), 'buffer');
  assert.equal(url.searchParams.get('a'), '-75.16,39.95');
  assert.equal(url.searchParams.has('artifact'), false);
  assert.equal(url.searchParams.has('title'), false);
  assert.equal(url.searchParams.has('result'), false);
  assert.doesNotMatch(url.href, /secret-id|Private\+title|%22total%22/);
});

test('save uses only a matching comparison snapshot and blocks duplicate pending saves', async () => {
  const gate = deferred();
  let saveCalls = 0;
  const harness = createHarness({
    getComparisonSnapshot: () => ({
      generatedAt: '2026-07-31T08:30:00.000Z',
      comparison: { a: { total: 12 } },
    }),
  });
  harness.repository.save = async (artifact) => {
    saveCalls += 1;
    await gate.promise;
    return artifact;
  };

  const first = harness.controller.save('Current view');
  const duplicate = await harness.controller.save('Duplicate');
  assert.deepEqual(duplicate, { status: 'pending' });
  assert.equal(saveCalls, 1);
  gate.resolve();
  await first;

  const createInput = harness.calls.find(([kind]) => kind === 'create')[1];
  assert.deepEqual(createInput.resultSummary, {
    generatedAt: '2026-07-31T08:30:00.000Z',
    comparison: { a: { total: 12 } },
  });
  assert.deepEqual(createInput.provenance.coverage, {
    min: '2006-01-01',
    max: '2026-07-30',
  });
  assert.ok(createInput.provenance.sources.includes('crime-carto'));
  assert.equal(harness.calls.filter(([kind]) => kind === 'draft-clear').length, 1);
});

test('storage failure returns a visible warning instead of an unhandled action rejection', async () => {
  const harness = createHarness();
  harness.repository.save = async () => {
    throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
  };

  const result = await harness.controller.save('Cannot persist');

  assert.equal(result.status, 'failed');
  assert.deepEqual(
    harness.calls.find(([kind, message]) => kind === 'status' && /could not be saved/i.test(message)),
    ['status', 'Analysis could not be saved locally: Storage quota exceeded', 'warning'],
  );
  assert.equal(harness.calls.some(([kind, value]) => kind === 'pending' && value === false), true);
});

test('restore consumes the coordinator Crime schedule as its only refresh', async () => {
  const harness = createHarness();
  const result = await harness.controller.restore('analysis-1');

  assert.deepEqual(result, { status: 'live', artifact: savedArtifact() });
  assert.equal(harness.calls.filter(([kind]) => kind === 'replace').length, 1);
  assert.deepEqual(harness.calls.find(([kind]) => kind === 'view-mode'), ['view-mode', 'crime', { silent: true }]);
  assert.equal(harness.calls.filter(([kind]) => kind === 'schedule').length, 1);
  assert.deepEqual(harness.calls.find(([kind]) => kind === 'render-comparison'), ['render-comparison', null]);
  assert.equal(harness.calls.filter(([kind]) => kind === 'snapshot-clear').length, 1);

  const failed = createHarness({ scheduleCrime: async () => ({ status: 'failed' }) });
  assert.equal((await failed.controller.restore('analysis-1')).status, 'failed');
  assert.equal(failed.calls.some(([kind]) => kind === 'snapshot-clear'), false);
});

test('a partially successful failed restore repaints the saved comparison before its failed terminal', async () => {
  const summary = {
    generatedAt: '2026-07-31T08:30:00.000Z',
    comparison: { a: { label: 'Saved Point A', total: 12 }, b: null },
  };
  const harness = createHarness({
    scheduleCrime: async () => {
      harness.calls.push(['live-mutated']);
      return { status: 'failed' };
    },
  });
  harness.rows.set('analysis-1', savedArtifact({ resultSummary: summary }));

  assert.equal((await harness.controller.restore('analysis-1')).status, 'failed');
  assert.deepEqual(
    harness.calls.filter(([kind]) => ['render-comparison', 'live-mutated', 'snapshot-state'].includes(kind)),
    [
      ['render-comparison', summary],
      ['live-mutated'],
      ['render-comparison', summary],
      ['snapshot-state', savedArtifact({ resultSummary: summary }), 'failed'],
    ],
  );
});

test('rejected Crime scheduling repaints the saved comparison, reports failure, and releases restore ownership', async () => {
  const summary = {
    generatedAt: '2026-07-31T08:30:00.000Z',
    comparison: { a: { label: 'Saved Point A', total: 12 }, b: null },
  };
  let schedules = 0;
  const harness = createHarness({
    scheduleCrime: async () => {
      schedules += 1;
      if (schedules === 1) throw new Error('Crime startup failed');
      return { status: 'live' };
    },
  });
  const artifact = savedArtifact({ resultSummary: summary });
  harness.rows.set('analysis-1', artifact);

  const failed = await harness.controller.restore('analysis-1');

  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.message, 'Crime startup failed');
  assert.deepEqual(
    harness.calls.filter(([kind]) => kind === 'render-comparison'),
    [['render-comparison', summary], ['render-comparison', summary]],
  );
  assert.deepEqual(
    harness.calls.find(([kind, , status]) => kind === 'snapshot-state' && status === 'failed'),
    ['snapshot-state', artifact, 'failed'],
  );
  assert.deepEqual(
    harness.calls.find(([kind, message]) => kind === 'status' && /Crime startup failed/.test(message)),
    ['status', 'Saved settings are visible, but live data could not be refreshed: Crime startup failed', 'warning'],
  );

  assert.equal((await harness.controller.restore('analysis-1')).status, 'live');
  assert.equal(schedules, 2);
  assert.equal(harness.calls.filter(([kind]) => kind === 'snapshot-clear').length, 1);
});

test('an older rejected restore cannot overwrite the terminal state of a newer restore', async () => {
  const olderGate = deferred();
  let schedules = 0;
  const harness = createHarness({
    scheduleCrime: () => {
      schedules += 1;
      return schedules === 1 ? olderGate.promise : Promise.resolve({ status: 'live' });
    },
  });
  const newerArtifact = savedArtifact({ id: 'analysis-2', title: 'Newer analysis' });
  harness.rows.set('analysis-2', newerArtifact);

  const olderRestore = harness.controller.restore('analysis-1');
  while (schedules < 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await harness.controller.restore('analysis-2')).status, 'live');
  const terminalCallsBeforeOlderFailure = harness.calls.filter(([kind]) => ['snapshot-state', 'snapshot-clear', 'status'].includes(kind));
  olderGate.reject(new Error('Older Crime startup failed'));

  assert.deepEqual(await olderRestore, { status: 'superseded' });
  assert.equal(
    harness.calls.some(([kind, artifact, status]) => kind === 'snapshot-state'
      && artifact?.id === 'analysis-1'
      && status === 'failed'),
    false,
  );
  assert.equal(harness.calls.some(([kind, message]) => kind === 'status' && /Older Crime startup failed/.test(message)), false);
  assert.equal(harness.calls.filter(([kind]) => kind === 'snapshot-clear').length, 1);
  assert.deepEqual(
    harness.calls.filter(([kind]) => ['snapshot-state', 'snapshot-clear', 'status'].includes(kind)),
    terminalCallsBeforeOlderFailure,
  );
});

test('a missing or unreadable newer restore intent truthfully terminates an older held restore', async () => {
  for (const nextOutcome of ['missing', 'throw']) {
    const olderGate = deferred();
    let schedules = 0;
    const harness = createHarness({
      scheduleCrime: () => {
        schedules += 1;
        return olderGate.promise;
      },
    });
    const repositoryGet = harness.repository.get;
    harness.repository.get = async (id) => {
      if (id === 'analysis-2' && nextOutcome === 'throw') throw new Error('IndexedDB read failed');
      return repositoryGet(id);
    };

    const olderRestore = harness.controller.restore('analysis-1');
    while (schedules < 1) await new Promise((resolve) => setImmediate(resolve));
    const newerResult = await harness.controller.restore('analysis-2');

    assert.equal(newerResult.status, nextOutcome === 'missing' ? 'missing' : 'failed');
    assert.deepEqual(
      harness.calls.find(([kind, artifact, status]) => kind === 'snapshot-state'
        && artifact?.id === 'analysis-1'
        && status === 'superseded'),
      ['snapshot-state', savedArtifact(), 'superseded'],
    );
    if (nextOutcome === 'throw') {
      assert.deepEqual(
        harness.calls.find(([kind, message]) => kind === 'status' && /IndexedDB read failed/.test(message)),
        ['status', 'Saved analysis could not be opened: IndexedDB read failed', 'warning'],
      );
    }

    const terminalCallsBeforeOlderSettlement = harness.calls.filter(([kind]) => ['snapshot-state', 'snapshot-clear', 'status'].includes(kind));
    olderGate.resolve({ status: 'live' });
    assert.deepEqual(await olderRestore, { status: 'superseded' });
    assert.deepEqual(
      harness.calls.filter(([kind]) => ['snapshot-state', 'snapshot-clear', 'status'].includes(kind)),
      terminalCallsBeforeOlderSettlement,
    );
  }
});

test('a newer restore intent cancels the old Crime transition before its repository read settles', async () => {
  const olderRefresh = deferred();
  const newerRead = deferred();
  let cancelCalls = 0;
  let schedules = 0;
  const harness = createHarness({
    scheduleCrime: () => {
      schedules += 1;
      return olderRefresh.promise;
    },
    cancelCrimeTransition: () => {
      cancelCalls += 1;
      if (schedules > 0) olderRefresh.resolve({ status: 'superseded' });
    },
  });
  const repositoryGet = harness.repository.get;
  harness.repository.get = (id) => (id === 'analysis-2' ? newerRead.promise : repositoryGet(id));

  const olderRestore = harness.controller.restore('analysis-1');
  while (schedules < 1) await new Promise((resolve) => setImmediate(resolve));
  const newerRestore = harness.controller.restore('analysis-2');

  assert.equal(cancelCalls, 2, 'each restore intent must synchronously cancel the previous coordinator transition');
  assert.deepEqual(await olderRestore, { status: 'superseded' });
  let newerSettled = false;
  void newerRestore.then(() => { newerSettled = true; });
  await Promise.resolve();
  assert.equal(newerSettled, false);
  newerRead.resolve(null);
  assert.deepEqual(await newerRestore, { status: 'missing' });
});

test('saved comparison renderer paints the real Compare view before refresh and clears stale data when absent', () => {
  assert.equal(typeof compareCard.renderSavedComparison, 'function');
  const calls = [];
  const view = {
    success(value) { calls.push(['success', value]); },
    empty(message) { calls.push(['empty', message]); },
  };
  const summary = {
    generatedAt: '2026-07-31T08:30:00.000Z',
    comparison: {
      a: { label: 'Cached Point A', total: 12, per10k: null, top3: [], delta30: null },
      b: null,
    },
  };

  assert.equal(compareCard.renderSavedComparison(summary, { view }), true);
  assert.deepEqual(calls[0], ['success', summary.comparison]);
  assert.equal(compareCard.renderSavedComparison(null, { view }), false);
  assert.match(calls[1][1], /no cached comparison/i);
});

test('real coordinator/controller restore boundary invokes one Crime refresh', async () => {
  let refreshCalls = 0;
  const crimeController = {
    setActive() {},
    async requestRefresh() { refreshCalls += 1; return { status: 'live' }; },
    updateBuffer() {},
    setTractsOverlayVisible() {},
    getCurrentProvenance() { return {}; },
  };
  const coordinator = createModeCoordinator({
    map: { isStyleLoaded: () => true },
    diaryFeatureEnabled: false,
    getCurrentMode: () => 'crime',
    writeMode() {},
    loadCrimeController: async () => crimeController,
    loadDiaryModule: async () => null,
    getDiaryInsights: async () => null,
    reportError() {},
  });
  const harness = createHarness({ scheduleCrime: () => coordinator.schedule('crime') });

  assert.equal((await harness.controller.restore('analysis-1')).status, 'live');
  assert.equal(refreshCalls, 1);
});

test('failed and superseded restores keep an explicit saved-snapshot terminal state', async () => {
  for (const terminalStatus of ['failed', 'superseded']) {
    const harness = createHarness({
      scheduleCrime: async () => ({ status: terminalStatus }),
    });
    await harness.controller.restore('analysis-1');
    assert.deepEqual(
      harness.calls.find(([kind, , status]) => kind === 'snapshot-state' && status === terminalStatus),
      ['snapshot-state', savedArtifact(), terminalStatus],
    );
    assert.equal(harness.calls.some(([kind]) => kind === 'snapshot-clear'), false);
  }
});

test('history view uses result generation time and renders truthful terminal snapshot text', () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => new FakeElement() };
  try {
    const mount = new FakeElement();
    const view = createAnalysisHistoryView(mount, {
      onSave() {}, onRestore() {}, onRename() {}, onDelete() {}, onExport() {}, onShare() {},
    });
    const artifact = savedArtifact({
      updatedAt: '2026-07-31T09:00:00.000Z',
      resultSummary: {
        generatedAt: '2026-07-31T08:30:00.000Z',
        comparison: { a: null, b: null },
      },
    });
    const snapshot = mount.children[2];
    view.showSnapshot(artifact);
    assert.match(snapshot.textContent, new RegExp(new Date(artifact.resultSummary.generatedAt).toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(snapshot.textContent, new RegExp(new Date(artifact.updatedAt).toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(snapshot.textContent, /Refreshing live data/);
    view.showSnapshotState(artifact, 'failed');
    assert.match(snapshot.textContent, /refresh failed/i);
    view.showSnapshotState(artifact, 'superseded');
    assert.match(snapshot.textContent, /refresh was superseded/i);
    view.showSnapshotState(artifact, 'cancelled');
    assert.match(snapshot.textContent, /refresh was cancelled/i);

    const settingsOnly = savedArtifact({ updatedAt: '2026-07-31T09:00:00.000Z', resultSummary: null });
    view.showSnapshot(settingsOnly);
    assert.match(snapshot.textContent, /saved settings have no cached comparison/i);
    assert.doesNotMatch(snapshot.textContent, /2026/i);
    view.showSnapshotState(settingsOnly, 'cancelled');
    assert.match(snapshot.textContent, /saved settings have no cached comparison/i);
    assert.match(snapshot.textContent, /refresh was cancelled/i);
    assert.doesNotMatch(snapshot.textContent, /Refreshing live data/i);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('held restore refresh is aborted by a newer Diary schedule and reaches a cancelled terminal state', async () => {
  let mode = 'crime';
  let refreshSignal = null;
  const crimeController = {
    setActive() {},
    requestRefresh({ signal } = {}) {
      refreshSignal = signal;
      return new Promise((resolve) => signal.addEventListener(
        'abort',
        () => resolve({ status: 'superseded' }),
        { once: true },
      ));
    },
    getCurrentProvenance() { return {}; },
  };
  const diaryModule = {
    async initDiaryMode() { return { status: 'ready' }; },
    teardownDiaryMode() {},
  };
  const coordinator = createModeCoordinator({
    map: { isStyleLoaded: () => true },
    diaryFeatureEnabled: true,
    getCurrentMode: () => mode,
    writeMode() {},
    loadCrimeController: async () => crimeController,
    loadDiaryModule: async () => diaryModule,
    getDiaryInsights: async () => ({ show() {}, hide() {}, setCollapsed() {} }),
    reportError() {},
  });
  const harness = createHarness({
    setViewMode: (nextMode) => { mode = nextMode; },
    scheduleCrime: () => coordinator.schedule('crime'),
    cancelCrimeTransition: () => coordinator.cancelCurrentTransition(),
  });

  const restoring = harness.controller.restore('analysis-1');
  while (!refreshSignal) await new Promise((resolve) => setImmediate(resolve));
  harness.controller.cancelPendingRestore();
  assert.equal(refreshSignal.aborted, true);
  mode = 'diary';
  const diary = coordinator.schedule('diary');

  assert.equal((await restoring).status, 'superseded');
  assert.equal((await diary).status, 'ready');
  assert.deepEqual(
    harness.calls.find(([kind, , status]) => kind === 'snapshot-state' && status === 'cancelled'),
    ['snapshot-state', savedArtifact(), 'cancelled'],
  );
});

test('newer explicit mode intent cancels an older restore before it can refresh', async () => {
  const readGate = deferred();
  const harness = createHarness();
  harness.repository.get = async () => readGate.promise;

  const restoring = harness.controller.restore('analysis-1');
  harness.controller.cancelPendingRestore();
  readGate.resolve(savedArtifact());

  assert.deepEqual(await restoring, { status: 'superseded' });
  assert.equal(harness.calls.some(([kind]) => kind === 'replace'), false);
  assert.equal(harness.calls.some(([kind]) => kind === 'schedule'), false);
});

test('tract snapshot provenance round-trips and changes mark saved analysis as needing refresh', async () => {
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
  const harness = createHarness({
    getCurrentCrimeProvenance: () => ({ tractSnapshot }),
  });
  harness.store.adminLevel = 'tracts';
  await harness.controller.save('Tract snapshot');
  const createInput = harness.calls.find(([kind]) => kind === 'create')[1];
  assert.deepEqual(createInput.provenance.tractSnapshot, tractSnapshot);

  harness.repository.list = async () => ({
    items: [savedArtifact({ provenance: createInput.provenance })],
    warnings: [],
  });
  await harness.controller.load();
  let model = harness.calls.filter(([kind]) => kind === 'render').at(-1)[1];
  assert.equal(model.items[0].dataStatus, 'current');

  tractSnapshot.geographyIdentity = 'fnv1a32:408:89abcdef';
  await harness.controller.load();
  model = harness.calls.filter(([kind]) => kind === 'render').at(-1)[1];
  assert.equal(model.items[0].dataStatus, 'provenance-mismatch');
});

test('freshness recomputes current to mismatch to current without rereading IndexedDB', async () => {
  const currentProvenance = {
    coverage: { min: '2006-01-01', max: '2026-07-30' },
    sources: ['crime-carto', 'police-districts-api-first', 'census-tracts-api-first', 'acs-api-first'],
  };
  let liveProvenance = {};
  let listCalls = 0;
  const harness = createHarness({ getCurrentCrimeProvenance: () => liveProvenance });
  harness.repository.list = async () => {
    listCalls += 1;
    return { items: [savedArtifact({ provenance: currentProvenance })], warnings: [] };
  };
  liveProvenance = {};
  await harness.controller.load();
  assert.equal(harness.calls.filter(([kind]) => kind === 'render').at(-1)[1].items[0].dataStatus, 'current');

  liveProvenance = { tractSnapshot: {
    schemaVersion: 2,
    start: '2025-08-01',
    end: '2026-08-01',
    generatedAt: '2026-07-31T03:30:49.163Z',
    coverageDate: '2026-07-30',
    rowCount: 408,
    sourceDataset: 'incidents_part1_part2',
    tractSource: 'public/data/tracts_phl.geojson',
    geographyIdentity: 'fnv1a32:408:01234567',
  } };
  harness.store.adminLevel = 'tracts';
  await harness.controller.refreshFreshness();
  assert.equal(harness.calls.filter(([kind]) => kind === 'render').at(-1)[1].items[0].dataStatus, 'provenance-mismatch');

  liveProvenance = {};
  await harness.controller.refreshFreshness();
  assert.equal(harness.calls.filter(([kind]) => kind === 'render').at(-1)[1].items[0].dataStatus, 'current');
  assert.equal(listCalls, 1);
});

test('list keeps valid artifacts visible while reporting corrupt storage warnings', async () => {
  const harness = createHarness();
  harness.repository.list = async () => ({
    items: [savedArtifact()],
    warnings: [{ id: 'broken', message: 'Unsupported schema version.' }],
  });

  await harness.controller.load();
  const model = harness.calls.find(([kind]) => kind === 'render')[1];
  assert.equal(model.items.length, 1);
  assert.equal(model.warnings.length, 1);
  assert.equal(model.items[0].id, 'analysis-1');
  assert.equal(model.items[0].dataStatus, 'provenance-mismatch');
});

test('list derives transient current and unknown source status without changing saved artifacts', async () => {
  const currentProvenance = {
    coverage: { min: '2006-01-01', max: '2026-07-30' },
    sources: ['crime-carto', 'police-districts-api-first', 'census-tracts-api-first', 'acs-api-first'],
  };
  const currentArtifact = savedArtifact({ provenance: currentProvenance });
  const current = createHarness();
  current.repository.list = async () => ({ items: [currentArtifact], warnings: [] });
  await current.controller.load();
  const currentModel = current.calls.find(([kind]) => kind === 'render')[1];
  assert.equal(currentModel.items[0].dataStatus, 'current');
  assert.equal('dataStatus' in currentArtifact, false);

  const unknown = createHarness();
  unknown.store.coverageStatus = 'idle';
  unknown.repository.list = async () => ({ items: [currentArtifact], warnings: [] });
  await unknown.controller.load();
  const unknownModel = unknown.calls.find(([kind]) => kind === 'render')[1];
  assert.equal(unknownModel.items[0].dataStatus, 'unknown');
});

test('panel stays storage-agnostic and main loads history only after Crime becomes active', async () => {
  const [panelSource, mainSource, viewSource] = await Promise.all([
    readFile(new URL('../../src/ui/panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/ui/analysis_history_panel.js', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(panelSource, /analysis_repository|analysis_history_controller|\bfrom ['"]idb['"]/);
  assert.match(panelSource, /analysisHistoryMount/);
  assert.match(panelSource, /setAnalysisHistorySync/);
  assert.match(mainSource, /import\(['"]\.\/analysis\/analysis_history_controller\.js['"]\)/);
  assert.match(mainSource, /getActiveMode\(\) === ['"]crime['"]/);
  assert.match(mainSource, /cancelPendingRestore\(\)/);
  assert.match(mainSource, /refreshFreshness\(/);
  assert.doesNotMatch(viewSource, /innerHTML\s*=/);
  assert.match(viewSource, /title\.textContent = artifact\.title/);
  assert.match(viewSource, /history\.needsRefresh/);
  assert.match(viewSource, /history\.sourceUnknown/);
  assert.match(viewSource, /Promise\.resolve\(action\(id\)\)\.catch\(reportActionError\)/);
});
