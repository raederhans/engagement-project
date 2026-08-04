#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCrimeSummaryHtml,
  clearCurrentComparison,
  getLastComparison,
  getLastComparisonSnapshot,
  updateCompare,
} from '../../src/compare/card.js';

function createView() {
  const calls = [];
  return {
    calls,
    pending: () => calls.push(['pending']),
    success: (result) => calls.push(['success', result]),
    error: (error) => calls.push(['error', error]),
  };
}

function baseFilters(overrides = {}) {
  return {
    start: '2031-01-01',
    end: '2031-02-01',
    types: ['test'],
    center3857: [1, 2],
    centerB3857: [3, 4],
    addressA: 'A',
    addressB: 'B',
    radiusM: 400,
    adminLevel: 'tracts',
    per10k: true,
    ...overrides,
  };
}

test('clearing a comparison restores the honest no-selection state', () => {
  const view = createView();
  assert.equal(clearCurrentComparison({ view }), true);
  assert.deepEqual(view.calls, [['success', { a: null, b: null }]]);
});

test('A and B settle independently and expose metric-level unavailable values without fake zeroes', async () => {
  const view = createView();
  const result = await updateCompare(baseFilters(), {
    view,
    fetchers: {
      fetchCountBuffer: async ({ center3857 }) => {
        if (center3857[0] === 1) throw new Error('A count unavailable');
        return 8;
      },
      fetchTopTypesBuffer: async ({ center3857 }) => {
        if (center3857[0] === 3) throw new Error('B top unavailable');
        return { rows: [{ text_general_code: 'Theft', n: 5 }] };
      },
      estimatePopInBuffer: async ({ center3857 }) => {
        if (center3857[0] === 1) throw new Error('A population unavailable');
        return { pop: 2_000 };
      },
    },
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.a.status, 'partial');
  assert.equal(result.a.total, null);
  assert.equal(result.a.per10k, null);
  assert.deepEqual(result.a.top3, [{ text_general_code: 'Theft', n: 5 }]);
  assert.deepEqual(result.a.metricStatus, {
    count: 'unavailable', top: 'available', population: 'unavailable',
  });
  assert.equal(result.b.status, 'partial');
  assert.equal(result.b.total, 8);
  assert.equal(result.b.per10k, 40);
  assert.equal(result.b.top3, null);
  assert.deepEqual(result.b.metricStatus, {
    count: 'available', top: 'unavailable', population: 'available',
  });
  assert.equal(view.calls.at(-1)[0], 'success');
});

test('fulfilled responses with missing metric payloads are unavailable rather than available zeroes', async () => {
  const result = await updateCompare(baseFilters({ start: '2031-02-01', centerB3857: null }), {
    view: createView(),
    fetchers: {
      fetchCountBuffer: async () => undefined,
      fetchTopTypesBuffer: async () => ({}),
      estimatePopInBuffer: async () => ({}),
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.a.status, 'failed');
  assert.equal(result.a.total, null);
  assert.equal(result.a.top3, null);
  assert.equal(result.a.population, null);
  assert.deepEqual(result.a.metricStatus, {
    count: 'unavailable', top: 'unavailable', population: 'unavailable',
  });
});

test('a fully failed point does not hide the other successful point', async () => {
  const result = await updateCompare(baseFilters({ start: '2031-03-01' }), {
    view: createView(),
    fetchers: {
      fetchCountBuffer: async ({ center3857 }) => {
        if (center3857[0] === 1) throw new Error('A count failed');
        return 4;
      },
      fetchTopTypesBuffer: async ({ center3857 }) => {
        if (center3857[0] === 1) throw new Error('A top failed');
        return { rows: [] };
      },
      estimatePopInBuffer: async ({ center3857 }) => {
        if (center3857[0] === 1) throw new Error('A population failed');
        return { pop: 1_000 };
      },
    },
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.a.status, 'failed');
  assert.equal(result.a.total, null);
  assert.equal(result.b.status, 'success');
  assert.equal(result.b.total, 4);
});

test('same-filter prior values are retained as stale only for metrics that currently fail', async () => {
  const filters = baseFilters({ start: '2031-05-01' });
  const successFetchers = {
    fetchCountBuffer: async ({ center3857 }) => center3857[0] === 1 ? 7 : 9,
    fetchTopTypesBuffer: async () => ({ rows: [{ text_general_code: 'Other', n: 2 }] }),
    estimatePopInBuffer: async () => ({ pop: 1_000 }),
  };
  await updateCompare(filters, { view: createView(), fetchers: successFetchers });

  const result = await updateCompare(filters, {
    view: createView(),
    fetchers: {
      ...successFetchers,
      fetchCountBuffer: async ({ center3857 }) => {
        if (center3857[0] === 1) throw new Error('A count refresh failed');
        return 10;
      },
    },
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.a.total, 7);
  assert.equal(result.a.stale, true);
  assert.equal(result.a.metricStatus.count, 'stale');
  assert.equal(result.a.metricStatus.top, 'available');
  assert.equal(result.b.total, 10);
  assert.equal(result.b.stale, false);
});

test('partial retained metrics are labeled, expose provenance detail, and disable stale exports until recovery', async () => {
  const filters = baseFilters({
    start: '2031-06-01',
    end: '2031-07-01',
    centerB3857: null,
  });
  const successFetchers = {
    fetchCountBuffer: async () => 14,
    fetchTopTypesBuffer: async () => ({ rows: [{ text_general_code: 'Theft', n: 6 }] }),
    estimatePopInBuffer: async () => ({ pop: 2_000 }),
  };
  const first = await updateCompare(filters, {
    view: createView(),
    fetchers: successFetchers,
    now: () => '2031-07-02T00:00:00.000Z',
  });
  assert.equal(first.status, 'success');
  assert.ok(getLastComparison(filters));
  assert.ok(getLastComparisonSnapshot(filters));

  const partial = await updateCompare(filters, {
    view: createView(),
    fetchers: {
      ...successFetchers,
      fetchCountBuffer: async () => { throw new Error('count refresh failed'); },
    },
  });

  assert.equal(partial.status, 'partial');
  assert.equal(partial.stale, true);
  assert.equal(partial.retainedGeneratedAt, '2031-07-02T00:00:00.000Z');
  assert.deepEqual(partial.metricStatus.a, partial.a.metricStatus);
  assert.deepEqual(partial.errors.a, { count: 'count refresh failed' });
  assert.match(
    buildCrimeSummaryHtml(partial, { start: filters.start, end: filters.end }),
    /previous result/i,
  );
  assert.match(
    buildCrimeSummaryHtml(partial, { start: filters.start, end: filters.end }),
    /Some metrics could not be updated/i,
  );
  assert.equal(getLastComparison(filters), null);
  assert.equal(getLastComparisonSnapshot(filters), null);

  const recovered = await updateCompare(filters, {
    view: createView(),
    fetchers: successFetchers,
    now: () => '2031-07-03T00:00:00.000Z',
  });
  assert.equal(recovered.status, 'success');
  assert.ok(getLastComparison(filters));
  assert.equal(getLastComparisonSnapshot(filters)?.generatedAt, '2031-07-03T00:00:00.000Z');
});

test('population source metadata propagates through Summary comparison fetches', async () => {
  const sources = [];
  for (const [index, kind] of ['live', 'fallback'].entries()) {
    const result = await updateCompare(baseFilters({
      start: `2031-0${index + 7}-01`,
      end: `2031-0${index + 8}-01`,
      centerB3857: null,
    }), {
      view: createView(),
      onSourceResolved: (metadata) => sources.push(metadata),
      fetchers: {
        fetchCountBuffer: async () => 5,
        fetchTopTypesBuffer: async () => ({ rows: [] }),
        estimatePopInBuffer: async ({ onSourceResolved }) => {
          onSourceResolved({
            dataset: 'census-tract-statistics',
            kind,
            provider: kind === 'live' ? 'Census Reporter' : 'Bundled ACS snapshot',
          });
          return { pop: 1_000 };
        },
      },
    });

    assert.equal(result.status, 'success');
  }
  assert.deepEqual(sources, [
    {
      dataset: 'census-tract-statistics',
      kind: 'live',
      provider: 'Census Reporter',
    },
    {
      dataset: 'census-tract-statistics',
      kind: 'fallback',
      provider: 'Bundled ACS snapshot',
    },
  ]);
});

test('stale population retains the tract and demographic lineage that produced it', async () => {
  const filters = baseFilters({
    start: '2031-10-01',
    end: '2031-11-01',
    centerB3857: null,
    per10k: false,
  });
  const firstSources = [];
  const sharedFetchers = {
    fetchCountBuffer: async () => 12,
    fetchTopTypesBuffer: async () => ({ rows: [] }),
  };
  const first = await updateCompare(filters, {
    view: createView(),
    onSourceResolved: (metadata) => firstSources.push(metadata),
    fetchers: {
      ...sharedFetchers,
      estimatePopInBuffer: async ({ onSourceResolved }) => {
        onSourceResolved({
          dataset: 'census-tract-boundaries',
          kind: 'live',
          provider: 'Official tract boundary API',
        });
        onSourceResolved({
          dataset: 'census-tract-statistics',
          kind: 'fallback',
          provider: 'Published ACS snapshot',
          asOf: '2030-12-31',
        });
        return { pop: 5_000 };
      },
    },
    now: () => '2031-11-02T00:00:00.000Z',
  });
  assert.equal(first.status, 'success');
  assert.deepEqual(firstSources.map(({ dataset }) => dataset), [
    'census-tract-boundaries',
    'census-tract-statistics',
  ]);

  const retrySources = [];
  const partial = await updateCompare(filters, {
    view: createView(),
    onSourceResolved: (metadata) => retrySources.push(metadata),
    fetchers: {
      ...sharedFetchers,
      estimatePopInBuffer: async () => {
        throw new Error('population failed before resolving a source');
      },
    },
  });

  assert.equal(partial.status, 'partial');
  assert.equal(partial.a.metricStatus.population, 'stale');
  assert.equal(partial.retainedGeneratedAt, '2031-11-02T00:00:00.000Z');
  assert.deepEqual(retrySources, []);
  assert.deepEqual(partial.sourceLineage.map(({ dataset }) => dataset), [
    'census-tract-boundaries',
    'census-tract-statistics',
  ]);
});

test('retained fallback lineage cannot overwrite a current live source in mixed A and B results', async () => {
  const filters = baseFilters({
    start: '2032-01-01',
    end: '2032-02-01',
    per10k: false,
  });
  const sharedFetchers = {
    fetchCountBuffer: async () => 12,
    fetchTopTypesBuffer: async () => ({ rows: [] }),
  };
  await updateCompare(filters, {
    view: createView(),
    fetchers: {
      ...sharedFetchers,
      estimatePopInBuffer: async ({ onSourceResolved }) => {
        onSourceResolved({
          dataset: 'census-tract-boundaries',
          kind: 'fallback',
          provider: 'Bundled tract snapshot',
        });
        onSourceResolved({
          dataset: 'census-tract-statistics',
          kind: 'fallback',
          provider: 'Published ACS snapshot',
        });
        return { pop: 5_000 };
      },
    },
  });

  const finalByDataset = new Map();
  const mixed = await updateCompare(filters, {
    view: createView(),
    onSourceResolved: (metadata) => finalByDataset.set(metadata.dataset, metadata),
    fetchers: {
      ...sharedFetchers,
      estimatePopInBuffer: async ({ center3857, onSourceResolved }) => {
        onSourceResolved({
          dataset: 'census-tract-boundaries',
          kind: 'live',
          provider: 'Official tract boundary API',
        });
        onSourceResolved({
          dataset: 'census-tract-statistics',
          kind: 'live',
          provider: 'Census Reporter',
        });
        if (center3857[0] === 1) throw new Error('A population failed after resolving live sources');
        return { pop: 5_000 };
      },
    },
  });

  assert.equal(mixed.status, 'partial');
  assert.equal(mixed.a.metricStatus.population, 'stale');
  assert.equal(mixed.b.metricStatus.population, 'available');
  assert.deepEqual(
    [...finalByDataset.values()].map(({ kind }) => kind),
    ['live', 'live'],
  );
  assert.deepEqual(
    [...new Set(mixed.sourceLineage.map(({ kind }) => kind))].sort(),
    ['fallback', 'live'],
  );
});

test('different-filter failures never retain values from an older filter', async () => {
  const oldFilters = baseFilters({ start: '2031-07-01' });
  const fetchers = {
    fetchCountBuffer: async () => 13,
    fetchTopTypesBuffer: async () => ({ rows: [] }),
    estimatePopInBuffer: async () => ({ pop: 1_000 }),
  };
  await updateCompare(oldFilters, { view: createView(), fetchers });

  const result = await updateCompare({ ...oldFilters, types: ['different'] }, {
    view: createView(),
    fetchers: {
      fetchCountBuffer: async () => { throw new Error('count failed'); },
      fetchTopTypesBuffer: async () => { throw new Error('top failed'); },
      estimatePopInBuffer: async () => { throw new Error('population failed'); },
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.a.total, null);
  assert.equal(result.a.stale, false);
  assert.equal(result.b.total, null);
  assert.equal(result.b.stale, false);
});

test('status is failed only when every requested point fully fails', async () => {
  const view = createView();
  const result = await updateCompare(baseFilters({ start: '2031-09-01' }), {
    view,
    fetchers: {
      fetchCountBuffer: async () => { throw new Error('count failed'); },
      fetchTopTypesBuffer: async () => { throw new Error('top failed'); },
      estimatePopInBuffer: async () => { throw new Error('population failed'); },
    },
  });

  assert.equal(result.applied, true);
  assert.equal(result.status, 'failed');
  assert.equal(result.a.status, 'failed');
  assert.equal(result.b.status, 'failed');
  assert.equal(view.calls.at(-1)[0], 'error');
});

test('aborted or stale completion adds no success or error sink', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const controller = new AbortController();
  const view = createView();
  const request = updateCompare(baseFilters({ start: '2031-11-01' }), {
    signal: controller.signal,
    shouldApply: () => !controller.signal.aborted,
    view,
    fetchers: {
      fetchCountBuffer: () => gate,
      fetchTopTypesBuffer: async () => ({ rows: [] }),
      estimatePopInBuffer: async () => ({ pop: 1_000 }),
    },
  });
  const callsBeforeAbort = view.calls.length;
  controller.abort();
  release(3);

  assert.deepEqual(await request, { applied: false });
  assert.equal(view.calls.length, callsBeforeAbort);
  assert.deepEqual(view.calls, [['pending']]);
});
