#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildHomeCompareCitywideJoinDq,
  loadHomeCompareCitywideJoinDqInput,
  writeHomeCompareCitywideJoinDq,
} from './lib/home_compare_citywide_join_dq.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArguments(argv);
  const load = dependencies.loadHomeCompareCitywideJoinDqInput ?? loadHomeCompareCitywideJoinDqInput;
  const build = dependencies.buildHomeCompareCitywideJoinDq ?? buildHomeCompareCitywideJoinDq;
  const write = dependencies.writeHomeCompareCitywideJoinDq ?? writeHomeCompareCitywideJoinDq;
  const input = await load({
    lifecyclePath: resolveInput(options.lifecycle),
    expectedLifecycleIdentity: options['lifecycle-identity'],
    expectedLifecycleSha256: options['lifecycle-sha256'],
    ...dependencies.inputDependencies,
  });
  const ledger = build(input);
  const written = await write(options.output, ledger, { workspace });
  return Object.freeze({ ...written, ledger });
}

function parseArguments(argv) {
  const required = ['lifecycle', 'lifecycle-identity', 'lifecycle-sha256', 'output'];
  const options = {};
  for (const argument of argv) {
    const match = String(argument).match(/^--([a-z0-9-]+)=(.+)$/);
    if (!match || !required.includes(match[1]) || Object.hasOwn(options, match[1])) {
      throw new Error(`Unsupported or duplicate Home Compare citywide join DQ argument: ${argument}`);
    }
    options[match[1]] = match[2];
  }
  const missing = required.filter((name) => !options[name]);
  if (missing.length) throw new Error(`Missing Home Compare citywide join DQ arguments: ${missing.join(', ')}`);
  return options;
}

function resolveInput(value) { return path.resolve(workspace, value); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(({ status, outputPath, ledger }) => {
    console.log(JSON.stringify({
      status, output: path.relative(workspace, outputPath).replaceAll('\\', '/'),
      schema: ledger.schema, identity: ledger.identity, join_status: ledger.status,
      dimensions: ledger.dimensions.map(({ dimension, source_readiness, join_status, admission_status, identity }) => ({ dimension, source_readiness, join_status, admission_status, identity })),
      authority: ledger.authority,
    }, null, 2));
  }).catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
}
