import {
  createHash,
} from 'node:crypto';

import { ROUTE_SEARCH_CAPACITY_POLICY } from '../candidate_search_v2.js';
import { admitSourceObservation } from '../index.js';
import { admitCanonicalOutcome } from './canonical_outcome_v1.js';
import {
  CAPABILITY_FACTORS,
  PROBE_TERMINATIONS,
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
  S3_SYNTHETIC_DISTANCE_BUCKETS as SYNTHETIC_DISTANCE_BUCKETS,
  S3_SYNTHETIC_PROFILES,
  S3_SYNTHETIC_PROFILE_IDS,
  areS3DataTreesEquivalent,
  admitExactLiteral,
  admitPolicy,
  admitSearchRequest,
  admitSyntheticGraph,
  assertCounts,
  assertPolicySearchEquality,
  claimCodes,
  deepFreeze,
  exactObject,
  exactSequence,
  exactVersion,
  fail,
  id,
  integer,
  same,
  snapshotData,
  strictArray,
  text,
  version,
} from './model_v1.js';

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
  areS3DataTreesEquivalent,
};

function admitCapacityPolicy(raw, label) {
  const value = exactObject(raw, label, ['version', 'maxFrontierStates', 'maxFrontierEdgeReferences']);
  const admitted = {
    version: version(value.version, `${label}.version`),
    maxFrontierStates: integer(value.maxFrontierStates, `${label}.maxFrontierStates`, { min: 1 }),
    maxFrontierEdgeReferences: integer(value.maxFrontierEdgeReferences, `${label}.maxFrontierEdgeReferences`, { min: 1 }),
  };
  if (!same(admitted, ROUTE_SEARCH_CAPACITY_POLICY)) fail(`${label} must match the frozen S2 capacity policy`);
  return admitted;
}

