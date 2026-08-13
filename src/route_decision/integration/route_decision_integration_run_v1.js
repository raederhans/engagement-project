import { admitDecisionPolicy } from '../contracts/index.js';
import { admitRouteCandidateSearchRequest } from '../contracts/candidate_search_v2.js';
import { evaluateAdmittedRouteSearchDecision } from '../evaluator/search_v2.js';
import {
  buildRouteDecisionExplanation,
  projectRouteDecisionExplanationPresentation,
} from '../explanation/index.js';
import { searchRouteCandidates } from '../../route_generation/candidate_search/index.js';

import {
  CITY_ROUTE_DECISION_BINDING_VERSION,
  admitCityRouteDecisionBinding,
  projectBindingEvidenceForSearch,
} from './city_route_decision_binding_v1.js';
import {
  compareCodeUnits,
  contentIdentity,
  contractFail,
  deepFreeze,
  exactDataObject,
  sameData,
  snapshotData,
} from './contract_support.js';

export const ROUTE_DECISION_INTEGRATION_RUN_VERSION =
  'engagement-route-decision-integration-run/v1';
export const ROUTE_DECISION_INTEGRATION_RUN_IDENTITY_VERSION =
  'engagement-route-decision-integration-run-identity/v1';

const RUN_IDENTITY_CANONICALIZATION =
  'route-decision-integration-run-canonical-json/v1';
const CLAIM_LIMITATIONS = Object.freeze([
  'deterministic-node-tooling-execution-only',
  'not-performance-authority',
  'not-external-graph-authority',
  'not-browser-or-worker-authenticity',
  'not-safety-or-safer-route-advice',
  'not-route-recommendation',
  'not-user-preference-evidence',
  'not-accessibility-outcome-evidence',
  'not-scientific-validity',
  'not-product-runtime-or-public-admission',
]);

function fail(message) {
  contractFail('RouteDecisionIntegrationRun/v1 contract', message);
}

function canonicalPolicy(rawPolicy) {
  const admitted = admitDecisionPolicy(snapshotData(rawPolicy, 'integration run decisionPolicy', fail));
  const canonical = {
    ...admitted,
    hardConstraints: [...admitted.hardConstraints]
      .sort((left, right) => compareCodeUnits(left.constraintId, right.constraintId)),
    softPreferences: [...admitted.softPreferences]
      .sort((left, right) => compareCodeUnits(left.preferenceId, right.preferenceId)),
  };
  return admitDecisionPolicy(snapshotData(canonical, 'canonical integration run policy', fail));
}

function executionTruth(searchResult) {
  const candidateSet = searchResult.candidateSet;
  const searched = candidateSet !== null;
  const stopped = searchResult.status === 'stopped';
  const routeSearchCompleteness = candidateSet?.completeness.routeSearch ?? 'not-established';
  const constraintOutcome = candidateSet?.constraintOutcome ?? 'not-established';
  const boundedNoEligibleRouteProven =
    searchResult.termination === 'no-eligible-route-in-bounded-scope'
    && routeSearchCompleteness === 'complete-within-bounds'
    && constraintOutcome === 'no-eligible-route-in-bounded-scope-proven';
  return {
    schemaVersion: 'engagement-route-decision-integration-run-truth/v1',
    searchStatus: searchResult.status,
    termination: searchResult.termination,
    searched,
    stopped,
    partial: stopped,
    incomplete: routeSearchCompleteness !== 'complete-within-bounds',
    routeSearchCompleteness,
    constraintOutcome,
    edgeFactorCoverage: 'complete',
    missingCoverageAccepted: false,
    boundedNoEligibleRouteProven,
  };
}

function revisionChain(binding, searchResult, explanation) {
  const graphArtifactVersion =
    binding.cityAdaptationResult.graphArtifact.receipt.artifactVersion;
  const candidateSetRevision = searchResult.candidateSet?.candidateSetRevision ?? null;
  const explanationInputRevision = explanation.inputIdentity.candidateSetRevision;
  if (candidateSetRevision === null || explanationInputRevision === null) {
    fail('a run artifact requires a searched CandidateSet and explanation revision');
  }
  if (candidateSetRevision !== graphArtifactVersion
    || explanationInputRevision !== graphArtifactVersion) {
    fail('graph artifactVersion, CandidateSet revision, and Explanation input revision must exactly match');
  }
  return {
    schemaVersion: 'engagement-route-decision-integration-revision-chain/v1',
    graphArtifactVersion,
    candidateSetRevision,
    explanationInputRevision,
    exactMatch: true,
  };
}

