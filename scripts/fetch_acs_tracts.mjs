#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ACS_POPULATION_SCHEMA_VERSION } from '../src/data/acs_population.js';

export const ACS_VINTAGE = '2024';
export const ACS_PERIOD = '2020-2024';
export const ACS_SOURCE_URL =
  'https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b01003.dat';
export const ACS_OUTPUT_PATH = path.join('src', 'data', 'acs_tracts_2024_pa101.json');
const SOURCE_VARIABLES = Object.freeze({
  estimate: 'B01003_001E',
  moe90: 'B01003_001M',
});
const SUMMARY_COLUMNS = Object.freeze({
  estimate: 'B01003_E001',
  moe90: 'B01003_M001',
});

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function parseNonNegativeInteger(value) {
  if (!/^\d+$/.test(String(value || ''))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

export function parseSummaryFile(text) {
  const lines = String(text).trim().split(/\r?\n/);
  const header = lines.shift()?.split('|') || [];
  const index = Object.fromEntries(header.map((name, column) => [name, column]));
  for (const name of ['GEO_ID', SUMMARY_COLUMNS.estimate, SUMMARY_COLUMNS.moe90]) {
    if (!Object.hasOwn(index, name)) throw new Error(`Official ACS Summary File is missing ${name}.`);
  }
  const rows = lines.flatMap((line) => {
    const columns = line.split('|');
    const geoidMatch = String(columns[index.GEO_ID] || '').match(/^1400000US(42101\d{6})$/);
    if (!geoidMatch) return [];
    const estimate = parseNonNegativeInteger(columns[index[SUMMARY_COLUMNS.estimate]]);
    const moe90 = parseNonNegativeInteger(columns[index[SUMMARY_COLUMNS.moe90]]);
    return [{
      geoid: geoidMatch[1],
      population: {
        estimate,
        moe90,
        status: estimate == null ? 'unavailable' : moe90 == null ? 'partial' : 'available',
      },
    }];
  }).sort((a, b) => a.geoid.localeCompare(b.geoid));
  if (rows.length === 0) throw new Error('Official ACS Summary File contains no Philadelphia tract rows.');
  if (new Set(rows.map(({ geoid }) => geoid)).size !== rows.length) {
    throw new Error('Official ACS Summary File contains duplicate Philadelphia tract GEOIDs.');
  }
  return rows;
}

export function buildSnapshot(rows, { retrievedAt, sourceUrl = ACS_SOURCE_URL } = {}) {
  const parsedRetrievedAt = new Date(retrievedAt || '');
  if (Number.isNaN(parsedRetrievedAt.getTime()) || parsedRetrievedAt.toISOString() !== retrievedAt) {
    throw new Error('Snapshot retrieval time must be an ISO timestamp.');
  }
  const rowsJson = JSON.stringify(rows);
  return {
    schemaVersion: ACS_POPULATION_SCHEMA_VERSION,
    manifest: {
      dataset: 'American Community Survey 5-Year Detailed Table B01003',
      vintage: ACS_VINTAGE,
      period: ACS_PERIOD,
      geography: 'Census tracts in Philadelphia County, Pennsylvania (state 42, county 101)',
      source: 'U.S. Census Bureau ACS Table-Based Summary File',
      sourceUrl,
      retrievedAt,
      rowCount: rows.length,
      variables: SOURCE_VARIABLES,
      rowsSha256: sha256(rowsJson),
      hashContract: 'SHA-256 of JSON.stringify(rows); retrievedAt excluded',
    },
    rows,
  };
}

function parseArgs(argv) {
  const options = { verify: false, output: ACS_OUTPUT_PATH, retrievedAt: null };
  for (const arg of argv) {
    if (arg === '--verify') options.verify = true;
    else if (arg.startsWith('--output=')) options.output = arg.slice('--output='.length);
    else if (arg.startsWith('--retrieved-at=')) options.retrievedAt = arg.slice('--retrieved-at='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export async function fetchOfficialRows({ request = fetch, timeoutMs = null } = {}) {
  const response = await request(ACS_SOURCE_URL, {
    headers: { accept: 'text/plain', 'user-agent': 'engagement-project-acs-snapshot/1.0' },
    ...requestTimeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Official ACS Summary File returned HTTP ${response.status}.`);
  return parseSummaryFile(await response.text());
}

function requestTimeout(timeoutMs) {
  if (timeoutMs === null) return {};
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('ACS request timeoutMs must be a positive integer or null.');
  }
  return { signal: AbortSignal.timeout(timeoutMs) };
}

async function verifySnapshot(outputPath, officialRows) {
  const existing = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  const expectedRowsHash = sha256(JSON.stringify(officialRows));
  const failures = [];
  if (existing.schemaVersion !== ACS_POPULATION_SCHEMA_VERSION) failures.push('schemaVersion');
  if (existing.manifest?.dataset !== 'American Community Survey 5-Year Detailed Table B01003') failures.push('dataset');
  if (existing.manifest?.vintage !== ACS_VINTAGE) failures.push('vintage');
  if (existing.manifest?.period !== ACS_PERIOD) failures.push('period');
  if (existing.manifest?.source !== 'U.S. Census Bureau ACS Table-Based Summary File') failures.push('source');
  if (existing.manifest?.sourceUrl !== ACS_SOURCE_URL) failures.push('sourceUrl');
  if (Number.isNaN(Date.parse(existing.manifest?.retrievedAt))) failures.push('retrievedAt');
  if (existing.manifest?.rowCount !== officialRows.length) failures.push('rowCount');
  if (JSON.stringify(existing.manifest?.variables) !== JSON.stringify(SOURCE_VARIABLES)) failures.push('variables');
  if (existing.manifest?.hashContract !== 'SHA-256 of JSON.stringify(rows); retrievedAt excluded') failures.push('hashContract');
  if (existing.manifest?.rowsSha256 !== expectedRowsHash) failures.push('manifest rowsSha256');
  if (sha256(JSON.stringify(existing.rows)) !== expectedRowsHash) failures.push('snapshot rows');
  if (failures.length) throw new Error(`ACS snapshot verification failed: ${failures.join(', ')}.`);
  console.log(`Verified ${outputPath}: ${officialRows.length} rows, ${expectedRowsHash}`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const officialRows = await fetchOfficialRows();
  if (options.verify) {
    await verifySnapshot(options.output, officialRows);
    return;
  }
  const retrievedAt = options.retrievedAt || new Date().toISOString();
  const snapshot = buildSnapshot(officialRows, { retrievedAt });
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.writeFile(options.output, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Saved ${options.output}: ${snapshot.manifest.rowCount} rows, ${snapshot.manifest.rowsSha256}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
