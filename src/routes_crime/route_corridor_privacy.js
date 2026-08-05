import {
  ROUTE_CORRIDOR_BUFFER_LIMITS_M,
  validateKnownRouteInput,
} from './route_corridor_capability.js';

export const COARSE_ROUTE_ENVELOPE_GRID_M = 2_000;
export const COARSE_ROUTE_ENVELOPE_MAX_SPAN_M = 100_000;

const WEB_MERCATOR_RADIUS_M = 6_378_137;
const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;
const EARTH_RADIUS_M = 6_371_008.8;
const PROJECTED_CURVE_TOLERANCE_M = 0.25;
const MAX_CURVE_SUBDIVISION_DEPTH = 20;
const toRadians = (degrees) => degrees * Math.PI / 180;
const toDegrees = (radians) => radians * 180 / Math.PI;

/**
 * Builds the only route-derived value admitted to the remote source. The exact
 * route and its exact corridor remain caller-owned browser memory.
 */
export function createCoarseRouteEnvelope({ routeInput, bufferM } = {}) {
  const admission = validateKnownRouteInput(routeInput);
  if (!admission.ok) throw new Error(`Coarse envelope requires a valid known route: ${admission.reason}.`);
  if (!Number.isInteger(bufferM)
    || bufferM < ROUTE_CORRIDOR_BUFFER_LIMITS_M.min
    || bufferM > ROUTE_CORRIDOR_BUFFER_LIMITS_M.max) {
    throw new Error('Coarse envelope requires a valid integral metre buffer.');
  }

  const coordinates = admission.value.geometry.coordinates;
  const projectedVertices = coordinates.map(projectLonLatToWebMercator);
  rejectOversizedEnvelope(projectedVertices);
  const sampledCoordinates = sampleGreatCircleRoute(coordinates);
  const corridorMaxAbsLatitude = Math.max(...sampledCoordinates.map(([, latitude]) => Math.abs(latitude)))
    + toDegrees((bufferM + 1) / EARTH_RADIUS_M);
  if (corridorMaxAbsLatitude >= WEB_MERCATOR_MAX_LATITUDE) {
    throw new Error('Buffered route is outside the supported Web Mercator range.');
  }
  const projected = sampledCoordinates.map(projectLonLatToWebMercator);

  // EPSG:3857 scale grows with latitude. Expanding by buffer / cos(latitude)
  // makes the server envelope a conservative candidate superset; the exact
  // spherical corridor decision remains local.
  const projectedBufferM = conservativeGroundDistanceInWebMercator(bufferM, corridorMaxAbsLatitude)
    + PROJECTED_CURVE_TOLERANCE_M;
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const bbox = {
    minX: snapDown(Math.min(...xs) - projectedBufferM),
    minY: snapDown(Math.min(...ys) - projectedBufferM),
    maxX: snapUp(Math.max(...xs) + projectedBufferM),
    maxY: snapUp(Math.max(...ys) + projectedBufferM),
  };
  rejectOversizedEnvelope([[bbox.minX, bbox.minY], [bbox.maxX, bbox.maxY]]);
  return bbox;
}

export function projectLonLatToWebMercator([longitude, latitude]) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)
    || longitude < -180 || longitude > 180
    || latitude < -WEB_MERCATOR_MAX_LATITUDE || latitude > WEB_MERCATOR_MAX_LATITUDE) {
    throw new Error('Coordinate is outside the supported Web Mercator range.');
  }
  const x = WEB_MERCATOR_RADIUS_M * toRadians(longitude);
  const y = WEB_MERCATOR_RADIUS_M
    * Math.log(Math.tan(Math.PI / 4 + toRadians(latitude) / 2));
  return [x, y];
}

export function conservativeGroundDistanceInWebMercator(distanceM, maxAbsLatitude) {
  if (!Number.isFinite(distanceM) || distanceM < 0
    || !Number.isFinite(maxAbsLatitude) || maxAbsLatitude < 0
    || maxAbsLatitude >= WEB_MERCATOR_MAX_LATITUDE) {
    throw new Error('A supported ground distance and latitude are required.');
  }
  return distanceM * (WEB_MERCATOR_RADIUS_M / EARTH_RADIUS_M)
    / Math.cos(toRadians(maxAbsLatitude));
}

