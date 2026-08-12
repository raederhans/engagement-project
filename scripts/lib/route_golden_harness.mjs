import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  ROUTE_GOLDEN_GRAPH_SCHEMA_VERSION,
  ROUTE_GOLDEN_ORACLE_CONTRACT_VERSION,
  inspectReferenceRouteInput,
  solveReferenceRoute,
} from './route_golden_oracle.mjs';

export const ROUTE_GOLDEN_MANIFEST_SCHEMA_VERSION = 'route-golden-manifest/v1';
export const ROUTE_GOLDEN_CASE_SCHEMA_VERSION = 'route-golden-case/v1';
export const ROUTE_GOLDEN_FIXTURE_SET_VERSION = 'synthetic-route-generation/v1';
export const ROUTE_GOLDEN_LEDGER_SCHEMA_VERSION = 'route-golden-ledger/v1';
export const ROUTE_GOLDEN_FULL_ORACLE_SCOPE = 'full-oracle/v1';
export const ROUTE_GOLDEN_PRIMARY_ONLY_SCOPE = 'primary-only/v1';
export const DEFAULT_ROUTE_GOLDEN_MANIFEST_URL = new URL(
  '../tests/fixtures/route_generation/manifest.json',
  import.meta.url,
).href;

const COHORT_NAMES = Object.freeze(['reachable', 'terminal', 'conformance']);
const TIE_BREAK_CONTRACT = Object.freeze(['objectiveCostUnits', 'edgeIdsLexicographic']);
const SOLVER_TERMINAL_STATUSES = new Set([
  'ready', 'no-route', 'endpoint-unavailable', 'invalid-input',
]);
const COMPARISON_SCOPES = new Set([
  ROUTE_GOLDEN_FULL_ORACLE_SCOPE,
  ROUTE_GOLDEN_PRIMARY_ONLY_SCOPE,
]);
const FAILURE_CLASS_ORDER = Object.freeze([
  'fixture-load-error',
  'fixture-invalid',
  'fixture-oracle-mismatch',
  'solver-threw',
  'solver-invalid-result',
  'missing-terminal-status',
  'nondeterministic-output',
  'unexpected-terminal-status',
  'expected-outcome-mismatch',
  'oracle-mismatch',
  'route-edge-missing',
  'route-discontinuous',
  'route-wrong-origin',
  'route-wrong-destination',
  'distance-mismatch',
  'objective-cost-mismatch',
  'alternative-facts-mismatch',
]);

export class GoldenFixtureError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'GoldenFixtureError';
    this.code = code;
  }
}

