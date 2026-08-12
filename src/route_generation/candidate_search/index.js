import {
  ROUTE_DECISION_SCHEMA_VERSIONS,
  admitGraphArtifact,
  admitSourceObservation,
} from '../../route_decision/contracts/index.js';
import {
  ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS,
  ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
  admitRouteCandidateSearchRequest,
  admitRouteCandidateSearchResult,
} from '../../route_decision/contracts/candidate_search_v2.js';
import {
  compareStableIds,
  compileNormalizedGraph,
} from '../normalized_graph.js';

const MAX_SAFE_TOTAL = BigInt(Number.MAX_SAFE_INTEGER);
const AGGREGATED_CAPABILITY_SOURCE_ID = 'synthetic-route-search-edge-aggregation';
const COMPLETENESS_SCOPE = 'loopless-directed-routes-within-max-route-edge-count';

export const ROUTE_CANDIDATE_SEARCH_CAPACITY = Object.freeze({
  version: 'bounded-frontier-capacity/v1',
  maxFrontierStates: 4_096,
  maxFrontierEdgeReferences: 65_536,
});

/**
 * One expanded state is one non-destination loopless path label, below the
 * maxRouteEdgeCount bound, removed from a frontier and inspected for outgoing
 * directed edges. Dead ends count. Destination labels and labels already at the
 * edge-count bound do not, because neither is expanded. The same unit applies
 * to the constraint-filtered enumeration and any topology-only classification
 * pass, and their shared count never exceeds maxExpandedStates.
 */
export const ROUTE_CANDIDATE_SEARCH_EXPANDED_STATE_UNIT = Object.freeze({
  version: 'loopless-frontier-state-expansion/v1',
  includes: 'nonterminal-label-adjacency-inspection',
  sharedAcrossClassificationPasses: true,
});

/**
 * Generate a finalized ordered prefix of bounded loopless directed routes.
 *
 * edgeObservationsByEdgeId is private search input, not another public schema:
 * it is a plain object keyed by admitted graph edge ID, whose values are plain
 * objects keyed only by the request's admitted search-constraint factor IDs.
 * Every supplied value is re-admitted through the existing SourceObservation
 * contract. A missing edge/factor is unresolved evidence.
 */
