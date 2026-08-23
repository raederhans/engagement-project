import {
  REAL_GRAPH_AUTHORITY_IDENTITY_KEYS,
  REAL_GRAPH_AUTHORITY_MATCH_SUBJECT_SCHEMA,
  REAL_GRAPH_AUTHORITY_REGISTRY_ENTRY_SCHEMA,
  REAL_GRAPH_AUTHORITY_REGISTRY_POLICY_SCHEMA,
  REAL_GRAPH_AUTHORITY_REVIEW_GATE_SCHEMA,
  REAL_GRAPH_OWNER_RESOLVED_BINDINGS_SCHEMA,
  REAL_GRAPH_OWNER_RESOLVED_STATE_SCHEMA,
  REQUIRED_INSTALLED_SCOPES,
} from './contracts.mjs';
import {
  assertArray,
  boundedText,
  canonicalStringify,
  cloneData,
  contentIdentity,
  exactDataObject,
  exactDateOrTimestamp,
  exactGitRevision,
  exactIdentity,
  exactTimestamp,
  fail,
  freezeData,
} from './safe_data.mjs';

const MATCH_RESULT_SCHEMA = 'route-real-graph-installed-authority-match/v1';
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const REVISION_FIELDS = Object.freeze([
  'acquisition', 'adapter', 'build', 'authority',
]);

export function analyzeInstalledAuthorityEntries(entriesValue, subjectValue, policyValue) {
  if (arguments.length !== 3) {
    fail('installed-matcher-arguments', 'installed matcher requires exact entries, match subject, and registry policy');
  }
  const entriesData = cloneData(entriesValue, 'installed authority entries');
  assertArray(entriesData, 'installed authority entries', { minimum: 0, maximum: 1_000 });
  const subject = admitMatchSubject(subjectValue);
  const policy = admitRegistryPolicy(policyValue, entriesData.length);
  const entries = entriesData.map((entry) => admitInstalledEntry(entry, policy));
  assertUniqueEntries(entries);

  const matches = entries.filter((entry) => exactEntryMatches(entry, subject));
  if (matches.length > 1) {
    fail('installed-registry-ambiguous', 'installed authority registry contains more than one exact match');
  }
  const entry = matches[0] ?? null;
  return freezeData({
    schema: MATCH_RESULT_SCHEMA,
    status: entry ? 'exact-match' : 'no-match',
    entryMatched: entry !== null,
    installedEntryCount: entries.length,
    registryRevision: policy.registryRevision,
    entry,
  }, 'neutral installed authority analysis');
}

function admitMatchSubject(value) {
  const subject = exactDataObject(value, [
    'schema', 'sourceId', 'evidenceSetIdentity', 'identities',
  ], 'real graph authority match subject');
  if (subject.schema !== REAL_GRAPH_AUTHORITY_MATCH_SUBJECT_SCHEMA) {
    fail('installed-subject-schema', 'real graph authority match subject schema is unsupported');
  }
  boundedText(subject.sourceId, 'match subject sourceId', { max: 120, pattern: ID_PATTERN });
  exactIdentity(subject.evidenceSetIdentity, 'match subject evidenceSetIdentity');
  const identities = exactDataObject(
    subject.identities,
    REAL_GRAPH_AUTHORITY_IDENTITY_KEYS,
    'match subject identities',
  );
  for (const [name, identity] of Object.entries(identities)) {
    exactIdentity(identity, `match subject identities.${name}`);
  }
  return freezeData({ ...subject, identities }, 'admitted authority match subject');
}

