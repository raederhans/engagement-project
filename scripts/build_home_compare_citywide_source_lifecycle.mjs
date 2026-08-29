#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildHomeCompareCitywideSourceLifecycle,
  loadHomeCompareCitywideLifecycleInputs,
  writeHomeCompareCitywideSourceLifecycle,
} from './lib/home_compare_citywide_source_lifecycle.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArguments(argv);
  const inputs = await loadHomeCompareCitywideLifecycleInputs({
    registryPath: resolveInput(options.registry),
    observationPath: resolveInput(options.observation),
    m1Root: resolveInput(options['m1-root']),
    m1ReceiptPath: resolveInput(options['m1-receipt']),
    hinSnapshotPath: resolveInput(options['hin-snapshot']),
    hinReceiptPath: resolveInput(options['hin-receipt']),
    validationClock: options['validation-clock'],
    expectedObservationIdentity: options['observation-identity'],
    ...dependencies,
  });
  const lifecycle = buildHomeCompareCitywideSourceLifecycle(inputs);
  const written = await writeHomeCompareCitywideSourceLifecycle(options.output, lifecycle, { workspace });
  return Object.freeze({ ...written, lifecycle });
}

function parseArguments(argv) {
  const required = [
    'registry',
    'observation',
    'm1-root',
    'm1-receipt',
    'hin-snapshot',
    'hin-receipt',
    'validation-clock',
    'observation-identity',
    'output',
  ];
  const options = {};
  for (const argument of argv) {
    const match = String(argument).match(/^--([a-z0-9-]+)=(.+)$/);
    if (!match || !required.includes(match[1]) || Object.hasOwn(options, match[1])) {
      throw new Error(`Unsupported or duplicate Home Compare lifecycle argument: ${argument}`);
    }
    options[match[1]] = match[2];
  }
  const missing = required.filter((name) => !options[name]);
  if (missing.length) throw new Error(`Missing Home Compare lifecycle arguments: ${missing.join(', ')}`);
  return options;
}

function resolveInput(value) {
  return path.resolve(workspace, value);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(({ status, outputPath, lifecycle }) => {
    console.log(JSON.stringify({
      status,
      output: path.relative(workspace, outputPath).replaceAll('\\', '/'),
      schema: lifecycle.schema,
      identity: lifecycle.identity,
      lifecycle_status: lifecycle.status,
      sources: lifecycle.receipts.map((receipt) => ({
        source_id: receipt.source_id,
        status: receipt.status,
        evidence_kind: receipt.evidence_kind,
        semantic_identity: receipt.semantic_identity,
        receipt_identity: receipt.receipt_identity,
      })),
      authority: lifecycle.authority,
    }, null, 2));
  }).catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
