import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as authorityApi from '../lib/route_graph_authority/index.mjs';

import {
  CALLER_SUPPLIED_REVIEW_ASSERTION_SCHEMA,
  evaluateRouteGraphEligibility,
  inspectRouteGraphEligibilityEvidence,
} from '../lib/route_graph_admission/index.mjs';
import {
  createCandidateReceipt,
  normalizeRouteGraphCandidate,
} from '../lib/route_graph_candidate/index.mjs';
import {
  ACTUAL_ADMISSION_RECORD_SCHEMA,
  AUTHORITY_REFERENCE_BINDING_SCHEMA,
  AUTHORITY_REGISTRY_BINDING_SCHEMA,
  AUTHORITY_TRANSITION_CONTRACTS,
  AUTHORITY_TRANSITION_SEQUENCE,
  ELIGIBILITY_REPORT_BINDING_SCHEMA,
  GRAPH_BASELINE_BINDING_SCHEMA,
  GRAPH_CURRENT_BINDING_SCHEMA,
  PRODUCT_MATERIALIZATION_RECORD_SCHEMA,
  PUBLIC_ACCESS_TRANSITION_RECORD_SCHEMA,
  PUBLICATION_TRANSITION_RECORD_SCHEMA,
  REDISTRIBUTION_TRANSITION_RECORD_SCHEMA,
  SOURCE_HEALTH_UPDATE_AUTHORIZATION_SCHEMA,
  attemptExternalGraphAuthorityTransition,
  inspectExternalGraphAuthorityPrerequisites,
  simulateSyntheticAuthorityStateMachine,
} from '../lib/route_graph_authority/index.mjs';

const sourceDescriptorFixture = await candidateFixture('synthetic_descriptor.json');
const modeProfileFixture = await candidateFixture('walking_profile.json');
const rawGraphFixture = await candidateFixture('valid_raw_graph.json');
const authorityPolicyFixture = await admissionFixture('authority_policy.json');
const promotionIntentFixture = await admissionFixture('promotion_intent.json');
const reviewTemplateFixture = await admissionFixture('review_template.json');
const fullSequenceFixture = await authorityFixture('full_sequence.json');
const prerequisitePrefixFixture = await authorityFixture('prerequisite_prefix.json');

test('versioned transition contracts are ordered and use one distinct artifact schema per gate', () => {
  assert.deepEqual(
    AUTHORITY_TRANSITION_CONTRACTS.map((contract) => contract.toState),
    AUTHORITY_TRANSITION_SEQUENCE,
  );
  assert.deepEqual(
    AUTHORITY_TRANSITION_CONTRACTS.map((contract) => contract.ordinal),
    Array.from({ length: AUTHORITY_TRANSITION_SEQUENCE.length }, (_, index) => index + 1),
  );
  assert.equal(
    new Set(AUTHORITY_TRANSITION_CONTRACTS.map((contract) => contract.artifactSchema)).size,
    AUTHORITY_TRANSITION_CONTRACTS.length,
  );
  assert.deepEqual(
    AUTHORITY_TRANSITION_CONTRACTS.slice(5).map((contract) => contract.artifactSchema),
    [
      ACTUAL_ADMISSION_RECORD_SCHEMA,
      PRODUCT_MATERIALIZATION_RECORD_SCHEMA,
      SOURCE_HEALTH_UPDATE_AUTHORIZATION_SCHEMA,
      REDISTRIBUTION_TRANSITION_RECORD_SCHEMA,
      PUBLIC_ACCESS_TRANSITION_RECORD_SCHEMA,
      PUBLICATION_TRANSITION_RECORD_SCHEMA,
    ],
  );
});

test('production prerequisite inspection preserves S4 validation-only truth and candidate-external ontology', () => {
  const { report, inputs } = reportAndInputs();
  const snapshot = inspectExternalGraphAuthorityPrerequisites({ eligibilityReport: report, eligibilityInputs: inputs });

  assert.equal(snapshot.state, 'authority-unbound');
  assert.equal(snapshot.authorityAvailable, false);
  assert.equal(snapshot.baselineBinding.dataClassification, 'candidate-external');
  assert.equal(snapshot.currentGraphBinding.dataClassification, 'candidate-external');
  assert.equal(snapshot.baselineBinding.productConsumable, false);
  assert.equal(snapshot.currentGraphBinding.productConsumable, false);
  assert.equal(snapshot.eligibilityReportBinding.bindingStatus, 'validation-only');
  assert.equal(snapshot.eligibilityReportBinding.reportIdentity, report.reportIdentity);
  assert.equal(snapshot.actualAdmission, false);
  assert.equal(snapshot.productMaterialized, false);
  assert.equal(snapshot.publicationAuthorized, false);
  assert.equal('graphArtifact' in snapshot, false);
  assert.equal('productArtifact' in snapshot, false);
});

