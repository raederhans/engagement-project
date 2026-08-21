#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  buildTractCountSQL,
  collectTractCounts,
  createSnapshotWindow,
  createTractCrimeSnapshot,
  normalizeCoverageDate,
  prepareTracts,
  validateTractCrimeSnapshot,
} from './lib/tract_crime_snapshot.mjs';
import {
  compareTractCrimeSemanticSnapshots,
  createTractCrimeReceipt,
  validateTractCrimeBundledReceiptModule,
  validateTractCrimeReceipt,
  validateTractSourceRegistry,
  writeTractCrimeLifecycleAtomic,
} from './lib/tract_crime_receipt.mjs';

const DEFAULT_CARTO_URL = 'https://phl.carto.com/api/v2/sql';
const DEFAULT_TRACT_FILE = path.join('public', 'data', 'tracts_phl.geojson');
const DEFAULT_OUTPUT_FILE = path.join('public', 'data', 'tract_crime_counts_last12m.json');
const DEFAULT_RECEIPT_FILE = path.join('src', 'source_health', 'tract_crime_bundled_receipt.json');
const DEFAULT_BUNDLED_RECEIPT_FILE = path.join(
  'src', 'source_health', 'tract_crime_bundled_receipt.generated.js',
);
const DEFAULT_REGISTRY_FILE = path.join('scripts', 'data', 'tract_source_contract.json');
const COVERAGE_SQL = `SELECT MAX(dispatch_date_time)::date AS max_dt
FROM incidents_part1_part2`;

export async function runPrecompute(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(helpText());
    return null;
  }

  const readFile = dependencies.readFile || fs.readFile;
  const fileSystem = dependencies.fileSystem || fs;
  const now = dependencies.now || (() => new Date());
  const cartoUrl = options.cartoUrl || DEFAULT_CARTO_URL;
  const requestRows = dependencies.requestRows
    || ((sql) => requestSqlRows(cartoUrl, sql));

  const tractGeoJson = JSON.parse(await readFile(options.tractFile, 'utf8'));
  const tracts = prepareTracts(tractGeoJson);
  const registry = validateTractSourceRegistry(dependencies.registry || JSON.parse(
    await fileSystem.readFile(options.registryFile, 'utf8'),
  ));
  const coverageDate = options.asOf || await fetchCoverageDate(requestRows);
  const window = createSnapshotWindow(coverageDate);
  console.log(
    `[tract-crime] Querying ${tracts.length} tracts for [${window.start}, ${window.end}) with concurrency ${options.concurrency}.`,
  );

  const counts = await collectTractCounts(tracts, {
    concurrency: options.concurrency,
    queryCount: async (tract) => {
      const rows = await requestRows(buildTractCountSQL(tract.geometry, window));
      if (!Array.isArray(rows)) throw new Error('CARTO returned invalid offense counts.');
      return rows;
    },
    onProgress: ({ completed, total }) => {
      if (completed === total || completed % 25 === 0) {
        console.log(`[tract-crime] ${completed}/${total} complete.`);
      }
    },
  });

  const retrievedAt = now().toISOString();
  const builtAt = now().toISOString();
  const snapshot = createTractCrimeSnapshot({
    tracts,
    counts,
    coverageDate,
    generatedAt: builtAt,
    sourceUrl: cartoUrl,
    tractSource: normalizePath(options.tractFile),
  });
  validateTractCrimeSnapshot(snapshot, tracts);
  const receipt = createTractCrimeReceipt({ snapshot, tracts, retrievedAt, registry });
  validateTractCrimeReceipt(receipt, { snapshot, tracts, registry });
  const existing = await readExistingLifecycle(
    options.outputFile,
    options.receiptFile,
    options.bundledReceiptFile,
    fileSystem,
  );
  if (existing) {
    validateTractCrimeSnapshot(existing.snapshot, tracts);
    validateTractCrimeReceipt(existing.receipt, {
      snapshot: existing.snapshot,
      tracts,
      registry,
    });
    validateTractCrimeBundledReceiptModule(existing.bundledReceipt, existing.receipt, {
      snapshot: existing.snapshot,
      tracts,
      registry,
    });
    if (compareTractCrimeSemanticSnapshots(existing.snapshot, snapshot, tracts)) {
      console.log('[tract-crime] No semantic source change; existing snapshot and receipt left untouched.');
      return existing.snapshot;
    }
  }
  await writeTractCrimeLifecycleAtomic({
    snapshotDestination: options.outputFile,
    receiptDestination: options.receiptFile,
    bundledReceiptDestination: options.bundledReceiptFile,
    snapshot,
    receipt,
    tracts,
    registry,
    fileSystem,
  });
  console.log(
    `[tract-crime] Wrote validated ${snapshot.rows.length}-row snapshot and Source Health receipt.`,
  );
  return snapshot;
}

