import { ROUTE_DECISION_SCHEMA_VERSIONS } from '../../../../src/route_decision/contracts/index.js';
import {
  ROUTE_SEARCH_DECISION_EVALUATION_VERSION,
} from '../../../../src/route_decision/evaluator/search_v2.js';
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
  buildS3GraphContentIdentity,
  buildS3ScenarioOdPairs,
} from '../../../../src/route_decision/contracts/scenario_cohort_v1.js';

const CAPABILITY_FACTORS = ['step-free', 'curb-ramp-present', 'paved-surface'];
const REASON_BY_STATE = {
  unknown: 'not-observed',
  unavailable: 'source-unavailable',
  partial: 'coverage-partial',
  stale: 'observation-stale',
  invalid: 'source-invalid',
};
const TERMINATIONS = [
  'invalid-input',
  'no-directed-route-in-bounded-scope',
  'unresolved-constraint-evidence',
  'no-eligible-route-in-bounded-scope',
];
const REASON_BY_TERMINATION = {
  'invalid-input': 'candidate-search-invalid-input',
  'no-directed-route-in-bounded-scope': 'candidate-search-no-directed-route-in-bounded-scope',
  'unresolved-constraint-evidence': 'candidate-search-unresolved-constraint-evidence',
  'no-eligible-route-in-bounded-scope': 'candidate-search-no-eligible-route-in-bounded-scope',
};

function sourceObservation(factorId, state = 'observed', value = true) {
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.sourceObservation,
    factorId,
    state,
    value: state === 'observed' ? value : null,
    unit: 'boolean',
    reasonCode: state === 'observed' ? null : REASON_BY_STATE[state],
    sourceId: 'synthetic-s3-scale-edge-evidence',
  };
}

function edgeFactorEvidence(graph, stateByEdgeFactor = {}) {
  return {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.edgeFactorEvidence,
    evidenceId: `${graph.graphId}-edge-evidence`,
    fixtureVersion: `${graph.receipt.artifactVersion}-edge-evidence-v1`,
    graphId: graph.graphId,
    graphArtifactVersion: graph.receipt.artifactVersion,
    graphContentIdentity: structuredClone(buildS3GraphContentIdentity(graph)),
    factorIds: [...CAPABILITY_FACTORS],
    edgeEvidence: graph.edges.map(({ edgeId }) => ({
      edgeId,
      observations: Object.fromEntries(CAPABILITY_FACTORS.map((factorId) => [
        factorId,
        structuredClone(stateByEdgeFactor[`${edgeId}:${factorId}`] ?? sourceObservation(factorId)),
      ])),
    })),
  };
}

function mainGraph() {
  const nodes = Array.from({ length: 1_002 }, (_, index) => ({ nodeId: `n${index}` }));
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.graphArtifact,
    graphId: 'synthetic-s3-scale-graph',
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
    components: {
      kind: 'weakly-connected',
      count: 1,
      byNodeId: Object.fromEntries(nodes.map(({ nodeId }) => [nodeId, 0])),
    },
    provenance: { dataClassification: 'synthetic', sourceIds: ['synthetic-s3-scale-fixture'] },
    receipt: { artifactVersion: 'synthetic-s3-scale-graph-v1' },
  };
}

function probeGraph(probeKind) {
  const disconnected = probeKind === 'disconnected';
  const graphId = `synthetic-s3-scale-probe-${probeKind}`;
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.graphArtifact,
    graphId,
    mode: 'walk',
    directed: true,
    nodes: [{ nodeId: 'p0' }, { nodeId: 'p1' }],
    edges: disconnected ? [] : [{
      edgeId: 'pe1', fromNodeId: 'p0', toNodeId: 'p1', distanceMm: 1_000, objectiveCostUnits: 10,
    }],
    components: disconnected
      ? { kind: 'weakly-connected', count: 2, byNodeId: { p0: 0, p1: 1 } }
      : { kind: 'weakly-connected', count: 1, byNodeId: { p0: 0, p1: 0 } },
    provenance: { dataClassification: 'synthetic', sourceIds: [`synthetic-s3-scale-${probeKind}`] },
    receipt: { artifactVersion: `${probeKind}-graph-v1` },
  };
}

