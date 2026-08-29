import assert from 'node:assert/strict';
import test from 'node:test';

import {
  M5_BALANCED_POLICY_V1,
  M5_M4_SOURCE_FINAL_COMMIT,
  M5_SCHEMA_VERSIONS,
  evaluateRouteAlternativesM5,
  evaluateRouteAlternativesM5Core,
} from '../../src/route_alternatives_m5/index.js';

const PRODUCED_AT = '2026-08-29T00:00:00.000Z';
const AUTHORITY_SOURCE_COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function engineCandidate(candidateId, edgeIds, durationMs) {
  return {
    candidateId,
    edgeIds,
    travelDuration: {
      state: 'observed',
      valueMs: durationMs,
      unit: 'ms',
      authorityId: 'authority:m5-1:test',
      engineOutputId: 'engine-output:test',
      observedAt: PRODUCED_AT,
    },
  };
}

function m4Entry(engineEdgeId, exposure, evidenceId = `m4:${engineEdgeId}`) {
  return {
    engineEdgeId,
    state: 'eligible',
    m4EdgeIds: [`m4-edge:${engineEdgeId}`],
    modeledExposureMicrounits: exposure,
    evidenceId,
    sourceFinalCommit: M5_M4_SOURCE_FINAL_COMMIT,
  };
}

function accessibilityEntry(engineEdgeId) {
  return {
    engineEdgeId,
    state: 'observed',
    mode: 'walk',
    stepFree: true,
    curbRampPresent: true,
    pavedSurface: true,
    evidenceId: `access:${engineEdgeId}`,
    authorityId: 'authority:m5-1:test',
  };
}

function makeInput({
  candidates = [engineCandidate('candidate:a', ['edge:a'], 1_000)],
  termination = 'candidate-set-ready',
  budgetState = termination === 'search-budget-exhausted' ? 'exhausted' : 'within-budget',
  profileKind = 'walking',
  mode = 'walk',
  m4Entries,
  accessibilityEntries,
} = {}) {
  const edgeIds = [...new Set(candidates.flatMap((candidate) => candidate.edgeIds))];
  const status = termination === 'search-budget-exhausted'
    ? 'stopped'
    : termination === 'engine-unavailable' ? 'unavailable' : 'completed';
  return {
    schemaVersion: M5_SCHEMA_VERSIONS.input,
    request: { requestId: 'request:m5:test', mode: 'walk' },
    engineResult: {
      schemaVersion: M5_SCHEMA_VERSIONS.engineResult,
      status,
      termination,
      bindings: {
        requestId: 'request:m5:test',
        authorityId: 'authority:m5-1:test',
        authoritySourceCommit: AUTHORITY_SOURCE_COMMIT,
        engineName: 'local-test-engine',
        engineBuildId: 'engine-build:test',
        engineOutputId: 'engine-output:test',
        graphId: 'graph:test',
        graphReceiptId: 'graph-receipt:test',
        profileId: 'walking-profile:test',
        profileKind,
        mode,
        executionEnvironment: 'local',
        engineMaturity: 'mature',
        networkTransport: 'local-loopback-http',
        probeHost: '127.0.0.1',
        candidateGenerationAuthorized: false,
        privateRuntimeProductPromotion: false,
        producedAt: PRODUCED_AT,
      },
      budget: {
        state: budgetState,
        maxCandidates: 16,
        examinedCandidates: candidates.length,
      },
      candidates,
    },
    m4Evidence: {
      schemaVersion: M5_SCHEMA_VERSIONS.m4Evidence,
      binding: {
        handoffSchema: 'engagement-known-route-evidence-handoff/v2',
        sourceFinalCommit: M5_M4_SOURCE_FINAL_COMMIT,
        handoffId: 'm4-handoff:test',
        artifactIdentity: 'sha256:m4-test-artifact',
      },
      crosswalkVersion: 'engine-edge-to-m4-edge/v1',
      entries: m4Entries ?? edgeIds.map((edgeId, index) => (
        m4Entry(edgeId, (index + 1) * 1_000_000)
      )),
    },
    accessibilityEvidence: {
      schemaVersion: M5_SCHEMA_VERSIONS.accessibilityEvidence,
      entries: accessibilityEntries ?? edgeIds.map(accessibilityEntry),
    },
  };
}

function coreCandidate(
  candidateId,
  edgeIds,
  travelDurationMs,
  modeledExposureMicrounits,
  metricEvidenceIdentity = `evidence:${candidateId}`,
  accessibilityEvidenceState = 'unavailable',
) {
  return {
    candidateId,
    edgeIds,
    travelDurationMs,
    modeledExposureMicrounits,
    accessibilityEvidenceState,
    metricEvidenceIdentity,
  };
}

