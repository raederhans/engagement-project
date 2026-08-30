import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  validateHomeCompareCitywideReadiness as validateProducerReadiness,
  writeHomeCompareCitywideReadiness,
} from '../lib/home_compare_citywide_readiness.mjs';
import {
  homeCompareCitywideReadinessHtml,
  readinessIdentity,
  validateHomeCompareCitywideReadiness,
} from '../../src/home_compare/citywide_readiness.js';

const SOURCE_IDS = [
  'citygeo-address-locator',
  'opa-current-property',
  'opa-assessment-history',
  'real-estate-transfers',
  'philly311-requests',
  'li-property-history',
  'vacant-property-indicators',
  'philadelphia-reported-crime',
  'vision-zero-hin-2025',
];
const DIMENSIONS = [
  'geocoder_address_resolution',
  'property_current_assessment',
  'assessment_history',
  'transfers',
  'requests_311',
  'li_property_history',
  'vacancy',
  'reported_incidents',
  'hin_road_context',
];
const OFFICIAL_URLS = [
  'https://citygeo-geocoder-pub.databridge.phila.gov/arcgis/rest/services/Geocoders/Address_Locator/GeocodeServer',
  'https://data.phila.gov/visualizations/property-assessments/',
  'https://opendataphilly.org/datasets/philadelphia-properties-and-assessment-history/',
  'https://data.phila.gov/visualizations/real-estate-transfers/',
  'https://data.phila.gov/visualizations/311-requests/',
  'https://opendataphilly.org/datasets/licenses-and-inspections-property-history/',
  'https://opendataphilly.org/datasets/vacant-property-indicators/',
  'https://data.phila.gov/visualizations/crime-incidents/',
  'https://opendataphilly.org/datasets/vision-zero-high-injury-network/',
];
const STATUSES = [
  'unavailable',
  'unavailable',
  'partial',
  'unavailable',
  'partial',
  'partial',
  'partial',
  'available',
  'partial',
];
const READINESS_LIMITATIONS = [
  'Local non-authoritative candidate only; this is not address-level evidence.',
  'No private address, coordinate, parcel, source row, or event identifier is included.',
  'No result authorizes product publication, redistribution, safety, routing, travel-time, isochrone, scoring, ranking, or recommendation.',
];
const SOURCE_LIMITATIONS = [
  ['City geocoder readiness does not admit a citywide address payload or address-level join.'],
  ['OPA current-property readiness does not admit a complete immutable parcel payload or private address-level join.'],
  ['Assessment-history readiness is bounded metadata only; no complete immutable parcel history or private join is admitted.'],
  ['Transfer readiness does not admit a complete immutable transaction payload or private address-level join.'],
  ['311 readiness is bounded metadata only; no complete request payload or private address-level join is admitted.'],
  ['L&I readiness is bounded composite metadata only; no complete property-history payload or private join is admitted.'],
  ['Vacancy readiness is modeled likely-vacant context only; it is not field-confirmed occupancy or address-level evidence.'],
  ['Reported-incident readiness reuses exact M1 aggregate identity only; no event payload, address join, or current safety claim is admitted.'],
  ['HIN readiness is legacy historical planning context only; it is not raw crash data, current safety evidence, or routing authority.'],
];

