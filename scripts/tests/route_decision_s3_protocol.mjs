import assert from 'node:assert/strict';
import test from 'node:test';

import { ROUTE_DECISION_SCHEMA_VERSIONS } from '../../src/route_decision/contracts/index.js';
import {
  admitRouteCandidateSearchRequest,
} from '../../src/route_decision/contracts/candidate_search_v2.js';
import {
  S3_CONFIGURATION_GROUPS,
  S3_CONFIGURATION_IDS,
  S3_CONFORMANCE_PROBE_KINDS,
  S3_ORACLE_ALGORITHM_VERSION,
  S3_ORACLE_EXECUTION_SPEC,
  S3_PERFORMANCE_PROTOCOL,
  S3_SCENARIO_COUNTS,
  S3_SCENARIO_GENERATOR_VERSION,
  S3_SCENARIO_SEED,
  S3_SCENARIO_SCHEMA_VERSIONS,
  S3_SYNTHETIC_PROFILES,
  areS3DataTreesEquivalent,
  admitS3ConfigurationGroup,
  admitS3IndependentOracleResult,
  admitS3JoinedRunRecord,
  admitS3ProductExecution,
  admitS3RecordCollection,
  admitS3Report,
  admitS3RunManifest,
  admitS3ScenarioCohort,
  admitS3ScenarioProtocol,
  admitS3SyntheticProfile,
  buildS3GraphContentIdentity,
  buildS3ScenarioOdPairs,
} from '../../src/route_decision/contracts/scenario_cohort_v1.js';
import {
  ROUTE_SEARCH_DECISION_EVALUATION_VERSION,
  ROUTE_SEARCH_DECISION_VERSION,
  evaluateAdmittedRouteSearchDecision,
} from '../../src/route_decision/evaluator/search_v2.js';
import { searchRouteCandidates } from '../../src/route_generation/candidate_search/index.js';

const CAPABILITY_FACTORS = ['step-free', 'curb-ramp-present', 'paved-surface'];
const REASON_BY_STATE = {
  unknown: 'not-observed',
  unavailable: 'source-unavailable',
  partial: 'coverage-partial',
  stale: 'observation-stale',
  invalid: 'source-invalid',
};

function sourceObservation(factorId, state = 'observed', value = true) {
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.sourceObservation,
    factorId,
    state,
    value: state === 'observed' ? value : null,
    unit: 'boolean',
    reasonCode: state === 'observed' ? null : REASON_BY_STATE[state],
    sourceId: 'synthetic-s3-edge-evidence',
  };
}

function countObservation(state, value = null) {
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.sourceObservation,
    factorId: 'stairs-count',
    state,
    value: state === 'observed' || state === 'zero' ? value : null,
    unit: 'count',
    reasonCode: state === 'observed' || state === 'zero' ? null : REASON_BY_STATE[state],
    sourceId: 'synthetic-s3-edge-evidence',
  };
}

function graphArtifact() {
  const nodes = Array.from({ length: 1_002 }, (_, index) => ({ nodeId: `n${index}` }));
  const byNodeId = Object.fromEntries(nodes.map(({ nodeId }) => [nodeId, 0]));
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.graphArtifact,
    graphId: 'synthetic-s3-graph',
    mode: 'walk',
    directed: true,
    nodes,
    edges: [
      ...Array.from({ length: 1_000 }, (_, index) => ({
      edgeId: `e${index + 1}`,
      fromNodeId: 'n0',
      toNodeId: `n${index + 1}`,
      distanceMm: (index + 1) * 1_000,
      objectiveCostUnits: (index + 1) * 10,
      })),
      { edgeId: 'e-alt-1', fromNodeId: 'n0', toNodeId: 'n1001', distanceMm: 400, objectiveCostUnits: 5 },
      { edgeId: 'e-alt-2', fromNodeId: 'n1001', toNodeId: 'n1', distanceMm: 900, objectiveCostUnits: 20 },
    ],
    components: { kind: 'weakly-connected', count: 1, byNodeId },
    provenance: { dataClassification: 'synthetic', sourceIds: ['synthetic-s3-fixture'] },
    receipt: { artifactVersion: 'synthetic-graph-v1' },
  };
}

function graphScope() {
  const graph = graphArtifact();
  return {
    scopeKind: 'admitted-synthetic-graph',
    graphArtifact: graph,
    graphContentIdentity: structuredClone(buildS3GraphContentIdentity(graph)),
  };
}

function edgeFactorEvidence(graph, overrides = {}) {
  const stateByEdgeFactor = overrides.stateByEdgeFactor ?? {};
  return {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.edgeFactorEvidence,
    evidenceId: overrides.evidenceId ?? `${graph.graphId}-edge-evidence`,
    fixtureVersion: overrides.fixtureVersion ?? `${graph.receipt.artifactVersion}-edge-evidence-v1`,
    graphId: graph.graphId,
    graphArtifactVersion: graph.receipt.artifactVersion,
    graphContentIdentity: structuredClone(buildS3GraphContentIdentity(graph)),
    factorIds: [...CAPABILITY_FACTORS],
    edgeEvidence: graph.edges.map(({ edgeId }) => ({
      edgeId,
      observations: Object.fromEntries(CAPABILITY_FACTORS.map((factorId) => {
        const observation = stateByEdgeFactor[`${edgeId}:${factorId}`]
          ?? sourceObservation(factorId);
        return [factorId, structuredClone(observation)];
      })),
    })),
  };
}

const EXPECTED_TERMINATIONS = [
  'invalid-input',
  'no-directed-route-in-bounded-scope',
  'unresolved-constraint-evidence',
  'no-eligible-route-in-bounded-scope',
];
const ZERO_CANDIDATE_REASON_BY_TERMINATION = {
  'invalid-input': 'candidate-search-invalid-input',
  'endpoint-unavailable': 'candidate-search-endpoint-unavailable',
  'no-directed-route-in-bounded-scope': 'candidate-search-no-directed-route-in-bounded-scope',
  'no-eligible-route-in-bounded-scope': 'candidate-search-no-eligible-route-in-bounded-scope',
  'unresolved-constraint-evidence': 'candidate-search-unresolved-constraint-evidence',
  'search-budget-exhausted': 'candidate-search-budget-exhausted',
  'search-capacity-exhausted': 'candidate-search-capacity-exhausted',
};

function probeGraph(probeKind) {
  const disconnected = probeKind === 'disconnected';
  const graphId = `synthetic-s3-probe-${probeKind}`;
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.graphArtifact,
    graphId,
    mode: 'walk',
    directed: true,
    nodes: [{ nodeId: 'p0' }, { nodeId: 'p1' }],
    edges: disconnected ? [] : [{
      edgeId: 'pe1', fromNodeId: 'p0', toNodeId: 'p1',
      distanceMm: 1_000, objectiveCostUnits: 10,
    }],
    components: disconnected
      ? { kind: 'weakly-connected', count: 2, byNodeId: { p0: 0, p1: 1 } }
      : { kind: 'weakly-connected', count: 1, byNodeId: { p0: 0, p1: 0 } },
    provenance: { dataClassification: 'synthetic', sourceIds: [`synthetic-s3-${probeKind}-fixture`] },
    receipt: { artifactVersion: `${probeKind}-graph-v1` },
  };
}

function zeroCandidateOutcome(termination, overrides = {}) {
  const hasConstraints = overrides.hasConstraints
    ?? ['no-eligible-route-in-bounded-scope', 'unresolved-constraint-evidence'].includes(termination);
  const requestedCandidateCount = termination === 'invalid-input' ? null : 5;
  const expandedStateCount = overrides.expandedStateCount ?? ({
    'invalid-input': null,
    'endpoint-unavailable': null,
    'no-directed-route-in-bounded-scope': 1,
    'no-eligible-route-in-bounded-scope': 2,
    'unresolved-constraint-evidence': 1,
    'search-budget-exhausted': 100_000,
    'search-capacity-exhausted': 0,
  })[termination];
  const searched = !['invalid-input', 'endpoint-unavailable'].includes(termination);
  const resourceStopped = ['search-budget-exhausted', 'search-capacity-exhausted'].includes(termination);
  const constraintOutcome = !searched
    ? null
    : !hasConstraints
      ? 'not-required'
      : termination === 'no-directed-route-in-bounded-scope'
        ? 'not-evaluated'
        : termination === 'no-eligible-route-in-bounded-scope'
          ? 'no-eligible-route-in-bounded-scope-proven'
          : termination === 'unresolved-constraint-evidence'
            ? 'unresolved-evidence'
            : 'no-eligible-route-not-proven';
  return {
    termination,
    searchMetadata: {
      status: termination === 'invalid-input'
        ? 'rejected'
        : termination === 'endpoint-unavailable'
          ? 'not-started'
          : resourceStopped ? 'stopped' : 'completed',
      requestedCandidateCount,
      candidateCount: 0,
      expandedStateCount,
      routeSearchCompleteness: !searched
        ? null
        : resourceStopped ? 'not-proven' : 'complete-within-bounds',
      constraintOutcome,
      budgetOutcome: !searched
        ? null
        : termination === 'search-budget-exhausted' ? 'exhausted' : 'within-budget',
      capacityOutcome: !searched
        ? null
        : termination === 'search-capacity-exhausted' ? 'exhausted' : 'within-capacity',
      unresolvedEvidenceEncountered: searched
        ? constraintOutcome === 'unresolved-evidence'
        : null,
    },
    orderedCandidates: [],
    providedSetDecision: {
      evaluationSchemaVersion: ROUTE_SEARCH_DECISION_EVALUATION_VERSION,
      evaluationStatus: 'not-evaluated',
      reasonCode: ZERO_CANDIDATE_REASON_BY_TERMINATION[termination],
      decisionSchemaVersion: null,
      scope: null,
      decisionStatus: null,
      admittedCandidateIds: [], rankedCandidateIds: [],
      rejectedCandidateIds: [], unresolvedCandidateIds: [],
      publicExplanation: {
        hardConstraintTrace: [], softPreferenceTrace: [],
        candidateDispositions: [], rankingTrace: [],
      },
    },
  };
}

function probes() {
  return S3_CONFORMANCE_PROBE_KINDS.map((probeKind, index) => {
    const graph = probeGraph(probeKind);
    const stateByEdgeFactor = {};
    if (probeKind === 'source-unavailable') {
      stateByEdgeFactor['pe1:step-free'] = sourceObservation('step-free', 'unavailable');
    }
    if (probeKind === 'constraint-no-solution') {
      stateByEdgeFactor['pe1:step-free'] = sourceObservation('step-free', 'observed', false);
    }
    return {
      schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.conformanceProbe,
      probeId: `probe-${probeKind}`,
      probeKind,
      configurationId: index < 2 ? S3_CONFIGURATION_IDS[0] : S3_CONFIGURATION_IDS[4],
      profileId: index % 2 === 0 ? 's3-profile-a' : 's3-profile-b',
      stimulus: {
        stimulusKind: probeKind,
        graphArtifact: graph,
        graphContentIdentity: structuredClone(buildS3GraphContentIdentity(graph)),
        edgeFactorEvidence: edgeFactorEvidence(graph, { stateByEdgeFactor }),
        originNodeId: 'p0',
        destinationNodeId: 'p1',
        requestMutation: probeKind === 'invalid-input'
          ? { mutationKind: 'replace-field', field: 'requestedCandidateCount', invalidValue: 0 }
          : null,
      },
      expectedOutcome: zeroCandidateOutcome(EXPECTED_TERMINATIONS[index]),
      includedInMainCohort: false,
    };
  });
}

function cohort(overrides = {}) {
  const scope = graphScope();
  return {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.cohort,
    cohortId: 's3-cohort-v1',
    cohortKind: 'researcher-defined-synthetic-s3',
    scenarioGeneratorVersion: S3_SCENARIO_GENERATOR_VERSION,
    graphScope: scope,
    edgeFactorEvidence: edgeFactorEvidence(scope.graphArtifact),
    seed: S3_SCENARIO_SEED,
    counts: { ...S3_SCENARIO_COUNTS },
    configurationGroups: structuredClone(S3_CONFIGURATION_GROUPS),
    profiles: structuredClone(S3_SYNTHETIC_PROFILES),
    odPairs: structuredClone(buildS3ScenarioOdPairs(
      scope.graphArtifact,
      S3_SCENARIO_GENERATOR_VERSION,
      S3_SCENARIO_SEED,
    )),
    conformanceProbes: probes(),
    ...overrides,
  };
}

function protocol(overrides = {}) {
  return {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.protocol,
    protocolId: 's3-protocol-v1',
    definitionScope: 'preregistered-synthetic-engineering',
    historicalWrtRecovery: 'not-claimed',
    evaluationUnit: 'scenario-config-evaluation',
    cohort: cohort(),
    eligibleClaimCodes: [
      'synthetic-engineering-protocol',
      'synthetic-contract-conformance',
      'synthetic-determinism-evidence',
      'bounded-offline-validation',
    ],
    ...overrides,
  };
}

