import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  admitPropertyAddressCandidates,
  admitPropertyParcelJoin,
} from '../../src/home_compare/address.js';
import {
  combineHomeCompareSources,
  fetchHomeProfileEvidence,
  loadHomeCompareRegistry,
} from '../../src/home_compare/api.js';
import {
  buildWeightSensitivity,
  createEvidenceMetric,
  createHomeCompareProjection,
  decodeHomeCompareShareState,
  encodeHomeCompareShareState,
  HOME_COMPARE_DIMENSIONS,
  HOME_COMPARE_EVIDENCE_KEYS,
  validateHomeCompareProjection,
} from '../../src/home_compare/contract.js';
import {
  observeHomeCompareSources,
  validateHomeCompareSourceObservation,
  validateHomeCompareSourceRegistry,
  writeHomeCompareSourceManifest,
} from '../lib/home_compare_source_smoke.mjs';
import {
  homeCompareProductHtml,
} from '../../src/home_compare/view.js';
import { homeCompareResultsHtml } from '../../src/home_compare/results_view.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registry = validateHomeCompareSourceRegistry(JSON.parse(
  await readFile(path.join(repoRoot, 'public/data/home_compare_sources.v1.json'), 'utf8'),
));
const defaultWeights = Object.fromEntries(HOME_COMPARE_DIMENSIONS.map((key) => [key, 20]));

test('property address admission rejects low score, competing candidates, and geography conflict', () => {
  assert.throws(
    () => admitPropertyAddressCandidates(candidatePayload([candidate({ score: 89 })])),
    hasCode('ADDRESS_LOW_CONFIDENCE'),
  );
  assert.throws(
    () => admitPropertyAddressCandidates(candidatePayload([
      candidate({ address: '100 TEST ST, 19100', score: 100 }),
      candidate({ address: '102 TEST ST, 19100', score: 99 }),
    ])),
    hasCode('ADDRESS_AMBIGUOUS'),
  );
  assert.throws(
    () => admitPropertyAddressCandidates(candidatePayload([
      candidate({ x: -75.16, y: 39.95 }),
      candidate({ x: -75.16, y: 39.952 }),
    ])),
    hasCode('ADDRESS_GEOGRAPHY_CONFLICT'),
  );
});

test('property address and parcel join preserve runtime identity while failing closed on parcel gaps', () => {
  const address = admitPropertyAddressCandidates(candidatePayload([candidate()]));
  const joined = admitPropertyParcelJoin(address, { rows: [parcelRow()] });
  assert.equal(joined.normalizedAddress, '100 TEST ST');
  assert.equal(joined.parcelId, '123456789');
  assert.ok(joined.join.distanceMeters < 20);
  assert.equal(joined.property.yearBuilt, 1999);

  assert.throws(() => admitPropertyParcelJoin(address, { rows: [] }), hasCode('PARCEL_MISSING'));
  assert.throws(() => admitPropertyParcelJoin(address, { rows: [
    parcelRow(),
    parcelRow({ parcel_number: '987654321' }),
  ] }), hasCode('PARCEL_AMBIGUOUS'));
  assert.throws(() => admitPropertyParcelJoin(address, { rows: [
    parcelRow({ location: '102 TEST ST' }),
  ] }), hasCode('PARCEL_ADDRESS_MISMATCH'));
  assert.throws(() => admitPropertyParcelJoin(address, { rows: [
    parcelRow({ lon: -75.1, lat: 40.05 }),
  ] }), hasCode('PARCEL_GEOGRAPHY_MISMATCH'));
  assert.throws(() => admitPropertyParcelJoin(address, { rows: [
    parcelRow({ lon: 0, lat: 0 }),
  ] }), hasCode('PARCEL_ROW_INVALID'));
});

test('Home Compare serving projection admits two, three, and four profiles without private fields', () => {
  for (const count of [2, 3, 4]) {
    const projection = makeProjection(count);
    assert.equal(projection.profiles.length, count);
    assert.equal(projection.status, 'partial', 'source revision gaps keep the overall projection partial');
    assert.equal(projection.areaIntelligence.status, 'not-promoted');
    assert.equal(projection.areaIntelligence.forecast.status, 'unavailable');
    assert.deepEqual(projection.areaIntelligence.forecast.predictions, []);
    assert.equal(projection.commute.status, 'unavailable');
    const serialized = JSON.stringify(projection);
    assert.doesNotMatch(serialized, /"(?:input_address|normalized_address|coordinates|parcel_identifier|source_record_id)"\s*:/i);
    assert.doesNotMatch(serialized, /100 TEST ST/i);
  }
});

