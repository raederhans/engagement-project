import {
  admitEvidenceIdentity,
  admitRecordGraphIdentity,
  admitS3RunManifest,
  evidenceIdentityOf,
  graphIdentityOf,
  graphIdentityOfArtifact,
} from './scenario_cohort/cohort_v1.js';
import {
  admitCanonicalOutcome,
  canonicalSearchMetadata,
  emptyPublicExplanation,
} from './scenario_cohort/canonical_outcome_v1.js';
import {
  CAPABILITY_FACTORS,
  MAX_ID_LENGTH,
  OBSERVATION_KEYS,
  S3_PERFORMANCE_PROTOCOL,
  S3_SCENARIO_COUNTS,
  S3_SCENARIO_SCHEMA_VERSIONS,
  S3_SYNTHETIC_DISTANCE_BUCKETS as SYNTHETIC_DISTANCE_BUCKETS,
  TERMINATION_KEYS,
  admitDecisionEvaluation,
  admitPolicy,
  admitSearchRequest,
  admitSearchResult,
  assertPolicySearchEquality,
  claimCodes,
  deepFreeze,
  enumValue,
  exactObject,
  exactVersion,
  fail,
  id,
  integer,
  same,
  snapshotData,
  strictArray,
} from './scenario_cohort/model_v1.js';

const ATTEMPT_STATES = new Set(['not-started', 'started-no-terminal', 'terminal']);
const CONFORMANCE_OUTCOMES = new Set(['not-applicable', 'pass', 'fail', 'not-run']);
const EXECUTION_ROLES = new Set(['primary', 'replay']);
// Validation-only acceleration seam. WeakMap identity is the unforgeable
// process-local brand; this is not an authenticity or authorization token.
const S3_VALIDATION_ADMISSION_SESSIONS = new WeakMap();
export {
  S3_CONFIGURATION_GROUPS,
  S3_CONFIGURATION_IDS,
  S3_CONFORMANCE_PROBE_KINDS,
  S3_DECISION_POLICIES,
  S3_ORACLE_ALGORITHM_VERSION,
  S3_ORACLE_EXECUTION_SPEC,
  S3_PERFORMANCE_PROTOCOL,
  S3_SCENARIO_COUNTS,
  S3_SCENARIO_GENERATOR_VERSION,
  S3_SCENARIO_SCHEMA_VERSIONS,
  S3_SCENARIO_SEED,
  S3_SYNTHETIC_PROFILES,
  S3_SYNTHETIC_PROFILE_IDS,
  admitS3ConfigurationGroup,
  admitS3RunManifest,
  admitS3ScenarioCohort,
  admitS3ScenarioProtocol,
  admitS3SyntheticProfile,
  areS3DataTreesEquivalent,
  buildS3GraphContentIdentity,
  buildS3ScenarioOdPairs,
} from './scenario_cohort/cohort_v1.js';

export function createS3ValidationAdmissionSession(rawRunManifest) {
  const admittedRunManifest = admitS3RunManifest(rawRunManifest);
  const session = Object.freeze({ admittedRunManifest });
  S3_VALIDATION_ADMISSION_SESSIONS.set(session, Object.freeze({
    admittedRunManifest,
  }));
  return session;
}

function validationAdmissionSessionState(session) {
  let state;
  try {
    state = S3_VALIDATION_ADMISSION_SESSIONS.get(session);
  } catch {
    fail('S3 validation admission session is invalid');
  }
  if (!state) fail('S3 validation admission session is invalid');
  return state;
}

function scenarioFor(run, denominatorKind, scenarioId, configurationId) {
  if (denominatorKind === 'main') {
    const pair = run.protocol.cohort.odPairs.find(({ odPairId }) => odPairId === scenarioId);
    if (!pair || !pair.configurationIds.includes(configurationId)) fail('S3 record references an unknown main scenario/configuration');
    return {
      originNodeId: pair.originNodeId,
      destinationNodeId: pair.destinationNodeId,
      profileId: pair.profileId,
      odPairId: pair.odPairId,
      graphArtifact: run.protocol.cohort.graphScope.graphArtifact,
      edgeFactorEvidence: run.protocol.cohort.edgeFactorEvidence,
    };
  }
  if (denominatorKind === 'conformance') {
    const probe = run.protocol.cohort.conformanceProbes.find(({ probeId }) => probeId === scenarioId);
    if (!probe || probe.configurationId !== configurationId) fail('S3 record references an unknown conformance scenario/configuration');
    return {
      originNodeId: probe.stimulus.originNodeId,
      destinationNodeId: probe.stimulus.destinationNodeId,
      profileId: probe.profileId,
      odPairId: null,
      graphArtifact: probe.stimulus.graphArtifact,
      edgeFactorEvidence: probe.stimulus.edgeFactorEvidence,
      probe,
    };
  }
  fail('S3 record denominatorKind is unsupported');
}

function recordKey(runId, denominatorKind, scenarioId, configurationId, profileId) {
  return `${runId}:${denominatorKind}:${scenarioId}:${configurationId}:${profileId}`;
}

