import {
  ROUTE_DECISION_SCHEMA_VERSIONS,
  admitCandidateSet,
  admitDecisionPolicy,
  admitDecisionResult,
  admitRouteCandidateFacts,
} from '../contracts/index.js';

import { evaluate as evaluatePrivate } from './evaluate.js';

const PRIVATE_POLICY_SCHEMA_VERSION = 'route-evaluator-policy-ir/v1';
const PRIVATE_CANDIDATE_SCHEMA_VERSION = 'route-evaluator-candidate-ir/v1';

const PRIVATE_TIE_BREAK_FIELD_BY_PUBLIC = Object.freeze({
  'score-units': 'scoreUnits',
  'objective-cost-units': 'objectiveCostUnits',
  'distance-mm': 'distanceMm',
  'candidate-id': 'candidateId',
});
const PUBLIC_TIE_BREAK_FACTOR_BY_PRIVATE = Object.freeze({
  scoreUnits: 'score-units',
  objectiveCostUnits: 'objective-cost-units',
  distanceMm: 'distance-mm',
  candidateId: 'candidate-id',
});
const PRIVATE_DIRECTION_BY_PUBLIC = Object.freeze({
  ascending: 'asc',
  descending: 'desc',
});
const PUBLIC_DIRECTION_BY_PRIVATE = Object.freeze({
  asc: 'ascending',
  desc: 'descending',
});
const PUBLIC_SOFT_UNIT_BY_FACTOR = Object.freeze({
  'distance-mm': 'millimetres',
  'objective-cost-units': 'cost-units',
});
const PUBLIC_UNRESOLVED_STATES = new Set([
  'unknown',
  'unavailable',
  'partial',
  'stale',
  'invalid',
  'missing',
]);

function privateConstraintRuleId(constraintId) {
  return `hard:${constraintId}`;
}

function privatePreferenceRuleId(preferenceId) {
  return `soft:${preferenceId}`;
}

function fail(message) {
  throw new TypeError(`route decision evaluator adapter: ${message}`);
}