export function searchRouteCandidates(
  rawGraphArtifact,
  rawSearchRequest,
  rawEdgeObservationsByEdgeId = {},
) {
  let input;
  try {
    input = admitSearchInput(
      rawGraphArtifact,
      rawSearchRequest,
      rawEdgeObservationsByEdgeId,
    );
  } catch {
    return invalidInputResult();
  }

  const { graphArtifact, graph, request, edgeObservationsByEdgeId } = input;
  const availableNodeIds = new Set(graph.nodes.map(({ nodeId }) => nodeId));
  if (!availableNodeIds.has(request.originNodeId)
    || !availableNodeIds.has(request.destinationNodeId)) {
    return admitRouteCandidateSearchResult({
      schemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchResult,
      status: 'not-started',
      termination: 'endpoint-unavailable',
      request,
      candidateSet: null,
      candidateFacts: [],
    });
  }

  // An empty same-endpoint route has no directed edge evidence to aggregate.
  // Without constraints it remains the deterministic zero-edge primary; with
  // any admitted edge-local hard constraint, vacuous truth must not invent an
  // observed capability. Fail closed without expanding the graph.
  if (request.originNodeId === request.destinationNodeId
    && request.hardConstraints.length > 0) {
    return searchedResult({
      graphArtifact,
      request,
      routes: [],
      expandedStateCount: 0,
      termination: 'unresolved-constraint-evidence',
      unresolvedEvidenceEncountered: true,
    });
  }

  const searchContext = createSearchContext(graph, request, edgeObservationsByEdgeId);
  const budget = { expandedStateCount: 0 };
  const constrained = enumerateRoutes(searchContext, budget, true);
  if (constrained.outcome === 'overflow') return invalidInputResult();

  if (constrained.outcome === 'requested-count-reached') {
    return searchedResult({
      graphArtifact,
      request,
      routes: constrained.routes,
      expandedStateCount: budget.expandedStateCount,
      termination: 'requested-candidate-count-reached',
      unresolvedEvidenceEncountered: constrained.unresolvedEvidenceEncountered,
    });
  }
  if (constrained.outcome === 'budget-exhausted') {
    return searchedResult({
      graphArtifact,
      request,
      routes: constrained.routes,
      expandedStateCount: budget.expandedStateCount,
      termination: 'search-budget-exhausted',
      unresolvedEvidenceEncountered: constrained.unresolvedEvidenceEncountered,
    });
  }
  if (constrained.outcome === 'capacity-exhausted') {
    return searchedResult({
      graphArtifact,
      request,
      routes: constrained.routes,
      expandedStateCount: budget.expandedStateCount,
      termination: 'search-capacity-exhausted',
      unresolvedEvidenceEncountered: constrained.unresolvedEvidenceEncountered,
    });
  }

  if (constrained.routes.length > 0) {
    return searchedResult({
      graphArtifact,
      request,
      routes: constrained.routes,
      expandedStateCount: budget.expandedStateCount,
      termination: constrained.unresolvedEvidenceEncountered
        ? 'unresolved-constraint-evidence'
        : 'bounded-search-space-exhausted',
      unresolvedEvidenceEncountered: constrained.unresolvedEvidenceEncountered,
    });
  }

  if (request.hardConstraints.length === 0) {
    return searchedResult({
      graphArtifact,
      request,
      routes: [],
      expandedStateCount: budget.expandedStateCount,
      termination: 'no-directed-route-in-bounded-scope',
      unresolvedEvidenceEncountered: false,
    });
  }

  if (constrained.unresolvedEvidenceEncountered) {
    return searchedResult({
      graphArtifact,
      request,
      routes: [],
      expandedStateCount: budget.expandedStateCount,
      termination: 'unresolved-constraint-evidence',
      unresolvedEvidenceEncountered: true,
    });
  }

  if (!constrained.knownConstraintFailureEncountered) {
    return searchedResult({
      graphArtifact,
      request,
      routes: [],
      expandedStateCount: budget.expandedStateCount,
      termination: 'no-directed-route-in-bounded-scope',
      unresolvedEvidenceEncountered: false,
    });
  }

  // A definite constraint failure may have occurred only on a dead branch. A
  // second pass over the same bounded simple-path space, sharing the expansion
  // budget, is required before distinguishing bounded no-route from bounded
  // no-eligible-route. It produces no public candidates.
  const topology = enumerateRoutes(searchContext, budget, false, 1);
  if (topology.outcome === 'overflow') return invalidInputResult();
  if (topology.outcome === 'budget-exhausted') {
    return searchedResult({
      graphArtifact,
      request,
      routes: [],
      expandedStateCount: budget.expandedStateCount,
      termination: 'search-budget-exhausted',
      unresolvedEvidenceEncountered: false,
    });
  }
  if (topology.outcome === 'capacity-exhausted') {
    return searchedResult({
      graphArtifact,
      request,
      routes: [],
      expandedStateCount: budget.expandedStateCount,
      termination: 'search-capacity-exhausted',
      unresolvedEvidenceEncountered: false,
    });
  }
  return searchedResult({
    graphArtifact,
    request,
    routes: [],
    expandedStateCount: budget.expandedStateCount,
    termination: topology.routes.length > 0
      ? 'no-eligible-route-in-bounded-scope'
      : 'no-directed-route-in-bounded-scope',
    unresolvedEvidenceEncountered: false,
  });
}

function admitSearchInput(rawGraphArtifact, rawSearchRequest, rawEdgeObservationsByEdgeId) {
  const graphArtifact = admitGraphArtifact(rawGraphArtifact);
  const request = admitRouteCandidateSearchRequest(rawSearchRequest);
  if (request.graphId !== graphArtifact.graphId || request.mode !== graphArtifact.mode) {
    throw new TypeError('candidate search graph/request identity mismatch');
  }
  const compilation = compileNormalizedGraph(graphArtifact);
  if (compilation.status !== 'ready') {
    throw new TypeError('admitted graph cannot be normalized');
  }
  const edgeObservationsByEdgeId = admitEdgeObservations(
    rawEdgeObservationsByEdgeId,
    compilation.graph,
    request,
  );
  return {
    graphArtifact,
    graph: compilation.graph,
    request,
    edgeObservationsByEdgeId,
  };
}