async function fetchCoverageDate(requestRows) {
  const rows = await requestRows(COVERAGE_SQL);
  return normalizeCoverageDate(rows?.[0]?.max_dt);
}

async function requestSqlRows(url, sql, {
  retries = 3,
  timeoutMs = 20_000,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `q=${encodeURIComponent(sql)}`,
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 300);
        throw new Error(`HTTP ${response.status}${body ? `: ${body}` : ''}`);
      }
      const payload = await response.json();
      if (!Array.isArray(payload?.rows)) throw new Error('CARTO response did not contain rows.');
      return payload.rows;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await delay(500 * (2 ** (attempt - 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`CARTO query failed after ${retries} attempts: ${lastError?.message || lastError}`);
}

function parseArguments(argv) {
  const options = {
    asOf: null,
    cartoUrl: DEFAULT_CARTO_URL,
    concurrency: 3,
    tractFile: DEFAULT_TRACT_FILE,
    outputFile: DEFAULT_OUTPUT_FILE,
    receiptFile: DEFAULT_RECEIPT_FILE,
    bundledReceiptFile: DEFAULT_BUNDLED_RECEIPT_FILE,
    registryFile: DEFAULT_REGISTRY_FILE,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    const [name, inlineValue] = argument.split('=', 2);
    const value = inlineValue ?? argv[++index];
    if (value == null || value.startsWith('--')) throw new Error(`${name} requires a value.`);
    if (name === '--as-of') options.asOf = value;
    else if (name === '--carto') options.cartoUrl = value;
    else if (name === '--concurrency') options.concurrency = Number(value);
    else if (name === '--tracts') options.tractFile = value;
    else if (name === '--output') options.outputFile = value;
    else if (name === '--receipt') options.receiptFile = value;
    else if (name === '--bundled-receipt') options.bundledReceiptFile = value;
    else if (name === '--registry') options.registryFile = value;
    else throw new Error(`Unknown argument: ${name}`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 10) {
    throw new Error(`--concurrency must be an integer from 1 to 10; received ${options.concurrency}.`);
  }
  if (options.asOf) createSnapshotWindow(options.asOf);
  return options;
}

function helpText() {
  return `Generate a complete 12-month Philadelphia tract crime snapshot.

Usage: node scripts/precompute_tract_crime.mjs [options]

Options:
  --as-of YYYY-MM-DD   Override the live CARTO coverage date
  --concurrency N      Concurrent tract queries, 1-10 (default: 3)
  --tracts PATH        Tract GeoJSON input (default: ${DEFAULT_TRACT_FILE})
  --output PATH        Snapshot output (default: ${DEFAULT_OUTPUT_FILE})
  --receipt PATH       Source Health receipt output (default: ${DEFAULT_RECEIPT_FILE})
  --bundled-receipt PATH  Runtime receipt module (default: ${DEFAULT_BUNDLED_RECEIPT_FILE})
  --registry PATH      Source registry (default: ${DEFAULT_REGISTRY_FILE})
  --carto URL          CARTO SQL endpoint (default: ${DEFAULT_CARTO_URL})
  --help               Show this help`;
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readExistingLifecycle(snapshotFile, receiptFile, bundledReceiptFile, fileSystem) {
  const [snapshot, receipt, bundledReceipt] = await Promise.all([
    readJsonIfPresent(snapshotFile, fileSystem),
    readJsonIfPresent(receiptFile, fileSystem),
    readTextIfPresent(bundledReceiptFile, fileSystem),
  ]);
  if (new Set([snapshot, receipt, bundledReceipt].map(Boolean)).size !== 1) {
    throw new Error('Existing tract crime lifecycle is incomplete; all generated artifacts must be repaired together.');
  }
  return snapshot ? { snapshot, receipt, bundledReceipt } : null;
}

async function readJsonIfPresent(file, fileSystem) {
  try {
    return JSON.parse(await fileSystem.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function readTextIfPresent(file, fileSystem) {
  try {
    return await fileSystem.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function isDirectInvocation() {
  return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectInvocation()) {
  runPrecompute().catch((error) => {
    console.error(`[tract-crime] Failed: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
