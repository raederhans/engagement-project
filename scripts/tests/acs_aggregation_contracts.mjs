#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

import {
  fetchAcsPopulationVreSnapshot,
  fetchAcsTractPopulationAggregate,
} from '../../src/api/acs_aggregation.js';
import {
  ACS_TRACT_GEOGRAPHY_VINTAGE,
  aggregateAcsTractPopulation,
  calculateSdrRatio,
} from '../../src/data/acs_aggregation.js';
import { acsAggregationTableHtml } from '../../src/ui/acs_aggregation_table.js';
import { toAcsAggregationEvidenceRecord } from '../../src/analysis/acs_aggregation_evidence_adapter.js';
import {
  ACS_VRE_SOURCE_URL,
  buildVreSnapshot,
  parseOfficialVreCsv,
} from '../fetch_acs_vre_b01003.mjs';

const FIXTURE_PATH = 'scripts/tests/fixtures/acs_vre_b01003_2024_pa42_sample.csv';
const fixtureText = await readFile(FIXTURE_PATH, 'utf8');
const officialRows = parseOfficialVreCsv(fixtureText);
const snapshot = buildVreSnapshot(officialRows, { retrievedAt: '2026-08-10T10:00:00.000Z' });
const selections = officialRows.map(({ geoid }) => ({
  geoid,
  coverage: 'full-tract',
  geographyVintage: ACS_TRACT_GEOGRAPHY_VINTAGE,
}));

test('official fixed B01003 fixture preserves 80 ordered replicates and golden aggregate', () => {
  assert.equal(officialRows.length, 2);
  assert.equal(officialRows[0].replicates.length, 80);
  assert.equal(officialRows[0].replicates[0], 1897);
  assert.equal(officialRows[0].replicates[79], 2001);
  const outcome = aggregateAcsTractPopulation({ selections, snapshot });
  assert.equal(outcome.status, 'available');
  assert.equal(outcome.result.estimate, 5135);
  assert.equal(outcome.result.variance, 79149.05);
  assert.equal(outcome.result.moe90, 463);
  assert.equal(outcome.result.tractCount, 2);
  assert.equal(outcome.result.period, '2020-2024');
  assert.equal(outcome.result.release, '2024 ACS 5-year');
  assert.equal(outcome.result.geographyVintage, '2020 Census');
  assert.equal(outcome.result.source.sourceUrl, ACS_VRE_SOURCE_URL);
});

test('official parser rejects missing, reordered, and incomplete replicate inputs', () => {
  assert.throws(
    () => parseOfficialVreCsv(fixtureText.replace('Var_Rep40', 'Wrong_Rep40')),
    /missing the ordered column Var_Rep40/,
  );
  assert.throws(
    () => parseOfficialVreCsv(fixtureText.replace('Var_Rep39,Var_Rep40', 'Var_Rep40,Var_Rep39')),
    /reordered/,
  );
  assert.throws(
    () => parseOfficialVreCsv(fixtureText.replace(',1961,2127,', ',,2127,')),
    /missing or invalid values/,
  );
});

test('single tract is unavailable while two complete tracts are admitted', () => {
  const single = aggregateAcsTractPopulation({ selections: selections.slice(0, 1), snapshot });
  assert.deepEqual(single, {
    status: 'unavailable',
    reason: 'two-or-more-complete-tracts-required',
    result: null,
  });
  assert.equal(aggregateAcsTractPopulation({ selections, snapshot }).status, 'available');
});

test('zero denominator fails closed instead of producing a ratio', () => {
  const numerator = { estimate: 10, replicates: Array(80).fill(10) };
  const denominator = { estimate: 0, replicates: Array(80).fill(0) };
  assert.deepEqual(calculateSdrRatio({ numerator, denominator, scale: 100 }), {
    status: 'unavailable',
    reason: 'zero-denominator',
    result: null,
  });
});

test('missing VRE never falls back to summed tract MOEs', () => {
  const missing = aggregateAcsTractPopulation({
    selections: [...selections, {
      geoid: '42101999999',
      coverage: 'full-tract',
      geographyVintage: ACS_TRACT_GEOGRAPHY_VINTAGE,
    }],
    snapshot,
  });
  assert.deepEqual(missing, { status: 'unavailable', reason: 'tract-vre-unavailable', result: null });
});

