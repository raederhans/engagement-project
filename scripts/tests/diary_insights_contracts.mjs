#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readProductCss } from './helpers/css_source.mjs';

import {
  deriveLocalDiaryInsights,
  describeDiaryInsightsContext,
  normalizeDiaryInsightsContext,
  renderInsightsSections,
  selectDiaryInsightEntries,
  setDiaryInsightEntries,
} from '../../src/charts/diary_insights.js';
import { applyTranslations, setLanguage, t } from '../../src/i18n/index.js';
import { createDiaryInsightsPort } from '../../src/routes_diary/diary_insights_port.js';
import { createDiaryLocalController } from '../../src/routes_diary/diary_local_controller.js';
import { publishDiarySnapshotToInsights } from '../../src/routes_diary/index.js';
import { createDiaryInsightsHost } from '../../src/routes_diary/ui_insights_panel.js';
import {
  createSampleCommunityModel,
  renderCommunityPanel,
} from '../../src/routes_diary/ui_community_panel.js';

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  toggle(value, force) {
    if (force === false) this.values.delete(value);
    else if (force === true || !this.values.has(value)) this.values.add(value);
    else this.values.delete(value);
  }
}

class FakeElement extends EventTarget {
  constructor(tagName = 'div') {
    super();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.classList = new FakeClassList();
    this.className = '';
    this.hidden = false;
    this.id = '';
    this.style = {};
    this.textContent = '';
    this.value = '';
    this.attributes = new Map();
    this.dataset = {};
  }

  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  matches(selector) {
    const match = /^\[([^\]]+)\]$/.exec(selector);
    return Boolean(match && this.attributes.has(match[1]));
  }
  querySelectorAll(selector) {
    return descendants(this).slice(1).filter((element) => element.matches(selector));
  }
  set innerHTML(value) { if (value === '') this.children = []; }
  get innerHTML() { return ''; }
  set title(value) { this.setAttribute('title', value); }
  get title() { return this.getAttribute('title') || ''; }
}

function descendants(root) {
  return [root, ...root.children.flatMap((child) => descendants(child))];
}

function classTokens(element) {
  return new Set([
    ...String(element.className || '').split(/\s+/).filter(Boolean),
    ...element.classList.values,
  ]);
}

function surfaceText(root) {
  return descendants(root).flatMap((element) => [
    element.textContent,
    ...element.attributes.values(),
    ...Object.values(element.dataset),
  ]).filter(Boolean).join('\n');
}

function readerText(root) {
  return descendants(root).map((element) => element.textContent).filter(Boolean).join('\n');
}

function elementsWithClass(root, className) {
  return descendants(root).filter((element) => classTokens(element).has(className));
}

test('Live insights use only the current route without mutating local entries', () => {
  const entries = [
    { id: 'one', routeId: 'route-1', score: 3 },
    { id: 'two', routeId: 'route-2', score: 5 },
    { id: 'three', routeId: 'route-1', score: 4 },
  ];
  const snapshot = structuredClone(entries);

  const selected = selectDiaryInsightEntries(entries, { mode: 'live', routeId: 'route-1' });

  assert.deepEqual(selected.map((entry) => entry.id), ['one', 'three']);
  assert.notEqual(selected, entries);
  assert.deepEqual(entries, snapshot);
});

test('History insights use all local entries and Community remains sample-scoped', () => {
  const entries = [
    { id: 'one', routeId: 'route-1', score: 3 },
    { id: 'two', routeId: 'route-2', score: 5 },
  ];

  assert.deepEqual(
    selectDiaryInsightEntries(entries, { mode: 'history', routeId: 'route-1' }),
    entries,
  );
  assert.deepEqual(selectDiaryInsightEntries(entries, { mode: 'community' }), []);
});

test('Diary insight context titles and empty states state their actual scope', () => {
  assert.deepEqual(describeDiaryInsightsContext({ mode: 'live', routeId: 'route-1' }), {
    title: 'Current route insights',
    hint: 'Local ratings for this route',
    intro: 'Patterns from ratings saved for the selected route on this device.',
    emptyTrend: 'No ratings saved for this route in this period.',
    emptyTags: 'No tags saved for this route in this period.',
  });
  assert.deepEqual(describeDiaryInsightsContext({ mode: 'history' }), {
    title: 'Your local patterns',
    hint: 'All ratings saved on this device',
    intro: 'Patterns across all of your locally saved route ratings.',
    emptyTrend: 'No local ratings saved in this period.',
    emptyTags: 'No local tags saved in this period.',
  });
  assert.deepEqual(describeDiaryInsightsContext({ mode: 'community' }), {
    title: 'Illustrative sample patterns',
    hint: 'Static examples · no live community feed',
    intro: 'Static examples: not real-time, not user-submitted, and not safety/risk ratings.',
    emptyTrend: 'No sample ratings are available.',
    emptyTags: 'No sample tags are available.',
  });
});

