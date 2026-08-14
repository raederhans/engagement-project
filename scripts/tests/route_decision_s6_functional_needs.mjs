#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DEFAULT_FUNCTIONAL_NEEDS_CATALOG_V1,
  FUNCTIONAL_NEEDS_COMPILER_IDENTITY_V1,
  FUNCTIONAL_NEEDS_COMPILER_INPUT_BUDGET_V1,
  FUNCTIONAL_NEEDS_COMPILER_SCHEMA_VERSIONS,
  compileFunctionalNeedsV1,
} from '../../src/route_decision/functional_needs/compiler_v1.js';
import { admitDecisionPolicy } from '../../src/route_decision/contracts/index.js';
import { admitRouteCandidateSearchRequest } from '../../src/route_decision/contracts/candidate_search_v2.js';
import { evaluateAdmittedRouteSearchDecision } from '../../src/route_decision/evaluator/search_v2.js';

const fixtureUrl = new URL('../fixtures/route-s6-functional-needs/selected-needs.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));

function clone(value) {
  return structuredClone(value);
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function deepFreezeInput(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezeInput(child);
  return Object.freeze(value);
}

function reverseObjectKeyOrder(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeyOrder);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).reverse().map(([key, child]) => [key, reverseObjectKeyOrder(child)]),
  );
}

function inputStringCodeUnits(value) {
  if (typeof value === 'string') return value.length;
  if (!value || typeof value !== 'object') return 0;
  if (Array.isArray(value)) {
    return value.reduce((sum, child) => sum + inputStringCodeUnits(child), 0);
  }
  return Object.entries(value).reduce((sum, [key, child]) => (
    sum + key.length + inputStringCodeUnits(child)
  ), 0);
}

function padBoundedIdsToStringBudget(raw, target) {
  const idFields = [
    [raw, 'compilationId'],
    [raw, 'policyId'],
    [raw.catalog, 'catalogId'],
    [raw.search, 'requestId'],
    [raw.search, 'graphId'],
    [raw.search, 'originNodeId'],
    [raw.search, 'destinationNodeId'],
    ...raw.selections.map((selection) => [selection, 'selectionId']),
  ];
  let remaining = target - inputStringCodeUnits(raw);
  assert.ok(remaining >= 0);
  for (const [owner, key] of idFields) {
    const added = Math.min(remaining, 120 - owner[key].length);
    owner[key] += 'a'.repeat(added);
    remaining -= added;
    if (remaining === 0) break;
  }
  assert.equal(remaining, 0);
  assert.equal(inputStringCodeUnits(raw), target);
  return raw;
}

test('compiler identity is versioned, tooling-only, synthetic-only, and non-identity', () => {
  assert.deepEqual(FUNCTIONAL_NEEDS_COMPILER_IDENTITY_V1, {
    compilerId: 'controlled-functional-needs-compiler-v1',
    compilerVersion: 'engagement-functional-needs-compiler/v1',
    inputSchemaVersion: 'engagement-functional-needs-compile-request/v1',
    outputSchemaVersion: 'engagement-functional-needs-compilation-result/v1',
    mappingTraceSchemaVersion: 'engagement-functional-needs-mapping-trace/v1',
    contentIdentitySchemaVersion: 'engagement-functional-needs-content-identity/v1',
    canonicalizationVersion: 'engagement-functional-needs-canonical-json/v1',
    inputBudgetVersion: 'engagement-functional-needs-input-budget/v1',
    selectionSemantics: 'set-after-admission-and-canonical-sort',
    outputContractVersions: {
      decisionPolicy: 'engagement-route-decision-policy/v1',
      candidateSearchRequest: 'engagement-route-candidate-search-request/v1',
    },
    executionScope: 'tooling-only',
    dataClassification: 'synthetic-only',
    identityInference: 'forbidden',
  });
  assert.equal(DEFAULT_FUNCTIONAL_NEEDS_CATALOG_V1.catalogId, 'core-functional-needs-v1');
  assertDeepFrozen(FUNCTIONAL_NEEDS_COMPILER_IDENTITY_V1);
});

