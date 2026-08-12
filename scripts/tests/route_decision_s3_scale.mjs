import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ROUTE_DECISION_SCHEMA_VERSIONS } from '../../src/route_decision/contracts/index.js';
import {
  S3_CONFIGURATION_GROUPS,
  S3_CONFIGURATION_IDS,
  S3_SCENARIO_COUNTS,
  S3_SYNTHETIC_PROFILES,
} from '../../src/route_decision/contracts/scenario_cohort_v1.js';
import {
  buildRouteS3FocusedReport,
  executeRouteS3JoinedRecord,
  summarizeRouteS3FocusedEvidence,
} from '../lib/route_s3_harness.mjs';
import {
  assertRouteS3OracleImportBoundary,
  assertRouteS3ProductAdapterImportBoundary,
  collectStaticImportClosure,
} from '../lib/route_s3_import_boundary.mjs';
import { evaluateIndependentRouteCase } from '../lib/route_s3_oracle.mjs';
import { invokeRouteS3Product } from '../lib/route_s3_product_adapter.mjs';
import {
  ROUTE_S3_SCALE_CHUNK_MAX_RECORDS,
  ROUTE_S3_SCALE_RUNNER_VERSIONS,
  combineRouteS3ScaleCheckpoints,
  createRouteS3ScaleExecutionSession,
  exportRouteS3AdmittedManifestCompanion,
  getRouteS3ScaleWorklist,
  resumeRouteS3MainChunks,
  runRouteS3Conformance,
  runRouteS3MainChunk,
} from '../lib/route_s3_scale_runner.mjs';
import { createRouteS3FocusedRunManifest } from './fixtures/route_decision_s3/protocol_fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const CAPABILITY_FACTORS = ['step-free', 'curb-ramp-present', 'paved-surface'];
const REASON_BY_STATE = {
  unknown: 'not-observed',
  unavailable: 'source-unavailable',
  partial: 'coverage-partial',
  stale: 'observation-stale',
  invalid: 'source-invalid',
};

function sourceObservation(factorId, state = 'observed', value = true) {
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.sourceObservation,
    factorId,
    state,
    value: state === 'observed' ? value : null,
    unit: 'boolean',
    reasonCode: state === 'observed' ? null : REASON_BY_STATE[state],
    sourceId: 'synthetic-s3-micrograph-evidence',
  };
}

function generatedShape(generator) {
  if (generator.kind === 'parallel-routes') {
    const nodes = ['o', 'd', ...Array.from({ length: generator.count }, (_, index) => `r${index}`)];
    const edges = Array.from({ length: generator.count }, (_, index) => [
      [`r${index}-a`, 'o', `r${index}`, 100 + index, 10 + index],
      [`r${index}-b`, `r${index}`, 'd', 100 + index, 10 + index],
    ]).flat();
    return { nodes, edges };
  }
  if (generator.kind === 'fanout-capacity') {
    const leaves = Array.from({ length: generator.width }, (_, index) => `f${index}`);
    return {
      nodes: ['o', 'd', ...leaves],
      edges: leaves.map((nodeId, index) => [`f-${String(index).padStart(4, '0')}`, 'o', nodeId, 1, 1]),
    };
  }
  if (generator.kind === 'second-pass-chain') {
    return {
      nodes: ['o', 'a', 'd'],
      edges: [
        ['e-oa', 'o', 'a', 1, 1],
        ['e-ad', 'a', 'd', 1, 1],
      ],
    };
  }
  if (generator.kind === 'expansion-order-budget') {
    return {
      nodes: ['o', 'a', 'b', 'd'],
      edges: [
        ['e-oa', 'o', 'a', 1, 1],
        ['e-ob', 'o', 'b', 1, 2],
        ['e-ad', 'a', 'd', 1, 100],
        ['e-bd', 'b', 'd', 1, 1],
      ],
    };
  }
  if (generator.kind === 'candidateful-budget') {
    return {
      nodes: ['o', 'a', 'h', 'd'],
      edges: [
        ['e-od', 'o', 'd', 1, 1],
        ['e-oa', 'o', 'a', 1, 2],
        ['e-ad', 'a', 'd', 1, 1],
        ['e-ah', 'a', 'h', 1, 3],
      ],
    };
  }
  if (generator.kind === 'candidateful-capacity') {
    const leaves = Array.from({ length: generator.width }, (_, index) => `c${index + 1}`);
    return {
      nodes: ['o', 'a', 'h', 'd', ...leaves],
      edges: [
        ['e-od', 'o', 'd', 1, 1],
        ['e-oa', 'o', 'a', 1, 2],
        ['e-ad', 'a', 'd', 1, 1],
        ['e-ah', 'a', 'h', 1, 3],
        ...leaves.map((nodeId, index) => [`e-h-${index + 1}`, 'h', nodeId, 1, 1]),
      ],
    };
  }
  if (generator.kind === 'direct-k') {
    return { nodes: ['o', 'd'], edges: [['e-od', 'o', 'd', 1, 1]] };
  }
  if (generator.kind === 'capacity-before-k') {
    const leaves = Array.from({ length: generator.width }, (_, index) => `c${index + 1}`);
    return {
      nodes: ['o', 'd', ...leaves],
      edges: [
        ['e0000', 'o', 'd', 1, 1],
        ...leaves.map((nodeId, index) => [`e${String(index + 1).padStart(4, '0')}`, 'o', nodeId, 1, 1]),
      ],
    };
  }
  if (generator.kind === 'budget-before-capacity') {
    const leaves = Array.from({ length: generator.width }, (_, index) => `c${index + 1}`);
    return {
      nodes: ['o', 'd', ...leaves],
      edges: [
        ['e0000', 'o', 'd', 1, 100],
        ...leaves.map((nodeId, index) => [`e${String(index + 1).padStart(4, '0')}`, 'o', nodeId, 1, 1]),
      ],
    };
  }
  throw new TypeError(`unknown fixture generator ${generator.kind}`);
}

function weakComponents(nodeIds, edges) {
  const neighbors = new Map(nodeIds.map((nodeId) => [nodeId, []]));
  for (const [, fromNodeId, toNodeId] of edges) {
    neighbors.get(fromNodeId).push(toNodeId);
    neighbors.get(toNodeId).push(fromNodeId);
  }
  const byNodeId = {};
  let count = 0;
  for (const nodeId of nodeIds) {
    if (Object.hasOwn(byNodeId, nodeId)) continue;
    byNodeId[nodeId] = count;
    const queue = [nodeId];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const neighbor of neighbors.get(queue[cursor])) {
        if (Object.hasOwn(byNodeId, neighbor)) continue;
        byNodeId[neighbor] = count;
        queue.push(neighbor);
      }
    }
    count += 1;
  }
  return { kind: 'weakly-connected', count, byNodeId };
}

function graphForFixture(fixture) {
  const shape = fixture.generator ? generatedShape(fixture.generator) : fixture;
  const nodes = shape.nodes.map((nodeId) => ({ nodeId }));
  const edges = shape.edges.map(([edgeId, fromNodeId, toNodeId, distanceMm, objectiveCostUnits]) => ({
    edgeId, fromNodeId, toNodeId, distanceMm, objectiveCostUnits,
  }));
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.graphArtifact,
    graphId: `s3-${fixture.caseId}`,
    mode: 'walk',
    directed: true,
    nodes,
    edges,
    components: weakComponents(shape.nodes, shape.edges),
    provenance: { dataClassification: 'synthetic', sourceIds: [`synthetic-${fixture.caseId}`] },
    receipt: { artifactVersion: `${fixture.caseId}-v1` },
  };
}

function evidenceForFixture(graph, fixture) {
  return {
    edgeEvidence: graph.edges.map(({ edgeId }) => ({
      edgeId,
      observations: Object.fromEntries(CAPABILITY_FACTORS.map((factorId) => {
        const override = fixture.evidenceOverrides?.[`${edgeId}:${factorId}`];
        const observation = override === undefined
          ? sourceObservation(factorId)
          : typeof override === 'boolean'
            ? sourceObservation(factorId, 'observed', override)
            : sourceObservation(factorId, override);
        return [factorId, observation];
      })),
    })),
  };
}

