import {
  ACCEPTED_SYNTHETIC_CONSTRUCTION_FIXTURE,
  REAL_COMPACT_GRAPH_CANONICALIZATIONS,
  REAL_COMPACT_GRAPH_DEPENDENCY_STATUS,
  REAL_COMPACT_GRAPH_SCHEMA_VERSIONS,
  SYNTHETIC_CONSTRUCTION_ELIGIBLE_CLAIMS,
  SYNTHETIC_CONSTRUCTION_LIMITATIONS,
  admitRouteGraphCandidateMechanicsValue,
  candidateGraphValue,
  compileRouteGraphCandidateProjection,
  dependencyPlaceholderBindingsFor,
  exactObject,
  exactString,
  exactTimestamp,
  fail,
  identityShape,
  sameIdentity,
  syntheticId,
  validateDependencyPlaceholderBindings,
  validateDependencyPlaceholders,
  validateGraphProjectionValue,
} from './graph_mechanics_v1.js';
import {
  canonicalStringify,
  contentIdentity,
  deepFreeze,
} from './canonical_v1.js';
import { strictRealCompactJsonParse } from './strict_json_v1.js';

function syntheticClaimBoundary() {
  return {
    schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.claimBoundary,
    classification: 'synthetic-construction-only',
    eligibleClaims: [...SYNTHETIC_CONSTRUCTION_ELIGIBLE_CLAIMS],
    limitations: [...SYNTHETIC_CONSTRUCTION_LIMITATIONS],
  };
}

function syntheticSourceHealthBoundary() {
  return {
    state: 'not-authorized-synthetic-construction',
    catalogMutationAuthorized: false,
    currentClaimAllowed: false,
    callerCurrentCanIncreaseAuthority: false,
  };
}

function syntheticLicenceBoundary() {
  return {
    schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.licenceBoundary,
    fixtureDataLicense: 'not-applicable-synthetic-construction',
    realArtifactDatabaseLicenseRequirement: 'ODbL-1.0',
    licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    attributionText: '© OpenStreetMap contributors',
    attributionUrl: 'https://www.openstreetmap.org/copyright',
    derivativeDatabaseRequirement: true,
    appliesToFixture: false,
  };
}

function syntheticMaterialization(constructedAt, buildIdentity) {
  return {
    schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.materialization,
    status: 'synthetic-construction-only-not-materialized',
    constructedAt,
    artifactPath: null,
    rebuildMethod: {
      status: 'unavailable-synthetic-fixture',
      buildPlaceholderIdentity: buildIdentity,
      publicMethodRef: null,
      machineReadableGraphRef: null,
    },
  };
}

function admitSyntheticConstructionFixtureValue(value) {
  const fixture = exactObject(value, [
    'schemaVersion',
    'fixtureId',
    'dataClassification',
    'constructedAt',
    'dependencyPlaceholders',
    'routeGraphCandidate',
  ], 'synthetic construction fixture');
  exactString(
    fixture.schemaVersion,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticFixture,
    'synthetic construction fixture.schemaVersion',
  );
  syntheticId(fixture.fixtureId, 'synthetic construction fixture.fixtureId');
  exactString(
    fixture.dataClassification,
    'synthetic-construction-only',
    'synthetic construction fixture.dataClassification',
  );
  exactTimestamp(fixture.constructedAt, 'synthetic construction fixture.constructedAt');
  const dependencyPlaceholders = validateDependencyPlaceholders(fixture.dependencyPlaceholders);
  const graph = admitRouteGraphCandidateMechanicsValue(fixture.routeGraphCandidate);
  return { value: fixture, dependencyPlaceholders, graph };
}

function syntheticFixtureIdentityFor(fixture) {
  return contentIdentity(
    fixture,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticFixtureIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.syntheticFixture,
  );
}

