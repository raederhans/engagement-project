#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createDiaryClient,
  submitAgree,
  submitDiary,
  submitImprove,
} from '../../src/api/diary.js';
import { messages } from '../../src/i18n/messages.js';
import '../../src/i18n/p1.js';
import {
  runRatingSubmission,
  submitSegmentFeedback,
} from '../../src/routes_diary/form_submit.js';
import * as myRoutes from '../../src/routes_diary/my_routes.js';

const EXPECTED_PUBLIC_WRITE_UNAVAILABLE = {
  ok: false,
  status: 'unavailable',
  mode: 'local-only',
  capability: 'unavailable',
  network: 'disabled',
  persisted: false,
  shared: false,
  message: 'Public Diary and Community submissions are unavailable. No data left this browser.',
};

test('static Diary public writes are deterministically unavailable with zero transport access', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.VITE_DIARY_API_BASE;
  const originalConsole = {
    error: console.error,
    info: console.info,
    log: console.log,
    warn: console.warn,
  };
  const logs = [];
  let transports = 0;
  const transport = () => {
    transports += 1;
    return {
      then(resolve) {
        resolve({ ok: true, persisted: true, capability: 'public-write' });
      },
    };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    Object.assign(console, originalConsole);
    if (originalEnv === undefined) delete process.env.VITE_DIARY_API_BASE;
    else process.env.VITE_DIARY_API_BASE = originalEnv;
  });
  globalThis.fetch = transport;
  for (const method of Object.keys(originalConsole)) {
    console[method] = (...args) => logs.push([method, args]);
  }
  process.env.VITE_DIARY_API_BASE = 'https://hostile.invalid/private?upload=1';
  const client = createDiaryClient({
    apiBase: 'https://hostile.invalid/private?upload=1',
    endpoint: 'https://hostile.invalid/community',
    request: transport,
    fetch: transport,
    adapter: { submit: transport },
    capability: {
      publicWrite: true,
      moderation: true,
      abusePrevention: true,
      deletion: true,
      kAnonymity: true,
      dataAuthority: true,
    },
    telemetry: { emit: transport },
    logger: { info: transport },
    shareState: { set: transport },
  });

  const privatePayload = {
    route_id: 'route-sentinel-%F0%9F%94%92',
    routeId: 'routeCamel-sentinel-%F0%9F%94%92',
    address: 'address-sentinel-%F0%9F%94%92',
    start_address: 'snake-address-sentinel-%F0%9F%94%92',
    startAddress: 'camel-address-sentinel-%F0%9F%94%92',
    coordinates: [[-75.123456, 39.987654]],
    route_geometry: 'snake-geometry-sentinel-%F0%9F%94%92',
    routeGeometry: 'camel-geometry-sentinel-%F0%9F%94%92',
    notes: 'notes-sentinel-%F0%9F%94%92',
    timestamp: 'timestamp-sentinel-%F0%9F%94%92',
    created_at: 'snake-time-sentinel-%F0%9F%94%92',
    createdAt: 'camel-time-sentinel-%F0%9F%94%92',
  };
  const hostileOptions = {
    endpoint: 'https://hostile.invalid/submit',
    request: transport,
    fetch: transport,
    adapter: transport,
    capability: 'public-write',
    telemetry: { emit: transport },
    logger: { info: transport },
    shareState: { set: transport },
  };
  const pending = client.submitDiary(privatePayload, hostileOptions);
  privatePayload.notes = 'caller-mutated-notes';
  privatePayload.coordinates[0][0] = 999;

  const results = await Promise.all([
    pending,
    client.submitAgree(privatePayload, hostileOptions),
    client.submitImprove(privatePayload, hostileOptions),
    submitDiary(privatePayload, hostileOptions),
    submitAgree(privatePayload, hostileOptions),
    submitImprove(privatePayload, hostileOptions),
    submitSegmentFeedback(privatePayload, { submit: transport, request: transport, ...hostileOptions }),
  ]);

  assert.equal(transports, 0);
  assert.equal(logs.length, 0);
  for (const result of results) {
    assert.deepEqual(result, EXPECTED_PUBLIC_WRITE_UNAVAILABLE);
    assert.equal(Object.isFrozen(result), true);
    assert.doesNotMatch(result.message, /queue|later|upload|accepted|agreed|will be sent|稍后|排队|上传|已同意/iu);
    assert.doesNotMatch(JSON.stringify(result), /sentinel|999|hostile\.invalid|route_id|routeId|address|coordinates|geometry|notes|timestamp|created_at|createdAt/i);
  }
  assert.equal(results.every((result) => result === results[0]), true);
  assert.throws(() => { results[0].status = 'available'; }, TypeError);
});

test('legacy My Routes entry points are inert, deterministic, and silent for private route identifiers', () => {
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const logs = [];
  console.warn = (...args) => logs.push(args);
  console.info = (...args) => logs.push(args);
  try {
    const privateId = 'route-address-coordinate-notes-time-%F0%9F%94%92';
    const results = [
      myRoutes.openMyRoutesPanel({ endpoint: 'https://hostile.invalid', routeId: privateId }),
      myRoutes.closeMyRoutesPanel(privateId),
      myRoutes.loadRoute(privateId, { request() { throw new Error('must not run'); } }),
      myRoutes.deleteRoute(privateId, { fetch() { throw new Error('must not run'); } }),
    ];

    assert.equal(logs.length, 0);
    assert.equal(results.every((result) => result === results[0]), true);
    assert.equal(Object.isFrozen(results[0]), true);
    assert.equal(results[0].status, 'unavailable');
    assert.equal(results[0].network, 'disabled');
    assert.doesNotMatch(JSON.stringify(results), /sentinel|hostile\.invalid|route-address/i);
  } finally {
    console.warn = originalWarn;
    console.info = originalInfo;
  }
});

