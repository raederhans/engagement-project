import { types } from 'node:util';

import { fail } from '../route_graph_candidate/safe_data.mjs';
import {
  OSM_BOUNDARY_SCHEMA,
  OSM_EDGE_RECORD_SCHEMA,
  OSM_EXTRACTOR_BINDING_SCHEMA,
  OSM_INTERMEDIATE_SCHEMA,
  OSM_TURN_RESTRICTIONS_SCHEMA,
} from './schemas.mjs';

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const OSM_INGRESS_LIMITS = Object.freeze({
  maximumEdgeRecords: 100_000,
  maximumGeometryPointsPerEdge: 4_096,
  maximumAggregateGeometryPoints: 250_000,
});

export function admitOsmIntermediateIngress(value) {
  const state = {
    geometryPoints: 0,
    seen: new WeakSet(),
  };
  validateIntermediate(value, state);
  return cloneApprovedData(value, new WeakSet());
}

function validateIntermediate(value, state) {
  const descriptors = exactObject(value, [
    'schema', 'sourceId', 'sourceKind', 'extractor', 'boundary', 'turnRestrictions', 'edges',
  ], 'OSM intermediate', state);
  exactSchema(descriptors.schema.value, OSM_INTERMEDIATE_SCHEMA, 'OSM intermediate.schema');
  primitive(descriptors.sourceId.value, 'OSM intermediate.sourceId');
  primitive(descriptors.sourceKind.value, 'OSM intermediate.sourceKind');
  validateExtractor(descriptors.extractor.value, state);
  validateBoundary(descriptors.boundary.value, state);
  validateTurnRestrictions(descriptors.turnRestrictions.value, state);
  validateEdges(descriptors.edges.value, state);
}

function validateExtractor(value, state) {
  const descriptors = exactObject(value, [
    'schema', 'extractorId', 'extractorVersion', 'recordSchema',
  ], 'OSM extractor binding', state);
  exactSchema(descriptors.schema.value, OSM_EXTRACTOR_BINDING_SCHEMA, 'OSM extractor binding.schema');
  for (const key of ['extractorId', 'extractorVersion', 'recordSchema']) {
    primitive(descriptors[key].value, `OSM extractor binding.${key}`);
  }
}

function validateBoundary(value, state) {
  const descriptors = exactObject(value, [
    'schema', 'boundaryId', 'clipperId', 'clipperVersion', 'clippingStatus',
    'clippingPolicy', 'outsideInputPolicy', 'bbox',
  ], 'OSM boundary binding', state);
  exactSchema(descriptors.schema.value, OSM_BOUNDARY_SCHEMA, 'OSM boundary binding.schema');
  for (const key of [
    'boundaryId', 'clipperId', 'clipperVersion', 'clippingStatus', 'clippingPolicy', 'outsideInputPolicy',
  ]) primitive(descriptors[key].value, `OSM boundary binding.${key}`);
  const bboxDescriptors = denseArray(
    descriptors.bbox.value,
    'OSM boundary binding.bbox',
    state,
    { minimum: 4, maximum: 4 },
  );
  for (let index = 0; index < 4; index += 1) {
    primitive(bboxDescriptors[String(index)].value, `OSM boundary binding.bbox[${index}]`);
  }
}

function validateTurnRestrictions(value, state) {
  const descriptors = exactObject(value, ['schema', 'status', 'reason'], 'OSM turn restrictions', state);
  exactSchema(descriptors.schema.value, OSM_TURN_RESTRICTIONS_SCHEMA, 'OSM turn restrictions.schema');
  primitive(descriptors.status.value, 'OSM turn restrictions.status');
  primitive(descriptors.reason.value, 'OSM turn restrictions.reason');
}

function validateEdges(value, state) {
  const descriptors = denseArray(value, 'OSM intermediate.edges', state, {
    minimum: 0,
    maximum: OSM_INGRESS_LIMITS.maximumEdgeRecords,
    maximumCode: 'edge-record-limit',
  });
  const length = descriptors.length.value;
  for (let index = 0; index < length; index += 1) {
    validateEdge(descriptors[String(index)].value, index, state);
  }
}

function validateEdge(value, index, state) {
  const label = `OSM edges[${index}]`;
  const descriptors = exactObject(value, [
    'schema', 'recordId', 'osmWayId', 'segmentIndex', 'partIndex',
    'fromNodeId', 'toNodeId', 'fromEndpointKind', 'toEndpointKind',
    'geometry', 'distanceMillimeters', 'boundaryDisposition', 'tags',
  ], label, state);
  exactSchema(descriptors.schema.value, OSM_EDGE_RECORD_SCHEMA, `${label}.schema`);
  for (const key of [
    'recordId', 'osmWayId', 'segmentIndex', 'partIndex', 'fromNodeId', 'toNodeId',
    'fromEndpointKind', 'toEndpointKind', 'distanceMillimeters', 'boundaryDisposition',
  ]) primitive(descriptors[key].value, `${label}.${key}`);
  validateGeometry(descriptors.geometry.value, `${label}.geometry`, state);
  validateTags(descriptors.tags.value, `${label}.tags`, state);
}

