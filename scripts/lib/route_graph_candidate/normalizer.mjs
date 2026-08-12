import { admitModeProfile, candidateDataClassification } from './contracts.mjs';
import {
  ROUTE_GRAPH_CANDIDATE_SCHEMA,
  auditRouteGraphCandidate,
  geometryIdentityFor,
  stableEdgeId,
  stableNodeId,
  topologyIdentityFor,
  weakComponentCounts,
} from './graph_audit.mjs';
import {
  boundedText,
  exactDataObject,
  fail,
  freezeData,
} from './safe_data.mjs';

export const ROUTE_GRAPH_RAW_CANDIDATE_SCHEMA = 'route-graph-raw-candidate/v1';
export { auditRouteGraphCandidate } from './graph_audit.mjs';

export function normalizeRouteGraphCandidate(rawValue, profileValue) {
  const profile = admitModeProfile(profileValue);
  const raw = exactDataObject(rawValue, ['schema', 'sourceId', 'sourceKind', 'features'], 'raw graph candidate');
  if (raw.schema !== ROUTE_GRAPH_RAW_CANDIDATE_SCHEMA) fail('raw-schema', 'raw graph candidate schema is unsupported');
  boundedId(raw.sourceId, 'raw.sourceId');
  if (raw.sourceKind !== profile.sourceKind) fail('raw-profile-kind', 'raw graph source kind must match its mode profile');
  if (!Array.isArray(raw.features)) fail('raw-features', 'raw graph candidate features must be an array');

  const parsed = raw.features.map((feature, index) => parseFeature(feature, index, profile));
  parsed.sort((left, right) => compareText(left.sourceEdgeId, right.sourceEdgeId));
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index - 1].sourceEdgeId === parsed[index].sourceEdgeId) {
      fail('duplicate-source-edge-id', `duplicate source edge id: ${parsed[index].sourceEdgeId}`);
    }
  }

  const nodesBySourceId = new Map();
  const edges = [];
  let excludedAccessCount = 0;
  for (const feature of parsed) {
    if (feature.accessDisposition === 'denied') {
      excludedAccessCount += 1;
      continue;
    }
    registerNode(nodesBySourceId, raw.sourceId, feature.fromNodeId, feature.geometry[0]);
    registerNode(nodesBySourceId, raw.sourceId, feature.toNodeId, feature.geometry.at(-1));
    if (feature.direction === 'forward' || feature.direction === 'bidirectional') {
      edges.push(createEdge(raw.sourceId, feature, 'forward'));
    }
    if (feature.direction === 'reverse' || feature.direction === 'bidirectional') {
      edges.push(createEdge(raw.sourceId, feature, 'reverse'));
    }
  }

  const nodes = [...nodesBySourceId.values()].sort((left, right) => compareText(left.id, right.id));
  edges.sort((left, right) => compareText(left.id, right.id));
  const graphCore = {
    schema: ROUTE_GRAPH_CANDIDATE_SCHEMA,
    dataClassification: candidateDataClassification(raw.sourceKind),
    sourceId: raw.sourceId,
    sourceKind: raw.sourceKind,
    profileId: profile.profileId,
    mode: profile.mode,
    nodes,
    edges,
  };
  const topologyIdentity = topologyIdentityFor(graphCore);
  const geometryIdentity = geometryIdentityFor(graphCore);
  const componentCounts = weakComponentCounts(nodes, edges);
  const graph = freezeData({
    ...graphCore,
    topologyIdentity,
    geometryIdentity,
    counts: {
      physicalFeatureCount: parsed.length,
      excludedAccessCount,
      nodeCount: nodes.length,
      directedEdgeCount: edges.length,
      weakComponentCount: componentCounts.weakComponentCount,
      largestWeakComponentNodeCount: componentCounts.largestWeakComponentNodeCount,
      selfLoopCount: edges.filter((edge) => edge.fromNodeId === edge.toNodeId).length,
      zeroCostEdgeCount: edges.filter((edge) => edge.cost === 0).length,
    },
    limitations: [
      'Candidate-only normalized graph; not GraphArtifact v1 and not admitted for product runtime or publication.',
      'Turn restrictions, live conditions, and unrepresented source semantics remain unavailable.',
    ],
  }, 'normalized route graph candidate');
  const audit = auditRouteGraphCandidate(graph);
  return freezeData({
    status: audit.status === 'passed' ? 'ready' : 'failed',
    graph,
    audit,
  }, 'route graph normalization result');
}

