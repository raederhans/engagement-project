import assert from 'node:assert/strict';
import test from 'node:test';

import {
  M5_BALANCED_POLICY_V1,
  M5_M4_SOURCE_FINAL_COMMIT,
  M5_SCHEMA_VERSIONS,
  evaluateRouteAlternativesM5,
} from '../../src/route_alternatives_m5/index.js';

const PRODUCED_AT = '2026-08-29T00:00:00.000Z';
const VERIFIED_AT = '2026-08-29T00:01:00.000Z';
const AUTHORITY_SOURCE_COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function candidate(candidateId, edgeIds, durationMs) {
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

function accessibilityEntry(engineEdgeId, evidenceId = `access:${engineEdgeId}`) {
  return {
    engineEdgeId,
    state: 'observed',
    mode: 'walk',
    stepFree: true,
    curbRampPresent: true,
    pavedSurface: true,
    evidenceId,
    authorityId: 'authority:m5-1:test',
  };
}

function makeInput({
  candidates = [candidate('candidate:a', ['edge:a'], 1_000)],
  termination = 'candidate-set-ready',
  budgetState = 'within-budget',
  m4Entries,
  accessibilityEntries,
} = {}) {
  const edgeIds = [...new Set(candidates.flatMap((item) => item.edgeIds))];
  return {
    schemaVersion: M5_SCHEMA_VERSIONS.input,
    request: {
      requestId: 'request:m5:test',
      mode: 'walk',
    },
    engineResult: {
      schemaVersion: M5_SCHEMA_VERSIONS.engineResult,
      status: termination === 'search-budget-exhausted' ? 'stopped' : 'completed',
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
        profileKind: 'walking',
        mode: 'walk',
        executionEnvironment: 'local',
        engineMaturity: 'mature',
        networkTransport: 'none',
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
      entries: accessibilityEntries ?? edgeIds.map((edgeId) => accessibilityEntry(edgeId)),
    },
  };
}

function engineVerdict(overrides = {}) {
  return {
    schemaVersion: M5_SCHEMA_VERSIONS.authorityVerdict,
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
    networkTransport: 'none',
    travelDurationAuthority: 'admitted',
    accessibilityAuthority: 'admitted',
    producedAt: PRODUCED_AT,
    verifiedAt: VERIFIED_AT,
    ...overrides,
  };
}

function m4Verdict(overrides = {}) {
  return {
    schemaVersion: M5_SCHEMA_VERSIONS.m4HandoffVerdict,
    status: 'admitted',
    handoffSchema: 'engagement-known-route-evidence-handoff/v2',
    sourceFinalCommit: M5_M4_SOURCE_FINAL_COMMIT,
    handoffId: 'm4-handoff:test',
    artifactIdentity: 'sha256:m4-test-artifact',
    ...overrides,
  };
}

function trustedOptions({ engine = engineVerdict(), m4 = m4Verdict() } = {}) {
  return {
    verifyEngineAuthority: () => engine,
    verifyM4Handoff: () => m4,
  };
}

function clone(value) {
  return structuredClone(value);
}

function oraclePareto(candidates) {
  const dominates = (left, right) => (
    left.durationMs <= right.durationMs
    && left.exposure <= right.exposure
    && (left.durationMs < right.durationMs || left.exposure < right.exposure)
  );
  return candidates
    .filter((right) => !candidates.some((left) => (
      left.candidateId !== right.candidateId && dominates(left, right)
    )))
    .map(({ candidateId }) => candidateId)
    .sort();
}

function oracleBalancedRanking(candidates, policy) {
  const fastest = Math.min(...candidates.map(({ durationMs }) => durationMs));
  const eligible = candidates.filter(({ durationMs }) => (
    BigInt(durationMs) * 10_000n
      <= BigInt(fastest) * BigInt(policy.maxDurationOverFastestBasisPoints)
  ));
  const numerator = (item) => (
    BigInt(item.durationMs)
      * BigInt(policy.durationWeightBasisPoints)
      * BigInt(policy.exposureReferenceMicrounits)
    + BigInt(item.exposure)
      * BigInt(policy.exposureWeightBasisPoints)
      * BigInt(policy.durationReferenceMs)
  );
  return eligible.sort((left, right) => {
    const leftScore = numerator(left);
    const rightScore = numerator(right);
    if (leftScore < rightScore) return -1;
    if (leftScore > rightScore) return 1;
    if (left.durationMs !== right.durationMs) return left.durationMs - right.durationMs;
    if (left.exposure !== right.exposure) return left.exposure - right.exposure;
    return left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0;
  }).map(({ candidateId }) => candidateId);
}

test('M5 fails closed when an input merely self-declares engine or M4 authority', () => {
  const input = makeInput();
  const withoutVerifier = evaluateRouteAlternativesM5(input);
  assert.equal(withoutVerifier.status, 'unavailable');
  assert.equal(withoutVerifier.termination, 'engine-authority-unavailable');
  assert.equal(withoutVerifier.candidateSet, null);
  assert.equal(withoutVerifier.objectives.fastest.status, 'unavailable');

  const mismatched = evaluateRouteAlternativesM5(input, trustedOptions({
    engine: engineVerdict({ authorityId: 'authority:forged' }),
  }));
  assert.equal(mismatched.status, 'unavailable');
  assert.equal(mismatched.termination, 'engine-authority-unavailable');

  const engineOnly = evaluateRouteAlternativesM5(input, {
    verifyEngineAuthority: () => engineVerdict({ accessibilityAuthority: 'unavailable' }),
  });
  assert.equal(engineOnly.status, 'partial');
  assert.equal(engineOnly.objectives.fastest.status, 'available');
  assert.equal(engineOnly.objectives.accessible.status, 'unavailable');
  assert.equal(engineOnly.objectives.lowerModeledExposure.status, 'unavailable');
  assert.equal(
    engineOnly.dimensions.modeledExposure.reasonCode,
    'm4-handoff-authority-unavailable',
  );

  const serialized = JSON.stringify([withoutVerifier, mismatched]).toLowerCase();
  for (const prohibited of ['safest', 'safer', 'recommended', 'low risk']) {
    assert.equal(serialized.includes(prohibited), false);
  }
});

test('M5 requires the exact M4 source-final binding and a trusted handoff verifier', () => {
  const input = makeInput();
  input.m4Evidence.binding.sourceFinalCommit =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  input.m4Evidence.entries[0].sourceFinalCommit =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const result = evaluateRouteAlternativesM5(input, trustedOptions({
    m4: m4Verdict({
      sourceFinalCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    }),
  }));
  assert.equal(result.status, 'partial');
  assert.equal(result.objectives.fastest.status, 'available');
  assert.equal(result.objectives.lowerModeledExposure.status, 'unavailable');
  assert.equal(
    result.dimensions.modeledExposure.reasonCode,
    'm4-handoff-authority-unavailable',
  );
});

test('M5 rejects accessors without invoking them', () => {
  const input = makeInput();
  let invoked = false;
  Object.defineProperty(input.request, 'mode', {
    enumerable: true,
    get() {
      invoked = true;
      return 'walk';
    },
  });
  const result = evaluateRouteAlternativesM5(input, trustedOptions());
  assert.equal(invoked, false);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.termination, 'invalid-input');
});

