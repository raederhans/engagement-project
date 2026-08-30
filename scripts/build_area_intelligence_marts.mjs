#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildAreaIntelligenceMarts } from './lib/area_intelligence_mart.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
if (!args.source) {
  throw new Error('Usage: node scripts/build_area_intelligence_marts.mjs --source=<authorized-M1-root> [--output=.dfev1/area-intelligence/m2-baseline]');
}

const startedAt = Date.now();
let peakRss = process.memoryUsage().rss;
const memorySampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 1000);
memorySampler.unref();

try {
  const result = await buildAreaIntelligenceMarts({
    sourceRoot: path.resolve(args.source),
    outputRoot: path.resolve(root, args.output || '.dfev1/area-intelligence/m2-baseline'),
    protocolPath: path.resolve(root, 'scripts/data/area_intelligence_evaluation_protocol.v2.json'),
    tractGeoJsonPath: path.resolve(root, 'public/data/tracts_phl.geojson'),
    outputPartitionCount: Number(args['output-partitions'] || 32),
    onProgress(event) {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      process.stdout.write(`${JSON.stringify({ event: 'area-intelligence-mart-progress', ...event, manifest: undefined })}\n`);
    },
  });
  process.stdout.write(`${JSON.stringify({
    event: 'area-intelligence-mart-result',
    status: result.idempotent ? 'idempotent' : 'built',
    artifact_identity: result.manifest.artifact_identity,
    canonical_rows_seen: result.manifest.admission.canonical_rows_seen,
    mart_rows: result.manifest.row_count,
    units: result.manifest.unit_count,
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
