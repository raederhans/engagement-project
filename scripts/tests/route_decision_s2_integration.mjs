#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { ROUTE_DECISION_SCHEMA_VERSIONS } from '../../src/route_decision/contracts/index.js';
import {
  ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS,
  ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
  ROUTE_SEARCH_DISTINCTNESS_VERSION,
  ROUTE_SEARCH_TIE_BREAK_VERSION,
  ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES,
} from '../../src/route_decision/contracts/candidate_search_v2.js';
import {
  ROUTE_ENRICHMENT_SCHEMA_VERSIONS,
  ROUTE_ENRICHMENT_SEARCH_AGGREGATE_SOURCE_IDENTITY,
  admitRouteCandidateSearchEnrichmentResult,
  enrichRouteCandidateSearchResult,
  projectSyntheticSearchEvidence,
} from '../../src/route_decision/enrichment/index.js';
import {
  ROUTE_SEARCH_DECISION_EVALUATION_VERSION,
  evaluateAdmittedRouteSearchDecision,
} from '../../src/route_decision/evaluator/search_v2.js';
import { searchRouteCandidates } from '../../src/route_generation/candidate_search/index.js';

const GRAPH_ID = 's2-integration-graph';
const POLICY_ID = 's2-integration-policy';
const SOURCE_ID = 'synthetic-s2-integration-evidence';
const EDGE_IDS = ['cheap-direct', 'long-a', 'long-b', 'short-a', 'short-b'];

function graphArtifact() {
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.graphArtifact,
    graphId: GRAPH_ID,
    mode: 'walk',
    directed: true,
    nodes: ['a', 'b', 'c', 'd'].map((nodeId) => ({ nodeId })),
    edges: [
      { edgeId: 'cheap-direct', fromNodeId: 'a', toNodeId: 'd', distanceMm: 100, objectiveCostUnits: 1 },
      { edgeId: 'long-a', fromNodeId: 'a', toNodeId: 'b', distanceMm: 300, objectiveCostUnits: 2 },
      { edgeId: 'long-b', fromNodeId: 'b', toNodeId: 'd', distanceMm: 300, objectiveCostUnits: 2 },
      { edgeId: 'short-a', fromNodeId: 'a', toNodeId: 'c', distanceMm: 100, objectiveCostUnits: 3 },
      { edgeId: 'short-b', fromNodeId: 'c', toNodeId: 'd', distanceMm: 100, objectiveCostUnits: 3 },
    ],
    components: {
      kind: 'weakly-connected',
      count: 1,
      byNodeId: { a: 0, b: 0, c: 0, d: 0 },
    },
    provenance: {
      dataClassification: 'synthetic',
      sourceIds: ['synthetic-s2-integration-graph'],
    },
    receipt: { artifactVersion: 's2-integration-graph-v1' },
  };
}

function searchConstraint() {
  return {
    constraintId: 'requires-step-free',
    factorId: 'step-free',
    locality: 'edge-local',
    edgeEvidenceRequirement: 'complete',
    operator: 'equals',
    expectedValue: true,
    routeAggregation: 'every-directed-edge',
    aggregationVersion: ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
    unresolvedStates: [...ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES],
    unresolvedDisposition: 'exclude-and-report',
  };
}

function searchRequest() {
  return {
    schemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchRequest,
    requestId: 's2-integration-request',
    graphId: GRAPH_ID,
    mode: 'walk',
    originNodeId: 'a',
    destinationNodeId: 'd',
    decisionPolicyId: POLICY_ID,
    objectiveFactorId: 'objective-cost-units',
    requestedCandidateCount: 2,
    routeDistinctnessVersion: ROUTE_SEARCH_DISTINCTNESS_VERSION,
    tieBreakVersion: ROUTE_SEARCH_TIE_BREAK_VERSION,
    bounds: { maxExpandedStates: 100, maxRouteEdgeCount: 4 },
    hardConstraints: [searchConstraint()],
  };
}

