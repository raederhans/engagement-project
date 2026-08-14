import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  cloneDescriptorSafe,
  contentIdentity,
  fail,
  freezeData,
} from '../route_graph_candidate/safe_data.mjs';
import {
  BOUNDARY_MAX_POINTS,
  BOUNDARY_MAX_POINTS_PER_RING,
  BOUNDARY_MAX_POLYGONS,
  BOUNDARY_MAX_RINGS,
  parseBoundaryGeoJsonText,
} from './bounded_json.mjs';
import {
  BUILD_CLAIM_LIMITATION,
  REAL_GRAPH_BOUNDARY_CANDIDATE_SCHEMA,
  parseRealGraphBuildPolicyJson,
} from './contracts.mjs';
import {
  ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  ROUTE_REAL_GRAPH_BUILD_POLICY_JSON_TEXT,
} from './policy.mjs';

const BOUNDARY_CANDIDATE_LIMITATION =
  'A deterministic boundary candidate is not a supervisor-admitted local boundary byte binding and cannot authorize download, extraction, graph build, routing, or publication.';
const require = createRequire(import.meta.url);
const ROUTE_REAL_GRAPH_BUILD_POLICY = parseRealGraphBuildPolicyJson(
  ROUTE_REAL_GRAPH_BUILD_POLICY_JSON_TEXT,
);

export async function createBoundaryBufferCandidate(boundaryGeoJsonText) {
  const safeInput = parseBoundaryGeoJsonText(boundaryGeoJsonText);
  const core = singlePolygonFeature(safeInput);
  const coreGeometryCounts = validatePolygonGeometry(core.geometry, 'boundary core geometry');

  const bufferPolicy = ROUTE_REAL_GRAPH_BUILD_POLICY.boundary.buffer;
  const turfBuffer = await loadExactTurfBuffer(bufferPolicy);
  const buffered = turfBuffer(core, bufferPolicy.distance / 1_000, {
    units: 'kilometers',
    steps: bufferPolicy.steps,
  });
  if (!buffered) fail('boundary-buffer-empty', 'boundary buffer returned no geometry');
  const safeBuffer = cloneDescriptorSafe(buffered, 'buffered boundary GeoJSON');
  const bufferGeometryCounts = validatePolygonGeometry(safeBuffer.geometry, 'boundary buffer geometry');

  const normalizedBuffer = {
    type: 'Feature',
    properties: {},
    geometry: safeBuffer.geometry,
  };
  return freezeData({
    schema: REAL_GRAPH_BOUNDARY_CANDIDATE_SCHEMA,
    policyId: ROUTE_REAL_GRAPH_BUILD_POLICY.boundary.policyId,
    dataClassification: 'candidate-boundary-derivation',
    policyIdentity: ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    sourceGeometryIdentity: contentIdentity(core.geometry),
    bufferGeometryIdentity: contentIdentity(normalizedBuffer.geometry),
    algorithm: {
      package: bufferPolicy.builderPackage,
      version: bufferPolicy.builderVersion,
      integrity: bufferPolicy.builderIntegrity,
      function: bufferPolicy.builderFunction,
      distance: bufferPolicy.distance,
      unit: bufferPolicy.unit,
      steps: bufferPolicy.steps,
      outputCrs: bufferPolicy.outputCrs,
    },
    geometryCounts: {
      core: coreGeometryCounts,
      buffer: bufferGeometryCounts,
    },
    core,
    buffer: normalizedBuffer,
    authorityVerified: false,
    buildEligible: false,
    crossStatePolicy: ROUTE_REAL_GRAPH_BUILD_POLICY.boundary.crossState,
    limitations: [BOUNDARY_CANDIDATE_LIMITATION, BUILD_CLAIM_LIMITATION],
  }, 'route real graph boundary candidate');
}

async function loadExactTurfBuffer(bufferPolicy) {
  let lockData;
  try {
    lockData = JSON.parse(await readFile(new URL('../../../package-lock.json', import.meta.url), 'utf8'));
  } catch {
    fail('boundary-builder-lock', 'repository package lock could not be read as JSON');
  }
  const lockEntry = lockData?.packages?.['node_modules/@turf/turf'];
  if (
    lockEntry?.version !== bufferPolicy.builderVersion
    || lockEntry?.integrity !== bufferPolicy.builderIntegrity
  ) {
    fail('boundary-builder-lock', 'boundary builder version or integrity does not match the repository lock');
  }

  let moduleEntryPath;
  try {
    moduleEntryPath = require.resolve('@turf/turf');
  } catch {
    fail(
      'boundary-builder-unavailable',
      `boundary builder ${bufferPolicy.builderPackage} ${bufferPolicy.builderVersion} is unavailable`,
    );
  }

  const packageData = await readPackageMetadata(moduleEntryPath, bufferPolicy.builderPackage);
  if (packageData?.name !== bufferPolicy.builderPackage || packageData?.version !== bufferPolicy.builderVersion) {
    fail('boundary-builder-version', 'boundary builder package name or version does not match policy');
  }

  let turf;
  try {
    turf = await import('@turf/turf');
  } catch {
    fail('boundary-builder-unavailable', 'boundary builder module could not be loaded');
  }
  if (typeof turf.buffer !== 'function') {
    fail('boundary-builder-function', 'boundary builder does not export the exact buffer function');
  }
  return turf.buffer;
}

