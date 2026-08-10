#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createManualRouteInput,
  parseRouteGeoJsonText,
  readRouteGeoJsonFile,
  ROUTE_GEOJSON_MAX_FILE_BYTES,
  ROUTE_GEOJSON_MAX_TEXT_CHARS,
} from '../../src/routes_crime/route_input.js';
import {
  COARSE_ROUTE_ENVELOPE_GRID_M,
  createCoarseRouteEnvelope,
  projectLonLatToWebMercator,
} from '../../src/routes_crime/route_corridor_privacy.js';
import { buildRouteCorridorEnvelopeSQL } from '../../src/utils/sql.js';
import { fetchRouteCorridorEnvelope } from '../../src/api/route_corridor.js';
import {
  createRouteCorridorFilterKey,
  createRouteCorridorRequestOwner,
} from '../../src/routes_crime/route_corridor_request_owner.js';
import {
  createRouteCorridorCrimeCoordinator,
  createRouteCorridorModuleFacade,
} from '../../src/routes_crime/route_corridor_crime_coordinator.js';

const coordinates = [[-75.1652, 39.9526], [-75.1552, 39.9526]];
const route = createManualRouteInput(coordinates);
const selectedRange = { start: '2025-06-01', end: '2025-07-01' };

function feature(id, point = [-75.1602, 39.9527]) {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: point },
    properties: {
      cartodb_id: id,
      dispatch_date_time: '2025-06-15T12:00:00Z',
      text_general_code: 'Thefts',
      ucr_general: '0600',
      dc_dist: '09',
      location_block: '1500 BLOCK MARKET ST',
    },
  };
}

function envelope(overrides = {}) {
  return {
    candidateTotal: 1,
    returnedCandidateCount: 1,
    truncated: false,
    coverageMin: '2006-01-01',
    coverageMax: '2026-08-04',
    coverageMonths: ['2025-06'],
    sourceWideUnmappedCount: 3,
    candidates: [feature(101)],
    ...overrides,
  };
}

const coveredSpatialCoverage = async () => ({
  status: 'ready',
  region: 'Philadelphia',
  corridorCovered: true,
  conservativeMarginM: 500,
  source: 'Philadelphia Police GIS',
  sourceKind: 'live',
  method: 'city-limit-interior',
});

function createTestRequestOwner(options = {}) {
  return createRouteCorridorRequestOwner({
    fetchSpatialCoverage: coveredSpatialCoverage,
    ...options,
  });
}

test('explicit GeoJSON import and manual coordinates create known polylines without a GPS matching claim', async () => {
  const imported = parseRouteGeoJsonText(JSON.stringify({
    type: 'Feature',
    properties: { name: 'chosen route' },
    geometry: { type: 'LineString', coordinates },
  }));
  assert.equal(imported.inputKind, 'known-polyline');
  assert.equal(imported.source, 'imported-route');
  assert.deepEqual(imported.geometry.coordinates, coordinates);
  assert.deepEqual(route, {
    inputKind: 'known-polyline',
    source: 'manual-draw',
    geometry: { type: 'LineString', coordinates },
  });

  const fromFile = await readRouteGeoJsonFile({
    name: 'route.geojson',
    text: async () => JSON.stringify({ type: 'LineString', coordinates }),
  });
  assert.equal(fromFile.source, 'imported-route');
  assert.throws(
    () => parseRouteGeoJsonText(JSON.stringify({ type: 'FeatureCollection', features: [] })),
    /exactly one LineString/i,
  );
  assert.throws(() => createManualRouteInput([coordinates[0]]), /valid known route/i);
});

test('route import rejects oversized text, files, and coordinate arrays before cloning or parsing them', async () => {
  assert.throws(
    () => parseRouteGeoJsonText(' '.repeat(ROUTE_GEOJSON_MAX_TEXT_CHARS + 1)),
    /too large/i,
  );
  let read = false;
  await assert.rejects(
    readRouteGeoJsonFile({
      size: ROUTE_GEOJSON_MAX_FILE_BYTES + 1,
      text: async () => { read = true; return '{}'; },
    }),
    /too large/i,
  );
  assert.equal(read, false);
  assert.throws(
    () => createManualRouteInput(Array.from({ length: 513 }, () => [-75.16, 39.95])),
    /vertex limit/i,
  );
});

