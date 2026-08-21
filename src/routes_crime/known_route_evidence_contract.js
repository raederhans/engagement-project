import { validateKnownRouteInput } from './route_corridor_capability.js';

export const KNOWN_ROUTE_EVIDENCE_SCHEMA = 'known-route-evidence-request/v1';
export const KNOWN_ROUTE_EVIDENCE_DATA_VERSION_CURRENT = 'current-observed';
export const KNOWN_ROUTE_EVIDENCE_TRANSPORT_MODES = Object.freeze([
  'walking',
  'cycling',
  'driving',
  'transit',
]);
export const KNOWN_ROUTE_EVIDENCE_LIMITS = Object.freeze({
  minVertices: 2,
  maxVertices: 256,
  canonicalCoordinatePrecision: 6,
  maximumInputCoordinatePrecision: 8,
  minimumLengthM: 30,
  maximumLengthM: 50_000,
  maximumJumpM: 5_000,
  philadelphiaBbox: Object.freeze([-75.30, 39.86, -74.95, 40.15]),
});

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const REQUEST_KEYS = new Set(['schema', 'routeInput', 'transportMode', 'requestedDataVersion']);
const ROUTE_KEYS = new Set(['inputKind', 'source', 'geometry']);
const GEOMETRY_KEYS = new Set(['type', 'coordinates']);
const EARTH_RADIUS_M = 6_371_008.8;
const REFERENCE_LONGITUDE = -75;
const REFERENCE_LATITUDE = 40;
const REFERENCE_LATITUDE_RADIANS = REFERENCE_LATITUDE * Math.PI / 180;

/**
 * Strict M4 admission. This is deliberately narrower than the legacy Known
 * Route contract and returns a session-only normalized route, never a share or
 * persistence payload.
 */
export function admitKnownRouteEvidenceRequest(value) {
  assertSafeData(value, 'request');
  requirePlainRecord(value, 'request');
  requireOnlyKeys(value, REQUEST_KEYS, 'request');
  if (value.schema !== KNOWN_ROUTE_EVIDENCE_SCHEMA) {
    throw new Error('Known Route evidence request schema is invalid.');
  }
  if (!KNOWN_ROUTE_EVIDENCE_TRANSPORT_MODES.includes(value.transportMode)) {
    throw new Error('Known Route evidence transport mode is unsupported.');
  }
  if (value.requestedDataVersion !== KNOWN_ROUTE_EVIDENCE_DATA_VERSION_CURRENT
    && !/^city-street-centerline:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.requestedDataVersion || '')) {
    throw new Error('Known Route evidence data version is invalid.');
  }

  requirePlainRecord(value.routeInput, 'route input');
  requireOnlyKeys(value.routeInput, ROUTE_KEYS, 'route input');
  requirePlainRecord(value.routeInput.geometry, 'route geometry');
  requireOnlyKeys(value.routeInput.geometry, GEOMETRY_KEYS, 'route geometry');
  const legacyAdmission = validateKnownRouteInput(value.routeInput);
  if (!legacyAdmission.ok) {
    throw new Error(`Known Route evidence route is invalid: ${legacyAdmission.reason}.`);
  }

  const coordinates = legacyAdmission.value.geometry.coordinates;
  if (coordinates.length < KNOWN_ROUTE_EVIDENCE_LIMITS.minVertices
    || coordinates.length > KNOWN_ROUTE_EVIDENCE_LIMITS.maxVertices) {
    throw new Error('Known Route evidence route vertex count is outside the admitted range.');
  }
  const normalizedCoordinates = coordinates.map((coordinate, index) => normalizeCoordinate(coordinate, index));
  const jumpsM = [];
  for (let index = 0; index < normalizedCoordinates.length - 1; index += 1) {
    const jumpM = haversineDistanceM(normalizedCoordinates[index], normalizedCoordinates[index + 1]);
    if (jumpM < 0.05) throw new Error('Known Route evidence route contains duplicate consecutive coordinates.');
    if (jumpM > KNOWN_ROUTE_EVIDENCE_LIMITS.maximumJumpM) {
      throw new Error('Known Route evidence route contains an unsupported jump.');
    }
    jumpsM.push(jumpM);
  }
  const lengthM = jumpsM.reduce((sum, valueM) => sum + valueM, 0);
  if (lengthM < KNOWN_ROUTE_EVIDENCE_LIMITS.minimumLengthM
    || lengthM > KNOWN_ROUTE_EVIDENCE_LIMITS.maximumLengthM) {
    throw new Error('Known Route evidence route length is outside the admitted range.');
  }
  if (hasSelfIntersection(normalizedCoordinates)) {
    throw new Error('Known Route evidence route self-intersects.');
  }

  const canonical = {
    schema: KNOWN_ROUTE_EVIDENCE_SCHEMA,
    source: legacyAdmission.value.source,
    transportMode: value.transportMode,
    requestedDataVersion: value.requestedDataVersion,
    geometry: { type: 'LineString', coordinates: normalizedCoordinates },
    bbox: bboxFor(normalizedCoordinates),
    lengthM: round(lengthM, 2),
  };
  return deepFreeze({
    ...canonical,
    sessionRouteIdentity: deterministicIdentity('route', canonical),
  });
}

