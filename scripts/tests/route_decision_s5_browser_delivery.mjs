#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  buildCityRouteDecisionBinding,
  buildRouteDecisionIntegrationRun,
} from '../../src/route_decision/integration/index.js';
import {
  ROUTE_DECISION_BROWSER_DELIVERY_CANONICALIZATION,
  ROUTE_DECISION_BROWSER_DELIVERY_IDENTITY_VERSION,
  ROUTE_DECISION_BROWSER_DELIVERY_VERSION,
  ROUTE_DECISION_BROWSER_TERMINAL_TRUTH_TABLE_VERSION,
  parseRouteDecisionBrowserDelivery,
} from '../../src/route_decision/browser_delivery/browser_delivery_v1.js';
import {
  buildRouteDecisionBrowserDelivery,
  serializeRouteDecisionBrowserDelivery,
} from '../../src/route_decision/browser_delivery/node_producer_v1.js';

const SOURCE_URL = new URL(
  '../fixtures/route-s5-integration/synthetic_city_source.json',
  import.meta.url,
);
const BOUNDARY_URL = new URL(
  '../fixtures/route-s5-browser-delivery/expected_boundaries.json',
  import.meta.url,
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function sourceFixture() {
  return JSON.parse(await readFile(SOURCE_URL, 'utf8'));
}

async function boundaryFixture() {
  return JSON.parse(await readFile(BOUNDARY_URL, 'utf8'));
}

function binding(source) {
  return buildCityRouteDecisionBinding({
    sourceGraph: source,
    cityAdapter: PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
    cityAdaptationResult: adaptPhiladelphiaSyntheticGraph(
      source,
      PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
    ),
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
  destinationNodeId = 'node-b',
  maxExpandedStates = 100,
} = {}) {
  const graph = cityBinding.cityAdaptationResult.graphArtifact;
  return {
    schemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchRequest,
    requestId: 's5-browser-delivery-request',
    graphId: graph.graphId,
    mode: graph.mode,
    originNodeId: 'node-a',
    destinationNodeId,
    decisionPolicyId: 's5-browser-delivery-policy',
    objectiveFactorId: 'objective-cost-units',
    requestedCandidateCount: 1,
    routeDistinctnessVersion: ROUTE_SEARCH_DISTINCTNESS_VERSION,
    tieBreakVersion: ROUTE_SEARCH_TIE_BREAK_VERSION,
    bounds: { maxExpandedStates, maxRouteEdgeCount: 4 },
    hardConstraints: factorIds.map(searchConstraint),
  };
}

function policyFor(factorIds = ['step-free']) {
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.decisionPolicy,
    policyId: 's5-browser-delivery-policy',
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

function integrationRun(cityBinding, options = {}) {
  const factorIds = options.factorIds ?? ['step-free'];
  return buildRouteDecisionIntegrationRun({
    binding: cityBinding,
    searchRequest: requestFor(cityBinding, { ...options, factorIds }),
    decisionPolicy: policyFor(factorIds),
  });
}

function reverseObjectKeyOrder(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeyOrder);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).reverse()
    .map((key) => [key, reverseObjectKeyOrder(value[key])]));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, canonicalJson(value[key])]));
}

function resignDelivery(value) {
  const projection = clone(value);
  delete projection.deliveryIdentity;
  const canonical = JSON.stringify(canonicalJson(projection));
  const bytes = new TextEncoder().encode(canonical);
  value.deliveryIdentity = {
    schemaVersion: ROUTE_DECISION_BROWSER_DELIVERY_IDENTITY_VERSION,
    canonicalization: ROUTE_DECISION_BROWSER_DELIVERY_CANONICALIZATION,
    digestAlgorithm: 'sha256',
    canonicalUtf8Bytes: bytes.length,
    digest: `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`,
  };
  return JSON.stringify(value);
}

function removeLimitation(delivery, code) {
  delivery.limitations.explanationLimitations = delivery.limitations.explanationLimitations
    .filter((entry) => entry !== code);
  delivery.displayModel.sections.limitations = delivery.displayModel.sections.limitations
    .filter((entry) => entry.code !== code);
}