function coreInput(candidates, searchState = 'complete') {
  return {
    schemaVersion: M5_SCHEMA_VERSIONS.coreInput,
    searchState,
    candidates,
  };
}

function oraclePareto(candidates) {
  const dominates = (left, right) => (
    left.travelDurationMs <= right.travelDurationMs
    && left.modeledExposureMicrounits <= right.modeledExposureMicrounits
    && (left.travelDurationMs < right.travelDurationMs
      || left.modeledExposureMicrounits < right.modeledExposureMicrounits)
  );
  return candidates
    .filter((right) => !candidates.some((left) => (
      left.candidateId !== right.candidateId && dominates(left, right)
    )))
    .map(({ candidateId }) => candidateId)
    .sort();
}

function oracleBalancedRanking(candidates, policy) {
  const fastest = Math.min(...candidates.map(({ travelDurationMs }) => travelDurationMs));
  const score = (candidate) => (
    BigInt(candidate.travelDurationMs)
      * BigInt(policy.durationWeightBasisPoints)
      * BigInt(policy.exposureReferenceMicrounits)
    + BigInt(candidate.modeledExposureMicrounits)
      * BigInt(policy.exposureWeightBasisPoints)
      * BigInt(policy.durationReferenceMs)
  );
  return candidates
    .filter(({ travelDurationMs }) => (
      BigInt(travelDurationMs) * 10_000n
        <= BigInt(fastest) * BigInt(policy.maxDurationOverFastestBasisPoints)
    ))
    .sort((left, right) => {
      const leftScore = score(left);
      const rightScore = score(right);
      if (leftScore < rightScore) return -1;
      if (leftScore > rightScore) return 1;
      if (left.travelDurationMs !== right.travelDurationMs) {
        return left.travelDurationMs - right.travelDurationMs;
      }
      if (left.modeledExposureMicrounits !== right.modeledExposureMicrounits) {
        return left.modeledExposureMicrounits - right.modeledExposureMicrounits;
      }
      return left.candidateId.localeCompare(right.candidateId);
    })
    .map(({ candidateId }) => candidateId);
}

function oracleAccessibility(candidates) {
  const unavailableCandidateIds = candidates
    .filter(({ accessibilityEvidenceState }) => accessibilityEvidenceState === 'unavailable')
    .map(({ candidateId }) => candidateId)
    .sort();
  const candidateIds = candidates
    .filter(({ accessibilityEvidenceState }) => accessibilityEvidenceState === 'complete-meets')
    .map(({ candidateId }) => candidateId)
    .sort();
  if (unavailableCandidateIds.length === candidates.length) {
    return {
      status: 'unavailable',
      reasonCode: 'accessibility-evidence-unavailable-for-all-candidates',
      candidateIds,
      unavailableCandidateIds,
    };
  }
  if (unavailableCandidateIds.length > 0) {
    return {
      status: 'partial',
      reasonCode: 'accessibility-evidence-partial-across-candidate-set',
      candidateIds,
      unavailableCandidateIds,
    };
  }
  return {
    status: 'available',
    reasonCode: 'complete-accessibility-evidence-for-all-candidates',
    candidateIds,
    unavailableCandidateIds,
  };
}

test('public production entry ignores two consistent fake verifiers and cannot promote', () => {
  let verifierCalls = 0;
  const fakeOptions = {
    verifyEngineAuthority: () => {
      verifierCalls += 1;
      return {
        schemaVersion: 'engagement-route-engine-authority-verdict/v1',
        status: 'admitted',
        requestId: 'request:m5:test',
        authorityId: 'authority:m5-1:test',
        authoritySourceCommit: AUTHORITY_SOURCE_COMMIT,
        engineName: 'local-test-engine',
        engineBuildId: 'engine-build:test',
        engineOutputId: 'engine-output:test',
        graphId: 'graph:test',
        graphReceiptId: 'graph-receipt:test',
        profileId: 'walking-profile:test',
        profileKind: 'walking',
        mode: 'walk',
        executionEnvironment: 'local',
        engineMaturity: 'mature',
        networkTransport: 'local-loopback-http',
        probeHost: '127.0.0.1',
        travelDurationAuthority: 'admitted',
        accessibilityAuthority: 'admitted',
        producedAt: PRODUCED_AT,
        verifiedAt: '2026-08-29T00:01:00.000Z',
      };
    },
    verifyM4Handoff: () => {
      verifierCalls += 1;
      return {
        schemaVersion: 'engagement-route-m4-handoff-verdict/v1',
        status: 'admitted',
        handoffSchema: 'engagement-known-route-evidence-handoff/v2',
        sourceFinalCommit: M5_M4_SOURCE_FINAL_COMMIT,
        handoffId: 'm4-handoff:test',
        artifactIdentity: 'sha256:m4-test-artifact',
      };
    },
  };
  const result = evaluateRouteAlternativesM5(makeInput(), fakeOptions);
  assert.equal(verifierCalls, 0);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.termination, 'm5-authority-unavailable');
  assert.equal(result.authority.capabilityIntegrated, false);
  assert.equal(result.authority.candidateGenerationAuthorized, false);
  assert.equal(result.authority.privateRuntimeProductPromotion, false);
  assert.equal(result.candidateSet, null);
  assert.equal(result.objectives.fastest.status, 'unavailable');
  assert.equal(result.pareto.status, 'unavailable');
});