function zeroOutcome(termination) {
  const searched = termination !== 'invalid-input';
  const constraintOutcome = termination === 'unresolved-constraint-evidence'
    ? 'unresolved-evidence'
    : termination === 'no-eligible-route-in-bounded-scope'
      ? 'no-eligible-route-in-bounded-scope-proven'
      : searched ? 'not-required' : null;
  return {
    termination,
    searchMetadata: {
      status: searched ? 'completed' : 'rejected',
      requestedCandidateCount: searched ? 5 : null,
      candidateCount: 0,
      expandedStateCount: searched
        ? termination === 'no-eligible-route-in-bounded-scope' ? 2 : 1
        : null,
      routeSearchCompleteness: searched ? 'complete-within-bounds' : null,
      constraintOutcome,
      budgetOutcome: searched ? 'within-budget' : null,
      capacityOutcome: searched ? 'within-capacity' : null,
      unresolvedEvidenceEncountered: searched
        ? termination === 'unresolved-constraint-evidence'
        : null,
    },
    orderedCandidates: [],
    providedSetDecision: {
      evaluationSchemaVersion: ROUTE_SEARCH_DECISION_EVALUATION_VERSION,
      evaluationStatus: 'not-evaluated',
      reasonCode: REASON_BY_TERMINATION[termination],
      decisionSchemaVersion: null,
      scope: null,
      decisionStatus: null,
      admittedCandidateIds: [],
      rankedCandidateIds: [],
      rejectedCandidateIds: [],
      unresolvedCandidateIds: [],
      publicExplanation: {
        hardConstraintTrace: [],
        softPreferenceTrace: [],
        candidateDispositions: [],
        rankingTrace: [],
      },
    },
  };
}

function conformanceProbes() {
  return S3_CONFORMANCE_PROBE_KINDS.map((probeKind, index) => {
    const graph = probeGraph(probeKind);
    const overrides = {};
    if (probeKind === 'source-unavailable') {
      overrides['pe1:step-free'] = sourceObservation('step-free', 'unavailable');
    }
    if (probeKind === 'constraint-no-solution') {
      overrides['pe1:step-free'] = sourceObservation('step-free', 'observed', false);
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
        edgeFactorEvidence: edgeFactorEvidence(graph, overrides),
        originNodeId: 'p0',
        destinationNodeId: 'p1',
        requestMutation: probeKind === 'invalid-input'
          ? { mutationKind: 'replace-field', field: 'requestedCandidateCount', invalidValue: 0 }
          : null,
      },
      expectedOutcome: zeroOutcome(TERMINATIONS[index]),
      includedInMainCohort: false,
    };
  });
}

export function createRouteS3FocusedRunManifest() {
  const graphArtifact = mainGraph();
  const graphContentIdentity = structuredClone(buildS3GraphContentIdentity(graphArtifact));
  const cohort = {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.cohort,
    cohortId: 's3-scale-focused-cohort-v1',
    cohortKind: 'researcher-defined-synthetic-s3',
    scenarioGeneratorVersion: S3_SCENARIO_GENERATOR_VERSION,
    graphScope: { scopeKind: 'admitted-synthetic-graph', graphArtifact, graphContentIdentity },
    edgeFactorEvidence: edgeFactorEvidence(graphArtifact),
    seed: S3_SCENARIO_SEED,
    counts: { ...S3_SCENARIO_COUNTS },
    configurationGroups: structuredClone(S3_CONFIGURATION_GROUPS),
    profiles: structuredClone(S3_SYNTHETIC_PROFILES),
    odPairs: structuredClone(buildS3ScenarioOdPairs(
      graphArtifact,
      S3_SCENARIO_GENERATOR_VERSION,
      S3_SCENARIO_SEED,
    )),
    conformanceProbes: conformanceProbes(),
  };
  const protocol = {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.protocol,
    protocolId: 's3-scale-focused-protocol-v1',
    definitionScope: 'preregistered-synthetic-engineering',
    historicalWrtRecovery: 'not-claimed',
    evaluationUnit: 'scenario-config-evaluation',
    cohort,
    eligibleClaimCodes: [
      'synthetic-engineering-protocol',
      'synthetic-contract-conformance',
      'synthetic-determinism-evidence',
      'bounded-offline-validation',
    ],
  };
  return {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.runManifest,
    runId: 's3-scale-focused-run-v1',
    protocol,
    protocolId: protocol.protocolId,
    graphScope: structuredClone(cohort.graphScope),
    seed: cohort.seed,
    configurationExecutions: cohort.configurationGroups.map((group) => ({
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
      fixtureVersion: 's3-micrograph-fixtures/v1',
      canonicalSerializationVersion: 'canonical-json/v1',
    },
    referenceEnvironment: {
      runtime: `Node ${process.version}`,
      os: process.platform,
      architecture: process.arch,
      cpuClass: 'not-captured-for-focused-correctness-run',
      memoryBytes: 1,
    },
    oracleExecutionSpec: structuredClone(S3_ORACLE_EXECUTION_SPEC),
    performanceProtocol: structuredClone(S3_PERFORMANCE_PROTOCOL),
    expectedCounts: { ...S3_SCENARIO_COUNTS, conformanceProbeEvaluations: 4 },
  };
}
