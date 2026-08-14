import { types as utilTypes } from 'node:util';

import {
  REAL_GRAPH_AUTHORITY_EVIDENCE_HANDLE_SCHEMA,
  REAL_GRAPH_AUTHORITY_IDENTITY_KEYS,
  REAL_GRAPH_AUTHORITY_LIMITATIONS,
  REAL_GRAPH_AUTHORITY_MATCH_SUBJECT_SCHEMA,
  REAL_GRAPH_AUTHORITY_REGISTRY_POLICY_SCHEMA,
  REAL_GRAPH_AUTHORITY_REGISTRY_SCHEMA,
  REAL_GRAPH_AUTHORITY_REVIEW_GATE_SCHEMA,
  REAL_GRAPH_AUTHORIZATION_CERTIFICATE_SCHEMA,
  REAL_GRAPH_SOURCE_HEALTH_AUTHORIZATION_SCHEMA,
  REAL_GRAPH_SOURCE_HEALTH_PROJECTION_SCHEMA,
  REQUIRED_INSTALLED_SCOPES,
} from './contracts.mjs';
import { admitRealGraphEvidenceDocuments } from './evidence.mjs';
import { analyzeInstalledAuthorityEntries } from './installed_authority.mjs';
import {
  canonicalStringify,
  contentIdentity,
  exactDataObject,
  fail,
  freezeData,
} from './safe_data.mjs';

const PREPARED_HANDLES = new WeakMap();
const ATTEMPTED_HANDLES = new WeakSet();
const evaluateInstalledAuthority = createInstalledAuthorityClosure();

export function prepareRealGraphAuthorityEvidence(
  acquisitionJson,
  adapterJson,
  buildJson,
  readinessJson,
) {
  if (arguments.length !== 4) {
    fail(
      'evidence-arguments',
      'authority preparation accepts exactly RD-A, RD-B, RD-E, and source-readiness primitive JSON documents',
    );
  }
  const evidenceSet = admitRealGraphEvidenceDocuments(
    acquisitionJson,
    adapterJson,
    buildJson,
    readinessJson,
  );
  const reviewGate = unavailableReviewGate('installed-entry-required');
  const handleCore = {
    schema: REAL_GRAPH_AUTHORITY_EVIDENCE_HANDLE_SCHEMA,
    status: 'evidence-bound',
    dataClassification: 'candidate-external-authority-prerequisite',
    sourceId: evidenceSet.sourceId,
    evidenceSetIdentity: evidenceSet.evidenceSetIdentity,
    identities: evidenceSet.identities,
    reviewGate,
    authorityAvailable: false,
    entryMatched: false,
    authorizationIssued: false,
    actualAdmission: false,
    sourceHealthUpdateAuthorized: false,
    sourceHealthCurrentClaimed: false,
    sourceCatalogMutationAuthorized: false,
    productMaterialized: false,
    runtimeAuthorized: false,
    redistributionAuthorized: false,
    publicationAuthorized: false,
  };
  const handle = freezeData({
    ...handleCore,
    handleIdentity: contentIdentity(handleCore),
  }, 'real graph authority evidence handle');
  PREPARED_HANDLES.set(handle, evidenceSet);
  return handle;
}

export function authorizeRealGraphSourceHealthUpdate(handle) {
  if (arguments.length !== 1) {
    fail(
      'authorization-arguments',
      'authorization accepts only the exact same-session handle; caller registry, hash, reviewedBy, brand, policy, and projection overrides are forbidden',
    );
  }
  if (utilTypes.isProxy(handle)) {
    fail('authority-handle-proxy', 'authority handle must not be a Proxy');
  }
  const evidenceSet = PREPARED_HANDLES.get(handle);
  if (!evidenceSet) {
    fail(
      'authority-handle-not-admitted',
      'authorization requires the exact same-session handle returned by this module instance',
    );
  }
  if (ATTEMPTED_HANDLES.has(handle)) {
    fail('authority-handle-replay', 'an authority evidence handle can be evaluated only once');
  }
  assertHandleIntact(handle, evidenceSet);
  ATTEMPTED_HANDLES.add(handle);

  const subject = freezeData({
    schema: REAL_GRAPH_AUTHORITY_MATCH_SUBJECT_SCHEMA,
    sourceId: evidenceSet.sourceId,
    evidenceSetIdentity: evidenceSet.evidenceSetIdentity,
    identities: evidenceSet.identities,
  }, 'same-session authority match subject');
  const { analysis: match, certificateResult } = evaluateInstalledAuthority(subject);
  return authorizationResult(evidenceSet, match, certificateResult);
}

