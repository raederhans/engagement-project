import {
  CANDIDATE_RECEIPT_EVIDENCE_LIMITATION,
  ROUTE_GRAPH_CANDIDATE_RECEIPT_SCHEMA,
  admitCandidateReceipt,
  approveCandidateComparison,
  artifactSummaryFromGraph,
  auditSummaryFromFreshAudit,
  candidateDataClassification,
  candidateIdFromEvidence,
  standaloneReceiptReasons,
} from './contracts.mjs';
import { admitRouteGraphCandidateLifecycle } from './candidate_lifecycle.mjs';
import { exactDataObject } from './safe_data.mjs';
import { compareRouteGraphCandidates } from './semantic_diff.mjs';

export function createCandidateReceipt(value) {
  const request = exactDataObject(value, [
    'descriptor', 'profile', 'normalization', 'baseline', 'review',
  ], 'candidate receipt request');
  const candidate = admitRouteGraphCandidateLifecycle({
    descriptor: request.descriptor,
    profile: request.profile,
    normalization: request.normalization,
  }, 'candidate');
  const baseline = request.baseline === null
    ? null
    : admitRouteGraphCandidateLifecycle(request.baseline, 'baseline');
  let comparison = compareRouteGraphCandidates({ baseline, candidate });
  if (request.review !== null) {
    comparison = approveCandidateComparison(comparison, request.review);
  }

  const source = candidate.descriptor;
  const profile = candidate.profile;
  const graph = candidate.normalization.graph;
  const audit = auditSummaryFromFreshAudit(candidate.normalization.audit);
  const artifact = artifactSummaryFromGraph(graph);
  const reasons = standaloneReceiptReasons(source, artifact, audit, comparison);
  return admitCandidateReceipt({
    schema: ROUTE_GRAPH_CANDIDATE_RECEIPT_SCHEMA,
    dataClassification: candidateDataClassification(source.sourceKind),
    candidateId: candidateIdFromEvidence(source, profile, artifact, audit),
    source,
    profile,
    artifact,
    audit,
    comparison,
    eligibility: {
      harnessEligible: false,
      productionEligible: false,
      publishEligible: false,
      reasons,
    },
    limitations: [
      'Candidate-only evidence; not a production-admitted or published route graph.',
      'Endpoint reachability does not establish freshness, completeness, mode fitness, licence approval, or public-use eligibility.',
      CANDIDATE_RECEIPT_EVIDENCE_LIMITATION,
      ...source.limitations,
    ],
  });
}