function decisionPolicy() {
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.decisionPolicy,
    policyId: POLICY_ID,
    hardConstraints: [{
      constraintId: 'requires-step-free',
      needTag: 'require-capability',
      factorId: 'step-free',
      operator: 'equals',
      expectedValue: true,
      unresolvedStates: [...ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES],
    }],
    softPreferences: [{
      preferenceId: 'prefer-shorter-distance',
      needTag: 'minimize-distance',
      factorId: 'distance-mm',
      operator: 'minimize',
      rangeMin: 0,
      rangeMax: 1_000,
      weightBasisPoints: 10_000,
    }],
    weightBasisPointsTotal: 10_000,
    tieBreak: [
      { factorId: 'score-units', direction: 'descending' },
      { factorId: 'distance-mm', direction: 'ascending' },
      { factorId: 'candidate-id', direction: 'ascending' },
    ],
  };
}

function syntheticSource() {
  return {
    schemaVersion: ROUTE_ENRICHMENT_SCHEMA_VERSIONS.syntheticSource,
    sourceId: SOURCE_ID,
    receipt: {
      schemaVersion: ROUTE_ENRICHMENT_SCHEMA_VERSIONS.sourceReceipt,
      sourceId: SOURCE_ID,
      artifactVersion: 's2-integration-evidence-v1',
      dataClassification: 'synthetic',
      sourceAsOf: null,
      retrievedAt: null,
      builtAt: '2026-08-12T00:00:00.000Z',
      observedAt: null,
      mappingPolicyVersion: 'direct-synthetic-edge-map-v1',
      coverage: { graphId: GRAPH_ID, edgeIds: [...EDGE_IDS] },
      limitations: ['Synthetic integration fixture; no real-world accessibility claim.'],
    },
    edgeObservations: EDGE_IDS.map((edgeId) => ({
      edgeId,
      factorId: 'step-free',
      state: 'observed',
      value: edgeId !== 'cheap-direct',
      unit: 'boolean',
      reasonCode: null,
    })),
  };
}

test('synthetic evidence flows one way through S2 search, enrichment, and provided-set evaluation', () => {
  const request = searchRequest();
  const source = syntheticSource();
  const projected = projectSyntheticSearchEvidence({ source, request });
  const searched = searchRouteCandidates(
    graphArtifact(),
    request,
    projected.edgeObservationsByEdgeId,
  );

  assert.equal(searched.termination, 'requested-candidate-count-reached');
  assert.deepEqual(searched.candidateFacts.map(({ edgeIds }) => edgeIds), [
    ['long-a', 'long-b'],
    ['short-a', 'short-b'],
  ]);
  assert.equal(
    searched.candidateFacts[0].observations['step-free'].sourceId,
    ROUTE_ENRICHMENT_SEARCH_AGGREGATE_SOURCE_IDENTITY.sourceId,
  );

  const enriched = admitRouteCandidateSearchEnrichmentResult(
    enrichRouteCandidateSearchResult({ searchResult: searched, source }),
  );
  assert.equal(enriched.sourceReceipt.sourceId, SOURCE_ID);
  assert.equal(enriched.candidateAudits.length, 2);
  assert.equal(enriched.searchResult.candidateFacts.every(
    (candidate) => candidate.observations['step-free'].sourceId === SOURCE_ID,
  ), true);

  const evaluated = evaluateAdmittedRouteSearchDecision({
    policy: decisionPolicy(),
    candidateArtifact: enriched,
  });
  assert.equal(evaluated.schemaVersion, ROUTE_SEARCH_DECISION_EVALUATION_VERSION);
  assert.equal(evaluated.candidateArtifact.sourceReceipt.sourceId, SOURCE_ID);
  assert.equal(
    evaluated.candidateArtifact.searchResult.termination,
    'requested-candidate-count-reached',
  );
  assert.equal(evaluated.evaluation.status, 'evaluated');
  assert.equal(evaluated.evaluation.decision.scope, 'provided-candidate-set');
  assert.deepEqual(evaluated.evaluation.decision.candidateIds, ['candidate:1', 'candidate:2']);
  assert.deepEqual(evaluated.evaluation.decision.rankedCandidateIds, [
    'candidate:2',
    'candidate:1',
  ]);
  assert.equal(Object.isFrozen(evaluated.candidateArtifact.candidateAudits), true);
});