function allPresentationText(delivery) {
  return Object.values(delivery.displayModel.sections)
    .flat()
    .map(({ text }) => text)
    .join('\n');
}

test('producer fully binds exact S5-A run and emits exact versioned browser delivery', async () => {
  const run = integrationRun(binding(await sourceFixture()));
  const built = buildRouteDecisionBrowserDelivery(run);
  const text = serializeRouteDecisionBrowserDelivery(run);
  const parsed = parseRouteDecisionBrowserDelivery(text);
  const boundaries = await boundaryFixture();

  assert.equal(built.schemaVersion, ROUTE_DECISION_BROWSER_DELIVERY_VERSION);
  assert.equal(built.deliveryIdentity.schemaVersion,
    ROUTE_DECISION_BROWSER_DELIVERY_IDENTITY_VERSION);
  assert.equal(built.deliveryIdentity.canonicalization,
    ROUTE_DECISION_BROWSER_DELIVERY_CANONICALIZATION);
  assert.deepEqual(parsed, built);
  assert.equal(parsed.run.schemaVersion, run.schemaVersion);
  assert.deepEqual(parsed.run.identity, run.runIdentity);
  assert.deepEqual(parsed.provenance.bindingIdentity, run.binding.bindingIdentity);
  assert.deepEqual(parsed.provenance.sourceContentIdentity,
    run.binding.cityAdaptationResult.inputContentIdentity);
  assert.equal(parsed.provenance.graphArtifactVersion, run.revisions.graphArtifactVersion);
  assert.equal(parsed.provenance.candidateSetRevision, run.revisions.candidateSetRevision);
  assert.equal(parsed.provenance.explanationInputRevision,
    run.revisions.explanationInputRevision);
  assert.equal(parsed.searchTruth.terminalTruthTableVersion,
    ROUTE_DECISION_BROWSER_TERMINAL_TRUTH_TABLE_VERSION);
  assert.deepEqual(parsed.limitations.cityAdapterLimitations,
    boundaries.cityAdapterLimitations);
  assert.deepEqual(parsed.limitations.deliveryLimitations,
    boundaries.deliveryLimitations);
  assert.deepEqual(parsed.admissionBoundary.doesNotProve, boundaries.doesNotProve);
  assert.equal(parsed.displayModel.displayCompletenessScope,
    boundaries.displayCompletenessScope);
  assert.equal(parsed.displayModel.sourcePresentationRelationship,
    boundaries.sourcePresentationRelationship);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.displayModel.sections), true);
});

test('producer rejects projection, identity-only, and tampered run inputs before delivery', async () => {
  const run = integrationRun(binding(await sourceFixture()));
  assert.throws(() => buildRouteDecisionBrowserDelivery({
    schemaVersion: run.schemaVersion,
    runIdentity: run.runIdentity,
  }), /RouteDecisionIntegrationRun|schema mismatch/);
  assert.throws(() => buildRouteDecisionBrowserDelivery(run.runIdentity),
    /RouteDecisionIntegrationRun|schema mismatch/);

  const tamperedTruth = clone(run);
  tamperedTruth.truth.boundedNoEligibleRouteProven = true;
  assert.throws(() => buildRouteDecisionBrowserDelivery(tamperedTruth), /full binding/);

  const tamperedProjection = clone(run);
  tamperedProjection.presentation.textComplete = false;
  assert.throws(() => buildRouteDecisionBrowserDelivery(tamperedProjection), /full binding/);
});

