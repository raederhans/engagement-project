import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchHomeProfileEvidence,
  resolveHomePropertyAddress,
} from '../../src/home_compare/api.js';
import { validateHomeCompareSourceRegistry } from '../../src/home_compare/source_registry.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRegistry = JSON.parse(await readFile(
  path.join(repoRoot, 'public/data/home_compare_sources.v1.json'),
  'utf8',
));

test('Home Compare binds all source identities to a trusted synchronous registry baseline', () => {
  for (const [index, source] of sourceRegistry.sources.entries()) {
    const mutations = {
      canonical_url: 'https://example.invalid/hostile-source',
      dataset: `${source.dataset}-hostile-drift`,
      expected_fields: [...source.expected_fields, 'hostile_field'],
      selected_fields: source.selected_fields.slice(0, -1),
      ...(source.api_url ? {
        api_url: 'https://example.invalid/hostile-api',
        transport: source.transport === 'carto-sql' ? 'arcgis-feature-service' : 'carto-sql',
      } : {}),
    };
    for (const [field, hostileValue] of Object.entries(mutations)) {
      const hostile = structuredClone(sourceRegistry);
      hostile.sources[index][field] = hostileValue;
      assert.throws(
        () => validateHomeCompareSourceRegistry(hostile),
        /source (?:identit|registr)/i,
        `${source.id} accepted hostile ${field}`,
      );
    }
  }
});