async function readPackageMetadata(moduleEntryPath, expectedPackageName) {
  let directory = dirname(moduleEntryPath);
  for (let depth = 0; depth < 8; depth += 1) {
    const packageJsonPath = join(directory, 'package.json');
    try {
      const value = JSON.parse(await readFile(packageJsonPath, 'utf8'));
      if (value?.name === expectedPackageName) return value;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        fail('boundary-builder-metadata', 'boundary builder package metadata could not be read as JSON');
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  fail('boundary-builder-metadata', 'boundary builder package metadata was not found beside the resolved module');
}

function singlePolygonFeature(value) {
  let feature;
  if (value?.type === 'FeatureCollection') {
    if (!Array.isArray(value.features) || value.features.length !== 1) {
      fail('boundary-feature-count', 'boundary FeatureCollection must contain exactly one feature');
    }
    [feature] = value.features;
  } else if (value?.type === 'Feature') {
    feature = value;
  } else {
    fail('boundary-feature-required', 'boundary input must be a Feature or single-feature FeatureCollection');
  }
  if (!feature || feature.type !== 'Feature' || !feature.geometry) {
    fail('boundary-feature-required', 'boundary input must contain one polygon feature');
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: cloneDescriptorSafe(feature.geometry, 'boundary feature.geometry'),
  };
}

function validatePolygonGeometry(geometry, label) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    fail('boundary-polygon-required', `${label} must be Polygon or MultiPolygon`);
  }
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
    fail('boundary-coordinates', `${label} must contain coordinates`);
  }
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (polygons.length > BOUNDARY_MAX_POLYGONS) {
    fail('boundary-polygon-limit', `${label} exceeds ${BOUNDARY_MAX_POLYGONS} polygons`);
  }
  let ringCount = 0;
  let pointCount = 0;
  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex += 1) {
    const polygon = polygons[polygonIndex];
    if (!Array.isArray(polygon) || polygon.length === 0) {
      fail('boundary-rings', `${label} polygon ${polygonIndex} must contain at least one ring`);
    }
    for (let ringIndex = 0; ringIndex < polygon.length; ringIndex += 1) {
      ringCount += 1;
      if (ringCount > BOUNDARY_MAX_RINGS) {
        fail('boundary-ring-limit', `${label} exceeds ${BOUNDARY_MAX_RINGS} total rings`);
      }
      const ringPoints = validateRing(
        polygon[ringIndex],
        `${label} polygon ${polygonIndex} ring ${ringIndex}`,
      );
      pointCount += ringPoints;
      if (pointCount > BOUNDARY_MAX_POINTS) {
        fail('boundary-point-limit', `${label} exceeds ${BOUNDARY_MAX_POINTS} total points`);
      }
    }
  }
  return { polygonCount: polygons.length, ringCount, pointCount };
}

function validateRing(ring, label) {
  if (!Array.isArray(ring) || ring.length < 4) {
    fail('boundary-ring-size', `${label} must contain at least four positions`);
  }
  if (ring.length > BOUNDARY_MAX_POINTS_PER_RING) {
    fail('boundary-ring-point-limit', `${label} exceeds ${BOUNDARY_MAX_POINTS_PER_RING} points`);
  }
  for (let index = 0; index < ring.length; index += 1) {
    const position = ring[index];
    if (
      !Array.isArray(position)
      || position.length !== 2
      || !Number.isFinite(position[0])
      || !Number.isFinite(position[1])
      || Object.is(position[0], -0)
      || Object.is(position[1], -0)
      || position[0] < -180
      || position[0] > 180
      || position[1] < -90
      || position[1] > 90
    ) {
      fail('boundary-position', `${label} position ${index} must be a finite CRS84 longitude/latitude pair`);
    }
  }
  const first = ring[0];
  const last = ring.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) {
    fail('boundary-ring-open', `${label} must be closed`);
  }
  return ring.length;
}
