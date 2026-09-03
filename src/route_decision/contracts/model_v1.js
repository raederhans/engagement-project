import {
  boundedId,
  booleanValue,
  deepFreeze,
  exactEnum,
  exactObject,
  exactSchemaVersion,
  exactSequence,
  fail,
  inspectPlainObject,
  safeInteger,
  strictArray,
  uniqueStrings,
} from './internal/route_decision_validator_v1.js';

const MAX_GRAPH_NODES = 100_000;
const MAX_GRAPH_EDGES = 250_000;
const MAX_CANDIDATE_EDGES = 100_000;
const MAX_GEOMETRY_POINTS = 100_001;
export const MAX_POLICY_RULES = 64;
export const MAX_RESULT_CANDIDATES = 1_000;
export const MAX_RESULT_TRACE_ITEMS = 10_000;
export const MAX_SCORING_ABSOLUTE_VALUE = Math.floor(
  Number.MAX_SAFE_INTEGER / (10_000 * 2),
);

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

export const SOFT_PREFERENCE_BINDINGS = Object.freeze({
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

function syntheticSourceId(value, label) {
  const sourceId = boundedId(value, label);
  if (!sourceId.startsWith('synthetic-')) {
    fail(`${label} must identify a synthetic source`);
  }
  return sourceId;
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
