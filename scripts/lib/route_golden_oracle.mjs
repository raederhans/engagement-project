export const ROUTE_GOLDEN_GRAPH_SCHEMA_VERSION = 'route-golden-synthetic-graph/v1';
export const ROUTE_GOLDEN_ORACLE_CONTRACT_VERSION = 'reference-dijkstra/v1';

const READY_STATUS = 'ready';

export function inspectReferenceRouteInput({ graph, request } = {}) {
  const violations = [];

  if (!isPlainObject(graph)) {
    return freezeClone({ valid: false, violations: ['graph-invalid'] });
  }
  if (graph.schemaVersion !== ROUTE_GOLDEN_GRAPH_SCHEMA_VERSION) {
    violations.push('graph-schema-version-unsupported');
  }
  if (!isNonEmptyString(graph.graphId)) violations.push('graph-id-invalid');
  if (graph.directed !== true) violations.push('graph-must-be-directed');

  const nodeIds = new Set();
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    violations.push('graph-nodes-invalid');
  } else {
    for (const node of graph.nodes) {
      if (!isPlainObject(node) || !isNonEmptyString(node.nodeId)) {
        violations.push('node-id-invalid');
        continue;
      }
      if (nodeIds.has(node.nodeId)) violations.push('node-id-duplicate');
      nodeIds.add(node.nodeId);
      if (node.coordinates !== undefined && !isCoordinatePair(node.coordinates)) {
        violations.push('node-coordinates-invalid');
      }
    }
  }

  const edgeIds = new Set();
  let distanceTotal = 0;
  let objectiveCostTotal = 0;
  if (!Array.isArray(graph.edges)) {
    violations.push('graph-edges-invalid');
  } else {
    for (const edge of graph.edges) {
      if (!isPlainObject(edge)) {
        violations.push('edge-invalid');
        continue;
      }
      if (!isNonEmptyString(edge.edgeId)) {
        violations.push('edge-id-invalid');
      } else if (edgeIds.has(edge.edgeId)) {
        violations.push('edge-id-duplicate');
      } else {
        edgeIds.add(edge.edgeId);
      }

      if (!isNonEmptyString(edge.fromNodeId) || !isNonEmptyString(edge.toNodeId)) {
        violations.push('edge-endpoint-id-invalid');
      } else if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
        violations.push('edge-endpoint-unavailable');
      }

      if (!Number.isSafeInteger(edge.distanceMm)) {
        violations.push('edge-distance-invalid');
      } else if (edge.distanceMm < 0) {
        violations.push('edge-distance-negative');
      } else {
        distanceTotal += edge.distanceMm;
      }

      if (!Number.isSafeInteger(edge.objectiveCostUnits)) {
        violations.push('edge-objective-cost-invalid');
      } else if (edge.objectiveCostUnits < 0) {
        violations.push('edge-objective-cost-negative');
      } else {
        objectiveCostTotal += edge.objectiveCostUnits;
      }

      if (edge.geometry !== undefined && !isLineString(edge.geometry)) {
        violations.push('edge-geometry-invalid');
      }
    }
  }

  if (!Number.isSafeInteger(distanceTotal)) violations.push('graph-distance-sum-unsafe');
  if (!Number.isSafeInteger(objectiveCostTotal)) violations.push('graph-objective-cost-sum-unsafe');

  if (!isPlainObject(request)) {
    violations.push('request-invalid');
  } else {
    if (!isNonEmptyString(request.originNodeId)) violations.push('request-origin-invalid');
    if (!isNonEmptyString(request.destinationNodeId)) violations.push('request-destination-invalid');
  }

  return freezeClone({ valid: violations.length === 0, violations });
}

