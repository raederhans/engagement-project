import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const taxonomyUrl = new URL('../../src/data/crime_taxonomy.v1.json', import.meta.url);
const metadataUrl = new URL('../../src/data/crime_metadata.js', import.meta.url);
const stabilityUrl = new URL('../../src/analysis/residential_stability.js', import.meta.url);

const OFFICIAL_OFFENSES = Object.freeze([
  'Aggravated Assault Firearm',
  'Aggravated Assault No Firearm',
  'All Other Offenses',
  'Arson',
  'Burglary Non-Residential',
  'Burglary Residential',
  'Disorderly Conduct',
  'DRIVING UNDER THE INFLUENCE',
  'Embezzlement',
  'Forgery and Counterfeiting',
  'Fraud',
  'Gambling Violations',
  'Homicide - Criminal',
  'Homicide - Gross Negligence',
  'Homicide - Justifiable',
  'Liquor Law Violations',
  'Motor Vehicle Theft',
  'Narcotic / Drug Law Violations',
  'Offenses Against Family and Children',
  'Other Assaults',
  'Other Sex Offenses (Not Commercialized)',
  'Prostitution and Commercialized Vice',
  'Public Drunkenness',
  'Rape',
  'Receiving Stolen Property',
  'Robbery Firearm',
  'Robbery No Firearm',
  'Theft from Vehicle',
  'Thefts',
  'Vagrancy/Loitering',
  'Vandalism/Criminal Mischief',
  'Weapon Violations',
]);

test('versioned taxonomy covers every observed official offense exactly once', async () => {
  assert.equal(existsSync(taxonomyUrl), true, 'versioned Crime taxonomy must exist');
  const taxonomy = JSON.parse(await readFile(taxonomyUrl, 'utf8'));
  assert.equal(taxonomy.schema_version, 1);
  assert.match(taxonomy.taxonomy_version, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(taxonomy.source.dataset, 'incidents_part1_part2');
  assert.equal(taxonomy.source.offense_field, 'text_general_code');
  assert.equal(taxonomy.source.ucr_field, 'ucr_general');
  assert.equal(taxonomy.themes.length, 6, 'default UI should stay concise');

  const ucrNodes = taxonomy.themes.flatMap((theme) => theme.ucr_categories);
  const leaves = ucrNodes.flatMap((category) => category.offenses.map((offense) => ({
    ...offense,
    ucr: category.code,
  })));
  assert.equal(new Set(ucrNodes.map(({ code }) => code)).size, 26);
  assert.deepEqual(
    leaves.map(({ code }) => code).sort(),
    [...OFFICIAL_OFFENSES].sort(),
  );
  assert.equal(new Set(leaves.map(({ code }) => code)).size, leaves.length);
  for (const leaf of leaves) {
    assert.match(leaf.ucr, /^\d+$/);
    assert.ok(leaf.label?.en);
    assert.ok(leaf.label?.['zh-CN']);
  }
});

test('taxonomy utilities expand six new themes and preserve legacy shared URLs', async () => {
  const types = await import('../../src/utils/types.js');
  const taxonomyUtils = await import('../../src/utils/crime_taxonomy.js');
  assert.equal(taxonomyUtils.CRIME_TAXONOMY_VERSION, '2026-08-04');
  assert.equal(
    Object.hasOwn(types, 'CRIME_TAXONOMY_VERSION'),
    false,
    'taxonomy version must have one source of truth',
  );
  assert.deepEqual(Object.keys(types.offenseGroups), [
    'person', 'property', 'vehicle', 'financial', 'public_order', 'other',
  ]);
  assert.equal(types.expandGroupsToCodes(['person']).includes('Rape'), true);
  assert.equal(types.expandGroupsToCodes(['financial']).includes('Fraud'), true);
  assert.equal(types.expandGroupsToCodes(['public_order']).includes('Disorderly Conduct'), true);
  assert.equal(types.expandGroupsToCodes(['other']).includes('All Other Offenses'), true);
  assert.deepEqual(
    types.expandGroupsToCodes(['robbery_gun']),
    ['Robbery Firearm', 'Robbery No Firearm'],
    'legacy URL groups must remain readable',
  );
  const described = taxonomyUtils.describeOffense('Burglary Residential', 'zh-CN');
  assert.deepEqual(described, {
    themeId: 'property',
    themeLabel: '财产与住宅',
    ucrCode: '500',
    ucrLabel: '入室盗窃',
    offenseCode: 'Burglary Residential',
    offenseLabel: '住宅入室盗窃',
  });
});

test('Crime metadata exposes one concise primary metric and optional technical detail', async () => {
  assert.equal(existsSync(metadataUrl), true, 'Crime metadata module must exist');
  const { CRIME_DATASET_METADATA, CRIME_METRICS } = await import('../../src/data/crime_metadata.js');
  assert.equal(CRIME_DATASET_METADATA.schemaVersion, 1);
  assert.equal(CRIME_DATASET_METADATA.grain, 'reported_record');
  assert.equal(CRIME_DATASET_METADATA.timezone, 'America/New_York');
  assert.equal(CRIME_DATASET_METADATA.taxonomyVersion, '2026-08-04');
  assert.match(CRIME_DATASET_METADATA.locationPrecision, /hundred block/i);

  const metrics = Object.values(CRIME_METRICS);
  assert.equal(metrics.filter(({ defaultVisible }) => defaultVisible).length, 1);
  assert.equal(CRIME_METRICS.reportedRecords.defaultVisible, true);
  assert.equal(CRIME_METRICS.reportedRecords.numerator, 'COUNT(*)');
  assert.equal(CRIME_METRICS.uniqueCaseKeys.defaultVisible, false);
  assert.equal(CRIME_METRICS.uniqueCaseKeys.numerator, 'COUNT(DISTINCT dc_key)');
  assert.equal(CRIME_METRICS.mappedRecords.purpose, 'data_quality');
});

test('coverage query uses Philadelphia calendar dates', async () => {
  const meta = await import('../../src/api/meta.js');
  assert.equal(typeof meta.COVERAGE_SQL, 'string');
  assert.match(meta.COVERAGE_SQL, /AT TIME ZONE\s+'America\/New_York'/i);
  assert.match(meta.COVERAGE_SQL, /MIN\([^)]+\)::date AS min_dt/i);
  assert.match(meta.COVERAGE_SQL, /MAX\([^)]+\)::date AS max_dt/i);
});