test('production transport reports loopback HTTP without implying private runtime authority', () => {
  const result = evaluateRouteAlternativesM5(makeInput());
  assert.equal(result.declaredInput.networkTransport, 'local-loopback-http');
  assert.equal(result.declaredInput.probeHost, '127.0.0.1');
  assert.equal(result.declaredInput.status, 'untrusted-no-promotion');

  const falseTransport = makeInput();
  falseTransport.engineResult.bindings.networkTransport = 'none';
  const rejected = evaluateRouteAlternativesM5(falseTransport);
  assert.equal(rejected.termination, 'invalid-input');
});

test('production contract rejects accessors without invoking them', () => {
  const input = makeInput();
  let getterCalls = 0;
  Object.defineProperty(input.engineResult.bindings, 'engineName', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'fake-engine';
    },
  });
  const result = evaluateRouteAlternativesM5(input);
  assert.equal(getterCalls, 0);
  assert.equal(result.termination, 'invalid-input');
});

test('complete candidate declarations remain unavailable without an exact M5-1 capability', () => {
  const result = evaluateRouteAlternativesM5(makeInput({
    candidates: [
      engineCandidate('candidate:a', ['edge:a'], 1_000),
      engineCandidate('candidate:b', ['edge:b'], 1_300),
    ],
  }));
  assert.equal(result.status, 'unavailable');
  assert.equal(result.declaredInput.engineTermination, 'candidate-set-ready');
  for (const objective of Object.values(result.objectives)) {
    assert.equal(objective.status, 'unavailable');
    assert.equal(objective.selectedCandidateId, null);
  }
});

test('missing, partial, unavailable, and one-to-many M4 declarations never become zero exposure', () => {
  const variants = [
    { state: 'missing', m4EdgeIds: [] },
    { state: 'partial', m4EdgeIds: [] },
    { state: 'unavailable', m4EdgeIds: [] },
    { state: 'ambiguous', m4EdgeIds: ['m4-edge:a', 'm4-edge:b'] },
  ];
  for (const variant of variants) {
    const entry = {
      engineEdgeId: 'edge:a',
      state: variant.state,
      m4EdgeIds: variant.m4EdgeIds,
      modeledExposureMicrounits: null,
      evidenceId: null,
      sourceFinalCommit: M5_M4_SOURCE_FINAL_COMMIT,
    };
    const result = evaluateRouteAlternativesM5(makeInput({ m4Entries: [entry] }));
    assert.equal(result.status, 'unavailable');
    assert.equal(result.objectives.lowerModeledExposure.status, 'unavailable');
  }
});

test('budget exhaustion and disconnection preserve terminal facts but never promote', () => {
  const exhausted = evaluateRouteAlternativesM5(makeInput({
    termination: 'search-budget-exhausted',
  }));
  assert.equal(exhausted.status, 'unavailable');
  assert.equal(exhausted.declaredInput.engineTermination, 'search-budget-exhausted');
  assert.equal(exhausted.declaredInput.budgetState, 'exhausted');

  const disconnected = evaluateRouteAlternativesM5(makeInput({
    candidates: [],
    termination: 'disconnected',
  }));
  assert.equal(disconnected.status, 'unavailable');
  assert.equal(disconnected.declaredInput.engineTermination, 'disconnected');
  assert.equal(disconnected.pareto.status, 'unavailable');
});

test('an OSRM car profile declaration cannot establish walking accessibility', () => {
  const result = evaluateRouteAlternativesM5(makeInput({
    profileKind: 'osrm-car',
    mode: 'car',
  }));
  assert.equal(result.status, 'unavailable');
  assert.equal(result.objectives.accessible.status, 'unavailable');
});