export function validateGoldenManifest(value) {
  requirePlainObject(value, 'manifest-invalid', 'Golden manifest must be an object');
  requireExactKeys(
    value,
    ['schemaVersion', 'fixtureSetVersion', 'oracleContractVersion', 'tieBreak', 'cohorts', 'expectedCounts'],
    'manifest-keys-invalid',
    'Golden manifest',
  );
  requireEqual(
    value.schemaVersion,
    ROUTE_GOLDEN_MANIFEST_SCHEMA_VERSION,
    'manifest-schema-version-unsupported',
    'Unsupported Golden manifest schemaVersion',
  );
  requireEqual(
    value.fixtureSetVersion,
    ROUTE_GOLDEN_FIXTURE_SET_VERSION,
    'fixture-set-version-unsupported',
    'Unsupported Golden fixtureSetVersion',
  );
  requireEqual(
    value.oracleContractVersion,
    ROUTE_GOLDEN_ORACLE_CONTRACT_VERSION,
    'oracle-contract-version-mismatch',
    'Golden manifest oracleContractVersion does not match the reference oracle',
  );
  if (!isDeepStrictEqual(value.tieBreak, TIE_BREAK_CONTRACT)) {
    throw new GoldenFixtureError(
      'tie-break-contract-mismatch',
      `Golden tieBreak must be ${JSON.stringify(TIE_BREAK_CONTRACT)}`,
    );
  }

  requirePlainObject(value.cohorts, 'manifest-cohorts-invalid', 'Golden manifest cohorts must be an object');
  requireExactKeys(value.cohorts, COHORT_NAMES, 'manifest-cohorts-invalid', 'Golden manifest cohorts');
  requirePlainObject(
    value.expectedCounts,
    'manifest-counts-invalid',
    'Golden manifest expectedCounts must be an object',
  );
  requireExactKeys(
    value.expectedCounts,
    [...COHORT_NAMES, 'total'],
    'manifest-counts-invalid',
    'Golden manifest expectedCounts',
  );

  const seenCaseIds = new Set();
  let total = 0;
  for (const cohort of COHORT_NAMES) {
    const references = value.cohorts[cohort];
    if (!Array.isArray(references)) {
      throw new GoldenFixtureError('manifest-cohort-invalid', `${cohort} cohort must be an array`);
    }
    for (const reference of references) {
      requirePlainObject(reference, 'manifest-case-reference-invalid', `${cohort} case reference must be an object`);
      requireExactKeys(reference, ['caseId', 'file'], 'manifest-case-reference-invalid', `${cohort} case reference`);
      requireNonEmptyString(reference.caseId, 'manifest-case-id-invalid', 'Golden manifest caseId');
      requireSafeFixturePath(reference.file);
      if (seenCaseIds.has(reference.caseId)) {
        throw new GoldenFixtureError('manifest-case-id-duplicate', `Duplicate Golden caseId: ${reference.caseId}`);
      }
      seenCaseIds.add(reference.caseId);
    }
    if (value.expectedCounts[cohort] !== references.length) {
      throw new GoldenFixtureError(
        'manifest-count-mismatch',
        `${cohort} expectedCounts does not match its case inventory`,
      );
    }
    total += references.length;
  }
  if (value.expectedCounts.total !== total) {
    throw new GoldenFixtureError('manifest-count-mismatch', 'total expectedCounts does not match case inventory');
  }

  return freezeClone(value);
}

export function validateGoldenCase(value, { manifest, caseReference, cohort } = {}) {
  if (!COHORT_NAMES.includes(cohort)) {
    throw new GoldenFixtureError('fixture-cohort-invalid', `Unsupported Golden cohort: ${cohort}`);
  }
  requirePlainObject(value, 'fixture-invalid', 'Golden case must be an object');
  const expectedKeys = [
    'schemaVersion', 'fixtureSetVersion', 'caseId', 'title', 'input', 'expected',
    ...(cohort === 'conformance' ? ['declaredViolationCode'] : []),
  ];
  requireExactKeys(value, expectedKeys, 'fixture-keys-invalid', `Golden case ${caseReference?.caseId || ''}`);
  requireEqual(
    value.schemaVersion,
    ROUTE_GOLDEN_CASE_SCHEMA_VERSION,
    'fixture-schema-version-unsupported',
    'Unsupported Golden case schemaVersion',
  );
  requireEqual(
    value.fixtureSetVersion,
    manifest?.fixtureSetVersion,
    'fixture-set-version-mismatch',
    'Golden case fixtureSetVersion does not match the manifest',
  );
  requireEqual(
    value.caseId,
    caseReference?.caseId,
    'fixture-case-id-mismatch',
    'Golden caseId does not match its manifest reference',
  );
  requireNonEmptyString(value.title, 'fixture-title-invalid', `Golden case ${value.caseId} title`);

  requirePlainObject(value.input, 'fixture-input-invalid', `Golden case ${value.caseId} input must be an object`);
  requireExactKeys(value.input, ['graph', 'request'], 'fixture-input-invalid', `Golden case ${value.caseId} input`);
  validateSyntheticGraphShape(value.input.graph, value.caseId);
  validateRequestShape(value.input.request, value.caseId);
  validateExpectedOutcomeShape(value.expected, value.caseId);

  const expectedStatuses = {
    reachable: new Set(['ready']),
    terminal: new Set(['no-route', 'endpoint-unavailable']),
    conformance: new Set(['invalid-input']),
  };
  if (!expectedStatuses[cohort].has(value.expected.status)) {
    throw new GoldenFixtureError(
      'fixture-cohort-status-mismatch',
      `${value.caseId} expected status ${value.expected.status} does not belong to ${cohort}`,
    );
  }

  const inspection = inspectReferenceRouteInput(value.input);
  if (cohort === 'conformance') {
    requireNonEmptyString(
      value.declaredViolationCode,
      'fixture-declared-violation-invalid',
      `${value.caseId} declaredViolationCode`,
    );
    if (inspection.violations.length !== 1
      || inspection.violations[0] !== value.declaredViolationCode
      || value.expected.reasonCode !== value.declaredViolationCode) {
      throw new GoldenFixtureError(
        'fixture-declared-violation-mismatch',
        `${value.caseId} must trigger exactly its declared violation`,
      );
    }
  } else if (!inspection.valid) {
    throw new GoldenFixtureError(
      'fixture-graph-invalid',
      `${value.caseId} is not a valid synthetic graph/request: ${inspection.violations.join(', ')}`,
    );
  }

  return freezeClone(value);
}

