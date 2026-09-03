#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import maplibregl from 'maplibre-gl';

import './source_health_contracts.mjs';

import * as acs from '../../src/api/acs.js';
import * as boundaries from '../../src/api/boundaries.js';
import * as config from '../../src/config.js';
import { admitCoverageResponse } from '../../src/api/meta.js';
import * as diary from '../../src/api/diary.js';
import * as formSubmit from '../../src/routes_diary/form_submit.js';
import {
  buildSegmentCardHtml,
  mountSegmentsLayer,
  removeSegmentsLayer,
  submitSegmentCardFeedback,
} from '../../src/map/segments_layer.js';
import { fetchJson } from '../../src/utils/http.js';
import { buildMonthlyCitySQL, dateFloorGuard } from '../../src/utils/sql.js';

function resetPoliceBoundaryCache() {
  boundaries.fetchPoliceDistrictsPreferred._cache = null;
  boundaries.fetchPoliceDistrictsPreferred._cacheMeta = null;
}

test('project geography and crime coverage are defined once', () => {
  assert.deepEqual(config.PROJECT_REGION, {
    name: 'Philadelphia',
    stateFips: '42',
    countyFips: '101',
  });
  assert.equal(config.CRIME_DATASET_START, '2006-01-01');
  assert.equal(config.CRIME_DATASET_COVERAGE_MAX, '2026-08-31');
  assert.equal(config.CRIME_DATASET_END_EXCLUSIVE, '2026-09-01');
  assert.equal(dateFloorGuard('2007-06-01'), '2007-06-01');
});

test('Crime snapshot caps coverage and every query at August 31, 2026', () => {
  assert.deepEqual(admitCoverageResponse({
    rows: [{ min_dt: '2006-01-01', max_dt: '2027-02-15' }],
  }), {
    min: '2006-01-01',
    max: '2026-08-31',
  });
  const sql = buildMonthlyCitySQL({
    start: '2026-01-01',
    end: '2027-03-01',
    types: [],
  });
  assert.match(sql, /dispatch_date_time < '2026-09-01'/);
  assert.doesNotMatch(sql, /2027-03-01/);
});

test('police boundary cancellation never falls through to the bundled fallback', async (t) => {
  resetPoliceBoundaryCache();
  const originalFetch = globalThis.fetch;
  const calls = [];
  const resolvedSources = [];
  const controller = new AbortController();
  const reason = new DOMException('Boundary refresh superseded', 'AbortError');
  t.after(() => {
    globalThis.fetch = originalFetch;
    resetPoliceBoundaryCache();
  });

  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), signal: options.signal });
    if (calls.length === 1) {
      controller.abort(reason);
      throw reason;
    }
    throw new Error('bundled fallback must not run after cancellation');
  };

  await assert.rejects(
    boundaries.fetchPoliceDistrictsCachedFirst({
      signal: controller.signal,
      onSourceResolved: (meta) => resolvedSources.push(meta),
    }),
    (error) => error === reason,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, true);
  assert.deepEqual(resolvedSources, []);
});

test('police districts still use the bundled fallback for an ordinary live failure', async (t) => {
  resetPoliceBoundaryCache();
  const originalFetch = globalThis.fetch;
  const calls = [];
  const resolvedSources = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
    resetPoliceBoundaryCache();
  });

  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) throw new Error('live boundary unavailable');
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

  const result = await boundaries.fetchPoliceDistrictsCachedFirst({
    onSourceResolved: (meta) => resolvedSources.push(meta),
  });
  assert.equal(result.features.length, 21);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^https:\/\/policegis\.phila\.gov\//);
  assert.match(calls[1], /data\/police_districts\.geojson$/);
  assert.deepEqual(resolvedSources, [{
    dataset: 'police-districts',
    kind: 'fallback',
    provider: 'Bundled boundary snapshot',
    url: calls[1],
    cacheHit: false,
  }]);
});

test('police districts prefer the live city API before the bundled fallback', async (t) => {
  resetPoliceBoundaryCache();
  const originalFetch = globalThis.fetch;
  const calls = [];
  const resolvedSources = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
    resetPoliceBoundaryCache();
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

  const result = await boundaries.fetchPoliceDistrictsCachedFirst({
    onSourceResolved: (meta) => resolvedSources.push(meta),
  });
  assert.equal(result.features.length, 21);
  assert.match(calls[0], /^https:\/\/policegis\.phila\.gov\//);
  assert.deepEqual(resolvedSources, [{
    dataset: 'police-districts',
    kind: 'live',
    provider: 'Philadelphia Police GIS',
    url: calls[0],
    cacheHit: false,
  }]);
});

test('police district source and provenance are reused after the first resolved request', async (t) => {
  resetPoliceBoundaryCache();
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const calls = [];
  const resolvedSources = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    resetPoliceBoundaryCache();
  });
  Date.now = () => originalNow() + (11 * 60_000);

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

  const first = await boundaries.fetchPoliceDistrictsPreferred({
    onSourceResolved: (meta) => resolvedSources.push(meta),
  });
  const second = await boundaries.fetchPoliceDistrictsPreferred({
    onSourceResolved: (meta) => resolvedSources.push(meta),
  });

  assert.equal(first, second);
  assert.equal(calls.length, 1);
  assert.equal(resolvedSources[0].cacheHit, false);
  assert.equal(resolvedSources[1].cacheHit, true);
});

