export const ROUTE_GOLDEN_S2_GRAPH_SCHEMA_VERSION = 'route-golden-s2-synthetic-graph/v1';
export const ROUTE_GOLDEN_S2_ORACLE_CONTRACT_VERSION =
  'exhaustive-bounded-loopless-routes/v1';
export const ROUTE_GOLDEN_S2_EXPANDED_STATE_UNIT = Object.freeze({
  version: 'loopless-frontier-state-expansion/v1',
  includes: 'nonterminal-label-adjacency-inspection',
  sharedAcrossClassificationPasses: true,
});

const COMPLETENESS_SCOPE = 'loopless-directed-routes-within-max-route-edge-count';
const MAX_ORACLE_NODES = 12;
const MAX_ORACLE_EDGES = 32;
const MAX_ORACLE_ROUTES = 4_096;
const REQUEST_SCHEMA_VERSION = 'engagement-route-candidate-search-request/v1';
const SOURCE_OBSERVATION_SCHEMA_VERSION = 'engagement-route-source-observation/v1';
const DISTINCTNESS_VERSION = 'ordered-directed-edge-id-sequence/v1';
const TIE_BREAK_VERSION = 'route-candidate-search-tie-break/v1';
const AGGREGATION_VERSION = 'every-directed-edge-fail-dominates-unresolved/v1';
const UNRESOLVED_STATES = Object.freeze([
  'unknown', 'unavailable', 'partial', 'stale', 'invalid', 'missing',
]);
const SEARCH_FACTORS = Object.freeze(['step-free', 'curb-ramp-present', 'paved-surface']);
const SEARCH_FACTOR_ORDER = new Map(SEARCH_FACTORS.map((factorId, index) => [factorId, index]));
const NON_OBSERVED_REASON = Object.freeze({
  unknown: 'not-observed',
  unavailable: 'source-unavailable',
  partial: 'coverage-partial',
  stale: 'observation-stale',
  invalid: 'source-invalid',
});

export function solveS2GoldenReference(input = {}) {
  let admitted;
  try {
    admitted = admitReferenceInput(input);
  } catch {
    return freezeClone({
      status: 'rejected',
      termination: 'invalid-input',
      routes: [],
      search: null,
    });
  }

  const { graph, request, evidence } = admitted;
  const nodeIds = new Set(graph.nodes.map(({ nodeId }) => nodeId));
  if (!nodeIds.has(request.originNodeId) || !nodeIds.has(request.destinationNodeId)) {
    return freezeClone({
      status: 'not-started',
      termination: 'endpoint-unavailable',
      routes: [],
      search: null,
    });
  }

  const context = createContext(graph, request, evidence);
  const universe = enumerateAllBoundedRoutes(context);
  const eligibleUniverse = universe
    .filter((route) => classifyRoute(route, context) === 'eligible')
    .sort(compareRoutes);
  const unresolvedUniverse = universe
    .filter((route) => classifyRoute(route, context) === 'unresolved');
  const failedUniverse = universe
    .filter((route) => classifyRoute(route, context) === 'failed');
  const budget = { expandedStateCount: 0 };
  const constrained = enumerateWithExpansionUnit(context, budget, true);
  assertOrderedPrefix(constrained.routes, eligibleUniverse);

  if (constrained.outcome === 'requested-count-reached') {
    return searchedOutcome(context, constrained.routes, budget.expandedStateCount,
      'requested-candidate-count-reached', constrained.unresolvedEvidenceEncountered);
  }
  if (constrained.outcome === 'budget-exhausted') {
    return searchedOutcome(context, constrained.routes, budget.expandedStateCount,
      'search-budget-exhausted', constrained.unresolvedEvidenceEncountered);
  }
  if (constrained.routes.length > 0) {
    return searchedOutcome(
      context,
      constrained.routes,
      budget.expandedStateCount,
      unresolvedUniverse.length > 0
        ? 'unresolved-constraint-evidence'
        : 'bounded-search-space-exhausted',
      unresolvedUniverse.length > 0,
    );
  }
  if (request.hardConstraints.length === 0) {
    return searchedOutcome(context, [], budget.expandedStateCount,
      'no-directed-route-in-bounded-scope', false);
  }
  if (unresolvedUniverse.length > 0) {
    return searchedOutcome(context, [], budget.expandedStateCount,
      'unresolved-constraint-evidence', true);
  }
  if (!constrained.knownConstraintFailureEncountered) {
    if (universe.length !== 0) {
      throw new TypeError('oracle missed a bounded-route constraint classification');
    }
    return searchedOutcome(context, [], budget.expandedStateCount,
      'no-directed-route-in-bounded-scope', false);
  }
  if (universe.length > 0 && failedUniverse.length !== universe.length) {
    throw new TypeError('oracle bounded-route classification is inconsistent');
  }

  const topology = enumerateWithExpansionUnit(context, budget, false, 1);
  if (topology.outcome === 'budget-exhausted') {
    return searchedOutcome(context, [], budget.expandedStateCount,
      'search-budget-exhausted', false);
  }
  return searchedOutcome(
    context,
    [],
    budget.expandedStateCount,
    universe.length > 0
      ? 'no-eligible-route-in-bounded-scope'
      : 'no-directed-route-in-bounded-scope',
    false,
  );
}