export async function loadGoldenFixtureSet({
  manifestUrl = DEFAULT_ROUTE_GOLDEN_MANIFEST_URL,
  loadJson = readJson,
} = {}) {
  const resolvedManifestUrl = resolveManifestUrl(manifestUrl);
  const manifest = validateGoldenManifest(await loadJson(resolvedManifestUrl));
  const fixtureRoot = new URL('./', resolvedManifestUrl);
  const cases = [];
  for (const cohort of COHORT_NAMES) {
    for (const caseReference of manifest.cohorts[cohort]) {
      const fixture = validateGoldenCase(
        await loadJson(resolveFixtureUrl(fixtureRoot, caseReference.file)),
        { manifest, caseReference, cohort },
      );
      cases.push(freezeClone({ cohort, caseReference, fixture }));
    }
  }
  return freezeClone({ manifest, cases });
}

export async function runGoldenCases({
  solve,
  solverId = 'injected-solver',
  comparisonScope = ROUTE_GOLDEN_FULL_ORACLE_SCOPE,
  manifestUrl = DEFAULT_ROUTE_GOLDEN_MANIFEST_URL,
  loadJson = readJson,
} = {}) {
  if (typeof solve !== 'function') throw new TypeError('runGoldenCases solve must be a function');
  requireNonEmptyString(solverId, 'solver-id-invalid', 'runGoldenCases solverId');
  if (!COMPARISON_SCOPES.has(comparisonScope)) {
    throw new TypeError(`Unsupported Golden comparisonScope: ${comparisonScope}`);
  }

  const resolvedManifestUrl = resolveManifestUrl(manifestUrl);
  const manifest = validateGoldenManifest(await loadJson(resolvedManifestUrl));
  const fixtureRoot = new URL('./', resolvedManifestUrl);
  const entries = [];

  for (const cohort of COHORT_NAMES) {
    for (const caseReference of manifest.cohorts[cohort]) {
      let rawFixture;
      try {
        rawFixture = await loadJson(resolveFixtureUrl(fixtureRoot, caseReference.file));
      } catch (error) {
        entries.push(fixtureFailureEntry({ caseReference, cohort, failureClass: 'fixture-load-error', error }));
        continue;
      }

      let fixture;
      try {
        fixture = validateGoldenCase(rawFixture, { manifest, caseReference, cohort });
      } catch (error) {
        entries.push(fixtureFailureEntry({ caseReference, cohort, failureClass: 'fixture-invalid', error }));
        continue;
      }

      entries.push(await runOneGoldenCase({ solve, fixture, cohort, comparisonScope }));
    }
  }

  const cohorts = Object.fromEntries(COHORT_NAMES.map((cohort) => {
    const cohortEntries = entries.filter((entry) => entry.cohort === cohort);
    const passed = cohortEntries.filter((entry) => entry.verdict === 'pass').length;
    return [cohort, {
      cases: cohortEntries.length,
      passed,
      failed: cohortEntries.length - passed,
      ...(cohort === 'reachable'
        ? { denominator: manifest.cohorts.reachable.length }
        : { excludedFromReachableDenominator: true }),
    }];
  }));
  const passedCases = entries.filter((entry) => entry.verdict === 'pass').length;
  return freezeClone({
    schemaVersion: ROUTE_GOLDEN_LEDGER_SCHEMA_VERSION,
    fixtureSetVersion: manifest.fixtureSetVersion,
    oracleContractVersion: manifest.oracleContractVersion,
    solverId,
    comparisonScope,
    entries,
    summary: {
      totalCases: entries.length,
      terminalOutcomeCount: entries.filter((entry) => isPlainObject(entry.terminalOutcome)).length,
      passedCases,
      failedCases: entries.length - passedCases,
      reachableDenominator: manifest.cohorts.reachable.length,
      cohorts,
    },
  });
}