test('authority, registry, baseline, current and eligibility bindings stay separate and independently identified', () => {
  const snapshot = prerequisiteSnapshot();
  const artifacts = [
    snapshot.authorityReference,
    snapshot.authorityRegistry,
    snapshot.baselineBinding,
    snapshot.currentGraphBinding,
    snapshot.eligibilityReportBinding,
  ];
  assert.deepEqual(artifacts.map((artifact) => artifact.schema), [
    AUTHORITY_REFERENCE_BINDING_SCHEMA,
    AUTHORITY_REGISTRY_BINDING_SCHEMA,
    GRAPH_BASELINE_BINDING_SCHEMA,
    GRAPH_CURRENT_BINDING_SCHEMA,
    ELIGIBILITY_REPORT_BINDING_SCHEMA,
  ]);
  assert.equal(new Set(artifacts.map((artifact) => artifact.identity)).size, artifacts.length);
  for (const artifact of artifacts) {
    assert.equal(artifact.actual, false);
    assert.equal(artifact.productConsumable, false);
    assert.equal(Object.isFrozen(artifact), true);
  }
});

test('caller-policy conformance cannot become authority, actual admission or product/public state', () => {
  const snapshot = prerequisiteSnapshot();
  assert.deepEqual(
    Object.values(snapshot.eligibilityReportBinding.callerPolicyConformance),
    [true, true, true, true, true, true],
  );
  assert.equal(snapshot.authorityReference.authorityVerified, false);
  assert.equal(snapshot.authorityRegistry.authorityVerified, false);
  assert.equal(snapshot.actualAdmission, false);
  assert.equal(snapshot.productMaterialized, false);
  assert.equal(snapshot.sourceHealthUpdateAuthorized, false);
  assert.equal(snapshot.redistributionAuthorized, false);
  assert.equal(snapshot.publicAccessAuthorized, false);
  assert.equal(snapshot.publicationAuthorized, false);
});

test('first production transition stops honestly at authority-unavailable with no minted artifact', () => {
  const snapshot = prerequisiteSnapshot();
  const result = attemptExternalGraphAuthorityTransition({
    prerequisiteSnapshot: snapshot,
    requestedTransition: 'authority-reference-bound',
  });
  assert.equal(result.status, 'authority-unavailable');
  assert.equal(result.transitioned, false);
  assert.equal(result.fromState, 'authority-unbound');
  assert.equal(result.toState, 'authority-unbound');
  assert.equal(result.authorityVerified, false);
  assert.equal(result.actualAdmission, false);
  assert.equal(result.productMaterialized, false);
  assert.equal(result.sourceHealthUpdateAuthorized, false);
  assert.equal(result.redistributionAuthorized, false);
  assert.equal(result.publicAccessAuthorized, false);
  assert.equal(result.publicationAuthorized, false);
  assert.equal(result.mintedArtifactSchema, null);
  assert.equal(result.mintedArtifactIdentity, null);
  assert.equal(result.productConsumable, false);
  assert.deepEqual(result.reasonCodes, ['trusted-authority-root-unavailable', 'no-transition']);
});

test('production transitions cannot skip from authority-unbound to later gates', () => {
  for (const requestedTransition of AUTHORITY_TRANSITION_SEQUENCE.slice(1)) {
    const snapshot = prerequisiteSnapshot();
    assert.throws(
      () => attemptExternalGraphAuthorityTransition({ prerequisiteSnapshot: snapshot, requestedTransition }),
      hasCode('authority-transition-order'),
      requestedTransition,
    );
  }
});

test('same-session snapshot replay fails closed after the first authority-unavailable attempt', () => {
  const snapshot = prerequisiteSnapshot();
  const request = { prerequisiteSnapshot: snapshot, requestedTransition: 'authority-reference-bound' };
  attemptExternalGraphAuthorityTransition(request);
  assert.throws(() => attemptExternalGraphAuthorityTransition(request), hasCode('authority-transition-replay'));
});