test('Home Compare keeps partial and unavailable evidence distinct from admitted zero', () => {
  const availableZero = metric({ value: { recordCount: 0 } });
  const unavailable = metric({ status: 'unavailable', value: null, dataAsOf: null });
  assert.equal(availableZero.status, 'available');
  assert.equal(availableZero.value.recordCount, 0);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.value, null);
  assert.throws(
    () => createEvidenceMetric({
      status: 'unavailable',
      value: { recordCount: 0 },
      dataAsOf: null,
      coverage: 'Synthetic test coverage.',
      precision: 'Synthetic test precision.',
      sourceIds: ['synthetic-source'],
      limitations: [],
    }),
    /value must be null/i,
  );
});

test('Home Compare rejects promotion, forecasts, safety claims, and private projection fields', () => {
  const projection = makeProjection(2);
  const promoted = structuredClone(projection);
  promoted.areaIntelligence.status = 'promoted';
  assert.throws(() => validateHomeCompareProjection(promoted), /must remain not-promoted/i);

  const forecast = structuredClone(projection);
  forecast.areaIntelligence.forecast = { status: 'available', reason: 'synthetic', predictions: [1] };
  assert.throws(() => validateHomeCompareProjection(forecast), /forecast must remain unavailable/i);

  const safety = structuredClone(projection);
  safety.profiles[0].evidence.property.value.safety_score = 99;
  assert.throws(() => validateHomeCompareProjection(safety), /forbidden field/i);

  const privateField = structuredClone(projection);
  privateField.profiles[0].evidence.property.value.address = '100 TEST ST';
  assert.throws(() => validateHomeCompareProjection(privateField), /forbidden field/i);
});

test('Home Compare rejects caller-tampered profile and root availability states', () => {
  const rootTamper = structuredClone(makeProjection(2));
  rootTamper.status = 'available';
  assert.throws(
    () => validateHomeCompareProjection(rootTamper),
    /status mismatch/i,
  );

  const profileTamper = structuredClone(makeProjection(2));
  profileTamper.profiles[0].evidence.assessments = metric({
    status: 'unavailable', value: null, dataAsOf: null,
  });
  assert.throws(
    () => validateHomeCompareProjection(profileTamper),
    /status mismatch/i,
  );
});

test('share state contains weights and dimensions only and rejects malicious or private state', () => {
  const encoded = encodeHomeCompareShareState({ weights: defaultWeights });
  const decoded = decodeHomeCompareShareState(encoded);
  assert.deepEqual(decoded.weights, defaultWeights);
  assert.deepEqual(decoded.dimensions, HOME_COMPARE_DIMENSIONS);
  assert.doesNotMatch(encoded, /address|destination|coordinate|parcel|<script/i);

  assert.throws(() => decodeHomeCompareShareState(JSON.stringify({
    ...JSON.parse(encoded),
    address: '<img src=x onerror=alert(1)>',
  })), /fields are invalid/i);
  assert.throws(() => decodeHomeCompareShareState(JSON.stringify({
    ...JSON.parse(encoded),
    weights: { ...defaultWeights, property: 101 },
  })), /integer from 0 to 100/i);
  assert.throws(() => decodeHomeCompareShareState('{"__proto__":{"address":"private"}}'), /fields are invalid/i);
  assert.throws(() => decodeHomeCompareShareState('x'.repeat(4097)), /bounded JSON text/i);
  assert.throws(() => decodeHomeCompareShareState(JSON.stringify({
    ...JSON.parse(encoded),
    dimensions: ['property'],
  })), /dimensions are invalid/i);
});

test('weight sensitivity changes evidence emphasis without ranking homes or recommending', () => {
  const sensitivity = buildWeightSensitivity({
    property: 40,
    costHistory: 25,
    civicRecords: 15,
    transportContext: 10,
    dataQuality: 10,
  });
  assert.deepEqual(sensitivity.topDimensions, ['property', 'costHistory']);
  assert.equal(sensitivity.perturbationPercent, 20);
  assert.match(sensitivity.interpretation, /do not rank homes/i);
  assert.doesNotMatch(JSON.stringify(sensitivity), /safety[_-]?score|recommendedHome|winner/i);
});

