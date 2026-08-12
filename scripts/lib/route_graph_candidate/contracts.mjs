import {
  boundedText,
  canonicalStringify,
  contentIdentity,
  exactDataObject,
  exactTimestamp,
  fail,
  freezeData,
  httpUrl,
  stringArray,
} from './safe_data.mjs';
import {
  ROUTE_GRAPH_CANDIDATE_SCHEMA,
} from './graph_audit.mjs';
import { candidateSemanticIdentity } from './semantic_identity.mjs';

export const ROUTE_GRAPH_MODE_PROFILE_SCHEMA = 'route-graph-mode-profile/v1';
export const ROUTE_GRAPH_SOURCE_DESCRIPTOR_SCHEMA = 'route-graph-source-descriptor/v1';
export const ROUTE_GRAPH_CANDIDATE_RECEIPT_SCHEMA = 'route-graph-candidate-receipt/v3';
export const ROUTE_GRAPH_SEMANTIC_COMPARISON_SCHEMA = 'route-graph-semantic-comparison/v2';

export const CANDIDATE_RECEIPT_EVIDENCE_LIMITATION = 'A standalone receipt is a recomputable summary; it does not prove source history, acquisition authenticity, baseline existence, or prior admission.';

export function candidateDataClassification(sourceKindValue) {
  sourceKind(sourceKindValue, 'sourceKind');
  return sourceKindValue === 'synthetic'
    ? 'candidate-synthetic-fixture'
    : 'candidate-external';
}

const SOURCE_KINDS = new Set(['synthetic', 'osm', 'city']);
const COVERAGE_STATUSES = new Set(['declared', 'validated', 'partial', 'unavailable']);
const CANDIDATE_USE = new Set(['allowed', 'unknown', 'prohibited']);
const REDISTRIBUTION = new Set(['allowed', 'allowed-with-conditions', 'unknown', 'prohibited']);

export function admitModeProfile(value) {
  const profile = exactDataObject(value, [
    'schema', 'profileId', 'sourceKind', 'mode', 'fields', 'oneway', 'access', 'modeValues', 'cost',
  ], 'route graph mode profile');
  if (profile.schema !== ROUTE_GRAPH_MODE_PROFILE_SCHEMA) fail('profile-schema', 'route graph mode profile schema is unsupported');
  boundedId(profile.profileId, 'profileId');
  sourceKind(profile.sourceKind, 'profile.sourceKind');
  boundedId(profile.mode, 'profile.mode');

  const fields = exactDataObject(profile.fields, [
    'sourceEdgeId', 'fromNodeId', 'toNodeId', 'geometry', 'cost', 'oneway', 'access', 'mode',
  ], 'profile.fields');
  for (const [key, field] of Object.entries(fields)) boundedId(field, `profile.fields.${key}`);
  if (new Set(Object.values(fields)).size !== Object.keys(fields).length) {
    fail('profile-field-collision', 'profile field mappings must be unique');
  }

  const oneway = directionalPolicy(profile.oneway, 'profile.oneway');
  const access = allowDenyPolicy(profile.access, 'profile.access');
  const modeValues = allowOnlyPolicy(profile.modeValues, 'profile.modeValues');
  const cost = exactDataObject(profile.cost, ['unit', 'minimum', 'maximum'], 'profile.cost');
  if (cost.unit !== 'integer') fail('profile-cost-unit', 'S3 candidate profiles require integer cost');
  if (!Number.isSafeInteger(cost.minimum) || cost.minimum < 0) fail('profile-cost-minimum', 'profile cost minimum must be a non-negative safe integer');
  if (!Number.isSafeInteger(cost.maximum) || cost.maximum < cost.minimum) fail('profile-cost-maximum', 'profile cost maximum must be a safe integer at least minimum');

  return freezeData({ ...profile, fields, oneway, access, modeValues, cost }, 'admitted mode profile');
}

