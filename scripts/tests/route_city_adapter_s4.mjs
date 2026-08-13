#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CITY_ADAPTER_SCHEMA_VERSIONS,
  PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
  adaptPhiladelphiaSyntheticGraph,
  admitCityAdaptationResult,
  admitCityAdapter,
  buildCityAdapterInputIdentity,
  buildCityAdapterOutputIdentity,
} from '../../src/route_generation/city_adapter/index.js';
import { admitGraphArtifact } from '../../src/route_decision/contracts/index.js';
import { searchRouteCandidates } from '../../src/route_generation/candidate_search/index.js';
import {
  ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS,
  ROUTE_SEARCH_DISTINCTNESS_VERSION,
  ROUTE_SEARCH_TIE_BREAK_VERSION,
} from '../../src/route_decision/contracts/candidate_search_v2.js';

const fixtureRoot = new URL('../fixtures/route-city-adapter-s4/', import.meta.url);

async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, fixtureRoot), 'utf8'));
}

function clone(value) {
  return structuredClone(value);
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function searchAdaptedGraph(graphArtifact) {
  return searchRouteCandidates(graphArtifact, {
    schemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchRequest,
    requestId: 'city-adapter-search',
    graphId: graphArtifact.graphId,
    mode: 'walk',
    originNodeId: 'node.dot',
    destinationNodeId: 'node_under',
    decisionPolicyId: 'city-adapter-policy',
    objectiveFactorId: 'objective-cost-units',
    requestedCandidateCount: 1,
    routeDistinctnessVersion: ROUTE_SEARCH_DISTINCTNESS_VERSION,
    tieBreakVersion: ROUTE_SEARCH_TIE_BREAK_VERSION,
    bounds: { maxExpandedStates: 100, maxRouteEdgeCount: 10 },
    hardConstraints: [],
  });
}

test('CityAdapter/v1 admits only the exact Philadelphia synthetic profile', () => {
  const admitted = admitCityAdapter(clone(PHILADELPHIA_SYNTHETIC_CITY_ADAPTER));
  assert.deepEqual(admitted, PHILADELPHIA_SYNTHETIC_CITY_ADAPTER);
  assert.equal(admitted.schemaVersion, CITY_ADAPTER_SCHEMA_VERSIONS.cityAdapter);
  assert.equal(admitted.coverage.realDataAdmitted, false);
  assert.equal(admitted.missingValuePolicy.unresolvedCapabilityAsFalseOrZero, 'forbidden');
  assertDeepFrozen(admitted);

  for (const mutation of [
    (candidate) => { candidate.cityId = 'new-york-ny-us'; },
    (candidate) => { candidate.spatialReference.axisOrder.reverse(); },
    (candidate) => { candidate.timezone = 'UTC'; },
    (candidate) => { candidate.topologyMapping.values.both = ['forward']; },
    (candidate) => { candidate.coverage.realDataAdmitted = true; },
    (candidate) => { candidate.limitations.pop(); },
    (candidate) => { candidate.adapterContentIdentity.digest = 'sha256:0'; },
  ]) {
    const candidate = clone(PHILADELPHIA_SYNTHETIC_CITY_ADAPTER);
    mutation(candidate);
    assert.throws(() => admitCityAdapter(candidate), /CityAdapter contract/);
  }
});

test('Philadelphia synthetic shape maps directed traversal, costs, and unresolved capabilities exactly', async () => {
  const input = await fixture('philadelphia-synthetic-minimal.json');
  const before = clone(input);
  const result = adaptPhiladelphiaSyntheticGraph(input);

  assert.deepEqual(input, before);
  assert.equal(result.schemaVersion, CITY_ADAPTER_SCHEMA_VERSIONS.adaptationResult);
  assert.deepEqual(result.graphArtifact.edges.map((edge) => [
    edge.edgeId,
    edge.fromNodeId,
    edge.toNodeId,
    edge.distanceMm,
    edge.objectiveCostUnits,
  ]), [
    ['block-a:forward', 'node.dot', 'node:colon', 1000, 10],
    ['block-a:reverse', 'node:colon', 'node.dot', 1000, 10],
    ['block-b:forward', 'node:colon', 'node_under', 1000, 12],
  ]);
  assert.deepEqual(result.graphArtifact.nodes.map(({ nodeId }) => nodeId), [
    'node-dash', 'node.dot', 'node:colon', 'node_under',
  ]);
  assert.equal(result.graphArtifact.directed, true);
  assert.equal(result.graphArtifact.mode, 'walk');
  assert.equal(result.graphArtifact.provenance.dataClassification, 'synthetic');
  assert.deepEqual(admitGraphArtifact(result.graphArtifact), result.graphArtifact);

  const blockA = result.edgeCapabilityObservations.find(({ edgeId }) => edgeId === 'block-a:forward');
  assert.deepEqual(blockA.observations.map(({ capabilityId, state, value }) => [capabilityId, state, value]), [
    ['step-free', 'observed', true],
    ['curb-ramp-present', 'unknown', null],
    ['paved-surface', 'observed', false],
  ]);
  const blockB = result.edgeCapabilityObservations.find(({ edgeId }) => edgeId === 'block-b:forward');
  assert.deepEqual(blockB.observations[0], {
    schemaVersion: CITY_ADAPTER_SCHEMA_VERSIONS.capabilityObservation,
    capabilityId: 'step-free',
    state: 'unavailable',
    value: null,
    unit: 'boolean',
    reasonCode: 'source-unavailable',
    sourceId: 'synthetic-philadelphia-minimal',
  });
  assertDeepFrozen(result);
});

test('input and output identities are deterministic, recomputable, and content-sensitive', async () => {
  const input = await fixture('philadelphia-synthetic-minimal.json');
  const first = adaptPhiladelphiaSyntheticGraph(input);
  const second = adaptPhiladelphiaSyntheticGraph(clone(input));
  assert.deepEqual(first, second);
  assert.deepEqual(first.inputContentIdentity, buildCityAdapterInputIdentity(input));
  assert.deepEqual(first.outputContentIdentity, buildCityAdapterOutputIdentity(first, { sourceGraph: input }));
  assert.deepEqual(first, admitCityAdaptationResult(clone(first), { sourceGraph: input }));
  assert.deepEqual(
    first,
    admitCityAdaptationResult(JSON.parse(JSON.stringify(first)), { sourceGraph: input }),
  );

  const changed = clone(input);
  changed.edges[0].distanceMm += 1;
  const changedResult = adaptPhiladelphiaSyntheticGraph(changed);
  assert.notEqual(changedResult.inputContentIdentity.digest, first.inputContentIdentity.digest);
  assert.notEqual(changedResult.graphArtifact.receipt.artifactVersion, first.graphArtifact.receipt.artifactVersion);
  assert.notEqual(changedResult.outputContentIdentity.digest, first.outputContentIdentity.digest);
  assert.notEqual(
    searchAdaptedGraph(changedResult.graphArtifact).candidateSet.candidateSetRevision,
    searchAdaptedGraph(first.graphArtifact).candidateSet.candidateSetRevision,
  );
});

test('CityAdaptationResult rejects graph, capability, coverage, and identity tampering', async () => {
  const sourceGraph = await fixture('philadelphia-synthetic-minimal.json');
  const result = adaptPhiladelphiaSyntheticGraph(sourceGraph);
  const tampered = [
    (candidate) => { candidate.graphArtifact.edges[0].distanceMm += 1; },
    (candidate) => { candidate.graphArtifact.receipt.artifactVersion = 'self-authored'; },
    (candidate) => { candidate.edgeCapabilityObservations[0].observations[0].value = false; },
    (candidate) => { candidate.coverage.realDataAdmitted = true; },
    (candidate) => { candidate.adapterContentIdentity.digest = 'sha256:0'; },
    (candidate) => { candidate.inputContentIdentity.digest = 'sha256:0'; },
    (candidate) => { candidate.outputContentIdentity.digest = 'sha256:0'; },
  ];
  for (const mutate of tampered) {
    const candidate = clone(result);
    mutate(candidate);
    assert.throws(
      () => admitCityAdaptationResult(candidate, { sourceGraph }),
      /GraphArtifact|exactly match recomputation/,
    );
  }
  assert.equal(result.limitations.includes('digest-proves-json-internal-consistency-only'), true);
  assert.equal(
    result.limitations.includes('digest-does-not-prove-source-history-authorization-or-transferability'),
    true,
  );
});

test('admission is getter-safe and returns detached output', async () => {
  const input = await fixture('philadelphia-synthetic-minimal.json');
  let getterCalls = 0;
  Object.defineProperty(input.edges[0], 'distanceMm', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 1000;
    },
  });
  assert.throws(() => adaptPhiladelphiaSyntheticGraph(input), /data properties only/);
  assert.equal(getterCalls, 0);

  const clean = await fixture('philadelphia-synthetic-minimal.json');
  const result = adaptPhiladelphiaSyntheticGraph(clean);
  const admissionSource = clone(clean);
  clean.edges[0].capabilities.stepFree.token = 'no';
  clean.nodes[0].sourceNodeId = 'mutated';
  assert.equal(result.edgeCapabilityObservations[0].observations[0].value, true);
  assert.equal(result.graphArtifact.nodes[0].nodeId, 'node-dash');

  const hostileResult = clone(result);
  Object.defineProperty(hostileResult.graphArtifact.edges[0], 'distanceMm', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 1000;
    },
  });
  assert.throws(() => buildCityAdapterOutputIdentity(hostileResult, { sourceGraph: admissionSource }), /data properties only/);
  assert.equal(getterCalls, 0);
});