test('Home Compare view renders 2/3/4 address controls, bilingual boundaries, and escaped labels', () => {
  for (const count of [2, 3, 4]) {
    const shell = homeCompareProductHtml({
      locale: count === 3 ? 'zh-CN' : 'en',
      addressCount: count,
      weights: defaultWeights,
    });
    assert.equal((shell.match(/data-home-address=/g) || []).length, count);
    assert.match(shell, count === 3 ? /并排比较 2–4 个费城住宅/ : /Compare 2–4 Philadelphia homes/);
    assert.match(shell, count === 3
      ? /地址、坐标和 parcel ID 仅临时用于查询列出的官方公共来源/
      : /used ephemerally to query the listed official public sources/);
    assert.match(shell, count === 3
      ? /通勤目的地只保留在本次会话中/
      : /commute destinations remain in this session/);
  }
  const rendered = homeCompareResultsHtml(makeProjection(2), {
    labels: ['<img src=x onerror=alert(1)>', '<script>alert(2)</script>'],
    locale: 'zh-CN',
  });
  assert.doesNotMatch(rendered, /<img|<script/i);
  assert.match(rendered, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(rendered, /预测继续不可用/);
  assert.match(rendered, /通勤时间与 isochrone 不可用/);
  assert.match(rendered, /不计算 safety score/);
});

test('source registry freezes official fields, privacy exclusions, and unavailable routing', () => {
  assert.equal(registry.sources.length, 9);
  assert.equal(registry.routing.status, 'unavailable');
  assert.equal(registry.routing.road.status, 'unavailable');
  assert.equal(registry.routing.transit.status, 'unavailable');
  assert.ok(registry.privacy.forbidden_tracked_or_shareable_fields.includes('address'));
  assert.ok(registry.sources.every((source) => source.canonical_url.startsWith('https://')));
});

test('runtime registry admission rejects drift and routing promotion', async () => {
  assert.equal((await loadHomeCompareRegistry({ request: async () => registry })).sources.length, 9);
  const promoted = structuredClone(registry);
  promoted.routing.status = 'available';
  await assert.rejects(
    loadHomeCompareRegistry({ request: async () => promoted }),
    /must remain unavailable/i,
  );
  const drifted = structuredClone(registry);
  drifted.sources[0].unexpected = true;
  await assert.rejects(
    loadHomeCompareRegistry({ request: async () => drifted }),
    /fields are invalid/i,
  );
});

test('runtime evidence keeps geocoder provenance, unknown counts, source revision, and tax-year timing honest', async () => {
  const identity = admitPropertyParcelJoin(
    admitPropertyAddressCandidates(candidatePayload([candidate()])),
    { rows: [parcelRow()] },
  );
  const result = await fetchHomeProfileEvidence(identity, {
    request: syntheticRuntimeRequest,
    now: () => '2026-08-21T00:00:00.000Z',
    incidentReader: async () => 0,
    coverageReader: async () => ({ min: '2006-01-01', max: '2026-08-20' }),
  });
  assert.deepEqual(result.profile.evidence.property.sourceIds, [
    'citygeo-address-locator',
    'opa-current-property',
  ]);
  assert.equal(result.sourceStates['citygeo-address-locator'].recordCount, 1);
  assert.equal(result.sourceStates['citygeo-address-locator'].dataAsOf, null);
  assert.equal(result.sourceStates['opa-current-property'].recordCount, 1);
  assert.equal(result.sourceStates['opa-current-property'].dataAsOf, '2026-01-01T00:00:00.000Z');
  assert.equal(result.profile.evidence.assessments.status, 'partial');
  assert.equal(result.profile.evidence.assessments.value.latestTaxYear, 2027);
  assert.equal(result.profile.evidence.assessments.dataAsOf, null);
  assert.equal(result.profile.evidence.hinContext.dataAsOf, null);

  result.sourceStates['citygeo-address-locator'].recordCount = null;
  const sources = await combineHomeCompareSources(registry, [result], '2026-08-21T00:00:00.000Z');
  assert.equal(sources.length, 9);
  assert.equal(sources.find(({ sourceId }) => sourceId === 'citygeo-address-locator').recordCount, null);
  assert.deepEqual(
    sources.find(({ sourceId }) => sourceId === 'vision-zero-hin-2025').revision,
    { status: 'unavailable', identity: null },
  );
});

test('source observation validator rejects malformed partial counts', () => {
  const source = registry.sources[0];
  assert.throws(() => validateHomeCompareSourceObservation({
    sourceId: source.id,
    status: 'partial',
    dataset: source.dataset,
    transport: source.transport,
    retrievedAt: '2026-08-21T00:00:00.000Z',
    sourceAsOf: null,
    revision: null,
    rowCount: -1,
    schemaFields: [...source.expected_fields],
    missingFields: [],
    dq: [],
  }, source), /row count/i);
});

test('source smoke fails schema drift closed and writes semantic no-op idempotently', async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'home-compare-smoke-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const requestJson = syntheticSourceRequest(registry);
  const first = await observeHomeCompareSources(registry, {
    requestJson,
    retrievedAt: '2026-08-21T00:00:00.000Z',
  });
  assert.equal(first.status, 'partial');
  assert.ok(first.observations.every(({ status }) => status === 'partial'));
  assert.equal(first.routing.status, 'unavailable');
  const assessment = first.observations.find(({ sourceId }) => sourceId === 'opa-assessment-history');
  assert.equal(assessment.sourceAsOf, null);
  assert.ok(assessment.dq.includes('max-published-assessment-tax-year-2026'));

  const target = path.join(outputRoot, 'manifest.json');
  const written = await writeHomeCompareSourceManifest(first, target);
  assert.equal(written.status, 'published');
  const firstStat = await stat(target);
  const second = await observeHomeCompareSources(registry, {
    requestJson,
    retrievedAt: '2026-08-21T01:00:00.000Z',
  });
  assert.equal(second.semanticIdentity, first.semanticIdentity);
  const noOp = await writeHomeCompareSourceManifest(second, target);
  assert.equal(noOp.status, 'idempotent');
  assert.equal((await stat(target)).mtimeMs, firstStat.mtimeMs);
  assert.equal(JSON.parse(await readFile(target, 'utf8')).generatedAt, first.generatedAt);

  const driftedRequest = syntheticSourceRequest(registry, { omitGeocoderField: 'Ref_ID' });
  const drifted = await observeHomeCompareSources(registry, { requestJson: driftedRequest });
  const geocoder = drifted.observations.find(({ sourceId }) => sourceId === 'citygeo-address-locator');
  assert.equal(geocoder.status, 'unavailable');
  assert.deepEqual(geocoder.missingFields, ['Ref_ID']);
  assert.ok(geocoder.dq.includes('schema-drift'));
});

