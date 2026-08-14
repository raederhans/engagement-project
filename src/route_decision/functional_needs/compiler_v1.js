import { createHash } from 'node:crypto';
import { types as nodeTypes } from 'node:util';

import {
  CAPABILITY_OBSERVATION_TAGS,
  DEFAULT_TRAVEL_NEED_CATALOG,
  ROUTE_DECISION_SCHEMA_VERSIONS,
  UNRESOLVED_OBSERVATION_STATES,
  admitDecisionPolicy,
  admitTravelNeedCatalog,
} from '../contracts/index.js';
import {
  ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS,
  ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
  ROUTE_SEARCH_DISTINCTNESS_VERSION,
  ROUTE_SEARCH_TIE_BREAK_VERSION,
  ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES,
  admitRouteCandidateSearchRequest,
} from '../contracts/candidate_search_v2.js';

const MAX_ID_LENGTH = 120;
const MAX_SELECTIONS = 64;
const MAX_CONTAINER_ITEMS = 1_000;
const MAX_INPUT_DEPTH = 16;
const MAX_SCORING_VALUE = Math.floor(Number.MAX_SAFE_INTEGER / (10_000 * 2));
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,119})$/;
const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const CAPABILITY_FACTOR_SET = new Set(CAPABILITY_OBSERVATION_TAGS);
const RESOLUTION_SET = new Set([
  'selected',
  'unknown',
  'unavailable',
  'partial',
  'conflict',
]);
const SOFT_NEED_TAG_SET = new Set(['minimize-distance', 'minimize-objective-cost']);
const COMPILE_REQUEST_KEYS = Object.freeze([
  'schemaVersion',
  'compilationId',
  'dataClassification',
  'catalog',
  'policyId',
  'search',
  'selections',
]);

export const FUNCTIONAL_NEEDS_COMPILER_SCHEMA_VERSIONS = Object.freeze({
  compileRequest: 'engagement-functional-needs-compile-request/v1',
  compilationResult: 'engagement-functional-needs-compilation-result/v1',
  mappingTrace: 'engagement-functional-needs-mapping-trace/v1',
  contentIdentity: 'engagement-functional-needs-content-identity/v1',
  canonicalization: 'engagement-functional-needs-canonical-json/v1',
  compiler: 'engagement-functional-needs-compiler/v1',
});

export const FUNCTIONAL_NEEDS_COMPILER_INPUT_BUDGET_V1 = deepFreeze({
  schemaVersion: 'engagement-functional-needs-input-budget/v1',
  maxVisitedNodes: 600,
  maxContainers: 80,
  maxPropertiesAndArrayItems: 480,
  maxStringCodeUnits: 2_048,
  stringAccounting: 'string-values-and-object-keys-array-indexes-excluded',
});

export const FUNCTIONAL_NEEDS_COMPILER_IDENTITY_V1 = deepFreeze({
  compilerId: 'controlled-functional-needs-compiler-v1',
  compilerVersion: FUNCTIONAL_NEEDS_COMPILER_SCHEMA_VERSIONS.compiler,
  inputSchemaVersion: FUNCTIONAL_NEEDS_COMPILER_SCHEMA_VERSIONS.compileRequest,
  outputSchemaVersion: FUNCTIONAL_NEEDS_COMPILER_SCHEMA_VERSIONS.compilationResult,
  mappingTraceSchemaVersion: FUNCTIONAL_NEEDS_COMPILER_SCHEMA_VERSIONS.mappingTrace,
  contentIdentitySchemaVersion: FUNCTIONAL_NEEDS_COMPILER_SCHEMA_VERSIONS.contentIdentity,
  canonicalizationVersion: FUNCTIONAL_NEEDS_COMPILER_SCHEMA_VERSIONS.canonicalization,
  inputBudgetVersion: FUNCTIONAL_NEEDS_COMPILER_INPUT_BUDGET_V1.schemaVersion,
  selectionSemantics: 'set-after-admission-and-canonical-sort',
  outputContractVersions: {
    decisionPolicy: ROUTE_DECISION_SCHEMA_VERSIONS.decisionPolicy,
    candidateSearchRequest: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchRequest,
  },
  executionScope: 'tooling-only',
  dataClassification: 'synthetic-only',
  identityInference: 'forbidden',
});