function assertAcceptedSyntheticConstructionFixture(fixture, label) {
  const fixtureInputIdentity = syntheticFixtureIdentityFor(fixture.value);
  if (fixture.value.fixtureId !== ACCEPTED_SYNTHETIC_CONSTRUCTION_FIXTURE.fixtureId
    || fixtureInputIdentity.digest
      !== ACCEPTED_SYNTHETIC_CONSTRUCTION_FIXTURE.fixtureInputDigest) {
    fail(`${label} is not the one exact accepted mechanics fixture; expected ${ACCEPTED_SYNTHETIC_CONSTRUCTION_FIXTURE.fixtureId} at ${ACCEPTED_SYNTHETIC_CONSTRUCTION_FIXTURE.fixtureInputDigest}`);
  }
  return fixtureInputIdentity;
}

function buildSyntheticConstructionObservation(fixture) {
  const fixtureInputIdentity = assertAcceptedSyntheticConstructionFixture(
    fixture,
    'synthetic construction observation source fixture',
  );
  const dependencyPlaceholderBindings = dependencyPlaceholderBindingsFor(
    fixture.dependencyPlaceholders,
  );
  const projection = {
    schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticObservation,
    fixtureId: fixture.value.fixtureId,
    dataClassification: 'synthetic-construction-only',
    compiler: {
      schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.compiler,
      deterministic: true,
      executionBoundary: 'node-build-time-only',
      productionBridgeStatus: 'dependency-contract-unavailable',
      productionAuthorityState: 'authority-unavailable',
    },
    fixtureInputIdentity,
    dependencyStatus: REAL_COMPACT_GRAPH_DEPENDENCY_STATUS,
    dependencyPlaceholders: fixture.dependencyPlaceholders,
    dependencyPlaceholderBindings,
    sourceHealthBoundary: syntheticSourceHealthBoundary(),
    graphProjection: compileRouteGraphCandidateProjection(fixture.graph),
    licenceBoundary: syntheticLicenceBoundary(),
    materialization: syntheticMaterialization(
      fixture.value.constructedAt,
      dependencyPlaceholderBindings.build.contentIdentity,
    ),
    claimBoundary: syntheticClaimBoundary(),
  };
  return {
    ...projection,
    observationIdentity: contentIdentity(
      projection,
      REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticObservationIdentity,
      REAL_COMPACT_GRAPH_CANONICALIZATIONS.syntheticObservation,
    ),
  };
}

function reconstructFixtureFromObservation(value) {
  const { graph } = validateGraphProjectionValue(value.graphProjection);
  return {
    schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticFixture,
    fixtureId: value.fixtureId,
    dataClassification: value.dataClassification,
    constructedAt: value.materialization.constructedAt,
    dependencyPlaceholders: value.dependencyPlaceholders,
    routeGraphCandidate: candidateGraphValue(graph),
  };
}