export function normalizeGoldenOutcome(value) {
  return normalizeJsonValue(value, new WeakSet());
}

function projectOutcomeForScope(outcome, comparisonScope) {
  if (comparisonScope === ROUTE_GOLDEN_FULL_ORACLE_SCOPE || outcome.status !== 'ready') {
    return outcome;
  }
  return {
    status: outcome.status,
    primary: outcome.primary,
  };
}

async function runOneGoldenCase({ solve, fixture, cohort, comparisonScope }) {
  const oracleOutcome = normalizeGoldenOutcome(solveReferenceRoute(fixture.input));
  const expectedOutcome = normalizeGoldenOutcome(fixture.expected);
  const fixtureMatchesOracle = isDeepStrictEqual(expectedOutcome, oracleOutcome);
  const scopedOracleOutcome = projectOutcomeForScope(oracleOutcome, comparisonScope);
  const scopedExpectedOutcome = projectOutcomeForScope(expectedOutcome, comparisonScope);
  const rounds = [
    await invokeSolver(solve, fixture.input, comparisonScope),
    await invokeSolver(solve, fixture.input, comparisonScope),
  ];
  const deterministic = isDeepStrictEqual(roundSignature(rounds[0]), roundSignature(rounds[1]));
  const failureClasses = new Set();
  if (!fixtureMatchesOracle) failureClasses.add('fixture-oracle-mismatch');
  for (const round of rounds) {
    for (const failureClass of round.failureClasses) failureClasses.add(failureClass);
  }
  if (!deterministic) failureClasses.add('nondeterministic-output');

  const stableCanonicalResult = deterministic && rounds.every((round) => (
    round.kind === 'returned' && round.failureClasses.length === 0
  ));
  let terminalOutcome;
  const checks = {
    fixtureIntegrity: fixtureMatchesOracle ? 'pass' : 'fail',
    terminalPresent: 'pass',
    deterministic: deterministic ? 'pass' : 'fail',
    solverContract: stableCanonicalResult ? 'pass' : 'fail',
    expectedAgreement: 'not-run',
    oracleAgreement: 'not-run',
    continuity: 'not-applicable',
    distance: 'not-applicable',
    cost: 'not-applicable',
    alternatives: 'not-applicable',
  };

  if (stableCanonicalResult) {
    const outcome = rounds[0].outcome;
    terminalOutcome = { source: 'solver', ...outcome };
    const expectedAgreement = isDeepStrictEqual(outcome, scopedExpectedOutcome);
    const oracleAgreement = isDeepStrictEqual(outcome, scopedOracleOutcome);
    checks.expectedAgreement = expectedAgreement ? 'pass' : 'fail';
    checks.oracleAgreement = oracleAgreement ? 'pass' : 'fail';
    if (!expectedAgreement) {
      failureClasses.add('expected-outcome-mismatch');
      if (outcome.status !== scopedExpectedOutcome.status) failureClasses.add('unexpected-terminal-status');
    }
    if (!oracleAgreement) failureClasses.add('oracle-mismatch');

    if (outcome.status === 'ready') {
      const readyInspection = inspectReadyOutcome(
        outcome,
        fixture.input,
        scopedOracleOutcome,
        comparisonScope,
      );
      Object.assign(checks, readyInspection.checks);
      for (const failureClass of readyInspection.failureClasses) failureClasses.add(failureClass);
    }
  } else {
    terminalOutcome = {
      source: 'harness',
      status: 'solver-error',
      reasonCode: !deterministic
        ? 'nondeterministic-output'
        : rounds.some((round) => round.failureClasses.includes('solver-threw'))
          ? 'solver-threw'
          : rounds.some((round) => round.failureClasses.includes('missing-terminal-status'))
            ? 'missing-terminal-status'
            : 'solver-invalid-result',
    };
  }

  const orderedFailures = orderFailureClasses(failureClasses);
  return freezeClone({
    caseId: fixture.caseId,
    cohort,
    expectedStatus: fixture.expected.status,
    terminalOutcome,
    verdict: orderedFailures.length === 0 ? 'pass' : 'fail',
    failureClasses: orderedFailures,
    checks,
    runs: rounds.map(publicRound),
  });
}

