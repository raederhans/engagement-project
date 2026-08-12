import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  ROUTE_GOLDEN_S2_CAPACITY_POLICY,
  ROUTE_GOLDEN_S2_EXPANDED_STATE_UNIT,
  ROUTE_GOLDEN_S2_GRAPH_SCHEMA_VERSION,
  ROUTE_GOLDEN_S2_ORACLE_CONTRACT_VERSION,
  solveS2GoldenReference,
} from './route_golden_s2_oracle.mjs';
import {
  admitRouteCandidateSearchResult,
} from '../../src/route_decision/contracts/candidate_search_v2.js';

export const ROUTE_GOLDEN_S2_MANIFEST_SCHEMA_VERSION = 'route-golden-s2-manifest/v2';
export const ROUTE_GOLDEN_S2_CASE_SCHEMA_VERSION = 'route-golden-s2-case/v2';
export const ROUTE_GOLDEN_S2_FIXTURE_SET_VERSION = 'synthetic-route-generation-s2/v2';
export const ROUTE_GOLDEN_S2_LEDGER_SCHEMA_VERSION = 'route-golden-s2-ledger/v2';
export const ROUTE_GOLDEN_S2_DENOMINATORS = Object.freeze([
  'conformance',
  'primary',
  'terminals',
  'alternatives',
  'constraints',
  'budget',
  'capacity',
  'completeness',
]);
export const DEFAULT_ROUTE_GOLDEN_S2_MANIFEST_URL = new URL(
  '../tests/fixtures/route_generation_s2/manifest.json',
  import.meta.url,
).href;

const CASE_KEYS = Object.freeze([
  'schemaVersion', 'fixtureSetVersion', 'caseId', 'title', 'input', 'expected',
]);

export class S2GoldenFixtureError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'S2GoldenFixtureError';
    this.code = code;
  }
}

export function validateS2GoldenManifest(value) {
  requirePlainDataObject(value, 'manifest-invalid', 'S2 Golden manifest');
  requireExactKeys(value, [
    'schemaVersion', 'fixtureSetVersion', 'oracleContractVersion', 'expandedStateUnit',
    'cases', 'cohorts', 'expectedCounts',
  ], 'manifest-keys-invalid', 'S2 Golden manifest');
  requireEqual(value.schemaVersion, ROUTE_GOLDEN_S2_MANIFEST_SCHEMA_VERSION,
    'manifest-schema-version-unsupported', 'S2 Golden manifest schemaVersion is unsupported');
  requireEqual(value.fixtureSetVersion, ROUTE_GOLDEN_S2_FIXTURE_SET_VERSION,
    'fixture-set-version-unsupported', 'S2 Golden fixtureSetVersion is unsupported');
  requireEqual(value.oracleContractVersion, ROUTE_GOLDEN_S2_ORACLE_CONTRACT_VERSION,
    'oracle-contract-version-mismatch', 'S2 Golden oracle contract does not match');
  if (!isDeepStrictEqual(value.expandedStateUnit, ROUTE_GOLDEN_S2_EXPANDED_STATE_UNIT)) {
    throw fixtureError('expanded-state-unit-mismatch', 'S2 Golden expansion unit does not match');
  }

  const cases = requireDataArray(value.cases, 'manifest-cases-invalid', 'S2 Golden cases');
  const caseIds = new Set();
  for (const reference of cases) {
    requirePlainDataObject(reference, 'manifest-case-invalid', 'S2 Golden case reference');
    requireExactKeys(reference, ['caseId', 'file'], 'manifest-case-invalid', 'S2 Golden case reference');
    requireId(reference.caseId, 'manifest-case-id-invalid', 'S2 Golden caseId');
    requireSafeFixturePath(reference.file);
    if (caseIds.has(reference.caseId)) {
      throw fixtureError('manifest-case-id-duplicate', `Duplicate S2 Golden caseId: ${reference.caseId}`);
    }
    caseIds.add(reference.caseId);
  }

  requirePlainDataObject(value.cohorts, 'manifest-cohorts-invalid', 'S2 Golden cohorts');
  requireExactKeys(value.cohorts, ROUTE_GOLDEN_S2_DENOMINATORS,
    'manifest-cohorts-invalid', 'S2 Golden cohorts');
  requirePlainDataObject(value.expectedCounts, 'manifest-counts-invalid', 'S2 Golden expectedCounts');
  requireExactKeys(value.expectedCounts, [...ROUTE_GOLDEN_S2_DENOMINATORS, 'totalCases'],
    'manifest-counts-invalid', 'S2 Golden expectedCounts');

  const membership = new Map([...caseIds].map((caseId) => [caseId, []]));
  for (const denominator of ROUTE_GOLDEN_S2_DENOMINATORS) {
    const members = requireDataArray(
      value.cohorts[denominator],
      'manifest-cohort-invalid',
      `S2 Golden ${denominator} cohort`,
    );
    if (new Set(members).size !== members.length) {
      throw fixtureError('manifest-cohort-duplicate', `${denominator} cohort contains duplicates`);
    }
    for (const caseId of members) {
      if (!caseIds.has(caseId)) {
        throw fixtureError('manifest-cohort-case-missing', `${denominator} references unknown case ${caseId}`);
      }
      membership.get(caseId).push(denominator);
    }
    if (value.expectedCounts[denominator] !== members.length) {
      throw fixtureError('manifest-count-mismatch', `${denominator} count does not match inventory`);
    }
  }
  if (value.expectedCounts.totalCases !== cases.length) {
    throw fixtureError('manifest-count-mismatch', 'totalCases does not match inventory');
  }
  for (const [caseId, memberships] of membership) {
    if (memberships.length === 0) {
      throw fixtureError('manifest-case-unclassified', `S2 Golden case has no denominator: ${caseId}`);
    }
  }
  return freezeClone(value);
}