export function enumerateS2GoldenBoundedRoutes(input = {}) {
  const { graph, request, evidence } = admitReferenceInput(input);
  return freezeClone(enumerateAllBoundedRoutes(createContext(graph, request, evidence)));
}

function admitReferenceInput(input) {
  if (!isPlainObject(input)) throw new TypeError('S2 Golden input must be an object');
  const keys = Object.keys(input).sort();
  if (!sameSequence(keys, ['edgeObservationsByEdgeId', 'graph', 'request'])) {
    throw new TypeError('S2 Golden input keys are invalid');
  }
  const graph = admitSyntheticGraph(input.graph);
  const request = admitReferenceRequest(input.request);
  if (request.graphId !== graph.graphId) throw new TypeError('graph/request mismatch');
  const evidence = admitEvidence(input.edgeObservationsByEdgeId, graph, request);
  return { graph, request, evidence };
}

function admitReferenceRequest(raw) {
  if (!isPlainObject(raw) || !sameSequence(Object.keys(raw).sort(), [
    'bounds', 'decisionPolicyId', 'destinationNodeId', 'graphId', 'hardConstraints', 'mode',
    'objectiveFactorId', 'originNodeId', 'requestId', 'requestedCandidateCount',
    'routeDistinctnessVersion', 'schemaVersion', 'tieBreakVersion',
  ])) {
    throw new TypeError('reference request keys are invalid');
  }
  if (raw.schemaVersion !== REQUEST_SCHEMA_VERSION || raw.mode !== 'walk'
    || raw.objectiveFactorId !== 'objective-cost-units'
    || raw.routeDistinctnessVersion !== DISTINCTNESS_VERSION
    || raw.tieBreakVersion !== TIE_BREAK_VERSION
    || ![raw.requestId, raw.graphId, raw.originNodeId, raw.destinationNodeId,
      raw.decisionPolicyId].every(isId)
    || !Number.isSafeInteger(raw.requestedCandidateCount)
    || raw.requestedCandidateCount < 1 || raw.requestedCandidateCount > 16) {
    throw new TypeError('reference request contract mismatch');
  }
  if (!isPlainObject(raw.bounds)
    || !sameSequence(Object.keys(raw.bounds).sort(), ['maxExpandedStates', 'maxRouteEdgeCount'])
    || !Number.isSafeInteger(raw.bounds.maxExpandedStates)
    || raw.bounds.maxExpandedStates < 1 || raw.bounds.maxExpandedStates > 1_000_000
    || !Number.isSafeInteger(raw.bounds.maxRouteEdgeCount)
    || raw.bounds.maxRouteEdgeCount < 0 || raw.bounds.maxRouteEdgeCount > 100_000) {
    throw new TypeError('reference request bounds are invalid');
  }
  if (!Array.isArray(raw.hardConstraints) || raw.hardConstraints.length > SEARCH_FACTORS.length) {
    throw new TypeError('reference request constraints are invalid');
  }
  const hardConstraints = raw.hardConstraints.map(admitReferenceConstraint);
  if (new Set(hardConstraints.map(({ constraintId }) => constraintId)).size
      !== hardConstraints.length
    || new Set(hardConstraints.map(({ factorId }) => factorId)).size
      !== hardConstraints.length) {
    throw new TypeError('reference request constraints must be unique');
  }
  hardConstraints.sort((left, right) => (
    SEARCH_FACTOR_ORDER.get(left.factorId) - SEARCH_FACTOR_ORDER.get(right.factorId)
  ));
  return {
    schemaVersion: REQUEST_SCHEMA_VERSION,
    requestId: raw.requestId,
    graphId: raw.graphId,
    mode: 'walk',
    originNodeId: raw.originNodeId,
    destinationNodeId: raw.destinationNodeId,
    decisionPolicyId: raw.decisionPolicyId,
    objectiveFactorId: 'objective-cost-units',
    requestedCandidateCount: raw.requestedCandidateCount,
    routeDistinctnessVersion: DISTINCTNESS_VERSION,
    tieBreakVersion: TIE_BREAK_VERSION,
    bounds: { ...raw.bounds },
    hardConstraints,
  };
}

