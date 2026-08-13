export const ROUTE_DECISION_BROWSER_DELIVERY_VERSION =
  'engagement-route-decision-browser-delivery/v1';
export const ROUTE_DECISION_BROWSER_DELIVERY_IDENTITY_VERSION =
  'engagement-route-decision-browser-delivery-identity/v1';
export const ROUTE_DECISION_BROWSER_DELIVERY_CANONICALIZATION =
  'route-decision-browser-delivery-canonical-json/v1';
export const ROUTE_DECISION_BROWSER_TERMINAL_TRUTH_TABLE_VERSION =
  'engagement-route-decision-browser-terminal-truth-table/v1';

const MAX_JSON_CODE_UNITS = 5_000_000;
const MAX_DEPTH = 64;
const MAX_ITEMS = 250_000;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const RUN_VERSION = 'engagement-route-decision-integration-run/v1';
const RUN_IDENTITY_VERSION = 'engagement-route-decision-integration-run-identity/v1';
const BINDING_VERSION = 'engagement-city-route-decision-binding/v1';
const BINDING_IDENTITY_VERSION = 'engagement-city-route-decision-binding-identity/v1';
const SOURCE_VERSION = 'engagement-philadelphia-synthetic-street-shape/v1';
const CITY_ADAPTER_VERSION = 'engagement-city-adapter/v2';
const CITY_ADAPTATION_RESULT_VERSION = 'engagement-city-adaptation-result/v2';
const GRAPH_VERSION = 'engagement-route-graph/v1';
const CANDIDATE_SET_VERSION = 'engagement-route-candidate-set/v3';
const SEARCH_RESULT_VERSION = 'engagement-route-candidate-search-result/v2';
const EXPLANATION_VERSION = 'route-decision-explanation/v1';
const PRESENTATION_VERSION = 'route-decision-explanation-presentation/v1';

const RUN_LIMITATIONS = Object.freeze([
  'deterministic-node-tooling-execution-only',
  'not-performance-authority',
  'not-external-graph-authority',
  'not-browser-or-worker-authenticity',
  'not-safety-or-safer-route-advice',
  'not-route-recommendation',
  'not-user-preference-evidence',
  'not-accessibility-outcome-evidence',
  'not-scientific-validity',
  'not-product-runtime-or-public-admission',
]);
const CITY_LIMITATIONS = Object.freeze([
  'synthetic-field-shape-only',
  'not-real-philadelphia-data',
  'not-product-or-public-admitted',
  'not-second-city-transferability-evidence',
  'digest-proves-json-internal-consistency-only',
  'digest-does-not-prove-source-history-authorization-or-transferability',
]);
const DELIVERY_LIMITATIONS = Object.freeze([
  'synthetic-evidence-only',
  'not-real-philadelphia-data',
  'not-product-or-public-admitted',
  'not-second-city-transferability-evidence',
  'unknown-unavailable-preserved-not-zero-or-false',
  'not-source-authenticity',
  'not-typed-recomputation',
  'not-performance-authority',
  'not-external-graph-authority',
  'not-product-admission',
]);
const DOES_NOT_PROVE = Object.freeze([
  'source-authenticity',
  'typed-recomputation',
  'performance-authority',
  'external-graph-authority',
  'product-admission',
]);
const PROHIBITED_CLAIM_TAGS = Object.freeze([
  'safe-route',
  'safer-route',
  'recommended-route',
  'risk-prediction',
  'accessibility-validated',
  'city-validated',
  'scientifically-validated',
  'user-research-validated',
  'production-validated',
]);
const EXPLANATION_LIMITATIONS = new Set([
  'synthetic-evidence-only',
  'provided-candidate-set-only',
  'bounded-search-scope-only',
  'route-search-completeness-not-proven',
  'route-search-stopped',
  'constraint-evidence-unknown',
  'constraint-evidence-unavailable',
  'constraint-evidence-partial',
  'constraint-evidence-stale',
  'constraint-evidence-invalid',
  'constraint-evidence-missing',
  'soft-contribution-not-decisive-cause',
  'counterfactual-effect-not-causal',
  'no-user-preference-inference',
  'no-accessibility-outcome-claim',
  'no-safety-claim',
]);
const SEARCH_STATUSES = new Set(['completed', 'stopped']);
const SEARCH_TERMINATIONS = new Set([
  'requested-candidate-count-reached',
  'bounded-search-space-exhausted',
  'no-directed-route-in-bounded-scope',
  'no-eligible-route-in-bounded-scope',
  'unresolved-constraint-evidence',
  'search-budget-exhausted',
  'search-capacity-exhausted',
]);
const COMPLETENESS_VALUES = new Set(['complete-within-bounds', 'not-proven']);
const CONSTRAINT_OUTCOMES = new Set([
  'not-required',
  'eligible-candidates-returned',
  'no-eligible-route-in-bounded-scope-proven',
  'no-eligible-route-not-proven',
  'unresolved-evidence',
  'not-evaluated',
]);
const UNRESOLVED_EVIDENCE_STATES = new Set([
  'unknown', 'unavailable',
]);
const BROWSER_PRESENTATION_SECTIONS = Object.freeze([
  'summary', 'claimBoundary', 'limitations',
]);