async function invokeSolver(solve, input, comparisonScope) {
  let returned;
  try {
    returned = await solve({
      graph: structuredClone(input.graph),
      request: structuredClone(input.request),
    });
  } catch (error) {
    return {
      kind: 'threw',
      error: stableError(error),
      failureClasses: ['solver-threw'],
    };
  }

  let outcome;
  try {
    outcome = normalizeGoldenOutcome(returned);
  } catch {
    return {
      kind: 'returned',
      outcome: null,
      failureClasses: ['solver-invalid-result'],
    };
  }
  return {
    kind: 'returned',
    outcome,
    failureClasses: inspectCanonicalOutcome(outcome, comparisonScope),
  };
}

function inspectCanonicalOutcome(outcome, comparisonScope) {
  if (!isPlainObject(outcome)) return ['solver-invalid-result'];
  if (!Object.hasOwn(outcome, 'status') || !isNonEmptyString(outcome.status)) {
    return ['missing-terminal-status', 'solver-invalid-result'];
  }
  if (!SOLVER_TERMINAL_STATUSES.has(outcome.status)) return ['solver-invalid-result'];
  try {
    validateExpectedOutcomeShape(outcome, 'solver-result', comparisonScope);
    return [];
  } catch {
    return ['solver-invalid-result'];
  }
}

function inspectReadyOutcome(outcome, input, oracleOutcome, comparisonScope) {
  const failures = new Set();
  const routeChecks = [inspectRouteFacts(outcome.primary, input.graph, input.request)];
  if (comparisonScope === ROUTE_GOLDEN_PRIMARY_ONLY_SCOPE) {
    for (const inspection of routeChecks) {
      for (const failureClass of inspection.failureClasses) failures.add(failureClass);
    }
    return {
      checks: {
        continuity: routeChecks[0].continuity ? 'pass' : 'fail',
        distance: routeChecks[0].distance ? 'pass' : 'fail',
        cost: routeChecks[0].cost ? 'pass' : 'fail',
        alternatives: 'not-evaluated',
      },
      failureClasses: orderFailureClasses(failures),
    };
  }
  if (outcome.alternatives.kind === 'multiple-distinct') {
    routeChecks.push(inspectRouteFacts(outcome.alternatives.bestDistinct, input.graph, input.request));
    if (isDeepStrictEqual(outcome.primary.edgeIds, outcome.alternatives.bestDistinct.edgeIds)) {
      failures.add('alternative-facts-mismatch');
    }
  }
  for (const inspection of routeChecks) {
    for (const failureClass of inspection.failureClasses) failures.add(failureClass);
  }
  const alternativesMatchOracle = oracleOutcome.status === 'ready'
    && isDeepStrictEqual(outcome.alternatives, oracleOutcome.alternatives);
  if (!alternativesMatchOracle) failures.add('alternative-facts-mismatch');

  return {
    checks: {
      continuity: routeChecks.every((inspection) => inspection.continuity) ? 'pass' : 'fail',
      distance: routeChecks.every((inspection) => inspection.distance) ? 'pass' : 'fail',
      cost: routeChecks.every((inspection) => inspection.cost) ? 'pass' : 'fail',
      alternatives: alternativesMatchOracle
        && !failures.has('alternative-facts-mismatch') ? 'pass' : 'fail',
    },
    failureClasses: orderFailureClasses(failures),
  };
}

