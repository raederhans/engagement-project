#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { loadJsonFromCandidates } from '../../src/routes_diary/demo_data_loader.js';
import { addNetworkLayer } from '../../src/map/network_layer.js';
import {
  createDiaryInsightsPort,
  createDiaryInsightsLoader,
} from '../../src/routes_diary/diary_insights_port.js';
import { finalizeDiarySubmission } from '../../src/routes_diary/form_submit.js';
import {
  createLatestSerialQueue,
  waitForOwnedPromise,
} from '../../src/utils/latest_serial_queue.js';
import { store } from '../../src/state/store.js';
import {
  fitCurrentDiarySelection,
  initDiaryMode,
  teardownDiaryMode,
} from '../../src/routes_diary/index.js';
import {
  highlightSegments,
  removeSegmentsLayer,
} from '../../src/map/segments_layer.js';
import {
  DIARY_ROUTE_PRIMARY_SOURCE_ID,
  DIARY_SEGMENTS_HIT_LAYER_ID,
} from '../../src/routes_diary/map_ids.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createCoordinatorHarness(initialMode) {
  let currentMode = initialMode;
  const events = [];
  const crimeController = {
    setActive(active) { events.push(['crime', active]); },
    requestRefresh() { events.push(['crime', 'refresh']); },
    updateBuffer() { events.push(['crime', 'buffer']); },
    setTractsOverlayVisible(visible) { events.push(['crime', 'tracts', visible]); },
  };
  const insights = {
    show() { events.push(['insights', 'show']); },
    hide() { events.push(['insights', 'hide']); },
    setCollapsed(collapsed) { events.push(['insights', 'collapsed', collapsed]); },
  };
  const chartsPane = { style: { display: '' } };
  const diaryMount = {
    replaceChildren() { events.push(['mount', 'clear']); },
  };
  const map = { isStyleLoaded: () => true };

  return {
    events,
    crimeController,
    insights,
    chartsPane,
    diaryMount,
    map,
    getCurrentMode: () => currentMode,
    setCurrentMode(mode) { currentMode = mode; },
  };
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
  }

  toggle(value, force) {
    const enabled = force === undefined ? !this.values.has(value) : Boolean(force);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }
}

class FakeElement extends EventTarget {
  constructor(tagName) {
    super();
    this.tagName = String(tagName || '').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this._innerHTML = '';
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  replaceChildren(...children) {
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
    children.forEach((child) => this.appendChild(child));
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this.replaceChildren();
    this._innerHTML = String(value);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
}

function createFakeDocument() {
  const document = new EventTarget();
  document.body = new FakeElement('body');
  document.hidden = false;
  document.createElement = (tagName) => new FakeElement(tagName);
  document.createTextNode = (text) => {
    const node = new FakeElement('#text');
    node.textContent = String(text);
    return node;
  };
  document.getElementById = (id) => findElement(document.body, (element) => element.id === id);
  return document;
}

function findElement(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function findElements(root, predicate, matches = []) {
  if (predicate(root)) matches.push(root);
  for (const child of root.children || []) {
    findElements(child, predicate, matches);
  }
  return matches;
}

function createDiaryMapFake() {
  const sources = new Map();
  const layers = new Map();
  const handlers = [];
  const mutations = [];
  return {
    handlers,
    mutations,
    getContainer: () => ({ classList: new FakeClassList() }),
    getSource: (id) => sources.get(id) || null,
    getLayer: (id) => layers.get(id) || null,
    addSource(id, specification) {
      const source = {
        ...specification,
        setData(data) {
          this.data = data;
          mutations.push(['set-data', id]);
        },
      };
      sources.set(id, source);
      mutations.push(['add-source', id]);
    },
    addLayer(layer) {
      layers.set(layer.id, layer);
      mutations.push(['add-layer', layer.id]);
    },
    removeSource(id) {
      sources.delete(id);
      mutations.push(['remove-source', id]);
    },
    removeLayer(id) {
      layers.delete(id);
      mutations.push(['remove-layer', id]);
    },
    setPaintProperty() {},
    on(...args) { handlers.push(args); },
    off(...args) {
      const index = handlers.findIndex((entry) => entry.length === args.length
        && entry.every((value, entryIndex) => value === args[entryIndex]));
      if (index >= 0) handlers.splice(index, 1);
    },
    fitBounds(bounds, options) {
      mutations.push(['fit-bounds', structuredClone(bounds), structuredClone(options)]);
    },
    getCanvas: () => ({ style: {} }),
    queryRenderedFeatures: () => [],
    getZoom: () => 12,
    easeTo() {},
  };
}

test('demo data loader falls back in order after an ordinary request failure', async () => {
  const calls = [];
  const payload = { type: 'FeatureCollection', features: [] };
  const result = await loadJsonFromCandidates('segments', ['first', 'second'], {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === 'first') throw new Error('offline');
      return { ok: true, json: async () => payload };
    },
  });

  assert.equal(result, payload);
  assert.deepEqual(calls.map(({ url }) => url), ['first', 'second']);
  assert.equal(calls[0].options.cache, 'no-cache');
});

test('demo data loader preserves caller cancellation and never tries a fallback', async () => {
  const controller = new AbortController();
  const reason = new DOMException('cancelled', 'AbortError');
  const calls = [];
  controller.abort(reason);

  await assert.rejects(
    loadJsonFromCandidates('routes', ['first', 'second'], {
      signal: controller.signal,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        throw options.signal.reason;
      },
    }),
    (error) => error === reason,
  );
  assert.deepEqual(calls, []);
});

test('an AbortError from fetch is rethrown without requesting another candidate', async () => {
  const reason = new DOMException('fetch cancelled', 'AbortError');
  const calls = [];

  await assert.rejects(
    loadJsonFromCandidates('routes', ['first', 'second'], {
      fetchImpl: async (url) => {
        calls.push(url);
        throw reason;
      },
    }),
    (error) => error === reason,
  );
  assert.deepEqual(calls, ['first']);
});