test('M5 rejects conflicting metrics for one ordered route identity', () => {
  const input = makeInput({
    candidates: [
      candidate('candidate:a', ['edge:a'], 1_000),
      candidate('candidate:b', ['edge:a'], 1_001),
    ],
  });
  const result = evaluateRouteAlternativesM5(input, trustedOptions());
  assert.equal(result.status, 'unavailable');
  assert.equal(result.termination, 'candidate-set-invalid');
  assert.equal(result.objectives.fastest.status, 'unavailable');
});

test('M5 Pareto and stable candidate semantics match an independent oracle', () => {
  const candidates = [
    candidate('candidate:a', ['edge:a'], 1_000),
    candidate('candidate:z-copy', ['edge:a'], 1_000),
    candidate('candidate:b', ['edge:b'], 2_000),
    candidate('candidate:b2', ['edge:b2'], 2_000),
    candidate('candidate:different-evidence', ['edge:d'], 2_000),
    candidate('candidate:dominated', ['edge:c'], 2_500),
  ];
  const input = makeInput({
    candidates,
    m4Entries: [
      m4Entry('edge:a', 9_000_000),
      m4Entry('edge:b', 1_000_000, 'm4:shared-b'),
      m4Entry('edge:b2', 1_000_000, 'm4:shared-b'),
      m4Entry('edge:d', 1_000_000, 'm4:different'),
      m4Entry('edge:c', 5_000_000),
    ],
    accessibilityEntries: [
      accessibilityEntry('edge:a'),
      accessibilityEntry('edge:b', 'access:shared-b'),
      accessibilityEntry('edge:b2', 'access:shared-b'),
      accessibilityEntry('edge:d', 'access:different'),
      accessibilityEntry('edge:c'),
    ],
  });
  const result = evaluateRouteAlternativesM5(input, trustedOptions());
  assert.equal(result.status, 'available');
  assert.deepEqual(result.candidateSet.candidateIds, [
    'candidate:a',
    'candidate:b',
    'candidate:b2',
    'candidate:different-evidence',
    'candidate:dominated',
  ]);
  assert.deepEqual(result.candidateSet.duplicates, [{
    duplicateCandidateId: 'candidate:z-copy',
    canonicalCandidateId: 'candidate:a',
    reasonCode: 'same-ordered-directed-edge-sequence',
  }]);

  const oracleCandidates = [
    { candidateId: 'candidate:a', durationMs: 1_000, exposure: 9_000_000 },
    { candidateId: 'candidate:b', durationMs: 2_000, exposure: 1_000_000 },
    { candidateId: 'candidate:b2', durationMs: 2_000, exposure: 1_000_000 },
    { candidateId: 'candidate:different-evidence', durationMs: 2_000, exposure: 1_000_000 },
    { candidateId: 'candidate:dominated', durationMs: 2_500, exposure: 5_000_000 },
  ];
  assert.deepEqual(result.pareto.candidateIds, oraclePareto(oracleCandidates));
  assert.deepEqual(
    result.objectives.balanced.rankedCandidateIds,
    oracleBalancedRanking(clone(oracleCandidates), M5_BALANCED_POLICY_V1),
  );
  assert.deepEqual(result.candidateSet.metricEquivalenceGroups, [[
    'candidate:b', 'candidate:b2', 'candidate:different-evidence',
  ]]);
  assert.deepEqual(result.candidateSet.evidenceEquivalenceGroups, [[
    'candidate:b', 'candidate:b2',
  ]]);
});

