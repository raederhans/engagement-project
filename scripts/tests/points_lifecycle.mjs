#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { attachClusterExpansion, refreshPoints } from '../../src/map/points.js';
import { wirePoints } from '../../src/map/wire_points.js';
import { createCrimeRefreshOwner } from '../../src/routes_crime/crime_refresh_owner.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createMap({ loaded = true } = {}) {
  const handlers = new Map();
  const mutations = [];
  return {
    handlers,
    mutations,
    loaded: () => loaded,
    isStyleLoaded: () => loaded,
    getBounds: () => ({
      getWest: () => -75.2,
      getSouth: () => 39.9,
      getEast: () => -75.1,
      getNorth: () => 40,
    }),
    getSource: () => null,
    getLayer: () => null,
    addSource: (...args) => mutations.push(['addSource', ...args]),
    addLayer: (...args) => mutations.push(['addLayer', ...args]),
    on(event, handler) { handlers.set(event, handler); },
    once(event, handler) { handlers.set(event, handler); },
    off(event, handler) {
      if (handlers.get(event) === handler) handlers.delete(event);
    },
  };
}

function createScheduler() {
  let nextId = 1;
  const timers = new Map();
  const cleared = [];
  return {
    timers,
    cleared,
    setTimeout(callback) {
      const id = nextId++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      cleared.push(id);
      timers.delete(id);
    },
  };
}

test('refreshPoints forwards AbortSignal and stale success cannot mutate the map', async () => {
  const map = createMap();
  const gate = deferred();
  const controller = new AbortController();
  let receivedSignal;

  const refresh = refreshPoints(map, {
    start: '2026-01-01',
    end: '2026-02-01',
    signal: controller.signal,
    shouldApply: () => true,
    fetchPointsImpl: (params) => {
      receivedSignal = params.signal;
      return gate.promise;
    },
  });
  controller.abort();
  gate.resolve({ type: 'FeatureCollection', features: [] });

  assert.deepEqual(await refresh, { applied: false });
  assert.equal(receivedSignal, controller.signal);
  assert.deepEqual(map.mutations, []);
});

test('a newer refresh aborts the superseded request', async () => {
  const map = createMap();
  const requests = [];
  const controller = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: (_map, params) => {
      const gate = deferred();
      requests.push({ gate, signal: params.signal });
      return gate.promise;
    },
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
  });
  await Promise.resolve();
  const next = controller.refresh();

  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].signal.aborted, false);
  requests[0].gate.resolve({ applied: false });
  requests[1].gate.resolve({ applied: true });
  await next;
  controller.destroy();
});

test('an unselected Crime entry stays idle until an analysis authorizes incident loading', async () => {
  const map = createMap();
  const scheduler = createScheduler();
  let filters = { queryMode: 'buffer', center3857: null };
  const requests = [];
  const controller = wirePoints(map, {
    getFilters: () => filters,
    shouldRefresh: (snapshot) => snapshot.queryMode === 'buffer' && Boolean(snapshot.center3857),
    refreshPointsImpl: async (_map, snapshot) => {
      requests.push(snapshot);
      return { applied: true };
    },
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
    scheduler,
  });

  await Promise.resolve();
  assert.equal(requests.length, 0);
  map.handlers.get('moveend')();
  assert.equal(scheduler.timers.size, 0);

  filters = { queryMode: 'buffer', center3857: [-8_365_000, 4_855_000] };
  assert.deepEqual(await controller.refresh(filters), { applied: true });
  assert.equal(requests.length, 1);

  filters = { queryMode: 'buffer', center3857: null };
  map.handlers.get('moveend')();
  assert.equal(scheduler.timers.size, 0);
  assert.equal(requests.length, 1);
  controller.destroy();
});

