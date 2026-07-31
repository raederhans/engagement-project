#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildTractCountSQL,
  collectTractCounts,
  createSnapshotWindow,
  createTractCrimeSnapshot,
  normalizeCoverageDate,
  prepareTracts,
  validateTractCrimeSnapshot,
  writeJsonAtomic,
} from '../lib/tract_crime_snapshot.mjs';
import { fetchFirstValidTractSource } from '../lib/tract_source.mjs';
import { runPrecompute } from '../precompute_tract_crime.mjs';
import * as tractFetcher from '../fetch_tracts.mjs';

const tractFeature = (geoid, offset = 0) => ({
  type: 'Feature',
  properties: { GEOID: geoid },
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-75.2 + offset, 39.9],
      [-75.1 + offset, 39.9],
      [-75.1 + offset, 40],
      [-75.2 + offset, 40],
      [-75.2 + offset, 39.9],
    ]],
  },
});

const tractCollection = {
  type: 'FeatureCollection',
  features: [
    tractFeature('42101000200', 0.01),
    tractFeature('42101000100'),
  ],
};

test('snapshot window covers exactly 12 calendar months through the coverage month', () => {
  assert.deepEqual(createSnapshotWindow('2026-07-31'), {
    coverageDate: '2026-07-31',
    start: '2025-08-01',
    end: '2026-08-01',
  });
});

test('snapshot window rejects invalid dates', () => {
  assert.throws(() => createSnapshotWindow('not-a-date'), /valid YYYY-MM-DD/i);
});

test('live coverage timestamps normalize to a calendar date', () => {
  assert.equal(normalizeCoverageDate('2026-07-30T00:00:00Z'), '2026-07-30');
  assert.equal(normalizeCoverageDate('2026-07-30'), '2026-07-30');
  assert.throws(() => normalizeCoverageDate('2026/07/30'), /coverage date/i);
  assert.throws(() => normalizeCoverageDate('2026-07-30not-iso'), /coverage date/i);
});