function runManifest(overrides = {}) {
  const source = protocol();
  return {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.runManifest,
    runId: 's3-run-v1',
    protocol: source,
    protocolId: source.protocolId,
    graphScope: structuredClone(source.cohort.graphScope),
    seed: source.cohort.seed,
    configurationExecutions: source.cohort.configurationGroups.map((group) => ({
      configurationId: group.configurationId,
      policyArtifactVersion: group.policyArtifactVersion,
      decisionPolicy: structuredClone(group.decisionPolicy),
      searchRequestTemplate: structuredClone(group.searchRequestTemplate),
      capacityPolicy: structuredClone(group.capacityPolicy),
    })),
    executionIdentity: {
      productAdapterVersion: 's3-product-adapter/v1',
      solverAlgorithmVersion: 'bounded-loopless-search/v1',
      oracleAlgorithmVersion: S3_ORACLE_ALGORITHM_VERSION,
      fixtureVersion: 's3-fixture-set/v1',
      canonicalSerializationVersion: 'canonical-json/v1',
    },
    referenceEnvironment: {
      runtime: 'Node test runtime', os: 'Windows test host', architecture: 'x64',
      cpuClass: 'unspecified test CPU class', memoryBytes: 8_000_000_000,
    },
    oracleExecutionSpec: structuredClone(S3_ORACLE_EXECUTION_SPEC),
    performanceProtocol: structuredClone(S3_PERFORMANCE_PROTOCOL),
    expectedCounts: { ...S3_SCENARIO_COUNTS, conformanceProbeEvaluations: 4 },
    ...overrides,
  };
}

function graphIdentityFor(graph) {
  return {
    scopeKind: 'admitted-synthetic-graph',
    graphId: graph.graphId,
    artifactVersion: graph.receipt.artifactVersion,
    graphContentIdentity: structuredClone(buildS3GraphContentIdentity(graph)),
  };
}

function evidenceIdentity(evidence) {
  return {
    schemaVersion: evidence.schemaVersion,
    evidenceId: evidence.evidenceId,
    fixtureVersion: evidence.fixtureVersion,
    graphId: evidence.graphId,
    graphArtifactVersion: evidence.graphArtifactVersion,
    graphContentIdentity: structuredClone(evidence.graphContentIdentity),
  };
}

function scenario(run, denominatorKind, scenarioId, configurationId) {
  if (denominatorKind === 'main') return run.protocol.cohort.odPairs.find(({ odPairId }) => odPairId === scenarioId);
  return run.protocol.cohort.conformanceProbes.find(({ probeId }) => probeId === scenarioId && configurationId);
}

function scenarioIdForDestination(run, destinationNodeId) {
  return run.protocol.cohort.odPairs.find((pair) => pair.destinationNodeId === destinationNodeId).odPairId;
}

function requestFor(run, denominatorKind, scenarioId, configurationId) {
  const item = scenario(run, denominatorKind, scenarioId, configurationId);
  const stimulus = denominatorKind === 'main'
    ? {
      graphArtifact: run.protocol.cohort.graphScope.graphArtifact,
      originNodeId: item.originNodeId,
      destinationNodeId: item.destinationNodeId,
    }
    : item.stimulus;
  const execution = run.configurationExecutions.find((entry) => entry.configurationId === configurationId);
  return {
    ...structuredClone(execution.searchRequestTemplate),
    requestId: `${run.runId}-${scenarioId}-${configurationId}`.slice(0, 120),
    graphId: stimulus.graphArtifact.graphId,
    originNodeId: stimulus.originNodeId,
    destinationNodeId: stimulus.destinationNodeId,
  };
}

function keyFor(run, denominatorKind, scenarioId, configurationId, profileId) {
  return `${run.runId}:${denominatorKind}:${scenarioId}:${configurationId}:${profileId}`;
}

function measurement(overrides = {}) {
  return {
    measurementStatus: 'not-measured', cacheState: 'not-applicable',
    latencyMicros: null, memoryBytes: null, unmeasuredReason: 'measurement-not-enabled',
    ...overrides,
  };
}

const EVALUATION_REASON = {
  'invalid-input': 'candidate-search-invalid-input',
  'endpoint-unavailable': 'candidate-search-endpoint-unavailable',
  'no-directed-route-in-bounded-scope': 'candidate-search-no-directed-route-in-bounded-scope',
  'no-eligible-route-in-bounded-scope': 'candidate-search-no-eligible-route-in-bounded-scope',
  'unresolved-constraint-evidence': 'candidate-search-unresolved-constraint-evidence',
  'search-budget-exhausted': 'candidate-search-budget-exhausted',
  'search-capacity-exhausted': 'candidate-search-capacity-exhausted',
};

function decisionEvaluation(policy, result) {
  if (result.candidateFacts.length > 0) {
    return evaluateAdmittedRouteSearchDecision({ policy, candidateArtifact: result });
  }
  return {
    schemaVersion: 'engagement-route-search-decision-evaluation/v2',
    policy: structuredClone(policy),
    candidateArtifact: structuredClone(result),
    evaluation: {
      status: 'not-evaluated',
      reasonCode: EVALUATION_REASON[result.termination],
      decision: null,
    },
  };
}

function stimulusFor(run, denominatorKind, scenarioId, configurationId) {
  const item = scenario(run, denominatorKind, scenarioId, configurationId);
  if (denominatorKind === 'main') {
    return {
      graphArtifact: run.protocol.cohort.graphScope.graphArtifact,
      edgeFactorEvidence: run.protocol.cohort.edgeFactorEvidence,
      requestMutation: null,
    };
  }
  return item.stimulus;
}

function privateEdgeObservations(evidence, request) {
  const factorIds = request.hardConstraints.map(({ factorId }) => factorId);
  return Object.fromEntries(evidence.edgeEvidence.map(({ edgeId, observations }) => [
    edgeId,
    Object.fromEntries(factorIds.map((factorId) => [factorId, structuredClone(observations[factorId])])),
  ]));
}

function executeScenario(run, denominatorKind, scenarioId, configurationId) {
  const request = requestFor(run, denominatorKind, scenarioId, configurationId);
  const stimulus = stimulusFor(run, denominatorKind, scenarioId, configurationId);
  const executableRequest = stimulus.requestMutation
    ? { ...structuredClone(request), [stimulus.requestMutation.field]: stimulus.requestMutation.invalidValue }
    : request;
  return searchRouteCandidates(
    stimulus.graphArtifact,
    executableRequest,
    privateEdgeObservations(stimulus.edgeFactorEvidence, request),
  );
}

function resourceGraph(graphId, nodeIds, edges, components = null) {
  const byNodeId = components?.byNodeId
    ?? Object.fromEntries(nodeIds.map((nodeId) => [nodeId, 0]));
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.graphArtifact,
    graphId,
    mode: 'walk',
    directed: true,
    nodes: nodeIds.map((nodeId) => ({ nodeId })),
    edges,
    components: components ?? { kind: 'weakly-connected', count: 1, byNodeId },
    provenance: { dataClassification: 'synthetic', sourceIds: [`synthetic-${graphId}-fixture`] },
    receipt: { artifactVersion: `${graphId}-v1` },
  };
}

function resourceRequest(
  graph,
  originNodeId,
  destinationNodeId,
  maxExpandedStates,
  constrained = false,
  requestedCandidateCount = 1,
) {
  const template = structuredClone(S3_CONFIGURATION_GROUPS[constrained ? 4 : 0].searchRequestTemplate);
  return {
    ...template,
    requestId: `${graph.graphId}-request`,
    graphId: graph.graphId,
    originNodeId,
    destinationNodeId,
    requestedCandidateCount,
    bounds: { ...template.bounds, maxExpandedStates },
  };
}

function trueCapabilityObservations(overrides = {}) {
  return Object.fromEntries(CAPABILITY_FACTORS.map((factorId) => [
    factorId,
    overrides[factorId] ?? sourceObservation(factorId),
  ]));
}

function enrichedSearchResult(run, scenarioId, stairsByCandidateId = {}) {
  const result = structuredClone(executeScenario(run, 'main', scenarioId, S3_CONFIGURATION_IDS[0]));
  const evidence = run.protocol.cohort.edgeFactorEvidence;
  const byEdge = new Map(evidence.edgeEvidence.map((entry) => [entry.edgeId, entry.observations]));
  for (const facts of result.candidateFacts) {
    for (const factorId of CAPABILITY_FACTORS) {
      const edgeObservations = facts.edgeIds.map((edgeId) => byEdge.get(edgeId)[factorId]);
      facts.observations[factorId] = structuredClone(
        edgeObservations.find(({ state, value }) => state === 'observed' && value === false)
          ?? edgeObservations.find(({ state }) => state !== 'observed')
          ?? edgeObservations[0],
      );
    }
    if (stairsByCandidateId[facts.candidateId]) {
      facts.observations['stairs-count'] = structuredClone(stairsByCandidateId[facts.candidateId]);
    }
  }
  return result;
}

function productExecution(run, denominatorKind, scenarioId, configurationId, options = {}) {
  const item = scenario(run, denominatorKind, scenarioId, configurationId);
  const profileId = item.profileId;
  const execution = run.configurationExecutions.find((entry) => entry.configurationId === configurationId);
  const request = requestFor(run, denominatorKind, scenarioId, configurationId);
  const stimulus = stimulusFor(run, denominatorKind, scenarioId, configurationId);
  const attemptState = options.attemptState ?? 'terminal';
  const executionRole = options.executionRole ?? 'primary';
  const result = attemptState === 'terminal'
    ? options.searchResult ?? executeScenario(run, denominatorKind, scenarioId, configurationId)
    : null;
  return {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.productExecution,
    recordKey: keyFor(run, denominatorKind, scenarioId, configurationId, profileId),
    denominatorKind, scenarioId, runId: run.runId, protocolId: run.protocolId,
    graphIdentity: graphIdentityFor(stimulus.graphArtifact),
    evidenceIdentity: evidenceIdentity(stimulus.edgeFactorEvidence),
    odPairId: denominatorKind === 'main' ? scenarioId : null,
    configurationId, profileId,
    decisionPolicy: structuredClone(execution.decisionPolicy),
    searchRequest: request,
    executionRole,
    executionAttemptId: options.executionAttemptId
      ?? `${executionRole}-${denominatorKind}-${scenarioId}-${configurationId}`.slice(0, 120),
    attemptState,
    searchResult: result,
    decisionEvaluation: result ? decisionEvaluation(execution.decisionPolicy, result) : null,
    measurement: options.measurement ?? measurement(),
  };
}

function comparatorFixtureOutcome(product) {
  const evaluation = product.decisionEvaluation.evaluation;
  const decision = evaluation.decision;
  const uniqueIdsFrom = (items) => [...new Set(items.map(({ candidateId }) => candidateId))];
  const candidateSet = product.searchResult.candidateSet;
  return {
    termination: product.searchResult.termination,
    searchMetadata: {
      status: product.searchResult.status,
      requestedCandidateCount: product.searchResult.request?.requestedCandidateCount ?? null,
      candidateCount: product.searchResult.candidateFacts.length,
      expandedStateCount: candidateSet?.expandedStateCount ?? null,
      routeSearchCompleteness: candidateSet?.completeness.routeSearch ?? null,
      constraintOutcome: candidateSet?.constraintOutcome ?? null,
      budgetOutcome: candidateSet?.budgetOutcome ?? null,
      capacityOutcome: candidateSet?.capacityOutcome ?? null,
      unresolvedEvidenceEncountered: candidateSet === null
        || product.searchResult.termination === 'requested-candidate-count-reached'
        ? null
        : candidateSet.constraintOutcome === 'unresolved-evidence',
    },
    orderedCandidates: product.searchResult.candidateFacts.map(({ candidateId, edgeIds }) => ({ candidateId, edgeIds: [...edgeIds] })),
    providedSetDecision: {
      evaluationSchemaVersion: product.decisionEvaluation.schemaVersion,
      evaluationStatus: evaluation.status,
      reasonCode: evaluation.reasonCode,
      decisionSchemaVersion: decision?.schemaVersion ?? null,
      scope: decision?.scope ?? null,
      decisionStatus: decision?.status ?? null,
      admittedCandidateIds: decision ? [...decision.admittedCandidateIds] : [],
      rankedCandidateIds: decision ? [...decision.rankedCandidateIds] : [],
      rejectedCandidateIds: decision ? uniqueIdsFrom(decision.rejected) : [],
      unresolvedCandidateIds: decision ? uniqueIdsFrom(decision.unresolved) : [],
      publicExplanation: decision ? {
        hardConstraintTrace: decision.trace.filter(({ stage }) => stage === 'hard-constraint').map((item) => structuredClone(item)),
        softPreferenceTrace: decision.trace.filter(({ stage }) => stage === 'soft-preference').map((item) => structuredClone(item)),
        candidateDispositions: decision.trace.filter(({ stage }) => stage === 'candidate-disposition').map((item) => structuredClone(item)),
        rankingTrace: decision.trace.filter(({ stage }) => stage === 'ranking').map((item) => structuredClone(item)),
      } : {
        hardConstraintTrace: [], softPreferenceTrace: [],
        candidateDispositions: [], rankingTrace: [],
      },
    },
  };
}

