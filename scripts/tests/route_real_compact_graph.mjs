import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as compilerModule from '../lib/route_real_compact_graph/compiler.mjs';
import * as contractModule from '../../src/route_generation/real_compact_graph/contract_v1.js';
import {
  canonicalStringify,
  contentIdentity,
} from '../../src/route_generation/real_compact_graph/canonical_v1.js';
import { REAL_COMPACT_JSON_LIMITS } from '../../src/route_generation/real_compact_graph/strict_json_v1.js';

const {
  compileAdmittedRealCompactGraph,
  compileSyntheticConstructionObservation,
  parseAdmittedRealCompactGraphArtifact,
} = compilerModule;
const {
  parseSyntheticConstructionObservation,
  REAL_COMPACT_GRAPH_CANONICALIZATIONS,
  REAL_COMPACT_GRAPH_DEPENDENCY_STATUS,
  REAL_COMPACT_GRAPH_SCHEMA_VERSIONS,
  SYNTHETIC_CONSTRUCTION_ELIGIBLE_CLAIMS,
  SYNTHETIC_CONSTRUCTION_LIMITATIONS,
} = contractModule;

const FIXTURE_URL = new URL(
  '../fixtures/route-real-compact-graph/synthetic_construction_input.json',
  import.meta.url,
);
const SUMMARY_URL = new URL(
  '../fixtures/route-real-compact-graph/expected_construction_summary.json',
  import.meta.url,
);
const DEPENDENCY_UNAVAILABLE = /dependency-contract-unavailable and authority-unavailable:.*RD-B.*RD-C.*owner registry is empty; caller Source Health current.*cannot increase authority/;

function fixtureText() {
  return readFileSync(FIXTURE_URL, 'utf8');
}

function fixtureValue() {
  return JSON.parse(fixtureText());
}

function expectedSummary() {
  return JSON.parse(readFileSync(SUMMARY_URL, 'utf8'));
}