test('caller cancellation during JSON parsing wins over the parsed payload', async () => {
  const controller = new AbortController();
  const reason = new Error('cancel during parse');
  let resolveJson;
  const request = loadJsonFromCandidates('segments', ['only'], {
    signal: controller.signal,
    fetchImpl: async () => ({
      ok: true,
      json: () => new Promise((resolve) => { resolveJson = resolve; }),
    }),
  });
  await Promise.resolve();
  controller.abort(reason);
  resolveJson({ stale: true });

  await assert.rejects(request, (error) => error === reason);
});

test('a stale network response performs zero map mutations', async () => {
  const controller = new AbortController();
  let active = true;
  let resolveNetwork;
  let receivedSignal;
  const mutations = [];
  const map = {
    getSource: () => null,
    getLayer: () => null,
    addSource: (...args) => mutations.push(['source', ...args]),
    addLayer: (...args) => mutations.push(['layer', ...args]),
  };
  const pending = addNetworkLayer(map, {
    enabled: true,
    signal: controller.signal,
    shouldApply: () => active,
    loadNetworkGeojsonImpl: ({ signal }) => {
      receivedSignal = signal;
      return new Promise((resolve) => { resolveNetwork = resolve; });
    },
  });

  active = false;
  resolveNetwork({ type: 'FeatureCollection', features: [] });
  const result = await pending;

  assert.equal(receivedSignal, controller.signal);
  assert.deepEqual(result, { applied: false, reason: 'stale' });
  assert.deepEqual(mutations, []);
});

test('Diary insights callbacks use the injected host without a window bridge', () => {
  const calls = [];
  const port = createDiaryInsightsPort({
    setViewContext: (mode) => calls.push(['view', mode]),
    refresh: () => calls.push(['refresh']),
  });

  port.setViewContext('history');
  port.refresh();
  assert.deepEqual(calls, [['view', 'history'], ['refresh']]);
});

test('an aborted modal submission cannot close or finalize its captured state', () => {
  const controller = new AbortController();
  const calls = [];
  const state = {
    signal: controller.signal,
    onSuccess: () => calls.push('success'),
  };
  controller.abort();

  const finalized = finalizeDiarySubmission({
    state,
    payload: {},
    response: {},
    close: () => calls.push('close'),
  });

  assert.equal(finalized, false);
  assert.deepEqual(calls, []);
});

test('a superseded modal state cannot close or finalize the newer modal', () => {
  const calls = [];
  const finalized = finalizeDiarySubmission({
    state: { onSuccess: () => calls.push('success') },
    payload: {},
    response: {},
    close: () => calls.push('close'),
    isCurrent: () => false,
  });

  assert.equal(finalized, false);
  assert.deepEqual(calls, []);
});

test('a Crime intent invalidates Diary seed loading before initialization can commit', async () => {
  const { loadOwnedDiaryData } = await import('../../src/routes_diary/demo_data_loader.js');
  assert.equal(typeof loadOwnedDiaryData, 'function');
  let signal;
  let resolveSegments;
  let resolveRoutes;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const commits = [];
  const schedule = createLatestSerialQueue(async (mode, { isLatest }) => {
    if (mode !== 'diary') return;
    const controller = new AbortController();
    signal = controller.signal;
    const result = await loadOwnedDiaryData({
      signal,
      isCurrent: isLatest,
      loadSegments: ({ signal: receivedSignal }) => {
        assert.equal(receivedSignal, signal);
        markStarted();
        return new Promise((resolve) => { resolveSegments = resolve; });
      },
      loadRoutes: ({ signal: receivedSignal }) => {
        assert.equal(receivedSignal, signal);
        return new Promise((resolve) => { resolveRoutes = resolve; });
      },
    });
    if (result.applied) commits.push(result);
  });

  const diary = schedule('diary');
  await started;
  const crime = schedule('crime');
  resolveSegments({ type: 'FeatureCollection', features: [] });
  resolveRoutes({ type: 'FeatureCollection', features: [] });
  await Promise.all([diary, crime]);

  assert.deepEqual(commits, []);
});

test('scheduling a newer transition immediately aborts the running transition signal', async () => {
  let firstSignal;
  let markStarted;
  let releaseFirst;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const order = [];
  const schedule = createLatestSerialQueue(async (mode, { signal }) => {
    order.push(`start:${mode}`);
    if (mode === 'diary') {
      firstSignal = signal;
      markStarted();
      await firstGate;
    }
    order.push(`finish:${mode}`);
  });

  const diary = schedule('diary');
  await started;
  const crime = schedule('crime');

  assert.equal(firstSignal.aborted, true);
  assert.deepEqual(order, ['start:diary']);
  releaseFirst();
  await Promise.all([diary, crime]);
  assert.deepEqual(order, ['start:diary', 'finish:diary', 'start:crime', 'finish:crime']);
});

test('cancelling the latest serial queue immediately aborts and invalidates its running owner', async () => {
  const gate = deferred();
  let signal;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const commits = [];
  const schedule = createLatestSerialQueue(async (_value, owner) => {
    signal = owner.signal;
    markStarted();
    await gate.promise;
    if (owner.isLatest()) commits.push('stale');
    return { status: owner.signal.aborted ? 'superseded' : 'live' };
  });

  const running = schedule('crime');
  await started;

  assert.equal(schedule.cancel(), true);
  assert.equal(signal.aborted, true);
  gate.resolve();
  assert.deepEqual(await running, { status: 'superseded' });
  assert.deepEqual(commits, []);
  assert.equal(schedule.cancel(), false);
});

