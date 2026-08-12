import { evaluateAdmittedRouteSearchDecision } from '../../src/route_decision/evaluator/search_v2.js';
import { searchRouteCandidates } from '../../src/route_generation/candidate_search/index.js';

export const ROUTE_S3_PRODUCT_ADAPTER_VERSION = 's3-product-adapter/v1';

function privateConstraintEvidence(edgeFactorEvidence, searchRequest) {
  const factorIds = searchRequest.hardConstraints.map(({ factorId }) => factorId);
  return Object.fromEntries(edgeFactorEvidence.edgeEvidence.map(({ edgeId, observations }) => [
    edgeId,
    Object.fromEntries(factorIds.map((factorId) => [
      factorId,
      structuredClone(observations[factorId]),
    ])),
  ]));
}

export function invokeRouteS3Product({
  graphArtifact,
  searchRequest,
  edgeFactorEvidence,
  decisionPolicy,
  invocationId,
}) {
  const searchResult = searchRouteCandidates(
    graphArtifact,
    searchRequest,
    privateConstraintEvidence(edgeFactorEvidence, searchRequest),
  );
  const decisionEvaluation = evaluateAdmittedRouteSearchDecision({
    policy: decisionPolicy,
    candidateArtifact: searchResult,
  });
  return Object.freeze({ invocationId, searchResult, decisionEvaluation });
}
