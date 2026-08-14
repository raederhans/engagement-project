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
  parseRouteDecisionBrowserDelivery,
} from '../../src/route_decision/browser_delivery/browser_delivery_v1.js';
import {
  serializeRouteDecisionBrowserDelivery,
} from '../../src/route_decision/browser_delivery/node_producer_v1.js';
import {
  ROUTE_DECISION_BROWSER_ACCEPTANCE_CANONICALIZATION,
  ROUTE_DECISION_BROWSER_ACCEPTANCE_IDENTITY_VERSION,
  ROUTE_DECISION_BROWSER_ACCEPTANCE_VERSION,
  ROUTE_DECISION_BROWSER_ATOMIC_PRESENTATION_VERSION,
  acceptRouteDecisionBrowserPresentation,
} from '../../src/route_decision/browser_acceptance/browser_acceptance_v1.js';

const SOURCE_URL = new URL(
  '../fixtures/route-s5-integration/synthetic_city_source.json',
  import.meta.url,
);
const BOUNDARY_URL = new URL(
  '../fixtures/route-s6-browser-acceptance/expected_boundaries.json',
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

function requestFor(cityBinding, { factorIds = ['step-free'] } = {}) {
  const graph = cityBinding.cityAdaptationResult.graphArtifact;
  return {
    schemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchRequest,
    requestId: 's6-browser-acceptance-request',
    graphId: graph.graphId,
    mode: graph.mode,
    originNodeId: 'node-a',
    destinationNodeId: 'node-b',
    decisionPolicyId: 's6-browser-acceptance-policy',
    objectiveFactorId: 'objective-cost-units',
    requestedCandidateCount: 1,
    routeDistinctnessVersion: ROUTE_SEARCH_DISTINCTNESS_VERSION,
    tieBreakVersion: ROUTE_SEARCH_TIE_BREAK_VERSION,
    bounds: { maxExpandedStates: 100, maxRouteEdgeCount: 4 },
    hardConstraints: factorIds.map(searchConstraint),
  };
}

function policyFor(factorIds = ['step-free']) {
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.decisionPolicy,
    policyId: 's6-browser-acceptance-policy',
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

function integrationRun(cityBinding, factorIds = ['step-free']) {
  return buildRouteDecisionIntegrationRun({
    binding: cityBinding,
    searchRequest: requestFor(cityBinding, { factorIds }),
    decisionPolicy: policyFor(factorIds),
  });
}

async function deliveryText(factorIds = ['step-free']) {
  const cityBinding = binding(await sourceFixture());
  return serializeRouteDecisionBrowserDelivery(integrationRun(cityBinding, factorIds));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, canonicalize(value[key])]));
}

function resignDelivery(value) {
  const projection = clone(value);
  delete projection.deliveryIdentity;
  const canonical = JSON.stringify(canonicalize(projection));
  const bytes = new TextEncoder().encode(canonical);
  value.deliveryIdentity = {
    schemaVersion: ROUTE_DECISION_BROWSER_DELIVERY_IDENTITY_VERSION,
    canonicalization: ROUTE_DECISION_BROWSER_DELIVERY_CANONICALIZATION,
    digestAlgorithm: 'sha256',
    canonicalUtf8Bytes: bytes.length,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
  return JSON.stringify(value);
}

function reverseObjectKeyOrder(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeyOrder);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).reverse()
    .map((key) => [key, reverseObjectKeyOrder(value[key])]));
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test('accepts one exact primitive document as a versioned atomic presentation', async () => {
  const sourceText = await deliveryText();
  const source = parseRouteDecisionBrowserDelivery(sourceText);
  const accepted = acceptRouteDecisionBrowserPresentation(sourceText);
  const boundaries = await boundaryFixture();

  assert.equal(accepted.schemaVersion, ROUTE_DECISION_BROWSER_ACCEPTANCE_VERSION);
  assert.equal(accepted.schemaVersion, boundaries.acceptanceSchemaVersion);
  assert.equal(accepted.atomicPresentation.schemaVersion,
    ROUTE_DECISION_BROWSER_ATOMIC_PRESENTATION_VERSION);
  assert.equal(accepted.atomicPresentation.schemaVersion,
    boundaries.atomicPresentationSchemaVersion);
  assert.deepEqual(accepted.atomicPresentation.atomicSections, boundaries.atomicSections);
  assert.deepEqual(accepted.atomicPresentation.summary, source.displayModel.sections.summary);
  assert.deepEqual(accepted.atomicPresentation.claimBoundary,
    source.displayModel.sections.claimBoundary);
  assert.deepEqual(accepted.atomicPresentation.limitations,
    source.displayModel.sections.limitations);
  assert.notEqual(accepted.atomicPresentation.summary,
    source.displayModel.sections.summary, 'accepted output must be detached');
  assert.equal(accepted.atomicPresentation.displayCompletenessScope,
    boundaries.displayCompletenessScope);
  assert.equal(accepted.atomicPresentation.sourcePresentationRelationship,
    boundaries.sourcePresentationRelationship);
  assert.equal(accepted.atomicPresentation.mapModel, null);
  assertDeepFrozen(accepted);
});

