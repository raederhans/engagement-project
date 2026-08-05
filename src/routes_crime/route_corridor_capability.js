export const ROUTE_CORRIDOR_BUFFER_LIMITS_M = Object.freeze({ min: 10, max: 10_000 });
export const ROUTE_CORRIDOR_INPUT_LIMITS = Object.freeze({ maxRouteVertices: 512, maxIncidentFeatures: 2_000 });

const EARTH_RADIUS_M = 6_371_008.8;
const toRadians = (degrees) => degrees * Math.PI / 180;

const KNOWN_POLYLINE_SOURCES = new Set([
  'user-provided',
  'manual-draw',
  'imported-route',
]);

/**
 * Admits only an explicit, known LineString.  Raw GPS traces are intentionally
 * rejected because this repository has no reliable map-matching contract.
 */
export function validateKnownRouteInput(routeInput) {
  if (routeInput?.inputKind === 'raw-gps-trace') {
    return failure('route-invalid', 'raw-gps-matching-unavailable');
  }
  if (!routeInput || typeof routeInput !== 'object') {
    return failure('route-required', 'route-required');
  }
  if (routeInput.inputKind !== 'known-polyline') {
    return failure('route-invalid', 'unsupported-route-input');
  }
  if (!KNOWN_POLYLINE_SOURCES.has(routeInput.source)) {
    return failure('route-invalid', 'unsupported-route-source');
  }
  if (routeInput.geometry?.coordinates?.length > ROUTE_CORRIDOR_INPUT_LIMITS.maxRouteVertices) {
    return failure('route-invalid', 'route-vertex-limit-exceeded');
  }
  if (!isLineString(routeInput.geometry)) {
    return failure('route-invalid', 'invalid-route-polyline');
  }
  return { ok: true, value: routeInput };
}

/**
 * Produces the opaque equality value a coordinator records with the exact
 * corridor request it fulfilled. It is an in-memory admission check, never a
 * persistence or URL format.
 */
export function createRouteCorridorQueryFingerprint({ routeInput, bufferM, selectedRange, filterKey } = {}) {
  const routeAdmission = validateKnownRouteInput(routeInput);
  if (!routeAdmission.ok || !isValidBufferM(bufferM) || !isValidSelectedRange(selectedRange) || !isFilterKey(filterKey)) {
    throw new Error('Route corridor fingerprint requires a valid explicit query.');
  }
  return JSON.stringify({
    geometry: routeAdmission.value.geometry.coordinates,
    bufferM,
    start: selectedRange.start,
    end: selectedRange.end,
    filterKey,
  });
}

/**
 * Spatially associates already-loaded reported incident points with a known
 * route. It does not fetch, persist, or imply that an incident happened on the
 * route: `reported-point-near-route` is the only positive relation it emits.
 */
export function associateRouteCorridorIncidents({
  route,
  bufferM,
  selectedRange,
  incidents,
} = {}) {
  const routeAdmission = validateKnownRouteInput(route);
  if (!routeAdmission.ok) throw new Error(`Route corridor requires a valid route: ${routeAdmission.reason}`);
  if (!isValidBufferM(bufferM)) throw new Error('Route corridor buffer must be an integral metre value within bounds.');
  if (!isValidSelectedRange(selectedRange)) throw new Error('Route corridor requires a valid half-open historic date range.');

  const normalizedIncidents = normalizeIncidentFeatures(incidents);
  if (!normalizedIncidents.ok) throw new Error(`Route corridor incident input is invalid: ${normalizedIncidents.reason}`);

  const matches = [];
  const unmapped = [];
  const excluded = {
    duplicateStableIdentity: 0,
    outsideCorridor: 0,
    outsideSelectedRange: 0,
  };
  const candidates = [];
  for (const incident of normalizedIncidents.features) {
    const stableId = stableIncidentIdentity(incident);
    const reportedAt = reportedAtFor(incident);
    if (!reportedAt) {
      unmapped.push(unmappedIncident(incident, stableId, 'incident-reported-time-unavailable'));
      continue;
    }
    if (!isInHalfOpenRange(reportedAt, selectedRange)) {
      excluded.outsideSelectedRange += 1;
      continue;
    }

    const coordinates = incident?.geometry?.type === 'Point' ? incident.geometry.coordinates : null;
    if (!isLonLat(coordinates)) {
      unmapped.push(unmappedIncident(incident, stableId, 'incident-point-unavailable'));
      continue;
    }
    candidates.push({ incident, stableId, coordinates });
  }

  const groups = new Map();
  candidates.forEach((candidate, index) => {
    const key = candidate.stableId || `unstable:${index}`;
    const group = groups.get(key) || [];
    group.push({
      ...candidate,
      distanceM: pointToLineDistanceM(candidate.coordinates, routeAdmission.value.geometry.coordinates),
    });
    groups.set(key, group);
  });
  for (const group of groups.values()) {
    const sorted = [...group].sort((left, right) => (
      left.distanceM - right.distanceM
      || stableSerialization(left.incident).localeCompare(stableSerialization(right.incident))
    ));
    const canonical = sorted[0];
    if (canonical.stableId) excluded.duplicateStableIdentity += sorted.length - 1;
    if (canonical.distanceM > bufferM + 0.01) {
      excluded.outsideCorridor += 1;
      continue;
    }
    matches.push({
      id: canonical.stableId,
      distanceM: canonical.distanceM,
      relation: 'reported-point-near-route',
      incident: canonical.incident,
    });
  }

  return { matches, unmapped, excluded };
}

