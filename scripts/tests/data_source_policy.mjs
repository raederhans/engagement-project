#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import * as acs from '../../src/api/acs.js';
import * as boundaries from '../../src/api/boundaries.js';
import * as config from '../../src/config.js';
import * as diary from '../../src/api/diary.js';
import * as formSubmit from '../../src/routes_diary/form_submit.js';
import { dateFloorGuard } from '../../src/utils/sql.js';

test('project geography and crime coverage are defined once', () => {
  assert.deepEqual(config.PROJECT_REGION, {
    name: 'Philadelphia',
    stateFips: '42',
    countyFips: '101',
  });
  assert.equal(config.CRIME_DATASET_START, '2006-01-01');
  assert.equal(dateFloorGuard('2007-06-01'), '2007-06-01');
});

test('police districts prefer the live city API before the bundled fallback', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({
      type: 'FeatureCollection',
      features: Array.from({ length: 21 }, (_, index) => ({
        type: 'Feature',
        properties: { DIST_NUMC: String(index + 1).padStart(2, '0') },
        geometry: null,
      })),
    }), {
      status: 200,
      headers: { 'content-type': 'application/geo+json' },
    });
  };

  const result = await boundaries.fetchPoliceDistrictsCachedFirst();
  assert.equal(result.features.length, 21);
  assert.match(calls[0], /^https:\/\/policegis\.phila\.gov\//);
});

test('ACS uses configured live endpoints first and falls back to the validated snapshot', async () => {
  assert.equal(typeof acs.fetchTractStatsPreferred, 'function');

  const liveCalls = [];
  const liveRows = await acs.fetchTractStatsPreferred({
    endpoints: { population: 'live:population', poverty: 'live:poverty' },
    localUrl: 'local:snapshot',
    fetchJsonImpl: async (url) => {
      liveCalls.push(url);
      if (url === 'live:population') {
        return [
          ['NAME', 'B01003_001E', 'B25003_001E', 'B25003_003E', 'B19013_001E', 'state', 'county', 'tract'],
          ['Tract 1', '100', '40', '20', '50000', '42', '101', '000100'],
        ];
      }
      if (url === 'live:poverty') {
        return [
          ['NAME', 'S1701_C03_001E', 'state', 'county', 'tract'],
          ['Tract 1', '12.5', '42', '101', '000100'],
        ];
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  assert.deepEqual(liveCalls, ['live:population', 'live:poverty']);
  assert.deepEqual(liveRows[0], {
    geoid: '42101000100',
    pop: 100,
    renter_total: 40,
    renter_count: 20,
    median_income: 50000,
    poverty_pct: 12.5,
  });

  const fallbackCalls = [];
  const snapshot = [{
    geoid: '42101000100',
    pop: 90,
    renter_total: 35,
    renter_count: 18,
    median_income: 48000,
    poverty_pct: 13,
  }];
  const fallbackRows = await acs.fetchTractStatsPreferred({
    endpoints: { population: 'live:population', poverty: 'live:poverty' },
    localUrl: 'local:snapshot',
    fetchJsonImpl: async (url) => {
      fallbackCalls.push(url);
      if (url.startsWith('live:')) throw new Error('upstream unavailable');
      return snapshot;
    },
  });
  assert.ok(fallbackCalls.includes('local:snapshot'));
  assert.deepEqual(fallbackRows, snapshot);
});

test('ACS can use the keyless online Census Reporter feed', async () => {
  assert.match(config.CENSUS_REPORTER_ACS_URL, /^https:\/\/api\.censusreporter\.org\//);
  assert.equal(typeof acs.fetchTractStatsFromCensusReporter, 'function');

  const rows = await acs.fetchTractStatsFromCensusReporter({
    url: 'live:census-reporter',
    fetchJsonImpl: async () => ({
      release: { id: 'acs2024_5yr' },
      data: {
        '14000US42101000100': {
          B01003: { estimate: { B01003001: 100 } },
          B25003: { estimate: { B25003001: 40, B25003003: 20 } },
          B19013: { estimate: { B19013001: 50000 } },
          B17001: { estimate: { B17001001: 80, B17001002: 10 } },
        },
      },
    }),
  });

  assert.deepEqual(rows, [{
    geoid: '42101000100',
    pop: 100,
    renter_total: 40,
    renter_count: 20,
    median_income: 50000,
    poverty_pct: 12.5,
  }]);
});

test('Diary client uses a real API when configured and deterministic demo semantics otherwise', async () => {
  assert.equal(typeof diary.createDiaryClient, 'function');
  const payload = {
    route_id: 'route_demo_1',
    segment_ids: ['seg_1', 'seg_2'],
    overall_rating: 4,
    tags: ['poor_lighting'],
    segment_overrides: [{ segment_id: 'seg_2', rating: 2 }],
    mode: 'bike',
    user_hash: 'demo_user',
    timestamp: '2026-07-30T00:00:00.000Z',
  };

  const demoClient = diary.createDiaryClient({ apiBase: '' });
  const first = await demoClient.submitDiary(payload);
  const second = await demoClient.submitDiary(payload);
  assert.deepEqual(first, second);
  assert.equal(first.persisted, false);
  assert.equal(first.mode, 'demo');
  assert.deepEqual(first.updated_segments.map((row) => row.rating), [4, 2]);

  const requests = [];
  const apiClient = diary.createDiaryClient({
    apiBase: 'https://example.test/api/diary/',
    request: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, submission_id: 'sub_1', updated_segments: [] };
    },
  });
  await apiClient.submitDiary(payload);
  assert.equal(requests[0].url, 'https://example.test/api/diary/submit');
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    overall_rating: 4,
    tags: ['poor_lighting'],
    travel_mode: 'bike',
    segment_overrides: [{ segment_id: 'seg_2', rating: 2 }],
    save_as_route: false,
    matched_segments: ['seg_1', 'seg_2'],
    timestamp: 1785369600000,
  });
  assert.equal(requests[0].options.headers['x-user-hash'], 'demo_user');
});

test('submission completion closes the modal and still invokes the captured callback', () => {
  assert.equal(typeof formSubmit.finalizeDiarySubmission, 'function');
  const order = [];
  const payload = { route_id: 'route_demo_1' };
  const response = { ok: true, persisted: false };
  const state = {
    onSuccess(args) {
      order.push(['callback', args]);
    },
  };

  formSubmit.finalizeDiarySubmission({
    state,
    payload,
    response,
    close() {
      order.push(['close']);
    },
  });

  assert.deepEqual(order, [
    ['close'],
    ['callback', { payload, response }],
  ]);
});