test('M5 preserves fastest only when M4 crosswalk or accessibility evidence is unresolved', () => {
  for (const state of ['missing', 'partial', 'unavailable']) {
    const input = makeInput();
    input.m4Evidence.entries[0] = {
      engineEdgeId: 'edge:a',
      state,
      m4EdgeIds: [],
      modeledExposureMicrounits: null,
      evidenceId: null,
      sourceFinalCommit: M5_M4_SOURCE_FINAL_COMMIT,
    };
    const result = evaluateRouteAlternativesM5(input, trustedOptions());
    assert.equal(result.status, 'partial');
    assert.equal(result.objectives.fastest.status, 'available');
    assert.equal(result.objectives.lowerModeledExposure.status, 'unavailable');
    assert.equal(result.objectives.balanced.status, 'unavailable');
    assert.equal(result.pareto.status, 'unavailable');
  }

  const ambiguous = makeInput();
  ambiguous.m4Evidence.entries[0] = {
    engineEdgeId: 'edge:a',
    state: 'ambiguous',
    m4EdgeIds: ['m4-edge:a', 'm4-edge:b'],
    modeledExposureMicrounits: null,
    evidenceId: null,
    sourceFinalCommit: M5_M4_SOURCE_FINAL_COMMIT,
  };
  const ambiguousResult = evaluateRouteAlternativesM5(ambiguous, trustedOptions());
  assert.equal(ambiguousResult.dimensions.modeledExposure.reasonCode, 'm4-crosswalk-ambiguous');
  assert.equal(ambiguousResult.objectives.lowerModeledExposure.status, 'unavailable');

  for (const state of ['unknown', 'partial', 'unavailable']) {
    const input = makeInput();
    input.accessibilityEvidence.entries[0] = {
      engineEdgeId: 'edge:a',
      state,
      mode: null,
      stepFree: null,
      curbRampPresent: null,
      pavedSurface: null,
      evidenceId: null,
      authorityId: 'authority:m5-1:test',
    };
    const result = evaluateRouteAlternativesM5(input, trustedOptions());
    assert.equal(result.status, 'partial');
    assert.equal(result.objectives.fastest.status, 'available');
    assert.equal(result.objectives.accessible.status, 'unavailable');
  }
});

