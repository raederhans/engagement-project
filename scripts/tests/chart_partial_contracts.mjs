#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearCrimeCharts,
  createChartLocaleCache,
  updateAllCharts,
} from '../../src/charts/index.js';

function createSinks() {
  const calls = [];
  return {
    calls,
    status: (...args) => calls.push(['status', ...args]),
    monthly: (...args) => calls.push(['monthly', ...args]),
    top: (...args) => calls.push(['top', ...args]),
    heat: (...args) => calls.push(['heat', ...args]),
    error: (...args) => calls.push(['error', ...args]),
  };
}

function bufferParams() {
  return {
    start: '2026-01-01',
    end: '2026-02-01',
    types: [],
    center3857: [1, 2],
    radiusM: 400,
    queryMode: 'buffer',
  };
}

test('one failed chart does not prevent successful charts from rendering', async () => {
  const sinks = createSinks();
  const monthlyError = new Error('monthly offline');
  const result = await updateAllCharts(bufferParams(), {
    fetchers: {
      fetchMonthlySeriesCity: async () => { throw monthlyError; },
      fetchMonthlySeriesBuffer: async () => ({ rows: [{ m: '2026-01-01', n: 2 }] }),
      fetchTopTypesBuffer: async () => ({ rows: [{ text_general_code: 'Robbery', n: 3 }] }),
      fetch7x24Buffer: async () => ({ rows: [{ dow: 1, hr: 8, n: 4 }] }),
    },
    sinks,
  });

  assert.equal(result.applied, true);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.succeeded, ['top', 'heat']);
  assert.deepEqual(result.failed, ['monthly']);
  assert.equal(sinks.calls.find(([name]) => name === 'error')[1], monthlyError);
  assert.deepEqual(sinks.calls.filter(([name]) => ['monthly', 'top', 'heat'].includes(name)).map(([name]) => name), ['top', 'heat']);
  assert.deepEqual(sinks.calls.filter(([name]) => name === 'error').map(([, , options]) => options.chart), ['monthly']);
});

test('all chart failures return failed status instead of rejecting', async () => {
  const sinks = createSinks();
  const fail = (message) => async () => { throw new Error(message); };
  const result = await updateAllCharts(bufferParams(), {
    fetchers: {
      fetchMonthlySeriesCity: fail('monthly'),
      fetchMonthlySeriesBuffer: async () => ({ rows: [] }),
      fetchTopTypesBuffer: fail('top'),
      fetch7x24Buffer: fail('heat'),
    },
    sinks,
  });

  assert.equal(result.applied, true);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.succeeded, []);
  assert.deepEqual(result.failed, ['monthly', 'top', 'heat']);
  assert.deepEqual(sinks.calls.filter(([name]) => ['monthly', 'top', 'heat'].includes(name)), []);
});

test('an aborted partial result writes no sink', async () => {
  const sinks = createSinks();
  const controller = new AbortController();
  let releaseTop;
  const topGate = new Promise((resolve) => { releaseTop = resolve; });
  const updating = updateAllCharts(bufferParams(), {
    signal: controller.signal,
    fetchers: {
      fetchMonthlySeriesCity: async () => { throw new Error('monthly'); },
      fetchMonthlySeriesBuffer: async () => ({ rows: [] }),
      fetchTopTypesBuffer: () => topGate,
      fetch7x24Buffer: async () => ({ rows: [] }),
    },
    sinks,
  });

  controller.abort(new DOMException('superseded', 'AbortError'));
  releaseTop({ rows: [] });

  assert.deepEqual(await updating, { applied: false });
  assert.deepEqual(sinks.calls, []);
});

test('default sinks expose local accessible failures without clearing chart canvases', async (t) => {
  const previousDocument = globalThis.document;
  const previousConsoleError = console.error;
  let consoleErrors = 0;
  console.error = () => { consoleErrors += 1; };
  const elements = new Map();
  const makeElement = (id = '') => ({
    id,
    dataset: {},
    textContent: '',
    innerText: '',
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    getContext() { return {}; },
  });
  for (const id of ['chart-monthly', 'chart-topn', 'chart-7x24', 'chart-monthly-insight', 'chart-topn-insight', 'chart-7x24-insight']) {
    elements.set(id, makeElement(id));
  }
  for (const id of ['chart-monthly', 'chart-topn', 'chart-7x24']) elements.get(id).textContent = 'existing-canvas';
  const body = { appendChild(element) { elements.set(element.id, element); } };
  globalThis.document = {
    body,
    createElement: () => makeElement(),
    getElementById: (id) => elements.get(id) ?? null,
    querySelectorAll: () => [],
  };
  t.after(() => {
    globalThis.document = previousDocument;
    console.error = previousConsoleError;
  });

  const fail = (message) => async () => { throw new Error(message); };
  const result = await updateAllCharts(bufferParams(), {
    fetchers: {
      fetchMonthlySeriesCity: fail('monthly offline'),
      fetchMonthlySeriesBuffer: async () => ({ rows: [] }),
      fetchTopTypesBuffer: fail('top offline'),
      fetch7x24Buffer: fail('heat offline'),
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(consoleErrors, 0, 'handled chart failures belong in the local UI, not console.error');
  for (const name of ['monthly', 'topn', '7x24']) {
    const insight = elements.get(`chart-${name}-insight`);
    assert.equal(insight.attributes.get('role'), 'status');
    assert.equal(insight.attributes.get('aria-live'), 'polite');
    assert.match(insight.textContent, /Charts unavailable:/);
    assert.equal(elements.get(`chart-${name}`).textContent, 'existing-canvas');
  }
});

test('clearing charts removes cached results and replaces old canvases with the selection prompt', () => {
  const calls = [];
  const localeCache = createChartLocaleCache();
  localeCache.store({ kind: 'charts', topRows: [{ text_general_code: 'Old', n: 3 }] });
  const sinks = {
    clear: () => calls.push(['clear']),
    status: (message, options) => calls.push(['status', message, options]),
  };

  assert.equal(clearCrimeCharts({ sinks, localeCache }), true);
  assert.deepEqual(calls.map(([name]) => name), ['clear', 'status']);
  assert.match(calls[1][1], /click the map|set a center/i);
  assert.equal(localeCache.refresh(createSinks()), false);
});
