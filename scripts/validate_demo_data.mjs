#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const LIMITS = {
  lng: [-75.35, -74.9],
  lat: [39.88, 40.05],
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = resolve(__dirname, '..', 'data');
const segmentsPath = resolve(dataDir, 'segments_phl.demo.geojson');
const routesPath = resolve(dataDir, 'routes_phl.demo.geojson');

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function assertNumber(value, label, errors) {
  if (!Number.isFinite(value)) {
    errors.push(`${label} is not numeric (value=${value})`);
  }
}

function collectCoords(geometry, out) {
  if (!geometry) return;
  if (geometry.type === 'LineString') {
    geometry.coordinates.forEach(([lng, lat]) => out.push([lng, lat]));
  } else if (geometry.type === 'MultiLineString') {
    geometry.coordinates.flat().forEach(([lng, lat]) => out.push([lng, lat]));
  } else if (geometry.type === 'Point') {
    out.push(geometry.coordinates);
  }
}

const segments = readJson(segmentsPath);
const routes = readJson(routesPath);
const errors = [];

if (segments.type !== 'FeatureCollection') {
  errors.push('Segments file must be a FeatureCollection');
}
if (routes.type !== 'FeatureCollection') {
  errors.push('Routes file must be a FeatureCollection');
}

const segmentIds = new Set();
const coords = [];
(segments.features || []).forEach((feature, idx) => {
  const props = feature?.properties || {};
  if (!props.segment_id) {
    errors.push(`Segment index ${idx} missing segment_id`);
  } else if (segmentIds.has(props.segment_id)) {
    errors.push(`Duplicate segment_id ${props.segment_id}`);
  } else {
    segmentIds.add(props.segment_id);
  }
  assertNumber(props.length_m, `segments[${idx}].length_m`, errors);
  assertNumber(props.decayed_mean, `segments[${idx}].decayed_mean`, errors);
  assertNumber(props.n_eff, `segments[${idx}].n_eff`, errors);
  assertNumber(props.delta_30d, `segments[${idx}].delta_30d`, errors);
  collectCoords(feature.geometry, coords);
});

const routeFeatures = routes.features || [];
routeFeatures.forEach((feature, idx) => {
  const props = feature?.properties || {};
  if (!Array.isArray(props.segment_ids) || props.segment_ids.length === 0) {
    errors.push(`Route index ${idx} missing segment_ids`);
  } else {
    props.segment_ids.forEach((id) => {
      if (!segmentIds.has(id)) {
        errors.push(`Route index ${idx} references missing segment_id ${id}`);
      }
    });
  }
  if (Array.isArray(props.alt_segment_ids)) {
    props.alt_segment_ids.forEach((id) => {
      if (!segmentIds.has(id)) {
        errors.push(`Route index ${idx} references missing alt_segment_id ${id}`);
      }
    });
  }
  assertNumber(props.length_m, `routes[${idx}].length_m`, errors);
  assertNumber(props.duration_min, `routes[${idx}].duration_min`, errors);
  if (props.alt_length_m !== undefined) {
    assertNumber(props.alt_length_m, `routes[${idx}].alt_length_m`, errors);
  }
  if (props.alt_duration_min !== undefined) {
    assertNumber(props.alt_duration_min, `routes[${idx}].alt_duration_min`, errors);
  }
  collectCoords(feature.geometry, coords);
  if (props.alt_geometry) {
    collectCoords(props.alt_geometry, coords);
  }
});

coords.forEach(([lng, lat], idx) => {
  if (lng < LIMITS.lng[0] || lng > LIMITS.lng[1] || lat < LIMITS.lat[0] || lat > LIMITS.lat[1]) {
    errors.push(`Coordinate ${idx} (${lng.toFixed(5)}, ${lat.toFixed(5)}) outside Philly bbox`);
  }
});

if (errors.length > 0) {
  console.error('[Diary] Demo data validation failed:');
  errors.slice(0, 50).forEach((err) => console.error(` - ${err}`));
  process.exitCode = 1;
} else {
  console.info(`[Diary] OK — ${segmentIds.size} segments / ${routeFeatures.length} routes validated.`);
}
