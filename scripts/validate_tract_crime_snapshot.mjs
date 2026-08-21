#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  prepareTracts,
  validateTractCrimeSnapshot,
} from './lib/tract_crime_snapshot.mjs';
import {
  validateTractCrimeReceipt,
  validateTractCrimeBundledReceiptModule,
  validateTractSourceRegistry,
} from './lib/tract_crime_receipt.mjs';

const snapshotFile = process.argv[2]
  || path.join('public', 'data', 'tract_crime_counts_last12m.json');
const tractFile = process.argv[3]
  || path.join('public', 'data', 'tracts_phl.geojson');
const receiptFile = process.argv[4]
  || path.join('src', 'source_health', 'tract_crime_bundled_receipt.json');
const registryFile = process.argv[5]
  || path.join('scripts', 'data', 'tract_source_contract.json');
const bundledReceiptFile = process.argv[6]
  || path.join('src', 'source_health', 'tract_crime_bundled_receipt.generated.js');

try {
  const [snapshot, tractGeoJson, receipt, registryValue, bundledReceipt] = await Promise.all([
    readJson(snapshotFile),
    readJson(tractFile),
    readJson(receiptFile),
    readJson(registryFile),
    fs.readFile(bundledReceiptFile, 'utf8'),
  ]);
  const tracts = prepareTracts(tractGeoJson);
  const registry = validateTractSourceRegistry(registryValue);
  const result = validateTractCrimeSnapshot(snapshot, tracts);
  validateTractCrimeReceipt(receipt, { snapshot, tracts, registry });
  validateTractCrimeBundledReceiptModule(bundledReceipt, receipt, {
    snapshot,
    tracts,
    registry,
  });
  console.log(
    `[tract-crime] Valid snapshot/receipt pair: ${result.rowCount} tracts for [${result.start}, ${result.end}).`,
  );
} catch (error) {
  console.error(`[tract-crime] Invalid snapshot: ${error?.message || error}`);
  process.exitCode = 1;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
