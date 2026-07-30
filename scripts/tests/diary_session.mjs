#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDiarySession,
  releaseOwnedReference,
  runCleanupSteps,
} from '../../src/routes_diary/diary_session.js';

test('dispose invokes each owned cleanup exactly once', () => {
  const session = createDiarySession();
  let firstCalls = 0;
  let secondCalls = 0;

  session.addCleanup(() => { firstCalls += 1; });
  session.addCleanup(() => { secondCalls += 1; });

  session.dispose();
  session.dispose();

  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 1);
});

test('dispose aborts the public signal once before owned cleanup runs', () => {
  const session = createDiarySession();
  const observed = [];

  session.signal?.addEventListener('abort', () => {
    observed.push(['abort', session.isActive()]);
  });
  session.addCleanup(() => {
    observed.push(['cleanup', session.signal?.aborted]);
  });

  session.dispose();
  session.dispose();

  assert.ok(session.signal instanceof AbortSignal);
  assert.equal(session.signal.aborted, true);
  assert.deepEqual(observed, [
    ['abort', false],
    ['cleanup', true],
  ]);
});

test('dispose clears owned interval and timeout with the injected scheduler', () => {
  const cleared = [];
  const scheduler = {
    setTimeout: () => 'timeout-1',
    clearTimeout: (id) => cleared.push(['timeout', id]),
    setInterval: () => 'interval-1',
    clearInterval: (id) => cleared.push(['interval', id]),
  };
  const session = createDiarySession({ scheduler });

  session.setTimeout(() => {}, 10);
  session.setInterval(() => {}, 20);
  session.dispose();

  assert.deepEqual(cleared, [
    ['timeout', 'timeout-1'],
    ['interval', 'interval-1'],
  ]);
});

test('a queued interval callback cannot run after dispose', () => {
  let scheduledCallback;
  const scheduler = {
    setTimeout,
    clearTimeout,
    setInterval: (callback) => {
      scheduledCallback = callback;
      return 'interval-queued';
    },
    clearInterval() {},
  };
  const session = createDiarySession({ scheduler });
  let calls = 0;

  session.setInterval(() => { calls += 1; }, 10);
  session.dispose();
  scheduledCallback();

  assert.equal(calls, 0);
});

test('dispose removes an owned EventTarget listener', () => {
  const session = createDiarySession();
  const target = new EventTarget();
  let calls = 0;

  session.listen(target, 'change', () => { calls += 1; });
  target.dispatchEvent(new Event('change'));
  session.dispose();
  target.dispatchEvent(new Event('change'));

  assert.equal(calls, 1);
});

test('dispose reports one cleanup error and still runs later cleanups once', () => {
  const reported = [];
  const session = createDiarySession({
    reportError: (error) => reported.push(error.message),
  });
  let laterCalls = 0;

  session.addCleanup(() => { throw new Error('cleanup failed'); });
  session.addCleanup(() => { laterCalls += 1; });

  assert.doesNotThrow(() => session.dispose());
  session.dispose();

  assert.deepEqual(reported, ['cleanup failed']);
  assert.equal(laterCalls, 1);
});

test('a naturally fired timeout unregisters before dispose', () => {
  let scheduledCallback;
  const cleared = [];
  const scheduler = {
    setTimeout: (callback) => {
      scheduledCallback = callback;
      return 'timeout-natural';
    },
    clearTimeout: (id) => cleared.push(id),
    setInterval,
    clearInterval,
  };
  const session = createDiarySession({ scheduler });
  let calls = 0;

  session.setTimeout(() => { calls += 1; }, 10);
  scheduledCallback();
  session.dispose();

  assert.equal(calls, 1);
  assert.deepEqual(cleared, []);
});

test('manually cancelled session timers are not cleared again on dispose', () => {
  const cleared = [];
  const scheduler = {
    setTimeout: () => 'timeout-manual',
    clearTimeout: (id) => cleared.push(['timeout', id]),
    setInterval: () => 'interval-manual',
    clearInterval: (id) => cleared.push(['interval', id]),
  };
  const session = createDiarySession({ scheduler });

  const timeoutId = session.setTimeout(() => {}, 10);
  const intervalId = session.setInterval(() => {}, 20);
  session.clearTimeout(timeoutId);
  session.clearInterval(intervalId);
  session.dispose();

  assert.deepEqual(cleared, [
    ['timeout', 'timeout-manual'],
    ['interval', 'interval-manual'],
  ]);
});

test('releaseOwnedReference clears only the reference that was cleaned', () => {
  const cleanedMap = {};
  const otherMap = {};

  assert.equal(releaseOwnedReference(cleanedMap, cleanedMap), null);
  assert.equal(releaseOwnedReference(otherMap, cleanedMap), otherMap);
  assert.equal(releaseOwnedReference(null, cleanedMap), null);
});

test('runCleanupSteps reports a failed step and still cleans DOM state and references', () => {
  const reported = [];
  const completed = [];
  let mapReference = {};

  runCleanupSteps([
    () => { throw new Error('map layer failed'); },
    () => completed.push('dom'),
    () => completed.push('state'),
    () => {
      mapReference = null;
      completed.push('reference');
    },
  ], (error) => reported.push(error.message));

  assert.deepEqual(reported, ['map layer failed']);
  assert.deepEqual(completed, ['dom', 'state', 'reference']);
  assert.equal(mapReference, null);
});
