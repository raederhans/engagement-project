#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { solveShortestRoute } from '../../src/route_generation/base_dijkstra.js';
import {
  ROUTE_GOLDEN_PRIMARY_ONLY_SCOPE,
  runGoldenCases,
} from '../lib/route_golden_harness.mjs';
import {
  ROUTE_GOLDEN_PRODUCT_ADAPTER_VERSION,
  createGoldenProductionRouteAdapter,
  solveGoldenWithProductionRoute,
} from '../lib/route_golden_product_adapter.mjs';

test('thin adapter changes direct production injection from 0/11 to 11/11', async () => {
  const directLedger = await runGoldenCases({
    solve: solveShortestRoute,
    solverId: 'direct-production-solver',
    comparisonScope: ROUTE_GOLDEN_PRIMARY_ONLY_SCOPE,
  });
  assert.equal(directLedger.summary.passedCases, 0);
  assert.equal(directLedger.summary.failedCases, 11);

  const adaptedLedger = await runGoldenCases({
    solve: solveGoldenWithProductionRoute,
    solverId: ROUTE_GOLDEN_PRODUCT_ADAPTER_VERSION,
    comparisonScope: ROUTE_GOLDEN_PRIMARY_ONLY_SCOPE,
  });
  assert.equal(adaptedLedger.summary.passedCases, 11);
  assert.equal(adaptedLedger.summary.failedCases, 0);
  assert.equal(adaptedLedger.summary.totalCases, 11);
});

test('primary-only scope verifies exact primary facts while machine-marking alternatives unevaluated', async () => {
  const ledger = await productionLedger();
  assert.equal(ledger.comparisonScope, 'primary-only/v1');
  assert.equal(ledger.entries.length, 11);
  assert.equal(ledger.entries.every(({ checks }) => (
    checks.deterministic === 'pass'
    && checks.expectedAgreement === 'pass'
    && checks.oracleAgreement === 'pass'
  )), true);

  const readyEntries = ledger.entries.filter(({ expectedStatus }) => expectedStatus === 'ready');
  assert.equal(readyEntries.length, 6);
  assert.equal(readyEntries.every(({ checks, terminalOutcome }) => (
    checks.continuity === 'pass'
    && checks.distance === 'pass'
    && checks.cost === 'pass'
    && checks.alternatives === 'not-evaluated'
    && !Object.hasOwn(terminalOutcome, 'alternatives')
  )), true);

  const nonReadyEntries = ledger.entries.filter(({ expectedStatus }) => expectedStatus !== 'ready');
  assert.equal(nonReadyEntries.length, 5);
  assert.equal(nonReadyEntries.every(({ checks }) => checks.alternatives === 'not-applicable'), true);
});

test('adapter maps graph/request and product primary fields without replacing the product path', async () => {
  let capturedRequest;
  const adapter = createGoldenProductionRouteAdapter({
    solveProductRoute(request) {
      capturedRequest = structuredClone(request);
      return {
        status: 'ready',
        graphId: request.graphArtifact.graphId,
        startNodeId: request.startNodeId,
        endNodeId: request.endNodeId,
        nodePath: ['adapter-a', 'adapter-b'],
        edgePath: ['product-edge'],
        distanceMm: 4321,
        objectiveCostUnits: 17,
      };
    },
  });
  const outcome = await adapter({
    graph: {
      schemaVersion: 'route-golden-synthetic-graph/v1',
      graphId: 'adapter-graph',
      directed: true,
      nodes: [{ nodeId: 'adapter-a' }, { nodeId: 'adapter-b' }],
      edges: [{
        edgeId: 'product-edge',
        fromNodeId: 'adapter-a',
        toNodeId: 'adapter-b',
        distanceMm: 4321,
        objectiveCostUnits: 17,
      }],
    },
    request: { originNodeId: 'adapter-a', destinationNodeId: 'adapter-b' },
  });

  assert.deepEqual(capturedRequest, {
    graphArtifact: {
      schemaVersion: 'route-golden-synthetic-graph/v1',
      graphId: 'adapter-graph',
      mode: 'golden-synthetic',
      directed: true,
      nodes: [{ nodeId: 'adapter-a' }, { nodeId: 'adapter-b' }],
      edges: [{
        edgeId: 'product-edge',
        fromNodeId: 'adapter-a',
        toNodeId: 'adapter-b',
        distanceMm: 4321,
        objectiveCostUnits: 17,
      }],
    },
    startNodeId: 'adapter-a',
    endNodeId: 'adapter-b',
  });
  assert.deepEqual(outcome, {
    status: 'ready',
    primary: {
      edgeIds: ['product-edge'],
      nodeIds: ['adapter-a', 'adapter-b'],
      distanceMm: 4321,
      objectiveCostUnits: 17,
    },
  });
});