function clampFloorPolicy() {
  const policy = structuredClone(S3_CONFIGURATION_GROUPS[0].decisionPolicy);
  policy.policyId = 's3-clamp-floor-policy-v1';
  policy.softPreferences[0].rangeMax = 3;
  return policy;
}

function caseInputs(fixture) {
  const graphArtifact = graphForFixture(fixture);
  const configuration = fixture.policyKind === 'clamp-floor'
    ? null
    : S3_CONFIGURATION_GROUPS[fixture.configurationIndex];
  const decisionPolicy = configuration
    ? structuredClone(configuration.decisionPolicy)
    : clampFloorPolicy();
  const template = structuredClone(
    configuration?.searchRequestTemplate ?? S3_CONFIGURATION_GROUPS[0].searchRequestTemplate,
  );
  const requestOverrides = fixture.requestOverrides ?? {};
  const searchRequest = {
    ...template,
    requestId: `${fixture.caseId}-request`,
    graphId: graphArtifact.graphId,
    originNodeId: 'o',
    destinationNodeId: 'd',
    decisionPolicyId: decisionPolicy.policyId,
    ...requestOverrides,
    bounds: requestOverrides.bounds
      ? { ...requestOverrides.bounds }
      : { ...template.bounds },
  };
  return {
    graphArtifact,
    searchRequest,
    edgeFactorEvidence: evidenceForFixture(graphArtifact, fixture),
    decisionPolicy,
  };
}

function uniqueDispositionIds(items) {
  return [...new Set(items.map(({ candidateId }) => candidateId))];
}

function canonicalProductOutcome({ searchResult, decisionEvaluation }) {
  const candidateSet = searchResult.candidateSet;
  const evaluation = decisionEvaluation.evaluation;
  const decision = evaluation.decision;
  return {
    termination: searchResult.termination,
    searchMetadata: {
      status: searchResult.status,
      requestedCandidateCount: searchResult.request?.requestedCandidateCount ?? null,
      candidateCount: searchResult.candidateFacts.length,
      expandedStateCount: candidateSet?.expandedStateCount ?? null,
      routeSearchCompleteness: candidateSet?.completeness.routeSearch ?? null,
      constraintOutcome: candidateSet?.constraintOutcome ?? null,
      budgetOutcome: candidateSet?.budgetOutcome ?? null,
      capacityOutcome: candidateSet?.capacityOutcome ?? null,
      unresolvedEvidenceEncountered: candidateSet === null
        || searchResult.termination === 'requested-candidate-count-reached'
        ? null
        : candidateSet.constraintOutcome === 'unresolved-evidence',
    },
    orderedCandidates: searchResult.candidateFacts.map(({ candidateId, edgeIds }) => ({
      candidateId,
      edgeIds: [...edgeIds],
    })),
    providedSetDecision: {
      evaluationSchemaVersion: decisionEvaluation.schemaVersion,
      evaluationStatus: evaluation.status,
      reasonCode: evaluation.reasonCode,
      decisionSchemaVersion: decision?.schemaVersion ?? null,
      scope: decision?.scope ?? null,
      decisionStatus: decision?.status ?? null,
      admittedCandidateIds: decision ? [...decision.admittedCandidateIds] : [],
      rankedCandidateIds: decision ? [...decision.rankedCandidateIds] : [],
      rejectedCandidateIds: decision ? uniqueDispositionIds(decision.rejected) : [],
      unresolvedCandidateIds: decision ? uniqueDispositionIds(decision.unresolved) : [],
      publicExplanation: decision ? {
        hardConstraintTrace: decision.trace.filter(({ stage }) => stage === 'hard-constraint'),
        softPreferenceTrace: decision.trace.filter(({ stage }) => stage === 'soft-preference'),
        candidateDispositions: decision.trace.filter(({ stage }) => stage === 'candidate-disposition'),
        rankingTrace: decision.trace.filter(({ stage }) => stage === 'ranking'),
      } : {
        hardConstraintTrace: [], softPreferenceTrace: [],
        candidateDispositions: [], rankingTrace: [],
      },
    },
  };
}

const fixtureDocument = JSON.parse(await readFile(
  resolve(HERE, 'fixtures', 'route_decision_s3', 'micrographs.json'),
  'utf8',
));

test('S3 frozen configuration/profile semantics retain their non-behavioral meanings', () => {
  assert.equal(S3_SCENARIO_COUNTS.scenarioConfigEvaluations, 5_000);
  assert.deepEqual(S3_CONFIGURATION_IDS, [
    's3-objective-cost-only',
    's3-distance-ranking-over-objective-candidates',
    's3-distance-objective-equal-weight',
    's3-distance-objective-reweighted-range-capped',
    's3-three-capability-constraint-aware',
  ]);
  assert.deepEqual(
    S3_CONFIGURATION_GROUPS[2].decisionPolicy.softPreferences.map(({ weightBasisPoints }) => weightBasisPoints),
    [5_000, 5_000],
  );
  assert.deepEqual(
    S3_CONFIGURATION_GROUPS[3].decisionPolicy.softPreferences.map(({ weightBasisPoints, rangeMax }) => ({
      weightBasisPoints, rangeMax,
    })),
    [
      { weightBasisPoints: 6_500, rangeMax: 50_000_000 },
      { weightBasisPoints: 3_500, rangeMax: 50_000_000 },
    ],
  );
  assert.deepEqual(
    S3_CONFIGURATION_GROUPS[4].decisionPolicy.hardConstraints.map(({ factorId }) => factorId),
    CAPABILITY_FACTORS,
  );
  assert.deepEqual(
    S3_SYNTHETIC_PROFILES.map(({ assignmentTarget, behavioralEffect }) => ({ assignmentTarget, behavioralEffect })),
    [
      { assignmentTarget: 500, behavioralEffect: 'forbidden' },
      { assignmentTarget: 500, behavioralEffect: 'forbidden' },
    ],
  );
});

test('clean-room oracle exactly matches product outcomes across focused differential fixtures', async (t) => {
  assert.equal(fixtureDocument.fixtureVersion, 's3-micrograph-fixtures/v1');
  for (const fixture of fixtureDocument.cases) {
    await t.test(fixture.caseId, () => {
      const inputs = caseInputs(fixture);
      const product = invokeRouteS3Product({ ...inputs, invocationId: `${fixture.caseId}-product` });
      const oracle = evaluateIndependentRouteCase(inputs);
      assert.deepEqual(oracle, canonicalProductOutcome(product));
      assert.equal(oracle.termination, fixture.expectedTermination);
      assert.equal(oracle.orderedCandidates.length, fixture.expectedCandidateCount);
      if (fixture.expectedRankedCandidateIds) {
        assert.deepEqual(oracle.providedSetDecision.rankedCandidateIds, fixture.expectedRankedCandidateIds);
      }
      if (fixture.expectedOrderedEdgeIds) {
        assert.deepEqual(oracle.orderedCandidates.map(({ edgeIds }) => edgeIds), fixture.expectedOrderedEdgeIds);
      }
      if (fixture.expectedScoreUnits) {
        assert.deepEqual(
          oracle.providedSetDecision.publicExplanation.candidateDispositions
            .map(({ totalScoreUnits }) => totalScoreUnits),
          fixture.expectedScoreUnits,
        );
        assert.equal(
          oracle.providedSetDecision.publicExplanation.softPreferenceTrace[0].utilityBasisPoints,
          6_666,
        );
      }
      assert.equal(
        new Set(oracle.orderedCandidates.map(({ edgeIds }) => JSON.stringify(edgeIds))).size,
        oracle.orderedCandidates.length,
      );
    });
  }
});