function fail(message) {
  throw new TypeError(`RouteDecisionBrowserDelivery/v1 contract: ${message}`);
}

function strictJsonParse(text) {
  if (typeof text !== 'string') {
    fail('input must be primitive JSON text; object, Proxy, getter, and descriptor inputs are forbidden');
  }
  if (text.length === 0 || text.length > MAX_JSON_CODE_UNITS) {
    fail('JSON text length is outside the supported range');
  }
  let cursor = 0;
  let itemCount = 0;

  function whitespace() {
    while (cursor < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[cursor])) cursor += 1;
  }

  function stringValue() {
    const start = cursor;
    cursor += 1;
    let escaped = false;
    while (cursor < text.length) {
      const code = text.charCodeAt(cursor);
      if (!escaped && code === 0x22) {
        cursor += 1;
        let value;
        try {
          value = JSON.parse(text.slice(start, cursor));
        } catch {
          fail('JSON string escape is invalid');
        }
        assertUnicodeScalarString(value, 'JSON string');
        return value;
      }
      if (!escaped && code < 0x20) fail('JSON strings must not contain raw control characters');
      if (escaped) escaped = false;
      else if (code === 0x5c) escaped = true;
      cursor += 1;
    }
    fail('JSON string is unterminated');
  }

  function value(depth) {
    if (depth > MAX_DEPTH) fail('JSON exceeds the supported nesting depth');
    whitespace();
    const token = text[cursor];
    if (token === '"') return stringValue();
    if (token === '{') return objectValue(depth + 1);
    if (token === '[') return arrayValue(depth + 1);
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, cursor)) {
        cursor += literal.length;
        return result;
      }
    }
    const match = text.slice(cursor).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) fail(`unexpected JSON token at code-unit offset ${cursor}`);
    cursor += match[0].length;
    const number = Number(match[0]);
    if (!Number.isSafeInteger(number) || Object.is(number, -0)) {
      fail('JSON numbers must be safe integers and must not be negative zero');
    }
    return number;
  }

  function objectValue(depth) {
    cursor += 1;
    whitespace();
    const result = {};
    const keys = new Set();
    if (text[cursor] === '}') {
      cursor += 1;
      return result;
    }
    while (cursor < text.length) {
      whitespace();
      if (text[cursor] !== '"') fail('JSON object key must be a string');
      const key = stringValue();
      if (BLOCKED_KEYS.has(key)) fail(`JSON object key ${key} is prohibited`);
      if (keys.has(key)) fail(`duplicate JSON object key ${key} is prohibited`);
      keys.add(key);
      itemCount += 1;
      if (itemCount > MAX_ITEMS) fail('JSON contains too many items');
      whitespace();
      if (text[cursor] !== ':') fail('JSON object key must be followed by a colon');
      cursor += 1;
      result[key] = value(depth);
      whitespace();
      if (text[cursor] === '}') {
        cursor += 1;
        return result;
      }
      if (text[cursor] !== ',') fail('JSON object entries must be comma separated');
      cursor += 1;
    }
    fail('JSON object is unterminated');
  }

  function arrayValue(depth) {
    cursor += 1;
    whitespace();
    const result = [];
    if (text[cursor] === ']') {
      cursor += 1;
      return result;
    }
    while (cursor < text.length) {
      itemCount += 1;
      if (itemCount > MAX_ITEMS) fail('JSON contains too many items');
      result.push(value(depth));
      whitespace();
      if (text[cursor] === ']') {
        cursor += 1;
        return result;
      }
      if (text[cursor] !== ',') fail('JSON array entries must be comma separated');
      cursor += 1;
    }
    fail('JSON array is unterminated');
  }

  const parsed = value(0);
  whitespace();
  if (cursor !== text.length) fail('JSON text contains trailing data');
  return parsed;
}

