#!/usr/bin/env node
// Robust tracts GeoJSON fetch with multi-endpoint fallback and normalization.

import fs from 'node:fs/promises';
import path from 'node:path';

const ENDPOINTS = [
  // PASDA - Philadelphia Census Tracts 2020 (preferred - stable, full coverage)
  "https://mapservices.pasda.psu.edu/server/rest/services/pasda/CityPhilly/MapServer/28/query?where=1%3D1&outFields=*&f=geojson",
  // TIGERweb Tracts_Blocks - 2025 vintage (federal, always current)
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query?where=STATE%3D%2742%27%20AND%20COUNTY%3D%27101%27&outFields=STATE,COUNTY,GEOID,NAME,BASENAME,ALAND,AWATER&returnGeometry=true&f=geojson",
  // OpenDataPhilly fallback (city-managed GeoJSON - requires landing page parsing, skip for now)
  // "https://opendataphilly.org/datasets/census-tracts/"  // Landing page only; actual GeoJSON URL changes
];

const OUT_DIR = path.join('public', 'data');
const OUT_FILE = path.join(OUT_DIR, 'tracts_phl.geojson');

const delays = [2000, 4000, 8000];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function fetchJson(url) { const r = await fetch(url, { headers: { accept: 'application/geo+json,application/json' } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }

function validFeature(f) {
  if (!f || !f.geometry || !f.properties) return false;
  const p = f.properties;
  // Require GEOID or components to derive it
  return (
    p.GEOID || (
      (p.STATE_FIPS || p.STATE || p.STATEFP) &&
      (p.COUNTY_FIPS || p.COUNTY || p.COUNTYFP) &&
      (p.TRACT_FIPS || p.TRACT || p.TRACTCE || p.NAME)
    )
  );
}

function normalizeFeature(f) {
  const p = { ...(f.properties || {}) };

  // Extract components (handle various field names)
  const state = p.STATE_FIPS ?? p.STATE ?? p.STATEFP ?? '42';
  const county = p.COUNTY_FIPS ?? p.COUNTY ?? p.COUNTYFP ?? '101';
  const tract = p.TRACT_FIPS ?? p.TRACT ?? p.TRACTCE ?? null;

  // Derive GEOID (11-digit: STATE(2) + COUNTY(3) + TRACT(6))
  let geoid = p.GEOID ?? null;
  if (!geoid && state && county && tract) {
    const statePad = String(state).padStart(2, '0');
    const countyPad = String(county).padStart(3, '0');
    const tractPad = String(tract).padStart(6, '0');
    geoid = `${statePad}${countyPad}${tractPad}`;
  }

  const props = {
    GEOID: geoid,
    STATE: state,
    COUNTY: county,
    TRACT: tract,
    NAME: p.NAME ?? p.NAMELSAD ?? p.BASENAME ?? '',
    ALAND: p.ALAND ?? null,
    AWATER: p.AWATER ?? null,
  };
  return { type: 'Feature', geometry: f.geometry, properties: props };
}

function validateAndNormalize(geo, endpoint) {
  if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
    throw new Error(`Invalid GeoJSON from ${endpoint}: bad type/features`);
  }
  if (geo.features.length < 300) {
    throw new Error(`Invalid GeoJSON from ${endpoint}: too few features (${geo.features.length}); expected ~384 tracts for Philadelphia`);
  }
  const allValid = geo.features.every(validFeature);
  if (!allValid) {
    const sample = geo.features.find(f => !validFeature(f));
    throw new Error(`Invalid GeoJSON from ${endpoint}: missing GEOID or components in feature. Sample props: ${JSON.stringify(sample?.properties || {}).substring(0, 200)}`);
  }
  const features = geo.features.map(normalizeFeature);

  // Ensure all have GEOID after normalization
  const missingGeoid = features.filter(f => !f.properties.GEOID);
  if (missingGeoid.length > 0) {
    throw new Error(`Invalid GeoJSON from ${endpoint}: ${missingGeoid.length} features missing GEOID after normalization`);
  }

  return { type: 'FeatureCollection', features };
}

async function tryEndpoint(url, log) {
  for (let i = 0; i < delays.length; i++) {
    try {
      const raw = await fetchJson(url);
      const norm = validateAndNormalize(raw, url);
      return norm;
    } catch (e) {
      const last = i === delays.length - 1;
      log.push(`[${new Date().toISOString()}] ${url} attempt ${i + 1} failed: ${e?.message || e}`);
      if (last) break; else await sleep(delays[i]);
    }
  }
  return null;
}

async function main() {
  const log = [];
  for (const url of ENDPOINTS) {
    const data = await tryEndpoint(url, log);
    if (data) {
      await fs.mkdir(OUT_DIR, { recursive: true });
      await fs.writeFile(OUT_FILE, JSON.stringify(data));
      log.push(`[${new Date().toISOString()}] Saved ${OUT_FILE} (${data.features.length} features) from ${url}`);
      break;
    }
  }
  if (!(await exists(OUT_FILE))) {
    log.push('WARN: All endpoints exhausted; no tracts cache written. Runtime will fallback.');
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const logPath = path.join('logs', `fetch_tracts_${ts}.log`);
  await fs.mkdir('logs', { recursive: true });
  await fs.writeFile(logPath, log.join('\n'));
  console.log(`Wrote log ${logPath}`);
}

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

main();
