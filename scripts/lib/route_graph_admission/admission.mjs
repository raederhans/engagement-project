import {
  admitRouteGraphCandidateLifecycle,
} from '../route_graph_candidate/candidate_lifecycle.mjs';
import {
  canonicalStringify,
  contentIdentity,
  exactDataObject,
  fail,
  freezeData,
} from '../route_graph_candidate/safe_data.mjs';
import {
  EXTERNAL_DATA_ELIGIBILITY_SCHEMA,
  GRAPH_SOURCE_HEALTH_PROJECTION_SCHEMA,
  INTERNAL_IDENTITY_LIMITATION,
  INTERNAL_REVIEW_ELIGIBILITY_SCHEMA,
  PRODUCT_GRAPH_ELIGIBILITY_SCHEMA,
  PUBLICATION_ELIGIBILITY_SCHEMA,
  PUBLIC_ACCESS_ELIGIBILITY_SCHEMA,
  REDISTRIBUTION_ELIGIBILITY_SCHEMA,
  ROUTE_GRAPH_ELIGIBILITY_REPORT_SCHEMA,
  VALIDATION_ONLY_LIMITATION,
  admitPromotionIntent,
  admitCallerSuppliedReviewAssertion,
  admitCallerSuppliedReviewPolicy,
  authorityHasScope,
} from './contracts.mjs';

const AXES = Object.freeze([
  'schema', 'source', 'licenseAttribution', 'coverage', 'fourClocks', 'mode',
  'topology', 'geometry', 'content', 'audit',
]);

export function inspectRouteGraphAdmissionEvidence({ baselineLifecycle, currentLifecycle }) {
  const baseline = admitExternalLifecycle(baselineLifecycle, 'baseline');
  const current = admitExternalLifecycle(currentLifecycle, 'current');
  const baselineIdentities = identitiesFor(baseline);
  const currentIdentities = identitiesFor(current);
  const semanticDiff = semanticDiffFor(baselineIdentities, currentIdentities);
  return freezeData({
    baseline: baselineIdentities,
    current: currentIdentities,
    semanticDiff,
  }, 'route graph eligibility evidence inspection');
}