export function validateS2GoldenCase(value, { manifest, caseReference } = {}) {
  requirePlainDataObject(value, 'fixture-invalid', 'S2 Golden case');
  requireExactKeys(value, CASE_KEYS, 'fixture-keys-invalid', 'S2 Golden case');
  requireEqual(value.schemaVersion, ROUTE_GOLDEN_S2_CASE_SCHEMA_VERSION,
    'fixture-schema-version-unsupported', 'S2 Golden case schemaVersion is unsupported');
  requireEqual(value.fixtureSetVersion, manifest?.fixtureSetVersion,
    'fixture-set-version-mismatch', 'S2 Golden case fixtureSetVersion does not match');
  requireEqual(value.caseId, caseReference?.caseId,
    'fixture-case-id-mismatch', 'S2 Golden caseId does not match manifest');
  requireId(value.caseId, 'fixture-case-id-invalid', 'S2 Golden caseId');
  requireNonEmptyText(value.title, 'fixture-title-invalid', 'S2 Golden title');
  validateFixtureInputShape(value.input);
  requireJsonData(value.expected, 'fixture-expected-invalid', 'S2 Golden expected result');
  const oracleOutcome = solveS2GoldenReference(value.input);
  if (!isDeepStrictEqual(value.expected, oracleOutcome)) {
    throw fixtureError('fixture-oracle-mismatch', `${value.caseId} expected result does not match the independent oracle`);
  }
  return freezeClone(value);
}

export async function loadS2GoldenFixtureSet({
  manifestUrl = DEFAULT_ROUTE_GOLDEN_S2_MANIFEST_URL,
  loadJson = readJson,
} = {}) {
  const resolvedManifestUrl = resolveManifestUrl(manifestUrl);
  const manifest = validateS2GoldenManifest(await loadJson(resolvedManifestUrl));
  const root = new URL('./', resolvedManifestUrl);
  const cases = [];
  for (const caseReference of manifest.cases) {
    const fixture = validateS2GoldenCase(
      await loadJson(resolveFixtureUrl(root, caseReference.file)),
      { manifest, caseReference },
    );
    cases.push(freezeClone({
      caseReference,
      cohorts: denominatorMemberships(manifest, fixture.caseId),
      fixture,
    }));
  }
  return freezeClone({ manifest, cases });
}

