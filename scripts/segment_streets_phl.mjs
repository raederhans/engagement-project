#!/usr/bin/env node

export async function segmentStreetsPhl({ inPath = 'data/raw/streets_centerlines_phl.geojson', outPath = 'data/streets_phl.prepared.geojson', targetLengthM = 150 } = {}) {
  console.info('[Diary Streets] Stub segmentStreetsPhl called.');
  console.info(`[Diary Streets] Input: ${inPath}`);
  console.info(`[Diary Streets] Output: ${outPath}`);
  console.info(`[Diary Streets] Target segment length: ~${targetLengthM}m`);
  console.info('[Diary Streets] TODO: load GeoJSON, split polylines into ~100–200m segments, assign segment_id, length_m, class, oneway, etc.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  segmentStreetsPhl().catch((err) => {
    console.error('[Diary Streets] segmentStreetsPhl failed', err);
    process.exitCode = 1;
  });
}
