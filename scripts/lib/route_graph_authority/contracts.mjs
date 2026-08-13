import {
  boundedText,
  contentIdentity,
  exactDataObject,
  fail,
  freezeData,
} from '../route_graph_candidate/safe_data.mjs';
import {
  admitPublicDataArray,
  admitPublicDataObject,
} from './public_data.mjs';

export const AUTHORITY_REFERENCE_BINDING_SCHEMA = 'route-graph-trusted-authority-reference-binding/v1';
export const AUTHORITY_REGISTRY_BINDING_SCHEMA = 'route-graph-trusted-authority-registry-binding/v1';
export const GRAPH_BASELINE_BINDING_SCHEMA = 'route-graph-external-baseline-binding/v1';
export const GRAPH_CURRENT_BINDING_SCHEMA = 'route-graph-external-current-binding/v1';
export const ELIGIBILITY_REPORT_BINDING_SCHEMA = 'route-graph-external-eligibility-report-binding/v1';
export const ACTUAL_ADMISSION_RECORD_SCHEMA = 'route-graph-external-actual-admission-record/v1';
export const PRODUCT_MATERIALIZATION_RECORD_SCHEMA = 'route-graph-external-product-materialization-record/v1';
export const SOURCE_HEALTH_UPDATE_AUTHORIZATION_SCHEMA = 'route-graph-source-health-update-authorization/v1';
export const REDISTRIBUTION_TRANSITION_RECORD_SCHEMA = 'route-graph-redistribution-transition-record/v1';
export const PUBLIC_ACCESS_TRANSITION_RECORD_SCHEMA = 'route-graph-public-access-transition-record/v1';
export const PUBLICATION_TRANSITION_RECORD_SCHEMA = 'route-graph-publication-transition-record/v1';
export const AUTHORITY_PREREQUISITE_SNAPSHOT_SCHEMA = 'route-graph-external-authority-prerequisite-snapshot/v1';
export const AUTHORITY_TRANSITION_RESULT_SCHEMA = 'route-graph-external-authority-transition-result/v1';
export const SYNTHETIC_STATE_MACHINE_FIXTURE_SCHEMA = 'route-graph-authority-state-machine-fixture/v1';
export const SYNTHETIC_TRANSITION_OBSERVATION_SCHEMA = 'route-graph-authority-synthetic-transition-observation/v1';
export const SYNTHETIC_TRACE_SCHEMA = 'route-graph-authority-synthetic-trace/v1';

export const INTERNAL_IDENTITY_ONLY_LIMITATION = 'SHA-256 identities are internal drift bindings only; they do not establish trusted authority, signature validity, review authenticity, repository history, or publication authority.';
export const AUTHORITY_UNAVAILABLE_LIMITATION = 'No non-caller-writable trusted authority root is configured. Production transitions remain unavailable and no actual admission, product artifact, Source Health update, redistribution, public access, or publication record can be minted.';

export const INITIAL_AUTHORITY_STATE = 'authority-unbound';

export const AUTHORITY_TRANSITION_SEQUENCE = Object.freeze([
  'authority-reference-bound',
  'authority-registry-bound',
  'baseline-bound',
  'current-graph-bound',
  'eligibility-report-bound',
  'actual-admitted',
  'product-materialized',
  'source-health-update-authorized',
  'redistribution-authorized',
  'public-access-authorized',
  'publication-authorized',
]);

const TRANSITION_ARTIFACT_SCHEMAS = Object.freeze([
  AUTHORITY_REFERENCE_BINDING_SCHEMA,
  AUTHORITY_REGISTRY_BINDING_SCHEMA,
  GRAPH_BASELINE_BINDING_SCHEMA,
  GRAPH_CURRENT_BINDING_SCHEMA,
  ELIGIBILITY_REPORT_BINDING_SCHEMA,
  ACTUAL_ADMISSION_RECORD_SCHEMA,
  PRODUCT_MATERIALIZATION_RECORD_SCHEMA,
  SOURCE_HEALTH_UPDATE_AUTHORIZATION_SCHEMA,
  REDISTRIBUTION_TRANSITION_RECORD_SCHEMA,
  PUBLIC_ACCESS_TRANSITION_RECORD_SCHEMA,
  PUBLICATION_TRANSITION_RECORD_SCHEMA,
]);

