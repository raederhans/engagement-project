import {
  MAX_POLICY_RULES,
  ROUTE_DECISION_SCHEMA_VERSIONS,
} from './model_v1.js';
import {
  boundedId,
  deepFreeze,
  exactObject,
  exactSchemaVersion,
  safeInteger,
  uniqueStrings,
} from './internal/route_decision_validator_v1.js';

export function admitScenarioRunManifest(raw) {
  const value = exactObject(raw, 'ScenarioRunManifest', [
    'schemaVersion',
    'seed',
    'graphId',
    'policyVersions',
    'fixtureSetVersion',
    'solverVersion',
    'expectedCaseCount',
  ]);
  exactSchemaVersion(
    value.schemaVersion,
    ROUTE_DECISION_SCHEMA_VERSIONS.scenarioRunManifest,
    'ScenarioRunManifest',
  );
  return deepFreeze({
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.scenarioRunManifest,
    seed: safeInteger(value.seed, 'ScenarioRunManifest.seed', { min: 0 }),
    graphId: boundedId(value.graphId, 'ScenarioRunManifest.graphId'),
    policyVersions: uniqueStrings(
      value.policyVersions,
      'ScenarioRunManifest.policyVersions',
      { min: 1, max: MAX_POLICY_RULES },
    ),
    fixtureSetVersion: boundedId(value.fixtureSetVersion, 'ScenarioRunManifest.fixtureSetVersion'),
    solverVersion: boundedId(value.solverVersion, 'ScenarioRunManifest.solverVersion'),
    expectedCaseCount: safeInteger(
      value.expectedCaseCount,
      'ScenarioRunManifest.expectedCaseCount',
      { min: 1, max: 1_000_000 },
    ),
  });
}