test('frozen resource precedence cases match independent literal outcomes', async (t) => {
  // These literals are hand-derived from the S3-0 charged-event order:
  // destination/K, edge bound, shared budget, expansion, then child capacity.
  // The decision literals separately freeze every canonical evaluator and
  // explanation field; neither expected tree is generated from an execution.
  assert.equal(fixtureDocument.resourceCases.length, 9);
  for (const fixture of fixtureDocument.resourceCases) {
    await t.test(fixture.caseId, () => {
      const inputs = caseInputs(fixture);
      const product = invokeRouteS3Product({ ...inputs, invocationId: `${fixture.caseId}-product` });
      const oracle = evaluateIndependentRouteCase(inputs);
      const expected = {
        termination: fixture.expected.termination,
        searchMetadata: fixture.expected.searchMetadata,
        orderedCandidates: fixture.expected.orderedCandidates,
        providedSetDecision: fixtureDocument.providedSetDecisionLiterals[
          fixture.expected.providedSetDecisionLiteralId
        ],
      };
      assert.deepEqual(canonicalProductOutcome(product), expected);
      assert.deepEqual(oracle, expected);
      assert.deepEqual(oracle, canonicalProductOutcome(product));
    });
  }
});

test('product artifact perturbation cannot change oracle output', () => {
  const fixture = fixtureDocument.cases.find(({ caseId }) => caseId === 'objective-candidateful');
  const inputs = caseInputs(fixture);
  const before = evaluateIndependentRouteCase(inputs);
  const product = structuredClone(invokeRouteS3Product({ ...inputs, invocationId: 'perturb-product' }));
  product.searchResult.candidateFacts.reverse();
  product.decisionEvaluation.evaluation.reasonCode = 'perturbed-product-only';
  const after = evaluateIndependentRouteCase(inputs);
  assert.deepEqual(after, before);
  assert.notDeepEqual(canonicalProductOutcome(product), before);
});

test('rerun and input/configuration permutation preserve exact outcomes', () => {
  const fixtureIds = ['route-order-and-distinctness', 'g4-candidateful'];
  const executeInOrder = (ids) => Object.fromEntries(ids.map((fixtureId) => {
    const fixture = fixtureDocument.cases.find(({ caseId }) => caseId === fixtureId);
    const inputs = caseInputs(fixture);
    return [fixtureId, evaluateIndependentRouteCase(inputs)];
  }));
  assert.deepEqual(executeInOrder(fixtureIds), executeInOrder([...fixtureIds].reverse()));

  const fixture = fixtureDocument.cases.find(({ caseId }) => caseId === 'route-order-and-distinctness');
  const original = caseInputs(fixture);
  const permuted = structuredClone(original);
  permuted.graphArtifact.nodes.reverse();
  permuted.graphArtifact.edges.reverse();
  permuted.edgeFactorEvidence.edgeEvidence.reverse();
  const firstOracle = evaluateIndependentRouteCase(original);
  const secondOracle = evaluateIndependentRouteCase(original);
  const permutedOracle = evaluateIndependentRouteCase(permuted);
  assert.deepEqual(secondOracle, firstOracle);
  assert.deepEqual(permutedOracle, firstOracle);

  const firstProduct = invokeRouteS3Product({ ...original, invocationId: 'rerun-primary' });
  const secondProduct = invokeRouteS3Product({ ...original, invocationId: 'rerun-replay' });
  assert.notEqual(firstProduct.searchResult, secondProduct.searchResult);
  assert.deepEqual(canonicalProductOutcome(firstProduct), canonicalProductOutcome(secondProduct));
});

test('recursive import closures enforce separate oracle and bounded product adapter surfaces', async () => {
  const oracleEntry = resolve(REPO_ROOT, 'scripts', 'lib', 'route_s3_oracle.mjs');
  const adapterEntry = resolve(REPO_ROOT, 'scripts', 'lib', 'route_s3_product_adapter.mjs');
  const [oracleClosure, adapterClosure] = await Promise.all([
    collectStaticImportClosure(oracleEntry),
    collectStaticImportClosure(adapterEntry),
  ]);
  const normalizedOracleFiles = oracleClosure.files.map((file) => file.replaceAll('\\', '/'));
  const normalizedAdapterFiles = adapterClosure.files.map((file) => file.replaceAll('\\', '/'));
  assert.equal(assertRouteS3OracleImportBoundary(oracleClosure), oracleClosure);
  assert.equal(assertRouteS3ProductAdapterImportBoundary(adapterClosure), adapterClosure);
  assert.deepEqual(normalizedOracleFiles, [oracleEntry.replaceAll('\\', '/')]);
  assert.deepEqual(oracleClosure.edges, []);
  assert.equal(normalizedOracleFiles.some((file) => /scenario_cohort_v1|route_generation|route_decision\/evaluator|route_decision\/enrichment/u.test(file)), false);
  assert.equal(normalizedAdapterFiles.some((file) => file.endsWith('/src/route_generation/candidate_search/index.js')), true);
  assert.equal(normalizedAdapterFiles.some((file) => file.endsWith('/src/route_decision/evaluator/search_v2.js')), true);
  assert.equal(normalizedAdapterFiles.some((file) => file.endsWith('/src/route_decision/evaluator/evaluate_admitted.js')), true);
  assert.equal(normalizedAdapterFiles.some((file) => file.includes('/scripts/lib/route_graph_candidate/')), false);
  assert.equal(normalizedAdapterFiles.some((file) => file.endsWith('/src/route_decision/contracts/scenario_cohort_v1.js')), false);
  assert.deepEqual(
    adapterClosure.edges
      .filter(({ importer }) => importer === adapterEntry)
      .map(({ specifier }) => specifier)
      .sort(),
    [
      '../../src/route_decision/evaluator/search_v2.js',
      '../../src/route_generation/candidate_search/index.js',
    ],
  );
  const runtimePoisonedAdapterClosure = {
    ...adapterClosure,
    edges: [...adapterClosure.edges, {
      importer: adapterClosure.files.at(-1),
      kind: 'runtime-loader',
      specifier: './product.mjs',
      loader: 'require',
      imported: null,
    }],
  };
  assert.throws(
    () => assertRouteS3ProductAdapterImportBoundary(runtimePoisonedAdapterClosure),
    /unresolved or runtime-loader dependency/u,
  );
  const capabilityPoisonedAdapterClosure = {
    ...adapterClosure,
    capabilityReferences: [...adapterClosure.capabilityReferences, {
      file: adapterClosure.entry,
      capability: 'WebSocket',
      tokenIndex: 0,
    }],
  };
  assert.throws(
    () => assertRouteS3ProductAdapterImportBoundary(capabilityPoisonedAdapterClosure),
    /entry references a forbidden capability: WebSocket/u,
  );
  for (const forbiddenFile of [
    resolve(REPO_ROOT, 'scripts', 'lib', 'route_s3_oracle.mjs'),
    resolve(REPO_ROOT, 'scripts', 'lib', 'route_s3_harness.mjs'),
    resolve(REPO_ROOT, 'scripts', 'lib', 'route_s3_import_boundary.mjs'),
    resolve(REPO_ROOT, 'scripts', 'tests', 'route_decision_s3_scale.mjs'),
    resolve(REPO_ROOT, 'scripts', 'tests', 'fixtures', 'route_decision_s3', 'protocol_fixture.mjs'),
  ]) {
    const s3PoisonedClosure = {
      ...adapterClosure,
      files: [...adapterClosure.files, forbiddenFile],
      edges: [...adapterClosure.edges, {
        importer: adapterClosure.files.find((file) => file.endsWith('search_v2.js')),
        kind: 'static-import',
        specifier: './poisoned-s3-surface.mjs',
        loader: null,
        imported: forbiddenFile,
      }],
    };
    assert.throws(
      () => assertRouteS3ProductAdapterImportBoundary(s3PoisonedClosure),
      /crosses a forbidden boundary/u,
    );
  }
});

