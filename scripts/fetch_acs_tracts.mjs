#!/usr/bin/env node
// Fetch ACS 2023 5-year stats for Philadelphia County and cache to src/data.

import fs from 'node:fs/promises';
import path from 'node:path';

const URL_POP_TENURE_INCOME = 'https://api.census.gov/data/2023/acs/acs5?get=NAME,B01003_001E,B25003_001E,B25003_003E,B19013_001E&for=tract:*&in=state:42%20county:101';
const URL_POVERTY = 'https://api.census.gov/data/2023/acs/acs5/subject?get=NAME,S1701_C03_001E&for=tract:*&in=state:42%20county:101';
const OUT_PATH = path.join('src', 'data', 'acs_tracts_2023_pa101.json');

const delays = [2000, 4000, 8000];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function toNumber(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function toGEOID(state, county, tract6) { return `${state}${county}${String(tract6).padStart(6, '0')}`; }

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function attempt() {
  const popRows = await fetchJson(URL_POP_TENURE_INCOME);
  const povRows = await fetchJson(URL_POVERTY);

  if (!Array.isArray(popRows) || popRows.length < 2) throw new Error('Invalid ACS pop/tenure/income response');

  const [popHeader, ...popData] = popRows;
  const [povHeader, ...povData] = Array.isArray(povRows) ? povRows : [[], []];

  const popIdx = Object.fromEntries(popHeader.map((k, i) => [k, i]));
  const povIdx = Object.fromEntries(povHeader.map((k, i) => [k, i]));

  const povMap = new Map();
  for (const row of povData) {
    const geoid = toGEOID(row[povIdx.state], row[povIdx.county], row[povIdx.tract]);
    const poverty = toNumber(row[povIdx['S1701_C03_001E']]);
    povMap.set(geoid, poverty);
  }

  const out = [];
  for (const row of popData) {
    const geoid = toGEOID(row[popIdx.state], row[popIdx.county], row[popIdx.tract]);
    out.push({
      geoid,
      pop: toNumber(row[popIdx['B01003_001E']]) ?? 0,
      hh_total: toNumber(row[popIdx['B25003_001E']]),
      renter_total: toNumber(row[popIdx['B25003_003E']]),
      median_income: toNumber(row[popIdx['B19013_001E']]),
      poverty_pct: povMap.get(geoid) ?? null,
    });
  }

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out));
  console.log(`Saved ${OUT_PATH} (${out.length} rows)`);
}

async function main() {
  for (let i = 0; i < delays.length; i++) {
    try {
      await attempt();
      return;
    } catch (e) {
      const last = i === delays.length - 1;
      console.warn(`Attempt ${i + 1} failed: ${e?.message || e}`);
      if (last) {
        console.warn('WARN: ACS fetch exhausted. Runtime will fallback to live endpoints.');
        return;
      }
      await sleep(delays[i]);
    }
  }
}

main();