test('pure core matches an independent Pareto oracle and separates metric from evidence equivalence', () => {
  const candidates = [
    coreCandidate('candidate:z', ['edge:a'], 1_000, 3_000_000, 'evidence:shared'),
    coreCandidate('candidate:a', ['edge:a'], 1_000, 3_000_000, 'evidence:shared'),
    coreCandidate('candidate:d', ['edge:d'], 1_000, 3_000_000, 'evidence:different'),
    coreCandidate('candidate:e', ['edge:e'], 1_000, 3_000_000, 'evidence:shared'),
    coreCandidate('candidate:b', ['edge:b'], 1_500, 1_000_000, 'evidence:b', 'complete-meets'),
    coreCandidate('candidate:c', ['edge:c'], 1_700, 4_000_000),
  ];
  const result = evaluateRouteAlternativesM5Core(coreInput(candidates));
  const oracleCandidates = candidates.filter(({ candidateId }) => candidateId !== 'candidate:z');
  assert.equal(result.authority, 'none');
  assert.equal(result.productPromotionAuthorized, false);
  assert.deepEqual(result.pareto.candidateIds, oraclePareto(oracleCandidates));
  assert.deepEqual(result.candidateSet.candidateIds, [
    'candidate:a', 'candidate:b', 'candidate:c', 'candidate:d', 'candidate:e',
  ]);
  assert.deepEqual(result.candidateSet.metricEquivalenceGroups, [[
    'candidate:a', 'candidate:d', 'candidate:e',
  ]]);
  assert.deepEqual(result.candidateSet.evidenceEquivalenceGroups, [[
    'candidate:a', 'candidate:e',
  ]]);
  assert.deepEqual(result.accessibility, oracleAccessibility(oracleCandidates));
});

test('pure core mechanically distinguishes unavailable from complete-does-not-meet', () => {
  const unavailableCandidate = coreCandidate(
    'candidate:a', ['edge:a'], 1_000, 1_000_000, 'evidence:a', 'unavailable',
  );
  const doesNotMeetCandidate = coreCandidate(
    'candidate:a', ['edge:a'], 1_000, 1_000_000, 'evidence:a', 'complete-does-not-meet',
  );
  const unavailable = evaluateRouteAlternativesM5Core(coreInput([unavailableCandidate]));
  const doesNotMeet = evaluateRouteAlternativesM5Core(coreInput([doesNotMeetCandidate]));

  assert.deepEqual(unavailable.accessibility, oracleAccessibility([unavailableCandidate]));
  assert.deepEqual(doesNotMeet.accessibility, oracleAccessibility([doesNotMeetCandidate]));
  assert.notEqual(JSON.stringify(unavailable), JSON.stringify(doesNotMeet));
  assert.deepEqual(unavailable.accessibility.unavailableCandidateIds, ['candidate:a']);
  assert.deepEqual(doesNotMeet.accessibility.unavailableCandidateIds, []);

  const allCompleteCandidates = [
    coreCandidate(
      'candidate:meets', ['edge:meets'], 1_000, 1_000_000,
      'evidence:meets', 'complete-meets',
    ),
    coreCandidate(
      'candidate:no', ['edge:no'], 1_100, 900_000,
      'evidence:no', 'complete-does-not-meet',
    ),
  ];
  const allComplete = evaluateRouteAlternativesM5Core(coreInput(allCompleteCandidates));
  assert.deepEqual(allComplete.accessibility, oracleAccessibility(allCompleteCandidates));
  assert.deepEqual(allComplete.accessibility.candidateIds, ['candidate:meets']);
});

test('pure core keeps mixed accessibility evidence partial without changing Pareto or balance', () => {
  const candidates = [
    coreCandidate(
      'candidate:meets', ['edge:meets'], 1_000, 2_000_000,
      'evidence:meets', 'complete-meets',
    ),
    coreCandidate(
      'candidate:unknown', ['edge:unknown'], 1_200, 1_000_000,
      'evidence:unknown', 'unavailable',
    ),
    coreCandidate(
      'candidate:no', ['edge:no'], 1_400, 3_000_000,
      'evidence:no', 'complete-does-not-meet',
    ),
  ];
  const result = evaluateRouteAlternativesM5Core(coreInput(candidates));

  assert.deepEqual(result.accessibility, oracleAccessibility(candidates));
  assert.deepEqual(result.pareto.candidateIds, oraclePareto(candidates));
  assert.deepEqual(
    result.balanced.rankedCandidateIds,
    oracleBalancedRanking(structuredClone(candidates), M5_BALANCED_POLICY_V1),
  );
  assert.deepEqual(result.accessibility.candidateIds, ['candidate:meets']);
  assert.deepEqual(result.accessibility.unavailableCandidateIds, ['candidate:unknown']);
});