test('an owner-aware wait releases the serial queue before its underlying promise settles', async () => {
  let firstSignal;
  let resolveUnderlying;
  let markFirstStarted;
  let markSecondCompleted;
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const secondCompleted = new Promise((resolve) => { markSecondCompleted = resolve; });
  const underlying = new Promise((resolve) => {
    resolveUnderlying = resolve;
  });
  const commits = [];
  const schedule = createLatestSerialQueue(async (mode, { signal, isLatest }) => {
    if (mode === 'diary') {
      firstSignal = signal;
      markFirstStarted();
      try {
        await waitForOwnedPromise(underlying, signal);
      } catch (error) {
        if (!signal.aborted) throw error;
      }
      if (isLatest()) commits.push('diary');
      return;
    }
    commits.push('crime');
    markSecondCompleted();
  });

  const diary = schedule('diary');
  await firstStarted;
  const crime = schedule('crime');
  await secondCompleted;

  assert.equal(firstSignal.aborted, true);
  assert.deepEqual(commits, ['crime']);
  await Promise.all([diary, crime]);

  resolveUnderlying('late success');
  await Promise.resolve();
  assert.deepEqual(commits, ['crime']);
});

test('an aborted owner-aware wait observes a late underlying rejection', async () => {
  let rejectUnderlying;
  const underlying = new Promise((_resolve, reject) => { rejectUnderlying = reject; });
  const owner = new AbortController();
  const wait = waitForOwnedPromise(underlying, owner.signal);
  owner.abort(new DOMException('superseded', 'AbortError'));

  await assert.rejects(wait, (error) => error === owner.signal.reason);
  rejectUnderlying(new Error('late import failure'));
  await new Promise((resolve) => setImmediate(resolve));
});

test('aborted Insights loading caches only the module and a later owner creates one host', async () => {
  let resolveModule;
  const modulePromise = new Promise((resolve) => { resolveModule = resolve; });
  const events = [];
  const loader = createDiaryInsightsLoader({
    loadModule: () => modulePromise,
    createRoot: () => {
      events.push('append');
      return { id: 'root' };
    },
    createHost: (module, root) => {
      events.push(['create', module.id, root.id]);
      return {
        show() { events.push('show'); },
      };
    },
  });
  const staleOwner = new AbortController();
  const stale = loader.getHost({
    signal: staleOwner.signal,
    isCurrent: () => !staleOwner.signal.aborted,
  });
  staleOwner.abort(new DOMException('mode changed', 'AbortError'));
  resolveModule({ id: 'insights-module' });

  assert.equal(await stale, null);
  assert.deepEqual(events, []);

  const host = await loader.getHost({ isCurrent: () => true });
  host.show();
  const sameHost = await loader.getHost({ isCurrent: () => true });
  assert.equal(sameHost, host);
  assert.deepEqual(events, [
    'append',
    ['create', 'insights-module', 'root'],
    'show',
  ]);
});

