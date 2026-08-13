#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ROUTE_DECISION_SCHEMA_VERSIONS,
  UNRESOLVED_OBSERVATION_STATES,
} from '../../src/route_decision/contracts/index.js';
import {
  ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS,
  ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
  ROUTE_SEARCH_DISTINCTNESS_VERSION,
  ROUTE_SEARCH_TIE_BREAK_VERSION,
  ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES,
} from '../../src/route_decision/contracts/candidate_search_v2.js';
import {
  CITY_ADAPTER_SCHEMA_VERSIONS,
  PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
  adaptPhiladelphiaSyntheticGraph,
} from '../../src/route_generation/city_adapter/index.js';
import {
  CITY_CAPABILITY_TO_SOURCE_OBSERVATION_MAPPING_V1,
  CITY_CAPABILITY_TO_SOURCE_OBSERVATION_MAPPING_VERSION,
  CITY_ROUTE_DECISION_BINDING_IDENTITY_VERSION,
  CITY_ROUTE_DECISION_BINDING_VERSION,
  ROUTE_DECISION_INTEGRATION_RUN_IDENTITY_VERSION,
  ROUTE_DECISION_INTEGRATION_RUN_VERSION,
  admitCityRouteDecisionBinding,
  admitRouteDecisionIntegrationRun,
  buildCityRouteDecisionBinding,
  buildRouteDecisionIntegrationRun,
} from '../../src/route_decision/integration/index.js';

const FIXTURE_URL = new URL(
  '../fixtures/route-s5-integration/synthetic_city_source.json',
  import.meta.url,
);
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreezeData(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreezeData(descriptor.value, seen);
  }
  return Object.freeze(value);
}

async function sourceFixture() {
  return JSON.parse(await readFile(FIXTURE_URL, 'utf8'));
}

function adaptation(source, adapter = PHILADELPHIA_SYNTHETIC_CITY_ADAPTER) {
  return adaptPhiladelphiaSyntheticGraph(source, adapter);
}

function binding(source, adapter = PHILADELPHIA_SYNTHETIC_CITY_ADAPTER) {
  return buildCityRouteDecisionBinding({
    sourceGraph: source,
    cityAdapter: adapter,
    cityAdaptationResult: adaptation(source, adapter),
  });
}

function searchConstraint(factorId) {
  return {
    constraintId: `requires-${factorId}`,
    factorId,
    locality: 'edge-local',
    edgeEvidenceRequirement: 'complete',
    operator: 'equals',
    expectedValue: true,
    routeAggregation: 'every-directed-edge',
    aggregationVersion: ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
    unresolvedStates: [...ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES],
    unresolvedDisposition: 'exclude-and-report',
  };
}

function policyConstraint(factorId) {
  return {
    constraintId: `requires-${factorId}`,
    needTag: 'require-capability',
    factorId,
    operator: 'equals',
    expectedValue: true,
    unresolvedStates: [...UNRESOLVED_OBSERVATION_STATES],
  };
}

function requestFor(cityBinding, {
  factorIds = ['step-free'],
  originNodeId = 'node-a',
  destinationNodeId = 'node-b',
  requestedCandidateCount = 1,
  maxExpandedStates = 100,
  maxRouteEdgeCount = 4,
} = {}) {
  const graph = cityBinding.cityAdaptationResult.graphArtifact;
  return {
    schemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchRequest,
    requestId: 's5-integration-request',
    graphId: graph.graphId,
    mode: graph.mode,
    originNodeId,
    destinationNodeId,
    decisionPolicyId: 's5-integration-policy',
    objectiveFactorId: 'objective-cost-units',
    requestedCandidateCount,
    routeDistinctnessVersion: ROUTE_SEARCH_DISTINCTNESS_VERSION,
    tieBreakVersion: ROUTE_SEARCH_TIE_BREAK_VERSION,
    bounds: { maxExpandedStates, maxRouteEdgeCount },
    hardConstraints: factorIds.map(searchConstraint),
  };
}

