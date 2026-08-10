import { publicUrl } from '../utils/public_url.js';
import { validateKnownRouteInput } from './route_corridor_capability.js';

export const HIN_2025_LOCAL_SNAPSHOT_URL = publicUrl('data/hin_2025.snapshot.json');
export const HIN_2025_ASSOCIATION_TOLERANCE_M = 20;
export const HIN_2025_ASSOCIATION_RELATION = 'known-route-near-or-intersects-hin-snapshot';
export const HIN_2025_ASSOCIATION_METHOD = 'inclusive 20 m segment-to-segment distance in a local equirectangular projection fixed at 40°N';

const EARTH_RADIUS_M = 6_371_008.8;
const REFERENCE_LONGITUDE = -75;
const REFERENCE_LATITUDE = 40;
const REFERENCE_LATITUDE_RADIANS = REFERENCE_LATITUDE * Math.PI / 180;
const DISTANCE_EPSILON_M = 0.01;
let defaultSnapshotPromise = null;

/**
 * Loads only the versioned same-origin snapshot. The exact route is never an
 * argument to this function or part of its URL, request headers, or cache key.
 */
export async function loadHin2025Snapshot({
  request = fetch,
  url = HIN_2025_LOCAL_SNAPSHOT_URL,
} = {}) {
  const response = await request(url, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'force-cache',
    headers: { accept: 'application/json' },
  });
  if (!response?.ok) throw new Error(`HIN 2025 local snapshot failed (${response?.status || 'unknown'}).`);
  const snapshot = await response.json();
  validateRuntimeSnapshot(snapshot);
  return snapshot;
}

export function createHin2025ContextAdapter({
  loadSnapshot = loadDefaultSnapshot,
} = {}) {
  if (typeof loadSnapshot !== 'function') throw new Error('HIN 2025 adapter requires a snapshot loader.');
  return Object.freeze({
    async request({ routeInput } = {}) {
      const routeAdmission = validateKnownRouteInput(routeInput);
      if (!routeAdmission.ok) {
        return unavailableResult(routeAdmission.reason || 'route-unavailable');
      }
      try {
        // Deliberately no arguments: exact route geometry stays in this call.
        const snapshot = await loadSnapshot();
        return associateKnownRouteWithHin2025({
          routeInput: routeAdmission.value,
          snapshot,
        });
      } catch {
        return unavailableResult('snapshot-unavailable');
      }
    },
  });
}

const defaultAdapter = createHin2025ContextAdapter();
export const requestKnownRouteHin2025Context = (...args) => defaultAdapter.request(...args);

/**
 * Pure browser-memory association. A match says only that the known route is
 * within the fixed tolerance of snapshot geometry; it is not route identity,
 * crash occurrence, danger, prediction, or an official safety determination.
 */
export function associateKnownRouteWithHin2025({ routeInput, snapshot } = {}) {
  const routeAdmission = validateKnownRouteInput(routeInput);
  if (!routeAdmission.ok) throw new Error(`HIN 2025 context requires a valid known route: ${routeAdmission.reason}.`);
  validateRuntimeSnapshot(snapshot);

  const routeSegments = segmentsForLines([routeAdmission.value.geometry.coordinates]);
  const matchesByStreet = new Map();
  for (const row of snapshot.rows) {
    const [snapshotObjectId, streetName, , , geometryCode, coordinates] = row;
    const lines = geometryCode === 'L' ? [coordinates] : coordinates;
    const distanceM = minimumSegmentDistance(routeSegments, segmentsForLines(lines));
    if (distanceM > HIN_2025_ASSOCIATION_TOLERANCE_M + DISTANCE_EPSILON_M) continue;

    const key = streetName.trim();
    const current = matchesByStreet.get(key) || {
      streetName: key,
      relation: HIN_2025_ASSOCIATION_RELATION,
      minimumDistanceM: Infinity,
      snapshotObjectIds: [],
    };
    current.minimumDistanceM = Math.min(current.minimumDistanceM, distanceM);
    current.snapshotObjectIds.push(snapshotObjectId);
    matchesByStreet.set(key, current);
  }

  const matches = [...matchesByStreet.values()]
    .map((match) => ({
      ...match,
      minimumDistanceM: Number(match.minimumDistanceM.toFixed(2)),
      snapshotObjectIds: [...match.snapshotObjectIds].sort((left, right) => left - right),
    }))
    .sort((left, right) => left.streetName.localeCompare(right.streetName, 'en'));
  return {
    status: matches.length ? 'ready' : 'no-associated-streets',
    relation: HIN_2025_ASSOCIATION_RELATION,
    toleranceM: HIN_2025_ASSOCIATION_TOLERANCE_M,
    method: HIN_2025_ASSOCIATION_METHOD,
    matches,
    snapshot: publicSnapshotMetadata(snapshot.meta),
  };
}

async function loadDefaultSnapshot() {
  if (!defaultSnapshotPromise) {
    defaultSnapshotPromise = loadHin2025Snapshot()
      .catch((error) => {
        defaultSnapshotPromise = null;
        throw error;
      });
  }
  return defaultSnapshotPromise;
}

function unavailableResult(reason) {
  return {
    status: 'unavailable',
    reason,
    relation: HIN_2025_ASSOCIATION_RELATION,
    toleranceM: HIN_2025_ASSOCIATION_TOLERANCE_M,
    method: HIN_2025_ASSOCIATION_METHOD,
    matches: [],
    snapshot: null,
  };
}

