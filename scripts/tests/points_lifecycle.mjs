#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { refreshPoints } from '../../src/map/points.js';
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