function policyFor(factorIds = ['step-free']) {
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.decisionPolicy,
    policyId: 's5-integration-policy',
    hardConstraints: factorIds.map(policyConstraint),
    softPreferences: [{
      preferenceId: 'prefer-shorter-distance',
      needTag: 'minimize-distance',
      factorId: 'distance-mm',
      operator: 'minimize',
      rangeMin: 0,
      rangeMax: 10_000,
      weightBasisPoints: 10_000,
    }],
    weightBasisPointsTotal: 10_000,
    tieBreak: [
      { factorId: 'score-units', direction: 'descending' },
      { factorId: 'distance-mm', direction: 'ascending' },
      { factorId: 'candidate-id', direction: 'ascending' },
    ],
  };
}

function run(cityBinding, requestOptions = {}, factorIds = requestOptions.factorIds ?? ['step-free']) {
  return buildRouteDecisionIntegrationRun({
    binding: cityBinding,
    searchRequest: requestFor(cityBinding, { ...requestOptions, factorIds }),
    decisionPolicy: policyFor(factorIds),
  });
}

test('version matrix freezes typed binding, mapping, run, and identities', () => {
  assert.equal(CITY_ROUTE_DECISION_BINDING_VERSION, 'engagement-city-route-decision-binding/v1');
  assert.equal(
    CITY_ROUTE_DECISION_BINDING_IDENTITY_VERSION,
    'engagement-city-route-decision-binding-identity/v1',
  );
  assert.equal(
    CITY_CAPABILITY_TO_SOURCE_OBSERVATION_MAPPING_VERSION,
    'engagement-city-capability-to-source-observation-mapping/v1',
  );
  assert.equal(ROUTE_DECISION_INTEGRATION_RUN_VERSION, 'engagement-route-decision-integration-run/v1');
  assert.equal(
    ROUTE_DECISION_INTEGRATION_RUN_IDENTITY_VERSION,
    'engagement-route-decision-integration-run-identity/v1',
  );
  assert.deepEqual(CITY_CAPABILITY_TO_SOURCE_OBSERVATION_MAPPING_V1.factorIds, [
    'step-free', 'curb-ramp-present', 'paved-surface',
  ]);
  assert.equal(CITY_CAPABILITY_TO_SOURCE_OBSERVATION_MAPPING_V1.aliases, 'forbidden');
});

test('binding re-admits original source, exact CityAdapter/v2, and supplied recomputation', async () => {
  const source = await sourceFixture();
  const result = binding(source);
  assert.equal(result.schemaVersion, CITY_ROUTE_DECISION_BINDING_VERSION);
  assert.equal(result.cityAdapter.schemaVersion, CITY_ADAPTER_SCHEMA_VERSIONS.cityAdapter);
  assert.equal(result.cityAdaptationResult.schemaVersion, CITY_ADAPTER_SCHEMA_VERSIONS.adaptationResult);
  assert.equal(result.provenance.graphArtifactVersion, result.cityAdaptationResult.graphArtifact.receipt.artifactVersion);
  assert.equal(result.provenance.cityAdapterContentIdentity.digest, result.cityAdapter.adapterContentIdentity.digest);
  assert.equal(Object.isFrozen(result.edgeObservationsByEdgeId), true);
  assert.deepEqual(result, admitCityRouteDecisionBinding(result));
});

test('capability mapping is explicit and preserves observed, unknown, and unavailable truth', async () => {
  const result = binding(await sourceFixture());
  const forwardA = result.edgeObservationsByEdgeId['edge-a:forward'];
  const forwardB = result.edgeObservationsByEdgeId['edge-b:forward'];
  assert.deepEqual(
    [forwardA['step-free'].state, forwardA['step-free'].value, forwardA['step-free'].reasonCode],
    ['observed', true, null],
  );
  assert.deepEqual(
    [forwardA['curb-ramp-present'].state, forwardA['curb-ramp-present'].value,
      forwardA['curb-ramp-present'].reasonCode],
    ['unknown', null, 'not-observed'],
  );
  assert.deepEqual(
    [forwardB['step-free'].state, forwardB['step-free'].value, forwardB['step-free'].reasonCode],
    ['unavailable', null, 'source-unavailable'],
  );
  assert.equal(result.mappingTrace.length, result.cityAdaptationResult.graphArtifact.edges.length * 3);
  assert.equal(result.mappingTrace.every(({ cityObservation, sourceObservation }) => (
    cityObservation.sourceId === sourceObservation.sourceId
  )), true);
});