test('explicit functional needs compile losslessly into admitted policy and search inputs', () => {
  const result = compileFunctionalNeedsV1(fixture);

  assert.equal(result.schemaVersion, FUNCTIONAL_NEEDS_COMPILER_SCHEMA_VERSIONS.compilationResult);
  assert.equal(result.status, 'compiled');
  assert.deepEqual(result.issues, []);
  assert.strictEqual(admitDecisionPolicy(clone(result.decisionPolicy)).schemaVersion,
    'engagement-route-decision-policy/v1');
  assert.strictEqual(admitRouteCandidateSearchRequest(clone(result.candidateSearchRequest)).schemaVersion,
    'engagement-route-candidate-search-request/v1');
  assert.deepEqual(
    result.decisionPolicy.hardConstraints.map(({ factorId }) => factorId),
    ['step-free', 'curb-ramp-present'],
  );
  assert.deepEqual(
    result.candidateSearchRequest.hardConstraints.map(({ factorId }) => factorId),
    ['step-free', 'curb-ramp-present'],
  );
  assert.deepEqual(
    result.decisionPolicy.softPreferences.map(({ needTag, weightBasisPoints }) => (
      [needTag, weightBasisPoints]
    )),
    [['minimize-distance', 6000], ['minimize-objective-cost', 4000]],
  );
  assert.equal(result.candidateSearchRequest.decisionPolicyId, result.decisionPolicy.policyId);
  assert.deepEqual(
    result.mappingTrace.entries.map(({ selectionId }) => selectionId),
    ['need-step-free', 'need-curb-ramp', 'need-shorter-distance', 'need-lower-objective-cost'],
  );
  for (const entry of result.mappingTrace.entries) {
    const source = fixture.selections.find(({ selectionId }) => selectionId === entry.selectionId);
    assert.deepEqual(entry.source, source);
    assert.notEqual(entry.mapping.emittedTo.length, 0);
  }
  assert.equal(result.requestIdentity.kind, 'request');
  assert.equal(result.identity.kind, 'result');
  assert.match(result.requestIdentity.digest, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.identity.digest, /^sha256:[a-f0-9]{64}$/);
  assertDeepFrozen(result);
});

test('selection order does not change compiled output or trace order', () => {
  const reversed = clone(fixture);
  reversed.selections.reverse();
  assert.deepEqual(compileFunctionalNeedsV1(reversed), compileFunctionalNeedsV1(fixture));
});

test('canonical identities bind request and complete result semantics without caller-id collisions', () => {
  const baseline = compileFunctionalNeedsV1(fixture);
  const variants = [];

  const weights = clone(fixture);
  weights.selections[0].weightBasisPoints = 5000;
  weights.selections[2].weightBasisPoints = 5000;
  variants.push(compileFunctionalNeedsV1(weights));

  const range = clone(fixture);
  range.selections[0].rangeMax = 90_000_000;
  variants.push(compileFunctionalNeedsV1(range));

  const selectedFactor = clone(fixture);
  selectedFactor.selections[1].factorId = 'paved-surface';
  variants.push(compileFunctionalNeedsV1(selectedFactor));

  const unresolved = clone(fixture);
  unresolved.selections[1].resolution = 'unknown';
  unresolved.selections[1].expectedValue = null;
  const unresolvedResult = compileFunctionalNeedsV1(unresolved);
  variants.push(unresolvedResult);

  for (const variant of variants) {
    assert.notEqual(variant.requestIdentity.digest, baseline.requestIdentity.digest);
    assert.notEqual(variant.identity.digest, baseline.identity.digest);
  }
  assert.equal(baseline.status, 'compiled');
  assert.equal(unresolvedResult.status, 'unresolved');
  assert.notEqual(unresolvedResult.identity.digest, baseline.identity.digest);
});

test('canonical identities ignore non-semantic object-key order', () => {
  assert.deepEqual(
    compileFunctionalNeedsV1(reverseObjectKeyOrder(fixture)),
    compileFunctionalNeedsV1(fixture),
  );
});

test('compiled policy and request are jointly consumable by the search evaluator boundary', () => {
  const result = compileFunctionalNeedsV1(fixture);
  const evaluation = evaluateAdmittedRouteSearchDecision({
    policy: result.decisionPolicy,
    candidateArtifact: {
      schemaVersion: 'engagement-route-candidate-search-result/v2',
      status: 'not-started',
      termination: 'endpoint-unavailable',
      request: result.candidateSearchRequest,
      candidateSet: null,
      candidateFacts: [],
    },
  });
  assert.equal(evaluation.evaluation.status, 'not-evaluated');
  assert.equal(
    evaluation.evaluation.reasonCode,
    'candidate-search-endpoint-unavailable',
  );
});