test('structured-cloned and JSON-round-tripped snapshots cannot cross session boundaries', () => {
  const snapshot = prerequisiteSnapshot();
  for (const replay of [structuredClone(snapshot), JSON.parse(JSON.stringify(snapshot))]) {
    assert.throws(
      () => attemptExternalGraphAuthorityTransition({
        prerequisiteSnapshot: replay,
        requestedTransition: 'authority-reference-bound',
      }),
      hasCode('authority-snapshot-not-admitted'),
    );
  }
});

test('same-process caller factories and hand-authored JSON cannot create authority', () => {
  const snapshot = prerequisiteSnapshot();
  const fake = { ...snapshot };
  assert.throws(
    () => attemptExternalGraphAuthorityTransition({
      prerequisiteSnapshot: fake,
      requestedTransition: 'authority-reference-bound',
    }),
    hasCode('authority-snapshot-not-admitted'),
  );
});

test('root Proxy, getter, hidden and symbol properties fail closed without invoking getter traps', () => {
  let proxyCalls = 0;
  const proxy = new Proxy({ eligibilityReport: {}, eligibilityInputs: {} }, {
    get() { proxyCalls += 1; throw new Error('must not read'); },
    ownKeys() { proxyCalls += 1; throw new Error('must not inspect'); },
  });
  assert.throws(() => inspectExternalGraphAuthorityPrerequisites(proxy), hasCode('proxy-object'));
  assert.equal(proxyCalls, 0);

  let getterCalls = 0;
  const getterInput = {};
  Object.defineProperty(getterInput, 'eligibilityReport', {
    enumerable: true,
    get() { getterCalls += 1; return {}; },
  });
  getterInput.eligibilityInputs = {};
  assert.throws(() => inspectExternalGraphAuthorityPrerequisites(getterInput), hasCode('accessor-property'));
  assert.equal(getterCalls, 0);

  const hiddenInput = { eligibilityReport: {}, eligibilityInputs: {} };
  Object.defineProperty(hiddenInput, 'actualAdmission', { enumerable: false, value: true });
  assert.throws(() => inspectExternalGraphAuthorityPrerequisites(hiddenInput), hasCode('hidden-property'));

  const symbolInput = { eligibilityReport: {}, eligibilityInputs: {} };
  symbolInput[Symbol('authority')] = true;
  assert.throws(() => inspectExternalGraphAuthorityPrerequisites(symbolInput), hasCode('symbol-property'));
});

test('all public roots accept only container-wide mutable or fully frozen descriptor modes', () => {
  for (const admission of publicRootAdmissions()) {
    const mutable = admission.make();
    const mutableResult = admission.call(mutable);
    admission.assertHardFalse(mutableResult);

    const frozen = admission.make();
    if (Array.isArray(frozen.transitions)) Object.freeze(frozen.transitions);
    Object.freeze(frozen);
    const frozenResult = admission.call(frozen);
    admission.assertHardFalse(frozenResult);
  }
});

test('readonly required and partially readonly public roots fail instead of being normalized', () => {
  for (const admission of publicRootAdmissions()) {
    const readonly = admission.make();
    for (const key of Object.keys(readonly)) {
      Object.defineProperty(readonly, key, { writable: false, configurable: false });
    }
    assert.throws(
      () => admission.call(readonly),
      hasCode('field-descriptor-mode'),
      `${admission.name}: all readonly`,
    );

    const partial = admission.make();
    Object.defineProperty(partial, Object.keys(partial)[0], { writable: false });
    assert.throws(
      () => admission.call(partial),
      hasCode('field-descriptor-mode'),
      `${admission.name}: partially readonly`,
    );
  }
});

test('nonextensible mutable and pseudo-frozen public roots fail closed', () => {
  for (const admission of publicRootAdmissions()) {
    const nonextensible = admission.make();
    Object.preventExtensions(nonextensible);
    assert.throws(
      () => admission.call(nonextensible),
      hasCode('container-descriptor-mode'),
      `${admission.name}: preventExtensions mutable`,
    );

    const pseudoFrozen = admission.make();
    for (const key of Object.keys(pseudoFrozen)) {
      Object.defineProperty(pseudoFrozen, key, { writable: false, configurable: true });
    }
    Object.preventExtensions(pseudoFrozen);
    assert.equal(Object.isFrozen(pseudoFrozen), false);
    assert.throws(
      () => admission.call(pseudoFrozen),
      hasCode('container-descriptor-mode'),
      `${admission.name}: pseudo-frozen`,
    );
  }
});

