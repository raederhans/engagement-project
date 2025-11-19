#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = process.argv[2] || 'data/segments_phl.network.geojson';
const fc = JSON.parse(readFileSync(resolve(file), 'utf8'));
const feats = fc.features || [];
const counts = feats.reduce((acc, f) => {
  const cls = f?.properties?.class ?? 'unknown';
  acc[cls] = (acc[cls] || 0) + 1;
  return acc;
}, {});
let minLng = Infinity; let minLat = Infinity; let maxLng = -Infinity; let maxLat = -Infinity;
feats.forEach((f) => {
  const geom = f.geometry || {};
  let pts = [];
  if (geom.type === 'LineString') pts = geom.coordinates;
  else if (geom.type === 'MultiLineString') pts = geom.coordinates.flat();
  pts.forEach(([lng, lat]) => {
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  });
});
console.info('[Inspect] file:', file);
console.info('[Inspect] features:', feats.length);
console.info('[Inspect] class counts:', counts);
console.info('[Inspect] bbox:', [minLng, minLat], [maxLng, maxLat]);