function oracleResult(run, product, options = {}) {
  return {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.independentOracle,
    recordKey: product.recordKey,
    denominatorKind: product.denominatorKind,
    scenarioId: product.scenarioId,
    runId: product.runId,
    protocolId: product.protocolId,
    graphIdentity: structuredClone(product.graphIdentity),
    evidenceIdentity: structuredClone(product.evidenceIdentity),
    odPairId: product.odPairId,
    configurationId: product.configurationId,
    profileId: product.profileId,
    decisionPolicy: structuredClone(product.decisionPolicy),
    searchRequest: structuredClone(product.searchRequest),
    oracleStatus: options.oracleStatus ?? (product.searchResult ? 'computed' : 'not-run'),
    // Comparator fixture only. S3-2 must produce this outcome through the frozen
    // separate-oracle spec and prove its import boundary independently.
    expectedOutcome: options.expectedOutcome
      ?? (product.searchResult ? comparatorFixtureOutcome(product) : null),
  };
}

function joinedRecord(run, denominatorKind, scenarioId, configurationId, options = {}) {
  const primary = productExecution(run, denominatorKind, scenarioId, configurationId, {
    ...options,
    executionRole: 'primary',
  });
  const replayOptions = {
    ...options,
    ...(options.replayOptions ?? {}),
    executionRole: 'replay',
  };
  const replay = productExecution(run, denominatorKind, scenarioId, configurationId, replayOptions);
  const oracle = oracleResult(run, primary, options);
  return {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.joinedRunRecord,
    recordKey: primary.recordKey,
    denominatorKind,
    primaryExecution: primary,
    replayExecution: replay,
    oracleResult: oracle,
  };
}

function collection(run = runManifest(), mainRecords = [], conformanceRecords = []) {
  return { schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.recordCollection, runManifest: run, mainRecords, conformanceRecords };
}

function report(recordCollection, emittedClaimCodes = []) {
  const run = recordCollection.runManifest;
  const main = recordCollection.mainRecords;
  const partial = main.length < 5_000 || main.some(({ primaryExecution }) => primaryExecution.attemptState !== 'terminal');
  const stopped = main.filter(({ primaryExecution }) => primaryExecution.searchResult?.status === 'stopped').length;
  return {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.report,
    reportId: 's3-report-v1', recordCollection, runId: run.runId,
    emittedClaimCodes, disclosures: { partialRun: partial, stoppedRecords: stopped },
  };
}

function hostileTree(value, onGet) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const output = [];
    output.length = value.length;
    for (let index = 0; index < value.length; index += 1) {
      Object.defineProperty(output, String(index), { enumerable: true, configurable: true, writable: true, value: hostileTree(value[index], onGet) });
    }
    return new Proxy(output, { get() { onGet(); throw new Error('direct get'); } });
  }
  const output = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    Object.defineProperty(output, key, { ...descriptor, value: hostileTree(descriptor.value, onGet) });
  }
  return new Proxy(output, { get() { onGet(); throw new Error('direct get'); } });
}

test('cohort freezes exact 1000 x 5 and keeps four conformance probes outside main', () => {
  const admitted = admitS3ScenarioCohort(cohort());
  assert.deepEqual(admitted.counts, S3_SCENARIO_COUNTS);
  assert.equal(admitted.odPairs.length, 1_000);
  assert.equal(admitted.odPairs.filter(({ profileId }) => profileId === 's3-profile-a').length, 500);
  assert.equal(admitted.odPairs.filter(({ profileId }) => profileId === 's3-profile-b').length, 500);
  assert.equal(admitted.conformanceProbes.every(({ includedInMainCohort }) => !includedInMainCohort), true);
  assert.equal(admitted.edgeFactorEvidence.edgeEvidence.length, admitted.graphScope.graphArtifact.edges.length);
  assert.equal(admitted.conformanceProbes.every(({ stimulus }) => Object.isFrozen(stimulus.graphArtifact)), true);
  assert.equal(Object.isFrozen(admitted.odPairs[0].stratum), true);
});

test('fixed generator mechanically binds seed, OD order, endpoints, component, partition, and distance bucket', () => {
  const raw = cohort();
  assert.deepEqual(
    raw.odPairs,
    buildS3ScenarioOdPairs(raw.graphScope.graphArtifact, raw.scenarioGeneratorVersion, raw.seed),
  );
  const wrongGenerator = cohort();
  wrongGenerator.scenarioGeneratorVersion = 'other-generator/v1';
  assert.throws(() => admitS3ScenarioCohort(wrongGenerator), /scenarioGeneratorVersion/);
  const wrongSeed = cohort();
  wrongSeed.seed += 1;
  assert.throws(() => admitS3ScenarioCohort(wrongSeed), /seed must be/);
  const wrongOrder = cohort();
  [wrongOrder.odPairs[0], wrongOrder.odPairs[1]] = [wrongOrder.odPairs[1], wrongOrder.odPairs[0]];
  assert.throws(() => admitS3ScenarioCohort(wrongOrder), /deterministic generator/);
  const wrongEndpoint = cohort();
  wrongEndpoint.odPairs[0].destinationNodeId = wrongEndpoint.odPairs[0].destinationNodeId === 'n1'
    ? 'n2'
    : 'n1';
  assert.throws(() => admitS3ScenarioCohort(wrongEndpoint), /deterministic generator/);
  const wrongComponent = cohort();
  wrongComponent.odPairs[0].stratum.weakComponentId = 1;
  assert.throws(() => admitS3ScenarioCohort(wrongComponent), /weakComponentId/);
  const wrongPartition = cohort();
  const partition = Number(wrongPartition.odPairs[0].stratum.syntheticPartitionId.at(-1));
  wrongPartition.odPairs[0].stratum.syntheticPartitionId = `synthetic-partition-${(partition + 1) % 10}`;
  assert.throws(() => admitS3ScenarioCohort(wrongPartition), /deterministic generator/);
  const wrongBucket = cohort();
  const bucket = Number(wrongBucket.odPairs[0].stratum.syntheticDistanceBucket.at(-1));
  wrongBucket.odPairs[0].stratum.syntheticDistanceBucket = `synthetic-distance-q${(bucket % 5) + 1}`;
  assert.throws(() => admitS3ScenarioCohort(wrongBucket), /deterministic generator/);
});

test('five configurations use only current primitives and G1 is provided-set distance ranking', () => {
  assert.deepEqual(S3_CONFIGURATION_GROUPS.map(({ configurationKind }) => configurationKind), [
    'objective-cost-only',
    'distance-ranking-over-objective-generated-candidates',
    'distance-objective-equal-weight',
    'distance-objective-reweighted-and-range-capped',
    'three-capability-constraint-aware',
  ]);
  for (const group of S3_CONFIGURATION_GROUPS) {
    assert.equal(group.searchRequestTemplate.requestedCandidateCount, 5);
    assert.deepEqual(group.searchRequestTemplate.bounds, { maxExpandedStates: 100_000, maxRouteEdgeCount: 1_024 });
    assert.equal(group.searchRequestTemplate.objectiveFactorId, 'objective-cost-units');
    assert.deepEqual(admitS3ConfigurationGroup(group), group);
  }
  assert.deepEqual(S3_CONFIGURATION_GROUPS[4].decisionPolicy.hardConstraints.map(({ factorId }) => factorId), [
    'step-free', 'curb-ramp-present', 'paved-surface',
  ]);
  assert.deepEqual(
    S3_CONFIGURATION_GROUPS[2].decisionPolicy.softPreferences
      .map(({ weightBasisPoints }) => weightBasisPoints),
    [5_000, 5_000],
  );
  assert.deepEqual(
    S3_CONFIGURATION_GROUPS[3].decisionPolicy.softPreferences
      .map(({ weightBasisPoints }) => weightBasisPoints),
    [6_500, 3_500],
  );
  assert.deepEqual(
    S3_CONFIGURATION_GROUPS[3].decisionPolicy.softPreferences
      .map(({ rangeMax }) => rangeMax),
    [50_000_000, 50_000_000],
  );
});

test('policy/search hard constraints are bidirectionally exact', () => {
  const missing = structuredClone(S3_CONFIGURATION_GROUPS[4]);
  missing.searchRequestTemplate.hardConstraints.pop();
  assert.throws(() => admitS3ConfigurationGroup(missing), /bidirectionally equal/);
  const extra = structuredClone(S3_CONFIGURATION_GROUPS[0]);
  extra.searchRequestTemplate.hardConstraints.push(structuredClone(S3_CONFIGURATION_GROUPS[4].searchRequestTemplate.hardConstraints[0]));
  assert.throws(() => admitS3ConfigurationGroup(extra), /bidirectionally equal|drifted/);
  const drift = structuredClone(S3_CONFIGURATION_GROUPS[4]);
  drift.searchRequestTemplate.hardConstraints[0].constraintId = 'other-constraint';
  assert.throws(() => admitS3ConfigurationGroup(drift), /bidirectionally equal/);
});

test('profiles are non-behavioral paired strata and cannot carry functional-need execution inputs', () => {
  for (const profile of S3_SYNTHETIC_PROFILES) {
    const admitted = admitS3SyntheticProfile(profile);
    assert.equal(admitted.profileKind, 'synthetic-cohort-stratum');
    assert.equal(admitted.behavioralEffect, 'forbidden');
  }
  const behavioral = { ...structuredClone(S3_SYNTHETIC_PROFILES[0]), functionalNeedTags: ['minimize-distance'] };
  assert.throws(() => admitS3SyntheticProfile(behavioral), /unknown: functionalNeedTags/);
});

test('graph scope v1 rejects external/candidate handoffs and requires a complete synthetic graph', () => {
  assert.equal(admitS3ScenarioCohort(cohort()).graphScope.graphArtifact.nodes.length, 1_002);
  const external = cohort({ graphScope: { scopeKind: 'candidate-external-graph-handoff', graphArtifact: null } });
  assert.throws(() => admitS3ScenarioCohort(external), /schema mismatch|only admits a complete synthetic GraphArtifact/);
  const loose = cohort({ graphScope: { scopeKind: 'admitted-synthetic-graph', graphArtifact: { graphId: 'x' } } });
  assert.throws(() => admitS3ScenarioCohort(loose), /schema mismatch/);
});

test('graph content identity is recomputed from full topology, weights, order, and components', () => {
  for (const mutation of [
    (graph) => { graph.edges.reverse(); },
    (graph) => { graph.edges[0].distanceMm += 1; },
  ]) {
    const input = cohort();
    mutation(input.graphScope.graphArtifact);
    assert.throws(
      () => admitS3ScenarioCohort(input),
      /graphContentIdentity.*recomputed from the complete admitted GraphArtifact/,
    );
  }
  const componentRelabel = cohort();
  const disconnected = componentRelabel.conformanceProbes[1].stimulus;
  disconnected.graphArtifact.components.byNodeId = { p0: 1, p1: 0 };
  assert.throws(
    () => admitS3ScenarioCohort(componentRelabel),
    /graphContentIdentity.*recomputed from the complete admitted GraphArtifact/,
  );

  const changed = graphArtifact();
  changed.edges[0].objectiveCostUnits += 1;
  assert.notDeepEqual(
    buildS3GraphContentIdentity(changed),
    buildS3GraphContentIdentity(graphArtifact()),
  );
});

