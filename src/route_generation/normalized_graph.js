const NORMALIZED_GRAPH_VERSION = 1;
const UNREADABLE_PROPERTY = Symbol('unreadable-property');

/**
 * Compile an explicit directed graph artifact into the deterministic, plain-data
 * representation consumed by the base router. The compiler deliberately keeps
 * only routing facts; source admission and shared schema validation belong to
 * their owning layers.
 */
export function compileNormalizedGraph(graphArtifact) {
  const inspection = copyGraphArtifactFromDataProperties(graphArtifact);
  if (inspection.issues.length > 0) {
    return invalidGraph(inspection.issues);
  }

  const artifact = inspection.artifact;
  const issues = validateGraphArtifact(artifact);
  if (issues.length > 0) {
    return invalidGraph(issues);
  }

  const nodes = artifact.nodes
    .map(({ nodeId }) => ({ nodeId }))
    .sort((left, right) => compareStableIds(left.nodeId, right.nodeId));
  const edges = artifact.edges
    .map((candidate) => ({
      edgeId: candidate.edgeId,
      fromNodeId: candidate.fromNodeId,
      toNodeId: candidate.toNodeId,
      distanceMm: candidate.distanceMm,
      objectiveCostUnits: candidate.objectiveCostUnits,
    }))
    .sort((left, right) => compareStableIds(left.edgeId, right.edgeId));

  const outgoingByNodeId = new Map(nodes.map(({ nodeId }) => [nodeId, []]));
  for (const candidate of edges) {
    outgoingByNodeId.get(candidate.fromNodeId).push(candidate.edgeId);
  }

  const adjacency = nodes.map(({ nodeId }) => ({
    nodeId,
    outgoingEdgeIds: outgoingByNodeId.get(nodeId).sort(compareStableIds),
  }));

  const graph = {
    normalizedGraphVersion: NORMALIZED_GRAPH_VERSION,
    schemaVersion: artifact.schemaVersion,
    graphId: artifact.graphId,
    mode: artifact.mode,
    directed: true,
    nodes,
    edges,
    adjacency,
    components: buildWeakComponents(nodes, edges),
  };

  return deepFreeze({ status: 'ready', graph });
}

function copyGraphArtifactFromDataProperties(graphArtifact) {
  if (!isRecord(graphArtifact)) {
    return { artifact: graphArtifact, issues: [] };
  }

  const issues = [];
  const rawNodes = readOwnDataProperty(graphArtifact, 'nodes', '$.nodes', issues);
  const rawEdges = readOwnDataProperty(graphArtifact, 'edges', '$.edges', issues);
  const artifact = {
    schemaVersion: readOwnDataProperty(graphArtifact, 'schemaVersion', '$.schemaVersion', issues),
    graphId: readOwnDataProperty(graphArtifact, 'graphId', '$.graphId', issues),
    mode: readOwnDataProperty(graphArtifact, 'mode', '$.mode', issues),
    directed: readOwnDataProperty(graphArtifact, 'directed', '$.directed', issues),
    nodes: copyRecordArrayFromDataProperties(rawNodes, '$.nodes', ['nodeId'], issues),
    edges: copyRecordArrayFromDataProperties(rawEdges, '$.edges', [
      'edgeId',
      'fromNodeId',
      'toNodeId',
      'distanceMm',
      'objectiveCostUnits',
    ], issues),
  };

  return { artifact, issues: sortIssues(issues) };
}

function copyRecordArrayFromDataProperties(value, path, properties, issues) {
  if (!isArray(value)) {
    return value;
  }

  const entries = readDenseArrayEntries(value, path, issues);
  return entries.map((entry, index) => {
    if (!isRecord(entry)) {
      return entry;
    }

    const copy = Object.create(null);
    for (const property of properties) {
      Object.defineProperty(copy, property, {
        configurable: true,
        enumerable: true,
        value: readOwnDataProperty(entry, property, `${path}[${index}].${property}`, issues),
        writable: true,
      });
    }
    return copy;
  });
}

function readDenseArrayEntries(array, path, issues) {
  const length = readOwnDataProperty(array, 'length', `${path}.length`, issues);
  if (!Number.isSafeInteger(length) || length < 0) {
    issues.push({ code: 'array_length_invalid', path: `${path}.length` });
    return [];
  }

  const entries = [];
  for (let index = 0; index < length; index += 1) {
    const entryPath = `${path}[${index}]`;
    const entry = readOwnDataProperty(array, String(index), entryPath, issues, true);
    entries.push(entry);
  }
  return entries;
}

function readOwnDataProperty(target, property, path, issues, required = false) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(target, property);
  } catch {
    issues.push({ code: 'property_inspection_failed', path });
    return UNREADABLE_PROPERTY;
  }

  if (!descriptor) {
    if (required) {
      issues.push({ code: 'array_entry_missing', path });
      return UNREADABLE_PROPERTY;
    }
    return undefined;
  }
  if (!Object.hasOwn(descriptor, 'value')) {
    issues.push({ code: 'accessor_property_disallowed', path });
    return UNREADABLE_PROPERTY;
  }
  return descriptor.value;
}

/**
 * Load either a parsed artifact or its JSON serialization. Parse failures are
 * data states, not thrown exceptions, so callers never receive a partial graph.
 */
export function loadNormalizedGraph(serializedOrParsedArtifact) {
  if (typeof serializedOrParsedArtifact !== 'string') {
    return compileNormalizedGraph(serializedOrParsedArtifact);
  }

  try {
    return compileNormalizedGraph(JSON.parse(serializedOrParsedArtifact));
  } catch {
    return invalidGraph([{ code: 'graph_json_invalid', path: '$' }]);
  }
}