function admitReferenceConstraint(raw) {
  if (!isPlainObject(raw) || !sameSequence(Object.keys(raw).sort(), [
    'aggregationVersion', 'constraintId', 'edgeEvidenceRequirement', 'expectedValue',
    'factorId', 'locality', 'operator', 'routeAggregation', 'unresolvedDisposition',
    'unresolvedStates',
  ])) {
    throw new TypeError('reference constraint keys are invalid');
  }
  if (!isId(raw.constraintId) || !SEARCH_FACTOR_ORDER.has(raw.factorId)
    || raw.locality !== 'edge-local' || raw.edgeEvidenceRequirement !== 'complete'
    || raw.operator !== 'equals' || raw.expectedValue !== true
    || raw.routeAggregation !== 'every-directed-edge'
    || raw.aggregationVersion !== AGGREGATION_VERSION
    || raw.unresolvedDisposition !== 'exclude-and-report'
    || !Array.isArray(raw.unresolvedStates)
    || !sameSequence(raw.unresolvedStates, UNRESOLVED_STATES)) {
    throw new TypeError('reference constraint contract mismatch');
  }
  return {
    constraintId: raw.constraintId,
    factorId: raw.factorId,
    locality: 'edge-local',
    edgeEvidenceRequirement: 'complete',
    operator: 'equals',
    expectedValue: true,
    routeAggregation: 'every-directed-edge',
    aggregationVersion: AGGREGATION_VERSION,
    unresolvedStates: [...UNRESOLVED_STATES],
    unresolvedDisposition: 'exclude-and-report',
  };
}