export function admitSourceDescriptor(value) {
  const descriptor = exactDataObject(value, [
    'schema', 'sourceId', 'sourceKind', 'owner', 'transport', 'license', 'attribution',
    'coverage', 'clocks', 'acquisition', 'limitations',
  ], 'route graph source descriptor');
  if (descriptor.schema !== ROUTE_GRAPH_SOURCE_DESCRIPTOR_SCHEMA) fail('descriptor-schema', 'route graph source descriptor schema is unsupported');
  boundedId(descriptor.sourceId, 'source.sourceId');
  sourceKind(descriptor.sourceKind, 'source.sourceKind');

  const owner = exactDataObject(descriptor.owner, ['name', 'canonicalUrl'], 'source.owner');
  boundedText(owner.name, 'source.owner.name', { max: 240 });
  httpUrl(owner.canonicalUrl, 'source.owner.canonicalUrl');

  const transport = exactDataObject(descriptor.transport, ['endpoint', 'method'], 'source.transport');
  httpUrl(transport.endpoint, 'source.transport.endpoint');
  if (!['GET', 'POST'].includes(transport.method)) fail('transport-method', 'source transport method must be GET or POST');

  const license = exactDataObject(descriptor.license, [
    'name', 'url', 'internalCandidateUse', 'derivativeRedistribution',
  ], 'source.license');
  boundedText(license.name, 'source.license.name', { max: 240 });
  httpUrl(license.url, 'source.license.url');
  enumValue(license.internalCandidateUse, CANDIDATE_USE, 'source.license.internalCandidateUse');
  enumValue(license.derivativeRedistribution, REDISTRIBUTION, 'source.license.derivativeRedistribution');

  const attribution = exactDataObject(descriptor.attribution, ['required', 'text', 'url'], 'source.attribution');
  if (typeof attribution.required !== 'boolean') fail('attribution-required', 'source.attribution.required must be boolean');
  if (attribution.required) {
    boundedText(attribution.text, 'source.attribution.text', { max: 500 });
    httpUrl(attribution.url, 'source.attribution.url');
  } else if (attribution.text !== null || attribution.url !== null) {
    fail('attribution-shape', 'non-required attribution must use null text and url');
  }

  const coverage = exactDataObject(descriptor.coverage, [
    'requested', 'acquired', 'validated', 'routing',
  ], 'source.coverage');
  for (const key of Object.keys(coverage)) coverage[key] = admitCoverage(coverage[key], `source.coverage.${key}`);

  const clocks = exactDataObject(descriptor.clocks, [
    'sourceAsOf', 'retrievedAt', 'builtAt', 'observedAt',
  ], 'source.clocks');
  exactTimestamp(clocks.sourceAsOf, 'source.clocks.sourceAsOf', { nullable: true, dateAllowed: true });
  exactTimestamp(clocks.retrievedAt, 'source.clocks.retrievedAt');
  exactTimestamp(clocks.builtAt, 'source.clocks.builtAt');
  exactTimestamp(clocks.observedAt, 'source.clocks.observedAt');
  admitClockOrder(clocks);

  const acquisition = exactDataObject(descriptor.acquisition, [
    'status', 'fallbackUsed', 'contentIdentity', 'bytes', 'recordCount', 'contentType', 'etag', 'lastModified',
  ], 'source.acquisition');
  enumValue(acquisition.status, new Set(['complete', 'partial', 'failed']), 'source.acquisition.status');
  if (typeof acquisition.fallbackUsed !== 'boolean') fail('fallback-flag', 'source.acquisition.fallbackUsed must be boolean');
  nullableIdentity(acquisition.contentIdentity, 'source.acquisition.contentIdentity');
  nullableCount(acquisition.bytes, 'source.acquisition.bytes');
  nullableCount(acquisition.recordCount, 'source.acquisition.recordCount');
  nullableText(acquisition.contentType, 'source.acquisition.contentType');
  nullableText(acquisition.etag, 'source.acquisition.etag');
  nullableText(acquisition.lastModified, 'source.acquisition.lastModified');
  if (acquisition.status === 'complete' && (!acquisition.contentIdentity || acquisition.bytes === null)) {
    fail('acquisition-evidence', 'complete acquisition requires content identity and byte count');
  }
  if (acquisition.status !== 'complete' && acquisition.recordCount !== null) {
    fail('acquisition-record-count', 'partial or failed acquisition must not claim a complete record count');
  }
  if (descriptor.limitations.length === 0) fail('source-limitations', 'source descriptor must disclose at least one limitation');
  stringArray(descriptor.limitations, 'source.limitations', { min: 1 });

  return freezeData({
    ...descriptor,
    owner,
    transport,
    license,
    attribution,
    coverage,
    clocks,
    acquisition,
  }, 'admitted source descriptor');
}

