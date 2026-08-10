#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  acquireOfficialHin2025,
  normalizeHin2025Snapshot,
} from './lib/hin_2025_snapshot.mjs';
import {
  compareHin2025SemanticSnapshots,
  createHin2025Receipt,
  validateHin2025Receipt,
  writeHin2025LifecycleAtomic,
} from './lib/hin_2025_receipt.mjs';

const options = parseOptions(process.argv.slice(2));
const retrievedAt = options.retrievedAt || new Date().toISOString();
const destination = options.output || path.join('public', 'data', 'hin_2025.snapshot.json');
const receiptDestination = options.receipt || path.join('public', 'data', 'hin_2025.receipt.json');

try {
  const acquired = await acquireOfficialHin2025();
  const candidate = normalizeHin2025Snapshot({ ...acquired, retrievedAt });
  const current = await readJsonIfPresent(destination);
  if (current) {
    const comparison = compareHin2025SemanticSnapshots(current, candidate);
    if (!comparison.changed) {
      const receipt = JSON.parse(await fs.readFile(receiptDestination, 'utf8'));
      validateHin2025Receipt(receipt, { snapshot: current });
      console.log('[hin-2025] No admitted semantic source change; existing snapshot and receipt left untouched.');
      process.exit(0);
    }
    if (!options.acceptReviewedChange) {
      throw new Error(`Official HIN 2025 change requires explicit review; no artifacts written (${comparison.reasons.join(', ')}).`);
    }
  } else if (!options.acceptReviewedChange) {
    throw new Error('Initial HIN 2025 snapshot requires explicit review; no artifacts written.');
  }
  if (!options.reviewedBy?.trim()) {
    throw new Error('--reviewed-by is required with --accept-reviewed-change.');
  }
  const builtAt = new Date().toISOString();
  const receipt = createHin2025Receipt({
    snapshot: candidate,
    builtAt,
    review: {
      status: 'admitted-after-review',
      reviewedAt: builtAt,
      reviewedBy: options.reviewedBy.trim(),
    },
  });
  const result = await writeHin2025LifecycleAtomic({
    snapshotDestination: destination,
    receiptDestination,
    snapshot: candidate,
    receipt,
  });
  console.log(`[hin-2025] Wrote reviewed ${candidate.rows.length}-feature snapshot to ${result.snapshot.destination} (${result.snapshot.bytes} bytes) and receipt to ${result.receipt.destination}.`);
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
    else if (value.startsWith('--receipt=')) result.receipt = value.slice('--receipt='.length);
    else if (value === '--receipt') result.receipt = args[++index];
    else if (value === '--accept-reviewed-change') result.acceptReviewedChange = true;
    else if (value.startsWith('--reviewed-by=')) result.reviewedBy = value.slice('--reviewed-by='.length);
    else if (value === '--reviewed-by') result.reviewedBy = args[++index];
    else throw new Error(`Unknown HIN 2025 acquisition option: ${value}`);
  }
  return result;
}

async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