test('legacy V1, bare graph artifact, and opaque artifactVersion cannot become CityAdapter provenance', async () => {
  const source = await sourceFixture();
  const cityResult = adaptation(source);
  const oldAdapter = clone(PHILADELPHIA_SYNTHETIC_CITY_ADAPTER);
  oldAdapter.schemaVersion = 'engagement-city-adapter/v1';
  oldAdapter.adapterVersion = 'philadelphia-synthetic-city-adapter/v1';
  assert.throws(() => buildCityRouteDecisionBinding({
    sourceGraph: source,
    cityAdapter: oldAdapter,
    cityAdaptationResult: cityResult,
  }), /CityAdapter|Binding/);
  assert.throws(() => buildCityRouteDecisionBinding({
    graphArtifact: cityResult.graphArtifact,
    artifactVersion: cityResult.graphArtifact.receipt.artifactVersion,
    cityAdaptationResult: cityResult,
  }), /schema mismatch/);
});

test('wrong source/result combinations, capability aliases, and missing edge coverage fail closed', async () => {
  const source = await sourceFixture();
  const cityResult = adaptation(source);
  const changedSource = clone(source);
  changedSource.edges[0].objectiveCostUnits += 1;
  assert.throws(() => buildCityRouteDecisionBinding({
    sourceGraph: changedSource,
    cityAdapter: PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
    cityAdaptationResult: cityResult,
  }), /recomputation/);

  const alias = clone(cityResult);
  alias.edgeCapabilityObservations[0].observations[0].capabilityId = 'stepfree';
  assert.throws(() => buildCityRouteDecisionBinding({
    sourceGraph: source,
    cityAdapter: PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
    cityAdaptationResult: alias,
  }), /recomputation|capability/);

  const missing = clone(cityResult);
  missing.edgeCapabilityObservations.pop();
  assert.throws(() => buildCityRouteDecisionBinding({
    sourceGraph: source,
    cityAdapter: PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
    cityAdaptationResult: missing,
  }), /recomputation|coverage/);
});

test('source collection permutation preserves identities while real content mutation propagates', async () => {
  const source = await sourceFixture();
  const first = binding(source);
  const permutedSource = clone(source);
  permutedSource.nodes.reverse();
  permutedSource.edges.reverse();
  const permuted = binding(permutedSource);
  assert.equal(permuted.bindingIdentity.digest, first.bindingIdentity.digest);
  assert.equal(
    permuted.cityAdaptationResult.graphArtifact.receipt.artifactVersion,
    first.cityAdaptationResult.graphArtifact.receipt.artifactVersion,
  );

  const changedSource = clone(source);
  changedSource.edges[0].objectiveCostUnits += 1;
  const changed = binding(changedSource);
  assert.notEqual(changed.bindingIdentity.digest, first.bindingIdentity.digest);
  assert.notEqual(
    changed.cityAdaptationResult.graphArtifact.receipt.artifactVersion,
    first.cityAdaptationResult.graphArtifact.receipt.artifactVersion,
  );
});

test('deterministic run binds search, S2 evaluation, explanation, and presentation revisions', async () => {
  const cityBinding = binding(await sourceFixture());
  const result = run(cityBinding);
  assert.equal(result.schemaVersion, ROUTE_DECISION_INTEGRATION_RUN_VERSION);
  assert.equal(result.searchResult.termination, 'requested-candidate-count-reached');
  assert.equal(result.decisionEvaluation.evaluation.status, 'evaluated');
  assert.equal(result.presentation.textComplete, true);
  assert.equal(result.revisions.exactMatch, true);
  assert.equal(result.revisions.graphArtifactVersion, result.revisions.candidateSetRevision);
  assert.equal(result.revisions.graphArtifactVersion, result.revisions.explanationInputRevision);
  assert.deepEqual(result.claimBoundary.eligibleClaims, [
    'deterministic-execution-for-exact-admitted-inputs',
  ]);
  assert.equal(result.claimBoundary.limitations.includes('not-performance-authority'), true);
  assert.equal(result.claimBoundary.limitations.includes('not-safety-or-safer-route-advice'), true);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(run(cityBinding), result);
});