export function approveCandidateComparison(value, reviewValue) {
  const comparison = admitCandidateComparison(value);
  if (comparison.disposition !== 'review-required' || comparison.review.status !== 'pending') {
    fail('comparison-not-reviewable', 'only a pending review-required comparison can be approved');
  }
  const review = exactDataObject(reviewValue, ['reviewedBy', 'reviewedAt', 'evidenceRef'], 'semantic review evidence');
  boundedText(review.reviewedBy, 'semantic review evidence.reviewedBy', { max: 160 });
  exactTimestamp(review.reviewedAt, 'semantic review evidence.reviewedAt');
  boundedText(review.evidenceRef, 'semantic review evidence.evidenceRef', { max: 500 });
  return admitCandidateComparison({
    ...comparison,
    disposition: 'review-approved',
    review: { status: 'approved', ...review },
  });
}

export function admitCandidateReceipt(value) {
  const receipt = exactDataObject(value, [
    'schema', 'dataClassification', 'candidateId', 'source', 'profile', 'artifact', 'audit', 'comparison', 'eligibility', 'limitations',
  ], 'route graph candidate receipt');
  if (receipt.schema !== ROUTE_GRAPH_CANDIDATE_RECEIPT_SCHEMA) fail('receipt-schema', 'route graph candidate receipt schema is unsupported');
  if (receipt.dataClassification !== candidateDataClassification(receipt.source.sourceKind)) {
    fail('receipt-data-classification', 'candidate receipt classification must reflect its real source kind');
  }
  nullableIdentity(receipt.candidateId, 'receipt.candidateId', false);
  receipt.source = admitSourceDescriptor(receipt.source);
  receipt.profile = admitModeProfile(receipt.profile);
  receipt.artifact = admitArtifact(receipt.artifact, receipt.source.sourceKind, receipt.profile);
  receipt.audit = admitAuditSummary(receipt.audit);
  receipt.comparison = admitComparison(receipt.comparison);
  receipt.eligibility = admitCandidateEligibility(receipt.eligibility, 'receipt.eligibility');
  stringArray(receipt.limitations, 'receipt.limitations', { min: 1 });
  if (!receipt.limitations.includes(CANDIDATE_RECEIPT_EVIDENCE_LIMITATION)) {
    fail('receipt-evidence-limitation', 'standalone receipt must disclose that it cannot prove history, acquisition authenticity, or baseline existence');
  }
  const currentCandidateIdentity = candidateSemanticIdentity(
    receipt.source,
    receipt.profile,
    semanticGraphFromArtifact(receipt.artifact),
    receipt.audit,
  );
  if (receipt.comparison.candidateIdentity !== currentCandidateIdentity) {
    fail('receipt-comparison-identity-drift', 'receipt semantic comparison is not bound to its complete projection summary');
  }
  const expectedId = candidateIdFromEvidence(receipt.source, receipt.profile, receipt.artifact, receipt.audit);
  if (receipt.candidateId !== expectedId) fail('receipt-candidate-id-drift', 'receipt candidateId does not match its admitted source, profile, and artifact summary');
  const expectedReasons = standaloneReceiptReasons(receipt.source, receipt.artifact, receipt.audit, receipt.comparison);
  if (receipt.eligibility.harnessEligible !== false
    || canonicalStringify(receipt.eligibility.reasons) !== canonicalStringify(expectedReasons)) {
    fail('receipt-eligibility-drift', 'standalone receipt eligibility must remain false and its reasons must be mechanically recomputed');
  }
  if (receipt.eligibility.productionEligible || receipt.eligibility.publishEligible) {
    fail('receipt-public-eligibility', 'candidate receipt v3 can never be harness-, production-, or publish-eligible on its own');
  }
  return freezeData(receipt, 'admitted route graph candidate receipt');
}

