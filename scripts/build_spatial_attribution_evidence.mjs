#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { runSpatialAttributionEvidence } from './lib/spatial_attribution_runner.mjs';

const OPTIONS = Object.freeze({
  '--warehouse-root': 'warehouseRoot',
  '--mart-root': 'martRoot',
  '--output-root': 'outputRoot',
  '--protocol': 'protocolPath',
  '--evaluation-protocol': 'evaluationProtocolPath',
});

const CLI_ARGUMENT_ERROR = 'SPATIAL_ATTRIBUTION_INVALID_ARGUMENT';
const CLI_BUILD_ERROR = 'SPATIAL_ATTRIBUTION_BUILD_FAILED';

class SpatialAttributionCliArgumentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SpatialAttributionCliArgumentError';
    this.code = CLI_ARGUMENT_ERROR;
  }
}

export function parseArguments(argv = []) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const equals = token.indexOf('=');
    const option = equals === -1 ? token : token.slice(0, equals);
    const key = OPTIONS[option];
    if (!key) throw new SpatialAttributionCliArgumentError(`Unknown spatial attribution option: ${option}`);
    if (Object.hasOwn(values, key)) {
      throw new SpatialAttributionCliArgumentError(`Duplicate spatial attribution option: ${option}`);
    }
    const value = equals === -1 ? argv[index += 1] : token.slice(equals + 1);
    if (typeof value !== 'string' || value === '' || value.startsWith('--')) {
      throw new SpatialAttributionCliArgumentError(`Spatial attribution option requires a value: ${option}`);
    }
    values[key] = value;
  }
  const missing = Object.values(OPTIONS).filter((key) => !Object.hasOwn(values, key));
  if (missing.length > 0) {
    throw new SpatialAttributionCliArgumentError(
      `Missing required spatial attribution options: ${missing.join(', ')}`,
    );
  }
  return values;
}

export async function main(argv = process.argv.slice(2), runtime = {}) {
  const stdout = runtime.stdout || process.stdout;
  const stderr = runtime.stderr || process.stderr;
  const run = runtime.run || runSpatialAttributionEvidence;
  try {
    const result = await run(parseArguments(argv), runtime.runnerRuntime || {});
    stdout.write(`${JSON.stringify({
      status: 'complete',
      output_root: result.outputRoot,
      bundle_identity: result.manifest.bundle_identity,
    })}\n`);
    return result;
  } catch (error) {
    stderr.write(`${JSON.stringify(renderCliError(error))}\n`);
    if (runtime.rethrow === false) return null;
    throw error;
  }
}

export function renderCliError(error) {
  const isArgumentError = error?.code === CLI_ARGUMENT_ERROR
    && error instanceof SpatialAttributionCliArgumentError;
  return {
    status: 'error',
    error: {
      code: isArgumentError ? CLI_ARGUMENT_ERROR : CLI_BUILD_ERROR,
      message: isArgumentError
        ? error.message
        : 'Spatial attribution evidence build failed.',
    },
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch(() => {
    process.exitCode = 1;
  });
}