function parseFeature(value, index, profile) {
  const fields = profile.fields;
  const feature = exactDataObject(value, Object.values(fields), `raw.features[${index}]`);
  const sourceEdgeId = boundedId(feature[fields.sourceEdgeId], `raw.features[${index}].${fields.sourceEdgeId}`);
  const fromNodeId = boundedId(feature[fields.fromNodeId], `raw.features[${index}].${fields.fromNodeId}`);
  const toNodeId = boundedId(feature[fields.toNodeId], `raw.features[${index}].${fields.toNodeId}`);
  const geometry = geometryLine(feature[fields.geometry], `raw.features[${index}].${fields.geometry}`);
  const cost = feature[fields.cost];
  if (!Number.isSafeInteger(cost) || cost < profile.cost.minimum || cost > profile.cost.maximum) {
    fail('invalid-edge-cost', `raw feature ${sourceEdgeId} cost must be an integer within the admitted profile range`);
  }
  const direction = classifiedValue(feature[fields.oneway], profile.oneway, ['forward', 'reverse', 'bidirectional'], 'oneway', sourceEdgeId);
  const accessDisposition = classifiedValue(feature[fields.access], profile.access, ['allowed', 'denied'], 'access', sourceEdgeId);
  classifiedValue(feature[fields.mode], profile.modeValues, ['allowed'], 'mode', sourceEdgeId);
  return { sourceEdgeId, fromNodeId, toNodeId, geometry, cost, direction, accessDisposition };
}

function classifiedValue(value, policy, groups, semantic, sourceEdgeId) {
  if (value === null || value === '') fail(`missing-${semantic}`, `${semantic} is missing for source edge ${sourceEdgeId}`);
  if (typeof value !== 'string') fail(`unknown-${semantic}`, `${semantic} is unknown for source edge ${sourceEdgeId}`);
  for (const group of groups) {
    if (policy[group].includes(value)) return group;
  }
  fail(`unknown-${semantic}`, `${semantic} value is not admitted for source edge ${sourceEdgeId}`);
}

function registerNode(nodesBySourceId, sourceId, sourceNodeId, coordinate) {
  const id = stableNodeId(sourceId, sourceNodeId);
  const existing = nodesBySourceId.get(sourceNodeId);
  if (existing && !sameCoordinate(existing.coordinate, coordinate)) {
    fail('node-coordinate-conflict', `source node ${sourceNodeId} has inconsistent endpoint coordinates`);
  }
  if (!existing) nodesBySourceId.set(sourceNodeId, { id, sourceNodeId, coordinate });
}

function createEdge(sourceId, feature, traversal) {
  const reverse = traversal === 'reverse';
  return {
    id: stableEdgeId(sourceId, feature.sourceEdgeId, traversal),
    sourceEdgeId: feature.sourceEdgeId,
    fromNodeId: stableNodeId(sourceId, reverse ? feature.toNodeId : feature.fromNodeId),
    toNodeId: stableNodeId(sourceId, reverse ? feature.fromNodeId : feature.toNodeId),
    cost: feature.cost,
    geometry: reverse ? [...feature.geometry].reverse() : feature.geometry,
    traversal,
    sourceDirection: feature.direction,
  };
}

function geometryLine(value, label) {
  if (!Array.isArray(value) || value.length < 2) fail('invalid-geometry', `${label} must contain at least two coordinates`);
  return value.map((item, index) => coordinate(item, `${label}[${index}]`));
}

function coordinate(value, label) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) {
    fail('invalid-coordinate', `${label} must contain exactly two finite numbers`);
  }
  return value.map((number) => Object.is(number, -0) ? 0 : number);
}

function sameCoordinate(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

function boundedId(value, label) {
  return boundedText(value, label, { max: 160, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/ });
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
