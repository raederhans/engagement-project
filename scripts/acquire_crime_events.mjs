#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  acquireCrimeSourceSnapshot,
  resolveIncrementalCrimeScope,
} from './lib/crime_event_source.mjs';

const DEFAULT_SOURCE_CONTRACT = path.join('scripts', 'data', 'crime_event_source_contract.json');

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(helpText());
    return;
  }
  const sourceContract = JSON.parse(await fs.readFile(options.sourceContract, 'utf8'));
  let start = options.start;
  if (!start) {
    const warehouseManifest = await readJsonIfExists(path.join(options.warehouse, 'manifest.json'));
    const scope = resolveIncrementalCrimeScope(warehouseManifest, {
      end: options.end,
      overlapDays: options.overlapDays,
      initialStart: sourceContract.coverage.declared_start,
    });
    start = scope.start;
    console.log(`[crime-source] Planned ${scope.mode} scope [${scope.start}, ${scope.end}).`);
  }
  const result = await acquireCrimeSourceSnapshot({
    outputDir: options.output,
    start,
    end: options.end,
    pageSize: options.pageSize,
    partitionCount: options.partitionCount,
    sourceContract,
    onProgress(event) {
      console.log(`[crime-source] ${JSON.stringify(event)}`);
    },
  });
  console.log(
    `[crime-source] ${result.idempotent ? 'Verified existing' : 'Completed'} ${result.manifestPath}: `
      + `${result.manifest.row_count} rows, ${result.manifest.snapshot_id}.`,
  );
}

function parseArguments(argv) {
  const options = {
    help: false,
    start: null,
    end: null,
    output: null,
    warehouse: null,
    sourceContract: DEFAULT_SOURCE_CONTRACT,
    pageSize: undefined,
    partitionCount: undefined,
    overlapDays: 45,
  };
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument.startsWith('--start=')) options.start = argument.slice('--start='.length);
    else if (argument.startsWith('--end=')) options.end = argument.slice('--end='.length);
    else if (argument.startsWith('--output=')) options.output = argument.slice('--output='.length);
    else if (argument.startsWith('--warehouse=')) options.warehouse = argument.slice('--warehouse='.length);
    else if (argument.startsWith('--source-contract=')) {
      options.sourceContract = argument.slice('--source-contract='.length);
    } else if (argument.startsWith('--page-size=')) {
      options.pageSize = Number(argument.slice('--page-size='.length));
    } else if (argument.startsWith('--partitions=')) {
      options.partitionCount = Number(argument.slice('--partitions='.length));
    } else if (argument.startsWith('--overlap-days=')) {
      options.overlapDays = Number(argument.slice('--overlap-days='.length));
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.help && (!options.end || !options.output || (!options.start && !options.warehouse))) {
    throw new Error('Crime acquisition requires --end, an ignored --output, and either --start or --warehouse.');
  }
  return options;
}

function helpText() {
  return `Acquire a resumable, partitioned Philadelphia reported-crime source snapshot.

Usage:
  node scripts/acquire_crime_events.mjs --start=YYYY-MM-DD --end=YYYY-MM-DD --output=.dfev1/crime/acquisitions/<run>

Incremental overlap:
  node scripts/acquire_crime_events.mjs --warehouse=.dfev1/crime/warehouse --overlap-days=45 \\
    --end=YYYY-MM-DD --output=.dfev1/crime/acquisitions/<run>

Options:
  --page-size=N       CARTO keyset page size (1..50000; contract default 50000)
  --partitions=N      Raw snapshot shard count (1..256; contract default 64)
  --warehouse=P       Derive start from the warehouse latest-event watermark
  --overlap-days=N    Incremental overlap (1..366; default 45)
  --source-contract=P Override the versioned official source contract

The date scope is half-open [start, end). Re-run the same command to resume a checkpoint
or validate an already completed source vintage. Raw event rows remain under .dfev1/.`;
}

function isDirectInvocation() {
  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

if (isDirectInvocation()) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