test('pure core fails closed on conflicting evidence for the same route', () => {
  const result = evaluateRouteAlternativesM5Core(coreInput([
    coreCandidate('candidate:a', ['edge:a'], 1_000, 1_000_000, 'evidence:a'),
    coreCandidate('candidate:b', ['edge:a'], 1_000, 1_000_000, 'evidence:b'),
  ]));
  assert.equal(result.status, 'unavailable');
  assert.equal(result.termination, 'candidate-set-invalid');
  assert.equal(result.reasonCode, 'duplicate-route-evidence-conflict');
});

test('pure core exposes budget exhaustion and disconnection without rankings', () => {
  for (const searchState of ['budget-exhausted', 'disconnected']) {
    const result = evaluateRouteAlternativesM5Core(coreInput([], searchState));
    assert.equal(result.status, 'unavailable');
    assert.equal(result.termination, searchState);
    assert.deepEqual(result.balanced.rankedCandidateIds, []);
    assert.deepEqual(result.pareto.candidateIds, []);
    assert.deepEqual(result.accessibility, {
      status: 'unavailable',
      reasonCode: result.reasonCode,
      candidateIds: [],
      unavailableCandidateIds: [],
    });
  }
});

test('pure core rejects non-empty terminal candidate sets as input contradictions', () => {
  for (const searchState of ['budget-exhausted', 'disconnected']) {
    const result = evaluateRouteAlternativesM5Core(coreInput([
      coreCandidate('candidate:a', ['edge:a'], 1_000, 1_000_000),
    ], searchState));
    assert.equal(result.status, 'unavailable');
    assert.equal(result.termination, 'invalid-input');
    assert.equal(result.reasonCode, 'input-contract-invalid');
  }
});

test('pure core terminal contradictions remain fail-closed for accessors and duplicate IDs', () => {
  let getterCalls = 0;
  const accessorCandidate = coreCandidate('candidate:a', ['edge:a'], 1_000, 1_000_000);
  Object.defineProperty(accessorCandidate, 'travelDurationMs', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 1_000;
    },
  });
  const accessorResult = evaluateRouteAlternativesM5Core(coreInput(
    [accessorCandidate],
    'disconnected',
  ));
  assert.equal(getterCalls, 0);
  assert.equal(accessorResult.termination, 'invalid-input');

  const duplicateResult = evaluateRouteAlternativesM5Core(coreInput([
    coreCandidate('candidate:a', ['edge:a'], 1_000, 1_000_000),
    coreCandidate('candidate:a', ['edge:b'], 1_100, 900_000),
  ], 'budget-exhausted'));
  assert.equal(duplicateResult.termination, 'invalid-input');
  assert.equal(duplicateResult.reasonCode, 'input-contract-invalid');
});

test('pure core sensitivity matches an independent oracle and captures a ranking reversal', () => {
  const candidates = [
    coreCandidate('candidate:fast', ['edge:fast'], 1_000, 8_000_000),
    coreCandidate('candidate:cleaner', ['edge:cleaner'], 1_800, 1_000_000),
  ];
  const result = evaluateRouteAlternativesM5Core(coreInput(candidates));
  assert.deepEqual(
    result.balanced.rankedCandidateIds,
    oracleBalancedRanking(structuredClone(candidates), M5_BALANCED_POLICY_V1),
  );
  const durationHeavyPolicy = M5_BALANCED_POLICY_V1.sensitivityScenarios.find(
    ({ scenarioId }) => scenarioId === 'duration-heavy',
  );
  const durationHeavy = result.sensitivity.scenarios.find(
    ({ scenarioId }) => scenarioId === 'duration-heavy',
  );
  assert.deepEqual(
    durationHeavy.rankedCandidateIds,
    oracleBalancedRanking(structuredClone(candidates), durationHeavyPolicy),
  );
  assert.equal(result.balanced.rankedCandidateIds[0], 'candidate:cleaner');
  assert.equal(durationHeavy.rankedCandidateIds[0], 'candidate:fast');
  assert.equal(durationHeavy.rankingChangedFromBaseline, true);
});

test('neither public nor pure-core results emit prohibited product claims', () => {
  const results = [
    evaluateRouteAlternativesM5(makeInput()),
    evaluateRouteAlternativesM5Core(coreInput([
      coreCandidate('candidate:a', ['edge:a'], 1_000, 1_000_000),
    ])),
  ];
  for (const result of results) {
    assert.doesNotMatch(JSON.stringify(result).toLowerCase(), /safest|safer|recommended|low risk/);
  }
});