export function admitS3ConfigurationGroup(raw) {
  const value = exactObject(raw, 'S3ConfigurationGroup', [
    'schemaVersion', 'configurationId', 'ordinal', 'configurationKind', 'definitionScope',
    'historicalWrtRecovery', 'policyArtifactVersion', 'decisionPolicy',
    'searchRequestTemplate', 'capacityPolicy',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.configuration, 'S3ConfigurationGroup.schemaVersion');
  const configurationId = id(value.configurationId, 'S3ConfigurationGroup.configurationId');
  const index = S3_CONFIGURATION_IDS.indexOf(configurationId);
  if (index < 0) fail('S3ConfigurationGroup.configurationId is unsupported');
  const policy = admitPolicy(value.decisionPolicy, 'S3ConfigurationGroup.decisionPolicy');
  const request = admitSearchRequest(value.searchRequestTemplate, 'S3ConfigurationGroup.searchRequestTemplate');
  assertPolicySearchEquality(policy, request, 'S3ConfigurationGroup');
  const admitted = {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.configuration,
    configurationId,
    ordinal: integer(value.ordinal, 'S3ConfigurationGroup.ordinal', { max: 4 }),
    configurationKind: value.configurationKind,
    definitionScope: value.definitionScope,
    historicalWrtRecovery: value.historicalWrtRecovery,
    policyArtifactVersion: id(value.policyArtifactVersion, 'S3ConfigurationGroup.policyArtifactVersion'),
    decisionPolicy: policy,
    searchRequestTemplate: request,
    capacityPolicy: admitCapacityPolicy(value.capacityPolicy, 'S3ConfigurationGroup.capacityPolicy'),
  };
  if (!same(admitted, S3_CONFIGURATION_GROUPS[index])) fail('S3ConfigurationGroup drifted from the frozen current-primitive configuration');
  return deepFreeze(admitted);
}

export function admitS3SyntheticProfile(raw) {
  const value = exactObject(raw, 'S3SyntheticProfile', [
    'schemaVersion', 'profileId', 'profileKind', 'assignmentTarget',
    'pairedStratumLabel', 'behavioralEffect',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.syntheticProfile, 'S3SyntheticProfile.schemaVersion');
  const profileId = id(value.profileId, 'S3SyntheticProfile.profileId');
  const index = S3_SYNTHETIC_PROFILE_IDS.indexOf(profileId);
  if (index < 0) fail('S3SyntheticProfile.profileId is unsupported');
  const admitted = {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.syntheticProfile,
    profileId,
    profileKind: value.profileKind,
    assignmentTarget: integer(value.assignmentTarget, 'S3SyntheticProfile.assignmentTarget', { min: 500, max: 500 }),
    pairedStratumLabel: id(value.pairedStratumLabel, 'S3SyntheticProfile.pairedStratumLabel'),
    behavioralEffect: value.behavioralEffect,
  };
  if (!same(admitted, S3_SYNTHETIC_PROFILES[index])) fail('S3SyntheticProfile must be a non-behavioral paired cohort stratum');
  return deepFreeze(admitted);
}

function admitGraphScope(raw) {
  const value = exactObject(raw, 'S3GraphScope', [
    'scopeKind', 'graphArtifact', 'graphContentIdentity',
  ]);
  if (value.scopeKind !== 'admitted-synthetic-graph') {
    fail('S3GraphScope v1 only admits a complete synthetic GraphArtifact/v1');
  }
  const graphArtifact = admitSyntheticGraph(value.graphArtifact, 'S3GraphScope.graphArtifact');
  const graphContentIdentity = admitGraphContentIdentity(
    value.graphContentIdentity,
    graphArtifact,
    'S3GraphScope.graphContentIdentity',
  );
  return deepFreeze({
    scopeKind: 'admitted-synthetic-graph',
    graphArtifact,
    graphContentIdentity,
  });
}

function graphIdentityOf(scope) {
  return graphIdentityOfArtifact(scope.graphArtifact);
}

function graphIdentityOfArtifact(graphArtifact) {
  return {
    scopeKind: 'admitted-synthetic-graph',
    graphId: graphArtifact.graphId,
    artifactVersion: graphArtifact.receipt.artifactVersion,
    graphContentIdentity: graphContentIdentityOfAdmitted(graphArtifact),
  };
}

function graphContentIdentityOfAdmitted(graphArtifact) {
  const canonicalGraphArtifact = JSON.stringify(graphArtifact);
  return {
    canonicalization: 'json-stringify-admitted-graph-artifact/v1',
    digestAlgorithm: 'sha256',
    canonicalUtf8Bytes: new TextEncoder().encode(canonicalGraphArtifact).length,
    digest: `sha256:${createHash('sha256').update(canonicalGraphArtifact, 'utf8').digest('hex')}`,
  };
}

function admitGraphContentIdentity(raw, graphArtifact, label) {
  const value = exactObject(raw, label, [
    'canonicalization', 'digestAlgorithm', 'canonicalUtf8Bytes', 'digest',
  ]);
  const admitted = {
    canonicalization: version(value.canonicalization, `${label}.canonicalization`),
    digestAlgorithm: id(value.digestAlgorithm, `${label}.digestAlgorithm`),
    canonicalUtf8Bytes: integer(value.canonicalUtf8Bytes, `${label}.canonicalUtf8Bytes`),
    digest: version(value.digest, `${label}.digest`),
  };
  const expected = graphContentIdentityOfAdmitted(graphArtifact);
  if (!same(admitted, expected)) fail(`${label} must be recomputed from the complete admitted GraphArtifact`);
  return admitted;
}

export function buildS3GraphContentIdentity(rawGraphArtifact) {
  const graphArtifact = admitSyntheticGraph(rawGraphArtifact, 'S3 graph content identity input');
  return deepFreeze(graphContentIdentityOfAdmitted(graphArtifact));
}

function admitEdgeFactorEvidence(raw, graphArtifact, label) {
  const value = exactObject(raw, label, [
    'schemaVersion', 'evidenceId', 'fixtureVersion', 'graphId',
    'graphArtifactVersion', 'graphContentIdentity', 'factorIds', 'edgeEvidence',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.edgeFactorEvidence, `${label}.schemaVersion`);
  if (value.graphId !== graphArtifact.graphId
    || value.graphArtifactVersion !== graphArtifact.receipt.artifactVersion) {
    fail(`${label} graph revision drifted`);
  }
  exactSequence(value.factorIds, CAPABILITY_FACTORS, `${label}.factorIds`);
  const graphContentIdentity = admitGraphContentIdentity(
    value.graphContentIdentity,
    graphArtifact,
    `${label}.graphContentIdentity`,
  );
  const expectedEdges = new Map(graphArtifact.edges.map((edge) => [edge.edgeId, edge]));
  const edgeEvidence = strictArray(value.edgeEvidence, `${label}.edgeEvidence`, {
    min: graphArtifact.edges.length,
    max: graphArtifact.edges.length,
  }).map((rawEntry, index) => {
    const entryLabel = `${label}.edgeEvidence[${index}]`;
    const entry = exactObject(rawEntry, entryLabel, ['edgeId', 'observations']);
    const edgeId = id(entry.edgeId, `${entryLabel}.edgeId`);
    if (!expectedEdges.has(edgeId)) fail(`${entryLabel} references an unknown directed edge`);
    const observations = exactObject(entry.observations, `${entryLabel}.observations`, CAPABILITY_FACTORS);
    const admittedObservations = {};
    for (const factorId of CAPABILITY_FACTORS) {
      const observation = admitSourceObservation(snapshotData(observations[factorId], `${entryLabel}.observations.${factorId}`));
      if (observation.factorId !== factorId) fail(`${entryLabel} observation factor drifted`);
      admittedObservations[factorId] = observation;
    }
    return { edgeId, observations: admittedObservations };
  });
  if (new Set(edgeEvidence.map(({ edgeId }) => edgeId)).size !== expectedEdges.size) {
    fail(`${label} must bind every directed edge exactly once`);
  }
  const byEdge = new Map(edgeEvidence.map((entry) => [entry.edgeId, entry]));
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.edgeFactorEvidence,
    evidenceId: id(value.evidenceId, `${label}.evidenceId`),
    fixtureVersion: version(value.fixtureVersion, `${label}.fixtureVersion`),
    graphId: graphArtifact.graphId,
    graphArtifactVersion: graphArtifact.receipt.artifactVersion,
    graphContentIdentity,
    factorIds: [...CAPABILITY_FACTORS],
    edgeEvidence: graphArtifact.edges.map(({ edgeId }) => byEdge.get(edgeId)),
  });
}

function evidenceIdentityOf(evidence) {
  return {
    schemaVersion: evidence.schemaVersion,
    evidenceId: evidence.evidenceId,
    fixtureVersion: evidence.fixtureVersion,
    graphId: evidence.graphId,
    graphArtifactVersion: evidence.graphArtifactVersion,
    graphContentIdentity: evidence.graphContentIdentity,
  };
}

function admitEvidenceIdentity(raw, label) {
  const value = exactObject(raw, label, [
    'schemaVersion', 'evidenceId', 'fixtureVersion', 'graphId', 'graphArtifactVersion',
    'graphContentIdentity',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.edgeFactorEvidence, `${label}.schemaVersion`);
  return {
    schemaVersion: value.schemaVersion,
    evidenceId: id(value.evidenceId, `${label}.evidenceId`),
    fixtureVersion: version(value.fixtureVersion, `${label}.fixtureVersion`),
    graphId: id(value.graphId, `${label}.graphId`),
    graphArtifactVersion: version(value.graphArtifactVersion, `${label}.graphArtifactVersion`),
    graphContentIdentity: admitGraphContentIdentityShape(
      value.graphContentIdentity,
      `${label}.graphContentIdentity`,
    ),
  };
}

function admitGraphContentIdentityShape(raw, label) {
  const value = exactObject(raw, label, [
    'canonicalization', 'digestAlgorithm', 'canonicalUtf8Bytes', 'digest',
  ]);
  if (value.canonicalization !== 'json-stringify-admitted-graph-artifact/v1') {
    fail(`${label}.canonicalization is unsupported`);
  }
  if (value.digestAlgorithm !== 'sha256' || !/^sha256:[0-9a-f]{64}$/.test(value.digest)) {
    fail(`${label} digest contract is unsupported`);
  }
  return {
    canonicalization: value.canonicalization,
    digestAlgorithm: value.digestAlgorithm,
    canonicalUtf8Bytes: integer(value.canonicalUtf8Bytes, `${label}.canonicalUtf8Bytes`),
    digest: value.digest,
  };
}

function admitRecordGraphIdentity(raw, label) {
  const value = exactObject(raw, label, [
    'scopeKind', 'graphId', 'artifactVersion', 'graphContentIdentity',
  ]);
  if (value.scopeKind !== 'admitted-synthetic-graph') {
    fail(`${label}.scopeKind is unsupported`);
  }
  return {
    scopeKind: value.scopeKind,
    graphId: id(value.graphId, `${label}.graphId`),
    artifactVersion: version(value.artifactVersion, `${label}.artifactVersion`),
    graphContentIdentity: admitGraphContentIdentityShape(
      value.graphContentIdentity,
      `${label}.graphContentIdentity`,
    ),
  };
}

function syntheticPartitionId(seed, index, originNodeId, destinationNodeId) {
  let hash = seed >>> 0;
  const input = `${index}:${originNodeId}:${destinationNodeId}`;
  for (let cursor = 0; cursor < input.length; cursor += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(cursor), 16_777_619) >>> 0;
  }
  return `synthetic-partition-${hash % 10}`;
}

export function buildS3ScenarioOdPairs(
  rawGraphArtifact,
  scenarioGeneratorVersion = S3_SCENARIO_GENERATOR_VERSION,
  seed = S3_SCENARIO_SEED,
) {
  exactVersion(
    scenarioGeneratorVersion,
    S3_SCENARIO_GENERATOR_VERSION,
    'S3 scenario generator version',
  );
  if (seed !== S3_SCENARIO_SEED) fail(`S3 scenario seed must be ${S3_SCENARIO_SEED}`);
  const graphArtifact = admitSyntheticGraph(rawGraphArtifact, 'S3 scenario generator graph');
  const seenEndpointPairs = new Set();
  const selectedEdges = [];
  for (const edge of graphArtifact.edges) {
    const endpointKey = `${edge.fromNodeId}\0${edge.toNodeId}`;
    if (seenEndpointPairs.has(endpointKey)) continue;
    seenEndpointPairs.add(endpointKey);
    selectedEdges.push(edge);
    if (selectedEdges.length === S3_SCENARIO_COUNTS.uniqueOdPairs) break;
  }
  if (selectedEdges.length !== S3_SCENARIO_COUNTS.uniqueOdPairs) {
    fail('S3 scenario generator requires 1000 unique directed edge endpoint pairs');
  }
  let shuffleState = seed >>> 0;
  for (let index = selectedEdges.length - 1; index > 0; index -= 1) {
    shuffleState = (Math.imul(shuffleState, 1_664_525) + 1_013_904_223) >>> 0;
    const swapIndex = shuffleState % (index + 1);
    [selectedEdges[index], selectedEdges[swapIndex]] = [selectedEdges[swapIndex], selectedEdges[index]];
  }
  const ranked = selectedEdges.map((edge, selectionIndex) => ({ edge, selectionIndex }));
  ranked.sort((left, right) => (
    left.edge.distanceMm - right.edge.distanceMm
      || (left.edge.edgeId < right.edge.edgeId ? -1 : left.edge.edgeId > right.edge.edgeId ? 1 : 0)
      || left.selectionIndex - right.selectionIndex
  ));
  const bucketBySelectionIndex = new Map(ranked.map(({ selectionIndex }, rank) => [
    selectionIndex,
    SYNTHETIC_DISTANCE_BUCKETS[Math.floor((rank * SYNTHETIC_DISTANCE_BUCKETS.length) / selectedEdges.length)],
  ]));
  return deepFreeze(selectedEdges.map((edge, index) => ({
    odPairId: `od-${String(index).padStart(4, '0')}`,
    originNodeId: edge.fromNodeId,
    destinationNodeId: edge.toNodeId,
    profileId: index < 500 ? S3_SYNTHETIC_PROFILE_IDS[0] : S3_SYNTHETIC_PROFILE_IDS[1],
    configurationIds: [...S3_CONFIGURATION_IDS],
    stratum: {
      weakComponentId: graphArtifact.components.byNodeId[edge.fromNodeId],
      syntheticPartitionId: syntheticPartitionId(seed, index, edge.fromNodeId, edge.toNodeId),
      syntheticDistanceBucket: bucketBySelectionIndex.get(index),
    },
  })));
}

function admitOdPair(raw, index, scope) {
  const label = `S3ScenarioCohort.odPairs[${index}]`;
  const value = exactObject(raw, label, ['odPairId', 'originNodeId', 'destinationNodeId', 'profileId', 'configurationIds', 'stratum']);
  const originNodeId = id(value.originNodeId, `${label}.originNodeId`);
  const destinationNodeId = id(value.destinationNodeId, `${label}.destinationNodeId`);
  if (originNodeId === destinationNodeId) fail(`${label} endpoints must be distinct`);
  if (!S3_SYNTHETIC_PROFILE_IDS.includes(value.profileId)) fail(`${label}.profileId is unsupported`);
  const stratum = exactObject(value.stratum, `${label}.stratum`, [
    'weakComponentId', 'syntheticPartitionId', 'syntheticDistanceBucket',
  ]);
  if (!SYNTHETIC_DISTANCE_BUCKETS.includes(stratum.syntheticDistanceBucket)) {
    fail(`${label}.stratum.syntheticDistanceBucket is unsupported`);
  }
  const nodeIds = new Set(scope.graphArtifact.nodes.map(({ nodeId }) => nodeId));
  if (!nodeIds.has(originNodeId) || !nodeIds.has(destinationNodeId)) fail(`${label} endpoints must exist in the admitted graph`);
  const expectedComponentId = scope.graphArtifact.components.byNodeId[originNodeId];
  if (scope.graphArtifact.components.byNodeId[destinationNodeId] !== expectedComponentId) {
    fail(`${label} endpoints must be in the same admitted weak component`);
  }
  return {
    odPairId: id(value.odPairId, `${label}.odPairId`),
    originNodeId,
    destinationNodeId,
    profileId: value.profileId,
    configurationIds: exactSequence(value.configurationIds, S3_CONFIGURATION_IDS, `${label}.configurationIds`),
    stratum: {
      weakComponentId: integer(stratum.weakComponentId, `${label}.stratum.weakComponentId`, {
        max: scope.graphArtifact.components.count - 1,
      }),
      syntheticPartitionId: id(stratum.syntheticPartitionId, `${label}.stratum.syntheticPartitionId`),
      syntheticDistanceBucket: stratum.syntheticDistanceBucket,
    },
  };
}

function admitProbe(raw, index) {
  const label = `S3ScenarioCohort.conformanceProbes[${index}]`;
  const value = exactObject(raw, label, [
    'schemaVersion', 'probeId', 'probeKind', 'configurationId', 'profileId',
    'stimulus', 'expectedOutcome', 'includedInMainCohort',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.conformanceProbe, `${label}.schemaVersion`);
  if (value.probeKind !== S3_CONFORMANCE_PROBE_KINDS[index]) fail(`${label} kind sequence drifted`);
  if (!S3_CONFIGURATION_IDS.includes(value.configurationId)) fail(`${label}.configurationId is unsupported`);
  if (!S3_SYNTHETIC_PROFILE_IDS.includes(value.profileId)) fail(`${label}.profileId is unsupported`);
  if (value.includedInMainCohort !== false) fail(`${label}.includedInMainCohort must be false`);
  if (index < 2 && value.configurationId !== S3_CONFIGURATION_IDS[0]) {
    fail(`${label} topology/input probe must use the objective-only configuration`);
  }
  if (index >= 2 && value.configurationId !== S3_CONFIGURATION_IDS[4]) {
    fail(`${label} evidence probe must use the three-capability configuration`);
  }
  const stimulusValue = exactObject(value.stimulus, `${label}.stimulus`, [
    'stimulusKind', 'graphArtifact', 'graphContentIdentity', 'edgeFactorEvidence',
    'originNodeId', 'destinationNodeId', 'requestMutation',
  ]);
  if (stimulusValue.stimulusKind !== value.probeKind) fail(`${label}.stimulus kind drifted`);
  const graphArtifact = admitSyntheticGraph(stimulusValue.graphArtifact, `${label}.stimulus.graphArtifact`);
  const graphContentIdentity = admitGraphContentIdentity(
    stimulusValue.graphContentIdentity,
    graphArtifact,
    `${label}.stimulus.graphContentIdentity`,
  );
  const edgeFactorEvidence = admitEdgeFactorEvidence(
    stimulusValue.edgeFactorEvidence,
    graphArtifact,
    `${label}.stimulus.edgeFactorEvidence`,
  );
  const originNodeId = id(stimulusValue.originNodeId, `${label}.stimulus.originNodeId`);
  const destinationNodeId = id(stimulusValue.destinationNodeId, `${label}.stimulus.destinationNodeId`);
  const nodeIds = new Set(graphArtifact.nodes.map(({ nodeId }) => nodeId));
  if (!nodeIds.has(originNodeId) || !nodeIds.has(destinationNodeId) || originNodeId === destinationNodeId) {
    fail(`${label}.stimulus endpoints must be distinct admitted fixture nodes`);
  }
  let requestMutation = null;
  if (value.probeKind === 'invalid-input') {
    const mutation = exactObject(stimulusValue.requestMutation, `${label}.stimulus.requestMutation`, [
      'mutationKind', 'field', 'invalidValue',
    ]);
    if (mutation.mutationKind !== 'replace-field'
      || mutation.field !== 'requestedCandidateCount'
      || mutation.invalidValue !== 0) {
      fail(`${label} invalid-input mutation must replace requestedCandidateCount with zero`);
    }
    requestMutation = { mutationKind: 'replace-field', field: 'requestedCandidateCount', invalidValue: 0 };
  } else if (stimulusValue.requestMutation !== null) {
    fail(`${label}.stimulus.requestMutation is only allowed for invalid-input`);
  }
  const directEdges = graphArtifact.edges.filter(({ fromNodeId, toNodeId }) => (
    fromNodeId === originNodeId && toNodeId === destinationNodeId
  ));
  if (graphArtifact.nodes.length !== 2) {
    fail(`${label} executable probe fixture must contain exactly its two endpoint nodes`);
  }
  if (value.probeKind === 'disconnected') {
    const components = graphArtifact.components.byNodeId;
    if (graphArtifact.edges.length !== 0
      || components[originNodeId] === components[destinationNodeId]) {
      fail(`${label} disconnected stimulus must freeze two components with no directed edge`);
    }
  } else {
    if (graphArtifact.edges.length !== 1 || directEdges.length !== 1) {
      fail(`${label} executable probe must freeze one direct OD-relevant edge and no unrelated topology`);
    }
    const directEvidence = edgeFactorEvidence.edgeEvidence
      .find(({ edgeId }) => edgeId === directEdges[0].edgeId).observations;
    const routeObservations = CAPABILITY_FACTORS.map((factorId) => directEvidence[factorId]);
    if (value.probeKind === 'source-unavailable'
      && (!routeObservations.some(({ state }) => state === 'unavailable')
        || routeObservations.some(({ state, value: observationValue }) => (
          state === 'observed' && observationValue === false
        )))) {
      fail(`${label} source-unavailable stimulus requires unavailable evidence on its only OD route without a known false`);
    }
    if (value.probeKind === 'constraint-no-solution'
      && !routeObservations.some(({ state, value: observationValue }) => (
        state === 'observed' && observationValue === false
      ))) {
      fail(`${label} constraint-no-solution stimulus requires observed false evidence on its only OD route`);
    }
  }
  const expectedOutcome = admitCanonicalOutcome(
    value.expectedOutcome,
    `${label}.expectedOutcome`,
    {
      graphArtifact,
      edgeFactorEvidence,
      policy: S3_DECISION_POLICIES[S3_CONFIGURATION_IDS.indexOf(value.configurationId)],
      searchRequest: S3_CONFIGURATION_GROUPS[
        S3_CONFIGURATION_IDS.indexOf(value.configurationId)
      ].searchRequestTemplate,
      originNodeId,
      destinationNodeId,
      denominatorKind: 'conformance',
      probeKind: value.probeKind,
    },
  );
  if (expectedOutcome.termination !== PROBE_TERMINATIONS[index]) {
    fail(`${label}.expectedOutcome drifted from its executable stimulus contract`);
  }
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.conformanceProbe,
    probeId: id(value.probeId, `${label}.probeId`),
    probeKind: value.probeKind,
    configurationId: value.configurationId,
    profileId: value.profileId,
    stimulus: {
      stimulusKind: value.probeKind,
      graphArtifact,
      graphContentIdentity,
      edgeFactorEvidence,
      originNodeId,
      destinationNodeId,
      requestMutation,
    },
    expectedOutcome,
    includedInMainCohort: false,
  });
}