test('graphId remains an exact bounded reference without lexical authority classification', () => {
  const s5GraphId = 'philadelphia-pa-us:synthetic:s5-binding-fixture-v1';
  const s5Input = clone(fixture);
  s5Input.search.graphId = s5GraphId;
  const s5Result = compileFunctionalNeedsV1(s5Input);
  const admittedPolicy = admitDecisionPolicy(clone(s5Result.decisionPolicy));
  const admittedRequest = admitRouteCandidateSearchRequest(
    clone(s5Result.candidateSearchRequest),
  );
  assert.equal(admittedRequest.decisionPolicyId, admittedPolicy.policyId);
  assert.equal(admittedRequest.graphId, s5GraphId);

  const arbitraryInput = clone(fixture);
  arbitraryInput.search.graphId = 'bounded-reference-without-classification';
  const arbitraryResult = compileFunctionalNeedsV1(arbitraryInput);
  assert.equal(
    arbitraryResult.candidateSearchRequest.graphId,
    'bounded-reference-without-classification',
  );
  assert.deepEqual(arbitraryResult.claimBoundary, {
    dataClassification: 'synthetic',
    executionScope: 'tooling-only',
    externalAuthority: false,
    productRuntimeWiring: false,
    identityInference: false,
    realData: false,
  });
});

for (const resolution of ['unknown', 'unavailable', 'partial', 'conflict']) {
  test(`${resolution} selection withholds both downstream artifacts without guessing`, () => {
    const raw = clone(fixture);
    raw.selections[1].resolution = resolution;
    raw.selections[1].expectedValue = null;
    const result = compileFunctionalNeedsV1(raw);

    assert.equal(result.status, 'unresolved');
    assert.equal(result.decisionPolicy, null);
    assert.equal(result.candidateSearchRequest, null);
    assert.equal(result.issues.some(({ issueCode }) => issueCode === `selection-${resolution}`), true);
    const trace = result.mappingTrace.entries.find(({ selectionId }) => (
      selectionId === 'need-step-free'
    ));
    assert.equal(trace.source.expectedValue, null);
    assert.deepEqual(trace.mapping.emittedTo, []);
    assertDeepFrozen(result);
  });
}

test('soft and mixed partial selections remain explicit and withhold all downstream artifacts', () => {
  const softPartial = clone(fixture);
  softPartial.selections[0] = {
    ...softPartial.selections[0],
    resolution: 'partial',
    rangeMin: null,
    rangeMax: null,
    weightBasisPoints: null,
  };
  const softResult = compileFunctionalNeedsV1(softPartial);
  assert.equal(softResult.status, 'unresolved');
  assert.equal(softResult.decisionPolicy, null);
  assert.equal(softResult.candidateSearchRequest, null);
  assert.deepEqual(
    softResult.issues,
    [{
      issueCode: 'selection-partial',
      selectionIds: ['need-shorter-distance'],
      needTag: 'minimize-distance',
      factorId: 'distance-mm',
    }],
  );

  const mixedPartial = clone(softPartial);
  mixedPartial.selections[1].resolution = 'partial';
  mixedPartial.selections[1].expectedValue = null;
  const mixedResult = compileFunctionalNeedsV1(mixedPartial);
  assert.equal(mixedResult.status, 'unresolved');
  assert.equal(mixedResult.decisionPolicy, null);
  assert.equal(mixedResult.candidateSearchRequest, null);
  assert.deepEqual(
    mixedResult.issues.filter(({ issueCode }) => issueCode === 'selection-partial')
      .flatMap(({ selectionIds }) => selectionIds),
    ['need-shorter-distance', 'need-step-free'],
  );
  for (const entry of mixedResult.mappingTrace.entries) {
    assert.deepEqual(entry.mapping.emittedTo, []);
  }
});

test('conflicting mapped factors and weights fail closed with deterministic issues', () => {
  const duplicateFactor = clone(fixture);
  duplicateFactor.selections.push({
    selectionId: 'need-step-free-again',
    needTag: 'require-capability',
    resolution: 'selected',
    factorId: 'step-free',
    expectedValue: true,
  });
  const factorResult = compileFunctionalNeedsV1(duplicateFactor);
  assert.equal(factorResult.status, 'unresolved');
  assert.equal(factorResult.decisionPolicy, null);
  assert.deepEqual(factorResult.issues, [{
    issueCode: 'conflicting-hard-factor',
    selectionIds: ['need-step-free', 'need-step-free-again'],
    needTag: 'require-capability',
    factorId: 'step-free',
  }]);

  const badWeights = clone(fixture);
  badWeights.selections[0].weightBasisPoints = 5000;
  const weightResult = compileFunctionalNeedsV1(badWeights);
  assert.equal(weightResult.status, 'unresolved');
  assert.equal(weightResult.decisionPolicy, null);
  assert.deepEqual(weightResult.issues.map(({ issueCode }) => issueCode), [
    'soft-weight-total-conflict',
  ]);
});