test('owner abort disposes an actual pending Diary initialization and prevents stale commits', async () => {
  const originalDiaryFeatureOn = store.diaryFeatureOn;
  store.diaryFeatureOn = true;
  const owner = new AbortController();
  let transportSignal;
  let markNetworkStarted;
  const networkStarted = new Promise((resolve) => { markNetworkStarted = resolve; });
  const skinStates = [];
  const mutations = [];
  const container = {
    classList: {
      toggle(name, enabled) { skinStates.push([name, enabled]); },
    },
  };
  const map = {
    getContainer: () => container,
    getLayer: () => null,
    getSource: () => null,
    removeLayer: (id) => mutations.push(['remove-layer', id]),
    removeSource: (id) => mutations.push(['remove-source', id]),
    on: (...args) => mutations.push(['on', ...args.slice(0, 2)]),
    off: (...args) => mutations.push(['off', ...args.slice(0, 2)]),
  };
  const mount = {
    innerHTML: 'pending diary',
    setAttribute(name, value) { mutations.push(['mount-attribute', name, value]); },
  };
  let segmentLoads = 0;
  let routeLoads = 0;

  try {
    const initialization = initDiaryMode(map, {
      mountInto: mount,
      signal: owner.signal,
      isCurrent: () => !owner.signal.aborted,
      addNetworkLayerImpl: (_map, { signal }) => {
        transportSignal = signal;
        markNetworkStarted();
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      loadDemoSegmentsImpl: async () => { segmentLoads += 1; return { type: 'FeatureCollection', features: [] }; },
      loadDemoRoutesImpl: async () => { routeLoads += 1; return { type: 'FeatureCollection', features: [] }; },
    });
    await networkStarted;
    owner.abort(new DOMException('superseded', 'AbortError'));
    const stats = await initialization;

    assert.equal(transportSignal.aborted, true);
    assert.deepEqual(stats, { status: 'cancelled', segmentsCount: 0, routesCount: 0 });
    assert.equal(segmentLoads, 0);
    assert.equal(routeLoads, 0);
    assert.deepEqual(skinStates, []);
    assert.equal(mount.innerHTML, 'pending diary');
    assert.equal(mutations.some(([kind]) => kind === 'on'), false);
  } finally {
    store.diaryFeatureOn = originalDiaryFeatureOn;
  }
});

test('an already-aborted Diary owner applies no map or mount state', async () => {
  const originalDiaryFeatureOn = store.diaryFeatureOn;
  store.diaryFeatureOn = true;
  const owner = new AbortController();
  owner.abort(new DOMException('already stale', 'AbortError'));
  const mutations = [];
  const map = {
    getContainer: () => ({ classList: { toggle: (...args) => mutations.push(['skin', ...args]) } }),
  };
  const mount = {
    setAttribute: (...args) => mutations.push(['mount', ...args]),
  };

  try {
    const stats = await initDiaryMode(map, {
      mountInto: mount,
      signal: owner.signal,
      isCurrent: () => false,
      addNetworkLayerImpl: () => { throw new Error('network must not start'); },
    });
    assert.deepEqual(stats, { status: 'cancelled', segmentsCount: 0, routesCount: 0 });
    assert.deepEqual(mutations, []);
  } finally {
    store.diaryFeatureOn = originalDiaryFeatureOn;
  }
});

test('the mode coordinator makes Crime to Diary to Crime latest-only', async () => {
  const { createModeCoordinator } = await import('../../src/mode_coordinator.js');
  const harness = createCoordinatorHarness('crime');
  const diaryGate = deferred();
  const staleCommits = [];
  const diaryModule = {
    async initDiaryMode(_map, { signal, isCurrent }) {
      harness.events.push(['diary', 'init', signal]);
      await diaryGate.promise;
      if (isCurrent()) staleCommits.push('diary');
      return { status: 'ready' };
    },
    teardownDiaryMode() { harness.events.push(['diary', 'teardown']); },
  };
  const coordinator = createModeCoordinator({
    map: harness.map,
    diaryFeatureEnabled: true,
    getCurrentMode: harness.getCurrentMode,
    writeMode: (mode) => harness.events.push(['mode', mode]),
    chartsPane: harness.chartsPane,
    diaryMount: harness.diaryMount,
    loadCrimeController: async () => harness.crimeController,
    loadDiaryModule: async () => diaryModule,
    getDiaryInsights: async () => harness.insights,
  });

  await coordinator.schedule('crime');
  harness.setCurrentMode('diary');
  const diary = coordinator.schedule('diary');
  await new Promise((resolve) => setImmediate(resolve));
  harness.setCurrentMode('crime');
  const crime = coordinator.schedule('crime');
  await crime;

  assert.equal(coordinator.getActiveMode(), 'crime');
  assert.equal(harness.chartsPane.style.display, '');
  assert.deepEqual(staleCommits, []);
  assert.ok(harness.events.some(([owner, action]) => owner === 'crime' && action === false));
  assert.ok(harness.events.some(([owner, action]) => owner === 'diary' && action === 'teardown'));

  diaryGate.resolve();
  await diary;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(staleCommits, []);
});

test('the mode coordinator makes Diary to Crime to Diary latest-only', async () => {
  const { createModeCoordinator } = await import('../../src/mode_coordinator.js');
  const harness = createCoordinatorHarness('diary');
  const crimeGate = deferred();
  const diaryCommits = [];
  let diaryGeneration = 0;
  const diaryModule = {
    async initDiaryMode(_map, { isCurrent }) {
      const generation = ++diaryGeneration;
      harness.events.push(['diary', 'init', generation]);
      if (isCurrent()) diaryCommits.push(generation);
      return { status: 'ready' };
    },
    teardownDiaryMode() { harness.events.push(['diary', 'teardown']); },
  };
  const coordinator = createModeCoordinator({
    map: harness.map,
    diaryFeatureEnabled: true,
    getCurrentMode: harness.getCurrentMode,
    writeMode: (mode) => harness.events.push(['mode', mode]),
    chartsPane: harness.chartsPane,
    diaryMount: harness.diaryMount,
    loadCrimeController: () => crimeGate.promise,
    loadDiaryModule: async () => diaryModule,
    getDiaryInsights: async () => harness.insights,
  });

  await coordinator.schedule('diary');
  harness.setCurrentMode('crime');
  const crime = coordinator.schedule('crime');
  await new Promise((resolve) => setImmediate(resolve));
  harness.setCurrentMode('diary');
  const diary = coordinator.schedule('diary');
  await diary;

  assert.equal(coordinator.getActiveMode(), 'diary');
  assert.equal(harness.chartsPane.style.display, 'none');
  assert.deepEqual(diaryCommits, [1, 2]);
  assert.ok(harness.events.some(([owner, action]) => owner === 'diary' && action === 'teardown'));

  crimeGate.resolve(harness.crimeController);
  await crime;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(coordinator.getActiveMode(), 'diary');
  assert.equal(harness.events.some(([owner, action]) => owner === 'crime' && action === true), false);
  assert.ok(harness.events.some(([owner, action]) => owner === 'crime' && action === false));
});

test('the mode coordinator retries Crime initialization after a rejected first load', async () => {
  const { createModeCoordinator } = await import('../../src/mode_coordinator.js');
  const harness = createCoordinatorHarness('crime');
  const errors = [];
  let attempts = 0;
  const coordinator = createModeCoordinator({
    map: harness.map,
    diaryFeatureEnabled: true,
    getCurrentMode: harness.getCurrentMode,
    writeMode: () => {},
    chartsPane: harness.chartsPane,
    diaryMount: harness.diaryMount,
    loadCrimeController: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary Crime load failure');
      return harness.crimeController;
    },
    loadDiaryModule: async () => ({ initDiaryMode: async () => ({ status: 'ready' }), teardownDiaryMode() {} }),
    getDiaryInsights: async () => harness.insights,
    reportError: (label, error) => errors.push([label, error.message]),
  });
  await coordinator.schedule('crime');
  assert.equal(coordinator.getActiveMode(), null);
  await coordinator.schedule('crime');
  assert.equal(attempts, 2);
  assert.equal(coordinator.getActiveMode(), 'crime');
  assert.match(errors[0][1], /temporary Crime load failure/);
});

test('Diary data failure does not leave the coordinator in an active Diary mode', async () => {
  const { createModeCoordinator } = await import('../../src/mode_coordinator.js');
  const harness = createCoordinatorHarness('diary');
  const coordinator = createModeCoordinator({
    map: harness.map,
    diaryFeatureEnabled: true,
    getCurrentMode: harness.getCurrentMode,
    writeMode: () => {},
    chartsPane: harness.chartsPane,
    diaryMount: harness.diaryMount,
    loadCrimeController: async () => harness.crimeController,
    loadDiaryModule: async () => ({
      initDiaryMode: async () => ({ status: 'failed' }),
      teardownDiaryMode() {},
    }),
    getDiaryInsights: async () => harness.insights,
  });
  await coordinator.schedule('diary');
  assert.equal(coordinator.getActiveMode(), null);
  assert.match(harness.diaryMount.textContent, /unavailable/i);
});