export const AUTHORITY_TRANSITION_CONTRACTS = freezeData(
  AUTHORITY_TRANSITION_SEQUENCE.map((toState, index) => ({
    contractVersion: 'route-graph-external-authority-transition/v1',
    ordinal: index + 1,
    fromState: index === 0 ? INITIAL_AUTHORITY_STATE : AUTHORITY_TRANSITION_SEQUENCE[index - 1],
    toState,
    artifactSchema: TRANSITION_ARTIFACT_SCHEMAS[index],
    predecessorArtifactSchema: index === 0 ? null : TRANSITION_ARTIFACT_SCHEMAS[index - 1],
  })),
  'route graph authority transition contracts',
);

const STATE_SET = new Set([INITIAL_AUTHORITY_STATE, ...AUTHORITY_TRANSITION_SEQUENCE]);

export function transitionContractFor(fromState, toState) {
  assertAuthorityState(fromState, 'fromState');
  assertAuthorityState(toState, 'toState');
  const contract = AUTHORITY_TRANSITION_CONTRACTS.find(
    (entry) => entry.fromState === fromState && entry.toState === toState,
  );
  if (!contract) {
    fail('authority-transition-order', `transition ${fromState} -> ${toState} is not the next versioned authority transition`);
  }
  return contract;
}

export function admitSyntheticStateMachineFixture(value) {
  const keys = [
    'schema',
    'fixtureId',
    'dataClassification',
    'authorityKind',
    'baselineIdentity',
    'currentGraphIdentity',
    'eligibilityReportIdentity',
    'transitions',
  ];
  const root = admitPublicDataObject(value, keys, 'route graph synthetic authority fixture');
  const transitions = admitPublicDataArray(
    root.data.transitions,
    'route graph synthetic authority fixture.transitions',
    { max: AUTHORITY_TRANSITION_SEQUENCE.length, expectedMode: root.mode },
  );
  const fixture = exactDataObject(root.data, keys, 'route graph synthetic authority fixture');
  if (fixture.schema !== SYNTHETIC_STATE_MACHINE_FIXTURE_SCHEMA) {
    fail('synthetic-fixture-schema-unsupported', 'synthetic authority fixture schema is unsupported');
  }
  boundedText(fixture.fixtureId, 'synthetic fixture.fixtureId', {
    max: 160,
    pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
  });
  if (fixture.dataClassification !== 'synthetic-state-machine-fixture') {
    fail('synthetic-fixture-classification', 'authority state-machine fixtures must remain explicitly synthetic');
  }
  if (fixture.authorityKind !== 'synthetic-fixture') {
    fail('synthetic-fixture-authority-kind', 'only synthetic-fixture authorityKind is accepted by the simulator');
  }
  exactInternalIdentity(fixture.baselineIdentity, 'synthetic fixture.baselineIdentity');
  exactInternalIdentity(fixture.currentGraphIdentity, 'synthetic fixture.currentGraphIdentity');
  exactInternalIdentity(fixture.eligibilityReportIdentity, 'synthetic fixture.eligibilityReportIdentity');
  transitions.items.forEach((transition, index) => {
    boundedText(transition, `synthetic fixture.transitions[${index}]`, { max: 80 });
    if (transition !== AUTHORITY_TRANSITION_SEQUENCE[index]) {
      fail('authority-transition-order', 'synthetic transitions must be an exact prefix of the versioned transition sequence');
    }
  });
  return freezeData(fixture, 'admitted synthetic authority fixture');
}

export function exactInternalIdentity(value, label) {
  return boundedText(value, label, { max: 71, pattern: /^sha256:[a-f0-9]{64}$/ });
}

export function artifactIdentity(core) {
  return contentIdentity(core);
}

function assertAuthorityState(value, label) {
  if (!STATE_SET.has(value)) fail('authority-state-unsupported', `${label} is not a versioned authority state`);
}