test('cluster activation expands through the GeoJSON source and owns the camera move', async () => {
  const handlers = new Map();
  const cameraMoves = [];
  const source = {
    getClusterExpansionZoom(clusterId) {
      assert.equal(clusterId, 73);
      return Promise.resolve(14);
    },
  };
  const map = {
    on(event, layer, handler) { handlers.set(`${event}:${layer}`, handler); },
    off(event, layer, handler) {
      if (handlers.get(`${event}:${layer}`) === handler) handlers.delete(`${event}:${layer}`);
    },
    getSource(id) { return id === 'crime-points' ? source : null; },
    easeTo(options) { cameraMoves.push(options); },
  };
  let refreshes = 0;
  const cleanup = attachClusterExpansion(map, {
    isActive: () => true,
    runMapMove: async (action) => {
      action();
      return true;
    },
    refresh: async () => { refreshes += 1; },
  });

  await handlers.get('click:clusters')({
    features: [{
      properties: { cluster_id: 73 },
      geometry: { type: 'Point', coordinates: [-75.16, 39.95] },
    }],
  });

  assert.deepEqual(cameraMoves, [{
    center: [-75.16, 39.95],
    zoom: 14,
    duration: 350,
  }]);
  assert.equal(refreshes, 1);
  cleanup();
  assert.equal(handlers.has('click:clusters'), false);
});

test('an unclustered incident opens escaped details and releases its map listeners', async () => {
  const points = await import('../../src/map/points.js');
  assert.equal(typeof points.attachIncidentDetails, 'function');

  const handlers = new Map();
  const canvas = { style: { cursor: '' } };
  const map = {
    on(event, layer, handler) { handlers.set(`${event}:${layer}`, handler); },
    off(event, layer, handler) {
      if (handlers.get(`${event}:${layer}`) === handler) handlers.delete(`${event}:${layer}`);
    },
    getCanvas: () => canvas,
  };
  const popup = {
    setLngLat(value) { this.lngLat = value; return this; },
    setHTML(value) { this.html = value; return this; },
    addTo(value) { this.map = value; return this; },
    remove() { this.removed = true; },
  };
  const cleanup = points.attachIncidentDetails(map, {
    createPopup: () => popup,
  });

  handlers.get('mouseenter:unclustered')();
  assert.equal(canvas.style.cursor, 'pointer');
  handlers.get('click:unclustered')({
    lngLat: { lng: -75.16, lat: 39.95 },
    features: [{
      geometry: { type: 'Point', coordinates: [-75.17, 39.96] },
      properties: {
        text_general_code: '<img src=x onerror=alert(1)>',
        dispatch_date_time: '2026-07-15T14:35:00Z',
        location_block: '1500 MARKET ST & <script>',
        dc_dist: '09',
      },
    }],
  });

  assert.deepEqual(popup.lngLat, [-75.17, 39.96]);
  assert.equal(popup.map, map);
  assert.match(popup.html, /Incident details/i);
  assert.match(popup.html, /Jul 15, 2026/i);
  assert.match(popup.html, /1500 MARKET ST &amp; &lt;script&gt;/);
  assert.doesNotMatch(popup.html, /<img|<script>/i);

  const { setLanguage } = await import('../../src/i18n/index.js');
  setLanguage('zh-CN');
  assert.match(popup.html, /事件详情/);
  assert.match(popup.html, /2026年7月15日/);
  setLanguage('en');

  cleanup();
  assert.equal(popup.removed, true);
  assert.equal(canvas.style.cursor, '');
  assert.equal(handlers.has('click:unclustered'), false);
  assert.equal(handlers.has('mouseenter:unclustered'), false);
  assert.equal(handlers.has('mouseleave:unclustered'), false);
});

test('cluster expansion disables animation when reduced motion is requested', async () => {
  const handlers = new Map();
  const cameraMoves = [];
  const map = {
    on(event, layer, handler) { handlers.set(`${event}:${layer}`, handler); },
    off() {},
    getSource: () => ({ getClusterExpansionZoom: async () => 15 }),
    easeTo(options) { cameraMoves.push(options); },
  };
  const cleanup = attachClusterExpansion(map, {
    isActive: () => true,
    prefersReducedMotion: () => true,
    runMapMove: async (action) => { action(); return true; },
  });

  await handlers.get('click:clusters')({
    features: [{
      properties: { cluster_id: 4 },
      geometry: { type: 'Point', coordinates: [-75.16, 39.95] },
    }],
  });

  assert.equal(cameraMoves[0].duration, 0);
  cleanup();
});