function directionalPolicy(value, label) {
  const policy = exactDataObject(value, ['forward', 'reverse', 'bidirectional', 'missing', 'unknown'], label);
  for (const key of ['forward', 'reverse', 'bidirectional']) policy[key] = stringArray(policy[key], `${label}.${key}`, { min: 1 });
  const all = [...policy.forward, ...policy.reverse, ...policy.bidirectional];
  if (new Set(all).size !== all.length) fail('direction-overlap', `${label} values must be disjoint`);
  failClosed(policy.missing, `${label}.missing`);
  failClosed(policy.unknown, `${label}.unknown`);
  return policy;
}

function allowDenyPolicy(value, label) {
  const policy = exactDataObject(value, ['allowed', 'denied', 'missing', 'unknown'], label);
  policy.allowed = stringArray(policy.allowed, `${label}.allowed`, { min: 1 });
  policy.denied = stringArray(policy.denied, `${label}.denied`, { min: 1 });
  if (policy.allowed.some((entry) => policy.denied.includes(entry))) fail('access-overlap', `${label} values must be disjoint`);
  failClosed(policy.missing, `${label}.missing`);
  failClosed(policy.unknown, `${label}.unknown`);
  return policy;
}

function allowOnlyPolicy(value, label) {
  const policy = exactDataObject(value, ['allowed', 'missing', 'unknown'], label);
  policy.allowed = stringArray(policy.allowed, `${label}.allowed`, { min: 1 });
  failClosed(policy.missing, `${label}.missing`);
  failClosed(policy.unknown, `${label}.unknown`);
  return policy;
}

function admitCoverage(value, label) {
  const coverage = exactDataObject(value, ['status', 'bbox', 'description'], label);
  enumValue(coverage.status, COVERAGE_STATUSES, `${label}.status`);
  boundedText(coverage.description, `${label}.description`, { max: 500 });
  if (coverage.bbox !== null) {
    if (!Array.isArray(coverage.bbox) || coverage.bbox.length !== 4 || !coverage.bbox.every(Number.isFinite)) {
      fail('coverage-bbox', `${label}.bbox must be null or four finite coordinates`);
    }
    if (coverage.bbox[0] >= coverage.bbox[2] || coverage.bbox[1] >= coverage.bbox[3]) {
      fail('coverage-bbox', `${label}.bbox must have increasing bounds`);
    }
  }
  if (coverage.status === 'unavailable' && coverage.bbox !== null) fail('coverage-unavailable', `${label} unavailable coverage must use a null bbox`);
  return coverage;
}

function admitClockOrder(clocks) {
  const retrievedAt = Date.parse(clocks.retrievedAt);
  const builtAt = Date.parse(clocks.builtAt);
  const observedAt = Date.parse(clocks.observedAt);
  if (retrievedAt > builtAt || builtAt > observedAt) {
    fail('clock-order', 'source clocks must satisfy retrievedAt <= builtAt <= observedAt; this ordering is provenance consistency, not freshness evidence');
  }
  if (clocks.sourceAsOf === null) return;
  if (/^\d{4}-\d{2}-\d{2}$/.test(clocks.sourceAsOf)) {
    if (clocks.sourceAsOf > clocks.observedAt.slice(0, 10)) {
      fail('source-as-of-future', 'date-only sourceAsOf must not be later than the observedAt calendar date');
    }
    return;
  }
  if (Date.parse(clocks.sourceAsOf) > observedAt) {
    fail('source-as-of-future', 'timestamp sourceAsOf must not be later than observedAt');
  }
}

