import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyCrimeRefreshJobs,
  createCrimeRefreshProvenance,
  createCrimeResultMetaPresenter,
  createCrimeResultProvenance,
  normalizeCrimeRefreshResult,
} from '../../src/ui/crime_result_meta.js';

function createElement(attributes = {}) {
  const listeners = new Map();
  return {
    attributes: new Map(Object.entries(attributes)),
    dataset: {},
    hidden: false,
    textContent: '',
    addEventListener(type, listener) {
      const handlers = listeners.get(type) || [];
      handlers.push(listener);
      listeners.set(type, handlers);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter((handler) => handler !== listener));
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    },
    click() {
      for (const listener of [...(listeners.get('click') || [])]) listener({ currentTarget: this });
    },
  };
}

function createMetaFixture(surface = 'summary') {
  const nodes = Object.fromEntries([
    'status', 'result', 'generated', 'sources', 'coverage', 'scope', 'limitations', 'retry',
  ].map((name) => [name, createElement()]));
  const selectorMap = new Map([
    ['[data-result-meta-status]', nodes.status],
    ['[data-result-meta-result]', nodes.result],
    ['[data-result-meta-generated]', nodes.generated],
    ['[data-result-meta-sources]', nodes.sources],
    ['[data-result-meta-coverage]', nodes.coverage],
    ['[data-result-meta-scope]', nodes.scope],
    ['[data-result-meta-limitations]', nodes.limitations],
    ['[data-result-meta-retry]', nodes.retry],
  ]);
  const root = createElement({ 'data-result-meta': '' });
  root.dataset.resultMeta = surface;
  root.querySelector = (selector) => selectorMap.get(selector) || null;
  return { root, nodes };
}

const validInput = () => ({
  result: { kind: 'incident-query', count: 12, nested: { verified: true } },
  generatedAt: '2026-08-03T07:10:00.000Z',
  sources: [
    { dataset: 'incidents', kind: 'live', provider: 'CARTO', asOf: '2026-07-30' },
    { dataset: '', kind: 'live', provider: 'Invented default' },
    { dataset: 'districts', kind: 'live', provider: '  ' },
  ],
  coverage: { start: '2026-01-01', end: '2026-07-30', asOf: '2026-07-30' },
  scope: {
    queryMode: 'buffer',
    selection: [-75.16, 39.95],
    radius: 500,
    offenseCodes: ['Aggravated Assault', '', 'Aggravated Assault', 'Burglary'],
  },
  limitations: ['crime.limit.incompleteRecent', '', 'crime.limit.geocoding'],
});

test('provenance is a deeply immutable structured snapshot without fabricated sources or empty fields', () => {
  const provenance = createCrimeResultProvenance(validInput());

  assert.deepEqual(provenance.sources, [
    { dataset: 'incidents', kind: 'live', provider: 'CARTO', asOf: '2026-07-30' },
  ]);
  assert.deepEqual(provenance.scope.offenseCodes, ['Aggravated Assault', 'Burglary']);
  assert.deepEqual(provenance.limitations, ['crime.limit.incompleteRecent', 'crime.limit.geocoding']);
  assert.equal(Object.hasOwn(provenance, 'availability'), false);
  assert.ok(Object.isFrozen(provenance));
  assert.ok(Object.isFrozen(provenance.result));
  assert.ok(Object.isFrozen(provenance.result.nested));
  assert.ok(Object.isFrozen(provenance.sources));
  assert.ok(Object.isFrozen(provenance.scope.selection));
});

test('provenance rejects contradictory scope and coverage instead of retaining misleading fields', () => {
  assert.throws(() => createCrimeResultProvenance({
    ...validInput(),
    coverage: { start: '2026-08-01', end: '2026-07-30' },
  }), /coverage/i);
  assert.throws(() => createCrimeResultProvenance({
    ...validInput(),
    scope: { queryMode: 'district', selection: '01', radius: 500, offenseCodes: [] },
  }), /radius/i);
  assert.throws(() => createCrimeResultProvenance({
    ...validInput(),
    scope: { queryMode: 'tract', selection: '', offenseCodes: [] },
  }), /selection/i);
  assert.throws(() => createCrimeResultProvenance({
    ...validInput(),
    coverage: { start: '2026-02-31', end: '2026-07-30' },
  }), /coverage/i);
  assert.throws(() => createCrimeResultProvenance({
    ...validInput(),
    sources: [{ dataset: 'incidents', kind: 'live', provider: 'CARTO', asOf: '2026-02-31' }],
  }), /source.*asOf/i);
});