export function evaluateRouteGraphEligibility({
  baselineLifecycle,
  currentLifecycle,
  callerSuppliedPolicy,
  reviewEvidence,
  promotionIntent,
}) {
  const inspected = inspectRouteGraphAdmissionEvidence({ baselineLifecycle, currentLifecycle });
  const policy = admitCallerSuppliedReviewPolicy(callerSuppliedPolicy);
  if (!Array.isArray(reviewEvidence)) fail('review-evidence-array-required', 'reviewEvidence must be an array');
  const reviews = reviewEvidence.map(admitCallerSuppliedReviewAssertion);
  assertUniqueReviewScopes(reviews);
  const intent = admitPromotionIntent(promotionIntent);
  const policyIdentity = contentIdentity(policy);
  const evidenceIdentity = contentIdentity(inspected);
  const reviewSetIdentity = contentIdentity(reviews);
  const reviewStatus = Object.fromEntries(
    ['semantic-review', 'product-approval', 'redistribution-review', 'public-approval', 'publication-review']
      .map((scope) => [scope, matchingSelfReportedApproval(scope, reviews, policy, inspected)]),
  );

  const externalReasons = externalDataReasons(inspected, policy, reviewStatus);
  const externalDataEligibility = eligibility(
    EXTERNAL_DATA_ELIGIBILITY_SCHEMA,
    'external-data',
    externalReasons,
    { policyIdentity, evidenceIdentity, semanticDiffIdentity: inspected.semanticDiff.identity },
  );
  const internalReasons = conformanceDependencyReasons(externalDataEligibility, 'external-data-not-conformant');
  if (!reviewStatus['semantic-review']) internalReasons.push('semantic-review-assertion-missing-or-mismatched');
  const internalReviewEligibility = eligibility(
    INTERNAL_REVIEW_ELIGIBILITY_SCHEMA,
    'reviewed-internal',
    internalReasons,
    { externalDataEligibilityIdentity: externalDataEligibility.identity, reviewSetIdentity, currentGraphIdentity: inspected.current.graph },
  );
  const productReasons = conformanceDependencyReasons(internalReviewEligibility, 'internal-review-not-conformant');
  if (!reviewStatus['product-approval']) productReasons.push('product-approval-assertion-missing-or-mismatched');
  const productGraphEligibility = eligibility(
    PRODUCT_GRAPH_ELIGIBILITY_SCHEMA,
    'product',
    productReasons,
    { internalReviewEligibilityIdentity: internalReviewEligibility.identity, currentGraphIdentity: inspected.current.graph },
  );
  const redistributionReasons = conformanceDependencyReasons(productGraphEligibility, 'product-graph-not-conformant');
  if (!intent.redistributionRequested) redistributionReasons.push('redistribution-not-requested');
  if (!['allowed', 'allowed-with-conditions'].includes(inspected.current.licenseDisposition)) {
    redistributionReasons.push('redistribution-license-not-allowed');
  }
  if (!reviewStatus['redistribution-review']) redistributionReasons.push('redistribution-review-assertion-missing-or-mismatched');
  if (inspected.current.attributionRequired && !attributionSatisfied(intent, inspected.current)) {
    redistributionReasons.push('required-attribution-not-satisfied');
  }
  const redistributionEligibility = eligibility(
    REDISTRIBUTION_ELIGIBILITY_SCHEMA,
    'redistribution',
    redistributionReasons,
    { productEligibilityIdentity: productGraphEligibility.identity, intentIdentity: contentIdentity(intent) },
  );
  const publicReasons = conformanceDependencyReasons(redistributionEligibility, 'redistribution-not-conformant');
  if (!intent.publicAccessRequested) publicReasons.push('public-access-not-requested');
  if (!reviewStatus['public-approval']) publicReasons.push('public-approval-assertion-missing-or-mismatched');
  const publicAccessEligibility = eligibility(
    PUBLIC_ACCESS_ELIGIBILITY_SCHEMA,
    'public',
    publicReasons,
    { redistributionEligibilityIdentity: redistributionEligibility.identity, currentGraphIdentity: inspected.current.graph },
  );
  const publicationReasons = conformanceDependencyReasons(publicAccessEligibility, 'public-access-not-conformant');
  if (!intent.publicationRequested) publicationReasons.push('publication-not-requested');
  if (!reviewStatus['publication-review']) publicationReasons.push('publication-review-assertion-missing-or-mismatched');
  const publicationEligibility = eligibility(
    PUBLICATION_ELIGIBILITY_SCHEMA,
    'publication',
    publicationReasons,
    { publicAccessEligibilityIdentity: publicAccessEligibility.identity, redistributionEligibilityIdentity: redistributionEligibility.identity },
  );
  const sourceHealthProjection = sourceHealthProjectionFor({
    inspected,
    productGraphEligibility,
    policyIdentity,
  });

  const reportCore = {
    schema: ROUTE_GRAPH_ELIGIBILITY_REPORT_SCHEMA,
    dataClassification: 'validation-only-external-graph-eligibility',
    authorityVerified: false,
    actualAdmission: false,
    promotionExecuted: false,
    materializedArtifact: false,
    policyIdentity,
    evidenceIdentity,
    reviewSetIdentity,
    identities: inspected,
    gates: {
      externalDataEligibility,
      internalReviewEligibility,
      productGraphEligibility,
      redistributionEligibility,
      publicAccessEligibility,
      publicationEligibility,
      sourceHealthProjection,
    },
    limitations: [INTERNAL_IDENTITY_LIMITATION, VALIDATION_ONLY_LIMITATION],
  };
  return freezeData({ ...reportCore, reportIdentity: contentIdentity(reportCore) }, 'route graph eligibility report');
}

