#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRouteCorridorPresentation,
  createRouteQueryKey,
  createRouteBufferWidthExpression,
} from '../../src/routes_crime/route_corridor_ui_controller.js';
import { createQueryPresetController } from '../../src/routes_crime/query_preset_controller.js';

const statuses = [
  'route-required',
  'route-invalid',
  'pending',
  'coverage-unavailable',
  'source-failure',
  'superseded',
  'no-mapped-incidents',
  'ready',
];

test('route corridor keeps all eight states distinct and only admitted empty results say zero', () => {
  for (const status of statuses) {
    const presentation = createRouteCorridorPresentation({
      status,
      matches: status === 'ready' ? [{ id: 'mapped' }] : [],
    });
    assert.equal(presentation.status, status);
    assert.equal(presentation.zeroClaim, status === 'no-mapped-incidents');
    if (status !== 'no-mapped-incidents') assert.doesNotMatch(presentation.summary, /^0\b/i);
  }
});

test('query preset port exceptions settle as incomplete instead of leaving the transaction pending', async () => {
  let current = { startMonth: '2025-01', durationMonths: 12, radius: 800 };
  const controller = createQueryPresetController({
    readCanonical: () => structuredClone(current),
    readCoverage: () => ({ status: 'ready', min: '2020-01', max: '2026-06' }),
    replaceCanonical: (next) => { current = structuredClone(next); },
    syncControls: () => { throw new Error('sync interrupted'); },
    writeCanonicalUrl: () => { throw new Error('must not continue'); },
    clearCurrentArtifact: () => { throw new Error('must not continue'); },
    requestSingleCrimeRefresh: () => { throw new Error('must not continue'); },
  });
  assert.equal(controller.previewPreset('latest-6-months').status, 'preview');
  const result = await controller.confirmPreview();
  assert.equal(result.status, 'incomplete');
  assert.equal(result.failedPort, 'sync');
  assert.equal(controller.cancelPreview().status, 'cancelled');
  assert.equal(current.durationMonths, 6, 'the already-applied canonical change remains honest and editable');
});

test('ready presentation reports mapped and citywide-unmapped scopes without calling rows unique incidents', () => {
  const presentation = createRouteCorridorPresentation({
    status: 'ready',
    matches: [{ id: '1', incident: { properties: {} } }, { id: '2', incident: { properties: {} } }],
    coverage: {
      unmappedIncidentCount: 17,
      unmappedIncidentScope: 'selected-time-and-filter-citywide',
      source: 'Philadelphia Crime Incidents',
      availableStart: '2025-01-01',
      availableEndExclusive: '2026-01-01',
      spatialCoverageSource: 'Philadelphia City Limits',
      conservativeBoundaryMarginM: 500,
    },
  });
  assert.match(presentation.summary, /2/);
  assert.equal(presentation.mappedCount, 2);
  assert.equal(presentation.unmappedCount, 17);
  assert.equal(presentation.recordGrain, 'reported-record/non-unique');
});

test('route query identity changes only for canonical historical/filter inputs', () => {
  const baseline = createRouteQueryKey({
    start: '2025-01-01', end: '2026-01-01', types: ['Theft'], radiusM: 800,
  });
  assert.equal(createRouteQueryKey({
    start: '2025-01-01', end: '2026-01-01', types: ['Theft'], radiusM: 1200,
  }), baseline, 'unrelated canonical fields do not supersede the route query');
  assert.notEqual(createRouteQueryKey({
    start: '2025-01-01', end: '2026-01-01', types: ['Assault'], radiusM: 800,
  }), baseline);
});

test('route buffer map width is a metre-derived zoom expression rather than a fixed pixel width', () => {
  const expression = createRouteBufferWidthExpression({
    bufferM: 100,
    latitude: 39.95,
  });
  assert.deepEqual(expression.slice(0, 3), ['interpolate', ['exponential', 2], ['zoom']]);
  assert.equal(expression[3], 0);
  assert.ok(expression[4] > 0 && expression[4] < 1);
  assert.equal(expression[5], 22);
  assert.ok(expression[6] > 1000);
  const polarExpression = createRouteBufferWidthExpression({ bufferM: 100, latitude: 90 });
  assert.ok(polarExpression.every((value) => typeof value !== 'number' || (Number.isFinite(value) && value < 1_000_000_000)));
});
