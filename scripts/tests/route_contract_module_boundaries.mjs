import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import * as routeDecision from '../../src/route_decision/contracts/index.js';
import * as candidateSearch from '../../src/route_decision/contracts/candidate_search_v2.js';
import * as scenarioCohort from '../../src/route_decision/contracts/scenario_cohort_v1.js';
import * as realCompact from '../../src/route_generation/real_compact_graph/contract_v1.js';
import {
  canonicalStringify,
} from '../../src/route_generation/real_compact_graph/canonical_v1.js';
import {
  CANDIDATE_SEARCH_VALIDATOR_PROFILE_VERSION,
  exactObject as exactCandidateSearchObject,
} from '../../src/route_decision/contracts/internal/candidate_search_validator_v1.js';
import {
  ROUTE_DECISION_VALIDATOR_PROFILE_VERSION,
  exactObject as exactRouteDecisionObject,
} from '../../src/route_decision/contracts/internal/route_decision_validator_v1.js';
import {
  S3_VALIDATOR_PROFILE_VERSION,
} from '../../src/route_decision/contracts/internal/s3_validator_v1.js';
import {
  ROUTE_CONTRACT_VALIDATOR_SUPPORT_VERSION,
} from '../../src/route_decision/contracts/internal/validator_support_v1.js';

const ROUTE_DECISION_EXPORTS = Object.freeze([
  'CANDIDATE_SET_LIMITATIONS',
  'CAPABILITY_OBSERVATION_TAGS',
  'DECISION_POLICY_OPERATORS',
  'DECISION_TIE_BREAK_TAGS',
  'DEFAULT_ROUTE_DECISION_BOUNDARY',
  'DEFAULT_TRAVEL_NEED_CATALOG',
  'FUNCTIONAL_NEED_TAGS',
  'PERMITTED_CLAIM_TAGS',
  'PERMITTED_CONSTRAINT_INPUT_TAGS',
  'PERMITTED_RANKING_INPUT_TAGS',
  'PROHIBITED_CLAIM_TAGS',
  'PROHIBITED_RANKING_INPUT_TAGS',
  'ROUTE_CONSTRAINT_FACTOR_IDS',
  'ROUTE_DECISION_SCHEMA_VERSIONS',
  'ROUTE_OBSERVATION_STATES',
  'ROUTE_OBSERVATION_TAGS',
  'ROUTE_RANKING_FACTOR_IDS',
  'UNRESOLVED_OBSERVATION_STATES',
  'admitCandidateSet',
  'admitDecisionPolicy',
  'admitDecisionResult',
  'admitGraphArtifact',
  'admitRouteCandidateFacts',
  'admitRouteDecisionBoundary',
  'admitRouteRequest',
  'admitScenarioRunManifest',
  'admitSourceObservation',
  'admitTravelNeedCatalog',
  'assertPermittedClaimTag',
  'assertPermittedConstraintInputTag',
  'assertPermittedRankingInputTag',
]);

const CANDIDATE_SEARCH_EXPORTS = Object.freeze([
  'ROUTE_CANDIDATE_SEARCH_DECISIONS',
  'ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS',
  'ROUTE_SEARCH_ADMISSIBLE_FACTOR_IDS',
  'ROUTE_SEARCH_CAPACITY_POLICY',
  'ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION',
  'ROUTE_SEARCH_DISTINCTNESS_VERSION',
  'ROUTE_SEARCH_RESULT_STATUSES',
  'ROUTE_SEARCH_TERMINATIONS',
  'ROUTE_SEARCH_TIE_BREAK_VERSION',
  'ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES',
  'admitCandidateSetV3',
  'admitRouteCandidateSearchRequest',
  'admitRouteCandidateSearchResult',
]);

const SCENARIO_COHORT_EXPORTS = Object.freeze([
  'S3_CONFIGURATION_GROUPS',
  'S3_CONFIGURATION_IDS',
  'S3_CONFORMANCE_PROBE_KINDS',
  'S3_DECISION_POLICIES',
  'S3_ORACLE_ALGORITHM_VERSION',
  'S3_ORACLE_EXECUTION_SPEC',
  'S3_PERFORMANCE_PROTOCOL',
  'S3_SCENARIO_COUNTS',
  'S3_SCENARIO_GENERATOR_VERSION',
  'S3_SCENARIO_SCHEMA_VERSIONS',
  'S3_SCENARIO_SEED',
  'S3_SYNTHETIC_PROFILES',
  'S3_SYNTHETIC_PROFILE_IDS',
  'admitS3ConfigurationGroup',
  'admitS3IndependentOracleResult',
  'admitS3JoinedRunRecord',
  'admitS3JoinedRunRecordWithValidationSession',
  'admitS3ProductExecution',
  'admitS3RecordCollection',
  'admitS3RecordCollectionWithValidationSession',
  'admitS3Report',
  'admitS3ReportWithValidationSession',
  'admitS3RunManifest',
  'admitS3ScenarioCohort',
  'admitS3ScenarioProtocol',
  'admitS3SyntheticProfile',
  'areS3DataTreesEquivalent',
  'buildS3GraphContentIdentity',
  'buildS3ScenarioOdPairs',
  'createS3ValidationAdmissionSession',
]);

const REAL_COMPACT_EXPORTS = Object.freeze([
  'REAL_COMPACT_GRAPH_CANONICALIZATIONS',
  'REAL_COMPACT_GRAPH_DEPENDENCY_STATUS',
  'REAL_COMPACT_GRAPH_SCHEMA_VERSIONS',
  'SYNTHETIC_CONSTRUCTION_ELIGIBLE_CLAIMS',
  'SYNTHETIC_CONSTRUCTION_LIMITATIONS',
  'compileSyntheticConstructionObservation',
  'parseSyntheticConstructionObservation',
]);

