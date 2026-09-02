#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createLocalRouteCompanion,
  deriveEvidenceCoverageReceiptIdentity,
} from '../../src/route_generation/local_companion/index.js';
import { ROUTE_DECISION_SCHEMA_VERSIONS } from '../../src/route_decision/contracts/index.js';
import {
  ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS,
  ROUTE_SEARCH_DISTINCTNESS_VERSION,
  ROUTE_SEARCH_TIE_BREAK_VERSION,
} from '../../src/route_decision/contracts/candidate_search_v2.js';
import { createTrustedLocalCompanionBridge } from '../local_route_companion/validation/bridge.mjs';
import { runPublicBenchmark } from '../local_route_companion/validation/runner.mjs';
import {
  observeRuntimeEscapes,
  RUNTIME_ESCAPE_OBSERVER_IDENTITY,
} from '../local_route_companion/validation/observer.mjs';

const fixtureRoot = new URL('../fixtures/mainline-m7-validation/', import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(name, fixtureRoot), 'utf8'));

function graphArtifact() {
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.graphArtifact,
    graphId: 'm7-runner-graph',
    mode: 'walk',
    directed: true,
    nodes: ['a', 'b', 'd'].map((nodeId) => ({ nodeId })),
    edges: [
      { edgeId: 'a-b', fromNodeId: 'a', toNodeId: 'b', distanceMm: 100000, objectiveCostUnits: 1 },
      { edgeId: 'b-d', fromNodeId: 'b', toNodeId: 'd', distanceMm: 100000, objectiveCostUnits: 1 },
    ],
    components: { kind: 'weakly-connected', count: 1, byNodeId: { a: 0, b: 0, d: 0 } },
    provenance: { dataClassification: 'synthetic', sourceIds: ['synthetic-m7-runner-graph'] },
    receipt: { artifactVersion: 'm7-runner-graph-v1' },
  };
}

function searchRequest() {
  return {
    schemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchRequest,
    requestId: 'm7-runner-search',
    graphId: 'm7-runner-graph',
    mode: 'walk',
    originNodeId: 'a',
    destinationNodeId: 'd',
    decisionPolicyId: 'm7-runner-policy',
    objectiveFactorId: 'objective-cost-units',
    requestedCandidateCount: 3,
    routeDistinctnessVersion: ROUTE_SEARCH_DISTINCTNESS_VERSION,
    tieBreakVersion: ROUTE_SEARCH_TIE_BREAK_VERSION,
    bounds: { maxExpandedStates: 100, maxRouteEdgeCount: 8 },
    hardConstraints: [],
  };
}