function projectSearchRequest(run, scenario, configurationId, scenarioId) {
  const execution = run.configurationExecutions.find((item) => item.configurationId === configurationId);
  if (!execution) fail('S3 record configuration execution is missing');
  const template = execution.searchRequestTemplate;
  return admitSearchRequest({
    ...template,
    requestId: `${run.runId}-${scenarioId}-${configurationId}`.slice(0, MAX_ID_LENGTH),
    graphId: scenario.graphArtifact.graphId,
    originNodeId: scenario.originNodeId,
    destinationNodeId: scenario.destinationNodeId,
  }, 'S3 projected CandidateSearchRequest');
}

function assertResultEvidenceBinding(result, request, scenario) {
  if (!result) return;
  const graphEdgeById = new Map(scenario.graphArtifact.edges.map((edge) => [edge.edgeId, edge]));
  const evidenceByEdge = new Map(
    scenario.edgeFactorEvidence.edgeEvidence.map((entry) => [entry.edgeId, entry.observations]),
  );
  for (const candidate of result.candidateFacts) {
    let cursor = request.originNodeId;
    let distanceMm = 0;
    let objectiveCostUnits = 0;
    const routeEvidence = Object.fromEntries(CAPABILITY_FACTORS.map((factorId) => [factorId, []]));
    for (const edgeId of candidate.edgeIds) {
      const edge = graphEdgeById.get(edgeId);
      const observations = evidenceByEdge.get(edgeId);
      if (!edge || !observations) fail('S3ProductExecution candidate references an edge outside its frozen graph/evidence fixture');
      if (edge.fromNodeId !== cursor) fail('S3ProductExecution candidate edge sequence is not contiguous from its frozen origin');
      cursor = edge.toNodeId;
      distanceMm += edge.distanceMm;
      objectiveCostUnits += edge.objectiveCostUnits;
      for (const factorId of CAPABILITY_FACTORS) routeEvidence[factorId].push(observations[factorId]);
      for (const { factorId } of request.hardConstraints) {
        const edgeObservation = observations[factorId];
        if (edgeObservation.state !== 'observed' || edgeObservation.value !== true) {
          fail(`S3ProductExecution returned candidate contradicts edge evidence for ${factorId}`);
        }
      }
    }
    if (cursor !== request.destinationNodeId
      || candidate.distanceMm !== distanceMm
      || candidate.objectiveCostUnits !== objectiveCostUnits) {
      fail('S3ProductExecution candidate path metrics/endpoints drifted from its frozen graph');
    }
    for (const factorId of CAPABILITY_FACTORS) {
      const candidateObservation = candidate.observations[factorId];
      if (!candidateObservation) continue;
      const edgeObservations = routeEvidence[factorId];
      const expected = edgeObservations.find(({ state, value: observationValue }) => (
        state === 'observed' && observationValue === false
      )) ?? edgeObservations.find(({ state }) => state !== 'observed') ?? edgeObservations[0];
      if (!expected || candidateObservation.state !== expected.state
        || candidateObservation.value !== expected.value
        || candidateObservation.unit !== expected.unit
        || candidateObservation.reasonCode !== expected.reasonCode) {
        fail(`S3ProductExecution candidate observation drifted from edge evidence for ${factorId}`);
      }
    }
  }
}

function deriveObservationSummary(result) {
  const summary = {
    denominatorUnit: 'candidate-factor-observation',
    denominator: result ? result.candidateFacts.length * CAPABILITY_FACTORS.length : 0,
    ...zeroMap(OBSERVATION_KEYS),
  };
  if (!result) return summary;
  for (const candidate of result.candidateFacts) {
    for (const factorId of CAPABILITY_FACTORS) {
      const observation = candidate.observations[factorId];
      if (!observation) {
        summary.missing += 1;
      } else if (observation.state === 'observed') {
        if (typeof observation.value === 'boolean') {
          summary[observation.value ? 'observedBooleanTrue' : 'observedBooleanFalse'] += 1;
        } else {
          summary.observedNumericNonzero += 1;
        }
      } else if (observation.state === 'zero') {
        summary.numericZero += 1;
      } else {
        summary[observation.state] += 1;
      }
    }
  }
  return summary;
}

