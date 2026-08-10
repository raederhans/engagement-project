#!/usr/bin/env node
import path from 'node:path';

import {
  acquireOfficialHin2025,
  normalizeHin2025Snapshot,
  writeHin2025SnapshotAtomic,
} from './lib/hin_2025_snapshot.mjs';

const options = parseOptions(process.argv.slice(2));
const retrievedAt = options.retrievedAt || new Date().toISOString();
const destination = options.output || path.join('public', 'data', 'hin_2025.snapshot.json');

try {
  const acquired = await acquireOfficialHin2025();
  const snapshot = normalizeHin2025Snapshot({ ...acquired, retrievedAt });
  const result = await writeHin2025SnapshotAtomic(destination, snapshot);
  console.log(`[hin-2025] Wrote ${snapshot.rows.length} features to ${result.destination} (${result.bytes} bytes).`);
} catch (error) {
  console.error(`[hin-2025] Acquisition failed: ${error?.message || error}`);
  process.exitCode = 1;
}

function parseOptions(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value.startsWith('--retrieved-at=')) result.retrievedAt = value.slice('--retrieved-at='.length);
    else if (value === '--retrieved-at') result.retrievedAt = args[++index];
    else if (value.startsWith('--output=')) result.output = value.slice('--output='.length);
    else if (value === '--output') result.output = args[++index];
    else throw new Error(`Unknown HIN 2025 acquisition option: ${value}`);
  }
  return result;
}
