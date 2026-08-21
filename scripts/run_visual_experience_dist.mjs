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
  let code = 1;
  const cleanupErrors = [];
  try {
    server = await createPreview({ preview: { ...VISUAL_PREVIEW, strictPort: true } });
    code = await run();
  } catch (error) {
    didPrimaryFail = true;
    primaryError = error;
  } finally {
    if (server?.close) {
      try { await server.close(); }
      catch (error) { cleanupErrors.push(error); }
    }
  }
  if (didPrimaryFail && cleanupErrors.length) {
    const error = new AggregateError([primaryError, ...cleanupErrors], 'Visual runner failed and preview cleanup failed.');
    error.primaryError = primaryError;
    error.cleanupErrors = cleanupErrors;
    throw error;
  }
  if (didPrimaryFail) throw primaryError;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Visual preview cleanup failed.');
  return code;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try { process.exitCode = await runVisualExperienceDist(); }
  catch (error) { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; }
}