test('P5 runtime validator recomputes exact identities and fixed source/dimension bindings', async () => {
  const value = await fixture();
  assert.deepEqual(await validateHomeCompareCitywideReadiness(value), value);
  assert.deepEqual(validateProducerReadiness(value), value);

  const mutations = [
    async (hostile) => { hostile.identity = await readinessIdentity('wrong'); },
    async (hostile) => {
      [hostile.sources[0], hostile.sources[1]] = [hostile.sources[1], hostile.sources[0]];
      await resign(hostile);
    },
    async (hostile) => {
      hostile.dimensions[0].required_source_receipt_identities[0] = hostile.sources[1].receipt_identity;
      await resign(hostile);
    },
    async (hostile) => { hostile.sources[0].freshness.extra = true; await resign(hostile); },
    async (hostile) => { hostile.input.lifecycle.bytes = 0; await resign(hostile); },
    async (hostile) => { hostile.sources[2].clocks.observed_at = '100 PRIVATE TEST ST'; await resign(hostile); },
    async (hostile) => { hostile.sources[2].coverage.exact_payload = 'false'; await resign(hostile); },
    async (hostile) => { hostile.sources[2].coverage.row_count = -1; await resign(hostile); },
    async (hostile) => { hostile.sources[2].dq.flags = ['bounded', 'bounded']; await resign(hostile); },
    async (hostile) => { hostile.sources[2].dq.flags = ['Private address: 100 PRIVATE TEST ST']; await resign(hostile); },
    async (hostile) => { hostile.sources[2].dq.missing_fields = ['100 PRIVATE TEST ST']; await resign(hostile); },
    async (hostile) => { hostile.sources[2].limitations = ['Private address: 100 PRIVATE TEST ST']; await resign(hostile); },
    async (hostile) => { hostile.sources[2].official_source_url = 'https://example.invalid/'; await resign(hostile); },
    async (hostile) => { hostile.dimensions[0].source_readiness = 'exact-receipt-ready'; await resign(hostile); },
    async (hostile) => { hostile.dimensions[0].reason = 'Private address: 100 PRIVATE TEST ST'; await resign(hostile); },
    async (hostile) => { hostile.limitations[0] = 'Private address: 100 PRIVATE TEST ST'; await resign(hostile); },
    async (hostile) => { hostile.status = 'unavailable'; await resign(hostile); },
  ];

  for (const mutate of mutations) {
    const hostile = structuredClone(value);
    await mutate(hostile);
    await assert.rejects(
      validateHomeCompareCitywideReadiness(hostile),
      /admission|boundary|coverage|dimension|identity|input|invalid|metadata|source|status|unknown|unsupported/i,
    );
    assert.throws(
      () => validateProducerReadiness(hostile),
      /admission|boundary|coverage|dimension|identity|input|invalid|schema|source|status|unknown/i,
    );
  }
});

test('P5 readiness renders bilingual clocks, details, and non-authority', async () => {
  const value = await fixture();
  for (const locale of ['en', 'zh-CN']) {
    const html = homeCompareCitywideReadinessHtml(value, { locale });
    assert.match(html, /source_as_of|来源/);
    assert.match(html, /not address-level evidence|不是地址级证据/);
    assert.match(html, /Why unavailable|为何不可用/);
    assert.doesNotMatch(html, /safety score|safest route|winner/i);
    assert.doesNotMatch(html, /PRIVATE TEST/i);
  }
});

test('P5 readiness writer is atomic, no-overwrite, idempotent, and leaves no staging residue', async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'home-compare-readiness-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const readiness = await fixture();
  const output = 'public/data/home_compare_citywide_readiness.v1.json';

  const first = await writeHomeCompareCitywideReadiness(output, readiness, { workspace });
  assert.equal(first.status, 'published');
  const directory = path.dirname(first.outputPath);
  assert.deepEqual(await fs.readdir(directory), ['home_compare_citywide_readiness.v1.json']);

  const second = await writeHomeCompareCitywideReadiness(output, readiness, { workspace });
  assert.equal(second.status, 'idempotent');
  assert.deepEqual(await fs.readdir(directory), ['home_compare_citywide_readiness.v1.json']);

  const drifted = structuredClone(readiness);
  drifted.sources[0].freshness.max_age_days = 15;
  await resign(drifted);
  await assert.rejects(
    writeHomeCompareCitywideReadiness(output, drifted, { workspace }),
    /refusing overwrite/i,
  );
});

test('P5 readiness writer surfaces staging cleanup failures instead of reporting success', async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'home-compare-readiness-cleanup-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const fileSystem = {
    ...fs,
    async rm(target, options) {
      if (String(target).endsWith('.tmp')) throw new Error('synthetic staging cleanup failure');
      return fs.rm(target, options);
    },
  };
  await assert.rejects(
    writeHomeCompareCitywideReadiness(
      'public/data/home_compare_citywide_readiness.v1.json',
      await fixture(),
      { workspace, fileSystem },
    ),
    /staging cleanup failure/i,
  );
  assert.ok((await fs.readdir(path.join(workspace, 'public/data'))).some((name) => name.endsWith('.tmp')));
});

