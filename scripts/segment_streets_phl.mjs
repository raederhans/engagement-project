#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const turf = await import('@turf/turf');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_IN = resolve(__dirname, '..', 'data', 'streets_phl.raw.geojson');
const DEFAULT_OUT = resolve(__dirname, '..', 'data', 'segments_phl.network.geojson');
const STUDY_BBOX = [-75.25, 39.90, -75.13, 39.97];

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function toClass(props = {}) {
  const raw = Number(props.func_class ?? props.FUNC_CLASS ?? props.CLASS ?? props.func);
  if (Number.isFinite(raw)) {
    if (raw <= 1) return 1;
    if (raw <= 2) return 2;
    if (raw <= 3) return 3;
    return 4;
  }
  const name = String(props.name || props.ST_NAME || '').toLowerCase();
  if (name.includes('highway') || name.includes('express') || name.includes('i-')) return 1;
  if (name.includes('blvd') || name.includes('ave') || name.includes('avenue')) return 2;
  if (name.includes('st') || name.includes('street')) return 3;
  return 4;
}

function bboxFilter(feature) {
  try {
    return turf.booleanIntersects(feature, turf.bboxPolygon(STUDY_BBOX));
  } catch {
    return false;
  }
}

function splitLine(feature, targetLengthM) {
  const chunks = turf.lineChunk(feature, targetLengthM, { units: 'meters' });
  return chunks.features || [];
}

export async function segmentStreetsPhl({ inPath = DEFAULT_IN, outPath = DEFAULT_OUT, targetLengthM = 150 } = {}) {
  if (!existsSync(inPath)) {
    throw new Error(`Input not found: ${inPath}`);
  }
  const raw = readJSON(inPath);
  const all = raw.features || [];
  const filtered = all.filter((f) => f?.geometry?.type?.includes('Line') && bboxFilter(f));
  const segments = [];
  let counter = 1;
  filtered.forEach((feature) => {
    const props = feature.properties || {};
    const line = turf.lineString(feature.geometry.coordinates, props);
    const parts = splitLine(line, targetLengthM);
    parts.forEach((part) => {
      const len = turf.length(part, { units: 'kilometers' }) * 1000;
      segments.push({
        type: 'Feature',
        geometry: part.geometry,
        properties: {
          segment_id: `seg_${String(counter).padStart(4, '0')}`,
          street_name: props.name || props.ST_NAME || props.L_F_ADD || 'Unknown',
          class: toClass(props),
          length_m: Math.max(10, Math.round(len)),
        },
      });
      counter += 1;
    });
  });

  const fc = { type: 'FeatureCollection', features: segments };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(fc, null, 2)}\n`);
  console.info(`[Streets] Segmented ${segments.length} segments → ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  segmentStreetsPhl().catch((err) => {
    console.error('[Diary Streets] segmentStreetsPhl failed', err);
    process.exitCode = 1;
  });
}
