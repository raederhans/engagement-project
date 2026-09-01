#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  LOCAL_ROUTE_PRIVATE_REQUEST_SCHEMA_VERSION,
  createInProcessOsrmEngineAdapter,
  createLocalRouteCompanion,
  createUnavailableEngineAdapter,
  deriveEvidenceCoverageReceiptIdentity,
} from '../../src/route_generation/local_companion/index.js';
import { ROUTE_DECISION_SCHEMA_VERSIONS } from '../../src/route_decision/contracts/index.js';
import {
  ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS,
  ROUTE_SEARCH_DISTINCTNESS_VERSION,
  ROUTE_SEARCH_TIE_BREAK_VERSION,
} from '../../src/route_decision/contracts/candidate_search_v2.js';

const ORIGIN_SENTINEL = -75.165222;
const DESTINATION_SENTINEL = 39.952583;
const EVIDENCE_ARTIFACT_IDENTITY = `sha256:${'6'.repeat(64)}`;

function privateRequest(overrides = {}) {
  return {
    schemaVersion: LOCAL_ROUTE_PRIVATE_REQUEST_SCHEMA_VERSION,
    requestId: 'm7-private-request',
    mode: 'walk',
    origin: { longitude: ORIGIN_SENTINEL, latitude: 39.950001 },
    destination: { longitude: -75.170001, latitude: DESTINATION_SENTINEL },
    ...overrides,
  };
}

function edge(edgeId, fromNodeId, toNodeId, distanceMm, objectiveCostUnits) {
  return { edgeId, fromNodeId, toNodeId, distanceMm, objectiveCostUnits };
}

function graphArtifact({
  edges = [
    edge('a-b', 'a', 'b', 100, 1),
    edge('b-d', 'b', 'd', 100, 1),
    edge('a-c', 'a', 'c', 130, 2),
    edge('c-d', 'c', 'd', 130, 2),
  ],
} = {}) {
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.graphArtifact,
    graphId: 'm7-local-graph',
    mode: 'walk',
    directed: true,
    nodes: ['a', 'b', 'c', 'd'].map((nodeId) => ({ nodeId })),
    edges,
    components: {
      kind: 'weakly-connected',
      count: 1,
      byNodeId: { a: 0, b: 0, c: 0, d: 0 },
    },
    provenance: {
      dataClassification: 'synthetic',
      sourceIds: ['synthetic-m7-local-graph'],
    },
    receipt: { artifactVersion: 'm7-local-graph-v1' },
  };
}

function searchRequest(requestedCandidateCount = 2) {
  return {
    schemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchRequest,
    requestId: 'm7-candidate-search',
    graphId: 'm7-local-graph',
    mode: 'walk',
    originNodeId: 'a',
    destinationNodeId: 'd',
    decisionPolicyId: 'm7-local-policy',
    objectiveFactorId: 'objective-cost-units',
    requestedCandidateCount,
    routeDistinctnessVersion: ROUTE_SEARCH_DISTINCTNESS_VERSION,
    tieBreakVersion: ROUTE_SEARCH_TIE_BREAK_VERSION,
    bounds: { maxExpandedStates: 100, maxRouteEdgeCount: 8 },
    hardConstraints: [],
  };
}

function readyEngine({
  identity = 'm7-in-process-engine',
  transport = { kind: 'in-process' },
  requestedCandidateCount = 2,
  graph = graphArtifact(),
  onGenerate = null,
} = {}) {
  return {
    identity,
    transport,
    async generate(request) {
      onGenerate?.(request);
      return {
        status: 'ready',
        graphArtifact: graph,
        searchRequest: searchRequest(requestedCandidateCount),
        edgeObservationsByEdgeId: {},
      };
    },
  };
}

function allAvailableDimensions(overrides = {}) {
  const identityDigit = {
    crime: '1',
    crash: '2',
    accessibility: '3',
    'map-match': '4',
    sensitivity: '5',
  };
  const make = (id, value) => ({
    status: 'available',
    value,
    receiptIdentity: `sha256:${identityDigit[id].repeat(64)}`,
  });
  return {
    crime: make('crime', 2),
    crash: make('crash', 1),
    accessibility: make('accessibility', true),
    'map-match': make('map-match', 3.5),
    sensitivity: make('sensitivity', 'stable'),
    ...overrides,
  };
}