test('missing fields, unknown tokens, schema drift, and real-data-shaped identifiers fail closed', async () => {
  const base = await fixture('philadelphia-synthetic-minimal.json');
  const cases = [
    [() => { const value = clone(base); delete value.timezone; return value; }, /missing: timezone/],
    [() => { const value = clone(base); delete value.edges[0].capabilities.curbRamp; return value; }, /missing: curbRamp/],
    [() => { const value = clone(base); value.edges[0].capabilities.stepFree.token = 'maybe'; return value; }, /token is unsupported/],
    [() => { const value = clone(base); value.edges[0].direction = 'unspecified'; return value; }, /direction is unsupported/],
    [() => { const value = clone(base); value.sourceId = 'real-philadelphia'; return value; }, /synthetic source/],
    [() => { const value = clone(base); value.crs = 'EPSG:4326'; return value; }, /source graph.crs/],
  ];
  for (const [make, pattern] of cases) {
    assert.throws(() => adaptPhiladelphiaSyntheticGraph(make()), pattern);
  }

  const nyc = await fixture('nyc-lion-missing-city-contract.json');
  const osOpenRoads = await fixture('os-open-roads-missing-direction.json');
  assert.throws(() => adaptPhiladelphiaSyntheticGraph(nyc), /schema mismatch/);
  assert.throws(() => adaptPhiladelphiaSyntheticGraph(osOpenRoads), /missing: direction/);
});