test('tract boundary memory cache preserves the resolved live source metadata', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const resolvedSources = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
    boundaries.fetchTractsPreferred._cache = null;
    boundaries.fetchTractsPreferred._cacheMeta = null;
  });
  boundaries.fetchTractsPreferred._cache = null;
  boundaries.fetchTractsPreferred._cacheMeta = null;

  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({
      type: 'FeatureCollection',
      features: Array.from({ length: 300 }, (_, index) => ({
        type: 'Feature',
        properties: {
          STATE: '42',
          COUNTY: '101',
          TRACT: String(index).padStart(6, '0'),
        },
        geometry: null,
      })),
    }), {
      status: 200,
      headers: { 'content-type': 'application/geo+json' },
    });
  };

  const first = await boundaries.fetchTractsPreferred({
    onSourceResolved: (meta) => resolvedSources.push(meta),
  });
  const second = await boundaries.fetchTractsPreferred({
    onSourceResolved: (meta) => resolvedSources.push(meta),
  });

  assert.equal(first, second);
  assert.equal(calls.length, 1);
  assert.deepEqual(resolvedSources, [
    {
      dataset: 'census-tract-boundaries',
      kind: 'live',
      provider: 'Official tract boundary API',
      url: calls[0],
      cacheHit: false,
    },
    {
      dataset: 'census-tract-boundaries',
      kind: 'live',
      provider: 'Official tract boundary API',
      url: calls[0],
      cacheHit: true,
    },
  ]);
});

test('tract boundary fallback reports its bundled source while cancellation reports nothing', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const fallbackCalls = [];
  const fallbackSources = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    boundaries.fetchTractsPreferred._cache = null;
    boundaries.fetchTractsPreferred._cacheMeta = null;
  });
  boundaries.fetchTractsPreferred._cache = null;
  boundaries.fetchTractsPreferred._cacheMeta = null;
  Date.now = () => originalNow() + (11 * 60_000);

  globalThis.fetch = async (url) => {
    fallbackCalls.push(String(url));
    if (!String(url).endsWith('/data/tracts_phl.geojson')) {
      throw new Error('live tract boundary unavailable');
    }
    return new Response(JSON.stringify({
      type: 'FeatureCollection',
      features: Array.from({ length: 300 }, (_, index) => ({
        type: 'Feature',
        properties: {
          STATE: '42',
          COUNTY: '101',
          TRACT: String(index).padStart(6, '0'),
        },
        geometry: null,
      })),
    }), {
      status: 200,
      headers: { 'content-type': 'application/geo+json' },
    });
  };

  await boundaries.fetchTractsPreferred({
    onSourceResolved: (meta) => fallbackSources.push(meta),
  });
  assert.deepEqual(fallbackSources, [{
    dataset: 'census-tract-boundaries',
    kind: 'fallback',
    provider: 'Bundled tract snapshot',
    url: fallbackCalls.at(-1),
    cacheHit: false,
  }]);

  boundaries.fetchTractsPreferred._cache = null;
  boundaries.fetchTractsPreferred._cacheMeta = null;
  const controller = new AbortController();
  const reason = new DOMException('Tract refresh superseded', 'AbortError');
  const cancelledSources = [];
  globalThis.fetch = async () => {
    controller.abort(reason);
    throw reason;
  };

  await assert.rejects(
    boundaries.fetchTractsPreferred({
      signal: controller.signal,
      onSourceResolved: (meta) => cancelledSources.push(meta),
    }),
    (error) => error === reason,
  );
  assert.deepEqual(cancelledSources, []);
});