test('refresh provenance uses an inclusive displayed end date and an honest citywide boundary scope', () => {
  const provenance = createCrimeRefreshProvenance({
    name: 'boundary',
    value: { applied: true, status: 'partial', featureCount: 21 },
    snapshot: {
      queryMode: 'buffer',
      centerLonLat: [-75.16, 39.95],
      radiusM: 500,
      adminLevel: 'districts',
      overlayTractsLines: true,
      start: '2026-01-01',
      end: '2026-02-01',
      types: ['Burglary'],
    },
    sources: [
      { dataset: 'districts', kind: 'live', source: 'CARTO' },
      { dataset: 'tracts', kind: 'fallback', source: 'Published fallback' },
      { dataset: 'incidents', kind: 'live', source: 'CARTO' },
    ],
    coverageMax: '2026-01-31',
    generatedAt: '2026-08-03T07:10:00.000Z',
  });

  assert.deepEqual(provenance.coverage, {
    start: '2026-01-01',
    end: '2026-01-31',
    asOf: '2026-01-31',
  });
  assert.deepEqual(provenance.scope, {
    queryMode: 'citywide',
    selection: 'Philadelphia',
    offenseCodes: ['Burglary'],
    adminLevel: 'districts',
    overlayTractsLines: true,
  });
  assert.deepEqual(provenance.sources.map(({ dataset }) => dataset), ['districts', 'tracts']);
});

test('summary refresh provenance preserves partial metric truth and retained timestamps', () => {
  const provenance = createCrimeRefreshProvenance({
    name: 'summary',
    value: {
      applied: true,
      status: 'partial',
      retainedGeneratedAt: '2026-08-02T07:10:00.000Z',
      a: {
        status: 'partial',
        stale: true,
        total: 12,
        per10k: null,
        metricStatus: { count: 'stale', top: 'available', population: 'unavailable' },
        errors: { count: 'upstream timeout', population: 'population unavailable' },
      },
    },
    snapshot: {
      queryMode: 'buffer',
      centerLonLat: [-75.16, 39.95],
      radiusM: 500,
      adminLevel: 'tracts',
      per10k: true,
      start: '2026-01-01',
      end: '2026-02-01',
      types: [],
    },
    sources: [
      { dataset: 'incidents', kind: 'live', source: 'CARTO' },
      { dataset: 'demographics', kind: 'fallback', source: 'Published ACS snapshot' },
    ],
    generatedAt: '2026-08-03T07:10:00.000Z',
  });

  assert.equal(provenance.result.retainedGeneratedAt, '2026-08-02T07:10:00.000Z');
  assert.deepEqual(provenance.result.points, [{
    point: 'A',
    status: 'partial',
    stale: true,
    total: 12,
    per10k: null,
    metricStatus: { count: 'stale', top: 'available', population: 'unavailable' },
    errors: { count: 'upstream timeout', population: 'population unavailable' },
    retainedGeneratedAt: '2026-08-02T07:10:00.000Z',
  }]);
  assert.deepEqual(provenance.sources.map(({ dataset }) => dataset), ['incidents', 'demographics']);
});

test('summary provenance reports tract and demographic lineage whenever population metrics are used', () => {
  const provenance = createCrimeRefreshProvenance({
    name: 'summary',
    value: {
      applied: true,
      status: 'success',
      a: {
        status: 'success',
        stale: false,
        total: 10,
        population: 5_000,
        per10k: 20,
        metricStatus: { count: 'available', top: 'available', population: 'available' },
      },
    },
    snapshot: {
      queryMode: 'buffer',
      centerLonLat: [-75.16, 39.95],
      radiusM: 500,
      adminLevel: 'tracts',
      per10k: false,
      start: '2026-01-01',
      end: '2026-02-01',
      types: [],
    },
    sources: [
      { dataset: 'incidents', kind: 'live', source: 'CARTO' },
      { dataset: 'tracts', kind: 'live', source: 'Official tract boundary API' },
      { dataset: 'demographics', kind: 'fallback', source: 'Published ACS snapshot' },
    ],
    generatedAt: '2026-08-03T07:10:00.000Z',
  });

  assert.deepEqual(
    provenance.sources.map(({ dataset }) => dataset),
    ['incidents', 'tracts', 'demographics'],
  );
});

