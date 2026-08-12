const MAX_ID_LENGTH = 120;
const MAX_GRAPH_NODES = 100_000;
const MAX_GRAPH_EDGES = 250_000;
const MAX_CANDIDATE_EDGES = 100_000;
const MAX_GEOMETRY_POINTS = 100_001;
const MAX_POLICY_RULES = 64;
const MAX_RESULT_CANDIDATES = 1_000;
const MAX_RESULT_TRACE_ITEMS = 10_000;
const MAX_SCORING_ABSOLUTE_VALUE = Math.floor(
  Number.MAX_SAFE_INTEGER / (10_000 * 2),
);

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,119})$/;
const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

export const ROUTE_DECISION_SCHEMA_VERSIONS = Object.freeze({
  graphArtifact: 'engagement-route-graph/v1',
  routeRequest: 'engagement-route-request/v1',
  routeCandidateFacts: 'engagement-route-candidate-facts/v1',
  candidateSet: 'engagement-route-candidate-set/v1',
  sourceObservation: 'engagement-route-source-observation/v1',
  travelNeedCatalog: 'engagement-travel-need-catalog/v1',
  decisionPolicy: 'engagement-route-decision-policy/v1',
  decisionResult: 'engagement-route-decision-result/v1',
  scenarioRunManifest: 'engagement-route-scenario-run-manifest/v1',
  boundary: 'engagement-route-decision-boundary/v1',
});

export const ROUTE_OBSERVATION_STATES = Object.freeze([
  'observed',
  'zero',
  'unknown',
  'unavailable',
  'partial',
  'stale',
  'invalid',
]);

export const ROUTE_CONSTRAINT_FACTOR_IDS = Object.freeze([
  'step-free',
  'curb-ramp-present',
  'paved-surface',
  'stairs-count',
]);

export const ROUTE_RANKING_FACTOR_IDS = Object.freeze([
  'distance-mm',
  'objective-cost-units',
]);

export const ROUTE_OBSERVATION_TAGS = ROUTE_CONSTRAINT_FACTOR_IDS;

export const CAPABILITY_OBSERVATION_TAGS = Object.freeze([
  'step-free',
  'curb-ramp-present',
  'paved-surface',
]);

export const FUNCTIONAL_NEED_TAGS = Object.freeze([
  'require-capability',
  'minimize-distance',
  'minimize-objective-cost',
]);

export const DECISION_POLICY_OPERATORS = Object.freeze(['equals', 'minimize']);
export const DECISION_TIE_BREAK_TAGS = Object.freeze([
  'score-units',
  'objective-cost-units',
  'distance-mm',
  'candidate-id',
]);

export const UNRESOLVED_OBSERVATION_STATES = Object.freeze([
  'unknown',
  'unavailable',
  'partial',
  'stale',
  'invalid',
  'missing',
]);

const OBSERVATION_STATE_SET = new Set(ROUTE_OBSERVATION_STATES);
const OBSERVATION_TAG_SET = new Set(ROUTE_CONSTRAINT_FACTOR_IDS);
const CAPABILITY_OBSERVATION_TAG_SET = new Set(CAPABILITY_OBSERVATION_TAGS);
const FUNCTIONAL_NEED_TAG_SET = new Set(FUNCTIONAL_NEED_TAGS);
const TIE_BREAK_TAG_SET = new Set(DECISION_TIE_BREAK_TAGS);
const UNRESOLVED_STATE_SET = new Set(UNRESOLVED_OBSERVATION_STATES);

const OBSERVATION_DEFINITIONS = Object.freeze({
  'step-free': Object.freeze({ kind: 'boolean', unit: 'boolean' }),
  'curb-ramp-present': Object.freeze({ kind: 'boolean', unit: 'boolean' }),
  'paved-surface': Object.freeze({ kind: 'boolean', unit: 'boolean' }),
  'stairs-count': Object.freeze({ kind: 'integer', unit: 'count' }),
});

const NON_OBSERVED_REASON_BY_STATE = Object.freeze({
  unknown: 'not-observed',
  unavailable: 'source-unavailable',
  partial: 'coverage-partial',
  stale: 'observation-stale',
  invalid: 'source-invalid',
});

const TRAVEL_NEED_DEFINITIONS = Object.freeze({
  'require-capability': Object.freeze({
    kind: 'hard-constraint',
    operator: 'equals',
    valueUnit: 'boolean',
  }),
  'minimize-distance': Object.freeze({
    kind: 'soft-preference',
    operator: 'minimize',
    valueUnit: 'millimetres',
  }),
  'minimize-objective-cost': Object.freeze({
    kind: 'soft-preference',
    operator: 'minimize',
    valueUnit: 'cost-units',
  }),
});

const SOFT_PREFERENCE_BINDINGS = Object.freeze({
  'minimize-distance': Object.freeze({
    factorId: 'distance-mm',
    direction: 'minimize',
    unit: 'millimetres',
  }),
  'minimize-objective-cost': Object.freeze({
    factorId: 'objective-cost-units',
    direction: 'minimize',
    unit: 'cost-units',
  }),
});

const TIE_BREAK_DIRECTIONS = new Set(['ascending', 'descending']);

function fail(message) {
  throw new TypeError(`route decision contract: ${message}`);
}

function inspectPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    fail(`${label} must not contain symbol properties`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of ownKeys) {
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value')) {
      fail(`${label} must contain data properties only`);
    }
  }
  return { ownKeys, descriptors };
}

function exactObject(value, label, requiredKeys, optionalKeys = []) {
  const { ownKeys, descriptors } = inspectPlainObject(value, label);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const missing = requiredKeys.filter((key) => !Object.hasOwn(descriptors, key));
  const unknown = ownKeys.filter((key) => !allowed.has(key));
  if (missing.length || unknown.length) {
    fail(`${label} schema mismatch (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`);
  }
  return Object.fromEntries(
    ownKeys.map((key) => [key, descriptors[key].value]),
  );
}

function strictArray(value, label, { min = 0, max } = {}) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${label} must be an array`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    fail(`${label} must not contain symbol properties`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < min || (max !== undefined && length > max)) {
    fail(`${label} length is outside the supported range`);
  }
  const items = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor) fail(`${label} must not contain sparse entries`);
    if (!Object.hasOwn(descriptor, 'value')) {
      fail(`${label} must contain data properties only`);
    }
    items.push(descriptor.value);
  }
  const extra = ownKeys.filter((key) => key !== 'length'
    && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length));
  if (extra.length) fail(`${label} contains unsupported properties`);
  return items;
}

function exactSchemaVersion(value, expected, label) {
  if (value !== expected) fail(`${label}.schemaVersion is unsupported`);
  return value;
}

function boundedId(value, label) {
  if (typeof value !== 'string' || value.length > MAX_ID_LENGTH
    || !ID_PATTERN.test(value) || BLOCKED_PROPERTY_NAMES.has(value)) {
    fail(`${label} must be a bounded canonical id`);
  }
  return value;
}

function syntheticSourceId(value, label) {
  const sourceId = boundedId(value, label);
  if (!sourceId.startsWith('synthetic-')) {
    fail(`${label} must identify a synthetic source`);
  }
  return sourceId;
}

function exactEnum(value, allowed, label) {
  if (typeof value !== 'string' || !allowed.has(value)) fail(`${label} is unsupported`);
  return value;
}

function safeInteger(value, label, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < min || value > max) {
    fail(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function booleanValue(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be a boolean`);
  return value;
}

function uniqueStrings(value, label, {
  min = 0,
  max,
  validator = boundedId,
} = {}) {
  const items = strictArray(value, label, { min, max });
  const admitted = items.map((item, index) => validator(item, `${label}[${index}]`));
  if (new Set(admitted).size !== admitted.length) fail(`${label} must be unique`);
  return admitted;
}