function inspectExactDataObject(value, requiredKeys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be a plain object`);
  }
  let prototype;
  let ownKeys;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    ownKeys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(`${label} cannot be inspected safely`);
  }
  if (prototype !== Object.prototype || ownKeys.some((key) => typeof key === 'symbol')) {
    fail(`${label} must be a plain string-keyed object`);
  }
  if (ownKeys.length !== requiredKeys.length
    || requiredKeys.some((key) => !Object.hasOwn(descriptors, key))
    || ownKeys.some((key) => !requiredKeys.includes(key))) {
    fail(`${label} schema mismatch`);
  }
  for (const key of ownKeys) {
    if (!Object.hasOwn(descriptors[key], 'value')) {
      fail(`${label} must contain data properties only`);
    }
  }
  return Object.fromEntries(requiredKeys.map((key) => [key, descriptors[key].value]));
}

function inspectDataArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  let prototype;
  let ownKeys;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    ownKeys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(`${label} cannot be inspected safely`);
  }
  if (prototype !== Array.prototype || ownKeys.some((key) => typeof key === 'symbol')) {
    fail(`${label} must be a standard array`);
  }
  const items = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      fail(`${label} must contain data properties only`);
    }
    items.push(descriptor.value);
  }
  const extraKeys = ownKeys.filter((key) => key !== 'length'
    && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length));
  if (extraKeys.length) fail(`${label} contains unsupported properties`);
  return items;
}

function admitPublicEvaluationInput(input) {
  const envelope = inspectExactDataObject(
    input,
    ['policy', 'candidateSet', 'candidates'],
    'evaluation input',
  );
  const rawCandidates = inspectDataArray(envelope.candidates, 'evaluation input.candidates');

  const policy = admitDecisionPolicy(envelope.policy);
  const candidateSet = admitCandidateSet(envelope.candidateSet);
  if (rawCandidates.length !== candidateSet.candidateCount) {
    fail('candidateSet.candidateCount must equal candidates length');
  }
  const candidates = rawCandidates.map((candidate) => admitRouteCandidateFacts(candidate));
  const candidateIds = candidates.map(({ candidateId }) => candidateId);
  if (candidateIds.some((candidateId, index) => candidateSet.candidateIds[index] !== candidateId)) {
    fail('candidateSet.candidateIds must exactly match candidates in order');
  }
  if (candidates.some(({ provenance }) => provenance.graphId !== candidateSet.graphId)) {
    fail('candidate graphId must match candidateSet.graphId');
  }
  return Object.freeze({ policy, candidateSet, candidates: Object.freeze(candidates) });
}

function compilePrivateObservation(observation) {
  if (observation.state === 'observed') {
    return Object.freeze({ state: 'known', value: observation.value ? 1 : 0 });
  }
  if (!PUBLIC_UNRESOLVED_STATES.has(observation.state)) {
    fail(`cannot compile hard observation state ${observation.state}`);
  }
  return Object.freeze({ state: observation.state });
}

function compilePrivatePolicy(policy) {
  return Object.freeze({
    schemaVersion: PRIVATE_POLICY_SCHEMA_VERSION,
    policyId: policy.policyId,
    hardConstraints: Object.freeze(policy.hardConstraints.map((constraint) => Object.freeze({
      id: privateConstraintRuleId(constraint.constraintId),
      factorId: constraint.factorId,
      operator: 'eq',
      value: constraint.expectedValue ? 1 : 0,
    }))),
    softPreferences: Object.freeze(policy.softPreferences.map((preference) => Object.freeze({
      id: privatePreferenceRuleId(preference.preferenceId),
      factorId: preference.factorId,
      direction: 'minimize',
      rangeMin: preference.rangeMin,
      rangeMax: preference.rangeMax,
      weightBasisPoints: preference.weightBasisPoints,
    }))),
    weightBasisPointsTotal: policy.weightBasisPointsTotal,
    tieBreak: Object.freeze(policy.tieBreak.map((entry) => Object.freeze({
      field: PRIVATE_TIE_BREAK_FIELD_BY_PUBLIC[entry.factorId],
      direction: PRIVATE_DIRECTION_BY_PUBLIC[entry.direction],
    }))),
  });
}

function compilePrivateCandidate(candidate, policy) {
  const observations = {};
  for (const constraint of policy.hardConstraints) {
    if (Object.hasOwn(candidate.observations, constraint.factorId)) {
      observations[constraint.factorId] = compilePrivateObservation(
        candidate.observations[constraint.factorId],
      );
    }
  }
  for (const preference of policy.softPreferences) {
    const rawValue = preference.factorId === 'distance-mm'
      ? candidate.distanceMm
      : preference.factorId === 'objective-cost-units'
        ? candidate.objectiveCostUnits
        : fail(`cannot compile soft factor ${preference.factorId}`);
    observations[preference.factorId] = Object.freeze({ state: 'known', value: rawValue });
  }
  return Object.freeze({
    schemaVersion: PRIVATE_CANDIDATE_SCHEMA_VERSION,
    candidateId: candidate.candidateId,
    edgeIds: Object.freeze([...candidate.edgeIds]),
    distanceMm: candidate.distanceMm,
    objectiveCostUnits: candidate.objectiveCostUnits,
    observations: Object.freeze(observations),
    provenance: Object.freeze({}),
  });
}

function publicUnresolvedState(privateState, label) {
  if (!PUBLIC_UNRESOLVED_STATES.has(privateState)) {
    fail(`${label} contains unmappable observation state ${privateState}`);
  }
  return privateState;
}

function mapHardTrace(entry, constraint) {
  if (!constraint || constraint.factorId !== entry.factorId || entry.operator !== 'eq') {
    fail(`private hard trace does not match public constraint ${entry.ruleId}`);
  }
  if (entry.expectedValue !== (constraint.expectedValue ? 1 : 0)) {
    fail(`private hard trace changed expectedValue for ${entry.ruleId}`);
  }
  if (entry.outcome === 'unresolved') {
    const observationState = publicUnresolvedState(
      entry.observationState,
      `hard constraint ${constraint.constraintId}`,
    );
    return Object.freeze({
      candidateId: entry.candidateId,
      stage: 'hard-constraint',
      constraintId: constraint.constraintId,
      factorId: constraint.factorId,
      observationState,
      actualValue: null,
      operator: 'equals',
      expectedValue: constraint.expectedValue,
      outcome: 'unresolved',
      reasonCode: `hard-constraint-${observationState}-unresolved`,
    });
  }
  if (!['pass', 'fail'].includes(entry.outcome) || ![0, 1].includes(entry.actualValue)) {
    fail(`private hard trace outcome is unmappable for ${constraint.constraintId}`);
  }
  const outcome = entry.outcome === 'pass' ? 'pass' : 'reject';
  return Object.freeze({
    candidateId: entry.candidateId,
    stage: 'hard-constraint',
    constraintId: constraint.constraintId,
    factorId: constraint.factorId,
    observationState: 'observed',
    actualValue: entry.actualValue === 1,
    operator: 'equals',
    expectedValue: constraint.expectedValue,
    outcome,
    reasonCode: outcome === 'pass' ? 'hard-constraint-passed' : 'hard-constraint-failed',
  });
}

function publicSoftRawValue(candidate, factorId) {
  if (factorId === 'distance-mm') return candidate.distanceMm;
  if (factorId === 'objective-cost-units') return candidate.objectiveCostUnits;
  fail(`cannot read public soft factor ${factorId}`);
}

function mapSoftTrace(entry, preference, candidate) {
  if (!preference
    || preference.factorId !== entry.factorId
    || entry.direction !== 'minimize'
    || entry.rangeMin !== preference.rangeMin
    || entry.rangeMax !== preference.rangeMax
    || entry.weightBasisPoints !== preference.weightBasisPoints) {
    fail(`private soft trace does not match public preference ${entry.ruleId}`);
  }
  const base = {
    candidateId: entry.candidateId,
    stage: 'soft-preference',
    preferenceId: preference.preferenceId,
    factorId: preference.factorId,
    unit: PUBLIC_SOFT_UNIT_BY_FACTOR[preference.factorId],
    direction: 'minimize',
    rangeMin: preference.rangeMin,
    rangeMax: preference.rangeMax,
    rangeSpan: preference.rangeMax - preference.rangeMin,
    weightBasisPoints: preference.weightBasisPoints,
  };
  if (entry.outcome === 'unresolved') {
    const observationState = publicUnresolvedState(
      entry.observationState,
      `soft preference ${preference.preferenceId}`,
    );
    return Object.freeze({
      ...base,
      observationState,
      rawValue: null,
      utilityNumerator: null,
      utilityBasisPoints: null,
      weightedScoreUnits: null,
      outcome: 'unresolved',
      reasonCode: `soft-preference-${observationState}-unresolved`,
    });
  }
  const rawValue = publicSoftRawValue(candidate, preference.factorId);
  if (entry.outcome !== 'scored' || entry.actualValue !== rawValue) {
    fail(`private soft trace changed rawValue for ${preference.preferenceId}`);
  }
  return Object.freeze({
    ...base,
    observationState: rawValue === 0 ? 'zero' : 'observed',
    rawValue,
    utilityNumerator: entry.utilityNumerator,
    utilityBasisPoints: entry.utilityBasisPoints,
    weightedScoreUnits: entry.weightedScoreUnits,
    outcome: 'scored',
    reasonCode: 'soft-preference-scored',
  });
}

function candidateRuleTrace(publicTrace, candidateId) {
  return publicTrace.filter((item) => item.candidateId === candidateId
    && ['hard-constraint', 'soft-preference'].includes(item.stage));
}

function mapDispositionTrace(entry, publicTrace) {
  const ruleTrace = candidateRuleTrace(publicTrace, entry.candidateId);
  const rejectedConstraints = ruleTrace.filter(
    (item) => item.stage === 'hard-constraint' && item.outcome === 'reject',
  );
  const unresolvedConstraints = ruleTrace.filter(
    (item) => item.stage === 'hard-constraint' && item.outcome === 'unresolved',
  );
  const unresolvedPreferences = ruleTrace.filter(
    (item) => item.stage === 'soft-preference' && item.outcome === 'unresolved',
  );

  if (entry.outcome === 'admitted') {
    return Object.freeze({
      candidateId: entry.candidateId,
      stage: 'candidate-disposition',
      outcome: 'admitted',
      constraintIds: Object.freeze([]),
      preferenceIds: Object.freeze([]),
      totalScoreUnits: entry.scoreUnits,
      reasonCode: 'candidate-admitted',
    });
  }
  if (entry.outcome === 'rejected' && rejectedConstraints.length > 0) {
    return Object.freeze({
      candidateId: entry.candidateId,
      stage: 'candidate-disposition',
      outcome: 'rejected',
      constraintIds: Object.freeze(rejectedConstraints.map(({ constraintId }) => constraintId)),
      preferenceIds: Object.freeze([]),
      totalScoreUnits: null,
      reasonCode: 'candidate-hard-constraint-rejected',
    });
  }
  if (entry.outcome === 'unresolved'
    && ((unresolvedConstraints.length > 0) !== (unresolvedPreferences.length > 0))) {
    const hardUnresolved = unresolvedConstraints.length > 0;
    return Object.freeze({
      candidateId: entry.candidateId,
      stage: 'candidate-disposition',
      outcome: 'unresolved',
      constraintIds: Object.freeze(
        unresolvedConstraints.map(({ constraintId }) => constraintId),
      ),
      preferenceIds: Object.freeze(
        unresolvedPreferences.map(({ preferenceId }) => preferenceId),
      ),
      totalScoreUnits: null,
      reasonCode: hardUnresolved
        ? 'candidate-hard-constraint-unresolved'
        : 'candidate-soft-preference-unresolved',
    });
  }
  fail(`private disposition is inconsistent for ${entry.candidateId}`);
}

function mapTieBreakValues(entries, policy, candidateId) {
  const values = entries.map((entry) => {
    const factorId = PUBLIC_TIE_BREAK_FACTOR_BY_PRIVATE[entry.field];
    const direction = PUBLIC_DIRECTION_BY_PRIVATE[entry.direction];
    if (!factorId || !direction) fail('private ranking trace contains an unsupported tie-break');
    return Object.freeze({ factorId, direction, value: entry.value });
  });
  if (values.length !== policy.tieBreak.length
    || values.some((entry, index) => entry.factorId !== policy.tieBreak[index].factorId
      || entry.direction !== policy.tieBreak[index].direction)
    || values.at(-1)?.value !== candidateId) {
    fail(`private ranking trace changed the public tie-break for ${candidateId}`);
  }
  return Object.freeze(values);
}

function mapRankingTrace(entry, policy) {
  return Object.freeze({
    candidateId: entry.candidateId,
    stage: 'ranking',
    outcome: 'ranked',
    totalScoreUnits: entry.scoreUnits,
    rank: entry.rank,
    tieBreakValues: mapTieBreakValues(entry.tieBreakValues, policy, entry.candidateId),
    decidingFactorId: null,
    reasonCode: 'candidate-ranked',
  });
}

function mapPrivateResult(privateResult, admittedInput) {
  if (!['ranked', 'no_admitted_candidate'].includes(privateResult.status)) {
    fail(`private evaluator failed closed with ${privateResult.status}`);
  }
  const constraintsById = new Map(
    admittedInput.policy.hardConstraints.map((constraint) => [
      privateConstraintRuleId(constraint.constraintId),
      constraint,
    ]),
  );
  const preferencesById = new Map(
    admittedInput.policy.softPreferences.map((preference) => [
      privatePreferenceRuleId(preference.preferenceId),
      preference,
    ]),
  );
  const candidatesById = new Map(
    admittedInput.candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const publicTrace = [];
  for (const entry of privateResult.trace) {
    if (entry.phase === 'hard_constraint') {
      publicTrace.push(mapHardTrace(entry, constraintsById.get(entry.ruleId)));
    } else if (entry.phase === 'soft_preference') {
      publicTrace.push(mapSoftTrace(
        entry,
        preferencesById.get(entry.ruleId),
        candidatesById.get(entry.candidateId),
      ));
    } else if (entry.phase === 'candidate_disposition') {
      publicTrace.push(mapDispositionTrace(entry, publicTrace));
    } else if (entry.phase === 'ranking') {
      publicTrace.push(mapRankingTrace(entry, admittedInput.policy));
    } else {
      fail(`private trace contains unsupported phase ${entry.phase}`);
    }
  }

  const dispositions = publicTrace.filter((item) => item.stage === 'candidate-disposition');
  const rejectedCandidateIds = new Set(
    dispositions.filter(({ outcome }) => outcome === 'rejected').map(({ candidateId }) => candidateId),
  );
  const unresolvedCandidateIds = new Set(
    dispositions.filter(({ outcome }) => outcome === 'unresolved').map(({ candidateId }) => candidateId),
  );
  const rejected = publicTrace.filter((item) => item.stage === 'hard-constraint'
    && item.outcome === 'reject' && rejectedCandidateIds.has(item.candidateId));
  const unresolved = publicTrace.filter((item) => ['hard-constraint', 'soft-preference'].includes(item.stage)
    && item.outcome === 'unresolved' && unresolvedCandidateIds.has(item.candidateId));
  const status = privateResult.admittedCandidateIds.length > 0
    ? 'ranked-in-provided-set'
    : unresolvedCandidateIds.size > 0
      ? 'candidate-search-incomplete'
      : rejectedCandidateIds.size > 0
        ? 'no-eligible-candidate-in-provided-set'
        : 'candidate-search-incomplete';

  return {
    status,
    admittedCandidateIds: [...privateResult.admittedCandidateIds],
    rankedCandidateIds: [...privateResult.rankedCandidateIds],
    rejected,
    unresolved,
    trace: publicTrace,
  };
}

/**
 * Version-neutral evaluator core for already-admitted public policies and
 * candidate facts. This is intentionally not exported by the public barrel;
 * versioned adapters remain responsible for their own artifact admission and
 * result envelope.
 */
export function evaluateAdmittedRouteCandidatesCore({ policy, candidates }) {
  const privatePolicy = compilePrivatePolicy(policy);
  const privateCandidates = candidates.map(
    (candidate) => compilePrivateCandidate(candidate, policy),
  );
  const privateResult = evaluatePrivate({
    policy: privatePolicy,
    candidates: privateCandidates,
  });
  return mapPrivateResult(privateResult, { policy, candidates });
}

/**
 * Re-admits exact S0 public contracts, compiles a version-specific private IR,
 * evaluates it deterministically, and re-admits the mapped public result.
 */
export function evaluateAdmittedRouteDecision(input) {
  const admittedInput = admitPublicEvaluationInput(input);
  const evaluation = evaluateAdmittedRouteCandidatesCore(admittedInput);
  return admitDecisionResult({
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.decisionResult,
    policyId: admittedInput.policy.policyId,
    candidateSet: {
      schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.candidateSet,
      candidateSetId: admittedInput.candidateSet.candidateSetId,
      candidateSetRevision: admittedInput.candidateSet.candidateSetRevision,
      candidateIds: [...admittedInput.candidateSet.candidateIds],
      candidateCount: admittedInput.candidateSet.candidateCount,
      completeness: admittedInput.candidateSet.completeness,
    },
    ...evaluation,
  });
}
