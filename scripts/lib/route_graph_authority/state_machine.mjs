import { types as utilTypes } from 'node:util';

import {
  canonicalStringify,
  contentIdentity,
  exactDataObject,
  fail,
  freezeData,
} from '../route_graph_candidate/safe_data.mjs';
import {
  ROUTE_GRAPH_ELIGIBILITY_REPORT_SCHEMA,
  verifyRouteGraphEligibilityReport,
} from '../route_graph_admission/index.mjs';
import {
  AUTHORITY_PREREQUISITE_SNAPSHOT_SCHEMA,
  AUTHORITY_REFERENCE_BINDING_SCHEMA,
  AUTHORITY_REGISTRY_BINDING_SCHEMA,
  AUTHORITY_TRANSITION_RESULT_SCHEMA,
  AUTHORITY_TRANSITION_SEQUENCE,
  AUTHORITY_UNAVAILABLE_LIMITATION,
  ELIGIBILITY_REPORT_BINDING_SCHEMA,
  GRAPH_BASELINE_BINDING_SCHEMA,
  GRAPH_CURRENT_BINDING_SCHEMA,
  INITIAL_AUTHORITY_STATE,
  INTERNAL_IDENTITY_ONLY_LIMITATION,
  SYNTHETIC_TRACE_SCHEMA,
  SYNTHETIC_TRANSITION_OBSERVATION_SCHEMA,
  admitSyntheticStateMachineFixture,
  artifactIdentity,
  transitionContractFor,
} from './contracts.mjs';
import { admitPublicDataObject } from './public_data.mjs';

const ADMITTED_SNAPSHOTS = new WeakSet();
const ATTEMPTED_SNAPSHOTS = new WeakSet();
const REPORT_GATE_NAMES = Object.freeze([
  'externalDataEligibility',
  'internalReviewEligibility',
  'productGraphEligibility',
  'redistributionEligibility',
  'publicAccessEligibility',
  'publicationEligibility',
]);

export function inspectExternalGraphAuthorityPrerequisites(raw) {
  const input = exactRootDataObject(raw, ['eligibilityReport', 'eligibilityInputs'], 'external graph authority prerequisite input');
  if (utilTypes.isProxy(input.eligibilityReport)) {
    fail('eligibility-report-proxy', 'eligibilityReport must not be a Proxy');
  }
  if (utilTypes.isProxy(input.eligibilityInputs)) {
    fail('eligibility-inputs-proxy', 'eligibilityInputs must not be a Proxy');
  }
  const report = verifyRouteGraphEligibilityReport(input.eligibilityReport, input.eligibilityInputs);
  assertValidationOnlyReport(report);

  const authorityReference = identified({
    schema: AUTHORITY_REFERENCE_BINDING_SCHEMA,
    bindingStatus: 'authority-unavailable',
    authorityVerified: false,
    authorityId: null,
    authorityRootKind: null,
    trustAnchorIdentity: null,
    verificationMethod: null,
    actual: false,
    productConsumable: false,
    reasonCodes: ['trusted-authority-root-unavailable'],
  });
  const authorityRegistry = identified({
    schema: AUTHORITY_REGISTRY_BINDING_SCHEMA,
    bindingStatus: 'authority-unavailable',
    authorityVerified: false,
    authorityReferenceIdentity: authorityReference.identity,
    registryId: null,
    registryEntryIdentity: null,
    registryRevision: null,
    grantedScopes: [],
    actual: false,
    productConsumable: false,
    reasonCodes: ['trusted-authority-registry-unavailable'],
  });
  const baselineBinding = graphBinding(
    GRAPH_BASELINE_BINDING_SCHEMA,
    'baseline',
    report.identities.baseline,
  );
  const currentGraphBinding = graphBinding(
    GRAPH_CURRENT_BINDING_SCHEMA,
    'current',
    report.identities.current,
  );
  const eligibilityReportBinding = identified({
    schema: ELIGIBILITY_REPORT_BINDING_SCHEMA,
    bindingStatus: 'validation-only',
    reportSchema: report.schema,
    reportIdentity: report.reportIdentity,
    evidenceIdentity: report.evidenceIdentity,
    policyIdentity: report.policyIdentity,
    reviewSetIdentity: report.reviewSetIdentity,
    baselineGraphIdentity: report.identities.baseline.graph,
    currentGraphIdentity: report.identities.current.graph,
    semanticDiffIdentity: report.identities.semanticDiff.identity,
    callerPolicyConformance: Object.fromEntries(
      REPORT_GATE_NAMES.map((name) => [name, report.gates[name].callerPolicyConformance]),
    ),
    authorityVerified: false,
    actualAdmission: false,
    promotionExecuted: false,
    materializedArtifact: false,
    actual: false,
    productConsumable: false,
    reasonCodes: ['s4-eligibility-report-validation-only', 'trusted-authority-root-unavailable'],
  });
  const snapshotCore = {
    schema: AUTHORITY_PREREQUISITE_SNAPSHOT_SCHEMA,
    state: INITIAL_AUTHORITY_STATE,
    dataClassification: 'candidate-external-authority-prerequisite',
    authorityAvailable: false,
    authorityReference,
    authorityRegistry,
    baselineBinding,
    currentGraphBinding,
    eligibilityReportBinding,
    nextTransition: AUTHORITY_TRANSITION_SEQUENCE[0],
    actualAdmission: false,
    productMaterialized: false,
    sourceHealthUpdateAuthorized: false,
    redistributionAuthorized: false,
    publicAccessAuthorized: false,
    publicationAuthorized: false,
    limitations: [INTERNAL_IDENTITY_ONLY_LIMITATION, AUTHORITY_UNAVAILABLE_LIMITATION],
  };
  const snapshot = freezeData({ ...snapshotCore, snapshotIdentity: contentIdentity(snapshotCore) }, 'external graph authority prerequisite snapshot');
  ADMITTED_SNAPSHOTS.add(snapshot);
  return snapshot;
}

