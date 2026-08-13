import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

import { admitGraphArtifact } from '../../route_decision/contracts/index.js';

const MAX_ID_LENGTH = 120;
const MAX_ITEMS = 10_000;
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,119})$/;
const BLOCKED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const CAPABILITY_IDS = Object.freeze([
  'step-free',
  'curb-ramp-present',
  'paved-surface',
]);
const CAPABILITY_STATES = new Set(['observed', 'unknown', 'unavailable']);
const SOURCE_CAPABILITY_TOKENS = new Set(['yes', 'no', 'unknown', 'unavailable']);

export const CITY_ADAPTER_SCHEMA_VERSIONS = Object.freeze({
  cityAdapter: 'engagement-city-adapter/v2',
  sourceGraph: 'engagement-philadelphia-synthetic-street-shape/v1',
  adaptationResult: 'engagement-city-adaptation-result/v2',
  graphArtifact: 'engagement-route-graph/v1',
  capabilityObservation: 'engagement-city-capability-observation/v1',
  contentIdentity: 'engagement-city-adapter-content-identity/v2',
});

const CITY_ADAPTER_IDENTITY_CANONICALIZATION = 'city-adapter-canonical-source-sets/v2';

const PHILADELPHIA_LIMITATIONS = Object.freeze([
  'synthetic-field-shape-only',
  'not-real-philadelphia-data',
  'not-product-or-public-admitted',
  'not-second-city-transferability-evidence',
  'digest-proves-json-internal-consistency-only',
  'digest-does-not-prove-source-history-authorization-or-transferability',
]);

const PHILADELPHIA_ADAPTER_DEFINITION = {
  schemaVersion: CITY_ADAPTER_SCHEMA_VERSIONS.cityAdapter,
  cityId: 'philadelphia-pa-us',
  adapterVersion: 'philadelphia-synthetic-city-adapter/v2',
  sourceProfileVersion: 'philadelphia-synthetic-street-profile/v2',
  sourceSchemaVersion: CITY_ADAPTER_SCHEMA_VERSIONS.sourceGraph,
  outputSchemaVersion: CITY_ADAPTER_SCHEMA_VERSIONS.graphArtifact,
  spatialReference: {
    crsAuthority: 'synthetic',
    crsCode: 'synthetic-philadelphia-mm-grid/v1',
    axisOrder: ['x', 'y'],
    coordinateUnits: 'millimetres',
  },
  timezone: 'America/New_York',
  modeMapping: {
    taxonomyVersion: 'engagement-route-mode-taxonomy/v1',
    sourceMode: 'pedestrian',
    outputMode: 'walk',
  },
  topologyMapping: {
    topology: 'directed',
    sourceDirectionField: 'direction',
    onewayVocabularyVersion: 'philadelphia-synthetic-direction/v1',
    values: {
      forward: ['forward'],
      reverse: ['reverse'],
      both: ['forward', 'reverse'],
    },
  },
  costPrimitive: {
    sourceDistanceField: 'distanceMm',
    sourceDistanceUnit: 'millimetres',
    outputDistanceField: 'distanceMm',
    outputDistanceUnit: 'millimetres',
    sourceObjectiveCostField: 'objectiveCostUnits',
    sourceObjectiveCostUnit: 'integer-cost-units',
    outputObjectiveCostField: 'objectiveCostUnits',
    outputObjectiveCostUnit: 'integer-cost-units',
    conversion: 'identity-integer/v1',
  },
  capabilityMapping: {
    vocabularyVersion: 'engagement-route-capability-vocabulary/v1',
    sourceVocabularyVersion: 'philadelphia-synthetic-capability-tokens/v1',
    fields: {
      stepFree: 'step-free',
      curbRamp: 'curb-ramp-present',
      pavedSurface: 'paved-surface',
    },
    tokens: {
      yes: { state: 'observed', value: true },
      no: { state: 'observed', value: false },
      unknown: { state: 'unknown', value: null },
      unavailable: { state: 'unavailable', value: null },
    },
  },
  coverage: {
    status: 'synthetic-shape-only',
    geographicScope: 'fictional-philadelphia-coordinate-shape',
    realDataAdmitted: false,
  },
  missingValuePolicy: {
    missingRequiredField: 'reject',
    unknownVocabularyToken: 'reject',
    explicitUnknownCapability: 'preserve-unresolved',
    explicitUnavailableCapability: 'preserve-unresolved',
    unresolvedCapabilityAsFalseOrZero: 'forbidden',
  },
  limitations: PHILADELPHIA_LIMITATIONS,
};