test('source admission is closed over derived GraphArtifact ID bounds', async () => {
  const base = await fixture('philadelphia-synthetic-minimal.json');
  const graphIdPrefix = `${PHILADELPHIA_SYNTHETIC_CITY_ADAPTER.cityId}:synthetic:`;
  const traversalSuffix = ':forward';

  const maxGraphIdInput = clone(base);
  maxGraphIdInput.sourceVersion = 'v'.repeat(120 - graphIdPrefix.length);
  assert.doesNotThrow(() => buildCityAdapterInputIdentity(maxGraphIdInput));
  assert.equal(adaptPhiladelphiaSyntheticGraph(maxGraphIdInput).graphArtifact.graphId.length, 120);

  const graphIdOneOver = clone(maxGraphIdInput);
  graphIdOneOver.sourceVersion += 'v';
  assert.throws(() => buildCityAdapterInputIdentity(graphIdOneOver), /derived graphId/);
  assert.throws(() => adaptPhiladelphiaSyntheticGraph(graphIdOneOver), /derived graphId/);

  const maxEdgeIdInput = clone(base);
  maxEdgeIdInput.edges[0].sourceEdgeId = 'e'.repeat(120 - traversalSuffix.length);
  assert.doesNotThrow(() => buildCityAdapterInputIdentity(maxEdgeIdInput));
  assert.equal(
    adaptPhiladelphiaSyntheticGraph(maxEdgeIdInput).graphArtifact.edges
      .find(({ edgeId }) => edgeId.startsWith('e')).edgeId.length,
    120,
  );

  const edgeIdOneOver = clone(maxEdgeIdInput);
  edgeIdOneOver.edges[0].sourceEdgeId += 'e';
  assert.throws(() => buildCityAdapterInputIdentity(edgeIdOneOver), /derived edgeId/);
  assert.throws(() => adaptPhiladelphiaSyntheticGraph(edgeIdOneOver), /derived edgeId/);

  const oldSourceVersionPoc = clone(base);
  oldSourceVersionPoc.sourceVersion = 'v'.repeat(120);
  assert.throws(() => buildCityAdapterInputIdentity(oldSourceVersionPoc), /derived graphId/);
  assert.throws(() => adaptPhiladelphiaSyntheticGraph(oldSourceVersionPoc), /derived graphId/);

  const oldSourceEdgeIdPoc = clone(base);
  oldSourceEdgeIdPoc.edges[0].sourceEdgeId = 'e'.repeat(120);
  assert.throws(() => buildCityAdapterInputIdentity(oldSourceEdgeIdPoc), /derived edgeId/);
  assert.throws(() => adaptPhiladelphiaSyntheticGraph(oldSourceEdgeIdPoc), /derived edgeId/);
});

test('adapted GraphArtifact remains compatible with the existing S2 search contract', async () => {
  const { graphArtifact } = adaptPhiladelphiaSyntheticGraph(
    await fixture('philadelphia-synthetic-minimal.json'),
  );
  const result = searchAdaptedGraph(graphArtifact);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.candidateFacts[0].edgeIds, ['block-a:forward', 'block-b:forward']);
  assert.equal(result.candidateFacts[0].distanceMm, 2000);
});
