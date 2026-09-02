import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PUBLISHED_GEOJSON = Object.freeze([
  'data/tracts_phl.geojson',
  'data/police_districts.geojson',
]);
export const DEFAULT_PUBLISHED_PROPERTY_ALLOWLISTS = Object.freeze({
  'data/tracts_phl.geojson': Object.freeze(['GEOID']),
  'data/police_districts.geojson': Object.freeze(['DIST_NUMC']),
});

export function compactFeatureCollectionCoordinates(collection, {
  precision = 6,
  propertyAllowlist = null,
} = {}) {
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('Published GeoJSON must be a FeatureCollection.');
  }
  if (!Number.isInteger(precision) || precision < 0 || precision > 15) {
    throw new Error('GeoJSON coordinate precision must be an integer from 0 to 15.');
  }
  if (propertyAllowlist !== null && (!Array.isArray(propertyAllowlist)
    || propertyAllowlist.some((key) => typeof key !== 'string' || !key))) {
    throw new Error('GeoJSON property allowlist must be null or an array of field names.');
  }
  const allowed = propertyAllowlist === null ? null : new Set(propertyAllowlist);

  return {
    ...collection,
    features: collection.features.map((feature) => ({
      ...feature,
      properties: allowed === null ? feature.properties : Object.fromEntries(
        Object.entries(feature.properties || {}).filter(([key]) => allowed.has(key)),
      ),
      geometry: compactGeometry(feature.geometry, precision),
    })),
  };
}

export async function compactPublishedGeoJson({
  distDir = path.resolve('dist'),
  artifacts = DEFAULT_PUBLISHED_GEOJSON,
  precision = 5,
  propertyAllowlists = DEFAULT_PUBLISHED_PROPERTY_ALLOWLISTS,
} = {}) {
  const root = path.resolve(distDir);
  const results = [];

  for (const relativePath of artifacts) {
    const target = path.resolve(root, relativePath);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Published GeoJSON path escapes dist: ${relativePath}`);
    }
    const source = await readFile(target, 'utf8');
    const parsed = JSON.parse(source);
    const normalizedPath = relativePath.replaceAll('\\', '/');
    const compacted = compactFeatureCollectionCoordinates(parsed, {
      precision,
      propertyAllowlist: propertyAllowlists[normalizedPath] || null,
    });
    const output = JSON.stringify(compacted);
    await writeFile(target, output);
    results.push({
      relativePath: normalizedPath,
      featureCount: compacted.features.length,
      beforeBytes: Buffer.byteLength(source),
      afterBytes: Buffer.byteLength(output),
    });
  }

  return results;
}

export async function compactJsonArtifact(target) {
  const source = await readFile(target, 'utf8');
  const output = JSON.stringify(JSON.parse(source));
  await writeFile(target, output);
  return {
    beforeBytes: Buffer.byteLength(source),
    afterBytes: Buffer.byteLength(output),
  };
}

export async function compactBuiltGeoJsonAssets({
  assetsDir = path.resolve('dist/assets'),
} = {}) {
  const entries = await readdir(assetsDir, { withFileTypes: true });
  const targets = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.geojson'))
    .map((entry) => path.join(assetsDir, entry.name));
  return Promise.all(targets.map(async (target) => ({
    target,
    ...await compactJsonArtifact(target),
  })));
}

function compactGeometry(geometry, precision) {
  if (!geometry) return geometry;
  if (geometry.type === 'GeometryCollection') {
    return {
      ...geometry,
      geometries: (geometry.geometries || []).map((item) => compactGeometry(item, precision)),
    };
  }
  return {
    ...geometry,
    coordinates: roundCoordinateTree(geometry.coordinates, precision),
  };
}

function roundCoordinateTree(value, precision) {
  if (Array.isArray(value)) return value.map((item) => roundCoordinateTree(item, precision));
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Published GeoJSON coordinates must be finite numbers.');
  }
  return Number(value.toFixed(precision));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const results = await compactPublishedGeoJson();
  for (const result of results) {
    console.log(`[GeoJSON Artifact] ${result.relativePath}: ${result.beforeBytes} -> ${result.afterBytes} bytes (${result.featureCount} features)`);
  }
  try {
    const builtAssets = await compactBuiltGeoJsonAssets();
    for (const result of builtAssets) {
      console.log(`[Built GeoJSON Asset] ${path.basename(result.target)}: ${result.beforeBytes} -> ${result.afterBytes} bytes`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  try {
    const result = await compactJsonArtifact(path.resolve('dist/.vite/manifest.json'));
    console.log(`[Vite Manifest] ${result.beforeBytes} -> ${result.afterBytes} bytes`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
