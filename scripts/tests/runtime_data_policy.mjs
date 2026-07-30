#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DIARY_NETWORK_DATA_ENABLED,
  resolveDiaryNetworkDataEnabled,
} from '../../src/config.js';
import {
  addNetworkLayer,
  ensureNetworkLayer,
} from '../../src/map/network_layer.js';
import {
  DIARY_NETWORK_LAYER_ID,
  DIARY_NETWORK_SOURCE_ID,
} from '../../src/routes_diary/map_ids.js';

function createFakeMap({
  existingSource = null,
  failAddLayer = false,
  attachLayerBeforeFailure = false,
  replacementOnLayerFailure = null,
} = {}) {
  const sources = new Map();
  const layers = new Map();
  const mutations = [];

  if (existingSource) sources.set(DIARY_NETWORK_SOURCE_ID, existingSource);

  return {
    mutations,
    getSource(id) {
      return sources.get(id) || null;
    },
    getLayer(id) {
      return layers.get(id) || null;
    },
    addSource(id, source) {
      mutations.push(['addSource', id, source]);
      sources.set(id, source);
    },
    addLayer(layer) {
      mutations.push(['addLayer', layer]);
      if (replacementOnLayerFailure) {
        sources.set(DIARY_NETWORK_SOURCE_ID, replacementOnLayerFailure.source);
        layers.set(DIARY_NETWORK_LAYER_ID, replacementOnLayerFailure.layer);
        throw new Error('addLayer failed after replacement');
      }
      if (attachLayerBeforeFailure) {
        layers.set(layer.id, layer);
        throw new Error('addLayer failed after partial attach');
      }
      if (failAddLayer) throw new Error('addLayer failed');
      layers.set(layer.id, layer);
    },
    removeLayer(id) {
      mutations.push(['removeLayer', id]);
      layers.delete(id);
    },
    removeSource(id) {
      mutations.push(['removeSource', id]);
      sources.delete(id);
    },
  };
}

test('network data requires the exact trimmed opt-in value 1', () => {
  for (const value of [undefined, null, '', '0', 'false', false, 0, true, ' 0 ', ' true ']) {
    assert.equal(
      resolveDiaryNetworkDataEnabled({ VITE_DIARY_NETWORK_DATA: value }),
      false,
      `expected ${String(value)} to stay disabled`,
    );
  }
  assert.equal(resolveDiaryNetworkDataEnabled({ VITE_DIARY_NETWORK_DATA: '1' }), true);
  assert.equal(resolveDiaryNetworkDataEnabled({ VITE_DIARY_NETWORK_DATA: ' 1 ' }), true);
});

test('development mode alone never enables the optional network dataset', () => {
  assert.equal(resolveDiaryNetworkDataEnabled({ DEV: true }), false);
  assert.equal(DIARY_NETWORK_DATA_ENABLED, false);
});

test('default-disabled network layer performs no load or map mutation', async () => {
  const map = createFakeMap();
  let loaderCalls = 0;

  const addResult = await addNetworkLayer(map, {
    loadNetworkGeojsonImpl: async () => {
      loaderCalls += 1;
      return { type: 'FeatureCollection', features: [] };
    },
  });
  const ensureResult = ensureNetworkLayer(map);

  assert.deepEqual(addResult, { applied: false, reason: 'disabled' });
  assert.deepEqual(ensureResult, { applied: false, reason: 'disabled' });
  assert.equal(loaderCalls, 0);
  assert.deepEqual(map.mutations, []);
});