test('tract count SQL keeps geometry and envelope in EPSG 4326', () => {
  const sql = buildTractCountSQL(
    tractFeature('42101000100').geometry,
    { start: '2025-08-01', end: '2026-08-01' },
  );

  assert.match(sql, /the_geom && ST_MakeEnvelope\(-75\.2, 39\.9, -75\.1, 40, 4326\)/);
  assert.match(sql, /ST_Intersects\(the_geom, ST_SetSRID\(ST_GeomFromGeoJSON/);
  assert.match(sql, /SELECT text_general_code, COUNT\(\*\)::int AS n/);
  assert.match(sql, /GROUP BY text_general_code/);
  assert.doesNotMatch(sql, /ST_Transform/);
});

test('snapshot creation preserves filterable offense counts for every tract', () => {
  const snapshot = createTractCrimeSnapshot({
    tracts: prepareTracts(tractCollection),
    counts: [
      {
        geoid: '42101000100',
        offenses: [
          { code: 'Robbery Firearm', n: 2 },
          { code: 'Theft', n: 5 },
        ],
      },
      {
        geoid: '42101000200',
        offenses: [{ code: 'Theft', n: 4 }],
      },
    ],
    coverageDate: '2026-07-31',
    generatedAt: '2026-07-31T01:00:00.000Z',
    sourceUrl: 'https://example.test/sql',
    tractSource: 'public/data/tracts_phl.geojson',
  });

  assert.equal(snapshot.meta.schema_version, 2);
  assert.equal(snapshot.meta.filter_dimension, 'text_general_code');
  assert.deepEqual(snapshot.rows[0], {
    geoid: '42101000100',
    total: 7,
    offenses: [
      { code: 'Robbery Firearm', n: 2 },
      { code: 'Theft', n: 5 },
    ],
  });
});

test('tract preparation sorts valid GEOIDs', () => {
  assert.deepEqual(
    prepareTracts(tractCollection).map(({ geoid }) => geoid),
    ['42101000100', '42101000200'],
  );
});

test('tract preparation rejects duplicate GEOIDs', () => {
  assert.throws(
    () => prepareTracts({
      type: 'FeatureCollection',
      features: [tractFeature('42101000100'), tractFeature('42101000100', 0.01)],
    }),
    /duplicate GEOID 42101000100/i,
  );
});

test('snapshot creation rejects incomplete count results', () => {
  assert.throws(
    () => createTractCrimeSnapshot({
      tracts: prepareTracts(tractCollection),
      counts: [{
        geoid: '42101000100',
        offenses: [{ code: 'Theft', n: 7 }],
      }],
      coverageDate: '2026-07-31',
      generatedAt: '2026-07-31T01:00:00.000Z',
      sourceUrl: 'https://example.test/sql',
      tractSource: 'public/data/tracts_phl.geojson',
    }),
    /missing count for tract 42101000200/i,
  );
});

test('snapshot creation emits sorted provenance and row-count metadata', () => {
  const snapshot = createTractCrimeSnapshot({
    tracts: prepareTracts(tractCollection),
    counts: [
      { geoid: '42101000200', offenses: [{ code: 'Theft', n: 4 }] },
      { geoid: '42101000100', offenses: [{ code: 'Theft', n: 7 }] },
    ],
    coverageDate: '2026-07-31',
    generatedAt: '2026-07-31T01:00:00.000Z',
    sourceUrl: 'https://example.test/sql',
    tractSource: 'public/data/tracts_phl.geojson',
  });

  assert.deepEqual(snapshot.meta, {
    schema_version: 2,
    source_url: 'https://example.test/sql',
    source_dataset: 'incidents_part1_part2',
    tract_source: 'public/data/tracts_phl.geojson',
    coverage_date: '2026-07-31',
    start: '2025-08-01',
    end: '2026-08-01',
    generated_at: '2026-07-31T01:00:00.000Z',
    row_count: 2,
    filter_dimension: 'text_general_code',
  });
  assert.deepEqual(snapshot.rows, [
    { geoid: '42101000100', total: 7, offenses: [{ code: 'Theft', n: 7 }] },
    { geoid: '42101000200', total: 4, offenses: [{ code: 'Theft', n: 4 }] },
  ]);
});

test('snapshot validation rejects metadata or rows that no longer match the tract source', () => {
  const tracts = prepareTracts(tractCollection);
  const snapshot = createTractCrimeSnapshot({
    tracts,
    counts: [
      { geoid: '42101000100', offenses: [{ code: 'Theft', n: 7 }] },
      { geoid: '42101000200', offenses: [{ code: 'Theft', n: 4 }] },
    ],
    coverageDate: '2026-07-31',
    generatedAt: '2026-07-31T01:00:00.000Z',
    sourceUrl: 'https://example.test/sql',
    tractSource: 'public/data/tracts_phl.geojson',
  });

  assert.deepEqual(validateTractCrimeSnapshot(snapshot, tracts), {
    rowCount: 2,
    start: '2025-08-01',
    end: '2026-08-01',
  });
  assert.throws(
    () => validateTractCrimeSnapshot({
      ...snapshot,
      meta: { ...snapshot.meta, row_count: 1 },
    }, tracts),
    /row_count/i,
  );
  assert.throws(
    () => validateTractCrimeSnapshot({
      ...snapshot,
      meta: { ...snapshot.meta, row_count: 1 },
      rows: snapshot.rows.slice(0, 1),
    }, tracts),
    /missing count for tract 42101000200/i,
  );
});

test('count collection respects its concurrency bound', async () => {
  const tracts = prepareTracts(tractCollection);
  let active = 0;
  let maxActive = 0;
  const counts = await collectTractCounts(tracts, {
    concurrency: 1,
    queryCount: async ({ geoid }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return [{ text_general_code: 'Theft', n: geoid.endsWith('100') ? 7 : 4 }];
    },
  });

  assert.equal(maxActive, 1);
  assert.deepEqual(counts, [
    { geoid: '42101000100', offenses: [{ code: 'Theft', n: 7 }] },
    { geoid: '42101000200', offenses: [{ code: 'Theft', n: 4 }] },
  ]);
});

test('count collection rejects the whole run when one tract fails', async () => {
  await assert.rejects(
    collectTractCounts(prepareTracts(tractCollection), {
      concurrency: 2,
      queryCount: async ({ geoid }) => {
        if (geoid === '42101000200') throw new Error('upstream unavailable');
        return [{ text_general_code: 'Theft', n: 7 }];
      },
    }),
    /42101000200.*upstream unavailable/i,
  );
});

test('atomic JSON writing replaces the destination and leaves no temp file', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'engagement-snapshot-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'snapshot.json');
  await writeFile(destination, '{"old":true}\n');

  await writeJsonAtomic(destination, { rows: [{ geoid: '42101000100', n: 7 }] });

  assert.equal(
    await readFile(destination, 'utf8'),
    '{\n  "rows": [\n    {\n      "geoid": "42101000100",\n      "n": 7\n    }\n  ]\n}\n',
  );
  assert.deepEqual(await readdir(directory), ['snapshot.json']);
});

test('tract source fetching fails closed instead of treating a stale file as success', async () => {
  const errors = [];
  await assert.rejects(
    fetchFirstValidTractSource(['one', 'two'], {
      attempts: 1,
      fetchJson: async (url) => { throw new Error(`${url} unavailable`); },
      validate: (value) => value,
      onFailure: (message) => errors.push(message),
      sleep: async () => {},
    }),
    /all 2 tract endpoints failed/i,
  );
  assert.equal(errors.length, 2);

  const result = await fetchFirstValidTractSource(['one', 'two'], {
    attempts: 1,
    fetchJson: async (url) => {
      if (url === 'one') throw new Error('first unavailable');
      return { type: 'FeatureCollection', features: [] };
    },
    validate: (value, url) => ({ ...value, source: url }),
    onFailure: () => {},
    sleep: async () => {},
  });
  assert.equal(result.sourceUrl, 'two');
  assert.equal(result.data.source, 'two');
});

test('TIGER fallback uses current area fields and normalizes them into the published schema', () => {
  assert.match(tractFetcher.TRACT_ENDPOINTS[1], /outFields=[^&]*AREALAND,AREAWATER/);
  const normalized = tractFetcher.normalizeTractFeature({
    type: 'Feature',
    geometry: tractFeature('42101000100').geometry,
    properties: {
      STATE: '42',
      COUNTY: '101',
      TRACT: '000100',
      GEOID: '42101000100',
      NAME: '1',
      AREALAND: 123,
      AREAWATER: 4,
    },
  }, 'https://example.test/tiger', 0);

  assert.equal(normalized.properties.ALAND, 123);
  assert.equal(normalized.properties.AWATER, 4);
});

test('CI and Pages explicitly build with the validated tract snapshot enabled', async () => {
  const [ciWorkflow, pagesWorkflow] = await Promise.all([
    readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8'),
  ]);
  for (const workflow of [ciWorkflow, pagesWorkflow]) {
    assert.match(workflow, /VITE_TRACT_CRIME_SNAPSHOT:\s*['"]?1['"]?/);
  }
});

test('the historical precompute entry delegates instead of keeping a second implementation', async () => {
  const legacyEntry = await readFile(
    new URL('../precompute_tract_counts.mjs', import.meta.url),
    'utf8',
  );
  assert.match(legacyEntry, /runPrecompute/);
  assert.doesNotMatch(legacyEntry, /ST_Intersects|fetch\(|writeFile/);
});

test('the integrated generator leaves an existing snapshot untouched after any tract failure', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'engagement-generator-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputFile = path.join(directory, 'snapshot.json');
  await writeFile(outputFile, '{"stable":true}\n');
  let queryNumber = 0;

  await assert.rejects(
    runPrecompute([
      '--as-of', '2026-07-31',
      '--tracts', 'virtual.geojson',
      '--output', outputFile,
      '--concurrency', '2',
    ], {
      readFile: async () => JSON.stringify(tractCollection),
      requestRows: async () => {
        queryNumber += 1;
        if (queryNumber === 2) throw new Error('query failed');
        return [{ n: 7 }];
      },
      now: () => new Date('2026-07-31T01:00:00.000Z'),
    }),
    /query failed/i,
  );
  assert.equal(await readFile(outputFile, 'utf8'), '{"stable":true}\n');
});