function admitMeasurement(raw, label, attemptState, result) {
  const value = exactObject(raw, label, [
    'measurementStatus', 'cacheState', 'latencyMicros', 'memoryBytes', 'unmeasuredReason',
  ]);
  if (value.measurementStatus === 'not-measured') {
    if (value.cacheState !== 'not-applicable' || value.latencyMicros !== null
      || value.memoryBytes !== null) fail(`${label} not-measured must not carry samples`);
    const unmeasuredReason = id(value.unmeasuredReason, `${label}.unmeasuredReason`);
    if (!S3_PERFORMANCE_PROTOCOL.notMeasuredReasons.includes(unmeasuredReason)) {
      fail(`${label}.unmeasuredReason is outside the frozen performance protocol`);
    }
    const reasonAllowed = unmeasuredReason === 'measurement-not-enabled'
      || (unmeasuredReason === 'measurement-failure' && attemptState !== 'not-started')
      || (unmeasuredReason === 'execution-not-started'
        && (attemptState === 'not-started' || result?.status === 'not-started'))
      || (unmeasuredReason === 'execution-nonterminal' && attemptState === 'started-no-terminal');
    if (!reasonAllowed) fail(`${label}.unmeasuredReason contradicts the execution state`);
    return {
      measurementStatus: 'not-measured',
      cacheState: 'not-applicable',
      latencyMicros: null,
      memoryBytes: null,
      unmeasuredReason,
    };
  }
  if (value.measurementStatus !== 'measured'
    || !new Set(['warm', 'cold']).has(value.cacheState)
    || value.unmeasuredReason !== null) fail(`${label} measurement shape is unsupported`);
  if (attemptState !== 'terminal') fail(`${label} measured samples require a terminal execution record`);
  return {
    measurementStatus: 'measured',
    cacheState: value.cacheState,
    latencyMicros: integer(value.latencyMicros, `${label}.latencyMicros`),
    memoryBytes: integer(value.memoryBytes, `${label}.memoryBytes`),
    unmeasuredReason: null,
  };
}

function admitProductExecutionWithRun(raw, run) {
  const value = exactObject(raw, 'S3ProductExecution', [
    'schemaVersion', 'recordKey', 'denominatorKind', 'scenarioId', 'runId', 'protocolId',
    'graphIdentity', 'evidenceIdentity', 'odPairId', 'configurationId', 'profileId', 'decisionPolicy',
    'searchRequest', 'executionRole', 'executionAttemptId', 'attemptState', 'searchResult',
    'decisionEvaluation', 'measurement',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.productExecution, 'S3ProductExecution.schemaVersion');
  const configurationId = id(value.configurationId, 'S3ProductExecution.configurationId');
  const scenario = scenarioFor(run, value.denominatorKind, value.scenarioId, configurationId);
  const expectedKey = recordKey(run.runId, value.denominatorKind, value.scenarioId, configurationId, scenario.profileId);
  if (value.recordKey !== expectedKey || value.runId !== run.runId || value.protocolId !== run.protocolId
    || value.profileId !== scenario.profileId || value.odPairId !== scenario.odPairId) fail('S3ProductExecution composite identity drifted');
  const graphIdentity = admitRecordGraphIdentity(value.graphIdentity, 'S3ProductExecution.graphIdentity');
  if (!same(graphIdentity, graphIdentityOfArtifact(scenario.graphArtifact))) fail('S3ProductExecution graph identity drifted');
  const evidenceIdentity = admitEvidenceIdentity(value.evidenceIdentity, 'S3ProductExecution.evidenceIdentity');
  if (!same(evidenceIdentity, evidenceIdentityOf(scenario.edgeFactorEvidence))) {
    fail('S3ProductExecution edge-factor evidence identity drifted');
  }
  const execution = run.configurationExecutions.find((item) => item.configurationId === configurationId);
  const policy = admitPolicy(value.decisionPolicy, 'S3ProductExecution.decisionPolicy');
  if (!same(policy, execution.decisionPolicy)) fail('S3ProductExecution DecisionPolicy drifted');
  const request = admitSearchRequest(value.searchRequest, 'S3ProductExecution.searchRequest');
  const projected = projectSearchRequest(run, scenario, configurationId, value.scenarioId);
  if (!same(request, projected)) fail('S3ProductExecution search request drifted from its OD/config template projection');
  assertPolicySearchEquality(policy, request, 'S3ProductExecution');
  const executionRole = enumValue(value.executionRole, EXECUTION_ROLES, 'S3ProductExecution.executionRole');
  const executionAttemptId = id(value.executionAttemptId, 'S3ProductExecution.executionAttemptId');
  const attemptState = enumValue(value.attemptState, ATTEMPT_STATES, 'S3ProductExecution.attemptState');
  const result = value.searchResult === null ? null : admitSearchResult(value.searchResult, 'S3ProductExecution.searchResult');
  const evaluation = value.decisionEvaluation === null
    ? null
    : admitDecisionEvaluation(value.decisionEvaluation, 'S3ProductExecution.decisionEvaluation');
  if (attemptState === 'terminal') {
    if (!result) fail('S3ProductExecution terminal record requires a search result');
    if (result.termination === 'endpoint-unavailable') {
      fail('S3ProductExecution endpoint-unavailable is not applicable in S3 v1 admitted graph scenarios');
    }
    if (result.request && !same(result.request, request)) fail('S3ProductExecution result request drifted');
    if (!result.request && !(value.denominatorKind === 'conformance' && scenario.probe.probeKind === 'invalid-input')) {
      fail('S3ProductExecution null result request is only valid for invalid-input probe');
    }
    if (!evaluation || !same(evaluation.policy, policy) || !same(evaluation.candidateArtifact, result)) {
      fail('S3ProductExecution terminal record requires its exact admitted provided-set decision evaluation');
    }
    assertResultEvidenceBinding(result, request, scenario);
    if (value.denominatorKind === 'conformance'
      && !same(canonicalOutcome({ attemptState, searchResult: result, decisionEvaluation: evaluation }), scenario.probe.expectedOutcome)) {
      fail('S3ProductExecution conformance result drifted from the frozen executable stimulus outcome');
    }
  } else if (result !== null || evaluation !== null) {
    fail('S3ProductExecution non-terminal record must not contain executable results');
  }
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.productExecution,
    recordKey: expectedKey,
    denominatorKind: value.denominatorKind,
    scenarioId: value.scenarioId,
    runId: run.runId,
    protocolId: run.protocolId,
    graphIdentity,
    evidenceIdentity,
    odPairId: scenario.odPairId,
    configurationId,
    profileId: scenario.profileId,
    decisionPolicy: policy,
    searchRequest: request,
    executionRole,
    executionAttemptId,
    attemptState,
    searchResult: result,
    decisionEvaluation: evaluation,
    observationSummary: deriveObservationSummary(result),
    measurement: admitMeasurement(
      value.measurement,
      'S3ProductExecution.measurement',
      attemptState,
      result,
    ),
  });
}