test('M5 reports disconnected and exhausted searches without naming an objective', () => {
  const disconnected = makeInput({ candidates: [], termination: 'disconnected' });
  const disconnectedResult = evaluateRouteAlternativesM5(disconnected, trustedOptions());
  assert.equal(disconnectedResult.status, 'unavailable');
  assert.equal(disconnectedResult.termination, 'disconnected');
  assert.deepEqual(disconnectedResult.candidateSet.candidateIds, []);
  assert.equal(disconnectedResult.objectives.fastest.status, 'unavailable');

  const exhausted = makeInput({
    candidates: [candidate('candidate:a', ['edge:a'], 1_000)],
    termination: 'search-budget-exhausted',
    budgetState: 'exhausted',
  });
  const exhaustedResult = evaluateRouteAlternativesM5(exhausted, trustedOptions());
  assert.equal(exhaustedResult.status, 'partial');
  assert.equal(exhaustedResult.termination, 'search-budget-exhausted');
  assert.equal(exhaustedResult.candidateSet.completeness, 'not-proven');
  assert.equal(exhaustedResult.objectives.fastest.status, 'unavailable');
  assert.equal(exhaustedResult.pareto.status, 'unavailable');
});

test('M5 never substitutes another cost for admitted travel duration', () => {
  const input = makeInput();
  input.engineResult.candidates[0].travelDuration = {
    state: 'partial',
    valueMs: null,
    unit: 'ms',
    authorityId: 'authority:m5-1:test',
    engineOutputId: 'engine-output:test',
    observedAt: PRODUCED_AT,
  };
  const result = evaluateRouteAlternativesM5(input, trustedOptions());
  assert.equal(result.status, 'unavailable');
  assert.equal(result.dimensions.travelDuration.status, 'unavailable');
  assert.equal(result.objectives.fastest.status, 'unavailable');
});

test('M5 sensitivity reports an independent-oracle ranking reversal', () => {
  const candidates = [
    candidate('candidate:fast', ['edge:fast'], 1_000),
    candidate('candidate:low-exposure', ['edge:low'], 2_000),
  ];
  const input = makeInput({
    candidates,
    m4Entries: [
      m4Entry('edge:fast', 9_000_000),
      m4Entry('edge:low', 1_000_000),
    ],
  });
  const result = evaluateRouteAlternativesM5(input, trustedOptions());
  const oracleCandidates = [
    { candidateId: 'candidate:fast', durationMs: 1_000, exposure: 9_000_000 },
    { candidateId: 'candidate:low-exposure', durationMs: 2_000, exposure: 1_000_000 },
  ];
  const baseline = oracleBalancedRanking(clone(oracleCandidates), M5_BALANCED_POLICY_V1);
  assert.deepEqual(result.objectives.balanced.rankedCandidateIds, baseline);
  const durationHeavyPolicy = M5_BALANCED_POLICY_V1.sensitivityScenarios.find(
    ({ scenarioId }) => scenarioId === 'duration-heavy',
  );
  const durationHeavy = result.sensitivity.scenarios.find(
    ({ scenarioId }) => scenarioId === 'duration-heavy',
  );
  assert.deepEqual(
    durationHeavy.rankedCandidateIds,
    oracleBalancedRanking(clone(oracleCandidates), durationHeavyPolicy),
  );
  assert.notEqual(durationHeavy.selectedCandidateId, baseline[0]);
  assert.equal(durationHeavy.rankingChangedFromBaseline, true);
});

test('an OSRM car profile cannot establish the M5 walking accessibility dimension', () => {
  const input = makeInput();
  const result = evaluateRouteAlternativesM5(input, trustedOptions({
    engine: engineVerdict({ profileKind: 'osrm-car', mode: 'car' }),
  }));
  assert.equal(result.status, 'unavailable');
  assert.equal(result.termination, 'engine-authority-unavailable');
  assert.equal(result.objectives.accessible.status, 'unavailable');
});
