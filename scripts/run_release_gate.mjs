#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { sanitizeNpmEnvironment } from './run_npm_audit.mjs';

const RELEASE_STEPS = Object.freeze([
  ['audit', '--audit-level=high'],
  ['run', 'lint:js'],
  ['run', 'lint:css'],
  ['run', 'ci:core'],
  ['run', 'test:browser-smoke'],
  ['run', 'test:acs-multitract-browser'],
  ['run', 'test:visual-experience:dist'],
]);

export function createReleaseEnvironment(environment = process.env) {
  return {
    ...sanitizeNpmEnvironment(environment),
    VITE_FEATURE_DIARY: '1',
    VITE_TRACT_CRIME_SNAPSHOT: '1',
  };
}

function runNpm(npmExecPath, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmExecPath, ...args], {
      env: environment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`npm ${args.join(' ')} stopped by signal ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

async function runReleaseGate() {
  const environment = createReleaseEnvironment();
  const npmExecPath = environment.npm_execpath;
  if (!npmExecPath) {
    throw new Error('npm_execpath is required; run this command through npm.');
  }

  for (const args of RELEASE_STEPS) {
    const code = await runNpm(npmExecPath, args, environment);
    if (code !== 0) return code;
  }
  return 0;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    process.exitCode = await runReleaseGate();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