function validateRuntimeSnapshot(snapshot) {
  if (snapshot?.schema !== 'phl-hin-2025-v1'
    || snapshot?.meta?.featureCount !== 162
    || snapshot.meta.objectIdScope !== 'snapshot-local-only'
    || snapshot.meta.networkVintage !== 2025
    || JSON.stringify(snapshot.meta.crashDataPeriod) !== JSON.stringify([2019, 2023])
    || !Array.isArray(snapshot.rows)
    || snapshot.rows.length !== 162) {
    throw new Error('HIN 2025 local snapshot contract is invalid.');
  }
  let previousIdentity = 0;
  const geometryCounts = { LineString: 0, MultiLineString: 0 };
  for (const row of snapshot.rows) {
    if (!Array.isArray(row) || row.length !== 6) throw new Error('HIN 2025 local row is invalid.');
    const [identity, streetName, lengthFt, shapeLength, geometryCode, coordinates] = row;
    const type = geometryCode === 'L' ? 'LineString' : geometryCode === 'M' ? 'MultiLineString' : null;
    const lines = type === 'LineString' ? [coordinates] : coordinates;
    if (!Number.isSafeInteger(identity) || identity <= previousIdentity
      || typeof streetName !== 'string' || !streetName.trim()
      || !Number.isFinite(lengthFt) || lengthFt < 0
      || !Number.isFinite(shapeLength) || shapeLength < 0
      || !type || !Array.isArray(lines) || !lines.length
      || lines.some((line) => !Array.isArray(line) || line.length < 2 || line.some((coordinate) => !isLonLat(coordinate)))) {
      throw new Error('HIN 2025 local snapshot row contract is invalid.');
    }
    previousIdentity = identity;
    geometryCounts[type] += 1;
  }
  if (JSON.stringify(geometryCounts) !== JSON.stringify({ LineString: 6, MultiLineString: 156 })) {
    throw new Error('HIN 2025 local snapshot geometry counts are invalid.');
  }
  return snapshot;
}

function publicSnapshotMetadata(meta) {
  return {
    dataset: meta.dataset,
    definition: meta.definition,
    crashDataPeriod: [...meta.crashDataPeriod],
    networkVintage: meta.networkVintage,
    retrievedAt: meta.retrievedAt,
    itemMetadataModifiedAt: meta.itemMetadataModifiedAt,
    layerDataEditedAt: meta.layerDataEditedAt,
    layerSchemaEditedAt: meta.layerSchemaEditedAt,
    sourceItem: meta.sourceItem,
    officialContext: meta.officialContext,
    licenseAndWarranty: meta.licenseAndWarranty,
    objectIdScope: meta.objectIdScope,
  };
}

function segmentsForLines(lines) {
  const segments = [];
  for (const line of lines) {
    for (let index = 0; index < line.length - 1; index += 1) {
      segments.push([project(line[index]), project(line[index + 1])]);
    }
  }
  return segments;
}

function minimumSegmentDistance(leftSegments, rightSegments) {
  let minimum = Infinity;
  for (const [leftStart, leftEnd] of leftSegments) {
    for (const [rightStart, rightEnd] of rightSegments) {
      minimum = Math.min(minimum, segmentDistance(leftStart, leftEnd, rightStart, rightEnd));
      if (minimum === 0) return 0;
    }
  }
  return minimum;
}

function project([longitude, latitude]) {
  return [
    EARTH_RADIUS_M * (longitude - REFERENCE_LONGITUDE) * Math.PI / 180 * Math.cos(REFERENCE_LATITUDE_RADIANS),
    EARTH_RADIUS_M * (latitude - REFERENCE_LATITUDE) * Math.PI / 180,
  ];
}

function segmentDistance(startA, endA, startB, endB) {
  if (segmentsIntersect(startA, endA, startB, endB)) return 0;
  return Math.min(
    pointToSegmentDistance(startA, startB, endB),
    pointToSegmentDistance(endA, startB, endB),
    pointToSegmentDistance(startB, startA, endA),
    pointToSegmentDistance(endB, startA, endA),
  );
}

function pointToSegmentDistance([x, y], [startX, startY], [endX, endY]) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared,
  ));
  return Math.hypot(x - (startX + fraction * deltaX), y - (startY + fraction * deltaY));
}

function segmentsIntersect(a, b, c, d) {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  if (first === 0 && pointOnSegment(c, a, b)) return true;
  if (second === 0 && pointOnSegment(d, a, b)) return true;
  if (third === 0 && pointOnSegment(a, c, d)) return true;
  if (fourth === 0 && pointOnSegment(b, c, d)) return true;
  return first !== second && third !== fourth;
}

function orientation([xA, yA], [xB, yB], [xC, yC]) {
  const cross = (xB - xA) * (yC - yA) - (yB - yA) * (xC - xA);
  return Math.abs(cross) < 1e-9 ? 0 : Math.sign(cross);
}

function pointOnSegment([x, y], [startX, startY], [endX, endY]) {
  return x >= Math.min(startX, endX) && x <= Math.max(startX, endX)
    && y >= Math.min(startY, endY) && y <= Math.max(startY, endY);
}

function isLonLat(value) {
  return Array.isArray(value) && value.length === 2
    && Number.isFinite(value[0]) && value[0] >= -180 && value[0] <= 180
    && Number.isFinite(value[1]) && value[1] >= -90 && value[1] <= 90;
}