function validateGraphArtifact(graphArtifact) {
  if (!isRecord(graphArtifact)) {
    return [{ code: 'graph_artifact_invalid', path: '$' }];
  }

  const issues = [];
  validateStableId(graphArtifact.schemaVersion, '$.schemaVersion', 'schema_version_invalid', issues);
  validateStableId(graphArtifact.graphId, '$.graphId', 'graph_id_invalid', issues);
  validateStableId(graphArtifact.mode, '$.mode', 'graph_mode_invalid', issues);

  if (graphArtifact.directed !== true) {
    issues.push({ code: 'directed_topology_required', path: '$.directed' });
  }

  const nodes = isArray(graphArtifact.nodes) ? graphArtifact.nodes : null;
  const edges = isArray(graphArtifact.edges) ? graphArtifact.edges : null;
  if (!nodes) {
    issues.push({ code: 'graph_nodes_invalid', path: '$.nodes' });
  }
  if (!edges) {
    issues.push({ code: 'graph_edges_invalid', path: '$.edges' });
  }
  if (!nodes || !edges) {
    return sortIssues(issues);
  }

  const nodeIds = new Set();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const path = `$.nodes[${index}]`;
    if (!isRecord(node)) {
      issues.push({ code: 'node_invalid', path });
      continue;
    }
    if (!isStableId(node.nodeId)) {
      issues.push({ code: 'node_id_invalid', path: `${path}.nodeId` });
      continue;
    }
    if (nodeIds.has(node.nodeId)) {
      issues.push({ code: 'node_id_duplicate', path: `${path}.nodeId`, nodeId: node.nodeId });
      continue;
    }
    nodeIds.add(node.nodeId);
  }

  const edgeIds = new Set();
  for (let index = 0; index < edges.length; index += 1) {
    const candidate = edges[index];
    const path = `$.edges[${index}]`;
    if (!isRecord(candidate)) {
      issues.push({ code: 'edge_invalid', path });
      continue;
    }

    if (!isStableId(candidate.edgeId)) {
      issues.push({ code: 'edge_id_invalid', path: `${path}.edgeId` });
    } else if (edgeIds.has(candidate.edgeId)) {
      issues.push({ code: 'edge_id_duplicate', path: `${path}.edgeId`, edgeId: candidate.edgeId });
    } else {
      edgeIds.add(candidate.edgeId);
    }

    validateEdgeNodeReference(candidate.fromNodeId, 'from', path, nodeIds, issues);
    validateEdgeNodeReference(candidate.toNodeId, 'to', path, nodeIds, issues);
    validateWeight(candidate.distanceMm, `${path}.distanceMm`, 'edge_distance_mm_invalid', issues);
    validateWeight(
      candidate.objectiveCostUnits,
      `${path}.objectiveCostUnits`,
      'edge_objective_cost_units_invalid',
      issues,
    );
  }

  return sortIssues(issues);
}

function validateEdgeNodeReference(nodeId, endpoint, edgePath, knownNodeIds, issues) {
  const path = `${edgePath}.${endpoint}NodeId`;
  if (!isStableId(nodeId)) {
    issues.push({ code: `edge_${endpoint}_node_id_invalid`, path });
    return;
  }
  if (!knownNodeIds.has(nodeId)) {
    issues.push({ code: `edge_${endpoint}_node_missing`, path, nodeId });
  }
}

function validateStableId(value, path, code, issues) {
  if (!isStableId(value)) {
    issues.push({ code, path });
  }
}

function validateWeight(value, path, code, issues) {
  if (!Number.isSafeInteger(value) || value < 0) {
    issues.push({ code, path });
  }
}

function isStableId(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !isArray(value);
}

function isArray(value) {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

function sortIssues(issues) {
  return issues.sort((left, right) => (
    compareStableIds(left.path, right.path)
      || compareStableIds(left.code, right.code)
  ));
}

function invalidGraph(issues) {
  return deepFreeze({
    status: 'invalid_graph',
    issues: sortIssues(issues.map((issue) => ({ ...issue }))),
  });
}

function buildWeakComponents(nodes, edges) {
  const neighborsByNodeId = new Map(nodes.map(({ nodeId }) => [nodeId, new Set()]));
  for (const { fromNodeId, toNodeId } of edges) {
    neighborsByNodeId.get(fromNodeId).add(toNodeId);
    neighborsByNodeId.get(toNodeId).add(fromNodeId);
  }

  const visited = new Set();
  const componentByNodeId = new Map();
  const items = [];

  for (const { nodeId: startingNodeId } of nodes) {
    if (visited.has(startingNodeId)) {
      continue;
    }

    const componentNodeIds = [];
    const pending = [startingNodeId];
    visited.add(startingNodeId);

    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      const nodeId = pending[cursor];
      componentNodeIds.push(nodeId);
      const neighbors = [...neighborsByNodeId.get(nodeId)].sort(compareStableIds);
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          pending.push(neighborId);
        }
      }
    }

    componentNodeIds.sort(compareStableIds);
    const componentId = `weak:${componentNodeIds[0]}`;
    const membership = new Set(componentNodeIds);
    const edgeIds = edges
      .filter(({ fromNodeId, toNodeId }) => membership.has(fromNodeId) && membership.has(toNodeId))
      .map(({ edgeId }) => edgeId)
      .sort(compareStableIds);

    for (const nodeId of componentNodeIds) {
      componentByNodeId.set(nodeId, componentId);
    }
    items.push({ componentId, nodeIds: componentNodeIds, edgeIds });
  }

  return {
    kind: 'weak',
    count: items.length,
    items,
    nodeMembership: nodes.map(({ nodeId }) => ({
      nodeId,
      componentId: componentByNodeId.get(nodeId),
    })),
  };
}

export function compareStableIds(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}