test('import scanner rejects export/dynamic/bare and direct runtime-loader bypasses', async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'route-s3-import-boundary-'));
  try {
    const modulePath = (name) => resolve(temporaryRoot, name);
    await Promise.all([
      writeFile(modulePath('entry.mjs'), [
        "export { value } from './exported.mjs';",
        'import { single as staticSingle } from "./single.mjs";',
        "import './side.mjs';",
        "const single = import ( './single.mjs' );",
        'const double = import(  "./double.mjs"  );',
        'const ignoredString = "import(\\\'./ignored.mjs\\\')";',
        'const ignoredRegex = /import\\(\\\'ignored\\\'\\)/u;',
        'const templateExpression = `${1 + 1}`;',
        'void staticSingle; void single; void double; void ignoredString; void ignoredRegex; void templateExpression;',
      ].join('\n'), 'utf8'),
      writeFile(modulePath('exported.mjs'), "export * from './nested.mjs';\nexport const value = 1;\n", 'utf8'),
      writeFile(modulePath('nested.mjs'), 'export const nested = 1;\n', 'utf8'),
      writeFile(modulePath('single.mjs'), 'export const single = 1;\n', 'utf8'),
      writeFile(modulePath('double.mjs'), 'export const double = 1;\n', 'utf8'),
      writeFile(modulePath('side.mjs'), 'export const side = 1;\n', 'utf8'),
      writeFile(modulePath('bare.mjs'), "import 'node:fs';\nimport '#self';\nimport 'package-name';\n", 'utf8'),
      writeFile(modulePath('relative.mjs'), "import './single.mjs';\n", 'utf8'),
      writeFile(modulePath('nonliteral.mjs'), "const target = './single.mjs';\nawait import ( target );\n", 'utf8'),
      writeFile(modulePath('nonliteral-concat.mjs'), "const name = 'single.mjs';\nawait import('./' + name);\n", 'utf8'),
      writeFile(modulePath('template-dynamic.mjs'), 'await import(`./single.mjs`);\n', 'utf8'),
      writeFile(modulePath('runtime-require.mjs'), "const product = require('./product.mjs');\nvoid product;\n", 'utf8'),
      writeFile(
        modulePath('runtime-create-require.mjs'),
        "const product = process.getBuiltinModule('node:module').createRequire(import.meta.url)('./product.mjs');\nvoid product;\n",
        'utf8',
      ),
      writeFile(modulePath('runtime-builtin.mjs'), "const fs = process.getBuiltinModule('node:fs');\nvoid fs;\n", 'utf8'),
      writeFile(modulePath('runtime-meta-resolve.mjs'), "const path = import.meta.resolve('./product.mjs');\nvoid path;\n", 'utf8'),
      writeFile(modulePath('runtime-eval.mjs'), "eval(\"require('./product.mjs')\");\n", 'utf8'),
      writeFile(modulePath('runtime-function.mjs'), "Function(\"return require('./product.mjs')\")();\n", 'utf8'),
      writeFile(modulePath('runtime-async-function.mjs'), "AsyncFunction(\"return import('./product.mjs')\")();\n", 'utf8'),
      writeFile(modulePath('runtime-capability-declarations.mjs'), [
        "const labels = { require: 'r', createRequire: 'c', getBuiltinModule: 'g', resolve: 'x', eval: 'e', Function: 'f', AsyncFunction: 'a' };",
        "function require(label) { return label; }",
        "class LoaderNames { createRequire() { return 'label'; } }",
        "const methods = { require() { return 'label'; } };",
        "const ordinaryString = \"process.getBuiltinModule('node:fs')\";",
        "const ordinaryRegex = /require\\(['\"]product['\"]\\)/u;",
        "const ordinaryTemplate = `import.meta.resolve('./product.mjs')`;",
        'void labels; void require; void LoaderNames; void methods; void ordinaryString; void ordinaryRegex; void ordinaryTemplate;',
      ].join('\n'), 'utf8'),
      writeFile(modulePath('runtime-raw-text-only.mjs'), [
        "// process require createRequire import.meta eval Function AsyncFunction Reflect constructor __proto__ prototype",
        "const ordinaryString = \"globalThis['require'] process.getBuiltinModule('node:fs')\";",
        "const ordinaryRegex = /Reflect\\.construct\\(Function\\)/u;",
        "const ordinaryTemplate = `import.meta.resolve('./product.mjs')`;",
        'const benign = 1;',
        'void ordinaryString; void ordinaryRegex; void ordinaryTemplate; void benign;',
      ].join('\n'), 'utf8'),
      writeFile(modulePath('alias-all.mjs'), [
        'const get=process.getBuiltinModule;',
        "const mod=get('node:module');",
        'const make=mod.createRequire;',
        "const load=make(process.cwd()+'/oracle-alias.mjs');",
        "const fs=load('node:fs');",
        "console.log(typeof fs.readFileSync === 'function');",
      ].join('\n'), 'utf8'),
      writeFile(modulePath('runtime-global-bracket.mjs'), "const load=globalThis['require'];\nvoid load;\n", 'utf8'),
      writeFile(modulePath('runtime-meta-alias.mjs'), 'const resolveModule=import.meta.resolve;\nvoid resolveModule;\n', 'utf8'),
      writeFile(modulePath('runtime-eval-alias.mjs'), 'const run=eval;\nvoid run;\n', 'utf8'),
      writeFile(modulePath('runtime-reflect-function.mjs'), "const run=Reflect.construct(Function,[\"return 1\"]);\nvoid run;\n", 'utf8'),
      writeFile(modulePath('runtime-websocket.mjs'), "const socket=new WebSocket('ws://127.0.0.1:1');\nvoid socket;\n", 'utf8'),
      writeFile(modulePath('runtime-unicode-alias.mjs'), [
        'const get=pro\\u0063ess.getBuiltinModule;',
        "const mod=get('node:module');",
        'const make=mod.cre\\u0061teRequire;',
        'void make;',
      ].join('\n'), 'utf8'),
      writeFile(modulePath('runtime-computed-constructor.mjs'), 'const Build=(()=>{})["constructor"];\nvoid Build;\n', 'utf8'),
      writeFile(modulePath('runtime-computed-prototype.mjs'), 'const get=Object["getPrototypeOf"];\nvoid get;\n', 'utf8'),
      writeFile(modulePath('runtime-computed-process.mjs'), 'const root=globalThis["process"];\nvoid root;\n', 'utf8'),
      writeFile(modulePath('runtime-standalone-string.mjs'), 'const label="constructor";\nvoid label;\n', 'utf8'),
    ]);

    const recursive = await collectStaticImportClosure(modulePath('entry.mjs'));
    assert.equal(recursive.files.length, 6);
    assert.deepEqual(
      recursive.edges.map(({ kind, specifier }) => ({ kind, specifier })).sort((left, right) => {
        if (left.specifier < right.specifier) return -1;
        if (left.specifier > right.specifier) return 1;
        if (left.kind < right.kind) return -1;
        if (left.kind > right.kind) return 1;
        return 0;
      }),
      [
        { kind: 'dynamic-import', specifier: './double.mjs' },
        { kind: 'export-from', specifier: './exported.mjs' },
        { kind: 'export-from', specifier: './nested.mjs' },
        { kind: 'side-effect-import', specifier: './side.mjs' },
        { kind: 'dynamic-import', specifier: './single.mjs' },
        { kind: 'static-import', specifier: './single.mjs' },
      ],
    );

    const bare = await collectStaticImportClosure(modulePath('bare.mjs'));
    assert.deepEqual(bare.edges.map(({ specifier, imported }) => ({ specifier, imported })), [
      { specifier: 'node:fs', imported: null },
      { specifier: '#self', imported: null },
      { specifier: 'package-name', imported: null },
    ]);
    assert.throws(() => assertRouteS3OracleImportBoundary(bare), /empty dependency edges/u);
    const relative = await collectStaticImportClosure(modulePath('relative.mjs'));
    assert.throws(() => assertRouteS3OracleImportBoundary(relative), /empty dependency edges/u);
    await assert.rejects(
      collectStaticImportClosure(modulePath('nonliteral.mjs')),
      /non-literal dynamic import/u,
    );
    await assert.rejects(
      collectStaticImportClosure(modulePath('nonliteral-concat.mjs')),
      /non-literal dynamic import/u,
    );
    await assert.rejects(
      collectStaticImportClosure(modulePath('template-dynamic.mjs')),
      /non-literal dynamic import/u,
    );

    const runtimeCases = [
      ['runtime-require.mjs', ['require']],
      ['runtime-create-require.mjs', ['process.getBuiltinModule', 'createRequire']],
      ['runtime-builtin.mjs', ['process.getBuiltinModule']],
      ['runtime-meta-resolve.mjs', ['import.meta.resolve']],
      ['runtime-eval.mjs', ['eval']],
      ['runtime-function.mjs', ['Function']],
      ['runtime-async-function.mjs', ['AsyncFunction']],
    ];
    for (const [file, expectedLoaders] of runtimeCases) {
      const closure = await collectStaticImportClosure(modulePath(file));
      assert.deepEqual(closure.edges.map(({ kind, loader }) => ({ kind, loader })), expectedLoaders.map((loader) => ({
        kind: 'runtime-loader', loader,
      })));
      assert.throws(
        () => assertRouteS3OracleImportBoundary(closure),
        /empty dependency edges/u,
      );
    }
    const capabilityDeclarations = await collectStaticImportClosure(modulePath('runtime-capability-declarations.mjs'));
    assert.deepEqual(capabilityDeclarations.edges, []);
    assert.equal(capabilityDeclarations.capabilityReferences.length > 0, true);
    assert.throws(
      () => assertRouteS3OracleImportBoundary(capabilityDeclarations),
      /forbidden capability references/u,
    );
    const rawTextOnly = await collectStaticImportClosure(modulePath('runtime-raw-text-only.mjs'));
    assert.deepEqual(rawTextOnly.edges, []);
    assert.deepEqual(rawTextOnly.capabilityReferences, []);
    assert.equal(assertRouteS3OracleImportBoundary(rawTextOnly), rawTextOnly);

    const aliasExecution = spawnSync(process.execPath, [modulePath('alias-all.mjs')], {
      cwd: temporaryRoot,
      encoding: 'utf8',
    });
    assert.equal(aliasExecution.status, 0, aliasExecution.stderr);
    assert.equal(aliasExecution.stdout.trim(), 'true');
    for (const file of [
      'alias-all.mjs',
      'runtime-global-bracket.mjs',
      'runtime-meta-alias.mjs',
      'runtime-eval-alias.mjs',
      'runtime-reflect-function.mjs',
      'runtime-websocket.mjs',
    ]) {
      const closure = await collectStaticImportClosure(modulePath(file));
      assert.equal(closure.capabilityReferences.length > 0, true, file);
      assert.throws(
        () => assertRouteS3OracleImportBoundary(closure),
        /forbidden capability references/u,
      );
    }
    await assert.rejects(
      collectStaticImportClosure(modulePath('runtime-unicode-alias.mjs')),
      /escaped code token/u,
    );
    for (const [file, capability] of [
      ['runtime-computed-constructor.mjs', 'constructor'],
      ['runtime-computed-prototype.mjs', 'getPrototypeOf'],
      ['runtime-computed-process.mjs', 'process'],
    ]) {
      const closure = await collectStaticImportClosure(modulePath(file));
      assert.equal(
        closure.capabilityReferences.some((reference) => reference.capability === capability),
        true,
        file,
      );
      assert.throws(
        () => assertRouteS3OracleImportBoundary(closure),
        /forbidden capability references/u,
      );
    }
    const standaloneString = await collectStaticImportClosure(modulePath('runtime-standalone-string.mjs'));
    assert.deepEqual(standaloneString.edges, []);
    assert.deepEqual(standaloneString.capabilityReferences, []);
    assert.equal(assertRouteS3OracleImportBoundary(standaloneString), standaloneString);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('S3 admissions preserve two real invocations, denominator truth, and diagnostic-only performance', () => {
  const runManifest = createRouteS3FocusedRunManifest();
  const mainScenarioId = runManifest.protocol.cohort.odPairs[0].odPairId;
  const main = executeRouteS3JoinedRecord({
    runManifest,
    denominatorKind: 'main',
    scenarioId: mainScenarioId,
    configurationId: S3_CONFIGURATION_IDS[4],
  });
  assert.deepEqual(main.invocationSequence.map(({ sequence, role }) => ({ sequence, role })), [
    { sequence: 1, role: 'primary' },
    { sequence: 2, role: 'replay' },
  ]);
  assert.equal(main.productResultObjectsAreDistinct, true);
  assert.notEqual(
    main.joinedRecord.primaryExecution.executionAttemptId,
    main.joinedRecord.replayExecution.executionAttemptId,
  );
  assert.equal(main.joinedRecord.replayComparison, 'match');
  assert.equal(main.joinedRecord.oracleComparison, 'match');

  const conformance = runManifest.protocol.cohort.conformanceProbes.map((probe) => (
    executeRouteS3JoinedRecord({
      runManifest,
      denominatorKind: 'conformance',
      scenarioId: probe.probeId,
      configurationId: probe.configurationId,
    }).joinedRecord
  ));
  const report = buildRouteS3FocusedReport({
    runManifest,
    mainRecords: [main.joinedRecord],
    conformanceRecords: conformance,
  });
  assert.equal(report.mainCohortDenominators.expected, 5_000);
  assert.equal(report.mainCohortDenominators.recorded, 1);
  assert.equal(report.mainCohortDenominators.terminal, 1);
  assert.equal(report.mainCohortDenominators.replayComparisons.match, 1);
  assert.equal(report.mainCohortDenominators.oracleComparisons.match, 1);
  assert.equal(report.mainCohortDenominators.performanceMeasurements.primary.measured, 0);
  assert.equal(report.conformanceDenominators.expected, 4);
  assert.equal(report.conformanceDenominators.recorded, 4);
  assert.equal(report.conformanceDenominators.conformanceOutcomes.pass, 4);
  assert.equal(report.disclosures.partialRun, true);
  assert.equal(report.disclosures.stoppedRecords, 0);
  assert.equal(report.executionEvidence.performanceInterpretation, 'diagnostic-only-no-performance-claim-eligible-in-v1');
  assert.deepEqual(report.emittedClaimCodes, []);

  const focused = summarizeRouteS3FocusedEvidence([main.joinedRecord, ...conformance]);
  assert.equal(focused.recorded, 5);
  assert.equal(focused.productInvocations, 10);
  assert.equal(focused.terminalPrimary, 5);
  assert.equal(focused.primaryCandidates, 1);
  assert.equal(focused.constraintRecords, 3);
  assert.equal(focused.terminalOutcomes['invalid-input'], 1);
  assert.equal(focused.terminalOutcomes['no-directed-route-in-bounded-scope'], 1);
  assert.equal(focused.terminalOutcomes['unresolved-constraint-evidence'], 1);
  assert.equal(focused.terminalOutcomes['no-eligible-route-in-bounded-scope'], 1);
  assert.equal(focused.completenessOutcomes['not-evaluated'], 1);
  assert.equal(focused.budgetOutcomes['within-budget'], 4);
  assert.equal(focused.capacityOutcomes['within-capacity'], 4);
  assert.equal(focused.explanationItems.hardConstraint > 0, true);
  assert.equal(focused.explanationItems.softPreference > 0, true);
  assert.equal(focused.explanationItems.candidateDisposition > 0, true);
  assert.equal(focused.explanationItems.ranking > 0, true);
});

let cachedScaleArtifacts;

function scaleArtifacts() {
  if (cachedScaleArtifacts) return cachedScaleArtifacts;
  const runManifest = createRouteS3FocusedRunManifest();
  const session = createRouteS3ScaleExecutionSession({ runManifest });
  const first = runRouteS3MainChunk({ session, startIndex: 0, maxRecords: 1 });
  const second = resumeRouteS3MainChunks({
    session,
    previousCheckpoint: first,
    maxRecords: 1,
  });
  const conformance = runRouteS3Conformance({ session });
  cachedScaleArtifacts = Object.freeze({ runManifest, session, first, second, conformance });
  return cachedScaleArtifacts;
}

test('scale runner freezes the exact admitted 1,000 OD by five-configuration worklist', () => {
  const { runManifest, session } = scaleArtifacts();
  const worklist = getRouteS3ScaleWorklist(session);
  const admittedConfigurationOrder = runManifest.configurationExecutions.map(({ configurationId }) => configurationId);
  assert.equal(worklist.main.length, 5_000);
  assert.equal(new Set(worklist.main.map(({ scenarioId }) => scenarioId)).size, 1_000);
  assert.equal(new Set(worklist.main.map(({ recordKey: key }) => key)).size, 5_000);
  for (let odIndex = 0; odIndex < 1_000; odIndex += 1) {
    const slice = worklist.main.slice(odIndex * 5, (odIndex + 1) * 5);
    assert.deepEqual(slice.map(({ configurationId }) => configurationId), admittedConfigurationOrder);
    assert.deepEqual(
      [...new Set(slice.map(({ scenarioId }) => scenarioId))],
      [runManifest.protocol.cohort.odPairs[odIndex].odPairId],
    );
  }
  assert.equal(worklist.conformance.length, 4);
  assert.equal(worklist.conformance.every(({ denominatorKind }) => denominatorKind === 'conformance'), true);
  assert.equal(worklist.main.some(({ recordKey: key }) => (
    worklist.conformance.some(({ recordKey: probeKey }) => probeKey === key)
  )), false);
  assert.equal(worklist.identity.worklistIdentity.expectedRecords, 5_000);
  assert.equal(Object.isFrozen(worklist), true);
  assert.equal(Object.isFrozen(worklist.main), true);
  assert.equal(Object.isFrozen(worklist.main[0]), true);
});

test('bounded main chunks execute prefix and middle ranges without implying a complete run', () => {
  const { session, first } = scaleArtifacts();
  const middle = runRouteS3MainChunk({ session, startIndex: 10, maxRecords: 2 });
  assert.deepEqual(
    {
      startIndex: first.startIndex,
      targetEndIndex: first.targetEndIndex,
      endIndex: first.endIndex,
      nextIndex: first.nextIndex,
      expectedRecords: first.expectedRecords,
      rangeStatus: first.rangeStatus,
      mainComplete: first.mainComplete,
      conformanceComplete: first.conformanceComplete,
      evidenceComplete: first.evidenceComplete,
      partialRun: first.partialRun,
    },
    {
      startIndex: 0,
      targetEndIndex: 1,
      endIndex: 1,
      nextIndex: 1,
      expectedRecords: 5_000,
      rangeStatus: 'complete',
      mainComplete: false,
      conformanceComplete: false,
      evidenceComplete: false,
      partialRun: true,
    },
  );
  assert.equal(middle.startIndex, 10);
  assert.equal(middle.endIndex, 12);
  assert.deepEqual(middle.orderedRecordKeys, middle.joinedRecords.map(({ recordKey: key }) => key));
  assert.equal(middle.joinedRecords.every(({ primaryExecution, replayExecution }) => (
    primaryExecution.attemptState === 'terminal' && replayExecution.attemptState === 'terminal'
  )), true);
  assert.equal(middle.failureSource, null);
  assert.equal(middle.faultInjectionUsed, false);
  assert.deepEqual(middle.emittedClaimCodes, []);
  assert.equal(middle.performance.measurementStatus, 'measurement-not-enabled');
  assert.equal(middle.performance.performanceSamples, 0);
  assert.match(middle.performance.interpretation, /diagnostic-only/u);
  assert.throws(
    () => runRouteS3MainChunk({
      session,
      startIndex: 0,
      maxRecords: ROUTE_S3_SCALE_CHUNK_MAX_RECORDS + 1,
    }),
    /maxRecords is outside its integer bounds/u,
  );
});

test('resume and combine require a continuous prefix and retain a partial no-claim report', () => {
  const { session, first, second, conformance } = scaleArtifacts();
  assert.equal(second.startIndex, first.nextIndex);
  const combined = combineRouteS3ScaleCheckpoints({
    session,
    mainCheckpoints: [first, second],
    conformanceCheckpoint: conformance,
  });
  assert.equal(combined.schemaVersion, ROUTE_S3_SCALE_RUNNER_VERSIONS.combinedCheckpoint);
  assert.equal(combined.endIndex, 2);
  assert.equal(combined.nextIndex, 2);
  assert.equal(combined.expectedRecords, 5_000);
  assert.equal(combined.mainComplete, false);
  assert.equal(combined.conformanceComplete, true);
  assert.equal(combined.evidenceComplete, false);
  assert.equal(combined.partialRun, true);
  assert.equal(combined.report.disclosures.partialRun, true);
  assert.deepEqual(combined.report.emittedClaimCodes, []);
  assert.equal(combined.report.mainCohortDenominators.recorded, 2);
  assert.equal(combined.report.mainCohortDenominators.expected, 5_000);
  assert.equal(combined.report.conformanceDenominators.recorded, 4);
  assert.equal(combined.conformance.includedInMainCohort, false);
  assert.equal(combined.summary.mainRecorded, 2);
  assert.equal(combined.summary.conformanceRecorded, 4);
  assert.equal(combined.summary.performanceSamples, 0);
  assert.equal(combined.summary.performanceStatus, 'measurement-not-enabled');
  assert.match(combined.summary.performanceInterpretation, /diagnostic-only/u);
});

test('checkpoint sequence validation rejects gap, overlap, duplicate, reorder, and tamper', () => {
  const { session, first, second } = scaleArtifacts();
  const distant = runRouteS3MainChunk({ session, startIndex: 10, maxRecords: 1 });
  for (const checkpoints of [
    [first, distant],
    [first, first],
    [second, first],
  ]) {
    assert.throws(
      () => combineRouteS3ScaleCheckpoints({ session, mainCheckpoints: checkpoints }),
      /gap, overlap, or reorder|duplicate/u,
    );
  }
  const tamperedRange = JSON.parse(JSON.stringify(first));
  tamperedRange.nextIndex = 99;
  assert.throws(
    () => combineRouteS3ScaleCheckpoints({ session, mainCheckpoints: [tamperedRange] }),
    /content digest mismatch/u,
  );
  const tamperedIdentity = JSON.parse(JSON.stringify(first));
  tamperedIdentity.identity.runId = 'tampered-run';
  assert.throws(
    () => combineRouteS3ScaleCheckpoints({ session, mainCheckpoints: [tamperedIdentity] }),
    /identity drifted/u,
  );
  const tamperedRecord = JSON.parse(JSON.stringify(first));
  tamperedRecord.joinedRecords[0].primaryExecution.executionAttemptId = 'tampered-attempt';
  assert.throws(
    () => combineRouteS3ScaleCheckpoints({ session, mainCheckpoints: [tamperedRecord] }),
    /content digest mismatch/u,
  );

  const reorderedObjectKeys = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(first))).reverse());
  assert.equal(
    combineRouteS3ScaleCheckpoints({ session, mainCheckpoints: [reorderedObjectKeys] }).endIndex,
    1,
  );
  const twoRecords = runRouteS3MainChunk({ session, startIndex: 40, maxRecords: 2 });
  const reorderedArray = JSON.parse(JSON.stringify(twoRecords));
  reorderedArray.orderedRecordKeys.reverse();
  assert.throws(
    () => combineRouteS3ScaleCheckpoints({ session, mainCheckpoints: [reorderedArray] }),
    /content digest mismatch/u,
  );
});