function inspectRouteFacts(route, graph, request) {
  const failures = new Set();
  const edgesById = new Map(graph.edges.map((edge) => [edge.edgeId, edge]));
  const edges = [];
  for (const edgeId of route.edgeIds) {
    const edge = edgesById.get(edgeId);
    if (!edge) failures.add('route-edge-missing');
    else edges.push(edge);
  }

  let continuity = !failures.has('route-edge-missing');
  let derivedNodeIds = [request.originNodeId];
  if (continuity) {
    let currentNodeId = request.originNodeId;
    for (const edge of edges) {
      if (edge.fromNodeId !== currentNodeId) {
        failures.add(derivedNodeIds.length === 1 ? 'route-wrong-origin' : 'route-discontinuous');
        continuity = false;
      }
      currentNodeId = edge.toNodeId;
      derivedNodeIds.push(currentNodeId);
    }
    if (currentNodeId !== request.destinationNodeId) {
      failures.add('route-wrong-destination');
      continuity = false;
    }
    if (!isDeepStrictEqual(route.nodeIds, derivedNodeIds)) {
      failures.add('route-discontinuous');
      continuity = false;
    }
  }

  const distanceMm = edges.reduce((sum, edge) => sum + edge.distanceMm, 0);
  const objectiveCostUnits = edges.reduce((sum, edge) => sum + edge.objectiveCostUnits, 0);
  const distance = edges.length === route.edgeIds.length
    && Number.isSafeInteger(distanceMm) && route.distanceMm === distanceMm;
  const cost = edges.length === route.edgeIds.length
    && Number.isSafeInteger(objectiveCostUnits) && route.objectiveCostUnits === objectiveCostUnits;
  if (!distance) failures.add('distance-mismatch');
  if (!cost) failures.add('objective-cost-mismatch');

  return { continuity, distance, cost, failureClasses: orderFailureClasses(failures) };
}

function fixtureFailureEntry({ caseReference, cohort, failureClass, error }) {
  const errorShape = stableError(error);
  return freezeClone({
    caseId: caseReference.caseId,
    cohort,
    expectedStatus: null,
    terminalOutcome: {
      source: 'harness',
      status: 'fixture-error',
      reasonCode: failureClass,
    },
    verdict: 'fail',
    failureClasses: [failureClass],
    checks: {
      fixtureIntegrity: 'fail',
      terminalPresent: 'pass',
      deterministic: 'not-run',
      solverContract: 'not-run',
      expectedAgreement: 'not-run',
      oracleAgreement: 'not-run',
      continuity: 'not-applicable',
      distance: 'not-applicable',
      cost: 'not-applicable',
      alternatives: 'not-applicable',
    },
    runs: [],
    error: errorShape,
  });
}

function validateSyntheticGraphShape(graph, caseId) {
  requirePlainObject(graph, 'fixture-graph-invalid', `${caseId} graph must be an object`);
  requireExactKeys(
    graph,
    ['schemaVersion', 'graphId', 'directed', 'nodes', 'edges'],
    'fixture-graph-invalid',
    `${caseId} graph`,
  );
  requireEqual(
    graph.schemaVersion,
    ROUTE_GOLDEN_GRAPH_SCHEMA_VERSION,
    'fixture-graph-schema-version-unsupported',
    `${caseId} graph schemaVersion is unsupported`,
  );
  requireNonEmptyString(graph.graphId, 'fixture-graph-id-invalid', `${caseId} graphId`);
  requireEqual(graph.directed, true, 'fixture-graph-directed-invalid', `${caseId} graph must be directed`);
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    throw new GoldenFixtureError('fixture-nodes-invalid', `${caseId} nodes must be a non-empty array`);
  }
  for (const node of graph.nodes) {
    requirePlainObject(node, 'fixture-node-invalid', `${caseId} node must be an object`);
    requireAllowedKeys(node, ['nodeId', 'coordinates'], ['nodeId'], 'fixture-node-invalid', `${caseId} node`);
    requireNonEmptyString(node.nodeId, 'fixture-node-id-invalid', `${caseId} nodeId`);
    if (node.coordinates !== undefined && !isCoordinatePair(node.coordinates)) {
      throw new GoldenFixtureError('fixture-node-coordinates-invalid', `${caseId} node coordinates are invalid`);
    }
  }
  if (!Array.isArray(graph.edges)) {
    throw new GoldenFixtureError('fixture-edges-invalid', `${caseId} edges must be an array`);
  }
  for (const edge of graph.edges) {
    requirePlainObject(edge, 'fixture-edge-invalid', `${caseId} edge must be an object`);
    requireAllowedKeys(
      edge,
      ['edgeId', 'fromNodeId', 'toNodeId', 'distanceMm', 'objectiveCostUnits', 'geometry'],
      ['edgeId', 'fromNodeId', 'toNodeId', 'distanceMm', 'objectiveCostUnits'],
      'fixture-edge-invalid',
      `${caseId} edge`,
    );
    for (const field of ['edgeId', 'fromNodeId', 'toNodeId']) {
      requireNonEmptyString(edge[field], 'fixture-edge-invalid', `${caseId} edge ${field}`);
    }
    if (!Number.isSafeInteger(edge.distanceMm) || !Number.isSafeInteger(edge.objectiveCostUnits)) {
      throw new GoldenFixtureError('fixture-edge-metric-invalid', `${caseId} edge metrics must be safe integers`);
    }
    if (edge.geometry !== undefined && !isLineString(edge.geometry)) {
      throw new GoldenFixtureError('fixture-edge-geometry-invalid', `${caseId} edge geometry is invalid`);
    }
  }
}