function exactSequence(value, expected, label) {
  const sequence = strictArray(value, label, { max: expected.length });
  if (sequence.length !== expected.length
    || sequence.some((item, index) => item !== expected[index])) {
    fail(`${label} must exactly preserve ${expected.join(',')}`);
  }
  return [...sequence];
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function admitSourceObservationAt(raw, label) {
  const value = exactObject(raw, label, [
    'schemaVersion',
    'factorId',
    'state',
    'value',
    'unit',
    'reasonCode',
    'sourceId',
  ]);
  exactSchemaVersion(value.schemaVersion, ROUTE_DECISION_SCHEMA_VERSIONS.sourceObservation, label);
  const factorId = exactEnum(value.factorId, OBSERVATION_TAG_SET, `${label}.factorId`);
  const state = exactEnum(value.state, OBSERVATION_STATE_SET, `${label}.state`);
  const definition = OBSERVATION_DEFINITIONS[factorId];
  if (value.unit !== definition.unit) fail(`${label}.unit must be ${definition.unit}`);
  const sourceId = syntheticSourceId(value.sourceId, `${label}.sourceId`);

  let admittedValue;
  let reasonCode;
  if (state === 'observed') {
    if (value.reasonCode !== null) fail(`${label}.observed must not carry a reasonCode`);
    if (definition.kind === 'boolean') {
      admittedValue = booleanValue(value.value, `${label}.value`);
    } else {
      admittedValue = safeInteger(value.value, `${label}.value`, { min: 1 });
    }
    reasonCode = null;
  } else if (state === 'zero') {
    if (definition.kind !== 'integer' || value.value !== 0) {
      fail(`${label}.zero requires an integer observation with value 0`);
    }
    if (value.reasonCode !== null) fail(`${label}.zero must not carry a reasonCode`);
    admittedValue = 0;
    reasonCode = null;
  } else {
    if (value.value !== null) fail(`${label}.${state} must not carry a value`);
    const expectedReason = NON_OBSERVED_REASON_BY_STATE[state];
    if (value.reasonCode !== expectedReason) {
      fail(`${label}.${state} reasonCode must be ${expectedReason}`);
    }
    admittedValue = null;
    reasonCode = expectedReason;
  }

  return deepFreeze({
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.sourceObservation,
    factorId,
    state,
    value: admittedValue,
    unit: definition.unit,
    reasonCode,
    sourceId,
  });
}

export function admitSourceObservation(value) {
  return admitSourceObservationAt(value, 'source observation');
}

export function admitGraphArtifact(raw) {
  const value = exactObject(raw, 'GraphArtifact', [
    'schemaVersion',
    'graphId',
    'mode',
    'directed',
    'nodes',
    'edges',
    'components',
    'provenance',
    'receipt',
  ]);
  exactSchemaVersion(value.schemaVersion, ROUTE_DECISION_SCHEMA_VERSIONS.graphArtifact, 'GraphArtifact');
  const graphId = boundedId(value.graphId, 'GraphArtifact.graphId');
  if (value.mode !== 'walk') fail('GraphArtifact.mode is unsupported');
  if (value.directed !== true) fail('GraphArtifact.directed must be true');

  const rawNodes = strictArray(value.nodes, 'GraphArtifact.nodes', { min: 1, max: MAX_GRAPH_NODES });
  const nodeIds = new Set();
  const nodes = rawNodes.map((rawNode, index) => {
    const node = exactObject(rawNode, `GraphArtifact.nodes[${index}]`, ['nodeId']);
    const nodeId = boundedId(node.nodeId, `GraphArtifact.nodes[${index}].nodeId`);
    if (nodeIds.has(nodeId)) fail(`GraphArtifact.nodes contains duplicate nodeId ${nodeId}`);
    nodeIds.add(nodeId);
    return { nodeId };
  });

  const rawEdges = strictArray(value.edges, 'GraphArtifact.edges', { max: MAX_GRAPH_EDGES });
  const edgeIds = new Set();
  const edges = rawEdges.map((rawEdge, index) => {
    const label = `GraphArtifact.edges[${index}]`;
    const edge = exactObject(rawEdge, label, [
      'edgeId',
      'fromNodeId',
      'toNodeId',
      'distanceMm',
      'objectiveCostUnits',
    ]);
    const edgeId = boundedId(edge.edgeId, `${label}.edgeId`);
    if (edgeIds.has(edgeId)) fail(`GraphArtifact.edges contains duplicate edgeId ${edgeId}`);
    edgeIds.add(edgeId);
    const fromNodeId = boundedId(edge.fromNodeId, `${label}.fromNodeId`);
    const toNodeId = boundedId(edge.toNodeId, `${label}.toNodeId`);
    if (!nodeIds.has(fromNodeId)) fail(`${label} references unknown fromNodeId`);
    if (!nodeIds.has(toNodeId)) fail(`${label} references unknown toNodeId`);
    return {
      edgeId,
      fromNodeId,
      toNodeId,
      distanceMm: safeInteger(edge.distanceMm, `${label}.distanceMm`, { min: 0 }),
      objectiveCostUnits: safeInteger(
        edge.objectiveCostUnits,
        `${label}.objectiveCostUnits`,
        { min: 0 },
      ),
    };
  });

  const nodeIndexById = new Map(nodes.map(({ nodeId }, index) => [nodeId, index]));
  const weakNeighbors = nodes.map(() => []);
  for (const edge of edges) {
    const fromIndex = nodeIndexById.get(edge.fromNodeId);
    const toIndex = nodeIndexById.get(edge.toNodeId);
    weakNeighbors[fromIndex].push(toIndex);
    weakNeighbors[toIndex].push(fromIndex);
  }
  const visited = new Uint8Array(nodes.length);
  let actualWeakComponentCount = 0;
  for (let start = 0; start < nodes.length; start += 1) {
    if (visited[start]) continue;
    actualWeakComponentCount += 1;
    visited[start] = 1;
    const queue = [start];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const neighbor of weakNeighbors[queue[cursor]]) {
        if (visited[neighbor]) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
  }

  const components = exactObject(
    value.components,
    'GraphArtifact.components',
    ['kind', 'count', 'byNodeId'],
  );
  if (components.kind !== 'weakly-connected') {
    fail('GraphArtifact.components.kind must be weakly-connected');
  }
  const componentCount = safeInteger(
    components.count,
    'GraphArtifact.components.count',
    { min: 1, max: nodes.length },
  );
  exactObject(
    components.byNodeId,
    'GraphArtifact.components.byNodeId',
    nodes.map(({ nodeId }) => nodeId),
  );
  const byNodeId = {};
  const seenComponentIds = new Set();
  for (const { nodeId } of nodes) {
    const componentId = safeInteger(
      components.byNodeId[nodeId],
      `GraphArtifact.components.byNodeId.${nodeId}`,
      { min: 0, max: componentCount - 1 },
    );
    byNodeId[nodeId] = componentId;
    seenComponentIds.add(componentId);
  }
  if (seenComponentIds.size !== componentCount
    || Array.from({ length: componentCount }, (_, componentId) => componentId)
      .some((componentId) => !seenComponentIds.has(componentId))) {
    fail('GraphArtifact.components must use every declared component id');
  }
  for (const edge of edges) {
    if (byNodeId[edge.fromNodeId] !== byNodeId[edge.toNodeId]) {
      fail(`GraphArtifact edge ${edge.edgeId} crosses declared components`);
    }
  }
  if (componentCount !== actualWeakComponentCount) {
    fail('GraphArtifact.components.count does not match explicit topology');
  }

  const provenance = exactObject(value.provenance, 'GraphArtifact.provenance', [
    'dataClassification',
    'sourceIds',
  ]);
  if (provenance.dataClassification !== 'synthetic') {
    fail('GraphArtifact.provenance.dataClassification must be synthetic');
  }
  const sourceIds = uniqueStrings(provenance.sourceIds, 'GraphArtifact.provenance.sourceIds', {
    min: 1,
    max: 32,
    validator: syntheticSourceId,
  });

  const receipt = exactObject(value.receipt, 'GraphArtifact.receipt', ['artifactVersion']);
  const artifactVersion = boundedId(receipt.artifactVersion, 'GraphArtifact.receipt.artifactVersion');

  return deepFreeze({
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.graphArtifact,
    graphId,
    mode: 'walk',
    directed: true,
    nodes,
    edges,
    components: { kind: 'weakly-connected', count: componentCount, byNodeId },
    provenance: { dataClassification: 'synthetic', sourceIds },
    receipt: { artifactVersion },
  });
}

export function admitRouteRequest(raw) {
  const value = exactObject(raw, 'RouteRequest', [
    'schemaVersion',
    'requestId',
    'graphId',
    'mode',
    'originNodeId',
    'destinationNodeId',
    'decisionPolicyId',
    'maxCandidateCount',
  ]);
  exactSchemaVersion(value.schemaVersion, ROUTE_DECISION_SCHEMA_VERSIONS.routeRequest, 'RouteRequest');
  if (value.mode !== 'walk') fail('RouteRequest.mode is unsupported');
  return deepFreeze({
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.routeRequest,
    requestId: boundedId(value.requestId, 'RouteRequest.requestId'),
    graphId: boundedId(value.graphId, 'RouteRequest.graphId'),
    mode: 'walk',
    originNodeId: boundedId(value.originNodeId, 'RouteRequest.originNodeId'),
    destinationNodeId: boundedId(value.destinationNodeId, 'RouteRequest.destinationNodeId'),
    decisionPolicyId: boundedId(value.decisionPolicyId, 'RouteRequest.decisionPolicyId'),
    maxCandidateCount: safeInteger(value.maxCandidateCount, 'RouteRequest.maxCandidateCount', {
      min: 1,
      max: 16,
    }),
  });
}

function admitSyntheticGeometry(raw) {
  const value = exactObject(raw, 'RouteCandidateFacts.geometry', ['kind', 'coordinatesMm']);
  if (value.kind !== 'synthetic-polyline-mm') {
    fail('RouteCandidateFacts.geometry.kind is unsupported');
  }
  const coordinates = strictArray(
    value.coordinatesMm,
    'RouteCandidateFacts.geometry.coordinatesMm',
    { min: 1, max: MAX_GEOMETRY_POINTS },
  ).map((rawCoordinate, index) => {
    const coordinate = strictArray(
      rawCoordinate,
      `RouteCandidateFacts.geometry.coordinatesMm[${index}]`,
      { min: 2, max: 2 },
    );
    return [
      safeInteger(coordinate[0], `RouteCandidateFacts.geometry.coordinatesMm[${index}][0]`),
      safeInteger(coordinate[1], `RouteCandidateFacts.geometry.coordinatesMm[${index}][1]`),
    ];
  });
  return { kind: 'synthetic-polyline-mm', coordinatesMm: coordinates };
}

function admitCandidateObservations(raw) {
  const { ownKeys: keys, descriptors } = inspectPlainObject(
    raw,
    'RouteCandidateFacts.observations',
  );
  if (keys.length > ROUTE_OBSERVATION_TAGS.length) {
    fail('RouteCandidateFacts.observations contains too many tags');
  }
  const observations = {};
  for (const tag of keys) {
    if (!OBSERVATION_TAG_SET.has(tag)) {
      fail(`RouteCandidateFacts observation tag is unsupported: ${tag}`);
    }
    const observation = admitSourceObservationAt(
      descriptors[tag].value,
      `RouteCandidateFacts.observations.${tag}`,
    );
    if (observation.factorId !== tag) {
      fail(`RouteCandidateFacts.observations.${tag} tag does not match its key`);
    }
    observations[tag] = observation;
  }
  return observations;
}

export function admitRouteCandidateFacts(raw) {
  const value = exactObject(raw, 'RouteCandidateFacts', [
    'schemaVersion',
    'candidateId',
    'edgeIds',
    'distanceMm',
    'objectiveCostUnits',
    'observations',
    'provenance',
  ], ['geometry']);
  exactSchemaVersion(
    value.schemaVersion,
    ROUTE_DECISION_SCHEMA_VERSIONS.routeCandidateFacts,
    'RouteCandidateFacts',
  );
  const edgeIds = uniqueStrings(value.edgeIds, 'RouteCandidateFacts.edgeIds', {
    max: MAX_CANDIDATE_EDGES,
  });
  const distanceMm = safeInteger(value.distanceMm, 'RouteCandidateFacts.distanceMm', { min: 0 });
  const objectiveCostUnits = safeInteger(
    value.objectiveCostUnits,
    'RouteCandidateFacts.objectiveCostUnits',
    { min: 0 },
  );
  if (edgeIds.length === 0 && (distanceMm !== 0 || objectiveCostUnits !== 0)) {
    fail('RouteCandidateFacts with no edges must have zero distance and objective cost');
  }
  const observations = admitCandidateObservations(value.observations);
  const provenance = exactObject(value.provenance, 'RouteCandidateFacts.provenance', [
    'graphId',
    'dataClassification',
  ]);
  if (provenance.dataClassification !== 'synthetic') {
    fail('RouteCandidateFacts.provenance.dataClassification must be synthetic');
  }

  const admitted = {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.routeCandidateFacts,
    candidateId: boundedId(value.candidateId, 'RouteCandidateFacts.candidateId'),
    edgeIds,
    distanceMm,
    objectiveCostUnits,
    observations,
    provenance: {
      graphId: boundedId(provenance.graphId, 'RouteCandidateFacts.provenance.graphId'),
      dataClassification: 'synthetic',
    },
  };
  if (Object.hasOwn(value, 'geometry')) admitted.geometry = admitSyntheticGeometry(value.geometry);
  return deepFreeze(admitted);
}

export const CANDIDATE_SET_LIMITATIONS = Object.freeze([
  'only-base-objective-candidate-generated',
  'constraint-aware-alternative-search-not-performed',
]);

export function admitCandidateSet(raw) {
  const value = exactObject(raw, 'CandidateSet', [
    'schemaVersion',
    'candidateSetId',
    'candidateSetRevision',
    'requestId',
    'graphId',
    'strategy',
    'objectiveFactorId',
    'candidateIds',
    'candidateCount',
    'completeness',
    'constraintAwareSearch',
    'limitations',
  ]);
  exactSchemaVersion(
    value.schemaVersion,
    ROUTE_DECISION_SCHEMA_VERSIONS.candidateSet,
    'CandidateSet',
  );
  if (value.strategy !== 'base-objective-only') {
    fail('CandidateSet.strategy must be base-objective-only');
  }
  if (value.objectiveFactorId !== 'objective-cost-units') {
    fail('CandidateSet.objectiveFactorId must be objective-cost-units');
  }
  const candidateIds = uniqueStrings(value.candidateIds, 'CandidateSet.candidateIds', { max: 1 });
  const candidateCount = safeInteger(value.candidateCount, 'CandidateSet.candidateCount', {
    min: 0,
    max: 1,
  });
  if (candidateCount !== candidateIds.length) {
    fail('CandidateSet.candidateCount must equal candidateIds length');
  }
  if (value.completeness !== 'incomplete') {
    fail('CandidateSet.completeness must be incomplete');
  }
  if (value.constraintAwareSearch !== false) {
    fail('CandidateSet.constraintAwareSearch must be false');
  }
  const limitations = exactSequence(
    value.limitations,
    CANDIDATE_SET_LIMITATIONS,
    'CandidateSet.limitations',
  );
  return deepFreeze({
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.candidateSet,
    candidateSetId: boundedId(value.candidateSetId, 'CandidateSet.candidateSetId'),
    candidateSetRevision: boundedId(
      value.candidateSetRevision,
      'CandidateSet.candidateSetRevision',
    ),
    requestId: boundedId(value.requestId, 'CandidateSet.requestId'),
    graphId: boundedId(value.graphId, 'CandidateSet.graphId'),
    strategy: 'base-objective-only',
    objectiveFactorId: 'objective-cost-units',
    candidateIds,
    candidateCount,
    completeness: 'incomplete',
    constraintAwareSearch: false,
    limitations,
  });
}

export function admitTravelNeedCatalog(raw) {
  const value = exactObject(raw, 'TravelNeedCatalog', ['schemaVersion', 'catalogId', 'entries']);
  exactSchemaVersion(
    value.schemaVersion,
    ROUTE_DECISION_SCHEMA_VERSIONS.travelNeedCatalog,
    'TravelNeedCatalog',
  );
  const rawEntries = strictArray(value.entries, 'TravelNeedCatalog.entries', {
    max: FUNCTIONAL_NEED_TAGS.length,
  });
  const seenTags = new Set();
  const entries = rawEntries.map((rawEntry, index) => {
    const label = `TravelNeedCatalog.entries[${index}]`;
    const entry = exactObject(rawEntry, label, ['tag', 'kind', 'operator', 'valueUnit']);
    const tag = exactEnum(entry.tag, FUNCTIONAL_NEED_TAG_SET, `${label}.tag`);
    if (seenTags.has(tag)) fail('TravelNeedCatalog.entries tags must be unique');
    seenTags.add(tag);
    const expected = TRAVEL_NEED_DEFINITIONS[tag];
    for (const field of ['kind', 'operator', 'valueUnit']) {
      if (entry[field] !== expected[field]) fail(`${label}.${field} is unsupported for ${tag}`);
    }
    return { tag, ...expected };
  });
  if (seenTags.size !== FUNCTIONAL_NEED_TAGS.length
    || FUNCTIONAL_NEED_TAGS.some((tag) => !seenTags.has(tag))) {
    fail('TravelNeedCatalog must define every functional need tag');
  }
  return deepFreeze({
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.travelNeedCatalog,
    catalogId: boundedId(value.catalogId, 'TravelNeedCatalog.catalogId'),
    entries,
  });
}

export const DEFAULT_TRAVEL_NEED_CATALOG = deepFreeze({
  schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.travelNeedCatalog,
  catalogId: 'core-functional-needs-v1',
  entries: FUNCTIONAL_NEED_TAGS.map((tag) => ({ tag, ...TRAVEL_NEED_DEFINITIONS[tag] })),
});

function admitHardConstraint(raw, index) {
  const label = `DecisionPolicy.hardConstraints[${index}]`;
  const value = exactObject(raw, label, [
    'constraintId',
    'needTag',
    'factorId',
    'operator',
    'expectedValue',
    'unresolvedStates',
  ]);
  if (value.needTag !== 'require-capability') fail(`${label}.needTag is unsupported`);
  const factorId = exactEnum(
    value.factorId,
    CAPABILITY_OBSERVATION_TAG_SET,
    `${label}.factorId`,
  );
  if (value.operator !== 'equals') fail(`${label}.operator is unsupported`);
  return {
    constraintId: boundedId(value.constraintId, `${label}.constraintId`),
    needTag: 'require-capability',
    factorId,
    operator: 'equals',
    expectedValue: booleanValue(value.expectedValue, `${label}.expectedValue`),
    unresolvedStates: exactSequence(
      value.unresolvedStates,
      UNRESOLVED_OBSERVATION_STATES,
      `${label}.unresolvedStates`,
    ),
  };
}

function admitSoftPreference(raw, index) {
  const label = `DecisionPolicy.softPreferences[${index}]`;
  const value = exactObject(raw, label, [
    'preferenceId',
    'needTag',
    'factorId',
    'operator',
    'rangeMin',
    'rangeMax',
    'weightBasisPoints',
  ]);
  const binding = SOFT_PREFERENCE_BINDINGS[value.needTag];
  if (!binding) {
    fail(`${label}.needTag is unsupported`);
  }
  if (value.factorId !== binding.factorId) {
    fail(`${label}.factorId is unsupported for ${value.needTag}`);
  }
  if (value.operator !== binding.direction) fail(`${label}.operator is unsupported`);
  const rangeMin = safeInteger(value.rangeMin, `${label}.rangeMin`, {
    min: 0,
    max: MAX_SCORING_ABSOLUTE_VALUE,
  });
  const rangeMax = safeInteger(value.rangeMax, `${label}.rangeMax`, {
    min: 0,
    max: MAX_SCORING_ABSOLUTE_VALUE,
  });
  if (rangeMin >= rangeMax) fail(`${label} normalization range must increase`);
  return {
    preferenceId: boundedId(value.preferenceId, `${label}.preferenceId`),
    needTag: value.needTag,
    factorId: binding.factorId,
    operator: 'minimize',
    rangeMin,
    rangeMax,
    weightBasisPoints: safeInteger(
      value.weightBasisPoints,
      `${label}.weightBasisPoints`,
      { min: 0, max: 10_000 },
    ),
  };
}

export function admitDecisionPolicy(raw) {
  const value = exactObject(raw, 'DecisionPolicy', [
    'schemaVersion',
    'policyId',
    'hardConstraints',
    'softPreferences',
    'weightBasisPointsTotal',
    'tieBreak',
  ]);
  exactSchemaVersion(value.schemaVersion, ROUTE_DECISION_SCHEMA_VERSIONS.decisionPolicy, 'DecisionPolicy');
  const hardConstraints = strictArray(
    value.hardConstraints,
    'DecisionPolicy.hardConstraints',
    { max: MAX_POLICY_RULES },
  ).map(admitHardConstraint);
  const constraintIds = hardConstraints.map(({ constraintId }) => constraintId);
  if (new Set(constraintIds).size !== constraintIds.length) {
    fail('DecisionPolicy.hardConstraints constraintIds must be unique');
  }

  const softPreferences = strictArray(
    value.softPreferences,
    'DecisionPolicy.softPreferences',
    { min: 1, max: MAX_POLICY_RULES },
  ).map(admitSoftPreference);
  const preferenceIds = softPreferences.map(({ preferenceId }) => preferenceId);
  if (new Set(preferenceIds).size !== preferenceIds.length) {
    fail('DecisionPolicy.softPreferences preferenceIds must be unique');
  }
  const preferenceTags = softPreferences.map(({ needTag }) => needTag);
  if (new Set(preferenceTags).size !== preferenceTags.length) {
    fail('DecisionPolicy.softPreferences needTags must be unique');
  }
  if (value.weightBasisPointsTotal !== 10_000) {
    fail('DecisionPolicy.weightBasisPointsTotal must equal 10000');
  }
  const actualTotal = softPreferences.reduce((sum, item) => sum + item.weightBasisPoints, 0);
  if (actualTotal !== 10_000) fail('DecisionPolicy soft preference weights must sum to 10000');

  const tieBreak = strictArray(value.tieBreak, 'DecisionPolicy.tieBreak', {
    min: 2,
    max: DECISION_TIE_BREAK_TAGS.length,
  }).map((rawEntry, index) => {
    const label = `DecisionPolicy.tieBreak[${index}]`;
    const entry = exactObject(rawEntry, label, ['factorId', 'direction']);
    const factorId = exactEnum(entry.factorId, TIE_BREAK_TAG_SET, `${label}.factorId`);
    const direction = exactEnum(entry.direction, TIE_BREAK_DIRECTIONS, `${label}.direction`);
    if (factorId === 'score-units' && direction !== 'descending') {
      fail(`${label}.direction must be descending for score-units`);
    }
    if (factorId === 'candidate-id' && direction !== 'ascending') {
      fail(`${label}.direction must be ascending for candidate-id`);
    }
    return { factorId, direction };
  });
  const tieBreakFactors = tieBreak.map(({ factorId }) => factorId);
  if (new Set(tieBreakFactors).size !== tieBreakFactors.length) {
    fail('DecisionPolicy.tieBreak factorIds must be unique');
  }
  if (tieBreak[0].factorId !== 'score-units') {
    fail('DecisionPolicy.tieBreak must begin with score-units');
  }
  if (tieBreak.at(-1).factorId !== 'candidate-id') {
    fail('DecisionPolicy.tieBreak must end with candidate-id');
  }

  return deepFreeze({
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.decisionPolicy,
    policyId: boundedId(value.policyId, 'DecisionPolicy.policyId'),
    hardConstraints,
    softPreferences,
    weightBasisPointsTotal: 10_000,
    tieBreak,
  });
}

const RESULT_STATUS_SET = new Set([
  'ranked-in-provided-set',
  'no-eligible-candidate-in-provided-set',
  'candidate-search-incomplete',
]);

const HARD_TRACE_KEYS = Object.freeze([
  'candidateId',
  'stage',
  'constraintId',
  'factorId',
  'observationState',
  'actualValue',
  'operator',
  'expectedValue',
  'outcome',
  'reasonCode',
]);

const SOFT_TRACE_KEYS = Object.freeze([
  'candidateId',
  'stage',
  'preferenceId',
  'factorId',
  'observationState',
  'rawValue',
  'unit',
  'direction',
  'rangeMin',
  'rangeMax',
  'rangeSpan',
  'utilityNumerator',
  'utilityBasisPoints',
  'weightBasisPoints',
  'weightedScoreUnits',
  'outcome',
  'reasonCode',
]);

function unresolvedReason(prefix, observationState) {
  return `${prefix}-${observationState}-unresolved`;
}

function admitHardTraceItem(raw, label) {
  const value = exactObject(raw, label, HARD_TRACE_KEYS);
  if (value.stage !== 'hard-constraint') fail(`${label}.stage must be hard-constraint`);
  const candidateId = boundedId(value.candidateId, `${label}.candidateId`);
  const constraintId = boundedId(value.constraintId, `${label}.constraintId`);
  const factorId = exactEnum(value.factorId, CAPABILITY_OBSERVATION_TAG_SET, `${label}.factorId`);
  if (value.operator !== 'equals') fail(`${label}.operator must be equals`);
  const expectedValue = booleanValue(value.expectedValue, `${label}.expectedValue`);
  const outcome = exactEnum(
    value.outcome,
    new Set(['pass', 'reject', 'unresolved']),
    `${label}.outcome`,
  );

  if (outcome === 'unresolved') {
    const observationState = exactEnum(
      value.observationState,
      UNRESOLVED_STATE_SET,
      `${label}.observationState`,
    );
    if (value.actualValue !== null) fail(`${label}.actualValue must be null when unresolved`);
    const reasonCode = unresolvedReason('hard-constraint', observationState);
    if (value.reasonCode !== reasonCode) fail(`${label}.reasonCode is unsupported`);
    return {
      candidateId,
      stage: 'hard-constraint',
      constraintId,
      factorId,
      observationState,
      actualValue: null,
      operator: 'equals',
      expectedValue,
      outcome: 'unresolved',
      reasonCode,
    };
  }

  if (value.observationState !== 'observed') {
    fail(`${label}.observationState must be observed for ${outcome}`);
  }
  const actualValue = booleanValue(value.actualValue, `${label}.actualValue`);
  const equalityHolds = actualValue === expectedValue;
  if ((outcome === 'pass') !== equalityHolds) {
    fail(`${label}.outcome is inconsistent with actualValue and expectedValue`);
  }
  const reasonCode = outcome === 'pass'
    ? 'hard-constraint-passed'
    : 'hard-constraint-failed';
  if (value.reasonCode !== reasonCode) fail(`${label}.reasonCode is unsupported`);
  return {
    candidateId,
    stage: 'hard-constraint',
    constraintId,
    factorId,
    observationState: 'observed',
    actualValue,
    operator: 'equals',
    expectedValue,
    outcome,
    reasonCode,
  };
}

function admitSoftTraceItem(raw, label) {
  const value = exactObject(raw, label, SOFT_TRACE_KEYS);
  if (value.stage !== 'soft-preference') fail(`${label}.stage must be soft-preference`);
  const candidateId = boundedId(value.candidateId, `${label}.candidateId`);
  const preferenceId = boundedId(value.preferenceId, `${label}.preferenceId`);
  const factorId = exactEnum(
    value.factorId,
    new Set(ROUTE_RANKING_FACTOR_IDS),
    `${label}.factorId`,
  );
  const binding = Object.values(SOFT_PREFERENCE_BINDINGS)
    .find((definition) => definition.factorId === factorId);
  if (value.unit !== binding.unit) fail(`${label}.unit is unsupported for ${factorId}`);
  if (value.direction !== binding.direction) fail(`${label}.direction is unsupported`);
  const rangeMin = safeInteger(value.rangeMin, `${label}.rangeMin`, {
    min: 0,
    max: MAX_SCORING_ABSOLUTE_VALUE,
  });
  const rangeMax = safeInteger(value.rangeMax, `${label}.rangeMax`, {
    min: 0,
    max: MAX_SCORING_ABSOLUTE_VALUE,
  });
  if (rangeMin >= rangeMax) fail(`${label} normalization range must increase`);
  const rangeSpan = safeInteger(value.rangeSpan, `${label}.rangeSpan`, { min: 1 });
  if (rangeSpan !== rangeMax - rangeMin) fail(`${label}.rangeSpan is inconsistent`);
  const weightBasisPoints = safeInteger(
    value.weightBasisPoints,
    `${label}.weightBasisPoints`,
    { min: 0, max: 10_000 },
  );
  const outcome = exactEnum(
    value.outcome,
    new Set(['scored', 'unresolved']),
    `${label}.outcome`,
  );

  if (outcome === 'unresolved') {
    const observationState = exactEnum(
      value.observationState,
      UNRESOLVED_STATE_SET,
      `${label}.observationState`,
    );
    for (const field of [
      'rawValue',
      'utilityNumerator',
      'utilityBasisPoints',
      'weightedScoreUnits',
    ]) {
      if (value[field] !== null) fail(`${label}.${field} must be null when unresolved`);
    }
    const reasonCode = unresolvedReason('soft-preference', observationState);
    if (value.reasonCode !== reasonCode) fail(`${label}.reasonCode is unsupported`);
    return {
      candidateId,
      stage: 'soft-preference',
      preferenceId,
      factorId,
      observationState,
      rawValue: null,
      unit: binding.unit,
      direction: 'minimize',
      rangeMin,
      rangeMax,
      rangeSpan,
      utilityNumerator: null,
      utilityBasisPoints: null,
      weightBasisPoints,
      weightedScoreUnits: null,
      outcome: 'unresolved',
      reasonCode,
    };
  }

  const rawValue = safeInteger(value.rawValue, `${label}.rawValue`, {
    min: 0,
    max: MAX_SCORING_ABSOLUTE_VALUE,
  });
  const observationState = exactEnum(
    value.observationState,
    new Set(['observed', 'zero']),
    `${label}.observationState`,
  );
  if ((rawValue === 0) !== (observationState === 'zero')) {
    fail(`${label}.observationState must distinguish zero from observed non-zero values`);
  }
  const boundedRawValue = Math.min(rangeMax, Math.max(rangeMin, rawValue));
  const utilityNumerator = safeInteger(
    value.utilityNumerator,
    `${label}.utilityNumerator`,
    { min: 0 },
  );
  const expectedNumerator = (rangeMax - boundedRawValue) * 10_000;
  if (utilityNumerator !== expectedNumerator) fail(`${label}.utilityNumerator is inconsistent`);
  const utilityBasisPoints = safeInteger(
    value.utilityBasisPoints,
    `${label}.utilityBasisPoints`,
    { min: 0, max: 10_000 },
  );
  if (utilityBasisPoints !== Math.floor(utilityNumerator / rangeSpan)) {
    fail(`${label}.utilityBasisPoints is inconsistent`);
  }
  const weightedScoreUnits = safeInteger(
    value.weightedScoreUnits,
    `${label}.weightedScoreUnits`,
    { min: 0 },
  );
  if (weightedScoreUnits !== utilityBasisPoints * weightBasisPoints) {
    fail(`${label}.weightedScoreUnits is inconsistent`);
  }
  if (value.reasonCode !== 'soft-preference-scored') {
    fail(`${label}.reasonCode is unsupported`);
  }
  return {
    candidateId,
    stage: 'soft-preference',
    preferenceId,
    factorId,
    observationState,
    rawValue,
    unit: binding.unit,
    direction: 'minimize',
    rangeMin,
    rangeMax,
    rangeSpan,
    utilityNumerator,
    utilityBasisPoints,
    weightBasisPoints,
    weightedScoreUnits,
    outcome: 'scored',
    reasonCode: 'soft-preference-scored',
  };
}

function admitCandidateDispositionTraceItem(raw, label) {
  const value = exactObject(raw, label, [
    'candidateId',
    'stage',
    'outcome',
    'constraintIds',
    'preferenceIds',
    'totalScoreUnits',
    'reasonCode',
  ]);
  if (value.stage !== 'candidate-disposition') {
    fail(`${label}.stage must be candidate-disposition`);
  }
  const candidateId = boundedId(value.candidateId, `${label}.candidateId`);
  const outcome = exactEnum(
    value.outcome,
    new Set(['admitted', 'rejected', 'unresolved']),
    `${label}.outcome`,
  );
  const constraintIds = uniqueStrings(value.constraintIds, `${label}.constraintIds`, {
    max: MAX_POLICY_RULES,
  });
  const preferenceIds = uniqueStrings(value.preferenceIds, `${label}.preferenceIds`, {
    max: MAX_POLICY_RULES,
  });

  if (outcome === 'admitted') {
    if (constraintIds.length || preferenceIds.length) {
      fail(`${label} admitted disposition cannot cite unresolved or rejected rules`);
    }
    const totalScoreUnits = safeInteger(value.totalScoreUnits, `${label}.totalScoreUnits`, {
      min: 0,
    });
    if (value.reasonCode !== 'candidate-admitted') fail(`${label}.reasonCode is unsupported`);
    return {
      candidateId,
      stage: 'candidate-disposition',
      outcome: 'admitted',
      constraintIds,
      preferenceIds,
      totalScoreUnits,
      reasonCode: 'candidate-admitted',
    };
  }

  if (value.totalScoreUnits !== null) fail(`${label}.totalScoreUnits must be null for ${outcome}`);
  if (outcome === 'rejected') {
    if (!constraintIds.length || preferenceIds.length) {
      fail(`${label} rejected disposition must cite only rejected constraints`);
    }
    if (value.reasonCode !== 'candidate-hard-constraint-rejected') {
      fail(`${label}.reasonCode is unsupported`);
    }
    return {
      candidateId,
      stage: 'candidate-disposition',
      outcome: 'rejected',
      constraintIds,
      preferenceIds,
      totalScoreUnits: null,
      reasonCode: 'candidate-hard-constraint-rejected',
    };
  }

  if ((constraintIds.length === 0) === (preferenceIds.length === 0)) {
    fail(`${label} unresolved disposition must cite exactly one rule category`);
  }
  const reasonCode = constraintIds.length
    ? 'candidate-hard-constraint-unresolved'
    : 'candidate-soft-preference-unresolved';
  if (value.reasonCode !== reasonCode) fail(`${label}.reasonCode is unsupported`);
  return {
    candidateId,
    stage: 'candidate-disposition',
    outcome: 'unresolved',
    constraintIds,
    preferenceIds,
    totalScoreUnits: null,
    reasonCode,
  };
}

function admitTieBreakValue(raw, label) {
  const value = exactObject(raw, label, ['factorId', 'direction', 'value']);
  const factorId = exactEnum(value.factorId, TIE_BREAK_TAG_SET, `${label}.factorId`);
  const direction = exactEnum(value.direction, TIE_BREAK_DIRECTIONS, `${label}.direction`);
  if (factorId === 'score-units' && direction !== 'descending') {
    fail(`${label}.direction must be descending for score-units`);
  }
  if (factorId === 'candidate-id' && direction !== 'ascending') {
    fail(`${label}.direction must be ascending for candidate-id`);
  }
  const admittedValue = factorId === 'candidate-id'
    ? boundedId(value.value, `${label}.value`)
    : safeInteger(value.value, `${label}.value`, { min: 0 });
  return { factorId, direction, value: admittedValue };
}

function admitRankingTraceItem(raw, label) {
  const value = exactObject(raw, label, [
    'candidateId',
    'stage',
    'outcome',
    'totalScoreUnits',
    'rank',
    'tieBreakValues',
    'decidingFactorId',
    'reasonCode',
  ]);
  if (value.stage !== 'ranking') fail(`${label}.stage must be ranking`);
  if (value.outcome !== 'ranked') fail(`${label}.outcome must be ranked`);
  const candidateId = boundedId(value.candidateId, `${label}.candidateId`);
  const totalScoreUnits = safeInteger(value.totalScoreUnits, `${label}.totalScoreUnits`, {
    min: 0,
  });
  const rank = safeInteger(value.rank, `${label}.rank`, { min: 1, max: MAX_RESULT_CANDIDATES });
  const tieBreakValues = strictArray(value.tieBreakValues, `${label}.tieBreakValues`, {
    min: 2,
    max: DECISION_TIE_BREAK_TAGS.length,
  }).map((rawEntry, index) => admitTieBreakValue(
    rawEntry,
    `${label}.tieBreakValues[${index}]`,
  ));
  const factorIds = tieBreakValues.map(({ factorId }) => factorId);
  if (new Set(factorIds).size !== factorIds.length) {
    fail(`${label}.tieBreakValues factorIds must be unique`);
  }
  if (tieBreakValues[0].factorId !== 'score-units'
    || tieBreakValues[0].value !== totalScoreUnits) {
    fail(`${label}.tieBreakValues must begin with the candidate total score`);
  }
  const lastTieBreak = tieBreakValues.at(-1);
  if (lastTieBreak.factorId !== 'candidate-id' || lastTieBreak.value !== candidateId) {
    fail(`${label}.tieBreakValues must end with the candidate ID`);
  }
  let decidingFactorId = null;
  if (value.decidingFactorId !== null) {
    decidingFactorId = exactEnum(
      value.decidingFactorId,
      new Set(factorIds),
      `${label}.decidingFactorId`,
    );
  }
  if (value.reasonCode !== 'candidate-ranked') fail(`${label}.reasonCode is unsupported`);
  return {
    candidateId,
    stage: 'ranking',
    outcome: 'ranked',
    totalScoreUnits,
    rank,
    tieBreakValues,
    decidingFactorId,
    reasonCode: 'candidate-ranked',
  };
}

function admitTraceItem(raw, index) {
  const label = `DecisionResult.trace[${index}]`;
  inspectPlainObject(raw, label);
  const stageDescriptor = Object.getOwnPropertyDescriptor(raw, 'stage');
  if (!stageDescriptor || !Object.hasOwn(stageDescriptor, 'value')) {
    fail(`${label}.stage must be a data property`);
  }
  if (stageDescriptor.value === 'hard-constraint') return admitHardTraceItem(raw, label);
  if (stageDescriptor.value === 'soft-preference') return admitSoftTraceItem(raw, label);
  if (stageDescriptor.value === 'candidate-disposition') {
    return admitCandidateDispositionTraceItem(raw, label);
  }
  if (stageDescriptor.value === 'ranking') return admitRankingTraceItem(raw, label);
  fail(`${label}.stage is unsupported`);
}

function admitRejectedItem(raw, index) {
  const item = admitHardTraceItem(raw, `DecisionResult.rejected[${index}]`);
  if (item.outcome !== 'reject') fail(`DecisionResult.rejected[${index}].outcome must be reject`);
  return item;
}

function admitUnresolvedItem(raw, index) {
  const label = `DecisionResult.unresolved[${index}]`;
  inspectPlainObject(raw, label);
  const stageDescriptor = Object.getOwnPropertyDescriptor(raw, 'stage');
  if (!stageDescriptor || !Object.hasOwn(stageDescriptor, 'value')) {
    fail(`${label}.stage must be a data property`);
  }
  const item = stageDescriptor.value === 'hard-constraint'
    ? admitHardTraceItem(raw, label)
    : stageDescriptor.value === 'soft-preference'
      ? admitSoftTraceItem(raw, label)
      : fail(`${label}.stage must identify a hard constraint or soft preference`);
  if (item.outcome !== 'unresolved') fail(`${label}.outcome must be unresolved`);
  return item;
}

function duplicateComposite(items, fields) {
  const keys = items.map((item) => fields.map((field) => item[field]).join('\u0000'));
  return new Set(keys).size !== keys.length;
}

function sameIdentifierSet(actual, expected) {
  return actual.length === expected.length
    && actual.every((identifier) => expected.includes(identifier));
}

function sameTraceRecord(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function admitCandidateSetReference(raw) {
  const value = exactObject(raw, 'DecisionResult.candidateSet', [
    'schemaVersion',
    'candidateSetId',
    'candidateSetRevision',
    'candidateIds',
    'candidateCount',
    'completeness',
  ]);
  exactSchemaVersion(
    value.schemaVersion,
    ROUTE_DECISION_SCHEMA_VERSIONS.candidateSet,
    'DecisionResult.candidateSet',
  );
  const candidateIds = uniqueStrings(
    value.candidateIds,
    'DecisionResult.candidateSet.candidateIds',
    { max: 1 },
  );
  const candidateCount = safeInteger(
    value.candidateCount,
    'DecisionResult.candidateSet.candidateCount',
    { min: 0, max: 1 },
  );
  if (candidateCount !== candidateIds.length) {
    fail('DecisionResult.candidateSet.candidateCount must equal candidateIds length');
  }
  if (value.completeness !== 'incomplete') {
    fail('DecisionResult.candidateSet.completeness must be incomplete');
  }
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.candidateSet,
    candidateSetId: boundedId(
      value.candidateSetId,
      'DecisionResult.candidateSet.candidateSetId',
    ),
    candidateSetRevision: boundedId(
      value.candidateSetRevision,
      'DecisionResult.candidateSet.candidateSetRevision',
    ),
    candidateIds,
    candidateCount,
    completeness: 'incomplete',
  };
}

export function admitDecisionResult(raw) {
  const value = exactObject(raw, 'DecisionResult', [
    'schemaVersion',
    'policyId',
    'candidateSet',
    'status',
    'admittedCandidateIds',
    'rankedCandidateIds',
    'rejected',
    'unresolved',
    'trace',
  ]);
  exactSchemaVersion(value.schemaVersion, ROUTE_DECISION_SCHEMA_VERSIONS.decisionResult, 'DecisionResult');
  const policyId = boundedId(value.policyId, 'DecisionResult.policyId');
  const candidateSet = admitCandidateSetReference(value.candidateSet);
  const status = exactEnum(value.status, RESULT_STATUS_SET, 'DecisionResult.status');
  const admittedCandidateIds = uniqueStrings(
    value.admittedCandidateIds,
    'DecisionResult.admittedCandidateIds',
    { max: MAX_RESULT_CANDIDATES },
  );
  const rankedCandidateIds = uniqueStrings(
    value.rankedCandidateIds,
    'DecisionResult.rankedCandidateIds',
    { max: MAX_RESULT_CANDIDATES },
  );
  if (rankedCandidateIds.length !== admittedCandidateIds.length
    || rankedCandidateIds.some((candidateId) => !admittedCandidateIds.includes(candidateId))) {
    fail('DecisionResult.rankedCandidateIds must contain every admitted candidate exactly once');
  }

  const rejected = strictArray(value.rejected, 'DecisionResult.rejected', {
    max: MAX_RESULT_TRACE_ITEMS,
  }).map(admitRejectedItem);
  if (duplicateComposite(rejected, ['candidateId', 'constraintId'])) {
    fail('DecisionResult.rejected items must be unique');
  }
  const unresolved = strictArray(value.unresolved, 'DecisionResult.unresolved', {
    max: MAX_RESULT_TRACE_ITEMS,
  }).map(admitUnresolvedItem);
  const unresolvedKeys = unresolved.map((item) => ({
    candidateId: item.candidateId,
    stage: item.stage,
    ruleId: item.stage === 'hard-constraint' ? item.constraintId : item.preferenceId,
  }));
  if (duplicateComposite(unresolvedKeys, ['candidateId', 'stage', 'ruleId'])) {
    fail('DecisionResult.unresolved items must be unique');
  }
  const rejectedIds = new Set(rejected.map(({ candidateId }) => candidateId));
  const unresolvedIds = new Set(unresolved.map(({ candidateId }) => candidateId));
  for (const candidateId of admittedCandidateIds) {
    if (rejectedIds.has(candidateId)) fail(`DecisionResult candidate ${candidateId} is both admitted and rejected`);
    if (unresolvedIds.has(candidateId)) fail(`DecisionResult candidate ${candidateId} is both admitted and unresolved`);
  }
  if ([...rejectedIds].some((candidateId) => unresolvedIds.has(candidateId))) {
    fail('DecisionResult candidates cannot be both rejected and unresolved');
  }

  const dispositionCandidateIds = [
    ...admittedCandidateIds,
    ...rejectedIds,
    ...unresolvedIds,
  ];
  if (!sameIdentifierSet(dispositionCandidateIds, candidateSet.candidateIds)) {
    fail('DecisionResult dispositions must exactly cover the referenced candidate set');
  }

  const trace = strictArray(value.trace, 'DecisionResult.trace', {
    max: MAX_RESULT_TRACE_ITEMS,
  }).map(admitTraceItem);
  const dispositionIds = new Set(dispositionCandidateIds);
  if (trace.some(({ candidateId }) => !dispositionIds.has(candidateId))) {
    fail('DecisionResult.trace references a candidate without a disposition');
  }

  const traceIdentities = trace.map((item) => ({
    candidateId: item.candidateId,
    stage: item.stage,
    ruleId: item.constraintId ?? item.preferenceId ?? '',
  }));
  if (duplicateComposite(traceIdentities, ['candidateId', 'stage', 'ruleId'])) {
    fail('DecisionResult.trace items must have unique public identities');
  }

  for (const item of rejected) {
    if (!trace.some((traceItem) => sameTraceRecord(traceItem, item))) {
      fail('DecisionResult.rejected must have a matching rejection trace');
    }
  }
  for (const item of unresolved) {
    if (!trace.some((traceItem) => sameTraceRecord(traceItem, item))) {
      fail('DecisionResult.unresolved must have a matching unresolved trace');
    }
  }

  const dispositionTrace = trace.filter((item) => item.stage === 'candidate-disposition');
  if (dispositionTrace.length !== dispositionIds.size
    || [...dispositionIds].some((candidateId) => !dispositionTrace.some(
      (item) => item.candidateId === candidateId,
    ))) {
    fail('DecisionResult.trace must include one disposition for every candidate');
  }

  for (const disposition of dispositionTrace) {
    const candidateRejected = rejected.filter(
      (item) => item.candidateId === disposition.candidateId,
    );
    const candidateUnresolved = unresolved.filter(
      (item) => item.candidateId === disposition.candidateId,
    );
    const expectedOutcome = admittedCandidateIds.includes(disposition.candidateId)
      ? 'admitted'
      : candidateRejected.length
        ? 'rejected'
        : 'unresolved';
    if (disposition.outcome !== expectedOutcome) {
      fail('DecisionResult candidate disposition outcome is inconsistent');
    }
    if (expectedOutcome === 'rejected') {
      const constraintIds = candidateRejected.map(({ constraintId }) => constraintId);
      if (!sameIdentifierSet(disposition.constraintIds, constraintIds)) {
        fail('DecisionResult rejected disposition must cite every rejected constraint');
      }
    }
    if (expectedOutcome === 'unresolved') {
      const constraintIds = candidateUnresolved
        .filter((item) => item.stage === 'hard-constraint')
        .map(({ constraintId }) => constraintId);
      const preferenceIds = candidateUnresolved
        .filter((item) => item.stage === 'soft-preference')
        .map(({ preferenceId }) => preferenceId);
      if (!sameIdentifierSet(disposition.constraintIds, constraintIds)
        || !sameIdentifierSet(disposition.preferenceIds, preferenceIds)) {
        fail('DecisionResult unresolved disposition must cite every unresolved public rule');
      }
    }
  }

  const hasAdmitted = admittedCandidateIds.length > 0;
  const hasRejected = rejected.length > 0;
  const hasUnresolved = unresolved.length > 0;
  const statusIsConsistent = (
    (status === 'ranked-in-provided-set' && hasAdmitted && !hasRejected && !hasUnresolved)
    || (status === 'no-eligible-candidate-in-provided-set'
      && !hasAdmitted && hasRejected && !hasUnresolved)
    || (status === 'candidate-search-incomplete'
      && !hasAdmitted && !hasRejected && (hasUnresolved || candidateSet.candidateCount === 0))
  );
  if (!statusIsConsistent) fail('DecisionResult.status is inconsistent with candidate dispositions');

  const rankingTrace = trace.filter((item) => item.stage === 'ranking');
  if (rankingTrace.length !== rankedCandidateIds.length) {
    fail('DecisionResult.trace must include one ranking item for every ranked candidate');
  }
  const orderedRankingTrace = [...rankingTrace].sort((left, right) => left.rank - right.rank);
  const rankingOrder = orderedRankingTrace.map(({ candidateId }) => candidateId);
  if (!sameIdentifierSet(rankingOrder, rankedCandidateIds)
    || rankingOrder.some((candidateId, index) => rankedCandidateIds[index] !== candidateId)) {
    fail('DecisionResult.rankedCandidateIds must follow trace rank order');
  }
  if (orderedRankingTrace.some((item, index) => item.rank !== index + 1)) {
    fail('DecisionResult ranking trace ranks must be contiguous from one');
  }

  for (const candidateId of dispositionIds) {
    const candidateTrace = trace.filter((item) => item.candidateId === candidateId);
    const hardFailures = candidateTrace.filter(
      (item) => item.stage === 'hard-constraint' && item.outcome === 'reject',
    );
    const hardUnresolved = candidateTrace.filter(
      (item) => item.stage === 'hard-constraint' && item.outcome === 'unresolved',
    );
    const softScored = candidateTrace.filter(
      (item) => item.stage === 'soft-preference' && item.outcome === 'scored',
    );
    const softUnresolved = candidateTrace.filter(
      (item) => item.stage === 'soft-preference' && item.outcome === 'unresolved',
    );
    const ranking = candidateTrace.filter((item) => item.stage === 'ranking');
    const disposition = dispositionTrace.find((item) => item.candidateId === candidateId);

    if (disposition.outcome === 'rejected'
      && (hardFailures.length === 0 || softScored.length || softUnresolved.length || ranking.length)) {
      fail('DecisionResult rejected candidate trace must stop after hard-constraint rejection');
    }
    if (disposition.outcome === 'unresolved') {
      if (hardFailures.length || (!hardUnresolved.length && !softUnresolved.length) || ranking.length) {
        fail('DecisionResult unresolved candidate trace is inconsistent');
      }
      if (hardUnresolved.length && (softScored.length || softUnresolved.length)) {
        fail('DecisionResult hard-unresolved candidate cannot have soft-preference trace');
      }
    }
    if (disposition.outcome === 'admitted') {
      if (hardFailures.length || hardUnresolved.length || softUnresolved.length
        || softScored.length === 0 || ranking.length !== 1) {
        fail('DecisionResult admitted candidate trace is incomplete');
      }
      const totalScoreUnits = softScored.reduce(
        (sum, item) => sum + item.weightedScoreUnits,
        0,
      );
      if (!Number.isSafeInteger(totalScoreUnits)
        || disposition.totalScoreUnits !== totalScoreUnits
        || ranking[0].totalScoreUnits !== totalScoreUnits) {
        fail('DecisionResult total score is inconsistent with scored contributions');
      }
    }
  }

  return deepFreeze({
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.decisionResult,
    policyId,
    candidateSet,
    status,
    admittedCandidateIds,
    rankedCandidateIds,
    rejected,
    unresolved,
    trace,
  });
}

export function admitScenarioRunManifest(raw) {
  const value = exactObject(raw, 'ScenarioRunManifest', [
    'schemaVersion',
    'seed',
    'graphId',
    'policyVersions',
    'fixtureSetVersion',
    'solverVersion',
    'expectedCaseCount',
  ]);
  exactSchemaVersion(
    value.schemaVersion,
    ROUTE_DECISION_SCHEMA_VERSIONS.scenarioRunManifest,
    'ScenarioRunManifest',
  );
  return deepFreeze({
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.scenarioRunManifest,
    seed: safeInteger(value.seed, 'ScenarioRunManifest.seed', { min: 0 }),
    graphId: boundedId(value.graphId, 'ScenarioRunManifest.graphId'),
    policyVersions: uniqueStrings(
      value.policyVersions,
      'ScenarioRunManifest.policyVersions',
      { min: 1, max: MAX_POLICY_RULES },
    ),
    fixtureSetVersion: boundedId(value.fixtureSetVersion, 'ScenarioRunManifest.fixtureSetVersion'),
    solverVersion: boundedId(value.solverVersion, 'ScenarioRunManifest.solverVersion'),
    expectedCaseCount: safeInteger(
      value.expectedCaseCount,
      'ScenarioRunManifest.expectedCaseCount',
      { min: 1, max: 1_000_000 },
    ),
  });
}

export const PERMITTED_RANKING_INPUT_TAGS = Object.freeze([
  'distance-mm',
  'objective-cost-units',
]);

export const PERMITTED_CONSTRAINT_INPUT_TAGS = Object.freeze([...CAPABILITY_OBSERVATION_TAGS]);

export const PROHIBITED_RANKING_INPUT_TAGS = Object.freeze([
  'crime',
  'hin',
  'acs',
  'diary',
  'real-estate-proxy',
  'safety-score',
  'risk-score',
  'safetyBySegmentId',
]);

export const PERMITTED_CLAIM_TAGS = Object.freeze(['contract-conformance']);

export const PROHIBITED_CLAIM_TAGS = Object.freeze([
  'safe-route',
  'safer-route',
  'recommended-route',
  'risk-prediction',
  'accessibility-validated',
  'city-validated',
  'scientifically-validated',
  'user-research-validated',
  'production-validated',
]);

const PERMITTED_RANKING_INPUT_SET = new Set(PERMITTED_RANKING_INPUT_TAGS);
const PERMITTED_CONSTRAINT_INPUT_SET = new Set(PERMITTED_CONSTRAINT_INPUT_TAGS);
const PROHIBITED_RANKING_INPUT_SET = new Set(PROHIBITED_RANKING_INPUT_TAGS);
const PERMITTED_CLAIM_SET = new Set(PERMITTED_CLAIM_TAGS);
const PROHIBITED_CLAIM_SET = new Set(PROHIBITED_CLAIM_TAGS);

export function assertPermittedRankingInputTag(value) {
  if (PROHIBITED_RANKING_INPUT_SET.has(value)) fail('ranking input tag is prohibited');
  if (!PERMITTED_RANKING_INPUT_SET.has(value)) fail('ranking input tag is unsupported');
  return value;
}

export function assertPermittedConstraintInputTag(value) {
  if (!PERMITTED_CONSTRAINT_INPUT_SET.has(value)) fail('constraint input tag is unsupported');
  return value;
}

export function assertPermittedClaimTag(value) {
  if (PROHIBITED_CLAIM_SET.has(value)) fail('claim tag is prohibited');
  if (!PERMITTED_CLAIM_SET.has(value)) fail('claim tag is unsupported');
  return value;
}

export const DEFAULT_ROUTE_DECISION_BOUNDARY = deepFreeze({
  schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.boundary,
  dataClassification: 'synthetic-only',
  permittedRankingInputTags: [...PERMITTED_RANKING_INPUT_TAGS],
  permittedConstraintInputTags: [...PERMITTED_CONSTRAINT_INPUT_TAGS],
  prohibitedRankingInputTags: [...PROHIBITED_RANKING_INPUT_TAGS],
  permittedClaimTags: [...PERMITTED_CLAIM_TAGS],
  prohibitedClaimTags: [...PROHIBITED_CLAIM_TAGS],
  privacy: {
    privateDiaryData: 'excluded',
    preciseLocationCollection: 'forbidden',
    routeGeometryPersistence: 'forbidden',
    sessionPreferenceStorage: 'forbidden',
    urlEncoding: 'forbidden',
    networkTransport: 'forbidden',
    telemetry: 'forbidden',
    geolocation: 'forbidden',
    gpsTracking: 'forbidden',
  },
});

function assertBoundarySequence(value, expected, label) {
  const admitted = exactSequence(value, expected, label);
  if (admitted.some((entry) => typeof entry !== 'string')) fail(`${label} must contain strings`);
  return admitted;
}

export function admitRouteDecisionBoundary(raw) {
  const value = exactObject(raw, 'RouteDecisionBoundary', [
    'schemaVersion',
    'dataClassification',
    'permittedRankingInputTags',
    'permittedConstraintInputTags',
    'prohibitedRankingInputTags',
    'permittedClaimTags',
    'prohibitedClaimTags',
    'privacy',
  ]);
  exactSchemaVersion(value.schemaVersion, ROUTE_DECISION_SCHEMA_VERSIONS.boundary, 'RouteDecisionBoundary');
  if (value.dataClassification !== 'synthetic-only') {
    fail('RouteDecisionBoundary must match the frozen boundary data classification');
  }
  assertBoundarySequence(
    value.permittedRankingInputTags,
    PERMITTED_RANKING_INPUT_TAGS,
    'RouteDecisionBoundary.permittedRankingInputTags',
  );
  assertBoundarySequence(
    value.prohibitedRankingInputTags,
    PROHIBITED_RANKING_INPUT_TAGS,
    'RouteDecisionBoundary.prohibitedRankingInputTags',
  );
  assertBoundarySequence(
    value.permittedConstraintInputTags,
    PERMITTED_CONSTRAINT_INPUT_TAGS,
    'RouteDecisionBoundary.permittedConstraintInputTags',
  );
  assertBoundarySequence(
    value.permittedClaimTags,
    PERMITTED_CLAIM_TAGS,
    'RouteDecisionBoundary.permittedClaimTags',
  );
  assertBoundarySequence(
    value.prohibitedClaimTags,
    PROHIBITED_CLAIM_TAGS,
    'RouteDecisionBoundary.prohibitedClaimTags',
  );
  const privacy = exactObject(value.privacy, 'RouteDecisionBoundary.privacy', [
    'privateDiaryData',
    'preciseLocationCollection',
    'routeGeometryPersistence',
    'sessionPreferenceStorage',
    'urlEncoding',
    'networkTransport',
    'telemetry',
    'geolocation',
    'gpsTracking',
  ]);
  for (const [key, boundaryValue] of Object.entries(privacy)) {
    const expected = key === 'privateDiaryData' ? 'excluded' : 'forbidden';
    if (boundaryValue !== expected) {
      fail(`RouteDecisionBoundary.privacy.${key} must match the frozen boundary`);
    }
  }
  return DEFAULT_ROUTE_DECISION_BOUNDARY;
}