test('checkpoint admission fails closed for Proxy and accessor inputs', () => {
  const { session, first } = scaleArtifacts();
  const proxy = new Proxy(first, {
    ownKeys() {
      throw new Error('proxy trap');
    },
  });
  assert.throws(
    () => combineRouteS3ScaleCheckpoints({ session, mainCheckpoints: [proxy] }),
    /inspectable plain data/u,
  );
  const accessor = JSON.parse(JSON.stringify(first));
  Object.defineProperty(accessor, 'nextIndex', {
    enumerable: true,
    get() {
      throw new Error('getter must not execute');
    },
  });
  assert.throws(
    () => combineRouteS3ScaleCheckpoints({ session, mainCheckpoints: [accessor] }),
    /must not be an accessor/u,
  );
});

test('checkpoint hostile trees reject cycles, repeated references, depth, sparse arrays, and oversized arrays', () => {
  const { session, first } = scaleArtifacts();
  const cyclic = JSON.parse(JSON.stringify(first));
  cyclic.identity.cycle = cyclic.identity;
  const repeated = JSON.parse(JSON.stringify(first));
  repeated.performance = repeated.identity;
  const tooDeep = JSON.parse(JSON.stringify(first));
  let cursor = tooDeep.identity;
  for (let index = 0; index < 70; index += 1) {
    cursor.nested = {};
    cursor = cursor.nested;
  }
  const sparse = JSON.parse(JSON.stringify(first));
  sparse.orderedRecordKeys = new Array(2);
  sparse.orderedRecordKeys[0] = first.orderedRecordKeys[0];
  const oversized = JSON.parse(JSON.stringify(first));
  oversized.orderedRecordKeys = Array.from({ length: 10_001 }, () => 'oversized');
  for (const [value, expected] of [
    [cyclic, /cycle or repeated reference/u],
    [repeated, /cycle or repeated reference/u],
    [tooDeep, /depth limit/u],
    [sparse, /must not be sparse/u],
    [oversized, /array limit/u],
  ]) {
    assert.throws(
      () => combineRouteS3ScaleCheckpoints({ session, mainCheckpoints: [value] }),
      expected,
    );
  }
});

