#!/usr/bin/env node
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as turf from '@turf/turf';
import { buildSegmentGraph } from './graph_pathfinder.mjs';

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

const ROUTE_SCENARIOS = [
  { route_id: 'route_A', name: '30th St Station → Clark Park', mode: 'walk', start: { lon: -75.1819, lat: 39.9558 }, end: { lon: -75.2205, lat: 39.9400 }, targetMinKm: 2.0, targetMaxKm: 3.5 },
  { route_id: 'route_B', name: '30th St Station → Rittenhouse Sq', mode: 'walk', start: { lon: -75.1819, lat: 39.9558 }, end: { lon: -75.1480, lat: 39.9430 }, targetMinKm: 2.0, targetMaxKm: 3.5 },
  { route_id: 'route_C', name: 'Penn Campus → 9th & Christian', mode: 'bike', start: { lon: -75.1915, lat: 39.9510 }, end: { lon: -75.1520, lat: 39.9340 }, targetMinKm: 3.0, targetMaxKm: 4.5 },
  { route_id: 'route_D', name: 'City Hall → 34th & Walnut', mode: 'walk', start: { lon: -75.1636, lat: 39.9524 }, end: { lon: -75.2080, lat: 39.9525 }, targetMinKm: 2.0, targetMaxKm: 3.5 },
  { route_id: 'route_E', name: 'Rittenhouse Sq → Passyunk & Tasker', mode: 'bike', start: { lon: -75.1719, lat: 39.9495 }, end: { lon: -75.1650, lat: 39.9200 }, targetMinKm: 2.5, targetMaxKm: 3.8 },
];

const routes = [];
const PHILLY_BBOX = [-75.28, 39.90, -75.135, 40.05];

function inPhilly(feature) {
  try {
    const b = turf.bbox(feature);
    return b[0] >= PHILLY_BBOX[0] && b[2] <= PHILLY_BBOX[2] && b[1] >= PHILLY_BBOX[1] && b[3] <= PHILLY_BBOX[3];
  } catch {
    return false;
  }
}

const phillySegments = segments.filter((seg) => inPhilly({ type: 'Feature', geometry: seg.geometry, properties: seg }));
const baseSegments = phillySegments.length > 0 ? phillySegments : segments;
if (phillySegments.length === 0) {
  console.warn('[Diary] Philly filter returned 0 segments; falling back to full set.');
}

const safetyBySegmentId = new Map();
baseSegments.forEach((seg) => {
  const score = Number(seg.decayed_mean || seg.properties?.decayed_mean);
  if (seg.id && Number.isFinite(score)) safetyBySegmentId.set(seg.id, score);
});

const graph = buildSegmentGraph(
  baseSegments.map((seg) => ({
    type: 'Feature',
    geometry: seg.geometry,
    properties: { segment_id: seg.id || seg.properties?.segment_id, length_m: seg.length_m, class: seg.class },
  })),
  { safetyBySegmentId }
);
const segmentById = new Map();
baseSegments.forEach((seg) => segmentById.set(seg.id, seg));

function findNearestNode(anchor) {
  if (!anchor) return null;
  let best = null;
  let bestDist = Infinity;
  graph.nodes.forEach((coord, id) => {
    if (Math.abs(coord.lon - anchor.lon) > 0.1 || Math.abs(coord.lat - anchor.lat) > 0.1) return;
    const degree = graph.adj.get(id)?.length || 0;
    if (degree < 2) return;
    const d = turf.distance([coord.lon, coord.lat], [anchor.lon, anchor.lat], { units: 'kilometers' }) * 1000;
    if (d < bestDist && d <= 4000) {
      bestDist = d;
      best = id;
    }
  });
  return best;
}

function stitchPath(segmentIds) {
  const coords = [];
  segmentIds.forEach((id) => {
    const seg = segmentById.get(id);
    if (!seg?.geometry?.coordinates?.length) return;
    let line = seg.geometry.coordinates;
    if (coords.length > 0) {
      const last = coords[coords.length - 1];
      const dStart = turf.distance(last, line[0], { units: 'kilometers' });
      const dEnd = turf.distance(last, line[line.length - 1], { units: 'kilometers' });
      if (dEnd < dStart) line = [...line].reverse();
      coords.push(...line.slice(1));
    } else {
      coords.push(...line);
    }
  });
  return coords.length >= 2 ? { type: 'LineString', coordinates: coords } : null;
}

for (let i = 0; i < routeCount && i < ROUTE_SCENARIOS.length; i += 1) {
  const scenario = ROUTE_SCENARIOS[i];
  const startNode = findNearestNode(scenario.start);
  const endNode = findNearestNode(scenario.end);
  if (!startNode || !endNode) {
    console.warn('[Diary] No nearby nodes for scenario', scenario.route_id, startNode, endNode);
    continue;
  }
  const degStart = graph.adj.get(startNode)?.length || 0;
  const degEnd = graph.adj.get(endNode)?.length || 0;
  const basePath = graph.findShortestPath(startNode, endNode, { costKind: 'base' });
  if (!basePath) {
    console.warn('[Diary] No base path for', scenario.route_id, startNode, endNode, 'deg', degStart, degEnd);
    continue;
  }
  let altPath = graph.findShortestPath(startNode, endNode, { costKind: 'alt', safetyPenaltyFactor: 1.2, safetyBySegmentId });
  if (!altPath || JSON.stringify(altPath.segmentPath) === JSON.stringify(basePath.segmentPath)) {
    altPath = graph.findShortestPath(startNode, endNode, { costKind: 'alt', safetyPenaltyFactor: 2.0, safetyBySegmentId }) || basePath;
  }
  const primaryGeom = stitchPath(basePath.segmentPath);
  const altGeom = stitchPath(altPath.segmentPath);
  const primaryLength = basePath.totalLengthM;
  const altLength = altPath.totalLengthM;
  const [fromLabel, toLabel] = scenario.name.includes('→') ? scenario.name.split('→').map((s) => s.trim()) : [scenario.name, scenario.name];
  const walkSpeedMPerMin = scenario.mode === 'bike' ? 15000 / 60 : 5000 / 60;
  const durationMin = Math.max(5, Math.round(primaryLength / walkSpeedMPerMin));
  const altDurationMin = Math.max(5, Math.round(altLength / walkSpeedMPerMin));
  routes.push({
    type: 'Feature',
    geometry: primaryGeom,
    properties: {
      route_id: scenario.route_id,
      name: scenario.name,
      mode: scenario.mode,
      from: fromLabel,
      to: toLabel,
      length_m: Math.round(primaryLength),
      duration_min: durationMin,
      segment_ids: basePath.segmentPath,
      alt_segment_ids: altPath.segmentPath,
      alt_length_m: Math.round(altLength),
      alt_duration_min: altDurationMin,
      alt_geometry: altGeom || primaryGeom,
      alt_is_same: JSON.stringify(altPath.segmentPath) === JSON.stringify(basePath.segmentPath),
    },
  });
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
