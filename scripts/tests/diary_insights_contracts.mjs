#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readProductCss } from './helpers/css_source.mjs';

import {
  describeDiaryInsightsContext,
  normalizeDiaryInsightsContext,
  selectDiaryInsightEntries,
} from '../../src/charts/diary_insights.js';
import { createDiaryInsightsPort } from '../../src/routes_diary/diary_insights_port.js';
import { createDiaryInsightsHost } from '../../src/routes_diary/ui_insights_panel.js';

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
  }

  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  set innerHTML(value) { if (value === '') this.children = []; }
  get innerHTML() { return ''; }
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
    title: 'Sample community patterns',
    hint: 'Illustrative sample data',
    intro: 'Read-only example patterns; these are not community submissions.',
    emptyTrend: 'No sample ratings are available.',
    emptyTags: 'No sample tags are available.',
  });
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
