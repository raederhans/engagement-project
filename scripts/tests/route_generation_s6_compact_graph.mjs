import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { compileSyntheticCompactGraph } from '../lib/route_s6_compact_graph/compiler.mjs';
import {
  COMPACT_GRAPH_CANONICALIZATIONS,
  COMPACT_GRAPH_ELIGIBLE_CLAIMS,
  COMPACT_GRAPH_LIMITATIONS,
  COMPACT_GRAPH_SCHEMA_VERSIONS,
  parseCompactDirectedGraphArtifact,
  parseSyntheticCompactGraphBundle,
  parseSyntheticCompactGraphManifest,
} from '../../src/route_generation/compact_graph/contract_v1.js';
import {
  canonicalStringify,
  contentIdentity,
} from '../../src/route_generation/compact_graph/canonical_v1.js';

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/route-s6-compact-graph/', import.meta.url));
const CONTRACT_DIR = fileURLToPath(new URL(
  '../../src/route_generation/compact_graph/',
  import.meta.url,
));
const FIXTURE_ID = 'synthetic-s6-compact-two-components';

function fixtureText(name) {
  return readFileSync(new URL(`../fixtures/route-s6-compact-graph/${name}`, import.meta.url), 'utf8')
    .trim();
}

function sourceFixture() {
  return JSON.parse(fixtureText('synthetic_graph_artifact.json'));
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function freezeData(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeData(child, seen);
  return Object.freeze(value);
}

function withArtifactIdentity(artifact) {
  const projection = structuredClone(artifact);
  delete projection.contentIdentity;
  return {
    ...projection,
    contentIdentity: contentIdentity(
      projection,
      COMPACT_GRAPH_SCHEMA_VERSIONS.artifactIdentity,
      COMPACT_GRAPH_CANONICALIZATIONS.artifact,
    ),
  };
}

function withManifestIdentity(manifest) {
  const projection = structuredClone(manifest);
  delete projection.manifestIdentity;
  return {
    ...projection,
    manifestIdentity: contentIdentity(
      projection,
      COMPACT_GRAPH_SCHEMA_VERSIONS.manifestIdentity,
      COMPACT_GRAPH_CANONICALIZATIONS.manifest,
    ),
  };
}

test('compiler deterministically emits the frozen synthetic artifact and manifest fixtures', () => {
  const firstSource = sourceFixture();
  const secondSource = sourceFixture();
  const first = compileSyntheticCompactGraph(firstSource, FIXTURE_ID);
  const second = compileSyntheticCompactGraph(secondSource, FIXTURE_ID);

  assert.equal(first.serializedArtifact, fixtureText('expected_compact_graph.json'));
  assert.equal(first.serializedManifest, fixtureText('expected_manifest.json'));
  assert.equal(first.serializedArtifact, second.serializedArtifact);
  assert.equal(first.serializedManifest, second.serializedManifest);
  assertDeepFrozen(first);

  firstSource.edges[0].distanceMm = 777;
  firstSource.nodes[0].nodeId = 'mutated-after-compile';
  assert.equal(first.artifact.edges[2].distanceMm, 0);
  assert.equal(first.artifact.nodeIds[2], 'node-c');
  assert.equal(first.serializedArtifact, fixtureText('expected_compact_graph.json'));
});

test('compact encoding preserves directed topology, integer costs, mode, components, and order', () => {
  const { artifact, manifest } = compileSyntheticCompactGraph(sourceFixture(), FIXTURE_ID);

  assert.deepEqual(artifact.nodeIds, ['node-a', 'node-b', 'node-c', 'node-x']);
  assert.deepEqual(artifact.edges, [
    {
      edgeId: 'edge-a', fromNodeIndex: 0, toNodeIndex: 1,
      distanceMm: 1000, objectiveCostUnits: 11, componentId: 0,
    },
    {
      edgeId: 'edge-m', fromNodeIndex: 1, toNodeIndex: 0,
      distanceMm: 900, objectiveCostUnits: 9, componentId: 0,
    },
    {
      edgeId: 'edge-z', fromNodeIndex: 1, toNodeIndex: 2,
      distanceMm: 0, objectiveCostUnits: 3, componentId: 0,
    },
  ]);
  assert.deepEqual(artifact.adjacency, {
    offsets: [0, 1, 3, 3, 3],
    edgeIndexes: [0, 1, 2],
  });
  assert.deepEqual(artifact.components, {
    kind: 'weakly-connected', count: 2, byNodeIndex: [0, 0, 0, 1],
  });
  assert.equal(artifact.graph.mode, 'walk');
  assert.equal(artifact.graph.directed, true);
  assert.equal(artifact.provenance.dataClassification, 'synthetic');
  assert.deepEqual(artifact.provenance.sourceIds, ['synthetic-a-source', 'synthetic-z-source']);
  assert.deepEqual(artifact.claimBoundary.eligibleClaims, COMPACT_GRAPH_ELIGIBLE_CLAIMS);
  assert.deepEqual(artifact.claimBoundary.limitations, COMPACT_GRAPH_LIMITATIONS);
  assert.deepEqual(manifest.claimBoundary, artifact.claimBoundary);
  assert.deepEqual(manifest.sourceGraph, artifact.provenance.sourceGraph);
  assert.deepEqual(manifest.compactGraph.contentIdentity, artifact.contentIdentity);
});

test('browser-safe parsers return detached deep-frozen data and bind artifact to manifest', () => {
  const artifactJson = fixtureText('expected_compact_graph.json');
  const manifestJson = fixtureText('expected_manifest.json');
  const artifact = parseCompactDirectedGraphArtifact(artifactJson);
  const manifest = parseSyntheticCompactGraphManifest(manifestJson);
  const bundle = parseSyntheticCompactGraphBundle(artifactJson, manifestJson);

  assert.notStrictEqual(bundle.artifact, artifact);
  assert.notStrictEqual(bundle.manifest, manifest);
  assertDeepFrozen(artifact);
  assertDeepFrozen(manifest);
  assertDeepFrozen(bundle);
});

test('browser content identity agrees with independent Node sha256', () => {
  const artifact = JSON.parse(fixtureText('expected_compact_graph.json'));
  const projection = { ...artifact };
  delete projection.contentIdentity;
  const canonical = canonicalStringify(projection);
  const expectedDigest = `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;

  assert.equal(artifact.contentIdentity.canonicalUtf8Bytes, Buffer.byteLength(canonical, 'utf8'));
  assert.equal(artifact.contentIdentity.digest, expectedDigest);
});

test('compiler accepts fully frozen GraphArtifact input without retaining caller references', () => {
  const frozenSource = freezeData(sourceFixture());
  const result = compileSyntheticCompactGraph(frozenSource, FIXTURE_ID);

  assert.equal(result.artifact.graph.graphId, frozenSource.graphId);
  assert.notStrictEqual(result.artifact.nodeIds, frozenSource.nodes);
  assertDeepFrozen(result);
});

test('compiler rejects Proxy input without invoking traps', () => {
  let trapCalls = 0;
  const handler = {
    getPrototypeOf() { trapCalls += 1; return Object.prototype; },
    ownKeys() { trapCalls += 1; return []; },
    getOwnPropertyDescriptor() { trapCalls += 1; return undefined; },
    isExtensible() { trapCalls += 1; return true; },
  };
  const rootProxy = new Proxy(sourceFixture(), handler);
  assert.throws(
    () => compileSyntheticCompactGraph(rootProxy, FIXTURE_ID),
    /must not be a Proxy/,
  );
  const nestedSource = sourceFixture();
  nestedSource.nodes[0] = new Proxy(nestedSource.nodes[0], handler);
  assert.throws(
    () => compileSyntheticCompactGraph(nestedSource, FIXTURE_ID),
    /must not be a Proxy/,
  );
  assert.equal(trapCalls, 0);
});

test('compiler rejects accessors, hostile descriptors, unknown fields, and cycles', () => {
  const accessor = sourceFixture();
  let getterCalls = 0;
  Object.defineProperty(accessor, 'mode', {
    configurable: true,
    enumerable: true,
    get() { getterCalls += 1; return 'walk'; },
  });
  assert.throws(
    () => compileSyntheticCompactGraph(accessor, FIXTURE_ID),
    /enumerable data property/,
  );
  assert.equal(getterCalls, 0);

  const mixedDescriptor = sourceFixture();
  Object.defineProperty(mixedDescriptor, 'mode', {
    configurable: false, enumerable: true, value: 'walk', writable: true,
  });
  assert.throws(
    () => compileSyntheticCompactGraph(mixedDescriptor, FIXTURE_ID),
    /descriptor does not match its container mode/,
  );

  const unknownField = sourceFixture();
  unknownField.runtimePointer = 'current';
  assert.throws(
    () => compileSyntheticCompactGraph(unknownField, FIXTURE_ID),
    /schema mismatch.*runtimePointer/,
  );

  const cyclic = sourceFixture();
  cyclic.nodes[0].cycle = cyclic;
  assert.throws(
    () => compileSyntheticCompactGraph(cyclic, FIXTURE_ID),
    /must not contain cycles/,
  );
});

test('compiler fails closed for non-synthetic classification, mode drift, bad components, and costs', () => {
  const nonSynthetic = sourceFixture();
  nonSynthetic.provenance.dataClassification = 'external';
  assert.throws(
    () => compileSyntheticCompactGraph(nonSynthetic, FIXTURE_ID),
    /dataClassification must be synthetic/,
  );

  const badSourceId = sourceFixture();
  badSourceId.provenance.sourceIds[0] = 'external-source';
  assert.throws(
    () => compileSyntheticCompactGraph(badSourceId, FIXTURE_ID),
    /must identify a synthetic source/,
  );

  const badMode = sourceFixture();
  badMode.mode = 'bike';
  assert.throws(() => compileSyntheticCompactGraph(badMode, FIXTURE_ID), /mode is unsupported/);

  const badComponent = sourceFixture();
  badComponent.components.byNodeId['node-c'] = 1;
  assert.throws(
    () => compileSyntheticCompactGraph(badComponent, FIXTURE_ID),
    /crosses declared components|does not match explicit topology/,
  );

  const negativeCost = sourceFixture();
  negativeCost.edges[0].objectiveCostUnits = -1;
  assert.throws(
    () => compileSyntheticCompactGraph(negativeCost, FIXTURE_ID),
    /objectiveCostUnits must be an integer/,
  );
});

test('primitive JSON boundary rejects object, Proxy, getter, and duplicate-key inputs without traps', () => {
  let trapCalls = 0;
  const proxy = new Proxy({}, {
    get() { trapCalls += 1; return undefined; },
    getPrototypeOf() { trapCalls += 1; return Object.prototype; },
  });
  const getter = {};
  Object.defineProperty(getter, 'schemaVersion', {
    enumerable: true,
    get() { trapCalls += 1; return COMPACT_GRAPH_SCHEMA_VERSIONS.artifact; },
  });
  for (const input of [{}, proxy, getter, Object.freeze({}), [], null, new String('{}')]) {
    assert.throws(() => parseCompactDirectedGraphArtifact(input), /primitive JSON text/);
  }
  assert.equal(trapCalls, 0);
  assert.throws(
    () => parseCompactDirectedGraphArtifact('{"schemaVersion":"a","schemaVersion":"b"}'),
    /duplicate JSON object key schemaVersion/,
  );
});

test('artifact tamper and unknown fields fail closed before any runtime use', () => {
  const tamperedCost = JSON.parse(fixtureText('expected_compact_graph.json'));
  tamperedCost.edges[0].distanceMm += 1;
  assert.throws(
    () => parseCompactDirectedGraphArtifact(JSON.stringify(tamperedCost)),
    /content identity does not match/,
  );

  const unknown = JSON.parse(fixtureText('expected_compact_graph.json'));
  unknown.currentPointer = 'synthetic-current';
  assert.throws(
    () => parseCompactDirectedGraphArtifact(JSON.stringify(unknown)),
    /schema mismatch.*currentPointer/,
  );

  const forgedAdjacency = JSON.parse(fixtureText('expected_compact_graph.json'));
  forgedAdjacency.adjacency.edgeIndexes = [1, 0, 2];
  const reidentified = withArtifactIdentity(forgedAdjacency);
  assert.throws(
    () => parseCompactDirectedGraphArtifact(JSON.stringify(reidentified)),
    /preserve directed outgoing topology|deterministic edge-id order/,
  );

  const relabeledSource = JSON.parse(fixtureText('expected_compact_graph.json'));
  relabeledSource.provenance.dataClassification = 'external';
  assert.throws(
    () => parseCompactDirectedGraphArtifact(JSON.stringify(withArtifactIdentity(relabeledSource))),
    /dataClassification must equal synthetic/,
  );
});

test('bundle rejects a self-consistent manifest that points at different artifact counts', () => {
  const artifactJson = fixtureText('expected_compact_graph.json');
  const manifest = JSON.parse(fixtureText('expected_manifest.json'));
  manifest.compactGraph.nodeCount = 3;
  const reidentifiedManifest = withManifestIdentity(manifest);
  const manifestJson = JSON.stringify(reidentifiedManifest);

  assert.doesNotThrow(() => parseSyntheticCompactGraphManifest(manifestJson));
  assert.throws(
    () => parseSyntheticCompactGraphBundle(artifactJson, manifestJson),
    /manifest does not bind the exact compact graph artifact/,
  );
});

test('browser-safe compact graph source files do not import Node builtins', () => {
  const files = readdirSync(CONTRACT_DIR).filter((name) => name.endsWith('.js')).sort();
  assert.deepEqual(files, ['canonical_v1.js', 'contract_v1.js', 'strict_json_v1.js']);
  for (const file of files) {
    const source = readFileSync(`${CONTRACT_DIR}/${file}`, 'utf8');
    assert.doesNotMatch(source, /(?:from\s+|import\s*\()\s*['"]node:/);
  }
  assert.equal(readdirSync(FIXTURE_DIR).length, 3);
});