function validateRequestShape(request, caseId) {
  requirePlainObject(request, 'fixture-request-invalid', `${caseId} request must be an object`);
  requireExactKeys(
    request,
    ['originNodeId', 'destinationNodeId'],
    'fixture-request-invalid',
    `${caseId} request`,
  );
  requireNonEmptyString(request.originNodeId, 'fixture-request-invalid', `${caseId} originNodeId`);
  requireNonEmptyString(request.destinationNodeId, 'fixture-request-invalid', `${caseId} destinationNodeId`);
}

function validateExpectedOutcomeShape(
  outcome,
  caseId,
  comparisonScope = ROUTE_GOLDEN_FULL_ORACLE_SCOPE,
) {
  requirePlainObject(outcome, 'outcome-invalid', `${caseId} outcome must be an object`);
  if (!SOLVER_TERMINAL_STATUSES.has(outcome.status)) {
    throw new GoldenFixtureError('outcome-status-invalid', `${caseId} outcome status is invalid`);
  }
  if (outcome.status === 'ready') {
    if (comparisonScope === ROUTE_GOLDEN_PRIMARY_ONLY_SCOPE) {
      requireExactKeys(outcome, ['status', 'primary'], 'outcome-invalid', `${caseId} ready outcome`);
      validateRouteFactsShape(outcome.primary, `${caseId} primary`);
      return;
    }
    requireExactKeys(outcome, ['status', 'primary', 'alternatives'], 'outcome-invalid', `${caseId} ready outcome`);
    validateRouteFactsShape(outcome.primary, `${caseId} primary`);
    requirePlainObject(outcome.alternatives, 'outcome-alternatives-invalid', `${caseId} alternatives must be an object`);
    requireExactKeys(
      outcome.alternatives,
      ['kind', 'bestDistinct'],
      'outcome-alternatives-invalid',
      `${caseId} alternatives`,
    );
    if (outcome.alternatives.kind === 'multiple-distinct') {
      validateRouteFactsShape(outcome.alternatives.bestDistinct, `${caseId} bestDistinct`);
    } else if (outcome.alternatives.kind === 'no-distinct-alternative') {
      requireEqual(
        outcome.alternatives.bestDistinct,
        null,
        'outcome-alternatives-invalid',
        `${caseId} no-distinct-alternative must use a null bestDistinct`,
      );
    } else {
      throw new GoldenFixtureError('outcome-alternatives-invalid', `${caseId} alternatives kind is invalid`);
    }
  } else {
    requireExactKeys(outcome, ['status', 'reasonCode'], 'outcome-invalid', `${caseId} terminal outcome`);
    requireNonEmptyString(outcome.reasonCode, 'outcome-reason-invalid', `${caseId} reasonCode`);
  }
}

