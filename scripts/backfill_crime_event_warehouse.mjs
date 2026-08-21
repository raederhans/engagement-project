#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  acquireCrimeSourceSnapshot,
  inspectCrimeSourceHealth,
} from './lib/crime_event_source.mjs';
import {
  createWarehouseDependencies,
  ingestCrimeSourceSnapshot,
} from './lib/crime_event_warehouse.mjs';

const DEFAULTS = Object.freeze({
  root: path.join('.dfev1', 'crime'),
  start: '2006-01-01',
  through: null,
  eventContract: path.join('scripts', 'data', 'crime_event_contract.v1.json'),
  sourceContract: path.join('scripts', 'data', 'crime_event_source_contract.json'),
  taxonomy: path.join('src', 'data', 'crime_taxonomy.v1.json'),
  tracts: path.join('public', 'data', 'tracts_phl.geojson'),
  tractRegistry: path.join('scripts', 'data', 'tract_source_contract.json'),
  acs: path.join('src', 'data', 'acs_tracts_2024_pa101.json'),
  corridors: null,
  pageSize: undefined,
  partitionCount: undefined,
});

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(helpText());
    return;
  }
  const [eventContract, sourceContract, taxonomy, tractGeoJson, tractSourceRegistry, acsSnapshot] = await Promise.all([
    readJson(options.eventContract),
    readJson(options.sourceContract),
    readJson(options.taxonomy),
    readJson(options.tracts),
    readJson(options.tractRegistry),
    readJson(options.acs),
  ]);
  const corridorRegistry = options.corridors ? await readJson(options.corridors) : null;
  const dependencies = await createWarehouseDependencies({
    eventContract,
    sourceContract,
    taxonomy,
    tractGeoJson,
    tractSourceRegistry,
    acsSnapshot,
    corridorRegistry,
  });

  const warehouseDir = path.join(options.root, 'warehouse');
  const checkpointPath = path.join(options.root, 'backfill-checkpoint.json');
  const periods = annualPeriods(options.start, options.through);
  const checkpoint = await loadCheckpoint(checkpointPath, { options, periods });
  if (!checkpoint.source_health_preflight) {
    checkpoint.source_health_preflight = await inspectCrimeSourceHealth(sourceContract, {
      scope: { start: options.start, end_exclusive: options.through },
    });
    checkpoint.updated_at = checkpoint.source_health_preflight.observed_at;
    await writeJsonAtomic(checkpointPath, checkpoint);
  }
  for (const period of periods) {
    const periodId = `${period.start}_${period.end_exclusive}`;
    const snapshotDir = path.join(options.root, 'acquisitions', periodId);
    console.log(`[crime-backfill] Starting ${periodId}.`);
    const acquisition = await acquireCrimeSourceSnapshot({
      outputDir: snapshotDir,
      start: period.start,
      end: period.end_exclusive,
      sourceContract,
      pageSize: options.pageSize,
      partitionCount: options.partitionCount,
      onProgress(event) {
        console.log(`[crime-backfill] acquisition ${periodId} ${JSON.stringify(event)}`);
      },
    });
    const ingest = await ingestCrimeSourceSnapshot({
      snapshotDir,
      warehouseDir,
      dependencies,
      onProgress(event) {
        console.log(`[crime-backfill] ingest ${periodId} ${JSON.stringify(event)}`);
      },
    });
    const nextCompleted = {
      snapshot_id: acquisition.manifest.snapshot_id,
      source_rows: acquisition.manifest.row_count,
      canonical_rows: ingest.manifest.canonical_row_count,
    };
    const existingCompleted = checkpoint.completed[periodId];
    const completionChanged = !existingCompleted
      || existingCompleted.snapshot_id !== nextCompleted.snapshot_id
      || existingCompleted.source_rows !== nextCompleted.source_rows
      || existingCompleted.canonical_rows !== nextCompleted.canonical_rows;
    if (completionChanged) {
      nextCompleted.completed_at = new Date().toISOString();
      checkpoint.completed[periodId] = nextCompleted;
      checkpoint.updated_at = nextCompleted.completed_at;
      await writeJsonAtomic(checkpointPath, checkpoint);
    }
    console.log(`[crime-backfill] Completed ${periodId}.`);
  }
  const acquiredRows = Object.values(checkpoint.completed)
    .reduce((sum, period) => sum + period.source_rows, 0);
  const expectedDateScopedRows = checkpoint.source_health_preflight.date_scoped_row_count;
  const finalQuality = {
    schema: 'engagement-phl-crime-backfill-quality/v1',
    acquired_rows: acquiredRows,
    expected_date_scoped_rows: expectedDateScopedRows,
    date_scoped_count_complete: acquiredRows === expectedDateScopedRows,
    excluded_missing_event_time: checkpoint.source_health_preflight.event_time_missing,
    requested_scope: { start: options.start, end_exclusive: options.through },
    note: 'Count equality covers the requested date scopes only; it does not prove immutable upstream data or scientific validity.',
  };
  if (JSON.stringify(checkpoint.final_quality) !== JSON.stringify(finalQuality)) {
    checkpoint.final_quality = finalQuality;
    checkpoint.updated_at = new Date().toISOString();
    await writeJsonAtomic(checkpointPath, checkpoint);
  }
  if (!finalQuality.date_scoped_count_complete) {
    throw new Error(
      `Backfill acquired ${acquiredRows} rows but preflight expected ${expectedDateScopedRows} date-scoped rows.`,
    );
  }
  console.log(
    `[crime-backfill] Local candidate covers requested scopes [${options.start}, ${options.through}); `
      + `${Object.keys(checkpoint.completed).length}/${periods.length} periods recorded.`,
  );
}

