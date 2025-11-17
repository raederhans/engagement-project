#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = resolve(__dirname, '..', 'data');
const DEFAULT_OUT = resolve(DATA_DIR, 'streets_phl.raw.geojson');

// If env is configured, prefer a real OpenDataPhilly endpoint; otherwise fall back to baked sample.
const STREETS_PHL_URL =
  process.env.STREETS_PHL_URL ||
  'https://opendata.arcgis.com/api/v3/datasets/placeholder-street-centerlines/download?format=geojson';

const SAMPLE_STREETS = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Market St', func_class: 2 },
      geometry: { type: 'LineString', coordinates: [[-75.1918, 39.9559], [-75.1675, 39.9525], [-75.1502, 39.9523]] },
    },
    {
      type: 'Feature',
      properties: { name: 'Chestnut St', func_class: 3 },
      geometry: { type: 'LineString', coordinates: [[-75.1932, 39.9525], [-75.1690, 39.9512], [-75.1515, 39.9510]] },
    },
    {
      type: 'Feature',
      properties: { name: 'Walnut St', func_class: 3 },
      geometry: { type: 'LineString', coordinates: [[-75.1935, 39.9495], [-75.1693, 39.9485], [-75.1520, 39.9483]] },
    },
    {
      type: 'Feature',
      properties: { name: 'Spruce St', func_class: 4 },
      geometry: { type: 'LineString', coordinates: [[-75.1936, 39.9472], [-75.1700, 39.9460], [-75.1530, 39.9456]] },
    },
    {
      type: 'Feature',
      properties: { name: 'S 33rd St', func_class: 4 },
      geometry: { type: 'LineString', coordinates: [[-75.1906, 39.9575], [-75.1902, 39.9465]] },
    },
    {
      type: 'Feature',
      properties: { name: 'S 30th St', func_class: 2 },
      geometry: { type: 'LineString', coordinates: [[-75.1820, 39.9585], [-75.1814, 39.9460]] },
    },
    {
      type: 'Feature',
      properties: { name: 'S 22nd St', func_class: 3 },
      geometry: { type: 'LineString', coordinates: [[-75.1740, 39.9580], [-75.1736, 39.9455]] },
    },
    {
      type: 'Feature',
      properties: { name: 'Broad St', func_class: 1 },
      geometry: { type: 'LineString', coordinates: [[-75.1655, 39.9600], [-75.1650, 39.9440]] },
    },
    {
      type: 'Feature',
      properties: { name: 'Pine St', func_class: 4 },
      geometry: { type: 'LineString', coordinates: [[-75.1928, 39.9462], [-75.1688, 39.9452], [-75.1512, 39.9450]] },
    },
    {
      type: 'Feature',
      properties: { name: 'South St', func_class: 3 },
      geometry: { type: 'LineString', coordinates: [[-75.1924, 39.9432], [-75.1682, 39.9425], [-75.1505, 39.9421]] },
    },
  ],
};

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

function writeOutput(fc, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(fc, null, 2)}\n`);
  const count = Array.isArray(fc.features) ? fc.features.length : 0;
  console.info(`[Streets] Wrote ${count} features to ${outPath}`);
  if (fc.features?.length) {
    const lngs = [];
    const lats = [];
    fc.features.forEach((f) => {
      const coords = f.geometry?.coordinates || [];
      const flat = f.geometry?.type === 'LineString' ? coords : f.geometry?.type === 'MultiLineString' ? coords.flat() : [];
      flat.forEach(([lng, lat]) => {
        lngs.push(lng);
        lats.push(lat);
      });
    });
    if (lngs.length && lats.length) {
      console.info(
        `[Streets] Bbox approx: [${Math.min(...lngs).toFixed(4)}, ${Math.min(...lats).toFixed(4)}] - [${Math.max(...lngs).toFixed(4)}, ${Math.max(...lats).toFixed(4)}]`
      );
    }
    console.info('[Streets] Sample attrs:', fc.features[0]?.properties || {});
  }
}

export async function fetchStreetsPhl({ outPath = DEFAULT_OUT } = {}) {
  let payload = null;
  try {
    if (process.env.STREETS_PHL_URL) {
      console.info(`[Streets] Fetching from ${STREETS_PHL_URL}`);
      payload = await fetchJson(STREETS_PHL_URL);
    } else {
      throw new Error('No STREETS_PHL_URL set; using sample fallback.');
    }
  } catch (err) {
    console.warn('[Streets] Fetch failed or URL unset; falling back to baked sample.', err?.message || err);
    payload = SAMPLE_STREETS;
  }
  writeOutput(payload, outPath);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchStreetsPhl().catch((err) => {
    console.error('[Diary Streets] fetchStreetsPhl failed', err);
    process.exitCode = 1;
  });
}