export function admitCandidateComparison(value) {
  const comparison = exactDataObject(value, [
    'schema', 'disposition', 'baselineIdentity', 'candidateIdentity', 'reasons', 'review',
  ], 'candidate comparison');
  if (comparison.schema !== ROUTE_GRAPH_SEMANTIC_COMPARISON_SCHEMA) fail('comparison-schema', 'candidate comparison schema is unsupported');
  enumValue(comparison.disposition, new Set(['unchanged', 'review-required', 'review-approved', 'failed']), 'comparison.disposition');
  nullableIdentity(comparison.baselineIdentity, 'comparison.baselineIdentity');
  nullableIdentity(comparison.candidateIdentity, 'comparison.candidateIdentity', comparison.disposition === 'failed');
  comparison.reasons = stringArray(comparison.reasons, 'comparison.reasons', {
    min: comparison.disposition === 'unchanged' ? 0 : 1,
  });
  if (comparison.disposition === 'unchanged' && comparison.reasons.length) fail('comparison-reasons', 'unchanged comparison must not contain reasons');
  if (comparison.disposition === 'unchanged' && comparison.baselineIdentity === null) {
    fail('comparison-baseline-required', 'unchanged comparison requires a non-null admitted baseline identity');
  }
  if (comparison.disposition === 'unchanged' && comparison.baselineIdentity !== comparison.candidateIdentity) {
    fail('comparison-unchanged-identity', 'unchanged comparison requires identical baseline and candidate semantic identities');
  }
  const isFirstSeen = comparison.reasons.length === 1 && comparison.reasons[0] === 'first-seen-candidate';
  if (comparison.baselineIdentity === null
    && ['review-required', 'review-approved'].includes(comparison.disposition)
    && !isFirstSeen) {
    fail('comparison-first-seen-baseline', 'null baseline is allowed for review only on the exact first-seen candidate path');
  }
  if (comparison.baselineIdentity !== null && comparison.reasons.includes('first-seen-candidate')) {
    fail('comparison-first-seen-baseline', 'first-seen candidate reason requires a null baseline identity');
  }
  comparison.review = admitSemanticReview(comparison.review, comparison.disposition);
  return freezeData(comparison, 'admitted comparison');
}

const admitComparison = admitCandidateComparison;

function admitSemanticReview(value, disposition) {
  const review = exactDataObject(value, ['status', 'reviewedBy', 'reviewedAt', 'evidenceRef'], 'comparison.review');
  enumValue(review.status, new Set(['not-required', 'pending', 'approved']), 'comparison.review.status');
  if (disposition === 'review-required' && review.status !== 'pending') fail('comparison-review-status', 'review-required comparison must be pending');
  if (disposition === 'review-approved' && review.status !== 'approved') fail('comparison-review-status', 'review-approved comparison must contain approved evidence');
  if (['unchanged', 'failed'].includes(disposition) && review.status !== 'not-required') fail('comparison-review-status', `${disposition} comparison cannot claim review approval`);
  if (review.status === 'approved') {
    boundedText(review.reviewedBy, 'comparison.review.reviewedBy', { max: 160 });
    exactTimestamp(review.reviewedAt, 'comparison.review.reviewedAt');
    boundedText(review.evidenceRef, 'comparison.review.evidenceRef', { max: 500 });
  } else if (review.reviewedBy !== null || review.reviewedAt !== null || review.evidenceRef !== null) {
    fail('comparison-review-shape', 'non-approved semantic review evidence must use null detail fields');
  }
  return review;
}