test('every public root rejects Proxy and accessor containers before invoking traps or getters', () => {
  for (const admission of publicRootAdmissions()) {
    let trapCalls = 0;
    const proxy = new Proxy(admission.make(), {
      get() { trapCalls += 1; throw new Error('must not read'); },
      getOwnPropertyDescriptor() { trapCalls += 1; throw new Error('must not inspect'); },
      getPrototypeOf() { trapCalls += 1; throw new Error('must not inspect'); },
      isExtensible() { trapCalls += 1; throw new Error('must not inspect'); },
      ownKeys() { trapCalls += 1; throw new Error('must not inspect'); },
    });
    assert.throws(() => admission.call(proxy), hasCode('proxy-object'), admission.name);
    assert.equal(trapCalls, 0, admission.name);

    let getterCalls = 0;
    const accessor = admission.make();
    const key = Object.keys(accessor)[0];
    Object.defineProperty(accessor, key, {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error('must not invoke');
      },
    });
    assert.throws(() => admission.call(accessor), hasCode('accessor-property'), admission.name);
    assert.equal(getterCalls, 0, admission.name);
  }
});

test('transition root and snapshot Proxy values fail closed without invoking Proxy traps', () => {
  let rootCalls = 0;
  const root = new Proxy({}, {
    get() { rootCalls += 1; throw new Error('must not read'); },
    ownKeys() { rootCalls += 1; throw new Error('must not inspect'); },
  });
  assert.throws(() => attemptExternalGraphAuthorityTransition(root), hasCode('proxy-object'));
  assert.equal(rootCalls, 0);

  let snapshotCalls = 0;
  const snapshot = new Proxy(prerequisiteSnapshot(), {
    get() { snapshotCalls += 1; throw new Error('must not read'); },
    ownKeys() { snapshotCalls += 1; throw new Error('must not inspect'); },
  });
  assert.throws(
    () => attemptExternalGraphAuthorityTransition({
      prerequisiteSnapshot: snapshot,
      requestedTransition: 'authority-reference-bound',
    }),
    hasCode('authority-snapshot-proxy'),
  );
  assert.equal(snapshotCalls, 0);
});

test('nested eligibility report/input Proxy values fail closed without invoking Proxy traps', () => {
  const { report, inputs } = reportAndInputs();
  for (const [field, value, code] of [
    ['eligibilityReport', report, 'eligibility-report-proxy'],
    ['eligibilityInputs', inputs, 'eligibility-inputs-proxy'],
  ]) {
    let trapCalls = 0;
    const proxy = new Proxy(value, {
      get() { trapCalls += 1; throw new Error('must not read'); },
      ownKeys() { trapCalls += 1; throw new Error('must not inspect'); },
    });
    const request = { eligibilityReport: report, eligibilityInputs: inputs };
    request[field] = proxy;
    assert.throws(() => inspectExternalGraphAuthorityPrerequisites(request), hasCode(code));
    assert.equal(trapCalls, 0, field);
  }
});

test('tampered, stale and cross-baseline S4 reports fail recomputation before binding', () => {
  const { report, inputs } = reportAndInputs();
  const tampered = structuredClone(report);
  tampered.identities.current.graph = identity('f');
  assert.throws(
    () => inspectExternalGraphAuthorityPrerequisites({ eligibilityReport: tampered, eligibilityInputs: inputs }),
    hasCode('eligibility-report-recomputation-mismatch'),
  );

  const otherBaseline = externalLifecycle();
  otherBaseline.descriptor.clocks.sourceAsOf = '2026-08-10';
  const otherInputs = inputsFor(otherBaseline, externalLifecycle());
  assert.throws(
    () => inspectExternalGraphAuthorityPrerequisites({ eligibilityReport: report, eligibilityInputs: otherInputs }),
    hasCode('eligibility-report-recomputation-mismatch'),
  );
});