test('a newer points generation invalidates a held cluster expansion', async () => {
  const handlers = new Map();
  const expansion = deferred();
  let generation = 7;
  let cameraMoves = 0;
  let refreshes = 0;
  const map = {
    on(event, layer, handler) { handlers.set(`${event}:${layer}`, handler); },
    off() {},
    getSource: () => ({ getClusterExpansionZoom: () => expansion.promise }),
    easeTo() { cameraMoves += 1; },
  };
  const cleanup = attachClusterExpansion(map, {
    isActive: () => true,
    getGeneration: () => generation,
    runMapMove: async (action) => { action(); return true; },
    refresh: async () => { refreshes += 1; },
  });
  const activation = handlers.get('click:clusters')({
    features: [{
      properties: { cluster_id: 9 },
      geometry: { type: 'Point', coordinates: [-75.16, 39.95] },
    }],
  });

  generation += 1;
  expansion.resolve(15);
  await activation;

  assert.equal(cameraMoves, 0);
  assert.equal(refreshes, 0);
  cleanup();
});

test('an inactive cluster expansion cannot move the map after its zoom resolves', async () => {
  const handlers = new Map();
  const expansion = deferred();
  let active = true;
  let cameraMoves = 0;
  const map = {
    on(event, layer, handler) { handlers.set(`${event}:${layer}`, handler); },
    off() {},
    getSource: () => ({ getClusterExpansionZoom: () => expansion.promise }),
    easeTo() { cameraMoves += 1; },
  };
  const cleanup = attachClusterExpansion(map, {
    isActive: () => active,
    runMapMove: async (action) => { action(); return true; },
    refresh: async () => {},
  });
  const activation = handlers.get('click:clusters')({
    features: [{
      properties: { cluster_id: 9 },
      geometry: { type: 'Point', coordinates: [-75.16, 39.95] },
    }],
  });
  active = false;
  expansion.resolve(15);
  await activation;

  assert.equal(cameraMoves, 0);
  cleanup();
});

test('refresh accepts a captured filter snapshot without reading live filters again', async () => {
  const map = createMap({ loaded: false });
  let filterReads = 0;
  let receivedFilters;
  const controller = wirePoints(map, {
    getFilters: () => {
      filterReads += 1;
      return { start: 'live' };
    },
    refreshPointsImpl: async (_map, params) => {
      receivedFilters = params;
    },
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
  });

  const result = await controller.refresh({ start: 'captured', end: 'snapshot' });

  assert.deepEqual(result, { applied: true });
  assert.equal(filterReads, 0);
  assert.equal(receivedFilters.start, 'captured');
  assert.equal(receivedFilters.end, 'snapshot');
  controller.destroy();
});

test('an outer refresh cancellation aborts points transport and blocks its late sink', async () => {
  const map = createMap({ loaded: false });
  const gate = deferred();
  const outer = new AbortController();
  let receivedSignal;
  const controller = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: async (_map, params) => {
      receivedSignal = params.signal;
      await gate.promise;
      if (params.shouldApply()) map.mutations.push(['late-points-sink']);
      return { applied: params.shouldApply() };
    },
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
  });

  const request = controller.refresh(
    { start: '2026-01-01', end: '2026-02-01' },
    { signal: outer.signal, shouldApply: () => !outer.signal.aborted },
  );
  await Promise.resolve();
  outer.abort(new DOMException('Superseded Crime refresh', 'AbortError'));

  assert.equal(receivedSignal.aborted, true);
  gate.resolve();
  assert.deepEqual(await request, { applied: false });
  assert.deepEqual(map.mutations, []);
  controller.destroy();
});

