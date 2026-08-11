#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import {
  ACS_AGGREGATION_PERIOD,
  ACS_AGGREGATION_RELEASE,
  ACS_AGGREGATION_SCHEMA_VERSION,
  ACS_TRACT_GEOGRAPHY_VINTAGE,
  ACS_VRE_REPLICATE_COUNT,
} from '../src/data/acs_aggregation.js';

export const ACS_VRE_SOURCE_URL =
  'https://www2.census.gov/programs-surveys/acs/replicate_estimates/2024/data/5-year/140/B01003_42.csv.zip';
export const ACS_VRE_DOCUMENTATION_URL =
  'https://www2.census.gov/programs-surveys/acs/replicate_estimates/2024/documentation/5-year/2020-2024_Variance_Replicate_Table_Documentation.pdf';
export const ACS_GEOGRAPHY_URL =
  'https://www.census.gov/programs-surveys/acs/geography-acs/geography-boundaries-by-year.2024.html';
export const ACS_VRE_OUTPUT_PATH = path.join('src', 'data', 'acs_vre_b01003_2024_pa101.json');
export const ACS_OFFICIAL_ACCESS_DATE = '2026-08-10';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function parseInteger(value, { nonNegative = false } = {}) {
  if (!/^-?\d+$/.test(String(value ?? ''))) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || (nonNegative && number < 0)) return null;
  return number;
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      values.push(value);
      value = '';
    } else value += character;
  }
  if (quoted) throw new Error('Official ACS VRE CSV contains an unterminated quoted field.');
  values.push(value);
  return values;
}

export function parseOfficialVreCsv(csvText) {
  const lines = String(csvText).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const header = parseCsvLine(lines.shift() || '');
  const index = Object.fromEntries(header.map((name, column) => [name, column]));
  for (const name of ['TBLID', 'GEOID', 'ORDER', 'ESTIMATE']) {
    if (!Object.hasOwn(index, name)) throw new Error(`Official ACS VRE CSV is missing ${name}.`);
  }
  const replicateColumns = [];
  for (let replicate = 1; replicate <= ACS_VRE_REPLICATE_COUNT; replicate += 1) {
    const name = `Var_Rep${replicate}`;
    if (!Object.hasOwn(index, name)) {
      throw new Error(`Official ACS VRE CSV is missing the ordered column ${name}.`);
    }
    replicateColumns.push(index[name]);
  }
  const unexpected = header.filter((name) => /^Var_Rep\d+$/.test(name))
    .filter((name, column) => name !== `Var_Rep${column + 1}`);
  const actualReplicateHeaders = header.filter((name) => /^Var_Rep\d+$/.test(name));
  if (actualReplicateHeaders.length !== ACS_VRE_REPLICATE_COUNT || unexpected.length > 0) {
    throw new Error('Official ACS VRE CSV replicate columns are duplicated, reordered, or unexpected.');
  }

  const rows = lines.flatMap((line) => {
    const values = parseCsvLine(line);
    const geoidMatch = values[index.GEOID]?.match(/^1400000US(42101\d{6})$/);
    if (!geoidMatch || values[index.TBLID] !== 'B01003' || values[index.ORDER] !== '1') return [];
    const estimate = parseInteger(values[index.ESTIMATE], { nonNegative: true });
    const replicates = replicateColumns.map((column) => parseInteger(values[column]));
    if (estimate == null || replicates.some((value) => value == null)) {
      throw new Error(`Official ACS VRE CSV has missing or invalid values for tract ${geoidMatch[1]}.`);
    }
    return [{ geoid: geoidMatch[1], estimate, replicates }];
  }).sort((left, right) => left.geoid.localeCompare(right.geoid));

  if (rows.length === 0) throw new Error('Official ACS VRE CSV contains no Philadelphia tract rows.');
  if (new Set(rows.map(({ geoid }) => geoid)).size !== rows.length) {
    throw new Error('Official ACS VRE CSV contains duplicate Philadelphia tract GEOIDs.');
  }
  return rows;
}

