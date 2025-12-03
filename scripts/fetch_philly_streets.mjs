#!/usr/bin/env node
import process from 'node:process';

function parseSource() {
  const arg = process.argv.find((p) => p.startsWith('--source='));
  return arg ? arg.split('=')[1] : 'opendata';
}

function main() {
  const source = parseSource();
  if (source !== 'opendata') {
    console.warn(`[streets] Unknown source "${source}". Supported: opendata (default).`);
  }
  if (source === 'opendata') {
    console.info('[streets] Dataset: Street Centerlines (Transportation, OpenDataPhilly)');
    console.info('[streets] Catalog: https://www.opendataphilly.org/dataset/street-centerlines');
    console.info('[streets] ArcGIS Open Data pattern: https://opendata.arcgis.com/api/v3/datasets/<id>/download?format=geojson');
    console.info('[streets] Target file (planned): data/streets_phl.raw.geojson');
    console.info('[streets] TODO: wire actual HTTP fetch or manual download instructions.');
  } else {
    console.info('[streets] Future sources may include: osm');
  }
}

main();
