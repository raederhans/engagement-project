#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const TAGS = ['poor_lighting', 'low_foot_traffic', 'cars_too_close', 'dogs', 'construction_blockage', 'other'];
const NEIGHBORHOODS = [
  { name: 'University City', center: [-75.191, 39.954], radius: 0.008 },
  { name: 'Center City', center: [-75.166, 39.952], radius: 0.0075 },
  { name: 'South Philly', center: [-75.171, 39.935], radius: 0.0065 },
];
const STREET_NAMES = ['Market St', 'Walnut St', 'Chestnut St', 'Spruce St', 'Locust St', 'Sansom St', 'Pine St', 'S 34th St', 'S 33rd St', 'S 32nd St', 'S 31st St'];

function parseArg(flag, fallback) {
  const idx = process.argv.findIndex((arg) => arg.startsWith(`${flag}=`));
  if (idx === -1) return fallback;
  const value = process.argv[idx].split('=')[1];
  return value ?? fallback;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function pickRand(random, list) {
  return list[Math.floor(random() * list.length)];
}

function jitterCoord(random, [lng, lat], radius) {
  const dx = (random() - 0.5) * radius * 2;
  const dy = (random() - 0.5) * radius * 2;
  return [lng + dx, lat + dy];
}

function distanceMeters([lng1, lat1], [lng2, lat2]) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function sampleMean(random) {
  const bins = [
    { min: 1.2, max: 1.8, weight: 0.08 },
    { min: 1.8, max: 2.6, weight: 0.22 },
    { min: 2.6, max: 3.4, weight: 0.3 },
    { min: 3.4, max: 4.2, weight: 0.28 },
    { min: 4.2, max: 4.9, weight: 0.12 },
  ];
  const total = bins.reduce((sum, bin) => sum + bin.weight, 0);
  let r = random() * total;
  for (const bin of bins) {
    if (r < bin.weight) {
      return +(bin.min + (bin.max - bin.min) * random()).toFixed(1);
    }
    r -= bin.weight;
  }
  return 3.0;
}

function sampleTags(random) {
  const count = random() < 0.35 ? 1 + Math.floor(random() * 2) : 0;
  const shuffled = [...TAGS].sort(() => random() - 0.5);
  return shuffled.slice(0, count).map((tag) => ({ tag, p: +(0.4 + random() * 0.4).toFixed(2) }));
}

const seed = Number(parseArg('--seed', 20251111));
const segmentCount = Number(parseArg('--segments', 64));
const routeCount = Number(parseArg('--routes', 5));
const rand = rng(seed);

const segments = [];
for (let i = 0; i < segmentCount; i += 1) {
  const hood = pickRand(rand, NEIGHBORHOODS);
  const start = jitterCoord(rand, hood.center, hood.radius);
  const end = jitterCoord(rand, start, hood.radius * 0.6);
  const length = Math.max(80, distanceMeters(start, end));
  const segmentId = `seg_${String(i + 1).padStart(3, '0')}`;
  segments.push({
    id: segmentId,
    street: pickRand(rand, STREET_NAMES),
    length_m: length,
    decayed_mean: sampleMean(rand),
    n_eff: Math.max(1, Math.round(rand() * 24) + 1),
    top_tags: sampleTags(rand),
    delta_30d: +((rand() - 0.5) * 0.4).toFixed(2),
    geometry: {
      type: 'LineString',
      coordinates: [start, end],
    },
    neighborhood: hood.name,
  });
}

function stitchGeometry(ids) {
  const coords = [];
  ids.forEach((id, idx) => {
    const seg = segments.find((s) => s.id === id);
    if (!seg) return;
    const line = seg.geometry.coordinates;
    if (coords.length === 0) {
      coords.push(...line);
    } else {
      const last = coords[coords.length - 1];
      const [firstLng, firstLat] = line[0];
      if (last[0] === firstLng && last[1] === firstLat) {
        coords.push(...line.slice(1));
      } else {
        coords.push(...line);
      }
    }
  });
  return coords.length >= 2 ? { type: 'LineString', coordinates: coords } : null;
}

function collectLength(ids) {
  return ids.reduce((sum, id) => {
    const seg = segments.find((s) => s.id === id);
    return sum + (seg?.length_m || 0);
  }, 0);
}

const ROUTE_NAMES = [
  ['30th St Station', 'Clark Park'],
  ['Rittenhouse Sq', 'Schuylkill River Trail'],
  ['Penn Museum', 'Drexel Quad'],
  ['City Hall', 'Italian Market'],
  ['Spring Garden', 'Fitler Square'],
  ['Queen Village', 'University City'],
];

const routes = [];
for (let i = 0; i < routeCount; i += 1) {
  const minSegments = 8;
  const span = minSegments + Math.floor(rand() * 5);
  const startIdx = Math.floor(rand() * Math.max(1, segmentCount - span - 1));
  const primarySegments = segments.slice(startIdx, startIdx + span).map((s) => s.id);
  const altStart = (startIdx + Math.max(4, Math.floor(rand() * 10))) % Math.max(1, segmentCount - span);
  const altSegments = segments.slice(altStart, altStart + span).map((s) => s.id);
  const [fromLabel, toLabel] = ROUTE_NAMES[i % ROUTE_NAMES.length];
  const primaryLength = collectLength(primarySegments);
  const altLength = collectLength(altSegments);
  const mode = rand() > 0.25 ? 'walk' : 'bike';
  const routeFeature = {
    type: 'Feature',
    geometry: stitchGeometry(primarySegments),
    properties: {
      route_id: `route_${String.fromCharCode(65 + i)}`,
      name: `Demo route ${String.fromCharCode(65 + i)}`,
      mode,
      from: fromLabel,
      to: toLabel,
      length_m: primaryLength,
      duration_min: Math.max(5, Math.round(primaryLength / (mode === 'bike' ? 200 : 90))),
      segment_ids: primarySegments,
      alt_segment_ids: altSegments,
      alt_length_m: altLength,
      alt_duration_min: Math.max(5, Math.round(altLength / (mode === 'bike' ? 210 : 95))),
    },
  };
  const altGeom = stitchGeometry(altSegments);
  if (altGeom) {
    routeFeature.properties.alt_geometry = altGeom;
  }
  routes.push(routeFeature);
}

const segmentsFC = {
  type: 'FeatureCollection',
  features: segments.map((segment) => ({
    type: 'Feature',
    properties: {
      segment_id: segment.id,
      street: segment.street,
      length_m: segment.length_m,
      decayed_mean: segment.decayed_mean,
      n_eff: segment.n_eff,
      top_tags: segment.top_tags,
      delta_30d: segment.delta_30d,
      neighborhood: segment.neighborhood,
    },
    geometry: segment.geometry,
  })),
};

const routesFC = {
  type: 'FeatureCollection',
  features: routes,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = resolve(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });
writeFileSync(resolve(dataDir, 'segments_phl.demo.geojson'), `${JSON.stringify(segmentsFC, null, 2)}\n`);
writeFileSync(resolve(dataDir, 'routes_phl.demo.geojson'), `${JSON.stringify(routesFC, null, 2)}\n`);

console.info(`[Diary] Demo data generated: ${segments.length} segments, ${routes.length} routes (seed=${seed}).`);