function admitArtifact(value, sourceKindValue, profile) {
  const artifact = exactDataObject(value, [
    'schema', 'dataClassification', 'sourceKind', 'profileId', 'mode',
    'topologyIdentity', 'geometryIdentity', 'nodeCount', 'directedEdgeCount', 'counts',
  ], 'receipt.artifact');
  if (artifact.sourceKind !== sourceKindValue) fail('artifact-source-kind', 'artifact must retain the descriptor source kind');
  if (artifact.dataClassification !== candidateDataClassification(sourceKindValue)) {
    fail('artifact-data-classification', 'artifact classification must reflect its real source kind');
  }
  boundedId(artifact.profileId, 'receipt.artifact.profileId');
  boundedId(artifact.mode, 'receipt.artifact.mode');
  if (artifact.profileId !== profile.profileId || artifact.mode !== profile.mode) {
    fail('artifact-profile', 'artifact must retain the admitted profile id and mode');
  }
  for (const key of ['topologyIdentity', 'geometryIdentity']) nullableIdentity(artifact[key], `receipt.artifact.${key}`);
  for (const key of ['nodeCount', 'directedEdgeCount']) nullableCount(artifact[key], `receipt.artifact.${key}`);
  if (artifact.schema === null) {
    if (artifact.topologyIdentity !== null || artifact.geometryIdentity !== null
      || artifact.nodeCount !== null || artifact.directedEdgeCount !== null || artifact.counts !== null) {
      fail('artifact-null-shape', 'missing artifact must contain only null evidence');
    }
  } else {
    if (artifact.schema !== ROUTE_GRAPH_CANDIDATE_SCHEMA) fail('artifact-schema', 'receipt artifact schema is unsupported');
    if (!artifact.topologyIdentity || !artifact.geometryIdentity || artifact.nodeCount === null || artifact.directedEdgeCount === null) {
      fail('artifact-evidence', 'present artifact requires identities and counts');
    }
    artifact.counts = admitArtifactCounts(artifact.counts);
    if (artifact.nodeCount !== artifact.counts.nodeCount
      || artifact.directedEdgeCount !== artifact.counts.directedEdgeCount) {
      fail('artifact-count-drift', 'artifact summary counts must match node and directed-edge totals');
    }
  }
  return artifact;
}

function admitArtifactCounts(value) {
  const counts = exactDataObject(value, [
    'physicalFeatureCount', 'excludedAccessCount', 'nodeCount', 'directedEdgeCount',
    'weakComponentCount', 'largestWeakComponentNodeCount', 'selfLoopCount', 'zeroCostEdgeCount',
  ], 'receipt.artifact.counts');
  for (const [key, count] of Object.entries(counts)) {
    if (!Number.isSafeInteger(count) || count < 0) {
      fail('artifact-count', `receipt.artifact.counts.${key} must be a non-negative safe integer`);
    }
  }
  return counts;
}

function admitAuditSummary(value) {
  const audit = exactDataObject(value, ['status', 'blockers', 'warnings'], 'receipt.audit');
  enumValue(audit.status, new Set(['passed', 'failed']), 'receipt.audit.status');
  audit.blockers = stringArray(audit.blockers, 'receipt.audit.blockers', { min: audit.status === 'failed' ? 1 : 0 });
  audit.warnings = stringArray(audit.warnings, 'receipt.audit.warnings');
  if (audit.status === 'passed' && audit.blockers.length) fail('audit-blockers', 'passed audit cannot contain blockers');
  return audit;
}

export function admitCandidateEligibility(value, label = 'candidate eligibility') {
  const eligibility = exactDataObject(value, [
    'harnessEligible', 'productionEligible', 'publishEligible', 'reasons',
  ], label);
  for (const key of ['harnessEligible', 'productionEligible', 'publishEligible']) {
    if (typeof eligibility[key] !== 'boolean') fail('eligibility-boolean', `${label}.${key} must be boolean`);
  }
  eligibility.reasons = stringArray(eligibility.reasons, `${label}.reasons`, { min: eligibility.harnessEligible ? 0 : 1 });
  return eligibility;
}

