#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = resolve(__dirname, '..', 'data');

const routesData = JSON.parse(readFileSync(resolve(dataDir, 'routes_phl.demo.geojson'), 'utf-8'));

console.log('=== ROUTE ANALYSIS ===\n');

routesData.features.forEach((route, idx) => {
  const props = route.properties;
  const coords = route.geometry.coordinates;

  console.log(`Route ${idx + 1}: ${props.route_id} - ${props.name}`);
  console.log(`  From: ${props.from} → To: ${props.to}`);
  const lengthKm = (props.length_m || 0) / 1000;
  console.log(`  Length: ${(props.length_m || 0).toLocaleString()}m (${lengthKm.toFixed(2)} km)`);
  console.log(`  Coordinates: ${coords.length}`);

  // Check for back-and-forth (repeated coords)
  const uniqueCoords = new Set(coords.map(c => `${c[0].toFixed(6)},${c[1].toFixed(6)}`));
  const duplicateRatio = (coords.length - uniqueCoords.size) / coords.length;
  console.log(`  Unique coords: ${uniqueCoords.size} (${(duplicateRatio * 100).toFixed(1)}% duplicates)`);
  if (duplicateRatio > 0.1) {
    console.log('  ⚠ Duplicate coordinate ratio exceeds 10% — investigate potential loops.');
  }

  // Start and end points
  const start = coords[0];
  const end = coords[coords.length - 1];
  console.log(`  Start: [${start[0].toFixed(4)}, ${start[1].toFixed(4)}]`);
  console.log(`  End: [${end[0].toFixed(4)}, ${end[1].toFixed(4)}]`);

  // Bbox
  const bbox = turf.bbox(route);
  console.log(`  Bbox: [${bbox[0].toFixed(4)}, ${bbox[1].toFixed(4)}] to [${bbox[2].toFixed(4)}, ${bbox[3].toFixed(4)}]`);
  const bboxWidth = (bbox[2] - bbox[0]) * 111; // km (rough)
  const bboxHeight = (bbox[3] - bbox[1]) * 111;
  console.log(`  Coverage: ${bboxWidth.toFixed(2)}km × ${bboxHeight.toFixed(2)}km`);

  // Segment IDs
  console.log(`  Segment IDs: ${props.segment_ids?.length || 0} segments`);
  if (props.segment_ids && props.segment_ids.length > 0) {
    console.log(`  First 5 IDs: ${props.segment_ids.slice(0, 5).join(', ')}`);

    // Check for repeating segment IDs
    const uniqueIds = new Set(props.segment_ids);
    if (uniqueIds.size < props.segment_ids.length) {
      console.log(`  ⚠ WARNING: ${props.segment_ids.length - uniqueIds.size} duplicate segment IDs`);
    }
  }

  console.log('');
});
