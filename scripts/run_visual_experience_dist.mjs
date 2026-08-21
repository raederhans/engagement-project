#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { preview } from 'vite';

export const VISUAL_PREVIEW = Object.freeze({ host: '127.0.0.1', port: 4178 });

export function runPlaywright({ spawnChild = spawn, environment = process.env } = {}) {
  const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
  const baseUrl = `http://${VISUAL_PREVIEW.host}:${VISUAL_PREVIEW.port}/`;
  return new Promise((resolve, reject) => {
    const child = spawnChild(process.execPath, [cli, 'test', '--config=playwright.config.mjs'], {
      env: { ...environment, PLAYWRIGHT_BASE_URL: baseUrl }, stdio: 'inherit', windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => signal
      ? reject(new Error(`visual Playwright stopped by signal ${signal}`))
      : resolve(code ?? 1));
  });
}

export async function runVisualExperienceDist({ createPreview = preview, run = runPlaywright } = {}) {
  let server = null;
  let didPrimaryFail = false;
  let primaryError;
  let nonzeroRunError;
  let code = 1;
  const cleanupErrors = [];
  try {
    server = await createPreview({ preview: { ...VISUAL_PREVIEW, strictPort: true } });
    code = await run();
    if (code !== 0) nonzeroRunError = createVisualNonzeroError(code);
  } catch (error) {
    didPrimaryFail = true;
    primaryError = error;
  } finally {
    if (server?.close) {
      try { await server.close(); }
      catch (error) { cleanupErrors.push(error); }
    }
  }
  const primaryFailure = didPrimaryFail ? primaryError : nonzeroRunError;
  if (primaryFailure && cleanupErrors.length) {
    const error = new AggregateError([primaryFailure, ...cleanupErrors], 'Visual runner failed and preview cleanup failed.');
    error.primaryError = primaryFailure;
    error.cleanupErrors = cleanupErrors;
    throw error;
  }
  if (didPrimaryFail) throw primaryError;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Visual preview cleanup failed.');
  return code;
}

export function createVisualNonzeroError(exitCode) {
  const error = new Error(`Visual Playwright step exited with code ${exitCode}.`);
  error.code = 'VISUAL_PLAYWRIGHT_NONZERO';
  error.step = 'playwright test --config=playwright.config.mjs';
  error.command = process.execPath;
  error.args = [fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url)), 'test', '--config=playwright.config.mjs'];
  error.exitCode = exitCode;
  return error;
}

export function formatVisualFailure(error) {
  if (error instanceof AggregateError) return [error.message, ...error.errors.map(formatVisualFailure)].join('\n');
  if (!(error instanceof Error)) return String(error);
  const details = [
    error.code && `code=${error.code}`,
    error.command && `command=${error.command}`,
    Array.isArray(error.args) && `argv=${JSON.stringify(error.args)}`,
    error.step && `step=${error.step}`,
    error.exitCode != null && `exitCode=${error.exitCode}`,
  ].filter(Boolean);
  return details.length ? `${error.message}\n${details.join(' | ')}` : error.message;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try { process.exitCode = await runVisualExperienceDist(); }
  catch (error) { console.error(formatVisualFailure(error)); process.exitCode = 1; }
}