const CLAIM_BOUNDARY = deepFreeze({
  dataClassification: 'synthetic',
  executionScope: 'tooling-only',
  externalAuthority: false,
  productRuntimeWiring: false,
  identityInference: false,
  realData: false,
});

const POLICY_TIE_BREAK = deepFreeze([
  { factorId: 'score-units', direction: 'descending' },
  { factorId: 'objective-cost-units', direction: 'ascending' },
  { factorId: 'distance-mm', direction: 'ascending' },
  { factorId: 'candidate-id', direction: 'ascending' },
]);

const SOFT_BINDINGS = deepFreeze({
  'minimize-distance': {
    preferenceId: 'prefer-shorter-distance',
    factorId: 'distance-mm',
  },
  'minimize-objective-cost': {
    preferenceId: 'prefer-lower-objective-cost',
    factorId: 'objective-cost-units',
  },
});

const NEED_ORDER = new Map([
  ['require-capability', 0],
  ['minimize-distance', 1],
  ['minimize-objective-cost', 2],
]);
const FACTOR_ORDER = new Map([
  ...CAPABILITY_OBSERVATION_TAGS.map((factorId, index) => [factorId, index]),
  ['distance-mm', CAPABILITY_OBSERVATION_TAGS.length],
  ['objective-cost-units', CAPABILITY_OBSERVATION_TAGS.length + 1],
]);

function fail(message) {
  throw new TypeError(`functional needs compiler: ${message}`);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function containerMode(value, label) {
  let extensible;
  let frozen;
  try {
    extensible = Object.isExtensible(value);
    frozen = Object.isFrozen(value);
  } catch {
    fail(`${label} container state cannot be inspected safely`);
  }
  if (extensible === true) return 'mutable';
  if (frozen === true) return 'frozen';
  fail(`${label} must be either extensible mutable data or fully frozen data`);
}

function inspectContainer(value, label, expectedArray) {
  if (!value || typeof value !== 'object') fail(`${label} must be an object`);
  if (nodeTypes.isProxy(value)) fail(`${label} must not be a Proxy`);

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
  const isArray = Array.isArray(value);
  if (isArray !== expectedArray
    || prototype !== (expectedArray ? Array.prototype : Object.prototype)) {
    fail(`${label} must be a standard ${expectedArray ? 'array' : 'plain object'}`);
  }
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    fail(`${label} must contain string keys only`);
  }
  const mode = containerMode(value, label);
  const expectedMutable = mode === 'mutable';
  let arrayLength = null;
  if (expectedArray) {
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')
      || lengthDescriptor.enumerable !== false
      || lengthDescriptor.configurable !== false
      || lengthDescriptor.writable !== expectedMutable) {
      fail(`${label}.length descriptor does not match the ${mode} array mode`);
    }
    arrayLength = lengthDescriptor.value;
    if (!Number.isSafeInteger(arrayLength) || arrayLength < 0
      || arrayLength > MAX_CONTAINER_ITEMS) {
      fail(`${label} length is outside the supported range`);
    }
  }
  for (const key of ownKeys) {
    if (BLOCKED_PROPERTY_NAMES.has(key)) fail(`${label}.${key} is prohibited`);
    if (expectedArray && key === 'length') continue;
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
      fail(`${label}.${key} must be an own enumerable data property`);
    }
    if (descriptor.writable !== expectedMutable || descriptor.configurable !== expectedMutable) {
      fail(`${label}.${key} descriptor does not match the ${mode} container mode`);
    }
  }
  return { ownKeys, descriptors, arrayLength };
}

function assertCompileRequestRootShape(value) {
  const label = 'FunctionalNeedsCompileRequest';
  const { ownKeys, descriptors } = inspectContainer(value, label, false);
  const allowed = new Set(COMPILE_REQUEST_KEYS);
  const missing = COMPILE_REQUEST_KEYS.filter((key) => !Object.hasOwn(descriptors, key));
  const unknown = ownKeys.filter((key) => !allowed.has(key));
  if (missing.length || unknown.length) {
    fail(`${label} schema mismatch (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`);
  }
}

function createSnapshotBudget() {
  return {
    visitedNodes: 0,
    containers: 0,
    propertiesAndArrayItems: 0,
    stringCodeUnits: 0,
  };
}