export function verifyRouteGraphEligibilityReport(report, inputs) {
  const assessed = exactDataObject(report, [
    'schema', 'dataClassification', 'authorityVerified', 'actualAdmission', 'promotionExecuted',
    'materializedArtifact', 'policyIdentity', 'evidenceIdentity', 'reviewSetIdentity',
    'identities', 'gates', 'limitations', 'reportIdentity',
  ], 'route graph eligibility report');
  const expected = evaluateRouteGraphEligibility(inputs);
  if (canonicalStringify(assessed) !== canonicalStringify(expected)) {
    fail('eligibility-report-recomputation-mismatch', 'eligibility report must match a fresh mechanical recomputation from complete evidence');
  }
  return expected;
}

function admitExternalLifecycle(value, label) {
  const lifecycle = admitRouteGraphCandidateLifecycle(value, label);
  if (lifecycle.descriptor.sourceKind === 'synthetic') {
    fail('external-source-required', `${label} lifecycle must retain an external source kind`);
  }
  if (lifecycle.normalization.graph.dataClassification !== 'candidate-external') {
    fail('external-classification-required', `${label} lifecycle must retain candidate-external classification`);
  }
  return lifecycle;
}

function identitiesFor(lifecycle) {
  const { descriptor, profile, normalization } = lifecycle;
  const { graph, audit } = normalization;
  const identities = {
    schema: contentIdentity({ descriptor: descriptor.schema, profile: profile.schema, graph: graph.schema, audit: audit.schema }),
    source: contentIdentity({ sourceId: descriptor.sourceId, sourceKind: descriptor.sourceKind, owner: descriptor.owner, transport: descriptor.transport }),
    licenseAttribution: contentIdentity({ license: descriptor.license, attribution: descriptor.attribution }),
    coverage: contentIdentity(descriptor.coverage),
    fourClocks: contentIdentity(descriptor.clocks),
    mode: contentIdentity(profile),
    topology: graph.topologyIdentity,
    geometry: graph.geometryIdentity,
    content: contentIdentity(graph),
    audit: contentIdentity(audit),
    graph: contentIdentity({ graph, audit }),
    sourceId: descriptor.sourceId,
    sourceContent: descriptor.acquisition.contentIdentity,
    licenseDisposition: descriptor.license.derivativeRedistribution,
    internalCandidateUse: descriptor.license.internalCandidateUse,
    attributionRequired: descriptor.attribution.required,
    attributionText: descriptor.attribution.text,
    attributionUrl: descriptor.attribution.url,
    acquisitionStatus: descriptor.acquisition.status,
    fallbackUsed: descriptor.acquisition.fallbackUsed,
    coverageStatuses: Object.fromEntries(Object.entries(descriptor.coverage).map(([key, entry]) => [key, entry.status])),
    clocks: descriptor.clocks,
    modeValue: profile.mode,
    auditStatus: audit.status,
  };
  return freezeData(identities, 'route graph evidence identities');
}

function semanticDiffFor(baseline, current) {
  const reasons = AXES
    .filter((axis) => baseline[axis] !== current[axis])
    .map((axis) => `${axis.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-identity-drift`);
  const core = {
    schema: 'route-graph-eligibility-semantic-diff/v1',
    disposition: reasons.length ? 'review-required' : 'unchanged',
    baselineGraphIdentity: baseline.graph,
    currentGraphIdentity: current.graph,
    changedAxes: reasons,
  };
  return freezeData({ ...core, identity: contentIdentity(core) }, 'route graph eligibility semantic diff');
}

function matchingSelfReportedApproval(scope, reviews, policy, inspected) {
  const review = reviews.find((item) => item.scope === scope);
  return Boolean(review
    && review.decision === 'approved'
    && authorityHasScope(policy, review.authorityId, scope)
    && review.baselineIdentity === inspected.baseline.graph
    && review.currentGraphIdentity === inspected.current.graph
    && review.semanticDiffIdentity === inspected.semanticDiff.identity);
}

