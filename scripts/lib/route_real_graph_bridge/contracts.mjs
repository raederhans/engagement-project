import { contentIdentity, freezeData } from '../route_graph_candidate/safe_data.mjs';
import {
  EXTRACTOR_TOOL_ID,
  EXTRACTOR_VERSION,
} from '../route_real_graph_build/contracts.mjs';

export const OSMIUM_OPL_SUBSET_SCHEMA = 'route-real-graph-osmium-opl-subset/v1';
export const OSMIUM_OPL_BRIDGE_METADATA_SCHEMA =
  'route-real-graph-osmium-opl-bridge-metadata/v1';
export const OSMIUM_OPL_BRIDGE_RESULT_SCHEMA =
  'route-real-graph-osmium-opl-bridge-result/v1';
export const OSMIUM_OPL_BRIDGE_STATUS_SCHEMA =
  'route-real-graph-osmium-opl-bridge-status/v1';
export const TRUSTED_BUILD_EVIDENCE_SCHEMA = 'TrustedBuildEvidence/v1';
export const TRUSTED_BUILD_EVIDENCE_STATUS_SCHEMA =
  'route-real-graph-trusted-build-evidence-status/v1';
export const TRUSTED_BUILD_EVIDENCE_CLAIM_INSPECTION_SCHEMA =
  'route-real-graph-trusted-build-evidence-claim-inspection/v1';
export const TRUSTED_BUILD_BOUND_OUTPUT_OBSERVATION_SCHEMA =
  'TrustedBuildBoundOutputObservation/v1';
export const TRUSTED_BUILD_BRIDGE_INPUT_CAPTURE_SCHEMA =
  'TrustedBuildBridgeInputCapture/v1';

export const REVIEWED_OSMIUM_TOOL_ID = EXTRACTOR_TOOL_ID;
export const REVIEWED_OSMIUM_VERSION = EXTRACTOR_VERSION;
export const REVIEWED_OSMIUM_OUTPUT_FORMAT = 'opl,add_metadata=version+timestamp';
export const REVIEWED_OSMIUM_OBJECT_ORDER =
  'nodes-then-ways-then-relations-id-ascending';

export const OPL_INGRESS_LIMITS = freezeData({
  maximumUtf8Bytes: 16_777_216,
  maximumCodeUnits: 16_777_216,
  maximumLineCodeUnits: 262_144,
  maximumLines: 200_000,
  maximumTokens: 1_200_000,
  maximumTokenCodeUnits: 262_143,
  maximumNodeRecords: 100_000,
  maximumWayRecords: 100_000,
  maximumRelationRecords: 1_000,
  maximumTagsPerRecord: 32,
  maximumAggregateTags: 250_000,
  maximumNodeReferencesPerWay: 4_096,
  maximumAggregateNodeReferences: 250_000,
  maximumRelationMembers: 1_024,
  maximumAggregateRelationMembers: 16_384,
  maximumEdgeRecords: 100_000,
  maximumAggregateGeometryPoints: 200_000,
}, 'reviewed osmium OPL ingress limits');

export const BRIDGE_JSON_INGRESS_LIMITS = freezeData({
  maximumUtf8Bytes: 524_288,
  maximumCodeUnits: 262_144,
  maximumDepth: 32,
  maximumItems: 8_192,
  maximumArrayLength: 2_048,
  maximumObjectKeys: 256,
  maximumStringCodeUnits: 8_192,
}, 'bridge JSON ingress limits inherited from RD-E contract JSON/v1');

export const OPL_DISTANCE_MECHANICS = freezeData({
  schema: 'route-real-graph-opl-distance-mechanics/v1',
  inputCoordinates: 'longitude-latitude-decimal-degrees-at-osm-1e-7-precision',
  earthModel: 'sphere-mean-earth-radius-6371008.8-metres',
  algorithm: 'haversine-atan2-per-consecutive-way-node-pair',
  radians: 'degrees-times-math-pi-divided-by-180',
  rounding: 'ecmascript-math-round-metres-times-1000-per-edge',
  outputUnit: 'integer-millimetres',
  aggregation: 'none-one-rd-b-record-per-consecutive-node-pair',
  minimum: 1,
  maximum: 2_000_000_000,
  additionalCostDimensions: 'forbidden',
  duration: 'not-produced',
  objective: 'not-produced',
  profileAdjustment: 'not-produced',
}, 'single OPL to RD-B integer millimetre mechanics');

export const OPL_DISTANCE_MECHANICS_IDENTITY = contentIdentity(OPL_DISTANCE_MECHANICS);