test('serialization and identity are deterministic and semantic set permutations are invariant', async () => {
  const source = await sourceFixture();
  const firstBinding = binding(source);
  const factorIds = ['step-free', 'curb-ramp-present'];
  const firstRun = buildRouteDecisionIntegrationRun({
    binding: firstBinding,
    searchRequest: requestFor(firstBinding, { factorIds }),
    decisionPolicy: policyFor(factorIds),
  });

  const permutedSource = clone(source);
  permutedSource.nodes.reverse();
  permutedSource.edges.reverse();
  const permutedBinding = binding(permutedSource);
  const reversedFactorIds = [...factorIds].reverse();
  const permutedRun = buildRouteDecisionIntegrationRun({
    binding: permutedBinding,
    searchRequest: requestFor(permutedBinding, { factorIds: reversedFactorIds }),
    decisionPolicy: policyFor(reversedFactorIds),
  });

  const firstText = serializeRouteDecisionBrowserDelivery(firstRun);
  assert.equal(serializeRouteDecisionBrowserDelivery(firstRun), firstText);
  assert.equal(serializeRouteDecisionBrowserDelivery(permutedRun), firstText);
  assert.equal(
    buildRouteDecisionBrowserDelivery(permutedRun).deliveryIdentity.digest,
    buildRouteDecisionBrowserDelivery(firstRun).deliveryIdentity.digest,
  );
});

test('source content mutation changes bound revisions and delivery identity', async () => {
  const source = await sourceFixture();
  const first = buildRouteDecisionBrowserDelivery(integrationRun(binding(source)));
  const changedSource = clone(source);
  changedSource.edges[0].objectiveCostUnits += 1;
  const changed = buildRouteDecisionBrowserDelivery(integrationRun(binding(changedSource)));

  assert.notEqual(changed.provenance.sourceContentIdentity.digest,
    first.provenance.sourceContentIdentity.digest);
  assert.notEqual(changed.provenance.graphArtifactVersion,
    first.provenance.graphArtifactVersion);
  assert.notEqual(changed.provenance.candidateSetRevision,
    first.provenance.candidateSetRevision);
  assert.notEqual(changed.run.identity.digest, first.run.identity.digest);
  assert.notEqual(changed.deliveryIdentity.digest, first.deliveryIdentity.digest);
});

test('key order is irrelevant to exact admission while UTF-8 identity remains exact', async () => {
  const text = serializeRouteDecisionBrowserDelivery(
    integrationRun(binding(await sourceFixture())),
  );
  const ordinary = JSON.parse(text);
  const reordered = JSON.stringify(reverseObjectKeyOrder(ordinary));
  const parsed = parseRouteDecisionBrowserDelivery(reordered);
  assert.deepEqual(parsed, ordinary);
  const projection = clone(ordinary);
  delete projection.deliveryIdentity;
  assert.equal(parsed.deliveryIdentity.canonicalUtf8Bytes,
    new TextEncoder().encode(JSON.stringify(canonicalJson(projection))).length,
    'producer byte count remains an explicit UTF-8 count over its projection');
});

test('unknown and unavailable remain unresolved, null-preserving, and never bounded proof', async () => {
  const cityBinding = binding(await sourceFixture());
  const unknown = parseRouteDecisionBrowserDelivery(serializeRouteDecisionBrowserDelivery(
    integrationRun(cityBinding, { factorIds: ['curb-ramp-present'] }),
  ));
  const unavailable = parseRouteDecisionBrowserDelivery(serializeRouteDecisionBrowserDelivery(
    integrationRun(cityBinding, {
      factorIds: ['step-free'],
      destinationNodeId: 'node-c',
    }),
  ));
  for (const delivery of [unknown, unavailable]) {
    assert.equal(delivery.searchTruth.termination, 'unresolved-constraint-evidence');
    assert.equal(delivery.searchTruth.constraintOutcome, 'unresolved-evidence');
    assert.equal(delivery.searchTruth.unresolvedEvidence, true);
    assert.equal(delivery.searchTruth.boundedNoEligibleRouteProven, false);
    assert.equal(delivery.searchTruth.missingCoverageAccepted, false);
    assert.equal(delivery.displayModel.mapModel, null);
  }
  assert.deepEqual(unknown.searchTruth.requestedFactorStatesPresentInBoundGraph, ['unknown']);
  assert.deepEqual(unavailable.searchTruth.requestedFactorStatesPresentInBoundGraph,
    ['unavailable']);
  assert.equal((await boundaryFixture()).requestedFactorStateDisclosure,
    'bound-graph-wide-not-terminal-cause');
});

