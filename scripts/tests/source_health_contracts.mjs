#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createSourceHealthLoader } from '../../src/source_health/source_health_loader.js';
import {
  adaptCrimeCoverageObservation,
  adaptTransportObservation,
  bundledArtifactObservations,
  createSourceHealthObservations,
} from '../../src/source_health/source_health_adapters.js';
import { BUNDLED_SOURCE_RECEIPTS } from '../../src/source_health/source_health_bundled_receipts.js';
import { SOURCE_HEALTH_CATALOG } from '../../src/source_health/source_health_catalog.js';
import {
  admitSourceHealthObservation,
  buildSourceHealthReadModel,
  SOURCE_HEALTH_SCHEMA_VERSION,
  SOURCE_HEALTH_STATUSES,
} from '../../src/source_health/source_health_read_model.js';
import { renderSourceHealthSurface } from '../../src/source_health/source_health_view.js';

const NOW = '2026-08-10T12:00:00.000Z';

function observation(overrides = {}) {
  return {
    sourceId: 'philadelphia-reported-crime',
    status: 'current',
    statusReason: 'fixture',
    clocks: {
      sourceAsOf: '2026-08-08',
      retrievedAt: '2026-08-09T01:00:00.000Z',
      builtAt: '2026-08-09T02:00:00.000Z',
      observedAt: NOW,
    },
    snapshot: { version: 'fixture-v1', identity: 'fixture:1' },
    boundaryVintage: null,
    coverage: { geography: 'Philadelphia', temporalStart: '2006-01-01', temporalEnd: '2026-08-08' },
    transport: { endpointUrl: 'https://example.test/data', lastModified: null, etag: null },
    recordCount: 0,
    ...overrides,
  };
}

test('source health preserves four clocks as distinct immutable evidence', () => {
  const admitted = admitSourceHealthObservation(observation());
  assert.deepEqual(admitted.clocks, {
    sourceAsOf: '2026-08-08',
    retrievedAt: '2026-08-09T01:00:00.000Z',
    builtAt: '2026-08-09T02:00:00.000Z',
    observedAt: NOW,
  });
  assert.equal(Object.isFrozen(admitted.clocks), true);
  assert.throws(() => admitSourceHealthObservation(observation({
    clocks: {
      sourceAsOf: '2026-08-08',
      retrievedAt: '2026-08-09',
      builtAt: '2026-08-09T02:00:00.000Z',
      observedAt: NOW,
    },
  })), /retrievedAt/);
});

test('HTTP validators remain transport evidence and never become a business clock', () => {
  const transport = adaptTransportObservation({
    sourceId: 'philadelphia-city-limits',
    endpointUrl: 'https://example.test/city-limits',
    observedAt: NOW,
    lastModified: 'Sat, 08 Aug 2026 10:00:00 GMT',
    etag: '"transport-v1"',
  });
  assert.equal(transport.status, 'unknown');
  assert.deepEqual(transport.clocks, {
    sourceAsOf: null,
    retrievedAt: null,
    builtAt: null,
    observedAt: NOW,
  });
  assert.equal(transport.transport.lastModified, 'Sat, 08 Aug 2026 10:00:00 GMT');
  assert.equal(transport.transport.etag, '"transport-v1"');
});

test('missing fields, unknown fields, and duplicate observations fail closed per supported source', () => {
  const missingStatus = observation();
  delete missingStatus.status;
  const extraField = { ...observation(), unexpectedFreshness: true };
  const model = buildSourceHealthReadModel({
    catalog: SOURCE_HEALTH_CATALOG,
    observations: [missingStatus, extraField],
  });
  const crime = model.sources.find(({ id }) => id === 'philadelphia-reported-crime');
  assert.equal(model.schemaVersion, SOURCE_HEALTH_SCHEMA_VERSION);
  assert.equal(model.rejectedObservationCount, 2);
  assert.equal(crime.status, 'unavailable');
  assert.equal(crime.statusReason, 'schema-drift');
  assert.equal(crime.recordCount, null);
});

test('zero, unavailable, partial, stale, and unknown remain separate states', () => {
  assert.deepEqual(SOURCE_HEALTH_STATUSES, ['current', 'partial', 'stale', 'unavailable', 'unknown']);
  const currentZero = admitSourceHealthObservation(observation({ recordCount: 0 }));
  assert.equal(currentZero.status, 'current');
  assert.equal(currentZero.recordCount, 0);
  for (const status of ['unavailable', 'unknown']) {
    assert.throws(
      () => admitSourceHealthObservation(observation({ status, recordCount: 0 })),
      /must not coerce recordCount/,
    );
  }
  assert.equal(admitSourceHealthObservation(observation({ status: 'partial' })).status, 'partial');
  assert.equal(admitSourceHealthObservation(observation({ status: 'stale' })).status, 'stale');
  const untouched = buildSourceHealthReadModel({ catalog: SOURCE_HEALTH_CATALOG }).sources;
  assert.equal(untouched.every(({ status }) => status === 'unknown'), true);
});