function assertUnicodeScalarString(value, label) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail(`${label} contains an unpaired surrogate`);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail(`${label} contains an unpaired surrogate`);
    }
  }
}

function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a JSON object`);
  }
  const actual = Object.keys(value);
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  const unknown = actual.filter((key) => !keys.includes(key));
  if (missing.length || unknown.length) {
    fail(`${label} schema mismatch (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`);
  }
  return value;
}

function exactString(value, expected, label) {
  if (value !== expected) fail(`${label} must equal ${expected}`);
}

function string(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`);
  assertUnicodeScalarString(value, label);
  return value;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be boolean`);
}

function safeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer`);
}

function exactArray(value, expected, label) {
  if (!Array.isArray(value) || value.length !== expected.length
    || value.some((entry, index) => entry !== expected[index])) {
    fail(`${label} must match the exact frozen vocabulary`);
  }
}

function uniqueStringArray(value, allowed, label) {
  if (!Array.isArray(value) || new Set(value).size !== value.length) {
    fail(`${label} must be a duplicate-free array`);
  }
  for (const entry of value) {
    string(entry, `${label} entry`);
    if (!allowed.has(entry)) fail(`${label} contains unsupported value ${entry}`);
  }
}

function identity(value, expectedVersion, expectedCanonicalization, label) {
  object(value, [
    'schemaVersion',
    'canonicalization',
    'digestAlgorithm',
    'canonicalUtf8Bytes',
    'digest',
  ], label);
  exactString(value.schemaVersion, expectedVersion, `${label}.schemaVersion`);
  exactString(value.canonicalization, expectedCanonicalization, `${label}.canonicalization`);
  exactString(value.digestAlgorithm, 'sha256', `${label}.digestAlgorithm`);
  safeInteger(value.canonicalUtf8Bytes, `${label}.canonicalUtf8Bytes`);
  if (value.canonicalUtf8Bytes === 0) fail(`${label}.canonicalUtf8Bytes must be positive`);
  if (typeof value.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value.digest)) {
    fail(`${label}.digest must be a lowercase sha256 digest`);
  }
}

function validateSerialization(value) {
  object(value, [
    'schemaVersion', 'mediaType', 'characterEncoding', 'canonicalization', 'inputContract',
  ], 'serialization');
  exactString(value.schemaVersion, 'engagement-route-decision-browser-serialization/v1',
    'serialization.schemaVersion');
  exactString(value.mediaType, 'application/json', 'serialization.mediaType');
  exactString(value.characterEncoding, 'utf-8', 'serialization.characterEncoding');
  exactString(value.canonicalization, ROUTE_DECISION_BROWSER_DELIVERY_CANONICALIZATION,
    'serialization.canonicalization');
  exactString(value.inputContract, 'primitive-json-text-only', 'serialization.inputContract');
}

function validateRun(value) {
  object(value, ['schemaVersion', 'identity'], 'run');
  exactString(value.schemaVersion, RUN_VERSION, 'run.schemaVersion');
  identity(value.identity, RUN_IDENTITY_VERSION,
    'route-decision-integration-run-canonical-json/v1', 'run.identity');
}