test('ACS uses configured live endpoints first and falls back to the validated snapshot', async () => {
  assert.equal(typeof acs.fetchTractStatsPreferred, 'function');

  const liveCalls = [];
  const liveSources = [];
  const liveRows = await acs.fetchTractStatsPreferred({
    endpoints: { population: 'live:population', poverty: 'live:poverty' },
    localUrl: 'local:snapshot',
    onSourceResolved: (meta) => liveSources.push(meta),
    fetchJsonImpl: async (url) => {
      liveCalls.push(url);
      if (url === 'live:population') {
        return [
          ['NAME', 'B01003_001E', 'B01003_001M', 'B25003_001E', 'B25003_003E', 'B19013_001E', 'state', 'county', 'tract'],
          ['Tract 1', '100', '7', '40', '20', '50000', '42', '101', '000100'],
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
  assert.deepEqual(liveSources, [{
    dataset: 'census-tract-statistics',
    kind: 'live',
    provider: 'Configured Census API',
    url: 'live:population',
    vintage: config.ACS_SNAPSHOT_YEAR,
    asOf: `${config.ACS_SNAPSHOT_YEAR}-12-31`,
    cacheHit: false,
  }]);
  assert.deepEqual(liveRows[0], {
    geoid: '42101000100',
    pop: 100,
    population: {
      estimate: 100,
      moe90: 7,
      vintage: config.ACS_SNAPSHOT_YEAR,
      source: 'Configured Census API',
      retrievedAt: null,
      status: 'available',
    },
    renter_total: 40,
    renter_count: 20,
    median_income: 50000,
    poverty_pct: 12.5,
  });

  const fallbackCalls = [];
  const fallbackSources = [];
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
    reporterUrl: '',
    onSourceResolved: (meta) => fallbackSources.push(meta),
    fetchJsonImpl: async (url) => {
      fallbackCalls.push(url);
      if (url.startsWith('live:')) throw new Error('upstream unavailable');
      return snapshot;
    },
  });
  assert.ok(fallbackCalls.includes('local:snapshot'));
  assert.deepEqual(fallbackRows, [{
    ...snapshot[0],
    population: {
      estimate: 90,
      moe90: null,
      vintage: config.ACS_SNAPSHOT_YEAR,
      source: 'Bundled ACS snapshot',
      retrievedAt: null,
      status: 'partial',
    },
  }]);
  assert.deepEqual(fallbackSources, [{
    dataset: 'census-tract-statistics',
    kind: 'fallback',
    provider: 'Bundled ACS snapshot',
    url: 'local:snapshot',
    vintage: config.ACS_SNAPSHOT_YEAR,
    asOf: `${config.ACS_SNAPSHOT_YEAR}-12-31`,
    retrievedAt: null,
    cacheHit: false,
  }]);
});

test('ACS cancellation does not probe Census Reporter or the local snapshot', async () => {
  const controller = new AbortController();
  const reason = new DOMException('ACS refresh superseded', 'AbortError');
  const calls = [];
  const resolvedSources = [];

  await assert.rejects(
    acs.fetchTractStatsPreferred({
      signal: controller.signal,
      endpoints: { population: 'live:population', poverty: 'live:poverty' },
      reporterUrl: 'live:reporter',
      localUrl: 'local:snapshot',
      onSourceResolved: (meta) => resolvedSources.push(meta),
      fetchJsonImpl: async (url, options = {}) => {
        calls.push({ url, signal: options.signal });
        if (url === 'live:population') {
          controller.abort(reason);
          throw reason;
        }
        if (url === 'live:poverty') return [];
        throw new Error(`fallback must not run after cancellation: ${url}`);
      },
    }),
    (error) => error === reason,
  );

  assert.deepEqual(calls.map((call) => call.url), ['live:population', 'live:poverty']);
  assert.ok(calls.every((call) => call.signal === controller.signal));
  assert.deepEqual(resolvedSources, []);
});

test('ACS can use the keyless online Census Reporter feed', async () => {
  assert.match(config.CENSUS_REPORTER_ACS_URL, /^https:\/\/api\.censusreporter\.org\//);
  assert.equal(typeof acs.fetchTractStatsFromCensusReporter, 'function');

  const resolvedSources = [];
  const rows = await acs.fetchTractStatsPreferred({
    endpoints: {},
    url: 'live:census-reporter',
    reporterUrl: 'live:census-reporter',
    localUrl: 'local:snapshot',
    onSourceResolved: (meta) => resolvedSources.push(meta),
    fetchJsonImpl: async () => ({
      release: { id: 'acs2024_5yr' },
      data: {
        '14000US42101000100': {
          B01003: { estimate: { B01003001: 100 }, error: { B01003001: 7 } },
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
    population: {
      estimate: 100,
      moe90: 7,
      vintage: '2024',
      source: 'Census Reporter',
      retrievedAt: null,
      status: 'available',
    },
    renter_total: 40,
    renter_count: 20,
    median_income: 50000,
    poverty_pct: 12.5,
  }]);
  assert.deepEqual(resolvedSources, [{
    dataset: 'census-tract-statistics',
    kind: 'live',
    provider: 'Census Reporter',
    url: 'live:census-reporter',
    vintage: '2024',
    asOf: '2024-12-31',
    cacheHit: false,
  }]);
});

test('ACS keeps a usable estimate when MOE is missing and never coerces missing estimates to zero', async () => {
  const rows = await acs.fetchTractStats({
    endpoints: { population: 'live:population', poverty: 'live:poverty' },
    fetchJsonImpl: async (url) => url === 'live:population'
      ? [
          ['NAME', 'B01003_001E', 'B01003_001M', 'B25003_001E', 'B25003_003E', 'B19013_001E', 'state', 'county', 'tract'],
          ['Estimate only', '125', '', '40', '20', '50000', '42', '101', '000100'],
          ['Unavailable', '', '', '0', '0', '', '42', '101', '000200'],
        ]
      : [
          ['NAME', 'S1701_C03_001E', 'state', 'county', 'tract'],
          ['Estimate only', '12.5', '42', '101', '000100'],
          ['Unavailable', '', '42', '101', '000200'],
        ],
  });

  assert.deepEqual(rows.map(({ pop, population }) => ({ pop, population })), [
    {
      pop: 125,
      population: {
        estimate: 125,
        moe90: null,
        vintage: config.ACS_SNAPSHOT_YEAR,
        source: 'Configured Census API',
        retrievedAt: null,
        status: 'partial',
      },
    },
    {
      pop: null,
      population: {
        estimate: null,
        moe90: null,
        vintage: config.ACS_SNAPSHOT_YEAR,
        source: 'Configured Census API',
        retrievedAt: null,
        status: 'unavailable',
      },
    },
  ]);
});

test('bundled ACS 2024 snapshot has a reproducible manifest and canonical row hash', () => {
  const snapshotPath = new URL('../../src/data/acs_tracts_2024_pa101.json', import.meta.url);
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  assert.equal(snapshot.schemaVersion, 'engagement-acs-tract-population/v1');
  assert.equal(snapshot.manifest.vintage, '2024');
  assert.equal(snapshot.manifest.period, '2020-2024');
  assert.deepEqual(snapshot.manifest.variables, {
    estimate: 'B01003_001E',
    moe90: 'B01003_001M',
  });
  assert.match(snapshot.manifest.sourceUrl, /^https:\/\/www2\.census\.gov\//);
  assert.equal(snapshot.manifest.rowCount, snapshot.rows.length);
  assert.equal(snapshot.rows.length, 408);
  const rowsJson = JSON.stringify(snapshot.rows);
  assert.equal(
    `sha256:${createHash('sha256').update(rowsJson).digest('hex')}`,
    snapshot.manifest.rowsSha256,
  );
  assert.equal(snapshot.rows.every((row) => (
    /^\d{11}$/.test(row.geoid)
    && Number.isInteger(row.population?.estimate)
    && Number.isInteger(row.population?.moe90)
    && row.population.status === 'available'
  )), true);
});

test('Census Reporter cache hits preserve release vintage and as-of provenance', async () => {
  let calls = 0;
  const fetchJsonImpl = async () => {
    calls += 1;
    return {
      release: { id: 'acs2024_5yr' },
      data: {
        '14000US42101000100': {
          B01003: { estimate: { B01003001: 100 } },
          B25003: { estimate: { B25003001: 40, B25003003: 20 } },
          B19013: { estimate: { B19013001: 50000 } },
          B17001: { estimate: { B17001001: 80, B17001002: 10 } },
        },
      },
    };
  };
  const firstSources = [];
  const secondSources = [];
  const options = {
    endpoints: {},
    reporterUrl: 'live:census-reporter-cache',
    localUrl: 'local:snapshot',
    fetchJsonImpl,
  };

  const first = await acs.fetchTractStatsPreferred({
    ...options,
    onSourceResolved: (meta) => firstSources.push(meta),
  });
  const second = await acs.fetchTractStatsPreferred({
    ...options,
    onSourceResolved: (meta) => secondSources.push(meta),
  });

  assert.equal(calls, 1);
  assert.deepEqual(second, first);
  assert.deepEqual(firstSources, [{
    dataset: 'census-tract-statistics',
    kind: 'live',
    provider: 'Census Reporter',
    url: 'live:census-reporter-cache',
    vintage: '2024',
    asOf: '2024-12-31',
    cacheHit: false,
  }]);
  assert.deepEqual(secondSources, [{
    ...firstSources[0],
    cacheHit: true,
  }]);
});

test('Diary public write policy stays unavailable and no-network under injected configuration', async (t) => {
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

  const originalFetch = globalThis.fetch;
  let requests = 0;
  const request = async () => {
    requests += 1;
    return { ok: true, persisted: true };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = request;
  const localClient = diary.createDiaryClient({
    apiBase: 'https://example.test/api/diary/',
    endpoint: 'https://example.test/api/diary/public',
    request,
    fetch: request,
    adapter: { submit: request },
    capability: { publicWrite: true },
  });
  const first = await localClient.submitDiary({
    ...payload,
    notes: 'private note',
    route_geometry: { type: 'LineString', coordinates: [[-75.1, 39.9], [-75.2, 40]] },
    draft: { unfinished: true },
  });
  const second = await localClient.submitDiary(payload);
  const agree = await localClient.submitAgree('seg_1', 'demo_user', { request });
  const improve = await localClient.submitImprove('seg_1', 'demo_user', { request });
  assert.deepEqual(first, second);
  assert.deepEqual(first, agree);
  assert.deepEqual(first, improve);
  assert.equal(first.ok, false);
  assert.equal(first.status, 'unavailable');
  assert.equal(first.network, 'disabled');
  assert.equal(first.persisted, false);
  assert.equal(first.shared, false);
  assert.equal(first.mode, 'local-only');
  assert.equal(first.capability, 'unavailable');
  assert.match(first.message, /unavailable/i);
  assert.match(first.message, /no data left this browser/i);
  assert.doesNotMatch(first.message, /saved|durable|persisted|已保存/iu);
  assert.equal(requests, 0, 'legacy configuration must not upload ratings, notes, geometry, or drafts');
  assert.doesNotMatch(JSON.stringify(first), /route_demo|seg_1|private note|39\.9|2026-07-30/);
  assert.equal(Object.hasOwn(config, 'DIARY_API_BASE'), false);
});

test('legacy Diary 501 endpoints are absent from the live tree and backend docs are historical proposals', () => {
  for (const path of ['submit.js', 'segments.js', 'route.js']) {
    assert.equal(existsSync(new URL(`../../server/api/diary/${path}`, import.meta.url)), false);
  }
  for (const path of ['API_DIARY.md', 'API_BACKEND_DIARY_M2.md']) {
    const text = readFileSync(new URL(`../../docs/${path}`, import.meta.url), 'utf8');
    assert.match(text.slice(0, 500), /historical proposal/i);
    assert.match(text.slice(0, 500), /not a production capability/i);
  }
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

test('requests with caching disabled are never cached or coalesced', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let calls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  });

  Date.now = () => 1_785_369_600_000;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ call: calls }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const options = {
    method: 'POST',
    body: JSON.stringify({ rating: 4 }),
    cacheTTL: 0,
    retries: 0,
  };
  const first = await fetchJson('https://example.test/api/ratings', options);
  const second = await fetchJson('https://example.test/api/ratings', options);

  assert.equal(calls, 2);
  assert.deepEqual(first, { call: 1 });
  assert.deepEqual(second, { call: 2 });
});

test('mutation requests default to uncached semantics', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ call: calls }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const options = { method: 'POST', body: '{}' };
  const first = await fetchJson('https://example.test/api/default-mutation', options);
  const second = await fetchJson('https://example.test/api/default-mutation', options);

  assert.equal(calls, 2);
  assert.deepEqual(first, { call: 1 });
  assert.deepEqual(second, { call: 2 });
});

test('segment popup submission reports the public write as unavailable without transport access', async () => {
  const state = {
    mode: 'input',
    rating: 4,
    selectedTags: new Set(['poor_lighting']),
  };
  let renders = 0;

  const response = await submitSegmentCardFeedback({
    props: { segment_id: 'seg_popup_1' },
    state,
    submitFeedback: formSubmit.submitSegmentFeedback,
    rerender() {
      renders += 1;
    },
  });

  assert.equal(response.status, 'unavailable');
  assert.equal(response.network, 'disabled');
  assert.equal(response.persisted, false);
  assert.equal(state.mode, 'view');
  assert.equal(state.submissionResult, response);
  assert.equal(renders, 1);

  const html = buildSegmentCardHtml({ segment_id: 'seg_popup_1' }, state);
  assert.match(html, /public community feedback is deterministically unavailable/i);
  assert.doesNotMatch(html, /browser-local save could not be confirmed/i);
  assert.doesNotMatch(html, /community aggregates/i);
  assert.doesNotMatch(html, /appear in the aggregate soon/i);
});

test('segment popup submission fails closed when the Diary submit port is missing', async () => {
  const state = {
    mode: 'input',
    rating: 4,
    selectedTags: new Set(['poor_lighting']),
  };

  await assert.rejects(
    submitSegmentCardFeedback({
      props: { segment_id: 'seg_popup_missing_port' },
      state,
    }),
    /submit port is required/i,
  );
  assert.equal(state.mode, 'input');
  assert.equal(state.submissionResult, undefined);
});

test('stale segment popup submission aborts transport and commits no popup state', async () => {
  const controller = new AbortController();
  let ownerCurrent = true;
  let resolveSubmit;
  let receivedSignal;
  let renders = 0;
  let popupAdds = 0;
  const state = {
    mode: 'input',
    rating: 2,
    selectedTags: new Set(['poor_lighting']),
    submissionResult: null,
    submissionError: '',
  };
  const initialState = structuredClone({
    mode: state.mode,
    rating: state.rating,
    selectedTags: [...state.selectedTags],
    submissionResult: state.submissionResult,
    submissionError: state.submissionError,
  });
  const pending = submitSegmentCardFeedback({
    props: { segment_id: 'seg_popup_stale' },
    state,
    signal: controller.signal,
    isCurrent: () => ownerCurrent,
    submitFeedback: (_payload, { signal } = {}) => {
      receivedSignal = signal;
      return new Promise((resolve) => { resolveSubmit = resolve; });
    },
    rerender() {
      renders += 1;
      popupAdds += 1;
    },
  });

  assert.equal(receivedSignal, controller.signal);
  ownerCurrent = false;
  controller.abort(new Error('Diary session replaced'));
  resolveSubmit({ ok: true, mode: 'demo', persisted: false });
  const response = await pending;

  assert.equal(response, null);
  assert.deepEqual({
    mode: state.mode,
    rating: state.rating,
    selectedTags: [...state.selectedTags],
    submissionResult: state.submissionResult,
    submissionError: state.submissionError,
  }, initialState);
  assert.equal(renders, 0);
  assert.equal(popupAdds, 0);
});

test('a mounted segment popup has no Community CTA event seam', (t) => {
  const OriginalPopup = maplibregl.Popup;
  const popups = [];
  class FakePopup {
    constructor() {
      this.content = {
        addEventListener: (_type, handler) => { this.clickHandler = handler; },
      };
      this.card = {
        querySelectorAll: () => [],
        querySelector: () => null,
      };
      popups.push(this);
    }
    getElement() {
      return {
        querySelector: (selector) => (
          selector === '.maplibregl-popup-content' ? this.content : this.card
        ),
      };
    }
    setLngLat() { return this; }
    setHTML(html) { this.html = html; return this; }
    addTo() { this.adds = (this.adds || 0) + 1; return this; }
    on() { return this; }
    remove() { this.removed = true; return this; }
  }
  maplibregl.Popup = FakePopup;
  t.after(() => {
    maplibregl.Popup = OriginalPopup;
  });

  const sources = new Map();
  const layers = new Map();
  const layerClicks = new Map();
  const mapMutations = [];
  const map = {
    getSource: (id) => sources.get(id) || null,
    getLayer: (id) => layers.get(id) || null,
    addSource(id, specification) {
      sources.set(id, { ...specification, setData() {} });
      mapMutations.push(['addSource', id]);
    },
    addLayer(layer) {
      layers.set(layer.id, layer);
      mapMutations.push(['addLayer', layer.id]);
    },
    removeSource(id) { sources.delete(id); mapMutations.push(['removeSource', id]); },
    removeLayer(id) { layers.delete(id); mapMutations.push(['removeLayer', id]); },
    setPaintProperty() {},
    on(event, layerOrHandler, maybeHandler) {
      if (event === 'click' && typeof layerOrHandler === 'string') {
        layerClicks.set(layerOrHandler, maybeHandler);
      }
    },
    off() {},
    fitBounds() {},
    queryRenderedFeatures: () => [],
    getZoom: () => 12,
    easeTo() {},
    getCanvas: () => ({ style: {} }),
  };
  const segments = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { segment_id: 'seg-owner', street_name: 'Owner Street', decayed_mean: 3, n_eff: 1 },
      geometry: { type: 'LineString', coordinates: [[-75.17, 39.95], [-75.16, 39.96]] },
    }],
  };
  const clickPopup = () => layerClicks.get('diary-segments-hit')({
    features: [structuredClone(segments.features[0])],
    lngLat: { lng: -75.16, lat: 39.95 },
  });
  const ownerA = new AbortController();
  const aCommits = [];
  mountSegmentsLayer(map, 'diary-segments', segments, {
    signal: ownerA.signal,
    isCurrent: () => true,
    onAction: (payload) => aCommits.push(payload),
  });
  clickPopup();
  const popupA = popups.at(-1);
  assert.equal(popupA.clickHandler, undefined);
  assert.match(popupA.html, /data-sample-status="static-invented-read-only"/);
  assert.doesNotMatch(popupA.html, /data-diary-action|enter-edit|submit-feedback|Add Feedback|Experience improved/iu);
  assert.deepEqual(aCommits, []);
  removeSegmentsLayer(map, 'diary-segments');
});

test('an already-aborted caller wins before cache lookup or fetch', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ source: 'network' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const url = 'https://example.test/api/already-aborted';
  await fetchJson(url, { cacheTTL: 60_000, retries: 0 });
  const controller = new AbortController();
  const reason = new Error('caller stopped');
  controller.abort(reason);

  await assert.rejects(
    fetchJson(url, { cacheTTL: 60_000, retries: 0, signal: controller.signal }),
    (error) => error === reason,
  );
  assert.equal(calls, 1);
});

test('caller cancellation reaches the final fetch signal before the attempt timeout', async (t) => {
  const originalFetch = globalThis.fetch;
  let receivedSignal;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_url, options) => {
    receivedSignal = options.signal;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  };

  const controller = new AbortController();
  const reason = new Error('caller cancelled');
  const request = fetchJson('https://example.test/api/caller-cancel', {
    cacheTTL: 0,
    retries: 0,
    timeoutMs: 50,
    signal: controller.signal,
  });
  controller.abort(reason);

  await assert.rejects(request, (error) => error === reason);
  assert.ok(receivedSignal instanceof AbortSignal);
  assert.equal(receivedSignal.aborted, true);
  assert.equal(receivedSignal.reason, reason);
});