test('presenter preserves old provenance while loading and atomically commits ready metadata', () => {
  const { root, nodes } = createMetaFixture();
  const presenter = createCrimeResultMetaPresenter({
    root,
    translate: (key, params = {}) => `${key}:${Object.values(params).join('|')}`,
    formatDate: (value) => `date(${value})`,
    languageChange: () => () => {},
  });
  const first = createCrimeResultProvenance(validInput());
  presenter.ready(first);
  const oldResult = nodes.result.textContent;
  const oldSources = nodes.sources.textContent;

  const token = presenter.loading();
  assert.ok(token);
  assert.equal(presenter.getAvailability(), 'current');
  assert.equal(presenter.getProvenance(), first);
  assert.equal(nodes.result.textContent, oldResult);
  assert.equal(nodes.sources.textContent, oldSources);
  assert.equal(root.getAttribute('aria-busy'), 'true');

  let calls = 0;
  const before = Object.fromEntries(Object.entries(nodes).map(([key, node]) => [key, node.textContent]));
  assert.throws(() => presenter.ready(createCrimeResultProvenance({ ...validInput(), generatedAt: '2026-08-03T08:10:00.000Z' }), {
    token,
    translate: () => {
      calls += 1;
      if (calls === 3) throw new Error('translation failed');
      return 'prepared';
    },
  }), /translation failed/);
  assert.deepEqual(
    Object.fromEntries(Object.entries(nodes).map(([key, node]) => [key, node.textContent])),
    before,
  );
  assert.equal(presenter.getProvenance(), first);
});

test('presenter tokens prevent stale requests from committing and cancellation restores the stable state', () => {
  const { root, nodes } = createMetaFixture('charts');
  let redrawLanguage = null;
  const presenter = createCrimeResultMetaPresenter({
    root,
    translate: (key) => key,
    languageChange: (listener) => {
      redrawLanguage = listener;
      return () => { redrawLanguage = null; };
    },
  });
  const first = createCrimeResultProvenance(validInput());
  const second = createCrimeResultProvenance({
    ...validInput(),
    generatedAt: '2026-08-03T08:10:00.000Z',
  });
  presenter.ready(first);

  const oldToken = presenter.loading();
  const activeToken = presenter.loading();
  redrawLanguage();
  assert.equal(root.getAttribute('aria-busy'), 'true');
  assert.equal(nodes.status.textContent, 'Updating result…');
  assert.equal(presenter.failed(new Error('old failure'), { token: oldToken }), false);
  assert.equal(presenter.ready(second, { token: oldToken }), false);
  assert.equal(presenter.cancel(oldToken), false);
  assert.equal(root.getAttribute('aria-busy'), 'true');
  assert.equal(presenter.cancel(activeToken), true);
  assert.equal(root.getAttribute('aria-busy'), 'false');
  assert.equal(presenter.getAvailability(), 'current');
  assert.equal(presenter.getProvenance(), first);

  const partialToken = presenter.loading();
  assert.equal(presenter.ready(second, { token: partialToken, availability: 'partial' }), true);
  assert.equal(presenter.getAvailability(), 'partial');
  assert.equal(root.dataset.availability, 'partial');
  assert.equal(nodes.retry.hidden, false);
  assert.equal(nodes.retry.textContent, 'Retry chart result');

  const failedToken = presenter.loading();
  assert.equal(presenter.failed(new Error('raw upstream SQL error'), { token: failedToken }), true);
  assert.equal(presenter.getAvailability(), 'stale');
  assert.doesNotMatch(nodes.status.textContent, /raw upstream SQL error/i);
});