export async function runS2GoldenCases({
  solve,
  solverId = 'injected-s2-solver',
  expandedStateUnit = ROUTE_GOLDEN_S2_EXPANDED_STATE_UNIT,
  manifestUrl = DEFAULT_ROUTE_GOLDEN_S2_MANIFEST_URL,
  loadJson = readJson,
} = {}) {
  if (typeof solve !== 'function') throw new TypeError('runS2GoldenCases solve must be a function');
  requireNonEmptyText(solverId, 'solver-id-invalid', 'S2 Golden solverId');
  const resolvedManifestUrl = resolveManifestUrl(manifestUrl);
  const manifest = validateS2GoldenManifest(await loadJson(resolvedManifestUrl));
  const root = new URL('./', resolvedManifestUrl);
  const entries = [];

  for (const caseReference of manifest.cases) {
    const cohorts = denominatorMemberships(manifest, caseReference.caseId);
    let rawFixture;
    try {
      rawFixture = await loadJson(resolveFixtureUrl(root, caseReference.file));
    } catch (error) {
      entries.push(fixtureFailureEntry(caseReference, cohorts, 'fixture-load-error', error));
      continue;
    }
    let fixture;
    try {
      fixture = validateS2GoldenCase(rawFixture, { manifest, caseReference });
    } catch (error) {
      entries.push(fixtureFailureEntry(caseReference, cohorts, 'fixture-invalid', error));
      continue;
    }
    entries.push(await runOneCase({ solve, fixture, cohorts, expandedStateUnit }));
  }

  const denominators = {};
  for (const denominator of ROUTE_GOLDEN_S2_DENOMINATORS) {
    const scoped = entries.filter(({ cohorts }) => cohorts.includes(denominator));
    const passed = scoped.filter(({ checks }) => checks[denominator] === 'pass').length;
    denominators[denominator] = {
      denominator: scoped.length,
      passed,
      failed: scoped.length - passed,
    };
  }
  const passedCases = entries.filter(({ verdict }) => verdict === 'pass').length;
  return freezeClone({
    schemaVersion: ROUTE_GOLDEN_S2_LEDGER_SCHEMA_VERSION,
    fixtureSetVersion: manifest.fixtureSetVersion,
    oracleContractVersion: manifest.oracleContractVersion,
    solverId,
    expandedStateUnit: normalizeJson(expandedStateUnit),
    entries,
    summary: {
      totalCases: entries.length,
      terminalLedgerEntries: entries.filter(({ terminalOutcome }) => terminalOutcome !== null).length,
      passedCases,
      failedCases: entries.length - passedCases,
      denominators,
    },
  });
}

async function runOneCase({ solve, fixture, cohorts, expandedStateUnit }) {
  const rounds = [
    await invokeSolver(solve, fixture.input),
    await invokeSolver(solve, fixture.input),
  ];
  const byteDeterministic = rounds[0].bytes !== null && rounds[0].bytes === rounds[1].bytes;
  const failureClasses = new Set();
  for (const round of rounds) for (const failure of round.failureClasses) failureClasses.add(failure);
  if (!byteDeterministic) failureClasses.add('nondeterministic-bytes');
  const stableContractResult = byteDeterministic
    && rounds.every(({ admitted }) => admitted !== null);
  let canonical = null;
  let topologyFailures = [];
  if (stableContractResult) {
    const projection = canonicalizeProductOutcome(rounds[0].admitted, fixture.input.graph);
    canonical = projection.outcome;
    topologyFailures = projection.failureClasses;
    for (const failure of topologyFailures) failureClasses.add(failure);
  }

  const checks = {
    fixtureIntegrity: 'pass',
    byteDeterminism: byteDeterministic ? 'pass' : 'fail',
    solverContract: stableContractResult ? 'pass' : 'fail',
    ...Object.fromEntries(ROUTE_GOLDEN_S2_DENOMINATORS.map((name) => [
      name,
      cohorts.includes(name) ? 'not-run' : 'not-applicable',
    ])),
  };
  if (stableContractResult && topologyFailures.length === 0) {
    for (const denominator of cohorts) {
      checks[denominator] = evaluateDenominator(
        denominator,
        canonical,
        fixture.expected,
        expandedStateUnit,
      ) ? 'pass' : 'fail';
      if (checks[denominator] === 'fail') failureClasses.add(`${denominator}-mismatch`);
    }
  } else {
    for (const denominator of cohorts) checks[denominator] = 'fail';
  }
  const orderedFailures = [...failureClasses].sort(compareText);
  return freezeClone({
    caseId: fixture.caseId,
    cohorts,
    terminalOutcome: canonical
      ? { status: canonical.status, termination: canonical.termination }
      : { status: 'solver-error', termination: 'harness-solver-failure' },
    verdict: orderedFailures.length === 0 ? 'pass' : 'fail',
    failureClasses: orderedFailures,
    checks,
    runs: rounds.map(publicRound),
  });
}

