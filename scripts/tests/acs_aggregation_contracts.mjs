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
  reviewAcsTractSelections,
} from '../../src/data/acs_aggregation.js';
import { acsAggregationTableHtml } from '../../src/ui/acs_aggregation_table.js';
import { toAcsAggregationEvidenceRecord } from '../../src/analysis/acs_aggregation_evidence_adapter.js';
import { parseAcsTractSelectionText } from '../../src/acs_multitract/selection.js';
import { adaptAcsVreSourceHealthObservation } from '../../src/acs_multitract/source_health.js';
import { createAcsMultitractWorkflow } from '../../src/acs_multitract/workflow.js';
import {
  acsMultitractProductHtml,
  acsSelectionReviewHtml,
} from '../../src/acs_multitract/view.js';
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
  assert.equal(outcome.result.source.sourceAsOf, '2024-12-31');
  assert.equal(outcome.result.source.snapshotVersion, 'engagement-acs-tract-aggregation-v1');
  assert.match(outcome.result.source.snapshotIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.equal(outcome.result.source.recordCount, 2);
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

test('text selection admits only unique Philadelphia full-tract GEOIDs', () => {
  const parsed = parseAcsTractSelectionText('42101000101, 42101000102');
  assert.equal(parsed.status, 'available');
  assert.deepEqual(parsed.selections, selections);
  assert.deepEqual(parseAcsTractSelectionText('42101000101'), {
    status: 'unavailable',
    reason: 'two-or-more-complete-tracts-required',
    selections: null,
  });
  assert.equal(
    parseAcsTractSelectionText('42101000101\n42101000101').reason,
    'duplicate-tract-selection',
  );
  assert.equal(
    parseAcsTractSelectionText('42101000101\n42102000100').reason,
    'invalid-philadelphia-tract-geoid',
  );
});

test('review verifies exact VRE correspondence before Calculate is available', () => {
  const admitted = reviewAcsTractSelections({ selections, snapshot });
  assert.equal(admitted.status, 'available');
  assert.deepEqual(admitted.review.selections, selections);
  assert.equal(admitted.review.snapshot.manifest.rowCount, 2);

  const unknown = reviewAcsTractSelections({
    selections: [selections[0], { ...selections[1], geoid: '42101999999' }],
    snapshot,
  });
  assert.deepEqual(unknown, {
    status: 'unavailable',
    reason: 'tract-vre-unavailable',
    result: null,
  });
});

test('product workflow requests VRE only after explicit Review and calculates only after admission', async () => {
  let loadCount = 0;
  const observations = [];
  const evidenceRecords = [];
  const workflow = createAcsMultitractWorkflow({
    loadSnapshot: async () => {
      loadCount += 1;
      return { status: 'available', snapshot };
    },
    onSourceHealthObservation: (value) => observations.push(value),
    onEvidenceRecord: (value) => evidenceRecords.push(value),
  });

  assert.equal(loadCount, 0);
  assert.equal(workflow.calculate(), null);
  workflow.invalidate();
  assert.equal(loadCount, 0);
  const reviewed = await workflow.review('42101000101\n42101000102');
  assert.equal(reviewed.status, 'available');
  assert.equal(loadCount, 1);
  assert.equal(observations.length, 1);
  assert.equal(workflow.getState().outcome, null);

  const calculated = workflow.calculate();
  assert.equal(calculated.status, 'available');
  assert.equal(calculated.result.estimate, 5135);
  assert.equal(evidenceRecords.length, 1);
});

test('editing a pending selection supersedes its source result without retaining evidence', async () => {
  let resolveSource;
  let reviewSignal;
  const observations = [];
  const workflow = createAcsMultitractWorkflow({
    loadSnapshot: ({ signal }) => new Promise((resolve) => {
      reviewSignal = signal;
      resolveSource = resolve;
    }),
    onSourceHealthObservation: (value) => observations.push(value),
  });
  const pending = workflow.review('42101000101,42101000102');
  workflow.invalidate();
  assert.equal(reviewSignal.aborted, true);
  resolveSource({ status: 'available', snapshot });
  assert.deepEqual(await pending, { status: 'superseded' });
  assert.deepEqual(workflow.getState(), { reviewed: null, outcome: null });
  assert.equal(observations.length, 0);
  assert.equal(workflow.calculate(), null);
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
  assert.match(html, /Standard error/);
  assert.match(html, /Census SDR VRE/);
  assert.doesNotMatch(html, /<(?:canvas|svg)|maplibre|mapbox/i);
  const zhHtml = acsAggregationTableHtml(outcome, { locale: 'zh-CN' });
  assert.match(zhHtml, /标准误（SE）/);
  assert.match(zhHtml, /限制/);
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
  assert.equal(record.tableId, 'B01003');
  assert.equal(record.tractCount, 2);
  assert.equal(record.standardError, outcome.result.standardError);
  assert.equal(record.variance, 79149.05);
  assert.equal(toAcsAggregationEvidenceRecord({ status: 'unavailable' }), null);
  assert.equal(toAcsAggregationEvidenceRecord({
    status: 'available',
    result: { ...outcome.result, geoids: ['42101000101', '42101000101'] },
  }), null);
});

test('reviewed product markup is table-first, bilingual, and has no map dependency', () => {
  const reviewed = reviewAcsTractSelections({ selections, snapshot });
  const reviewHtml = acsSelectionReviewHtml(reviewed);
  assert.match(reviewHtml, /Complete tracts ready for calculation/);
  assert.match(reviewHtml, /42101000101/);
  assert.match(reviewHtml, /2020 Census/);
  assert.doesNotMatch(reviewHtml, /<(?:canvas|svg)|maplibre|mapbox/i);

  const en = acsMultitractProductHtml('en');
  assert.match(en, /Review tracts/);
  assert.match(en, /data-acs-multitract-calculate disabled/);
  assert.match(en, /addresses, route buffers, partial tracts, centroids, and area weighting are not/);
  const zh = acsMultitractProductHtml('zh-CN');
  assert.match(zh, /检查人口普查区/);
  assert.match(zh, /计算汇总/);
  assert.match(zh, /不会直接把各人口普查区的误差范围相加/);
});

test('feature source-health adapter returns admitted evidence and fails closed', () => {
  const observation = adaptAcsVreSourceHealthObservation(
    { status: 'available', snapshot },
    { now: '2026-08-10T12:00:00.000Z' },
  );
  assert.equal(observation.sourceId, 'acs-tract-population-vre');
  assert.equal(observation.status, 'partial');
  assert.equal(observation.statusReason, 'bundled-vre-snapshot');
  assert.equal(observation.clocks.sourceAsOf, '2024-12-31');
  assert.equal(observation.clocks.retrievedAt, '2026-08-10T10:00:00.000Z');
  assert.equal(observation.boundaryVintage, '2020 Census tract geography');
  assert.equal(observation.recordCount, 2);

  const unavailable = adaptAcsVreSourceHealthObservation(
    { status: 'unavailable', snapshot: null },
    { now: '2026-08-10T12:00:00.000Z' },
  );
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.recordCount, null);
});