test('unknown and unavailable remain unresolved and never become false or no-feasible proof', async () => {
  const cityBinding = binding(await sourceFixture());
  const unknown = run(cityBinding, { factorIds: ['curb-ramp-present'] });
  assert.equal(unknown.searchResult.termination, 'unresolved-constraint-evidence');
  assert.equal(unknown.truth.constraintOutcome, 'unresolved-evidence');
  assert.equal(unknown.truth.boundedNoEligibleRouteProven, false);

  const unavailable = run(cityBinding, {
    factorIds: ['step-free'],
    destinationNodeId: 'node-c',
  });
  assert.equal(unavailable.searchResult.termination, 'unresolved-constraint-evidence');
  assert.equal(unavailable.truth.constraintOutcome, 'unresolved-evidence');
  assert.equal(unavailable.truth.boundedNoEligibleRouteProven, false);
});

test('known false can prove bounded no-eligible while missing coverage is rejected before a run exists', async () => {
  const source = await sourceFixture();
  const cityBinding = binding(source);
  const knownFalse = run(cityBinding, { factorIds: ['paved-surface'] });
  assert.equal(knownFalse.searchResult.termination, 'no-eligible-route-in-bounded-scope');
  assert.equal(knownFalse.truth.boundedNoEligibleRouteProven, true);
  assert.equal(knownFalse.truth.missingCoverageAccepted, false);

  const missing = clone(cityBinding);
  delete missing.edgeObservationsByEdgeId['edge-a:forward']['paved-surface'];
  assert.throws(() => buildRouteDecisionIntegrationRun({
    binding: missing,
    searchRequest: requestFor(cityBinding, { factorIds: ['paved-surface'] }),
    decisionPolicy: policyFor(['paved-surface']),
  }), /full recomputation/);
});

test('stopped search reports termination, partial, stopped, and incomplete truth without upgrading claims', async () => {
  const cityBinding = binding(await sourceFixture());
  const stopped = run(cityBinding, {
    factorIds: [],
    destinationNodeId: 'node-c',
    maxExpandedStates: 1,
  }, []);
  assert.equal(stopped.searchResult.termination, 'search-budget-exhausted');
  assert.equal(stopped.truth.stopped, true);
  assert.equal(stopped.truth.partial, true);
  assert.equal(stopped.truth.incomplete, true);
  assert.equal(stopped.truth.boundedNoEligibleRouteProven, false);
  assert.equal(stopped.explanation.explanation.limitations.includes('route-search-stopped'), true);
  assert.equal(
    stopped.explanation.explanation.limitations.includes('route-search-completeness-not-proven'),
    true,
  );
});

test('semantic policy and source set permutations keep run identity stable', async () => {
  const source = await sourceFixture();
  const firstBinding = binding(source);
  const factorIds = ['step-free', 'curb-ramp-present'];
  const request = requestFor(firstBinding, { factorIds });
  const firstPolicy = policyFor(factorIds);
  const first = buildRouteDecisionIntegrationRun({
    binding: firstBinding,
    searchRequest: request,
    decisionPolicy: firstPolicy,
  });

  const permutedSource = clone(source);
  permutedSource.nodes.reverse();
  permutedSource.edges.reverse();
  const permutedBinding = binding(permutedSource);
  const permutedRequest = requestFor(permutedBinding, { factorIds: [...factorIds].reverse() });
  const permutedPolicy = policyFor([...factorIds].reverse());
  const permuted = buildRouteDecisionIntegrationRun({
    binding: permutedBinding,
    searchRequest: permutedRequest,
    decisionPolicy: permutedPolicy,
  });
  assert.equal(permuted.runIdentity.digest, first.runIdentity.digest);
});

test('content mutation propagates through binding, graph, CandidateSet, Explanation, and run identities', async () => {
  const source = await sourceFixture();
  const firstBinding = binding(source);
  const first = run(firstBinding);
  const changedSource = clone(source);
  changedSource.edges[0].objectiveCostUnits += 1;
  const changedBinding = binding(changedSource);
  const changed = run(changedBinding);
  assert.notEqual(changedBinding.bindingIdentity.digest, firstBinding.bindingIdentity.digest);
  assert.notEqual(changed.revisions.graphArtifactVersion, first.revisions.graphArtifactVersion);
  assert.notEqual(changed.revisions.candidateSetRevision, first.revisions.candidateSetRevision);
  assert.notEqual(changed.revisions.explanationInputRevision, first.revisions.explanationInputRevision);
  assert.notEqual(changed.runIdentity.digest, first.runIdentity.digest);
});