function admitSyntheticGraph(raw) {
  if (!isPlainObject(raw)) throw new TypeError('synthetic graph must be an object');
  const keys = Object.keys(raw).sort();
  if (!sameSequence(keys, ['directed', 'edges', 'graphId', 'nodes', 'schemaVersion'])) {
    throw new TypeError('synthetic graph keys are invalid');
  }
  if (raw.schemaVersion !== ROUTE_GOLDEN_S2_GRAPH_SCHEMA_VERSION || raw.directed !== true) {
    throw new TypeError('synthetic graph contract mismatch');
  }
  if (!isId(raw.graphId)) throw new TypeError('synthetic graphId is invalid');
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0
    || raw.nodes.length > MAX_ORACLE_NODES) {
    throw new TypeError('synthetic graph nodes are invalid');
  }
  const nodes = raw.nodes.map((node) => {
    if (!isPlainObject(node) || !sameSequence(Object.keys(node).sort(), ['nodeId'])
      || !isId(node.nodeId)) {
      throw new TypeError('synthetic node is invalid');
    }
    return { nodeId: node.nodeId };
  });
  const nodeIds = new Set(nodes.map(({ nodeId }) => nodeId));
  if (nodeIds.size !== nodes.length) throw new TypeError('synthetic node IDs must be unique');
  if (!Array.isArray(raw.edges) || raw.edges.length > MAX_ORACLE_EDGES) {
    throw new TypeError('synthetic graph edges are invalid');
  }
  const edges = raw.edges.map((edge) => {
    if (!isPlainObject(edge) || !sameSequence(Object.keys(edge).sort(), [
      'distanceMm', 'edgeId', 'fromNodeId', 'objectiveCostUnits', 'toNodeId',
    ])) {
      throw new TypeError('synthetic edge keys are invalid');
    }
    if (![edge.edgeId, edge.fromNodeId, edge.toNodeId].every(isId)
      || !nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)
      || !isNonNegativeSafeInteger(edge.distanceMm)
      || !isNonNegativeSafeInteger(edge.objectiveCostUnits)) {
      throw new TypeError('synthetic edge is invalid');
    }
    return { ...edge };
  });
  if (new Set(edges.map(({ edgeId }) => edgeId)).size !== edges.length) {
    throw new TypeError('synthetic edge IDs must be unique');
  }
  return { schemaVersion: raw.schemaVersion, graphId: raw.graphId, directed: true, nodes, edges };
}

function admitEvidence(raw, graph, request) {
  if (!isPlainObject(raw)) throw new TypeError('edge evidence must be an object');
  const graphEdgeIds = new Set(graph.edges.map(({ edgeId }) => edgeId));
  const factorIds = new Set(request.hardConstraints.map(({ factorId }) => factorId));
  const evidence = new Map();
  for (const edgeId of Object.keys(raw)) {
    if (!graphEdgeIds.has(edgeId) || !isPlainObject(raw[edgeId])) {
      throw new TypeError('edge evidence key is invalid');
    }
    const byFactor = new Map();
    for (const factorId of Object.keys(raw[edgeId])) {
      if (!factorIds.has(factorId)) throw new TypeError('unused evidence factor');
      const observation = admitReferenceObservation(raw[edgeId][factorId]);
      if (observation.factorId !== factorId) throw new TypeError('evidence factor mismatch');
      byFactor.set(factorId, observation);
    }
    evidence.set(edgeId, byFactor);
  }
  return evidence;
}

function admitReferenceObservation(raw) {
  if (!isPlainObject(raw) || !sameSequence(Object.keys(raw).sort(), [
    'factorId', 'reasonCode', 'schemaVersion', 'sourceId', 'state', 'unit', 'value',
  ])) {
    throw new TypeError('reference observation keys are invalid');
  }
  if (raw.schemaVersion !== SOURCE_OBSERVATION_SCHEMA_VERSION
    || !SEARCH_FACTOR_ORDER.has(raw.factorId) || raw.unit !== 'boolean'
    || !isId(raw.sourceId)) {
    throw new TypeError('reference observation contract mismatch');
  }
  if (raw.state === 'observed') {
    if (typeof raw.value !== 'boolean' || raw.reasonCode !== null) {
      throw new TypeError('reference observed capability is invalid');
    }
  } else if (!UNRESOLVED_STATES.slice(0, -1).includes(raw.state)
    || raw.value !== null || raw.reasonCode !== NON_OBSERVED_REASON[raw.state]) {
    throw new TypeError('reference unresolved capability is invalid');
  }
  return { ...raw };
}

function createContext(graph, request, evidence) {
  const outgoing = new Map(graph.nodes.map(({ nodeId }) => [nodeId, []]));
  for (const edge of graph.edges) outgoing.get(edge.fromNodeId).push(edge);
  for (const edges of outgoing.values()) edges.sort((left, right) => compareText(left.edgeId, right.edgeId));
  return { graph, request, evidence, outgoing };
}

