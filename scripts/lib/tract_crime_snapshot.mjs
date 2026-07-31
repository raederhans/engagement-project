import fs from 'node:fs/promises';
import path from 'node:path';

import { tractFeatureGEOID } from '../../src/utils/geoids.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GEOID_PATTERN = /^\d{11}$/;

export function normalizeCoverageDate(value) {
  const input = String(value || '');
  const match = input.match(/^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/);
  if (!match) {
    throw new Error(`Coverage date is invalid; received ${value || '(empty)'}.`);
  }
  const date = match[1];
  createSnapshotWindow(date);
  return date;
}

export function createSnapshotWindow(coverageDate) {
  const value = String(coverageDate || '');
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`Coverage date must be a valid YYYY-MM-DD value; received ${value || '(empty)'}.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new Error(`Coverage date must be a valid YYYY-MM-DD value; received ${value}.`);
  }

  const endDate = new Date(Date.UTC(year, month, 1));
  const startDate = new Date(endDate);
  startDate.setUTCMonth(startDate.getUTCMonth() - 12);
  return {
    coverageDate: value,
    start: formatDate(startDate),
    end: formatDate(endDate),
  };
}

export function buildTractCountSQL(geometry, { start, end }) {
  const bbox = geometryBounds(geometry);
  const geojson = JSON.stringify(geometry).replaceAll("'", "''");
  return `SELECT text_general_code, COUNT(*)::int AS n
FROM incidents_part1_part2
WHERE dispatch_date_time >= '${start}'
  AND dispatch_date_time < '${end}'
  AND the_geom && ST_MakeEnvelope(${bbox.join(', ')}, 4326)
  AND ST_Intersects(the_geom, ST_SetSRID(ST_GeomFromGeoJSON('${geojson}'), 4326))
GROUP BY text_general_code
ORDER BY text_general_code`;
}

export function prepareTracts(featureCollection) {
  if (
    featureCollection?.type !== 'FeatureCollection'
    || !Array.isArray(featureCollection.features)
    || featureCollection.features.length === 0
  ) {
    throw new Error('Tract source must be a non-empty GeoJSON FeatureCollection.');
  }

  const seen = new Set();
  const tracts = featureCollection.features.map((feature, index) => {
    const geoid = tractFeatureGEOID(feature);
    if (!GEOID_PATTERN.test(geoid)) {
      throw new Error(`Tract feature ${index} has an invalid 11-digit GEOID.`);
    }
    if (seen.has(geoid)) throw new Error(`Duplicate GEOID ${geoid} in tract source.`);
    seen.add(geoid);
    geometryBounds(feature.geometry);
    return { geoid, geometry: feature.geometry };
  });

  return tracts.sort((left, right) => left.geoid.localeCompare(right.geoid));
}

export async function collectTractCounts(tracts, {
  concurrency = 3,
  queryCount,
  onProgress = () => {},
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`Concurrency must be a positive integer; received ${concurrency}.`);
  }
  if (typeof queryCount !== 'function') throw new Error('collectTractCounts requires queryCount.');

  const results = new Array(tracts.length);
  const failures = [];
  let cursor = 0;
  let completed = 0;
  const workerCount = Math.min(concurrency, Math.max(1, tracts.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= tracts.length) return;
      const tract = tracts[index];
      try {
        const offenses = normalizeOffenseCounts(await queryCount(tract));
        results[index] = { geoid: tract.geoid, offenses };
      } catch (error) {
        failures.push(`${tract.geoid}: ${error?.message || error}`);
      } finally {
        completed += 1;
        onProgress({ completed, total: tracts.length, geoid: tract.geoid });
      }
    }
  });

  await Promise.all(workers);
  if (failures.length) {
    throw new Error(`Tract count collection failed for ${failures.length} tract(s): ${failures.join('; ')}`);
  }
  return results.sort((left, right) => left.geoid.localeCompare(right.geoid));
}

export function createTractCrimeSnapshot({
  tracts,
  counts,
  coverageDate,
  generatedAt,
  sourceUrl,
  tractSource,
}) {
  if (!Array.isArray(tracts) || tracts.length === 0) throw new Error('Snapshot requires prepared tracts.');
  if (!Array.isArray(counts)) throw new Error('Snapshot requires tract counts.');
  const generated = new Date(generatedAt);
  if (!generatedAt || Number.isNaN(generated.getTime())) {
    throw new Error('Snapshot generatedAt must be a valid timestamp.');
  }
  if (!sourceUrl || !tractSource) throw new Error('Snapshot provenance is required.');

  const countByGeoid = new Map();
  for (const row of counts) {
    const geoid = String(row?.geoid || '');
    if (!GEOID_PATTERN.test(geoid)) throw new Error(`Invalid count GEOID ${geoid || '(empty)'}.`);
    if (countByGeoid.has(geoid)) throw new Error(`Duplicate count for tract ${geoid}.`);
    const offenses = normalizeOffenseCounts(row?.offenses);
    const total = offenses.reduce((sum, offense) => sum + offense.n, 0);
    countByGeoid.set(geoid, { geoid, total, offenses });
  }

  const expectedGeoids = new Set(tracts.map(({ geoid }) => geoid));
  for (const geoid of expectedGeoids) {
    if (!countByGeoid.has(geoid)) throw new Error(`Missing count for tract ${geoid}.`);
  }
  for (const geoid of countByGeoid.keys()) {
    if (!expectedGeoids.has(geoid)) throw new Error(`Count result contains unknown tract ${geoid}.`);
  }

  const window = createSnapshotWindow(coverageDate);
  const rows = Array.from(countByGeoid.values())
    .sort((left, right) => left.geoid.localeCompare(right.geoid));
  return {
    meta: {
      schema_version: 2,
      source_url: sourceUrl,
      source_dataset: 'incidents_part1_part2',
      filter_dimension: 'text_general_code',
      tract_source: tractSource,
      coverage_date: window.coverageDate,
      start: window.start,
      end: window.end,
      generated_at: generated.toISOString(),
      row_count: rows.length,
    },
    rows,
  };
}

export function validateTractCrimeSnapshot(snapshot, tracts) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Snapshot must be a JSON object.');
  }
  if (snapshot.meta?.schema_version !== 2) {
    throw new Error(`Snapshot schema_version must be 2; received ${snapshot.meta?.schema_version ?? '(missing)'}.`);
  }
  if (snapshot.meta?.source_dataset !== 'incidents_part1_part2') {
    throw new Error('Snapshot source_dataset must be incidents_part1_part2.');
  }
  if (snapshot.meta?.filter_dimension !== 'text_general_code') {
    throw new Error('Snapshot filter_dimension must be text_general_code.');
  }
  if (!Array.isArray(snapshot.rows)) throw new Error('Snapshot rows must be an array.');
  if (snapshot.meta?.row_count !== snapshot.rows.length) {
    throw new Error(`Snapshot row_count ${snapshot.meta?.row_count ?? '(missing)'} does not match ${snapshot.rows.length} rows.`);
  }

  const canonical = createTractCrimeSnapshot({
    tracts,
    counts: snapshot.rows,
    coverageDate: snapshot.meta?.coverage_date,
    generatedAt: snapshot.meta?.generated_at,
    sourceUrl: snapshot.meta?.source_url,
    tractSource: snapshot.meta?.tract_source,
  });
  if (snapshot.meta.start !== canonical.meta.start || snapshot.meta.end !== canonical.meta.end) {
    throw new Error(
      `Snapshot window must be [${canonical.meta.start}, ${canonical.meta.end}); received [${snapshot.meta.start}, ${snapshot.meta.end}).`,
    );
  }
  if (JSON.stringify(snapshot.rows) !== JSON.stringify(canonical.rows)) {
    throw new Error('Snapshot rows must be sorted by GEOID.');
  }

  return {
    rowCount: snapshot.rows.length,
    start: canonical.meta.start,
    end: canonical.meta.end,
  };
}

function normalizeOffenseCounts(value) {
  if (!Array.isArray(value)) throw new Error('Tract offense counts must be an array.');
  const byCode = new Map();
  for (const item of value) {
    const code = String(item?.code ?? item?.text_general_code ?? 'Unknown').trim() || 'Unknown';
    const count = Number(item?.n);
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`Invalid count for offense ${code}.`);
    }
    if (byCode.has(code)) throw new Error(`Duplicate offense count for ${code}.`);
    byCode.set(code, count);
  }
  return Array.from(byCode, ([code, n]) => ({ code, n }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

export async function writeJsonAtomic(destination, value, { space = 2 } = {}) {
  const directory = path.dirname(destination);
  const temporary = path.join(
    directory,
    `.${path.basename(destination)}.${process.pid}-${Date.now()}.tmp`,
  );
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, space)}\n`, 'utf8');
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function geometryBounds(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    throw new Error(`Tract geometry must be Polygon or MultiPolygon; received ${geometry?.type || '(missing)'}.`);
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (coordinates) => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === 'number') {
      const [x, y] = coordinates;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error('Tract geometry contains a non-numeric coordinate.');
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      return;
    }
    coordinates.forEach(visit);
  };
  visit(geometry.coordinates);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    throw new Error('Tract geometry contains no coordinates.');
  }
  return [minX, minY, maxX, maxY];
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}
