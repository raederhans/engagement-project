#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { writeJsonAtomic } from './lib/tract_crime_snapshot.mjs';
import { fetchFirstValidTractSource } from './lib/tract_source.mjs';

export const TRACT_ENDPOINTS = [
  'https://mapservices.pasda.psu.edu/server/rest/services/pasda/CityPhilly/MapServer/28/query?where=1%3D1&outFields=*&f=geojson',
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query?where=STATE%3D%2742%27%20AND%20COUNTY%3D%27101%27&outFields=STATE,COUNTY,TRACT,GEOID,NAME,BASENAME,AREALAND,AREAWATER&returnGeometry=true&f=geojson",
];
const OUTPUT_FILE = path.join('public', 'data', 'tracts_phl.geojson');

export async function runFetchTracts({
  endpoints = TRACT_ENDPOINTS,
  outputFile = OUTPUT_FILE,
  fetchJson = fetchGeoJson,
} = {}) {
  const { data, sourceUrl } = await fetchFirstValidTractSource(endpoints, {
    fetchJson,
    validate: validateAndNormalize,
    onFailure: (message) => console.warn(`[tracts] ${message}`),
  });
  await writeJsonAtomic(outputFile, data, { space: 0 });
  console.log(`[tracts] Wrote ${outputFile} with ${data.features.length} features from ${sourceUrl}.`);
  return { data, sourceUrl };
}

async function fetchGeoJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/geo+json,application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function validateAndNormalize(geoJson, endpoint) {
  if (geoJson?.type !== 'FeatureCollection' || !Array.isArray(geoJson.features)) {
    throw new Error(`Invalid GeoJSON from ${endpoint}: expected a FeatureCollection.`);
  }
  if (geoJson.features.length < 300) {
    throw new Error(`Invalid GeoJSON from ${endpoint}: only ${geoJson.features.length} features.`);
  }
  const features = geoJson.features.map((feature, index) => normalizeTractFeature(feature, endpoint, index));
  const geoids = new Set();
  for (const feature of features) {
    const geoid = feature.properties.GEOID;
    if (geoids.has(geoid)) throw new Error(`Invalid GeoJSON from ${endpoint}: duplicate GEOID ${geoid}.`);
    geoids.add(geoid);
  }
  return { type: 'FeatureCollection', features };
}

export function normalizeTractFeature(feature, endpoint, index) {
  if (!feature?.geometry || !feature?.properties) {
    throw new Error(`Invalid GeoJSON from ${endpoint}: feature ${index} is incomplete.`);
  }
  const properties = feature.properties;
  const state = properties.STATE_FIPS ?? properties.STATE ?? properties.STATEFP ?? '42';
  const county = properties.COUNTY_FIPS ?? properties.COUNTY ?? properties.COUNTYFP ?? '101';
  const tract = properties.TRACT_FIPS ?? properties.TRACT ?? properties.TRACTCE;
  const geoid = String(properties.GEOID || (
    tract == null ? '' : `${String(state).padStart(2, '0')}${String(county).padStart(3, '0')}${String(tract).padStart(6, '0')}`
  ));
  if (!/^\d{11}$/.test(geoid)) {
    throw new Error(`Invalid GeoJSON from ${endpoint}: feature ${index} lacks an 11-digit GEOID.`);
  }
  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      GEOID: geoid,
      STATE: String(state).padStart(2, '0'),
      COUNTY: String(county).padStart(3, '0'),
      TRACT: tract == null ? geoid.slice(5) : String(tract).padStart(6, '0'),
      NAME: properties.NAME ?? properties.NAMELSAD ?? properties.BASENAME ?? '',
      ALAND: properties.ALAND ?? properties.AREALAND ?? null,
      AWATER: properties.AWATER ?? properties.AREAWATER ?? null,
    },
  };
}

function isDirectInvocation() {
  return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectInvocation()) {
  runFetchTracts().catch((error) => {
    console.error(`[tracts] Failed: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