export function attemptExternalGraphAuthorityTransition(raw) {
  const input = exactRootDataObject(raw, ['prerequisiteSnapshot', 'requestedTransition'], 'external graph authority transition input');
  const snapshot = input.prerequisiteSnapshot;
  if (utilTypes.isProxy(snapshot)) fail('authority-snapshot-proxy', 'prerequisiteSnapshot must not be a Proxy');
  if (!ADMITTED_SNAPSHOTS.has(snapshot)) {
    fail('authority-snapshot-not-admitted', 'transition requires the exact same-session prerequisite snapshot');
  }
  if (ATTEMPTED_SNAPSHOTS.has(snapshot)) {
    fail('authority-transition-replay', 'a prerequisite snapshot cannot be replayed');
  }
  if (!Object.isFrozen(snapshot) || !snapshotIsIntact(snapshot)) {
    fail('authority-snapshot-tampered', 'prerequisite snapshot does not match its admitted identity');
  }
  transitionContractFor(snapshot.state, input.requestedTransition);
  ATTEMPTED_SNAPSHOTS.add(snapshot);

  const resultCore = {
    schema: AUTHORITY_TRANSITION_RESULT_SCHEMA,
    status: 'authority-unavailable',
    transitioned: false,
    fromState: snapshot.state,
    toState: snapshot.state,
    requestedTransition: input.requestedTransition,
    prerequisiteSnapshotIdentity: snapshot.snapshotIdentity,
    authorityVerified: false,
    actualAdmission: false,
    productMaterialized: false,
    sourceHealthUpdateAuthorized: false,
    redistributionAuthorized: false,
    publicAccessAuthorized: false,
    publicationAuthorized: false,
    mintedArtifactSchema: null,
    mintedArtifactIdentity: null,
    productConsumable: false,
    reasonCodes: ['trusted-authority-root-unavailable', 'no-transition'],
    limitations: [INTERNAL_IDENTITY_ONLY_LIMITATION, AUTHORITY_UNAVAILABLE_LIMITATION],
  };
  return freezeData({ ...resultCore, resultIdentity: contentIdentity(resultCore) }, 'external graph authority transition result');
}

export function simulateSyntheticAuthorityStateMachine(raw) {
  const fixture = admitSyntheticStateMachineFixture(raw);
  let state = INITIAL_AUTHORITY_STATE;
  const observations = [];
  for (const requestedTransition of fixture.transitions) {
    const contract = transitionContractFor(state, requestedTransition);
    const core = {
      schema: SYNTHETIC_TRANSITION_OBSERVATION_SCHEMA,
      dataClassification: 'synthetic-state-machine-observation',
      fixtureId: fixture.fixtureId,
      ordinal: contract.ordinal,
      fromState: contract.fromState,
      toState: contract.toState,
      expectedActualArtifactSchema: contract.artifactSchema,
      predecessorArtifactSchema: contract.predecessorArtifactSchema,
      baselineIdentity: fixture.baselineIdentity,
      currentGraphIdentity: fixture.currentGraphIdentity,
      eligibilityReportIdentity: fixture.eligibilityReportIdentity,
      syntheticOnly: true,
      actual: false,
      authorityVerified: false,
      productConsumable: false,
      mintedActualArtifactIdentity: null,
    };
    observations.push(freezeData({ ...core, observationIdentity: contentIdentity(core) }, 'synthetic authority transition observation'));
    state = requestedTransition;
  }
  const traceCore = {
    schema: SYNTHETIC_TRACE_SCHEMA,
    dataClassification: 'synthetic-state-machine-trace',
    fixtureId: fixture.fixtureId,
    initialState: INITIAL_AUTHORITY_STATE,
    finalState: state,
    transitionCount: observations.length,
    observations,
    syntheticOnly: true,
    actualAdmission: false,
    productMaterialized: false,
    sourceHealthUpdateAuthorized: false,
    redistributionAuthorized: false,
    publicAccessAuthorized: false,
    publicationAuthorized: false,
    productConsumable: false,
    limitations: [INTERNAL_IDENTITY_ONLY_LIMITATION, AUTHORITY_UNAVAILABLE_LIMITATION],
  };
  return freezeData({ ...traceCore, traceIdentity: contentIdentity(traceCore) }, 'synthetic authority state-machine trace');
}