function parseArguments(argv) {
  const options = { ...DEFAULTS, help: false };
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument.startsWith('--root=')) options.root = argument.slice('--root='.length);
    else if (argument.startsWith('--start=')) options.start = argument.slice('--start='.length);
    else if (argument.startsWith('--through=')) options.through = argument.slice('--through='.length);
    else if (argument.startsWith('--page-size=')) options.pageSize = Number(argument.slice('--page-size='.length));
    else if (argument.startsWith('--partitions=')) options.partitionCount = Number(argument.slice('--partitions='.length));
    else if (argument.startsWith('--corridors=')) options.corridors = argument.slice('--corridors='.length);
    else if (argument.startsWith('--event-contract=')) options.eventContract = argument.slice('--event-contract='.length);
    else if (argument.startsWith('--source-contract=')) options.sourceContract = argument.slice('--source-contract='.length);
    else if (argument.startsWith('--taxonomy=')) options.taxonomy = argument.slice('--taxonomy='.length);
    else if (argument.startsWith('--tracts=')) options.tracts = argument.slice('--tracts='.length);
    else if (argument.startsWith('--tract-registry=')) options.tractRegistry = argument.slice('--tract-registry='.length);
    else if (argument.startsWith('--acs=')) options.acs = argument.slice('--acs='.length);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.help && !options.through) {
    throw new Error('Crime event backfill requires an explicit half-open --through=YYYY-MM-DD gate.');
  }
  return options;
}

export function annualPeriods(start, through) {
  const startDate = exactDate(start, 'backfill start');
  const throughDate = exactDate(through, 'backfill through');
  if (startDate >= throughDate) throw new Error('Backfill range must be non-empty.');
  const periods = [];
  let cursor = startDate;
  while (cursor < throughDate) {
    const year = Number(cursor.slice(0, 4));
    const nextYear = `${year + 1}-01-01`;
    const end = nextYear < throughDate ? nextYear : throughDate;
    periods.push({ start: cursor, end_exclusive: end });
    cursor = end;
  }
  return periods;
}

async function loadCheckpoint(checkpointPath, { options, periods }) {
  try {
    const checkpoint = await readJson(checkpointPath);
    if (checkpoint.schema !== 'engagement-phl-crime-backfill-checkpoint/v1'
      || checkpoint.start !== options.start || checkpoint.through !== options.through
      || JSON.stringify(checkpoint.periods) !== JSON.stringify(periods)) {
      throw new Error('Existing backfill checkpoint does not match the requested range.');
    }
    return checkpoint;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const checkpoint = {
      schema: 'engagement-phl-crime-backfill-checkpoint/v1',
      start: options.start,
      through: options.through,
      periods,
      completed: {},
      source_health_preflight: null,
      final_quality: null,
      updated_at: null,
      resume: 'Re-run the identical command; completed source snapshots and warehouse vintages are idempotent.',
    };
    await writeJsonAtomic(checkpointPath, checkpoint);
    return checkpoint;
  }
}

async function writeJsonAtomic(destination, value) {
  const temporary = `${destination}.${process.pid}-${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, destination);
}

function exactDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function helpText() {
  return `Serially acquire and ingest annual official Philadelphia reported-crime scopes.

Usage:
  node scripts/backfill_crime_event_warehouse.mjs \\
    --start=2006-01-01 --through=YYYY-MM-DD --root=.dfev1/crime

The --through date is exclusive and must be explicit. Every annual acquisition has its own
checkpoint and exact source manifest. The outer checkpoint records completed periods. Re-run
the identical command to resume. All raw/canonical event data and logs remain ignored.`;
}

function isDirectInvocation() {
  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isDirectInvocation()) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
