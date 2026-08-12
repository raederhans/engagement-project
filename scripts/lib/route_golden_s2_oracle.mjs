import { admitSourceObservation } from '../../src/route_decision/contracts/index.js';
import {
  admitRouteCandidateSearchRequest,
} from '../../src/route_decision/contracts/candidate_search_v2.js';

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
      constrained.unresolvedEvidenceEncountered
        ? 'unresolved-constraint-evidence'
        : 'bounded-search-space-exhausted',
      constrained.unresolvedEvidenceEncountered,
    );
  }
  if (request.hardConstraints.length === 0) {
    return searchedOutcome(context, [], budget.expandedStateCount,
      'no-directed-route-in-bounded-scope', false);
  }
  if (constrained.unresolvedEvidenceEncountered) {
    return searchedOutcome(context, [], budget.expandedStateCount,
      'unresolved-constraint-evidence', true);
  }
  if (!constrained.knownConstraintFailureEncountered) {
    return searchedOutcome(context, [], budget.expandedStateCount,
      'no-directed-route-in-bounded-scope', false);
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
    topology.routes.length > 0
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
  const request = admitRouteCandidateSearchRequest(input.request);
  if (request.graphId !== graph.graphId) throw new TypeError('graph/request mismatch');
  const evidence = admitEvidence(input.edgeObservationsByEdgeId, graph, request);
  return { graph, request, evidence };
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
      const observation = admitSourceObservation(raw[edgeId][factorId]);
      if (observation.factorId !== factorId) throw new TypeError('evidence factor mismatch');
      byFactor.set(factorId, observation);
    }
    evidence.set(edgeId, byFactor);
  }
  return evidence;
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
      if (applyConstraints && next.edgeIds.length === 0
        && context.request.hardConstraints.length > 0) {
        unresolvedEvidenceEncountered = true;
        continue;
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
        if (disposition === 'unresolved') {
          unresolvedEvidenceEncountered = true;
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