test('explicitly enabled network layer loads once and attaches its source and layer', async () => {
  const map = createFakeMap();
  const network = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { segment_id: 'seg-1', class: 2 },
      geometry: { type: 'LineString', coordinates: [[-75.16, 39.95], [-75.15, 39.96]] },
    }],
  };
  let loaderCalls = 0;

  const result = await addNetworkLayer(map, {
    enabled: true,
    loadNetworkGeojsonImpl: async () => {
      loaderCalls += 1;
      return network;
    },
  });

  assert.deepEqual(result, { applied: true });
  assert.equal(loaderCalls, 1);
  assert.equal(map.getSource(DIARY_NETWORK_SOURCE_ID)?.data, network);
  assert.equal(map.getLayer(DIARY_NETWORK_LAYER_ID)?.source, DIARY_NETWORK_SOURCE_ID);

  const ensured = ensureNetworkLayer(map, { enabled: true });
  assert.deepEqual(ensured, { applied: true });
  assert.equal(loaderCalls, 1);
  assert.equal(map.mutations.filter(([type]) => type === 'addSource').length, 1);
  assert.equal(map.mutations.filter(([type]) => type === 'addLayer').length, 1);
});

test('failed layer attachment rolls back only the source created by that call', async () => {
  const network = { type: 'FeatureCollection', features: [] };
  const newSourceMap = createFakeMap({ failAddLayer: true });

  await assert.rejects(
    addNetworkLayer(newSourceMap, {
      enabled: true,
      loadNetworkGeojsonImpl: async () => network,
    }),
    /addLayer failed/,
  );
  assert.equal(newSourceMap.getSource(DIARY_NETWORK_SOURCE_ID), null);
  assert.deepEqual(
    newSourceMap.mutations.filter(([type]) => type === 'removeSource'),
    [['removeSource', DIARY_NETWORK_SOURCE_ID]],
  );

  const foreignSource = {
    type: 'geojson',
    data: network,
    setData(nextData) { this.data = nextData; },
  };
  const foreignSourceMap = createFakeMap({ existingSource: foreignSource, failAddLayer: true });
  await assert.rejects(
    addNetworkLayer(foreignSourceMap, {
      enabled: true,
      loadNetworkGeojsonImpl: async () => network,
    }),
    /addLayer failed/,
  );
  assert.equal(foreignSourceMap.getSource(DIARY_NETWORK_SOURCE_ID), foreignSource);
  assert.equal(
    foreignSourceMap.mutations.some(([type]) => type === 'removeSource'),
    false,
  );
});

test('failed attachment never removes newer resources that replaced this call ownership', async () => {
  const network = { type: 'FeatureCollection', features: [] };
  const newerSource = { owner: 'newer-source' };
  const newerLayer = { id: DIARY_NETWORK_LAYER_ID, owner: 'newer-layer' };
  const map = createFakeMap({
    replacementOnLayerFailure: { source: newerSource, layer: newerLayer },
  });

  await assert.rejects(
    addNetworkLayer(map, {
      enabled: true,
      loadNetworkGeojsonImpl: async () => network,
    }),
    /addLayer failed after replacement/,
  );

  assert.equal(map.getSource(DIARY_NETWORK_SOURCE_ID), newerSource);
  assert.equal(map.getLayer(DIARY_NETWORK_LAYER_ID), newerLayer);
  assert.equal(map.mutations.some(([type]) => type === 'removeSource'), false);
  assert.equal(map.mutations.some(([type]) => type === 'removeLayer'), false);
});

test('failed attachment removes a partially attached layer while this call still owns the source', async () => {
  const network = { type: 'FeatureCollection', features: [] };
  const map = createFakeMap({ attachLayerBeforeFailure: true });

  await assert.rejects(
    addNetworkLayer(map, {
      enabled: true,
      loadNetworkGeojsonImpl: async () => network,
    }),
    /addLayer failed after partial attach/,
  );

  assert.equal(map.getLayer(DIARY_NETWORK_LAYER_ID), null);
  assert.equal(map.getSource(DIARY_NETWORK_SOURCE_ID), null);
  assert.deepEqual(
    map.mutations.filter(([type]) => type === 'removeLayer' || type === 'removeSource'),
    [
      ['removeLayer', DIARY_NETWORK_LAYER_ID],
      ['removeSource', DIARY_NETWORK_SOURCE_ID],
    ],
  );
});