function makeProjection(count) {
  const profiles = Array.from({ length: count }, (_, index) => {
    const partial = index === count - 1 && count === 3;
    return {
      profileId: `home-${index + 1}`,
      status: partial ? 'partial' : 'available',
      evidence: Object.fromEntries(HOME_COMPARE_EVIDENCE_KEYS.map((key) => [
        key,
        partial && key === 'assessments' ? metric({ status: 'partial' }) : metric(),
      ])),
      limitations: ['Synthetic fixture for isolated contract testing only.'],
    };
  });
  return createHomeCompareProjection({
    generatedAt: '2026-08-21T00:00:00.000Z',
    profiles,
    sources: [sourceObservation()],
    areaIntelligence: areaBoundary(),
    sensitivity: buildWeightSensitivity(defaultWeights),
  });
}

function metric({ status = 'available', value = { recordCount: 0 }, dataAsOf = '2026-08-20T00:00:00.000Z' } = {}) {
  return createEvidenceMetric({
    status,
    value,
    dataAsOf,
    coverage: 'Synthetic fixture coverage.',
    precision: 'Synthetic fixture precision.',
    sourceIds: ['synthetic-source'],
    limitations: ['Synthetic fixture only; not runtime or source evidence.'],
  });
}

function sourceObservation() {
  return {
    sourceId: 'synthetic-source',
    status: 'partial',
    officialUrl: 'https://example.invalid/official-source',
    sourceAsOf: '2026-08-20T00:00:00.000Z',
    retrievedAt: '2026-08-21T00:00:00.000Z',
    builtAt: null,
    observedAt: '2026-08-21T00:00:00.000Z',
    revision: { status: 'unavailable', identity: null },
    coverage: 'Synthetic fixture coverage.',
    precision: 'Synthetic fixture precision.',
    recordCount: 0,
    limitations: ['Synthetic fixture only; not runtime or source evidence.'],
  };
}

function areaBoundary() {
  return {
    status: 'not-promoted',
    historicalEvidence: {
      status: 'available',
      measure: 'PPD reported incidents',
      coverage: '2006-01-01 to 2026-08-22.',
      limitations: ['Reported incidents are not absolute safety evidence.'],
    },
    forecast: {
      status: 'unavailable',
      reason: 'model-did-not-exceed-predefined-seasonal-baseline',
      predictions: [],
    },
  };
}