test('caller cancellation is not retried even when its reason is an AbortError', async (t) => {
  const originalFetch = globalThis.fetch;
  const nodeVersionDescriptor = Object.getOwnPropertyDescriptor(process.versions, 'node');
  let calls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(process.versions, 'node', nodeVersionDescriptor);
  });
  Object.defineProperty(process.versions, 'node', {
    value: undefined,
    configurable: true,
    enumerable: true,
  });

  globalThis.fetch = async (_url, options) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  };

  const controller = new AbortController();
  const reason = new DOMException('caller cancelled', 'AbortError');
  const request = fetchJson('https://example.test/api/no-retry-after-cancel', {
    cacheTTL: 0,
    retries: 1,
    timeoutMs: 10,
    signal: controller.signal,
  });
  controller.abort(reason);

  await assert.rejects(request, (error) => error === reason);
  assert.equal(calls, 1);
});

test('caller cancellation interrupts an in-progress retry backoff', async (t) => {
  const originalFetch = globalThis.fetch;
  const nodeVersionDescriptor = Object.getOwnPropertyDescriptor(process.versions, 'node');
  let calls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(process.versions, 'node', nodeVersionDescriptor);
  });
  Object.defineProperty(process.versions, 'node', {
    value: undefined,
    configurable: true,
    enumerable: true,
  });

  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ call: calls }), {
      status: calls === 1 ? 503 : 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const controller = new AbortController();
  const reason = new Error('stop during backoff');
  const request = fetchJson('https://example.test/api/abort-backoff', {
    cacheTTL: 0,
    retries: 1,
    timeoutMs: 0,
    signal: controller.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(reason);

  const quickOutcome = await Promise.race([
    request.then(
      (value) => ({ type: 'resolved', value }),
      (error) => ({ type: 'rejected', error }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ type: 'pending' }), 50)),
  ]);
  const finalOutcome = await request.then(
    (value) => ({ type: 'resolved', value }),
    (error) => ({ type: 'rejected', error }),
  );

  assert.deepEqual(quickOutcome, { type: 'rejected', error: reason });
  assert.deepEqual(finalOutcome, { type: 'rejected', error: reason });
  assert.equal(calls, 1);
});

