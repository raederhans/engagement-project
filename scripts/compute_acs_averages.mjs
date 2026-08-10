#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

import { normalizeAcsSnapshot } from '../src/data/acs_population.js';

const SNAPSHOT_PATH = 'src/data/acs_tracts_2024_pa101.json';

async function main() {
  const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8'));
  const rows = normalizeAcsSnapshot(snapshot);
  const available = rows.filter(({ population }) => population.status === 'available');
  const partial = rows.filter(({ population }) => population.status === 'partial');
  const unavailable = rows.filter(({ population }) => population.status === 'unavailable');
  const estimates = available.map(({ population }) => population.estimate);
  const margins = available.map(({ population }) => population.moe90);

  console.log(`ACS ${snapshot.manifest.period} tract population audit`);
  console.log(`Source: ${snapshot.manifest.sourceUrl}`);
  console.log(`Retrieved: ${snapshot.manifest.retrievedAt}`);
  console.log(`Rows: ${rows.length} (available ${available.length}, partial ${partial.length}, unavailable ${unavailable.length})`);
  console.log(`Population estimate: min ${Math.min(...estimates)}, max ${Math.max(...estimates)}, mean ${Math.round(estimates.reduce((sum, value) => sum + value, 0) / estimates.length)}`);
  console.log(`90% MOE: min ${Math.min(...margins)}, max ${Math.max(...margins)}, mean ${Math.round(margins.reduce((sum, value) => sum + value, 0) / margins.length)}`);
  console.log(`Rows SHA-256: ${snapshot.manifest.rowsSha256}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
