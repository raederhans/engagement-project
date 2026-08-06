#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  associateRouteCorridorIncidents,
  createRouteCorridorQueryFingerprint,
  evaluateRouteCorridorQuery,
  validateKnownRouteInput,
} from '../../src/routes_crime/route_corridor_capability.js';

const route = {
  inputKind: 'known-polyline',
  source: 'manual-draw',
  geometry: {
    type: 'LineString',
    coordinates: [[-75.1652, 39.9526], [-75.1552, 39.9526]],
  },
};

const coverage = {
  status: 'ready',
  source: 'Philadelphia Crime Incidents',
  availableStart: '2025-01-01',
  availableEndExclusive: '2026-01-01',
  availableMonths: ['2025-06'],
  unmappedIncidentCount: 2,
  unmappedIncidentScope: 'selected-time-and-filter-citywide',
  locationPrecision: 'Generalized to the hundred block by the source',
  recordGrain: 'reported_record',
  recordNote: 'A record is a source row and is not guaranteed to be one unique incident.',
  spatialRegion: 'Philadelphia',
  corridorCovered: true,
  spatialCoverageSource: 'Philadelphia Police GIS',
  conservativeBoundaryMarginM: 500,
  spatialDisclosure: 'coarse-bbox-only',
};

const selectedRange = { start: '2025-06-01', end: '2025-07-01' };
const filterKey = 'all-offenses';
const requestGeneration = 7;
const completeCorridorScope = {
  kind: 'route-corridor',
  complete: true,
  queryFingerprint: createRouteCorridorQueryFingerprint({ routeInput: route, bufferM: 100, selectedRange, filterKey }),
  requestGeneration,
};

function incident(id, coordinates, reportedAt = '2025-06-15T12:00:00Z') {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates },
    properties: { cartodb_id: id, dispatch_date_time: reportedAt },
  };
}

test('known route admission accepts explicit polylines and rejects raw GPS without pretending matching exists', () => {
  assert.deepEqual(validateKnownRouteInput(route), {
    ok: true,
    value: route,
  });
  assert.deepEqual(validateKnownRouteInput({ inputKind: 'raw-gps-trace', points: [] }), {
    ok: false,
    status: 'route-invalid',
    reason: 'raw-gps-matching-unavailable',
  });
});

test('corridor association includes endpoints and a boundary point, but excludes a point outside the selected historic period', () => {
  const result = associateRouteCorridorIncidents({
    route,
    bufferM: 100,
    selectedRange: { start: '2025-06-01', end: '2025-07-01' },
    incidents: [
      incident('endpoint', [-75.1652, 39.9534993]),
      incident('boundary', [-75.1602, 39.9534993]),
      incident('outside-time', [-75.1602, 39.9527], '2025-07-01T00:00:00Z'),
    ],
  });

  assert.deepEqual(result.matches.map(({ id }) => id), ['endpoint', 'boundary']);
  assert.equal(result.matches.every(({ relation }) => relation === 'reported-point-near-route'), true);
  assert.equal(result.excluded.outsideSelectedRange, 1);
});

test('corridor association deduplicates stable incident identities but reports unmapped points separately', () => {
  const result = associateRouteCorridorIncidents({
    route,
    bufferM: 100,
    selectedRange: { start: '2025-06-01', end: '2025-07-01' },
    incidents: [
      incident('same', [-75.1602, 39.9527]),
      incident('same', [-75.1602, 39.9527]),
      { type: 'Feature', id: 'no-point', geometry: null, properties: { cartodb_id: 'no-point', dispatch_date_time: '2025-06-15T12:00:00Z' } },
    ],
  });

  assert.deepEqual(result.matches.map(({ id }) => id), ['same']);
  assert.equal(result.excluded.duplicateStableIdentity, 1);
  assert.equal(result.unmapped.length, 1);
  assert.equal(result.unmapped[0].reason, 'incident-point-unavailable');
});