test('rating local commit ignores hostile submit seams and snapshots caller-owned private data', async (t) => {
  const originalFetch = globalThis.fetch;
  let transports = 0;
  let committedPayload;
  const transport = () => {
    transports += 1;
    return {
      then(resolve) {
        resolve({ ok: true, persisted: true, shared: true });
      },
    };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = transport;

  const payload = {
    route_id: 'route-sentinel-%F0%9F%94%92',
    routeId: 'route-camel-sentinel-%F0%9F%94%92',
    notes: 'notes-sentinel-%F0%9F%94%92',
    coordinates: [[-75.123456, 39.987654]],
    timestamp: 'time-sentinel-%F0%9F%94%92',
  };
  const state = { pending: false, signal: new AbortController().signal };
  const options = {
    state,
    payload,
    commit: async ({ payload: localPayload }) => {
      committedPayload = localPayload;
      return { applied: true };
    },
    request: transport,
    adapter: transport,
    endpoint: 'https://hostile.invalid/private',
    capability: { publicWrite: true },
  };
  Object.defineProperty(options, 'submit', {
    enumerable: true,
    get() {
      transports += 1;
      return transport;
    },
  });

  const pending = runRatingSubmission(options);
  payload.notes = 'caller-mutated-notes';
  payload.coordinates[0][0] = 999;
  const result = await pending;

  assert.equal(transports, 0);
  assert.deepEqual(result.response, EXPECTED_PUBLIC_WRITE_UNAVAILABLE);
  assert.deepEqual(committedPayload, {
    route_id: 'route-sentinel-%F0%9F%94%92',
    routeId: 'route-camel-sentinel-%F0%9F%94%92',
    notes: 'notes-sentinel-%F0%9F%94%92',
    coordinates: [[-75.123456, 39.987654]],
    timestamp: 'time-sentinel-%F0%9F%94%92',
  });
  assert.notEqual(committedPayload, payload);
  assert.equal(Object.hasOwn(state, 'submissionReceipt'), false);
  assert.doesNotMatch(JSON.stringify(result.response), /sentinel|999|hostile\.invalid|route_id|routeId|notes|coordinates|timestamp/i);
});

test('live tree has no Diary 501 endpoints and legacy API configuration is absent', async () => {
  const configSource = await readFile(new URL('../../src/config.js', import.meta.url), 'utf8');
  assert.doesNotMatch(configSource, /VITE_DIARY_API_BASE|DIARY_API_BASE/);
  for (const path of ['submit.js', 'segments.js', 'route.js']) {
    assert.equal(existsSync(new URL(`../../server/api/diary/${path}`, import.meta.url)), false);
  }
  for (const path of ['API_DIARY.md', 'API_BACKEND_DIARY_M2.md']) {
    const text = await readFile(new URL(`../../docs/${path}`, import.meta.url), 'utf8');
    assert.match(text.slice(0, 500), /historical proposal/i);
    assert.match(text.slice(0, 500), /not a production capability/i);
  }
});

test('owned Diary write surfaces contain no hidden HTTP or telemetry fallback', async () => {
  const sources = await Promise.all([
    readFile(new URL('../../src/api/diary.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_diary/form_submit.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_diary/my_routes.js', import.meta.url), 'utf8'),
  ]);
  const combined = sources.join('\n');

  assert.doesNotMatch(combined, /https?:\/\/|["'`]\/api\/diary|fetchJson|\bfetch\s*\(|XMLHttpRequest|sendBeacon|navigator\.share/i);
  assert.doesNotMatch(combined, /submissionReceipt|updated_segments|submission_id|saved_route_id/);
});

test('Diary demo has a truthful static document title before translations load', async () => {
  const demoHtml = await readFile(new URL('../../diary-demo.html', import.meta.url), 'utf8');
  assert.match(
    demoHtml,
    /<title\s+data-i18n=["']diary\.demoDocumentTitle["']>Route Experience Diary Demo<\/title>/i,
  );
  assert.doesNotMatch(demoHtml, /<title[^>]*>[^<]*Route Safety Diary[^<]*<\/title>/i);
  assert.equal(messages.en['diary.demoDocumentTitle'], 'Route Experience Diary Demo');
  assert.equal(messages['zh-CN']['diary.demoDocumentTitle'], '路线体验日记演示');
});

test('Diary copy and Sample Community presentation are personal, illustrative, and neutral', async () => {
  const [html, communitySource, css] = await Promise.all([
    readFile(new URL('../../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_diary/ui_community_panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/styles/diary-map-ui.css', import.meta.url), 'utf8'),
  ]);
  for (const locale of ['en', 'zh-CN']) {
    assert.match(messages[locale]['diary.title'], locale === 'en' ? /Route Experience Diary/ : /路线体验日记/);
    const diaryCopy = Object.entries(messages[locale])
      .filter(([key]) => /^(diary|rating|segment)\./.test(key))
      .map(([, value]) => value)
      .join('\n');
    assert.doesNotMatch(
      diaryCopy,
      /Route Safety Diary|safety score|community safety score|High risk|Moderate risk|Generally safe|safer route|safest route|路线安全日记|安全评分|社区安全评分|高风险|中等风险|总体安全/iu,
    );
  }
  assert.match(html, /browser-local route experience diary/i);
  assert.doesNotMatch(communitySource, /is-good|is-mid|is-bad/);
  assert.match(communitySource, /is-order-low|is-order-middle|is-order-high/);
  assert.doesNotMatch(css, /\.diary-score-pill\.is-(?:good|mid|bad)/);
  assert.match(css, /\.diary-score-pill\.is-order-low/);
});
