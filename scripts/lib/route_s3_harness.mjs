import {
  S3_SCENARIO_SCHEMA_VERSIONS,
  admitS3JoinedRunRecordWithValidationSession,
  admitS3RecordCollectionWithValidationSession,
  admitS3Report,
  admitS3ReportWithValidationSession,
  createS3ValidationAdmissionSession,
} from '../../src/route_decision/contracts/scenario_cohort_v1.js';

import { evaluateIndependentRouteCase } from './route_s3_oracle.mjs';
import { invokeRouteS3Product } from './route_s3_product_adapter.mjs';

const ROUTE_S3_FORCED_ADMISSION_TEST_ERRORS = new WeakSet();

export function isRouteS3ForcedAdmissionTestError(error) {
  return Boolean(error && typeof error === 'object' && ROUTE_S3_FORCED_ADMISSION_TEST_ERRORS.has(error));
}

function recordKey(run, denominatorKind, scenarioId, configurationId, profileId) {
  return `${run.runId}:${denominatorKind}:${scenarioId}:${configurationId}:${profileId}`;
}

function scenarioFor(run, denominatorKind, scenarioId, configurationId) {
  if (denominatorKind === 'main') {
    const odPair = run.protocol.cohort.odPairs.find((item) => item.odPairId === scenarioId);
    if (!odPair?.configurationIds.includes(configurationId)) throw new TypeError('unknown S3 main scenario/configuration');
    return {
      profileId: odPair.profileId,
      odPairId: odPair.odPairId,
      originNodeId: odPair.originNodeId,
      destinationNodeId: odPair.destinationNodeId,
      graphArtifact: run.graphScope.graphArtifact,
      edgeFactorEvidence: run.protocol.cohort.edgeFactorEvidence,
      requestMutation: null,
    };
  }
  const probe = run.protocol.cohort.conformanceProbes.find((item) => (
    item.probeId === scenarioId && item.configurationId === configurationId
  ));
  if (!probe) throw new TypeError('unknown S3 conformance scenario/configuration');
  return {
    profileId: probe.profileId,
    odPairId: null,
    originNodeId: probe.stimulus.originNodeId,
    destinationNodeId: probe.stimulus.destinationNodeId,
    graphArtifact: probe.stimulus.graphArtifact,
    edgeFactorEvidence: probe.stimulus.edgeFactorEvidence,
    requestMutation: probe.stimulus.requestMutation,
  };
}