/**
 * Produces the state machine consumed by a future lazy UI adapter.  It keeps
 * unavailable coverage, source failure, stale work, and no match separate.
 */
export function evaluateRouteCorridorQuery({
  routeInput,
  bufferM,
  selectedRange,
  coverage,
  incidentScope,
  sourceStatus,
  requestStatus,
  incidents,
  filterKey,
  requestGeneration,
} = {}) {
  const normalizedCoverage = normalizeCoverage(coverage);
  if (requestStatus === 'superseded' || requestStatus === 'aborted') return result('superseded', { coverage: normalizedCoverage });
  if (requestStatus === 'pending' || requestStatus === 'loading') return result('pending', { coverage: normalizedCoverage });
  if (requestStatus !== 'current') return result('source-failure', { reason: 'invalid-request-status', coverage: normalizedCoverage });
  if (sourceStatus === 'loading' || sourceStatus === 'pending') return result('pending', { coverage: normalizedCoverage });
  if (sourceStatus === 'partial') return result('coverage-unavailable', { reason: 'partial-source-result', coverage: normalizedCoverage });
  if (sourceStatus === 'failed') return result('source-failure', { coverage: normalizedCoverage });
  if (sourceStatus !== 'ready') return result('source-failure', { reason: 'invalid-source-status', coverage: normalizedCoverage });

  const routeAdmission = validateKnownRouteInput(routeInput);
  if (!routeAdmission.ok) return result(routeAdmission.status, { reason: routeAdmission.reason, coverage: normalizedCoverage });
  if (!isValidBufferM(bufferM)) return result('route-invalid', { reason: 'invalid-buffer-metres', coverage: normalizedCoverage });
  if (!isValidSelectedRange(selectedRange)) return result('route-invalid', { reason: 'invalid-selected-range', coverage: normalizedCoverage });
  if (!isFilterKey(filterKey)) return result('source-failure', { reason: 'invalid-filter-key', coverage: normalizedCoverage });
  if (!Number.isInteger(requestGeneration) || requestGeneration < 0) {
    return result('source-failure', { reason: 'invalid-request-generation', coverage: normalizedCoverage });
  }

  if (!normalizedCoverage || !Number.isInteger(normalizedCoverage.unmappedIncidentCount)
    || !isRangeCovered(selectedRange, normalizedCoverage)) {
    return result('coverage-unavailable', { coverage: normalizedCoverage });
  }
  const expectedFingerprint = createRouteCorridorQueryFingerprint({ routeInput, bufferM, selectedRange, filterKey });
  const scopeAdmission = validateRouteCorridorScope(incidentScope, expectedFingerprint, requestGeneration);
  if (!scopeAdmission.ok) {
    if (scopeAdmission.status === 'superseded') return result('superseded', { reason: scopeAdmission.reason, coverage: normalizedCoverage });
    return result('coverage-unavailable', { reason: 'spatial-coverage-unavailable', coverage: normalizedCoverage });
  }
  const normalizedIncidents = normalizeIncidentFeatures(incidents);
  if (!normalizedIncidents.ok) return result('source-failure', { reason: normalizedIncidents.reason, coverage: normalizedCoverage });

  const association = associateRouteCorridorIncidents({
    route: routeAdmission.value,
    bufferM,
    selectedRange,
    incidents: normalizedIncidents.features,
  });
  if (association.matches.length === 0) return result('no-mapped-incidents', { coverage: normalizedCoverage, ...association });
  return result('ready', { coverage: normalizedCoverage, ...association });
}

function failure(status, reason) {
  return { ok: false, status, reason };
}

function result(status, details = {}) {
  return { status, matches: [], unmapped: [], excluded: emptyExcluded(), ...details };
}

function emptyExcluded() {
  return { duplicateStableIdentity: 0, outsideCorridor: 0, outsideSelectedRange: 0 };
}

function isLineString(geometry) {
  return geometry?.type === 'LineString'
    && Array.isArray(geometry.coordinates)
    && geometry.coordinates.length >= 2
    && geometry.coordinates.every(isLonLat)
    && geometry.coordinates.some(([lon, lat]) => lon !== geometry.coordinates[0][0] || lat !== geometry.coordinates[0][1]);
}

function isLonLat(value) {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && value[0] >= -180
    && value[0] <= 180
    && value[1] >= -90
    && value[1] <= 90;
}

function isValidBufferM(value) {
  return Number.isInteger(value)
    && value >= ROUTE_CORRIDOR_BUFFER_LIMITS_M.min
    && value <= ROUTE_CORRIDOR_BUFFER_LIMITS_M.max;
}