test('stopped result is explicitly partial execution, incomplete, and never full-space complete', async () => {
  const stopped = parseRouteDecisionBrowserDelivery(serializeRouteDecisionBrowserDelivery(
    integrationRun(binding(await sourceFixture()), {
      factorIds: [],
      destinationNodeId: 'node-c',
      maxExpandedStates: 1,
    }),
  ));
  assert.equal(stopped.searchTruth.termination, 'search-budget-exhausted');
  assert.equal(stopped.searchTruth.stopped, true);
  assert.equal(stopped.searchTruth.stoppedWithPartialExecution, true);
  assert.equal(stopped.searchTruth.incomplete, true);
  assert.equal(stopped.searchTruth.boundedSearchCompleteness, 'not-proven');
  assert.equal(stopped.searchTruth.fullSearchSpaceCompleteness, 'not-claimed');
  assert.equal(stopped.searchTruth.boundedNoEligibleRouteProven, false);
  assert.equal(stopped.searchTruth.budgetOutcome, 'exhausted');
  assert.equal(stopped.searchTruth.capacityOutcome, 'within-capacity');
  assert.equal(stopped.limitations.explanationLimitations
    .includes('route-search-stopped'), true);
  assert.equal(stopped.limitations.explanationLimitations
    .includes('route-search-completeness-not-proven'), true);
});

test('display model is boundary-summary-complete, map-optional, and retains no-claim copy', async () => {
  const delivery = parseRouteDecisionBrowserDelivery(serializeRouteDecisionBrowserDelivery(
    integrationRun(binding(await sourceFixture())),
  ));
  assert.equal(delivery.displayModel.textCompleteForBoundarySummary, true);
  assert.equal(delivery.displayModel.displayCompletenessScope,
    'browser-boundary-summary/v1');
  assert.equal(delivery.displayModel.sourcePresentationRelationship,
    'source-fact-contract-only-not-full-s4-presentation-projection');
  assert.equal(delivery.displayModel.mapOptional, true);
  assert.equal(delivery.displayModel.mapModel, null);
  assert.equal(delivery.explanation.noClaimInterpretation,
    'no-claim-eligible-from-explanation-v1');
  assert.equal(delivery.displayModel.sections.claimBoundary[0].code,
    'no-claim-eligible-from-explanation-v1');
  const text = allPresentationText(delivery).toLowerCase();
  for (const unsupportedClaim of [
    'is safe',
    'is safer',
    'is recommended',
    'accessibility is validated',
    'was caused by',
  ]) assert.equal(text.includes(unsupportedClaim), false, unsupportedClaim);
});

test('object, Proxy, getter, descriptor, and frozen object inputs have no browser admission path', () => {
  let getterCalls = 0;
  const getter = {};
  Object.defineProperty(getter, 'schemaVersion', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return ROUTE_DECISION_BROWSER_DELIVERY_VERSION;
    },
  });
  let proxyTrapCalls = 0;
  const proxy = new Proxy({}, {
    get() {
      proxyTrapCalls += 1;
      return undefined;
    },
    getPrototypeOf() {
      proxyTrapCalls += 1;
      return Object.prototype;
    },
  });
  for (const input of [{}, getter, proxy, Object.freeze({}), [], null, new String('{}')]) {
    assert.throws(() => parseRouteDecisionBrowserDelivery(input), /primitive JSON text/);
  }
  assert.equal(getterCalls, 0);
  assert.equal(proxyTrapCalls, 0);
});