test('run binds complete policy, search template, capacity, execution, environment, and performance identities', () => {
  const admittedRun = admitS3RunManifest(runManifest());
  assert.deepEqual(admittedRun, runManifest());
  assert.equal(admittedRun.oracleExecutionSpec.independenceEvidence.comparatorAloneProvesIndependence, false);
  assert.equal(
    admittedRun.oracleExecutionSpec.independenceEvidence.evaluatorOracleBoundary,
    's3-2-separate-evaluator-oracle-module-required',
  );
  assert.deepEqual(
    admittedRun.oracleExecutionSpec.independenceEvidence.forbiddenEvaluatorOracleImports,
    [
      'product-route-search-decision-evaluator',
      'product-route-candidate-search',
      'product-route-enrichment',
    ],
  );
  assert.ok(
    admittedRun.oracleExecutionSpec.independenceEvidence.requiredS3_2Evidence
      .includes('evaluator-oracle-static-import-boundary-test'),
  );
  assert.deepEqual(admittedRun.performanceProtocol.executionOrder, [
    'primary-cold', 'warmup-1', 'warmup-2', 'replay-warm',
  ]);
  assert.equal(admittedRun.performanceProtocol.zeroSamplePolicy.performanceClaimEligible, false);
  const policyDrift = runManifest();
  policyDrift.configurationExecutions[2].decisionPolicy.softPreferences[0].weightBasisPoints = 6_000;
  policyDrift.configurationExecutions[2].decisionPolicy.softPreferences[1].weightBasisPoints = 4_000;
  assert.throws(() => admitS3RunManifest(policyDrift), /content drifted/);
  const environmentMissing = runManifest();
  delete environmentMissing.referenceEnvironment.memoryBytes;
  assert.throws(() => admitS3RunManifest(environmentMissing), /missing: memoryBytes/);
  const oracleVersionDrift = runManifest();
  oracleVersionDrift.executionIdentity.oracleAlgorithmVersion = 'other-oracle/v1';
  assert.throws(() => admitS3RunManifest(oracleVersionDrift), /oracleAlgorithmVersion drifted/);
  const oracleSpecDrift = runManifest();
  oracleSpecDrift.oracleExecutionSpec.pathUniverse.maxRouteEdgeCount = 2_048;
  assert.throws(() => admitS3RunManifest(oracleSpecDrift), /oracleExecutionSpec.*drifted/);
  const resourceRuleDrift = runManifest();
  resourceRuleDrift.oracleExecutionSpec.resourceSemantics
    .terminalPrecedence.conflictRules.requestedKBeforeBudget = 'implementation-choice';
  assert.throws(() => admitS3RunManifest(resourceRuleDrift), /oracleExecutionSpec.*drifted/);
  const performanceDrift = runManifest();
  performanceDrift.performanceProtocol.warmupRuns = 3;
  assert.throws(() => admitS3RunManifest(performanceDrift), /performanceProtocol.*drifted/);
});

test('oracle resource spec fixes expansion order, shared second-pass budget, and terminal precedence', () => {
  assert.equal(
    S3_ORACLE_EXECUTION_SPEC.candidateGeneration.candidateIdRule.template,
    'candidate:${index+1}',
  );
  assert.deepEqual(
    S3_ORACLE_EXECUTION_SPEC.resourceSemantics.terminalPrecedence
      .conflictRules,
    {
      requestedKBeforeBudget: 'destination-is-emitted-and-k-checked-before-budget-gate',
      budgetBeforeCapacity: 'budget-is-checked-before-expansion-while-capacity-is-checked-during-child-generation',
      capacityBeforeFutureK: 'capacity-failure-during-child-generation-stops-before-any-future-destination-emit',
      knownFalseSecondPassResource: 'shared-budget-or-capacity-exhaustion-overrides-no-eligible-classification',
    },
  );
  assert.deepEqual(
    S3_ORACLE_EXECUTION_SPEC.resourceSemantics.conformanceFixtures.map((fixture) => fixture.fixtureId),
    [
      'same-route-universe-expansion-order-budget-boundary',
      'known-false-shared-second-pass-budget',
      'resource-terminal-conflict-precedence',
    ],
  );

  const orderedGraph = resourceGraph('resource-order', ['o', 'a', 'b', 'd'], [
    { edgeId: 'e-oa', fromNodeId: 'o', toNodeId: 'a', distanceMm: 1, objectiveCostUnits: 1 },
    { edgeId: 'e-ob', fromNodeId: 'o', toNodeId: 'b', distanceMm: 1, objectiveCostUnits: 2 },
    { edgeId: 'e-ad', fromNodeId: 'a', toNodeId: 'd', distanceMm: 1, objectiveCostUnits: 100 },
    { edgeId: 'e-bd', fromNodeId: 'b', toNodeId: 'd', distanceMm: 1, objectiveCostUnits: 1 },
  ]);
  const ordered = searchRouteCandidates(
    orderedGraph,
    resourceRequest(orderedGraph, 'o', 'd', 2),
  );
  assert.equal(ordered.termination, 'search-budget-exhausted');
  assert.equal(ordered.candidateSet.expandedStateCount, 2);

  const secondPassGraph = resourceGraph('resource-second-pass', ['o', 'a', 'd'], [
    { edgeId: 'e-oa', fromNodeId: 'o', toNodeId: 'a', distanceMm: 1, objectiveCostUnits: 1 },
    { edgeId: 'e-ad', fromNodeId: 'a', toNodeId: 'd', distanceMm: 1, objectiveCostUnits: 1 },
  ]);
  const secondPassEvidence = {
    'e-oa': trueCapabilityObservations({
      'step-free': sourceObservation('step-free', 'observed', false),
    }),
    'e-ad': trueCapabilityObservations(),
  };
  const secondPass = searchRouteCandidates(
    secondPassGraph,
    resourceRequest(secondPassGraph, 'o', 'd', 2, true),
    secondPassEvidence,
  );
  assert.equal(secondPass.termination, 'search-budget-exhausted');
  assert.equal(secondPass.candidateSet.expandedStateCount, 2);

  const directGraph = resourceGraph('resource-k-before-budget', ['o', 'd'], [
    { edgeId: 'e-od', fromNodeId: 'o', toNodeId: 'd', distanceMm: 1, objectiveCostUnits: 1 },
  ]);
  const kBeforeBudget = searchRouteCandidates(
    directGraph,
    resourceRequest(directGraph, 'o', 'd', 1),
  );
  assert.equal(kBeforeBudget.termination, 'requested-candidate-count-reached');
  assert.equal(kBeforeBudget.candidateSet.expandedStateCount, 1);

  const capacityChildIds = Array.from({ length: 4_096 }, (_, index) => `c${index + 1}`);
  const capacityGraph = resourceGraph(
    'resource-capacity-before-future-k',
    ['o', 'd', ...capacityChildIds],
    [
      { edgeId: 'e0000', fromNodeId: 'o', toNodeId: 'd', distanceMm: 1, objectiveCostUnits: 1 },
      ...capacityChildIds.map((toNodeId, index) => ({
        edgeId: `e${String(index + 1).padStart(4, '0')}`,
        fromNodeId: 'o', toNodeId, distanceMm: 1, objectiveCostUnits: 1,
      })),
    ],
  );
  const capacityBeforeFutureK = searchRouteCandidates(
    capacityGraph,
    resourceRequest(capacityGraph, 'o', 'd', 2),
  );
  assert.equal(capacityBeforeFutureK.termination, 'search-capacity-exhausted');
  assert.equal(capacityBeforeFutureK.candidateSet.expandedStateCount, 1);

  const budgetChildIds = capacityChildIds.slice(0, 4_095);
  const budgetBeforeCapacityGraph = resourceGraph(
    'resource-budget-before-capacity',
    ['o', 'd', ...budgetChildIds],
    [
      { edgeId: 'e0000', fromNodeId: 'o', toNodeId: 'd', distanceMm: 1, objectiveCostUnits: 100 },
      ...budgetChildIds.map((toNodeId, index) => ({
        edgeId: `e${String(index + 1).padStart(4, '0')}`,
        fromNodeId: 'o', toNodeId, distanceMm: 1, objectiveCostUnits: 1,
      })),
    ],
  );
  const budgetBeforeCapacity = searchRouteCandidates(
    budgetBeforeCapacityGraph,
    resourceRequest(budgetBeforeCapacityGraph, 'o', 'd', 1),
  );
  assert.equal(budgetBeforeCapacity.termination, 'search-budget-exhausted');
  assert.equal(budgetBeforeCapacity.candidateSet.expandedStateCount, 1);
});

test('production resource stops mechanically distinguish encountered unresolved evidence', () => {
  const observationsFor = (graph, unresolvedState) => Object.fromEntries(
    graph.edges.map(({ edgeId }) => [
      edgeId,
      trueCapabilityObservations(edgeId === 'e-ad' ? {
        'step-free': sourceObservation(
          'step-free',
          unresolvedState ? 'unknown' : 'observed',
          unresolvedState ? null : false,
        ),
      } : {}),
    ]),
  );
  const assertResourceOutcome = (result, termination, constraintOutcome) => {
    assert.equal(result.termination, termination);
    assert.equal(result.candidateSet.candidateCount, 1);
    assert.equal(result.candidateSet.constraintOutcome, constraintOutcome);
    const projected = {
      constraintOutcome: result.candidateSet.constraintOutcome,
      unresolvedEvidenceEncountered:
        result.candidateSet.constraintOutcome === 'unresolved-evidence',
    };
    assert.deepEqual(projected, {
      constraintOutcome,
      unresolvedEvidenceEncountered: constraintOutcome === 'unresolved-evidence',
    });
  };

  const budgetGraph = resourceGraph('resource-candidateful-budget', ['o', 'a', 'h', 'd'], [
    { edgeId: 'e-od', fromNodeId: 'o', toNodeId: 'd', distanceMm: 1, objectiveCostUnits: 1 },
    { edgeId: 'e-oa', fromNodeId: 'o', toNodeId: 'a', distanceMm: 1, objectiveCostUnits: 2 },
    { edgeId: 'e-ad', fromNodeId: 'a', toNodeId: 'd', distanceMm: 1, objectiveCostUnits: 1 },
    { edgeId: 'e-ah', fromNodeId: 'a', toNodeId: 'h', distanceMm: 1, objectiveCostUnits: 3 },
  ]);
  const budgetRequest = resourceRequest(budgetGraph, 'o', 'd', 2, true, 5);
  assertResourceOutcome(
    searchRouteCandidates(budgetGraph, budgetRequest, observationsFor(budgetGraph, true)),
    'search-budget-exhausted',
    'unresolved-evidence',
  );
  assertResourceOutcome(
    searchRouteCandidates(budgetGraph, budgetRequest, observationsFor(budgetGraph, false)),
    'search-budget-exhausted',
    'eligible-candidates-returned',
  );

  const capacityChildIds = Array.from({ length: 4_097 }, (_, index) => `c${index + 1}`);
  const capacityGraph = resourceGraph(
    'resource-candidateful-capacity',
    ['o', 'a', 'h', 'd', ...capacityChildIds],
    [
      { edgeId: 'e-od', fromNodeId: 'o', toNodeId: 'd', distanceMm: 1, objectiveCostUnits: 1 },
      { edgeId: 'e-oa', fromNodeId: 'o', toNodeId: 'a', distanceMm: 1, objectiveCostUnits: 2 },
      { edgeId: 'e-ad', fromNodeId: 'a', toNodeId: 'd', distanceMm: 1, objectiveCostUnits: 1 },
      { edgeId: 'e-ah', fromNodeId: 'a', toNodeId: 'h', distanceMm: 1, objectiveCostUnits: 3 },
      ...capacityChildIds.map((toNodeId, index) => ({
        edgeId: `e-h-${index + 1}`,
        fromNodeId: 'h',
        toNodeId,
        distanceMm: 1,
        objectiveCostUnits: 1,
      })),
    ],
  );
  const capacityRequest = resourceRequest(capacityGraph, 'o', 'd', 100, true, 5);
  assertResourceOutcome(
    searchRouteCandidates(capacityGraph, capacityRequest, observationsFor(capacityGraph, true)),
    'search-capacity-exhausted',
    'unresolved-evidence',
  );
  assertResourceOutcome(
    searchRouteCandidates(capacityGraph, capacityRequest, observationsFor(capacityGraph, false)),
    'search-capacity-exhausted',
    'eligible-candidates-returned',
  );
});

