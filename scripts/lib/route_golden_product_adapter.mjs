import { solveShortestRoute } from '../../src/route_generation/base_dijkstra.js';

export const ROUTE_GOLDEN_PRODUCT_ADAPTER_VERSION = 'route-golden-product-adapter/v1';

const PRODUCT_INVALID_REASON_CODES = Object.freeze({
  edge_objective_cost_units_invalid: 'edge-objective-cost-invalid',
});

export class GoldenProductAdapterIncompatibility extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GoldenProductAdapterIncompatibility';
    this.code = code;
  }
}

export function createGoldenProductionRouteAdapter({
  solveProductRoute = solveShortestRoute,
} = {}) {
  if (typeof solveProductRoute !== 'function') {
    throw new TypeError('solveProductRoute must be a function');
  }

  return async function solveGoldenRoute({ graph, request } = {}) {
    const productResult = await solveProductRoute({
      graphArtifact: {
        schemaVersion: graph?.schemaVersion,
        graphId: graph?.graphId,
        mode: 'golden-synthetic',
        directed: graph?.directed,
        nodes: graph?.nodes,
        edges: graph?.edges,
      },
      startNodeId: request?.originNodeId,
      endNodeId: request?.destinationNodeId,
    });
    return normalizeProductRouteResult(productResult);
  };
}

export const solveGoldenWithProductionRoute = createGoldenProductionRouteAdapter();

function normalizeProductRouteResult(result) {
  if (!isPlainObject(result) || typeof result.status !== 'string') {
    throw incompatibility(
      'GOLDEN_PRODUCT_RESULT_INVALID',
      'Production route result must be an object with a status',
    );
  }

  if (result.status === 'ready') {
    if (!isStringArray(result.nodePath) || !isStringArray(result.edgePath)
      || !isNonNegativeSafeInteger(result.distanceMm)
      || !isNonNegativeSafeInteger(result.objectiveCostUnits)) {
      throw incompatibility(
        'GOLDEN_PRODUCT_READY_RESULT_INCOMPATIBLE',
        'Production ready result is missing a path or integer total',
      );
    }
    return {
      status: 'ready',
      primary: {
        edgeIds: [...result.edgePath],
        nodeIds: [...result.nodePath],
        distanceMm: result.distanceMm,
        objectiveCostUnits: result.objectiveCostUnits,
      },
    };
  }

  if (result.status === 'no_route') {
    return { status: 'no-route', reasonCode: 'no-directed-path' };
  }

  if (result.status === 'endpoint_unavailable') {
    return normalizeUnavailableEndpoints(result.unavailableEndpoints);
  }

  if (result.status === 'invalid_graph') {
    return normalizeInvalidGraph(result.issues);
  }

  throw incompatibility(
    'GOLDEN_PRODUCT_STATUS_INCOMPATIBLE',
    `Unsupported production route status: ${result.status}`,
  );
}

function normalizeUnavailableEndpoints(unavailableEndpoints) {
  if (!Array.isArray(unavailableEndpoints) || unavailableEndpoints.length === 0) {
    throw incompatibility(
      'GOLDEN_PRODUCT_ENDPOINT_REASON_INCOMPATIBLE',
      'Production endpoint_unavailable result lacks endpoint evidence',
    );
  }
  const endpoints = unavailableEndpoints.map((entry) => entry?.endpoint);
  if (endpoints.length === 1 && endpoints[0] === 'start') {
    return { status: 'endpoint-unavailable', reasonCode: 'origin-unavailable' };
  }
  if (endpoints.length === 1 && endpoints[0] === 'end') {
    return { status: 'endpoint-unavailable', reasonCode: 'destination-unavailable' };
  }
  if (endpoints.length === 2 && new Set(endpoints).size === 2
    && endpoints.includes('start') && endpoints.includes('end')) {
    return { status: 'endpoint-unavailable', reasonCode: 'endpoints-unavailable' };
  }
  throw incompatibility(
    'GOLDEN_PRODUCT_ENDPOINT_REASON_INCOMPATIBLE',
    `Unsupported production unavailableEndpoints: ${JSON.stringify(endpoints)}`,
  );
}

function normalizeInvalidGraph(issues) {
  if (!Array.isArray(issues) || issues.length !== 1 || !isPlainObject(issues[0])) {
    throw incompatibility(
      'GOLDEN_PRODUCT_INVALID_GRAPH_REASON_INCOMPATIBLE',
      'Production invalid_graph result must have exactly one mappable issue',
    );
  }
  const reasonCode = PRODUCT_INVALID_REASON_CODES[issues[0].code];
  if (!reasonCode) {
    throw incompatibility(
      'GOLDEN_PRODUCT_INVALID_GRAPH_REASON_INCOMPATIBLE',
      `Unsupported production graph issue: ${String(issues[0].code)}`,
    );
  }
  return { status: 'invalid-input', reasonCode };
}

function incompatibility(code, message) {
  return new GoldenProductAdapterIncompatibility(code, message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
