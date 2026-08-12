import { admitDecisionPolicy } from '../contracts/index.js';
import { admitRouteCandidateSearchResult } from '../contracts/candidate_search_v2.js';
import {
  ROUTE_ENRICHMENT_SCHEMA_VERSIONS,
  admitRouteCandidateSearchEnrichmentResult,
} from '../enrichment/index.js';

import { evaluateAdmittedRouteCandidatesCore } from './evaluate_admitted.js';

export const ROUTE_SEARCH_DECISION_EVALUATION_VERSION =
  'engagement-route-search-decision-evaluation/v1';
export const ROUTE_SEARCH_DECISION_VERSION = 'engagement-route-search-decision/v1';

const DECISION_SCOPE = 'provided-candidate-set';
const SEARCH_RESULT_VERSION = 'engagement-route-candidate-search-result/v1';
const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const ZERO_CANDIDATE_REASON_BY_TERMINATION = Object.freeze({
  'invalid-input': 'candidate-search-invalid-input',
  'endpoint-unavailable': 'candidate-search-endpoint-unavailable',
  'no-directed-route-in-bounded-scope': 'candidate-search-no-directed-route-in-bounded-scope',
  'no-eligible-route-in-bounded-scope': 'candidate-search-no-eligible-route-in-bounded-scope',
  'unresolved-constraint-evidence': 'candidate-search-unresolved-constraint-evidence',
  'search-budget-exhausted': 'candidate-search-budget-exhausted',
  'search-capacity-exhausted': 'candidate-search-capacity-exhausted',
});

function fail(message) {
  throw new TypeError(`route search decision evaluator adapter: ${message}`);
}

function exactDataObject(raw, keys, label) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`${label} must be a plain object`);
  }
  let prototype;
  let descriptors;
  let ownKeys;
  try {
    prototype = Object.getPrototypeOf(raw);
    descriptors = Object.getOwnPropertyDescriptors(raw);
    ownKeys = Reflect.ownKeys(raw);
  } catch {
    fail(`${label} cannot be inspected safely`);
  }
  if (prototype !== Object.prototype || ownKeys.some((key) => typeof key === 'symbol')) {
    fail(`${label} must be a plain string-keyed object`);
  }
  if (ownKeys.length !== keys.length
    || keys.some((key) => !Object.hasOwn(descriptors, key))
    || ownKeys.some((key) => !keys.includes(key))) {
    fail(`${label} schema mismatch`);
  }
  const value = {};
  for (const key of keys) {
    if (!Object.hasOwn(descriptors[key], 'value')) {
      fail(`${label}.${key} must be a data property`);
    }
    value[key] = descriptors[key].value;
  }
  return value;
}

function cloneDataTree(raw, label, depth = 0) {
  if (depth > 12) fail(`${label} exceeds the supported nesting depth`);
  if (raw === null || typeof raw === 'string' || typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw)) fail(`${label} must contain safe integers only`);
    return raw;
  }
  if (!raw || typeof raw !== 'object') fail(`${label} contains unsupported data`);

  let prototype;
  let descriptors;
  let ownKeys;
  try {
    prototype = Object.getPrototypeOf(raw);
    descriptors = Object.getOwnPropertyDescriptors(raw);
    ownKeys = Reflect.ownKeys(raw);
  } catch {
    fail(`${label} cannot be inspected safely`);
  }
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    fail(`${label} must use string keys only`);
  }

  if (Array.isArray(raw)) {
    if (prototype !== Array.prototype) fail(`${label} must be a standard array`);
    const copy = [];
    for (let index = 0; index < raw.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        fail(`${label}[${index}] must be a data property`);
      }
      copy.push(cloneDataTree(descriptor.value, `${label}[${index}]`, depth + 1));
    }
    const extras = ownKeys.filter((key) => key !== 'length'
      && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= raw.length));
    if (extras.length) fail(`${label} contains unsupported properties`);
    return copy;
  }

  if (prototype !== Object.prototype) fail(`${label} must contain plain objects only`);
  const copy = {};
  for (const key of ownKeys) {
    if (BLOCKED_PROPERTY_NAMES.has(key)) fail(`${label}.${key} is prohibited`);
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value')) {
      fail(`${label}.${key} must be a data property`);
    }
    copy[key] = cloneDataTree(descriptor.value, `${label}.${key}`, depth + 1);
  }
  return copy;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sameSequence(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function dataProperty(raw, key, label) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`${label} must be a plain object`);
  }
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(raw, key);
  } catch {
    fail(`${label} cannot be inspected safely`);
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    fail(`${label}.${key} must be a data property`);
  }
  return descriptor.value;
}

function admitCandidateArtifact(raw) {
  const schemaVersion = dataProperty(raw, 'schemaVersion', 'candidateArtifact');
  if (schemaVersion === SEARCH_RESULT_VERSION) {
    const admitted = admitRouteCandidateSearchResult(raw);
    return { candidateArtifact: admitted, searchResult: admitted };
  }
  if (schemaVersion === ROUTE_ENRICHMENT_SCHEMA_VERSIONS.searchResult) {
    const admitted = admitRouteCandidateSearchEnrichmentResult(raw);
    return { candidateArtifact: admitted, searchResult: admitted.searchResult };
  }
  fail('candidateArtifact.schemaVersion is unsupported');
}