test('selected VRE snapshot stays within its focused source-data budget', async () => {
  const source = await stat('src/data/acs_vre_b01003_2024_pa101.json');
  assert.ok(source.size <= 200_000, `selected VRE snapshot must stay <= 200000 bytes; received ${source.size}`);
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

test('product entry keeps the facade and VRE source behind a second-level lazy boundary', async () => {
  const [main, loader, controller, workflow, html, styles] = await Promise.all([
    readFile('src/main.js', 'utf8'),
    readFile('src/acs_multitract/loader.js', 'utf8'),
    readFile('src/acs_multitract/controller.js', 'utf8'),
    readFile('src/acs_multitract/workflow.js', 'utf8'),
    readFile('index.html', 'utf8'),
    readFile('src/acs_multitract/styles.css', 'utf8'),
  ]);
  assert.match(main, /import\('\.\/acs_multitract\/loader\.js'\)/);
  assert.doesNotMatch(main, /from ['"].*acs_aggregation/);
  assert.match(loader, /import\('\.\/controller\.js'\)/);
  assert.match(loader, /onSourceHealthObservation,/);
  assert.match(loader, /onEvidenceRecord,/);
  assert.match(main, /onSourceHealthObservation: registerSourceHealthObservation/);
  assert.match(controller, /from ['"]\.\.\/acs_aggregation\.js['"]/);
  assert.match(controller, /from ['"]\.\/workflow\.js['"]/);
  assert.match(controller, /onLanguageChange\(render\)/);
  assert.match(controller, /returnFocus\?\.focus/);
  assert.match(workflow, /fetchAcsPopulationVreSnapshot/);
  assert.match(html, /data-acs-multitract-open/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /<dialog[^>]+data-acs-multitract-dialog/);
  assert.match(styles, /@media \(max-width: 560px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