function withSymbolProperty(value) {
  Object.defineProperty(value, Symbol('unsupported'), {
    configurable: true,
    enumerable: true,
    value: true,
  });
  return value;
}

function collectJavaScriptModules(directoryUrl) {
  const modules = [];
  for (const entry of readdirSync(directoryUrl, { withFileTypes: true })) {
    const childUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directoryUrl);
    if (entry.isDirectory()) {
      modules.push(...collectJavaScriptModules(childUrl));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      modules.push(childUrl);
    }
  }
  return modules;
}

function relativeModuleDependencies(moduleUrl, knownModules) {
  const source = readFileSync(moduleUrl, 'utf8');
  const dependencies = [];
  const staticFromPattern = /\bfrom\s+['"](?<specifier>\.[^'"]+)['"]/g;
  for (const match of source.matchAll(staticFromPattern)) {
    const dependencyUrl = new URL(match.groups.specifier, moduleUrl);
    if (knownModules.has(dependencyUrl.href)) dependencies.push(dependencyUrl.href);
  }
  return dependencies;
}

test('compatibility entrypoints preserve their exact named export surfaces', () => {
  assert.deepEqual(Object.keys(routeDecision).sort(), ROUTE_DECISION_EXPORTS);
  assert.deepEqual(Object.keys(candidateSearch).sort(), CANDIDATE_SEARCH_EXPORTS);
  assert.deepEqual(Object.keys(scenarioCohort).sort(), SCENARIO_COHORT_EXPORTS);
  assert.deepEqual(Object.keys(realCompact).sort(), REAL_COMPACT_EXPORTS);
});

test('domain validator adapters preserve exact fail-closed symbol-property semantics', () => {
  assert.throws(
    () => routeDecision.admitRouteRequest(withSymbolProperty({})),
    {
      name: 'TypeError',
      message: 'route decision contract: RouteRequest must not contain symbol properties',
    },
  );
  assert.throws(
    () => candidateSearch.admitRouteCandidateSearchRequest(withSymbolProperty({})),
    {
      name: 'TypeError',
      message: 'route candidate search contract: CandidateSearchRequest must not contain symbol properties',
    },
  );
  assert.throws(
    () => scenarioCohort.admitS3ConfigurationGroup(withSymbolProperty({})),
    {
      name: 'TypeError',
      message: 'route decision S3 protocol contract: S3ConfigurationGroup must not contain symbols',
    },
  );
});

test('versioned validator profiles preserve intentional domain ordering differences', () => {
  assert.equal(
    ROUTE_DECISION_VALIDATOR_PROFILE_VERSION,
    `${ROUTE_CONTRACT_VALIDATOR_SUPPORT_VERSION}:route-decision`,
  );
  assert.equal(
    CANDIDATE_SEARCH_VALIDATOR_PROFILE_VERSION,
    `${ROUTE_CONTRACT_VALIDATOR_SUPPORT_VERSION}:candidate-search-v2`,
  );
  assert.equal(
    S3_VALIDATOR_PROFILE_VERSION,
    `${ROUTE_CONTRACT_VALIDATOR_SUPPORT_VERSION}:scenario-cohort-v1`,
  );

  const input = { second: 2, first: 1 };
  assert.deepEqual(
    Object.keys(exactRouteDecisionObject(input, 'route object', ['first', 'second'])),
    ['second', 'first'],
  );
  assert.deepEqual(
    Object.keys(exactCandidateSearchObject(input, 'candidate object', ['first', 'second'])),
    ['first', 'second'],
  );
});

test('route modules use named internal dependencies without aggregate registries or cycles', () => {
  const moduleUrls = [
    ...collectJavaScriptModules(new URL('../../src/route_decision/contracts/', import.meta.url)),
    ...collectJavaScriptModules(
      new URL('../../src/route_generation/real_compact_graph/', import.meta.url),
    ),
  ];
  const knownModules = new Set(moduleUrls.map(({ href }) => href));
  const dependenciesByModule = new Map();

  for (const moduleUrl of moduleUrls) {
    const source = readFileSync(moduleUrl, 'utf8');
    assert.doesNotMatch(
      source,
      /\b[A-Z][A-Z0-9_]*_INTERNALS\b/,
      `${moduleUrl.pathname} must not hide dependencies in an aggregate registry`,
    );
    dependenciesByModule.set(
      moduleUrl.href,
      relativeModuleDependencies(moduleUrl, knownModules),
    );
  }

  const state = new Map();
  const stack = [];
  function visit(moduleHref) {
    if (state.get(moduleHref) === 'visited') return;
    if (state.get(moduleHref) === 'visiting') {
      const cycleStart = stack.indexOf(moduleHref);
      assert.fail(`route module import cycle: ${[...stack.slice(cycleStart), moduleHref].join(' -> ')}`);
    }
    state.set(moduleHref, 'visiting');
    stack.push(moduleHref);
    for (const dependencyHref of dependenciesByModule.get(moduleHref)) visit(dependencyHref);
    stack.pop();
    state.set(moduleHref, 'visited');
  }
  for (const moduleHref of knownModules) visit(moduleHref);
});

test('real compact observation remains canonical and round-trips byte-for-byte', () => {
  const fixtureUrl = new URL(
    '../fixtures/route-real-compact-graph/synthetic_construction_input.json',
    import.meta.url,
  );
  const fixtureText = readFileSync(fixtureUrl, 'utf8');
  const compiled = realCompact.compileSyntheticConstructionObservation(fixtureText);

  assert.equal(compiled.serializedObservation, canonicalStringify(compiled.observation));
  assert.deepEqual(
    realCompact.parseSyntheticConstructionObservation(compiled.serializedObservation),
    compiled.observation,
  );
});
