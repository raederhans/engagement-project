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
  const matches = [...output.matchAll(expression)].map((match) => Number(match[1]));
  const listener = new RegExp(`^\\s*TCP\\s+[^\\s]*:${port}\\s+`, 'gmi');
  const listenerLines = [...output.matchAll(listener)].length;
  if (listenerLines !== matches.length || matches.some((pid) => !Number.isInteger(pid) || pid <= 0)) throw new Error(`Release listener ownership audit is unavailable for Windows port ${port}.`);
  return new Set(matches);
}

function linuxListeningPids(port, run = execFileSync) {
  // `ss -ltnpH` is present on the Ubuntu GitHub runner.  Read only the
  // listening sockets; the PID comparison below deliberately distinguishes
  // task-owned listeners from listeners which predate this release run.
  const output = run('ss', ['-ltnpH'], { encoding: 'utf8', windowsHide: true });
  const address = new RegExp(`(?:^|\\s)[^\\s]*:${port}(?:\\s|$)`);
  const listeners = output.split(/\r?\n/).filter((line) => address.test(line));
  const pids = listeners.flatMap((line) => [...line.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1])));
  if (listeners.length && (!pids.length || pids.some((pid) => !Number.isInteger(pid) || pid <= 0))) throw new Error(`Release listener ownership audit is unavailable for Linux port ${port}.`);
  return new Set(pids);
}

function listeningPids(platform, port, run) {
  if (platform === 'win32') return windowsListeningPids(port, run);
  if (platform === 'linux') return linuxListeningPids(port, run);
  throw new Error(`Release listener ownership audit is unavailable on ${platform}.`);
}

export function createReleasePortAudit({
  ports = RELEASE_AUDITED_PORTS,
  platform = process.platform,
  run = execFileSync,
} = {}) {
  const baseline = new Map(ports.map((port) => [port, listeningPids(platform, port, run)]));
  return {
    baseline,
    async verify() {
      const leaks = [];
      for (const port of ports) {
        const before = baseline.get(port);
        for (const pid of listeningPids(platform, port, run)) {
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
    child.once('error', (cause) => reject(createChildFailure('RELEASE_CHILD_SPAWN', command, args, { cause })));
    child.once('exit', (code, signal) => {
      if (signal) reject(createChildFailure('RELEASE_CHILD_SIGNAL', command, args, { signal }));
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
  let nonzeroStepError;
  let activeCommand;
  let activeArgs;
  let activeStep;
  try {
    for (const args of RELEASE_STEPS) {
      activeStep = args;
      activeCommand = process.execPath;
      activeArgs = args[0] === 'node' ? args.slice(1) : [npmExecPath, ...args];
      code = await execute(activeCommand, activeArgs, environment);
      if (code !== 0) {
        nonzeroStepError = createNonzeroStepError(activeCommand, activeArgs, activeStep, code);
        break;
      }
    }
  } catch (error) {
    bodyError = annotateChildFailure(error, activeCommand, activeArgs, activeStep);
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
  const primaryError = bodyError || nonzeroStepError;
  if (primaryError && cleanupErrors.length) {
    const error = new AggregateError([primaryError, ...cleanupErrors], 'Release gate failed and postcondition failed.');
    error.primaryError = primaryError;
    error.cleanupErrors = cleanupErrors;
    if (Number.isInteger(primaryError.exitCode) && primaryError.exitCode > 0) error.exitCode = primaryError.exitCode;
    throw error;
  }
  if (bodyError) throw bodyError;
  if (nonzeroStepError) throw nonzeroStepError;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Release gate postcondition failed.');
  return 0;
}

export function createNonzeroStepError(command, args, step, exitCode) {
  const error = new Error(`Release step ${step.join(' ')} exited with code ${exitCode}.`);
  error.code = 'RELEASE_STEP_NONZERO';
  error.command = command;
  error.args = [...args];
  error.step = [...step];
  error.exitCode = exitCode;
  return error;
}

function createChildFailure(code, command, args, { cause, signal } = {}) {
  const detail = signal ? `stopped by signal ${signal}` : `could not spawn: ${cause?.message || String(cause)}`;
  const error = new Error(`${command} ${args.join(' ')} ${detail}.`);
  error.code = code;
  error.command = command;
  error.args = [...args];
  if (signal) error.signal = signal;
  if (cause) error.cause = cause;
  return error;
}

function annotateChildFailure(error, command, args, step) {
  const failure = error instanceof Error ? error : Object.assign(new Error(String(error)), { cause: error });
  failure.code ||= 'RELEASE_CHILD_FAILURE';
  failure.command ||= command;
  failure.args ||= Array.isArray(args) ? [...args] : [];
  failure.step ||= Array.isArray(step) ? [...step] : step;
  return failure;
}

export function formatReleaseFailure(error) {
  if (error instanceof AggregateError) return [error.message, ...error.errors.map(formatReleaseFailure)].join('\n');
  if (!(error instanceof Error)) return String(error);
  const details = [
    error.code && `code=${error.code}`,
    error.command && `command=${error.command}`,
    Array.isArray(error.args) && `argv=${JSON.stringify(error.args)}`,
    (Array.isArray(error.step) ? error.step.join(' ') : error.step) && `step=${Array.isArray(error.step) ? error.step.join(' ') : error.step}`,
    error.exitCode != null && `exitCode=${error.exitCode}`,
    error.signal && `signal=${error.signal}`,
  ].filter(Boolean);
  return details.length ? `${error.message}\n${details.join(' | ')}` : error.message;
}

export async function runReleaseCli({ gate = runReleaseGate, write = (message) => console.error(message) } = {}) {
  try {
    return { exitCode: await gate(), output: null };
  } catch (error) {
    const output = formatReleaseFailure(error);
    write(output);
    return { exitCode: Number.isInteger(error.exitCode) && error.exitCode > 0 ? error.exitCode : 1, output };
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  process.exitCode = (await runReleaseCli()).exitCode;
}
