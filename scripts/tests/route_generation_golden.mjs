#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ROUTE_GOLDEN_ORACLE_CONTRACT_VERSION,
  inspectReferenceRouteInput,
  solveReferenceRoute,
} from '../lib/route_golden_oracle.mjs';
import {
  DEFAULT_ROUTE_GOLDEN_MANIFEST_URL,
  ROUTE_GOLDEN_CASE_SCHEMA_VERSION,
  ROUTE_GOLDEN_FIXTURE_SET_VERSION,
  ROUTE_GOLDEN_LEDGER_SCHEMA_VERSION,
  ROUTE_GOLDEN_MANIFEST_SCHEMA_VERSION,
  loadGoldenFixtureSet,
  runGoldenCases,
  validateGoldenManifest,
} from '../lib/route_golden_harness.mjs';

const fixtureSet = await loadGoldenFixtureSet();
const casesById = new Map(fixtureSet.cases.map(({ fixture }) => [fixture.caseId, fixture]));
const expectedCaseIds = [
  'unique-shortest',
  'equal-cost-tie',
  'directed-forward',
  'self-route',
  'multiple-distinct-alternatives',
  'no-distinct-alternative',
  'directed-reverse-no-route',
  'disconnected-components',
  'geometric-crossing-without-topology',
  'endpoint-unavailable',
  'invalid-edge',
];

test('versioned manifest keeps reachable, terminal, and conformance inventories separate', () => {
  const { manifest, cases } = fixtureSet;
  assert.equal(manifest.schemaVersion, ROUTE_GOLDEN_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.fixtureSetVersion, ROUTE_GOLDEN_FIXTURE_SET_VERSION);
  assert.equal(manifest.oracleContractVersion, ROUTE_GOLDEN_ORACLE_CONTRACT_VERSION);
  assert.deepEqual(manifest.expectedCounts, {
    reachable: 6,
    terminal: 4,
    conformance: 1,
    total: 11,
  });
  assert.deepEqual(cases.map(({ fixture }) => fixture.caseId), expectedCaseIds);
  assert.equal(new Set(cases.map(({ fixture }) => fixture.caseId)).size, cases.length);
  assert.equal(cases.every(({ fixture }) => fixture.schemaVersion === ROUTE_GOLDEN_CASE_SCHEMA_VERSION), true);
});

test('manifest validation rejects duplicate inventory, count drift, and paths outside the fixture root', () => {
  const duplicate = structuredClone(fixtureSet.manifest);
  duplicate.cohorts.terminal[0].caseId = duplicate.cohorts.reachable[0].caseId;
  assert.throws(
    () => validateGoldenManifest(duplicate),
    (error) => error.code === 'manifest-case-id-duplicate',
  );

  const countDrift = structuredClone(fixtureSet.manifest);
  countDrift.expectedCounts.reachable += 1;
  assert.throws(
    () => validateGoldenManifest(countDrift),
    (error) => error.code === 'manifest-count-mismatch',
  );

  const escaped = structuredClone(fixtureSet.manifest);
  escaped.cohorts.reachable[0].file = '../outside.json';
  assert.throws(
    () => validateGoldenManifest(escaped),
    (error) => error.code === 'fixture-path-invalid',
  );
});

test('the invalid-edge conformance fixture triggers exactly its declared violation', () => {
  const fixture = casesById.get('invalid-edge');
  const inspection = inspectReferenceRouteInput(fixture.input);
  assert.deepEqual(inspection, {
    valid: false,
    violations: [fixture.declaredViolationCode],
  });
  assert.equal(fixture.expected.reasonCode, fixture.declaredViolationCode);
});

for (const { cohort, fixture } of fixtureSet.cases) {
  test(`reference oracle matches ${cohort} fixture: ${fixture.caseId}`, () => {
    assert.deepEqual(solveReferenceRoute(fixture.input), fixture.expected);
  });
}

test('reference Dijkstra tie-breaking is independent of edge input order and does not mutate input', () => {
  const original = structuredClone(casesById.get('equal-cost-tie').input);
  const reordered = structuredClone(original);
  reordered.graph.edges.reverse();
  reordered.graph.nodes.reverse();

  const originalOutcome = solveReferenceRoute(original);
  const reorderedOutcome = solveReferenceRoute(reordered);
  assert.deepEqual(reorderedOutcome, originalOutcome);
  assert.deepEqual(original, casesById.get('equal-cost-tie').input);
  assert.deepEqual(reordered.graph.edges, [...original.graph.edges].reverse());
  assert.deepEqual(originalOutcome.primary.edgeIds, ['tie-a-b', 'tie-b-d']);
  assert.equal(originalOutcome.primary.distanceMm, 3000);
});

