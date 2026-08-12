import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  auditRouteGraphCandidate,
  normalizeRouteGraphCandidate,
} from '../lib/route_graph_candidate/index.mjs';

const profile = await fixture('walking_profile.json');
const validRaw = await fixture('valid_raw_graph.json');
const zeroCostSelfLoop = await fixture('zero_cost_self_loop.json');

test('normalization is deterministic across source feature order', () => {
  const first = normalizeRouteGraphCandidate(validRaw, profile);
  const reversed = structuredClone(validRaw);
  reversed.features.reverse();
  const second = normalizeRouteGraphCandidate(reversed, profile);
  assert.deepEqual(first, second);
  assert.equal(first.status, 'ready');
  assert.equal(first.audit.status, 'passed');
  assert.ok(Object.isFrozen(first.graph.edges));
});

test('normalizer emits stable directed identities counts and candidate classification', () => {
  const { graph, audit } = normalizeRouteGraphCandidate(validRaw, profile);
  assert.equal(graph.schema, 'route-graph-candidate/v1');
  assert.equal(graph.dataClassification, 'candidate-synthetic-fixture');
  assert.deepEqual(graph.counts, {
    physicalFeatureCount: 4,
    excludedAccessCount: 1,
    nodeCount: 5,
    directedEdgeCount: 5,
    weakComponentCount: 2,
    largestWeakComponentNodeCount: 3,
    selfLoopCount: 0,
    zeroCostEdgeCount: 0,
  });
  assert.match(graph.topologyIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.match(graph.geometryIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.ok(graph.nodes.every((node) => /^node:[a-f0-9]{64}$/.test(node.id)));
  assert.ok(graph.edges.every((edge) => /^edge:[a-f0-9]{64}$/.test(edge.id)));
  assert.ok(audit.warnings.includes('disconnected-components:2'));
});

test('missing one-way access and mode semantics each fail closed', () => {
  for (const [field, code] of [
    ['oneway', 'missing-oneway'],
    ['access', 'missing-access'],
    ['mode', 'missing-mode'],
  ]) {
    const raw = structuredClone(validRaw);
    raw.features[0][field] = null;
    assert.throws(() => normalizeRouteGraphCandidate(raw, profile), hasCode(code));
  }
});

test('unknown one-way access and mode semantics each fail closed', () => {
  for (const [field, code] of [
    ['oneway', 'unknown-oneway'],
    ['access', 'unknown-access'],
    ['mode', 'unknown-mode'],
  ]) {
    const raw = structuredClone(validRaw);
    raw.features[0][field] = 'not-admitted';
    assert.throws(() => normalizeRouteGraphCandidate(raw, profile), hasCode(code));
  }
});

test('negative or non-integer costs are rejected before graph construction', () => {
  for (const cost of [-1, 1.5]) {
    const raw = structuredClone(validRaw);
    raw.features[0].cost_integer = cost;
    assert.throws(() => normalizeRouteGraphCandidate(raw, profile), hasCode('invalid-edge-cost'));
  }
});

test('zero-cost self-loop is a topology blocker rather than a routable graph', () => {
  const result = normalizeRouteGraphCandidate(zeroCostSelfLoop, profile);
  assert.equal(result.status, 'failed');
  assert.equal(result.audit.status, 'failed');
  assert.ok(result.audit.blockers.some((reason) => reason.startsWith('zero-cost-self-loop:')));
});

test('inconsistent endpoint coordinates for a stable source node are rejected', () => {
  const raw = structuredClone(validRaw);
  raw.features.push({
    edge_id: 'e-ax-conflict',
    from_node: 'A',
    to_node: 'X',
    coordinates: [[-70, 30], [-69, 30]],
    cost_integer: 4,
    oneway: 'yes',
    access: 'yes',
    mode: 'walking',
  });
  assert.throws(() => normalizeRouteGraphCandidate(raw, profile), hasCode('node-coordinate-conflict'));
});

test('exact duplicate directed topology is rejected even with different source edge ids', () => {
  const raw = structuredClone(validRaw);
  raw.features.push({ ...structuredClone(raw.features.find((feature) => feature.edge_id === 'e-bc')), edge_id: 'e-bc-copy' });
  const result = normalizeRouteGraphCandidate(raw, profile);
  assert.equal(result.status, 'failed');
  assert.ok(result.audit.blockers.some((reason) => reason.startsWith('duplicate-directed-edge:')));
});

test('duplicate source edge identity is rejected before normalization', () => {
  const raw = structuredClone(validRaw);
  raw.features.push(structuredClone(raw.features[0]));
  assert.throws(() => normalizeRouteGraphCandidate(raw, profile), hasCode('duplicate-source-edge-id'));
});

test('reverse one-way semantics produce only the admitted reverse traversal', () => {
  const raw = structuredClone(validRaw);
  raw.features = [{
    edge_id: 'e-reverse',
    from_node: 'A',
    to_node: 'B',
    coordinates: [[-75, 40], [-74.99, 40]],
    cost_integer: 3,
    oneway: '-1',
    access: 'yes',
    mode: 'walking',
  }];
  const { graph, audit } = normalizeRouteGraphCandidate(raw, profile);
  assert.equal(audit.status, 'passed');
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].traversal, 'reverse');
  assert.equal(graph.edges[0].sourceDirection, 'reverse');
  assert.equal(graph.nodes.find((node) => node.id === graph.edges[0].fromNodeId).sourceNodeId, 'B');
  assert.equal(graph.nodes.find((node) => node.id === graph.edges[0].toNodeId).sourceNodeId, 'A');
});

test('fresh topology audit detects one-way reversal and endpoint tampering', () => {
  const graph = structuredClone(normalizeRouteGraphCandidate(validRaw, profile).graph);
  const target = graph.edges.find((edge) => edge.sourceDirection === 'forward');
  target.sourceDirection = 'reverse';
  target.geometry[0] = [-10, -10];
  const audit = auditRouteGraphCandidate(graph);
  assert.equal(audit.status, 'failed');
  assert.ok(audit.blockers.some((reason) => reason.startsWith('oneway-traversal-mismatch:')));
  assert.ok(audit.blockers.some((reason) => reason.startsWith('from-endpoint-discontinuity:')));
  assert.ok(audit.blockers.includes('topology-identity-mismatch'));
  assert.ok(audit.blockers.includes('geometry-identity-mismatch'));
});

function hasCode(code) {
  return (error) => error?.code === code;
}

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/route_graph_candidate/${name}`, import.meta.url), 'utf8'));
}