test('superseded points cannot commit while the next Crime refresh is still at its boundary', async () => {
  const map = createMap({ loaded: false });
  const secondBoundary = deferred();
  const pointRequests = [];
  const pointsController = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: async (_map, params) => {
      const gate = deferred();
      pointRequests.push({ gate, params });
      await gate.promise;
      if (params.shouldApply()) map.mutations.push(['points', params.sequence]);
      return { applied: params.shouldApply() };
    },
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
  });
  let sequence = 0;
  const owner = createCrimeRefreshOwner({
    readSnapshot: () => ({ sequence: ++sequence }),
    runRefresh: async (snapshot, context) => {
      if (snapshot.sequence === 2) await secondBoundary.promise;
      return pointsController.refresh(snapshot, {
        signal: context.signal,
        shouldApply: context.isCurrent,
      });
    },
  });

  const first = owner.refresh();
  await Promise.resolve();
  const second = owner.refresh();
  await Promise.resolve();
  assert.equal(pointRequests.length, 1);
  assert.equal(pointRequests[0].params.signal.aborted, true);

  pointRequests[0].gate.resolve();
  assert.deepEqual(await first, { applied: false });
  assert.deepEqual(map.mutations, []);

  secondBoundary.resolve();
  await Promise.resolve();
  assert.equal(pointRequests.length, 2);
  pointRequests[1].gate.resolve();
  assert.deepEqual(await second, { applied: true });
  assert.deepEqual(map.mutations, [['points', 2]]);
  pointsController.destroy();
  owner.destroy();
});

test('superseded and deactivated failures do not toast or retry', async () => {
  const map = createMap();
  const scheduler = createScheduler();
  const requests = [];
  let toastCount = 0;
  const controller = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: (_map, params) => {
      const gate = deferred();
      requests.push({ gate, signal: params.signal });
      return gate.promise;
    },
    clearCrimePointsImpl: () => {},
    showToast: () => { toastCount += 1; },
    hideToast: () => {},
    scheduler,
  });
  await Promise.resolve();
  const second = controller.refresh();
  requests[0].gate.reject(new Error('superseded'));
  await Promise.resolve();
  controller.setActive(false);
  requests[1].gate.reject(new Error('deactivated'));
  await second;

  assert.equal(toastCount, 0);
  assert.equal(scheduler.timers.size, 0);
  controller.destroy();
});

test('destroy aborts work, cancels debounce/retry timers, and removes listeners', async () => {
  const map = createMap({ loaded: false });
  const scheduler = createScheduler();
  const pending = deferred();
  const controller = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: (_map, params) => {
      pending.signal = params.signal;
      return pending.promise;
    },
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
    scheduler,
  });

  map.handlers.get('moveend')();
  assert.equal(scheduler.timers.size, 1);
  map.handlers.get('load')();
  await Promise.resolve();
  controller.destroy();

  assert.equal(pending.signal.aborted, true);
  assert.equal(scheduler.timers.size, 0);
  assert.equal(map.handlers.size, 0);
  pending.reject(new DOMException('Aborted', 'AbortError'));
  await Promise.resolve();
});

test('destroy clears retry and toast timers created by an active failure', async () => {
  const map = createMap({ loaded: false });
  const scheduler = createScheduler();
  const pending = deferred();
  const controller = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: () => pending.promise,
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
    scheduler,
  });
  const request = controller.refresh();
  pending.reject(new Error('network unavailable'));
  assert.deepEqual(await request, { status: 'failed' });

  assert.equal(scheduler.timers.size, 2);
  controller.destroy();
  assert.equal(scheduler.timers.size, 0);
  assert.equal(map.handlers.size, 0);
});

test('moveend stays idle while inactive and resumes through the same listener', async () => {
  const map = createMap({ loaded: false });
  const scheduler = createScheduler();
  let refreshCount = 0;
  const controller = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: async () => {
      refreshCount += 1;
      return { applied: true };
    },
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
    scheduler,
  });
  const moveend = map.handlers.get('moveend');

  controller.setActive(false);
  moveend();
  assert.equal(scheduler.timers.size, 0);
  assert.equal(refreshCount, 0);

  controller.setActive(true);
  moveend();
  assert.equal(scheduler.timers.size, 1);
  const [timerId, callback] = scheduler.timers.entries().next().value;
  scheduler.timers.delete(timerId);
  callback();
  await Promise.resolve();
  assert.equal(refreshCount, 1);
  controller.destroy();
});