function coverageForBinding(binding, overrides = {}) {
  const routeDirectedEdgeIds = binding.directedEdgeIds;
  const coveredDirectedEdgeIds = binding.directedEdgeIds;
  return {
    topologyIdentity: binding.topologyIdentity,
    routeDirectedEdgeIds,
    coveredDirectedEdgeIds,
    coveredSegmentCount: coveredDirectedEdgeIds.length,
    totalSegmentCount: routeDirectedEdgeIds.length,
    receiptIdentity: deriveEvidenceCoverageReceiptIdentity({
      evidenceArtifactIdentity: EVIDENCE_ARTIFACT_IDENTITY,
      topologyIdentity: binding.topologyIdentity,
      routeDirectedEdgeIds,
      coveredDirectedEdgeIds,
    }),
    ...overrides,
  };
}

test('valid multi-candidate generation is bounded, private, independent, and makes no egress claim', async () => {
  const logs = [];
  let admittedPrivateRequest;
  const engine = readyEngine({ onGenerate: (request) => { admittedPrivateRequest = request; } });
  const evidenceEnricher = {
    identity: 'm7-independent-evidence',
    async enrich({ searchResult, candidateBindings }) {
      const bindingByCandidateId = Object.fromEntries(candidateBindings.map((binding) => [
        binding.candidateId, binding,
      ]));
      return {
        status: 'ready',
        evidenceArtifactIdentity: EVIDENCE_ARTIFACT_IDENTITY,
        candidateEvidence: Object.fromEntries(searchResult.candidateFacts.map(({ candidateId }) => [
          candidateId,
          allAvailableDimensions(),
        ])),
        candidateCoverage: Object.fromEntries(searchResult.candidateFacts.map(({ candidateId }) => [
          candidateId,
          coverageForBinding(bindingByCandidateId[candidateId]),
        ])),
      };
    },
  };
  const companion = createLocalRouteCompanion({
    engineAdapter: engine,
    evidenceEnricher,
    logger: (entry) => logs.push(entry),
  });

  const result = await companion.generate(privateRequest());
  assert.equal(result.status, 'ready');
  assert.equal(result.candidateDisposition, 'alternatives');
  assert.equal(result.candidateCount, 2);
  assert.equal(result.candidates.length, 2);
  assert.match(result.candidates[0].topologyIdentity, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(result.candidates[0].topologyIdentity, result.candidates[1].topologyIdentity);
  assert.equal(result.candidates[0].evidence.crime.status, 'available');
  assert.deepEqual(result.candidates[0].evidenceCoverage, {
    status: 'available',
    coveredSegmentCount: 2,
    totalSegmentCount: 2,
    receiptIdentity: deriveEvidenceCoverageReceiptIdentity({
      evidenceArtifactIdentity: EVIDENCE_ARTIFACT_IDENTITY,
      topologyIdentity: result.candidates[0].topologyIdentity,
      routeDirectedEdgeIds: ['a-b', 'b-d'],
      coveredDirectedEdgeIds: ['a-b', 'b-d'],
    }),
    reasonCode: null,
  });
  assert.equal(result.engine.identity, 'm7-in-process-engine');
  assert.equal(result.engine.identityClaimStatus, 'caller-provided-unverified');
  assert.equal(result.evidence.identity, 'm7-independent-evidence');
  assert.equal(result.evidence.identityClaimStatus, 'caller-provided-unverified');
  assert.ok(Object.values(result.evidence.authority).every((value) => value === false));
  assert.deepEqual(result.privacy, {
    egressObservationStatus: 'unverified',
    privacyEgressCount: null,
    blockedNonLoopbackCount: 0,
    blockedPrivateUrlCount: 0,
    loopbackRequestCount: 0,
    inProcessRequestCount: 1,
    stdioRequestCount: 0,
  });
  assert.equal(admittedPrivateRequest.origin.longitude, ORIGIN_SENTINEL);
  assert.equal(Object.isFrozen(admittedPrivateRequest.origin), true);

  const serialized = JSON.stringify({ result, logs });
  assert.doesNotMatch(serialized, new RegExp(String(ORIGIN_SENTINEL).replace('.', '\\.')));
  assert.doesNotMatch(serialized, new RegExp(String(DESTINATION_SENTINEL).replace('.', '\\.')));
  assert.doesNotMatch(serialized, /longitude|latitude|geometry/i);
  assert.ok(logs.every((entry) => Object.keys(entry).join(',') === 'category'));
});

test('a single returned route is explicitly single and never presented as alternatives', async () => {
  const companion = createLocalRouteCompanion({
    engineAdapter: readyEngine({
      requestedCandidateCount: 3,
      graph: graphArtifact({
        edges: [
          edge('a-b', 'a', 'b', 100, 1),
          edge('b-d', 'b', 'd', 100, 1),
          edge('a-c', 'a', 'c', 130, 2),
        ],
      }),
      transport: { kind: 'loopback', endpoint: 'http://127.0.0.1:43123/v1/routes' },
    }),
  });
  const result = await companion.generate(privateRequest());
  assert.equal(result.status, 'ready');
  assert.equal(result.candidateDisposition, 'single');
  assert.equal(result.candidateCount, 1);
  assert.equal(result.privacy.loopbackRequestCount, 1);
  assert.equal(result.privacy.privacyEgressCount, null);
});

test('route identity follows the complete directed edge sequence rather than candidate rank', async () => {
  const first = await createLocalRouteCompanion({
    engineAdapter: readyEngine({ requestedCandidateCount: 1 }),
  }).generate(privateRequest());
  const second = await createLocalRouteCompanion({
    engineAdapter: readyEngine({
      requestedCandidateCount: 1,
      graph: graphArtifact({
        edges: [
          edge('a-c', 'a', 'c', 130, 1),
          edge('c-d', 'c', 'd', 130, 1),
          edge('a-b', 'a', 'b', 100, 2),
          edge('b-d', 'b', 'd', 100, 2),
        ],
      }),
    }),
  }).generate(privateRequest());
  assert.equal(first.candidates[0].candidateId, 'candidate:1');
  assert.equal(second.candidates[0].candidateId, 'candidate:1');
  assert.notEqual(first.candidates[0].topologyIdentity, second.candidates[0].topologyIdentity);
});

test('engine unavailable requires Known Route paste/draw fallback', async () => {
  const companion = createLocalRouteCompanion({
    engineAdapter: createUnavailableEngineAdapter(),
  });
  const result = await companion.generate(privateRequest());
  assert.equal(result.status, 'unavailable');
  assert.equal(result.fallback, 'known-route-paste-draw-required');
  assert.equal(result.candidateDisposition, 'none');
  assert.equal(result.candidateCount, 0);
  assert.equal(result.privacy.privacyEgressCount, null);
});

test('in-process OSRM adapter keeps coordinates out of URLs and projects into bounded search', async () => {
  let observedOptions;
  const adapter = createInProcessOsrmEngineAdapter({
    identity: 'm7-in-process-osrm',
    osrm: {
      route(options, callback) {
        observedOptions = options;
        callback(null, { code: 'Ok', routes: [{ weight: 2 }] });
      },
    },
    projectRouteContext(result, context) {
      assert.equal(result.code, 'Ok');
      assert.deepEqual(context, {
        requestId: 'm7-private-request', mode: 'walk', candidateLimit: 3,
      });
      return {
        status: 'ready',
        graphArtifact: graphArtifact(),
        searchRequest: searchRequest(2),
        edgeObservationsByEdgeId: {},
      };
    },
  });
  const result = await createLocalRouteCompanion({ engineAdapter: adapter })
    .generate(privateRequest());
  assert.equal(result.status, 'ready');
  assert.equal(result.engine.transportKind, 'in-process');
  assert.deepEqual(observedOptions.coordinates, [
    [ORIGIN_SENTINEL, 39.950001],
    [-75.170001, DESTINATION_SENTINEL],
  ]);
  assert.equal(Object.isFrozen(observedOptions.coordinates), true);
  assert.doesNotMatch(JSON.stringify(result), /-75\.165222|39\.952583/);
});

test('duplicate graph identity and invalid search input fail closed without candidates', async () => {
  const duplicateGraph = graphArtifact({
    edges: [
      edge('duplicate', 'a', 'b', 100, 1),
      edge('duplicate', 'b', 'd', 100, 1),
    ],
  });
  const duplicateResult = await createLocalRouteCompanion({
    engineAdapter: readyEngine({ graph: duplicateGraph }),
  }).generate(privateRequest());
  assert.equal(duplicateResult.status, 'invalid');
  assert.equal(duplicateResult.candidateCount, 0);
  assert.equal(duplicateResult.fallback, 'known-route-paste-draw-required');

  const invalidRequestEngine = readyEngine();
  invalidRequestEngine.generate = async () => ({
    status: 'ready',
    graphArtifact: graphArtifact(),
    searchRequest: { ...searchRequest(), mode: 'drive' },
    edgeObservationsByEdgeId: {},
  });
  const invalidResult = await createLocalRouteCompanion({
    engineAdapter: invalidRequestEngine,
  }).generate(privateRequest());
  assert.equal(invalidResult.status, 'invalid');
  assert.equal(invalidResult.candidateCount, 0);
  assert.equal(invalidResult.privacy.privacyEgressCount, null);
});

test('non-loopback and coordinate-bearing URL targets are blocked before adapter invocation', async () => {
  for (const [transport, expectedCounter] of [
    [{ kind: 'network', endpoint: 'https://routing.example/v1/routes' }, 'blockedNonLoopbackCount'],
    [{ kind: 'loopback', endpoint: 'http://127.1:43123/v1/routes' }, 'blockedPrivateUrlCount'],
    [{ kind: 'loopback', endpoint: 'http://127.0.0.1:43123/route/-75.1,39.9;-75.2,39.8' }, 'blockedPrivateUrlCount'],
    [{ kind: 'loopback', endpoint: 'http://127.0.0.1:43123/v1/routes?origin=private' }, 'blockedPrivateUrlCount'],
  ]) {
    let calls = 0;
    const result = await createLocalRouteCompanion({
      engineAdapter: readyEngine({ transport, onGenerate: () => { calls += 1; } }),
    }).generate(privateRequest());
    assert.equal(calls, 0);
    assert.equal(result.status, 'blocked');
    assert.equal(result.privacy.privacyEgressCount, null);
    assert.equal(result.privacy[expectedCounter], 1);
    assert.equal(result.fallback, 'known-route-paste-draw-required');
  }
});

test('missing and ambiguous evidence fail closed per dimension with null values', async () => {
  const companion = createLocalRouteCompanion({
    engineAdapter: readyEngine({ requestedCandidateCount: 1 }),
    evidenceEnricher: {
      identity: 'm7-partial-evidence',
      async enrich({ searchResult }) {
        return {
          status: 'ready',
          candidateEvidence: {
            [searchResult.candidateFacts[0].candidateId]: allAvailableDimensions({
              crime: { status: 'ambiguous', value: 99, receiptIdentity: 'ambiguous-receipt' },
              crash: { status: 'unavailable', value: null, receiptIdentity: null },
            }),
          },
        };
      },
    },
  });
  const result = await companion.generate(privateRequest());
  const dimensions = result.candidates[0].evidence;
  assert.deepEqual(dimensions.crime, {
    status: 'unavailable', value: null, receiptIdentity: null, reasonCode: 'ambiguous-evidence',
  });
  assert.deepEqual(dimensions.crash, {
    status: 'unavailable', value: null, receiptIdentity: null, reasonCode: 'evidence-unavailable',
  });
  assert.equal(dimensions.accessibility.status, 'available');

  const missing = await createLocalRouteCompanion({
    engineAdapter: readyEngine({ requestedCandidateCount: 1 }),
  }).generate(privateRequest());
  assert.ok(Object.values(missing.candidates[0].evidence).every(
    (dimension) => dimension.status === 'unavailable' && dimension.value === null,
  ));
  assert.equal(missing.candidates[0].evidenceCoverage.status, 'unavailable');
  assert.equal(missing.candidates[0].evidenceCoverage.coveredSegmentCount, null);
});

test('coverage rejects routes, denominators, subsets, topology, and receipts that are not bound', async () => {
  const cases = [
    ['wrong denominator', { totalSegmentCount: 3 }],
    ['unknown covered edge', { coveredDirectedEdgeIds: ['a-b', 'not-on-route'] }],
    ['duplicate covered edge', { coveredDirectedEdgeIds: ['a-b', 'a-b'] }],
    ['wrong ordered route', { routeDirectedEdgeIds: ['b-d', 'a-b'] }],
    ['wrong topology', { topologyIdentity: `sha256:${'7'.repeat(64)}` }],
    ['wrong receipt', { receiptIdentity: `sha256:${'8'.repeat(64)}` }],
  ];
  for (const [label, overrides] of cases) {
    const companion = createLocalRouteCompanion({
      engineAdapter: readyEngine({ requestedCandidateCount: 1 }),
      evidenceEnricher: {
        identity: `m7-invalid-coverage-${label.replaceAll(' ', '-')}`,
        async enrich({ candidateBindings }) {
          const [binding] = candidateBindings;
          return {
            status: 'ready',
            evidenceArtifactIdentity: EVIDENCE_ARTIFACT_IDENTITY,
            candidateEvidence: { [binding.candidateId]: allAvailableDimensions() },
            candidateCoverage: {
              [binding.candidateId]: coverageForBinding(binding, overrides),
            },
          };
        },
      },
    });
    const result = await companion.generate(privateRequest());
    assert.deepEqual(result.candidates[0].evidenceCoverage, {
      status: 'unavailable',
      coveredSegmentCount: null,
      totalSegmentCount: null,
      receiptIdentity: null,
      reasonCode: 'evidence-coverage-unavailable',
    }, label);
    assert.doesNotMatch(JSON.stringify(result), /a-b|b-d|not-on-route/, label);
  }
});

test('strict request and independent adapter contracts reject drift', async () => {
  const companion = createLocalRouteCompanion({ engineAdapter: readyEngine() });
  await assert.rejects(
    companion.generate({ ...privateRequest(), geometry: [] }),
    /schema mismatch/,
  );
  await assert.rejects(
    companion.generate(privateRequest({ mode: 'drive' })),
    /walk mode only/,
  );
  assert.throws(
    () => createLocalRouteCompanion({
      engineAdapter: readyEngine({ identity: 'same-source' }),
      evidenceEnricher: { identity: 'same-source', async enrich() {} },
    }),
    /must be independent/,
  );
});

test('engine and evidence work are bounded by abortable deadlines', async () => {
  let engineSignal = null;
  const engineResult = await createLocalRouteCompanion({
    engineAdapter: {
      identity: 'm7-hung-engine',
      transport: { kind: 'in-process' },
      async generate(_request, { signal }) {
        engineSignal = signal;
        return new Promise(() => {});
      },
    },
    engineTimeoutMs: 20,
  }).generate(privateRequest());
  assert.equal(engineResult.status, 'unavailable');
  assert.equal(engineSignal.aborted, true);

  let evidenceSignal = null;
  const evidenceResult = await createLocalRouteCompanion({
    engineAdapter: readyEngine({ requestedCandidateCount: 1 }),
    evidenceEnricher: {
      identity: 'm7-hung-evidence',
      async enrich(_context, { signal }) {
        evidenceSignal = signal;
        return new Promise(() => {});
      },
    },
    evidenceTimeoutMs: 20,
  }).generate(privateRequest());
  assert.equal(evidenceResult.status, 'ready');
  assert.equal(evidenceSignal.aborted, true);
  assert.ok(Object.values(evidenceResult.candidates[0].evidence).every(
    (dimension) => dimension.status === 'unavailable',
  ));
});

test('core has no hosted transport, persistence, telemetry, or M5 activation seam', async () => {
  const source = await readFile(
    new URL('../../src/route_generation/local_companion/index.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(source, /route_alternatives_m5|route-alternatives-m5/i);
  assert.doesNotMatch(source, /telemetry|analytics|hosted.backend/i);
});