export function solveReferenceRoute({ graph, request } = {}) {
  const inspection = inspectReferenceRouteInput({ graph, request });
  if (!inspection.valid) {
    return freezeClone({
      status: 'invalid-input',
      reasonCode: inspection.violations[0],
    });
  }

  const nodeIds = new Set(graph.nodes.map(({ nodeId }) => nodeId));
  const originAvailable = nodeIds.has(request.originNodeId);
  const destinationAvailable = nodeIds.has(request.destinationNodeId);
  if (!originAvailable || !destinationAvailable) {
    const reasonCode = !originAvailable && !destinationAvailable
      ? 'endpoints-unavailable'
      : !originAvailable
        ? 'origin-unavailable'
        : 'destination-unavailable';
    return freezeClone({ status: 'endpoint-unavailable', reasonCode });
  }

  if (request.originNodeId === request.destinationNodeId) {
    return freezeClone({
      status: READY_STATUS,
      primary: emptyRoute(request.originNodeId),
      alternatives: {
        kind: 'no-distinct-alternative',
        bestDistinct: null,
      },
    });
  }

  const adjacency = buildAdjacency(graph);
  const primary = findBestRoute({
    adjacency,
    originNodeId: request.originNodeId,
    destinationNodeId: request.destinationNodeId,
  });
  if (!primary) return freezeClone({ status: 'no-route', reasonCode: 'no-directed-path' });

  const alternativesByPath = new Map();
  for (const excludedEdgeId of primary.edgeIds) {
    const alternative = findBestRoute({
      adjacency,
      originNodeId: request.originNodeId,
      destinationNodeId: request.destinationNodeId,
      excludedEdgeId,
    });
    if (alternative && compareEdgeIdSequences(alternative.edgeIds, primary.edgeIds) !== 0) {
      alternativesByPath.set(JSON.stringify(alternative.edgeIds), alternative);
    }
  }
  const alternatives = [...alternativesByPath.values()].sort(compareRouteFacts);
  return freezeClone({
    status: READY_STATUS,
    primary,
    alternatives: alternatives.length > 0
      ? { kind: 'multiple-distinct', bestDistinct: alternatives[0] }
      : { kind: 'no-distinct-alternative', bestDistinct: null },
  });
}

function buildAdjacency(graph) {
  const adjacency = new Map(graph.nodes.map(({ nodeId }) => [nodeId, []]));
  for (const edge of graph.edges) adjacency.get(edge.fromNodeId).push(edge);
  for (const edges of adjacency.values()) {
    edges.sort((left, right) => compareStrings(left.edgeId, right.edgeId));
  }
  return adjacency;
}

function findBestRoute({ adjacency, originNodeId, destinationNodeId, excludedEdgeId = null }) {
  const initial = {
    currentNodeId: originNodeId,
    edgeIds: [],
    nodeIds: [originNodeId],
    distanceMm: 0,
    objectiveCostUnits: 0,
  };
  const frontier = [initial];
  const bestByNode = new Map([[originNodeId, initial]]);

  while (frontier.length > 0) {
    frontier.sort(compareLabels);
    const current = frontier.shift();
    if (bestByNode.get(current.currentNodeId) !== current) continue;
    if (current.currentNodeId === destinationNodeId) return routeFacts(current);

    for (const edge of adjacency.get(current.currentNodeId) || []) {
      if (edge.edgeId === excludedEdgeId || current.nodeIds.includes(edge.toNodeId)) continue;
      const candidate = {
        currentNodeId: edge.toNodeId,
        edgeIds: [...current.edgeIds, edge.edgeId],
        nodeIds: [...current.nodeIds, edge.toNodeId],
        distanceMm: current.distanceMm + edge.distanceMm,
        objectiveCostUnits: current.objectiveCostUnits + edge.objectiveCostUnits,
      };
      const incumbent = bestByNode.get(edge.toNodeId);
      if (!incumbent || compareLabels(candidate, incumbent) < 0) {
        bestByNode.set(edge.toNodeId, candidate);
        frontier.push(candidate);
      }
    }
  }

  return null;
}

function compareLabels(left, right) {
  if (left.objectiveCostUnits !== right.objectiveCostUnits) {
    return left.objectiveCostUnits < right.objectiveCostUnits ? -1 : 1;
  }
  return compareEdgeIdSequences(left.edgeIds, right.edgeIds);
}

function compareRouteFacts(left, right) {
  if (left.objectiveCostUnits !== right.objectiveCostUnits) {
    return left.objectiveCostUnits < right.objectiveCostUnits ? -1 : 1;
  }
  return compareEdgeIdSequences(left.edgeIds, right.edgeIds);
}

function compareEdgeIdSequences(left, right) {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const comparison = compareStrings(left[index], right[index]);
    if (comparison !== 0) return comparison;
  }
  if (left.length === right.length) return 0;
  return left.length < right.length ? -1 : 1;
}

function compareStrings(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function routeFacts(label) {
  return {
    edgeIds: [...label.edgeIds],
    nodeIds: [...label.nodeIds],
    distanceMm: label.distanceMm,
    objectiveCostUnits: label.objectiveCostUnits,
  };
}

function emptyRoute(nodeId) {
  return {
    edgeIds: [],
    nodeIds: [nodeId],
    distanceMm: 0,
    objectiveCostUnits: 0,
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function isCoordinatePair(value) {
  return Array.isArray(value) && value.length === 2
    && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate));
}

function isLineString(value) {
  return isPlainObject(value) && value.type === 'LineString'
    && Array.isArray(value.coordinates) && value.coordinates.length >= 2
    && value.coordinates.every(isCoordinatePair);
}

function freezeClone(value) {
  return deepFreeze(structuredClone(value));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