export function admitS3ProductExecution(raw, runManifest) {
  return admitProductExecutionWithRun(raw, admitS3RunManifest(runManifest));
}
function dispositionIds(items) {
  const ids = [];
  for (const item of items) {
    if (!ids.includes(item.candidateId)) ids.push(item.candidateId);
  }
  return ids;
}

function canonicalOutcome(product) {
  if (product.attemptState !== 'terminal') return null;
  const evaluation = product.decisionEvaluation.evaluation;
  const decision = evaluation.decision;
  return {
    termination: product.searchResult.termination,
    searchMetadata: canonicalSearchMetadata(product.searchResult),
    orderedCandidates: product.searchResult.candidateFacts.map(({ candidateId, edgeIds }) => ({
      candidateId,
      edgeIds: [...edgeIds],
    })),
    providedSetDecision: {
      evaluationSchemaVersion: product.decisionEvaluation.schemaVersion,
      evaluationStatus: evaluation.status,
      reasonCode: evaluation.reasonCode,
      decisionSchemaVersion: decision?.schemaVersion ?? null,
      scope: decision?.scope ?? null,
      decisionStatus: decision?.status ?? null,
      admittedCandidateIds: decision ? [...decision.admittedCandidateIds] : [],
      rankedCandidateIds: decision ? [...decision.rankedCandidateIds] : [],
      rejectedCandidateIds: decision ? dispositionIds(decision.rejected) : [],
      unresolvedCandidateIds: decision ? dispositionIds(decision.unresolved) : [],
      publicExplanation: decision ? {
        hardConstraintTrace: decision.trace
          .filter(({ stage }) => stage === 'hard-constraint')
          .map((item) => snapshotData(item, 'canonical hard-constraint trace')),
        softPreferenceTrace: decision.trace
          .filter(({ stage }) => stage === 'soft-preference')
          .map((item) => snapshotData(item, 'canonical soft-preference trace')),
        candidateDispositions: decision.trace
          .filter(({ stage }) => stage === 'candidate-disposition')
          .map((item) => snapshotData(item, 'canonical candidate-disposition trace')),
        rankingTrace: decision.trace
          .filter(({ stage }) => stage === 'ranking')
          .map((item) => snapshotData(item, 'canonical ranking trace')),
      } : emptyPublicExplanation(),
    },
  };
}