test('JSON round-trip succeeds only after full binding and run recomputation', async () => {
  const cityBinding = binding(await sourceFixture());
  const result = run(cityBinding);
  assert.deepEqual(
    admitCityRouteDecisionBinding(JSON.parse(JSON.stringify(cityBinding))),
    cityBinding,
  );
  assert.deepEqual(
    admitRouteDecisionIntegrationRun(JSON.parse(JSON.stringify(result))),
    result,
  );

  const forgedBinding = clone(cityBinding);
  forgedBinding.bindingIdentity.digest = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => admitCityRouteDecisionBinding(forgedBinding), /full recomputation/);
  const forgedRun = clone(result);
  forgedRun.runIdentity.digest = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => admitRouteDecisionIntegrationRun(forgedRun), /full binding/);
  const tamperedTruth = clone(result);
  tamperedTruth.truth.boundedNoEligibleRouteProven = true;
  assert.throws(() => admitRouteDecisionIntegrationRun(tamperedTruth), /full binding/);
  const tamperedTermination = clone(result);
  tamperedTermination.searchResult.termination = 'bounded-search-space-exhausted';
  assert.throws(() => admitRouteDecisionIntegrationRun(tamperedTermination), /full binding/);
  const tamperedCandidateRevision = clone(result);
  tamperedCandidateRevision.searchResult.candidateSet.candidateSetRevision = 'forged-revision';
  assert.throws(() => admitRouteDecisionIntegrationRun(tamperedCandidateRevision), /full binding/);
  const tamperedExplanationRevision = clone(result);
  tamperedExplanationRevision.explanation.inputIdentity.candidateSetRevision = 'forged-revision';
  assert.throws(() => admitRouteDecisionIntegrationRun(tamperedExplanationRevision), /full binding/);
});

test('Proxy, getter, mixed descriptors, and forged outer identity fail closed', async () => {
  const source = await sourceFixture();
  const cityResult = adaptation(source);
  const validInput = {
    sourceGraph: source,
    cityAdapter: PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
    cityAdaptationResult: cityResult,
  };
  assert.throws(() => buildCityRouteDecisionBinding(new Proxy(validInput, {})), /Proxy/);

  const getterSource = clone(source);
  Object.defineProperty(getterSource.nodes[0], 'xMm', {
    enumerable: true,
    configurable: true,
    get() { return 0; },
  });
  assert.throws(() => buildCityRouteDecisionBinding({
    sourceGraph: getterSource,
    cityAdapter: PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
    cityAdaptationResult: cityResult,
  }), /data property/);

  const mixed = clone(source);
  Object.preventExtensions(mixed.nodes[0]);
  assert.throws(() => buildCityRouteDecisionBinding({
    sourceGraph: mixed,
    cityAdapter: PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
    cityAdaptationResult: cityResult,
  }), /either extensible mutable data or fully frozen data/);

  const cityBinding = binding(source);
  const forged = clone(cityBinding);
  forged.provenance.graphArtifactVersion = 'opaque-artifact-version';
  assert.throws(() => admitCityRouteDecisionBinding(forged), /full recomputation/);

  const validRunInput = {
    binding: cityBinding,
    searchRequest: requestFor(cityBinding),
    decisionPolicy: policyFor(),
  };
  assert.throws(() => buildRouteDecisionIntegrationRun(new Proxy(validRunInput, {})), /Proxy/);
  const getterRequest = requestFor(cityBinding);
  Object.defineProperty(getterRequest, 'destinationNodeId', {
    enumerable: true,
    configurable: true,
    get() { return 'node-b'; },
  });
  assert.throws(() => buildRouteDecisionIntegrationRun({
    binding: cityBinding,
    searchRequest: getterRequest,
    decisionPolicy: policyFor(),
  }), /data property/);
});