test('nested array Proxy admission performs zero direct gets and follows descriptor semantics', () => {
  const { session, first } = scaleArtifacts();
  let transparentGets = 0;
  const transparent = JSON.parse(JSON.stringify(first));
  transparent.orderedRecordKeys = new Proxy(transparent.orderedRecordKeys, {
    get() {
      transparentGets += 1;
      throw new Error('array get trap must not run');
    },
  });
  assert.throws(
    () => combineRouteS3ScaleCheckpoints({ session, mainCheckpoints: [transparent] }),
    /detached JSON-serializable data/u,
  );
  assert.equal(transparentGets, 0);

  let rejectedGets = 0;
  const descriptorRejected = JSON.parse(JSON.stringify(first));
  descriptorRejected.orderedRecordKeys = new Proxy(descriptorRejected.orderedRecordKeys, {
    get() {
      rejectedGets += 1;
      throw new Error('array get trap must not run');
    },
    getOwnPropertyDescriptor() {
      throw new Error('controlled descriptor rejection');
    },
  });
  assert.throws(
    () => combineRouteS3ScaleCheckpoints({ session, mainCheckpoints: [descriptorRejected] }),
    /length must be an inspectable data property/u,
  );
  assert.equal(rejectedGets, 0);
});

test('manifest companion and checkpoint identity bind the complete admitted execution environment', () => {
  const { runManifest, session, first } = scaleArtifacts();
  const companion = exportRouteS3AdmittedManifestCompanion(session);
  assert.equal(companion.schemaVersion, ROUTE_S3_SCALE_RUNNER_VERSIONS.manifestCompanion);
  assert.equal(companion.artifactKind, 'admitted-run-manifest-companion');
  assert.deepEqual(companion.admittedRunManifest, session.harnessSession.run);
  assert.equal(companion.identity.runManifestIdentity.executionIdentity.productAdapterVersion,
    runManifest.executionIdentity.productAdapterVersion);
  assert.deepEqual(companion.identity.runManifestIdentity.referenceEnvironment, runManifest.referenceEnvironment);
  assert.equal(companion.contentDigest.canonicalization, 'route-s3-canonical-json-sorted-object-keys/v1');
  assert.equal(companion.contentDigest.trustModel, 'content-identity-not-signature-or-authenticity');
  assert.match(companion.persistenceSemantics, /no-filesystem-durability-or-atomicity/u);
  assert.equal(Object.isFrozen(companion.admittedRunManifest), true);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(companion)));

  const drifts = [
    ['executionIdentity', 'productAdapterVersion', 's3-product-adapter/v2'],
    ['executionIdentity', 'solverAlgorithmVersion', 'bounded-loopless-search/v2'],
    ['executionIdentity', 'fixtureVersion', 's3-micrograph-fixtures/v2'],
    ['executionIdentity', 'canonicalSerializationVersion', 'canonical-json/v2'],
    ['referenceEnvironment', 'runtime', 'Node drift'],
    ['referenceEnvironment', 'os', 'drift-os'],
    ['referenceEnvironment', 'architecture', 'drift-arch'],
    ['referenceEnvironment', 'cpuClass', 'drift-cpu'],
    ['referenceEnvironment', 'memoryBytes', runManifest.referenceEnvironment.memoryBytes + 1],
  ];
  for (const [section, field, replacement] of drifts) {
    const driftedManifest = structuredClone(runManifest);
    driftedManifest[section][field] = replacement;
    const driftedSession = createRouteS3ScaleExecutionSession({ runManifest: driftedManifest });
    assert.throws(
      () => combineRouteS3ScaleCheckpoints({ session: driftedSession, mainCheckpoints: [first] }),
      /identity drifted/u,
      `${section}.${field}`,
    );
  }
});

