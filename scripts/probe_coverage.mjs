#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchCoverage } from '../src/api/meta.js';

const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
const logPath = path.join('logs', `coverage_probe_${ts}.log`);

async function main(){
  await fs.mkdir('logs', { recursive: true });
  try {
    const cov = await fetchCoverage({ ttlMs: 0 });
    await fs.writeFile(logPath, `min=${cov.min} max=${cov.max}`);
    console.log(`Coverage: ${cov.min}..${cov.max}`);
  } catch (e) {
    await fs.writeFile(logPath, `FAIL: ${e?.message || e}`);
    console.error('Coverage probe failed:', e?.message || e);
  }
}

main();

