import {
  CAPABILITY_OBSERVATION_TAGS,
  ROUTE_DECISION_SCHEMA_VERSIONS,
} from './model_v1.js';
import {
  deepFreeze,
  exactObject,
  exactSchemaVersion,
  exactSequence,
  fail,
} from './internal/route_decision_validator_v1.js';

export const PERMITTED_RANKING_INPUT_TAGS = Object.freeze([
  'distance-mm',
  'objective-cost-units',
]);

export const PERMITTED_CONSTRAINT_INPUT_TAGS = Object.freeze([...CAPABILITY_OBSERVATION_TAGS]);

export const PROHIBITED_RANKING_INPUT_TAGS = Object.freeze([
  'crime',
  'hin',
  'acs',
  'diary',
  'real-estate-proxy',
  'safety-score',
  'risk-score',
  'safetyBySegmentId',
]);

export const PERMITTED_CLAIM_TAGS = Object.freeze(['contract-conformance']);

export const PROHIBITED_CLAIM_TAGS = Object.freeze([
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

const PERMITTED_RANKING_INPUT_SET = new Set(PERMITTED_RANKING_INPUT_TAGS);
const PERMITTED_CONSTRAINT_INPUT_SET = new Set(PERMITTED_CONSTRAINT_INPUT_TAGS);
const PROHIBITED_RANKING_INPUT_SET = new Set(PROHIBITED_RANKING_INPUT_TAGS);
const PERMITTED_CLAIM_SET = new Set(PERMITTED_CLAIM_TAGS);
const PROHIBITED_CLAIM_SET = new Set(PROHIBITED_CLAIM_TAGS);

export function assertPermittedRankingInputTag(value) {
  if (PROHIBITED_RANKING_INPUT_SET.has(value)) fail('ranking input tag is prohibited');
  if (!PERMITTED_RANKING_INPUT_SET.has(value)) fail('ranking input tag is unsupported');
  return value;
}

export function assertPermittedConstraintInputTag(value) {
  if (!PERMITTED_CONSTRAINT_INPUT_SET.has(value)) fail('constraint input tag is unsupported');
  return value;
}

export function assertPermittedClaimTag(value) {
  if (PROHIBITED_CLAIM_SET.has(value)) fail('claim tag is prohibited');
  if (!PERMITTED_CLAIM_SET.has(value)) fail('claim tag is unsupported');
  return value;
}

export const DEFAULT_ROUTE_DECISION_BOUNDARY = deepFreeze({
  schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.boundary,
  dataClassification: 'synthetic-only',
  permittedRankingInputTags: [...PERMITTED_RANKING_INPUT_TAGS],
  permittedConstraintInputTags: [...PERMITTED_CONSTRAINT_INPUT_TAGS],
  prohibitedRankingInputTags: [...PROHIBITED_RANKING_INPUT_TAGS],
  permittedClaimTags: [...PERMITTED_CLAIM_TAGS],
  prohibitedClaimTags: [...PROHIBITED_CLAIM_TAGS],
  privacy: {
    privateDiaryData: 'excluded',
    preciseLocationCollection: 'forbidden',
    routeGeometryPersistence: 'forbidden',
    sessionPreferenceStorage: 'forbidden',
    urlEncoding: 'forbidden',
    networkTransport: 'forbidden',
    telemetry: 'forbidden',
    geolocation: 'forbidden',
    gpsTracking: 'forbidden',
  },
});

function assertBoundarySequence(value, expected, label) {
  const admitted = exactSequence(value, expected, label);
  if (admitted.some((entry) => typeof entry !== 'string')) fail(`${label} must contain strings`);
  return admitted;
}

export function admitRouteDecisionBoundary(raw) {
  const value = exactObject(raw, 'RouteDecisionBoundary', [
    'schemaVersion',
    'dataClassification',
    'permittedRankingInputTags',
    'permittedConstraintInputTags',
    'prohibitedRankingInputTags',
    'permittedClaimTags',
    'prohibitedClaimTags',
    'privacy',
  ]);
  exactSchemaVersion(value.schemaVersion, ROUTE_DECISION_SCHEMA_VERSIONS.boundary, 'RouteDecisionBoundary');
  if (value.dataClassification !== 'synthetic-only') {
    fail('RouteDecisionBoundary must match the frozen boundary data classification');
  }
  assertBoundarySequence(
    value.permittedRankingInputTags,
    PERMITTED_RANKING_INPUT_TAGS,
    'RouteDecisionBoundary.permittedRankingInputTags',
  );
  assertBoundarySequence(
    value.prohibitedRankingInputTags,
    PROHIBITED_RANKING_INPUT_TAGS,
    'RouteDecisionBoundary.prohibitedRankingInputTags',
  );
  assertBoundarySequence(
    value.permittedConstraintInputTags,
    PERMITTED_CONSTRAINT_INPUT_TAGS,
    'RouteDecisionBoundary.permittedConstraintInputTags',
  );
  assertBoundarySequence(
    value.permittedClaimTags,
    PERMITTED_CLAIM_TAGS,
    'RouteDecisionBoundary.permittedClaimTags',
  );
  assertBoundarySequence(
    value.prohibitedClaimTags,
    PROHIBITED_CLAIM_TAGS,
    'RouteDecisionBoundary.prohibitedClaimTags',
  );
  const privacy = exactObject(value.privacy, 'RouteDecisionBoundary.privacy', [
    'privateDiaryData',
    'preciseLocationCollection',
    'routeGeometryPersistence',
    'sessionPreferenceStorage',
    'urlEncoding',
    'networkTransport',
    'telemetry',
    'geolocation',
    'gpsTracking',
  ]);
  for (const [key, boundaryValue] of Object.entries(privacy)) {
    const expected = key === 'privateDiaryData' ? 'excluded' : 'forbidden';
    if (boundaryValue !== expected) {
      fail(`RouteDecisionBoundary.privacy.${key} must match the frozen boundary`);
    }
  }
  return DEFAULT_ROUTE_DECISION_BOUNDARY;
}
