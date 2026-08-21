#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createWarehouseDependencies,
  ingestCrimeSourceSnapshot,
} from './lib/crime_event_warehouse.mjs';
import { assertTaskOwnedDfev1Path } from './lib/dfev1_path.mjs';

const DEFAULTS = Object.freeze({
  eventContract: path.join('scripts', 'data', 'crime_event_contract.v1.json'),
  sourceContract: path.join('scripts', 'data', 'crime_event_source_contract.json'),
  taxonomy: path.join('src', 'data', 'crime_taxonomy.v1.json'),
  tracts: path.join('public', 'data', 'tracts_phl.geojson'),
  tractRegistry: path.join('scripts', 'data', 'tract_source_contract.json'),
  acs: path.join('src', 'data', 'acs_tracts_2024_pa101.json'),
});

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(helpText());
    return;
  }
  options.snapshot = await assertTaskOwnedDfev1Path(options.snapshot, { label: 'Crime source snapshot' });
  options.warehouse = await assertTaskOwnedDfev1Path(options.warehouse, { label: 'Crime warehouse' });
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
  const result = await ingestCrimeSourceSnapshot({
    snapshotDir: options.snapshot,
    warehouseDir: options.warehouse,
    dependencies,
    onProgress(event) {
      console.log(`[crime-warehouse] ${JSON.stringify(event)}`);
    },
  });
  console.log(
    `[crime-warehouse] ${result.idempotent ? 'Idempotent' : 'Committed'} local warehouse candidate: `
      + `${result.manifest.canonical_row_count} canonical rows, snapshot ${result.manifest.current_snapshot_id}.`,
  );
}

function parseArguments(argv) {
  const options = { ...DEFAULTS, snapshot: null, warehouse: null, corridors: null, help: false };
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument.startsWith('--snapshot=')) options.snapshot = argument.slice('--snapshot='.length);
    else if (argument.startsWith('--warehouse=')) options.warehouse = argument.slice('--warehouse='.length);
    else if (argument.startsWith('--corridors=')) options.corridors = argument.slice('--corridors='.length);
    else if (argument.startsWith('--event-contract=')) options.eventContract = argument.slice('--event-contract='.length);
    else if (argument.startsWith('--source-contract=')) options.sourceContract = argument.slice('--source-contract='.length);
    else if (argument.startsWith('--taxonomy=')) options.taxonomy = argument.slice('--taxonomy='.length);
    else if (argument.startsWith('--tracts=')) options.tracts = argument.slice('--tracts='.length);
    else if (argument.startsWith('--tract-registry=')) options.tractRegistry = argument.slice('--tract-registry='.length);
    else if (argument.startsWith('--acs=')) options.acs = argument.slice('--acs='.length);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.help && (!options.snapshot || !options.warehouse)) {
    throw new Error('Crime warehouse ingest requires --snapshot and an ignored --warehouse directory.');
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function helpText() {
  return `Build or incrementally update the revision-aware Philadelphia crime event warehouse.

Usage:
  node scripts/ingest_crime_events.mjs \\
    --snapshot=.dfev1/crime/acquisitions/<run> \\
    --warehouse=.dfev1/crime/warehouse

Optional:
  --corridors=<registry.json>  Versioned known-polyline corridor registry
  --event-contract=<path>     Canonical event/artifact contract
  --source-contract=<path>    Official source contract
  --taxonomy=<path>           Versioned offense crosswalk
  --tracts=<path>             Philadelphia tract GeoJSON
  --tract-registry=<path>     Tract source/vintage registry
  --acs=<path>                ACS estimate/MOE snapshot

The official CLI rejects synthetic snapshots. Canonical/raw event data, checkpoints,
quality reports, revision ledgers, and lineage stay under the ignored .dfev1 root.`;
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
