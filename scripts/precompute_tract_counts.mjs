#!/usr/bin/env node
import { runPrecompute } from './precompute_tract_crime.mjs';

console.warn('[tract-crime] precompute_tract_counts.mjs is deprecated; using the canonical tract crime pipeline.');
runPrecompute().catch((error) => {
  console.error(`[tract-crime] Failed: ${error?.message || error}`);
  process.exitCode = 1;
});