function assertRunInputCompatibility(binding, searchRequest, decisionPolicy) {
  const graph = binding.cityAdaptationResult.graphArtifact;
  if (searchRequest.graphId !== graph.graphId || searchRequest.mode !== graph.mode) {
    fail('search request must exactly bind the recomputed city graph identity');
  }
  if (searchRequest.decisionPolicyId !== decisionPolicy.policyId) {
    fail('search request decisionPolicyId must match the admitted policy');
  }
  const nodeIds = new Set(graph.nodes.map(({ nodeId }) => nodeId));
  if (!nodeIds.has(searchRequest.originNodeId)
    || !nodeIds.has(searchRequest.destinationNodeId)) {
    fail('integration run endpoints must exist so the revision chain can be established');
  }
}

function expectedRun(rawInput) {
  const input = exactDataObject(
    rawInput,
    ['binding', 'searchRequest', 'decisionPolicy'],
    'integration run build input',
    fail,
  );
  const binding = admitCityRouteDecisionBinding(input.binding);
  if (binding.schemaVersion !== CITY_ROUTE_DECISION_BINDING_VERSION) {
    fail('binding schemaVersion is unsupported');
  }
  const searchRequest = admitRouteCandidateSearchRequest(
    snapshotData(input.searchRequest, 'integration run searchRequest', fail),
  );
  const decisionPolicy = canonicalPolicy(input.decisionPolicy);
  assertRunInputCompatibility(binding, searchRequest, decisionPolicy);

  const factorIds = searchRequest.hardConstraints.map(({ factorId }) => factorId);
  const searchEvidence = projectBindingEvidenceForSearch(binding, factorIds);
  const searchResult = searchRouteCandidates(
    binding.cityAdaptationResult.graphArtifact,
    searchRequest,
    searchEvidence,
  );
  if (searchResult.status === 'rejected' || searchResult.status === 'not-started') {
    fail(`admitted integration inputs produced unsupported search status ${searchResult.status}`);
  }
  const decisionEvaluation = evaluateAdmittedRouteSearchDecision({
    policy: decisionPolicy,
    candidateArtifact: searchResult,
  });
  const explanation = buildRouteDecisionExplanation({ decisionEvaluation });
  const presentation = projectRouteDecisionExplanationPresentation(explanation);
  const truth = executionTruth(searchResult);
  const revisions = revisionChain(binding, searchResult, explanation);
  const claimBoundary = {
    schemaVersion: 'engagement-route-decision-integration-run-claim-boundary/v1',
    eligibleClaims: ['deterministic-execution-for-exact-admitted-inputs'],
    limitations: [...CLAIM_LIMITATIONS],
  };
  const runIdentity = contentIdentity(
    ROUTE_DECISION_INTEGRATION_RUN_IDENTITY_VERSION,
    RUN_IDENTITY_CANONICALIZATION,
    {
      schemaVersion: ROUTE_DECISION_INTEGRATION_RUN_VERSION,
      bindingIdentity: binding.bindingIdentity,
      searchRequest,
      decisionPolicy,
      searchResult,
      decisionEvaluation,
      explanation,
      presentation,
      truth,
      revisions,
      claimBoundary,
    },
  );
  return deepFreeze({
    schemaVersion: ROUTE_DECISION_INTEGRATION_RUN_VERSION,
    binding,
    searchRequest,
    decisionPolicy,
    searchResult,
    decisionEvaluation,
    explanation,
    presentation,
    truth,
    revisions,
    claimBoundary,
    runIdentity,
  });
}

export function buildRouteDecisionIntegrationRun(input) {
  return expectedRun(input);
}

export function admitRouteDecisionIntegrationRun(raw) {
  const value = exactDataObject(raw, [
    'schemaVersion',
    'binding',
    'searchRequest',
    'decisionPolicy',
    'searchResult',
    'decisionEvaluation',
    'explanation',
    'presentation',
    'truth',
    'revisions',
    'claimBoundary',
    'runIdentity',
  ], 'RouteDecisionIntegrationRun', fail);
  if (value.schemaVersion !== ROUTE_DECISION_INTEGRATION_RUN_VERSION) {
    fail('schemaVersion is unsupported');
  }
  const expected = expectedRun({
    binding: value.binding,
    searchRequest: value.searchRequest,
    decisionPolicy: value.decisionPolicy,
  });
  const supplied = snapshotData(raw, 'RouteDecisionIntegrationRun', fail);
  if (!sameData(supplied, expected)) {
    fail('artifact must exactly match full binding, search, evaluation, explanation, and presentation recomputation');
  }
  return expected;
}