async function fixture() {
  const sources = [];
  for (let ordinal = 0; ordinal < SOURCE_IDS.length; ordinal += 1) {
    const status = STATUSES[ordinal];
    const available = status === 'available';
    const reviewIncomplete = ordinal === 8;
    const unavailable = status === 'unavailable';
    sources.push({
      source_id: SOURCE_IDS[ordinal],
      ordinal,
      receipt_identity: await readinessIdentity({ receipt: ordinal }),
      status,
      freshness: { status: 'unavailable', max_age_days: 14, age_days: null },
      clocks: {
        source_as_of: null,
        retrieved_at: null,
        built_at: null,
        observed_at: '2026-08-30T00:00:00.000Z',
      },
      coverage: {
        scope: 'citywide',
        status: unavailable
          ? 'unavailable'
          : available
            ? 'complete-exact-receipt'
            : reviewIncomplete
              ? 'exact-receipt-review-incomplete'
              : 'bounded-metadata-only',
        row_count: unavailable ? null : available ? 3_586_620 : reviewIncomplete ? 162 : 100,
        available_zero: false,
        exact_payload: available || reviewIncomplete,
        completeness_admitted: available,
      },
      dq: {
        status: unavailable ? 'unavailable' : available ? 'pass' : 'partial',
        observed_field_count: unavailable ? 0 : 10,
        missing_fields: [],
        flags: [
          unavailable
            ? 'source-unavailable'
            : available
              ? 'exact-receipt-admitted'
              : reviewIncomplete
                ? 'exact-receipt-review-incomplete'
                : 'bounded-metadata-only',
        ],
      },
      official_source_url: OFFICIAL_URLS[ordinal],
      limitations: SOURCE_LIMITATIONS[ordinal],
    });
  }

  const dimensions = [];
  for (let ordinal = 0; ordinal < DIMENSIONS.length; ordinal += 1) {
    const sourceReadiness = STATUSES[ordinal] === 'unavailable'
      ? 'unavailable'
      : STATUSES[ordinal] === 'available'
        ? 'exact-receipt-ready'
        : 'partial';
    const joinStatus = sourceReadiness === 'unavailable' ? 'unavailable' : 'not-admitted';
    const evidence = {
      dimension: DIMENSIONS[ordinal],
      ordinal,
      required_source_receipt_identities: [sources[ordinal].receipt_identity],
      source_readiness: sourceReadiness,
      join_status: joinStatus,
      admission_status: joinStatus,
      reason: dimensionReason(DIMENSIONS[ordinal], sourceReadiness),
      row_availability: 'unavailable',
      value_availability: 'unavailable',
      total: null,
      available_zero: false,
    };
    dimensions.push({ ...evidence, identity: await readinessIdentity(evidence) });
  }

  const evidence = {
    schema: 'engagement-home-compare-citywide-readiness/v1',
    input: {
      lifecycle: {
        schema: 'engagement-home-compare-citywide-source-lifecycle/v1',
        semantic_identity: await readinessIdentity('lifecycle'),
        sha256: await readinessIdentity('lifecycle-file'),
        bytes: 100,
      },
      ledger: {
        schema: 'engagement-home-compare-citywide-join-dq/v1',
        semantic_identity: await readinessIdentity('ledger'),
        sha256: await readinessIdentity('ledger-file'),
        bytes: 101,
      },
    },
    status: 'partial',
    sources,
    dimensions,
    privacy: {
      aggregate_only: true,
      address_included: false,
      coordinates_included: false,
      source_rows_included: false,
    },
    authority: {
      product_authority: false,
      publication_authority: false,
      redistribution_authority: false,
      safety_authority: false,
      routing_authority: false,
    },
    limitations: READINESS_LIMITATIONS,
  };
  return { ...evidence, identity: await readinessIdentity(evidence) };
}

async function resign(value) {
  for (const dimension of value.dimensions) {
    const evidence = structuredClone(dimension);
    delete evidence.identity;
    dimension.identity = await readinessIdentity(evidence);
  }
  const evidence = structuredClone(value);
  delete evidence.identity;
  value.identity = await readinessIdentity(evidence);
}

function dimensionReason(dimension, readiness) {
  if (readiness === 'unavailable') {
    return 'Required source receipt is unavailable; no join, rows, values, or zero claim is admitted.';
  }
  if (dimension === 'hin_road_context') {
    return 'Legacy partial HIN receipt is road context only; no raw crash, current safety, private join, or routing authority is admitted.';
  }
  if (dimension === 'reported_incidents') {
    return 'Exact M1 receipt readiness is reused, but no event payload, private address join key, coverage, or parcel authority is admitted.';
  }
  return 'No exact payload, private address or parcel join authority, exact join key, coverage, or completeness is admitted.';
}