async function invokeSolver(solve, input) {
  let returned;
  try {
    returned = await solve(structuredClone(input));
  } catch (error) {
    return {
      bytes: null,
      returned: null,
      admitted: null,
      error: stableError(error),
      failureClasses: ['solver-threw'],
    };
  }
  let bytes;
  try {
    bytes = JSON.stringify(returned);
    if (bytes === undefined) throw new TypeError('result is not JSON serializable');
  } catch {
    return {
      bytes: null,
      returned: null,
      admitted: null,
      error: null,
      failureClasses: ['solver-result-not-json'],
    };
  }
  let admitted;
  try {
    admitted = admitRouteCandidateSearchResult(returned);
  } catch (error) {
    return {
      bytes,
      returned: normalizeJson(returned),
      admitted: null,
      error: stableError(error),
      failureClasses: ['solver-result-contract-invalid'],
    };
  }
  return {
    bytes,
    returned: normalizeJson(returned),
    admitted,
    error: null,
    failureClasses: [],
  };
}

export function canonicalizeS2GoldenProductOutcome(result, graph) {
  const admitted = admitRouteCandidateSearchResult(result);
  return freezeClone(canonicalizeProductOutcome(admitted, graph));
}

function canonicalizeProductOutcome(result, graph) {
  const failureClasses = [];
  const request = result.request;
  const routes = result.candidateFacts.map((candidate) => {
    const inspection = inspectRoute(candidate, graph, request);
    failureClasses.push(...inspection.failureClasses);
    const observations = Object.fromEntries((request?.hardConstraints || []).map(({ factorId }) => {
      const observation = candidate.observations[factorId];
      return [factorId, observation
        ? { state: observation.state, value: observation.value }
        : null];
    }));
    return {
      edgeIds: [...candidate.edgeIds],
      nodeIds: inspection.nodeIds,
      distanceMm: candidate.distanceMm,
      objectiveCostUnits: candidate.objectiveCostUnits,
      observations,
    };
  });
  return {
    outcome: {
      status: result.status,
      termination: result.termination,
      routes,
      search: result.candidateSet ? {
        requestedCandidateCount: result.candidateSet.requestedCandidateCount,
        candidateCount: result.candidateSet.candidateCount,
        expandedStateCount: result.candidateSet.expandedStateCount,
        completeness: { ...result.candidateSet.completeness },
        constraintOutcome: result.candidateSet.constraintOutcome,
        budgetOutcome: result.candidateSet.budgetOutcome,
        capacityPolicy: { ...result.candidateSet.capacityPolicy },
        capacityOutcome: result.candidateSet.capacityOutcome,
      } : null,
    },
    failureClasses: [...new Set(failureClasses)].sort(compareText),
  };
}

