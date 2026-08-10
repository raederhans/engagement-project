#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createDiaryClient } from '../../src/api/diary.js';
import { messages } from '../../src/i18n/messages.js';
import '../../src/i18n/p1.js';

test('static Diary capability ignores legacy remote configuration and keeps private fields local', async () => {
  let requests = 0;
  const client = createDiaryClient({
    apiBase: 'https://example.test/api/diary',
    request: async () => { requests += 1; },
  });
  const result = await client.submitDiary({
    overall_rating: 4,
    segment_ids: ['segment-1'],
    notes: 'private note',
    route_geometry: { type: 'LineString', coordinates: [[-75.1, 39.9], [-75.2, 40]] },
    draft: { unfinished: true },
  });

  assert.equal(requests, 0);
  assert.equal(result.capability, 'local-only');
  assert.equal(result.persisted, false);
  assert.match(result.message, /browser session/i);
  assert.match(result.message, /no remote data was written/i);
  assert.doesNotMatch(result.message, /saved|durable|persisted|已保存/iu);
  assert.equal(Object.hasOwn(result, 'notes'), false);
  assert.equal(Object.hasOwn(result, 'route_geometry'), false);
  assert.equal(Object.hasOwn(result, 'draft'), false);
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