function admitEdgeObservations(raw, graph, request) {
  const root = inspectDataObject(raw, 'edge observations');
  const graphEdgeIds = new Set(graph.edges.map(({ edgeId }) => edgeId));
  const requestedFactorIds = new Set(
    request.hardConstraints.map(({ factorId }) => factorId),
  );
  const admitted = new Map();

  for (const edgeId of root.keys) {
    if (!graphEdgeIds.has(edgeId)) {
      throw new TypeError(`edge observations contain unknown edge ${edgeId}`);
    }
    const rawObservations = root.descriptors[edgeId].value;
    const observations = inspectDataObject(rawObservations, `edge observations.${edgeId}`);
    const admittedByFactorId = new Map();
    for (const factorId of observations.keys) {
      if (!requestedFactorIds.has(factorId)) {
        throw new TypeError(`edge observations contain unused factor ${factorId}`);
      }
      const observation = admitSourceObservation(observations.descriptors[factorId].value);
      if (observation.factorId !== factorId) {
        throw new TypeError(`edge observation factor mismatch for ${edgeId}`);
      }
      admittedByFactorId.set(factorId, observation);
    }
    admitted.set(edgeId, admittedByFactorId);
  }
  return admitted;
}

function inspectDataObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  let prototype;
  let keys;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new TypeError(`${label} cannot be inspected safely`);
  }
  if (prototype !== Object.prototype || keys.some((key) => typeof key === 'symbol')) {
    throw new TypeError(`${label} must be a plain string-keyed object`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(descriptors[key], 'value')) {
      throw new TypeError(`${label} must contain data properties only`);
    }
  }
  return { keys, descriptors };
}

function createSearchContext(graph, request, edgeObservationsByEdgeId) {
  const edgeById = new Map(graph.edges.map((edge) => [edge.edgeId, edge]));
  const outgoingByNodeId = new Map(graph.adjacency.map(({ nodeId, outgoingEdgeIds }) => [
    nodeId,
    outgoingEdgeIds.map((edgeId) => edgeById.get(edgeId)),
  ]));
  return { graph, request, outgoingByNodeId, edgeObservationsByEdgeId };
}

function enumerateRoutes(context, budget, applyConstraints, requestedCount = null) {
  const { request } = context;
  const routeLimit = requestedCount ?? request.requestedCandidateCount;
  const frontier = new MinHeap(compareLabels);
  frontier.push({
    nodeId: request.originNodeId,
    nodePath: [request.originNodeId],
    edgePath: [],
    distanceMm: 0n,
    objectiveCostUnits: 0n,
    unresolvedConstraintEvidence: false,
  });
  const routes = [];
  let frontierEdgeReferenceCount = 0;
  let unresolvedEvidenceEncountered = false;
  let knownConstraintFailureEncountered = false;

  while (frontier.size > 0) {
    const next = frontier.peek();
    if (next.nodeId === request.destinationNodeId) {
      const finalized = frontier.pop();
      frontierEdgeReferenceCount -= finalized.edgePath.length;
      if (applyConstraints && finalized.unresolvedConstraintEvidence) {
        unresolvedEvidenceEncountered = true;
        continue;
      }
      routes.push(finalized);
      if (routes.length === routeLimit) {
        return enumerationResult(
          'requested-count-reached',
          routes,
          unresolvedEvidenceEncountered,
          knownConstraintFailureEncountered,
        );
      }
      continue;
    }
    if (next.edgePath.length >= request.bounds.maxRouteEdgeCount) {
      const bounded = frontier.pop();
      frontierEdgeReferenceCount -= bounded.edgePath.length;
      continue;
    }
    if (budget.expandedStateCount >= request.bounds.maxExpandedStates) {
      return enumerationResult(
        'budget-exhausted',
        routes,
        unresolvedEvidenceEncountered,
        knownConstraintFailureEncountered,
      );
    }

    const current = frontier.pop();
    frontierEdgeReferenceCount -= current.edgePath.length;
    budget.expandedStateCount += 1;
    for (const edge of context.outgoingByNodeId.get(current.nodeId)) {
      if (current.nodePath.includes(edge.toNodeId)) continue;

      let unresolvedConstraintEvidence = current.unresolvedConstraintEvidence;
      if (applyConstraints) {
        const constraintDisposition = classifyEdgeConstraints(edge.edgeId, context);
        if (constraintDisposition === 'failed') {
          knownConstraintFailureEncountered = true;
          continue;
        }
        // An unresolved edge excludes the route from the returned candidate
        // set, but the rest of that bounded loopless route must still be
        // inspected. A later known-false edge dominates unresolved evidence
        // under the public every-edge aggregation contract.
        unresolvedConstraintEvidence ||= constraintDisposition === 'unresolved';
      }

      const distanceMm = current.distanceMm + BigInt(edge.distanceMm);
      const objectiveCostUnits = current.objectiveCostUnits + BigInt(edge.objectiveCostUnits);
      if (distanceMm > MAX_SAFE_TOTAL || objectiveCostUnits > MAX_SAFE_TOTAL) {
        return enumerationResult(
          'overflow',
          routes,
          unresolvedEvidenceEncountered,
          knownConstraintFailureEncountered,
        );
      }
      const nextEdgePathLength = current.edgePath.length + 1;
      if (frontier.size >= ROUTE_CANDIDATE_SEARCH_CAPACITY.maxFrontierStates
        || frontierEdgeReferenceCount + nextEdgePathLength
          > ROUTE_CANDIDATE_SEARCH_CAPACITY.maxFrontierEdgeReferences) {
        return enumerationResult(
          'capacity-exhausted',
          routes,
          unresolvedEvidenceEncountered,
          knownConstraintFailureEncountered,
        );
      }
      frontier.push({
        nodeId: edge.toNodeId,
        nodePath: [...current.nodePath, edge.toNodeId],
        edgePath: [...current.edgePath, edge.edgeId],
        distanceMm,
        objectiveCostUnits,
        unresolvedConstraintEvidence,
      });
      frontierEdgeReferenceCount += nextEdgePathLength;
    }
  }

  return enumerationResult(
    'frontier-exhausted',
    routes,
    unresolvedEvidenceEncountered,
    knownConstraintFailureEncountered,
  );
}

