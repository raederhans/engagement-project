#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROUTE_DECISION_SCHEMA_VERSIONS,
} from '../../src/route_decision/contracts/index.js';
import {
  ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS,
  ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
  ROUTE_SEARCH_DISTINCTNESS_VERSION,
  ROUTE_SEARCH_TIE_BREAK_VERSION,
  ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES,
} from '../../src/route_decision/contracts/candidate_search_v2.js';
import {
  ROUTE_ENRICHMENT_AGGREGATION_VERSION,
  ROUTE_ENRICHMENT_SCHEMA_VERSIONS,
  ROUTE_ENRICHMENT_SEARCH_AGGREGATE_SOURCE_IDENTITY,
  admitRouteCandidateEnrichmentResult,
  admitRouteCandidateSearchEnrichmentResult,
  admitSyntheticObservationSource,
  enrichRouteCandidateFacts,
  enrichRouteCandidateSearchResult,
  projectSyntheticSearchEvidence,
} from '../../src/route_decision/enrichment/index.js';

const V1 = ROUTE_DECISION_SCHEMA_VERSIONS;
const S2 = ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS;
const ENRICHMENT = ROUTE_ENRICHMENT_SCHEMA_VERSIONS;

function searchConstraint(factorId, constraintId = `requires-${factorId}`) {
  return {
    constraintId,
    factorId,
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

function searchResult({ hardConstraints = [] } = {}) {
  const requiredObservations = Object.fromEntries(hardConstraints.map(({ factorId }) => [
    factorId,
    {
      schemaVersion: V1.sourceObservation,
      factorId,
      state: 'observed',
      value: true,
      unit: 'boolean',
      reasonCode: null,
      sourceId: 'synthetic-edge-fixture',
    },
  ]));
  const candidateFacts = [
    {
      schemaVersion: V1.routeCandidateFacts,
      candidateId: 'candidate-a',
      edgeIds: ['a-b', 'b-d'],
      distanceMm: 2_000,
      objectiveCostUnits: 10,
      observations: requiredObservations,
      provenance: { graphId: 'graph-fixture-1', dataClassification: 'synthetic' },
    },
  ];
  const request = {
    schemaVersion: S2.searchRequest,
    requestId: 'search-request-1',
    graphId: 'graph-fixture-1',
    mode: 'walk',
    originNodeId: 'a',
    destinationNodeId: 'd',
    decisionPolicyId: 'distance-first-v1',
    objectiveFactorId: 'objective-cost-units',
    requestedCandidateCount: 2,
    routeDistinctnessVersion: ROUTE_SEARCH_DISTINCTNESS_VERSION,
    tieBreakVersion: ROUTE_SEARCH_TIE_BREAK_VERSION,
    bounds: { maxExpandedStates: 1_000, maxRouteEdgeCount: 12 },
    hardConstraints,
  };
  return {
    schemaVersion: S2.searchResult,
    status: 'completed',
    termination: 'bounded-search-space-exhausted',
    request,
    candidateSet: {
      schemaVersion: S2.candidateSet,
      candidateSetId: 'candidate-set-1',
      candidateSetRevision: 'fixture-graph-v1',
      requestId: request.requestId,
      graphId: request.graphId,
      strategy: 'bounded-loopless-k-candidates',
      objectiveFactorId: request.objectiveFactorId,
      requestedCandidateCount: request.requestedCandidateCount,
      candidateIds: ['candidate-a'],
      candidateCount: 1,
      routeDistinctnessVersion: request.routeDistinctnessVersion,
      searchConstraintIds: hardConstraints.map(({ constraintId }) => constraintId),
      constraintAggregationVersion: ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
      tieBreakVersion: request.tieBreakVersion,
      bounds: structuredClone(request.bounds),
      expandedStateCount: 20,
      completeness: {
        routeSearch: 'complete-within-bounds',
        scope: 'loopless-directed-routes-within-max-route-edge-count',
      },
      constraintOutcome: hardConstraints.length ? 'eligible-candidates-returned' : 'not-required',
      budgetOutcome: 'within-budget',
    },
    candidateFacts,
  };
}

function receipt(overrides = {}) {
  return {
    schemaVersion: ENRICHMENT.sourceReceipt,
    sourceId: 'synthetic-edge-fixture',
    artifactVersion: 'edge-observations-v1',
    dataClassification: 'synthetic',
    sourceAsOf: null,
    retrievedAt: null,
    builtAt: '2026-08-12T00:00:00.000Z',
    observedAt: null,
    mappingPolicyVersion: 'direct-edge-fixture-map-v1',
    coverage: { graphId: 'graph-fixture-1', edgeIds: ['a-b', 'b-d'] },
    limitations: ['Synthetic contract fixture; no real-world accessibility claim.'],
    ...overrides,
  };
}

function edgeObservation(edgeId, factorId, state, value = null) {
  const unit = factorId === 'stairs-count' ? 'count' : 'boolean';
  if (state === 'observed') {
    return { edgeId, factorId, state, value, unit, reasonCode: null };
  }
  if (state === 'zero') {
    return { edgeId, factorId, state, value: 0, unit, reasonCode: null };
  }
  const reasonCode = {
    unknown: 'not-observed',
    unavailable: 'source-unavailable',
    partial: 'coverage-partial',
    stale: 'observation-stale',
    invalid: 'source-invalid',
    missing: 'field-missing',
  }[state];
  return { edgeId, factorId, state, value: null, unit, reasonCode };
}

function source(edgeObservations, overrides = {}) {
  return {
    schemaVersion: ENRICHMENT.syntheticSource,
    sourceId: 'synthetic-edge-fixture',
    receipt: receipt(),
    edgeObservations,
    ...overrides,
  };
}

function allTrueSource() {
  return source([
    edgeObservation('a-b', 'step-free', 'observed', true),
    edgeObservation('b-d', 'step-free', 'observed', true),
    edgeObservation('a-b', 'curb-ramp-present', 'observed', true),
    edgeObservation('b-d', 'curb-ramp-present', 'observed', true),
    edgeObservation('a-b', 'paved-surface', 'observed', true),
    edgeObservation('b-d', 'paved-surface', 'observed', true),
    edgeObservation('a-b', 'stairs-count', 'zero'),
    edgeObservation('b-d', 'stairs-count', 'zero'),
  ]);
}

test('search evidence projection preserves known booleans and unresolved states before enumeration', () => {
  const observations = allTrueSource().edgeObservations.filter(
    ({ factorId }) => factorId !== 'step-free' && factorId !== 'curb-ramp-present',
  );
  observations.push(edgeObservation('a-b', 'step-free', 'observed', true));
  observations.push(edgeObservation('b-d', 'step-free', 'observed', false));
  observations.push(edgeObservation('a-b', 'curb-ramp-present', 'unavailable'));
  observations.push(edgeObservation('b-d', 'curb-ramp-present', 'missing'));
  const request = searchResult({
    hardConstraints: [
      searchConstraint('curb-ramp-present'),
      searchConstraint('step-free'),
    ],
  }).request;

  const projected = projectSyntheticSearchEvidence({
    source: source(observations),
    request,
  });

  assert.equal(projected.schemaVersion, ENRICHMENT.searchEvidence);
  assert.equal(projected.graphId, request.graphId);
  assert.deepEqual(projected.requestIdentity, {
    requestId: request.requestId,
    hardConstraints: [
      { constraintId: 'requires-step-free', factorId: 'step-free' },
      {
        constraintId: 'requires-curb-ramp-present',
        factorId: 'curb-ramp-present',
      },
    ],
  });
  assert.equal(projected.sourceReceipt.sourceId, 'synthetic-edge-fixture');
  assert.equal(projected.edgeObservationsByEdgeId['a-b']['step-free'].value, true);
  assert.equal(projected.edgeObservationsByEdgeId['b-d']['step-free'].value, false);
  assert.equal(
    projected.edgeObservationsByEdgeId['a-b']['curb-ramp-present'].state,
    'unavailable',
  );
  assert.equal(
    Object.hasOwn(projected.edgeObservationsByEdgeId['b-d'], 'curb-ramp-present'),
    false,
  );
});

test('search evidence projection includes only requested capability factors and omits mapped missing', () => {
  const observations = allTrueSource().edgeObservations.filter(
    ({ edgeId, factorId }) => !(edgeId === 'b-d' && factorId === 'paved-surface'),
  );
  const projected = projectSyntheticSearchEvidence({
    source: source(observations),
    request: searchResult({
      hardConstraints: [searchConstraint('paved-surface')],
    }).request,
  });

  assert.deepEqual(Object.keys(projected.edgeObservationsByEdgeId), ['a-b']);
  assert.deepEqual(Object.keys(projected.edgeObservationsByEdgeId['a-b']), ['paved-surface']);
  assert.equal(projected.edgeObservationsByEdgeId['a-b']['paved-surface'].value, true);
});

test('search evidence projection rejects receipt, graph, and request identity mismatch', () => {
  const receiptMismatch = allTrueSource();
  receiptMismatch.receipt.sourceId = 'synthetic-other-source';
  assert.throws(
    () => projectSyntheticSearchEvidence({
      source: receiptMismatch,
      request: searchResult().request,
    }),
    /receipt sourceId must match sourceId/,
  );

  const graphMismatch = allTrueSource();
  graphMismatch.receipt.coverage.graphId = 'graph-fixture-2';
  assert.throws(
    () => projectSyntheticSearchEvidence({
      source: graphMismatch,
      request: searchResult().request,
    }),
    /graphId must match search request graphId/,
  );

  const malformedRequest = searchResult().request;
  malformedRequest.requestId = 'invalid request id';
  assert.throws(
    () => projectSyntheticSearchEvidence({
      source: allTrueSource(),
      request: malformedRequest,
    }),
    /CandidateSearchRequest.requestId/,
  );
});

test('search evidence projection is descriptor-safe, deterministic, detached, and deeply frozen', () => {
  let requestReads = 0;
  const accessorRequest = searchResult({
    hardConstraints: [searchConstraint('step-free')],
  }).request;
  Object.defineProperty(accessorRequest, 'requestId', {
    enumerable: true,
    get() { requestReads += 1; return 'search-request-1'; },
  });
  assert.throws(
    () => projectSyntheticSearchEvidence({
      source: allTrueSource(),
      request: accessorRequest,
    }),
    /data properties only/,
  );
  assert.equal(requestReads, 0);

  const request = searchResult({
    hardConstraints: [searchConstraint('step-free')],
  }).request;
  const observationSource = allTrueSource();
  const first = projectSyntheticSearchEvidence({ source: observationSource, request });
  const second = projectSyntheticSearchEvidence({ source: observationSource, request });
  assert.equal(JSON.stringify(first), JSON.stringify(second));

  request.requestId = 'mutated-request';
  observationSource.edgeObservations[0].value = false;
  assert.equal(first.requestIdentity.requestId, 'search-request-1');
  assert.equal(first.edgeObservationsByEdgeId['a-b']['step-free'].value, true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.requestIdentity.hardConstraints), true);
  assert.equal(Object.isFrozen(first.sourceReceipt), true);
  assert.equal(Object.isFrozen(first.edgeObservationsByEdgeId['a-b']['step-free']), true);
});

test('synthetic-first enrichment produces admitted v1 facts plus a separate auditable receipt envelope', () => {
  const result = enrichRouteCandidateSearchResult({
    searchResult: searchResult({ hardConstraints: [searchConstraint('step-free')] }),
    source: allTrueSource(),
  });

  assert.equal(result.schemaVersion, ENRICHMENT.searchResult);
  assert.equal(result.aggregationVersion, ROUTE_ENRICHMENT_AGGREGATION_VERSION);
  assert.equal(result.searchResult.candidateFacts[0].observations['step-free'].value, true);
  assert.equal(result.searchResult.candidateFacts[0].observations['stairs-count'].state, 'zero');
  assert.equal(result.searchResult.candidateFacts[0].provenance.dataClassification, 'synthetic');
  assert.equal(Object.hasOwn(result.searchResult.candidateFacts[0].provenance, 'sourceReceipt'), false);
  assert.equal(result.sourceReceipt.sourceId, 'synthetic-edge-fixture');
  assert.deepEqual(
    result.candidateAudits[0].factors.find(({ factorId }) => factorId === 'step-free')
      .edgeEvidence.map(({ edgeId }) => edgeId),
    ['a-b', 'b-d'],
  );
});

test('candidate-batch enrichment can supply constraint evidence before SearchResult admission', () => {
  const constrained = searchResult({ hardConstraints: [searchConstraint('step-free')] });
  constrained.candidateFacts[0].observations = {};
  const batch = enrichRouteCandidateFacts({
    graphId: constrained.request.graphId,
    candidateFacts: constrained.candidateFacts,
    source: allTrueSource(),
  });
  assert.equal(batch.schemaVersion, ENRICHMENT.candidateBatchResult);
  assert.equal(batch.candidateFacts[0].observations['step-free'].value, true);

  constrained.candidateFacts = batch.candidateFacts;
  const result = enrichRouteCandidateSearchResult({ searchResult: constrained, source: allTrueSource() });
  assert.equal(result.searchResult.candidateFacts[0].observations['step-free'].value, true);
});

test('enrichment result admissions round-trip complete candidate and search artifacts', () => {
  const candidateInput = searchResult();
  const candidateResult = enrichRouteCandidateFacts({
    graphId: candidateInput.request.graphId,
    candidateFacts: candidateInput.candidateFacts,
    source: allTrueSource(),
  });
  const searchEnrichmentResult = enrichRouteCandidateSearchResult({
    searchResult: searchResult(),
    source: allTrueSource(),
  });

  assert.deepEqual(admitRouteCandidateEnrichmentResult(candidateResult), candidateResult);
  assert.deepEqual(
    admitRouteCandidateSearchEnrichmentResult(searchEnrichmentResult),
    searchEnrichmentResult,
  );
});

test('candidate enrichment result admission rejects envelope, receipt, audit, and aggregate drift', () => {
  const candidateInput = searchResult();
  const baseline = enrichRouteCandidateFacts({
    graphId: candidateInput.request.graphId,
    candidateFacts: candidateInput.candidateFacts,
    source: allTrueSource(),
  });
  const tamperCases = [
    {
      label: 'aggregation version',
      mutate: (value) => { value.aggregationVersion = 'future-aggregation/v2'; },
      pattern: /aggregationVersion is unsupported/,
    },
    {
      label: 'candidate identity',
      mutate: (value) => { value.candidateAudits[0].candidateId = 'candidate-other'; },
      pattern: /candidateId must match candidate order/,
    },
    {
      label: 'factor aggregate state',
      mutate: (value) => { value.candidateAudits[0].factors[0].state = 'unknown'; },
      pattern: /aggregate fields drift from edge evidence/,
    },
    {
      label: 'factor aggregate value',
      mutate: (value) => { value.candidateAudits[0].factors[0].value = false; },
      pattern: /aggregate fields drift from edge evidence/,
    },
    {
      label: 'edge evidence aggregate',
      mutate: (value) => {
        value.candidateAudits[0].factors[0].edgeEvidence[0].value = false;
      },
      pattern: /aggregate fields drift from edge evidence/,
    },
    {
      label: 'receipt coverage',
      mutate: (value) => { value.sourceReceipt.coverage.edgeIds = ['a-b']; },
      pattern: /cover every enriched candidate edge/,
    },
    {
      label: 'candidate source identity',
      mutate: (value) => {
        value.candidateFacts[0].observations['step-free'].sourceId = 'synthetic-other-source';
      },
      pattern: /aggregate must exactly match the enriched candidate observation/,
    },
    {
      label: 'receipt source identity',
      mutate: (value) => { value.sourceReceipt.sourceId = 'synthetic-other-source'; },
      pattern: /source identity binding must exactly match/,
    },
    {
      label: 'source identity binding',
      mutate: (value) => {
        value.sourceIdentityBinding.acceptedInputSourceIds.reverse();
      },
      pattern: /source identity binding must exactly match/,
    },
  ];

  for (const { label, mutate, pattern } of tamperCases) {
    const tampered = structuredClone(baseline);
    mutate(tampered);
    assert.throws(
      () => admitRouteCandidateEnrichmentResult(tampered),
      pattern,
      label,
    );
  }
});

test('search enrichment result admission rejects search and audit identity drift', () => {
  const baseline = enrichRouteCandidateSearchResult({
    searchResult: searchResult(),
    source: allTrueSource(),
  });

  const searchIdentityDrift = structuredClone(baseline);
  searchIdentityDrift.searchResult.candidateSet.candidateIds[0] = 'candidate-other';
  assert.throws(
    () => admitRouteCandidateSearchEnrichmentResult(searchIdentityDrift),
    /candidate IDs must exactly match candidateSet order/,
  );

  const auditOrderDrift = structuredClone(baseline);
  auditOrderDrift.candidateAudits[0].factors.reverse();
  assert.throws(
    () => admitRouteCandidateSearchEnrichmentResult(auditOrderDrift),
    /factorId must follow canonical factor order/,
  );
});

test('enrichment result admissions reject accessors without calls and return detached frozen copies', () => {
  const candidateInput = searchResult();
  const baseline = enrichRouteCandidateFacts({
    graphId: candidateInput.request.graphId,
    candidateFacts: candidateInput.candidateFacts,
    source: allTrueSource(),
  });

  let topLevelReads = 0;
  const topLevelAccessor = structuredClone(baseline);
  Object.defineProperty(topLevelAccessor, 'aggregationVersion', {
    enumerable: true,
    get() { topLevelReads += 1; return ROUTE_ENRICHMENT_AGGREGATION_VERSION; },
  });
  assert.throws(
    () => admitRouteCandidateEnrichmentResult(topLevelAccessor),
    /data properties only/,
  );
  assert.equal(topLevelReads, 0);

  let nestedReads = 0;
  const nestedAccessor = structuredClone(baseline);
  Object.defineProperty(nestedAccessor.candidateAudits[0].factors[0], 'state', {
    enumerable: true,
    get() { nestedReads += 1; return 'observed'; },
  });
  assert.throws(
    () => admitRouteCandidateEnrichmentResult(nestedAccessor),
    /data properties only/,
  );
  assert.equal(nestedReads, 0);

  const callerOwned = structuredClone(baseline);
  const admitted = admitRouteCandidateEnrichmentResult(callerOwned);
  callerOwned.sourceReceipt.coverage.edgeIds[0] = 'mutated-edge';
  callerOwned.candidateAudits[0].factors[0].edgeEvidence[0].value = false;
  assert.equal(admitted.sourceReceipt.coverage.edgeIds[0], 'a-b');
  assert.equal(admitted.candidateAudits[0].factors[0].edgeEvidence[0].value, true);
  assert.equal(Object.isFrozen(admitted), true);
  assert.equal(Object.isFrozen(admitted.candidateFacts[0]), true);
  assert.equal(Object.isFrozen(admitted.sourceReceipt.coverage.edgeIds), true);
  assert.equal(Object.isFrozen(admitted.candidateAudits[0].factors[0].edgeEvidence[0]), true);

  const searchCallerOwned = structuredClone(enrichRouteCandidateSearchResult({
    searchResult: searchResult(),
    source: allTrueSource(),
  }));
  const admittedSearch = admitRouteCandidateSearchEnrichmentResult(searchCallerOwned);
  searchCallerOwned.searchResult.candidateFacts[0].candidateId = 'mutated-candidate';
  searchCallerOwned.candidateAudits[0].factors[0].edgeEvidence[0].value = false;
  assert.equal(admittedSearch.searchResult.candidateFacts[0].candidateId, 'candidate-a');
  assert.equal(admittedSearch.candidateAudits[0].factors[0].edgeEvidence[0].value, true);
  assert.equal(Object.isFrozen(admittedSearch), true);
  assert.equal(Object.isFrozen(admittedSearch.searchResult.candidateFacts[0]), true);
  assert.equal(
    Object.isFrozen(admittedSearch.candidateAudits[0].factors[0].edgeEvidence[0]),
    true,
  );
});

test('observed zero is retained and never inferred from missing evidence', () => {
  const missingStairs = allTrueSource();
  missingStairs.edgeObservations = missingStairs.edgeObservations.filter(
    ({ factorId }) => factorId !== 'stairs-count',
  );
  const missingResult = enrichRouteCandidateSearchResult({
    searchResult: searchResult(),
    source: missingStairs,
  });
  const missingCandidate = missingResult.searchResult.candidateFacts[0];
  const missingAudit = missingResult.candidateAudits[0].factors.find(
    ({ factorId }) => factorId === 'stairs-count',
  );
  assert.equal(Object.hasOwn(missingCandidate.observations, 'stairs-count'), false);
  assert.equal(missingAudit.state, 'missing');
  assert.equal(missingAudit.value, null);

  const zeroResult = enrichRouteCandidateSearchResult({
    searchResult: searchResult(),
    source: allTrueSource(),
  });
  assert.equal(zeroResult.searchResult.candidateFacts[0].observations['stairs-count'].state, 'zero');
  assert.equal(zeroResult.searchResult.candidateFacts[0].observations['stairs-count'].value, 0);
});

test('unknown, unavailable, partial, stale, invalid, and explicit or mapped missing stay distinct', () => {
  for (const state of ['unknown', 'unavailable', 'partial', 'stale', 'invalid', 'missing']) {
    const observations = allTrueSource().edgeObservations.filter(
      ({ factorId }) => factorId !== 'paved-surface',
    );
    if (state !== 'missing') {
      observations.push(edgeObservation('a-b', 'paved-surface', 'observed', true));
      observations.push(edgeObservation('b-d', 'paved-surface', state));
    } else {
      observations.push(edgeObservation('a-b', 'paved-surface', 'observed', true));
      observations.push(edgeObservation('b-d', 'paved-surface', 'missing'));
    }
    const result = enrichRouteCandidateSearchResult({
      searchResult: searchResult(),
      source: source(observations),
    });
    const audit = result.candidateAudits[0].factors.find(
      ({ factorId }) => factorId === 'paved-surface',
    );
    assert.equal(audit.state, state);
    if (state === 'missing') {
      assert.equal(Object.hasOwn(result.searchResult.candidateFacts[0].observations, 'paved-surface'), false);
    } else {
      assert.equal(result.searchResult.candidateFacts[0].observations['paved-surface'].state, state);
    }
  }

  const mapped = allTrueSource();
  mapped.edgeObservations = mapped.edgeObservations.filter(
    ({ edgeId, factorId }) => !(edgeId === 'b-d' && factorId === 'paved-surface'),
  );
  const mappedResult = enrichRouteCandidateSearchResult({
    searchResult: searchResult(),
    source: mapped,
  });
  assert.equal(
    mappedResult.candidateAudits[0].factors.find(({ factorId }) => factorId === 'paved-surface').state,
    'missing',
  );
});

test('known boolean false dominates unresolved edge evidence without becoming zero', () => {
  const observations = allTrueSource().edgeObservations.filter(
    ({ factorId }) => factorId !== 'step-free',
  );
  observations.push(edgeObservation('a-b', 'step-free', 'observed', false));
  observations.push(edgeObservation('b-d', 'step-free', 'unavailable'));
  const result = enrichRouteCandidateSearchResult({
    searchResult: searchResult(),
    source: source(observations),
  });
  const observation = result.searchResult.candidateFacts[0].observations['step-free'];
  assert.equal(observation.state, 'observed');
  assert.equal(observation.value, false);
});

test('empty same-endpoint routes do not infer true or zero without edge evidence', () => {
  const input = searchResult();
  input.request.destinationNodeId = 'a';
  input.candidateFacts[0].edgeIds = [];
  input.candidateFacts[0].distanceMm = 0;
  input.candidateFacts[0].objectiveCostUnits = 0;
  const emptySource = source([], {
    receipt: receipt({ coverage: { graphId: 'graph-fixture-1', edgeIds: [] } }),
  });
  const result = enrichRouteCandidateSearchResult({ searchResult: input, source: emptySource });
  assert.deepEqual(result.searchResult.candidateFacts[0].observations, {});
  assert.equal(result.candidateAudits[0].factors.every(({ state }) => state === 'missing'), true);
});

test('an existing search observation must agree with the synthetic edge source', () => {
  const input = searchResult({ hardConstraints: [searchConstraint('step-free')] });
  input.candidateFacts[0].observations['step-free'].value = false;
  assert.throws(
    () => enrichRouteCandidateSearchResult({ searchResult: input, source: allTrueSource() }),
    /returned candidate must resolve step-free as observed true/,
  );

  const conflictAfterAdmission = searchResult();
  conflictAfterAdmission.candidateFacts[0].observations['step-free'] = {
    schemaVersion: V1.sourceObservation,
    factorId: 'step-free',
    state: 'observed',
    value: false,
    unit: 'boolean',
    reasonCode: null,
    sourceId: 'synthetic-edge-fixture',
  };
  assert.throws(
    () => enrichRouteCandidateSearchResult({
      searchResult: conflictAfterAdmission,
      source: allTrueSource(),
    }),
    /existing step-free observation conflicts with source/,
  );

  const arbitraryIdentity = searchResult();
  arbitraryIdentity.candidateFacts[0].observations['step-free'] = {
    schemaVersion: V1.sourceObservation,
    factorId: 'step-free',
    state: 'observed',
    value: true,
    unit: 'boolean',
    reasonCode: null,
    sourceId: 'synthetic-unbound-aggregate',
  };
  assert.throws(
    () => enrichRouteCandidateSearchResult({
      searchResult: arbitraryIdentity,
      source: allTrueSource(),
    }),
    /existing step-free observation conflicts with source/,
  );
});

test('route-search aggregate observations are strictly verified and rebound to the admitted source receipt', () => {
  const input = searchResult({ hardConstraints: [searchConstraint('step-free')] });
  input.candidateFacts[0].observations['step-free'].sourceId =
    ROUTE_ENRICHMENT_SEARCH_AGGREGATE_SOURCE_IDENTITY.sourceId;

  const result = enrichRouteCandidateSearchResult({
    searchResult: input,
    source: allTrueSource(),
  });

  assert.equal(
    result.searchResult.candidateFacts[0].observations['step-free'].sourceId,
    'synthetic-edge-fixture',
  );
  assert.deepEqual(result.sourceIdentityBinding, {
    schemaVersion: ENRICHMENT.sourceIdentityBinding,
    outputSourceId: 'synthetic-edge-fixture',
    acceptedInputSourceIds: [
      'synthetic-edge-fixture',
      'synthetic-route-search-edge-aggregation',
    ],
    aggregateIdentityVersion: 'route-search-edge-aggregation-source-identity/v1',
  });
  assert.equal(result.sourceReceipt.sourceId, 'synthetic-edge-fixture');
  const aggregateAudit = result.candidateAudits[0].factors.find(
    ({ factorId }) => factorId === 'step-free',
  );
  assert.equal(
    aggregateAudit.inputSourceId,
    ROUTE_ENRICHMENT_SEARCH_AGGREGATE_SOURCE_IDENTITY.sourceId,
  );
  assert.equal(aggregateAudit.outputSourceId, 'synthetic-edge-fixture');

  input.candidateFacts[0].observations['step-free'].value = false;
  assert.throws(
    () => enrichRouteCandidateSearchResult({ searchResult: input, source: allTrueSource() }),
    /returned candidate must resolve step-free as observed true/,
  );

  const nonSearchFactor = searchResult();
  nonSearchFactor.candidateFacts[0].observations['stairs-count'] = {
    schemaVersion: V1.sourceObservation,
    factorId: 'stairs-count',
    state: 'zero',
    value: 0,
    unit: 'count',
    reasonCode: null,
    sourceId: ROUTE_ENRICHMENT_SEARCH_AGGREGATE_SOURCE_IDENTITY.sourceId,
  };
  assert.throws(
    () => enrichRouteCandidateSearchResult({
      searchResult: nonSearchFactor,
      source: allTrueSource(),
    }),
    /existing stairs-count observation conflicts with source/,
  );
});

test('source admission rejects prohibited factors, production identity, duplicates, and coverage drift', () => {
  for (const prohibited of ['crime', 'hin', 'acs', 'diary', 'real-estate-proxy', 'safety-score', 'risk-score']) {
    assert.throws(
      () => admitSyntheticObservationSource(source([
        edgeObservation('a-b', prohibited, 'observed', true),
      ])),
      /factorId is unsupported/,
    );
  }

  const production = allTrueSource();
  production.sourceId = 'city-data';
  production.receipt.sourceId = 'city-data';
  assert.throws(() => admitSyntheticObservationSource(production), /synthetic source/);

  const duplicate = allTrueSource();
  duplicate.edgeObservations.push(structuredClone(duplicate.edgeObservations[0]));
  assert.throws(() => admitSyntheticObservationSource(duplicate), /must be unique/);

  const uncovered = allTrueSource();
  uncovered.receipt.coverage.edgeIds = ['a-b'];
  assert.throws(() => admitSyntheticObservationSource(uncovered), /outside receipt coverage/);
});

test('descriptor-safe admission rejects accessors without reading them', () => {
  let sourceReads = 0;
  const accessorSource = allTrueSource();
  Object.defineProperty(accessorSource, 'sourceId', {
    enumerable: true,
    get() { sourceReads += 1; return 'synthetic-edge-fixture'; },
  });
  assert.throws(
    () => admitSyntheticObservationSource(accessorSource),
    /data properties only/,
  );
  assert.equal(sourceReads, 0);

  let observationReads = 0;
  const accessorObservation = allTrueSource();
  Object.defineProperty(accessorObservation.edgeObservations[0], 'state', {
    enumerable: true,
    get() { observationReads += 1; return 'observed'; },
  });
  assert.throws(
    () => admitSyntheticObservationSource(accessorObservation),
    /data properties only/,
  );
  assert.equal(observationReads, 0);

  let requestReads = 0;
  const request = {
    graphId: 'graph-fixture-1',
    candidateFacts: searchResult().candidateFacts,
    source: allTrueSource(),
  };
  Object.defineProperty(request, 'graphId', {
    enumerable: true,
    get() { requestReads += 1; return 'graph-fixture-1'; },
  });
  assert.throws(() => enrichRouteCandidateFacts(request), /data properties only/);
  assert.equal(requestReads, 0);
});

test('enrichment is deterministic, deeply frozen, detached, and contains no evaluator or runtime side-effect seam', async () => {
  const input = searchResult();
  const observationSource = allTrueSource();
  const first = enrichRouteCandidateSearchResult({ searchResult: input, source: observationSource });
  const second = enrichRouteCandidateSearchResult({ searchResult: input, source: observationSource });
  assert.equal(JSON.stringify(first), JSON.stringify(second));

  input.candidateFacts[0].edgeIds[0] = 'mutated-edge';
  observationSource.edgeObservations[0].value = false;
  assert.equal(first.searchResult.candidateFacts[0].edgeIds[0], 'a-b');
  assert.equal(first.candidateAudits[0].factors[0].edgeEvidence[0].value, true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.sourceReceipt.coverage.edgeIds), true);
  assert.equal(Object.isFrozen(first.candidateAudits[0].factors[0].edgeEvidence[0]), true);

  const moduleText = await import('node:fs/promises').then(({ readFile }) => readFile(
    new URL('../../src/route_decision/enrichment/index.js', import.meta.url),
    'utf8',
  ));
  assert.doesNotMatch(moduleText, /from ['"].*evaluator|\bfetch\s*\(|\bdocument\b|\blocalStorage\b|\bsessionStorage\b|\bDate\.now\b|\bnew Date\s*\(|\bMath\.random\b/);
  assert.doesNotMatch(moduleText, /route_generation[/\\]candidate_search|\bsearchRouteCandidates\b/);
});