function admitRegistryPolicy(value, installedEntryCount) {
  const policy = exactDataObject(value, [
    'schema', 'registryRevision', 'acceptedRevisions',
  ], 'installed authority registry policy');
  if (policy.schema !== REAL_GRAPH_AUTHORITY_REGISTRY_POLICY_SCHEMA) {
    fail('installed-policy-schema', 'installed authority registry policy schema is unsupported');
  }
  boundedText(policy.registryRevision, 'installed registry revision', {
    max: 240,
    pattern: ID_PATTERN,
  });
  const acceptedRevisions = exactDataObject(
    policy.acceptedRevisions,
    REVISION_FIELDS,
    'installed accepted revisions',
  );
  if (installedEntryCount === 0) {
    if (Object.values(acceptedRevisions).some((revision) => revision !== null)) {
      fail('installed-policy-unconfigured', 'empty installed registry policy must not imply accepted revisions');
    }
  } else {
    boundedText(policy.registryRevision, 'installed registry revision', {
      max: 240,
      pattern: ID_PATTERN,
    });
    for (const field of REVISION_FIELDS) {
      exactGitRevision(acceptedRevisions[field], `installed accepted revisions.${field}`);
    }
  }
  return freezeData({ ...policy, acceptedRevisions }, 'admitted installed registry policy');
}

function admitInstalledEntry(value, policy) {
  const entry = exactDataObject(value, [
    'schema', 'entryIdentity', 'entryId', 'registryRevision', 'sourceId',
    'evidenceSetIdentity', 'identities', 'scopes', 'review', 'resolution',
  ], 'installed real graph authority entry');
  if (entry.schema !== REAL_GRAPH_AUTHORITY_REGISTRY_ENTRY_SCHEMA
    || entry.registryRevision !== policy.registryRevision) {
    fail('installed-entry-schema', 'installed authority entry schema or registry revision is unsupported');
  }
  boundedText(entry.entryId, 'installed entryId', { max: 160, pattern: ID_PATTERN });
  boundedText(entry.sourceId, 'installed sourceId', { max: 120, pattern: ID_PATTERN });
  exactIdentity(entry.evidenceSetIdentity, 'installed evidenceSetIdentity');
  const identities = exactDataObject(
    entry.identities,
    REAL_GRAPH_AUTHORITY_IDENTITY_KEYS,
    'installed evidence identities',
  );
  for (const [name, identity] of Object.entries(identities)) {
    exactIdentity(identity, `installed identities.${name}`);
  }
  if (canonicalStringify(entry.scopes) !== canonicalStringify(REQUIRED_INSTALLED_SCOPES)) {
    fail('installed-entry-scopes', 'installed authority entry must contain only the exact versioned scopes');
  }
  const review = admitReview(entry.review, policy.acceptedRevisions);
  const resolution = admitResolution(entry.resolution, identities, review);
  exactIdentity(entry.entryIdentity, 'installed entryIdentity');
  const entryCore = {
    schema: entry.schema,
    entryId: entry.entryId,
    registryRevision: entry.registryRevision,
    sourceId: entry.sourceId,
    evidenceSetIdentity: entry.evidenceSetIdentity,
    identities,
    scopes: entry.scopes,
    review,
    resolution,
  };
  if (entry.entryIdentity !== contentIdentity(entryCore)) {
    fail('installed-entry-identity-drift', 'installed entryIdentity does not match its exact source entry');
  }
  return freezeData({ ...entryCore, entryIdentity: entry.entryIdentity }, 'admitted installed authority entry');
}

function admitResolution(value, identities, review) {
  const resolution = exactDataObject(value, [
    'schema', 'status', 'bindings', 'reviewEvidenceIdentity', 'resolvedAt',
    'resolutionIdentity',
  ], 'installed owner-resolved state');
  if (resolution.schema !== REAL_GRAPH_OWNER_RESOLVED_STATE_SCHEMA
    || resolution.status !== 'owner-reviewed-resolved') {
    fail('installed-resolution-unavailable', 'installed entry requires the positive versioned owner-reviewed resolved state');
  }
  const bindings = exactDataObject(
    resolution.bindings,
    ['schema', ...REAL_GRAPH_AUTHORITY_IDENTITY_KEYS],
    'installed owner-resolved bindings',
  );
  if (bindings.schema !== REAL_GRAPH_OWNER_RESOLVED_BINDINGS_SCHEMA) {
    fail('installed-resolution-schema', 'installed owner-resolved bindings schema is unsupported');
  }
  for (const name of REAL_GRAPH_AUTHORITY_IDENTITY_KEYS) {
    exactIdentity(bindings[name], `installed resolution bindings.${name}`);
    if (bindings[name] !== identities[name]) {
      fail('installed-resolution-binding-drift', `installed resolved binding ${name} does not equal the exact entry identity`);
    }
  }
  exactIdentity(resolution.reviewEvidenceIdentity, 'installed resolution.reviewEvidenceIdentity');
  exactTimestamp(resolution.resolvedAt, 'installed resolution.resolvedAt');
  if (resolution.reviewEvidenceIdentity !== review.reviewEvidenceIdentity
    || resolution.resolvedAt !== review.acceptedAt) {
    fail('installed-resolution-review-drift', 'installed resolved state is not bound to the exact accepted owner review');
  }
  exactIdentity(resolution.resolutionIdentity, 'installed resolution.resolutionIdentity');
  const { resolutionIdentity, ...resolutionCore } = resolution;
  if (resolutionIdentity !== contentIdentity(resolutionCore)) {
    fail('installed-resolution-identity-drift', 'installed resolutionIdentity does not match exact resolved-state bytes');
  }
  return freezeData({ ...resolution, bindings }, 'admitted owner-reviewed resolved state');
}