test('every baseline/current semantic axis and diff identity is bound by fresh S4 recomputation', () => {
  const axes = [
    'schema', 'source', 'licenseAttribution', 'coverage', 'fourClocks', 'mode',
    'topology', 'geometry', 'content', 'audit', 'graph',
  ];
  for (const side of ['baseline', 'current']) {
    for (const axis of axes) {
      const { report, inputs } = reportAndInputs();
      const stale = structuredClone(report);
      stale.identities[side][axis] = identity('d');
      assert.throws(
        () => inspectExternalGraphAuthorityPrerequisites({ eligibilityReport: stale, eligibilityInputs: inputs }),
        hasCode('eligibility-report-recomputation-mismatch'),
        `${side}.${axis}`,
      );
    }
  }
  const { report, inputs } = reportAndInputs();
  const staleDiff = structuredClone(report);
  staleDiff.identities.semanticDiff.identity = identity('e');
  assert.throws(
    () => inspectExternalGraphAuthorityPrerequisites({ eligibilityReport: staleDiff, eligibilityInputs: inputs }),
    hasCode('eligibility-report-recomputation-mismatch'),
  );
});

test('license, clock, coverage, topology, geometry, content, audit and diff drift changes bindings', () => {
  const first = prerequisiteSnapshot();
  const inputs = validInputs();
  inputs.currentLifecycle.descriptor.license.derivativeRedistribution = 'prohibited';
  inputs.currentLifecycle.descriptor.clocks.sourceAsOf = '2026-08-12';
  inputs.currentLifecycle.descriptor.coverage.routing.description = 'Changed routing coverage.';
  const raw = externalRawGraph();
  raw.features[0].coordinates[1][0] += 0.0001;
  raw.features[0].cost_integer += 1;
  inputs.currentLifecycle.normalization = normalizeRouteGraphCandidate(raw, inputs.currentLifecycle.profile);
  const secondReport = evaluateRouteGraphEligibility(inputsFor(
    inputs.baselineLifecycle,
    inputs.currentLifecycle,
  ));
  const second = inspectExternalGraphAuthorityPrerequisites({
    eligibilityReport: secondReport,
    eligibilityInputs: inputsFor(inputs.baselineLifecycle, inputs.currentLifecycle),
  });

  for (const key of [
    'licenseAttributionIdentity', 'coverageIdentity', 'clockIdentity', 'topologyIdentity',
    'geometryIdentity', 'contentIdentity', 'graphIdentity',
  ]) {
    assert.notEqual(second.currentGraphBinding[key], first.currentGraphBinding[key], key);
  }
  assert.match(second.currentGraphBinding.auditIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(
    second.eligibilityReportBinding.semanticDiffIdentity,
    first.eligibilityReportBinding.semanticDiffIdentity,
  );
});

test('JSON key order is identity-invariant while returned prerequisites remain deeply frozen', () => {
  const { report, inputs } = reportAndInputs();
  const reorderedReport = reverseObjectKeysDeep(report);
  const first = inspectExternalGraphAuthorityPrerequisites({ eligibilityReport: report, eligibilityInputs: inputs });
  const second = inspectExternalGraphAuthorityPrerequisites({ eligibilityReport: reorderedReport, eligibilityInputs: inputs });
  assert.deepEqual(second, first);
  assert.equal(second.snapshotIdentity, first.snapshotIdentity);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.currentGraphBinding.reasonCodes), true);
  assert.throws(() => { first.currentGraphBinding.bindingStatus = 'actual'; }, TypeError);
});

test('S3-1 receipt relabel cannot enter the S5 prerequisite path', () => {
  const baseline = externalLifecycle();
  const candidate = externalLifecycle();
  const receipt = createCandidateReceipt({ ...candidate, baseline, review: null });
  const inputs = validInputs();
  inputs.currentLifecycle = {
    descriptor: receipt.source,
    profile: receipt.profile,
    normalization: receipt.artifact,
  };
  assert.throws(() => evaluateRouteGraphEligibility(inputs), /schema mismatch|normalization-graph-required/);
  assert.notEqual(receipt.artifact.schema, 'GraphArtifact/v1');
});

test('synthetic full-sequence fixture exercises every transition without minting actual records', () => {
  const trace = simulateSyntheticAuthorityStateMachine(fullSequenceFixture);
  assert.equal(trace.finalState, 'publication-authorized');
  assert.equal(trace.transitionCount, AUTHORITY_TRANSITION_SEQUENCE.length);
  assert.equal(trace.syntheticOnly, true);
  assert.equal(trace.actualAdmission, false);
  assert.equal(trace.productMaterialized, false);
  assert.equal(trace.sourceHealthUpdateAuthorized, false);
  assert.equal(trace.redistributionAuthorized, false);
  assert.equal(trace.publicAccessAuthorized, false);
  assert.equal(trace.publicationAuthorized, false);
  assert.equal(trace.productConsumable, false);
  assert.deepEqual(trace.observations.map((item) => item.toState), AUTHORITY_TRANSITION_SEQUENCE);
  for (const observation of trace.observations) {
    assert.equal(observation.syntheticOnly, true);
    assert.equal(observation.actual, false);
    assert.equal(observation.authorityVerified, false);
    assert.equal(observation.productConsumable, false);
    assert.equal(observation.mintedActualArtifactIdentity, null);
  }
});

