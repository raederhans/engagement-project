import {
  admitCandidateEligibility,
  admitCandidateReceipt,
  approveCandidateComparison,
  artifactSummaryFromGraph,
  auditSummaryFromFreshAudit,
  candidateDataClassification,
  candidateGateReasons,
} from './contracts.mjs';
import {
  admitRouteGraphCandidateLifecycle,
  admitRouteGraphCandidateLifecycleEvidence,
  lifecycleEvidenceFromAdmitted,
} from './candidate_lifecycle.mjs';
import { createCandidateReceipt } from './candidate_receipt.mjs';
import {
  canonicalStringify,
  exactDataObject,
  fail,
  freezeData,
} from './safe_data.mjs';
import { compareRouteGraphCandidates } from './semantic_diff.mjs';

export const ROUTE_GRAPH_CANDIDATE_BUNDLE_SCHEMA = 'route-graph-candidate-bundle/v3';

export function createCandidateBundle(value) {
  const request = exactDataObject(value, [
    'descriptor', 'profile', 'normalization', 'baseline', 'review',
  ], 'candidate bundle request');
  const candidate = admitRouteGraphCandidateLifecycle({
    descriptor: request.descriptor,
    profile: request.profile,
    normalization: request.normalization,
  }, 'candidate');
  const baseline = request.baseline === null
    ? null
    : admitRouteGraphCandidateLifecycle(request.baseline, 'baseline');
  const receipt = createCandidateReceipt(request);
  const reasons = candidateGateReasons(
    receipt.source,
    receipt.artifact,
    receipt.audit,
    receipt.comparison,
  );
  return admitCandidateBundle({
    schema: ROUTE_GRAPH_CANDIDATE_BUNDLE_SCHEMA,
    dataClassification: receipt.dataClassification,
    baseline: baseline === null ? null : lifecycleEvidenceFromAdmitted(baseline),
    graph: candidate.normalization.graph,
    receipt,
    eligibility: {
      harnessEligible: reasons.length === 0,
      productionEligible: false,
      publishEligible: false,
      reasons,
    },
  });
}

export function admitCandidateBundle(value) {
  const bundle = exactDataObject(value, [
    'schema', 'dataClassification', 'baseline', 'graph', 'receipt', 'eligibility',
  ], 'route graph candidate bundle');
  if (bundle.schema !== ROUTE_GRAPH_CANDIDATE_BUNDLE_SCHEMA) {
    fail('bundle-schema', 'route graph candidate bundle schema is unsupported');
  }
  const receipt = admitCandidateReceipt(bundle.receipt);
  const candidate = admitRouteGraphCandidateLifecycleEvidence({
    descriptor: receipt.source,
    profile: receipt.profile,
    graph: bundle.graph,
  }, 'bundle candidate');
  const baseline = bundle.baseline === null
    ? null
    : admitRouteGraphCandidateLifecycleEvidence(bundle.baseline, 'bundle baseline');
  const graph = candidate.normalization.graph;
  const expectedClassification = candidateDataClassification(graph.sourceKind);
  if (bundle.dataClassification !== expectedClassification
    || receipt.dataClassification !== expectedClassification
    || graph.dataClassification !== expectedClassification) {
    fail('bundle-data-classification', 'bundle, graph, and receipt must retain the real candidate source classification');
  }

  const expectedArtifact = artifactSummaryFromGraph(graph);
  if (canonicalStringify(receipt.artifact) !== canonicalStringify(expectedArtifact)) {
    fail('bundle-artifact-drift', 'receipt artifact summary does not match the full bundle graph');
  }
  const expectedAudit = auditSummaryFromFreshAudit(candidate.normalization.audit);
  if (canonicalStringify(receipt.audit) !== canonicalStringify(expectedAudit)) {
    fail('bundle-audit-drift', 'receipt audit summary does not match a fresh full-graph audit');
  }

  let expectedComparison = compareRouteGraphCandidates({ baseline, candidate });
  if (receipt.comparison.disposition === 'review-approved') {
    expectedComparison = approveCandidateComparison(expectedComparison, {
      reviewedBy: receipt.comparison.review.reviewedBy,
      reviewedAt: receipt.comparison.review.reviewedAt,
      evidenceRef: receipt.comparison.review.evidenceRef,
    });
  }
  if (canonicalStringify(receipt.comparison) !== canonicalStringify(expectedComparison)) {
    fail('bundle-comparison-drift', 'receipt comparison must be recomputed from the submitted baseline and candidate lifecycles');
  }

  const eligibility = admitCandidateEligibility(bundle.eligibility, 'bundle.eligibility');
  const expectedReasons = candidateGateReasons(
    receipt.source,
    expectedArtifact,
    expectedAudit,
    expectedComparison,
  );
  const expectedHarnessEligible = expectedReasons.length === 0;
  if (eligibility.harnessEligible !== expectedHarnessEligible
    || canonicalStringify(eligibility.reasons) !== canonicalStringify(expectedReasons)) {
    fail('bundle-eligibility-drift', 'bundle eligibility must be mechanically recomputed from the admitted lifecycle evidence');
  }
  if (eligibility.productionEligible || eligibility.publishEligible) {
    fail('bundle-public-eligibility', 'candidate bundle v3 can never be production- or publish-eligible');
  }
  return freezeData({
    schema: ROUTE_GRAPH_CANDIDATE_BUNDLE_SCHEMA,
    dataClassification: expectedClassification,
    baseline: baseline === null ? null : lifecycleEvidenceFromAdmitted(baseline),
    graph,
    receipt,
    eligibility,
  }, 'admitted route graph candidate bundle');
}