function validateProvenance(value) {
  object(value, [
    'schemaVersion',
    'bindingSchemaVersion',
    'bindingIdentity',
    'sourceGraphSchemaVersion',
    'sourceId',
    'sourceVersion',
    'sourceContentIdentity',
    'cityAdapterSchemaVersion',
    'cityAdapterVersion',
    'cityAdapterContentIdentity',
    'cityAdaptationResultSchemaVersion',
    'cityOutputContentIdentity',
    'graphArtifactSchemaVersion',
    'graphId',
    'graphArtifactVersion',
    'candidateSetSchemaVersion',
    'candidateSetId',
    'candidateSetRevision',
    'explanationInputRevision',
    'revisionsExactMatch',
  ], 'provenance');
  exactString(value.schemaVersion, 'engagement-route-decision-browser-provenance/v1',
    'provenance.schemaVersion');
  exactString(value.bindingSchemaVersion, BINDING_VERSION, 'provenance.bindingSchemaVersion');
  identity(value.bindingIdentity, BINDING_IDENTITY_VERSION,
    'city-route-decision-binding-canonical-json/v1', 'provenance.bindingIdentity');
  exactString(value.sourceGraphSchemaVersion, SOURCE_VERSION, 'provenance.sourceGraphSchemaVersion');
  string(value.sourceId, 'provenance.sourceId');
  string(value.sourceVersion, 'provenance.sourceVersion');
  identity(value.sourceContentIdentity, 'engagement-city-adapter-content-identity/v2',
    'city-adapter-canonical-source-sets/v2', 'provenance.sourceContentIdentity');
  exactString(value.cityAdapterSchemaVersion, CITY_ADAPTER_VERSION,
    'provenance.cityAdapterSchemaVersion');
  exactString(value.cityAdapterVersion, 'philadelphia-synthetic-city-adapter/v2',
    'provenance.cityAdapterVersion');
  identity(value.cityAdapterContentIdentity, 'engagement-city-adapter-content-identity/v2',
    'city-adapter-canonical-source-sets/v2', 'provenance.cityAdapterContentIdentity');
  exactString(value.cityAdaptationResultSchemaVersion, CITY_ADAPTATION_RESULT_VERSION,
    'provenance.cityAdaptationResultSchemaVersion');
  identity(value.cityOutputContentIdentity, 'engagement-city-adapter-content-identity/v2',
    'city-adapter-canonical-source-sets/v2', 'provenance.cityOutputContentIdentity');
  exactString(value.graphArtifactSchemaVersion, GRAPH_VERSION,
    'provenance.graphArtifactSchemaVersion');
  string(value.graphId, 'provenance.graphId');
  string(value.graphArtifactVersion, 'provenance.graphArtifactVersion');
  exactString(value.candidateSetSchemaVersion, CANDIDATE_SET_VERSION,
    'provenance.candidateSetSchemaVersion');
  string(value.candidateSetId, 'provenance.candidateSetId');
  string(value.candidateSetRevision, 'provenance.candidateSetRevision');
  string(value.explanationInputRevision, 'provenance.explanationInputRevision');
  if (value.revisionsExactMatch !== true
    || value.graphArtifactVersion !== value.candidateSetRevision
    || value.graphArtifactVersion !== value.explanationInputRevision) {
    fail('provenance revisions must be an exact graph/CandidateSet/explanation match');
  }
  if (!value.sourceId.startsWith('synthetic-')
    || !value.graphId.startsWith('philadelphia-pa-us:synthetic:')) {
    fail('provenance must remain explicitly Philadelphia-shaped synthetic data');
  }
}

