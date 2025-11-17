#!/usr/bin/env node

export async function fetchStreetsPhl({ outPath = 'data/raw/streets_centerlines_phl.geojson' } = {}) {
  console.info('[Diary Streets] Stub fetchStreetsPhl called — implement ArcGIS REST paging here.');
  console.info(`[Diary Streets] Target output: ${outPath}`);
  console.info('[Diary Streets] Expected source: Street Centerlines (CityPhillyStreets MapServer, polyline geometry).');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchStreetsPhl().catch((err) => {
    console.error('[Diary Streets] fetchStreetsPhl failed', err);
    process.exitCode = 1;
  });
}