test('scheme B emits a conservative outward-snapped coarse envelope and never route vertices', () => {
  const bbox = createCoarseRouteEnvelope({ routeInput: route, bufferM: 100 });
  assert.deepEqual(Object.keys(bbox).sort(), ['maxX', 'maxY', 'minX', 'minY']);
  for (const value of Object.values(bbox)) {
    assert.equal(Number.isInteger(value / COARSE_ROUTE_ENVELOPE_GRID_M), true);
  }

  const projected = coordinates.map(projectLonLatToWebMercator);
  const conservativeMargin = 100 * (6_378_137 / 6_371_008.8) / Math.cos(40 * Math.PI / 180);
  assert.ok(bbox.minX <= Math.min(...projected.map(([x]) => x)) - conservativeMargin);
  assert.ok(bbox.maxX >= Math.max(...projected.map(([x]) => x)) + conservativeMargin);
  assert.ok(bbox.minY <= Math.min(...projected.map(([, y]) => y)) - conservativeMargin);
  assert.ok(bbox.maxY >= Math.max(...projected.map(([, y]) => y)) + conservativeMargin);
  assert.equal(JSON.stringify(bbox).includes('-75.1652'), false);
  assert.throws(
    () => createCoarseRouteEnvelope({
      routeInput: createManualRouteInput([[-76, 39.9], [-74, 39.9]]),
      bufferM: 100,
    }),
    /maximum span/i,
  );
});

test('coarse envelope contains the locally evaluated great-circle segment between route vertices', () => {
  const gridBand = Math.floor(projectLonLatToWebMercator([0, 40])[1] / COARSE_ROUTE_ENVELOPE_GRID_M);
  const latitude = inverseWebMercatorLatitude(gridBand * COARSE_ROUTE_ENVELOPE_GRID_M + 1_950);
  const longRoute = createManualRouteInput([[-75.425, latitude], [-74.575, latitude]]);
  const bbox = createCoarseRouteEnvelope({ routeInput: longRoute, bufferM: 10 });
  const midpoint = greatCircleMidpoint(longRoute.geometry.coordinates[0], longRoute.geometry.coordinates[1]);
  const [, midpointY] = projectLonLatToWebMercator(midpoint);
  const projectedBuffer = 10 / Math.cos(Math.abs(midpoint[1]) * Math.PI / 180);
  assert.ok(bbox.maxY >= midpointY + projectedBuffer);
});

test('coarse envelope stays conservative near the supported Web Mercator latitude limit', () => {
  const latitude = 82.90074;
  const halfLongitudeSpan = (80_000 / 6_378_137) * 90 / Math.PI;
  const highLatitudeRoute = createManualRouteInput([
    [-halfLongitudeSpan, latitude],
    [halfLongitudeSpan, latitude],
  ]);
  const bbox = createCoarseRouteEnvelope({ routeInput: highLatitudeRoute, bufferM: 10 });
  const midpoint = greatCircleMidpoint(
    highLatitudeRoute.geometry.coordinates[0],
    highLatitudeRoute.geometry.coordinates[1],
  );
  const [, midpointY] = projectLonLatToWebMercator(midpoint);
  const projectedBuffer = 10 * (6_378_137 / 6_371_008.8)
    / Math.cos(Math.abs(midpoint[1]) * Math.PI / 180);
  assert.ok(bbox.maxY >= midpointY + projectedBuffer);
});