test('product and oracle expected-outcome schema bind the full composite key and comparator inputs', () => {
  const run = runManifest();
  const product = productExecution(
    run,
    'main',
    scenarioIdForDestination(run, 'n1'),
    S3_CONFIGURATION_IDS[0],
  );
  assert.equal(admitS3ProductExecution(product, run).searchResult.termination, 'bounded-search-space-exhausted');
  const oracle = oracleResult(run, product);
  assert.deepEqual(
    admitS3IndependentOracleResult(oracle, run).expectedOutcome,
    comparatorFixtureOutcome(product),
  );
  const renamed = oracleResult(run, product);
  for (let index = 0; index < renamed.expectedOutcome.orderedCandidates.length; index += 1) {
    const oldId = `candidate:${index + 1}`;
    const newId = `oracle:${index + 1}`;
    renamed.expectedOutcome.orderedCandidates[index].candidateId = newId;
    for (const key of [
      'admittedCandidateIds', 'rankedCandidateIds', 'rejectedCandidateIds',
      'unresolvedCandidateIds',
    ]) {
      renamed.expectedOutcome.providedSetDecision[key] = renamed.expectedOutcome
        .providedSetDecision[key].map((candidateId) => candidateId === oldId ? newId : candidateId);
    }
  }
  assert.throws(
    () => admitS3IndependentOracleResult(renamed, run),
    /candidateId must be candidate:1/,
  );
  const duplicateRoute = oracleResult(run, product);
  duplicateRoute.expectedOutcome.orderedCandidates[1].edgeIds = [
    ...duplicateRoute.expectedOutcome.orderedCandidates[0].edgeIds,
  ];
  assert.throws(
    () => admitS3IndependentOracleResult(duplicateRoute, run),
    /distinct directed-edge sequences/,
  );
  const generationOrderDrift = oracleResult(run, product);
  const firstRoute = generationOrderDrift.expectedOutcome.orderedCandidates[0].edgeIds;
  generationOrderDrift.expectedOutcome.orderedCandidates[0].edgeIds =
    generationOrderDrift.expectedOutcome.orderedCandidates[1].edgeIds;
  generationOrderDrift.expectedOutcome.orderedCandidates[1].edgeIds = firstRoute;
  assert.throws(
    () => admitS3IndependentOracleResult(generationOrderDrift, run),
    /objective-cost then directed-edge-sequence generation order/,
  );
  const keyDrift = structuredClone(product);
  keyDrift.recordKey = 'other';
  assert.throws(() => admitS3ProductExecution(keyDrift, run), /composite identity drifted/);
  const requestDrift = structuredClone(product);
  requestDrift.searchRequest.bounds.maxExpandedStates -= 1;
  assert.throws(() => admitS3ProductExecution(requestDrift, run), /template projection/);
  const evidenceDrift = structuredClone(product);
  evidenceDrift.evidenceIdentity.fixtureVersion = 'other-edge-evidence-v1';
  assert.throws(() => admitS3ProductExecution(evidenceDrift, run), /evidence identity drifted/);
  const evaluationDrift = structuredClone(product);
  evaluationDrift.decisionEvaluation.evaluation.reasonCode = 'fabricated-evaluation';
  assert.throws(() => admitS3ProductExecution(evaluationDrift, run), /does not match/);
});

test('oracle admission mechanically enforces evaluator envelope status and exact reason mappings', () => {
  const run = runManifest();
  const product = productExecution(run, 'main', scenarioIdForDestination(run, 'n1'), S3_CONFIGURATION_IDS[0]);
  const renamedReason = oracleResult(run, product);
  renamedReason.expectedOutcome.providedSetDecision.reasonCode = 'oracle-provided-set-evaluated';
  assert.throws(
    () => admitS3IndependentOracleResult(renamedReason, run),
    /reasonCode.*drifted from the frozen protocol/,
  );
  const wrongOuterStatus = oracleResult(run, product);
  wrongOuterStatus.expectedOutcome.providedSetDecision.evaluationStatus = 'not-evaluated';
  assert.throws(
    () => admitS3IndependentOracleResult(wrongOuterStatus, run),
    /evaluationStatus.*drifted from the frozen protocol/,
  );
  const wrongDecisionStatus = oracleResult(run, product);
  wrongDecisionStatus.expectedOutcome.providedSetDecision.decisionStatus = 'candidate-search-incomplete';
  assert.throws(
    () => admitS3IndependentOracleResult(wrongDecisionStatus, run),
    /decisionStatus.*drifted from the frozen protocol/,
  );

  for (const [termination, reasonCode] of Object.entries(ZERO_CANDIDATE_REASON_BY_TERMINATION)) {
    if (termination === 'invalid-input' || termination === 'endpoint-unavailable') continue;
    const hasConstraints = [
      'no-eligible-route-in-bounded-scope',
      'unresolved-constraint-evidence',
    ].includes(termination);
    const zeroProduct = hasConstraints
      ? productExecution(run, 'main', scenarioIdForDestination(run, 'n1'), S3_CONFIGURATION_IDS[4])
      : product;
    const zero = oracleResult(run, zeroProduct, {
      expectedOutcome: zeroCandidateOutcome(termination, { hasConstraints }),
    });
    const admitted = admitS3IndependentOracleResult(zero, run);
    assert.equal(admitted.expectedOutcome.providedSetDecision.evaluationStatus, 'not-evaluated');
    assert.equal(admitted.expectedOutcome.providedSetDecision.decisionStatus, null);
    assert.equal(admitted.expectedOutcome.providedSetDecision.reasonCode, reasonCode);
    const wrongReason = structuredClone(zero);
    wrongReason.expectedOutcome.providedSetDecision.reasonCode = `${reasonCode}-renamed`;
    assert.throws(
      () => admitS3IndependentOracleResult(wrongReason, run),
      /reasonCode.*drifted from the frozen protocol/,
      termination,
    );
  }
});

test('oracle admission enforces the frozen S2 candidate-count and resource termination truth table', () => {
  const run = runManifest();
  const product = productExecution(
    run,
    'main',
    scenarioIdForDestination(run, 'n1'),
    S3_CONFIGURATION_IDS[0],
  );
  const bounded = oracleResult(run, product);
  assert.equal(bounded.expectedOutcome.orderedCandidates.length, 2);
  assert.equal(bounded.expectedOutcome.termination, 'bounded-search-space-exhausted');
  assert.equal(
    admitS3IndependentOracleResult(bounded, run).expectedOutcome
      .searchMetadata.routeSearchCompleteness,
    'complete-within-bounds',
  );

  for (const inapplicableMainTermination of ['invalid-input', 'endpoint-unavailable']) {
    const inapplicableMain = oracleResult(run, product, {
      expectedOutcome: zeroCandidateOutcome(inapplicableMainTermination),
    });
    assert.throws(
      () => admitS3IndependentOracleResult(inapplicableMain, run),
      /only applicable to the invalid-input conformance probe|not applicable in S3 v1/,
      inapplicableMainTermination,
    );
  }
  const endpointProduct = structuredClone(product);
  endpointProduct.searchResult = {
    ...structuredClone(product.searchResult),
    status: 'not-started',
    termination: 'endpoint-unavailable',
    candidateSet: null,
    candidateFacts: [],
  };
  endpointProduct.decisionEvaluation = decisionEvaluation(
    endpointProduct.decisionPolicy,
    endpointProduct.searchResult,
  );
  assert.throws(
    () => admitS3ProductExecution(endpointProduct, run),
    /endpoint-unavailable is not applicable in S3 v1/,
  );
  const invalidMainProduct = structuredClone(product);
  invalidMainProduct.searchResult = {
    ...structuredClone(product.searchResult),
    status: 'rejected',
    termination: 'invalid-input',
    request: null,
    candidateSet: null,
    candidateFacts: [],
  };
  invalidMainProduct.decisionEvaluation = decisionEvaluation(
    invalidMainProduct.decisionPolicy,
    invalidMainProduct.searchResult,
  );
  assert.throws(
    () => admitS3ProductExecution(invalidMainProduct, run),
    /null result request is only valid for invalid-input probe/,
  );
  const disconnectedProbe = run.protocol.cohort.conformanceProbes
    .find(({ probeKind }) => probeKind === 'disconnected');
  const conformanceEndpointProduct = productExecution(
    run,
    'conformance',
    disconnectedProbe.probeId,
    disconnectedProbe.configurationId,
  );
  conformanceEndpointProduct.searchResult = {
    ...structuredClone(conformanceEndpointProduct.searchResult),
    status: 'not-started',
    termination: 'endpoint-unavailable',
    candidateSet: null,
    candidateFacts: [],
  };
  conformanceEndpointProduct.decisionEvaluation = decisionEvaluation(
    conformanceEndpointProduct.decisionPolicy,
    conformanceEndpointProduct.searchResult,
  );
  assert.throws(
    () => admitS3ProductExecution(conformanceEndpointProduct, run),
    /endpoint-unavailable is not applicable in S3 v1/,
  );

  const fabricated = structuredClone(bounded);
  fabricated.expectedOutcome.termination = 'fabricated-terminal';
  assert.throws(
    () => admitS3IndependentOracleResult(fabricated, run),
    /termination is unsupported/,
  );
  for (const zeroOnlyTermination of [
    'invalid-input',
    'no-directed-route-in-bounded-scope',
    'no-eligible-route-in-bounded-scope',
  ]) {
    const candidatefulZeroOnly = structuredClone(bounded);
    candidatefulZeroOnly.expectedOutcome.termination = zeroOnlyTermination;
    assert.throws(
      () => admitS3IndependentOracleResult(candidatefulZeroOnly, run),
      /must have zero candidates|requires zero candidates/,
      zeroOnlyTermination,
    );
  }
  const shortRequestedK = structuredClone(bounded);
  shortRequestedK.expectedOutcome.termination = 'requested-candidate-count-reached';
  Object.assign(shortRequestedK.expectedOutcome.searchMetadata, {
    status: 'completed',
    routeSearchCompleteness: 'not-proven',
    budgetOutcome: 'within-budget',
    capacityOutcome: 'within-capacity',
    unresolvedEvidenceEncountered: null,
  });
  assert.throws(
    () => admitS3IndependentOracleResult(shortRequestedK, run),
    /requires exactly requestedCandidateCount candidates/,
  );

  const budgetPartial = structuredClone(bounded);
  budgetPartial.expectedOutcome.termination = 'search-budget-exhausted';
  Object.assign(budgetPartial.expectedOutcome.searchMetadata, {
    status: 'stopped',
    expandedStateCount: 100_000,
    routeSearchCompleteness: 'not-proven',
    budgetOutcome: 'exhausted',
    capacityOutcome: 'within-capacity',
  });
  assert.equal(
    admitS3IndependentOracleResult(budgetPartial, run).expectedOutcome.termination,
    'search-budget-exhausted',
  );
  const budgetMetadataDrift = structuredClone(budgetPartial);
  budgetMetadataDrift.expectedOutcome.searchMetadata.expandedStateCount -= 1;
  assert.throws(
    () => admitS3IndependentOracleResult(budgetMetadataDrift, run),
    /exact expansion bound/,
  );

  const capacityPartial = structuredClone(bounded);
  capacityPartial.expectedOutcome.termination = 'search-capacity-exhausted';
  Object.assign(capacityPartial.expectedOutcome.searchMetadata, {
    status: 'stopped',
    routeSearchCompleteness: 'not-proven',
    budgetOutcome: 'within-budget',
    capacityOutcome: 'exhausted',
  });
  assert.equal(
    admitS3IndependentOracleResult(capacityPartial, run).expectedOutcome.termination,
    'search-capacity-exhausted',
  );
  const capacityMetadataDrift = structuredClone(capacityPartial);
  capacityMetadataDrift.expectedOutcome.searchMetadata.status = 'completed';
  assert.throws(
    () => admitS3IndependentOracleResult(capacityMetadataDrift, run),
    /status.*drifted from the frozen protocol/,
  );
});