export function admitS3ScenarioCohort(raw) {
  const value = exactObject(raw, 'S3ScenarioCohort', [
    'schemaVersion', 'cohortId', 'cohortKind', 'scenarioGeneratorVersion',
    'graphScope', 'edgeFactorEvidence', 'seed', 'counts',
    'configurationGroups', 'profiles', 'odPairs', 'conformanceProbes',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.cohort, 'S3ScenarioCohort.schemaVersion');
  if (value.cohortKind !== 'researcher-defined-synthetic-s3') fail('S3ScenarioCohort.cohortKind is unsupported');
  exactVersion(
    value.scenarioGeneratorVersion,
    S3_SCENARIO_GENERATOR_VERSION,
    'S3ScenarioCohort.scenarioGeneratorVersion',
  );
  if (value.seed !== S3_SCENARIO_SEED) fail(`S3ScenarioCohort.seed must be ${S3_SCENARIO_SEED}`);
  const countsValue = exactObject(value.counts, 'S3ScenarioCohort.counts', Object.keys(S3_SCENARIO_COUNTS));
  assertCounts(countsValue, 'S3ScenarioCohort.counts');
  const graphScope = admitGraphScope(value.graphScope);
  const edgeFactorEvidence = admitEdgeFactorEvidence(
    value.edgeFactorEvidence,
    graphScope.graphArtifact,
    'S3ScenarioCohort.edgeFactorEvidence',
  );
  const configurationGroups = strictArray(value.configurationGroups, 'S3ScenarioCohort.configurationGroups', { min: 5, max: 5 }).map(admitS3ConfigurationGroup);
  if (!same(configurationGroups, S3_CONFIGURATION_GROUPS)) fail('S3ScenarioCohort must preserve all five configurations');
  const profiles = strictArray(value.profiles, 'S3ScenarioCohort.profiles', { min: 2, max: 2 }).map(admitS3SyntheticProfile);
  if (!same(profiles, S3_SYNTHETIC_PROFILES)) fail('S3ScenarioCohort must preserve both paired strata');
  const odPairs = strictArray(value.odPairs, 'S3ScenarioCohort.odPairs', { min: 1_000, max: 1_000 }).map((pair, index) => admitOdPair(pair, index, graphScope));
  const generatedOdPairs = buildS3ScenarioOdPairs(
    graphScope.graphArtifact,
    value.scenarioGeneratorVersion,
    value.seed,
  );
  if (!same(odPairs, generatedOdPairs)) {
    fail('S3ScenarioCohort OD/profile/strata sequence drifted from the deterministic generator');
  }
  const probes = strictArray(value.conformanceProbes, 'S3ScenarioCohort.conformanceProbes', { min: 4, max: 4 }).map(admitProbe);
  if (new Set(probes.map(({ probeId }) => probeId)).size !== 4) fail('S3ScenarioCohort conformance probe IDs must be unique');
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.cohort,
    cohortId: id(value.cohortId, 'S3ScenarioCohort.cohortId'),
    cohortKind: 'researcher-defined-synthetic-s3',
    scenarioGeneratorVersion: S3_SCENARIO_GENERATOR_VERSION,
    graphScope,
    edgeFactorEvidence,
    seed: S3_SCENARIO_SEED,
    counts: { ...S3_SCENARIO_COUNTS },
    configurationGroups,
    profiles,
    odPairs,
    conformanceProbes: probes,
  });
}

