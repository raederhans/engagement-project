#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { sanitizeNpmEnvironment } from './run_npm_audit.mjs';

export const RELEASE_STEPS = Object.freeze([
  ['audit', '--audit-level=high'],
  ['run', 'lint:js'],
  ['run', 'lint:css'],
  ['run', 'ci:core'],
  ['run', 'test:browser-smoke'],
  ['run', 'test:acs-multitract-browser'],
  ['run', 'test:area-intelligence-browser'],
  ['run', 'test:home-compare-browser'],
  ['run', 'test:known-route-evidence-browser'],
  ['node', 'scripts/run_visual_experience_dist.mjs'],
]);

export const RELEASE_AUDITED_PORTS = Object.freeze([4173, 4178, 4189, 4194, 4198]);

function windowsListeningPids(port, run = execFileSync) {
  const output = run('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
  const expression = new RegExp(`^\\s*TCP\\s+[^\\s]*:${port}\\s+[^\\s]+\\s+LISTENING\\s+(\\d+)\\s*$`, 'gmi');
  return new Set([...output.matchAll(expression)].map((match) => Number(match[1])));
}

export function createReleasePortAudit({
  ports = RELEASE_AUDITED_PORTS,
  platform = process.platform,
  run = execFileSync,
} = {}) {
  const baseline = new Map(ports.map((port) => [port, platform === 'win32' ? windowsListeningPids(port, run) : new Set()]));
  return {
    baseline,
    async verify() {
      if (platform !== 'win32') return;
      const leaks = [];
      for (const port of ports) {
        const before = baseline.get(port);
        for (const pid of windowsListeningPids(port, run)) {
          if (!before.has(pid)) leaks.push({ port, pid });
        }
      }
      if (leaks.length) {
        const error = new Error(`Release gate left task-owned preview listener(s): ${leaks.map(({ port, pid }) => `${port}/${pid}`).join(', ')}`);
        error.leaks = leaks;
        throw error;
      }
    },
  };
}

export function createReleaseEnvironment(environment = process.env) {
  return {
    ...sanitizeNpmEnvironment(environment),
    VITE_FEATURE_DIARY: '1',
    VITE_TRACT_CRIME_SNAPSHOT: '1',
  };
}

export function runCommand(command, args, environment, { spawnChild = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnChild(command, args, {
      env: environment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} ${args.join(' ')} stopped by signal ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

export async function runReleaseGate({
  environment = createReleaseEnvironment(),
  execute = (command, args, env) => runCommand(command, args, env),
  taskOwnershipAudit = createReleasePortAudit(),
  postcondition = async () => {},
} = {}) {
  const npmExecPath = environment.npm_execpath;
  if (!npmExecPath) {
    throw new Error('npm_execpath is required; run this command through npm.');
  }

  let code = 1;
  let bodyError;
  try {
    for (const args of RELEASE_STEPS) {
      code = args[0] === 'node'
        ? await execute(process.execPath, args.slice(1), environment)
        : await execute(process.execPath, [npmExecPath, ...args], environment);
      if (code !== 0) break;
    }
  } catch (error) {
    bodyError = error;
  }
  const cleanupErrors = [];
  for (const cleanup of [
    () => taskOwnershipAudit.verify(),
    () => postcondition(),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (bodyError && cleanupErrors.length) {
    const error = new AggregateError([bodyError, ...cleanupErrors], 'Release gate failed and postcondition failed.');
    error.primaryError = bodyError;
    error.cleanupErrors = cleanupErrors;
    throw error;
  }
  if (bodyError) throw bodyError;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Release gate postcondition failed.');
  return code;
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