export const PHILADELPHIA_SYNTHETIC_CITY_ADAPTER = deepFreeze({
  ...PHILADELPHIA_ADAPTER_DEFINITION,
  adapterContentIdentity: contentIdentity(PHILADELPHIA_ADAPTER_DEFINITION),
});

function fail(message) {
  throw new TypeError(`CityAdapter contract: ${message}`);
}

function inspectPlainObject(value, label) {
  if (!value || typeof value !== 'object') {
    fail(`${label} must be a plain object`);
  }
  if (utilTypes.isProxy(value)) fail(`${label} must not be a Proxy`);
  if (Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol')) {
    fail(`${label} must not contain symbol properties`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    if (BLOCKED_NAMES.has(key)) fail(`${label} contains a blocked property`);
    if (!Object.hasOwn(descriptors[key], 'value') || descriptors[key].enumerable !== true) {
      fail(`${label} must contain enumerable own data properties only`);
    }
  }
  return { keys, descriptors };
}

function exactObject(value, label, requiredKeys, optionalKeys = []) {
  const { keys, descriptors } = inspectPlainObject(value, label);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const missing = requiredKeys.filter((key) => !Object.hasOwn(descriptors, key));
  const unknown = keys.filter((key) => !allowed.has(key));
  if (missing.length || unknown.length) {
    fail(`${label} schema mismatch (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`);
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function strictArray(value, label, { min = 0, max = MAX_ITEMS } = {}) {
  if (!value || typeof value !== 'object') fail(`${label} must be an array`);
  if (utilTypes.isProxy(value)) fail(`${label} must not be a Proxy`);
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${label} must be an array`);
  }
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < min || length > max) {
    fail(`${label} length is outside the supported range`);
  }
  const items = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
      fail(`${label} must be dense and contain enumerable own data properties only`);
    }
    items.push(descriptor.value);
  }
  const extras = keys.filter((key) => typeof key === 'symbol'
    || (key !== 'length' && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length)));
  if (extras.length) fail(`${label} contains unsupported properties`);
  return items;
}

function boundedId(value, label) {
  if (typeof value !== 'string' || value.length > MAX_ID_LENGTH
    || !ID_PATTERN.test(value) || BLOCKED_NAMES.has(value)) {
    fail(`${label} must be a bounded canonical id`);
  }
  return value;
}

function exactString(value, expected, label) {
  if (value !== expected) fail(`${label} must be ${expected}`);
  return expected;
}

function safeNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < 0) {
    fail(`${label} must be a non-negative integer`);
  }
  return value;
}

function exactSequence(value, expected, label) {
  const items = strictArray(value, label, { min: expected.length, max: expected.length });
  if (items.some((item, index) => item !== expected[index])) {
    fail(`${label} must exactly preserve ${expected.join(',')}`);
  }
  return [...items];
}

function admitContentIdentity(raw, expectedProjection, label) {
  const value = exactObject(raw, label, [
    'schemaVersion',
    'canonicalization',
    'digestAlgorithm',
    'canonicalUtf8Bytes',
    'digest',
  ]);
  exactString(value.schemaVersion, CITY_ADAPTER_SCHEMA_VERSIONS.contentIdentity, `${label}.schemaVersion`);
  exactString(
    value.canonicalization,
    CITY_ADAPTER_IDENTITY_CANONICALIZATION,
    `${label}.canonicalization`,
  );
  exactString(value.digestAlgorithm, 'sha256', `${label}.digestAlgorithm`);
  safeNonNegativeInteger(value.canonicalUtf8Bytes, `${label}.canonicalUtf8Bytes`);
  const expected = contentIdentity(expectedProjection);
  if (canonicalStringify(value) !== canonicalStringify(expected)) {
    fail(`${label} must be recomputed from the complete admitted content`);
  }
  return expected;
}

export function admitCityAdapter(raw) {
  const value = exactObject(raw, 'CityAdapter', [
    'schemaVersion',
    'cityId',
    'adapterVersion',
    'sourceProfileVersion',
    'sourceSchemaVersion',
    'outputSchemaVersion',
    'spatialReference',
    'timezone',
    'modeMapping',
    'topologyMapping',
    'costPrimitive',
    'capabilityMapping',
    'coverage',
    'missingValuePolicy',
    'limitations',
    'adapterContentIdentity',
  ]);
  exactString(value.schemaVersion, CITY_ADAPTER_SCHEMA_VERSIONS.cityAdapter, 'CityAdapter.schemaVersion');
  exactString(value.cityId, PHILADELPHIA_ADAPTER_DEFINITION.cityId, 'CityAdapter.cityId');
  exactString(value.adapterVersion, PHILADELPHIA_ADAPTER_DEFINITION.adapterVersion, 'CityAdapter.adapterVersion');
  exactString(value.sourceProfileVersion, PHILADELPHIA_ADAPTER_DEFINITION.sourceProfileVersion, 'CityAdapter.sourceProfileVersion');
  exactString(value.sourceSchemaVersion, CITY_ADAPTER_SCHEMA_VERSIONS.sourceGraph, 'CityAdapter.sourceSchemaVersion');
  exactString(value.outputSchemaVersion, CITY_ADAPTER_SCHEMA_VERSIONS.graphArtifact, 'CityAdapter.outputSchemaVersion');

  const admitted = {
    schemaVersion: value.schemaVersion,
    cityId: value.cityId,
    adapterVersion: value.adapterVersion,
    sourceProfileVersion: value.sourceProfileVersion,
    sourceSchemaVersion: value.sourceSchemaVersion,
    outputSchemaVersion: value.outputSchemaVersion,
    spatialReference: admitExactLiteral(value.spatialReference, PHILADELPHIA_ADAPTER_DEFINITION.spatialReference, 'CityAdapter.spatialReference'),
    timezone: exactString(value.timezone, PHILADELPHIA_ADAPTER_DEFINITION.timezone, 'CityAdapter.timezone'),
    modeMapping: admitExactLiteral(value.modeMapping, PHILADELPHIA_ADAPTER_DEFINITION.modeMapping, 'CityAdapter.modeMapping'),
    topologyMapping: admitExactLiteral(value.topologyMapping, PHILADELPHIA_ADAPTER_DEFINITION.topologyMapping, 'CityAdapter.topologyMapping'),
    costPrimitive: admitExactLiteral(value.costPrimitive, PHILADELPHIA_ADAPTER_DEFINITION.costPrimitive, 'CityAdapter.costPrimitive'),
    capabilityMapping: admitExactLiteral(value.capabilityMapping, PHILADELPHIA_ADAPTER_DEFINITION.capabilityMapping, 'CityAdapter.capabilityMapping'),
    coverage: admitExactLiteral(value.coverage, PHILADELPHIA_ADAPTER_DEFINITION.coverage, 'CityAdapter.coverage'),
    missingValuePolicy: admitExactLiteral(value.missingValuePolicy, PHILADELPHIA_ADAPTER_DEFINITION.missingValuePolicy, 'CityAdapter.missingValuePolicy'),
    limitations: admitExactLiteral(value.limitations, PHILADELPHIA_LIMITATIONS, 'CityAdapter.limitations'),
  };
  const adapterContentIdentity = admitContentIdentity(
    value.adapterContentIdentity,
    admitted,
    'CityAdapter.adapterContentIdentity',
  );
  return deepFreeze({ ...admitted, adapterContentIdentity });
}

function admitExactLiteral(raw, expected, label) {
  if (Array.isArray(expected)) {
    const items = strictArray(raw, label, { min: expected.length, max: expected.length });
    return items.map((item, index) => admitExactLiteral(item, expected[index], `${label}[${index}]`));
  }
  if (expected && typeof expected === 'object') {
    const value = exactObject(raw, label, Object.keys(expected));
    return Object.fromEntries(Object.keys(expected).map((key) => [
      key,
      admitExactLiteral(value[key], expected[key], `${label}.${key}`),
    ]));
  }
  if (raw !== expected) fail(`${label} must match the frozen CityAdapter profile`);
  return raw;
}

function admitSourceCapability(raw, label) {
  const token = exactObject(raw, label, ['token']);
  if (!SOURCE_CAPABILITY_TOKENS.has(token.token)) {
    fail(`${label}.token is unsupported`);
  }
  return { token: token.token };
}

function admitSourceGraph(raw, adapter) {
  const value = exactObject(raw, 'CityAdapter source graph', [
    'schemaVersion',
    'cityId',
    'sourceId',
    'sourceVersion',
    'sourceProfileVersion',
    'crs',
    'axisOrder',
    'coordinateUnits',
    'timezone',
    'modeTaxonomyVersion',
    'mode',
    'nodes',
    'edges',
  ]);
  exactString(value.schemaVersion, adapter.sourceSchemaVersion, 'CityAdapter source graph.schemaVersion');
  exactString(value.cityId, adapter.cityId, 'CityAdapter source graph.cityId');
  const sourceId = boundedId(value.sourceId, 'CityAdapter source graph.sourceId');
  if (!sourceId.startsWith('synthetic-')) fail('CityAdapter source graph.sourceId must identify a synthetic source');
  const sourceVersion = boundedId(value.sourceVersion, 'CityAdapter source graph.sourceVersion');
  boundedId(
    `${adapter.cityId}:synthetic:${sourceVersion}`,
    'CityAdapter source graph derived graphId',
  );
  exactString(value.sourceProfileVersion, adapter.sourceProfileVersion, 'CityAdapter source graph.sourceProfileVersion');
  exactString(value.crs, adapter.spatialReference.crsCode, 'CityAdapter source graph.crs');
  const axisOrder = exactSequence(value.axisOrder, adapter.spatialReference.axisOrder, 'CityAdapter source graph.axisOrder');
  exactString(value.coordinateUnits, adapter.spatialReference.coordinateUnits, 'CityAdapter source graph.coordinateUnits');
  exactString(value.timezone, adapter.timezone, 'CityAdapter source graph.timezone');
  exactString(value.modeTaxonomyVersion, adapter.modeMapping.taxonomyVersion, 'CityAdapter source graph.modeTaxonomyVersion');
  exactString(value.mode, adapter.modeMapping.sourceMode, 'CityAdapter source graph.mode');

  const nodeIds = new Set();
  const nodes = strictArray(value.nodes, 'CityAdapter source graph.nodes', { min: 1 }).map((rawNode, index) => {
    const node = exactObject(rawNode, `CityAdapter source graph.nodes[${index}]`, ['sourceNodeId', 'xMm', 'yMm']);
    const sourceNodeId = boundedId(node.sourceNodeId, `CityAdapter source graph.nodes[${index}].sourceNodeId`);
    if (nodeIds.has(sourceNodeId)) fail(`CityAdapter source graph.nodes contains duplicate sourceNodeId ${sourceNodeId}`);
    nodeIds.add(sourceNodeId);
    return {
      sourceNodeId,
      xMm: safeNonNegativeInteger(node.xMm, `CityAdapter source graph.nodes[${index}].xMm`),
      yMm: safeNonNegativeInteger(node.yMm, `CityAdapter source graph.nodes[${index}].yMm`),
    };
  }).sort((left, right) => compareCodeUnits(left.sourceNodeId, right.sourceNodeId));

  const edgeIds = new Set();
  const edges = strictArray(value.edges, 'CityAdapter source graph.edges').map((rawEdge, index) => {
    const label = `CityAdapter source graph.edges[${index}]`;
    const edge = exactObject(rawEdge, label, [
      'sourceEdgeId',
      'fromSourceNodeId',
      'toSourceNodeId',
      'direction',
      'distanceMm',
      'objectiveCostUnits',
      'capabilities',
    ]);
    const sourceEdgeId = boundedId(edge.sourceEdgeId, `${label}.sourceEdgeId`);
    if (edgeIds.has(sourceEdgeId)) fail(`CityAdapter source graph.edges contains duplicate sourceEdgeId ${sourceEdgeId}`);
    edgeIds.add(sourceEdgeId);
    const fromSourceNodeId = boundedId(edge.fromSourceNodeId, `${label}.fromSourceNodeId`);
    const toSourceNodeId = boundedId(edge.toSourceNodeId, `${label}.toSourceNodeId`);
    if (!nodeIds.has(fromSourceNodeId) || !nodeIds.has(toSourceNodeId)) {
      fail(`${label} references an unknown source node`);
    }
    if (!Object.hasOwn(adapter.topologyMapping.values, edge.direction)) {
      fail(`${label}.direction is unsupported`);
    }
    for (const traversal of adapter.topologyMapping.values[edge.direction]) {
      boundedId(`${sourceEdgeId}:${traversal}`, `${label} derived edgeId`);
    }
    const capabilities = exactObject(edge.capabilities, `${label}.capabilities`, [
      'stepFree', 'curbRamp', 'pavedSurface',
    ]);
    return {
      sourceEdgeId,
      fromSourceNodeId,
      toSourceNodeId,
      direction: edge.direction,
      distanceMm: safeNonNegativeInteger(edge.distanceMm, `${label}.distanceMm`),
      objectiveCostUnits: safeNonNegativeInteger(edge.objectiveCostUnits, `${label}.objectiveCostUnits`),
      capabilities: {
        stepFree: admitSourceCapability(capabilities.stepFree, `${label}.capabilities.stepFree`),
        curbRamp: admitSourceCapability(capabilities.curbRamp, `${label}.capabilities.curbRamp`),
        pavedSurface: admitSourceCapability(capabilities.pavedSurface, `${label}.capabilities.pavedSurface`),
      },
    };
  }).sort((left, right) => compareCodeUnits(left.sourceEdgeId, right.sourceEdgeId));

  return deepFreeze({
    schemaVersion: value.schemaVersion,
    cityId: value.cityId,
    sourceId,
    sourceVersion,
    sourceProfileVersion: value.sourceProfileVersion,
    crs: value.crs,
    axisOrder,
    coordinateUnits: value.coordinateUnits,
    timezone: value.timezone,
    modeTaxonomyVersion: value.modeTaxonomyVersion,
    mode: value.mode,
    nodes,
    edges,
  });
}

function capabilityObservation(sourceToken, capabilityId, sourceId) {
  const mapped = PHILADELPHIA_ADAPTER_DEFINITION.capabilityMapping.tokens[sourceToken];
  if (!mapped || !CAPABILITY_STATES.has(mapped.state)) fail('internal capability mapping is invalid');
  return {
    schemaVersion: CITY_ADAPTER_SCHEMA_VERSIONS.capabilityObservation,
    capabilityId,
    state: mapped.state,
    value: mapped.value,
    unit: 'boolean',
    reasonCode: mapped.state === 'observed' ? null : `source-${mapped.state}`,
    sourceId,
  };
}

function buildWeakComponents(nodes, edges) {
  const neighbors = new Map(nodes.map(({ nodeId }) => [nodeId, new Set()]));
  for (const edge of edges) {
    neighbors.get(edge.fromNodeId).add(edge.toNodeId);
    neighbors.get(edge.toNodeId).add(edge.fromNodeId);
  }
  const byNodeId = {};
  let componentId = 0;
  for (const { nodeId } of nodes) {
    if (Object.hasOwn(byNodeId, nodeId)) continue;
    byNodeId[nodeId] = componentId;
    const pending = [nodeId];
    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      for (const neighbor of neighbors.get(pending[cursor])) {
        if (!Object.hasOwn(byNodeId, neighbor)) {
          byNodeId[neighbor] = componentId;
          pending.push(neighbor);
        }
      }
    }
    componentId += 1;
  }
  return { kind: 'weakly-connected', count: componentId, byNodeId };
}

function outputProjection(result) {
  return {
    schemaVersion: result.schemaVersion,
    cityId: result.cityId,
    adapterVersion: result.adapterVersion,
    sourceProfileVersion: result.sourceProfileVersion,
    sourceVersion: result.sourceVersion,
    adapterContentIdentity: result.adapterContentIdentity,
    inputContentIdentity: result.inputContentIdentity,
    graphArtifact: result.graphArtifact,
    edgeCapabilityObservations: result.edgeCapabilityObservations,
    coverage: result.coverage,
    limitations: result.limitations,
  };
}

export function buildCityAdapterInputIdentity(rawSourceGraph, rawAdapter = PHILADELPHIA_SYNTHETIC_CITY_ADAPTER) {
  const adapter = admitCityAdapter(rawAdapter);
  const sourceGraph = admitSourceGraph(rawSourceGraph, adapter);
  return deepFreeze(contentIdentity(sourceGraph));
}

function inspectAdaptationResult(rawResult) {
  const snapshot = snapshotData(rawResult, 'CityAdaptationResult');
  return exactObject(snapshot, 'CityAdaptationResult', [
    'schemaVersion',
    'cityId',
    'adapterVersion',
    'sourceProfileVersion',
    'sourceVersion',
    'adapterContentIdentity',
    'inputContentIdentity',
    'graphArtifact',
    'edgeCapabilityObservations',
    'coverage',
    'limitations',
    'outputContentIdentity',
  ]);
}

function buildExpectedAdaptationResult(sourceGraph, adapter) {
  const inputContentIdentity = contentIdentity(sourceGraph);
  const nodes = sourceGraph.nodes
    .map(({ sourceNodeId }) => ({ nodeId: sourceNodeId }))
    .sort((left, right) => compareCodeUnits(left.nodeId, right.nodeId));
  const edges = [];
  const edgeCapabilityObservations = [];
  for (const sourceEdge of [...sourceGraph.edges].sort((left, right) => (
    compareCodeUnits(left.sourceEdgeId, right.sourceEdgeId)
  ))) {
    const traversals = adapter.topologyMapping.values[sourceEdge.direction];
    for (const traversal of traversals) {
      const reverse = traversal === 'reverse';
      const edgeId = `${sourceEdge.sourceEdgeId}:${traversal}`;
      edges.push({
        edgeId,
        fromNodeId: reverse ? sourceEdge.toSourceNodeId : sourceEdge.fromSourceNodeId,
        toNodeId: reverse ? sourceEdge.fromSourceNodeId : sourceEdge.toSourceNodeId,
        distanceMm: sourceEdge.distanceMm,
        objectiveCostUnits: sourceEdge.objectiveCostUnits,
      });
      edgeCapabilityObservations.push({
        edgeId,
        observations: CAPABILITY_IDS.map((capabilityId) => {
          const sourceField = Object.entries(adapter.capabilityMapping.fields)
            .find(([, mappedId]) => mappedId === capabilityId)[0];
          return capabilityObservation(sourceEdge.capabilities[sourceField].token, capabilityId, sourceGraph.sourceId);
        }),
      });
    }
  }
  edges.sort((left, right) => compareCodeUnits(left.edgeId, right.edgeId));
  edgeCapabilityObservations.sort((left, right) => compareCodeUnits(left.edgeId, right.edgeId));
  const graphContent = {
    schemaVersion: adapter.outputSchemaVersion,
    graphId: boundedId(
      `${adapter.cityId}:synthetic:${sourceGraph.sourceVersion}`,
      'CityAdapter derived graphId',
    ),
    mode: adapter.modeMapping.outputMode,
    directed: true,
    nodes,
    edges,
    components: buildWeakComponents(nodes, edges),
    provenance: {
      dataClassification: 'synthetic',
      sourceIds: [sourceGraph.sourceId],
    },
  };
  const artifactIdentity = contentIdentity({
    graphArtifact: graphContent,
    adapterContentIdentity: adapter.adapterContentIdentity,
    inputContentIdentity,
  });
  const graphArtifact = {
    ...graphContent,
    receipt: {
      artifactVersion: boundedId(
        `city-graph:${artifactIdentity.digest.slice('sha256:'.length)}`,
        'CityAdapter derived artifactVersion',
      ),
    },
  };
  const projection = {
    schemaVersion: CITY_ADAPTER_SCHEMA_VERSIONS.adaptationResult,
    cityId: adapter.cityId,
    adapterVersion: adapter.adapterVersion,
    sourceProfileVersion: adapter.sourceProfileVersion,
    sourceVersion: sourceGraph.sourceVersion,
    adapterContentIdentity: adapter.adapterContentIdentity,
    inputContentIdentity,
    graphArtifact,
    edgeCapabilityObservations,
    coverage: adapter.coverage,
    limitations: adapter.limitations,
  };
  return {
    ...projection,
    outputContentIdentity: contentIdentity(projection),
  };
}

export function admitCityAdaptationResult(raw, rawOptions) {
  const options = exactObject(
    rawOptions,
    'CityAdaptationResult options',
    ['sourceGraph'],
    ['adapter'],
  );
  const rawSourceGraph = options.sourceGraph;
  const rawAdapter = Object.hasOwn(options, 'adapter')
    ? options.adapter
    : PHILADELPHIA_SYNTHETIC_CITY_ADAPTER;
  const adapter = admitCityAdapter(rawAdapter);
  const sourceGraph = admitSourceGraph(rawSourceGraph, adapter);
  const rawResult = inspectAdaptationResult(raw);
  const admittedGraphArtifact = admitGraphArtifact(rawResult.graphArtifact);
  const expected = buildExpectedAdaptationResult(sourceGraph, adapter);
  const candidate = { ...rawResult, graphArtifact: admittedGraphArtifact };
  if (canonicalStringify(candidate) !== canonicalStringify(expected)) {
    fail('CityAdaptationResult must exactly match recomputation from the admitted sourceGraph and adapter');
  }
  return deepFreeze(expected);
}

export function buildCityAdapterOutputIdentity(rawResult, options) {
  return admitCityAdaptationResult(rawResult, options).outputContentIdentity;
}

export function adaptPhiladelphiaSyntheticGraph(
  rawSourceGraph,
  rawAdapter = PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
) {
  const adapter = admitCityAdapter(rawAdapter);
  const sourceGraph = admitSourceGraph(rawSourceGraph, adapter);
  const expected = buildExpectedAdaptationResult(sourceGraph, adapter);
  return admitCityAdaptationResult(expected, { sourceGraph, adapter });
}

function contentIdentity(value) {
  const canonical = canonicalStringify(value);
  return {
    schemaVersion: CITY_ADAPTER_SCHEMA_VERSIONS.contentIdentity,
    canonicalization: CITY_ADAPTER_IDENTITY_CANONICALIZATION,
    digestAlgorithm: 'sha256',
    canonicalUtf8Bytes: new TextEncoder().encode(canonical).length,
    digest: `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`,
  };
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function snapshotData(value, label, seen = new WeakSet(), depth = 0) {
  if (depth > 64) fail(`${label} exceeds the supported nesting depth`);
  if (value === null) return null;
  if (typeof value !== 'object') {
    if (typeof value === 'string' || typeof value === 'boolean'
      || (typeof value === 'number' && Number.isFinite(value))) return value;
    fail(`${label} contains unsupported data`);
  }
  if (utilTypes.isProxy(value)) fail(`${label} must not be a Proxy`);
  if (seen.has(value)) fail(`${label} must not contain cycles or aliases`);
  seen.add(value);
  let copy;
  if (Array.isArray(value)) {
    const items = strictArray(value, label);
    copy = items.map((item, index) => snapshotData(item, `${label}[${index}]`, seen, depth + 1));
  } else {
    const { keys, descriptors } = inspectPlainObject(value, label);
    copy = Object.fromEntries(keys.map((key) => [
      key,
      snapshotData(descriptors[key].value, `${label}.${key}`, seen, depth + 1),
    ]));
  }
  seen.delete(value);
  return copy;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}