test('runner creates one validation session and never rereads the revoked raw manifest', () => {
  const revocableManifest = Proxy.revocable(createRouteS3FocusedRunManifest(), {});
  const session = createRouteS3ScaleExecutionSession({ runManifest: revocableManifest.proxy });
  const admittedRunManifest = session.harnessSession.validationAdmissionSession.admittedRunManifest;
  assert.equal(session.harnessSession.run, admittedRunManifest);
  revocableManifest.revoke();

  const first = runRouteS3MainChunk({ session, startIndex: 0, maxRecords: 1 });
  const second = resumeRouteS3MainChunks({ session, previousCheckpoint: first, maxRecords: 1 });
  const conformance = runRouteS3Conformance({ session });
  const companion = exportRouteS3AdmittedManifestCompanion(session);
  const combined = combineRouteS3ScaleCheckpoints({
    session,
    mainCheckpoints: [
      JSON.parse(JSON.stringify(first)),
      JSON.parse(JSON.stringify(second)),
    ],
    conformanceCheckpoint: JSON.parse(JSON.stringify(conformance)),
  });
  assert.deepEqual(companion.admittedRunManifest, admittedRunManifest);
  assert.deepEqual(combined.report.recordCollection.runManifest, admittedRunManifest);
  assert.equal(combined.report.mainCohortDenominators.recorded, 2);
  assert.equal(combined.report.conformanceDenominators.recorded, 4);
});

test('beforeRecord can stop execution but cannot substitute a joined record result', () => {
  const { session, first } = scaleArtifacts();
  const checkpoint = runRouteS3MainChunk({
    session,
    startIndex: 50,
    maxRecords: 1,
    beforeRecord() {
      return first.joinedRecords[0];
    },
  });
  assert.equal(checkpoint.endIndex, 51);
  assert.notEqual(checkpoint.joinedRecords[0].recordKey, first.joinedRecords[0].recordKey);
  assert.equal(checkpoint.joinedRecords[0].recordKey, getRouteS3ScaleWorklist(session).main[50].recordKey);
});

test('per-record admission failure stops before the next index in return and throw modes', () => {
  const { session } = scaleArtifacts();
  const returnInvocations = [];
  const returned = runRouteS3MainChunk({
    session,
    startIndex: 60,
    maxRecords: 4,
    forceAdmissionFailureAtIndex: 62,
    beforeRecord({ workItem }) {
      returnInvocations.push(workItem.index);
    },
  });
  assert.deepEqual(returnInvocations, [60, 61, 62]);
  assert.equal(returned.rangeStatus, 'stopped-on-error');
  assert.equal(returned.endIndex, 62);
  assert.equal(returned.nextIndex, 62);
  assert.equal(returned.joinedRecords.length, 2);
  assert.equal(returned.error.failedIndex, 62);
  assert.match(returned.error.message, /composite binding drifted/u);
  assert.equal(returned.failureSource, 'forced-admission-test');
  assert.equal(returned.faultInjectionUsed, true);
  assert.equal(returned.error.failureSource, 'forced-admission-test');
  assert.equal(returned.error.faultInjectionUsed, true);

  const throwInvocations = [];
  assert.throws(
    () => runRouteS3MainChunk({
      session,
      startIndex: 70,
      maxRecords: 4,
      forceAdmissionFailureAtIndex: 72,
      errorMode: 'throw-with-checkpoint',
      beforeRecord({ workItem }) {
        throwInvocations.push(workItem.index);
      },
    }),
    (error) => {
      assert.equal(error.name, 'RouteS3ChunkExecutionError');
      assert.deepEqual(throwInvocations, [70, 71, 72]);
      assert.equal(error.checkpoint.endIndex, 72);
      assert.equal(error.checkpoint.nextIndex, 72);
      assert.equal(error.checkpoint.joinedRecords.length, 2);
      assert.equal(error.checkpoint.error.failedIndex, 72);
      assert.equal(error.checkpoint.failureSource, 'forced-admission-test');
      assert.equal(error.checkpoint.faultInjectionUsed, true);
      assert.equal(error.checkpoint.error.failureSource, 'forced-admission-test');
      assert.equal(error.checkpoint.error.faultInjectionUsed, true);
      return true;
    },
  );
});