test('local insight status keeps empty, partial, and unavailable distinct from zero', () => {
  assert.equal(deriveLocalDiaryInsights([]).status, 'empty');
  assert.deepEqual(deriveLocalDiaryInsights([]).trend, []);

  const malformed = deriveLocalDiaryInsights([
    { createdAt: 'unknown', score: null, tags: ['poor_lighting'] },
  ]);
  assert.equal(malformed.status, 'partial');
  assert.equal(malformed.omittedCount, 1);
  assert.equal(malformed.invalidCount, 1);
  assert.deepEqual(malformed.trend, []);

  const unavailable = deriveLocalDiaryInsights({
    entries: [],
    storageStatus: 'unavailable',
    warnings: [{ scope: 'storage', code: 'storage-unavailable' }],
    omittedCount: 0,
    invalidCount: 0,
  });
  assert.equal(unavailable.status, 'unavailable');
  assert.deepEqual(unavailable.trend, []);

  const partial = deriveLocalDiaryInsights([
    { createdAt: '2026-08-28T10:00:00.000Z', score: 3, tags: ['poor_lighting'] },
    { createdAt: 'unknown', score: 4, tags: ['cars_too_close'] },
  ]);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.omittedCount, 1);
  assert.deepEqual(partial.trend, [3]);
});

test('Diary heatmap buckets use Philadelphia civil time across standard time, daylight time, and midnight', () => {
  const insights = deriveLocalDiaryInsights([
    { createdAt: '2026-01-15T04:30:00.000Z', score: 3 }, // Wed 23:30 EST
    { createdAt: '2026-07-15T03:30:00.000Z', score: 4 }, // Tue 23:30 EDT
    { createdAt: '2026-07-15T13:30:00.000Z', score: 5 }, // Wed 09:30 EDT
    { createdAt: '2026-07-15T14:00:00.000Z', score: 2 }, // Wed 10:00 EDT
  ]);

  assert.equal(insights.heatmap[1][4], 1, 'Tuesday late-night bucket must follow EDT');
  assert.equal(insights.heatmap[2][0], 1, 'Wednesday morning bucket must follow EDT');
  assert.equal(insights.heatmap[2][1], 1, '10:00 local time starts the midday bucket');
  assert.equal(insights.heatmap[2][4], 1, 'Wednesday late-night bucket must follow EST');
  assert.equal(insights.heatmap.flat().reduce((sum, value) => sum + value, 0), 4);
});

