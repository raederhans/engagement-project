import {
  boundedText,
  exactDataObject,
  exactTimestamp,
  fail,
  freezeData,
  httpUrl,
  stringArray,
} from '../route_graph_candidate/safe_data.mjs';

export const CALLER_SUPPLIED_REVIEW_POLICY_SCHEMA = 'caller-supplied-route-graph-review-policy/v1';
export const CALLER_SUPPLIED_REVIEW_ASSERTION_SCHEMA = 'caller-supplied-route-graph-review-assertion/v1';
export const ROUTE_GRAPH_PROMOTION_INTENT_SCHEMA = 'route-graph-promotion-intent/v1';
export const ROUTE_GRAPH_ELIGIBILITY_REPORT_SCHEMA = 'route-graph-external-eligibility-report/v1';
export const EXTERNAL_DATA_ELIGIBILITY_SCHEMA = 'route-graph-external-data-eligibility/v1';
export const INTERNAL_REVIEW_ELIGIBILITY_SCHEMA = 'route-graph-internal-review-eligibility/v1';
export const PRODUCT_GRAPH_ELIGIBILITY_SCHEMA = 'route-graph-product-eligibility/v1';
export const REDISTRIBUTION_ELIGIBILITY_SCHEMA = 'route-graph-redistribution-eligibility/v1';
export const PUBLIC_ACCESS_ELIGIBILITY_SCHEMA = 'route-graph-public-access-eligibility/v1';
export const PUBLICATION_ELIGIBILITY_SCHEMA = 'route-graph-publication-eligibility/v1';
export const GRAPH_SOURCE_HEALTH_PROJECTION_SCHEMA = 'route-graph-source-health-projection/v1';

export const AUTHORITY_SCOPES = Object.freeze([
  'baseline',
  'semantic-review',
  'product-approval',
  'redistribution-review',
  'public-approval',
  'publication-review',
]);

const AUTHORITY_SCOPE_SET = new Set(AUTHORITY_SCOPES);

export const INTERNAL_IDENTITY_LIMITATION = 'SHA-256 identities in this JSON detect internal content drift only; they do not prove signer identity, acquisition history, review authenticity, or repository history.';
export const VALIDATION_ONLY_LIMITATION = 'This report is validation-only caller-policy conformance. With authority unverified, every actual eligibility gate remains false; this report does not admit or review a graph, create a GraphArtifact, update runtime or catalogs, redistribute data, publish data, or authorize release.';

export function admitCallerSuppliedReviewPolicy(value) {
  const policy = exactDataObject(value, [
    'schema', 'policyId', 'authorities', 'baselineAllowlist', 'limitations',
  ], 'caller-supplied graph review policy');
  if (policy.schema !== CALLER_SUPPLIED_REVIEW_POLICY_SCHEMA) {
    fail('review-policy-schema-unsupported', 'caller-supplied graph review policy schema is unsupported');
  }
  boundedId(policy.policyId, 'authority policy.policyId');
  if (!Array.isArray(policy.authorities) || policy.authorities.length === 0) {
    fail('review-policy-empty', 'caller-supplied graph review policy requires at least one asserted authority');
  }
  const authorityIds = new Set();
  policy.authorities = policy.authorities.map((raw, index) => {
    const authority = exactDataObject(raw, ['authorityId', 'displayName', 'scopes'], `authority policy.authorities[${index}]`);
    boundedId(authority.authorityId, `authority policy.authorities[${index}].authorityId`);
    boundedText(authority.displayName, `authority policy.authorities[${index}].displayName`, { max: 160 });
    if (authorityIds.has(authority.authorityId)) fail('authority-id-duplicate', 'trusted authority ids must be unique');
    authorityIds.add(authority.authorityId);
    authority.scopes = stringArray(authority.scopes, `authority policy.authorities[${index}].scopes`, { min: 1 });
    if (authority.scopes.some((scope) => !AUTHORITY_SCOPE_SET.has(scope))) {
      fail('authority-scope-unsupported', 'trusted authority policy contains an unsupported scope');
    }
    return authority;
  });
  policy.baselineAllowlist = stringArray(
    policy.baselineAllowlist,
    'review policy.baselineAllowlist',
    { min: 1 },
  );
  for (const identity of policy.baselineAllowlist) exactIdentity(identity, 'caller-allowlisted baseline identity');
  policy.limitations = boundedTextArray(policy.limitations, 'authority policy.limitations', { min: 1, max: 500 });
  if (!policy.limitations.includes(INTERNAL_IDENTITY_LIMITATION)) {
    fail('authority-policy-identity-limitation-required', 'authority policy must disclose the internal identity limitation');
  }
  return freezeData(policy, 'validated caller-supplied graph review policy');
}

