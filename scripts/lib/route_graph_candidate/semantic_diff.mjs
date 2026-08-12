import {
  ROUTE_GRAPH_SEMANTIC_COMPARISON_SCHEMA,
} from './contracts.mjs';
import { admitRouteGraphCandidateLifecycle } from './candidate_lifecycle.mjs';
import {
  candidateSemanticIdentity,
  candidateSemanticProjection,
} from './semantic_identity.mjs';
import {
  RouteGraphCandidateContractError,
  canonicalStringify,
  freezeData,
} from './safe_data.mjs';

export function compareRouteGraphCandidates({ baseline = null, candidate }) {
  let admittedBaseline = null;
  if (baseline !== null) {
    try {
      admittedBaseline = admitLifecycle(baseline, 'baseline');
    } catch (error) {
      return failedComparison(null, null, `baseline-contract-invalid:${errorCode(error)}`);
    }
    if (admittedBaseline.audit.status !== 'passed') {
      return failedComparison(admittedBaseline.identity, null, 'baseline-topology-invalid');
    }
  }
  const baselineIdentity = admittedBaseline ? admittedBaseline.identity : null;
  let admittedCandidate;
  try {
    admittedCandidate = admitLifecycle(candidate, 'candidate');
  } catch (error) {
    return failedComparison(baselineIdentity, null, `candidate-contract-invalid:${errorCode(error)}`);
  }
  const candidateIdentity = admittedCandidate.identity;
  if (admittedCandidate.audit.status !== 'passed') {
    return failedComparison(baselineIdentity, candidateIdentity, 'candidate-topology-invalid');
  }
  if (!admittedBaseline) {
    return comparison('review-required', null, candidateIdentity, ['first-seen-candidate'], pendingReview());
  }

  const reasons = projectionDriftReasons(admittedBaseline.projection, admittedCandidate.projection);
  if (!reasons.length) return comparison('unchanged', baselineIdentity, candidateIdentity, [], noReview());
  return comparison('review-required', baselineIdentity, candidateIdentity, reasons, pendingReview());
}

function admitLifecycle(value, label) {
  const lifecycle = admitRouteGraphCandidateLifecycle(value, label);
  const { descriptor, profile, normalization } = lifecycle;
  const { graph, audit } = normalization;
  const projection = candidateSemanticProjection(descriptor, profile, graph, audit);
  return freezeData({
    descriptor,
    profile,
    graph,
    audit,
    projection,
    identity: candidateSemanticIdentity(descriptor, profile, graph, audit),
  }, `${label} admitted lifecycle`);
}

function projectionDriftReasons(baseline, candidate) {
  const checks = [
    ['schema-drift', ['sourceContractSchema', 'graphSchema', 'dataClassification']],
    ['source-identity-drift', ['sourceId', 'sourceKind']],
    ['source-owner-transport-drift', ['owner', 'transport']],
    ['license-attribution-drift', ['license', 'attribution']],
    ['coverage-drift', ['coverage']],
    ['source-as-of-drift', ['sourceAsOf']],
    ['source-content-drift', ['sourceContentIdentity']],
    ['mode-profile-drift', ['profile']],
    ['topology-drift', ['topologyIdentity']],
    ['geometry-drift', ['geometryIdentity']],
    ['count-drift', ['counts']],
    ['audit-status-drift', ['auditStatus']],
  ];
  return checks
    .filter(([, keys]) => keys.some((key) => canonicalStringify(baseline[key]) !== canonicalStringify(candidate[key])))
    .map(([reason]) => reason);
}

function comparison(disposition, baselineIdentity, candidateIdentity, reasons, review) {
  return freezeData({
    schema: ROUTE_GRAPH_SEMANTIC_COMPARISON_SCHEMA,
    disposition,
    baselineIdentity,
    candidateIdentity,
    reasons: [...new Set(reasons)].sort(),
    review,
  }, 'route graph semantic comparison');
}

function failedComparison(baselineIdentity, candidateIdentity, reason) {
  return comparison('failed', baselineIdentity, candidateIdentity, [reason], noReview());
}

function pendingReview() {
  return { status: 'pending', reviewedBy: null, reviewedAt: null, evidenceRef: null };
}

function noReview() {
  return { status: 'not-required', reviewedBy: null, reviewedAt: null, evidenceRef: null };
}

function errorCode(error) {
  return error instanceof RouteGraphCandidateContractError ? error.code : 'unexpected-error';
}