test('synthetic prerequisite prefix stops before actual admission and preserves separate artifact expectations', () => {
  const trace = simulateSyntheticAuthorityStateMachine(prerequisitePrefixFixture);
  assert.equal(trace.finalState, 'eligibility-report-bound');
  assert.equal(trace.transitionCount, 5);
  assert.deepEqual(trace.observations.map((item) => item.expectedActualArtifactSchema), [
    AUTHORITY_REFERENCE_BINDING_SCHEMA,
    AUTHORITY_REGISTRY_BINDING_SCHEMA,
    GRAPH_BASELINE_BINDING_SCHEMA,
    GRAPH_CURRENT_BINDING_SCHEMA,
    ELIGIBILITY_REPORT_BINDING_SCHEMA,
  ]);
  assert.equal(trace.observations.some((item) => item.expectedActualArtifactSchema === ACTUAL_ADMISSION_RECORD_SCHEMA), false);
});

test('synthetic skip, replay, legacy schema and actual-authority relabel attempts fail closed', () => {
  const skip = structuredClone(fullSequenceFixture);
  skip.transitions.splice(1, 1);
  assert.throws(() => simulateSyntheticAuthorityStateMachine(skip), hasCode('authority-transition-order'));

  const replay = structuredClone(prerequisitePrefixFixture);
  replay.transitions.splice(2, 0, replay.transitions[1]);
  assert.throws(() => simulateSyntheticAuthorityStateMachine(replay), hasCode('authority-transition-order'));

  const legacy = structuredClone(fullSequenceFixture);
  legacy.schema = 'route-graph-authority-state-machine-fixture/v0';
  assert.throws(() => simulateSyntheticAuthorityStateMachine(legacy), hasCode('synthetic-fixture-schema-unsupported'));

  const relabel = structuredClone(fullSequenceFixture);
  relabel.authorityKind = 'trusted-registry';
  assert.throws(() => simulateSyntheticAuthorityStateMachine(relabel), hasCode('synthetic-fixture-authority-kind'));
});

test('synthetic cross-baseline reuse changes every transition observation and trace identity', () => {
  const first = simulateSyntheticAuthorityStateMachine(fullSequenceFixture);
  const changed = structuredClone(fullSequenceFixture);
  changed.baselineIdentity = identity('9');
  const second = simulateSyntheticAuthorityStateMachine(changed);
  assert.notEqual(second.traceIdentity, first.traceIdentity);
  assert.equal(second.observations.length, first.observations.length);
  for (let index = 0; index < first.observations.length; index += 1) {
    assert.notEqual(second.observations[index].observationIdentity, first.observations[index].observationIdentity);
  }
});

test('synthetic root Proxy/getter/unknown fields and returned trace tampering fail closed', () => {
  let trapCalls = 0;
  const proxy = new Proxy(fullSequenceFixture, {
    get() { trapCalls += 1; throw new Error('must not read'); },
    ownKeys() { trapCalls += 1; throw new Error('must not inspect'); },
  });
  assert.throws(() => simulateSyntheticAuthorityStateMachine(proxy), hasCode('proxy-object'));
  assert.equal(trapCalls, 0);

  let getterCalls = 0;
  const getter = structuredClone(fullSequenceFixture);
  Object.defineProperty(getter, 'fixtureId', {
    enumerable: true,
    get() { getterCalls += 1; return 'forged'; },
  });
  assert.throws(() => simulateSyntheticAuthorityStateMachine(getter), hasCode('accessor-property'));
  assert.equal(getterCalls, 0);

  const unknown = structuredClone(fullSequenceFixture);
  unknown.actualAdmission = true;
  assert.throws(() => simulateSyntheticAuthorityStateMachine(unknown), hasCode('schema-mismatch'));

  const trace = simulateSyntheticAuthorityStateMachine(fullSequenceFixture);
  assert.equal(Object.isFrozen(trace), true);
  assert.equal(Object.isFrozen(trace.observations), true);
  assert.equal(Object.isFrozen(trace.observations[0]), true);
  assert.throws(() => { trace.observations[0].actual = true; }, TypeError);
});