test('query result distinguishes coverage absence, source failure, supersession, and no mapped incidents from a ready result', () => {
  const base = {
    routeInput: route,
    bufferM: 100,
    selectedRange,
    coverage,
    incidentScope: completeCorridorScope,
    filterKey,
    requestGeneration,
    requestStatus: 'current',
    sourceStatus: 'ready',
    incidents: [],
  };

  assert.equal(evaluateRouteCorridorQuery({ ...base, coverage: { status: 'unavailable', source: 'Philadelphia Crime Incidents' } }).status, 'coverage-unavailable');
  assert.equal(evaluateRouteCorridorQuery({ ...base, sourceStatus: 'failed' }).status, 'source-failure');
  assert.equal(evaluateRouteCorridorQuery({ ...base, requestStatus: 'superseded' }).status, 'superseded');
  const noMatches = evaluateRouteCorridorQuery(base);
  assert.equal(noMatches.status, 'no-mapped-incidents');
  assert.equal(noMatches.coverage.unmappedIncidentCount, 2);

  const ready = evaluateRouteCorridorQuery({ ...base, incidents: [incident('near', [-75.1602, 39.9527])] });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.matches[0].relation, 'reported-point-near-route');
});

test('query rejects missing routes, invalid buffers, and selected periods outside verified coverage instead of producing a zero', () => {
  const base = {
    bufferM: 100,
    selectedRange,
    coverage,
    incidentScope: completeCorridorScope,
    filterKey,
    requestGeneration,
    requestStatus: 'current',
    sourceStatus: 'ready',
    incidents: [],
  };
  assert.equal(evaluateRouteCorridorQuery(base).status, 'route-required');
  assert.equal(evaluateRouteCorridorQuery({ ...base, routeInput: route, bufferM: 1 }).status, 'route-invalid');
  assert.equal(evaluateRouteCorridorQuery({ ...base, routeInput: route, selectedRange: { start: '2024-06-01', end: '2024-07-01' } }).status, 'coverage-unavailable');
});

test('only a complete route-corridor source scope and known unmapped evidence may make a zero-match claim', () => {
  const base = {
    routeInput: route,
    bufferM: 100,
    selectedRange,
    coverage,
    incidents: [],
    filterKey,
    requestGeneration,
    requestStatus: 'current',
    sourceStatus: 'ready',
  };
  assert.equal(evaluateRouteCorridorQuery(base).status, 'coverage-unavailable');
  assert.equal(evaluateRouteCorridorQuery({ ...base, incidentScope: { kind: 'map-viewport', complete: true } }).status, 'coverage-unavailable');
  assert.equal(evaluateRouteCorridorQuery({
    ...base,
    incidentScope: completeCorridorScope,
    coverage: { ...coverage, unmappedIncidentCount: null },
  }).status, 'coverage-unavailable');
  assert.equal(evaluateRouteCorridorQuery({
    ...base,
    incidentScope: completeCorridorScope,
    coverage: { ...coverage, unmappedIncidentScope: undefined },
  }).status, 'coverage-unavailable');
  assert.equal(evaluateRouteCorridorQuery({
    ...base,
    incidentScope: completeCorridorScope,
    coverage: { ...coverage, locationPrecision: undefined },
  }).status, 'coverage-unavailable');
  assert.equal(evaluateRouteCorridorQuery({
    ...base,
    incidentScope: completeCorridorScope,
    coverage: { ...coverage, availableMonths: [] },
  }).status, 'coverage-unavailable');
  assert.equal(evaluateRouteCorridorQuery({
    ...base,
    incidentScope: completeCorridorScope,
    coverage: { ...coverage, corridorCovered: false },
  }).status, 'coverage-unavailable');
});

test('a missing observed month inside the selected period is unavailable rather than zero', () => {
  const multiMonthRange = { start: '2025-06-15', end: '2025-08-02' };
  const scope = {
    kind: 'route-corridor',
    complete: true,
    queryFingerprint: createRouteCorridorQueryFingerprint({
      routeInput: route,
      bufferM: 100,
      selectedRange: multiMonthRange,
      filterKey,
    }),
    requestGeneration,
  };
  assert.equal(evaluateRouteCorridorQuery({
    routeInput: route,
    bufferM: 100,
    selectedRange: multiMonthRange,
    coverage: { ...coverage, availableMonths: ['2025-06', '2025-08'] },
    incidentScope: scope,
    filterKey,
    requestGeneration,
    requestStatus: 'current',
    sourceStatus: 'ready',
    incidents: [],
  }).status, 'coverage-unavailable');
});

