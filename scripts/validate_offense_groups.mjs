#!/usr/bin/env node
// Minimal validator for offense_groups.json shape: Object<string, string[]>

import fs from 'node:fs/promises';
import path from 'node:path';

const SRC = path.join('src', 'data', 'offense_groups.json');

async function main() {
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const logPath = path.join('logs', `validate_offense_${ts}.log`);
  await fs.mkdir('logs', { recursive: true });
  try {
    const raw = await fs.readFile(SRC, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('root not object');
    for (const [k, v] of Object.entries(obj)) {
      if (!Array.isArray(v)) throw new Error(`value for ${k} not array`);
      for (const x of v) if (typeof x !== 'string') throw new Error(`non-string in ${k}`);
    }
    await fs.writeFile(logPath, 'OK offense_groups.json is valid');
    console.log('Validation OK');
  } catch (e) {
    await fs.writeFile(logPath, `FAIL: ${e?.message || e}`);
    console.error('Validation failed:', e?.message || e);
  }
}

main();