test('candidateful unresolved product results remain admissible through the independent oracle boundary', () => {
  const source = protocol();
  const alternateEvidence = source.cohort.edgeFactorEvidence.edgeEvidence
    .find(({ edgeId }) => edgeId === 'e-alt-1');
  alternateEvidence.observations['step-free'] = sourceObservation('step-free', 'unknown');
  const run = runManifest({
    protocol: source,
    protocolId: source.protocolId,
    graphScope: structuredClone(source.cohort.graphScope),
  });
  const scenarioId = scenarioIdForDestination(run, 'n1');
  const product = productExecution(run, 'main', scenarioId, S3_CONFIGURATION_IDS[4]);
  assert.equal(product.searchResult.termination, 'unresolved-constraint-evidence');
  assert.equal(product.searchResult.candidateSet.candidateCount, 1);
  assert.equal(product.searchResult.candidateSet.constraintOutcome, 'unresolved-evidence');
  assert.equal(
    comparatorFixtureOutcome(product).searchMetadata.unresolvedEvidenceEncountered,
    true,
  );
  assert.equal(
    admitS3ProductExecution(product, run).searchResult.termination,
    'unresolved-constraint-evidence',
  );
  const admittedOracle = admitS3IndependentOracleResult(oracleResult(run, product), run);
  assert.equal(admittedOracle.expectedOutcome.orderedCandidates.length, 1);
  assert.equal(
    admittedOracle.expectedOutcome.searchMetadata.constraintOutcome,
    'unresolved-evidence',
  );
  assert.equal(
    admittedOracle.expectedOutcome.providedSetDecision.evaluationStatus,
    'evaluated',
  );
  const wrongConstraintOutcome = oracleResult(run, product);
  wrongConstraintOutcome.expectedOutcome.searchMetadata.constraintOutcome =
    'eligible-candidates-returned';
  assert.throws(
    () => admitS3IndependentOracleResult(wrongConstraintOutcome, run),
    /constraintOutcome.*drifted from the frozen protocol/,
  );

  for (const resourceTermination of [
    'search-budget-exhausted',
    'search-capacity-exhausted',
  ]) {
    const unresolvedStop = oracleResult(run, product);
    unresolvedStop.expectedOutcome.termination = resourceTermination;
    Object.assign(unresolvedStop.expectedOutcome.searchMetadata, {
      status: 'stopped',
      expandedStateCount: resourceTermination === 'search-budget-exhausted'
        ? 100_000
        : product.searchResult.candidateSet.expandedStateCount,
      routeSearchCompleteness: 'not-proven',
      constraintOutcome: 'unresolved-evidence',
      budgetOutcome: resourceTermination === 'search-budget-exhausted'
        ? 'exhausted'
        : 'within-budget',
      capacityOutcome: resourceTermination === 'search-capacity-exhausted'
        ? 'exhausted'
        : 'within-capacity',
      unresolvedEvidenceEncountered: true,
    });
    assert.equal(
      admitS3IndependentOracleResult(unresolvedStop, run).expectedOutcome
        .searchMetadata.constraintOutcome,
      'unresolved-evidence',
      resourceTermination,
    );

    const fullyObservedStop = structuredClone(unresolvedStop);
    Object.assign(fullyObservedStop.expectedOutcome.searchMetadata, {
      constraintOutcome: 'eligible-candidates-returned',
      unresolvedEvidenceEncountered: false,
    });
    assert.equal(
      admitS3IndependentOracleResult(fullyObservedStop, run).expectedOutcome
        .searchMetadata.constraintOutcome,
      'eligible-candidates-returned',
      resourceTermination,
    );

    const selfReportedMismatch = structuredClone(unresolvedStop);
    selfReportedMismatch.expectedOutcome.searchMetadata.unresolvedEvidenceEncountered = false;
    assert.throws(
      () => admitS3IndependentOracleResult(selfReportedMismatch, run),
      /constraintOutcome.*drifted from the frozen protocol/,
      resourceTermination,
    );
  }

  const kMinusOneSource = protocol();
  const graph = kMinusOneSource.cohort.graphScope.graphArtifact;
  const evidence = kMinusOneSource.cohort.edgeFactorEvidence;
  for (const suffix of ['997', '998', '999']) {
    const edge = {
      edgeId: `e-extra-${suffix}`,
      fromNodeId: `n${suffix}`,
      toNodeId: 'n1',
      distanceMm: 100,
      objectiveCostUnits: 1,
    };
    graph.edges.push(edge);
    evidence.edgeEvidence.push({
      edgeId: edge.edgeId,
      observations: trueCapabilityObservations(),
    });
  }
  const graphContentIdentity = structuredClone(buildS3GraphContentIdentity(graph));
  kMinusOneSource.cohort.graphScope.graphContentIdentity = graphContentIdentity;
  evidence.graphContentIdentity = structuredClone(graphContentIdentity);
  evidence.edgeEvidence.find(({ edgeId }) => edgeId === 'e-alt-1')
    .observations['step-free'] = sourceObservation('step-free', 'unknown');
  kMinusOneSource.cohort.odPairs = structuredClone(buildS3ScenarioOdPairs(
    graph,
    S3_SCENARIO_GENERATOR_VERSION,
    S3_SCENARIO_SEED,
  ));
  const kMinusOneRun = runManifest({
    protocol: kMinusOneSource,
    protocolId: kMinusOneSource.protocolId,
    graphScope: structuredClone(kMinusOneSource.cohort.graphScope),
  });
  const kMinusOneScenarioId = scenarioIdForDestination(kMinusOneRun, 'n1');
  const kMinusOneProduct = productExecution(
    kMinusOneRun,
    'main',
    kMinusOneScenarioId,
    S3_CONFIGURATION_IDS[4],
  );
  assert.equal(kMinusOneProduct.searchResult.termination, 'unresolved-constraint-evidence');
  assert.equal(kMinusOneProduct.searchResult.candidateSet.candidateCount, 4);
  assert.equal(kMinusOneProduct.searchResult.candidateSet.constraintOutcome, 'unresolved-evidence');
  assert.equal(
    admitS3IndependentOracleResult(
      oracleResult(kMinusOneRun, kMinusOneProduct),
      kMinusOneRun,
    ).expectedOutcome.orderedCandidates.length,
    4,
  );

  const zeroProduct = productExecution(run, 'main', scenarioId, S3_CONFIGURATION_IDS[4]);
  const zeroUnresolved = oracleResult(run, zeroProduct, {
    expectedOutcome: zeroCandidateOutcome('unresolved-constraint-evidence', {
      hasConstraints: true,
    }),
  });
  assert.equal(
    admitS3IndependentOracleResult(zeroUnresolved, run).expectedOutcome
      .searchMetadata.candidateCount,
    0,
  );

  kMinusOneSource.cohort.edgeFactorEvidence.edgeEvidence
    .find(({ edgeId }) => edgeId === 'e-alt-1')
    .observations['step-free'] = sourceObservation('step-free');
  const kRun = runManifest({
    protocol: kMinusOneSource,
    protocolId: kMinusOneSource.protocolId,
    graphScope: structuredClone(kMinusOneSource.cohort.graphScope),
  });
  const kScenarioId = scenarioIdForDestination(kRun, 'n1');
  const kProduct = productExecution(kRun, 'main', kScenarioId, S3_CONFIGURATION_IDS[4]);
  assert.equal(kProduct.searchResult.termination, 'requested-candidate-count-reached');
  assert.equal(kProduct.searchResult.candidateFacts.length, 5);
  assert.equal(
    admitS3IndependentOracleResult(oracleResult(kRun, kProduct), kRun)
      .expectedOutcome.searchMetadata.unresolvedEvidenceEncountered,
    null,
  );
  const kCandidates = oracleResult(kRun, kProduct);
  kCandidates.expectedOutcome.termination = 'unresolved-constraint-evidence';
  Object.assign(kCandidates.expectedOutcome.searchMetadata, {
    status: 'completed',
    routeSearchCompleteness: 'complete-within-bounds',
    constraintOutcome: 'unresolved-evidence',
    budgetOutcome: 'within-budget',
    capacityOutcome: 'within-capacity',
    unresolvedEvidenceEncountered: true,
  });
  assert.throws(
    () => admitS3IndependentOracleResult(kCandidates, kRun),
    /fewer than K candidates/,
  );
  const unconstrainedProduct = productExecution(run, 'main', scenarioId, S3_CONFIGURATION_IDS[0]);
  const unconstrainedUnresolved = oracleResult(run, unconstrainedProduct);
  unconstrainedUnresolved.expectedOutcome.termination = 'unresolved-constraint-evidence';
  Object.assign(unconstrainedUnresolved.expectedOutcome.searchMetadata, {
    status: 'completed',
    routeSearchCompleteness: 'complete-within-bounds',
    constraintOutcome: 'unresolved-evidence',
    budgetOutcome: 'within-budget',
    capacityOutcome: 'within-capacity',
  });
  assert.throws(
    () => admitS3IndependentOracleResult(unconstrainedUnresolved, run),
    /requires fewer than K candidates and hard constraints/,
  );
});

test('oracle evaluator fixture freezes clamp, floor, weighted score, disposition, explanation, and tie-break', () => {
  const fixture = S3_ORACLE_EXECUTION_SPEC.providedSetEvaluation.differentialFixtures[0];
  assert.equal(fixture.fixtureId, 'clamp-floor-weight-and-candidate-id-tie-break');
  const computedScores = fixture.candidates.map(({ candidateId, rawValue }) => {
    const { rangeMin, rangeMax, weightBasisPoints } = fixture.preference;
    const clampedValue = Math.min(rangeMax, Math.max(rangeMin, rawValue));
    const utilityNumerator = (rangeMax - clampedValue) * 10_000;
    const utilityBasisPoints = Math.floor(utilityNumerator / (rangeMax - rangeMin));
    return {
      candidateId,
      clampedValue,
      utilityNumerator,
      utilityBasisPoints,
      weightedScoreUnits: utilityBasisPoints * weightBasisPoints,
    };
  });
  assert.deepEqual(computedScores, fixture.expectedScores);
  assert.deepEqual(fixture.expectedRankedCandidateIds, [
    'candidate:1', 'candidate:2', 'candidate:3',
  ]);
  assert.equal(fixture.expectedDispositionReasonCode, 'candidate-admitted');
  assert.equal(fixture.expectedRankingReasonCode, 'candidate-ranked');
  assert.equal(fixture.expectedOuterReasonCode, 'provided-candidate-set-evaluated');

  const run = runManifest();
  const product = productExecution(run, 'main', scenarioIdForDestination(run, 'n1'), S3_CONFIGURATION_IDS[0]);
  const exact = admitS3IndependentOracleResult(oracleResult(run, product), run).expectedOutcome;
  assert.equal(exact.providedSetDecision.publicExplanation.candidateDispositions[0].reasonCode, 'candidate-admitted');
  assert.equal(exact.providedSetDecision.publicExplanation.rankingTrace[0].reasonCode, 'candidate-ranked');
  const scoreDrift = oracleResult(run, product);
  scoreDrift.expectedOutcome.providedSetDecision.publicExplanation
    .softPreferenceTrace[0].utilityBasisPoints += 1;
  assert.throws(
    () => admitS3IndependentOracleResult(scoreDrift, run),
    /utilityBasisPoints.*drifted from the frozen protocol/,
  );
  const dispositionDrift = oracleResult(run, product);
  dispositionDrift.expectedOutcome.providedSetDecision.publicExplanation
    .candidateDispositions[0].reasonCode = 'oracle-candidate-admitted';
  assert.throws(
    () => admitS3IndependentOracleResult(dispositionDrift, run),
    /reasonCode.*drifted from the frozen protocol/,
  );
  const tieBreakDrift = oracleResult(run, product);
  tieBreakDrift.expectedOutcome.providedSetDecision.publicExplanation
    .rankingTrace[0].tieBreakValues.at(-1).value = 'candidate:999';
  assert.throws(
    () => admitS3IndependentOracleResult(tieBreakDrift, run),
    /value.*drifted from the frozen protocol/,
  );
});

test('structural equality ignores object insertion order but preserves value and array semantics', () => {
  const left = {
    candidateId: 'candidate:1',
    stage: 'soft-preference',
    result: { outcome: 'scored', utilityBasisPoints: 9_000 },
  };
  const right = Object.fromEntries([
    ['result', Object.fromEntries([
      ['utilityBasisPoints', 9_000],
      ['outcome', 'scored'],
    ])],
    ['stage', 'soft-preference'],
    ['candidateId', 'candidate:1'],
  ]);
  assert.deepEqual(left, right);
  assert.notDeepEqual(Object.keys(left), Object.keys(right));
  assert.equal(areS3DataTreesEquivalent(left, right), true);

  const valueDrift = structuredClone(right);
  valueDrift.result.utilityBasisPoints = 8_999;
  assert.equal(areS3DataTreesEquivalent(left, valueDrift), false);
  const trace = [
    { candidateId: 'candidate:1', stage: 'soft-preference' },
    { candidateId: 'candidate:1', stage: 'ranking' },
  ];
  assert.equal(areS3DataTreesEquivalent(trace, [...trace].reverse()), false);

  let directGets = 0;
  const descriptorSafe = new Proxy(left, {
    get() {
      directGets += 1;
      throw new Error('direct get');
    },
  });
  assert.equal(areS3DataTreesEquivalent(descriptorSafe, left), true);
  assert.equal(directGets, 0);
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'candidateId', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'candidate:1';
    },
  });
  assert.equal(areS3DataTreesEquivalent(accessor, { candidateId: 'candidate:1' }), false);
  assert.equal(getterCalls, 0);

  const symbolKey = { candidateId: 'candidate:1', [Symbol('hidden')]: true };
  assert.equal(areS3DataTreesEquivalent(symbolKey, symbolKey), false);
  const blockedKey = {};
  Object.defineProperty(blockedKey, '__proto__', {
    enumerable: true,
    configurable: true,
    writable: true,
    value: 'blocked',
  });
  assert.equal(areS3DataTreesEquivalent(blockedKey, blockedKey), false);
  const unsupportedPrototype = Object.create(null);
  unsupportedPrototype.candidateId = 'candidate:1';
  assert.equal(
    areS3DataTreesEquivalent(unsupportedPrototype, unsupportedPrototype),
    false,
  );
  const arrayWithExtra = [1, 2];
  arrayWithExtra.extra = true;
  assert.equal(areS3DataTreesEquivalent(arrayWithExtra, arrayWithExtra), false);
});