function validateSyntheticObservationValue(value) {
  exactObject(value, [
    'schemaVersion',
    'fixtureId',
    'dataClassification',
    'compiler',
    'fixtureInputIdentity',
    'dependencyStatus',
    'dependencyPlaceholders',
    'dependencyPlaceholderBindings',
    'sourceHealthBoundary',
    'graphProjection',
    'licenceBoundary',
    'materialization',
    'claimBoundary',
    'observationIdentity',
  ], 'synthetic construction observation');
  exactString(
    value.schemaVersion,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticObservation,
    'synthetic construction observation.schemaVersion',
  );
  syntheticId(value.fixtureId, 'synthetic construction observation.fixtureId');
  exactString(
    value.dataClassification,
    'synthetic-construction-only',
    'synthetic construction observation.dataClassification',
  );
  exactObject(value.compiler, [
    'schemaVersion',
    'deterministic',
    'executionBoundary',
    'productionBridgeStatus',
    'productionAuthorityState',
  ], 'synthetic construction observation.compiler');
  exactString(
    value.compiler.schemaVersion,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.compiler,
    'synthetic construction observation.compiler.schemaVersion',
  );
  if (value.compiler.deterministic !== true) {
    fail('synthetic construction observation.compiler.deterministic must be true');
  }
  exactString(
    value.compiler.executionBoundary,
    'node-build-time-only',
    'synthetic construction observation.compiler.executionBoundary',
  );
  exactString(
    value.compiler.productionBridgeStatus,
    'dependency-contract-unavailable',
    'synthetic construction observation.compiler.productionBridgeStatus',
  );
  exactString(
    value.compiler.productionAuthorityState,
    'authority-unavailable',
    'synthetic construction observation.compiler.productionAuthorityState',
  );
  identityShape(
    value.fixtureInputIdentity,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticFixtureIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.syntheticFixture,
    'synthetic construction observation.fixtureInputIdentity',
  );
  if (canonicalStringify(value.dependencyStatus)
    !== canonicalStringify(REAL_COMPACT_GRAPH_DEPENDENCY_STATUS)) {
    fail('synthetic construction observation production dependency status drifted');
  }
  const placeholders = validateDependencyPlaceholders(value.dependencyPlaceholders);
  validateDependencyPlaceholderBindings(value.dependencyPlaceholderBindings);
  const expectedBindings = dependencyPlaceholderBindingsFor(placeholders);
  if (canonicalStringify(value.dependencyPlaceholderBindings)
    !== canonicalStringify(expectedBindings)) {
    fail('synthetic construction observation dependency placeholder identities drifted');
  }
  if (canonicalStringify(value.sourceHealthBoundary)
    !== canonicalStringify(syntheticSourceHealthBoundary())) {
    fail('synthetic construction observation cannot claim Source Health current or mutation authority');
  }
  if (canonicalStringify(value.licenceBoundary)
    !== canonicalStringify(syntheticLicenceBoundary())) {
    fail('synthetic construction observation licence and attribution boundary drifted');
  }
  exactObject(value.materialization, [
    'schemaVersion', 'status', 'constructedAt', 'artifactPath', 'rebuildMethod',
  ], 'synthetic construction observation.materialization');
  exactTimestamp(
    value.materialization.constructedAt,
    'synthetic construction observation.materialization.constructedAt',
  );
  const expectedMaterialization = syntheticMaterialization(
    value.materialization.constructedAt,
    expectedBindings.build.contentIdentity,
  );
  if (canonicalStringify(value.materialization) !== canonicalStringify(expectedMaterialization)) {
    fail('synthetic construction observation materialization or rebuild boundary drifted');
  }
  if (canonicalStringify(value.claimBoundary) !== canonicalStringify(syntheticClaimBoundary())) {
    fail('synthetic construction observation claim boundary drifted');
  }
  const reconstructedFixture = reconstructFixtureFromObservation(value);
  const fixture = admitSyntheticConstructionFixtureValue(reconstructedFixture);
  const expectedFixtureIdentity = assertAcceptedSyntheticConstructionFixture(
    fixture,
    'synthetic construction observation fixture identity',
  );
  if (!sameIdentity(value.fixtureInputIdentity, expectedFixtureIdentity)) {
    fail('synthetic construction observation fixture input identity drifted');
  }
  identityShape(
    value.observationIdentity,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticObservationIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.syntheticObservation,
    'synthetic construction observation.observationIdentity',
  );
  const projection = { ...value };
  delete projection.observationIdentity;
  const expectedObservationIdentity = contentIdentity(
    projection,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticObservationIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.syntheticObservation,
  );
  if (!sameIdentity(value.observationIdentity, expectedObservationIdentity)) {
    fail('synthetic construction observation identity drifted');
  }
  return value;
}

export function parseSyntheticConstructionObservation(serializedJson) {
  return deepFreeze(validateSyntheticObservationValue(strictRealCompactJsonParse(serializedJson)));
}

function parseSyntheticConstructionFixture(serializedJson) {
  return admitSyntheticConstructionFixtureValue(strictRealCompactJsonParse(serializedJson));
}

export function compileSyntheticConstructionObservation(serializedFixture) {
  const fixture = parseSyntheticConstructionFixture(serializedFixture);
  assertAcceptedSyntheticConstructionFixture(fixture, 'synthetic construction input');
  const candidate = buildSyntheticConstructionObservation(fixture);
  const serializedObservation = canonicalStringify(candidate);
  const observation = parseSyntheticConstructionObservation(serializedObservation);
  return deepFreeze({ observation, serializedObservation });
}