test('missing, extra, unknown schema, null substitution, and tamper fail closed', async () => {
  const delivery = JSON.parse(serializeRouteDecisionBrowserDelivery(
    integrationRun(binding(await sourceFixture())),
  ));
  const cases = [
    (value) => { delete value.run; },
    (value) => { value.extra = true; },
    (value) => { value.schemaVersion = 'engagement-route-decision-browser-delivery/v2'; },
    (value) => { value.provenance.graphArtifactVersion = null; },
    (value) => { value.searchTruth.termination = 'bounded-search-space-exhausted'; },
    (value) => { value.deliveryIdentity.digest = `sha256:${'0'.repeat(64)}`; },
    (value) => { value.displayModel.sections.summary[0].text = 'tampered'; },
    (value) => { value.admissionBoundary.doesNotProve.pop(); },
  ];
  for (const mutate of cases) {
    const candidate = clone(delivery);
    mutate(candidate);
    assert.throws(() => parseRouteDecisionBrowserDelivery(JSON.stringify(candidate)),
      /RouteDecisionBrowserDelivery/);
  }
});

test('browser terminal truth table rejects re-signed unreachable tuples before identity approval', async () => {
  const cityBinding = binding(await sourceFixture());
  const completed = JSON.parse(serializeRouteDecisionBrowserDelivery(
    integrationRun(cityBinding),
  ));
  const stopped = JSON.parse(serializeRouteDecisionBrowserDelivery(
    integrationRun(cityBinding, {
      factorIds: [],
      destinationNodeId: 'node-c',
      maxExpandedStates: 1,
    }),
  ));
  const unresolved = JSON.parse(serializeRouteDecisionBrowserDelivery(
    integrationRun(cityBinding, { factorIds: ['curb-ramp-present'] }),
  ));
  const noEligible = JSON.parse(serializeRouteDecisionBrowserDelivery(
    integrationRun(cityBinding, { factorIds: ['paved-surface'] }),
  ));
  const attacks = [
    [stopped, (value) => {
      value.searchTruth.status = 'completed';
      value.searchTruth.stopped = false;
      value.searchTruth.stoppedWithPartialExecution = false;
    }],
    [unresolved, (value) => {
      value.searchTruth.constraintOutcome = 'eligible-candidates-returned';
      value.searchTruth.unresolvedEvidence = false;
    }],
    [noEligible, (value) => {
      value.searchTruth.constraintOutcome = 'eligible-candidates-returned';
      value.searchTruth.boundedSearchCompleteness = 'not-proven';
      value.searchTruth.incomplete = true;
      value.searchTruth.boundedNoEligibleRouteProven = false;
    }],
    [stopped, (value) => {
      value.searchTruth.termination = 'requested-candidate-count-reached';
    }],
    [completed, (value) => {
      value.searchTruth.termination = 'endpoint-unavailable';
    }],
    [completed, (value) => {
      value.searchTruth.requestedFactorUnresolvedStates =
        value.searchTruth.requestedFactorStatesPresentInBoundGraph;
      delete value.searchTruth.requestedFactorStatesPresentInBoundGraph;
    }],
    [completed, (value) => {
      delete value.searchTruth.requestedFactorStatesPresentInBoundGraph;
    }],
  ];
  for (const [base, mutate] of attacks) {
    const candidate = clone(base);
    mutate(candidate);
    assert.throws(() => parseRouteDecisionBrowserDelivery(resignDelivery(candidate)),
      /terminal|termination|internally inconsistent|candidate count|schema mismatch/);
  }
});