test('synthetic transition arrays reject Proxy, sparse and nonstandard descriptors without executing traps', () => {
  let trapCalls = 0;
  const proxied = structuredClone(fullSequenceFixture);
  proxied.transitions = new Proxy(proxied.transitions, {
    get() { trapCalls += 1; throw new Error('must not read'); },
    ownKeys() { trapCalls += 1; throw new Error('must not inspect'); },
  });
  assert.throws(
    () => simulateSyntheticAuthorityStateMachine(proxied),
    hasCode('proxy-object'),
  );
  assert.equal(trapCalls, 0);

  const sparse = structuredClone(prerequisitePrefixFixture);
  delete sparse.transitions[1];
  assert.throws(
    () => simulateSyntheticAuthorityStateMachine(sparse),
    hasCode('array-index-descriptor-mode'),
  );

  const readonly = structuredClone(prerequisitePrefixFixture);
  Object.defineProperty(readonly.transitions, '0', { writable: false });
  assert.throws(
    () => simulateSyntheticAuthorityStateMachine(readonly),
    hasCode('array-index-descriptor-mode'),
  );
});

test('synthetic transition array mode must match its public root mode', () => {
  const mutableRootFrozenArray = structuredClone(prerequisitePrefixFixture);
  Object.freeze(mutableRootFrozenArray.transitions);
  assert.throws(
    () => simulateSyntheticAuthorityStateMachine(mutableRootFrozenArray),
    hasCode('container-mode-mismatch'),
  );

  const frozenRootMutableArray = structuredClone(prerequisitePrefixFixture);
  Object.freeze(frozenRootMutableArray);
  assert.throws(
    () => simulateSyntheticAuthorityStateMachine(frozenRootMutableArray),
    hasCode('container-mode-mismatch'),
  );

  const nonextensibleArray = structuredClone(prerequisitePrefixFixture);
  Object.preventExtensions(nonextensibleArray.transitions);
  assert.throws(
    () => simulateSyntheticAuthorityStateMachine(nonextensibleArray),
    hasCode('container-descriptor-mode'),
  );
});

test('synthetic transition array accessors fail without invoking getters', () => {
  let getterCalls = 0;
  const fixture = structuredClone(prerequisitePrefixFixture);
  Object.defineProperty(fixture.transitions, '0', {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      return 'authority-reference-bound';
    },
  });
  assert.throws(
    () => simulateSyntheticAuthorityStateMachine(fixture),
    hasCode('array-index-descriptor-mode'),
  );
  assert.equal(getterCalls, 0);
});

test('no production or synthetic API returns an actual product artifact schema as minted', () => {
  const result = attemptExternalGraphAuthorityTransition({
    prerequisiteSnapshot: prerequisiteSnapshot(),
    requestedTransition: 'authority-reference-bound',
  });
  const trace = simulateSyntheticAuthorityStateMachine(fullSequenceFixture);
  assert.equal(result.mintedArtifactSchema, null);
  assert.equal(result.mintedArtifactIdentity, null);
  assert.equal(
    trace.observations.some((observation) => observation.mintedActualArtifactIdentity !== null),
    false,
  );
  assert.equal(JSON.stringify({ result, trace }).includes('"actual":true'), false);
  assert.equal(JSON.stringify({ result, trace }).includes('"actualAdmission":true'), false);
});

test('legacy authority, admission, promotion and GraphArtifact minting APIs are absent', () => {
  for (const name of [
    'createTrustedAuthority',
    'admitAuthorityRegistry',
    'mintActualAdmission',
    'materializeProductGraph',
    'promoteRouteGraph',
    'updateSourceHealth',
    'createGraphArtifact',
    'admitPublicDataObject',
    'admitPublicDataArray',
  ]) {
    assert.equal(name in authorityApi, false, name);
  }
});

function prerequisiteSnapshot() {
  const { report, inputs } = reportAndInputs();
  return inspectExternalGraphAuthorityPrerequisites({ eligibilityReport: report, eligibilityInputs: inputs });
}