test('Diary seed cancellation shares one owner signal and commits no map or DOM state', async () => {
  const originalDiaryFeatureOn = store.diaryFeatureOn;
  store.diaryFeatureOn = true;
  const owner = new AbortController();
  const segmentsGate = deferred();
  const routesGate = deferred();
  const signals = [];
  const commits = [];
  const map = {
    getContainer: () => ({
      classList: { toggle: (...args) => commits.push(['skin', ...args]) },
    }),
    getLayer: () => null,
    getSource: () => null,
    addLayer: (...args) => commits.push(['add-layer', ...args]),
    addSource: (...args) => commits.push(['add-source', ...args]),
    on: (...args) => commits.push(['on', ...args.slice(0, 2)]),
    off: (...args) => commits.push(['off', ...args.slice(0, 2)]),
  };
  const mount = {
    setAttribute: (...args) => commits.push(['mount-attribute', ...args]),
    removeAttribute: (...args) => commits.push(['mount-remove', ...args]),
    replaceChildren: () => commits.push(['mount-clear']),
  };

  try {
    const initialization = initDiaryMode(map, {
      mountInto: mount,
      signal: owner.signal,
      isCurrent: () => !owner.signal.aborted,
      addNetworkLayerImpl: async (_map, { signal }) => {
        signals.push(signal);
        return { applied: false, reason: 'disabled' };
      },
      loadDemoSegmentsImpl: ({ signal }) => {
        signals.push(signal);
        return segmentsGate.promise;
      },
      loadDemoRoutesImpl: ({ signal }) => {
        signals.push(signal);
        return routesGate.promise;
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    owner.abort(new DOMException('superseded during seed loading', 'AbortError'));
    segmentsGate.resolve({ type: 'FeatureCollection', features: [] });
    routesGate.resolve({ type: 'FeatureCollection', features: [] });

    assert.deepEqual(await initialization, { status: 'cancelled', segmentsCount: 0, routesCount: 0 });
    assert.equal(signals.length, 3);
    assert.ok(signals.every((signal) => signal === signals[0]));
    assert.equal(signals[0].aborted, true);
    assert.deepEqual(commits, []);
  } finally {
    store.diaryFeatureOn = originalDiaryFeatureOn;
  }
});

test('a seed-pending Diary owner removes only its mounted network resources on abort', async () => {
  const originalDiaryFeatureOn = store.diaryFeatureOn;
  store.diaryFeatureOn = true;
  const owner = new AbortController();
  const segmentsGate = deferred();
  const routesGate = deferred();
  const sources = new Map();
  const layers = new Map();
  const mutations = [];
  const map = {
    getContainer: () => ({ classList: { toggle: (...args) => mutations.push(['skin', ...args]) } }),
    getSource: (id) => sources.get(id) || null,
    getLayer: (id) => layers.get(id) || null,
    addSource(id, value) { sources.set(id, value); mutations.push(['add-source', id]); },
    addLayer(value) { layers.set(value.id, value); mutations.push(['add-layer', value.id]); },
    removeSource(id) { sources.delete(id); mutations.push(['remove-source', id]); },
    removeLayer(id) { layers.delete(id); mutations.push(['remove-layer', id]); },
    on: (...args) => mutations.push(['on', ...args.slice(0, 2)]),
    off: (...args) => mutations.push(['off', ...args.slice(0, 2)]),
  };
  const mount = {
    setAttribute: (...args) => mutations.push(['mount-attribute', ...args]),
    removeAttribute: (...args) => mutations.push(['mount-remove', ...args]),
    replaceChildren: () => mutations.push(['mount-clear']),
  };
  const oldSource = { owner: 'old-source' };
  const oldLayer = { id: 'diary-network-line', owner: 'old-layer' };

  try {
    const initialization = initDiaryMode(map, {
      mountInto: mount,
      signal: owner.signal,
      isCurrent: () => !owner.signal.aborted,
      addNetworkLayerImpl: async () => {
        map.addSource('diary-network', oldSource);
        map.addLayer(oldLayer);
        return { applied: true };
      },
      loadDemoSegmentsImpl: () => segmentsGate.promise,
      loadDemoRoutesImpl: () => routesGate.promise,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(map.getSource('diary-network'), oldSource);
    assert.equal(map.getLayer('diary-network-line'), oldLayer);

    owner.abort(new DOMException('superseded while seeds are pending', 'AbortError'));
    assert.equal(map.getSource('diary-network'), null);
    assert.equal(map.getLayer('diary-network-line'), null);

    const newSource = { owner: 'new-source' };
    const newLayer = { id: 'diary-network-line', owner: 'new-layer' };
    sources.set('diary-network', newSource);
    layers.set('diary-network-line', newLayer);
    const mutationsBeforeLateSeeds = mutations.length;
    segmentsGate.resolve({ type: 'FeatureCollection', features: [] });
    routesGate.resolve({ type: 'FeatureCollection', features: [] });

    assert.deepEqual(await initialization, { status: 'cancelled', segmentsCount: 0, routesCount: 0 });
    assert.equal(map.getSource('diary-network'), newSource);
    assert.equal(map.getLayer('diary-network-line'), newLayer);
    assert.equal(mutations.length, mutationsBeforeLateSeeds);
    assert.equal(mutations.some(([kind]) => kind.startsWith('mount') || kind === 'skin' || kind === 'on'), false);
  } finally {
    store.diaryFeatureOn = originalDiaryFeatureOn;
  }
});

test('Diary mode suppresses stale Crime radius and tract overlay callbacks', async () => {
  const { createModeCoordinator } = await import('../../src/mode_coordinator.js');
  const harness = createCoordinatorHarness('crime');
  const diaryModule = {
    async initDiaryMode() { return { status: 'ready' }; },
    teardownDiaryMode() {},
  };
  const coordinator = createModeCoordinator({
    map: harness.map,
    diaryFeatureEnabled: true,
    getCurrentMode: harness.getCurrentMode,
    writeMode: () => {},
    chartsPane: harness.chartsPane,
    diaryMount: harness.diaryMount,
    loadCrimeController: async () => harness.crimeController,
    loadDiaryModule: async () => diaryModule,
    getDiaryInsights: async () => harness.insights,
  });

  await coordinator.schedule('crime');
  harness.setCurrentMode('diary');
  await coordinator.schedule('diary');
  harness.events.length = 0;
  coordinator.updateCrimeBuffer();
  coordinator.setTractsOverlayVisible(true);
  await Promise.resolve();
  assert.deepEqual(harness.events, []);

  harness.setCurrentMode('crime');
  await coordinator.schedule('crime');
  harness.events.length = 0;
  coordinator.updateCrimeBuffer();
  coordinator.setTractsOverlayVisible(false);
  assert.deepEqual(harness.events, [
    ['crime', 'buffer'],
    ['crime', 'tracts', false],
  ]);
});

test('detached Diary controls cannot act on a newer session while new controls still work', async (t) => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalDiaryFeatureOn = store.diaryFeatureOn;
  const originalDiaryViewMode = store.diaryViewMode;
  const originalSelectedRouteId = store.selectedRouteId;
  const originalSimState = structuredClone(store.simState);
  const fakeDocument = createFakeDocument();
  const storage = new Map();
  const fakeWindow = new EventTarget();
  fakeWindow.sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  };
  const timerEvents = [];
  let nextTimerId = 0;
  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;
  globalThis.setInterval = () => {
    const id = `interval-${++nextTimerId}`;
    timerEvents.push(['set', id]);
    return id;
  };
  globalThis.clearInterval = (id) => timerEvents.push(['clear', id]);
  store.diaryFeatureOn = true;
  store.diaryViewMode = 'live';
  store.selectedRouteId = null;
  store.simState = { playing: false, progress: 0, routeId: null };
  const segments = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { segment_id: 'seg-1', street_name: 'Test Street', decayed_mean: 3, n_eff: 1 },
      geometry: { type: 'LineString', coordinates: [[-75.17, 39.95], [-75.16, 39.96]] },
    }],
  };
  const routes = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        route_id: 'route-1',
        name: 'Test route',
        from: 'A',
        to: 'B',
        segment_ids: ['seg-1'],
        mode: 'walk',
      },
      geometry: { type: 'LineString', coordinates: [[-75.17, 39.95], [-75.16, 39.96]] },
    }],
  };
  const map = createDiaryMapFake();
  const initialize = (mount) => initDiaryMode(map, {
    mountInto: mount,
    isCurrent: () => true,
    addNetworkLayerImpl: async () => ({ applied: false, reason: 'disabled' }),
    loadDemoSegmentsImpl: async () => structuredClone(segments),
    loadDemoRoutesImpl: async () => structuredClone(routes),
  });
  const findControl = (mount, label) => findElement(
    mount,
    (element) => element.tagName === 'BUTTON' && element.textContent === label,
  );

  t.after(() => {
    teardownDiaryMode(map);
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    store.diaryFeatureOn = originalDiaryFeatureOn;
    store.diaryViewMode = originalDiaryViewMode;
    store.selectedRouteId = originalSelectedRouteId;
    store.simState = originalSimState;
  });

  const firstMount = new FakeElement('div');
  await initialize(firstMount);
  const oldPlay = findControl(firstMount, 'Play');
  const oldPause = findControl(firstMount, 'Pause');
  const oldFinish = findControl(firstMount, 'Finish → Rate');
  assert.ok(oldPlay && oldPause && oldFinish);
  teardownDiaryMode(map);

  const secondMount = new FakeElement('div');
  await initialize(secondMount);
  const newPlay = findControl(secondMount, 'Play');
  const newPause = findControl(secondMount, 'Pause');
  const newFinish = findControl(secondMount, 'Finish → Rate');
  assert.ok(newPlay && newPause && newFinish);
  assert.notEqual(newPlay, oldPlay);

  newPlay.dispatchEvent(new Event('click'));
  assert.equal(store.simState.playing, true);
  assert.equal(timerEvents.filter(([kind]) => kind === 'set').length, 1);
  const stateBeforeOldControls = structuredClone(store.simState);
  const mutationsBeforeOldControls = map.mutations.length;
  const timerEventsBeforeOldControls = timerEvents.length;
  const newControlState = [newPlay.disabled, newPause.disabled, newFinish.disabled];

  oldPlay.dispatchEvent(new Event('click'));
  oldPause.dispatchEvent(new Event('click'));
  oldFinish.dispatchEvent(new Event('click'));

  assert.deepEqual(store.simState, stateBeforeOldControls);
  assert.equal(map.mutations.length, mutationsBeforeOldControls);
  assert.equal(timerEvents.length, timerEventsBeforeOldControls);
  assert.deepEqual(
    [newPlay.disabled, newPause.disabled, newFinish.disabled],
    newControlState,
  );

  newPause.dispatchEvent(new Event('click'));
  assert.equal(store.simState.playing, false);
  assert.equal(timerEvents.filter(([kind]) => kind === 'clear').length, 1);
});