function validateSearchTruth(value) {
  object(value, [
    'schemaVersion',
    'terminalTruthTableVersion',
    'searchResultSchemaVersion',
    'status',
    'termination',
    'candidateCount',
    'requestedCandidateCount',
    'hasConstraints',
    'searched',
    'stopped',
    'stoppedWithPartialExecution',
    'incomplete',
    'boundedSearchCompleteness',
    'fullSearchSpaceCompleteness',
    'constraintOutcome',
    'budgetOutcome',
    'capacityOutcome',
    'missingCoverageAccepted',
    'boundedNoEligibleRouteProven',
    'unresolvedEvidence',
    'requestedFactorStatesPresentInBoundGraph',
    'unknownUnavailablePolicy',
  ], 'searchTruth');
  exactString(value.schemaVersion, 'engagement-route-decision-browser-search-truth/v1',
    'searchTruth.schemaVersion');
  exactString(value.terminalTruthTableVersion,
    ROUTE_DECISION_BROWSER_TERMINAL_TRUTH_TABLE_VERSION,
    'searchTruth.terminalTruthTableVersion');
  exactString(value.searchResultSchemaVersion, SEARCH_RESULT_VERSION,
    'searchTruth.searchResultSchemaVersion');
  if (!SEARCH_STATUSES.has(value.status)) fail('searchTruth.status is unsupported');
  if (!SEARCH_TERMINATIONS.has(value.termination)) fail('searchTruth.termination is unsupported');
  safeInteger(value.candidateCount, 'searchTruth.candidateCount');
  safeInteger(value.requestedCandidateCount, 'searchTruth.requestedCandidateCount');
  if (value.requestedCandidateCount < 1 || value.requestedCandidateCount > 16
    || value.candidateCount > value.requestedCandidateCount) {
    fail('searchTruth candidate counts are outside the exact CandidateSet/v3 bounds');
  }
  for (const key of [
    'hasConstraints',
    'searched', 'stopped', 'stoppedWithPartialExecution', 'incomplete',
    'missingCoverageAccepted', 'boundedNoEligibleRouteProven', 'unresolvedEvidence',
  ]) boolean(value[key], `searchTruth.${key}`);
  if (!COMPLETENESS_VALUES.has(value.boundedSearchCompleteness)) {
    fail('searchTruth.boundedSearchCompleteness is unsupported');
  }
  exactString(value.fullSearchSpaceCompleteness, 'not-claimed',
    'searchTruth.fullSearchSpaceCompleteness');
  if (!CONSTRAINT_OUTCOMES.has(value.constraintOutcome)) {
    fail('searchTruth.constraintOutcome is unsupported');
  }
  if (!['within-budget', 'exhausted'].includes(value.budgetOutcome)) {
    fail('searchTruth.budgetOutcome is unsupported');
  }
  if (!['within-capacity', 'exhausted'].includes(value.capacityOutcome)) {
    fail('searchTruth.capacityOutcome is unsupported');
  }
  uniqueStringArray(value.requestedFactorStatesPresentInBoundGraph, UNRESOLVED_EVIDENCE_STATES,
    'searchTruth.requestedFactorStatesPresentInBoundGraph');
  const sortedStates = [...value.requestedFactorStatesPresentInBoundGraph].sort(compareCodeUnits);
  if (sortedStates.some((entry, index) => (
    entry !== value.requestedFactorStatesPresentInBoundGraph[index]
  ))) {
    fail('searchTruth.requestedFactorStatesPresentInBoundGraph must use deterministic code-unit order');
  }
  exactString(value.unknownUnavailablePolicy, 'preserve-unresolved-never-false-zero-or-complete',
    'searchTruth.unknownUnavailablePolicy');
  const stopped = value.status === 'stopped';
  const incomplete = value.boundedSearchCompleteness !== 'complete-within-bounds';
  const boundedProof = value.termination === 'no-eligible-route-in-bounded-scope'
    && value.boundedSearchCompleteness === 'complete-within-bounds'
    && value.constraintOutcome === 'no-eligible-route-in-bounded-scope-proven';
  if (value.searched !== true || value.stopped !== stopped
    || value.stoppedWithPartialExecution !== stopped || value.incomplete !== incomplete
    || value.missingCoverageAccepted !== false
    || value.boundedNoEligibleRouteProven !== boundedProof
    || value.unresolvedEvidence !== (value.constraintOutcome === 'unresolved-evidence')) {
    fail('searchTruth fields are internally inconsistent');
  }
  if (value.unresolvedEvidence && value.requestedFactorStatesPresentInBoundGraph.length === 0) {
    fail('unresolved search truth must retain requested-factor states present in the bound graph');
  }
  if (!value.hasConstraints && value.requestedFactorStatesPresentInBoundGraph.length > 0) {
    fail('unconstrained search truth cannot report requested-factor states in the bound graph');
  }
  if (stopped && !incomplete) fail('stopped partial execution cannot claim bounded completeness');
  validateTerminalTruth(value);
}

