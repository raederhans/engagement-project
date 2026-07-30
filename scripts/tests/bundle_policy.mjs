#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'dist', '.vite', 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const entry = Object.values(manifest).find((record) => record.isEntry);

assert.ok(entry, 'Vite manifest must contain an application entry');
assert.ok(
  entry.dynamicImports?.includes('src/routes_crime/index.js'),
  'Crime dashboard must remain behind the lazy route boundary',
);
assert.ok(
  Object.values(manifest).some((record) => record.dynamicImports?.includes('src/charts/index.js')),
  'Chart.js must remain behind the lazy charts boundary',
);
assert.ok(
  entry.dynamicImports?.includes('src/routes_diary/index.js'),
  'Diary mode must remain behind the lazy route boundary',
);
assert.ok(
  !Object.keys(manifest).some((key) => key.includes('__vite-browser-external')),
  'Browser bundles must not contain the Node filesystem compatibility shim',
);

const entrySize = (await stat(path.join(root, 'dist', entry.file))).size;
assert.ok(
  entrySize < 950_000,
  `Initial entry must stay below 950 kB; received ${entrySize} bytes`,
);

console.log(`[Bundle Policy] PASS — entry ${entry.file} is ${entrySize} bytes.`);