test('derived limitations reject re-signed missing invariant and conditional codes', async () => {
  const cityBinding = binding(await sourceFixture());
  const completed = JSON.parse(serializeRouteDecisionBrowserDelivery(
    integrationRun(cityBinding),
  ));
  const stopped = JSON.parse(serializeRouteDecisionBrowserDelivery(
    integrationRun(cityBinding, {
      factorIds: [],
      destinationNodeId: 'node-c',
      maxExpandedStates: 1,
    }),
  ));
  const unresolved = JSON.parse(serializeRouteDecisionBrowserDelivery(
    integrationRun(cityBinding, { factorIds: ['curb-ramp-present'] }),
  ));
  const attacks = [
    [completed, 'synthetic-evidence-only'],
    [stopped, 'route-search-stopped'],
    [stopped, 'route-search-completeness-not-proven'],
    [unresolved, 'constraint-evidence-unknown'],
  ];
  for (const [base, code] of attacks) {
    const candidate = clone(base);
    removeLimitation(candidate, code);
    assert.throws(() => parseRouteDecisionBrowserDelivery(resignDelivery(candidate)),
      /explanationLimitations|displayModel/);
  }
  const wrongConditional = clone(completed);
  wrongConditional.limitations.explanationLimitations.push('route-search-stopped');
  wrongConditional.displayModel.sections.limitations.push({
    code: 'route-search-stopped',
    text: 'Limitation: route-search-stopped.',
  });
  assert.throws(() => parseRouteDecisionBrowserDelivery(resignDelivery(wrongConditional)),
    /explanationLimitations/);
});

test('browser-local deterministic text rejects re-signed prose and false scoped completeness', async () => {
  const delivery = JSON.parse(serializeRouteDecisionBrowserDelivery(
    integrationRun(binding(await sourceFixture())),
  ));
  const attacks = [
    (value) => { value.displayModel.sections.summary = []; },
    (value) => { value.displayModel.sections.summary[0].text = 'Caller-authored summary.'; },
    (value) => { value.displayModel.sections.limitations = []; },
    (value) => { value.displayModel.sections.limitations[0].text = 'Caller-authored limitation.'; },
    (value) => { value.displayModel.displayCompletenessScope = 'full-s4-presentation/v1'; },
    (value) => { delete value.displayModel.displayCompletenessScope; },
    (value) => { value.displayModel.sourcePresentationRelationship = 'full-projection'; },
    (value) => { delete value.displayModel.sourcePresentationRelationship; },
    (value) => { value.displayModel.textComplete = true; },
    (value) => { value.displayModel.textCompleteForBoundarySummary = false; },
    (value) => { value.explanation.textComplete = false; },
  ];
  for (const mutate of attacks) {
    const candidate = clone(delivery);
    mutate(candidate);
    assert.throws(() => parseRouteDecisionBrowserDelivery(resignDelivery(candidate)),
      /boundary-summary|displayCompletenessScope|sourcePresentationRelationship|schema mismatch|deterministic templates|text-complete/);
  }
});

test('duplicate keys, blocked prototype names, lone surrogates, unsafe numbers, and syntax fail closed', () => {
  const hostileTexts = [
    '{"schemaVersion":"a","schemaVersion":"b"}',
    '{"__proto__":{}}',
    '{"constructor":{}}',
    '{"prototype":{}}',
    '{"value":"\\ud800"}',
    '{"value":9007199254740992}',
    '{"value":-0}',
    '{"value":1.5}',
    '{"value":true} trailing',
    '{"value":}',
  ];
  for (const text of hostileTexts) {
    assert.throws(() => parseRouteDecisionBrowserDelivery(text),
      /RouteDecisionBrowserDelivery/);
  }
});

test('browser module has no Node, S5-A, runtime, or transitive import dependency', async () => {
  const browserSource = await readFile(new URL(
    '../../src/route_decision/browser_delivery/browser_delivery_v1.js',
    import.meta.url,
  ), 'utf8');
  assert.equal(/^\s*import\s/m.test(browserSource), false);
  assert.equal(browserSource.includes('node:'), false);
  assert.equal(browserSource.includes('../integration/'), false);
  assert.equal(browserSource.includes('/runtime'), false);
  assert.equal(browserSource.includes('public_adapter'), false);
  assert.equal(browserSource.includes('document.'), false);
  assert.equal(browserSource.includes('window.'), false);
});

test('boundary fixture and source fixture retain exact expected schemas', async () => {
  const source = await sourceFixture();
  const boundaries = await boundaryFixture();
  assert.equal(source.schemaVersion, CITY_ADAPTER_SCHEMA_VERSIONS.sourceGraph);
  assert.equal(boundaries.schemaVersion,
    'engagement-route-decision-browser-boundary-fixture/v1');
});