function validateTerminalTruth(value) {
  const {
    status,
    termination,
    candidateCount: count,
    requestedCandidateCount: requested,
    hasConstraints,
    boundedSearchCompleteness: completeness,
    constraintOutcome,
    budgetOutcome,
    capacityOutcome,
  } = value;
  if (!hasConstraints && constraintOutcome !== 'not-required') {
    fail('unconstrained terminal must have constraintOutcome=not-required');
  }
  if (hasConstraints && constraintOutcome === 'not-required') {
    fail('constrained terminal cannot have constraintOutcome=not-required');
  }
  if (count > 0 && [
    'no-eligible-route-in-bounded-scope-proven',
    'no-eligible-route-not-proven',
    'not-evaluated',
  ].includes(constraintOutcome)) {
    fail('positive candidate count conflicts with constraintOutcome');
  }
  if (count === 0 && constraintOutcome === 'eligible-candidates-returned') {
    fail('eligible-candidates-returned requires a positive candidate count');
  }

  const completedWithinResources = status === 'completed'
    && budgetOutcome === 'within-budget'
    && capacityOutcome === 'within-capacity';
  let reachable = false;
  if (termination === 'requested-candidate-count-reached') {
    reachable = completedWithinResources
      && count === requested
      && completeness === 'not-proven'
      && constraintOutcome === (hasConstraints ? 'eligible-candidates-returned' : 'not-required');
  } else if (termination === 'bounded-search-space-exhausted') {
    reachable = completedWithinResources
      && count > 0
      && count < requested
      && completeness === 'complete-within-bounds'
      && constraintOutcome === (hasConstraints ? 'eligible-candidates-returned' : 'not-required');
  } else if (termination === 'no-directed-route-in-bounded-scope') {
    reachable = completedWithinResources
      && count === 0
      && completeness === 'complete-within-bounds'
      && constraintOutcome === (hasConstraints ? 'not-evaluated' : 'not-required');
  } else if (termination === 'no-eligible-route-in-bounded-scope') {
    reachable = completedWithinResources
      && count === 0
      && completeness === 'complete-within-bounds'
      && hasConstraints
      && constraintOutcome === 'no-eligible-route-in-bounded-scope-proven';
  } else if (termination === 'unresolved-constraint-evidence') {
    reachable = completedWithinResources
      && count < requested
      && completeness === 'complete-within-bounds'
      && hasConstraints
      && constraintOutcome === 'unresolved-evidence';
  } else if (termination === 'search-budget-exhausted') {
    reachable = status === 'stopped'
      && count < requested
      && completeness === 'not-proven'
      && budgetOutcome === 'exhausted'
      && capacityOutcome === 'within-capacity'
      && resourceStopConstraintOutcomeReachable(count, hasConstraints, constraintOutcome);
  } else if (termination === 'search-capacity-exhausted') {
    reachable = status === 'stopped'
      && count < requested
      && completeness === 'not-proven'
      && budgetOutcome === 'within-budget'
      && capacityOutcome === 'exhausted'
      && resourceStopConstraintOutcomeReachable(count, hasConstraints, constraintOutcome);
  }
  if (!reachable) {
    fail(`terminal tuple is unreachable under ${ROUTE_DECISION_BROWSER_TERMINAL_TRUTH_TABLE_VERSION}`);
  }
}

function resourceStopConstraintOutcomeReachable(count, hasConstraints, outcome) {
  if (!hasConstraints) return outcome === 'not-required';
  if (count > 0) return outcome === 'eligible-candidates-returned'
    || outcome === 'unresolved-evidence';
  return outcome === 'no-eligible-route-not-proven' || outcome === 'unresolved-evidence';
}

function validateExplanation(value) {
  object(value, [
    'schemaVersion',
    'presentationSchemaVersion',
    'textComplete',
    'mapOptional',
    'noClaimInterpretation',
    'prohibitedClaimTags',
  ], 'explanation');
  exactString(value.schemaVersion, EXPLANATION_VERSION, 'explanation.schemaVersion');
  exactString(value.presentationSchemaVersion, PRESENTATION_VERSION,
    'explanation.presentationSchemaVersion');
  if (value.textComplete !== true || value.mapOptional !== true) {
    fail('explanation must be text-complete and map-optional');
  }
  exactString(value.noClaimInterpretation, 'no-claim-eligible-from-explanation-v1',
    'explanation.noClaimInterpretation');
  exactArray(value.prohibitedClaimTags, PROHIBITED_CLAIM_TAGS,
    'explanation.prohibitedClaimTags');
}

function validateClaimBoundary(value) {
  object(value, ['schemaVersion', 'eligibleClaims', 'limitations'], 'claimBoundary');
  exactString(value.schemaVersion, 'engagement-route-decision-integration-run-claim-boundary/v1',
    'claimBoundary.schemaVersion');
  exactArray(value.eligibleClaims, ['deterministic-execution-for-exact-admitted-inputs'],
    'claimBoundary.eligibleClaims');
  exactArray(value.limitations, RUN_LIMITATIONS, 'claimBoundary.limitations');
}

function expectedExplanationLimitations(searchTruth) {
  const expected = [
    'synthetic-evidence-only',
    ...(searchTruth.candidateCount > 0 ? ['provided-candidate-set-only'] : []),
    'bounded-search-scope-only',
    'soft-contribution-not-decisive-cause',
    'counterfactual-effect-not-causal',
    'no-user-preference-inference',
    'no-accessibility-outcome-claim',
    'no-safety-claim',
  ];
  if (searchTruth.boundedSearchCompleteness === 'not-proven') {
    expected.push('route-search-completeness-not-proven');
  }
  if (searchTruth.stopped) expected.push('route-search-stopped');
  for (const state of searchTruth.requestedFactorStatesPresentInBoundGraph) {
    expected.push(`constraint-evidence-${state}`);
  }
  return expected;
}

