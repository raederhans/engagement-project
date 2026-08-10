#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  renderHin2025Snapshot,
  validateHin2025Snapshot,
} from './lib/hin_2025_snapshot.mjs';
import {
  renderHin2025Receipt,
  validateHin2025Receipt,
} from './lib/hin_2025_receipt.mjs';

const snapshotFile = process.argv[2] || path.join('public', 'data', 'hin_2025.snapshot.json');
const receiptFile = process.argv[3] || path.join('public', 'data', 'hin_2025.receipt.json');

try {
  const snapshot = JSON.parse(await fs.readFile(snapshotFile, 'utf8'));
  const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
  const admitted = validateHin2025Snapshot(snapshot);
  const admittedReceipt = validateHin2025Receipt(receipt, { snapshot });
  const rendered = renderHin2025Snapshot(snapshot);
  const renderedReceipt = renderHin2025Receipt(receipt, { snapshot });
  console.log(`[hin-2025] Valid snapshot: ${admitted.featureCount} features, ${rendered.bytes} bytes, ${admittedReceipt.artifact.identity}, receipt ${renderedReceipt.bytes} bytes.`);
} catch (error) {
  console.error(`[hin-2025] Invalid snapshot: ${error?.message || error}`);
  process.exitCode = 1;
}