function assertPolicySearchCompatibility(policy, searchArtifact) {
  const { request } = searchArtifact;
  if (request === null) return;
  if (request.decisionPolicyId !== policy.policyId) {
    fail('CandidateSearchRequest.decisionPolicyId must match DecisionPolicy.policyId');
  }
  const policyConstraints = new Map(
    policy.hardConstraints.map((constraint) => [constraint.constraintId, constraint]),
  );
  for (const searchConstraint of request.hardConstraints) {
    const policyConstraint = policyConstraints.get(searchConstraint.constraintId);
    if (!policyConstraint
      || policyConstraint.factorId !== searchConstraint.factorId
      || policyConstraint.operator !== searchConstraint.operator
      || policyConstraint.expectedValue !== searchConstraint.expectedValue
      || !sameSequence(policyConstraint.unresolvedStates, searchConstraint.unresolvedStates)) {
      fail(`search hard constraint ${searchConstraint.constraintId} must exactly match a policy constraint`);
    }
  }
}

function makeDecision(policy, searchArtifact) {
  const candidateSet = searchArtifact.candidateSet;
  const projection = evaluateAdmittedRouteCandidatesCore({
    policy,
    candidates: searchArtifact.candidateFacts,
  });
  return {
    schemaVersion: ROUTE_SEARCH_DECISION_VERSION,
    scope: DECISION_SCOPE,
    candidateSetId: candidateSet.candidateSetId,
    candidateSetRevision: candidateSet.candidateSetRevision,
    candidateIds: [...candidateSet.candidateIds],
    ...projection,
  };
}

function expectedEvaluation(policy, searchArtifact) {
  if (searchArtifact.candidateFacts.length === 0) {
    const reasonCode = ZERO_CANDIDATE_REASON_BY_TERMINATION[searchArtifact.termination];
    if (!reasonCode) fail('zero-candidate search termination is not evaluable');
    return {
      status: 'not-evaluated',
      reasonCode,
      decision: null,
    };
  }
  return {
    status: 'evaluated',
    reasonCode: 'provided-candidate-set-evaluated',
    decision: makeDecision(policy, searchArtifact),
  };
}

function sameDataTree(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => sameDataTree(item, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return sameSequence(leftKeys, rightKeys)
    && leftKeys.every((key) => sameDataTree(left[key], right[key]));
}

/**
 * Strictly re-admits and independently recomputes the deterministic decision
 * projection, so a caller cannot tamper with dispositions, ranking, or trace.
 */
export function admitRouteSearchDecisionEvaluation(raw) {
  const value = exactDataObject(
    raw,
    ['schemaVersion', 'policy', 'candidateArtifact', 'evaluation'],
    'RouteSearchDecisionEvaluation',
  );
  if (value.schemaVersion !== ROUTE_SEARCH_DECISION_EVALUATION_VERSION) {
    fail('RouteSearchDecisionEvaluation.schemaVersion is unsupported');
  }
  const policy = admitDecisionPolicy(value.policy);
  const { candidateArtifact, searchResult } = admitCandidateArtifact(value.candidateArtifact);
  assertPolicySearchCompatibility(policy, searchResult);
  const rawEvaluation = exactDataObject(
    value.evaluation,
    ['status', 'reasonCode', 'decision'],
    'RouteSearchDecisionEvaluation.evaluation',
  );
  const admittedRawEvaluation = cloneDataTree(
    rawEvaluation,
    'RouteSearchDecisionEvaluation.evaluation',
  );
  const expected = expectedEvaluation(policy, searchResult);
  if (!sameDataTree(admittedRawEvaluation, expected)) {
    fail('evaluation does not match the admitted policy and search artifact');
  }
  return deepFreeze({
    schemaVersion: ROUTE_SEARCH_DECISION_EVALUATION_VERSION,
    policy,
    candidateArtifact,
    evaluation: cloneDataTree(expected, 'expected evaluation'),
  });
}

/**
 * Evaluates only the candidates supplied by an admitted S2 search artifact.
 * Search termination/completeness remains unchanged and orthogonal to the
 * provided-set decision status.
 */
export function evaluateAdmittedRouteSearchDecision(input) {
  const value = exactDataObject(
    input,
    ['policy', 'candidateArtifact'],
    'route search evaluation input',
  );
  const policy = admitDecisionPolicy(value.policy);
  const { candidateArtifact, searchResult } = admitCandidateArtifact(value.candidateArtifact);
  assertPolicySearchCompatibility(policy, searchResult);
  return admitRouteSearchDecisionEvaluation({
    schemaVersion: ROUTE_SEARCH_DECISION_EVALUATION_VERSION,
    policy,
    candidateArtifact,
    evaluation: expectedEvaluation(policy, searchResult),
  });
}