test('a caller-owned signal bypasses shared inflight deduplication', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_url, options) => {
    calls += 1;
    if (calls === 1) {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    }
    return new Response(JSON.stringify({ call: calls }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const controller = new AbortController();
  const reason = new Error('cancel only the first caller');
  const first = fetchJson('https://example.test/api/signal-inflight', {
    cacheTTL: 60_000,
    retries: 0,
    timeoutMs: 0,
    signal: controller.signal,
  });
  const second = fetchJson('https://example.test/api/signal-inflight', {
    cacheTTL: 60_000,
    retries: 0,
    timeoutMs: 0,
  });
  controller.abort(reason);

  await assert.rejects(first, (error) => error === reason);
  assert.deepEqual(await second, { call: 2 });
  assert.equal(calls, 2);
});

test('an active caller signal can still use a completed cache entry', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ call: calls }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const url = 'https://example.test/api/signal-cache-hit';
  const cached = await fetchJson(url, { cacheTTL: 60_000, retries: 0 });
  const controller = new AbortController();
  const result = await fetchJson(url, {
    cacheTTL: 60_000,
    retries: 0,
    signal: controller.signal,
  });

  assert.deepEqual(result, cached);
  assert.equal(calls, 1);
});

test('an attempt timeout remains retryable', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const nodeVersionDescriptor = Object.getOwnPropertyDescriptor(process.versions, 'node');
  let calls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    Object.defineProperty(process.versions, 'node', nodeVersionDescriptor);
  });
  Object.defineProperty(process.versions, 'node', {
    value: undefined,
    configurable: true,
    enumerable: true,
  });
  globalThis.setTimeout = (callback, delay, ...args) => (
    originalSetTimeout(callback, delay >= 1000 ? 0 : delay, ...args)
  );

  globalThis.fetch = async (_url, options) => {
    calls += 1;
    if (calls === 1) {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    }
    return new Response(JSON.stringify({ call: calls }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await fetchJson('https://example.test/api/timeout-retry', {
    cacheTTL: 0,
    retries: 1,
    timeoutMs: 5,
  });

  assert.deepEqual(result, { call: 2 });
  assert.equal(calls, 2);
});

test('an exhausted attempt timeout is reported as TimeoutError', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });

  await assert.rejects(
    fetchJson('https://example.test/api/timeout-classification', {
      cacheTTL: 0,
      retries: 0,
      timeoutMs: 5,
    }),
    (error) => error?.name === 'TimeoutError',
  );
});

