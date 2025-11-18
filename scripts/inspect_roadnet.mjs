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
const lngs = [];
const lats = [];
feats.forEach((f) => {
  const geom = f.geometry || {};
  let pts = [];
  if (geom.type === 'LineString') pts = geom.coordinates;
  else if (geom.type === 'MultiLineString') pts = geom.coordinates.flat();
  pts.forEach(([lng, lat]) => {
    lngs.push(lng);
    lats.push(lat);
  });
});
console.info('[Inspect] file:', file);
console.info('[Inspect] features:', feats.length);
console.info('[Inspect] class counts:', counts);
if (lngs.length && lats.length) {
  console.info('[Inspect] bbox:', [Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]);
}