function publicRootAdmissions() {
  return [
    {
      name: 'inspectExternalGraphAuthorityPrerequisites',
      make() {
        const { report, inputs } = reportAndInputs();
        return { eligibilityReport: report, eligibilityInputs: inputs };
      },
      call: inspectExternalGraphAuthorityPrerequisites,
      assertHardFalse(snapshot) {
        assert.equal(snapshot.actualAdmission, false);
        assert.equal(snapshot.gates, undefined);
        assert.equal(snapshot.eligibilityReportBinding.actualAdmission, false);
      },
    },
    {
      name: 'attemptExternalGraphAuthorityTransition',
      make() {
        return {
          prerequisiteSnapshot: prerequisiteSnapshot(),
          requestedTransition: 'authority-reference-bound',
        };
      },
      call: attemptExternalGraphAuthorityTransition,
      assertHardFalse(result) {
        assert.equal(result.transitioned, false);
        assert.equal(result.actualAdmission, false);
        assert.equal(result.productMaterialized, false);
        assert.equal(result.sourceHealthUpdateAuthorized, false);
      },
    },
    {
      name: 'simulateSyntheticAuthorityStateMachine',
      make() {
        return structuredClone(prerequisitePrefixFixture);
      },
      call: simulateSyntheticAuthorityStateMachine,
      assertHardFalse(trace) {
        assert.equal(trace.syntheticOnly, true);
        assert.equal(trace.actualAdmission, false);
        assert.equal(trace.productConsumable, false);
      },
    },
  ];
}

function reportAndInputs() {
  const inputs = validInputs();
  return { report: evaluateRouteGraphEligibility(inputs), inputs };
}

function validInputs() {
  return inputsFor(externalLifecycle(), externalLifecycle());
}

function inputsFor(baselineLifecycle, currentLifecycle) {
  const inspected = inspectRouteGraphEligibilityEvidence({ baselineLifecycle, currentLifecycle });
  const callerSuppliedPolicy = structuredClone(authorityPolicyFixture);
  callerSuppliedPolicy.baselineAllowlist = [inspected.baseline.graph];
  const reviewEvidence = [
    'semantic-review',
    'product-approval',
    'redistribution-review',
    'public-approval',
    'publication-review',
  ].map((scope, index) => ({
    ...structuredClone(reviewTemplateFixture),
    schema: CALLER_SUPPLIED_REVIEW_ASSERTION_SCHEMA,
    reviewId: `synthetic-${scope}-${index}`,
    scope,
    baselineIdentity: inspected.baseline.graph,
    currentGraphIdentity: inspected.current.graph,
    semanticDiffIdentity: inspected.semanticDiff.identity,
  }));
  return {
    baselineLifecycle,
    currentLifecycle,
    callerSuppliedPolicy,
    reviewEvidence,
    promotionIntent: structuredClone(promotionIntentFixture),
  };
}

function externalLifecycle() {
  const descriptor = structuredClone(sourceDescriptorFixture);
  descriptor.sourceId = 'synthetic-city-fixture';
  descriptor.sourceKind = 'city';
  descriptor.license.internalCandidateUse = 'allowed';
  descriptor.license.derivativeRedistribution = 'allowed-with-conditions';
  descriptor.attribution = {
    required: true,
    text: 'Synthetic City route graph fixture',
    url: 'https://example.invalid/synthetic-city/attribution',
  };
  descriptor.clocks.sourceAsOf = '2026-08-11';
  descriptor.limitations = ['Synthetic fixture shaped as external data; it is not acquired or admitted real data.'];
  const profile = structuredClone(modeProfileFixture);
  profile.profileId = 'synthetic-city-walking-v1';
  profile.sourceKind = 'city';
  return { descriptor, profile, normalization: normalizeRouteGraphCandidate(externalRawGraph(), profile) };
}

function externalRawGraph() {
  const raw = structuredClone(rawGraphFixture);
  raw.sourceId = 'synthetic-city-fixture';
  raw.sourceKind = 'city';
  return raw;
}

function reverseObjectKeysDeep(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeysDeep);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).reverse().map(([key, entry]) => [key, reverseObjectKeysDeep(entry)]),
  );
}

function identity(character) {
  return `sha256:${character.repeat(64)}`;
}

function hasCode(code) {
  return (error) => error?.code === code;
}

async function candidateFixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/route_graph_candidate/${name}`, import.meta.url), 'utf8'));
}

async function admissionFixture(name) {
  return JSON.parse(await readFile(new URL(`../fixtures/route-graph-admission-s4/${name}`, import.meta.url), 'utf8'));
}

async function authorityFixture(name) {
  return JSON.parse(await readFile(new URL(`../fixtures/route-graph-authority-s5/${name}`, import.meta.url), 'utf8'));
}
