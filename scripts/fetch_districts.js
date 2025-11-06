#!/usr/bin/env node
// Download and cache Police Districts GeoJSON locally with retry.
// Node ESM script; requires Node 18+ for global fetch.

import fs from 'node:fs/promises';
import path from 'node:path';

const URL_PD = 'https://policegis.phila.gov/arcgis/rest/services/POLICE/Boundaries/MapServer/1/query?where=1=1&outFields=*&f=geojson';
const OUT_DIR = path.join('public', 'data');
const OUT_FILE = path.join(OUT_DIR, 'police_districts.geojson');

const delays = [2000, 4000, 8000];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function countFeatures(geo) {
  if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) return -1;
  return geo.features.length;
}

async function attemptDownload() {
  const res = await fetch(URL_PD, { headers: { 'accept': 'application/geo+json, application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const n = countFeatures(data);
  if (n <= 0) throw new Error('Invalid GeoJSON (no features)');
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(data));
  console.log(`Saved ${OUT_FILE} (${n} features)`);
  return { n };
}

async function main() {
  for (let i = 0; i < delays.length; i++) {
    try {
      const { n } = await attemptDownload();
      console.log(`Police Districts downloaded successfully. Feature count: ${n}`);
      return;
    } catch (err) {
      const last = i === delays.length - 1;
      console.warn(`Attempt ${i + 1} failed: ${err?.message || err}`);
      if (last) {
        console.warn('WARN: All attempts failed. Leaving runtime to fallback to remote URL.');
        return; // exit 0
      }
      await sleep(delays[i]);
    }
  }
}

main();