function candidate({
  address = '100 TEST ST, 19100',
  score = 100,
  x = -75.16,
  y = 39.95,
  type = 'PointAddress',
} = {}) {
  return {
    address,
    score,
    location: { x, y },
    attributes: {
      Score: score,
      Match_addr: address,
      House: '100',
      Addr_type: type,
      Ref_ID: 'synthetic-ref',
    },
  };
}

function candidatePayload(candidates) {
  return { candidates };
}

function parcelRow(overrides = {}) {
  return {
    parcel_number: '123456789',
    location: '100 TEST ST',
    lon: -75.15995,
    lat: 39.95002,
    assessment_date: '2026-01-01T00:00:00Z',
    market_value: 100000,
    market_value_date: '2026-01-01T00:00:00Z',
    sale_date: '2020-01-01T00:00:00Z',
    sale_price: 90000,
    recording_date: '2020-02-01T00:00:00Z',
    total_livable_area: 1200,
    number_of_bedrooms: 3,
    number_of_bathrooms: 2,
    year_built: 1999,
    zoning: 'RSA5',
    ...overrides,
  };
}

async function syntheticRuntimeRequest(url, options = {}) {
  const text = String(url);
  if (text.includes('Vacant_Indicators_Bldg')) return { features: [] };
  if (text.includes('high_injury_network_2025')) return { count: 0 };
  const sql = new URLSearchParams(options.body || '').get('q') || '';
  if (/FROM assessments/i.test(sql)) return { rows: [{ year: 2027, market_value: 120000 }] };
  if (/FROM rtt_summary/i.test(sql)) return { rows: [] };
  if (/FROM public_cases_fc/i.test(sql)) return { rows: [{ record_count: 0, open_count: 0, earliest_at: null, latest_at: null }] };
  if (/FROM violations/i.test(sql)) return { rows: [{ record_count: 0, not_closed_count: 0, latest_at: null }] };
  if (/FROM business_licenses/i.test(sql)) return { rows: [{ record_count: 0, active_count: 0, latest_at: null }] };
  if (/FROM case_investigations/i.test(sql)) return { rows: [{ record_count: 0, not_closed_count: 0, latest_at: null }] };
  throw new Error(`Unexpected synthetic runtime request: ${text}`);
}

function syntheticSourceRequest(sourceRegistry, { omitGeocoderField = null } = {}) {
  const byTable = new Map();
  for (const source of sourceRegistry.sources) {
    if (source.transport !== 'carto-sql') continue;
    if (source.id === 'li-property-history') {
      byTable.set('violations', source.expected_fields.filter((field) => ['opa_account_num', 'parcel_id_num', 'violationdate', 'violationstatus'].includes(field)));
      byTable.set('business_licenses', source.expected_fields.filter((field) => ['opa_account_num', 'parcel_id_num', 'licensetype', 'licensestatus'].includes(field)));
      byTable.set('case_investigations', source.expected_fields.filter((field) => ['opa_account_num', 'parcel_id_num', 'investigationcompleted', 'investigationstatus'].includes(field)));
    } else {
      byTable.set(source.dataset, source.expected_fields);
    }
  }
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/GeocodeServer')) {
      const fields = sourceRegistry.sources.find(({ id }) => id === 'citygeo-address-locator').expected_fields
        .filter((field) => field !== omitGeocoderField);
      return { candidateFields: fields.map((name) => ({ name })) };
    }
    if (parsed.pathname.endsWith('/query')) return { count: 7 };
    if (parsed.hostname === 'services.arcgis.com') {
      const source = sourceRegistry.sources.find(({ api_url }) => api_url === `${parsed.origin}${parsed.pathname}`);
      return {
        fields: source.expected_fields.map((name) => ({ name })),
        editingInfo: { lastEditDate: Date.parse('2026-08-17T00:00:00.000Z') },
      };
    }
    const query = parsed.searchParams.get('q') || '';
    const table = [...byTable.keys()].find((name) => query.includes(`FROM ${name}`));
    if (!table) throw new Error(`Synthetic request did not recognize query: ${query}`);
    if (/LIMIT 0/i.test(query)) {
      return { fields: Object.fromEntries(byTable.get(table).map((field) => [field, { type: 'string' }])) };
    }
    return { rows: [{ row_count: 10, source_as_of: '2026-08-20T00:00:00.000Z' }] };
  };
}

function hasCode(code) {
  return (error) => error?.code === code;
}