function inspectRoute(candidate, graph, request) {
  const edgeById = new Map(graph.edges.map((edge) => [edge.edgeId, edge]));
  const nodeIds = [request.originNodeId];
  let current = request.originNodeId;
  let distanceMm = 0;
  let objectiveCostUnits = 0;
  const failures = [];
  for (const edgeId of candidate.edgeIds) {
    const edge = edgeById.get(edgeId);
    if (!edge) {
      failures.push('route-edge-missing');
      continue;
    }
    if (edge.fromNodeId !== current) failures.push('route-discontinuous');
    current = edge.toNodeId;
    nodeIds.push(current);
    distanceMm += edge.distanceMm;
    objectiveCostUnits += edge.objectiveCostUnits;
  }
  if (current !== request.destinationNodeId) failures.push('route-wrong-destination');
  if (distanceMm !== candidate.distanceMm) failures.push('route-distance-mismatch');
  if (objectiveCostUnits !== candidate.objectiveCostUnits) failures.push('route-cost-mismatch');
  return { nodeIds, failureClasses: failures };
}

function evaluateDenominator(name, actual, expected, expandedStateUnit) {
  if (name === 'conformance') return isDeepStrictEqual(actual, expected);
  if (name === 'terminals') {
    return actual.status === expected.status && actual.termination === expected.termination;
  }
  if (name === 'primary') return isDeepStrictEqual(actual.routes[0], expected.routes[0]);
  if (name === 'alternatives') {
    return isDeepStrictEqual(actual.routes, expected.routes)
      && actual.search?.candidateCount === expected.search?.candidateCount
      && actual.search?.requestedCandidateCount === expected.search?.requestedCandidateCount;
  }
  if (name === 'constraints') {
    return actual.search?.constraintOutcome === expected.search?.constraintOutcome
      && isDeepStrictEqual(
        actual.routes.map(({ observations }) => observations),
        expected.routes.map(({ observations }) => observations),
      );
  }
  if (name === 'budget') {
    return isDeepStrictEqual(expandedStateUnit, ROUTE_GOLDEN_S2_EXPANDED_STATE_UNIT)
      && actual.search?.expandedStateCount === expected.search?.expandedStateCount
      && actual.search?.budgetOutcome === expected.search?.budgetOutcome
      && actual.status === expected.status
      && actual.termination === expected.termination;
  }
  if (name === 'capacity') {
    return isDeepStrictEqual(actual.search?.capacityPolicy, ROUTE_GOLDEN_S2_CAPACITY_POLICY)
      && isDeepStrictEqual(actual.search?.capacityPolicy, expected.search?.capacityPolicy)
      && actual.search?.capacityOutcome === expected.search?.capacityOutcome
      && actual.search?.budgetOutcome === 'within-budget'
      && actual.search?.expandedStateCount === expected.search?.expandedStateCount
      && actual.status === expected.status
      && actual.termination === expected.termination;
  }
  if (name === 'completeness') {
    return isDeepStrictEqual(actual.search?.completeness, expected.search?.completeness);
  }
  throw new TypeError(`Unknown S2 Golden denominator: ${name}`);
}

function fixtureFailureEntry(reference, cohorts, failureClass, error) {
  const checks = {
    fixtureIntegrity: 'fail',
    byteDeterminism: 'not-run',
    solverContract: 'not-run',
    ...Object.fromEntries(ROUTE_GOLDEN_S2_DENOMINATORS.map((name) => [
      name,
      cohorts.includes(name) ? 'fail' : 'not-applicable',
    ])),
  };
  return freezeClone({
    caseId: reference.caseId,
    cohorts,
    terminalOutcome: { status: 'fixture-error', termination: failureClass },
    verdict: 'fail',
    failureClasses: [failureClass],
    checks,
    runs: [],
    error: stableError(error),
  });
}

function validateFixtureInputShape(input) {
  requirePlainDataObject(input, 'fixture-input-invalid', 'S2 Golden input');
  requireExactKeys(input, ['graph', 'request', 'edgeObservationsByEdgeId'],
    'fixture-input-invalid', 'S2 Golden input');
  requirePlainDataObject(input.graph, 'fixture-graph-invalid', 'S2 Golden graph');
  requireExactKeys(input.graph, ['schemaVersion', 'graphId', 'directed', 'nodes', 'edges'],
    'fixture-graph-invalid', 'S2 Golden graph');
  requireEqual(input.graph.schemaVersion, ROUTE_GOLDEN_S2_GRAPH_SCHEMA_VERSION,
    'fixture-graph-version-invalid', 'S2 Golden graph schemaVersion is unsupported');
  requireJsonData(input, 'fixture-input-invalid', 'S2 Golden input');
}