test('dynamic Diary insight keys resolve without reader-visible fallback in both locales', () => {
  const dynamicKeys = [
    ...['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => `diary.day.${day}`),
    ...['morning', 'midday', 'afternoon', 'evening', 'lateNight'].map((window) => `diary.time.${window}`),
    ...['live', 'history', 'community'].flatMap((mode) => [
      `diary.insights.${mode}.tagsSubtitle`,
      `diary.insights.${mode}.heatmapSubtitle`,
    ]),
  ];
  for (const locale of ['en', 'zh-CN']) {
    setLanguage(locale);
    for (const key of dynamicKeys) assert.notEqual(t(key), key, `${locale} fallback: ${key}`);
  }
  setLanguage('en');
});

test('Sample Community surfaces remain static, non-representative, and neutral in English and Chinese', async () => {
  const originalDocument = globalThis.document;
  const [insightsSource, communitySource, css] = await Promise.all([
    readFile(new URL('../../src/charts/diary_insights.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_diary/ui_community_panel.js', import.meta.url), 'utf8'),
    readProductCss(),
  ]);
  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    assert.doesNotMatch(insightsSource, /safetyColor|#(?:f87171|fbbf24|34d399|10b981)\b/i);
    assert.doesNotMatch(communitySource, /is-order-(?:low|middle|high)/i);
    assert.doesNotMatch(css, /\.diary-score-pill\.is-order-(?:low|middle|high)/i);
    assert.match(css, /\.diary-insights__trend-bar\s*\{[^}]*background:\s*var\(--density-blue\)/s);

    for (const locale of ['en', 'zh-CN']) {
      setLanguage(locale);
      const communityRoot = new FakeElement();
      renderCommunityPanel(communityRoot, createSampleCommunityModel());
      const trend = new FakeElement();
      const tags = new FakeElement();
      const heat = new FakeElement();
      renderInsightsSections(trend, tags, heat, { context: { mode: 'community' } });
      assert.doesNotMatch([trend, tags, heat].map(readerText).join('\n'), /\bdiary\.[a-z0-9_.-]+\b/i);

      const hostRoot = new FakeElement();
      const host = createDiaryInsightsHost(hostRoot);
      host.setViewContext('community');
      const hiddenContent = elementsWithClass(hostRoot, 'diary-insights-content')[0];
      assert.equal(hiddenContent.hidden, true);
      assert.match(
        surfaceText(hiddenContent),
        locale === 'en' ? /not real-time.*not user-submitted/i : /非实时.*非用户投稿/u,
      );
      const combined = [communityRoot, trend, tags, heat, hostRoot].map(surfaceText).join('\n');
      const required = locale === 'en'
        ? [/static/i, /illustrative|example/i, /not real-time/i, /not user-submitted/i, /not (?:a )?safety(?: or |\/)risk rating/i]
        : [/静态/u, /说明性|示例/u, /非实时/u, /非用户投稿/u, /不是安全或风险评级/u];
      for (const pattern of required) assert.match(combined, pattern);

      assert.doesNotMatch(
        combined,
        locale === 'en'
          ? /\b(?:safest|safer|unsafe|risk score|current community|latest community|recent community|users? (?:agree|reported|submitted)|people (?:agree|reported)|this week|today|tonight|\d+ (?:users|people))\b/iu
          : /最安全|更安全|不安全|风险分数|最新社区|近期社区|本周|今天|今晚|已有\s*\d+\s*人|用户一致认为|社区共识|官方认证|实时更新/iu,
      );

      assert.equal(elementsWithClass(tags, 'diary-select').length, 0, 'sample mode must not expose recency controls');
      for (const badge of elementsWithClass(communityRoot, 'diary-score-pill')) {
        assert.deepEqual([...classTokens(badge)].sort(), ['diary-score-pill']);
        assert.match(badge.getAttribute('aria-label'), locale === 'en' ? /not a safety\/risk rating/i : /不是安全或风险评级/u);
      }
      for (const bar of elementsWithClass(trend, 'diary-insights__trend-bar')) {
        assert.equal(bar.style.background, undefined, 'rating values must not choose colors');
        assert.equal(bar.title, bar.getAttribute('aria-label'));
        assert.match(bar.title, locale === 'en' ? /not a safety\/risk rating/i : /不是安全或风险评级/u);
      }
      for (const cell of elementsWithClass(heat, 'diary-insights__heatmap-cell')) {
        assert.equal(cell.title, cell.getAttribute('aria-label'));
        assert.match(cell.title, locale === 'en' ? /not real-time.*not a safety\/risk rating/i : /非实时.*不是安全或风险评级/u);
      }
      const dataAttributes = [communityRoot, trend, tags, heat, hostRoot]
        .flatMap(descendants)
        .flatMap((element) => [...element.attributes.entries(), ...Object.entries(element.dataset)])
        .filter(([name]) => String(name).startsWith('data-') || name === 'i18nParams')
        .map(([, value]) => String(value))
        .join('\n');
      assert.doesNotMatch(dataAttributes, /safest|safer|unsafe|risk score|最安全|更安全|不安全|风险分数/iu);
    }
  } finally {
    setLanguage('en');
    globalThis.document = originalDocument;
  }
});

test('Sample Community score labels follow EN to ZH to EN language changes without rerendering', () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    setLanguage('en');
    const root = new FakeElement();
    renderCommunityPanel(root, createSampleCommunityModel());
    const badge = elementsWithClass(root, 'diary-score-pill')[0];
    assert.match(badge.getAttribute('aria-label'), /not a safety\/risk rating/i);

    setLanguage('zh-CN');
    applyTranslations(root);
    assert.match(badge.getAttribute('aria-label'), /不是安全或风险评级/u);

    setLanguage('en');
    applyTranslations(root);
    assert.match(badge.getAttribute('aria-label'), /not a safety\/risk rating/i);
  } finally {
    setLanguage('en');
    globalThis.document = originalDocument;
  }
});

test('unavailable local insight records do not render zero-valued heat cells', () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    setLanguage('en');
    setDiaryInsightEntries(null);
    const trend = new FakeElement();
    const tags = new FakeElement();
    const heat = new FakeElement();
    renderInsightsSections(trend, tags, heat, { context: { mode: 'live', routeId: 'route-1' } });
    assert.match(surfaceText(heat), /unavailable/i);
    assert.equal(elementsWithClass(heat, 'diary-insights__heatmap-cell').length, 0);
  } finally {
    setDiaryInsightEntries([]);
    globalThis.document = originalDocument;
  }
});

