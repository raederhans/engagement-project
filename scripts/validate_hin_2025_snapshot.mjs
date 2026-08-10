#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  renderHin2025Snapshot,
  validateHin2025Snapshot,
} from './lib/hin_2025_snapshot.mjs';

const snapshotFile = process.argv[2] || path.join('public', 'data', 'hin_2025.snapshot.json');

try {
  const snapshot = JSON.parse(await fs.readFile(snapshotFile, 'utf8'));
  const admitted = validateHin2025Snapshot(snapshot);
  const rendered = renderHin2025Snapshot(snapshot);
  console.log(`[hin-2025] Valid snapshot: ${admitted.featureCount} features, ${rendered.bytes} bytes.`);
} catch (error) {
  console.error(`[hin-2025] Invalid snapshot: ${error?.message || error}`);
  process.exitCode = 1;
}