test('structural equality bounds cycles, depth, and repeated-pair traversal without rejecting shared DAGs', () => {
  const leftCycle = {};
  const rightCycle = {};
  leftCycle.self = leftCycle;
  rightCycle.self = rightCycle;
  assert.doesNotThrow(() => areS3DataTreesEquivalent(leftCycle, rightCycle));
  assert.equal(areS3DataTreesEquivalent(leftCycle, rightCycle), false);

  const nestedTree = (depth) => {
    const root = {};
    let cursor = root;
    for (let index = 0; index < depth; index += 1) {
      cursor.child = {};
      cursor = cursor.child;
    }
    return root;
  };
  assert.doesNotThrow(() => areS3DataTreesEquivalent(nestedTree(70), nestedTree(70)));
  assert.equal(areS3DataTreesEquivalent(nestedTree(70), nestedTree(70)), false);

  const leftShared = { value: 1 };
  const rightShared = { value: 1 };
  assert.equal(
    areS3DataTreesEquivalent(
      { first: leftShared, second: leftShared },
      { second: rightShared, first: rightShared },
    ),
    true,
  );

  const repeatedPairDag = (depth) => {
    let shared = { value: 1 };
    for (let index = 0; index < depth; index += 1) {
      shared = { left: shared, right: shared };
    }
    return shared;
  };
  assert.equal(
    areS3DataTreesEquivalent(repeatedPairDag(8), repeatedPairDag(8)),
    true,
  );
  assert.doesNotThrow(() => areS3DataTreesEquivalent(
    repeatedPairDag(17),
    repeatedPairDag(17),
  ));
  assert.equal(
    areS3DataTreesEquivalent(repeatedPairDag(17), repeatedPairDag(17)),
    false,
  );
});

test('joined records reject product/oracle drift and unsupported replay matches', () => {
  const run = runManifest();
  const multiRouteScenarioId = scenarioIdForDestination(run, 'n1');
  const joined = joinedRecord(run, 'main', multiRouteScenarioId, S3_CONFIGURATION_IDS[0]);
  const admittedJoined = admitS3JoinedRunRecord(joined, run);
  assert.equal(joined.primaryExecution.searchResult.candidateFacts.length, 2);
  assert.equal(admittedJoined.replayComparison, 'match');
  assert.equal(admittedJoined.oracleComparison, 'match');
  const admittedPrimary = admitS3ProductExecution(joined.primaryExecution, run);
  const primarySoftTrace = comparatorFixtureOutcome(admittedPrimary)
    .providedSetDecision.publicExplanation.softPreferenceTrace[0];
  const oracleSoftTrace = admittedJoined.oracleResult.expectedOutcome
    .providedSetDecision.publicExplanation.softPreferenceTrace[0];
  assert.deepEqual(primarySoftTrace, oracleSoftTrace);
  assert.notDeepEqual(Object.keys(primarySoftTrace), Object.keys(oracleSoftTrace));

  const g4Joined = joinedRecord(run, 'main', multiRouteScenarioId, S3_CONFIGURATION_IDS[4]);
  const admittedG4Joined = admitS3JoinedRunRecord(g4Joined, run);
  assert.equal(g4Joined.primaryExecution.searchResult.candidateFacts.length, 2);
  assert.equal(admittedG4Joined.replayComparison, 'match');
  assert.equal(admittedG4Joined.oracleComparison, 'match');
  const mismatch = structuredClone(joined);
  mismatch.oracleResult.searchRequest.originNodeId = 'n9';
  assert.throws(() => admitS3JoinedRunRecord(mismatch, run), /binding drifted|template projection/);
  const replayDrift = structuredClone(joined);
  replayDrift.replayExecution.searchResult.candidateFacts.reverse();
  replayDrift.replayExecution.searchResult.candidateSet.candidateIds.reverse();
  assert.throws(() => admitS3JoinedRunRecord(replayDrift, run), /tie-break order/);
  const admittedReplayMismatch = structuredClone(joined);
  admittedReplayMismatch.replayExecution.searchResult.candidateFacts[0].candidateId = 'candidate:9';
  admittedReplayMismatch.replayExecution.searchResult.candidateSet.candidateIds[0] = 'candidate:9';
  admittedReplayMismatch.replayExecution.decisionEvaluation = decisionEvaluation(
    admittedReplayMismatch.replayExecution.decisionPolicy,
    admittedReplayMismatch.replayExecution.searchResult,
  );
  assert.equal(admitS3JoinedRunRecord(admittedReplayMismatch, run).replayComparison, 'mismatch');
  const oraclePathBindingDrift = structuredClone(joined);
  const firstPath = oraclePathBindingDrift.oracleResult.expectedOutcome.orderedCandidates[0].edgeIds;
  oraclePathBindingDrift.oracleResult.expectedOutcome.orderedCandidates[0].edgeIds =
    oraclePathBindingDrift.oracleResult.expectedOutcome.orderedCandidates[1].edgeIds;
  oraclePathBindingDrift.oracleResult.expectedOutcome.orderedCandidates[1].edgeIds = firstPath;
  assert.throws(
    () => admitS3JoinedRunRecord(oraclePathBindingDrift, run),
    /drifted from the frozen protocol|generation order/,
  );
  const rankingDrift = structuredClone(joined);
  rankingDrift.oracleResult.expectedOutcome.providedSetDecision.rankedCandidateIds.reverse();
  assert.throws(
    () => admitS3JoinedRunRecord(rankingDrift, run),
    /drifted from the frozen protocol/,
  );
  const skippedTerminalOracle = structuredClone(joined);
  skippedTerminalOracle.oracleResult.oracleStatus = 'not-run';
  skippedTerminalOracle.oracleResult.expectedOutcome = null;
  assert.throws(
    () => admitS3JoinedRunRecord(skippedTerminalOracle, run),
    /oracle computed\/not-run policy drifted/,
  );
  const selfReplay = structuredClone(joined);
  selfReplay.replayExecution = structuredClone(selfReplay.primaryExecution);
  assert.throws(
    () => admitS3JoinedRunRecord(selfReplay, run),
    /distinct primary and replay execution attempts/,
  );
  const sameAttempt = structuredClone(joined);
  sameAttempt.replayExecution.executionAttemptId = sameAttempt.primaryExecution.executionAttemptId;
  assert.throws(
    () => admitS3JoinedRunRecord(sameAttempt, run),
    /distinct primary and replay execution attempts/,
  );
});

test('record collections reject duplicates, missing record fields, extras, and cross-denominator records', () => {
  const run = runManifest();
  const main = joinedRecord(run, 'main', 'od-0000', S3_CONFIGURATION_IDS[0]);
  assert.equal(admitS3RecordCollection(collection(run, [main], [])).mainRecords.length, 1);
  assert.throws(() => admitS3RecordCollection(collection(run, [main, structuredClone(main)], [])), /duplicate/);
  const missing = structuredClone(main);
  delete missing.primaryExecution.profileId;
  assert.throws(() => admitS3RecordCollection(collection(run, [missing], [])), /missing: profileId/);
  const extra = structuredClone(main);
  extra.oracleResult.accuracy = 1;
  assert.throws(() => admitS3RecordCollection(collection(run, [extra], [])), /unknown: accuracy/);
  const conformance = joinedRecord(run, 'conformance', 'probe-invalid-input', S3_CONFIGURATION_IDS[0]);
  assert.throws(() => admitS3RecordCollection(collection(run, [conformance], [])), /cross-denominator/);
  const reusedAttempt = joinedRecord(run, 'main', 'od-0001', S3_CONFIGURATION_IDS[0]);
  reusedAttempt.primaryExecution.executionAttemptId = main.primaryExecution.executionAttemptId;
  assert.throws(
    () => admitS3RecordCollection(collection(run, [main, reusedAttempt], [])),
    /executionAttemptIds must be globally distinct/,
  );
});

test('report derives partial counts and observation-state denominators from admitted records', () => {
  const source = protocol();
  const evidenceByEdge = new Map(source.cohort.edgeFactorEvidence.edgeEvidence.map((entry) => [entry.edgeId, entry]));
  evidenceByEdge.get('e1').observations['step-free'] = sourceObservation('step-free', 'observed', false);
  evidenceByEdge.get('e1').observations['paved-surface'] = sourceObservation('paved-surface', 'unavailable');
  for (const edgeId of ['e-alt-1', 'e-alt-2']) {
    evidenceByEdge.get(edgeId).observations['step-free'] = sourceObservation('step-free', 'unknown');
    evidenceByEdge.get(edgeId).observations['curb-ramp-present'] = sourceObservation('curb-ramp-present', 'partial');
    evidenceByEdge.get(edgeId).observations['paved-surface'] = sourceObservation('paved-surface', 'stale');
  }
  evidenceByEdge.get('e2').observations['step-free'] = sourceObservation('step-free', 'invalid');
  const run = runManifest({
    protocol: source,
    protocolId: source.protocolId,
    graphScope: structuredClone(source.cohort.graphScope),
  });
  const firstScenarioId = scenarioIdForDestination(run, 'n1');
  const secondScenarioId = scenarioIdForDestination(run, 'n2');
  const firstResult = enrichedSearchResult(run, firstScenarioId, {
    'candidate:1': countObservation('zero', 0),
  });
  const secondResult = enrichedSearchResult(run, secondScenarioId, {
    'candidate:1': countObservation('observed', 2),
  });
  const records = [
    joinedRecord(run, 'main', firstScenarioId, S3_CONFIGURATION_IDS[0], { searchResult: firstResult }),
    joinedRecord(run, 'main', secondScenarioId, S3_CONFIGURATION_IDS[0], { searchResult: secondResult }),
  ];
  const admitted = admitS3Report(report(collection(run, records, []), ['bounded-offline-validation']));
  assert.deepEqual(
    Object.fromEntries(['expected', 'attempted', 'recorded', 'terminal', 'notStarted', 'startedNoTerminal'].map((key) => [key, admitted.mainCohortDenominators[key]])),
    { expected: 5_000, attempted: 2, recorded: 2, terminal: 2, notStarted: 4_998, startedNoTerminal: 0 },
  );
  assert.equal(admitted.mainCohortDenominators.observationStates.denominatorUnit, 'candidate-factor-observation');
  assert.equal(admitted.mainCohortDenominators.observationStates.denominator, 9);
  assert.equal(admitted.mainCohortDenominators.observationStates.observedBooleanTrue, 3);
  assert.equal(admitted.mainCohortDenominators.observationStates.observedBooleanFalse, 1);
  assert.equal(admitted.mainCohortDenominators.observationStates.observedNumericNonzero, 0);
  assert.equal(admitted.mainCohortDenominators.observationStates.numericZero, 0);
  assert.equal(admitted.mainCohortDenominators.observationStates.missing, 0);
  for (const state of ['unknown', 'unavailable', 'partial', 'stale', 'invalid']) {
    assert.equal(admitted.mainCohortDenominators.observationStates[state], 1);
  }
  assert.equal(admitted.mainCohortDenominators.budgetOutcomes['within-budget'], 2);
  assert.equal(admitted.mainCohortDenominators.capacityOutcomes['within-capacity'], 2);
  assert.equal(admitted.mainCohortDenominators.completenessOutcomes['complete-within-bounds'], 2);
  assert.equal(admitted.mainCohortDenominators.performanceMeasurements.primary.measured, 0);
  assert.equal(
    admitted.executionEvidence.performanceInterpretation,
    'diagnostic-only-no-performance-claim-eligible-in-v1',
  );
  assert.equal(admitted.disclosures.partialRun, true);
});

test('report refuses hand-written aggregates and derives stopped/partial disclosure', () => {
  const run = runManifest();
  const main = joinedRecord(run, 'main', 'od-0000', S3_CONFIGURATION_IDS[0]);
  const input = report(collection(run, [main], []));
  input.accuracy = 1;
  assert.throws(() => admitS3Report(input), /unknown: accuracy/);
  const forgedObservationSummary = report(collection(run, [structuredClone(main)], []));
  forgedObservationSummary.recordCollection.mainRecords[0].primaryExecution.observationSummary = {
    denominatorUnit: 'candidate-factor-observation', denominator: 0,
  };
  assert.throws(() => admitS3Report(forgedObservationSummary), /unknown: observationSummary/);
  const falseComplete = report(collection(run, [main], []));
  falseComplete.disclosures.partialRun = false;
  assert.throws(() => admitS3Report(falseComplete), /partial disclosure must be derived/);
});