test('unknown or non-current request/source states and malformed incident payloads fail closed', () => {
  const base = {
    routeInput: route,
    bufferM: 100,
    selectedRange,
    coverage,
    incidentScope: completeCorridorScope,
    filterKey,
    requestGeneration,
    requestStatus: 'current',
    sourceStatus: 'ready',
    incidents: [],
  };
  assert.equal(evaluateRouteCorridorQuery({ ...base, requestStatus: 'pending' }).status, 'pending');
  assert.equal(evaluateRouteCorridorQuery({ ...base, sourceStatus: 'partial' }).status, 'coverage-unavailable');
  assert.equal(evaluateRouteCorridorQuery({ ...base, requestStatus: 'typo' }).status, 'source-failure');
  assert.equal(evaluateRouteCorridorQuery({ ...base, incidents: null }).status, 'source-failure');
  assert.equal(evaluateRouteCorridorQuery({ ...base, incidents: { type: 'FeatureCollection', features: [] } }).status, 'no-mapped-incidents');
});

test('strict calendar dates, route-size limits, and valid duplicates are handled without hiding usable evidence', () => {
  const base = {
    routeInput: route,
    bufferM: 100,
    selectedRange: { start: '2025-06-01', end: '2025-07-01' },
    coverage,
    incidentScope: completeCorridorScope,
    filterKey,
    requestGeneration,
    requestStatus: 'current',
    sourceStatus: 'ready',
  };
  assert.equal(evaluateRouteCorridorQuery({ ...base, selectedRange: { start: '2025-02-30', end: '2025-03-01' }, incidents: [] }).status, 'route-invalid');
  assert.equal(validateKnownRouteInput({ ...route, geometry: { type: 'LineString', coordinates: Array.from({ length: 513 }, () => [-75.16, 39.95]) } }).reason, 'route-vertex-limit-exceeded');

  const result = associateRouteCorridorIncidents({
    route,
    bufferM: 100,
    selectedRange: base.selectedRange,
    incidents: [
      { type: 'Feature', id: 'same', geometry: null, properties: { cartodb_id: 'same', dispatch_date_time: '2025-06-15T12:00:00Z' } },
      incident('same', [-75.1602, 39.9527]),
    ],
  });
  assert.deepEqual(result.matches.map(({ id }) => id), ['same']);
  assert.equal(result.unmapped.length, 1);
});

test('zero-result admission requires explicit status, payload, and a coordinator scope fingerprint for this exact query', () => {
  const base = {
    routeInput: route,
    bufferM: 100,
    selectedRange,
    coverage,
    incidentScope: completeCorridorScope,
    filterKey,
    requestGeneration,
    requestStatus: 'current',
    sourceStatus: 'ready',
    incidents: [],
  };
  assert.equal(evaluateRouteCorridorQuery({ ...base, requestStatus: undefined }).status, 'source-failure');
  assert.equal(evaluateRouteCorridorQuery({ ...base, sourceStatus: undefined }).status, 'source-failure');
  assert.equal(evaluateRouteCorridorQuery({ ...base, incidents: undefined }).status, 'source-failure');
  assert.equal(evaluateRouteCorridorQuery({
    ...base,
    incidentScope: { ...completeCorridorScope, queryFingerprint: createRouteCorridorQueryFingerprint({ routeInput: route, bufferM: 200, selectedRange, filterKey }) },
  }).status, 'coverage-unavailable');
  assert.equal(evaluateRouteCorridorQuery({
    ...base,
    incidentScope: { ...completeCorridorScope, requestGeneration: requestGeneration - 1 },
  }).status, 'superseded');
});

test('stable-ID association chooses corridor evidence independent of duplicate source ordering', () => {
  const outside = incident('same-place', [-75.1602, 39.9600]);
  const inside = incident('same-place', [-75.1602, 39.9527]);
  for (const incidents of [[outside, inside], [inside, outside]]) {
    const result = associateRouteCorridorIncidents({ route, bufferM: 100, selectedRange, incidents });
    assert.deepEqual(result.matches.map(({ id }) => id), ['same-place']);
    assert.equal(result.excluded.duplicateStableIdentity, 1);
  }
});

test('stable-ID association uses a deterministic tie-breaker for equal-distance conflicting records', () => {
  const alpha = { ...incident('same-distance', [-75.1602, 39.9527]), properties: { cartodb_id: 'same-distance', dispatch_date_time: '2025-06-15T12:00:00Z', text_general_code: 'ALPHA' } };
  const bravo = { ...incident('same-distance', [-75.1602, 39.9527]), properties: { cartodb_id: 'same-distance', dispatch_date_time: '2025-06-15T12:00:00Z', text_general_code: 'BRAVO' } };
  for (const incidents of [[alpha, bravo], [bravo, alpha]]) {
    const result = associateRouteCorridorIncidents({ route, bufferM: 100, selectedRange, incidents });
    assert.equal(result.matches[0].incident.properties.text_general_code, 'ALPHA');
  }
});