function validateLimitations(value, searchTruth) {
  object(value, [
    'schemaVersion',
    'cityAdapterLimitations',
    'runLimitations',
    'explanationLimitations',
    'deliveryLimitations',
  ], 'limitations');
  exactString(value.schemaVersion, 'engagement-route-decision-browser-limitations/v1',
    'limitations.schemaVersion');
  exactArray(value.cityAdapterLimitations, CITY_LIMITATIONS, 'limitations.cityAdapterLimitations');
  exactArray(value.runLimitations, RUN_LIMITATIONS, 'limitations.runLimitations');
  uniqueStringArray(value.explanationLimitations, EXPLANATION_LIMITATIONS,
    'limitations.explanationLimitations');
  exactArray(value.explanationLimitations, expectedExplanationLimitations(searchTruth),
    'limitations.explanationLimitations');
  exactArray(value.deliveryLimitations, DELIVERY_LIMITATIONS,
    'limitations.deliveryLimitations');
}

function validateAdmissionBoundary(value) {
  object(value, ['schemaVersion', 'proves', 'doesNotProve'], 'admissionBoundary');
  exactString(value.schemaVersion, 'engagement-route-decision-browser-admission-boundary/v1',
    'admissionBoundary.schemaVersion');
  exactArray(value.proves, [
    'serialized-json-internal-consistency',
    'delivery-content-identity-match',
  ], 'admissionBoundary.proves');
  exactArray(value.doesNotProve, DOES_NOT_PROVE, 'admissionBoundary.doesNotProve');
}

function presentationLine(code, text) {
  return { code, text };
}

function displayLimitationCodes(limitations) {
  return [...new Set([
    ...limitations.cityAdapterLimitations,
    ...limitations.runLimitations,
    ...limitations.explanationLimitations,
    ...limitations.deliveryLimitations,
  ])];
}

function expectedDisplayModel(searchTruth, provenance, limitations) {
  const limitationCodes = displayLimitationCodes(limitations);
  const summary = [
    presentationLine(
      'search-terminal',
      `Search status: ${searchTruth.status}; termination: ${searchTruth.termination}.`,
    ),
    presentationLine(
      'candidate-count',
      `Returned candidates: ${searchTruth.candidateCount}; requested candidates: ${searchTruth.requestedCandidateCount}.`,
    ),
    presentationLine(
      'bounded-completeness',
      `Bounded search completeness: ${searchTruth.boundedSearchCompleteness}; full search space completeness: not claimed.`,
    ),
    presentationLine(
      'constraint-outcome',
      `Constraints present: ${searchTruth.hasConstraints ? 'yes' : 'no'}; outcome: ${searchTruth.constraintOutcome}; unresolved evidence: ${searchTruth.unresolvedEvidence ? 'yes' : 'no'}.`,
    ),
    presentationLine(
      'resource-outcomes',
      `Search budget: ${searchTruth.budgetOutcome}; search capacity: ${searchTruth.capacityOutcome}.`,
    ),
    presentationLine(
      'bound-graph-requested-factor-states',
      `Requested-factor unresolved states present anywhere in the bound graph: ${searchTruth.requestedFactorStatesPresentInBoundGraph.length ? searchTruth.requestedFactorStatesPresentInBoundGraph.join(', ') : 'none'}. This is conservative graph-wide disclosure, not a terminal cause.`,
    ),
    presentationLine(
      'revision-binding',
      `Graph, candidate set, and explanation revisions are exactly bound: ${provenance.graphArtifactVersion}.`,
    ),
  ];
  return {
    schemaVersion: 'engagement-route-decision-browser-display-model/v1',
    sourcePresentationSchemaVersion: PRESENTATION_VERSION,
    sourcePresentationRelationship: 'source-fact-contract-only-not-full-s4-presentation-projection',
    displayCompletenessScope: 'browser-boundary-summary/v1',
    textCompleteForBoundarySummary: true,
    mapOptional: true,
    mapModel: null,
    sections: {
      summary,
      claimBoundary: [
        presentationLine(
          'no-claim-eligible-from-explanation-v1',
          'No route outcome claim is admitted from this browser delivery.',
        ),
        presentationLine(
          'browser-admission-boundary',
          'Browser admission proves serialized internal consistency only; it does not prove source, authority, or product status.',
        ),
      ],
      limitations: limitationCodes.map((code) => (
        presentationLine(code, `Limitation: ${code}.`)
      )),
    },
  };
}