function enumerateAllBoundedRoutes(context) {
  const { request } = context;
  const routes = [];
  const visit = (label) => {
    if (label.nodeId === request.destinationNodeId) {
      routes.push(routeFacts(label));
      if (routes.length > MAX_ORACLE_ROUTES) throw new TypeError('oracle route limit exceeded');
      return;
    }
    if (label.edgeIds.length >= request.bounds.maxRouteEdgeCount) return;
    for (const edge of context.outgoing.get(label.nodeId)) {
      if (label.nodeIds.includes(edge.toNodeId)) continue;
      visit(extendLabel(label, edge));
    }
  };
  visit(initialLabel(request.originNodeId));
  return routes.sort(compareRoutes);
}

function enumerateWithExpansionUnit(context, budget, applyConstraints, requestedCount = null) {
  const limit = requestedCount ?? context.request.requestedCandidateCount;
  const frontier = [initialLabel(context.request.originNodeId)];
  const routes = [];
  let unresolvedEvidenceEncountered = false;
  let knownConstraintFailureEncountered = false;

  while (frontier.length > 0) {
    frontier.sort(compareLabels);
    const next = frontier.shift();
    if (next.nodeId === context.request.destinationNodeId) {
      if (applyConstraints) {
        const disposition = classifyRoute(routeFacts(next), context);
        if (disposition === 'failed') {
          throw new TypeError('oracle reached a route whose known-false edge was not pruned');
        }
        if (disposition === 'unresolved') {
          unresolvedEvidenceEncountered = true;
          continue;
        }
      }
      routes.push(routeFacts(next));
      if (routes.length === limit) {
        return enumerationResult('requested-count-reached', routes,
          unresolvedEvidenceEncountered, knownConstraintFailureEncountered);
      }
      continue;
    }
    if (next.edgeIds.length >= context.request.bounds.maxRouteEdgeCount) continue;
    if (budget.expandedStateCount >= context.request.bounds.maxExpandedStates) {
      return enumerationResult('budget-exhausted', routes,
        unresolvedEvidenceEncountered, knownConstraintFailureEncountered);
    }
    budget.expandedStateCount += 1;
    for (const edge of context.outgoing.get(next.nodeId)) {
      if (next.nodeIds.includes(edge.toNodeId)) continue;
      if (applyConstraints) {
        const disposition = classifyEdge(edge.edgeId, context);
        if (disposition === 'failed') {
          knownConstraintFailureEncountered = true;
          continue;
        }
      }
      frontier.push(extendLabel(next, edge));
    }
  }
  return enumerationResult('frontier-exhausted', routes,
    unresolvedEvidenceEncountered, knownConstraintFailureEncountered);
}

function classifyEdge(edgeId, context) {
  const observations = context.evidence.get(edgeId);
  let failed = false;
  let unresolved = false;
  for (const { factorId } of context.request.hardConstraints) {
    const observation = observations?.get(factorId);
    if (!observation || observation.state !== 'observed') unresolved = true;
    else if (observation.value !== true) failed = true;
  }
  return failed ? 'failed' : unresolved ? 'unresolved' : 'eligible';
}

function classifyRoute(route, context) {
  if (route.edgeIds.length === 0 && context.request.hardConstraints.length > 0) {
    return 'unresolved';
  }
  let unresolved = false;
  for (const edgeId of route.edgeIds) {
    const disposition = classifyEdge(edgeId, context);
    if (disposition === 'failed') return 'failed';
    if (disposition === 'unresolved') unresolved = true;
  }
  return unresolved ? 'unresolved' : 'eligible';
}