test('Live route keeps rating primary and places Simulator in a closed disclosure', async (t) => {
  const originalDocument = globalThis.document;
  const fakeDocument = createFakeDocument();
  globalThis.document = fakeDocument;
  t.after(() => { globalThis.document = originalDocument; });
  const { renderLiveRoutePanel } = await import('../../src/routes_diary/ui_live_panel.js');
  const mount = new FakeElement('div');

  renderLiveRoutePanel(mount, {
    routes: { type: 'FeatureCollection', features: [] },
    canRate: true,
  });

  const disclosures = findElements(mount, (element) => element.tagName === 'DETAILS');
  assert.equal(disclosures.length, 1);
  assert.equal(Boolean(disclosures[0].open), false);
  assert.ok(findElement(disclosures[0], (element) => (
    element.tagName === 'SUMMARY' && element.textContent === 'Preview route'
  )));
  const primaryActions = findElements(mount, (element) => (
    element.tagName === 'BUTTON' && element.className === 'diary-btn-primary'
  ));
  assert.deepEqual(primaryActions.map((button) => button.textContent), ['Rate this route']);
});

test('initial Diary route receives one panel-aware camera fit', async (t) => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalDiaryFeatureOn = store.diaryFeatureOn;
  const originalSelectedRouteId = store.selectedRouteId;
  const fakeDocument = createFakeDocument();
  const fakeWindow = new EventTarget();
  fakeWindow.sessionStorage = { getItem: () => null, setItem() {} };
  fakeWindow.matchMedia = () => ({ matches: false });
  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;
  store.diaryFeatureOn = true;
  store.selectedRouteId = null;
  const map = createDiaryMapFake();
  const segments = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { segment_id: 'seg-1', street_name: 'Test Street', decayed_mean: 3, n_eff: 1 },
      geometry: { type: 'LineString', coordinates: [[-75.17, 39.95], [-75.16, 39.96]] },
    }],
  };
  const routes = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        route_id: 'route-1',
        name: 'Test route',
        from: 'A',
        to: 'B',
        segment_ids: ['seg-1'],
        mode: 'walk',
      },
      geometry: { type: 'LineString', coordinates: [[-75.17, 39.95], [-75.16, 39.96]] },
    }],
  };
  t.after(() => {
    teardownDiaryMode(map);
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    store.diaryFeatureOn = originalDiaryFeatureOn;
    store.selectedRouteId = originalSelectedRouteId;
  });

  await initDiaryMode(map, {
    mountInto: new FakeElement('div'),
    isCurrent: () => true,
    addNetworkLayerImpl: async () => ({ applied: false, reason: 'disabled' }),
    loadDemoSegmentsImpl: async () => structuredClone(segments),
    loadDemoRoutesImpl: async () => structuredClone(routes),
    localRepository: { async list() { return []; }, async save() {} },
  });

  const fits = map.mutations.filter(([kind]) => kind === 'fit-bounds');
  assert.equal(fits.length, 1);
  assert.deepEqual(fits[0][1], [[-75.17, 39.95], [-75.16, 39.96]]);
  assert.deepEqual(fits[0][2].padding, { top: 24, right: 24, bottom: 24, left: 24 });
});

