#!/usr/bin/env node
// Precompute last-12-months crime counts by tract using CARTO SQL API (POST), concurrency=3.

import fs from 'node:fs/promises';
import path from 'node:path';

const CARTO = 'https://phl.carto.com/api/v2/sql';
const OUT = path.join('src', 'data', 'tract_counts_last12m.json');
const TRACTS = path.join('public', 'data', 'tracts_phl.geojson');
const LOG_DIR = 'logs';
const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
const LOG = path.join(LOG_DIR, `precompute_tract_counts_${ts}.log`);

async function log(line) { await fs.mkdir(LOG_DIR, { recursive: true }); await fs.appendFile(LOG, `[${new Date().toISOString()}] ${line}\n`); }

async function ensureTracts() {
  try { await fs.access(TRACTS); return; } catch {}
  await log('Tracts cache missing; invoking scripts/fetch_tracts.mjs');
  const { spawn } = await import('node:child_process');
  await new Promise((resolve) => {
    const p = spawn(process.execPath, ['scripts/fetch_tracts.mjs'], { stdio: 'inherit' });
    p.on('close', () => resolve());
  });
}

function roundGeom(g) {
  const r6 = (n) => Math.round(n * 1e6) / 1e6;
  function roundCoords(coords) { return coords.map((c) => Array.isArray(c[0]) ? roundCoords(c) : [r6(c[0]), r6(c[1])]); }
  if (g.type === 'Polygon') return { type: 'Polygon', coordinates: roundCoords(g.coordinates) };
  if (g.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: g.coordinates.map((poly) => roundCoords(poly)) };
  return g;
}

function toSQL(geom, start, end) {
  const gj = JSON.stringify(geom).replace(/'/g, "''");
  return `WITH poly AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON('${gj}'), 4326) AS g)
SELECT COUNT(*)::int AS n
FROM incidents_part1_part2
WHERE dispatch_date_time >= '2015-01-01'
  AND dispatch_date_time >= '${start}'
  AND dispatch_date_time <  '${end}'
  AND ST_Intersects(the_geom, ST_Transform((SELECT g FROM poly), 3857))`;
}

async function postSQL(sql, { retries = 3, timeoutMs = 20000 } = {}) {
  for (let i = 0; i < retries; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(CARTO, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `q=${encodeURIComponent(sql)}`, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      clearTimeout(timer);
      const n = Number(json?.rows?.[0]?.n) || 0;
      return n;
    } catch (e) {
      clearTimeout(timer);
      const last = i === retries - 1;
      await log(`postSQL attempt ${i + 1} failed: ${e?.message || e}`);
      if (last) throw e;
      const backoff = [1000, 2000, 4000][Math.min(i, 2)];
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

async function main() {
  await ensureTracts();
  let gj;
  try { gj = JSON.parse(await fs.readFile(TRACTS, 'utf8')); }
  catch (e) { await log(`Failed to read tracts: ${e?.message || e}`); console.error('STOP: tracts not available'); return; }

  const endD = new Date(); endD.setHours(0,0,0,0); // floor to day; end exclusive next day
  const startD = new Date(endD); startD.setMonth(startD.getMonth() - 12);
  const end = new Date(endD.getTime() + 24*3600*1000).toISOString().slice(0,10);
  const start = startD.toISOString().slice(0,10);

  const out = { meta: { start, end, updatedAt: new Date().toISOString() }, rows: [] };
  const seen = new Set();
  try {
    const prev = JSON.parse(await fs.readFile(OUT, 'utf8'));
    for (const r of prev?.rows || []) seen.add(r.geoid);
    out.rows.push(...(prev?.rows || []));
  } catch {}

  // concurrency queue
  const tasks = (gj.features || []).map((ft) => ({ ft }));
  let i = 0; let done = 0;
  const workers = Array.from({ length: 3 }, () => (async function work(){
    while (true) {
      const idx = i++; if (idx >= tasks.length) break;
      const ft = tasks[idx].ft;
      const p = ft.properties || {};
      const geoid = String(p.STATE_FIPS ?? p.STATE ?? '') + String(p.COUNTY_FIPS ?? p.COUNTY ?? '') + String(p.TRACT_FIPS ?? p.TRACT ?? '').padStart(6,'0');
      if (!geoid || seen.has(geoid)) { done++; continue; }
      const geom = roundGeom(ft.geometry);
      const sql = toSQL(geom, start, end);
      try {
        const n = await postSQL(sql);
        out.rows.push({ geoid, n });
        await log(`OK ${geoid} => ${n}`);
      } catch (e) {
        await log(`FAIL ${geoid}: ${e?.message || e}`);
      }
      done++;
      if (done % 20 === 0) { await fs.mkdir(path.dirname(OUT), { recursive: true }); await fs.writeFile(OUT, JSON.stringify(out)); }
    }
  })());

  await Promise.all(workers);
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out));
  await log(`DONE rows=${out.rows.length}, window=[${start}, ${end}) saved to ${OUT}`);
  console.log(`Saved ${OUT}`);
}

main();

