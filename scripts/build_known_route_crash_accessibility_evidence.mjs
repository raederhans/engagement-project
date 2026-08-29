#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  loadKnownRouteCrashAccessibilityInput,
  writeKnownRouteCrashAccessibilityEvidence,
} from './lib/known_route_crash_accessibility_evidence.mjs';

const OPTIONS = Object.freeze({
  '--input': 'inputPath',
  '--expected-input-sha256': 'expectedInputSha256',
  '--output': 'outputPath',
  '--workspace': 'workspace',
});
const REQUIRED = Object.freeze(['inputPath', 'expectedInputSha256', 'outputPath']);

export class KnownRouteEvidenceCliArgumentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KnownRouteEvidenceCliArgumentError';
    this.code = 'KNOWN_ROUTE_CRASH_ACCESSIBILITY_INVALID_ARGUMENT';
  }
}

export function parseArguments(argv = []) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const equals = token.indexOf('=');
    const option = equals === -1 ? token : token.slice(0, equals);
    const key = OPTIONS[option];
    if (!key) throw new KnownRouteEvidenceCliArgumentError(`Unknown option: ${option}`);
    if (Object.hasOwn(values, key)) {
      throw new KnownRouteEvidenceCliArgumentError(`Duplicate option: ${option}`);
    }
    const value = equals === -1 ? argv[index += 1] : token.slice(equals + 1);
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
      throw new KnownRouteEvidenceCliArgumentError(`Option requires a value: ${option}`);
    }
    values[key] = value;
  }
  const missing = REQUIRED.filter((key) => !Object.hasOwn(values, key));
  if (missing.length > 0) {
    throw new KnownRouteEvidenceCliArgumentError(`Missing required options: ${missing.join(', ')}`);
  }
  return values;
}

export async function main(argv = process.argv.slice(2), runtime = {}) {
  const stdout = runtime.stdout || process.stdout;
  const stderr = runtime.stderr || process.stderr;
  const load = runtime.load || loadKnownRouteCrashAccessibilityInput;
  const write = runtime.write || writeKnownRouteCrashAccessibilityEvidence;
  try {
    const options = parseArguments(argv);
    const loaded = await load(options.inputPath, options.expectedInputSha256);
    const publication = await write(options.outputPath, loaded.evidence, {
      workspace: options.workspace || process.cwd(),
    });
    const result = Object.freeze({
      status: publication.status,
      output_path: publication.output_path,
      semantic_identity: loaded.evidence.semantic_identity,
      input_sha256: loaded.input_sha256,
    });
    stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  } catch (error) {
    const argument = error instanceof KnownRouteEvidenceCliArgumentError;
    stderr.write(`${JSON.stringify({
      status: 'error',
      error: {
        code: argument
          ? 'KNOWN_ROUTE_CRASH_ACCESSIBILITY_INVALID_ARGUMENT'
          : 'KNOWN_ROUTE_CRASH_ACCESSIBILITY_BUILD_FAILED',
        message: argument ? error.message : 'Known Route crash/accessibility evidence build failed.',
      },
    })}\n`);
    if (runtime.rethrow === false) return null;
    throw error;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch(() => {
    process.exitCode = 1;
  });
}
