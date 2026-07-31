#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  prepareTracts,
  validateTractCrimeSnapshot,
} from './lib/tract_crime_snapshot.mjs';

const snapshotFile = process.argv[2]
  || path.join('public', 'data', 'tract_crime_counts_last12m.json');
const tractFile = process.argv[3]
  || path.join('public', 'data', 'tracts_phl.geojson');

try {
  const [snapshot, tractGeoJson] = await Promise.all([
    readJson(snapshotFile),
    readJson(tractFile),
  ]);
  const result = validateTractCrimeSnapshot(snapshot, prepareTracts(tractGeoJson));
  console.log(
    `[tract-crime] Valid snapshot: ${result.rowCount} tracts for [${result.start}, ${result.end}).`,
  );
} catch (error) {
  console.error(`[tract-crime] Invalid snapshot: ${error?.message || error}`);
  process.exitCode = 1;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