function serialize(value) {
  return JSON.stringify(value);
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function observationSummary(observation) {
  const dependencyKinds = [
    'source',
    'acquisition',
    'profile',
    'boundary',
    'tool',
    'build',
    'authorization',
  ];
  return {
    schemaVersion: observation.schemaVersion,
    dataClassification: observation.dataClassification,
    fixtureInputDigest: observation.fixtureInputIdentity.digest,
    observationDigest: observation.observationIdentity.digest,
    candidateDigest: observation.graphProjection.identities.candidate.digest,
    topologyDigest: observation.graphProjection.identities.topology.digest,
    geometryDigest: observation.graphProjection.identities.geometry.digest,
    dependencyPlaceholderDigests: Object.fromEntries(
      dependencyKinds.map((kind) => [
        kind,
        observation.dependencyPlaceholderBindings[kind].contentIdentity.digest,
      ]),
    ),
    counts: observation.graphProjection.counts,
    adjacency: observation.graphProjection.adjacency,
    componentsByNodeIndex: observation.graphProjection.components.byNodeIndex,
    edgeCosts: observation.graphProjection.edges.map((edge) => edge.cost),
    costSemantics: observation.graphProjection.encoding.integerCostSemantics.cost,
    productionBridgeStatus: observation.compiler.productionBridgeStatus,
    productionAuthorityState: observation.compiler.productionAuthorityState,
    sourceHealthCurrentClaimAllowed: observation.sourceHealthBoundary.currentClaimAllowed,
    sourceHealthCatalogMutationAuthorized:
      observation.sourceHealthBoundary.catalogMutationAuthorized,
    databaseLicenseRequirement:
      observation.licenceBoundary.realArtifactDatabaseLicenseRequirement,
    attributionText: observation.licenceBoundary.attributionText,
    materializationStatus: observation.materialization.status,
  };
}

test('one exact synthetic construction fixture deterministically proves non-real mechanics only', () => {
  const first = compileSyntheticConstructionObservation(fixtureText());
  const second = compileSyntheticConstructionObservation(fixtureText());

  assert.equal(first.serializedObservation, second.serializedObservation);
  assert.deepEqual(observationSummary(first.observation), expectedSummary());
  assert.equal(first.observation.dataClassification, 'synthetic-construction-only');
  assert.equal(first.observation.compiler.productionBridgeStatus, 'dependency-contract-unavailable');
  assert.equal(first.observation.compiler.productionAuthorityState, 'authority-unavailable');
  assert.equal(first.observation.sourceHealthBoundary.currentClaimAllowed, false);
  assert.equal(first.observation.sourceHealthBoundary.catalogMutationAuthorized, false);
  assert.equal(first.observation.licenceBoundary.appliesToFixture, false);
  assert.equal(first.observation.materialization.artifactPath, null);
  assert.deepEqual(
    first.observation.claimBoundary.eligibleClaims,
    SYNTHETIC_CONSTRUCTION_ELIGIBLE_CLAIMS,
  );
  assert.deepEqual(
    first.observation.claimBoundary.limitations,
    SYNTHETIC_CONSTRUCTION_LIMITATIONS,
  );
  assert.doesNotMatch(first.serializedObservation, /real-osm-owner-admitted|GraphArtifact\/v1/);
  assertDeepFrozen(first);
});

test('conversion is mechanically route-graph-candidate/v1 with one integer-millimetre cost', () => {
  const fixture = fixtureValue();
  const { observation, serializedObservation } = compileSyntheticConstructionObservation(
    fixtureText(),
  );
  const candidate = fixture.routeGraphCandidate;
  const graph = observation.graphProjection;

  assert.equal(candidate.schema, 'route-graph-candidate/v1');
  assert.deepEqual(Object.keys(candidate.edges[0]), [
    'id',
    'sourceEdgeId',
    'fromNodeId',
    'toNodeId',
    'cost',
    'geometry',
    'traversal',
    'sourceDirection',
  ]);
  assert.deepEqual(graph.encoding.integerCostSemantics, {
    cost: 'non-negative-safe-integer-millimetres',
  });
  assert.equal(
    graph.encoding.additionalCostDimensions,
    'forbidden-without-separate-reviewed-profile-and-identity',
  );
  assert.deepEqual(graph.edges.map((edge) => edge.cost), [85000, 85000, 85000, 85000]);
  assert.equal(graph.identities.topology.digest, candidate.topologyIdentity);
  assert.equal(graph.identities.geometry.digest, candidate.geometryIdentity);
  assert.doesNotMatch(serializedObservation, /durationMs|objectiveCostUnits/);
});

test('compact projection preserves topology, geometry, counts, components, and adjacency', () => {
  const { graphProjection: graph } = compileSyntheticConstructionObservation(
    fixtureText(),
  ).observation;

  assert.deepEqual(graph.adjacency, {
    offsets: [0, 0, 1, 2, 3, 4],
    edgeIndexes: [0, 2, 3, 1],
  });
  assert.deepEqual(graph.components, {
    kind: 'weakly-connected',
    count: 2,
    byNodeIndex: [0, 0, 1, 1, 1],
    nodeCounts: [2, 3],
  });
  assert.deepEqual(graph.counts, {
    physicalFeatureCount: 3,
    excludedAccessCount: 0,
    nodeCount: 5,
    directedEdgeCount: 4,
    weakComponentCount: 2,
    largestWeakComponentNodeCount: 3,
    selfLoopCount: 0,
    zeroCostEdgeCount: 0,
    geometryPointCount: 10,
    isolatedNodeCount: 0,
  });
  assert.deepEqual(graph.edges.map((edge) => [
    edge.fromNodeIndex,
    edge.toNodeIndex,
    edge.componentId,
    edge.geometryIndex,
  ]), [
    [1, 0, 0, 0],
    [4, 3, 1, 1],
    [2, 4, 1, 2],
    [3, 4, 1, 3],
  ]);
  assert.equal(graph.topologyAudit.status, 'passed');
});

test('observation parser independently checks canonical sha256 and graph identity drift', () => {
  const { observation, serializedObservation } = compileSyntheticConstructionObservation(
    fixtureText(),
  );
  const parsed = parseSyntheticConstructionObservation(serializedObservation);
  const projection = structuredClone(observation);
  delete projection.observationIdentity;
  const canonical = canonicalStringify(projection);
  const digest = `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;

  assert.equal(observation.observationIdentity.canonicalUtf8Bytes, Buffer.byteLength(canonical));
  assert.equal(observation.observationIdentity.digest, digest);
  assert.deepEqual(parsed, observation);
  assertDeepFrozen(parsed);

  const adjacencyDrift = JSON.parse(serializedObservation);
  adjacencyDrift.graphProjection.adjacency.offsets[1] = 1;
  assert.throws(
    () => parseSyntheticConstructionObservation(serialize(adjacencyDrift)),
    /topology, geometry, one-cost values, counts, components, adjacency, or identities drifted/,
  );

  const topologyDrift = JSON.parse(serializedObservation);
  topologyDrift.graphProjection.identities.topology.digest = `sha256:${'0'.repeat(64)}`;
  assert.throws(
    () => parseSyntheticConstructionObservation(serialize(topologyDrift)),
    /topologyIdentity drifted/,
  );
});

test('public success exports expose only primitive-JSON compiler and parser entries', () => {
  const rawObjectApis = [
    'admitRouteGraphCandidateMechanicsValue',
    'compileRouteGraphCandidateProjection',
    'admitSyntheticConstructionFixtureValue',
    'buildSyntheticConstructionObservation',
    'syntheticFixtureIdentityFor',
    'validateGraphProjectionValue',
    'parseSyntheticConstructionFixture',
    'canonicalRealCompactJson',
    'freezeRealCompactValue',
  ];
  for (const api of rawObjectApis) assert.equal(Object.hasOwn(contractModule, api), false, api);
  assert.deepEqual(
    Object.entries(contractModule)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort(),
    ['compileSyntheticConstructionObservation', 'parseSyntheticConstructionObservation'],
  );
  assert.deepEqual(
    Object.entries(compilerModule)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort(),
    [
      'compileAdmittedRealCompactGraph',
      'compileSyntheticConstructionObservation',
      'parseAdmittedRealCompactGraphArtifact',
    ],
  );
  assert.equal(
    compilerModule.compileSyntheticConstructionObservation,
    contractModule.compileSyntheticConstructionObservation,
  );
});

test('every public success entry rejects hostile raw values without invoking traps', () => {
  let trapCalls = 0;
  const proxy = new Proxy({}, {
    get() { trapCalls += 1; return undefined; },
    getOwnPropertyDescriptor() { trapCalls += 1; return undefined; },
    getPrototypeOf() { trapCalls += 1; return Object.prototype; },
    has() { trapCalls += 1; return false; },
    ownKeys() { trapCalls += 1; return []; },
  });
  const getter = {};
  Object.defineProperty(getter, 'schemaVersion', {
    enumerable: true,
    get() { trapCalls += 1; return REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticFixture; },
  });
  const hostileDescriptor = {};
  Object.defineProperty(hostileDescriptor, 'schemaVersion', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticFixture,
  });
  const sparse = new Array(2);
  sparse[1] = 'value';
  const publicEntries = [
    ...Object.entries(contractModule),
    ...Object.entries(compilerModule),
  ].filter(([, value]) => typeof value === 'function');
  for (const input of [
    {},
    proxy,
    getter,
    hostileDescriptor,
    { [Symbol('brand')]: 'caller' },
    sparse,
    Object.freeze({}),
    new String('{}'),
    null,
  ]) {
    for (const [name, entry] of publicEntries) {
      assert.throws(() => entry(input), /primitive JSON text/, name);
    }
  }
  assert.equal(trapCalls, 0);
});

test('strict parser rejects duplicate/blocked keys, unsafe numbers, depth, and size attacks', () => {
  assert.throws(
    () => compileSyntheticConstructionObservation(
      '{"schemaVersion":"a","schemaVersion":"b"}',
    ),
    /duplicate JSON object key schemaVersion/,
  );
  assert.throws(
    () => compileSyntheticConstructionObservation('{"__proto__":{}}'),
    /JSON object key __proto__ is prohibited/,
  );
  assert.throws(
    () => compileSyntheticConstructionObservation('{"value":1.5}'),
    /JSON numbers must be safe integers/,
  );
  const depth = REAL_COMPACT_JSON_LIMITS.maxDepth + 2;
  assert.throws(
    () => compileSyntheticConstructionObservation(`${'['.repeat(depth)}0${']'.repeat(depth)}`),
    /supported nesting depth/,
  );
  assert.throws(
    () => compileSyntheticConstructionObservation(
      ' '.repeat(REAL_COMPACT_JSON_LIMITS.maxCodeUnits + 1),
    ),
    /JSON text length is outside the supported range/,
  );
});

test('wrong sorting, stable ids, geometry, cost, counts, and candidate identities fail closed', () => {
  const wrongOrder = fixtureValue();
  wrongOrder.routeGraphCandidate.nodes.reverse();
  assert.throws(
    () => compileSyntheticConstructionObservation(serialize(wrongOrder)),
    /strict id code-unit order/,
  );

  const wrongId = fixtureValue();
  wrongId.routeGraphCandidate.nodes[0].id = `node:${'0'.repeat(64)}`;
  assert.throws(
    () => compileSyntheticConstructionObservation(serialize(wrongId)),
    /deterministic route-graph-candidate\/v1 node id/,
  );

  const wrongGeometry = fixtureValue();
  wrongGeometry.routeGraphCandidate.edges[0].geometry[0][0] += 1;
  assert.throws(
    () => compileSyntheticConstructionObservation(serialize(wrongGeometry)),
    /geometry endpoints must exactly match/,
  );

  const negativeCost = fixtureValue();
  negativeCost.routeGraphCandidate.edges[0].cost = -1;
  assert.throws(
    () => compileSyntheticConstructionObservation(serialize(negativeCost)),
    /cost must be a non-negative safe integer/,
  );

  const wrongCount = fixtureValue();
  wrongCount.routeGraphCandidate.counts.directedEdgeCount = 5;
  assert.throws(
    () => compileSyntheticConstructionObservation(serialize(wrongCount)),
    /directedEdgeCount must match the recomputed candidate mechanics/,
  );

  const identityDrift = fixtureValue();
  identityDrift.routeGraphCandidate.topologyIdentity = `sha256:${'0'.repeat(64)}`;
  assert.throws(
    () => compileSyntheticConstructionObservation(serialize(identityDrift)),
    /topologyIdentity drifted/,
  );
});

test('invented duration/objective dimensions are rejected instead of silently normalized', () => {
  for (const field of ['durationMs', 'objectiveCostUnits']) {
    const invented = fixtureValue();
    invented.routeGraphCandidate.edges[0][field] = 1;
    assert.throws(
      () => compileSyntheticConstructionObservation(serialize(invented)),
      new RegExp(`route graph candidate\\.edges\\[0\\] schema mismatch.*${field}`),
    );
  }
});

test('only the exact mechanics fixture is accepted and caller authority fields are forbidden', () => {
  const driftedButStructurallyValid = fixtureValue();
  driftedButStructurallyValid.routeGraphCandidate.limitations.push(
    'Caller-added but structurally valid synthetic limitation.',
  );
  assert.throws(
    () => compileSyntheticConstructionObservation(serialize(driftedButStructurallyValid)),
    /not the one exact accepted mechanics fixture/,
  );

  for (const field of ['hash', 'reviewedBy', 'brand']) {
    const forged = fixtureValue();
    forged[field] = 'caller-authored';
    assert.throws(
      () => compileSyntheticConstructionObservation(serialize(forged)),
      new RegExp(`schema mismatch.*${field}`),
    );
  }
});

test('compile and parse share one exact fixture digest root against fully recomputed forgeries', () => {
  const expectedDigest = expectedSummary().fixtureInputDigest;
  const valid = compileSyntheticConstructionObservation(fixtureText());
  const parsed = parseSyntheticConstructionObservation(valid.serializedObservation);
  assert.equal(valid.observation.fixtureInputIdentity.digest, expectedDigest);
  assert.equal(parsed.fixtureInputIdentity.digest, expectedDigest);

  const limitation = 'Caller-added but structurally valid synthetic limitation.';
  const alteredFixture = fixtureValue();
  alteredFixture.routeGraphCandidate.limitations.push(limitation);
  const alteredFixtureIdentity = contentIdentity(
    alteredFixture,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticFixtureIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.syntheticFixture,
  );
  assert.notEqual(alteredFixtureIdentity.digest, expectedDigest);
  assert.throws(
    () => compileSyntheticConstructionObservation(canonicalStringify(alteredFixture)),
    new RegExp(`not the one exact accepted mechanics fixture.*${expectedDigest}`),
  );

  const forgedObservation = JSON.parse(valid.serializedObservation);
  forgedObservation.graphProjection.candidateLimitations.push(limitation);
  forgedObservation.graphProjection.identities.candidate = contentIdentity(
    alteredFixture.routeGraphCandidate,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.candidateIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.candidate,
  );
  forgedObservation.fixtureInputIdentity = alteredFixtureIdentity;
  const observationProjection = { ...forgedObservation };
  delete observationProjection.observationIdentity;
  forgedObservation.observationIdentity = contentIdentity(
    observationProjection,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticObservationIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.syntheticObservation,
  );
  assert.throws(
    () => parseSyntheticConstructionObservation(canonicalStringify(forgedObservation)),
    new RegExp(`not the one exact accepted mechanics fixture.*${expectedDigest}`),
  );
});

test('caller current and self-consistent admission JSON cannot cross the unavailable B/C bridge', () => {
  assert.deepEqual(REAL_COMPACT_GRAPH_DEPENDENCY_STATUS, {
    schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.dependencyBridgeStatus,
    status: 'dependency-contract-unavailable',
    rdB: {
      requiredSchema: 'route-graph-candidate/v1',
      requiredSemantics: 'accepted-exact-one-integer-millimetre-cost-contract',
      acceptedContractInstalled: false,
    },
    rdC: {
      requiredReceipt: 'accepted-exact-versioned-authorization-proposal-receipt',
      requiredBindings: [
        'authorization-identity',
        'evidence-identity',
        'admission-identity',
        'normalized-graph-identity',
      ],
      acceptedContractInstalled: false,
      ownerRegistry: 'empty',
      authorityState: 'authority-unavailable',
    },
    sourceHealth: {
      catalogMutationAuthorized: false,
      currentClaimAllowed: false,
      callerCurrentCanIncreaseAuthority: false,
    },
  });
  assertDeepFrozen(REAL_COMPACT_GRAPH_DEPENDENCY_STATUS);
  assert.equal(Object.hasOwn(REAL_COMPACT_GRAPH_SCHEMA_VERSIONS, 'compilerInput'), false);
  assert.equal(Object.hasOwn(REAL_COMPACT_GRAPH_SCHEMA_VERSIONS, 'artifact'), false);

  assert.throws(() => compileAdmittedRealCompactGraph('{}'), DEPENDENCY_UNAVAILABLE);

  const callerCurrent = {
    sourceHealth: { state: 'current', currentClaimAllowed: true },
  };
  assert.throws(
    () => compileAdmittedRealCompactGraph(serialize(callerCurrent)),
    DEPENDENCY_UNAVAILABLE,
  );

  const callerRecords = Object.fromEntries([
    'authorization', 'evidence', 'admission', 'normalized-graph',
  ].map((kind) => {
    const record = { schemaVersion: `caller-${kind}/v1`, decision: 'admitted' };
    return [kind, {
      record,
      identity: contentIdentity(
        record,
        REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.candidateIdentity,
        REAL_COMPACT_GRAPH_CANONICALIZATIONS.candidate,
      ),
    }];
  }));
  const selfConsistentAdmission = {
    schemaVersion: 'caller-rd-c-authorization/v1',
    reviewedBy: 'caller',
    sourceHealth: { state: 'current' },
    bindings: callerRecords,
  };
  assert.throws(
    () => compileAdmittedRealCompactGraph(serialize(selfConsistentAdmission)),
    DEPENDENCY_UNAVAILABLE,
  );

  const syntheticObservation = compileSyntheticConstructionObservation(fixtureText());
  assert.throws(
    () => parseAdmittedRealCompactGraphArtifact(syntheticObservation.serializedObservation),
    DEPENDENCY_UNAVAILABLE,
  );
});

test('synthetic observation cannot drift into real, current, materialized, or public claims', () => {
  const { serializedObservation } = compileSyntheticConstructionObservation(fixtureText());

  const healthDrift = JSON.parse(serializedObservation);
  healthDrift.sourceHealthBoundary.currentClaimAllowed = true;
  assert.throws(
    () => parseSyntheticConstructionObservation(serialize(healthDrift)),
    /cannot claim Source Health current or mutation authority/,
  );

  const dependencyDrift = JSON.parse(serializedObservation);
  dependencyDrift.dependencyStatus.status = 'available';
  assert.throws(
    () => parseSyntheticConstructionObservation(serialize(dependencyDrift)),
    /production dependency status drifted/,
  );

  const attributionDrift = JSON.parse(serializedObservation);
  attributionDrift.licenceBoundary.attributionText = 'Open map data';
  assert.throws(
    () => parseSyntheticConstructionObservation(serialize(attributionDrift)),
    /licence and attribution boundary drifted/,
  );

  const materializationDrift = JSON.parse(serializedObservation);
  materializationDrift.materialization.status = 'publishable';
  assert.throws(
    () => parseSyntheticConstructionObservation(serialize(materializationDrift)),
    /materialization or rebuild boundary drifted/,
  );

  const claimDrift = JSON.parse(serializedObservation);
  claimDrift.claimBoundary.classification = 'real';
  assert.throws(
    () => parseSyntheticConstructionObservation(serialize(claimDrift)),
    /claim boundary drifted/,
  );

  const authorizationDrift = JSON.parse(serializedObservation);
  authorizationDrift.dependencyPlaceholderBindings.authorization.contentIdentity.digest =
    `sha256:${'0'.repeat(64)}`;
  assert.throws(
    () => parseSyntheticConstructionObservation(serialize(authorizationDrift)),
    /dependency placeholder identities drifted/,
  );
});