function validateRouteFactsShape(route, label) {
  requirePlainObject(route, 'route-facts-invalid', `${label} must be an object`);
  requireExactKeys(
    route,
    ['edgeIds', 'nodeIds', 'distanceMm', 'objectiveCostUnits'],
    'route-facts-invalid',
    label,
  );
  if (!Array.isArray(route.edgeIds) || !route.edgeIds.every(isNonEmptyString)) {
    throw new GoldenFixtureError('route-edge-ids-invalid', `${label} edgeIds must be strings`);
  }
  if (!Array.isArray(route.nodeIds) || route.nodeIds.length === 0 || !route.nodeIds.every(isNonEmptyString)) {
    throw new GoldenFixtureError('route-node-ids-invalid', `${label} nodeIds must be non-empty strings`);
  }
  if (!Number.isSafeInteger(route.distanceMm) || route.distanceMm < 0) {
    throw new GoldenFixtureError('route-distance-invalid', `${label} distanceMm must be a non-negative safe integer`);
  }
  if (!Number.isSafeInteger(route.objectiveCostUnits) || route.objectiveCostUnits < 0) {
    throw new GoldenFixtureError(
      'route-objective-cost-invalid',
      `${label} objectiveCostUnits must be a non-negative safe integer`,
    );
  }
}

function resolveManifestUrl(value) {
  if (value instanceof URL) return new URL(value.href);
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('manifestUrl must be a URL or non-empty string');
  }
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
    throw new GoldenFixtureError('fixture-path-escape', `Fixture path escapes fixture root: ${relativePath}`);
  }
  return resolved;
}

function requireSafeFixturePath(value) {
  requireNonEmptyString(value, 'fixture-path-invalid', 'Golden fixture file');
  if (value.includes('\\') || /[?#%]/u.test(value) || value.startsWith('/')
    || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new GoldenFixtureError('fixture-path-invalid', `Unsafe Golden fixture path: ${value}`);
  }
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

function publicRound(round) {
  return round.kind === 'threw'
    ? { kind: round.kind, error: round.error, failureClasses: [...round.failureClasses] }
    : { kind: round.kind, outcome: round.outcome, failureClasses: [...round.failureClasses] };
}

function roundSignature(round) {
  return publicRound(round);
}

function stableError(error) {
  return {
    name: isNonEmptyString(error?.name) ? error.name : 'Error',
    code: isNonEmptyString(error?.code) ? error.code : null,
  };
}

function normalizeJsonValue(value, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Golden outcomes cannot contain non-finite numbers');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('Golden outcomes must contain JSON-compatible values');
  if (seen.has(value)) throw new TypeError('Golden outcomes cannot contain cycles');
  seen.add(value);
  let normalized;
  if (Array.isArray(value)) {
    normalized = value.map((entry) => {
      if (entry === undefined) throw new TypeError('Golden outcome arrays cannot contain undefined');
      return normalizeJsonValue(entry, seen);
    });
  } else {
    if (!isPlainObject(value)) throw new TypeError('Golden outcomes must contain plain objects');
    normalized = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) normalized[key] = normalizeJsonValue(value[key], seen);
    }
  }
  seen.delete(value);
  return normalized;
}

function requireExactKeys(value, keys, code, label) {
  requireAllowedKeys(value, keys, keys, code, label);
}

function requireAllowedKeys(value, allowed, required, code, label) {
  const actual = Object.keys(value).sort();
  const allowedSet = new Set(allowed);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const extra = actual.filter((key) => !allowedSet.has(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new GoldenFixtureError(
      code,
      `${label} keys are invalid (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`,
    );
  }
}

function requirePlainObject(value, code, message) {
  if (!isPlainObject(value)) throw new GoldenFixtureError(code, message);
}

function requireNonEmptyString(value, code, label) {
  if (!isNonEmptyString(value)) throw new GoldenFixtureError(code, `${label} must be a non-empty trimmed string`);
}

function requireEqual(actual, expected, code, message) {
  if (actual !== expected) throw new GoldenFixtureError(code, message);
}

function orderFailureClasses(values) {
  const unique = [...new Set(values)];
  return unique.sort((left, right) => {
    const leftIndex = FAILURE_CLASS_ORDER.indexOf(left);
    const rightIndex = FAILURE_CLASS_ORDER.indexOf(right);
    if (leftIndex === -1 && rightIndex === -1) return left < right ? -1 : left === right ? 0 : 1;
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function isCoordinatePair(value) {
  return Array.isArray(value) && value.length === 2
    && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate));
}

function isLineString(value) {
  return isPlainObject(value) && value.type === 'LineString'
    && Array.isArray(value.coordinates) && value.coordinates.length >= 2
    && value.coordinates.every(isCoordinatePair);
}

function freezeClone(value) {
  return deepFreeze(structuredClone(value));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
