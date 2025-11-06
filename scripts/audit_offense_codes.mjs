#!/usr/bin/env node
// Audit distinct text_general_code values from the last 24 months.

import fs from 'node:fs/promises';
import path from 'node:path';

const CARTO = 'https://phl.carto.com/api/v2/sql';
const SQL = `SELECT DISTINCT TRIM(text_general_code) AS code
FROM incidents_part1_part2
WHERE dispatch_date_time >= DATE_TRUNC('month', NOW()) - INTERVAL '24 months'
ORDER BY 1`;

async function main() {
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const logPath = path.join('logs', `offense_codes_${ts}.log`);
  const jsonPath = path.join('logs', `offense_codes_${ts}.json`);
  await fs.mkdir('logs', { recursive: true });
  try {
    const res = await fetch(CARTO, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `q=${encodeURIComponent(SQL)}`,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const codes = (data?.rows || []).map((r) => r.code).filter(Boolean);
    await fs.writeFile(jsonPath, JSON.stringify({ codes }, null, 2));
    await fs.writeFile(logPath, `OK ${codes.length} codes saved to ${jsonPath}`);
    console.log(`Saved ${codes.length} codes to ${jsonPath}`);
  } catch (e) {
    await fs.writeFile(logPath, `FAIL: ${e?.message || e}`);
    console.error('Audit failed:', e?.message || e);
  }
}

main();