test('oracle-injected harness writes one passing terminal ledger entry per case over two runs', async () => {
  let invocationCount = 0;
  const ledger = await runGoldenCases({
    solverId: 'reference-oracle-test-adapter',
    solve(input) {
      invocationCount += 1;
      assert.deepEqual(Object.keys(input).sort(), ['graph', 'request']);
      return solveReferenceRoute(input);
    },
  });

  assert.equal(ledger.schemaVersion, ROUTE_GOLDEN_LEDGER_SCHEMA_VERSION);
  assert.equal(ledger.entries.length, expectedCaseIds.length);
  assert.deepEqual(ledger.entries.map(({ caseId }) => caseId), expectedCaseIds);
  assert.equal(invocationCount, expectedCaseIds.length * 2);
  assert.equal(ledger.entries.every(({ verdict }) => verdict === 'pass'), true);
  assert.equal(ledger.entries.every(({ terminalOutcome }) => typeof terminalOutcome.status === 'string'), true);
  assert.equal(ledger.entries.every(({ checks }) => checks.deterministic === 'pass'), true);
  assert.equal(ledger.entries.every(({ runs }) => runs.length === 2), true);
  assert.deepEqual(ledger.summary, {
    totalCases: 11,
    terminalOutcomeCount: 11,
    passedCases: 11,
    failedCases: 0,
    reachableDenominator: 6,
    cohorts: {
      reachable: { cases: 6, passed: 6, failed: 0, denominator: 6 },
      terminal: { cases: 4, passed: 4, failed: 0, excludedFromReachableDenominator: true },
      conformance: { cases: 1, passed: 1, failed: 0, excludedFromReachableDenominator: true },
    },
  });
});

test('fixture load failure remains a terminal ledger entry and does not stop later cases', async () => {
  const ledger = await runGoldenCases({
    solverId: 'fixture-load-failure-adapter',
    solve: solveReferenceRoute,
    async loadJson(url) {
      if (url.pathname.endsWith('/unique-shortest.json')) throw new Error('synthetic fixture read failure');
      return JSON.parse(await readFile(url, 'utf8'));
    },
  });
  const entry = ledgerEntry(ledger, 'unique-shortest');
  assert.equal(ledger.entries.length, 11);
  assert.equal(ledger.summary.terminalOutcomeCount, 11);
  assert.equal(entry.terminalOutcome.status, 'fixture-error');
  assert.deepEqual(entry.failureClasses, ['fixture-load-error']);
  assert.equal(ledgerEntry(ledger, 'equal-cost-tie').verdict, 'pass');
});

test('fixture schema failure is classified without entering the reachable denominator twice', async () => {
  const ledger = await runGoldenCases({
    solverId: 'fixture-schema-failure-adapter',
    solve: solveReferenceRoute,
    async loadJson(url) {
      const value = JSON.parse(await readFile(url, 'utf8'));
      if (url.pathname.endsWith('/unique-shortest.json')) value.unexpected = true;
      return value;
    },
  });
  const entry = ledgerEntry(ledger, 'unique-shortest');
  assert.deepEqual(entry.failureClasses, ['fixture-invalid']);
  assert.equal(entry.terminalOutcome.status, 'fixture-error');
  assert.equal(ledger.summary.reachableDenominator, 6);
  assert.equal(ledger.summary.cohorts.terminal.excludedFromReachableDenominator, true);
  assert.equal(ledger.summary.cohorts.conformance.excludedFromReachableDenominator, true);
});

test('solver exceptions are stable harness terminal outcomes and do not truncate the ledger', async () => {
  const ledger = await runGoldenCases({
    solverId: 'throwing-test-adapter',
    solve(input) {
      if (input.graph.graphId === 'unique-shortest-graph') throw new Error('test-only failure');
      return solveReferenceRoute(input);
    },
  });
  const entry = ledgerEntry(ledger, 'unique-shortest');
  assert.equal(ledger.entries.length, 11);
  assert.equal(entry.terminalOutcome.source, 'harness');
  assert.equal(entry.terminalOutcome.status, 'solver-error');
  assert.deepEqual(entry.failureClasses, ['solver-threw']);
  assert.equal(entry.checks.deterministic, 'pass');
});

test('a returned object without status is classified as a missing terminal status', async () => {
  const ledger = await runGoldenCases({
    solverId: 'missing-status-test-adapter',
    solve(input) {
      if (input.graph.graphId === 'unique-shortest-graph') return { primary: null };
      return solveReferenceRoute(input);
    },
  });
  const entry = ledgerEntry(ledger, 'unique-shortest');
  assert.equal(entry.terminalOutcome.reasonCode, 'missing-terminal-status');
  assert.deepEqual(entry.failureClasses, ['solver-invalid-result', 'missing-terminal-status']);
});

