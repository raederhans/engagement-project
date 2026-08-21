#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { preview } from 'vite';

const host = '127.0.0.1';
const port = 4178;
const baseUrl = `http://${host}:${port}/`;

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.httpServer.close((error) => (error ? reject(error) : resolve()));
  });
}

function runPlaywright() {
  const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'test', '--config=playwright.config.mjs'], {
      env: { ...process.env, PLAYWRIGHT_BASE_URL: baseUrl },
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`visual Playwright stopped by signal ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

const server = await preview({ preview: { host, port, strictPort: true } });
try {
  process.exitCode = await runPlaywright();
} finally {
  await closeServer(server);
}