function isValidSelectedRange(range) {
  const start = parseCalendarDate(range?.start);
  const end = parseCalendarDate(range?.end);
  return Boolean(start && end && start < end);
}

function isFilterKey(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function stableIncidentIdentity(incident) {
  const value = incident?.properties?.cartodb_id ?? incident?.id ?? null;
  return typeof value === 'string' || Number.isFinite(value) ? String(value) : null;
}

function reportedAtFor(incident) {
  const value = incident?.properties?.dispatch_date_time;
  const date = typeof value === 'string' ? new Date(value) : null;
  return date && Number.isFinite(date.valueOf()) ? date : null;
}

function isInHalfOpenRange(date, range) {
  return date >= parseCalendarDate(range.start) && date < parseCalendarDate(range.end);
}

function unmappedIncident(incident, id, reason) {
  return { id, reason, incident };
}

function normalizeCoverage(coverage) {
  if (coverage?.status !== 'ready'
    || typeof coverage.source !== 'string'
    || !isValidSelectedRange({ start: coverage.availableStart, end: coverage.availableEndExclusive })) {
    return null;
  }
  return {
    status: 'ready',
    source: coverage.source,
    availableStart: coverage.availableStart,
    availableEndExclusive: coverage.availableEndExclusive,
    unmappedIncidentCount: Number.isInteger(coverage.unmappedIncidentCount) && coverage.unmappedIncidentCount >= 0
      ? coverage.unmappedIncidentCount : null,
  };
}

function isRangeCovered(range, coverage) {
  return parseCalendarDate(range.start) >= parseCalendarDate(coverage.availableStart)
    && parseCalendarDate(range.end) <= parseCalendarDate(coverage.availableEndExclusive);
}

function parseCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? parsed : null;
}

function validateRouteCorridorScope(scope, expectedFingerprint, requestGeneration) {
  if (scope?.kind !== 'route-corridor' || scope.complete !== true || typeof scope.queryFingerprint !== 'string') {
    return { ok: false, status: 'coverage-unavailable', reason: 'spatial-coverage-unavailable' };
  }
  if (!Number.isInteger(scope.requestGeneration) || scope.requestGeneration !== requestGeneration) {
    return { ok: false, status: 'superseded', reason: 'scope-generation-mismatch' };
  }
  if (scope.queryFingerprint !== expectedFingerprint) {
    return { ok: false, status: 'coverage-unavailable', reason: 'scope-query-mismatch' };
  }
  return { ok: true };
}

function normalizeIncidentFeatures(value) {
  const features = Array.isArray(value)
    ? value
    : value?.type === 'FeatureCollection' && Array.isArray(value.features) ? value.features : null;
  if (!features) return { ok: false, reason: 'invalid-source-data' };
  if (features.length > ROUTE_CORRIDOR_INPUT_LIMITS.maxIncidentFeatures) {
    return { ok: false, reason: 'incident-feature-limit-exceeded' };
  }
  return { ok: true, features };
}

function stableSerialization(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialization).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialization(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Minimum spherical great-circle distance from a coordinate to a LineString.
 * The explicit endpoint comparison creates the required round end caps; an
 * incident exactly on the chosen buffer boundary is included by the caller's
 * small floating-point tolerance. This is an analytic spatial approximation,
 * not a claim about source geocoding precision or a legal boundary.
 */
function pointToLineDistanceM(coordinate, lineCoordinates) {
  let minimum = Infinity;
  for (let index = 0; index < lineCoordinates.length - 1; index += 1) {
    minimum = Math.min(minimum, pointToSegmentDistanceM(
      coordinate,
      lineCoordinates[index],
      lineCoordinates[index + 1],
    ));
  }
  return minimum;
}

function pointToSegmentDistanceM(pointCoordinate, start, end) {
  const segmentAngularLength = angularDistance(start, end);
  if (segmentAngularLength === 0) return angularDistance(pointCoordinate, start) * EARTH_RADIUS_M;

  const startToPoint = angularDistance(start, pointCoordinate);
  const bearingDifference = initialBearing(start, pointCoordinate) - initialBearing(start, end);
  const alongTrack = Math.atan2(
    Math.sin(startToPoint) * Math.cos(bearingDifference),
    Math.cos(startToPoint),
  );
  if (alongTrack <= 0) return startToPoint * EARTH_RADIUS_M;
  if (alongTrack >= segmentAngularLength) return angularDistance(pointCoordinate, end) * EARTH_RADIUS_M;

  const crossTrack = Math.asin(Math.min(1, Math.abs(Math.sin(startToPoint) * Math.sin(bearingDifference))));
  return crossTrack * EARTH_RADIUS_M;
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

function initialBearing([fromLon, fromLat], [toLon, toLat]) {
  const longitudeDelta = toRadians(toLon - fromLon);
  const latitudeA = toRadians(fromLat);
  const latitudeB = toRadians(toLat);
  return Math.atan2(
    Math.sin(longitudeDelta) * Math.cos(latitudeB),
    Math.cos(latitudeA) * Math.sin(latitudeB)
      - Math.sin(latitudeA) * Math.cos(latitudeB) * Math.cos(longitudeDelta),
  );
}