function createInstalledAuthorityClosure() {
  const installedRegistryRevision =
    'route-real-graph-installed-authority-registry/unconfigured-v1';
  // Integration-owner-controlled capability root. This writer intentionally
  // installs no entry. Neither the registry, policy, issuance ledger, nor the
  // formal certificate builder escapes this closure.
  const installedRegistry = Object.freeze([]);
  const installedPolicy = freezeData({
    schema: REAL_GRAPH_AUTHORITY_REGISTRY_POLICY_SCHEMA,
    registryRevision: installedRegistryRevision,
    acceptedRevisions: {
      acquisition: null,
      adapter: null,
      build: null,
      authority: null,
    },
  }, 'module-private empty installed registry policy');
  const issuedCertificateIdentities = new Set();

  function buildPrivateCertificate(analysis, subject) {
    if (!analysis.entryMatched) {
      return freezeData({
        entryMatched: false,
        authorizationIssued: false,
        duplicateIssuance: false,
        certificateIdentity: null,
        certificate: null,
        reasonCode: 'exact-installed-authority-entry-unavailable',
      }, 'private unmatched authorization result');
    }
    const entry = analysis.entry;
    if (entry.sourceId !== subject.sourceId
      || entry.evidenceSetIdentity !== subject.evidenceSetIdentity
      || !REAL_GRAPH_AUTHORITY_IDENTITY_KEYS.every(
        (name) => entry.identities[name] === subject.identities[name],
      )) {
      fail('installed-match-subject-drift', 'private certificate subject no longer equals its installed entry');
    }
    const certificateCore = {
      schema: REAL_GRAPH_AUTHORIZATION_CERTIFICATE_SCHEMA,
      sourceId: subject.sourceId,
      evidenceSetIdentity: subject.evidenceSetIdentity,
      registryRevision: analysis.registryRevision,
      registryEntryIdentity: entry.entryIdentity,
      reviewEvidenceIdentity: entry.review.reviewEvidenceIdentity,
      resolutionIdentity: entry.resolution.resolutionIdentity,
      acceptedRevisions: {
        acquisition: entry.review.acquisitionRevision,
        adapter: entry.review.adapterRevision,
        build: entry.review.buildRevision,
        authority: entry.review.authorityRevision,
      },
      proposedStatus: 'current',
      sourceAsOf: entry.review.sourceAsOf,
      sourceAsOfProvenanceIdentity: entry.review.sourceAsOfProvenanceIdentity,
      recordCountDefinitionIdentity: subject.identities.recordCountDefinition,
      scopes: REQUIRED_INSTALLED_SCOPES,
      realGraphAdmissionAuthorized: true,
      sourceHealthUpdateAuthorized: true,
      sourceHealthOwnerApplicationRequired: true,
      directCatalogMutationAuthorized: false,
      catalogMutationExecuted: false,
      projectionObservationState: 'not-observed',
      projectionStatus: 'unavailable',
      graphArtifactMinted: false,
      runtimeAuthorized: false,
      publicationAuthorized: false,
    };
    const certificateIdentity = contentIdentity(certificateCore);
    if (issuedCertificateIdentities.has(certificateIdentity)) {
      return freezeData({
        entryMatched: true,
        authorizationIssued: false,
        duplicateIssuance: true,
        certificateIdentity,
        certificate: null,
        reasonCode: 'authorization-certificate-already-issued',
      }, 'private duplicate authorization result');
    }
    issuedCertificateIdentities.add(certificateIdentity);
    return freezeData({
      entryMatched: true,
      authorizationIssued: true,
      duplicateIssuance: false,
      certificateIdentity,
      certificate: { ...certificateCore, certificateIdentity },
      reasonCode: 'exact-installed-authority-entry-certificate-issued',
    }, 'private issued authorization result');
  }

  return function evaluate(subject) {
    const analysis = analyzeInstalledAuthorityEntries(
      installedRegistry,
      subject,
      installedPolicy,
    );
    return freezeData({
      analysis,
      certificateResult: buildPrivateCertificate(analysis, subject),
    }, 'module-private installed authority evaluation');
  };
}

