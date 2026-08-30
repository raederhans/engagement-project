#!/usr/bin/env node
import {
  loadArtifactRegistryContract,
  materializeBundleFromFilesystem,
  writeMaterializedBundleDirectory,
} from './lib/data_foundation_artifact_bundle/index.mjs';

const options = Object.fromEntries(process.argv.slice(2).map((entry) => {
  const match = /^--([^=]+)=(.+)$/.exec(entry);
  if (!match) throw new Error(`Expected --name=value argument, received: ${entry}`);
  return [match[1], match[2]];
}));
for (const required of [
  'm1-root',
  'mart-root',
  'evaluation-root',
  'protocol',
  'output-dir',
  'observed-at',
  'm1-artifact-base',
  'm2-artifact-base',
]) {
  if (!options[required]) throw new Error(`Missing --${required}=...`);
}
const registryContract = await loadArtifactRegistryContract(options['registry-module']);
const bundle = await materializeBundleFromFilesystem({
  registryContract,
  m1Root: options['m1-root'],
  martRoot: options['mart-root'],
  evaluationRoot: options['evaluation-root'],
  protocolPath: options.protocol,
  createdAt: options['observed-at'],
  m1Locations: [{ scheme: 'file', basePath: options['m1-artifact-base'] }],
  m2Locations: [{ scheme: 'file', basePath: options['m2-artifact-base'] }],
});
const output = await writeMaterializedBundleDirectory({
  outputDir: options['output-dir'],
  bundle,
  registryContract,
});
process.stdout.write(`${JSON.stringify({ protocol: bundle.protocol, bundleId: bundle.bundleId, ...output })}\n`);
