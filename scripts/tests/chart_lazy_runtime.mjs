#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const projectRoot = new URL('../../', import.meta.url);

async function runWithLoader(source, loaderSource) {
  const directory = await mkdtemp(path.join(tmpdir(), 'chart-lazy-runtime-'));
  const loaderPath = path.join(directory, 'loader.mjs');
  await writeFile(loaderPath, loaderSource, 'utf8');
  try {
    return spawnSync(process.execPath, [
      '--experimental-loader',
      pathToFileURL(loaderPath).href,
      '--input-type=module',
      '--eval',
      source,
    ], {
      cwd: fileURLToPath(projectRoot),
      encoding: 'utf8',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runWithChartJsBlocked(source) {
  return runWithLoader(source, `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'chart.js/auto') throw new Error('Chart.js renderer loaded');
  return nextResolve(specifier, context);
}
`);
}

function assertChildPassed(result) {
  assert.equal(result.status, 0, [result.stdout, result.stderr].filter(Boolean).join('\n'));
}

test('tract summary behavior remains available when Chart.js is unavailable', async () => {
  const moduleUrl = new URL('src/charts/tract_summary.js', projectRoot).href;
  const result = await runWithChartJsBlocked(`
    import assert from 'node:assert/strict';
    const { createTractSummaryFetchers, runTractSummary } = await import(${JSON.stringify(moduleUrl)});
    const fetchers = createTractSummaryFetchers({
      tractGEOID: '42101000100',
      fetchMonthly: async () => ({ rows: [{ m: '2026-01-01', n: 4 }, { m: '2026-02-01', n: 5 }] }),
      fetchTop: async () => ({ rows: [] }),
      fetchStats: async () => [{ geoid: '42101000100', pop: 1000 }],
    });
    assert.equal(await fetchers.fetchCountBuffer({ start: '2026-01-01', end: '2026-02-01', types: [] }), 9);
    let received;
    const summary = await runTractSummary({
      selectedTractGEOID: '42101000100',
      start: '2026-01-01',
      end: '2026-02-01',
      types: [],
    }, {}, async (filters, options) => {
      received = { filters, options };
      return { applied: true };
    });
    assert.deepEqual(summary, { applied: true });
    assert.equal(received.filters.queryMode, 'tract');
    assert.equal(typeof received.options.fetchers.fetchCountBuffer, 'function');
  `);
  assertChildPassed(result);
});

test('hidden Charts pane aggregates data without loading the Chart.js renderer', async () => {
  const moduleUrl = new URL('src/charts/index.js', projectRoot).href;
  const result = await runWithChartJsBlocked(`
    import assert from 'node:assert/strict';
    const pane = { hidden: true, inert: true };
    globalThis.document = {
      addEventListener() {},
      querySelector(selector) {
        return selector === '[data-result-pane="charts"]' ? pane : null;
      },
    };
    const charts = await import(${JSON.stringify(moduleUrl)});
    const params = {
      start: '2026-01-01',
      end: '2026-02-01',
      queryMode: 'city',
    };
    const options = {
      fetchers: {
        fetchMonthlySeriesCity: async () => ({ rows: [{ m: '2026-01-01', n: 4 }] }),
      },
    };
    const hiddenResult = await charts.updateAllCharts(params, options);
    assert.equal(hiddenResult.status, 'success');
    pane.hidden = false;
    pane.inert = false;
    await assert.rejects(charts.updateAllCharts(params, options), /Chart\.js renderer loaded/);
  `);
  assertChildPassed(result);
});

test('opening the Charts pane loads one renderer and replays cached chart data', async () => {
  const moduleUrl = new URL('src/charts/index.js', projectRoot).href;
  const rendererSource = `
    globalThis.__chartRendererLoads = (globalThis.__chartRendererLoads || 0) + 1;
    export function createDefaultChartSinks() {
      const record = (name) => (...args) => globalThis.__chartSinkCalls.push([name, ...args]);
      return {
        status: record('status'),
        monthly: record('monthly'),
        residential: record('residential'),
        top: record('top'),
        heat: record('heat'),
        error: record('error'),
        clear: record('clear'),
      };
    }
  `;
  const rendererUrl = `data:text/javascript,${encodeURIComponent(rendererSource)}`;
  const loaderSource = `
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === './renderer.js' && context.parentURL?.endsWith('/src/charts/index.js')) {
        return { url: ${JSON.stringify(rendererUrl)}, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
  `;
  const result = await runWithLoader(`
    import assert from 'node:assert/strict';
    globalThis.__chartSinkCalls = [];
    const listeners = new Map();
    const pane = { hidden: true, inert: true };
    globalThis.document = {
      addEventListener(type, listener) { listeners.set(type, listener); },
      querySelector(selector) {
        return selector === '[data-result-pane="charts"]' ? pane : null;
      },
    };
    const charts = await import(${JSON.stringify(moduleUrl)});
    const result = await charts.updateAllCharts({
      start: '2026-01-01',
      end: '2026-02-01',
      queryMode: 'city',
    }, {
      fetchers: {
        fetchMonthlySeriesCity: async () => ({ rows: [{ m: '2026-01-01', n: 4 }] }),
      },
    });
    assert.equal(result.status, 'success');
    assert.equal(globalThis.__chartRendererLoads, undefined);
    pane.hidden = false;
    pane.inert = false;
    listeners.get('click')({
      target: { closest: (selector) => selector === '[data-result-pane-target="charts"]' },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(globalThis.__chartRendererLoads, 1);
    assert.ok(globalThis.__chartSinkCalls.some(([name]) => name === 'monthly'));
  `, loaderSource);
  assertChildPassed(result);
});

test('a failed Charts renderer load is visible, handled, and retried on the next click', async () => {
  const moduleUrl = new URL('src/charts/index.js', projectRoot).href;
  const rendererSource = `
    globalThis.__chartRendererLoads = (globalThis.__chartRendererLoads || 0) + 1;
    export function createDefaultChartSinks() {
      const record = (name) => (...args) => globalThis.__chartSinkCalls.push([name, ...args]);
      return {
        status: record('status'),
        monthly: record('monthly'),
        residential: record('residential'),
        top: record('top'),
        heat: record('heat'),
        error: record('error'),
        clear: record('clear'),
      };
    }
  `;
  const rendererUrl = `data:text/javascript,${encodeURIComponent(rendererSource)}`;
  const loaderSource = `
    let rendererAttempts = 0;
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === './renderer.js' && context.parentURL?.endsWith('/src/charts/index.js')) {
        rendererAttempts += 1;
        if (rendererAttempts === 1) throw new Error('renderer chunk offline');
        return { url: ${JSON.stringify(rendererUrl)}, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
  `;
  const result = await runWithLoader(`
    import assert from 'node:assert/strict';
    globalThis.__chartSinkCalls = [];
    const unhandled = [];
    process.on('unhandledRejection', (error) => unhandled.push(error));
    const listeners = new Map();
    const elements = new Map();
    const pane = {
      hidden: true,
      inert: true,
      appendChild(element) { elements.set(element.id, element); },
    };
    elements.set('charts', pane);
    globalThis.document = {
      addEventListener(type, listener) { listeners.set(type, listener); },
      querySelector(selector) {
        return selector === '[data-result-pane="charts"]' ? pane : null;
      },
      getElementById(id) { return elements.get(id) || null; },
      createElement() {
        return {
          id: '',
          className: '',
          textContent: '',
          attributes: new Map(),
          setAttribute(name, value) { this.attributes.set(name, String(value)); },
        };
      },
    };
    const charts = await import(${JSON.stringify(moduleUrl)});
    const result = await charts.updateAllCharts({
      start: '2026-01-01',
      end: '2026-02-01',
      queryMode: 'city',
    }, {
      fetchers: {
        fetchMonthlySeriesCity: async () => ({ rows: [{ m: '2026-01-01', n: 4 }] }),
      },
    });
    assert.equal(result.status, 'success');
    pane.hidden = false;
    pane.inert = false;
    const click = () => listeners.get('click')({
      target: { closest: (selector) => selector === '[data-result-pane-target="charts"]' },
    });
    click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const status = elements.get('charts-status');
    assert.equal(unhandled.length, 0);
    assert.equal(status.attributes.get('role'), 'status');
    assert.equal(status.attributes.get('aria-live'), 'polite');
    assert.match(status.textContent, /renderer chunk offline/);
    click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(unhandled.length, 0);
    assert.equal(globalThis.__chartRendererLoads, 1);
    assert.ok(globalThis.__chartSinkCalls.some(([name]) => name === 'monthly'));
  `, loaderSource);
  assertChildPassed(result);
});