function admitReview(value, acceptedRevisions) {
  const review = exactDataObject(value, [
    'schema', 'status', 'acquisitionRevision', 'adapterRevision', 'buildRevision',
    'authorityRevision', 'reviewEvidenceIdentity', 'reviewedBy', 'acceptedAt',
    'sourceAsOf', 'sourceAsOfProvenanceIdentity',
  ], 'installed owner review gate');
  if (review.schema !== REAL_GRAPH_AUTHORITY_REVIEW_GATE_SCHEMA || review.status !== 'accepted') {
    fail('installed-review-unaccepted', 'installed owner review gate must be explicitly accepted');
  }
  for (const field of REVISION_FIELDS) {
    const reviewField = `${field}Revision`;
    exactGitRevision(review[reviewField], `installed review.${reviewField}`);
    if (review[reviewField] !== acceptedRevisions[field]) {
      fail('installed-review-revision-drift', `installed review ${reviewField} does not equal the module-private accepted revision`);
    }
  }
  boundedText(review.reviewedBy, 'installed review.reviewedBy', { max: 160 });
  exactTimestamp(review.acceptedAt, 'installed review.acceptedAt');
  const provenancePairIsNull = review.sourceAsOf === null
    && review.sourceAsOfProvenanceIdentity === null;
  const provenancePairIsBound = review.sourceAsOf !== null
    && review.sourceAsOfProvenanceIdentity !== null;
  if (!provenancePairIsNull && !provenancePairIsBound) {
    fail('installed-source-as-of-provenance', 'installed sourceAsOf and provenance identity must both be null or both be reviewed');
  }
  if (provenancePairIsBound) {
    exactDateOrTimestamp(review.sourceAsOf, 'installed review.sourceAsOf');
    exactIdentity(
      review.sourceAsOfProvenanceIdentity,
      'installed review.sourceAsOfProvenanceIdentity',
    );
  }
  exactIdentity(review.reviewEvidenceIdentity, 'installed review.reviewEvidenceIdentity');
  const { reviewEvidenceIdentity, ...reviewCore } = review;
  if (reviewEvidenceIdentity !== contentIdentity(reviewCore)) {
    fail('installed-review-identity-drift', 'installed reviewEvidenceIdentity does not match exact review and revision bytes');
  }
  return freezeData(review, 'admitted installed owner review gate');
}

function assertUniqueEntries(entries) {
  const entryIds = new Set();
  const entryIdentities = new Set();
  for (const entry of entries) {
    if (entryIds.has(entry.entryId) || entryIdentities.has(entry.entryIdentity)) {
      fail('installed-registry-duplicate', 'installed authority registry entries must have unique ids and identities');
    }
    entryIds.add(entry.entryId);
    entryIdentities.add(entry.entryIdentity);
  }
}

function exactEntryMatches(entry, subject) {
  return entry.sourceId === subject.sourceId
    && entry.evidenceSetIdentity === subject.evidenceSetIdentity
    && REAL_GRAPH_AUTHORITY_IDENTITY_KEYS.every(
      (name) => entry.identities[name] === subject.identities[name],
    );
}
