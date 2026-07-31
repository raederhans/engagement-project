#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { store } from '../../src/state/store.js';
import { escapeHtml } from '../../src/utils/html.js';
import { matchPathToSegments } from '../../src/utils/match.js';
import { estimatePopInBuffer } from '../../src/utils/pop_buffer.js';
import { createLatestSerialQueue } from '../../src/utils/latest_serial_queue.js';
import { parsePreviewArgs, resolvePreviewData, toViteFsUrl } from '../quick_preview.mjs';
import { refreshPoints } from '../../src/map/points.js';
import { buildSegmentCardHtml } from '../../src/map/segments_layer.js';
import { attachDistrictPopup } from '../../src/map/ui_popup_district.js';
import { applyRecentPreset } from '../../src/ui/panel.js';
import {
  buildCountBufferSQL,
  buildHeatmap7x24TractSQL,
  buildMonthlyTractSQL,
  buildTopTypesTractSQL,
  envelopeClause,
} from '../../src/utils/sql.js';

const polygon = {
  type: 'Polygon',
  coordinates: [[
    [-75.2, 39.9],
    [-75.1, 39.9],
    [-75.1, 40.0],
    [-75.2, 40.0],
    [-75.2, 39.9],
  ]],
};

test('recent-window presets synchronize state and visible controls', () => {
  const state = { coverageMax: '2026-07-30', startMonth: null, durationMonths: 6 };
  const startMonthInput = { value: '' };
  const durationSelect = { value: '6' };

  applyRecentPreset(state, 12, { startMonthInput, durationSelect });

  assert.deepEqual(state, {
    coverageMax: '2026-07-30',
    startMonth: '2025-08',
    durationMonths: 12,
  });
  assert.equal(startMonthInput.value, '2025-08');
  assert.equal(durationSelect.value, '12');
});

test('quick preview resolves and validates a diary data directory', () => {
  const options = parsePreviewArgs(['--data', 'data', '--no-open', '--port=5174']);
  const data = resolvePreviewData(options);

  assert.match(data.segments, /segments_phl\.demo\.geojson$/);
  assert.match(data.routes, /routes_phl\.demo\.geojson$/);
  assert.match(toViteFsUrl(data.segments), /^\/@fs\//);
  assert.equal(options.open, false);
  assert.equal(options.port, 5174);
});

test('EPSG:3857 buffer filters use the CARTO web-mercator geometry column', () => {
  assert.match(
    envelopeClause([-8_370_000, 4_850_000, -8_360_000, 4_860_000]),
    /the_geom_webmercator && ST_MakeEnvelope\([^)]*, 3857\)/,
  );
  const sql = buildCountBufferSQL({
    start: '2026-01-01',
    end: '2026-02-01',
    center3857: [-8_365_000, 4_855_000],
    radiusM: 400,
  });
  assert.match(sql, /ST_DWithin\(the_geom_webmercator,/);
});

test('tract filters keep both the envelope and polygon in EPSG:4326', () => {
  const builders = [buildMonthlyTractSQL, buildTopTypesTractSQL, buildHeatmap7x24TractSQL];
  for (const build of builders) {
    const sql = build({
      start: '2026-01-01',
      end: '2026-02-01',
      tractGEOID: '42101000100',
      tractGeometry: polygon,
    });
    assert.match(sql, /the_geom && ST_MakeEnvelope\(-75\.2, 39\.9, -75\.1, 40, 4326\)/);
    assert.match(sql, /ST_Intersects\(the_geom, ST_SetSRID\(ST_GeomFromGeoJSON/);
    assert.doesNotMatch(sql, /ST_Transform\(ST_MakeEnvelope/);
  }
});

test('month duration uses an exclusive boundary after exactly N calendar months', () => {
  const originalStart = store.startMonth;
  const originalDuration = store.durationMonths;
  try {
    store.startMonth = '2026-01';
    store.durationMonths = 6;
    assert.deepEqual(store.getStartEnd(), {
      start: '2026-01-01',
      end: '2026-07-01',
    });
  } finally {
    store.startMonth = originalStart;
    store.durationMonths = originalDuration;
  }
});

test('external text is escaped before it enters HTML templates', () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('xss')">&`),
    '&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;&amp;',
  );
});

test('unfinished map matching never returns fabricated segment IDs', () => {
  assert.throws(
    () => matchPathToSegments([], { type: 'FeatureCollection', features: [] }),
    /not implemented/i,
  );
});

test('buffer population joins ACS rows to tract geometry by GEOID', async () => {
  const result = await estimatePopInBuffer({
    center3857: [0, 0],
    radiusM: 1000,
    fetchTracts: async () => ({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { GEOID: '42101000100' },
        geometry: {
          type: 'Polygon',
          coordinates: [[[-0.001, -0.001], [0.001, -0.001], [0.001, 0.001], [-0.001, 0.001], [-0.001, -0.001]]],
        },
      }],
    }),
    fetchStats: async () => [{ geoid: '42101000100', pop: 1234 }],
  });

  assert.deepEqual(result, { pop: 1234, tractsChecked: 1 });
});

