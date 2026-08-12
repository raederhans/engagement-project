import {
  CANDIDATE_SET_LIMITATIONS,
  ROUTE_DECISION_SCHEMA_VERSIONS,
  admitCandidateSet,
  admitGraphArtifact,
  admitRouteCandidateFacts,
  admitRouteRequest,
} from '../route_decision/contracts/index.js';
import { solveShortestRoute } from './base_dijkstra.js';

/**
 * Exact public seam from the versioned S0 graph/request contracts to the
 * isolated base router. It generates at most one base-objective candidate and
 * never implies that constraint-aware or alternative search was performed.
 */
export function generateRouteFoundation(rawGraphArtifact, rawRouteRequest) {
  let graphArtifact;
  let routeRequest;
  try {
    graphArtifact = admitGraphArtifact(rawGraphArtifact);
    routeRequest = admitRouteRequest(rawRouteRequest);
  } catch {
    return terminalFailure('invalid-input', 'public-contract-invalid');
  }

  if (graphArtifact.graphId !== routeRequest.graphId || graphArtifact.mode !== routeRequest.mode) {
    return terminalFailure('invalid-input', 'graph-request-identity-mismatch');
  }

  const solverResult = solveShortestRoute({
    graphArtifact,
    startNodeId: routeRequest.originNodeId,
    endNodeId: routeRequest.destinationNodeId,
  });

  if (solverResult.status === 'invalid_graph') {
    return terminalFailure('invalid-graph', 'admitted-graph-not-routable');
  }
  if (solverResult.status === 'endpoint_unavailable') {
    return terminalWithCandidates('endpoint-unavailable', graphArtifact, routeRequest, []);
  }
  if (solverResult.status === 'no_route') {
    return terminalWithCandidates('no-route', graphArtifact, routeRequest, []);
  }
  if (solverResult.status !== 'ready') {
    return terminalFailure('invalid-graph', 'solver-terminal-unsupported');
  }

  try {
    const candidate = admitRouteCandidateFacts({
      schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.routeCandidateFacts,
      candidateId: routeRequest.requestId,
      edgeIds: [...solverResult.edgePath],
      distanceMm: solverResult.distanceMm,
      objectiveCostUnits: solverResult.objectiveCostUnits,
      observations: {},
      provenance: {
        graphId: graphArtifact.graphId,
        dataClassification: graphArtifact.provenance.dataClassification,
      },
    });
    return terminalWithCandidates('ready', graphArtifact, routeRequest, [candidate]);
  } catch {
    return terminalFailure('invalid-graph', 'solver-output-contract-invalid');
  }
}

function terminalWithCandidates(status, graphArtifact, routeRequest, candidateFacts) {
  try {
    const candidateIds = candidateFacts.map(({ candidateId }) => candidateId);
    const candidateSet = admitCandidateSet({
      schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.candidateSet,
      candidateSetId: routeRequest.requestId,
      candidateSetRevision: graphArtifact.receipt.artifactVersion,
      requestId: routeRequest.requestId,
      graphId: graphArtifact.graphId,
      strategy: 'base-objective-only',
      objectiveFactorId: 'objective-cost-units',
      candidateIds,
      candidateCount: candidateIds.length,
      completeness: 'incomplete',
      constraintAwareSearch: false,
      limitations: CANDIDATE_SET_LIMITATIONS,
    });
    return Object.freeze({
      status,
      candidateSet,
      candidateFacts: Object.freeze([...candidateFacts]),
    });
  } catch {
    return terminalFailure('invalid-graph', 'candidate-set-contract-invalid');
  }
}

function terminalFailure(status, reasonCode) {
  return Object.freeze({ status, reasonCode });
}