export function candidateGateReasons(source, artifact, audit, comparison) {
  const reasons = [];
  if (source.license.internalCandidateUse !== 'allowed') reasons.push('internal-candidate-use-not-allowed');
  if (source.acquisition.status !== 'complete') reasons.push('acquisition-not-complete');
  if (source.acquisition.fallbackUsed) reasons.push('fallback-used');
  if (!source.acquisition.contentIdentity) reasons.push('raw-content-identity-unavailable');
  if (source.coverage.requested.status === 'unavailable') reasons.push('requested-coverage-unavailable');
  if (source.coverage.acquired.status !== 'validated') reasons.push('acquired-coverage-not-validated');
  if (source.coverage.validated.status !== 'validated') reasons.push('validation-coverage-not-validated');
  if (source.coverage.routing.status !== 'validated') reasons.push('routing-coverage-not-validated');
  if (audit.status !== 'passed' || artifact.schema !== ROUTE_GRAPH_CANDIDATE_SCHEMA) reasons.push('topology-audit-not-passed');
  if (comparison.disposition === 'failed') reasons.push('semantic-comparison-failed');
  if (comparison.disposition === 'review-required') reasons.push('semantic-review-required');
  return [...new Set(reasons)].sort();
}

export function standaloneReceiptReasons(source, artifact, audit, comparison) {
  return [...new Set([
    ...candidateGateReasons(source, artifact, audit, comparison),
    'candidate-bundle-required',
  ])].sort();
}

export function artifactSummaryFromGraph(graph) {
  return freezeData({
    schema: graph.schema,
    dataClassification: graph.dataClassification,
    sourceKind: graph.sourceKind,
    profileId: graph.profileId,
    mode: graph.mode,
    topologyIdentity: graph.topologyIdentity,
    geometryIdentity: graph.geometryIdentity,
    nodeCount: graph.nodes.length,
    directedEdgeCount: graph.edges.length,
    counts: graph.counts,
  }, 'candidate graph artifact summary');
}

export function auditSummaryFromFreshAudit(audit) {
  return freezeData({
    status: audit.status,
    blockers: audit.blockers,
    warnings: audit.warnings,
  }, 'candidate graph audit summary');
}

export function candidateIdFromEvidence(source, profile, artifact, audit) {
  return contentIdentity({
    dataClassification: artifact.dataClassification,
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    profileId: profile.profileId,
    mode: profile.mode,
    sourceContentIdentity: source.acquisition.contentIdentity,
    topologyIdentity: artifact.topologyIdentity,
    geometryIdentity: artifact.geometryIdentity,
    candidateSemanticIdentity: candidateSemanticIdentity(
      source,
      profile,
      semanticGraphFromArtifact(artifact),
      audit,
    ),
  });
}

function semanticGraphFromArtifact(artifact) {
  return {
    schema: artifact.schema,
    dataClassification: artifact.dataClassification,
    topologyIdentity: artifact.topologyIdentity,
    geometryIdentity: artifact.geometryIdentity,
    counts: artifact.counts,
  };
}

function boundedId(value, label) {
  return boundedText(value, label, { max: 160, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/ });
}

function sourceKind(value, label) {
  return enumValue(value, SOURCE_KINDS, label);
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) fail('unsupported-enum', `${label} is unsupported`);
  return value;
}

function failClosed(value, label) {
  if (value !== 'reject') fail('non-fail-closed-policy', `${label} must be reject`);
}

function nullableIdentity(value, label, nullable = true) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) fail('invalid-identity', `${label} must be a sha256 identity${nullable ? ' or null' : ''}`);
  return value;
}

function nullableCount(value, label) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) fail('invalid-count', `${label} must be null or a non-negative safe integer`);
  return value;
}

function nullableText(value, label) {
  if (value === null) return null;
  return boundedText(value, label, { max: 2_048 });
}