function chargeSnapshotBudget(budget, field, amount, label) {
  const limitByField = {
    visitedNodes: FUNCTIONAL_NEEDS_COMPILER_INPUT_BUDGET_V1.maxVisitedNodes,
    containers: FUNCTIONAL_NEEDS_COMPILER_INPUT_BUDGET_V1.maxContainers,
    propertiesAndArrayItems:
      FUNCTIONAL_NEEDS_COMPILER_INPUT_BUDGET_V1.maxPropertiesAndArrayItems,
    stringCodeUnits: FUNCTIONAL_NEEDS_COMPILER_INPUT_BUDGET_V1.maxStringCodeUnits,
  };
  budget[field] += amount;
  if (budget[field] > limitByField[field]) {
    fail(`${label} aggregate ${field} budget exceeded`);
  }
}

function snapshotData(
  value,
  label,
  budget,
  depth = 0,
  ancestors = new Set(),
) {
  chargeSnapshotBudget(budget, 'visitedNodes', 1, label);
  if (depth > MAX_INPUT_DEPTH) fail(`${label} exceeds the supported nesting depth`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    chargeSnapshotBudget(budget, 'stringCodeUnits', value.length, label);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      fail(`${label} must contain safe integers only`);
    }
    return value;
  }
  if (!value || typeof value !== 'object') fail(`${label} contains unsupported data`);
  if (nodeTypes.isProxy(value)) fail(`${label} must not be a Proxy`);
  chargeSnapshotBudget(budget, 'containers', 1, label);
  if (ancestors.has(value)) fail(`${label} must not contain cycles`);
  ancestors.add(value);

  let copy;
  if (Array.isArray(value)) {
    const { ownKeys, descriptors, arrayLength } = inspectContainer(value, label, true);
    const extra = ownKeys.filter((key) => key !== 'length'
      && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= arrayLength));
    if (extra.length) fail(`${label} contains unsupported array properties`);
    chargeSnapshotBudget(budget, 'propertiesAndArrayItems', arrayLength, label);
    copy = [];
    for (let index = 0; index < arrayLength; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor) fail(`${label} must not contain sparse entries`);
      copy.push(snapshotData(
        descriptor.value,
        `${label}[${index}]`,
        budget,
        depth + 1,
        ancestors,
      ));
    }
  } else {
    const { ownKeys, descriptors } = inspectContainer(value, label, false);
    if (ownKeys.length > MAX_CONTAINER_ITEMS) fail(`${label} contains too many properties`);
    chargeSnapshotBudget(budget, 'propertiesAndArrayItems', ownKeys.length, label);
    chargeSnapshotBudget(
      budget,
      'stringCodeUnits',
      ownKeys.reduce((sum, key) => sum + key.length, 0),
      label,
    );
    copy = Object.fromEntries(ownKeys.map((key) => [
      key,
      snapshotData(
        descriptors[key].value,
        `${label}.${key}`,
        budget,
        depth + 1,
        ancestors,
      ),
    ]));
  }
  ancestors.delete(value);
  return copy;
}

function exactObject(value, label, requiredKeys) {
  const { ownKeys, descriptors } = inspectContainer(value, label, false);
  const allowed = new Set(requiredKeys);
  const missing = requiredKeys.filter((key) => !Object.hasOwn(descriptors, key));
  const unknown = ownKeys.filter((key) => !allowed.has(key));
  if (missing.length || unknown.length) {
    fail(`${label} schema mismatch (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`);
  }
  return Object.fromEntries(requiredKeys.map((key) => [key, descriptors[key].value]));
}

function strictArray(value, label, { min = 0, max } = {}) {
  const { ownKeys, descriptors, arrayLength: length } = inspectContainer(value, label, true);
  if (!Number.isSafeInteger(length) || length < min || length > max) {
    fail(`${label} length is outside the supported range`);
  }
  const items = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      fail(`${label} must contain dense data properties only`);
    }
    items.push(descriptor.value);
  }
  const extra = ownKeys.filter((key) => key !== 'length'
    && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length));
  if (extra.length) fail(`${label} contains unsupported properties`);
  return items;
}