test('detached non-Live Diary controls cannot mutate a newer session', async (t) => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalDiaryFeatureOn = store.diaryFeatureOn;
  const originalDiaryViewMode = store.diaryViewMode;
  const originalHistoryRouteId = store.diarySelectedHistoryRouteId;
  const originalCommunityRadius = store.diaryCommunityRadiusMeters;
  const fakeDocument = createFakeDocument();
  const storage = new Map();
  const fakeWindow = new EventTarget();
  fakeWindow.sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  };
  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;
  store.diaryFeatureOn = true;
  store.diaryViewMode = 'live';
  store.diarySelectedHistoryRouteId = null;
  store.diaryCommunityRadiusMeters = 1500;

  const segments = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { segment_id: 'seg-1', street_name: 'Test Street', decayed_mean: 3, n_eff: 1 },
      geometry: { type: 'LineString', coordinates: [[-75.17, 39.95], [-75.16, 39.96]] },
    }],
  };
  const routes = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { route_id: 'route-1', name: 'Test route', segment_ids: ['seg-1'], mode: 'walk' },
      geometry: { type: 'LineString', coordinates: [[-75.17, 39.95], [-75.16, 39.96]] },
    }],
  };
  const map = createDiaryMapFake();
  const localEntries = [{
    id: 'local-1',
    createdAt: new Date().toISOString(),
    routeId: 'route-1',
    label: 'Test route',
    mode: 'walk',
    score: 4,
    tags: [],
    segmentIds: ['seg-1'],
    payload: {},
  }];
  const initialize = (mount, insights) => initDiaryMode(map, {
    mountInto: mount,
    insights,
    isCurrent: () => true,
    addNetworkLayerImpl: async () => ({ applied: false, reason: 'disabled' }),
    loadDemoSegmentsImpl: async () => structuredClone(segments),
    loadDemoRoutesImpl: async () => structuredClone(routes),
    localRepository: {
      async list() { return structuredClone(localEntries); },
      async save() {},
    },
  });
  const button = (mount, label) => findElement(
    mount,
    (element) => element.tagName === 'BUTTON' && element.textContent === label,
  );

  t.after(() => {
    teardownDiaryMode(map);
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    store.diaryFeatureOn = originalDiaryFeatureOn;
    store.diaryViewMode = originalDiaryViewMode;
    store.diarySelectedHistoryRouteId = originalHistoryRouteId;
    store.diaryCommunityRadiusMeters = originalCommunityRadius;
  });

  const firstInsights = [];
  const firstMount = new FakeElement('div');
  await initialize(firstMount, {
    setViewContext: (mode) => firstInsights.push(['view', mode]),
    refresh: () => firstInsights.push(['refresh']),
  });
  const oldHistoryPill = button(firstMount, 'My routes');
  const oldCommunityPill = button(firstMount, 'Sample community');
  oldHistoryPill.dispatchEvent(new Event('click'));
  const oldHistorySelects = findElements(firstMount, (element) => element.tagName === 'SELECT');
  const oldHistoryRow = findElement(firstMount, (element) => element.getAttribute?.('data-id'));
  assert.equal(oldHistorySelects.length, 2);
  assert.ok(oldHistoryRow);

  oldCommunityPill.dispatchEvent(new Event('click'));
  teardownDiaryMode(map);

  store.diaryViewMode = 'live';
  store.diarySelectedHistoryRouteId = null;
  store.diaryCommunityRadiusMeters = 1500;
  const secondInsights = [];
  const secondMount = new FakeElement('div');
  await initialize(secondMount, {
    setViewContext: (mode) => secondInsights.push(['view', mode]),
    refresh: () => secondInsights.push(['refresh']),
  });
  const stateBeforeOldControls = {
    viewMode: store.diaryViewMode,
    historyRouteId: store.diarySelectedHistoryRouteId,
    radius: store.diaryCommunityRadiusMeters,
  };
  const mapMutationsBefore = map.mutations.length;
  const insightsBefore = structuredClone(secondInsights);
  const secondMountChildrenBefore = [...secondMount.children];
  const livePill = button(secondMount, 'Live route');
  const historyPill = button(secondMount, 'My routes');
  const communityPill = button(secondMount, 'Sample community');
  assert.equal(livePill.getAttribute('aria-pressed'), 'true');
  assert.equal(historyPill.getAttribute('aria-pressed'), 'false');
  assert.equal(communityPill.getAttribute('aria-pressed'), 'false');

  oldHistoryPill.dispatchEvent(new Event('click'));
  oldHistorySelects[0].value = '7d';
  oldHistorySelects[0].dispatchEvent(new Event('change'));
  oldHistorySelects[1].value = 'bike';
  oldHistorySelects[1].dispatchEvent(new Event('change'));
  oldHistoryRow.dispatchEvent(new Event('click'));

  assert.deepEqual({
    viewMode: store.diaryViewMode,
    historyRouteId: store.diarySelectedHistoryRouteId,
    radius: store.diaryCommunityRadiusMeters,
  }, stateBeforeOldControls);
  assert.equal(map.mutations.length, mapMutationsBefore);
  assert.deepEqual(secondInsights, insightsBefore);
  assert.deepEqual(secondMount.children, secondMountChildrenBefore);

  historyPill.dispatchEvent(new Event('click'));
  assert.equal(livePill.getAttribute('aria-pressed'), 'false');
  assert.equal(historyPill.getAttribute('aria-pressed'), 'true');
  const newHistoryRow = findElement(secondMount, (element) => element.getAttribute?.('data-id'));
  newHistoryRow.dispatchEvent(new Event('click'));
  assert.equal(store.diaryViewMode, 'history');
  assert.ok(store.diarySelectedHistoryRouteId);
  communityPill.dispatchEvent(new Event('click'));
  assert.equal(store.diaryViewMode, 'community');
  assert.equal(historyPill.getAttribute('aria-pressed'), 'false');
  assert.equal(communityPill.getAttribute('aria-pressed'), 'true');
  assert.equal(store.diaryCommunityRadiusMeters, 1500);
  assert.equal(
    map.mutations.some(([kind, id]) => kind === 'remove-layer' && id === `${DIARY_ROUTE_PRIMARY_SOURCE_ID}-line`),
    true,
  );
  const segmentHandler = map.handlers.find(([event, layer]) => (
    event === 'click' && layer === DIARY_SEGMENTS_HIT_LAYER_ID
  ))?.[2];
  assert.equal(typeof segmentHandler, 'function');
  const cameraFitsBeforeSampleClick = map.mutations.filter(([kind]) => kind === 'fit-bounds').length;
  assert.equal(fitCurrentDiarySelection(), false);
  assert.equal(
    map.mutations.filter(([kind]) => kind === 'fit-bounds').length,
    cameraFitsBeforeSampleClick,
    'Sample Community insights must not refit an invisible Live route',
  );
  segmentHandler({
    features: [{
      properties: { segment_id: 'seg-1' },
      geometry: { type: 'LineString', coordinates: [[-75.17, 39.95], [-75.16, 39.96]] },
    }],
    lngLat: { lng: -75.16, lat: 39.95 },
  });
  assert.equal(
    map.mutations.filter(([kind]) => kind === 'fit-bounds').length,
    cameraFitsBeforeSampleClick,
    'Sample Community must not open an interactive segment popup or move the map',
  );
  assert.deepEqual(secondInsights.filter(([kind]) => kind === 'view'), [
    ['view', { mode: 'live', routeId: 'route-1' }],
    ['view', { mode: 'history', routeId: null }],
    ['view', { mode: 'community', routeId: null }],
  ]);
});