test('latest mode transitions run serially and stale work cannot commit', async () => {
  let releaseFirst;
  let running = 0;
  let maxRunning = 0;
  const committed = [];
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const schedule = createLatestSerialQueue(async (mode, { isLatest }) => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    if (mode === 'first') await firstGate;
    if (isLatest()) committed.push(mode);
    running -= 1;
  });

  const first = schedule('first');
  const second = schedule('second');
  await Promise.resolve();
  assert.equal(maxRunning, 1);
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(maxRunning, 1);
  assert.deepEqual(committed, ['second']);
});

test('stale point responses never mutate map sources or layers', async () => {
  let resolvePoints;
  let active = true;
  const pointResponse = new Promise((resolve) => { resolvePoints = resolve; });
  const mutations = [];
  const map = {
    getBounds: () => ({ getWest: () => -75.2, getSouth: () => 39.9, getEast: () => -75.1, getNorth: () => 40 }),
    getSource: () => null,
    getLayer: () => null,
    addSource: (...args) => mutations.push(['source', ...args]),
    addLayer: (...args) => mutations.push(['layer', ...args]),
  };

  const refresh = refreshPoints(map, {
    start: '2026-01-01',
    end: '2026-02-01',
    fetchPointsImpl: () => pointResponse,
    shouldApply: () => active,
  });
  active = false;
  resolvePoints({ type: 'FeatureCollection', features: [] });
  await refresh;
  assert.deepEqual(mutations, []);
});

test('segment popup escapes external tag labels at the actual HTML sink', () => {
  const html = buildSegmentCardHtml({
    segment_id: 'seg-1',
    street_name: 'Safe street',
    decayed_mean: 3,
    n_eff: 5,
    top_tags: [{ tag: '<img src=x onerror=alert(1)>', p: '<svg onload=alert(2)>' }],
  });
  assert.doesNotMatch(html, /<img|<svg/i);
  assert.match(html, /&lt;img/);
});

test('segment CTA state comes from feature data without reading window globals', () => {
  const originalWindow = globalThis.window;
  globalThis.window = new Proxy({}, {
    get(_target, property) {
      throw new Error(`unexpected window read: ${String(property)}`);
    },
  });
  try {
    const html = buildSegmentCardHtml({
      segment_id: 'seg-cta',
      street_name: 'Explicit state street',
      decayed_mean: 3,
      n_eff: 5,
      __diaryVotes: { agreeDisabled: true, saferDisabled: false },
    });
    assert.match(html, /data-diary-action="agree"[^>]*disabled/);
    assert.doesNotMatch(html, /data-diary-action="safer"[^>]* disabled/);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('disposed district popup ignores a late network response', async (t) => {
  const originalStartMonth = store.startMonth;
  const originalDurationMonths = store.durationMonths;
  t.after(() => {
    store.startMonth = originalStartMonth;
    store.durationMonths = originalDurationMonths;
  });
  store.startMonth = '2026-01';
  store.durationMonths = 1;
  let clickHandler;
  let resolveDistricts;
  let resolveTopTypes;
  let popupCreations = 0;
  const districts = new Promise((resolve) => { resolveDistricts = resolve; });
  const topTypes = new Promise((resolve) => { resolveTopTypes = resolve; });
  const map = {
    on(event, layer, handler) { if (event === 'click' && layer === 'districts-fill') clickHandler = handler; },
    off() {},
  };
  const cleanup = attachDistrictPopup(map, 'districts-fill', {
    fetchByDistrictImpl: () => districts,
    fetchTopTypesByDistrictImpl: () => topTypes,
    createPopup: () => {
      popupCreations += 1;
      return {};
    },
  });
  const click = clickHandler({
    features: [{ properties: { DIST_NUMC: '01', name: 'District 1' } }],
    lngLat: { lng: -75.16, lat: 39.95 },
  });
  cleanup();
  resolveDistricts({ rows: [{ dc_dist: '01', n: 5 }] });
  resolveTopTypes({ rows: [] });
  await click;
  assert.equal(popupCreations, 0);
});