test('controller snapshot status survives the Insights port and hostile final rendering', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
  setLanguage('en');

  const run = async (snapshot) => {
    const trend = new FakeElement();
    const tags = new FakeElement();
    const heat = new FakeElement();
    const received = [];
    const port = createDiaryInsightsPort({
      setEntries(value) {
        received.push(structuredClone(value));
        setDiaryInsightEntries(value);
      },
      refresh() {
        renderInsightsSections(trend, tags, heat, { context: { mode: 'history' } });
      },
    });
    const repository = typeof snapshot === 'function'
      ? { snapshot }
      : { snapshot: async () => structuredClone(snapshot) };
    const controller = createDiaryLocalController({
      repository,
      lifecycle: { dispose() {} },
      onChange(view, { snapshotChanged } = {}) {
        if (snapshotChanged) publishDiarySnapshotToInsights(port, view.snapshot);
      },
    });
    const result = await controller.initialize();
    return {
      result,
      snapshot: received.at(-1),
      text: [trend, tags, heat].map(surfaceText).join('\n'),
      heatCells: elementsWithClass(heat, 'diary-insights__heatmap-cell').length,
    };
  };

  try {
    const unavailable = await run(async () => {
      throw new Error('hostile-storage-failure-<img src=x onerror=alert(1)>');
    });
    assert.equal(unavailable.result.reason, 'unavailable');
    assert.equal(unavailable.snapshot.storageStatus, 'unavailable');
    assert.equal(unavailable.snapshot.omittedCount, 0);
    assert.equal(unavailable.snapshot.invalidCount, 0);
    assert.deepEqual(unavailable.snapshot.warnings, [{ scope: 'storage', code: 'storage-unavailable' }]);
    assert.match(unavailable.text, /local insight data is unavailable/i);
    assert.doesNotMatch(unavailable.text, /no local ratings|hostile-storage-failure/i);
    assert.equal(unavailable.heatCells, 0);

    const hostileSentinel = 'PRIVATE-ROW-<svg onload=alert(1)>';
    const partial = await run({
      entries: [],
      drafts: [],
      warnings: [{ scope: 'entry', key: '0', message: hostileSentinel }],
    });
    assert.equal(partial.result.applied, true);
    assert.equal(partial.snapshot.storageStatus, 'partial');
    assert.equal(partial.snapshot.omittedCount, 1);
    assert.equal(partial.snapshot.invalidCount, 1);
    assert.equal(partial.snapshot.warnings[0].message, hostileSentinel);
    assert.match(partial.text, /partial view/i);
    assert.doesNotMatch(partial.text, /no local ratings|local insight data is unavailable/i);
    assert.doesNotMatch(partial.text, /PRIVATE-ROW|svg|onload/i);
    assert.equal(partial.heatCells, 0);
  } finally {
    setDiaryInsightEntries([]);
    setLanguage('en');
    globalThis.document = originalDocument;
  }
});

test('legacy string contexts remain compatible and the port forwards route identity', () => {
  assert.deepEqual(normalizeDiaryInsightsContext('history'), { mode: 'history', routeId: null });
  assert.deepEqual(normalizeDiaryInsightsContext('live'), { mode: 'live', routeId: null });

  const received = [];
  const port = createDiaryInsightsPort({
    setViewContext(context) { received.push(context); },
  });
  const context = { mode: 'live', routeId: 'route-4' };
  port.setViewContext(context);
  assert.deepEqual(received, [context]);
});

test('Diary insights disclosure exposes stable expanded state and controlled content', () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    const root = new FakeElement();
    root.id = 'diary-insights-root';
    const expandedStates = [];
    const host = createDiaryInsightsHost(root, (expanded) => expandedStates.push(expanded));
    const card = root.children[0];
    const toggle = card.children[0].children[1];
    const content = card.children[1];

    assert.equal(content.id, 'diary-insights-root-content');
    assert.equal(toggle.getAttribute('aria-controls'), content.id);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(content.hidden, true);

    host.setCollapsed(false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(content.hidden, false);
    assert.deepEqual(expandedStates.at(-1), true);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('Diary insights content is visible when expanded and hidden only by the disclosure state', async () => {
  const style = await readProductCss();
  assert.match(style, /\.diary-insights-content\s*\{[^}]*display:\s*flex/s);
  assert.match(style, /\.diary-insights-content\[hidden\]\s*\{[^}]*display:\s*none/s);
});