function admitIndependentOracleResultWithRun(raw, run) {
  const value = exactObject(raw, 'S3IndependentOracleResult', [
    'schemaVersion', 'recordKey', 'denominatorKind', 'scenarioId', 'runId', 'protocolId',
    'graphIdentity', 'evidenceIdentity', 'odPairId', 'configurationId', 'profileId', 'decisionPolicy',
    'searchRequest', 'oracleStatus', 'expectedOutcome',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.independentOracle, 'S3IndependentOracleResult.schemaVersion');
  const configurationId = id(value.configurationId, 'S3IndependentOracleResult.configurationId');
  const scenario = scenarioFor(run, value.denominatorKind, value.scenarioId, configurationId);
  const expectedKey = recordKey(run.runId, value.denominatorKind, value.scenarioId, configurationId, scenario.profileId);
  const graphIdentity = admitRecordGraphIdentity(value.graphIdentity, 'S3IndependentOracleResult.graphIdentity');
  const evidenceIdentity = admitEvidenceIdentity(value.evidenceIdentity, 'S3IndependentOracleResult.evidenceIdentity');
  if (value.recordKey !== expectedKey || value.runId !== run.runId || value.protocolId !== run.protocolId
    || value.profileId !== scenario.profileId || value.odPairId !== scenario.odPairId
    || !same(graphIdentity, graphIdentityOfArtifact(scenario.graphArtifact))
    || !same(evidenceIdentity, evidenceIdentityOf(scenario.edgeFactorEvidence))) {
    fail('S3IndependentOracleResult composite identity drifted');
  }
  const execution = run.configurationExecutions.find((item) => item.configurationId === configurationId);
  const policy = admitPolicy(value.decisionPolicy, 'S3IndependentOracleResult.decisionPolicy');
  const request = admitSearchRequest(value.searchRequest, 'S3IndependentOracleResult.searchRequest');
  if (!same(policy, execution.decisionPolicy)
    || !same(request, projectSearchRequest(run, scenario, configurationId, value.scenarioId))) fail('S3IndependentOracleResult policy/search binding drifted');
  if (!new Set(['computed', 'not-run']).has(value.oracleStatus)) fail('S3IndependentOracleResult.oracleStatus is unsupported');
  const expectedOutcome = value.expectedOutcome === null
    ? null
    : admitCanonicalOutcome(
      value.expectedOutcome,
      'S3IndependentOracleResult.expectedOutcome',
      {
        graphArtifact: scenario.graphArtifact,
        edgeFactorEvidence: scenario.edgeFactorEvidence,
        policy,
        searchRequest: request,
        originNodeId: scenario.originNodeId,
        destinationNodeId: scenario.destinationNodeId,
        denominatorKind: value.denominatorKind,
        probeKind: value.denominatorKind === 'conformance'
          ? scenario.probe.probeKind
          : null,
      },
    );
  if ((value.oracleStatus === 'computed') !== (expectedOutcome !== null)) {
    fail('S3IndependentOracleResult computed status must exactly bind a clean-room expected outcome');
  }
  if (value.denominatorKind === 'conformance' && expectedOutcome !== null
    && !same(expectedOutcome, scenario.probe.expectedOutcome)) {
    fail('S3IndependentOracleResult conformance oracle drifted from the preregistered canonical outcome');
  }
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.independentOracle,
    recordKey: expectedKey,
    denominatorKind: value.denominatorKind,
    scenarioId: value.scenarioId,
    runId: run.runId,
    protocolId: run.protocolId,
    graphIdentity,
    evidenceIdentity,
    odPairId: scenario.odPairId,
    configurationId,
    profileId: scenario.profileId,
    decisionPolicy: policy,
    searchRequest: request,
    oracleStatus: value.oracleStatus,
    expectedOutcome,
  });
}

export function admitS3IndependentOracleResult(raw, runManifest) {
  return admitIndependentOracleResultWithRun(raw, admitS3RunManifest(runManifest));
}

function admitJoinedRunRecordWithRun(raw, run) {
  const value = exactObject(raw, 'S3JoinedRunRecord', [
    'schemaVersion', 'recordKey', 'denominatorKind',
    'primaryExecution', 'replayExecution', 'oracleResult',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.joinedRunRecord, 'S3JoinedRunRecord.schemaVersion');
  const primary = admitProductExecutionWithRun(value.primaryExecution, run);
  const replay = admitProductExecutionWithRun(value.replayExecution, run);
  const oracle = admitIndependentOracleResultWithRun(value.oracleResult, run);
  if (primary.executionRole !== 'primary' || replay.executionRole !== 'replay'
    || primary.executionAttemptId === replay.executionAttemptId) {
    fail('S3JoinedRunRecord requires distinct primary and replay execution attempts');
  }
  if (value.recordKey !== primary.recordKey || replay.recordKey !== primary.recordKey
    || oracle.recordKey !== primary.recordKey || value.denominatorKind !== primary.denominatorKind
    || replay.denominatorKind !== primary.denominatorKind || oracle.denominatorKind !== primary.denominatorKind
    || !same(primary.decisionPolicy, replay.decisionPolicy)
    || !same(primary.decisionPolicy, oracle.decisionPolicy)
    || !same(primary.searchRequest, replay.searchRequest)
    || !same(primary.searchRequest, oracle.searchRequest)
    || !same(primary.evidenceIdentity, replay.evidenceIdentity)
    || !same(primary.evidenceIdentity, oracle.evidenceIdentity)) {
    fail('S3JoinedRunRecord primary/replay/oracle composite binding drifted');
  }
  if (primary.measurement.measurementStatus === 'measured'
    && primary.measurement.cacheState !== S3_PERFORMANCE_PROTOCOL.primaryCacheState) {
    fail('S3JoinedRunRecord measured primary must use the frozen cold sampling position');
  }
  if (replay.measurement.measurementStatus === 'measured'
    && replay.measurement.cacheState !== S3_PERFORMANCE_PROTOCOL.replayCacheState) {
    fail('S3JoinedRunRecord measured replay must use the frozen warm sampling position');
  }
  const requiredOracleStatus = primary.attemptState === 'terminal' ? 'computed' : 'not-run';
  if (oracle.oracleStatus !== requiredOracleStatus) {
    fail('S3JoinedRunRecord oracle computed/not-run policy drifted from the frozen oracle spec');
  }
  const primaryOutcome = canonicalOutcome(primary);
  const replayOutcome = canonicalOutcome(replay);
  const replayComparison = replay.attemptState === 'not-started'
    ? 'not-run'
    : !primaryOutcome || !replayOutcome
      ? 'not-comparable'
      : same(primaryOutcome, replayOutcome) ? 'match' : 'mismatch';
  const oracleComparison = oracle.oracleStatus === 'not-run'
    ? 'not-run'
    : !primaryOutcome ? 'not-comparable'
      : same(primaryOutcome, oracle.expectedOutcome) ? 'match' : 'mismatch';
  let conformanceOutcome = 'not-applicable';
  if (primary.denominatorKind === 'conformance') {
    const probe = run.protocol.cohort.conformanceProbes.find(({ probeId }) => probeId === primary.scenarioId);
    conformanceOutcome = primary.attemptState === 'not-started' ? 'not-run'
      : same(primaryOutcome, probe.expectedOutcome)
        && replayComparison === 'match' && oracleComparison === 'match' ? 'pass' : 'fail';
  }
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.joinedRunRecord,
    recordKey: primary.recordKey,
    denominatorKind: primary.denominatorKind,
    primaryExecution: primary,
    replayExecution: replay,
    oracleResult: oracle,
    replayComparison,
    oracleComparison,
    conformanceOutcome,
  });
}

