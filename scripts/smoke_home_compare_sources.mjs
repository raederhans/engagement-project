#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  observeHomeCompareSources,
  validateHomeCompareSourceRegistry,
  writeHomeCompareSourceManifest,
} from './lib/home_compare_source_smoke.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = path.join(root, 'public/data/home_compare_sources.v1.json');
const output = resolveOutput(process.argv.slice(2));
const registry = validateHomeCompareSourceRegistry(JSON.parse(await readFile(registryPath, 'utf8')));
const manifest = await observeHomeCompareSources(registry);
const result = await writeHomeCompareSourceManifest(manifest, output);

console.log(JSON.stringify({
  status: result.status,
  output: path.relative(root, result.outputPath).replaceAll('\\', '/'),
  manifestStatus: result.manifest.status,
  semanticIdentity: result.manifest.semanticIdentity,
  observations: result.manifest.observations.map(({ sourceId, status, rowCount, sourceAsOf, revision, missingFields, dq }) => ({
    sourceId, status, rowCount, sourceAsOf, revision, missingFields, dq,
  })),
  privacy: result.manifest.privacy,
  routing: result.manifest.routing,
}, null, 2));

function resolveOutput(args) {
  const raw = args.find((argument) => argument.startsWith('--output='))?.slice('--output='.length)
    || '.dfev1/home-neighborhood-compare/m3-v1/official-smoke/manifest.json';
  const target = path.resolve(root, raw);
  const admittedRoot = path.resolve(root, '.dfev1/home-neighborhood-compare/m3-v1');
  if (target !== admittedRoot && !target.startsWith(`${admittedRoot}${path.sep}`)) {
    throw new Error('Home Compare source smoke output must stay inside the task-owned ignored root.');
  }
  return target;
}