function enumerationResult(
  outcome,
  routes,
  unresolvedEvidenceEncountered,
  knownConstraintFailureEncountered,
) {
  return {
    outcome,
    routes,
    unresolvedEvidenceEncountered,
    knownConstraintFailureEncountered,
  };
}

function classifyEdgeConstraints(edgeId, context) {
  const observations = context.edgeObservationsByEdgeId.get(edgeId);
  let hasKnownFailure = false;
  let hasUnresolvedEvidence = false;
  for (const { factorId } of context.request.hardConstraints) {
    const observation = observations?.get(factorId);
    if (!observation || observation.state !== 'observed') {
      hasUnresolvedEvidence = true;
    } else if (observation.value !== true) {
      hasKnownFailure = true;
    }
  }
  if (hasKnownFailure) return 'failed';
  if (hasUnresolvedEvidence) return 'unresolved';
  return 'eligible';
}

function searchedResult({
  graphArtifact,
  request,
  routes,
  expandedStateCount,
  termination,
  unresolvedEvidenceEncountered,
}) {
  const candidateFacts = routes.map((route, index) => routeCandidateFacts(
    route,
    index,
    graphArtifact,
    request,
  ));
  const budgetExhausted = termination === 'search-budget-exhausted';
  const capacityExhausted = termination === 'search-capacity-exhausted';
  const completeWithinBounds = [
    'bounded-search-space-exhausted',
    'no-directed-route-in-bounded-scope',
    'no-eligible-route-in-bounded-scope',
    'unresolved-constraint-evidence',
  ].includes(termination);
  const constraintOutcome = deriveConstraintOutcome({
    request,
    candidateFacts,
    termination,
    unresolvedEvidenceEncountered,
  });
  const candidateSet = {
    schemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.candidateSet,
    candidateSetId: request.requestId,
    candidateSetRevision: graphArtifact.receipt.artifactVersion,
    requestId: request.requestId,
    graphId: request.graphId,
    strategy: 'bounded-loopless-k-candidates',
    objectiveFactorId: request.objectiveFactorId,
    requestedCandidateCount: request.requestedCandidateCount,
    candidateIds: candidateFacts.map(({ candidateId }) => candidateId),
    candidateCount: candidateFacts.length,
    routeDistinctnessVersion: request.routeDistinctnessVersion,
    searchConstraintIds: request.hardConstraints.map(({ constraintId }) => constraintId),
    constraintAggregationVersion: ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
    tieBreakVersion: request.tieBreakVersion,
    bounds: { ...request.bounds },
    expandedStateCount,
    completeness: {
      routeSearch: completeWithinBounds ? 'complete-within-bounds' : 'not-proven',
      scope: COMPLETENESS_SCOPE,
    },
    constraintOutcome,
    budgetOutcome: budgetExhausted
      ? 'exhausted'
      : capacityExhausted
        ? 'capacity-exhausted'
        : 'within-budget',
  };
  return admitRouteCandidateSearchResult({
    schemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchResult,
    status: budgetExhausted || capacityExhausted ? 'stopped' : 'completed',
    termination,
    request,
    candidateSet,
    candidateFacts,
  });
}