function denominatorMemberships(manifest, caseId) {
  return ROUTE_GOLDEN_S2_DENOMINATORS.filter((name) => manifest.cohorts[name].includes(caseId));
}

function requirePlainDataObject(value, code, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fixtureError(code, `${label} must be a plain object`);
  }
  let prototype;
  let keys;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw fixtureError(code, `${label} cannot be inspected safely`);
  }
  if (prototype !== Object.prototype || keys.some((key) => typeof key === 'symbol')) {
    throw fixtureError(code, `${label} must be a plain string-keyed object`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(descriptors[key], 'value')) {
      throw fixtureError(code, `${label} must contain data properties only`);
    }
  }
}

function requireDataArray(value, code, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw fixtureError(code, `${label} must be an array`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    if (!descriptors[String(index)] || !Object.hasOwn(descriptors[String(index)], 'value')) {
      throw fixtureError(code, `${label} must be dense and data-only`);
    }
  }
  return value;
}

function requireExactKeys(value, expected, code, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (!isDeepStrictEqual(actual, wanted)) {
    throw fixtureError(code, `${label} keys are invalid`);
  }
}

function requireJsonData(value, code, label, seen = new WeakSet()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || seen.has(value)) {
    throw fixtureError(code, `${label} must be acyclic JSON data`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    requireDataArray(value, code, label);
    for (const item of value) requireJsonData(item, code, label, seen);
  } else {
    requirePlainDataObject(value, code, label);
    for (const item of Object.values(value)) requireJsonData(item, code, label, seen);
  }
  seen.delete(value);
}

function requireId(value, code, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]*$/u.test(value)) {
    throw fixtureError(code, `${label} is invalid`);
  }
}

function requireNonEmptyText(value, code, label) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw fixtureError(code, `${label} must be non-empty trimmed text`);
  }
}

function requireEqual(actual, expected, code, message) {
  if (actual !== expected) throw fixtureError(code, message);
}

function requireSafeFixturePath(value) {
  requireNonEmptyText(value, 'fixture-path-invalid', 'S2 Golden fixture path');
  if (value.includes('\\') || value.startsWith('/') || /[?#%]/u.test(value)
    || value.split('/').some((segment) => ['', '.', '..'].includes(segment))) {
    throw fixtureError('fixture-path-invalid', `Unsafe S2 Golden fixture path: ${value}`);
  }
}

function resolveManifestUrl(value) {
  if (value instanceof URL) return new URL(value.href);
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('manifestUrl is invalid');
  if (/^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\')) {
    return pathToFileURL(path.resolve(value));
  }
  try {
    return new URL(value);
  } catch {
    return pathToFileURL(path.resolve(value));
  }
}

function resolveFixtureUrl(root, relativePath) {
  requireSafeFixturePath(relativePath);
  const resolved = new URL(relativePath, root);
  if (resolved.protocol !== root.protocol || !resolved.href.startsWith(root.href)) {
    throw fixtureError('fixture-path-escape', `S2 Golden fixture path escapes root: ${relativePath}`);
  }
  return resolved;
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

function normalizeJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function publicRound(round) {
  return {
    bytes: round.bytes,
    returned: round.returned,
    error: round.error,
    failureClasses: [...round.failureClasses],
  };
}

function stableError(error) {
  return {
    name: typeof error?.name === 'string' ? error.name : 'Error',
    code: typeof error?.code === 'string' ? error.code : null,
  };
}

function fixtureError(code, message) {
  return new S2GoldenFixtureError(code, message);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function freezeClone(value) {
  return deepFreeze(structuredClone(value));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