test('route SQL is one deterministic statement with complete-count, stable-limit, coverage, and unmapped evidence', () => {
  const sql = buildRouteCorridorEnvelopeSQL({
    start: selectedRange.start,
    end: selectedRange.end,
    types: ['Thefts'],
    drilldownCodes: ['Thefts'],
    bbox: { minX: -8370000, minY: 4850000, maxX: -8366000, maxY: 4854000 },
  });
  assert.match(sql, /^WITH candidates AS \(/);
  assert.match(sql, /the_geom_webmercator && ST_MakeEnvelope\(-8370000, 4850000, -8366000, 4854000, 3857\)/);
  assert.match(sql, /ORDER BY cartodb_id ASC\s+LIMIT 2001/);
  assert.match(sql, /COUNT\(\*\)::integer AS candidate_total/);
  assert.match(sql, /COUNT\(\*\) FILTER \(WHERE the_geom IS NULL OR the_geom_webmercator IS NULL\)::integer AS source_wide_unmapped_count/);
  assert.match(sql, /MIN\(\(dispatch_date_time AT TIME ZONE 'America\/New_York'\)::date\)::text AS coverage_min/);
  assert.match(sql, /jsonb_agg\(DISTINCT to_char\(dispatch_date_time AT TIME ZONE 'America\/New_York', 'YYYY-MM'\)/);
  assert.match(sql, /'coverageMonths', coverage_stats\.coverage_months/);
  assert.match(sql, /ST_AsGeoJSON\(bounded_candidates\.the_geom\)::json/);
  assert.match(sql, /json_agg\([\s\S]+ORDER BY bounded_candidates\.cartodb_id ASC\s*\)/);
  assert.equal((sql.match(/;\s*$/g) || []).length, 1);
  assert.equal(sql.slice(0, -1).includes(';'), false);
  assert.throws(() => buildRouteCorridorEnvelopeSQL({
    start: "2025-06-01'; SELECT pg_sleep(1); --",
    end: selectedRange.end,
    types: [],
    bbox: { minX: 1, minY: 1, maxX: 2, maxY: 2 },
  }), /invalid ISO date/i);
  assert.throws(() => buildRouteCorridorEnvelopeSQL({
    start: '2025-02-30',
    end: selectedRange.end,
    types: [],
    bbox: { minX: 1, minY: 1, maxX: 2, maxY: 2 },
  }), /invalid ISO date/i);
});

test('route source uses one uncached, non-retried POST and receives only coarse query parameters', async () => {
  let observed;
  const result = await fetchRouteCorridorEnvelope({
    ...selectedRange,
    types: ['Thefts'],
    drilldownCodes: ['Thefts'],
    bbox: { minX: -8370000, minY: 4850000, maxX: -8366000, maxY: 4854000 },
  }, {
    request: async (url, options) => {
      observed = { url, options };
      return { rows: [{ envelope: envelope() }] };
    },
  });
  assert.deepEqual(result, envelope());
  assert.equal(observed.options.method, 'POST');
  assert.equal(observed.options.cacheTTL, 0);
  assert.equal(observed.options.retries, 0);
  assert.match(observed.options.body, /^q=/);
  assert.equal(observed.options.body.includes('format=GeoJSON'), false);
  assert.equal(observed.options.body.includes(encodeURIComponent('-75.1652')), false);
});

test('request owner sends no exact route to the source and locally admits a complete ready result', async () => {
  let sourceParams;
  const owner = createTestRequestOwner({
    fetchEnvelope: async (params) => {
      sourceParams = params;
      return envelope();
    },
  });
  const filterKey = createRouteCorridorFilterKey({ types: ['Thefts'], drilldownCodes: [] });
  const result = await owner.request({
    routeInput: route,
    bufferM: 100,
    selectedRange,
    types: ['Thefts'],
    drilldownCodes: [],
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.matches.map(({ id }) => id), ['101']);
  assert.equal(result.matches[0].relation, 'reported-point-near-route');
  assert.equal(result.coverage.unmappedIncidentCount, 3);
  assert.equal(result.coverage.unmappedIncidentScope, 'selected-time-and-filter-citywide');
  assert.deepEqual(result.coverage.availableMonths, ['2025-06']);
  assert.equal(result.coverage.locationPrecision, 'Generalized to the hundred block by the source');
  assert.equal(result.coverage.recordGrain, 'reported_record');
  assert.equal(result.coverage.recordNote, 'A record is a source row and is not guaranteed to be one unique incident.');
  assert.equal(result.coverage.spatialRegion, 'Philadelphia');
  assert.equal(result.coverage.corridorCovered, true);
  assert.equal(result.coverage.spatialDisclosure, 'coarse-bbox-only');
  assert.equal(result.coverage.spatialCoverageKind, 'live');
  assert.equal(result.coverage.spatialCoverageMethod, 'city-limit-interior');
  assert.equal(sourceParams.routeInput, undefined);
  assert.equal(sourceParams.bufferM, undefined);
  assert.equal(JSON.stringify(sourceParams).includes('-75.1652'), false);
  assert.equal(result.query.filterKey, filterKey);
  assert.equal(result.query.historicNotRealtime, true);
});

test('spatial coverage is proven locally before any incident request and outside routes fail unavailable', async () => {
  let incidentFetches = 0;
  let observedRoute;
  const owner = createRouteCorridorRequestOwner({
    fetchSpatialCoverage: async (params) => {
      observedRoute = params.routeInput;
      return {
        status: 'ready',
        region: 'Philadelphia',
        corridorCovered: false,
        conservativeMarginM: 500,
        source: 'Philadelphia Police GIS',
      };
    },
    fetchEnvelope: async () => { incidentFetches += 1; return envelope(); },
  });
  const result = await owner.request({
    routeInput: createManualRouteInput([[-74.01, 40.71], [-73.99, 40.72]]),
    bufferM: 100,
    selectedRange,
  });
  assert.equal(result.status, 'coverage-unavailable');
  assert.equal(result.reason, 'spatial-coverage-unavailable');
  assert.equal(incidentFetches, 0);
  assert.equal(observedRoute.inputKind, 'known-polyline');

  const unavailable = createRouteCorridorRequestOwner({
    fetchSpatialCoverage: async () => { throw new Error('boundary unavailable'); },
    fetchEnvelope: async () => { incidentFetches += 1; return envelope(); },
  });
  assert.equal((await unavailable.request({
    routeInput: route,
    bufferM: 100,
    selectedRange,
  })).status, 'coverage-unavailable');
  assert.equal(incidentFetches, 0);
});

test('canonical person and full taxonomy filters share the same admitted fingerprint contract', async () => {
  const offenseGroups = JSON.parse(await readFile(
    new URL('../../src/data/offense_groups.json', import.meta.url),
    'utf8',
  ));
  for (const types of [offenseGroups.person, Object.values(offenseGroups).flat()]) {
    let called = false;
    const owner = createTestRequestOwner({
      fetchEnvelope: async () => { called = true; return envelope({ candidateTotal: 0, returnedCandidateCount: 0, candidates: [] }); },
    });
    const result = await owner.request({ routeInput: route, bufferM: 100, selectedRange, types });
    assert.equal(called, true);
    assert.equal(result.status, 'no-mapped-incidents');
  }
});

test('truncation, count mismatch, duplicate identities, and malformed candidates fail closed', async () => {
  const base = { routeInput: route, bufferM: 100, selectedRange, types: [], drilldownCodes: [] };
  const truncated = createTestRequestOwner({
    fetchEnvelope: async () => envelope({
      candidateTotal: 2001,
      returnedCandidateCount: 2001,
      truncated: true,
      candidates: Array.from({ length: 2001 }, (_, index) => feature(index + 1)),
    }),
  });
  assert.equal((await truncated.request(base)).status, 'coverage-unavailable');

  const mismatch = createTestRequestOwner({
    fetchEnvelope: async () => envelope({ candidateTotal: 2 }),
  });
  assert.equal((await mismatch.request(base)).status, 'source-failure');

  const duplicate = createTestRequestOwner({
    fetchEnvelope: async () => envelope({
      candidateTotal: 2,
      returnedCandidateCount: 2,
      candidates: [feature(101), feature(101)],
    }),
  });
  assert.equal((await duplicate.request(base)).status, 'source-failure');

  const malformed = createTestRequestOwner({
    fetchEnvelope: async () => envelope({ candidates: [{ ...feature(101), geometry: null }] }),
  });
  assert.equal((await malformed.request(base)).status, 'source-failure');

  const missingCoverage = createTestRequestOwner({
    fetchEnvelope: async () => envelope({ coverageMonths: undefined }),
  });
  assert.equal((await missingCoverage.request(base)).status, 'coverage-unavailable');

  for (const candidate of [
    feature(-1),
    feature(1.5),
    { ...feature(101), id: 102 },
  ]) {
    const invalidIdentity = createTestRequestOwner({
      fetchEnvelope: async () => envelope({ candidates: [candidate] }),
    });
    assert.equal((await invalidIdentity.request(base)).status, 'source-failure');
  }
});

test('new requests and deactivation supersede stale source work', async () => {
  const pending = [];
  const owner = createTestRequestOwner({
    fetchEnvelope: ({ signal }) => new Promise((resolve) => pending.push({ resolve, signal })),
  });
  const first = owner.request({ routeInput: route, bufferM: 100, selectedRange, types: [], drilldownCodes: [] });
  await Promise.resolve();
  const second = owner.request({ routeInput: route, bufferM: 200, selectedRange, types: [], drilldownCodes: [] });
  await Promise.resolve();
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve(envelope());
  assert.equal((await second).status, 'ready');
  pending[0].resolve(envelope());
  assert.equal((await first).status, 'superseded');

  const third = owner.request({ routeInput: route, bufferM: 100, selectedRange, types: [], drilldownCodes: [] });
  await Promise.resolve();
  owner.setActive(false);
  assert.equal(pending[2].signal.aborted, true);
  pending[2].resolve(envelope());
  assert.equal((await third).status, 'superseded');
});

test('an invalid replacement request immediately supersedes older source work', async () => {
  let pending;
  const owner = createTestRequestOwner({
    fetchEnvelope: ({ signal }) => new Promise((resolve) => { pending = { resolve, signal }; }),
  });
  const first = owner.request({ routeInput: route, bufferM: 100, selectedRange, types: [], drilldownCodes: [] });
  await Promise.resolve();
  assert.equal((await owner.request({ routeInput: null, bufferM: 100, selectedRange })).status, 'route-required');
  assert.equal(pending.signal.aborted, true);
  pending.resolve(envelope());
  assert.equal((await first).status, 'superseded');
});

test('Crime adapter captures canonical historic filters without mutating or persisting them', async () => {
  const snapshot = {
    start: '2025-06-01',
    end: '2025-07-01',
    types: ['Property'],
    drilldownCodes: ['Thefts'],
    selectedDistrictCode: '09',
  };
  let observed;
  let active = true;
  const coordinator = createRouteCorridorCrimeCoordinator({
    readSnapshot: () => structuredClone(snapshot),
    requestOwner: {
      request: async (params) => {
        observed = params;
        return { status: 'no-mapped-incidents' };
      },
      setActive: (next) => { active = next; },
      clear: () => {},
    },
  });
  const result = await coordinator.request({ routeInput: route, bufferM: 100 });
  assert.equal(result.status, 'no-mapped-incidents');
  assert.deepEqual(observed.selectedRange, selectedRange);
  assert.deepEqual(observed.types, ['Property']);
  assert.deepEqual(observed.drilldownCodes, ['Thefts']);
  assert.equal(observed.selectedDistrictCode, undefined);
  assert.deepEqual(snapshot, {
    start: '2025-06-01',
    end: '2025-07-01',
    types: ['Property'],
    drilldownCodes: ['Thefts'],
    selectedDistrictCode: '09',
  });
  coordinator.setActive(false);
  assert.equal(active, false);
});

test('Crime adapter rejects a completed route result when the canonical query changed in flight', async () => {
  let snapshot = { ...selectedRange, types: ['Thefts'], drilldownCodes: [] };
  let resolveRequest;
  const coordinator = createRouteCorridorCrimeCoordinator({
    readSnapshot: () => structuredClone(snapshot),
    requestOwner: {
      request: () => new Promise((resolve) => { resolveRequest = resolve; }),
      setActive: () => {},
      clear: () => {},
    },
  });
  const pendingResult = coordinator.request({ routeInput: route, bufferM: 100 });
  snapshot = { ...snapshot, types: ['Aggravated Assault'] };
  resolveRequest({ status: 'ready', matches: [feature(101)] });
  assert.equal((await pendingResult).status, 'superseded');
});

test('shared map/list integration exposes only an explicit lazy route request boundary', async () => {
  const [main, source, runtime, crimeController] = await Promise.all([
    readFile(new URL('../../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_crime/route_corridor_app_loader.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_crime/route_corridor_app_runtime.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_crime/index.js', import.meta.url), 'utf8'),
  ]);
  assert.match(main, /import\('\.\/routes_crime\/route_corridor_app_loader\.js'\)/);
  assert.match(source, /import\('\.\/route_corridor_app_runtime\.js'\)/);
  assert.doesNotMatch(source, /requestModulePromise|requestRouteCorridor|clearRouteCorridor/);
  assert.match(runtime, /import\('\.\/route_corridor_crime_coordinator\.js'\)/);
  assert.match(runtime, /requestModulePromise/);
  assert.match(runtime, /requestModulePromise \|\|= import/);
  assert.match(runtime, /requestModulePromise\?\.then\(\(module\) => module\.clear\(\)/);
  assert.match(runtime, /requestRouteCorridor/);
  assert.match(runtime, /clearRouteCorridor/);
  assert.match(runtime, /getMap/);
  assert.doesNotMatch(crimeController, /requestRouteCorridor|clearRouteCorridor/);
  assert.doesNotMatch(`${source}\n${runtime}`, /localStorage|sessionStorage|navigator\.geolocation/);
});

test('lazy module facade creates one coordinator so concurrent first requests share cancellation ownership', async () => {
  let creates = 0;
  const calls = [];
  const readSnapshot = () => ({});
  const facade = createRouteCorridorModuleFacade({
    createCoordinator: () => {
      creates += 1;
      return {
        request: async (options) => { calls.push(options); return { status: 'superseded' }; },
        clear: () => { calls.push('clear'); },
        setActive: (next) => { calls.push(`active:${next}`); },
      };
    },
  });
  await Promise.all([
    facade.request(readSnapshot, true, { bufferM: 100 }),
    facade.request(readSnapshot, true, { bufferM: 200 }),
  ]);
  facade.clear();
  facade.setActive(false);
  assert.equal(creates, 1);
  assert.deepEqual(calls, [
    { bufferM: 100 },
    'active:true',
    { bufferM: 200 },
    'clear',
    'active:false',
  ]);
});

function inverseWebMercatorLatitude(y) {
  return (2 * Math.atan(Math.exp(y / 6_378_137)) - Math.PI / 2) * 180 / Math.PI;
}

function greatCircleMidpoint([lonA, latA], [lonB, latB]) {
  const lambdaA = lonA * Math.PI / 180;
  const lambdaB = lonB * Math.PI / 180;
  const phiA = latA * Math.PI / 180;
  const phiB = latB * Math.PI / 180;
  const delta = lambdaB - lambdaA;
  const bx = Math.cos(phiB) * Math.cos(delta);
  const by = Math.cos(phiB) * Math.sin(delta);
  return [
    (lambdaA + Math.atan2(by, Math.cos(phiA) + bx)) * 180 / Math.PI,
    Math.atan2(
      Math.sin(phiA) + Math.sin(phiB),
      Math.sqrt((Math.cos(phiA) + bx) ** 2 + by ** 2),
    ) * 180 / Math.PI,
  ];
}