function actualBridge({
  onGenerate = null, never = false, attemptFetch = false, withEvidence = false,
  claimedEvidenceArtifactIdentity = null,
} = {}) {
  const graph = graphArtifact();
  const evidenceArtifactInput = withEvidence
    ? 'runner-evidence-artifact-v1' : 'unavailable-evidence-enricher-v1';
  const trustedEvidenceArtifactIdentity = `sha256:${createHash('sha256')
    .update(evidenceArtifactInput, 'utf8').digest('hex')}`;
  const evidenceArtifactIdentity = claimedEvidenceArtifactIdentity
    ?? trustedEvidenceArtifactIdentity;
  const engine = {
    identity: 'm7-runner-engine',
    transport: { kind: 'in-process' },
    async generate(request, { signal } = {}) {
      onGenerate?.({ request, signal });
      if (never) return new Promise(() => {});
      if (attemptFetch) {
        try { await fetch('https://example.invalid/private-route'); } catch { /* attempt is still observed */ }
      }
      return {
        status: 'ready',
        graphArtifact: graph,
        searchRequest: searchRequest(),
        edgeObservationsByEdgeId: {},
      };
    },
  };
  const evidenceIdentity = withEvidence ? 'm7-runner-evidence' : 'local-evidence-unavailable';
  const companion = createLocalRouteCompanion({
    engineAdapter: engine,
    ...(withEvidence ? {
      evidenceEnricher: {
        identity: evidenceIdentity,
        async enrich({ searchResult, candidateBindings }) {
          const bindingByCandidateId = Object.fromEntries(candidateBindings.map((binding) => [
            binding.candidateId, binding,
          ]));
          const dimensions = {
            crime: { status: 'available', value: 1, receiptIdentity: `sha256:${'1'.repeat(64)}` },
            crash: { status: 'available', value: 2, receiptIdentity: `sha256:${'2'.repeat(64)}` },
            accessibility: { status: 'available', value: true, receiptIdentity: `sha256:${'3'.repeat(64)}` },
            'map-match': { status: 'available', value: 4, receiptIdentity: `sha256:${'4'.repeat(64)}` },
            sensitivity: { status: 'available', value: false, receiptIdentity: `sha256:${'5'.repeat(64)}` },
          };
          return {
            status: 'ready',
            evidenceArtifactIdentity,
            candidateEvidence: Object.fromEntries(searchResult.candidateFacts.map(({ candidateId }) => [
              candidateId, dimensions,
            ])),
            candidateCoverage: Object.fromEntries(searchResult.candidateFacts.map(({ candidateId }) => {
              const binding = bindingByCandidateId[candidateId];
              return [candidateId, {
                topologyIdentity: binding.topologyIdentity,
                routeDirectedEdgeIds: binding.directedEdgeIds,
                coveredDirectedEdgeIds: binding.directedEdgeIds,
                coveredSegmentCount: 2,
                totalSegmentCount: 2,
                receiptIdentity: deriveEvidenceCoverageReceiptIdentity({
                  evidenceArtifactIdentity,
                  topologyIdentity: binding.topologyIdentity,
                  routeDirectedEdgeIds: binding.directedEdgeIds,
                  coveredDirectedEdgeIds: binding.directedEdgeIds,
                }),
              }];
            })),
          };
        },
      },
    } : {}),
  });
  return createTrustedLocalCompanionBridge({
    companion,
    artifactInputs: {
      engine: 'in-memory-engine-adapter-v1',
      graph,
      candidateGenerator: { schemaVersion: 'candidate-generator/v1', limit: 3 },
      evidence: evidenceArtifactInput,
    },
    runtimeBindings: {
      engineIdentity: 'm7-runner-engine',
      evidenceIdentity,
      transportKind: 'in-process',
    },
  });
}

async function inputs() {
  const [corpus, manifest, policy] = await Promise.all([
    load('public-od-corpus.v1.json'),
    load('manifest.v1.json'),
    load('validation-policy.v1.json'),
  ]);
  return { corpus, manifest, policy };
}

test('trusted bridge maps a public OD pair into the real private companion contract', async () => {
  const { corpus, policy } = await inputs();
  let captured;
  const bridge = actualBridge({
    onGenerate: (value) => { captured = value; },
    withEvidence: true,
  });
  const result = await bridge.generate({
    pair: corpus.pairs[0],
    policy,
    signal: new AbortController().signal,
  });
  assert.equal(captured.request.schemaVersion, 'LocalRoutePrivateRequest/v1');
  assert.deepEqual(captured.request.origin, {
    longitude: corpus.pairs[0].origin.longitude,
    latitude: corpus.pairs[0].origin.latitude,
  });
  assert.ok(captured.signal instanceof AbortSignal);
  assert.equal(result.status, 'success');
  assert.equal(result.candidates.length, 1);
  assert.match(result.candidates[0].candidateIdentity, /^sha256:[0-9a-f]{64}$/);
  assert.equal(result.candidates[0].mapMatchDistanceM, 4);
  assert.deepEqual(result.candidates[0].evidence, {
    coveredSegmentCount: 2,
    totalSegmentCount: 2,
  });
  assert.equal(result.candidates[0].weightSensitivityChanged, false);
  assert.doesNotMatch(JSON.stringify(result), /longitude|latitude|geometry|edgeId|nodeId/);
});

test('formal bridge rejects a coverage receipt that is not the trusted evidence artifact', async () => {
  const { corpus, policy } = await inputs();
  const bridge = actualBridge({
    withEvidence: true,
    claimedEvidenceArtifactIdentity: `sha256:${'9'.repeat(64)}`,
  });
  const result = await bridge.generate({
    pair: corpus.pairs[0],
    policy,
    signal: new AbortController().signal,
  });
  assert.deepEqual(result, {
    status: 'invalid',
    reasonCode: 'invalid-companion-result',
    candidates: [],
  });
});