test('failed state marks retained results stale and missing results unavailable', () => {
  const retained = createMetaFixture();
  const retainedPresenter = createCrimeResultMetaPresenter({ root: retained.root, languageChange: () => () => {} });
  const provenance = createCrimeResultProvenance(validInput());
  retainedPresenter.ready(provenance);
  const oldResult = retained.nodes.result.textContent;
  retainedPresenter.failed(new Error('upstream timeout'));
  assert.equal(retainedPresenter.getAvailability(), 'stale');
  assert.equal(retainedPresenter.getProvenance(), provenance);
  assert.equal(retained.nodes.result.textContent, oldResult);
  assert.equal(retained.nodes.retry.hidden, false);

  const missing = createMetaFixture();
  const missingPresenter = createCrimeResultMetaPresenter({ root: missing.root, languageChange: () => () => {} });
  missingPresenter.failed(new Error('offline'));
  assert.equal(missingPresenter.getAvailability(), 'unavailable');
  assert.equal(missingPresenter.getProvenance(), null);
  assert.equal(missing.nodes.result.textContent, '');
});

test('clearing a result removes stale provenance and returns the surface to an idle unavailable state', () => {
  const { root, nodes } = createMetaFixture();
  const presenter = createCrimeResultMetaPresenter({ root, languageChange: () => () => {} });
  presenter.ready(createCrimeResultProvenance(validInput()));
  presenter.failed(new Error('temporary outage'));

  assert.equal(presenter.clear(), true);
  assert.equal(presenter.getAvailability(), 'unavailable');
  assert.equal(presenter.getProvenance(), null);
  assert.equal(root.dataset.availability, 'unavailable');
  assert.equal(root.getAttribute('aria-busy'), 'false');
  assert.equal(nodes.retry.hidden, true);
  for (const key of ['result', 'generated', 'sources', 'coverage', 'scope', 'limitations']) {
    assert.equal(nodes[key].textContent, '');
  }
});

test('retry is accessible, bound once, and language redraw keeps the same immutable data', () => {
  const { root, nodes } = createMetaFixture();
  let retryCount = 0;
  let redraw = null;
  let language = 'en';
  const presenter = createCrimeResultMetaPresenter({
    root,
    onRetry: () => { retryCount += 1; },
    languageChange: (listener) => {
      redraw = listener;
      return () => { redraw = null; };
    },
    translate: (key) => `${language}:${key}`,
  });
  const provenance = createCrimeResultProvenance(validInput());
  presenter.ready(provenance);
  presenter.failed(new Error('timeout'));
  presenter.failed(new Error('timeout again'));

  assert.ok(nodes.retry.getAttribute('aria-label'));
  nodes.retry.click();
  assert.equal(retryCount, 1);

  const english = nodes.status.textContent;
  language = 'zh-CN';
  redraw();
  assert.notEqual(nodes.status.textContent, english);
  assert.equal(presenter.getProvenance(), provenance);
  assert.equal(presenter.getAvailability(), 'stale');

  presenter.destroy();
  nodes.retry.click();
  assert.equal(retryCount, 1);
  assert.equal(redraw, null);
});

test('result metadata resolves stable translation keys for kind, dataset, and query mode labels', () => {
  const { root, nodes } = createMetaFixture('incidents');
  const seen = [];
  const presenter = createCrimeResultMetaPresenter({
    root,
    languageChange: () => () => {},
    translate: (key, params = {}) => {
      seen.push(key);
      return `${key}:${Object.values(params).join('|')}`;
    },
  });
  presenter.ready(createCrimeResultProvenance(validInput()));

  assert.ok(seen.includes('resultMeta.result.incidentQuery'));
  assert.ok(seen.includes('scope.dataset.incidents'));
  assert.ok(seen.includes('scope.live'));
  assert.ok(seen.includes('resultMeta.mode.buffer'));
  assert.doesNotMatch(nodes.sources.textContent, /^incidents:/i);
  assert.doesNotMatch(nodes.scope.textContent, /^buffer:/i);
});

test('refresh outcome helpers remain available from the single metadata ownership boundary', () => {
  assert.deepEqual(normalizeCrimeRefreshResult({ applied: true }), { status: 'live' });
  assert.deepEqual(normalizeCrimeRefreshResult({ applied: false }), { status: 'superseded' });
  assert.deepEqual(classifyCrimeRefreshJobs([
    { name: 'boundary', result: { status: 'fulfilled', value: { applied: true } } },
    { name: 'charts', result: { status: 'rejected', reason: new Error('offline') } },
  ]), { status: 'partial', succeeded: ['boundary'], failed: ['charts'] });
});