test('a browser-style generic AbortError still preserves an internally owned timeout', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      reject(new DOMException('The user aborted a request.', 'AbortError'));
    }, { once: true });
  });

  await assert.rejects(
    fetchJson('https://example.test/api/browser-timeout-classification', {
      cacheTTL: 0,
      retries: 0,
      timeoutMs: 5,
    }),
    (error) => error?.name === 'TimeoutError',
  );
});

test('caller cancellation during deferred JSON parsing neither returns nor caches data', async (t) => {
  const originalFetch = globalThis.fetch;
  let resolveJson;
  let calls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: true,
        json: () => new Promise((resolve) => { resolveJson = resolve; }),
      };
    }
    return new Response(JSON.stringify({ source: 'second-network-call' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const url = 'https://example.test/api/deferred-json-cancel';
  const controller = new AbortController();
  const reason = new Error('cancel during JSON parsing');
  const request = fetchJson(url, {
    cacheTTL: 60_000,
    retries: 0,
    timeoutMs: 0,
    signal: controller.signal,
  });
  await Promise.resolve();
  controller.abort(reason);
  resolveJson({ source: 'stale-json' });

  await assert.rejects(request, (error) => error === reason);
  assert.deepEqual(
    await fetchJson(url, { cacheTTL: 60_000, retries: 0, timeoutMs: 0 }),
    { source: 'second-network-call' },
  );
  assert.equal(calls, 2);
});

test('attempt timer and caller listener are released before retry backoff ownership begins', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const nodeVersionDescriptor = Object.getOwnPropertyDescriptor(process.versions, 'node');
  const controller = new AbortController();
  const signal = controller.signal;
  const originalAdd = signal.addEventListener.bind(signal);
  const originalRemove = signal.removeEventListener.bind(signal);
  const listenerEvents = [];
  const timers = [];
  const clearedTimers = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    Object.defineProperty(process.versions, 'node', nodeVersionDescriptor);
  });
  Object.defineProperty(process.versions, 'node', {
    value: undefined,
    configurable: true,
    enumerable: true,
  });
  Object.defineProperties(signal, {
    addEventListener: {
      value(type, listener, options) {
        listenerEvents.push(['add', type, listener]);
        return originalAdd(type, listener, options);
      },
    },
    removeEventListener: {
      value(type, listener, options) {
        listenerEvents.push(['remove', type, listener]);
        return originalRemove(type, listener, options);
      },
    },
  });
  globalThis.setTimeout = (callback, delay) => {
    const timer = { callback, delay };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    clearedTimers.push(timer);
  };
  globalThis.fetch = async () => new Response('{}', {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });

  const reason = new Error('stop retry ownership test');
  const request = fetchJson('https://example.test/api/retry-ownership', {
    cacheTTL: 0,
    retries: 1,
    timeoutMs: 50,
    signal,
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(timers.map((timer) => timer.delay), [50, 1000]);
  assert.equal(clearedTimers.includes(timers[0]), true);
  assert.deepEqual(listenerEvents.slice(0, 3).map(([action, type]) => [action, type]), [
    ['add', 'abort'],
    ['remove', 'abort'],
    ['add', 'abort'],
  ]);

  controller.abort(reason);
  await assert.rejects(request, (error) => error === reason);
});

