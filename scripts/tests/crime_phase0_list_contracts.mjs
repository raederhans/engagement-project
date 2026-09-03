#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeCrimeListCount,
  projectCrimeListSummary,
  runCrimeListRefresh,
  sortCrimeListRows,
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

test('Crime list sorting keeps overview, category, and record ordering deterministic', () => {
  const categories = [
    { offenseLabel: 'Theft', themeLabel: 'Property', count: 8 },
    { offenseLabel: 'Fraud', themeLabel: 'Financial', count: 3 },
  ];
  assert.deepEqual(sortCrimeListRows(categories, 'name', 'categories').map((row) => row.offenseLabel), ['Fraud', 'Theft']);
  assert.deepEqual(sortCrimeListRows(categories, 'theme', 'categories').map((row) => row.offenseLabel), ['Fraud', 'Theft']);
  const records = [
    { properties: { cartodb_id: 1, text_general_code: 'Thefts', dispatch_date_time: '2025-01-01T00:00:00Z', dc_dist: '09' } },
    { properties: { cartodb_id: 2, text_general_code: 'Fraud', dispatch_date_time: '2025-02-01T00:00:00Z', dc_dist: '01' } },
  ];
  assert.equal(sortCrimeListRows(records, 'newest', 'records')[0].properties.cartodb_id, 2);
  assert.equal(sortCrimeListRows(records, 'district', 'records')[0].properties.cartodb_id, 2);
});

test('Crime list projects source categories into useful overview and category levels', () => {
  const summary = projectCrimeListSummary([
    { text_general_code: 'Thefts', n: 12 },
    { text_general_code: 'Burglary Residential', n: 3 },
    { text_general_code: 'Fraud', n: 5 },
  ], 'en');
  assert.equal(summary.total, 20);
  assert.deepEqual(summary.themes.map(({ id, count }) => [id, count]), [
    ['property', 15],
    ['financial', 5],
  ]);
  assert.deepEqual(summary.categories.map(({ offenseCode, count }) => [offenseCode, count]), [
    ['Thefts', 12],
    ['Fraud', 5],
    ['Burglary Residential', 3],
  ]);
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
    showIntent: (_mode, options) => {
      assert.deepEqual(options, { showSkeleton: false });
      busy = true;
    },
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
