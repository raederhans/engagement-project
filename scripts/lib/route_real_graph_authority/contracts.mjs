export const REAL_GRAPH_AUTHORITY_EVIDENCE_HANDLE_SCHEMA =
  'route-real-graph-authority-evidence-handle/v1';
export const REAL_GRAPH_AUTHORITY_EVIDENCE_SET_SCHEMA =
  'route-real-graph-authority-evidence-set/v1';
export const REAL_GRAPH_AUTHORITY_MATCH_SUBJECT_SCHEMA =
  'route-real-graph-authority-match-subject/v1';
export const REAL_GRAPH_AUTHORITY_REGISTRY_SCHEMA =
  'route-real-graph-installed-authority-registry/v1';
export const REAL_GRAPH_AUTHORITY_REGISTRY_POLICY_SCHEMA =
  'route-real-graph-installed-authority-policy/v1';
export const REAL_GRAPH_AUTHORITY_REGISTRY_ENTRY_SCHEMA =
  'route-real-graph-installed-authority-entry/v1';
export const REAL_GRAPH_AUTHORITY_REVIEW_GATE_SCHEMA =
  'route-real-graph-owner-review-gate/v1';
export const REAL_GRAPH_OWNER_RESOLVED_STATE_SCHEMA =
  'route-real-graph-owner-resolved-state/v1';
export const REAL_GRAPH_OWNER_RESOLVED_BINDINGS_SCHEMA =
  'route-real-graph-owner-resolved-bindings/v1';
export const REAL_GRAPH_SOURCE_READINESS_SCHEMA =
  'route-real-graph-source-readiness/v1';
export const REAL_GRAPH_SOURCE_HEALTH_PROJECTION_SCHEMA =
  'route-real-graph-source-health-projection/v1';
export const REAL_GRAPH_SOURCE_HEALTH_AUTHORIZATION_SCHEMA =
  'route-real-graph-source-health-update-authorization/v1';
export const REAL_GRAPH_AUTHORIZATION_CERTIFICATE_SCHEMA =
  'route-real-graph-owner-authorization-certificate/v1';
export const REAL_GRAPH_BUILD_EVIDENCE_SCHEMA =
  'route-real-graph-build-evidence/v1';
export const REAL_GRAPH_BUILD_TOOL_CERTIFICATE_SCHEMA =
  'route-real-graph-build-tool-certificate/v1';
export const REAL_GRAPH_RECORD_COUNT_DEFINITION_SCHEMA =
  'route-real-graph-record-count-definition/v1';
export const REAL_GRAPH_VERSION_BINDING_SCHEMA =
  'route-real-graph-version-binding/v1';

export const GEOFABRIK_ACQUISITION_MANIFEST_SCHEMA =
  'route-real-graph-geofabrik-acquisition-manifest/v1';
export const GEOFABRIK_ACQUISITION_OBSERVATION_SCHEMA =
  'route-real-graph-geofabrik-acquisition-observation/v1';
export const OSM_ADAPTER_RESULT_SCHEMA = 'route-real-graph-osm-adapter-result/v1';
export const OSM_WALK_PROFILE_SCHEMA = 'route-real-graph-osm-walk-profile/v1';
export const OSM_EXTRACTOR_BINDING_SCHEMA =
  'route-real-graph-osm-extractor-binding/v1';
export const OSM_BOUNDARY_SCHEMA = 'route-real-graph-osm-boundary/v1';
export const OSM_TURN_RESTRICTIONS_SCHEMA =
  'route-real-graph-osm-turn-restrictions/v1';
export const ROUTE_GRAPH_RAW_CANDIDATE_SCHEMA = 'route-graph-raw-candidate/v1';
export const ROUTE_GRAPH_CANDIDATE_SCHEMA = 'route-graph-candidate/v1';

export const SOURCE_HEALTH_STATUSES = Object.freeze([
  'current',
  'partial',
  'stale',
  'unavailable',
  'unknown',
]);

export const REAL_GRAPH_SOURCE_READINESS_STATES = Object.freeze([
  'candidate-evidence-complete',
  'candidate-evidence-partial',
  'candidate-evidence-stale',
  'candidate-evidence-unavailable',
  'candidate-evidence-unknown',
]);

export const REAL_GRAPH_RECORD_COUNT_DEFINITION = Object.freeze({
  schema: REAL_GRAPH_RECORD_COUNT_DEFINITION_SCHEMA,
  unit: 'normalized-directed-edge',
  inclusion: 'all-access-admitted-directed-edges',
});

export const REAL_GRAPH_AUTHORITY_INGRESS_LIMITS = Object.freeze({
  acquisitionCodeUnits: 262_144,
  adapterCodeUnits: 64_000_000,
  buildCodeUnits: 262_144,
  readinessCodeUnits: 65_536,
  maximumDepth: 32,
  maximumItems: 20_000_000,
});

export const REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS = Object.freeze({
  maximumDepth: 64,
  maximumObjectWidth: 1_024,
  maximumArrayLength: 2_000_000,
  maximumAggregateItems: 100_000,
  maximumDescriptors: 100_000,
  maximumStringCodeUnits: 64_000_000,
  maximumPropertyKeyCodeUnits: 1_024,
});

export const REAL_GRAPH_AUTHORITY_LIMITATIONS = Object.freeze([
  'SHA-256 identities are deterministic drift bindings only; they do not prove source authenticity, reviewer identity, repository history, or owner authority.',
  'The default installed authority registry is empty, so no caller-authored JSON, hash, reviewedBy value, brand, registry string, or deserialized handle can issue authorization.',
  'A matched installed entry can issue only a proposed Source Health update certificate; this contract never applies a Source Health catalog state change.',
  'Free-text identifiers and candidate readiness labels never establish eligibility; only a versioned owner-reviewed resolved state installed inside the private registry can qualify an exact entry.',
  'Every emitted Source Health projection remains not-observed/unavailable until the central Source Health owner independently applies reviewed provenance.',
  'Ingress ceilings reset per JSON document and per validation call; they are defensive rejection bounds, not evidence of real-graph capacity, performance, or successful large-input processing.',
  'This contract does not mutate the Source Health catalog, materialize a product graph, open runtime, or authorize publication.',
  'The contract does not establish accessibility, safety, completeness, city correctness, cross-boundary correctness, real-time status, performance, redistribution, or public release.',
]);

export const REQUIRED_INSTALLED_SCOPES = Object.freeze([
  'real-graph-admission',
  'source-health-update-projection',
]);

export const REAL_GRAPH_AUTHORITY_IDENTITY_KEYS = Object.freeze([
  'sourcePayload',
  'acquisitionManifest',
  'acquisitionObservation',
  'acquisitionDocument',
  'adapterProfile',
  'adapterIntermediate',
  'adapterResult',
  'adapterDocument',
  'adapterBoundary',
  'normalizedGraph',
  'graphTopology',
  'graphGeometry',
  'graphVersion',
  'recordCountDefinition',
  'buildToolCertificate',
  'buildToolExecutable',
  'buildToolCommand',
  'buildBoundary',
  'buildBoundaryPolicy',
  'build',
  'sourceReadiness',
]);
