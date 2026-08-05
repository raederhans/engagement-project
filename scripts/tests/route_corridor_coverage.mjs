#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createPhiladelphiaCoverageFootprint,
  evaluatePhiladelphiaRouteCoverage,
} from '../../src/routes_crime/route_corridor_coverage.js';
import { createManualRouteInput } from '../../src/routes_crime/route_input.js';

const centerCityRoute = createManualRouteInput([
  [-75.1705, 39.9526],
  [-75.1545, 39.9526],
]);

test('bundled Philadelphia police boundaries admit a Center City corridor and reject New York', async () => {
  const raw = JSON.parse(await readFile(
    new URL('../../public/data/police_districts.geojson', import.meta.url),
    'utf8',
  ));
  const footprint = createPhiladelphiaCoverageFootprint(raw);

  assert.equal(evaluatePhiladelphiaRouteCoverage({
    routeInput: centerCityRoute,
    bufferM: 100,
    footprint,
  }).corridorCovered, true);
  assert.equal(evaluatePhiladelphiaRouteCoverage({
    routeInput: createManualRouteInput([[-74.01, 40.71], [-73.99, 40.72]]),
    bufferM: 100,
    footprint,
  }).corridorCovered, false);
});

test('coverage admission rejects a route crossing the boundary and a buffer extending past it', () => {
  const footprint = createPhiladelphiaCoverageFootprint({
    type: 'FeatureCollection',
    features: Array.from({ length: 20 }, (_, index) => ({
      type: 'Feature',
      properties: { district: index + 1 },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-75.20, 39.90],
          [-75.10, 39.90],
          [-75.10, 40.00],
          [-75.20, 40.00],
          [-75.20, 39.90],
        ]],
      },
    })),
  });

  assert.equal(evaluatePhiladelphiaRouteCoverage({
    routeInput: createManualRouteInput([[-75.19, 39.95], [-75.09, 39.95]]),
    bufferM: 100,
    footprint,
  }).corridorCovered, false);
  assert.equal(evaluatePhiladelphiaRouteCoverage({
    routeInput: createManualRouteInput([[-75.1005, 39.95], [-75.1005, 39.96]]),
    bufferM: 100,
    footprint,
  }).corridorCovered, false);
});
