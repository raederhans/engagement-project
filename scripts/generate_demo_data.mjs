#!/usr/bin/env node
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as turf from '@turf/turf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = resolve(__dirname, '..', 'data');

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

function getBaseSegments() {
  const preparedPath = resolve(dataDir, 'streets_phl.prepared.geojson');
  try {
    if (existsSync(preparedPath)) {
      const raw = readFileSync(preparedPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const features = Array.isArray(parsed?.features) ? parsed.features : [];
      console.info(`[Diary] Prepared street file detected (${features.length} features). TODO: integrate fields for demo generator.`);
      return { type: 'FeatureCollection', features };
    }
  } catch (err) {
    console.warn('[Diary] Unable to read prepared street file; using synthetic demo segments.', err?.message || err);
  }
  return null;
}

const seed = Number(parseArg('--seed', 20251111));
const segmentCount = Number(parseArg('--segments', 64));
const routeCount = Number(parseArg('--routes', 5));
const rand = rng(seed);

function generateSyntheticSegments(random, count) {
  const list = [];
  for (let i = 0; i < count; i += 1) {
    const hood = pickRand(random, NEIGHBORHOODS);
    const start = jitterCoord(random, hood.center, hood.radius);
    const end = jitterCoord(random, start, hood.radius * 0.6);
    const length = Math.max(80, distanceMeters(start, end));
    const segmentId = `seg_${String(i + 1).padStart(3, '0')}`;
    list.push({
      id: segmentId,
      street: pickRand(random, STREET_NAMES),
      length_m: length,
      decayed_mean: sampleMean(random),
      n_eff: Math.max(1, Math.round(random() * 24) + 1),
      top_tags: sampleTags(random),
      delta_30d: +((random() - 0.5) * 0.4).toFixed(2),
      geometry: {
        type: 'LineString',
        coordinates: [start, end],
      },
      neighborhood: hood.name,
    });
  }
  return list;
}

const preparedSegments = getBaseSegments();
const syntheticSegments = generateSyntheticSegments(rand, segmentCount);
let segments = syntheticSegments;
if (existsSync(resolve(dataDir, 'segments_phl.network.geojson'))) {
  try {
    const networkRaw = JSON.parse(readFileSync(resolve(dataDir, 'segments_phl.network.geojson'), 'utf-8'));
    if (Array.isArray(networkRaw.features) && networkRaw.features.length) {
      segments = networkRaw.features.slice(0).map((f, idx) => {
        const lenM = turf.length(f, { units: 'kilometers' }) * 1000;
        return {
          id: f.properties?.segment_id || `seg_${String(idx + 1).padStart(3, '0')}`,
          street: f.properties?.street_name || f.properties?.name || `Street ${idx + 1}`,
          length_m: Math.max(20, Math.round(lenM)),
          decayed_mean: sampleMean(rand),
          n_eff: Math.max(1, Math.round(rand() * 24) + 1),
          top_tags: sampleTags(rand),
          delta_30d: +((rand() - 0.5) * 0.4).toFixed(2),
          geometry: f.geometry,
          class: Number(f.properties?.class) || 3,
        };
      });
      console.info(`[Diary] Using network segments (${segments.length}) from segments_phl.network.geojson`);
    }
  } catch (err) {
    console.warn('[Diary] Failed to load network segments; falling back to synthetic.', err?.message || err);
    segments = syntheticSegments;
  }
}

function stitchGeometry(ids) {
  const coords = [];
  ids.forEach((id) => {
    const seg = segments.find((s) => s.id === id);
    if (!seg) return;
    let line = seg.geometry.coordinates;
    if (coords.length > 0) {
      const last = coords[coords.length - 1];
      const start = line[0];
      const end = line[line.length - 1];
      const distStart = turf.distance(last, start, { units: 'meters' });
      const distEnd = turf.distance(last, end, { units: 'meters' });
      if (distEnd < distStart) {
        line = [...line].reverse();
      }
    }
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

const ROUTE_SCENARIOS = [
  { route_id: 'route_A', name: '30th St Station → Clark Park', start: [-75.1810, 39.9556], end: [-75.2129, 39.9493], targetKm: 2.3 },
  { route_id: 'route_B', name: '30th St Station → Rittenhouse Sq', start: [-75.1810, 39.9556], end: [-75.1715, 39.9496], targetKm: 2.2 },
  { route_id: 'route_C', name: 'Penn Campus → 9th & Christian', start: [-75.1932, 39.9522], end: [-75.1605, 39.9391], targetKm: 4.2 },
  { route_id: 'route_D', name: 'City Hall → 34th & Walnut', start: [-75.1652, 39.9526], end: [-75.1905, 39.9524], targetKm: 2.2 },
  { route_id: 'route_E', name: 'Rittenhouse Sq → Passyunk & Tasker', start: [-75.1715, 39.9496], end: [-75.1690, 39.9305], targetKm: 3.2 },
];

const routes = [];
const nodeKey = (coord) => (coord ? `${coord[0].toFixed(5)},${coord[1].toFixed(5)}` : null);
const adjacency = new Map();
const PHILLY_BBOX = [-75.28, 39.90, -75.135, 40.05];

function inPhilly(feature) {
  try {
    const b = turf.bbox(feature);
    return (
      b[0] >= PHILLY_BBOX[0] &&
      b[2] <= PHILLY_BBOX[2] &&
      b[1] >= PHILLY_BBOX[1] &&
      b[3] <= PHILLY_BBOX[3]
    );
  } catch {
    return false;
  }
}

const phillySegments = segments.filter((seg) => inPhilly({ type: 'Feature', geometry: seg.geometry, properties: seg }));
const baseSegments = phillySegments.length > 0 ? phillySegments : segments;
if (phillySegments.length === 0) {
  console.warn('[Diary] Philly filter returned 0 segments; falling back to full set.');
}

baseSegments.forEach((seg) => {
  if (!seg.geometry?.coordinates?.length) return;
  const coords = seg.geometry.coordinates;
  const a = nodeKey(coords[0]);
  const b = nodeKey(coords[coords.length - 1]);
  if (a && b) {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push(seg);
    adjacency.get(b).push(seg);
  }
});

function otherEnd(seg, key) {
  const coords = seg.geometry.coordinates;
  const a = nodeKey(coords[0]);
  const b = nodeKey(coords[coords.length - 1]);
  return key === a ? b : a;
}

function findNearestKey(targetLngLat) {
  let best = null;
  let bestDist = Infinity;
  adjacency.forEach((segs, key) => {
    if (!segs.length) return;
    const [lng, lat] = segs[0].geometry.coordinates[0];
    const d = turf.distance([lng, lat], targetLngLat, { units: 'kilometers' });
    if (d < bestDist) {
      bestDist = d;
      best = key;
    }
  });
  return best;
}

function walkRouteFrom(startKey, targetKm = 3.0, { maxSegments = 140, endHint } = {}) {
  if (!startKey || !adjacency.has(startKey)) return [];
  const path = [];
  const visited = new Set();
  let currentKey = startKey;
  let total = 0;
  for (let i = 0; i < maxSegments; i += 1) {
    const neighbors = adjacency.get(currentKey) || [];
    const unvisited = neighbors.filter((seg) => !visited.has(seg.id));
    const pool = unvisited.length ? unvisited : neighbors;
    if (!pool.length) break;
    let nextSeg = null;
    if (endHint) {
      pool.sort((a, b) => {
        const da = turf.distance(a.geometry.coordinates.at(-1), endHint, { units: 'kilometers' });
        const db = turf.distance(b.geometry.coordinates.at(-1), endHint, { units: 'kilometers' });
        return da - db;
      });
      nextSeg = pool[Math.min(pool.length - 1, Math.floor(rand() * Math.min(3, pool.length)))];
    } else {
      nextSeg = pool[Math.floor(rand() * pool.length)];
    }
    visited.add(nextSeg.id);
    path.push(nextSeg.id);
    total += nextSeg.length_m || 0;
    currentKey = otherEnd(nextSeg, currentKey) || currentKey;
    if (total / 1000 >= targetKm * 0.9 && total / 1000 <= targetKm * 1.2) break;
  }
  return path;
}

for (let i = 0; i < routeCount; i += 1) {
  const scenario = ROUTE_SCENARIOS[i] || {
    route_id: `route_${String.fromCharCode(65 + i)}`,
    name: `Demo route ${String.fromCharCode(65 + i)}`,
    start: null,
    end: null,
    targetKm: 3.0,
  };
  const startKey = scenario.start ? findNearestKey(scenario.start) : null;
  const primarySegments = walkRouteFrom(startKey, scenario.targetKm || 3.0, { endHint: scenario.end });
  const altSegments = walkRouteFrom(startKey, (scenario.targetKm || 3.0) * 0.9, { endHint: scenario.end });
  const [fromLabel, toLabel] = scenario.name.includes('→') ? scenario.name.split('→').map((s) => s.trim()) : [scenario.name, scenario.name];
  const primaryLength = collectLength(primarySegments);
  const altLength = collectLength(altSegments);
  const mode = 'walk';
  const routeFeature = {
    type: 'Feature',
    geometry: stitchGeometry(primarySegments),
    properties: {
      route_id: scenario.route_id || `route_${String.fromCharCode(65 + i)}`,
      name: scenario.name || `Demo route ${String.fromCharCode(65 + i)}`,
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

// Build demo segment set limited to segmentCount while ensuring routes are covered
const usedIds = new Set();
routes.forEach((r) => {
  (r.properties.segment_ids || []).forEach((id) => usedIds.add(id));
  (r.properties.alt_segment_ids || []).forEach((id) => usedIds.add(id));
});
const effectiveCount = Math.max(segmentCount, usedIds.size);
let demoSegments = baseSegments.filter((seg) => usedIds.has(seg.id));
const remaining = baseSegments.filter((seg) => !usedIds.has(seg.id));
const needed = Math.max(0, effectiveCount - demoSegments.length);
if (needed > 0 && remaining.length) {
  for (let i = 0; i < needed; i += 1) {
    const seg = remaining[i % remaining.length];
    demoSegments.push(seg);
  }
}
if (demoSegments.length > effectiveCount) {
  demoSegments = demoSegments.slice(0, effectiveCount);
}
segments = demoSegments;

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
      class: segment.class || 3,
    },
    geometry: segment.geometry,
  })),
};

const routesFC = {
  type: 'FeatureCollection',
  features: routes,
};

mkdirSync(dataDir, { recursive: true });
writeFileSync(resolve(dataDir, 'segments_phl.demo.geojson'), `${JSON.stringify(segmentsFC, null, 2)}\n`);
writeFileSync(resolve(dataDir, 'routes_phl.demo.geojson'), `${JSON.stringify(routesFC, null, 2)}\n`);

console.info(`[Diary] Demo data generated: ${segments.length} segments, ${routes.length} routes (seed=${seed}).`);