function validateDisplayModel(value, searchTruth, provenance, limitations) {
  object(value, [
    'schemaVersion',
    'sourcePresentationSchemaVersion',
    'sourcePresentationRelationship',
    'displayCompletenessScope',
    'textCompleteForBoundarySummary',
    'mapOptional',
    'mapModel',
    'sections',
  ], 'displayModel');
  exactString(value.schemaVersion, 'engagement-route-decision-browser-display-model/v1',
    'displayModel.schemaVersion');
  exactString(value.sourcePresentationSchemaVersion, PRESENTATION_VERSION,
    'displayModel.sourcePresentationSchemaVersion');
  exactString(
    value.sourcePresentationRelationship,
    'source-fact-contract-only-not-full-s4-presentation-projection',
    'displayModel.sourcePresentationRelationship',
  );
  exactString(value.displayCompletenessScope, 'browser-boundary-summary/v1',
    'displayModel.displayCompletenessScope');
  if (value.textCompleteForBoundarySummary !== true || value.mapOptional !== true) {
    fail('displayModel must be complete for its boundary-summary scope and map-optional');
  }
  if (value.mapModel !== null) fail('displayModel.mapModel must be null');
  const sections = object(value.sections, BROWSER_PRESENTATION_SECTIONS,
    'displayModel.sections');
  for (const sectionName of BROWSER_PRESENTATION_SECTIONS) {
    const lines = sections[sectionName];
    if (!Array.isArray(lines)) fail(`displayModel section ${sectionName} must be an array`);
    for (const [index, line] of lines.entries()) {
      object(line, ['code', 'text'], `displayModel.${sectionName}[${index}]`);
      string(line.code, `displayModel.${sectionName}[${index}].code`);
      string(line.text, `displayModel.${sectionName}[${index}].text`);
    }
  }
  const expected = expectedDisplayModel(searchTruth, provenance, limitations);
  if (canonicalStringify(value) !== canonicalStringify(expected)) {
    fail('displayModel must exactly match browser-local deterministic templates');
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort(compareCodeUnits)
    .map((key) => [key, canonicalize(value[key])]));
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sha256(bytes) {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15];
      const y = words[index - 2];
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}

function rotateRight(value, amount) {
  return (value >>> amount) | (value << (32 - amount));
}

function validateDelivery(value) {
  object(value, [
    'schemaVersion',
    'serialization',
    'run',
    'provenance',
    'searchTruth',
    'explanation',
    'claimBoundary',
    'limitations',
    'admissionBoundary',
    'displayModel',
    'deliveryIdentity',
  ], 'delivery');
  exactString(value.schemaVersion, ROUTE_DECISION_BROWSER_DELIVERY_VERSION,
    'delivery.schemaVersion');
  validateSerialization(value.serialization);
  validateRun(value.run);
  validateProvenance(value.provenance);
  validateSearchTruth(value.searchTruth);
  validateExplanation(value.explanation);
  validateClaimBoundary(value.claimBoundary);
  validateLimitations(value.limitations, value.searchTruth);
  validateAdmissionBoundary(value.admissionBoundary);
  validateDisplayModel(
    value.displayModel,
    value.searchTruth,
    value.provenance,
    value.limitations,
  );
  identity(value.deliveryIdentity, ROUTE_DECISION_BROWSER_DELIVERY_IDENTITY_VERSION,
    ROUTE_DECISION_BROWSER_DELIVERY_CANONICALIZATION, 'delivery.deliveryIdentity');
  if (value.explanation.presentationSchemaVersion
    !== value.displayModel.sourcePresentationSchemaVersion) {
    fail('explanation and display source presentation schema versions must match');
  }
  if (value.claimBoundary.limitations.join('\u0000')
    !== value.limitations.runLimitations.join('\u0000')) {
    fail('claimBoundary and limitations must bind the same run limitations');
  }
  const projection = { ...value };
  delete projection.deliveryIdentity;
  const canonical = canonicalStringify(projection);
  const bytes = new TextEncoder().encode(canonical);
  const digest = `sha256:${sha256(bytes)}`;
  if (value.deliveryIdentity.canonicalUtf8Bytes !== bytes.length
    || value.deliveryIdentity.digest !== digest) {
    fail('delivery content identity does not match the exact serialized data projection');
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Admit only primitive JSON text. Starting from text is the browser boundary:
 * caller objects, including Proxy/getter/descriptor variants, are never read.
 * This proves schema/internal-identity consistency only, not upstream authority.
 */
export function parseRouteDecisionBrowserDelivery(serializedJson) {
  const value = strictJsonParse(serializedJson);
  validateDelivery(value);
  return deepFreeze(value);
}