function boundedId(value, label) {
  if (typeof value !== 'string' || value.length > MAX_ID_LENGTH
    || !ID_PATTERN.test(value) || BLOCKED_PROPERTY_NAMES.has(value)) {
    fail(`${label} must be a bounded canonical id`);
  }
  return value;
}

function exactEnum(value, allowed, label) {
  if (typeof value !== 'string' || !allowed.has(value)) fail(`${label} is unsupported`);
  return value;
}

function safeInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < min || value > max) {
    fail(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function nullUnlessSelected(value, resolution, label) {
  if (resolution !== 'selected' && value !== null) {
    fail(`${label} must be null when resolution is ${resolution}`);
  }
}

function compareCodeUnits(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort(compareCodeUnits).map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function contentIdentity(kind, projection) {
  const canonical = canonicalStringify(projection);
  return {
    schemaVersion: FUNCTIONAL_NEEDS_COMPILER_SCHEMA_VERSIONS.contentIdentity,
    kind,
    canonicalization: FUNCTIONAL_NEEDS_COMPILER_SCHEMA_VERSIONS.canonicalization,
    digestAlgorithm: 'sha256',
    canonicalUtf8Bytes: new TextEncoder().encode(canonical).length,
    digest: `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`,
  };
}

function requestContentIdentity(request) {
  return contentIdentity('request', {
    schemaVersion: FUNCTIONAL_NEEDS_COMPILER_SCHEMA_VERSIONS.compileRequest,
    compilerVersion: FUNCTIONAL_NEEDS_COMPILER_SCHEMA_VERSIONS.compiler,
    selectionSemantics: FUNCTIONAL_NEEDS_COMPILER_IDENTITY_V1.selectionSemantics,
    compilationId: request.compilationId,
    dataClassification: 'synthetic',
    catalog: request.catalog,
    policyId: request.policyId,
    search: request.search,
    selections: request.selections.map(({ inputSelection }) => inputSelection),
  });
}

function compareSelections(left, right) {
  return NEED_ORDER.get(left.needTag) - NEED_ORDER.get(right.needTag)
    || FACTOR_ORDER.get(left.factorId) - FACTOR_ORDER.get(right.factorId)
    || compareCodeUnits(left.selectionId, right.selectionId);
}

function admitHardSelection(raw, index) {
  const label = `FunctionalNeedsCompileRequest.selections[${index}]`;
  const value = exactObject(raw, label, [
    'selectionId',
    'needTag',
    'resolution',
    'factorId',
    'expectedValue',
  ]);
  if (value.needTag !== 'require-capability') fail(`${label}.needTag is unsupported`);
  const resolution = exactEnum(value.resolution, RESOLUTION_SET, `${label}.resolution`);
  const factorId = exactEnum(value.factorId, CAPABILITY_FACTOR_SET, `${label}.factorId`);
  if (resolution === 'selected' && value.expectedValue !== true) {
    fail(`${label}.expectedValue must be true when selected`);
  }
  nullUnlessSelected(value.expectedValue, resolution, `${label}.expectedValue`);
  const inputSelection = {
    selectionId: boundedId(value.selectionId, `${label}.selectionId`),
    needTag: 'require-capability',
    resolution,
    factorId,
    expectedValue: value.expectedValue,
  };
  return { ...inputSelection, inputSelection };
}

function admitSoftSelection(raw, index, needTag) {
  const label = `FunctionalNeedsCompileRequest.selections[${index}]`;
  const value = exactObject(raw, label, [
    'selectionId',
    'needTag',
    'resolution',
    'rangeMin',
    'rangeMax',
    'weightBasisPoints',
  ]);
  const resolution = exactEnum(value.resolution, RESOLUTION_SET, `${label}.resolution`);
  if (resolution !== 'selected') {
    nullUnlessSelected(value.rangeMin, resolution, `${label}.rangeMin`);
    nullUnlessSelected(value.rangeMax, resolution, `${label}.rangeMax`);
    nullUnlessSelected(value.weightBasisPoints, resolution, `${label}.weightBasisPoints`);
  } else {
    safeInteger(value.rangeMin, `${label}.rangeMin`, { max: MAX_SCORING_VALUE });
    safeInteger(value.rangeMax, `${label}.rangeMax`, { max: MAX_SCORING_VALUE });
    if (value.rangeMin >= value.rangeMax) fail(`${label} normalization range must increase`);
    safeInteger(value.weightBasisPoints, `${label}.weightBasisPoints`, { max: 10_000 });
  }
  const binding = SOFT_BINDINGS[needTag];
  const inputSelection = {
    selectionId: boundedId(value.selectionId, `${label}.selectionId`),
    needTag,
    resolution,
    rangeMin: value.rangeMin,
    rangeMax: value.rangeMax,
    weightBasisPoints: value.weightBasisPoints,
  };
  return { ...inputSelection, factorId: binding.factorId, inputSelection };
}

function admitSelection(raw, index) {
  const label = `FunctionalNeedsCompileRequest.selections[${index}]`;
  const { descriptors } = inspectContainer(raw, label, false);
  const needTag = descriptors.needTag?.value;
  if (needTag === 'require-capability') return admitHardSelection(raw, index);
  if (SOFT_NEED_TAG_SET.has(needTag)) return admitSoftSelection(raw, index, needTag);
  fail(`${label}.needTag is unsupported`);
}

function admitSearchContext(raw) {
  const value = exactObject(raw, 'FunctionalNeedsCompileRequest.search', [
    'requestId',
    'graphId',
    'mode',
    'originNodeId',
    'destinationNodeId',
    'objectiveFactorId',
    'requestedCandidateCount',
    'routeDistinctnessVersion',
    'tieBreakVersion',
    'bounds',
  ]);
  if (value.mode !== 'walk') fail('FunctionalNeedsCompileRequest.search.mode must be walk');
  if (value.objectiveFactorId !== 'objective-cost-units') {
    fail('FunctionalNeedsCompileRequest.search.objectiveFactorId is unsupported');
  }
  if (value.routeDistinctnessVersion !== ROUTE_SEARCH_DISTINCTNESS_VERSION) {
    fail('FunctionalNeedsCompileRequest.search.routeDistinctnessVersion is unsupported');
  }
  if (value.tieBreakVersion !== ROUTE_SEARCH_TIE_BREAK_VERSION) {
    fail('FunctionalNeedsCompileRequest.search.tieBreakVersion is unsupported');
  }
  const bounds = exactObject(value.bounds, 'FunctionalNeedsCompileRequest.search.bounds', [
    'maxExpandedStates',
    'maxRouteEdgeCount',
  ]);
  return {
    requestId: boundedId(value.requestId, 'FunctionalNeedsCompileRequest.search.requestId'),
    graphId: boundedId(value.graphId, 'FunctionalNeedsCompileRequest.search.graphId'),
    mode: 'walk',
    originNodeId: boundedId(
      value.originNodeId,
      'FunctionalNeedsCompileRequest.search.originNodeId',
    ),
    destinationNodeId: boundedId(
      value.destinationNodeId,
      'FunctionalNeedsCompileRequest.search.destinationNodeId',
    ),
    objectiveFactorId: 'objective-cost-units',
    requestedCandidateCount: safeInteger(
      value.requestedCandidateCount,
      'FunctionalNeedsCompileRequest.search.requestedCandidateCount',
      { min: 1, max: 16 },
    ),
    routeDistinctnessVersion: ROUTE_SEARCH_DISTINCTNESS_VERSION,
    tieBreakVersion: ROUTE_SEARCH_TIE_BREAK_VERSION,
    bounds: {
      maxExpandedStates: safeInteger(
        bounds.maxExpandedStates,
        'FunctionalNeedsCompileRequest.search.bounds.maxExpandedStates',
        { min: 1, max: 1_000_000 },
      ),
      maxRouteEdgeCount: safeInteger(
        bounds.maxRouteEdgeCount,
        'FunctionalNeedsCompileRequest.search.bounds.maxRouteEdgeCount',
        { max: 100_000 },
      ),
    },
  };
}

function admitCompileRequest(raw) {
  const value = exactObject(raw, 'FunctionalNeedsCompileRequest', [
    'schemaVersion',
    'compilationId',
    'dataClassification',
    'catalog',
    'policyId',
    'search',
    'selections',
  ]);
  if (value.schemaVersion !== FUNCTIONAL_NEEDS_COMPILER_SCHEMA_VERSIONS.compileRequest) {
    fail('FunctionalNeedsCompileRequest.schemaVersion is unsupported');
  }
  if (value.dataClassification !== 'synthetic') {
    fail('FunctionalNeedsCompileRequest.dataClassification must be synthetic');
  }
  const admittedCatalog = admitTravelNeedCatalog(value.catalog);
  const catalog = {
    ...admittedCatalog,
    entries: [...admittedCatalog.entries].sort((left, right) => (
      NEED_ORDER.get(left.tag) - NEED_ORDER.get(right.tag)
    )),
  };
  const selections = strictArray(
    value.selections,
    'FunctionalNeedsCompileRequest.selections',
    { min: 1, max: MAX_SELECTIONS },
  ).map(admitSelection);
  const selectionIds = selections.map(({ selectionId }) => selectionId);
  if (new Set(selectionIds).size !== selectionIds.length) {
    fail('FunctionalNeedsCompileRequest.selections selectionIds must be unique');
  }
  selections.sort(compareSelections);
  return {
    compilationId: boundedId(value.compilationId, 'FunctionalNeedsCompileRequest.compilationId'),
    catalog,
    policyId: boundedId(value.policyId, 'FunctionalNeedsCompileRequest.policyId'),
    search: admitSearchContext(value.search),
    selections,
  };
}

function issue(issueCode, selectionIds, needTag = null, factorId = null) {
  return { issueCode, selectionIds: [...selectionIds].sort(compareCodeUnits), needTag, factorId };
}

function collectIssues(selections) {
  const issues = [];
  for (const selection of selections) {
    if (selection.resolution !== 'selected') {
      issues.push(issue(
        `selection-${selection.resolution}`,
        [selection.selectionId],
        selection.needTag,
        selection.factorId,
      ));
    }
  }

  const selected = selections.filter(({ resolution }) => resolution === 'selected');
  const hardByFactor = new Map();
  const softByNeed = new Map();
  for (const selection of selected) {
    const bucket = selection.needTag === 'require-capability' ? hardByFactor : softByNeed;
    const key = selection.needTag === 'require-capability' ? selection.factorId : selection.needTag;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key).push(selection.selectionId);
  }
  for (const [factorId, selectionIds] of hardByFactor) {
    if (selectionIds.length > 1) {
      issues.push(issue('conflicting-hard-factor', selectionIds, 'require-capability', factorId));
    }
  }
  for (const [needTag, selectionIds] of softByNeed) {
    if (selectionIds.length > 1) {
      issues.push(issue('conflicting-soft-need', selectionIds, needTag, SOFT_BINDINGS[needTag].factorId));
    }
  }

  const softSelections = selections.filter(({ needTag }) => needTag !== 'require-capability');
  const selectedSoft = softSelections.filter(({ resolution }) => resolution === 'selected');
  if (softSelections.length === 0) {
    issues.push(issue('missing-selected-soft-preference', [], null, null));
  } else if (selectedSoft.length === softSelections.length) {
    const weightTotal = selectedSoft.reduce((sum, selection) => (
      sum + selection.weightBasisPoints
    ), 0);
    if (weightTotal !== 10_000) {
      issues.push(issue(
        'soft-weight-total-conflict',
        selectedSoft.map(({ selectionId }) => selectionId),
        null,
        null,
      ));
    }
  }
  return issues.sort((left, right) => compareCodeUnits(left.issueCode, right.issueCode)
    || compareCodeUnits(left.selectionIds.join('\u0000'), right.selectionIds.join('\u0000')));
}

function policyConstraint(selection) {
  return {
    constraintId: `requires-${selection.factorId}`,
    needTag: 'require-capability',
    factorId: selection.factorId,
    operator: 'equals',
    expectedValue: true,
    unresolvedStates: [...UNRESOLVED_OBSERVATION_STATES],
  };
}

function searchConstraint(selection) {
  return {
    constraintId: `requires-${selection.factorId}`,
    factorId: selection.factorId,
    locality: 'edge-local',
    edgeEvidenceRequirement: 'complete',
    operator: 'equals',
    expectedValue: true,
    routeAggregation: 'every-directed-edge',
    aggregationVersion: ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
    unresolvedStates: [...ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES],
    unresolvedDisposition: 'exclude-and-report',
  };
}

function softPreference(selection) {
  const binding = SOFT_BINDINGS[selection.needTag];
  return {
    preferenceId: binding.preferenceId,
    needTag: selection.needTag,
    factorId: binding.factorId,
    operator: 'minimize',
    rangeMin: selection.rangeMin,
    rangeMax: selection.rangeMax,
    weightBasisPoints: selection.weightBasisPoints,
  };
}

function traceEntry(selection, emitted) {
  const hard = selection.needTag === 'require-capability';
  const binding = hard
    ? { targetId: `requires-${selection.factorId}`, factorId: selection.factorId }
    : { targetId: SOFT_BINDINGS[selection.needTag].preferenceId, factorId: selection.factorId };
  return {
    selectionId: selection.selectionId,
    needTag: selection.needTag,
    resolution: selection.resolution,
    source: { ...selection.inputSelection },
    mapping: {
      targetKind: hard ? 'hard-constraint' : 'soft-preference',
      targetId: binding.targetId,
      factorId: binding.factorId,
      emittedTo: emitted
        ? hard
          ? ['decisionPolicy.hardConstraints', 'candidateSearchRequest.hardConstraints']
          : ['decisionPolicy.softPreferences']
        : [],
    },
  };
}

function mappingTrace(request, emitted) {
  return {
    schemaVersion: FUNCTIONAL_NEEDS_COMPILER_SCHEMA_VERSIONS.mappingTrace,
    compilerVersion: FUNCTIONAL_NEEDS_COMPILER_SCHEMA_VERSIONS.compiler,
    compilationId: request.compilationId,
    catalogId: request.catalog.catalogId,
    entries: request.selections.map((selection) => traceEntry(selection, emitted)),
  };
}

function resultWithContentIdentity(request, payload) {
  const requestIdentity = requestContentIdentity(request);
  const schemaVersion = FUNCTIONAL_NEEDS_COMPILER_SCHEMA_VERSIONS.compilationResult;
  const identity = contentIdentity('result', {
    schemaVersion,
    requestIdentity,
    status: payload.status,
    issues: payload.issues,
    mappingTrace: payload.mappingTrace,
    decisionPolicy: payload.decisionPolicy,
    candidateSearchRequest: payload.candidateSearchRequest,
    claimBoundary: payload.claimBoundary,
  });
  return deepFreeze({ schemaVersion, requestIdentity, identity, ...payload });
}

function unresolvedResult(request, issues) {
  return resultWithContentIdentity(request, {
    status: 'unresolved',
    issues,
    mappingTrace: mappingTrace(request, false),
    decisionPolicy: null,
    candidateSearchRequest: null,
    claimBoundary: CLAIM_BOUNDARY,
  });
}

function compiledResult(request) {
  const selected = request.selections.filter(({ resolution }) => resolution === 'selected');
  const hard = selected.filter(({ needTag }) => needTag === 'require-capability');
  const soft = selected.filter(({ needTag }) => needTag !== 'require-capability');
  const decisionPolicy = admitDecisionPolicy({
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.decisionPolicy,
    policyId: request.policyId,
    hardConstraints: hard.map(policyConstraint),
    softPreferences: soft.map(softPreference),
    weightBasisPointsTotal: 10_000,
    tieBreak: POLICY_TIE_BREAK.map((entry) => ({ ...entry })),
  });
  const candidateSearchRequest = admitRouteCandidateSearchRequest({
    schemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchRequest,
    ...request.search,
    decisionPolicyId: request.policyId,
    hardConstraints: hard.map(searchConstraint),
  });
  return resultWithContentIdentity(request, {
    status: 'compiled',
    issues: [],
    mappingTrace: mappingTrace(request, true),
    decisionPolicy,
    candidateSearchRequest,
    claimBoundary: CLAIM_BOUNDARY,
  });
}

export function compileFunctionalNeedsV1(raw) {
  assertCompileRequestRootShape(raw);
  const snapshotBudget = createSnapshotBudget();
  const snapshot = snapshotData(raw, 'FunctionalNeedsCompileRequest', snapshotBudget);
  const request = admitCompileRequest(snapshot);
  const issues = collectIssues(request.selections);
  return issues.length ? unresolvedResult(request, issues) : compiledResult(request);
}

export const DEFAULT_FUNCTIONAL_NEEDS_CATALOG_V1 = DEFAULT_TRAVEL_NEED_CATALOG;
