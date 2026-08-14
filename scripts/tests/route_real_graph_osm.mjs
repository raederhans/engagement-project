import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  OSM_ADAPTER_RESULT_SCHEMA,
  OSM_INGRESS_LIMITS,
  OSM_WALK_PROFILE,
  OSM_WALK_PROFILE_IDENTITY,
  adaptOsmWalkingIntermediate,
} from '../lib/route_real_graph_osm/index.mjs';
import { contentIdentity } from '../lib/route_graph_candidate/index.mjs';

const semantic = await fixture('semantic_intermediate.json');
const hostile = await fixture('hostile_cases.json');

test('versioned strict walking profile publishes an explicit fail-closed decision table', () => {
  assert.equal(OSM_WALK_PROFILE.schema, 'route-real-graph-osm-walk-profile/v1');
  assert.equal(OSM_WALK_PROFILE.inputSchema, 'route-real-graph-osm-intermediate/v1');
  assert.equal(OSM_WALK_PROFILE.outputRawSchema, 'route-graph-raw-candidate/v1');
  assert.equal(OSM_WALK_PROFILE.outputNormalizedSchema, 'route-graph-candidate/v1');
  assert.equal(OSM_WALK_PROFILE.decisions.foot.missing, 'reject');
  assert.equal(OSM_WALK_PROFILE.decisions.foot.unknown, 'reject');
  assert.equal(OSM_WALK_PROFILE.decisions.access.missing, 'reject');
  assert.equal(OSM_WALK_PROFILE.decisions.access.unknown, 'reject');
  assert.equal(OSM_WALK_PROFILE.decisions.oneway.missingGeneral, 'bidirectional-profile-default');
  assert.equal(OSM_WALK_PROFILE.decisions.construction.unknownConstructionValue, 'exclude-not-pass');
  assert.equal(OSM_WALK_PROFILE.decisions.conditional.present, 'reject-unresolved');
  assert.equal(OSM_WALK_PROFILE.decisions.turnRestrictions.status, 'unavailable');
  assert.equal(OSM_WALK_PROFILE.decisions.distanceAndCost.outputCostUnit, 'integer-millimeters');
  assert.match(OSM_WALK_PROFILE_IDENTITY, /^sha256:[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(OSM_WALK_PROFILE.decisions.highway.allowed));
});

test('adapter is deterministic across intermediate record order and freezes its evidence', () => {
  const first = adaptOsmWalkingIntermediate(semantic);
  const reordered = structuredClone(semantic);
  reordered.edges.reverse();
  const second = adaptOsmWalkingIntermediate(reordered);
  assert.deepEqual(first, second);
  assert.match(first.intermediateIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.adapterIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(first.rawGraph.features));
  assert.ok(Object.isFrozen(first.normalization.graph.edges));
});

test('adapter identity binds every non-circular result leaf including normalization and limitations', () => {
  const result = adaptOsmWalkingIntermediate(semantic);
  const projection = structuredClone(result);
  delete projection.adapterIdentity;
  assert.equal(contentIdentity(projection), result.adapterIdentity);

  const leaves = leafPaths(projection);
  assert.ok(leaves.some((path) => path.join('.') === 'normalization.graph.topologyIdentity'));
  assert.ok(leaves.some((path) => path.join('.') === 'normalization.graph.geometryIdentity'));
  assert.ok(leaves.some((path) => path.join('.') === 'normalization.audit.status'));
  assert.ok(leaves.some((path) => path[0] === 'limitations'));
  for (const path of leaves) {
    const mutated = structuredClone(projection);
    mutateLeaf(mutated, path);
    assert.notEqual(contentIdentity(mutated), result.adapterIdentity, `identity did not bind ${path.join('.')}`);
  }
});

test('raw bbox evidence is preserved audited then projected and remains identity-bound', () => {
  const first = adaptOsmWalkingIntermediate(semantic);
  assert.deepEqual(first.boundary.bbox, [-75.2, 39.8, -74.8, 40.2]);
  assert.deepEqual(first.boundaryAudit.rawBbox, first.boundary.bbox);
  assert.deepEqual(first.boundaryAudit.rawBboxNumberTokens, ['-75.2', '39.8', '-74.8', '40.2']);
  assert.deepEqual(first.boundaryAudit.canonicalBbox, [-75.2, 39.8, -74.8, 40.2]);
  assert.equal(first.boundaryAudit.rawCoordinateAudit, 'passed');
  assert.equal(first.boundaryAudit.rawBoundaryIntersectionAudit, 'passed');
  assert.equal(first.boundaryAudit.rawCoordinateCount, 14);
  assert.equal(first.boundaryAudit.rawBoundaryIntersectionEndpointCount, 1);
  assert.equal(first.boundaryAudit.authority, 'candidate-only-not-established');

  const distinctRawBoundary = structuredClone(semantic);
  distinctRawBoundary.boundary.bbox[0] = -75.19999999;
  const second = adaptOsmWalkingIntermediate(distinctRawBoundary);
  assert.notDeepEqual(second.boundaryAudit.rawBbox, first.boundaryAudit.rawBbox);
  assert.deepEqual(second.boundaryAudit.canonicalBbox, first.boundaryAudit.canonicalBbox);
  assert.notEqual(second.intermediateIdentity, first.intermediateIdentity);
  assert.notEqual(second.adapterIdentity, first.adapterIdentity);
});

test('adapter maps semantic fixtures into existing candidate raw and normalized shapes', () => {
  const result = adaptOsmWalkingIntermediate(semantic);
  assert.equal(result.schema, OSM_ADAPTER_RESULT_SCHEMA);
  assert.equal(result.dataClassification, 'candidate-external');
  assert.equal(result.rawGraph.schema, 'route-graph-raw-candidate/v1');
  assert.equal(result.rawGraph.sourceKind, 'osm');
  assert.equal(result.normalization.status, 'ready');
  assert.equal(result.normalization.graph.schema, 'route-graph-candidate/v1');
  assert.equal(result.normalization.graph.dataClassification, 'candidate-external');
  assert.notEqual(result.normalization.graph.schema, 'GraphArtifact/v1');
  assert.deepEqual(result.decisions, {
    inputPhysicalFeatureCount: 7,
    includedPhysicalFeatureCount: 5,
    excludedPhysicalFeatureCount: 2,
    stairsPhysicalFeatureCount: 1,
    ferryPhysicalFeatureCount: 1,
    clippedPhysicalFeatureCount: 1,
    constructionExcludedPhysicalFeatureCount: 1,
    turnRestrictionRecordCount: null,
  });
  assert.equal(result.normalization.graph.counts.physicalFeatureCount, 7);
  assert.equal(result.normalization.graph.counts.excludedAccessCount, 2);
  assert.equal(result.normalization.graph.counts.directedEdgeCount, 9);
  assert.equal(result.decisions.turnRestrictionRecordCount, null);
});

test('stable record ids ordering rounding and integer millimeter costs are exact', () => {
  const { rawGraph, normalization } = adaptOsmWalkingIntermediate(semantic);
  assert.deepEqual(
    rawGraph.features.map((feature) => feature.source_edge_id),
    [...rawGraph.features.map((feature) => feature.source_edge_id)].sort(),
  );
  const first = rawGraph.features.find((feature) => feature.source_edge_id === 'osm-way:100:segment:0:part:0');
  assert.deepEqual(first.geometry_lon_lat_1e7[0], [-75.1, 39.9]);
  assert.equal(first.cost_millimeters, 1000);
  assert.equal(first.walk_direction, 'bidirectional');
  assert.ok(normalization.graph.nodes.every((node) => /^node:[a-f0-9]{64}$/.test(node.id)));
  assert.ok(normalization.graph.edges.every((edge) => /^edge:[a-f0-9]{64}$/.test(edge.id)));
  assert.deepEqual(
    normalization.graph.edges.map((edge) => edge.id),
    [...normalization.graph.edges.map((edge) => edge.id)].sort(),
  );
});

test('foot oneway override stairs ferry construction access and clipping decisions stay distinct', () => {
  const { rawGraph, normalization } = adaptOsmWalkingIntermediate(semantic);
  const feature = (wayId) => rawGraph.features.find(({ source_edge_id: id }) => id.startsWith(`osm-way:${wayId}:`));
  assert.equal(feature('200').walk_direction, 'reverse');
  assert.equal(feature('300').walk_direction, 'bidirectional');
  assert.equal(feature('300').walk_access, 'allowed');
  assert.equal(feature('400').walk_access, 'allowed');
  assert.equal(feature('500').walk_access, 'denied');
  assert.equal(feature('600').walk_access, 'denied');
  assert.equal(feature('700').to_node_id, 'clip:philadelphia-test-bbox-v1:700:3:1:to');
  assert.equal(normalization.graph.edges.filter(({ sourceEdgeId }) => sourceEdgeId.includes('way:500:')).length, 0);
  assert.equal(normalization.graph.edges.filter(({ sourceEdgeId }) => sourceEdgeId.includes('way:600:')).length, 0);
  assert.equal(normalization.graph.edges.filter(({ sourceEdgeId }) => sourceEdgeId.includes('way:200:')).length, 1);
});

test('hostile missing unknown conditional boundary identity and unavailable semantics fail closed', async (t) => {
  assert.equal(hostile.schema, 'route-real-graph-osm-hostile-cases/v1');
  for (const entry of hostile.cases) {
    await t.test(entry.name, () => {
      const input = structuredClone(semantic);
      setPath(input, entry.path, entry.value);
      assert.throws(() => adaptOsmWalkingIntermediate(input), hasCode(entry.code));
    });
  }
});

test('RD-B ingress rejects root and nested Proxies without executing any trap', () => {
  const cases = [
    (input, counter) => trapProxy(input, counter),
    (input, counter) => { input.edges = trapProxy(input.edges, counter); return input; },
    (input, counter) => { input.edges[0].tags = trapProxy(input.edges[0].tags, counter); return input; },
    (input, counter) => { input.edges[0].geometry[0] = trapProxy(input.edges[0].geometry[0], counter); return input; },
  ];
  for (const prepare of cases) {
    const counter = { count: 0 };
    const input = prepare(structuredClone(semantic), counter);
    assert.throws(() => adaptOsmWalkingIntermediate(input), hasCode('ingress-proxy'));
    assert.equal(counter.count, 0);
  }
});

test('RD-B ingress rejects accessors without executing getters', () => {
  const input = structuredClone(semantic);
  let getterCount = 0;
  Object.defineProperty(input.edges[0].tags, 'foot', {
    enumerable: true,
    configurable: true,
    get() {
      getterCount += 1;
      return 'yes';
    },
  });
  assert.throws(() => adaptOsmWalkingIntermediate(input), hasCode('ingress-accessor'));
  assert.equal(getterCount, 0);
});

test('RD-B ingress rejects hidden symbol sparse and custom array properties', () => {
  const hidden = structuredClone(semantic);
  Object.defineProperty(hidden.edges[0], 'recordId', {
    value: hidden.edges[0].recordId,
    enumerable: false,
  });
  assert.throws(() => adaptOsmWalkingIntermediate(hidden), hasCode('ingress-hidden-property'));

  const symbol = structuredClone(semantic);
  symbol.edges[0][Symbol('hostile')] = true;
  assert.throws(() => adaptOsmWalkingIntermediate(symbol), hasCode('ingress-symbol-property'));

  const sparse = structuredClone(semantic);
  sparse.edges[0].geometry = new Array(2);
  sparse.edges[0].geometry[1] = [-75.09, 39.9];
  assert.throws(() => adaptOsmWalkingIntermediate(sparse), hasCode('ingress-sparse-array'));

  const custom = structuredClone(semantic);
  custom.edges.extra = true;
  assert.throws(() => adaptOsmWalkingIntermediate(custom), hasCode('ingress-array-property'));
});

test('fixed-object ingress rejects 50k unknown keys before plural descriptor materialization', () => {
  const input = structuredClone(semantic);
  for (let index = 0; index < 50_000; index += 1) input[`unknown-${index}`] = index;

  const original = Object.getOwnPropertyDescriptors;
  let targetPluralDescriptorCalls = 0;
  Object.getOwnPropertyDescriptors = (target) => {
    if (target === input) targetPluralDescriptorCalls += 1;
    return original(target);
  };
  try {
    assert.throws(() => adaptOsmWalkingIntermediate(input), hasCode('schema-key-count'));
  } finally {
    Object.getOwnPropertyDescriptors = original;
  }
  assert.equal(targetPluralDescriptorCalls, 0);
});

test('RD-B ingress applies edge geometry and aggregate budgets before cloning', () => {
  const tooManyEdges = structuredClone(semantic);
  tooManyEdges.edges = [];
  tooManyEdges.edges.length = OSM_INGRESS_LIMITS.maximumEdgeRecords + 1;
  assert.throws(() => adaptOsmWalkingIntermediate(tooManyEdges), hasCode('edge-record-limit'));

  const tooManyPoints = structuredClone(semantic);
  tooManyPoints.edges[0].geometry = [];
  tooManyPoints.edges[0].geometry.length = OSM_INGRESS_LIMITS.maximumGeometryPointsPerEdge + 1;
  assert.throws(() => adaptOsmWalkingIntermediate(tooManyPoints), hasCode('geometry-point-limit'));

  const aggregate = structuredClone(semantic);
  aggregate.edges = aggregateGeometryBudgetFixture();
  assert.throws(() => adaptOsmWalkingIntermediate(aggregate), hasCode('aggregate-geometry-point-limit'));
});

test('a present unknown construction value is excluded and never interpreted as false or pass', () => {
  const input = structuredClone(semantic);
  const edge = input.edges.find(({ osmWayId }) => osmWayId === '100');
  edge.tags.construction = 'mystery_stage';
  const result = adaptOsmWalkingIntermediate(input);
  const mapped = result.rawGraph.features.find(({ source_edge_id: id }) => id.includes('way:100:'));
  assert.equal(mapped.walk_access, 'denied');
  assert.equal(result.decisions.constructionExcludedPhysicalFeatureCount, 2);
});

test('result limitations preserve unavailable and non-claim boundaries', () => {
  const result = adaptOsmWalkingIntermediate(semantic);
  const text = result.limitations.join(' ');
  for (const phrase of [
    'not GraphArtifact/v1', 'Turn restrictions are unavailable', 'accessibility',
    'safety', 'completeness', 'city correctness', 'cross-boundary connectivity',
  ]) assert.match(text, new RegExp(escapeRegExp(phrase), 'i'));
  assert.deepEqual(result.profile.claims, {
    candidateOnly: true,
    accessibility: 'not-established',
    safety: 'not-established',
    completeness: 'not-established',
    cityCorrectness: 'not-established',
    productRouting: 'not-authorized',
    publication: 'not-authorized',
  });
});

function setPath(object, path, value) {
  let target = object;
  for (const key of path.slice(0, -1)) target = target[key];
  target[path.at(-1)] = value;
}

function hasCode(code) {
  return (error) => error?.code === code;
}

function trapProxy(target, counter) {
  const trapped = () => {
    counter.count += 1;
    throw new Error('Proxy trap must not execute');
  };
  return new Proxy(target, {
    get: trapped,
    getOwnPropertyDescriptor: trapped,
    getPrototypeOf: trapped,
    has: trapped,
    ownKeys: trapped,
  });
}

function aggregateGeometryBudgetFixture() {
  const edgeCount = Math.floor(
    OSM_INGRESS_LIMITS.maximumAggregateGeometryPoints
      / OSM_INGRESS_LIMITS.maximumGeometryPointsPerEdge,
  ) + 1;
  const result = [];
  for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
    const edge = structuredClone(semantic.edges[1]);
    edge.geometry = [];
    for (let pointIndex = 0; pointIndex < OSM_INGRESS_LIMITS.maximumGeometryPointsPerEdge; pointIndex += 1) {
      edge.geometry.push(pointIndex % 2 === 0 ? [-75.1, 39.9] : [-75.09, 39.9]);
    }
    result.push(edge);
  }
  return result;
}

function leafPaths(value, prefix = []) {
  if (value === null || typeof value !== 'object') return [prefix];
  const result = [];
  for (const key of Object.keys(value)) result.push(...leafPaths(value[key], [...prefix, key]));
  return result;
}

function mutateLeaf(object, path) {
  let target = object;
  for (const key of path.slice(0, -1)) target = target[key];
  const key = path.at(-1);
  const value = target[key];
  if (value === null) target[key] = 'identity-mutation';
  else if (typeof value === 'string') target[key] = `${value}:identity-mutation`;
  else if (typeof value === 'boolean') target[key] = !value;
  else if (typeof value === 'number') target[key] = value + 1;
  else throw new TypeError(`unsupported identity leaf at ${path.join('.')}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`../fixtures/route-real-graph-osm/${name}`, import.meta.url), 'utf8'));
}