function validateGeometry(value, label, state) {
  const descriptors = denseArray(value, label, state, {
    minimum: 2,
    maximum: OSM_INGRESS_LIMITS.maximumGeometryPointsPerEdge,
    maximumCode: 'geometry-point-limit',
    beforeDescriptors(length) {
      state.geometryPoints += length;
      if (state.geometryPoints > OSM_INGRESS_LIMITS.maximumAggregateGeometryPoints) {
        fail(
          'aggregate-geometry-point-limit',
          `OSM intermediate exceeds ${OSM_INGRESS_LIMITS.maximumAggregateGeometryPoints} aggregate geometry points`,
        );
      }
    },
  });
  const length = descriptors.length.value;
  for (let index = 0; index < length; index += 1) {
    const coordinate = denseArray(descriptors[String(index)].value, `${label}[${index}]`, state, {
      minimum: 2,
      maximum: 2,
    });
    primitive(coordinate['0'].value, `${label}[${index}][0]`);
    primitive(coordinate['1'].value, `${label}[${index}][1]`);
  }
}

function validateTags(value, label, state) {
  const descriptors = exactObject(value, [
    'highway', 'foot', 'access', 'oneway', 'onewayFoot', 'route', 'construction', 'conditional',
  ], label, state);
  for (const key of ['highway', 'foot', 'access', 'oneway', 'onewayFoot', 'route', 'construction']) {
    primitive(descriptors[key].value, `${label}.${key}`);
  }
  const conditional = exactObject(
    descriptors.conditional.value,
    ['foot', 'access', 'oneway', 'onewayFoot'],
    `${label}.conditional`,
    state,
  );
  for (const key of ['foot', 'access', 'oneway', 'onewayFoot']) {
    primitive(conditional[key].value, `${label}.conditional.${key}`);
  }
}

function exactObject(value, expectedKeys, label, state) {
  enterContainer(value, label, state);
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value) || (prototype !== Object.prototype && prototype !== null)) {
    fail('ingress-plain-object', `${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  const expected = new Set(expectedKeys);
  for (const key of ownKeys) {
    if (typeof key !== 'string') fail('ingress-symbol-property', `${label} must not contain symbol properties`);
    if (BLOCKED_KEYS.has(key)) fail('ingress-blocked-property', `${label}.${key} is forbidden`);
  }
  if (ownKeys.length !== expectedKeys.length) {
    fail('schema-key-count', `${label} must contain exactly ${expectedKeys.length} own properties`);
  }
  for (const key of ownKeys) {
    if (!expected.has(key)) fail('schema-unknown-key', `${label}.${key} is not admitted by the fixed schema`);
  }
  const descriptors = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) fail('schema-missing-key', `${label}.${key} is required`);
    validateDataDescriptor(key, descriptor, label);
    descriptors[key] = descriptor;
  }
  return descriptors;
}

function denseArray(value, label, state, {
  minimum,
  maximum,
  maximumCode = 'ingress-array-size',
  beforeDescriptors = null,
}) {
  enterContainer(value, label, state);
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail('ingress-dense-array', `${label} must be a plain dense array`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') || !Number.isSafeInteger(lengthDescriptor.value)) {
    fail('ingress-array-length', `${label} has an invalid length descriptor`);
  }
  const length = lengthDescriptor.value;
  if (length < minimum) fail('ingress-array-size', `${label} must contain at least ${minimum} items`);
  if (length > maximum) fail(maximumCode, `${label} exceeds ${maximum} items`);
  if (beforeDescriptors) beforeDescriptors(length);

  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key !== 'string') fail('ingress-symbol-property', `${label} must not contain symbol properties`);
    if (key === 'length') continue;
    if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) {
      fail('ingress-array-property', `${label}.${key} is not an admitted array index`);
    }
  }
  if (keys.length !== length + 1) fail('ingress-sparse-array', `${label} must be dense and contain no custom properties`);
  const descriptors = { length: lengthDescriptor };
  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) fail('ingress-sparse-array', `${label} must be dense`);
    validateDataDescriptor(key, descriptor, label);
    descriptors[key] = descriptor;
  }
  return descriptors;
}

function enterContainer(value, label, state) {
  if (value === null || typeof value !== 'object') fail('ingress-container', `${label} must be a data container`);
  if (types.isProxy(value)) fail('ingress-proxy', `${label} must not be a Proxy`);
  if (state.seen.has(value)) fail('ingress-repeated-reference', `${label} must not reuse or cycle container references`);
  state.seen.add(value);
}

function validateDataDescriptor(key, descriptor, label) {
  if (!Object.hasOwn(descriptor, 'value')) fail('ingress-accessor', `${label}.${key} must not be an accessor`);
  if (!descriptor.enumerable) fail('ingress-hidden-property', `${label}.${key} must be enumerable`);
}

function primitive(value, label) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (value !== null && typeof value === 'object' && types.isProxy(value)) {
    fail('ingress-proxy', `${label} must not be a Proxy`);
  }
  fail('ingress-primitive', `${label} must be a finite JSON data primitive`);
}

function exactSchema(value, expected, label) {
  primitive(value, label);
  if (value !== expected) fail('ingress-schema', `${label} is unsupported`);
}

function cloneApprovedData(value, seen) {
  if (value === null || typeof value !== 'object') return value;
  if (types.isProxy(value)) fail('ingress-proxy', 'approved ingress changed to a Proxy');
  if (seen.has(value)) fail('ingress-repeated-reference', 'approved ingress contains a repeated container reference');
  seen.add(value);
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length.value;
    const result = new Array(length);
    for (let index = 0; index < length; index += 1) {
      result[index] = cloneApprovedData(descriptors[String(index)].value, seen);
    }
    return result;
  }
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    result[key] = cloneApprovedData(descriptor.value, seen);
  }
  return result;
}