function assertValidationOnlyReport(report) {
  if (report.schema !== ROUTE_GRAPH_ELIGIBILITY_REPORT_SCHEMA
    || report.dataClassification !== 'validation-only-external-graph-eligibility') {
    fail('s4-eligibility-report-required', 'authority prerequisites require the unchanged S4 validation-only eligibility report');
  }
  for (const field of ['authorityVerified', 'actualAdmission', 'promotionExecuted', 'materializedArtifact']) {
    if (report[field] !== false) fail('s4-eligibility-report-upgrade-forbidden', `S4 eligibility report ${field} must remain false`);
  }
  for (const name of REPORT_GATE_NAMES) {
    const gate = report.gates[name];
    for (const field of ['eligible', 'authorityVerified', 'actualAdmission', 'promotionExecuted', 'materializedArtifact']) {
      if (gate[field] !== false) fail('s4-eligibility-report-upgrade-forbidden', `S4 eligibility report ${name}.${field} must remain false`);
    }
  }
  const sourceHealth = report.gates.sourceHealthProjection;
  if (sourceHealth.projectionOnly !== true
    || sourceHealth.observationState !== 'not-observed'
    || sourceHealth.projectedStatus !== 'unknown'
    || sourceHealth.recordCount !== null
    || sourceHealth.authorityVerified !== false
    || sourceHealth.catalogMutationAuthorized !== false
    || sourceHealth.runtimeMutationAuthorized !== false) {
    fail('s4-source-health-projection-upgrade-forbidden', 'S4 Source Health projection must remain unknown, unobserved, and mutation-unauthorized');
  }
}

function graphBinding(schema, role, identities) {
  return identified({
    schema,
    bindingRole: role,
    bindingStatus: 'candidate-only',
    dataClassification: 'candidate-external',
    graphIdentity: identities.graph,
    sourceIdentity: identities.source,
    sourceContentIdentity: identities.sourceContent,
    schemaIdentity: identities.schema,
    licenseAttributionIdentity: identities.licenseAttribution,
    coverageIdentity: identities.coverage,
    clockIdentity: identities.fourClocks,
    modeIdentity: identities.mode,
    topologyIdentity: identities.topology,
    geometryIdentity: identities.geometry,
    contentIdentity: identities.content,
    auditIdentity: identities.audit,
    authorityVerified: false,
    actual: false,
    productConsumable: false,
    reasonCodes: ['candidate-external-not-authority-bound'],
  });
}

function identified(core) {
  return freezeData({ ...core, identity: artifactIdentity(core) }, `${core.schema} artifact`);
}

function snapshotIsIntact(snapshot) {
  const clone = exactDataObject(snapshot, [
    'schema', 'state', 'dataClassification', 'authorityAvailable', 'authorityReference',
    'authorityRegistry', 'baselineBinding', 'currentGraphBinding', 'eligibilityReportBinding',
    'nextTransition', 'actualAdmission', 'productMaterialized', 'sourceHealthUpdateAuthorized',
    'redistributionAuthorized', 'publicAccessAuthorized', 'publicationAuthorized', 'limitations',
    'snapshotIdentity',
  ], 'external graph authority prerequisite snapshot');
  const { snapshotIdentity, ...core } = clone;
  return snapshot.schema === AUTHORITY_PREREQUISITE_SNAPSHOT_SCHEMA
    && snapshotIdentity === contentIdentity(core)
    && canonicalStringify(clone) === canonicalStringify(snapshot);
}

function exactRootDataObject(value, keys, label) {
  return admitPublicDataObject(value, keys, label).data;
}