function authorizationResult(evidenceSet, match, certificateResult) {
  const entry = match.entry;
  const projection = unavailableProjection(evidenceSet.sourceId);
  const status = certificateResult.authorizationIssued
    ? 'authorization-issued'
    : certificateResult.duplicateIssuance
      ? 'authorization-already-issued'
      : 'authority-unavailable';
  const reasonCodes = certificateResult.authorizationIssued
    ? [certificateResult.reasonCode, 'central-source-health-owner-application-required', 'catalog-unchanged']
    : certificateResult.duplicateIssuance
      ? [certificateResult.reasonCode, 'catalog-unchanged']
      : [
        match.installedEntryCount === 0
          ? 'installed-authority-registry-empty'
          : 'exact-installed-authority-entry-unavailable',
        'authority-unavailable',
        'catalog-unchanged',
      ];
  const reviewGate = entry
    ? {
      schema: REAL_GRAPH_AUTHORITY_REVIEW_GATE_SCHEMA,
      status: 'accepted-installed-entry',
      callerAssertionsAccepted: false,
      registryEntryIdentity: entry.entryIdentity,
      reviewEvidenceIdentity: entry.review.reviewEvidenceIdentity,
      resolutionIdentity: entry.resolution.resolutionIdentity,
      reviewedBy: entry.review.reviewedBy,
      acceptedAt: entry.review.acceptedAt,
      sourceAsOf: entry.review.sourceAsOf,
      sourceAsOfProvenanceIdentity: entry.review.sourceAsOfProvenanceIdentity,
      acceptedRevisions: {
        acquisition: entry.review.acquisitionRevision,
        adapter: entry.review.adapterRevision,
        build: entry.review.buildRevision,
        authority: entry.review.authorityRevision,
      },
    }
    : unavailableReviewGate('unavailable');
  const core = {
    schema: REAL_GRAPH_SOURCE_HEALTH_AUTHORIZATION_SCHEMA,
    status,
    entryMatched: match.entryMatched,
    authorizationIssued: certificateResult.authorizationIssued,
    duplicateIssuance: certificateResult.duplicateIssuance,
    dataClassification: 'owner-controlled-real-graph-authority-result',
    evidenceSetIdentity: evidenceSet.evidenceSetIdentity,
    registry: {
      schema: REAL_GRAPH_AUTHORITY_REGISTRY_SCHEMA,
      revision: match.registryRevision,
      installedEntryCount: match.installedEntryCount,
      exactEntryMatched: match.entryMatched,
      entryIdentity: entry?.entryIdentity ?? null,
    },
    reviewGate,
    authorityVerified: match.entryMatched,
    actualAdmissionAuthorized: certificateResult.authorizationIssued,
    updateAuthorization: {
      authorized: certificateResult.authorizationIssued,
      scope: 'source-health-observation-update',
      sourceId: evidenceSet.sourceId,
      proposedStatus: certificateResult.certificate?.proposedStatus ?? null,
      certificateIdentity: certificateResult.certificateIdentity,
      certificate: certificateResult.certificate,
      centralSourceHealthOwnerApplicationRequired: certificateResult.authorizationIssued,
      directCatalogMutationAuthorized: false,
      catalogMutationExecuted: false,
    },
    projection,
    sourceHealthCurrentClaimed: false,
    sourceCatalogUnchanged: true,
    productMaterialized: false,
    runtimeAuthorized: false,
    redistributionAuthorized: false,
    publicAccessAuthorized: false,
    publicationAuthorized: false,
    graphArtifactMinted: false,
    reasonCodes,
    limitations: REAL_GRAPH_AUTHORITY_LIMITATIONS,
  };
  return freezeData({
    ...core,
    authorizationIdentity: contentIdentity(core),
  }, 'real graph Source Health update authorization');
}

function unavailableProjection(sourceId) {
  return freezeData({
    schema: REAL_GRAPH_SOURCE_HEALTH_PROJECTION_SCHEMA,
    sourceId,
    observationState: 'not-observed',
    status: 'unavailable',
    statusReason: 'central-source-health-owner-has-not-applied-reviewed-observation',
    clocks: {
      sourceAsOf: null,
      retrievedAt: null,
      builtAt: null,
      observedAt: null,
    },
    snapshot: { version: null, identity: null },
    boundaryVintage: null,
    coverage: { geography: null, temporalStart: null, temporalEnd: null },
    transport: { endpointUrl: null, lastModified: null, etag: null },
    recordCountDefinition: null,
    recordCount: null,
  }, 'not-observed unavailable real graph Source Health projection');
}

function unavailableReviewGate(status) {
  return {
    schema: REAL_GRAPH_AUTHORITY_REVIEW_GATE_SCHEMA,
    status,
    callerAssertionsAccepted: false,
    registryEntryIdentity: null,
    reviewEvidenceIdentity: null,
    resolutionIdentity: null,
    reviewedBy: null,
    acceptedAt: null,
    sourceAsOf: null,
    sourceAsOfProvenanceIdentity: null,
    acceptedRevisions: {
      acquisition: null,
      adapter: null,
      build: null,
      authority: null,
    },
  };
}

function assertHandleIntact(handle, evidenceSet) {
  if (!Object.isFrozen(handle)) {
    fail('authority-handle-tampered', 'same-session authority handle must remain frozen');
  }
  const clone = exactDataObject(handle, [
    'schema', 'status', 'dataClassification', 'sourceId', 'evidenceSetIdentity',
    'identities', 'reviewGate', 'authorityAvailable', 'entryMatched',
    'authorizationIssued', 'actualAdmission', 'sourceHealthUpdateAuthorized',
    'sourceHealthCurrentClaimed', 'sourceCatalogMutationAuthorized',
    'productMaterialized', 'runtimeAuthorized', 'redistributionAuthorized',
    'publicationAuthorized', 'handleIdentity',
  ], 'same-session authority handle');
  const { handleIdentity, ...core } = clone;
  if (handle.schema !== REAL_GRAPH_AUTHORITY_EVIDENCE_HANDLE_SCHEMA
    || handleIdentity !== contentIdentity(core)
    || handle.evidenceSetIdentity !== evidenceSet.evidenceSetIdentity
    || canonicalStringify(handle.identities) !== canonicalStringify(evidenceSet.identities)) {
    fail('authority-handle-tampered', 'same-session authority handle no longer binds its exact evidence set');
  }
}
