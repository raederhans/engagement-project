#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { admitKnownRouteEvidenceRequest } from '../../src/routes_crime/known_route_evidence_contract.js';
import {
  admitCenterlineFeatureCollection,
  admitCenterlineMetadata,
  requestPhiladelphiaCenterlineCatalog,
} from '../../src/routes_crime/known_route_centerline.js';
import { createManualRouteInput } from '../../src/routes_crime/route_input.js';

const normalizedRoute = admitKnownRouteEvidenceRequest({
  schema: 'known-route-evidence-request/v1',
  routeInput: createManualRouteInput([
    [-75.17, 39.95], [-75.16, 39.95], [-75.15, 39.95],
  ]),
  transportMode: 'walking',
  requestedDataVersion: 'current-observed',
});
const consent = { publicCenterlineRequest: true };

function metadata(overrides = {}) {
  const fields = [
    ['objectid', 'esriFieldTypeOID'],
    ['seg_id', 'esriFieldTypeInteger'],
    ['fnode_', 'esriFieldTypeInteger'],
    ['tnode_', 'esriFieldTypeInteger'],
    ['oneway', 'esriFieldTypeString'],
    ['class', 'esriFieldTypeSmallInteger'],
    ['streetlabe', 'esriFieldTypeString'],
    ['update_', 'esriFieldTypeDate'],
  ].map(([name, type]) => ({ name, type }));
  return {
    serviceItemId: 'c36d828494cd44b5bd8b038be696c839',
    name: 'Street_Centerline',
    type: 'Feature Layer',
    geometryType: 'esriGeometryPolyline',
    capabilities: 'Query',
    objectIdField: 'objectid',
    maxRecordCount: 2000,
    hasZ: false,
    hasM: false,
    supportedQueryFormats: 'JSON, geoJSON, PBF',
    editingInfo: { dataLastEditDate: Date.parse('2026-07-29T13:55:32.074Z') },
    fields,
    ...overrides,
  };
}

function feature(objectid, segId, from, to, coordinates) {
  return {
    type: 'Feature',
    properties: {
      objectid,
      seg_id: segId,
      fnode_: from,
      tnode_: to,
      oneway: 'B',
      class: 3,
      streetlabe: 'PUBLIC TEST ST',
      update_: Date.parse('2026-07-01T00:00:00.000Z'),
    },
    geometry: { type: 'LineString', coordinates },
  };
}

function featureCollection() {
  return {
    type: 'FeatureCollection',
    features: [
      feature(10, 100, 1, 2, [[-75.17, 39.95], [-75.16, 39.95]]),
      feature(11, 101, 2, 3, [[-75.16, 39.95], [-75.15, 39.95]]),
    ],
  };
}

async function transaction(responses, options = {}) {
  let index = 0;
  return requestPhiladelphiaCenterlineCatalog({
    normalizedRoute,
    consent,
    request: async () => ({ ok: true, json: async () => responses[index++] }),
    ...options,
  });
}

test('Centerline transaction requires explicit consent and exact URLSearchParams POSTs', async () => {
  const calls = [];
  const responses = [metadata(), { count: 2 }, featureCollection(), metadata()];
  const request = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => responses[calls.length - 1] };
  };
  assert.equal((await requestPhiladelphiaCenterlineCatalog({ normalizedRoute, request })).reason, 'consent-required');
  assert.equal(calls.length, 0);
  assert.equal((await requestPhiladelphiaCenterlineCatalog({
    normalizedRoute: {
      ...normalizedRoute,
      geometry: { type: 'LineString', coordinates: [[-74, 39.95], [-73.99, 39.95]] },
    },
    consent,
    request,
  })).reason, 'invalid-route');
  assert.equal(calls.length, 0);
  const catalog = await requestPhiladelphiaCenterlineCatalog({ normalizedRoute, consent, request });
  assert.equal(catalog.featureCount, 2);
  assert.deepEqual(calls.map(({ options }) => options.method), ['GET', 'POST', 'POST', 'GET']);
  for (const { options } of calls) {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
  }
  const posts = calls.filter(({ options }) => options.method === 'POST');
  assert.ok(posts.every(({ options }) => options.body instanceof URLSearchParams));
  assert.equal(posts[0].options.body.get('returnCountOnly'), 'true');
  assert.equal(posts[1].options.body.get('f'), 'geojson');
  assert.equal(posts[1].options.body.get('outFields'), 'objectid,seg_id,fnode_,tnode_,oneway,class,streetlabe,update_');
  assert.equal(posts[1].options.body.get('geometryType'), 'esriGeometryEnvelope');
  assert.equal(posts[1].options.body.get('inSR'), '4326');
  assert.equal(posts[1].options.body.get('outSR'), '4326');
  assert.doesNotMatch(posts.map(({ options }) => options.body.toString()).join('\n'), /LineString|walking|address|destination|Diary/i);
});

test('Centerline transaction rejects schema drift, truncation, duplicate/unknown fields, network, and timeout', async () => {
  const drifted = metadata();
  drifted.fields = drifted.fields.map((field) => field.name === 'class'
    ? { ...field, type: 'esriFieldTypeInteger' } : field);
  assert.equal((await transaction([metadata(), { count: 2 }, featureCollection(), drifted])).reason, 'source-drift');
  assert.equal((await transaction([
    metadata(), { count: 2 }, featureCollection(), metadata({ maxRecordCount: 3000 }),
  ])).reason, 'source-drift');
  assert.equal((await transaction([metadata(), { count: 3 }, featureCollection(), metadata()])).reason, 'source-drift');

  const sourceVersion = admitCenterlineMetadata(metadata());
  const duplicate = featureCollection();
  duplicate.features[1].properties.objectid = duplicate.features[0].properties.objectid;
  assert.throws(() => admitCenterlineFeatureCollection(duplicate, {
    expectedCount: 2, sourceVersion,
  }), /duplicate/i);
  const unknown = featureCollection();
  unknown.features[0].properties.walking_allowed = true;
  assert.throws(() => admitCenterlineFeatureCollection(unknown, {
    expectedCount: 2, sourceVersion,
  }), /unrequested fields/i);

  assert.equal((await requestPhiladelphiaCenterlineCatalog({
    normalizedRoute, consent, request: async () => { throw new TypeError('network'); },
  })).reason, 'source-network');
  const timedOut = await requestPhiladelphiaCenterlineCatalog({
    normalizedRoute,
    consent,
    timeoutMs: 1,
    request: async (_url, { signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(signal.reason), 10);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    }),
  });
  assert.equal(timedOut.reason, 'source-timeout');
});