test('acceptance identity is deterministic, independently reproducible, and key-order invariant', async () => {
  const sourceText = await deliveryText();
  const sourceObject = JSON.parse(sourceText);
  const first = acceptRouteDecisionBrowserPresentation(sourceText);
  const second = acceptRouteDecisionBrowserPresentation(
    JSON.stringify(reverseObjectKeyOrder(sourceObject)),
  );
  assert.deepEqual(second, first);
  assert.equal(first.acceptanceIdentity.schemaVersion,
    ROUTE_DECISION_BROWSER_ACCEPTANCE_IDENTITY_VERSION);
  assert.equal(first.acceptanceIdentity.canonicalization,
    ROUTE_DECISION_BROWSER_ACCEPTANCE_CANONICALIZATION);
  const projection = clone(first);
  delete projection.acceptanceIdentity;
  const canonical = JSON.stringify(canonicalize(projection));
  const bytes = new TextEncoder().encode(canonical);
  assert.equal(first.acceptanceIdentity.canonicalUtf8Bytes, bytes.length);
  assert.equal(first.acceptanceIdentity.digest,
    `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
});

test('primitive JSON is the only input API and caller objects are never traversed', async () => {
  const sourceText = await deliveryText();
  let getterCalls = 0;
  const hostile = {};
  Object.defineProperty(hostile, 'schemaVersion', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'anything';
    },
  });
  for (const rejected of [
    JSON.parse(sourceText),
    Object.freeze(JSON.parse(sourceText)),
    new String(sourceText),
    hostile,
  ]) {
    assert.throws(() => acceptRouteDecisionBrowserPresentation(rejected),
      /primitive JSON text/);
  }
  assert.equal(getterCalls, 0);
});

test('missing atomic section, stale alias, and re-signed presentation tamper fail closed', async () => {
  const original = JSON.parse(await deliveryText());
  const mutations = [
    (value) => { delete value.displayModel.sections.limitations; },
    (value) => {
      value.displayModel.sections.claim_boundary = value.displayModel.sections.claimBoundary;
      delete value.displayModel.sections.claimBoundary;
    },
    (value) => { value.displayModel.sections.summary[0].text = 'Caller terminal.'; },
    (value) => { value.displayModel.sourcePresentationRelationship = 'full-s4-projection'; },
  ];
  for (const mutate of mutations) {
    const changed = clone(original);
    mutate(changed);
    assert.throws(() => acceptRouteDecisionBrowserPresentation(resignDelivery(changed)),
      /RouteDecisionBrowserDelivery|RouteDecisionBrowserAcceptance/);
  }
});

test('content tamper without matching delivery identity fails closed', async () => {
  const changed = JSON.parse(await deliveryText());
  changed.displayModel.sections.summary[0].text = 'Tampered terminal.';
  assert.throws(() => acceptRouteDecisionBrowserPresentation(JSON.stringify(changed)),
    /deterministic templates|identity/);
});

test('re-signed impossible terminal tuple fails before atomic presentation', async () => {
  const changed = JSON.parse(await deliveryText());
  changed.searchTruth.status = 'completed';
  changed.searchTruth.termination = 'search-budget-exhausted';
  changed.searchTruth.budgetOutcome = 'exhausted';
  changed.searchTruth.stopped = false;
  changed.searchTruth.stoppedWithPartialExecution = false;
  assert.throws(() => acceptRouteDecisionBrowserPresentation(resignDelivery(changed)),
    /terminal tuple is unreachable|internally inconsistent/);
});

test('graph-wide unresolved observation cannot be re-signed as a terminal cause', async () => {
  const unresolvedText = await deliveryText(['curb-ramp-present']);
  const accepted = acceptRouteDecisionBrowserPresentation(unresolvedText);
  const acceptedGraphLine = accepted.atomicPresentation.summary.find(
    ({ code }) => code === 'bound-graph-requested-factor-states',
  );
  assert.equal(acceptedGraphLine.text.endsWith(
    'This is conservative graph-wide disclosure, not a terminal cause.',
  ), true);

  const changed = JSON.parse(unresolvedText);
  assert.deepEqual(changed.searchTruth.requestedFactorStatesPresentInBoundGraph, ['unknown']);
  const graphLine = changed.displayModel.sections.summary.find(
    ({ code }) => code === 'bound-graph-requested-factor-states',
  );
  graphLine.code = 'search-terminal';
  graphLine.text = 'Graph-wide unknown evidence is the terminal cause.';
  assert.throws(() => acceptRouteDecisionBrowserPresentation(resignDelivery(changed)),
    /deterministic templates|terminal cause/);
});

test('claim and digest boundaries stay explicit and do not open adjacent authority', async () => {
  const accepted = acceptRouteDecisionBrowserPresentation(await deliveryText());
  const boundaries = await boundaryFixture();
  assert.deepEqual(accepted.acceptanceBoundary.doesNotProve, boundaries.doesNotProve);
  assert.equal(accepted.acceptanceBoundary.sourceDeliveryDigestSemantics,
    boundaries.sourceDeliveryDigestSemantics);
  assert.equal(accepted.acceptanceBoundary.graphWideUnresolvedStateSemantics,
    boundaries.graphWideUnresolvedStateSemantics);
  assert.equal(accepted.acceptanceBoundary.doesNotProve.includes('source-authenticity'), true);
  assert.equal(accepted.acceptanceBoundary.doesNotProve.includes('typed-recomputation'), true);
  assert.equal(accepted.acceptanceBoundary.doesNotProve.includes('performance-authority'), true);
  assert.equal(accepted.acceptanceBoundary.doesNotProve.includes('external-graph-authority'), true);
  assert.equal(accepted.acceptanceBoundary.doesNotProve.includes('product-admission'), true);
});

test('fixture and source adapter versions remain exact prerequisites', async () => {
  const boundaries = await boundaryFixture();
  assert.equal(boundaries.schemaVersion,
    'engagement-route-decision-browser-acceptance-fixture/v1');
  assert.equal(PHILADELPHIA_SYNTHETIC_CITY_ADAPTER.schemaVersion,
    CITY_ADAPTER_SCHEMA_VERSIONS.cityAdapter);
});