export function admitS3JoinedRunRecord(raw, runManifest) {
  return admitJoinedRunRecordWithRun(raw, admitS3RunManifest(runManifest));
}

export function admitS3JoinedRunRecordWithValidationSession(raw, session) {
  return admitJoinedRunRecordWithRun(
    raw,
    validationAdmissionSessionState(session).admittedRunManifest,
  );
}

function expectedMainKeys(run) {
  const keys = new Set();
  for (const pair of run.protocol.cohort.odPairs) {
    for (const configurationId of pair.configurationIds) keys.add(recordKey(run.runId, 'main', pair.odPairId, configurationId, pair.profileId));
  }
  return keys;
}

function expectedConformanceKeys(run) {
  return new Set(run.protocol.cohort.conformanceProbes.map((probe) => recordKey(run.runId, 'conformance', probe.probeId, probe.configurationId, probe.profileId)));
}

function admitRecordCollectionCore(raw, resolveRunManifest) {
  const value = exactObject(raw, 'S3RecordCollection', ['schemaVersion', 'runManifest', 'mainRecords', 'conformanceRecords']);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.recordCollection, 'S3RecordCollection.schemaVersion');
  const run = resolveRunManifest(value.runManifest);
  const mainRecords = strictArray(value.mainRecords, 'S3RecordCollection.mainRecords', { max: 5_000 }).map((record) => admitJoinedRunRecordWithRun(record, run));
  const conformanceRecords = strictArray(value.conformanceRecords, 'S3RecordCollection.conformanceRecords', { max: run.expectedCounts.conformanceProbeEvaluations }).map((record) => admitJoinedRunRecordWithRun(record, run));
  if (mainRecords.some(({ denominatorKind }) => denominatorKind !== 'main')
    || conformanceRecords.some(({ denominatorKind }) => denominatorKind !== 'conformance')) fail('S3RecordCollection cross-denominator record is forbidden');
  const mainExpected = expectedMainKeys(run);
  const conformanceExpected = expectedConformanceKeys(run);
  for (const record of mainRecords) if (!mainExpected.has(record.recordKey)) fail('S3RecordCollection contains an extra main record');
  for (const record of conformanceRecords) if (!conformanceExpected.has(record.recordKey)) fail('S3RecordCollection contains an extra conformance record');
  if (new Set(mainRecords.map(({ recordKey: key }) => key)).size !== mainRecords.length
    || new Set(conformanceRecords.map(({ recordKey: key }) => key)).size !== conformanceRecords.length) fail('S3RecordCollection contains duplicate records');
  const executionAttemptIds = [...mainRecords, ...conformanceRecords].flatMap((record) => [
    record.primaryExecution.executionAttemptId,
    record.replayExecution.executionAttemptId,
  ]);
  if (new Set(executionAttemptIds).size !== executionAttemptIds.length) {
    fail('S3RecordCollection executionAttemptIds must be globally distinct');
  }
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.recordCollection,
    runManifest: run,
    mainRecords,
    conformanceRecords,
  });
}

export function admitS3RecordCollection(raw) {
  return admitRecordCollectionCore(raw, admitS3RunManifest);
}

export function admitS3RecordCollectionWithValidationSession(raw, session) {
  const state = validationAdmissionSessionState(session);
  return admitRecordCollectionCore(raw, (runManifest) => {
    if (runManifest !== state.admittedRunManifest) {
      fail('S3RecordCollection.runManifest drifted from the validation admission session');
    }
    return state.admittedRunManifest;
  });
}