test('Crime coverage uses semantic dates and fails unavailable on malformed coverage', () => {
  assert.equal(adaptCrimeCoverageObservation({
    status: 'ready', min: '2006-01-01', max: '2026-08-08',
  }, { now: NOW }).status, 'current');
  assert.equal(adaptCrimeCoverageObservation({
    status: 'ready', min: '2006-01-01', max: '2026-07-01',
  }, { now: NOW }).status, 'stale');
  assert.equal(adaptCrimeCoverageObservation({
    status: 'ready', min: '2006-01-01', max: 'latest',
  }, { now: NOW }).status, 'unavailable');
  assert.equal(adaptCrimeCoverageObservation({ status: 'error' }, { now: NOW }).recordCount, null);
});

test('official URLs and bundled receipt versions match committed fixtures', async () => {
  const [acsText, vreText, hinReceiptText, tractText, tractReceiptText] = await Promise.all([
    readFile(new URL('../../src/data/acs_tracts_2024_pa101.json', import.meta.url), 'utf8'),
    readFile(new URL('../../src/data/acs_vre_b01003_2024_pa101.json', import.meta.url), 'utf8'),
    readFile(new URL('../../public/data/hin_2025.receipt.json', import.meta.url), 'utf8'),
    readFile(new URL('../../public/data/tract_crime_counts_last12m.json', import.meta.url), 'utf8'),
    readFile(new URL('../../src/source_health/tract_crime_bundled_receipt.json', import.meta.url), 'utf8'),
  ]);
  const acs = JSON.parse(acsText);
  const vre = JSON.parse(vreText);
  const hin = JSON.parse(hinReceiptText);
  const tract = JSON.parse(tractText);
  const tractReceipt = JSON.parse(tractReceiptText);
  assert.deepEqual(BUNDLED_SOURCE_RECEIPTS.acsPopulation, {
    sourceId: 'acs-tract-population',
    sourceAsOf: `${acs.manifest.vintage}-12-31`,
    retrievedAt: acs.manifest.retrievedAt,
    builtAt: null,
    version: `${acs.manifest.vintage} ACS 5-year (${acs.manifest.period.replace('-', '–')}), table B01003`,
    identity: acs.manifest.rowsSha256,
    recordCount: acs.manifest.rowCount,
  });
  assert.deepEqual(BUNDLED_SOURCE_RECEIPTS.acsVre, {
    sourceId: 'acs-tract-population-vre',
    sourceAsOf: '2024-12-31',
    retrievedAt: vre.manifest.retrievedAt,
    builtAt: null,
    version: `${vre.schemaVersion}:${vre.manifest.release}`,
    identity: vre.manifest.rowsSha256,
    recordCount: vre.manifest.rowCount,
    boundaryVintage: '2020 Census tract geography',
    geography: vre.manifest.geography,
    temporalStart: '2020-01-01',
    temporalEnd: '2024-12-31',
  });
  assert.deepEqual(BUNDLED_SOURCE_RECEIPTS.hin2025, {
    sourceId: 'hin-2025',
    sourceAsOf: hin.source.sourceAsOf,
    retrievedAt: hin.artifact.retrievedAt,
    builtAt: hin.artifact.builtAt,
    version: `${hin.artifact.schema}@${hin.source.networkVintage}`,
    identity: hin.artifact.identity,
    recordCount: hin.artifact.featureCount,
    boundaryVintage: null,
    geography: 'Philadelphia High Injury Network historical planning geometry',
    temporalStart: '2019-01-01',
    temporalEnd: '2023-12-31',
  });
  assert.deepEqual(BUNDLED_SOURCE_RECEIPTS.tractCrime, {
    sourceId: tractReceipt.source.sourceId,
    sourceAsOf: tractReceipt.clocks.sourceAsOf,
    retrievedAt: tractReceipt.clocks.retrievedAt,
    builtAt: tractReceipt.clocks.builtAt,
    version: tractReceipt.artifact.version,
    identity: tractReceipt.artifact.identity,
    recordCount: tractReceipt.artifact.recordCount,
    temporalStart: tractReceipt.coverage.temporalStart,
    temporalEnd: tractReceipt.coverage.temporalEnd,
  });
  assert.equal(tractReceipt.clocks.sourceAsOf, tract.meta.coverage_date);
  assert.equal(tractReceipt.clocks.builtAt, tract.meta.generated_at);
  assert.equal(tractReceipt.clocks.observedAt, null);
  assert.equal(tractReceipt.failClosed.recordCount, null);
  assert.equal(tractReceipt.failClosed.unavailableIsZero, false);
  assert.equal(tractReceipt.failClosed.unknownIsCurrent, false);
  assert.equal(SOURCE_HEALTH_CATALOG.length, 10);
  assert.deepEqual(
    SOURCE_HEALTH_CATALOG
      .filter(({ id }) => ['acs-tract-population-vre', 'hin-2025'].includes(id))
      .map(({ id }) => id),
    ['acs-tract-population-vre', 'hin-2025'],
  );
  for (const source of SOURCE_HEALTH_CATALOG) {
    assert.match(source.canonicalUrl, /^https:\/\//);
    assert.match(source.officialHandoff.url, /^https:\/\//);
    assert.match(source.license.url, /^https:\/\//);
  }
  const observations = bundledArtifactObservations({ now: NOW });
  assert.deepEqual(observations.map(({ sourceId }) => sourceId), [
    'acs-tract-population',
    'acs-tract-population-vre',
    'hin-2025',
    'tract-crime-snapshot',
  ]);
  assert.equal(observations.find(({ sourceId }) => sourceId === 'acs-tract-population-vre').status, 'partial');
  assert.equal(observations.find(({ sourceId }) => sourceId === 'hin-2025').status, 'partial');
  assert.equal(observations.find(({ sourceId }) => sourceId === 'tract-crime-snapshot').status, 'stale');
});

test('feature-owned observations replace matching bundled evidence without duplication', () => {
  const existing = createSourceHealthObservations({}, { now: NOW });
  assert.deepEqual(existing, [
    adaptCrimeCoverageObservation(undefined, { now: NOW }),
    ...bundledArtifactObservations({ now: NOW }),
  ]);
  assert.deepEqual(existing.map(({ sourceId }) => sourceId), [
    'philadelphia-reported-crime',
    'acs-tract-population',
    'acs-tract-population-vre',
    'hin-2025',
    'tract-crime-snapshot',
  ]);

  const featureOwned = admitSourceHealthObservation(observation({
    sourceId: 'hin-2025',
    statusReason: 'runtime-receipt',
  }));
  const registeredSourceHealthObservations = [featureOwned];
  const extended = createSourceHealthObservations({
    registeredSourceHealthObservations,
  }, { now: NOW });
  assert.equal(extended.length, existing.length);
  assert.equal(extended.find(({ sourceId }) => sourceId === 'hin-2025'), featureOwned);
  assert.equal(extended.filter(({ sourceId }) => sourceId === 'hin-2025').length, 1);
  assert.equal(Object.isFrozen(extended), true);
  assert.deepEqual(registeredSourceHealthObservations, [featureOwned]);

  const latestFeatureOwned = admitSourceHealthObservation(observation({
    sourceId: 'hin-2025',
    statusReason: 'latest-runtime-receipt',
  }));
  const deduplicated = createSourceHealthObservations({
    registeredSourceHealthObservations: [featureOwned, latestFeatureOwned],
  }, { now: NOW });
  assert.equal(deduplicated.length, existing.length);
  assert.equal(deduplicated.find(({ sourceId }) => sourceId === 'hin-2025'), latestFeatureOwned);
  assert.equal(deduplicated.filter(({ sourceId }) => sourceId === 'hin-2025').length, 1);

  assert.throws(
    () => createSourceHealthObservations({ registeredSourceHealthObservations: {} }, { now: NOW }),
    /must be an array/,
  );
});

class TestNode {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.className = '';
    this._text = '';
  }

  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return `${this._text}${this.children.map((child) => typeof child === 'string' ? child : child.textContent).join('')}`; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this._text = ''; this.children = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  queryAll(tagName) {
    const expected = tagName.toUpperCase();
    return [
      ...(this.tagName === expected ? [this] : []),
      ...this.children.flatMap((child) => child instanceof TestNode ? child.queryAll(expected) : []),
    ];
  }
}

class TestDocument {
  createElement(tagName) { return new TestNode(tagName, this); }
  createDocumentFragment() { return new TestNode('fragment', this); }
}

test('text-first surface renders semantic no-map DOM with four clocks and accessible links', () => {
  const documentRef = new TestDocument();
  const host = new TestNode('section', documentRef);
  host.hidden = true;
  const observations = [
    adaptCrimeCoverageObservation({ status: 'error' }, { now: NOW }),
    ...bundledArtifactObservations({ now: NOW }),
  ];
  const model = buildSourceHealthReadModel({ catalog: SOURCE_HEALTH_CATALOG, observations });
  renderSourceHealthSurface({ host, model, language: 'zh-CN' });

  assert.equal(host.hidden, false);
  assert.equal(host.getAttribute('aria-labelledby'), 'source-health-title');
  assert.equal(host.queryAll('article').length, SOURCE_HEALTH_CATALOG.length);
  assert.ok(host.queryAll('dl').length > SOURCE_HEALTH_CATALOG.length);
  assert.ok(host.queryAll('a').every((anchor) => anchor.target === '_blank' && anchor.rel === 'noopener noreferrer'));
  assert.match(host.textContent, /数据来源与更新时间/);
  assert.match(host.textContent, /来源事实截至/);
  assert.match(host.textContent, /获取时间/);
  assert.match(host.textContent, /构建时间/);
  assert.match(host.textContent, /观测时间/);
  assert.doesNotMatch(host.textContent, /real-time danger|实时危险/i);
  assert.equal(host.queryAll('canvas').length, 0);
  assert.equal(host.queryAll('svg').length, 0);
});

function control() {
  const listeners = new Map();
  return {
    hidden: true,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    dispatch(type) { listeners.get(type)?.(); },
    setAttribute(name, value) { this[name] = value; },
  };
}

test('Data Status controller remains lazy until native details opens and retries import failure', async () => {
  const status = control();
  const retry = control();
  const host = control();
  const mount = {
    open: false,
    dataset: {},
    ...control(),
    querySelector(selector) {
      return new Map([
        ['[data-source-health-host]', host],
        ['[data-source-health-loader-status]', status],
        ['[data-source-health-retry]', retry],
      ]).get(selector) || null;
    },
  };
  let imports = 0;
  const loader = createSourceHealthLoader({
    mount,
    warn: () => {},
    loadUi: async () => {
      imports += 1;
      if (imports === 1) throw new Error('chunk failed');
      return { initSourceHealthSurface: () => ({ refresh() {} }) };
    },
  });
  assert.equal(imports, 0);
  mount.dispatch('toggle');
  assert.equal(imports, 0);
  mount.open = true;
  mount.dispatch('toggle');
  await loader.whenIdle();
  assert.equal(imports, 1);
  assert.equal(mount.dataset.sourceHealthLoader, 'unavailable');
  assert.equal(retry.hidden, false);
  retry.dispatch('click');
  await loader.whenIdle();
  assert.equal(imports, 2);
  assert.equal(mount.dataset.sourceHealthLoader, 'ready');
  assert.equal(host['aria-busy'], 'false');
});

test('source-health lazy boundary stays bounded and map-free', async () => {
  const paths = [
    '../../src/source_health/source_health_loader.js',
    '../../src/source_health/source_health_controller.js',
    '../../src/source_health/source_health_view.js',
    '../../src/source_health/source_health_catalog.js',
    '../../src/source_health/source_health_read_model.js',
    '../../src/source_health/source_health_adapters.js',
    '../../src/styles/source-health.css',
  ];
  const contents = await Promise.all(paths.map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  assert.ok(Buffer.byteLength(contents[0]) <= 4_000, 'static loader must remain a small entry-edge module');
  assert.ok(contents.slice(1).reduce((sum, value) => sum + Buffer.byteLength(value), 0) <= 50_000, 'lazy source-health implementation must stay under its focused raw ceiling');
  assert.match(contents[1], /source-health\.css/);
  assert.doesNotMatch(contents.join('\n'), /maplibre|initMap|optional_map_runtime|@turf/);
});

test('app shell exposes a native accessible entry and keeps the controller dynamically imported', async () => {
  const [html, main] = await Promise.all([
    readFile(new URL('../../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../../src/main.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /<details[^>]*data-source-health-entry/);
  assert.match(html, /<summary[^>]*aria-controls="source-health-surface"/);
  assert.match(html, /data-source-health-loader-status[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/);
  assert.match(html, /data-source-health-retry[^>]*hidden/);
  assert.match(html, /id="source-health-surface"[^>]*data-source-health-host[^>]*aria-busy="false"[^>]*hidden/);
  assert.match(main, /import \{ createSourceHealthLoader \} from '\.\/source_health\/source_health_loader\.js';/);
  assert.match(main, /loadUi: \(\) => import\('\.\/source_health\/source_health_controller\.js'\)/);
  assert.match(main, /registeredSourceHealthObservations: \[\.\.\.registeredSourceHealthObservations\]/);
  assert.match(main, /onSourceHealthObservation: registerSourceHealthObservation/g);
  assert.doesNotMatch(main, /^import .*source_health_controller/m);
});
