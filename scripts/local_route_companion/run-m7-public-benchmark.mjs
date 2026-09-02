#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { admitCorpus, admitManifest, admitPolicy } from './validation/contracts.mjs';
import { runPublicBenchmark } from './validation/runner.mjs';

const fixtureRoot = new URL('../fixtures/mainline-m7-validation/', import.meta.url);
const outputRoot = new URL('../../output/mainline-m7-validation/', import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(name, fixtureRoot), 'utf8'));
const RUN_ID = /^[a-z0-9](?:[a-z0-9._-]{0,119})$/;
const OUTPUT_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,119})\.json$/;

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=') || true];
  }));
  const allowedArgs = new Set(['run-id', 'output']);
  if (Object.keys(args).some((key) => !allowedArgs.has(key))) {
    throw new Error('custom runtime modules are not admitted by the benchmark preflight command');
  }
  const runId = String(args['run-id'] || 'm7-public-local-preflight');
  if (!RUN_ID.test(runId)) throw new Error('run-id must be a bounded canonical id');
  const corpus = admitCorpus(await load('public-od-corpus.v1.json'));
  const policy = admitPolicy(await load('validation-policy.v1.json'));
  const manifest = admitManifest(await load('manifest.v1.json'), corpus, policy);
  const receipt = await runPublicBenchmark({ corpus, policy, manifest, runId });
  const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
  if (!args.output) {
    process.stdout.write(bytes);
    return;
  }
  const outputName = String(args.output);
  if (!OUTPUT_NAME.test(outputName)) {
    throw new Error('output must be a JSON filename within the fixed local benchmark output directory');
  }
  await mkdir(outputRoot, { recursive: true });
  await writeFile(fileURLToPath(new URL(outputName, outputRoot)), bytes, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