function findEndOfCentralDirectory(zip) {
  const minimum = Math.max(0, zip.length - 65_557);
  for (let offset = zip.length - 22; offset >= minimum; offset -= 1) {
    if (zip.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('Official ACS VRE ZIP is missing its end-of-central-directory record.');
}

export function extractOfficialCsvFromZip(bytes) {
  const zip = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const eocd = findEndOfCentralDirectory(zip);
  const entryCount = zip.readUInt16LE(eocd + 10);
  let centralOffset = zip.readUInt32LE(eocd + 16);
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (zip.readUInt32LE(centralOffset) !== CENTRAL_SIGNATURE) {
      throw new Error('Official ACS VRE ZIP has an invalid central-directory entry.');
    }
    const method = zip.readUInt16LE(centralOffset + 10);
    const compressedSize = zip.readUInt32LE(centralOffset + 20);
    const uncompressedSize = zip.readUInt32LE(centralOffset + 24);
    const nameLength = zip.readUInt16LE(centralOffset + 28);
    const extraLength = zip.readUInt16LE(centralOffset + 30);
    const commentLength = zip.readUInt16LE(centralOffset + 32);
    const localOffset = zip.readUInt32LE(centralOffset + 42);
    const name = zip.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString('utf8');
    centralOffset += 46 + nameLength + extraLength + commentLength;
    if (!/B01003_42\.csv$/i.test(name)) continue;
    if (zip.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error('Official ACS VRE ZIP has an invalid local file header.');
    }
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = zip.subarray(start, start + compressedSize);
    const output = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
    if (!output || output.length !== uncompressedSize) {
      throw new Error('Official ACS VRE ZIP uses an unsupported or invalid compression entry.');
    }
    return output.toString('utf8');
  }
  throw new Error('Official ACS VRE ZIP does not contain B01003_42.csv.');
}

export function buildVreSnapshot(rows, { retrievedAt, sourceUrl = ACS_VRE_SOURCE_URL } = {}) {
  const timestamp = new Date(retrievedAt || '');
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== retrievedAt) {
    throw new Error('ACS VRE snapshot retrieval time must be an ISO timestamp.');
  }
  const rowsJson = JSON.stringify(rows);
  return {
    schemaVersion: ACS_AGGREGATION_SCHEMA_VERSION,
    manifest: {
      dataset: 'American Community Survey 5-Year Variance Replicate Estimates',
      release: ACS_AGGREGATION_RELEASE,
      period: ACS_AGGREGATION_PERIOD,
      geographyVintage: ACS_TRACT_GEOGRAPHY_VINTAGE,
      geography: 'Complete census tracts in Philadelphia County, Pennsylvania (state 42, county 101)',
      summaryLevel: '140',
      tableId: 'B01003',
      indicator: 'total-population',
      replicateCount: ACS_VRE_REPLICATE_COUNT,
      source: 'U.S. Census Bureau',
      sourceUrl,
      documentationUrl: ACS_VRE_DOCUMENTATION_URL,
      geographyUrl: ACS_GEOGRAPHY_URL,
      accessedAt: ACS_OFFICIAL_ACCESS_DATE,
      retrievedAt,
      rowCount: rows.length,
      rowsSha256: sha256(rowsJson),
      hashContract: 'SHA-256 of JSON.stringify(rows); manifest and retrievedAt excluded',
    },
    rows,
  };
}

function parseArgs(argv) {
  const options = { input: null, output: ACS_VRE_OUTPUT_PATH, retrievedAt: null, verify: false };
  for (const argument of argv) {
    if (argument === '--verify') options.verify = true;
    else if (argument.startsWith('--input=')) options.input = argument.slice('--input='.length);
    else if (argument.startsWith('--output=')) options.output = argument.slice('--output='.length);
    else if (argument.startsWith('--retrieved-at=')) options.retrievedAt = argument.slice('--retrieved-at='.length);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

export async function acquireRows(input, { request = fetch, timeoutMs = null } = {}) {
  if (input) return parseOfficialVreCsv(await fs.readFile(input, 'utf8'));
  const response = await request(ACS_VRE_SOURCE_URL, {
    headers: { accept: 'application/zip', 'user-agent': 'engagement-project-acs-vre/1.0' },
    ...requestTimeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Official ACS VRE source returned HTTP ${response.status}.`);
  return parseOfficialVreCsv(extractOfficialCsvFromZip(await response.arrayBuffer()));
}

function requestTimeout(timeoutMs) {
  if (timeoutMs === null) return {};
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('ACS VRE request timeoutMs must be a positive integer or null.');
  }
  return { signal: AbortSignal.timeout(timeoutMs) };
}

async function verifySnapshot(output, rows) {
  const existing = JSON.parse(await fs.readFile(output, 'utf8'));
  const expectedHash = sha256(JSON.stringify(rows));
  const failures = [];
  if (existing.schemaVersion !== ACS_AGGREGATION_SCHEMA_VERSION) failures.push('schemaVersion');
  if (existing.manifest?.release !== ACS_AGGREGATION_RELEASE) failures.push('release');
  if (existing.manifest?.period !== ACS_AGGREGATION_PERIOD) failures.push('period');
  if (existing.manifest?.geographyVintage !== ACS_TRACT_GEOGRAPHY_VINTAGE) failures.push('geographyVintage');
  if (existing.manifest?.sourceUrl !== ACS_VRE_SOURCE_URL) failures.push('sourceUrl');
  if (existing.manifest?.accessedAt !== ACS_OFFICIAL_ACCESS_DATE) failures.push('accessedAt');
  if (existing.manifest?.replicateCount !== ACS_VRE_REPLICATE_COUNT) failures.push('replicateCount');
  if (existing.manifest?.rowCount !== rows.length) failures.push('rowCount');
  if (existing.manifest?.rowsSha256 !== expectedHash) failures.push('rowsSha256');
  if (JSON.stringify(existing.rows) !== JSON.stringify(rows)) failures.push('rows');
  if (failures.length) throw new Error(`ACS VRE snapshot verification failed: ${failures.join(', ')}.`);
  console.log(`Verified ${output}: ${rows.length} Philadelphia tracts, ${ACS_VRE_REPLICATE_COUNT} ordered replicates each.`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const rows = await acquireRows(options.input);
  if (options.verify) return verifySnapshot(options.output, rows);
  const retrievedAt = options.retrievedAt || new Date().toISOString();
  const snapshot = buildVreSnapshot(rows, { retrievedAt });
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.writeFile(options.output, `${JSON.stringify(snapshot)}\n`);
  console.log(`Saved ${options.output}: ${rows.length} Philadelphia tracts, ${ACS_VRE_REPLICATE_COUNT} ordered replicates each.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
