#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { evaluateAreaIntelligence } from './lib/area_intelligence_evaluation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const martRoot = path.resolve(root, args.mart || '.dfev1/area-intelligence/m2-baseline');
const outputRoot = path.resolve(root, args.output || '.dfev1/area-intelligence/m2-baseline/evaluation');
const startedAt = Date.now();
let peakRss = process.memoryUsage().rss;
const memorySampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 1000);
memorySampler.unref();

try {
  const result = await evaluateAreaIntelligence({
    martRoot,
    outputRoot,
    protocolPath: path.resolve(root, 'scripts/data/area_intelligence_evaluation_protocol.v1.json'),
    onProgress(event) {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      process.stdout.write(`${JSON.stringify({ event: 'area-intelligence-evaluation-progress', ...event })}\n`);
    },
  });
  process.stdout.write(`${JSON.stringify({
    event: 'area-intelligence-evaluation-result',
    status: result.idempotent ? 'idempotent' : 'evaluated',
    promotion: result.manifest.promotion.status,
    selected_model: result.manifest.promotion.selected_model,
    elapsed_ms: Date.now() - startedAt,
    peak_rss_bytes: peakRss,
  }, null, 2)}\n`);
} finally {
  clearInterval(memorySampler);
}

function parseArgs(values) {
  return Object.fromEntries(values.map((entry) => {
    if (!entry.startsWith('--') || !entry.includes('=')) throw new Error(`Invalid argument: ${entry}`);
    const separator = entry.indexOf('=');
    return [entry.slice(2, separator), entry.slice(separator + 1)];
  }));
}