export function createKnownRouteEvidenceRequest({
  routeInput,
  transportMode,
  requestedDataVersion = KNOWN_ROUTE_EVIDENCE_DATA_VERSION_CURRENT,
} = {}) {
  return admitKnownRouteEvidenceRequest({
    schema: KNOWN_ROUTE_EVIDENCE_SCHEMA,
    routeInput,
    transportMode,
    requestedDataVersion,
  });
}

/** A deliberately route-free projection suitable for shareable UI state. */
export function createKnownRouteEvidenceShareState({ language = 'en', expandedEvidence = [] } = {}) {
  if (!['en', 'zh'].includes(language)) throw new Error('Known Route share language is invalid.');
  if (!Array.isArray(expandedEvidence)
    || expandedEvidence.some((value) => !['reported-incidents', 'hin-crash', 'accessibility'].includes(value))) {
    throw new Error('Known Route share evidence view is invalid.');
  }
  return deepFreeze({
    schema: 'known-route-evidence-share/v1',
    view: 'known-route-evidence',
    language,
    expandedEvidence: [...new Set(expandedEvidence)].sort(),
    exactRouteIncluded: false,
    endpointsIncluded: false,
    transportModeIncluded: false,
  });
}

export function assertSafeData(value, label = 'value', depth = 0) {
  if (depth > 20) throw new Error(`${label} exceeds the supported nesting depth.`);
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (BLOCKED_KEYS.has(key)) throw new Error(`${label} contains a blocked property.`);
    assertSafeData(value[key], label, depth + 1);
  }
}

export function stableCanonicalText(value) {
  if (Array.isArray(value)) return `[${value.map(stableCanonicalText).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableCanonicalText(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function deterministicIdentity(namespace, value) {
  const text = `${namespace}:${stableCanonicalText(value)}`;
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${namespace}:${hash.toString(16).padStart(16, '0')}`;
}

export function haversineDistanceM([lonA, latA], [lonB, latB]) {
  const latitudeA = latA * Math.PI / 180;
  const latitudeB = latB * Math.PI / 180;
  const deltaLatitude = latitudeB - latitudeA;
  const deltaLongitude = (lonB - lonA) * Math.PI / 180;
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function projectPhiladelphiaCoordinate([longitude, latitude]) {
  return [
    EARTH_RADIUS_M * (longitude - REFERENCE_LONGITUDE) * Math.PI / 180 * Math.cos(REFERENCE_LATITUDE_RADIANS),
    EARTH_RADIUS_M * (latitude - REFERENCE_LATITUDE) * Math.PI / 180,
  ];
}

function normalizeCoordinate(value, index) {
  if (!Array.isArray(value) || value.length !== 2
    || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) {
    throw new Error(`Known Route evidence coordinate ${index + 1} is invalid.`);
  }
  const [minLon, minLat, maxLon, maxLat] = KNOWN_ROUTE_EVIDENCE_LIMITS.philadelphiaBbox;
  if (value[0] < minLon || value[0] > maxLon || value[1] < minLat || value[1] > maxLat) {
    throw new Error('Known Route evidence route is outside the admitted Philadelphia area.');
  }
  const precision = KNOWN_ROUTE_EVIDENCE_LIMITS.maximumInputCoordinatePrecision;
  if (Math.abs(value[0] - round(value[0], precision)) > 1e-10
    || Math.abs(value[1] - round(value[1], precision)) > 1e-10) {
    throw new Error('Known Route evidence coordinate precision exceeds the admitted limit.');
  }
  return [
    round(value[0], KNOWN_ROUTE_EVIDENCE_LIMITS.canonicalCoordinatePrecision),
    round(value[1], KNOWN_ROUTE_EVIDENCE_LIMITS.canonicalCoordinatePrecision),
  ];
}

function bboxFor(coordinates) {
  const longitudes = coordinates.map(([longitude]) => longitude);
  const latitudes = coordinates.map(([, latitude]) => latitude);
  return Object.freeze([
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ]);
}

function hasSelfIntersection(coordinates) {
  const projected = coordinates.map(projectPhiladelphiaCoordinate);
  for (let left = 0; left < projected.length - 1; left += 1) {
    for (let right = left + 2; right < projected.length - 1; right += 1) {
      if (left === 0 && right === projected.length - 2
        && sameCoordinate(projected[0], projected.at(-1))) continue;
      if (segmentsIntersect(projected[left], projected[left + 1], projected[right], projected[right + 1])) {
        return true;
      }
    }
  }
  return false;
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
  return Math.abs(cross) < 1e-7 ? 0 : Math.sign(cross);
}

function pointOnSegment([x, y], [startX, startY], [endX, endY]) {
  return x >= Math.min(startX, endX) - 1e-7 && x <= Math.max(startX, endX) + 1e-7
    && y >= Math.min(startY, endY) - 1e-7 && y <= Math.max(startY, endY) + 1e-7;
}

function sameCoordinate([xA, yA], [xB, yB]) {
  return Math.abs(xA - xB) < 1e-7 && Math.abs(yA - yB) < 1e-7;
}

function requirePlainRecord(value, label) {
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (prototype !== Object.prototype && prototype !== null)) {
    throw new Error(`Known Route evidence ${label} must be a plain record.`);
  }
}

function requireOnlyKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Known Route evidence ${label} has unknown fields.`);
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