export function admitS3ScenarioProtocol(raw) {
  const value = exactObject(raw, 'S3ScenarioProtocol', [
    'schemaVersion', 'protocolId', 'definitionScope', 'historicalWrtRecovery',
    'evaluationUnit', 'cohort', 'eligibleClaimCodes',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.protocol, 'S3ScenarioProtocol.schemaVersion');
  if (value.definitionScope !== 'preregistered-synthetic-engineering'
    || value.historicalWrtRecovery !== 'not-claimed') fail('S3ScenarioProtocol scope/history is unsupported');
  if (value.evaluationUnit !== 'scenario-config-evaluation') fail('S3ScenarioProtocol evaluationUnit must not describe users, trips, or routes');
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.protocol,
    protocolId: id(value.protocolId, 'S3ScenarioProtocol.protocolId'),
    definitionScope: 'preregistered-synthetic-engineering',
    historicalWrtRecovery: 'not-claimed',
    evaluationUnit: 'scenario-config-evaluation',
    cohort: admitS3ScenarioCohort(value.cohort),
    eligibleClaimCodes: claimCodes(value.eligibleClaimCodes, 'S3ScenarioProtocol.eligibleClaimCodes'),
  });
}

function admitExecutionIdentity(raw) {
  const value = exactObject(raw, 'S3RunManifest.executionIdentity', [
    'productAdapterVersion', 'solverAlgorithmVersion', 'oracleAlgorithmVersion',
    'fixtureVersion', 'canonicalSerializationVersion',
  ]);
  const admitted = Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    version(item, `S3RunManifest.executionIdentity.${key}`),
  ]));
  if (admitted.oracleAlgorithmVersion !== S3_ORACLE_ALGORITHM_VERSION) {
    fail('S3RunManifest.executionIdentity.oracleAlgorithmVersion drifted from the frozen oracle spec');
  }
  return admitted;
}