export const SYNTHETIC_BRIDGE_CLAIMS = freezeData({
  syntheticFixtureOnly: true,
  exactOplBytesRequired: true,
  realBridgeAuthorized: false,
  trustedControllerImplemented: false,
  graphArtifactAuthority: false,
  rdCAdmissionAuthority: false,
  rdDRealArtifactAuthority: false,
  sourceHealthCurrent: false,
  runtimeAuthorized: false,
  publicationAuthorized: false,
}, 'synthetic OPL bridge claims');

export const SYNTHETIC_BRIDGE_LIMITATIONS = Object.freeze([
  'Successful materialization is synthetic exact-fixture mechanics only; it is not a real bridge observation or trusted controller result.',
  'The bridge emits the accepted RD-B intermediate and invokes the accepted RD-B adapter, but it cannot mint GraphArtifact, RD-C authority, an RD-D real artifact, or Source Health current.',
  'The sole cost is recomputed integer-millimetre geometry distance; duration, objective cost, safety, accessibility, completeness, and routing correctness are not produced or established.',
  'Relations and turn restrictions remain explicitly unavailable and are never treated as an empty applied set.',
  'Cross-state and non-rectangular core-boundary correctness remain unavailable; synthetic fixtures must remain wholly inside the declared bbox.',
  'The 16 MiB OPL, 100,000-node, and related aggregate ceilings are defensive small-fixture mechanics, not evidence of full Philadelphia capacity.',
  'No controller, process, filesystem, network, PBF parser, latest source, retry, fallback, runtime, or publication path exists in this module.',
]);

export const TRUSTED_BUILD_STEP_IDS = Object.freeze([
  'download-pbf',
  'source-fileinfo',
  'extract-buffer',
  'filter-walking',
  'check-references',
  'write-opl',
  'intermediate-fileinfo',
]);

export const TRUSTED_BUILD_PROMOTION_SLOTS = Object.freeze([
  'sourcePbf',
  'sourceFileInfo',
  'bufferExtractPbf',
  'walkingFilteredPbf',
  'intermediateOpl',
  'intermediateFileInfo',
  'log',
  'buildEvidence',
]);

export const TRUSTED_BUILD_CLAIMS = freezeData({
  observationKind: 'future-controller-direct-process-observation',
  exactResolvedArgvRequired: true,
  exactResolvedPathsRequired: true,
  noReparsePointsRequired: true,
  noPreExistingOutputsRequired: true,
  atomicNoReplacePromotionRequired: true,
  exactStdoutStderrLogAndFileinfoBytesRequired: true,
  exactIntermediatePayloadByteObservationsRequired: true,
  exactBridgeInputCapturesRequired: true,
  syntheticBridgeRecomputationRequired: true,
  retryAllowed: false,
  fallbackAllowed: false,
  latestAllowed: false,
  apiAllowed: false,
  overpassAllowed: false,
  tileAllowed: false,
  graphArtifactAuthority: false,
  rdCAdmissionAuthority: false,
  rdDRealArtifactAuthority: false,
  sourceHealthCurrent: false,
  runtimeAuthorized: false,
  publicationAuthorized: false,
}, 'TrustedBuildEvidence/v1 claim boundary');

export const TRUSTED_BUILD_LIMITATIONS = Object.freeze([
  'TrustedBuildEvidence/v1 can become trusted only through a future separately reviewed controller and module-private observation registry; caller JSON is never a capability or success evidence.',
  'Hashes, reviewedBy text, brands, internally consistent certificates, exit-code claims, and self-authored observations do not prove that a process ran or that bytes were observed.',
  'The default bridge and evidence registries are empty, the controller is unimplemented, and real bridge/evidence status is unavailable.',
  'The contract records exact acquisition, receipt, extraction, tool, lease, argv, cwd, path, capture, closed-file byte observation, promotion, and recomputed synthetic RD-B identities without authorizing any command.',
  'Intermediate PBF SHA-256 and byte counts are accepted only when cross-checked against distinct future-controller closed-file observation records; neither those records nor their hashes establish trust when supplied by a caller.',
  'The controller-produced build-evidence file cannot attest to itself; only a later independent module-private registry observation can establish its exact file bytes as TrustedBuildEvidence.',
  'The 16 MiB OPL, 100,000-node, and related aggregate ceilings are defensive small-fixture mechanics, not evidence of full Philadelphia capacity.',
  'No retry, fallback, latest source, API, Overpass, tile, PBF parsing, live process, runtime, Source Health current, admission, publication, or deployment is provided.',
]);

export const TRUSTED_BUILD_CAPTURE_LIMITS = freezeData({
  maximumChunks: 64,
  maximumAggregateDecodedBytes: 262_144,
  maximumSingleCaptureDecodedBytes: 131_072,
}, 'TrustedBuildEvidence/v1 embedded capture limits');
