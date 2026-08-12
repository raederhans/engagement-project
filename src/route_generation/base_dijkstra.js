import {
  compareStableIds,
  compileNormalizedGraph,
} from './normalized_graph.js';

const MAX_SAFE_TOTAL = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Find one deterministic minimum-objective path. Physical distance is carried
 * as a route fact and never participates in path ranking.
 *
 * Equal objective costs are resolved by fewer edges, then by the complete edge
 * ID sequence in stable code-unit order. This makes results independent of
 * input and adjacency order without inventing another product score.
 */
export function findShortestPath(graphArtifactOrCompiledGraph, endpointRequest = {}) {
  const safeEndpointRequest = isRecord(endpointRequest) ? endpointRequest : {};
  const compilation = compileNormalizedGraph(graphArtifactOrCompiledGraph);
  if (compilation.status !== 'ready') {
    return compilation;
  }
  return routeCompiledGraph(compilation.graph, {
    startNodeId: safeEndpointRequest.startNodeId,
    endNodeId: safeEndpointRequest.endNodeId,
  });
}

/**
 * Pure coordinator seam for a later Worker adapter. It performs no scheduling,
 * network access, persistence, or environment detection.
 */
export function solveShortestRoute(request = {}) {
  const safeRequest = isRecord(request) ? request : {};
  return findShortestPath(safeRequest.graphArtifact, {
    startNodeId: safeRequest.startNodeId,
    endNodeId: safeRequest.endNodeId,
  });
}

function routeCompiledGraph(graph, { startNodeId, endNodeId }) {
  const nodeIds = new Set(graph.nodes.map(({ nodeId }) => nodeId));
  const unavailableEndpoints = [
    unavailableEndpoint('start', startNodeId, nodeIds),
    unavailableEndpoint('end', endNodeId, nodeIds),
  ].filter(Boolean);

  if (unavailableEndpoints.length > 0) {
    return {
      status: 'endpoint_unavailable',
      graphId: graph.graphId,
      unavailableEndpoints,
    };
  }

  if (startNodeId === endNodeId) {
    return readyRoute(graph.graphId, startNodeId, endNodeId, [startNodeId], [], 0n, 0n);
  }

  const edgeById = new Map(graph.edges.map((candidate) => [candidate.edgeId, candidate]));
  const outgoingByNodeId = new Map(graph.adjacency.map(({ nodeId, outgoingEdgeIds }) => [
    nodeId,
    outgoingEdgeIds.map((edgeId) => edgeById.get(edgeId)),
  ]));

  const initialLabel = {
    nodeId: startNodeId,
    objectiveCostUnits: 0n,
    distanceMm: 0n,
    nodePath: [startNodeId],
    edgePath: [],
  };
  const bestByNodeId = new Map([[startNodeId, initialLabel]]);
  const pending = new MinHeap(compareLabels);
  pending.push(initialLabel);

  while (pending.size > 0) {
    const current = pending.pop();
    if (bestByNodeId.get(current.nodeId) !== current) {
      continue;
    }
    if (current.nodeId === endNodeId) {
      return readyRoute(
        graph.graphId,
        startNodeId,
        endNodeId,
        current.nodePath,
        current.edgePath,
        current.distanceMm,
        current.objectiveCostUnits,
      );
    }

    for (const candidate of outgoingByNodeId.get(current.nodeId)) {
      const next = {
        nodeId: candidate.toNodeId,
        objectiveCostUnits: current.objectiveCostUnits + BigInt(candidate.objectiveCostUnits),
        distanceMm: current.distanceMm + BigInt(candidate.distanceMm),
        nodePath: [...current.nodePath, candidate.toNodeId],
        edgePath: [...current.edgePath, candidate.edgeId],
      };
      const incumbent = bestByNodeId.get(next.nodeId);
      if (!incumbent || compareLabels(next, incumbent) < 0) {
        bestByNodeId.set(next.nodeId, next);
        pending.push(next);
      }
    }
  }

  const componentByNodeId = new Map(graph.components.nodeMembership.map(({ nodeId, componentId }) => [
    nodeId,
    componentId,
  ]));
  return {
    status: 'no_route',
    graphId: graph.graphId,
    startNodeId,
    endNodeId,
    startComponentId: componentByNodeId.get(startNodeId),
    endComponentId: componentByNodeId.get(endNodeId),
  };
}

function unavailableEndpoint(endpoint, nodeId, availableNodeIds) {
  if (typeof nodeId !== 'string' || nodeId.length === 0 || nodeId !== nodeId.trim()) {
    return { endpoint, nodeId: typeof nodeId === 'string' ? nodeId : null };
  }
  if (!availableNodeIds.has(nodeId)) {
    return { endpoint, nodeId };
  }
  return null;
}

function readyRoute(
  graphId,
  startNodeId,
  endNodeId,
  nodePath,
  edgePath,
  distanceMm,
  objectiveCostUnits,
) {
  if (distanceMm > MAX_SAFE_TOTAL || objectiveCostUnits > MAX_SAFE_TOTAL) {
    return {
      status: 'invalid_graph',
      issues: [{ code: 'route_total_exceeds_safe_integer', path: '$.edges' }],
    };
  }

  return {
    status: 'ready',
    graphId,
    startNodeId,
    endNodeId,
    nodePath: [...nodePath],
    edgePath: [...edgePath],
    distanceMm: Number(distanceMm),
    objectiveCostUnits: Number(objectiveCostUnits),
  };
}

function compareLabels(left, right) {
  if (left.objectiveCostUnits < right.objectiveCostUnits) {
    return -1;
  }
  if (left.objectiveCostUnits > right.objectiveCostUnits) {
    return 1;
  }

  const hopDifference = left.edgePath.length - right.edgePath.length;
  if (hopDifference !== 0) {
    return hopDifference;
  }

  const pathDifference = compareIdSequences(left.edgePath, right.edgePath);
  if (pathDifference !== 0) {
    return pathDifference;
  }
  return compareStableIds(left.nodeId, right.nodeId);
}

function compareIdSequences(left, right) {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = compareStableIds(left[index], right[index]);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class MinHeap {
  constructor(compare) {
    this.compare = compare;
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(value) {
    this.items.push(value);
    this.#bubbleUp(this.items.length - 1);
  }

  pop() {
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this.#sinkDown(0);
    }
    return first;
  }

  #bubbleUp(startingIndex) {
    let index = startingIndex;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.compare(this.items[index], this.items[parentIndex]) >= 0) {
        break;
      }
      [this.items[index], this.items[parentIndex]] = [this.items[parentIndex], this.items[index]];
      index = parentIndex;
    }
  }

  #sinkDown(startingIndex) {
    let index = startingIndex;
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let smallestIndex = index;

      if (
        leftIndex < this.items.length
        && this.compare(this.items[leftIndex], this.items[smallestIndex]) < 0
      ) {
        smallestIndex = leftIndex;
      }
      if (
        rightIndex < this.items.length
        && this.compare(this.items[rightIndex], this.items[smallestIndex]) < 0
      ) {
        smallestIndex = rightIndex;
      }
      if (smallestIndex === index) {
        return;
      }

      [this.items[index], this.items[smallestIndex]] = [this.items[smallestIndex], this.items[index]];
      index = smallestIndex;
    }
  }
}
