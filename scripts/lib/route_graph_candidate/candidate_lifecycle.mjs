import {
  admitModeProfile,
  admitSourceDescriptor,
  candidateDataClassification,
} from './contracts.mjs';
import {
  ROUTE_GRAPH_CANDIDATE_SCHEMA,
  auditRouteGraphCandidate,
} from './graph_audit.mjs';
import {
  canonicalStringify,
  exactDataObject,
  fail,
  freezeData,
} from './safe_data.mjs';

export function admitRouteGraphCandidateLifecycle(value, label = 'candidate') {
  const lifecycle = exactDataObject(value, [
    'descriptor', 'profile', 'normalization',
  ], `${label} lifecycle`);
  const descriptor = admitSourceDescriptor(lifecycle.descriptor);
  const profile = admitModeProfile(lifecycle.profile);
  const normalization = exactDataObject(lifecycle.normalization, [
    'status', 'graph', 'audit',
  ], `${label}.normalization`);
  if (!normalization.graph) {
    fail('normalization-graph-required', `${label} requires the full normalized graph`);
  }
  if (normalization.graph.schema !== ROUTE_GRAPH_CANDIDATE_SCHEMA) {
    fail('normalization-graph-schema', `${label} requires the candidate graph schema`);
  }
  if (descriptor.sourceKind !== profile.sourceKind) {
    fail('source-profile-kind', `${label} source and profile kinds must match`);
  }
  if (normalization.graph.sourceKind !== descriptor.sourceKind) {
    fail('source-graph-kind', `${label} graph must retain its real source kind`);
  }
  if (normalization.graph.sourceId !== descriptor.sourceId) {
    fail('source-graph-id', `${label} source and graph ids must match`);
  }
  if (normalization.graph.dataClassification !== candidateDataClassification(descriptor.sourceKind)) {
    fail('source-graph-classification', `${label} source and graph candidate classifications must match`);
  }
  if (normalization.graph.profileId !== profile.profileId || normalization.graph.mode !== profile.mode) {
    fail('profile-graph-contract', `${label} graph must retain its admitted profile id and mode`);
  }

  const audit = auditRouteGraphCandidate(normalization.graph);
  const status = audit.status === 'passed' ? 'ready' : 'failed';
  if (normalization.status !== status) {
    fail('normalization-status-drift', `${label} normalization status must be mechanically derived from a fresh full-graph audit`);
  }
  if (canonicalStringify(normalization.audit) !== canonicalStringify(audit)) {
    fail('normalization-audit-drift', `${label} normalization audit must match the fresh full-graph audit`);
  }
  return freezeData({
    descriptor,
    profile,
    normalization: {
      status,
      graph: normalization.graph,
      audit,
    },
  }, `admitted ${label} lifecycle`);
}

export function lifecycleEvidenceFromAdmitted(value) {
  return freezeData({
    descriptor: value.descriptor,
    profile: value.profile,
    graph: value.normalization.graph,
  }, 'candidate lifecycle evidence');
}

export function admitRouteGraphCandidateLifecycleEvidence(value, label = 'candidate') {
  const evidence = exactDataObject(value, [
    'descriptor', 'profile', 'graph',
  ], `${label} lifecycle evidence`);
  const audit = auditRouteGraphCandidate(evidence.graph);
  return admitRouteGraphCandidateLifecycle({
    descriptor: evidence.descriptor,
    profile: evidence.profile,
    normalization: {
      status: audit.status === 'passed' ? 'ready' : 'failed',
      graph: evidence.graph,
      audit,
    },
  }, label);
}