function graphIdentity(graphArtifact, graphContentIdentity) {
  return {
    scopeKind: 'admitted-synthetic-graph',
    graphId: graphArtifact.graphId,
    artifactVersion: graphArtifact.receipt.artifactVersion,
    graphContentIdentity: structuredClone(graphContentIdentity),
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

function notMeasured() {
  return {
    measurementStatus: 'not-measured',
    cacheState: 'not-applicable',
    latencyMicros: null,
    memoryBytes: null,
    unmeasuredReason: 'measurement-not-enabled',
  };
}

function assertExecutionSession(session) {
  if (!session?.validationAdmissionSession?.admittedRunManifest) {
    throw new TypeError('a Route S3 admitted execution session is required');
  }
  return session;
}

export function createRouteS3AdmittedExecutionSession({ runManifest }) {
  const validationAdmissionSession = createS3ValidationAdmissionSession(runManifest);
  return Object.freeze({
    validationAdmissionSession,
    run: validationAdmissionSession.admittedRunManifest,
  });
}

function productExecutionEnvelope({
  run,
  scenario,
  denominatorKind,
  scenarioId,
  configurationId,
  execution,
  role,
  invocation,
}) {
  return {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.productExecution,
    recordKey: recordKey(run, denominatorKind, scenarioId, configurationId, scenario.profileId),
    denominatorKind,
    scenarioId,
    runId: run.runId,
    protocolId: run.protocolId,
    graphIdentity: graphIdentity(scenario.graphArtifact, scenario.edgeFactorEvidence.graphContentIdentity),
    evidenceIdentity: evidenceIdentity(scenario.edgeFactorEvidence),
    odPairId: scenario.odPairId,
    configurationId,
    profileId: scenario.profileId,
    decisionPolicy: structuredClone(execution.decisionPolicy),
    searchRequest: structuredClone(execution.searchRequest),
    executionRole: role,
    executionAttemptId: invocation.invocationId,
    attemptState: 'terminal',
    searchResult: invocation.searchResult,
    decisionEvaluation: invocation.decisionEvaluation,
    measurement: notMeasured(),
  };
}

export function executeRouteS3AdmittedRecord({
  session,
  denominatorKind,
  scenarioId,
  configurationId,
  forceAdmissionFailure = false,
}) {
  const { run, validationAdmissionSession } = assertExecutionSession(session);
  const scenario = scenarioFor(run, denominatorKind, scenarioId, configurationId);
  const configuration = run.configurationExecutions.find((item) => item.configurationId === configurationId);
  const searchRequest = {
    ...structuredClone(configuration.searchRequestTemplate),
    requestId: `${run.runId}-${scenarioId}-${configurationId}`.slice(0, 120),
    graphId: scenario.graphArtifact.graphId,
    originNodeId: scenario.originNodeId,
    destinationNodeId: scenario.destinationNodeId,
  };
  const executableRequest = scenario.requestMutation
    ? { ...structuredClone(searchRequest), [scenario.requestMutation.field]: scenario.requestMutation.invalidValue }
    : searchRequest;
  const invocationSequence = [];
  const invoke = (role, sequence) => {
    const invocationId = `${run.runId}-${role}-${scenarioId}-${configurationId}`.slice(0, 120);
    const result = invokeRouteS3Product({
      graphArtifact: scenario.graphArtifact,
      searchRequest: executableRequest,
      edgeFactorEvidence: scenario.edgeFactorEvidence,
      decisionPolicy: configuration.decisionPolicy,
      invocationId,
    });
    invocationSequence.push(Object.freeze({
      sequence,
      role,
      invocationId,
      termination: result.searchResult.termination,
      candidateIds: Object.freeze(result.searchResult.candidateFacts.map(({ candidateId }) => candidateId)),
    }));
    return result;
  };
  const primaryInvocation = invoke('primary', 1);
  const replayInvocation = invoke('replay', 2);
  const expectedOutcome = evaluateIndependentRouteCase({
    graphArtifact: scenario.graphArtifact,
    searchRequest: executableRequest,
    edgeFactorEvidence: scenario.edgeFactorEvidence,
    decisionPolicy: configuration.decisionPolicy,
  });
  const primaryExecution = productExecutionEnvelope({
    run,
    scenario,
    denominatorKind,
    scenarioId,
    configurationId,
    execution: { decisionPolicy: configuration.decisionPolicy, searchRequest },
    role: 'primary',
    invocation: primaryInvocation,
  });
  const replayExecution = productExecutionEnvelope({
    run,
    scenario,
    denominatorKind,
    scenarioId,
    configurationId,
    execution: { decisionPolicy: configuration.decisionPolicy, searchRequest },
    role: 'replay',
    invocation: replayInvocation,
  });
  const oracleResult = {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.independentOracle,
    recordKey: primaryExecution.recordKey,
    denominatorKind,
    scenarioId,
    runId: run.runId,
    protocolId: run.protocolId,
    graphIdentity: structuredClone(primaryExecution.graphIdentity),
    evidenceIdentity: structuredClone(primaryExecution.evidenceIdentity),
    odPairId: scenario.odPairId,
    configurationId,
    profileId: scenario.profileId,
    decisionPolicy: structuredClone(configuration.decisionPolicy),
    searchRequest: structuredClone(searchRequest),
    oracleStatus: 'computed',
    expectedOutcome,
  };
  const joinedRecordCandidate = {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.joinedRunRecord,
    recordKey: primaryExecution.recordKey,
    denominatorKind,
    primaryExecution,
    replayExecution,
    oracleResult,
  };
  if (forceAdmissionFailure) joinedRecordCandidate.recordKey = 'forced-contract-invalid-record-key';
  let joinedRecord;
  try {
    joinedRecord = admitS3JoinedRunRecordWithValidationSession(
      joinedRecordCandidate,
      validationAdmissionSession,
    );
  } catch (error) {
    if (!forceAdmissionFailure) throw error;
    ROUTE_S3_FORCED_ADMISSION_TEST_ERRORS.add(error);
    throw error;
  }
  return Object.freeze({
    joinedRecord,
    invocationSequence: Object.freeze(invocationSequence),
    productResultObjectsAreDistinct: primaryInvocation.searchResult !== replayInvocation.searchResult,
  });
}

export function executeRouteS3JoinedRecord({
  runManifest,
  denominatorKind,
  scenarioId,
  configurationId,
}) {
  const session = createRouteS3AdmittedExecutionSession({ runManifest });
  return executeRouteS3AdmittedRecord({
    session,
    denominatorKind,
    scenarioId,
    configurationId,
  });
}

function rawProductExecution(execution) {
  return {
    schemaVersion: execution.schemaVersion,
    recordKey: execution.recordKey,
    denominatorKind: execution.denominatorKind,
    scenarioId: execution.scenarioId,
    runId: execution.runId,
    protocolId: execution.protocolId,
    graphIdentity: structuredClone(execution.graphIdentity),
    evidenceIdentity: structuredClone(execution.evidenceIdentity),
    odPairId: execution.odPairId,
    configurationId: execution.configurationId,
    profileId: execution.profileId,
    decisionPolicy: structuredClone(execution.decisionPolicy),
    searchRequest: structuredClone(execution.searchRequest),
    executionRole: execution.executionRole,
    executionAttemptId: execution.executionAttemptId,
    attemptState: execution.attemptState,
    searchResult: structuredClone(execution.searchResult),
    decisionEvaluation: structuredClone(execution.decisionEvaluation),
    measurement: structuredClone(execution.measurement),
  };
}

function rawJoinedRecord(record) {
  return {
    schemaVersion: record.schemaVersion,
    recordKey: record.recordKey,
    denominatorKind: record.denominatorKind,
    primaryExecution: rawProductExecution(record.primaryExecution),
    replayExecution: rawProductExecution(record.replayExecution),
    oracleResult: structuredClone(record.oracleResult),
  };
}

export function admitRouteS3JoinedRecordBatch({
  session,
  mainRecordCandidates = [],
  conformanceRecordCandidates = [],
}) {
  const { run, validationAdmissionSession } = assertExecutionSession(session);
  return admitS3RecordCollectionWithValidationSession({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.recordCollection,
    runManifest: run,
    mainRecords: mainRecordCandidates.map(rawJoinedRecord),
    conformanceRecords: conformanceRecordCandidates.map(rawJoinedRecord),
  }, validationAdmissionSession);
}

function buildRouteS3Report({
  validationAdmissionSession,
  runManifest,
  mainRecords,
  conformanceRecords,
  reportId,
}) {
  const rawMainRecords = mainRecords.map(rawJoinedRecord);
  const rawConformanceRecords = conformanceRecords.map(rawJoinedRecord);
  const recordCollection = {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.recordCollection,
    runManifest,
    mainRecords: rawMainRecords,
    conformanceRecords: rawConformanceRecords,
  };
  const stoppedRecords = rawMainRecords.filter(({ primaryExecution }) => (
    primaryExecution.searchResult?.status === 'stopped'
  )).length;
  const reportInput = {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.report,
    reportId,
    recordCollection,
    runId: runManifest.runId,
    emittedClaimCodes: [],
    disclosures: {
      partialRun: rawMainRecords.length < 5_000,
      stoppedRecords,
    },
  };
  return validationAdmissionSession
    ? admitS3ReportWithValidationSession(reportInput, validationAdmissionSession)
    : admitS3Report(reportInput);
}

export function buildRouteS3FocusedReport({ runManifest, mainRecords = [], conformanceRecords = [] }) {
  return buildRouteS3Report({
    runManifest,
    mainRecords,
    conformanceRecords,
    reportId: 's3-focused-micrograph-report-v1',
  });
}

export function buildRouteS3ScaleReport({ session, mainRecords = [], conformanceRecords = [] }) {
  const { run, validationAdmissionSession } = assertExecutionSession(session);
  return buildRouteS3Report({
    validationAdmissionSession,
    runManifest: run,
    mainRecords,
    conformanceRecords,
    reportId: 's3-scale-runner-report-v1',
  });
}

export function summarizeRouteS3FocusedEvidence(records) {
  const summary = {
    denominatorUnit: 'focused-joined-record',
    recorded: records.length,
    productInvocations: records.length * 2,
    terminalPrimary: 0,
    primaryCandidates: 0,
    alternativeCandidates: 0,
    constraintRecords: 0,
    terminalOutcomes: {},
    constraintOutcomes: {},
    explanationItems: {
      hardConstraint: 0,
      softPreference: 0,
      candidateDisposition: 0,
      ranking: 0,
    },
    completenessOutcomes: {},
    budgetOutcomes: {},
    capacityOutcomes: {},
  };
  const increment = (target, key) => {
    target[key] = (target[key] ?? 0) + 1;
  };
  for (const record of records) {
    const execution = record.primaryExecution;
    if (execution.attemptState !== 'terminal') continue;
    summary.terminalPrimary += 1;
    const result = execution.searchResult;
    const candidateCount = result.candidateFacts.length;
    summary.primaryCandidates += candidateCount > 0 ? 1 : 0;
    summary.alternativeCandidates += Math.max(0, candidateCount - 1);
    summary.constraintRecords += execution.searchRequest.hardConstraints.length > 0 ? 1 : 0;
    increment(summary.terminalOutcomes, result.termination);
    const candidateSet = result.candidateSet;
    increment(summary.constraintOutcomes, candidateSet?.constraintOutcome ?? 'not-evaluated');
    increment(summary.completenessOutcomes, candidateSet?.completeness.routeSearch ?? 'not-evaluated');
    increment(summary.budgetOutcomes, candidateSet?.budgetOutcome ?? 'not-evaluated');
    increment(summary.capacityOutcomes, candidateSet?.capacityOutcome ?? 'not-evaluated');
    const trace = execution.decisionEvaluation.evaluation.decision?.trace ?? [];
    summary.explanationItems.hardConstraint += trace.filter(({ stage }) => stage === 'hard-constraint').length;
    summary.explanationItems.softPreference += trace.filter(({ stage }) => stage === 'soft-preference').length;
    summary.explanationItems.candidateDisposition += trace.filter(({ stage }) => stage === 'candidate-disposition').length;
    summary.explanationItems.ranking += trace.filter(({ stage }) => stage === 'ranking').length;
  }
  return Object.freeze(summary);
}