test('two different normalized solver outcomes are classified as nondeterministic', async () => {
  let targetInvocation = 0;
  const ledger = await runGoldenCases({
    solverId: 'alternating-test-adapter',
    solve(input) {
      if (input.graph.graphId !== 'unique-shortest-graph') return solveReferenceRoute(input);
      targetInvocation += 1;
      return targetInvocation % 2 === 1
        ? solveReferenceRoute(input)
        : { status: 'no-route', reasonCode: 'no-directed-path' };
    },
  });
  const entry = ledgerEntry(ledger, 'unique-shortest');
  assert.equal(entry.terminalOutcome.reasonCode, 'nondeterministic-output');
  assert.equal(entry.checks.deterministic, 'fail');
  assert.equal(entry.failureClasses.includes('nondeterministic-output'), true);
});

test('ready-route continuity is recomputed from directed edge topology', async () => {
  const ledger = await runFaultedReadyCase((outcome) => {
    outcome.primary = {
      edgeIds: ['u-ac', 'u-bd'],
      nodeIds: ['u-a', 'u-c', 'u-d'],
      distanceMm: 150,
      objectiveCostUnits: 5,
    };
    return outcome;
  }, 'discontinuous-test-adapter');
  const entry = ledgerEntry(ledger, 'unique-shortest');
  assert.equal(entry.checks.continuity, 'fail');
  assert.equal(entry.failureClasses.includes('route-discontinuous'), true);
  assert.equal(entry.checks.distance, 'pass');
  assert.equal(entry.checks.cost, 'pass');
});

test('ready-route distance and objective cost are recomputed as separate facts', async () => {
  const distanceLedger = await runFaultedReadyCase((outcome) => {
    outcome.primary.distanceMm += 1;
    return outcome;
  }, 'distance-fault-test-adapter');
  const distanceEntry = ledgerEntry(distanceLedger, 'unique-shortest');
  assert.equal(distanceEntry.checks.distance, 'fail');
  assert.equal(distanceEntry.checks.cost, 'pass');
  assert.equal(distanceEntry.failureClasses.includes('distance-mismatch'), true);

  const costLedger = await runFaultedReadyCase((outcome) => {
    outcome.primary.objectiveCostUnits += 1;
    return outcome;
  }, 'cost-fault-test-adapter');
  const costEntry = ledgerEntry(costLedger, 'unique-shortest');
  assert.equal(costEntry.checks.distance, 'pass');
  assert.equal(costEntry.checks.cost, 'fail');
  assert.equal(costEntry.failureClasses.includes('objective-cost-mismatch'), true);
});

test('multiple and no-distinct alternative facts are reconciled against the independent oracle', async () => {
  assert.equal(
    casesById.get('multiple-distinct-alternatives').expected.alternatives.kind,
    'multiple-distinct',
  );
  assert.equal(
    casesById.get('no-distinct-alternative').expected.alternatives.kind,
    'no-distinct-alternative',
  );

  const ledger = await runGoldenCases({
    solverId: 'alternative-fault-test-adapter',
    solve(input) {
      const outcome = structuredClone(solveReferenceRoute(input));
      if (input.graph.graphId === 'multiple-distinct-alternatives-graph') {
        outcome.alternatives = { kind: 'no-distinct-alternative', bestDistinct: null };
      }
      return outcome;
    },
  });
  const entry = ledgerEntry(ledger, 'multiple-distinct-alternatives');
  assert.equal(entry.checks.alternatives, 'fail');
  assert.equal(entry.failureClasses.includes('alternative-facts-mismatch'), true);
});

test('the default manifest URL is a checked-in fixture URL rather than a product import', () => {
  const url = new URL(DEFAULT_ROUTE_GOLDEN_MANIFEST_URL);
  assert.equal(url.protocol, 'file:');
  assert.match(url.pathname, /scripts\/tests\/fixtures\/route_generation\/manifest\.json$/u);
});

async function runFaultedReadyCase(mutate, solverId) {
  return runGoldenCases({
    solverId,
    solve(input) {
      const outcome = structuredClone(solveReferenceRoute(input));
      if (input.graph.graphId === 'unique-shortest-graph') return mutate(outcome);
      return outcome;
    },
  });
}

function ledgerEntry(ledger, caseId) {
  const entry = ledger.entries.find((candidate) => candidate.caseId === caseId);
  assert.ok(entry, `Missing ledger entry for ${caseId}`);
  return entry;
}
