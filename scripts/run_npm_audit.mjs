#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function sanitizeNpmEnvironment(environment = process.env) {
  return Object.fromEntries(Object.entries(environment)
    .filter(([key]) => key.toLowerCase() !== 'npm_config_allow_scripts'));
}

async function runAudit() {
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) {
    throw new Error('npm_execpath is required; run this command through npm.');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [npmExecPath, 'audit', '--audit-level=high'],
      {
        env: sanitizeNpmEnvironment(),
        stdio: 'inherit',
      },
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`npm audit stopped by signal ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    process.exitCode = await runAudit();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