test('adapter maps all product terminal evidence to exact Golden terminal outcomes', async () => {
  const ledger = await productionLedger();
  assert.deepEqual(terminalOutcome(ledger, 'directed-reverse-no-route'), {
    source: 'solver',
    status: 'no-route',
    reasonCode: 'no-directed-path',
  });
  assert.deepEqual(terminalOutcome(ledger, 'disconnected-components'), {
    source: 'solver',
    status: 'no-route',
    reasonCode: 'no-directed-path',
  });
  assert.deepEqual(terminalOutcome(ledger, 'geometric-crossing-without-topology'), {
    source: 'solver',
    status: 'no-route',
    reasonCode: 'no-directed-path',
  });
  assert.deepEqual(terminalOutcome(ledger, 'endpoint-unavailable'), {
    source: 'solver',
    status: 'endpoint-unavailable',
    reasonCode: 'destination-unavailable',
  });
  assert.deepEqual(terminalOutcome(ledger, 'invalid-edge'), {
    source: 'solver',
    status: 'invalid-input',
    reasonCode: 'edge-objective-cost-invalid',
  });
});

test('unmappable production terminal reasons fail closed with a specific incompatibility code', async () => {
  const adapter = createGoldenProductionRouteAdapter({
    solveProductRoute(request) {
      if (request.graphArtifact.graphId === 'invalid-edge-graph') {
        return {
          status: 'invalid_graph',
          issues: [{ code: 'unmapped_product_issue', path: '$.edges[0]' }],
        };
      }
      return solveShortestRoute(request);
    },
  });
  const ledger = await runGoldenCases({
    solve: adapter,
    solverId: 'unmappable-reason-test-adapter',
    comparisonScope: ROUTE_GOLDEN_PRIMARY_ONLY_SCOPE,
  });
  const entry = ledger.entries.find(({ caseId }) => caseId === 'invalid-edge');
  assert.equal(entry.verdict, 'fail');
  assert.deepEqual(entry.failureClasses, ['solver-threw']);
  assert.equal(entry.terminalOutcome.reasonCode, 'solver-threw');
  assert.equal(entry.runs.length, 2);
  assert.equal(entry.runs.every(({ error }) => (
    error.name === 'GoldenProductAdapterIncompatibility'
    && error.code === 'GOLDEN_PRODUCT_INVALID_GRAPH_REASON_INCOMPATIBLE'
  )), true);
});

async function productionLedger() {
  return runGoldenCases({
    solve: solveGoldenWithProductionRoute,
    solverId: ROUTE_GOLDEN_PRODUCT_ADAPTER_VERSION,
    comparisonScope: ROUTE_GOLDEN_PRIMARY_ONLY_SCOPE,
  });
}

function terminalOutcome(ledger, caseId) {
  const entry = ledger.entries.find((candidate) => candidate.caseId === caseId);
  assert.ok(entry, `Missing ledger entry for ${caseId}`);
  return entry.terminalOutcome;
}