test('mixed or unsupported geography vintage is not comparable', () => {
  const mixed = structuredClone(selections);
  mixed[1].geographyVintage = '2010 Census';
  assert.deepEqual(aggregateAcsTractPopulation({ selections: mixed, snapshot }), {
    status: 'not-comparable',
    reason: 'mixed-geography-vintage',
    result: null,
  });
  const old = structuredClone(selections);
  old.forEach((selection) => { selection.geographyVintage = '2010 Census'; });
  assert.deepEqual(aggregateAcsTractPopulation({ selections: old, snapshot }), {
    status: 'not-comparable',
    reason: 'unsupported-geography-vintage',
    result: null,
  });
});

test('partial tract, route buffer, and address-point coverage fail the full-tract gate', () => {
  for (const coverage of ['partial-tract', 'route-buffer', 'address-point']) {
    const partial = structuredClone(selections);
    partial[1].coverage = coverage;
    assert.deepEqual(aggregateAcsTractPopulation({ selections: partial, snapshot }), {
      status: 'unavailable',
      reason: 'full-tract-only',
      result: null,
    });
  }
});

test('table-first UI exposes method and vintage without a map dependency', () => {
  const outcome = aggregateAcsTractPopulation({ selections, snapshot });
  const html = acsAggregationTableHtml(outcome);
  assert.match(html, /<table>/);
  assert.match(html, /<caption>ACS complete-tract population aggregate<\/caption>/);
  assert.match(html, /2020-2024/);
  assert.match(html, /2020 Census/);
  assert.match(html, /Complete tracts/);
  assert.match(html, /Census SDR VRE/);
  assert.doesNotMatch(html, /<(?:canvas|svg)|maplibre|mapbox/i);
  const unavailable = acsAggregationTableHtml({ status: 'unavailable', reason: 'vre-source-unavailable' });
  assert.match(unavailable, /role="status"/);
  assert.doesNotMatch(unavailable, /<table>/);
});

test('source failure clears the snapshot and aggregate instead of retaining pseudo-current data', async () => {
  const available = await fetchAcsPopulationVreSnapshot({ fetchJsonImpl: async () => snapshot });
  assert.equal(available.status, 'available');
  assert.ok(available.snapshot);
  const unavailable = await fetchAcsPopulationVreSnapshot({
    fetchJsonImpl: async () => { throw new Error('offline'); },
  });
  assert.deepEqual(unavailable, { status: 'unavailable', snapshot: null, error: 'offline' });
  const aggregate = await fetchAcsTractPopulationAggregate({
    selections,
    loadSnapshot: async () => unavailable,
  });
  assert.deepEqual(aggregate, { status: 'unavailable', reason: 'vre-source-unavailable', result: null });
});

test('Evidence Bundle adapter is explicit and does not mutate the existing schema', () => {
  const outcome = aggregateAcsTractPopulation({ selections, snapshot });
  const record = toAcsAggregationEvidenceRecord(outcome);
  assert.equal(record.schemaVersion, 'engagement-acs-aggregation-evidence-adapter/v1');
  assert.equal(record.tractCount, 2);
  assert.equal(toAcsAggregationEvidenceRecord({ status: 'unavailable' }), null);
});

test('selected VRE snapshot stays within its focused source-data budget', async () => {
  const source = await stat('src/data/acs_vre_b01003_2024_pa101.json');
  assert.ok(source.size <= 400_000, `selected VRE snapshot must stay <= 400000 bytes; received ${source.size}`);
});

test('foundation remains outside initial, Crime, and map runtime entry graphs', async () => {
  const entrySources = await Promise.all([
    readFile('src/main.js', 'utf8'),
    readFile('src/routes_crime/index.js', 'utf8'),
    readFile('src/map/initMap.js', 'utf8'),
    readFile('src/api/acs.js', 'utf8'),
  ]);
  for (const source of entrySources) assert.doesNotMatch(source, /acs_aggregation/);
  const facade = await readFile('src/acs_aggregation.js', 'utf8');
  assert.match(facade, /fetchAcsTractPopulationAggregate/);
  assert.match(facade, /acsAggregationTableHtml/);
});