function searchedOutcome(context, routes, expandedStateCount, termination,
  unresolvedEvidenceEncountered) {
  const budgetExhausted = termination === 'search-budget-exhausted';
  const complete = [
    'bounded-search-space-exhausted',
    'no-directed-route-in-bounded-scope',
    'no-eligible-route-in-bounded-scope',
    'unresolved-constraint-evidence',
  ].includes(termination);
  return freezeClone({
    status: budgetExhausted ? 'stopped' : 'completed',
    termination,
    routes: routes.map((route) => ({
      ...route,
      observations: Object.fromEntries(context.request.hardConstraints.map(({ factorId }) => [
        factorId,
        { state: 'observed', value: true },
      ])),
    })),
    search: {
      requestedCandidateCount: context.request.requestedCandidateCount,
      candidateCount: routes.length,
      expandedStateCount,
      completeness: {
        routeSearch: complete ? 'complete-within-bounds' : 'not-proven',
        scope: COMPLETENESS_SCOPE,
      },
      constraintOutcome: constraintOutcome(
        context.request,
        routes,
        termination,
        unresolvedEvidenceEncountered,
      ),
      budgetOutcome: budgetExhausted ? 'exhausted' : 'within-budget',
    },
  });
}

function constraintOutcome(request, routes, termination, unresolvedEvidenceEncountered) {
  if (request.hardConstraints.length === 0) return 'not-required';
  if (termination === 'no-directed-route-in-bounded-scope') return 'not-evaluated';
  if (termination === 'no-eligible-route-in-bounded-scope') {
    return 'no-eligible-route-in-bounded-scope-proven';
  }
  if (termination === 'requested-candidate-count-reached') return 'eligible-candidates-returned';
  if (termination === 'unresolved-constraint-evidence' || unresolvedEvidenceEncountered) {
    return 'unresolved-evidence';
  }
  if (routes.length > 0) return 'eligible-candidates-returned';
  return 'no-eligible-route-not-proven';
}

function initialLabel(nodeId) {
  return { nodeId, nodeIds: [nodeId], edgeIds: [], distanceMm: 0, objectiveCostUnits: 0 };
}

function extendLabel(label, edge) {
  const distanceMm = label.distanceMm + edge.distanceMm;
  const objectiveCostUnits = label.objectiveCostUnits + edge.objectiveCostUnits;
  if (!Number.isSafeInteger(distanceMm) || !Number.isSafeInteger(objectiveCostUnits)) {
    throw new TypeError('route total exceeds safe integer');
  }
  return {
    nodeId: edge.toNodeId,
    nodeIds: [...label.nodeIds, edge.toNodeId],
    edgeIds: [...label.edgeIds, edge.edgeId],
    distanceMm,
    objectiveCostUnits,
  };
}

function routeFacts(label) {
  return {
    edgeIds: [...label.edgeIds],
    nodeIds: [...label.nodeIds],
    distanceMm: label.distanceMm,
    objectiveCostUnits: label.objectiveCostUnits,
  };
}

function compareLabels(left, right) {
  if (left.objectiveCostUnits !== right.objectiveCostUnits) {
    return left.objectiveCostUnits < right.objectiveCostUnits ? -1 : 1;
  }
  return compareSequences(left.edgeIds, right.edgeIds);
}

function compareRoutes(left, right) {
  if (left.objectiveCostUnits !== right.objectiveCostUnits) {
    return left.objectiveCostUnits < right.objectiveCostUnits ? -1 : 1;
  }
  return compareSequences(left.edgeIds, right.edgeIds);
}

function compareSequences(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = compareText(left[index], right[index]);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function enumerationResult(outcome, routes, unresolvedEvidenceEncountered,
  knownConstraintFailureEncountered) {
  return { outcome, routes, unresolvedEvidenceEncountered, knownConstraintFailureEncountered };
}

function assertOrderedPrefix(actual, expected) {
  if (actual.length > expected.length) throw new TypeError('reference prefix exceeds universe');
  for (let index = 0; index < actual.length; index += 1) {
    if (JSON.stringify(actual[index]) !== JSON.stringify(expected[index])) {
      throw new TypeError('reference expansion is not an exhaustive-universe prefix');
    }
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isId(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function sameSequence(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function freezeClone(value) {
  return deepFreeze(structuredClone(value));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