test('hard constraints are compiled separately before weighted preferences', () => {
  const result = compileFunctionalNeedsV1(fixture);
  assert.equal(result.mappingTrace.entries[0].mapping.targetKind, 'hard-constraint');
  assert.equal(result.mappingTrace.entries[1].mapping.targetKind, 'hard-constraint');
  assert.equal(result.mappingTrace.entries[2].mapping.targetKind, 'soft-preference');
  assert.equal(result.mappingTrace.entries[3].mapping.targetKind, 'soft-preference');
  assert.deepEqual(result.mappingTrace.entries[0].mapping.emittedTo, [
    'decisionPolicy.hardConstraints',
    'candidateSearchRequest.hardConstraints',
  ]);
});

test('invalid, aliased, identity-like, real-data, and ambiguous values are rejected', () => {
  const cases = [
    ['unknown schema', (raw) => { raw.schemaVersion = 'engagement-functional-needs-compile-request/v2'; }],
    ['unknown root field', (raw) => { raw.profile = 'identity-like'; }],
    ['missing root field', (raw) => { delete raw.search; }],
    ['real classification', (raw) => { raw.dataClassification = 'real'; }],
    ['unknown need alias', (raw) => { raw.selections[0].needTag = 'shortest'; }],
    ['unknown factor alias', (raw) => { raw.selections[1].factorId = 'wheelchair'; }],
    ['false hard value', (raw) => { raw.selections[1].expectedValue = false; }],
    ['numeric unknown', (raw) => {
      raw.selections[0].resolution = 'unknown';
      raw.selections[0].rangeMin = 0;
      raw.selections[0].rangeMax = 0;
      raw.selections[0].weightBasisPoints = 0;
    }],
    ['duplicate selection id', (raw) => {
      raw.selections[1].selectionId = raw.selections[0].selectionId;
    }],
  ];
  for (const [label, mutate] of cases) {
    const raw = clone(fixture);
    mutate(raw);
    assert.throws(() => compileFunctionalNeedsV1(raw), TypeError, label);
  }
});

test('aggregate snapshot string budget admits exact N and rejects N plus one', () => {
  const exact = padBoundedIdsToStringBudget(
    clone(fixture),
    FUNCTIONAL_NEEDS_COMPILER_INPUT_BUDGET_V1.maxStringCodeUnits,
  );
  assert.equal(compileFunctionalNeedsV1(exact).status, 'compiled');

  const over = padBoundedIdsToStringBudget(
    clone(fixture),
    FUNCTIONAL_NEEDS_COMPILER_INPUT_BUDGET_V1.maxStringCodeUnits + 1,
  );
  assert.throws(
    () => compileFunctionalNeedsV1(over),
    /aggregate stringCodeUnits budget exceeded/,
  );
});

test('aggregate snapshot budget rejects many locally bounded containers', () => {
  const raw = clone(fixture);
  raw.selections = Array.from({ length: 64 }, (_, index) => ({
    selectionId: `s${index}`,
    needTag: 'minimize-distance',
    resolution: 'partial',
    rangeMin: null,
    rangeMax: null,
    weightBasisPoints: null,
  }));
  assert.equal(raw.selections.length, 64);
  assert.equal(raw.selections.every((selection) => Object.keys(selection).length === 6), true);
  assert.throws(
    () => compileFunctionalNeedsV1(raw),
    /aggregate (?:propertiesAndArrayItems|stringCodeUnits) budget exceeded/,
  );
});

test('root unknown shape rejects a large branch without traversing its value', () => {
  let trapCount = 0;
  const largeUnknownBranch = new Proxy(new Array(1_000).fill(0), {
    getPrototypeOf() { trapCount += 1; return Array.prototype; },
    ownKeys(target) { trapCount += 1; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) {
      trapCount += 1;
      return Object.getOwnPropertyDescriptor(target, key);
    },
  });
  const raw = clone(fixture);
  raw.unknownPayload = largeUnknownBranch;
  assert.throws(
    () => compileFunctionalNeedsV1(raw),
    /FunctionalNeedsCompileRequest schema mismatch.*unknown: unknownPayload/,
  );
  assert.equal(trapCount, 0);

  let getterCount = 0;
  const accessorRoot = clone(fixture);
  Object.defineProperty(accessorRoot, 'search', {
    enumerable: true,
    configurable: true,
    get() { getterCount += 1; return clone(fixture.search); },
  });
  assert.throws(
    () => compileFunctionalNeedsV1(accessorRoot),
    /must be an own enumerable data property/,
  );
  assert.equal(getterCount, 0);
});