test('Home Compare keeps private source inputs out of URLs/logs and isolates one source failure', async () => {
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const endpoint = new URL(url);
    const body = new URLSearchParams(options.body || '');
    const sql = body.get('q') || '';

    if (endpoint.pathname.endsWith('/findAddressCandidates')) {
      return {
        candidates: [{
          address: '100 TEST ST, 19100',
          score: 100,
          location: { x: -75.16, y: 39.95 },
          attributes: {
            Score: 100,
            Match_addr: '100 TEST ST, 19100',
            House: '100',
            Addr_type: 'PointAddress',
            Ref_ID: 'synthetic-ref',
          },
        }],
      };
    }
    if (/FROM opa_properties_public/i.test(sql)) {
      return { rows: [{
        parcel_number: '123456789',
        location: '100 TEST ST',
        lon: -75.15995,
        lat: 39.95002,
        assessment_date: '9798-06-12T08:00:00Z',
        market_value: 100000,
        market_value_date: '2026-01-01T00:00:00Z',
        sale_date: '9277-02-17T10:00:00Z',
        sale_price: 95000,
        recording_date: '2026-08-20T00:00:00Z',
        total_livable_area: 1200,
        number_of_bedrooms: 3,
        number_of_bathrooms: 2,
        year_built: 1999,
        zoning: 'RSA5',
      }] };
    }
    if (/FROM assessments/i.test(sql)) return { rows: [] };
    if (/FROM rtt_summary/i.test(sql)) return { rows: [{
      document_type: 'DEED',
      display_date: '9798-06-12T08:00:00Z',
      recording_date: '2026-08-20T00:00:00Z',
      document_date: '9277-02-17T10:00:00Z',
      adjusted_total_consideration: 1,
      matched_regmap: true,
      discrepancy: null,
      property_count: 1,
    }] };
    if (/FROM public_cases_fc/i.test(sql)) {
      return { rows: [{ record_count: 0, open_count: 0, earliest_at: null, latest_at: null }] };
    }
    if (/FROM violations/i.test(sql)) {
      return { rows: [{ record_count: 0, not_closed_count: 0, latest_at: null }] };
    }
    if (/FROM business_licenses/i.test(sql)) {
      return { rows: [{ record_count: 0, active_count: 0, latest_at: null }] };
    }
    if (/FROM case_investigations/i.test(sql)) {
      return { rows: [{ record_count: 0, not_closed_count: 0, latest_at: null }] };
    }
    if (/FROM incidents_part1_part2/i.test(sql)) return { rows: [{ n: 0 }] };
    if (endpoint.pathname.includes('/Vacant_Indicators_Bldg/')) return { features: [] };
    if (endpoint.pathname.includes('/high_injury_network_2025/')) {
      const error = new Error('Synthetic HIN outage.');
      error.code = 'HIN_DOWN';
      throw error;
    }
    throw new Error(`Unexpected synthetic request to ${endpoint.origin}${endpoint.pathname}`);
  };

  const identity = await resolveHomePropertyAddress('100 TEST ST', { request });
  const callsBeforeInvalidClock = calls.length;
  await assert.rejects(
    fetchHomeProfileEvidence(identity, { request, now: () => 'not-a-clock' }),
    /retrieval clock/i,
  );
  assert.equal(calls.length, callsBeforeInvalidClock, 'invalid clocks must fail before source transport');
  const result = await fetchHomeProfileEvidence(identity, {
    request,
    now: () => '2026-08-29T00:00:00.000Z',
    coverageReader: async () => ({ min: '2006-01-01', max: '2026-08-27' }),
  });

  assert.equal(result.profile.status, 'partial');
  assert.equal(result.profile.evidence.property.status, 'partial');
  assert.equal(result.profile.evidence.property.dataAsOf, '2026-08-20T00:00:00.000Z');
  assert.equal(result.profile.evidence.property.value.assessmentDate, null);
  assert.equal(result.profile.evidence.property.value.latestSaleDate, null);
  assert.equal(result.profile.evidence.property.value.marketValueDate, '2026-01-01T00:00:00.000Z');
  assert.equal(result.profile.evidence.property.value.recordingDate, '2026-08-20T00:00:00.000Z');
  assert.equal(result.profile.evidence.property.value.futureDatedFieldCount, 2);
  assert.doesNotMatch(JSON.stringify(result.profile), /9798-06-12|9277-02-17/);
  assert.equal(result.profile.evidence.transfers.status, 'partial');
  assert.equal(result.profile.evidence.transfers.dataAsOf, '2026-08-20T00:00:00.000Z');
  assert.equal(result.profile.evidence.transfers.value.futureDatedFieldCount, 2);
  assert.equal(result.profile.evidence.transfers.value.records[0].displayDate, null);
  assert.equal(result.profile.evidence.transfers.value.records[0].documentDate, null);
  assert.equal(result.profile.evidence.hinContext.status, 'unavailable');
  assert.equal(result.profile.evidence.hinContext.value, null);
  assert.equal(result.sourceStates['vision-zero-hin-2025'].status, 'unavailable');
  assert.equal(result.sourceStates['vision-zero-hin-2025'].recordCount, null);
  assert.equal(result.profile.evidence.serviceRequests.status, 'available');
  assert.equal(result.profile.evidence.reportedIncidents.status, 'available');
  assert.ok(calls.length >= 10);
  for (const call of calls) {
    assert.equal(new URL(call.url).search, '', `private source URL leaked a query: ${call.url}`);
    assert.equal(call.options.method, 'POST');
  }
  const geocoder = calls.find(({ url }) => url.endsWith('/findAddressCandidates'));
  const vacancy = calls.find(({ url }) => url.includes('/Vacant_Indicators_Bldg/'));
  const hin = calls.find(({ url }) => url.includes('/high_injury_network_2025/'));
  assert.equal(new URLSearchParams(geocoder.options.body).get('Street'), '100 TEST ST');
  assert.match(new URLSearchParams(vacancy.options.body).get('where'), /123456789/);
  assert.match(new URLSearchParams(hin.options.body).get('geometry'), /^-75\.16,39\.95$/);
  for (const call of [geocoder, vacancy, hin]) assert.equal(call.options.retries, 0);

  const serializedUrls = JSON.stringify(calls.map(({ url }) => url));
  assert.doesNotMatch(serializedUrls, /100 TEST ST|123456789|-75\.16|39\.95/i);
  const apiSource = await readFile(path.join(repoRoot, 'src/home_compare/api.js'), 'utf8');
  assert.doesNotMatch(apiSource, /\b(?:fetchCountBuffer|fetchCoverage|logQuery)\b/);
});