function deriveConstraintOutcome({
  request,
  candidateFacts,
  termination,
  unresolvedEvidenceEncountered,
}) {
  if (request.hardConstraints.length === 0) return 'not-required';
  if (termination === 'no-directed-route-in-bounded-scope') return 'not-evaluated';
  if (termination === 'no-eligible-route-in-bounded-scope') {
    return 'no-eligible-route-in-bounded-scope-proven';
  }
  if (termination === 'requested-candidate-count-reached') {
    return 'eligible-candidates-returned';
  }
  if (termination === 'unresolved-constraint-evidence' || unresolvedEvidenceEncountered) {
    return 'unresolved-evidence';
  }
  if (candidateFacts.length > 0) return 'eligible-candidates-returned';
  return 'no-eligible-route-not-proven';
}

function routeCandidateFacts(route, index, graphArtifact, request) {
  const observations = {};
  for (const { factorId } of request.hardConstraints) {
    observations[factorId] = {
      schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.sourceObservation,
      factorId,
      state: 'observed',
      value: true,
      unit: 'boolean',
      reasonCode: null,
      sourceId: AGGREGATED_CAPABILITY_SOURCE_ID,
    };
  }
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.routeCandidateFacts,
    candidateId: `candidate:${index + 1}`,
    edgeIds: [...route.edgePath],
    distanceMm: Number(route.distanceMm),
    objectiveCostUnits: Number(route.objectiveCostUnits),
    observations,
    provenance: {
      graphId: graphArtifact.graphId,
      dataClassification: graphArtifact.provenance.dataClassification,
    },
  };
}

function invalidInputResult() {
  return admitRouteCandidateSearchResult({
    schemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchResult,
    status: 'rejected',
    termination: 'invalid-input',
    request: null,
    candidateSet: null,
    candidateFacts: [],
  });
}

function compareLabels(left, right) {
  if (left.objectiveCostUnits < right.objectiveCostUnits) return -1;
  if (left.objectiveCostUnits > right.objectiveCostUnits) return 1;
  return compareIdSequences(left.edgePath, right.edgePath);
}

function compareIdSequences(left, right) {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = compareStableIds(left[index], right[index]);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

class MinHeap {
  constructor(compare) {
    this.compare = compare;
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  peek() {
    return this.items[0];
  }

  push(value) {
    this.items.push(value);
    this.#bubbleUp(this.items.length - 1);
  }

  pop() {
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this.#bubbleDown(0);
    }
    return first;
  }

  #bubbleUp(startIndex) {
    let index = startIndex;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.compare(this.items[index], this.items[parentIndex]) >= 0) break;
      [this.items[index], this.items[parentIndex]] = [
        this.items[parentIndex],
        this.items[index],
      ];
      index = parentIndex;
    }
  }

  #bubbleDown(startIndex) {
    let index = startIndex;
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let smallestIndex = index;
      if (leftIndex < this.items.length
        && this.compare(this.items[leftIndex], this.items[smallestIndex]) < 0) {
        smallestIndex = leftIndex;
      }
      if (rightIndex < this.items.length
        && this.compare(this.items[rightIndex], this.items[smallestIndex]) < 0) {
        smallestIndex = rightIndex;
      }
      if (smallestIndex === index) break;
      [this.items[index], this.items[smallestIndex]] = [
        this.items[smallestIndex],
        this.items[index],
      ];
      index = smallestIndex;
    }
  }
}