test('nested unknown branch remains bounded by the shared aggregate budget', () => {
  const raw = clone(fixture);
  raw.search.unknownPayload = new Array(1_000).fill(0);
  assert.throws(
    () => compileFunctionalNeedsV1(raw),
    /aggregate propertiesAndArrayItems budget exceeded/,
  );
});

test('root and nested Proxy inputs are rejected before any Proxy trap fires', () => {
  let rootTrapCount = 0;
  const rootProxy = new Proxy(clone(fixture), {
    getPrototypeOf() { rootTrapCount += 1; return Object.prototype; },
    ownKeys(target) { rootTrapCount += 1; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) {
      rootTrapCount += 1;
      return Object.getOwnPropertyDescriptor(target, key);
    },
    isExtensible() { rootTrapCount += 1; return true; },
  });
  assert.throws(() => compileFunctionalNeedsV1(rootProxy), /must not be a Proxy/);
  assert.equal(rootTrapCount, 0);

  let nestedTrapCount = 0;
  const nested = clone(fixture);
  nested.search.bounds = new Proxy(nested.search.bounds, {
    getPrototypeOf() { nestedTrapCount += 1; return Object.prototype; },
    ownKeys(target) { nestedTrapCount += 1; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) {
      nestedTrapCount += 1;
      return Object.getOwnPropertyDescriptor(target, key);
    },
    isExtensible() { nestedTrapCount += 1; return true; },
  });
  assert.throws(() => compileFunctionalNeedsV1(nested), /must not be a Proxy/);
  assert.equal(nestedTrapCount, 0);
});

test('container admission accepts only standard fully mutable or fully frozen descriptors', () => {
  const accessor = clone(fixture);
  Object.defineProperty(accessor.selections[0], 'needTag', {
    enumerable: true,
    get() { return 'minimize-distance'; },
  });
  assert.throws(() => compileFunctionalNeedsV1(accessor), TypeError);

  const sparse = clone(fixture);
  delete sparse.selections[1];
  assert.throws(() => compileFunctionalNeedsV1(sparse), TypeError);

  const symbolProperty = clone(fixture);
  symbolProperty.selections[Symbol('hidden')] = 'identity-like';
  assert.throws(() => compileFunctionalNeedsV1(symbolProperty), TypeError);

  const mixedDescriptor = clone(fixture);
  Object.defineProperty(mixedDescriptor, 'policyId', { writable: false });
  assert.throws(
    () => compileFunctionalNeedsV1(mixedDescriptor),
    /descriptor does not match the mutable container mode/,
  );

  const sealedNotFrozen = clone(fixture);
  Object.seal(sealedNotFrozen.search);
  assert.equal(Object.isFrozen(sealedNotFrozen.search), false);
  assert.throws(
    () => compileFunctionalNeedsV1(sealedNotFrozen),
    /either extensible mutable data or fully frozen data/,
  );

  const readonlyLength = clone(fixture);
  Object.defineProperty(readonlyLength.selections, 'length', { writable: false });
  assert.throws(
    () => compileFunctionalNeedsV1(readonlyLength),
    /length descriptor does not match the mutable array mode/,
  );

  const readonlyIndex = clone(fixture);
  Object.defineProperty(readonlyIndex.selections, '0', { writable: false });
  assert.throws(
    () => compileFunctionalNeedsV1(readonlyIndex),
    /descriptor does not match the mutable container mode/,
  );

  const frozenResult = compileFunctionalNeedsV1(deepFreezeInput(clone(fixture)));
  assert.equal(frozenResult.status, 'compiled');
  assertDeepFrozen(frozenResult);
});

test('input mutation cannot change detached compilation artifacts', () => {
  const raw = clone(fixture);
  const result = compileFunctionalNeedsV1(raw);
  raw.selections[0].weightBasisPoints = 1;
  raw.catalog.entries[0].kind = 'soft-preference';
  assert.equal(result.decisionPolicy.softPreferences[0].weightBasisPoints, 6000);
  assert.equal(result.mappingTrace.entries[2].source.weightBasisPoints, 6000);
  assert.equal(result.mappingTrace.catalogId, 'core-functional-needs-v1');
  assertDeepFrozen(result);
});
