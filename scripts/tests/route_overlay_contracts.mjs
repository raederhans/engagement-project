#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearRouteOverlay,
  clearSimPoint,
  drawRouteOverlay,
  drawSimPoint,
} from '../../src/map/routing_overlay.js';

function createFakeMap() {
  const sources = new Map();
  const layers = new Map();
  const paintUpdates = [];
  const removedLayers = [];
  const removedSources = [];

  return {
    sources,
    layers,
    paintUpdates,
    removedLayers,
    removedSources,
    getSource(id) {
      return sources.get(id) || null;
    },
    addSource(id, definition) {
      const source = {
        definition,
        data: definition.data,
        setData(data) {
          source.data = data;
        },
      };
      sources.set(id, source);
    },
    removeSource(id) {
      removedSources.push(id);
      sources.delete(id);
    },
    getLayer(id) {
      return layers.get(id) || null;
    },
    addLayer(definition) {
      layers.set(definition.id, structuredClone(definition));
    },
    setPaintProperty(layerId, key, value) {
      paintUpdates.push([layerId, key, value]);
      layers.get(layerId).paint[key] = value;
    },
    removeLayer(id) {
      removedLayers.push(id);
      layers.delete(id);
    },
  };
}

test('route overlay creates, updates, and clears its source and line layer', () => {
  const map = createFakeMap();
  const firstGeometry = {
    type: 'LineString',
    coordinates: [[-75.2, 39.9], [-75.1, 40]],
  };
  drawRouteOverlay(map, 'diary-route-overlay', firstGeometry, {
    color: '#123456',
    width: 5,
    opacity: 0.7,
    blur: 0.4,
    dasharray: [2, 3],
  });

  assert.deepEqual(map.sources.get('diary-route-overlay').data, {
    type: 'Feature',
    geometry: firstGeometry,
    properties: {},
  });
  assert.deepEqual(map.layers.get('diary-route-overlay-line'), {
    id: 'diary-route-overlay-line',
    type: 'line',
    source: 'diary-route-overlay',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#123456',
      'line-width': 5,
      'line-opacity': 0.7,
      'line-blur': 0.4,
      'line-dasharray': [2, 3],
    },
  });

  const updatedFeature = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[-75.3, 39.8], [-75.2, 39.9]] },
    properties: { route_id: 'updated' },
  };
  drawRouteOverlay(map, 'diary-route-overlay', updatedFeature, {
    lineColorExpression: ['case', true, '#abcdef', '#000000'],
    width: 8,
    opacity: 0,
    blur: 0,
  });

  assert.equal(map.sources.get('diary-route-overlay').data, updatedFeature);
  assert.deepEqual(map.paintUpdates, [
    ['diary-route-overlay-line', 'line-color', ['case', true, '#abcdef', '#000000']],
    ['diary-route-overlay-line', 'line-width', 8],
    ['diary-route-overlay-line', 'line-opacity', 0],
    ['diary-route-overlay-line', 'line-blur', 0],
  ]);

  clearRouteOverlay(map, 'diary-route-overlay');
  assert.deepEqual(map.removedLayers, ['diary-route-overlay-line']);
  assert.deepEqual(map.removedSources, ['diary-route-overlay']);
  assert.equal(map.getLayer('diary-route-overlay-line'), null);
  assert.equal(map.getSource('diary-route-overlay'), null);
});

test('sim point creates, updates, and clears its source and circle layer', () => {
  const map = createFakeMap();
  drawSimPoint(map, 'diary-sim-point', [-75.16, 39.95], {
    radius: 9,
    color: '#334455',
    strokeWidth: 3,
    strokeColor: '#eeeeee',
    opacity: 0.6,
  });

  assert.deepEqual(map.sources.get('diary-sim-point').data, {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-75.16, 39.95] },
    properties: {},
  });
  assert.deepEqual(map.layers.get('diary-sim-point-circle'), {
    id: 'diary-sim-point-circle',
    type: 'circle',
    source: 'diary-sim-point',
    paint: {
      'circle-radius': 9,
      'circle-color': '#334455',
      'circle-stroke-width': 3,
      'circle-stroke-color': '#eeeeee',
      'circle-opacity': 0.6,
    },
  });

  drawSimPoint(map, 'diary-sim-point', [-75.15, 39.96], {
    radius: 4,
    color: '#abcdef',
    strokeWidth: 2,
    strokeColor: '#111111',
    opacity: 0,
  });

  assert.deepEqual(
    map.sources.get('diary-sim-point').data.geometry.coordinates,
    [-75.15, 39.96],
  );
  assert.deepEqual(map.paintUpdates, [
    ['diary-sim-point-circle', 'circle-radius', 4],
    ['diary-sim-point-circle', 'circle-color', '#abcdef'],
    ['diary-sim-point-circle', 'circle-stroke-width', 2],
    ['diary-sim-point-circle', 'circle-stroke-color', '#111111'],
    ['diary-sim-point-circle', 'circle-opacity', 0],
  ]);

  clearSimPoint(map, 'diary-sim-point');
  assert.deepEqual(map.removedLayers, ['diary-sim-point-circle']);
  assert.deepEqual(map.removedSources, ['diary-sim-point']);
  assert.equal(map.getLayer('diary-sim-point-circle'), null);
  assert.equal(map.getSource('diary-sim-point'), null);
});