function admitReferenceEnvironment(raw) {
  const value = exactObject(raw, 'S3RunManifest.referenceEnvironment', ['runtime', 'os', 'architecture', 'cpuClass', 'memoryBytes']);
  return {
    runtime: text(value.runtime, 'S3RunManifest.referenceEnvironment.runtime', { max: 120 }),
    os: text(value.os, 'S3RunManifest.referenceEnvironment.os', { max: 120 }),
    architecture: id(value.architecture, 'S3RunManifest.referenceEnvironment.architecture'),
    cpuClass: text(value.cpuClass, 'S3RunManifest.referenceEnvironment.cpuClass', { max: 120 }),
    memoryBytes: integer(value.memoryBytes, 'S3RunManifest.referenceEnvironment.memoryBytes', { min: 1 }),
  };
}

function admitPerformanceProtocol(raw) {
  return deepFreeze(admitExactLiteral(
    raw,
    S3_PERFORMANCE_PROTOCOL,
    'S3RunManifest.performanceProtocol',
  ));
}

function admitConfigurationExecution(raw, index, protocol) {
  const label = `S3RunManifest.configurationExecutions[${index}]`;
  const value = exactObject(raw, label, ['configurationId', 'policyArtifactVersion', 'decisionPolicy', 'searchRequestTemplate', 'capacityPolicy']);
  const group = protocol.cohort.configurationGroups[index];
  const admitted = {
    configurationId: value.configurationId,
    policyArtifactVersion: id(value.policyArtifactVersion, `${label}.policyArtifactVersion`),
    decisionPolicy: admitPolicy(value.decisionPolicy, `${label}.decisionPolicy`),
    searchRequestTemplate: admitSearchRequest(value.searchRequestTemplate, `${label}.searchRequestTemplate`),
    capacityPolicy: admitCapacityPolicy(value.capacityPolicy, `${label}.capacityPolicy`),
  };
  assertPolicySearchEquality(admitted.decisionPolicy, admitted.searchRequestTemplate, label);
  const expected = {
    configurationId: group.configurationId,
    policyArtifactVersion: group.policyArtifactVersion,
    decisionPolicy: group.decisionPolicy,
    searchRequestTemplate: group.searchRequestTemplate,
    capacityPolicy: group.capacityPolicy,
  };
  if (!same(admitted, expected)) fail(`${label} policy/search/capacity content drifted from protocol`);
  return admitted;
}

