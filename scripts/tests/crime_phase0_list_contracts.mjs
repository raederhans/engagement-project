#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeCrimeListCount,
  runCrimeListRefresh,
} from '../../src/ui/crime_list_results.js';
import {
  GEOCODER_ERROR_CODES,
  PhiladelphiaGeocoderError,
  geocodePhiladelphiaAddress,
} from '../../src/api/geocoder.js';
import { setLanguage, t } from '../../src/i18n/index.js';

test('Crime list distinguishes complete 199/200 results from a truncated 201 result', () => {
  assert.deepEqual(describeCrimeListCount(199, 199), {
    key: 'crime.list.count',
    params: { count: 199 },
  });
  assert.deepEqual(describeCrimeListCount(200, 200), {
    key: 'crime.list.count',
    params: { count: 200 },
  });
  assert.deepEqual(describeCrimeListCount(201, 200), {
    key: 'crime.list.countTruncated',
    params: { displayed: 200, total: 201 },
  });

  setLanguage('en');
  assert.match(t('crime.list.countTruncated', { displayed: 200, total: 201 }), /200 of 201/);
  setLanguage('zh-CN');
  assert.match(t('crime.list.countTruncated', { displayed: 200, total: 201 }), /201.*200/);
  setLanguage('en');
});

test('Crime list initialization failure clears busy state and the same retry path succeeds', async () => {
  let attempts = 0;
  let busy = false;
  let visibleStatus = '';
  let retryVisible = false;
  let unhandled = null;
  const onUnhandled = (error) => { unhandled = error; };
  process.once('unhandledRejection', onUnhandled);

  const options = {
    ownsList: () => true,
    showIntent: () => { busy = true; },
    showStatus: ({ phase }) => { visibleStatus = phase; },
    settle: (_mode, phase) => { busy = false; visibleStatus = phase; },
    reportFailure: () => { retryVisible = true; },
    loadController: async () => ({
      async requestRefresh() {
        attempts += 1;
        if (attempts === 1) throw new Error('list initialization failed');
        return { status: 'live', succeeded: ['incidents'], failed: [] };
      },
    }),
  };

  assert.deepEqual(await runCrimeListRefresh(options), {
    status: 'failed',
    succeeded: [],
    failed: ['list'],
  });
  assert.equal(busy, false);
  assert.equal(visibleStatus, 'failed');
  assert.equal(retryVisible, true);

  retryVisible = false;
  assert.deepEqual(await runCrimeListRefresh(options), {
    status: 'live',
    succeeded: ['incidents'],
    failed: [],
  });
  await new Promise((resolve) => setImmediate(resolve));
  process.removeListener('unhandledRejection', onUnhandled);
  assert.equal(unhandled, null);
  assert.equal(busy, false);
  assert.equal(visibleStatus, 'ready');
  assert.equal(retryVisible, false);
});

test('Crime list lazy initialization stops before refresh when List no longer owns the view', async () => {
  let ownsList = true;
  let releaseLoader;
  let refreshCalls = 0;
  const activeStates = [];
  const loader = new Promise((resolve) => { releaseLoader = resolve; });
  const completion = runCrimeListRefresh({
    ownsList: () => ownsList,
    showIntent() {},
    showStatus() {},
    settle() {},
    loadController: () => loader,
  });

  ownsList = false;
  releaseLoader({
    setActive(value) { activeStates.push(value); },
    async requestRefresh() { refreshCalls += 1; return { status: 'live' }; },
  });

  assert.deepEqual(await completion, { status: 'superseded' });
  assert.equal(refreshCalls, 0);
  assert.deepEqual(activeStates, [false]);
});

test('short geocoder input exposes a stable typed code with localized copy', async () => {
  setLanguage('en');
  await assert.rejects(geocodePhiladelphiaAddress('x'), (error) => {
    assert.equal(error instanceof PhiladelphiaGeocoderError, true);
    assert.equal(error.name, 'PhiladelphiaGeocoderError');
    assert.equal(error.code, GEOCODER_ERROR_CODES.ADDRESS_TOO_SHORT);
    assert.equal(error.messageKey, 'crime.geocoder.addressTooShort');
    assert.equal(t(error.messageKey), 'Enter a Philadelphia address or intersection.');
    return true;
  });

  setLanguage('zh-CN');
  await assert.rejects(geocodePhiladelphiaAddress('x'), (error) => {
    assert.equal(error.code, GEOCODER_ERROR_CODES.ADDRESS_TOO_SHORT);
    assert.equal(t(error.messageKey), '请输入费城地址或交叉路口。');
    assert.doesNotMatch(t(error.messageKey), /Philadelphia|address|intersection/i);
    return true;
  });
  setLanguage('en');
});