test('ordinary downstream execution errors are not mislabeled as fault injection', () => {
  const { session } = scaleArtifacts();
  const nativeStructuredClone = globalThis.structuredClone;
  let checkpoint;
  try {
    globalThis.structuredClone = () => {
      globalThis.structuredClone = nativeStructuredClone;
      throw new Error('controlled downstream execution error');
    };
    checkpoint = runRouteS3MainChunk({ session, startIndex: 80, maxRecords: 1 });
  } finally {
    globalThis.structuredClone = nativeStructuredClone;
  }
  assert.equal(checkpoint.rangeStatus, 'stopped-on-error');
  assert.equal(checkpoint.endIndex, 80);
  assert.equal(checkpoint.nextIndex, 80);
  assert.equal(checkpoint.failureSource, 'record-execution');
  assert.equal(checkpoint.faultInjectionUsed, false);
  assert.equal(checkpoint.error.failureSource, 'record-execution');
  assert.equal(checkpoint.error.faultInjectionUsed, false);
});

test('mid-record failure checkpoints only the completed terminal prefix without retry or fallback', () => {
  const { session } = scaleArtifacts();
  const checkpoint = runRouteS3MainChunk({
    session,
    startIndex: 20,
    maxRecords: 4,
    beforeRecord({ workItem }) {
      if (workItem.index === 22) {
        const collision = new Error('controlled record failure');
        collision.routeS3FailureSource = 'forced-admission-test';
        collision.routeS3FaultInjectionUsed = true;
        throw collision;
      }
    },
  });
  assert.equal(checkpoint.rangeStatus, 'stopped-on-error');
  assert.equal(checkpoint.startIndex, 20);
  assert.equal(checkpoint.endIndex, 22);
  assert.equal(checkpoint.nextIndex, 22);
  assert.equal(checkpoint.joinedRecords.length, 2);
  assert.equal(checkpoint.joinedRecords.every(({ primaryExecution, replayExecution }) => (
    primaryExecution.attemptState === 'terminal' && replayExecution.attemptState === 'terminal'
  )), true);
  assert.equal(checkpoint.error.failedIndex, 22);
  assert.equal(checkpoint.error.retryAttempted, false);
  assert.equal(checkpoint.error.fallbackAttempted, false);
  assert.equal(checkpoint.failureSource, 'before-record-hook');
  assert.equal(checkpoint.faultInjectionUsed, true);
  assert.equal(checkpoint.error.failureSource, 'before-record-hook');
  assert.equal(checkpoint.error.faultInjectionUsed, true);
  assert.equal(checkpoint.mainComplete, false);
  assert.equal(checkpoint.conformanceComplete, false);
  assert.equal(checkpoint.evidenceComplete, false);
  assert.equal(checkpoint.partialRun, true);
  assert.deepEqual(checkpoint.emittedClaimCodes, []);
  assert.throws(
    () => resumeRouteS3MainChunks({ session, previousCheckpoint: checkpoint, maxRecords: 1 }),
    /stopped run cannot resume/u,
  );
  const stoppedAtZero = runRouteS3MainChunk({
    session,
    startIndex: 0,
    maxRecords: 2,
    beforeRecord({ workItem }) {
      if (workItem.index === 1) throw new Error('terminal stopped ledger');
    },
  });
  const afterStopped = runRouteS3MainChunk({ session, startIndex: stoppedAtZero.nextIndex, maxRecords: 1 });
  assert.throws(
    () => combineRouteS3ScaleCheckpoints({ session, mainCheckpoints: [stoppedAtZero, afterStopped] }),
    /digest chain drifted|continue after a stopped run boundary/u,
  );
  const stoppedCombined = combineRouteS3ScaleCheckpoints({ session, mainCheckpoints: [stoppedAtZero] });
  assert.equal(stoppedCombined.stoppedProvenance.error.failedIndex, 1);
  assert.equal(stoppedCombined.stoppedProvenance.failureSource, 'before-record-hook');
  assert.equal(stoppedCombined.stoppedProvenance.faultInjectionUsed, true);
  assert.equal(stoppedCombined.stoppedProvenance.error.failureSource, 'before-record-hook');
  assert.equal(stoppedCombined.stoppedProvenance.error.faultInjectionUsed, true);
  assert.equal(stoppedCombined.mainComplete, false);
  assert.equal(stoppedCombined.evidenceComplete, false);

  assert.throws(
    () => runRouteS3MainChunk({
      session,
      startIndex: 30,
      maxRecords: 3,
      errorMode: 'throw-with-checkpoint',
      beforeRecord({ workItem }) {
        if (workItem.index === 32) throw new Error('controlled thrown boundary');
      },
    }),
    (error) => {
      assert.equal(error.name, 'RouteS3ChunkExecutionError');
      assert.equal(error.checkpoint.endIndex, 32);
      assert.equal(error.checkpoint.nextIndex, 32);
      assert.equal(error.checkpoint.joinedRecords.length, 2);
      assert.equal(error.checkpoint.error.retryAttempted, false);
      assert.equal(error.checkpoint.failureSource, 'before-record-hook');
      assert.equal(error.checkpoint.faultInjectionUsed, true);
      return true;
    },
  );
});

test('conformance execution remains an exact separate four-record denominator', () => {
  const { conformance } = scaleArtifacts();
  assert.equal(conformance.checkpointKind, 'conformance-batch');
  assert.equal(conformance.expectedRecords, 4);
  assert.equal(conformance.startIndex, 0);
  assert.equal(conformance.endIndex, 4);
  assert.equal(conformance.mainComplete, false);
  assert.equal(conformance.conformanceComplete, true);
  assert.equal(conformance.evidenceComplete, false);
  assert.equal(conformance.partialRun, true);
  assert.equal(conformance.joinedRecords.length, 4);
  assert.equal(conformance.joinedRecords.every(({ denominatorKind }) => denominatorKind === 'conformance'), true);
  assert.equal(conformance.failureSource, null);
  assert.equal(conformance.faultInjectionUsed, false);
  assert.equal(conformance.performance.performanceSamples, 0);
  assert.deepEqual(conformance.emittedClaimCodes, []);
});

test('checkpoint APIs return detached deep-frozen JSON data', () => {
  const { first } = scaleArtifacts();
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.identity), true);
  assert.equal(Object.isFrozen(first.joinedRecords), true);
  assert.equal(Object.isFrozen(first.joinedRecords[0]), true);
  assert.equal(Object.isFrozen(first.joinedRecords[0].primaryExecution.searchResult), true);
  assert.throws(() => {
    first.nextIndex = 99;
  }, TypeError);
  const serialized = JSON.stringify(first);
  const detached = JSON.parse(serialized);
  assert.equal(detached.schemaVersion, ROUTE_S3_SCALE_RUNNER_VERSIONS.checkpoint);
  detached.nextIndex = 99;
  assert.equal(first.nextIndex, 1);
  assert.equal(serialized.includes('measurement-not-enabled'), true);
  assert.equal(serialized.includes('diagnostic-only-no-performance-claim-eligible-in-v1'), true);
});