test('a caller aborted between backoff completion and the next attempt is forwarded immediately', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const nodeVersionDescriptor = Object.getOwnPropertyDescriptor(process.versions, 'node');
  const timers = [];
  let calls = 0;
  let secondSignal;
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    Object.defineProperty(process.versions, 'node', nodeVersionDescriptor);
  });
  Object.defineProperty(process.versions, 'node', {
    value: undefined,
    configurable: true,
    enumerable: true,
  });
  globalThis.setTimeout = (callback, delay) => {
    const timer = { callback, delay };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = () => {};
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    if (calls === 1) {
      return new Response('{}', {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    secondSignal = options.signal;
    if (secondSignal.aborted) throw secondSignal.reason;
    return new Response(JSON.stringify({ call: calls }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const controller = new AbortController();
  const reason = new Error('cancel between attempts');
  const request = fetchJson('https://example.test/api/between-attempts', {
    cacheTTL: 0,
    retries: 1,
    timeoutMs: 0,
    signal: controller.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers[0]?.delay, 1000);

  timers[0].callback();
  controller.abort(reason);

  await assert.rejects(request, (error) => error === reason);
  assert.equal(calls, 2);
  assert.equal(secondSignal.aborted, true);
  assert.equal(secondSignal.reason, reason);
});

test('cancelling a later signalled request does not affect an existing shared inflight request', async (t) => {
  const originalFetch = globalThis.fetch;
  let resolveFirst;
  let calls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_url, options) => {
    calls += 1;
    if (calls === 1) {
      return new Promise((resolve) => { resolveFirst = resolve; });
    }
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  };

  const url = 'https://example.test/api/existing-inflight';
  const shared = fetchJson(url, {
    cacheTTL: 60_000,
    retries: 0,
    timeoutMs: 0,
  });
  const controller = new AbortController();
  const reason = new Error('cancel only the later request');
  const cancellable = fetchJson(url, {
    cacheTTL: 60_000,
    retries: 0,
    timeoutMs: 0,
    signal: controller.signal,
  });
  controller.abort(reason);
  resolveFirst(new Response(JSON.stringify({ source: 'shared-request' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));

  await assert.rejects(cancellable, (error) => error === reason);
  assert.deepEqual(await shared, { source: 'shared-request' });
  assert.equal(calls, 2);
});
