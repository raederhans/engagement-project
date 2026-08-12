import {
  ROUTE_CANDIDATE_SEARCH_EXPANDED_STATE_UNIT,
  searchRouteCandidates,
} from '../../src/route_generation/candidate_search/index.js';

export const ROUTE_GOLDEN_S2_PRODUCT_ADAPTER_VERSION =
  'route-golden-s2-product-adapter/v1';
export const ROUTE_GOLDEN_S2_PRODUCT_EXPANDED_STATE_UNIT =
  ROUTE_CANDIDATE_SEARCH_EXPANDED_STATE_UNIT;

export function createS2GoldenProductionAdapter({
  searchProduct = searchRouteCandidates,
} = {}) {
  if (typeof searchProduct !== 'function') throw new TypeError('searchProduct must be a function');
  return async function solveS2Golden(input = {}) {
    const graphArtifact = buildS2GoldenGraphArtifact(input.graph);
    return searchProduct(
      graphArtifact,
      structuredClone(input.request),
      structuredClone(input.edgeObservationsByEdgeId),
    );
  };
}

export const solveS2GoldenWithProductionSearch = createS2GoldenProductionAdapter();

export function buildS2GoldenGraphArtifact(graph) {
  const nodes = graph.nodes.map(({ nodeId }) => ({ nodeId }));
  const edges = graph.edges.map((edge) => ({ ...edge }));
  const byNodeId = weakComponentMembership(nodes.map(({ nodeId }) => nodeId), edges);
  return {
    schemaVersion: 'engagement-route-graph/v1',
    graphId: graph.graphId,
    mode: 'walk',
    directed: true,
    nodes,
    edges,
    components: {
      kind: 'weakly-connected',
      count: new Set(Object.values(byNodeId)).size,
      byNodeId,
    },
    provenance: {
      dataClassification: 'synthetic',
      sourceIds: ['synthetic-route-golden-s2-fixture'],
    },
    receipt: { artifactVersion: 'route-golden-s2-fixture-v1' },
  };
}

function weakComponentMembership(nodeIds, edges) {
  const neighbors = new Map(nodeIds.map((nodeId) => [nodeId, []]));
  for (const edge of edges) {
    neighbors.get(edge.fromNodeId).push(edge.toNodeId);
    neighbors.get(edge.toNodeId).push(edge.fromNodeId);
  }
  const byNodeId = {};
  let component = 0;
  for (const start of nodeIds) {
    if (Object.hasOwn(byNodeId, start)) continue;
    const pending = [start];
    byNodeId[start] = component;
    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      for (const neighbor of neighbors.get(pending[cursor])) {
        if (Object.hasOwn(byNodeId, neighbor)) continue;
        byNodeId[neighbor] = component;
        pending.push(neighbor);
      }
    }
    component += 1;
  }
  return byNodeId;
}