export function admitCallerSuppliedReviewAssertion(value) {
  const review = exactDataObject(value, [
    'schema', 'reviewId', 'authorityId', 'scope', 'decision', 'reviewedAt', 'evidenceRef',
    'baselineIdentity', 'currentGraphIdentity', 'semanticDiffIdentity',
  ], 'route graph review evidence');
  if (review.schema !== CALLER_SUPPLIED_REVIEW_ASSERTION_SCHEMA) {
    fail('review-assertion-schema-unsupported', 'caller-supplied route graph review assertion schema is unsupported');
  }
  boundedId(review.reviewId, 'review.reviewId');
  boundedId(review.authorityId, 'review.authorityId');
  if (!AUTHORITY_SCOPE_SET.has(review.scope)) fail('review-scope-unsupported', 'review scope is unsupported');
  if (!['approved', 'rejected'].includes(review.decision)) fail('review-decision-unsupported', 'review decision is unsupported');
  exactTimestamp(review.reviewedAt, 'review.reviewedAt');
  httpUrl(review.evidenceRef, 'review.evidenceRef');
  exactIdentity(review.baselineIdentity, 'review.baselineIdentity');
  exactIdentity(review.currentGraphIdentity, 'review.currentGraphIdentity');
  exactIdentity(review.semanticDiffIdentity, 'review.semanticDiffIdentity');
  return freezeData(review, 'validated caller-supplied route graph review evidence');
}

export function admitPromotionIntent(value) {
  const intent = exactDataObject(value, [
    'schema', 'redistributionRequested', 'publicAccessRequested', 'publicationRequested',
    'attributionIncluded', 'attributionText', 'attributionUrl',
  ], 'route graph promotion intent');
  if (intent.schema !== ROUTE_GRAPH_PROMOTION_INTENT_SCHEMA) {
    fail('promotion-intent-schema-unsupported', 'route graph promotion intent schema is unsupported');
  }
  for (const key of ['redistributionRequested', 'publicAccessRequested', 'publicationRequested', 'attributionIncluded']) {
    if (typeof intent[key] !== 'boolean') fail('promotion-intent-flag-invalid', `${key} must be boolean`);
  }
  if (intent.attributionIncluded) {
    boundedText(intent.attributionText, 'intent.attributionText', { max: 500 });
    httpUrl(intent.attributionUrl, 'intent.attributionUrl');
  } else if (intent.attributionText !== null || intent.attributionUrl !== null) {
    fail('promotion-intent-attribution-shape', 'omitted attribution must use null text and url');
  }
  if (intent.publicationRequested && (!intent.publicAccessRequested || !intent.redistributionRequested)) {
    fail('promotion-intent-order', 'publication requires public access and redistribution intents');
  }
  if (intent.publicAccessRequested && !intent.redistributionRequested) {
    fail('promotion-intent-order', 'public access requires redistribution intent');
  }
  return freezeData(intent, 'validated route graph eligibility intent');
}

export function authorityHasScope(policy, authorityId, scope) {
  return policy.authorities.some((authority) => authority.authorityId === authorityId && authority.scopes.includes(scope));
}

export function exactIdentity(value, label) {
  return boundedText(value, label, { max: 71, pattern: /^sha256:[a-f0-9]{64}$/ });
}

function boundedId(value, label) {
  return boundedText(value, label, { max: 160, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/ });
}

function boundedTextArray(value, label, { min, max }) {
  if (!Array.isArray(value) || value.length < min) fail('array-too-small', `${label} must contain at least ${min} item(s)`);
  const admitted = value.map((item, index) => boundedText(item, `${label}[${index}]`, { max }));
  if (new Set(admitted).size !== admitted.length) fail('duplicate-value', `${label} must not contain duplicates`);
  return admitted;
}