test('immediate segment teardown owns the highlight timer and leaves no late artifact', () => {
  const layers = new Set();
  const sources = new Set();
  const mutations = [];
  const scheduled = [];
  const scheduler = {
    setTimeout(callback) {
      scheduled.push(callback);
      return callback;
    },
    clearTimeout(callback) {
      mutations.push(['clear-timeout', callback]);
    },
  };
  const map = {
    getLayer: (id) => (layers.has(id) ? { id } : null),
    getSource: (id) => (sources.has(id) ? { id } : null),
    addLayer(layer) { layers.add(layer.id); mutations.push(['add-layer', layer.id]); },
    addSource(id) { sources.add(id); mutations.push(['add-source', id]); },
    removeLayer(id) { layers.delete(id); mutations.push(['remove-layer', id]); },
    removeSource(id) { sources.delete(id); mutations.push(['remove-source', id]); },
    off() {},
  };
  const ownedCleanups = [];
  highlightSegments(map, [{
    type: 'Feature',
    properties: { segment_id: 'seg-1' },
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
  }], {
    durationMs: 1500,
    scheduler,
    addCleanup(cleanup) {
      ownedCleanups.push(cleanup);
      return cleanup;
    },
  });

  removeSegmentsLayer(map, 'diary-segments');
  const mutationsAfterTeardown = mutations.length;
  scheduled[0]?.();
  ownedCleanups[0]?.();

  assert.equal([...layers].some((id) => id.includes('highlight')), false);
  assert.equal([...sources].some((id) => id.includes('highlight')), false);
  assert.equal(mutations.length, mutationsAfterTeardown);
});

test('owned DEV debug cleanup preserves a newer identity and removes its own identity', async () => {
  const { installOwnedDebugGlobal } = await import('../../src/routes_diary/diary_insights_port.js');
  const target = {};
  const cleanups = [];
  const ownedDebug = Object.freeze({ id: 'owned' });
  installOwnedDebugGlobal(target, ownedDebug, (cleanup) => {
    cleanups.push(cleanup);
    return cleanup;
  });

  assert.equal(target.__diary_debug, ownedDebug);

  const newerDebug = Object.freeze({ id: 'newer' });
  target.__diary_debug = newerDebug;
  cleanups[0]();
  assert.equal(target.__diary_debug, newerDebug);

  const secondTarget = {};
  const secondCleanups = [];
  installOwnedDebugGlobal(secondTarget, ownedDebug, (cleanup) => {
    secondCleanups.push(cleanup);
    return cleanup;
  });
  secondCleanups[0]();
  assert.equal(secondTarget.__diary_debug, undefined);
});