test('array descriptor admission is exact for mutable, frozen, and hostile modes', async (t) => {
  await t.test('extensible array with readonly non-empty length is rejected', async () => {
    const source = await sourceFixture();
    const cityResult = adaptation(source);
    Object.defineProperty(source.nodes, 'length', { writable: false });
    assert.equal(Object.isExtensible(source.nodes), true);
    assert.throws(() => buildCityRouteDecisionBinding({
      sourceGraph: source,
      cityAdapter: PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
      cityAdaptationResult: cityResult,
    }), /length descriptor.*mutable array mode/);
  });

  await t.test('extensible empty array with readonly length is rejected', async () => {
    const source = await sourceFixture();
    source.edges = [];
    const cityResult = adaptation(source);
    Object.defineProperty(source.edges, 'length', { writable: false });
    assert.equal(source.edges.length, 0);
    assert.equal(Object.isExtensible(source.edges), true);
    assert.throws(() => buildCityRouteDecisionBinding({
      sourceGraph: source,
      cityAdapter: PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
      cityAdaptationResult: cityResult,
    }), /length descriptor.*mutable array mode/);
  });

  await t.test('mutable array with readonly index is rejected', async () => {
    const source = await sourceFixture();
    const cityResult = adaptation(source);
    Object.defineProperty(source.nodes, '0', { writable: false });
    assert.equal(Object.isExtensible(source.nodes), true);
    assert.throws(() => buildCityRouteDecisionBinding({
      sourceGraph: source,
      cityAdapter: PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
      cityAdaptationResult: cityResult,
    }), /nodes\.0 descriptor does not match the mutable container mode/);
  });

  await t.test('preventExtensions but not frozen array is rejected', async () => {
    const source = await sourceFixture();
    const cityResult = adaptation(source);
    Object.preventExtensions(source.nodes);
    assert.equal(Object.isFrozen(source.nodes), false);
    assert.throws(() => buildCityRouteDecisionBinding({
      sourceGraph: source,
      cityAdapter: PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
      cityAdaptationResult: cityResult,
    }), /either extensible mutable data or fully frozen data/);
  });

  await t.test('standard mutable arrays are accepted', async () => {
    const source = await sourceFixture();
    const cityResult = clone(adaptation(source));
    const mutableAdapter = clone(PHILADELPHIA_SYNTHETIC_CITY_ADAPTER);
    const result = buildCityRouteDecisionBinding({
      sourceGraph: source,
      cityAdapter: mutableAdapter,
      cityAdaptationResult: cityResult,
    });
    assert.equal(result.schemaVersion, CITY_ROUTE_DECISION_BINDING_VERSION);
  });

  await t.test('complete deeply frozen arrays and input are accepted', async () => {
    const source = await sourceFixture();
    const input = deepFreezeData({
      sourceGraph: source,
      cityAdapter: clone(PHILADELPHIA_SYNTHETIC_CITY_ADAPTER),
      cityAdaptationResult: clone(adaptation(source)),
    });
    const result = buildCityRouteDecisionBinding(input);
    assert.equal(result.schemaVersion, CITY_ROUTE_DECISION_BINDING_VERSION);
  });

  await t.test('Proxy and getter traps are never invoked', async () => {
    const source = await sourceFixture();
    const cityResult = adaptation(source);
    let proxyTrapCalls = 0;
    const proxyInput = new Proxy({
      sourceGraph: source,
      cityAdapter: PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
      cityAdaptationResult: cityResult,
    }, {
      getPrototypeOf() { proxyTrapCalls += 1; return Object.prototype; },
      ownKeys() { proxyTrapCalls += 1; return []; },
      getOwnPropertyDescriptor() { proxyTrapCalls += 1; return undefined; },
      isExtensible() { proxyTrapCalls += 1; return true; },
    });
    assert.throws(() => buildCityRouteDecisionBinding(proxyInput), /must not be a Proxy/);
    assert.equal(proxyTrapCalls, 0);

    let getterCalls = 0;
    const getterSource = clone(source);
    Object.defineProperty(getterSource.nodes, '0', {
      enumerable: true,
      configurable: true,
      get() { getterCalls += 1; return source.nodes[0]; },
    });
    assert.throws(() => buildCityRouteDecisionBinding({
      sourceGraph: getterSource,
      cityAdapter: PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
      cityAdaptationResult: cityResult,
    }), /must be an own data property/);
    assert.equal(getterCalls, 0);
  });
});

test('integration run rejects endpoints that cannot establish the exact revision chain', async () => {
  const cityBinding = binding(await sourceFixture());
  assert.throws(() => buildRouteDecisionIntegrationRun({
    binding: cityBinding,
    searchRequest: requestFor(cityBinding, { destinationNodeId: 'missing-node' }),
    decisionPolicy: policyFor(),
  }), /endpoints must exist/);
});