test('programmatic movement refreshes once from final bounds and preserves no-move, user-pan, and cancellation semantics', async () => {
  const map = createMap({ loaded: false });
  const scheduler = createScheduler();
  let moving = false;
  let bounds = [-75.2, 39.9, -75.1, 40];
  const refreshBounds = [];
  map.isMoving = () => moving;
  map.getBounds = () => ({
    getWest: () => bounds[0],
    getSouth: () => bounds[1],
    getEast: () => bounds[2],
    getNorth: () => bounds[3],
  });
  const controller = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: async (currentMap) => {
      const current = currentMap.getBounds();
      refreshBounds.push([current.getWest(), current.getSouth(), current.getEast(), current.getNorth()]);
      return { applied: true };
    },
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
    scheduler,
  });
  const moveend = map.handlers.get('moveend');

  const moveCompleted = controller.runProgrammaticMapMove(() => { moving = true; });
  const ownedRefresh = moveCompleted.then((completed) => (
    completed ? controller.refresh() : { applied: false }
  ));
  await Promise.resolve();
  assert.deepEqual(refreshBounds, []);
  bounds = [-75.18, 39.92, -75.08, 40.02];
  moving = false;
  moveend();
  assert.deepEqual(await ownedRefresh, { applied: true });
  assert.equal(scheduler.timers.size, 0);
  assert.deepEqual(refreshBounds, [[-75.18, 39.92, -75.08, 40.02]]);

  bounds = [-75.17, 39.93, -75.07, 40.03];
  const noMoveCompleted = await controller.runProgrammaticMapMove(() => {});
  assert.equal(noMoveCompleted, true);
  await controller.refresh();
  assert.deepEqual(refreshBounds.at(-1), bounds);

  bounds = [-75.16, 39.94, -75.06, 40.04];
  moveend();
  const [userTimerId, userCallback] = scheduler.timers.entries().next().value;
  scheduler.timers.delete(userTimerId);
  userCallback();
  await Promise.resolve();
  assert.deepEqual(refreshBounds.at(-1), bounds);

  await assert.rejects(
    controller.runProgrammaticMapMove(() => { throw new Error('flyTo failed'); }),
    /flyTo failed/,
  );
  await controller.refresh();
  assert.equal(refreshBounds.length, 4);

  moving = true;
  const cancelledMove = controller.runProgrammaticMapMove(() => {});
  const cancelledRefresh = cancelledMove.then((completed) => (
    completed ? controller.refresh() : { applied: false }
  ));
  controller.setActive(false);
  assert.equal(await cancelledMove, false);
  assert.deepEqual(await cancelledRefresh, { applied: false });
  assert.equal(refreshBounds.length, 4);
  controller.destroy();
});

test('a replacement programmatic move ignores the synchronous moveend emitted while stopping the old animation', async () => {
  const map = createMap({ loaded: false });
  const scheduler = createScheduler();
  let moving = false;
  map.isMoving = () => moving;
  const controller = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: async () => ({ applied: true }),
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
    scheduler,
  });
  const moveend = map.handlers.get('moveend');

  const firstMove = controller.runProgrammaticMapMove(() => { moving = true; });
  let secondSettled = false;
  const secondMove = controller.runProgrammaticMapMove(() => {
    moveend(); // MapLibre stops the first animation synchronously inside flyTo().
    moving = true;
  }).then((completed) => {
    secondSettled = true;
    return completed;
  });

  assert.equal(await firstMove, false);
  await Promise.resolve();
  assert.equal(secondSettled, false);
  assert.equal(scheduler.timers.size, 0);

  moving = false;
  moveend();
  assert.equal(await secondMove, true);
  assert.equal(scheduler.timers.size, 0);
  controller.destroy();
});