export function admitS3RunManifest(raw) {
  const value = exactObject(raw, 'S3RunManifest', [
    'schemaVersion', 'runId', 'protocol', 'protocolId', 'graphScope', 'seed',
    'configurationExecutions', 'executionIdentity', 'referenceEnvironment',
    'oracleExecutionSpec', 'performanceProtocol', 'expectedCounts',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.runManifest, 'S3RunManifest.schemaVersion');
  const protocol = admitS3ScenarioProtocol(value.protocol);
  if (value.protocolId !== protocol.protocolId) fail('S3RunManifest.protocolId drifted');
  const graphScope = admitGraphScope(value.graphScope);
  if (!same(graphScope, protocol.cohort.graphScope)) fail('S3RunManifest.graphScope drifted');
  if (value.seed !== protocol.cohort.seed) fail('S3RunManifest.seed drifted');
  const expectedCounts = exactObject(value.expectedCounts, 'S3RunManifest.expectedCounts', [
    'uniqueOdPairs', 'configurationGroups', 'scenarioConfigEvaluations', 'conformanceProbeEvaluations',
  ]);
  assertCounts(expectedCounts, 'S3RunManifest.expectedCounts');
  if (expectedCounts.conformanceProbeEvaluations !== protocol.cohort.conformanceProbes.length) fail('S3RunManifest conformance count drifted');
  const configurationExecutions = strictArray(value.configurationExecutions, 'S3RunManifest.configurationExecutions', { min: 5, max: 5 })
    .map((entry, index) => admitConfigurationExecution(entry, index, protocol));
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.runManifest,
    runId: id(value.runId, 'S3RunManifest.runId'),
    protocol,
    protocolId: protocol.protocolId,
    graphScope,
    seed: protocol.cohort.seed,
    configurationExecutions,
    executionIdentity: admitExecutionIdentity(value.executionIdentity),
    referenceEnvironment: admitReferenceEnvironment(value.referenceEnvironment),
    oracleExecutionSpec: deepFreeze(admitExactLiteral(
      value.oracleExecutionSpec,
      S3_ORACLE_EXECUTION_SPEC,
      'S3RunManifest.oracleExecutionSpec',
    )),
    performanceProtocol: admitPerformanceProtocol(value.performanceProtocol),
    expectedCounts: { ...S3_SCENARIO_COUNTS, conformanceProbeEvaluations: protocol.cohort.conformanceProbes.length },
  });
}

export {
  admitEvidenceIdentity,
  admitRecordGraphIdentity,
  evidenceIdentityOf,
  graphIdentityOf,
  graphIdentityOfArtifact,
};