test('result provenance keeps technical count and location caveats behind details', async () => {
  const { createCrimeRefreshProvenance } = await import('../../src/ui/crime_result_meta.js');
  const provenance = createCrimeRefreshProvenance({
    name: 'summary',
    value: { applied: true, status: 'success', a: { total: 12, top3: [] } },
    snapshot: {
      queryMode: 'buffer',
      centerLonLat: [-75.16, 39.95],
      radiusM: 400,
      adminLevel: 'districts',
      start: '2026-01-01',
      end: '2026-02-01',
      types: [],
    },
    sources: [{ dataset: 'incidents', kind: 'live', source: 'CARTO' }],
    coverageMax: '2026-01-31',
    generatedAt: '2026-08-04T10:00:00.000Z',
  });
  assert.deepEqual(provenance.limitations, [
    'resultMeta.limit.reportedRecords',
    'resultMeta.limit.generalizedLocations',
  ]);
});

test('residential stability summarizes direction, volatility, confidence, and partial months without a safety score', async () => {
  assert.equal(existsSync(stabilityUrl), true, 'residential stability model must exist');
  const { buildResidentialStability } = await import('../../src/analysis/residential_stability.js');
  const rows = [
    10, 11, 9, 10, 10, 10,
    14, 15, 16, 15, 16, 18,
    3,
  ].map((n, index) => ({
    m: new Date(Date.UTC(2025, index, 1)).toISOString().slice(0, 10),
    n,
  }));
  const model = buildResidentialStability({
    rows,
    coverageDate: '2026-01-12',
  });

  assert.equal(model.monthsObserved, 12, 'partial current month is excluded');
  assert.equal(model.partialMonthExcluded, true);
  assert.equal(model.trend, 'rising');
  assert.equal(model.recentChangePct, 8.9);
  assert.equal(model.volatility, 'moderate');
  assert.equal(model.confidence, 'high');
  assert.equal(Object.hasOwn(model, 'score'), false, 'do not emit an opaque safety score');
});

test('residential stability treats omitted API months inside the selected window as zero records', async () => {
  const { buildResidentialStability } = await import('../../src/analysis/residential_stability.js');
  const model = buildResidentialStability({
    rows: [
      { m: '2026-01', n: 10 },
      { m: '2026-03', n: 10 },
      { m: '2026-04', n: 10 },
      { m: '2026-05', n: 10 },
      { m: '2026-06', n: 10 },
    ],
    start: '2026-01-01',
    end: '2026-07-01',
    coverageDate: '2026-06-30',
  });

  assert.equal(model.monthsObserved, 6);
  assert.equal(model.totalRecords, 50);
  assert.equal(model.recentChangePct, 50);
});

test('three-month rolling series smooths raw monthly drawing values', async () => {
  assert.equal(existsSync(stabilityUrl), true, 'residential stability model must exist');
  const { buildRollingAverageSeries } = await import('../../src/analysis/residential_stability.js');
  assert.deepEqual(buildRollingAverageSeries([
    { m: '2026-01', n: 3 },
    { m: '2026-02', n: 6 },
    { m: '2026-03', n: 12 },
    { m: '2026-04', n: 9 },
  ], 3), [
    { m: '2026-01', n: null },
    { m: '2026-02', n: null },
    { m: '2026-03', n: 7 },
    { m: '2026-04', n: 9 },
  ]);
});

test('unified Crime UI exposes six themes, rolling view, and one residential subsection', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  for (const theme of ['person', 'property', 'vehicle', 'financial', 'public_order', 'other']) {
    assert.match(html, new RegExp(`<option value="${theme}"`));
  }
  assert.match(html, /data-chart-value="rolling"/);
  assert.match(html, /id="residential-stability"/);
  assert.match(html, /data-residential-stability-content/);
  assert.doesNotMatch(html, /id="walking-safety"/);
});