test('formal bridge rejects aliased engine and evidence sources', () => {
  const companion = createLocalRouteCompanion({
    engineAdapter: {
      identity: 'm7-independent-engine',
      transport: { kind: 'in-process' },
      async generate() { return { status: 'unavailable' }; },
    },
  });
  assert.throws(
    () => createTrustedLocalCompanionBridge({
      companion,
      artifactInputs: {
        engine: 'same-artifact',
        graph: graphArtifact(),
        candidateGenerator: { schemaVersion: 'candidate-generator/v1', limit: 3 },
        evidence: 'same-artifact',
      },
      runtimeBindings: {
        engineIdentity: 'm7-independent-engine',
        evidenceIdentity: 'local-evidence-unavailable',
        transportKind: 'in-process',
      },
    }),
    /independent engine and evidence artifacts/,
  );
});

test('runner-owned observer labels attempt detection without claiming OS enforcement', async () => {
  const observation = await observeRuntimeEscapes(async () => 'completed');
  assert.equal(observation.value, 'completed');
  assert.equal(observation.measurementStatus, 'observed');
  assert.equal(observation.enforcement, 'attempt-detection-only');
  assert.equal(observation.observerIdentity, RUNTIME_ESCAPE_OBSERVER_IDENTITY);
  assert.match(observation.observerIdentity, /^sha256:[0-9a-f]{64}$/);
  assert.equal(observation.egressCount, 0);
});

test('real companion run remains unavailable until an independent OS outbound-deny observation exists', async () => {
  const values = await inputs();
  let calls = 0;
  const receipt = await runPublicBenchmark({
    ...values,
    bridge: actualBridge({ onGenerate: () => { calls += 1; } }),
    pairDeadlineMs: 100,
  });
  assert.equal(calls, 40);
  assert.equal(receipt.status, 'unavailable');
  assert.deepEqual(receipt.reasonCodes, [
    'os-outbound-deny-observation-unavailable',
    'graph-and-runtime-identities-not-observed',
  ]);
  assert.match(receipt.privacy.measurement, /async-hooks-fetch-attempt-detector/);
  assert.equal(receipt.privacy.measurementStatus, 'observed');
  assert.equal(receipt.privacy.enforcement, 'attempt-detection-only');
  assert.equal(receipt.privacy.observerIdentity, RUNTIME_ESCAPE_OBSERVER_IDENTITY);
  assert.equal(receipt.privacy.egressCount, 0);
});

test('custom self-reported identities and egress never mint an available receipt', async () => {
  const values = await inputs();
  let called = false;
  const receipt = await runPublicBenchmark({
    ...values,
    engine: { identity: `sha256:${'1'.repeat(64)}` },
    companion: {
      async generate() { called = true; return { status: 'success', candidates: [] }; },
      identities() { return {}; },
      privacyEgressCount() { return 0; },
    },
  });
  assert.equal(called, false);
  assert.equal(receipt.status, 'unavailable');
  assert.equal(receipt.reasonCodes[0], 'unverified-custom-runtime');
  assert.match(receipt.privacy.measurement, /no-runtime-executed/);
  assert.equal(receipt.privacy.measurementStatus, 'not-run');
  assert.equal(receipt.privacy.observerIdentity, null);
});

test('fetch attempt is independently detected even when the engine catches its failure', async () => {
  const values = await inputs();
  await assert.rejects(
    runPublicBenchmark({ ...values, bridge: actualBridge({ attemptFetch: true }), pairDeadlineMs: 100 }),
    /runtime escape attempt.*FETCH/,
  );
});

test('per-pair deadline aborts a never-resolving companion instead of hanging the runner', async () => {
  const values = await inputs();
  let observedSignal;
  const started = performance.now();
  const receipt = await runPublicBenchmark({
    ...values,
    bridge: actualBridge({ never: true, onGenerate: ({ signal }) => { observedSignal = signal; } }),
    pairDeadlineMs: 2,
  });
  assert.equal(receipt.status, 'unavailable');
  assert.equal(receipt.reasonCodes[0], 'os-outbound-deny-observation-unavailable');
  assert.ok(observedSignal instanceof AbortSignal);
  assert.equal(observedSignal.aborted, true);
  assert.ok(performance.now() - started < 2000);
});