function externalDataReasons(inspected, policy, reviewStatus) {
  const current = inspected.current;
  const reasons = [];
  if (!policy.authorities.some((authority) => authority.scopes.includes('baseline'))) reasons.push('baseline-authority-missing');
  if (!policy.baselineAllowlist.includes(inspected.baseline.graph)) reasons.push('baseline-not-caller-allowlisted');
  if (current.acquisitionStatus !== 'complete') reasons.push('acquisition-not-complete');
  if (current.fallbackUsed) reasons.push('fallback-used');
  if (!current.sourceContent) reasons.push('source-content-identity-missing');
  if (current.internalCandidateUse !== 'allowed') reasons.push('internal-candidate-use-not-allowed');
  if (current.clocks.sourceAsOf === null) reasons.push('source-as-of-unknown');
  for (const clock of ['retrievedAt', 'builtAt', 'observedAt']) {
    if (current.clocks[clock] === null) reasons.push(`${camelToKebab(clock)}-missing`);
  }
  for (const [coverage, required] of [['acquired', 'validated'], ['validated', 'validated'], ['routing', 'validated']]) {
    if (current.coverageStatuses[coverage] !== required) reasons.push(`${coverage}-coverage-not-validated`);
  }
  if (current.modeValue !== 'walking') reasons.push('walking-mode-not-eligible');
  if (current.auditStatus !== 'passed') reasons.push('topology-audit-not-passed');
  if (inspected.semanticDiff.disposition === 'review-required' && !reviewStatus['semantic-review']) {
    reasons.push('semantic-diff-not-approved');
  }
  return reasons;
}

function eligibility(schema, gate, reasons, bindings) {
  const conformanceReasonCodes = [...new Set(reasons)].sort();
  const core = {
    schema,
    gate,
    eligible: false,
    authorityVerified: false,
    callerPolicyConformance: conformanceReasonCodes.length === 0,
    actualAdmission: false,
    promotionExecuted: false,
    materializedArtifact: false,
    reasonCodes: [...new Set(['authority-unverified', ...conformanceReasonCodes])].sort(),
    conformanceReasonCodes,
    bindings,
  };
  return freezeData({ ...core, identity: contentIdentity(core) }, `${gate} graph gate`);
}

function sourceHealthProjectionFor({ inspected, productGraphEligibility, policyIdentity }) {
  const reasons = conformanceDependencyReasons(productGraphEligibility, 'product-graph-not-conformant');
  const current = inspected.current;
  if (current.clocks.sourceAsOf === null) reasons.push('source-as-of-unknown');
  const core = {
    schema: GRAPH_SOURCE_HEALTH_PROJECTION_SCHEMA,
    projectionOnly: true,
    authorityVerified: false,
    observationState: 'not-observed',
    catalogMutationAuthorized: false,
    runtimeMutationAuthorized: false,
    sourceId: current.sourceId,
    projectedStatus: 'unknown',
    statusReason: reasons.length ? [...new Set(reasons)].sort().join(',') : 'caller-policy-conformant-authority-unverified',
    clocks: current.clocks,
    snapshot: { version: null, identity: current.graph },
    coverageIdentity: current.coverage,
    recordCount: null,
    policyIdentity,
  };
  return freezeData({ ...core, identity: contentIdentity(core) }, 'route graph source health projection');
}

function conformanceDependencyReasons(stageValue, reason) {
  return stageValue.callerPolicyConformance ? [] : [reason];
}

function attributionSatisfied(intent, current) {
  return intent.attributionIncluded
    && intent.attributionText === current.attributionText
    && intent.attributionUrl === current.attributionUrl;
}

function assertUniqueReviewScopes(reviews) {
  const scopes = new Set();
  for (const review of reviews) {
    if (scopes.has(review.scope)) fail('review-scope-duplicate', 'review evidence must contain at most one record per scope');
    scopes.add(review.scope);
  }
}

function camelToKebab(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