test('performance distributions and graph size are mechanically derived from executable records', () => {
  const run = runManifest();
  const measured = joinedRecord(run, 'main', 'od-0000', S3_CONFIGURATION_IDS[0], {
    measurement: measurement({
      measurementStatus: 'measured', cacheState: 'cold',
      latencyMicros: 120, memoryBytes: 4_096, unmeasuredReason: null,
    }),
    replayOptions: {
      measurement: measurement({
        measurementStatus: 'measured', cacheState: 'warm',
        latencyMicros: 80, memoryBytes: 3_072, unmeasuredReason: null,
      }),
    },
  });
  const unmeasured = joinedRecord(run, 'main', 'od-0001', S3_CONFIGURATION_IDS[0]);
  const admitted = admitS3Report(report(collection(run, [measured, unmeasured], [])));
  const { primary, replay } = admitted.mainCohortDenominators.performanceMeasurements;
  assert.deepEqual(primary.coldLatencyMicros, {
    sampleCount: 1, min: 120, p50: 120, p95: 120, max: 120,
  });
  assert.deepEqual(replay.warmLatencyMicros, {
    sampleCount: 1, min: 80, p50: 80, p95: 80, max: 80,
  });
  assert.equal(primary.recorded, 2);
  assert.equal(primary.measured, 1);
  assert.equal(primary.recordedNotMeasured, 1);
  assert.equal(primary.missingRecords, 4_998);
  assert.equal(primary.notMeasured, 4_999);
  assert.deepEqual(admitted.executionEvidence.graphSize, {
    nodeCount: 1_002,
    edgeCount: 1_002,
    canonicalArtifactUtf8Bytes: admitted.executionEvidence.graphSize.canonicalArtifactUtf8Bytes,
  });
  assert.equal(admitted.disclosures.partialRun, true);

  const wrongPrimaryPosition = structuredClone(measured);
  wrongPrimaryPosition.primaryExecution.measurement.cacheState = 'warm';
  assert.throws(
    () => admitS3JoinedRunRecord(wrongPrimaryPosition, run),
    /measured primary.*cold sampling position/,
  );
  const invalidReason = productExecution(run, 'main', 'od-0002', S3_CONFIGURATION_IDS[0]);
  invalidReason.measurement.unmeasuredReason = 'arbitrary-reason';
  assert.throws(() => admitS3ProductExecution(invalidReason, run), /outside the frozen performance protocol/);
  const contradictoryReason = productExecution(run, 'main', 'od-0003', S3_CONFIGURATION_IDS[0], {
    attemptState: 'not-started',
  });
  contradictoryReason.measurement.unmeasuredReason = 'measurement-failure';
  assert.throws(() => admitS3ProductExecution(contradictoryReason, run), /contradicts the execution state/);
});

test('claim predicates require preregistration, complete replay, and complete conformance evidence', () => {
  const run = runManifest();
  const main = joinedRecord(run, 'main', 'od-0000', S3_CONFIGURATION_IDS[0]);
  const missingReplay = structuredClone(main);
  delete missingReplay.replayExecution;
  assert.throws(() => admitS3JoinedRunRecord(missingReplay, run), /missing: replayExecution/);
  assert.throws(
    () => admitS3Report(report(collection(run, [main], []), ['synthetic-determinism-evidence'])),
    /complete primary\/replay all-match/,
  );
  assert.throws(
    () => admitS3Report(report(collection(run, [], []), ['synthetic-contract-conformance'])),
    /every prescribed probe/,
  );
  const notStarted = joinedRecord(run, 'main', 'od-0001', S3_CONFIGURATION_IDS[0], {
    attemptState: 'not-started',
  });
  assert.throws(
    () => admitS3Report(report(collection(run, [notStarted], []), ['bounded-offline-validation'])),
    /bounded terminal evidence/,
  );
  const unregistered = protocol({ eligibleClaimCodes: ['synthetic-engineering-protocol'] });
  const unregisteredRun = runManifest({ protocol: unregistered, protocolId: unregistered.protocolId, graphScope: structuredClone(unregistered.cohort.graphScope) });
  assert.throws(
    () => admitS3Report(report(collection(unregisteredRun, [joinedRecord(unregisteredRun, 'main', 'od-0000', S3_CONFIGURATION_IDS[0])], []), ['bounded-offline-validation'])),
    /not preregistered/,
  );
});

test('all four conformance records can pass only with their prescribed terminal results', () => {
  const run = runManifest();
  const records = run.protocol.cohort.conformanceProbes.map((probe) => joinedRecord(
    run, 'conformance', probe.probeId, probe.configurationId,
  ));
  const admitted = admitS3Report(report(collection(run, [], records), ['synthetic-contract-conformance']));
  assert.equal(admitted.conformanceDenominators.conformanceOutcomes.pass, 4);
  const wrong = structuredClone(records[1]);
  wrong.primaryExecution.searchResult.termination = 'endpoint-unavailable';
  assert.throws(() => admitS3JoinedRunRecord(wrong, run), /contract|stimulus outcome|terminal/i);
});

test('four conformance probes freeze independently executable stimuli and produce canonical terminals', () => {
  const run = runManifest();
  const graphIds = [];
  for (const probe of run.protocol.cohort.conformanceProbes) {
    graphIds.push(probe.stimulus.graphArtifact.graphId);
    const result = executeScenario(run, 'conformance', probe.probeId, probe.configurationId);
    assert.equal(result.termination, probe.expectedOutcome.termination, probe.probeKind);
    const product = productExecution(run, 'conformance', probe.probeId, probe.configurationId, {
      searchResult: result,
    });
    assert.deepEqual(comparatorFixtureOutcome(product), probe.expectedOutcome, probe.probeKind);
    if (probe.probeKind === 'invalid-input') {
      assert.equal(
        admitS3IndependentOracleResult(oracleResult(run, product), run)
          .expectedOutcome.termination,
        'invalid-input',
      );
    }
  }
  assert.equal(new Set(graphIds).size, 4);
  const invalid = run.protocol.cohort.conformanceProbes[0];
  const validRequest = requestFor(run, 'conformance', invalid.probeId, invalid.configurationId);
  const mutation = invalid.stimulus.requestMutation;
  assert.throws(
    () => admitRouteCandidateSearchRequest({ ...validRequest, [mutation.field]: mutation.invalidValue }),
    /requestedCandidateCount/,
  );
  const disconnected = run.protocol.cohort.conformanceProbes[1].stimulus;
  assert.notEqual(
    disconnected.graphArtifact.components.byNodeId[disconnected.originNodeId],
    disconnected.graphArtifact.components.byNodeId[disconnected.destinationNodeId],
  );

  const irrelevantFailure = cohort();
  const unavailable = irrelevantFailure.conformanceProbes[2].stimulus;
  unavailable.graphArtifact.nodes.push({ nodeId: 'p2' }, { nodeId: 'p3' });
  unavailable.graphArtifact.edges.push({
    edgeId: 'pe-unrelated', fromNodeId: 'p2', toNodeId: 'p3',
    distanceMm: 1_000, objectiveCostUnits: 10,
  });
  unavailable.graphArtifact.components = {
    kind: 'weakly-connected', count: 2,
    byNodeId: { p0: 0, p1: 0, p2: 1, p3: 1 },
  };
  unavailable.graphContentIdentity = structuredClone(
    buildS3GraphContentIdentity(unavailable.graphArtifact),
  );
  unavailable.edgeFactorEvidence = edgeFactorEvidence(unavailable.graphArtifact, {
    stateByEdgeFactor: {
      'pe-unrelated:step-free': sourceObservation('step-free', 'unavailable'),
    },
  });
  assert.throws(
    () => admitS3ScenarioCohort(irrelevantFailure),
    /exactly its two endpoint nodes|only OD route/,
  );
});

test('G4 edge evidence rejects missing facts and distinguishes unknown from observed false', () => {
  const missing = cohort();
  delete missing.conformanceProbes[2].stimulus.edgeFactorEvidence
    .edgeEvidence[0].observations['paved-surface'];
  assert.throws(() => admitS3ScenarioCohort(missing), /missing: paved-surface/);

  const unknownCohort = cohort();
  unknownCohort.edgeFactorEvidence.edgeEvidence
    .find(({ edgeId }) => edgeId === 'e2')
    .observations['step-free'] = sourceObservation('step-free', 'unknown');
  const unknownProtocol = protocol({ cohort: unknownCohort });
  const unknownRun = runManifest({
    protocol: unknownProtocol,
    protocolId: unknownProtocol.protocolId,
    graphScope: structuredClone(unknownProtocol.cohort.graphScope),
  });
  const unknown = productExecution(
    unknownRun,
    'main',
    scenarioIdForDestination(unknownRun, 'n2'),
    S3_CONFIGURATION_IDS[4],
  );
  assert.equal(admitS3ProductExecution(unknown, unknownRun).searchResult.termination, 'unresolved-constraint-evidence');
  assert.equal(unknown.searchResult.candidateSet.constraintOutcome, 'unresolved-evidence');

  const falseRun = runManifest();
  const knownFalse = productExecution(
    falseRun,
    'conformance',
    'probe-constraint-no-solution',
    S3_CONFIGURATION_IDS[4],
  );
  assert.equal(admitS3ProductExecution(knownFalse, falseRun).searchResult.termination, 'no-eligible-route-in-bounded-scope');
  assert.equal(knownFalse.searchResult.candidateSet.constraintOutcome, 'no-eligible-route-in-bounded-scope-proven');
});

test('not-started and started-no-terminal remain explicit truthful states', () => {
  const run = runManifest();
  const notStarted = joinedRecord(run, 'main', 'od-0000', S3_CONFIGURATION_IDS[0], {
    attemptState: 'not-started',
  });
  const started = joinedRecord(run, 'main', 'od-0001', S3_CONFIGURATION_IDS[0], {
    attemptState: 'started-no-terminal',
  });
  const admitted = admitS3Report(report(collection(run, [notStarted, started], [])));
  assert.equal(admitted.mainCohortDenominators.terminalStatuses['not-started'], 4_999);
  assert.equal(admitted.mainCohortDenominators.terminalStatuses['started-no-terminal'], 1);
  assert.equal(admitted.mainCohortDenominators.terminal, 0);
});

test('exact versions, counts, generated OD/profile drift, and forbidden claims fail closed', () => {
  const wrongCount = cohort();
  wrongCount.counts.scenarioConfigEvaluations = 4_999;
  assert.throws(() => admitS3ScenarioCohort(wrongCount), /must be 5000/);
  const duplicate = cohort();
  duplicate.odPairs[1].destinationNodeId = duplicate.odPairs[0].destinationNodeId;
  assert.throws(() => admitS3ScenarioCohort(duplicate), /deterministic generator/);
  const profile = cohort();
  profile.odPairs[0].profileId = 's3-profile-b';
  assert.throws(() => admitS3ScenarioCohort(profile), /deterministic generator/);
  assert.throws(() => admitS3ScenarioProtocol(protocol({ evaluationUnit: 'users' })), /must not describe users/);
  for (const prohibitedClaim of [
    'historical-wrt-validation',
    'persona-validation',
    'scientific-validation',
    'safer-route-validation',
    'risk-prediction',
    'safety-validation',
    'performance-validation',
  ]) {
    assert.throws(
      () => admitS3ScenarioProtocol(protocol({ eligibleClaimCodes: [prohibitedClaim] })),
      /prohibited/,
      prohibitedClaim,
    );
  }
});

test('descriptor-safe recursive hostile Proxy admission performs zero direct gets', () => {
  const run = runManifest();
  const main = joinedRecord(run, 'main', 'od-0000', S3_CONFIGURATION_IDS[0]);
  const raw = report(collection(run, [main], []));
  let gets = 0;
  const hostile = hostileTree(raw, () => { gets += 1; });
  assert.deepEqual(admitS3Report(hostile), admitS3Report(raw));
  assert.equal(gets, 0);
  let reads = 0;
  Object.defineProperty(raw.recordCollection.mainRecords[0].primaryExecution, 'profileId', {
    enumerable: true, get() { reads += 1; return 's3-profile-a'; },
  });
  assert.throws(() => admitS3Report(raw), /data properties only/);
  assert.equal(reads, 0);
});

test('snapshot admission fails closed with a controlled error before extreme recursion overflows', () => {
  const input = runManifest();
  let cursor = {};
  input.configurationExecutions[0].decisionPolicy.excessiveDepth = cursor;
  for (let depth = 0; depth < 15_000; depth += 1) {
    const next = {};
    cursor.child = next;
    cursor = next;
  }
  assert.throws(
    () => admitS3RunManifest(input),
    (error) => error instanceof TypeError
      && error.name !== 'RangeError'
      && /route decision S3 protocol contract:.*bounded snapshot depth/.test(error.message),
  );

  const nodeBudgetInput = runManifest();
  nodeBudgetInput.configurationExecutions[0].decisionPolicy.excessiveWidth =
    Array.from({ length: 100_001 }, () => null);
  assert.throws(
    () => admitS3RunManifest(nodeBudgetInput),
    (error) => error instanceof TypeError
      && error.name !== 'RangeError'
      && /route decision S3 protocol contract:.*bounded snapshot node budget/.test(error.message),
  );
});

test('prototype-pollution keys are rejected and admitted values are detached/deep-frozen', () => {
  const polluted = cohort();
  polluted.profiles[0] = JSON.parse(`${JSON.stringify(polluted.profiles[0]).slice(0, -1)},"__proto__":{"polluted":true}}`);
  assert.throws(() => admitS3ScenarioCohort(polluted), /unknown: __proto__/);
  assert.equal({}.polluted, undefined);
  const input = runManifest();
  const admitted = admitS3RunManifest(input);
  input.configurationExecutions[0].decisionPolicy.softPreferences[0].rangeMax = 1;
  assert.notEqual(admitted.configurationExecutions[0].decisionPolicy.softPreferences[0].rangeMax, 1);
  assert.equal(Object.isFrozen(admitted.configurationExecutions[0].searchRequestTemplate.bounds), true);
});