function zeroMap(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function integerDistribution(values) {
  if (values.length === 0) return { sampleCount: 0, min: null, p50: null, p95: null, max: null };
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (percent) => sorted[Math.ceil((percent / 100) * sorted.length) - 1];
  return {
    sampleCount: sorted.length,
    min: sorted[0],
    p50: percentile(50),
    p95: percentile(95),
    max: sorted.at(-1),
  };
}

function deriveMeasurements(records, expected, executionKey) {
  const measurements = records.map((record) => record[executionKey].measurement);
  const measured = measurements.filter(({ measurementStatus }) => measurementStatus === 'measured');
  const cold = measured.filter(({ cacheState }) => cacheState === 'cold');
  const warm = measured.filter(({ cacheState }) => cacheState === 'warm');
  return {
    denominatorUnit: 'scenario-config-product-execution',
    expected,
    recorded: measurements.length,
    measured: measured.length,
    recordedNotMeasured: measurements.length - measured.length,
    missingRecords: expected - measurements.length,
    notMeasured: expected - measured.length,
    coldSamples: cold.length,
    warmSamples: warm.length,
    coldLatencyMicros: integerDistribution(cold.map(({ latencyMicros }) => latencyMicros)),
    warmLatencyMicros: integerDistribution(warm.map(({ latencyMicros }) => latencyMicros)),
    measuredMemoryBytes: integerDistribution(measured.map(({ memoryBytes }) => memoryBytes)),
  };
}

function deriveDenominator(records, expected) {
  const terminalStatuses = zeroMap(TERMINATION_KEYS);
  const observations = { denominatorUnit: 'candidate-factor-observation', denominator: 0, ...zeroMap(OBSERVATION_KEYS) };
  const replayComparisons = zeroMap(['match', 'mismatch', 'not-comparable', 'not-run']);
  const oracleComparisons = zeroMap(['match', 'mismatch', 'not-comparable', 'not-run']);
  const conformanceOutcomes = zeroMap([...CONFORMANCE_OUTCOMES]);
  const constraintOutcomes = zeroMap([
    'not-required', 'eligible-candidates-returned',
    'no-eligible-route-in-bounded-scope-proven', 'no-eligible-route-not-proven',
    'unresolved-evidence', 'not-evaluated',
  ]);
  const budgetOutcomes = zeroMap(['within-budget', 'exhausted', 'not-evaluated']);
  const capacityOutcomes = zeroMap(['within-capacity', 'exhausted', 'not-evaluated']);
  const completenessOutcomes = zeroMap(['complete-within-bounds', 'not-proven', 'not-evaluated']);
  let attempted = 0;
  let terminal = 0;
  let startedNoTerminal = 0;
  for (const record of records) {
    const product = record.primaryExecution;
    if (product.attemptState !== 'not-started') attempted += 1;
    if (product.attemptState === 'terminal') {
      terminal += 1;
      terminalStatuses[product.searchResult.termination] += 1;
    } else if (product.attemptState === 'started-no-terminal') {
      startedNoTerminal += 1;
      terminalStatuses['started-no-terminal'] += 1;
    } else terminalStatuses['not-started'] += 1;
    observations.denominator += product.observationSummary.denominator;
    for (const key of OBSERVATION_KEYS) observations[key] += product.observationSummary[key];
    replayComparisons[record.replayComparison] += 1;
    oracleComparisons[record.oracleComparison] += 1;
    conformanceOutcomes[record.conformanceOutcome] += 1;
    const candidateSet = product.searchResult?.candidateSet;
    if (candidateSet) {
      constraintOutcomes[candidateSet.constraintOutcome] += 1;
      budgetOutcomes[candidateSet.budgetOutcome] += 1;
      capacityOutcomes[candidateSet.capacityOutcome] += 1;
      completenessOutcomes[candidateSet.completeness.routeSearch] += 1;
    } else {
      constraintOutcomes['not-evaluated'] += 1;
      budgetOutcomes['not-evaluated'] += 1;
      capacityOutcomes['not-evaluated'] += 1;
      completenessOutcomes['not-evaluated'] += 1;
    }
  }
  const missingRecords = expected - records.length;
  terminalStatuses['not-started'] += missingRecords;
  constraintOutcomes['not-evaluated'] += missingRecords;
  budgetOutcomes['not-evaluated'] += missingRecords;
  capacityOutcomes['not-evaluated'] += missingRecords;
  completenessOutcomes['not-evaluated'] += missingRecords;
  return {
    expected,
    attempted,
    recorded: records.length,
    terminal,
    notStarted: expected - attempted,
    startedNoTerminal,
    terminalStatuses: { denominator: expected, ...terminalStatuses },
    observationStates: observations,
    replayComparisons: { denominator: expected, ...replayComparisons, 'not-run': replayComparisons['not-run'] + expected - records.length },
    oracleComparisons: { denominator: expected, ...oracleComparisons, 'not-run': oracleComparisons['not-run'] + expected - records.length },
    conformanceOutcomes: { denominator: expected, ...conformanceOutcomes, 'not-run': conformanceOutcomes['not-run'] + expected - records.length },
    constraintOutcomes: { denominator: expected, ...constraintOutcomes },
    budgetOutcomes: { denominator: expected, ...budgetOutcomes },
    capacityOutcomes: { denominator: expected, ...capacityOutcomes },
    completenessOutcomes: { denominator: expected, ...completenessOutcomes },
    performanceMeasurements: {
      primary: deriveMeasurements(records, expected, 'primaryExecution'),
      replay: deriveMeasurements(records, expected, 'replayExecution'),
    },
  };
}

function assertClaims(emitted, protocol, collection, main, conformance, disclosures) {
  for (const claim of emitted) {
    if (!protocol.eligibleClaimCodes.includes(claim)) fail('S3Report emitted claim was not preregistered');
    if (claim === 'synthetic-determinism-evidence') {
      if (main.recorded !== main.expected || main.terminal !== main.expected
        || main.replayComparisons.match !== main.expected) fail('S3Report determinism claim requires complete primary/replay all-match records');
    }
    if (claim === 'synthetic-contract-conformance') {
      if (conformance.recorded !== conformance.expected
        || conformance.conformanceOutcomes.pass !== conformance.expected) fail('S3Report conformance claim requires every prescribed probe to pass');
    }
    if (claim === 'bounded-offline-validation') {
      const boundedTerminal = collection.mainRecords.some(({ primaryExecution }) => (
        primaryExecution.attemptState === 'terminal'
          && primaryExecution.searchResult.candidateSet !== null
      ));
      if (!boundedTerminal
        || disclosures.partialRun !== (main.recorded < main.expected || main.terminal < main.expected)) {
        fail('S3Report bounded validation claim requires bounded terminal evidence and truthful partial disclosure');
      }
    }
  }
}

function admitReportCore(raw, admitRecordCollection) {
  const value = exactObject(raw, 'S3Report', ['schemaVersion', 'reportId', 'recordCollection', 'runId', 'emittedClaimCodes', 'disclosures']);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.report, 'S3Report.schemaVersion');
  const collection = admitRecordCollection(value.recordCollection);
  const run = collection.runManifest;
  if (value.runId !== run.runId) fail('S3Report.runId drifted');
  const disclosuresValue = exactObject(value.disclosures, 'S3Report.disclosures', ['partialRun', 'stoppedRecords']);
  if (typeof disclosuresValue.partialRun !== 'boolean') fail('S3Report.disclosures.partialRun must be boolean');
  const stoppedRecords = integer(disclosuresValue.stoppedRecords, 'S3Report.disclosures.stoppedRecords', { max: 5_000 });
  const actualStopped = collection.mainRecords.filter(({ primaryExecution }) => (
    primaryExecution.searchResult?.status === 'stopped'
  )).length;
  if (stoppedRecords !== actualStopped) fail('S3Report stopped disclosure must be derived from records');
  const main = deriveDenominator(collection.mainRecords, run.expectedCounts.scenarioConfigEvaluations);
  const conformance = deriveDenominator(collection.conformanceRecords, run.expectedCounts.conformanceProbeEvaluations);
  const actualPartial = main.recorded < main.expected || main.terminal < main.expected;
  if (disclosuresValue.partialRun !== actualPartial) fail('S3Report partial disclosure must be derived from records');
  const emittedClaimCodes = claimCodes(value.emittedClaimCodes, 'S3Report.emittedClaimCodes');
  const disclosures = { partialRun: actualPartial, stoppedRecords: actualStopped };
  assertClaims(emittedClaimCodes, run.protocol, collection, main, conformance, disclosures);
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.report,
    reportId: id(value.reportId, 'S3Report.reportId'),
    recordCollection: collection,
    runId: run.runId,
    emittedClaimCodes,
    disclosures,
    counts: {
      uniqueOdPairs: S3_SCENARIO_COUNTS.uniqueOdPairs,
      configurationGroups: S3_SCENARIO_COUNTS.configurationGroups,
      scenarioConfigEvaluations: S3_SCENARIO_COUNTS.scenarioConfigEvaluations,
    },
    mainCohortDenominators: main,
    conformanceDenominators: conformance,
    executionEvidence: {
      graphIdentity: graphIdentityOf(run.graphScope),
      graphSize: {
        nodeCount: run.graphScope.graphArtifact.nodes.length,
        edgeCount: run.graphScope.graphArtifact.edges.length,
        canonicalArtifactUtf8Bytes: new TextEncoder().encode(
          JSON.stringify(run.graphScope.graphArtifact),
        ).length,
      },
      executionIdentity: run.executionIdentity,
      referenceEnvironment: run.referenceEnvironment,
      performanceProtocol: run.performanceProtocol,
      performanceInterpretation: 'diagnostic-only-no-performance-claim-eligible-in-v1',
    },
  });
}

export function admitS3Report(raw) {
  return admitReportCore(raw, admitS3RecordCollection);
}

export function admitS3ReportWithValidationSession(raw, session) {
  validationAdmissionSessionState(session);
  return admitReportCore(
    raw,
    (recordCollection) => admitS3RecordCollectionWithValidationSession(
      recordCollection,
      session,
    ),
  );
}