function snapDown(value) {
  return Math.floor(value / COARSE_ROUTE_ENVELOPE_GRID_M) * COARSE_ROUTE_ENVELOPE_GRID_M;
}

function snapUp(value) {
  return Math.ceil(value / COARSE_ROUTE_ENVELOPE_GRID_M) * COARSE_ROUTE_ENVELOPE_GRID_M;
}

export function sampleGreatCircleRoute(coordinates) {
  const samples = [coordinates[0]];
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    const angularLength = angularDistance(start, end);
    appendProjectedCurveSamples(samples, start, end, angularLength, 0, 1, 0);
  }
  return samples;
}

function appendProjectedCurveSamples(samples, start, end, angularLength, startFraction, endFraction, depth) {
  const midpointFraction = (startFraction + endFraction) / 2;
  const startCoordinate = interpolateGreatCircle(start, end, startFraction, angularLength);
  const endCoordinate = interpolateGreatCircle(start, end, endFraction, angularLength);
  const midpointCoordinate = interpolateGreatCircle(start, end, midpointFraction, angularLength);
  const projectedStart = projectLonLatToWebMercator(startCoordinate);
  const projectedEnd = projectLonLatToWebMercator(endCoordinate);
  const projectedMidpoint = projectLonLatToWebMercator(midpointCoordinate);
  const deviation = Math.max(
    Math.abs(projectedMidpoint[0] - (projectedStart[0] + projectedEnd[0]) / 2),
    Math.abs(projectedMidpoint[1] - (projectedStart[1] + projectedEnd[1]) / 2),
  );
  if (deviation > PROJECTED_CURVE_TOLERANCE_M && depth < MAX_CURVE_SUBDIVISION_DEPTH) {
    appendProjectedCurveSamples(samples, start, end, angularLength, startFraction, midpointFraction, depth + 1);
    appendProjectedCurveSamples(samples, start, end, angularLength, midpointFraction, endFraction, depth + 1);
    return;
  }
  samples.push(endCoordinate);
}

function interpolateGreatCircle([startLon, startLat], [endLon, endLat], fraction, angularLength) {
  if (angularLength < 1e-12) return [endLon, endLat];
  const scaleA = Math.sin((1 - fraction) * angularLength) / Math.sin(angularLength);
  const scaleB = Math.sin(fraction * angularLength) / Math.sin(angularLength);
  const startLatitude = toRadians(startLat);
  const startLongitude = toRadians(startLon);
  const endLatitude = toRadians(endLat);
  const endLongitude = toRadians(endLon);
  const x = scaleA * Math.cos(startLatitude) * Math.cos(startLongitude)
    + scaleB * Math.cos(endLatitude) * Math.cos(endLongitude);
  const y = scaleA * Math.cos(startLatitude) * Math.sin(startLongitude)
    + scaleB * Math.cos(endLatitude) * Math.sin(endLongitude);
  const z = scaleA * Math.sin(startLatitude) + scaleB * Math.sin(endLatitude);
  return [toDegrees(Math.atan2(y, x)), toDegrees(Math.atan2(z, Math.hypot(x, y)))];
}

function angularDistance([lonA, latA], [lonB, latB]) {
  const latitudeA = toRadians(latA);
  const latitudeB = toRadians(latB);
  const deltaLatitude = latitudeB - latitudeA;
  const deltaLongitude = toRadians(lonB - lonA);
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function rejectOversizedEnvelope(projectedCoordinates) {
  const xs = projectedCoordinates.map(([x]) => x);
  const ys = projectedCoordinates.map(([, y]) => y);
  if (Math.max(...xs) - Math.min(...xs) > COARSE_ROUTE_ENVELOPE_MAX_SPAN_M
    || Math.max(...ys) - Math.min(...ys) > COARSE_ROUTE_ENVELOPE_MAX_SPAN_M) {
    throw new Error('Coarse route envelope exceeds the supported maximum span.');
  }
}
