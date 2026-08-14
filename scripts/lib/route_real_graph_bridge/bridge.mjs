import {
  canonicalStringify,
  contentIdentity,
  exactDataObject,
  fail,
  freezeData,
} from '../route_graph_candidate/safe_data.mjs';
import {
  adaptOsmWalkingIntermediate,
  OSM_ADAPTER_RESULT_SCHEMA,
  OSM_BOUNDARY_SCHEMA,
  OSM_EDGE_RECORD_SCHEMA,
  OSM_EXTRACTOR_BINDING_SCHEMA,
  OSM_INTERMEDIATE_SCHEMA,
  OSM_TURN_RESTRICTIONS_SCHEMA,
} from '../route_real_graph_osm/index.mjs';
import {
  OPL_DISTANCE_MECHANICS,
  OPL_DISTANCE_MECHANICS_IDENTITY,
  OSMIUM_OPL_BRIDGE_METADATA_SCHEMA,
  OSMIUM_OPL_BRIDGE_RESULT_SCHEMA,
  OSMIUM_OPL_BRIDGE_STATUS_SCHEMA,
  OSMIUM_OPL_SUBSET_SCHEMA,
  REVIEWED_OSMIUM_OBJECT_ORDER,
  REVIEWED_OSMIUM_OUTPUT_FORMAT,
  REVIEWED_OSMIUM_TOOL_ID,
  REVIEWED_OSMIUM_VERSION,
  SYNTHETIC_BRIDGE_CLAIMS,
  SYNTHETIC_BRIDGE_LIMITATIONS,
} from './contracts.mjs';
import { parseReviewedOsmiumOplText } from './opl_parser.mjs';
import { parseBridgeContractJsonText } from './primitive_ingress.mjs';
import { readInstalledRealBridgeObservationJsonText } from './private_registry.mjs';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const REVIEWED_EXTRACTOR_ID = 'osmium-tool/1.19.1/opl-to-rd-b/v1';
const EARTH_RADIUS_METRES = 6_371_008.8;

export function materializeSyntheticOsmiumOplFixture(oplText, metadataJsonText) {
  if (arguments.length !== 2) {
    fail('bridge-arguments', 'synthetic OPL materialization accepts exactly two primitive text inputs');
  }
  const parsedOpl = parseReviewedOsmiumOplText(oplText);
  const metadataValue = parseBridgeContractJsonText(
    metadataJsonText,
    'synthetic OPL bridge metadata JSON',
  );
  const metadata = admitSyntheticBridgeMetadata(metadataValue);
  if (parsedOpl.oplIdentity !== metadata.expected.oplIdentity) {
    fail(
      'bridge-opl-identity-drift',
      `OPL identity ${parsedOpl.oplIdentity} does not match the exact fixture binding`,
    );
  }
  exactAuditCounts(parsedOpl.audit, metadata.expected);

  const edges = materializeEdges(parsedOpl, metadata.boundary);
  const intermediate = freezeData({
    schema: OSM_INTERMEDIATE_SCHEMA,
    sourceId: metadata.sourceId,
    sourceKind: 'osm',
    extractor: metadata.extractor,
    boundary: metadata.boundary,
    turnRestrictions: metadata.turnRestrictions,
    edges,
  }, 'synthetic exact OPL RD-B intermediate');
  const intermediateIdentity = contentIdentity(intermediate);
  if (intermediateIdentity !== metadata.expected.intermediateIdentity) {
    fail(
      'bridge-intermediate-identity-drift',
      `RD-B intermediate identity ${intermediateIdentity} does not match the exact fixture binding`,
    );
  }

  const distances = intermediate.edges.map(({ recordId, distanceMillimeters }) => ({
    recordId,
    distanceMillimeters,
  }));
  if (canonicalStringify(distances) !== canonicalStringify(metadata.expected.edgeDistances)) {
    fail('bridge-distance-recomputation-drift', 'recomputed integer-mm edge distances drifted');
  }

  const rdBResult = adaptOsmWalkingIntermediate(intermediate);
  if (rdBResult.schema !== OSM_ADAPTER_RESULT_SCHEMA) {
    fail('bridge-rd-b-schema-drift', 'accepted RD-B adapter returned an unsupported result schema');
  }
  if (
    rdBResult.intermediateIdentity !== intermediateIdentity
    || rdBResult.adapterIdentity !== metadata.expected.rdBAdapterIdentity
  ) {
    fail(
      'bridge-rd-b-identity-drift',
      `RD-B adapter identity ${rdBResult.adapterIdentity} does not match the exact fixture binding`,
    );
  }

  const projection = {
    schema: OSMIUM_OPL_BRIDGE_RESULT_SCHEMA,
    dataClassification: 'synthetic-contract-fixture',
    status: 'synthetic-fixture-mechanics-only',
    fixtureId: metadata.fixtureId,
    oplContract: metadata.oplContract,
    distanceMechanics: OPL_DISTANCE_MECHANICS,
    identities: {
      oplIdentity: parsedOpl.oplIdentity,
      metadataIdentity: contentIdentity(metadata),
      distanceMechanicsIdentity: OPL_DISTANCE_MECHANICS_IDENTITY,
      intermediateIdentity,
      rdBAdapterIdentity: rdBResult.adapterIdentity,
    },
    audit: freezeData(parsedOpl.audit, 'synthetic OPL bridge audit'),
    intermediate,
    rdBResult,
    claims: SYNTHETIC_BRIDGE_CLAIMS,
    limitations: SYNTHETIC_BRIDGE_LIMITATIONS,
  };
  return freezeData({
    ...projection,
    bridgeIdentity: contentIdentity(projection),
  }, 'synthetic exact OPL bridge result');
}

export function inspectRouteRealGraphBridge() {
  if (arguments.length !== 0) {
    fail('caller-bridge-observation-forbidden', 'real bridge inspection accepts no caller records');
  }
  const installed = readInstalledRealBridgeObservationJsonText();
  return freezeData({
    schema: OSMIUM_OPL_BRIDGE_STATUS_SCHEMA,
    bridgeSchema: OSMIUM_OPL_BRIDGE_RESULT_SCHEMA,
    status: 'real-bridge-unavailable',
    registryState: installed === null ? 'empty' : 'installed-observation-not-admitted',
    trustedControllerImplemented: false,
    processObservationInstalled: false,
    realOplMaterializationAuthorized: false,
    syntheticFixtureMechanicsAvailable: true,
    graphArtifactAuthority: false,
    rdCAdmissionAuthority: false,
    rdDRealArtifactAuthority: false,
    sourceHealthCurrent: false,
    runtimeAuthorized: false,
    publicationAuthorized: false,
    reasonCodes: [
      'trusted-controller-unavailable',
      'module-private-real-bridge-observation-missing',
      'real-opl-bytes-not-observed',
      'cross-state-observation-unavailable',
      'trusted-build-evidence-unavailable',
    ],
    limitations: SYNTHETIC_BRIDGE_LIMITATIONS,
  }, 'real graph bridge unavailable status');
}

function admitSyntheticBridgeMetadata(value) {
  const metadata = exactDataObject(value, [
    'schema',
    'dataClassification',
    'fixtureId',
    'sourceId',
    'oplContract',
    'extractor',
    'boundary',
    'turnRestrictions',
    'coverage',
    'expected',
    'claims',
    'limitations',
  ], 'synthetic OPL bridge metadata');
  if (metadata.schema !== OSMIUM_OPL_BRIDGE_METADATA_SCHEMA) {
    fail('bridge-metadata-schema', 'synthetic OPL bridge metadata schema is unsupported');
  }
  if (metadata.dataClassification !== 'synthetic-contract-fixture') {
    fail('bridge-real-input-forbidden', 'only synthetic exact-fixture mechanics may materialize');
  }
  boundedId(metadata.fixtureId, 'bridge metadata.fixtureId');
  if (!metadata.fixtureId.startsWith('synthetic-')) {
    fail('bridge-fixture-id', 'bridge fixture id must remain explicitly synthetic');
  }
  boundedId(metadata.sourceId, 'bridge metadata.sourceId');
  if (!metadata.sourceId.startsWith('synthetic-')) {
    fail('bridge-source-id', 'bridge source id must remain explicitly synthetic');
  }
  metadata.oplContract = admitOplContract(metadata.oplContract);
  metadata.extractor = admitExtractor(metadata.extractor);
  metadata.boundary = admitBoundary(metadata.boundary);
  metadata.turnRestrictions = admitTurnRestrictions(metadata.turnRestrictions);
  metadata.coverage = admitCoverage(metadata.coverage);
  metadata.expected = admitExpected(metadata.expected);
  if (canonicalStringify(metadata.claims) !== canonicalStringify(SYNTHETIC_BRIDGE_CLAIMS)) {
    fail('bridge-claims', 'synthetic bridge claims must match the exact closed boundary');
  }
  if (canonicalStringify(metadata.limitations) !== canonicalStringify(SYNTHETIC_BRIDGE_LIMITATIONS)) {
    fail('bridge-limitations', 'synthetic bridge limitations must match the exact closed boundary');
  }
  metadata.claims = SYNTHETIC_BRIDGE_CLAIMS;
  metadata.limitations = [...SYNTHETIC_BRIDGE_LIMITATIONS];
  return freezeData(metadata, 'admitted synthetic OPL bridge metadata');
}

function admitOplContract(value) {
  const contract = exactDataObject(value, [
    'schema',
    'toolId',
    'toolVersion',
    'outputFormat',
    'objectOrder',
    'nodeFields',
    'wayFields',
    'relationFields',
    'distanceMechanicsIdentity',
  ], 'synthetic OPL contract');
  if (
    contract.schema !== OSMIUM_OPL_SUBSET_SCHEMA
    || contract.toolId !== REVIEWED_OSMIUM_TOOL_ID
    || contract.toolVersion !== REVIEWED_OSMIUM_VERSION
    || contract.outputFormat !== REVIEWED_OSMIUM_OUTPUT_FORMAT
    || contract.objectOrder !== REVIEWED_OSMIUM_OBJECT_ORDER
    || contract.distanceMechanicsIdentity !== OPL_DISTANCE_MECHANICS_IDENTITY
  ) {
    fail('bridge-opl-contract-drift', 'OPL contract drifted from the reviewed osmium subset');
  }
  exactTextArray(contract.nodeFields, ['id', 'version', 'timestamp', 'tags', 'longitude', 'latitude'], 'OPL node fields');
  exactTextArray(contract.wayFields, ['id', 'version', 'timestamp', 'tags', 'nodeRefsWithLocations'], 'OPL way fields');
  exactTextArray(contract.relationFields, ['id', 'version', 'timestamp', 'tags', 'members'], 'OPL relation fields');
  return contract;
}

function admitExtractor(value) {
  const extractor = exactDataObject(value, [
    'schema', 'extractorId', 'extractorVersion', 'recordSchema',
  ], 'bridge RD-B extractor binding');
  if (
    extractor.schema !== OSM_EXTRACTOR_BINDING_SCHEMA
    || extractor.extractorId !== REVIEWED_EXTRACTOR_ID
    || extractor.extractorVersion !== REVIEWED_OSMIUM_VERSION
    || extractor.recordSchema !== OSM_EDGE_RECORD_SCHEMA
  ) {
    fail('bridge-extractor-drift', 'RD-B extractor binding drifted from the reviewed bridge');
  }
  return extractor;
}

function admitBoundary(value) {
  const boundary = exactDataObject(value, [
    'schema',
    'boundaryId',
    'clipperId',
    'clipperVersion',
    'clippingStatus',
    'clippingPolicy',
    'outsideInputPolicy',
    'bbox',
  ], 'bridge RD-B boundary binding');
  if (
    boundary.schema !== OSM_BOUNDARY_SCHEMA
    || boundary.clipperId !== 'synthetic-bbox-noop-clipper'
    || boundary.clipperVersion !== '1.0.0'
    || boundary.clippingStatus !== 'complete'
    || boundary.clippingPolicy !== 'extractor-preclipped-explicit-endpoints'
    || boundary.outsideInputPolicy !== 'reject'
  ) {
    fail('bridge-boundary-drift', 'synthetic RD-B boundary binding drifted');
  }
  boundedId(boundary.boundaryId, 'bridge boundary.boundaryId');
  if (
    !Array.isArray(boundary.bbox)
    || boundary.bbox.length !== 4
    || !boundary.bbox.every(Number.isFinite)
    || boundary.bbox[0] < -180
    || boundary.bbox[2] > 180
    || boundary.bbox[1] < -90
    || boundary.bbox[3] > 90
    || boundary.bbox[0] >= boundary.bbox[2]
    || boundary.bbox[1] >= boundary.bbox[3]
  ) {
    fail('bridge-boundary-bbox', 'synthetic RD-B bbox is invalid');
  }
  return boundary;
}

function admitTurnRestrictions(value) {
  const restrictions = exactDataObject(value, ['schema', 'status', 'reason'], 'bridge turn restrictions');
  if (
    restrictions.schema !== OSM_TURN_RESTRICTIONS_SCHEMA
    || restrictions.status !== 'unavailable'
    || restrictions.reason !== 'not-extracted'
  ) {
    fail('bridge-turn-restrictions', 'turn restrictions must remain unavailable/not-extracted');
  }
  return restrictions;
}

function admitCoverage(value) {
  const coverage = exactDataObject(value, [
    'status', 'crossState', 'outsideBufferPolicy', 'boundaryIntersectionPolicy',
  ], 'synthetic bridge coverage');
  if (
    coverage.status !== 'synthetic-bbox-only'
    || coverage.crossState !== 'unavailable-no-real-observation'
    || coverage.outsideBufferPolicy !== 'reject'
    || coverage.boundaryIntersectionPolicy !== 'unavailable-reject'
  ) {
    fail('bridge-coverage', 'synthetic coverage must remain bbox-only and real-state-unavailable');
  }
  return coverage;
}

function admitExpected(value) {
  const expected = exactDataObject(value, [
    'oplIdentity',
    'nodeRecordCount',
    'wayRecordCount',
    'relationRecordCount',
    'tagCount',
    'nodeReferenceCount',
    'edgeRecordCount',
    'aggregateGeometryPointCount',
    'edgeDistances',
    'intermediateIdentity',
    'rdBAdapterIdentity',
  ], 'synthetic bridge expected identities');
  exactSha256(expected.oplIdentity, 'expected OPL identity');
  exactSha256(expected.intermediateIdentity, 'expected RD-B intermediate identity');
  exactSha256(expected.rdBAdapterIdentity, 'expected RD-B adapter identity');
  for (const key of [
    'nodeRecordCount',
    'wayRecordCount',
    'relationRecordCount',
    'tagCount',
    'nodeReferenceCount',
    'edgeRecordCount',
    'aggregateGeometryPointCount',
  ]) nonNegativeSafeInteger(expected[key], `expected.${key}`);
  if (expected.relationRecordCount !== 0) {
    fail('bridge-expected-relations', 'synthetic successful fixture must contain zero relations');
  }
  if (!Array.isArray(expected.edgeDistances) || expected.edgeDistances.length !== expected.edgeRecordCount) {
    fail('bridge-expected-distances', 'expected edge distances must cover every exact edge');
  }
  expected.edgeDistances = expected.edgeDistances.map((entry, index) => {
    const distance = exactDataObject(entry, ['recordId', 'distanceMillimeters'], `expected edge distance ${index}`);
    boundedId(distance.recordId, `expected edge distance ${index}.recordId`);
    if (
      !Number.isSafeInteger(distance.distanceMillimeters)
      || distance.distanceMillimeters < 1
      || distance.distanceMillimeters > 2_000_000_000
    ) fail('bridge-expected-distances', `expected edge distance ${index} is invalid`);
    if (index > 0 && expected.edgeDistances[index - 1]?.recordId >= distance.recordId) {
      fail('bridge-expected-distance-order', 'expected edge distances must be strictly id-sorted');
    }
    return distance;
  });
  return expected;
}

function exactAuditCounts(audit, expected) {
  for (const key of [
    'nodeRecordCount',
    'wayRecordCount',
    'relationRecordCount',
    'tagCount',
    'nodeReferenceCount',
    'edgeRecordCount',
    'aggregateGeometryPointCount',
  ]) {
    if (audit[key] !== expected[key]) {
      fail('bridge-count-drift', `OPL ${key} does not match the exact fixture binding`);
    }
  }
}

function materializeEdges(parsedOpl, boundary) {
  const edges = [];
  for (const way of parsedOpl.ways) {
    for (let segmentIndex = 0; segmentIndex < way.refs.length - 1; segmentIndex += 1) {
      const from = way.refs[segmentIndex];
      const to = way.refs[segmentIndex + 1];
      assertInsideBbox(from, boundary.bbox, way.id);
      assertInsideBbox(to, boundary.bbox, way.id);
      const distanceMillimeters = computeDistanceMillimeters(from, to, way.id, segmentIndex);
      edges.push({
        schema: OSM_EDGE_RECORD_SCHEMA,
        recordId: `osm-way:${way.id}:segment:${segmentIndex}:part:0`,
        osmWayId: way.id,
        segmentIndex,
        partIndex: 0,
        fromNodeId: `osm-node:${from.id}`,
        toNodeId: `osm-node:${to.id}`,
        fromEndpointKind: 'osm-node',
        toEndpointKind: 'osm-node',
        geometry: [
          [from.longitude, from.latitude],
          [to.longitude, to.latitude],
        ],
        distanceMillimeters,
        boundaryDisposition: 'inside',
        tags: way.tags,
      });
    }
  }
  edges.sort((left, right) => compareText(left.recordId, right.recordId));
  return edges;
}

function assertInsideBbox(node, bbox, wayId) {
  if (
    node.longitude < bbox[0]
    || node.longitude > bbox[2]
    || node.latitude < bbox[1]
    || node.latitude > bbox[3]
  ) {
    fail('bridge-outside-buffer', `way ${wayId} node ${node.id} is outside the declared bbox buffer`);
  }
}

function computeDistanceMillimeters(from, to, wayId, segmentIndex) {
  const latitude1 = degreesToRadians(from.latitude);
  const latitude2 = degreesToRadians(to.latitude);
  const deltaLatitude = latitude2 - latitude1;
  const deltaLongitude = degreesToRadians(to.longitude - from.longitude);
  const sinLatitude = Math.sin(deltaLatitude / 2);
  const sinLongitude = Math.sin(deltaLongitude / 2);
  const haversine = sinLatitude ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * sinLongitude ** 2;
  const centralAngle = 2 * Math.atan2(
    Math.sqrt(Math.min(1, Math.max(0, haversine))),
    Math.sqrt(Math.max(0, 1 - haversine)),
  );
  const result = Math.round(EARTH_RADIUS_METRES * centralAngle * 1_000);
  if (!Number.isSafeInteger(result) || result < 1 || result > 2_000_000_000) {
    fail(
      'bridge-distance-range',
      `way ${wayId} segment ${segmentIndex} cannot produce one admitted integer-mm distance`,
    );
  }
  return result;
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
}

function exactTextArray(value, expected, label) {
  if (
    !Array.isArray(value)
    || value.length !== expected.length
    || value.some((item, index) => item !== expected[index])
  ) fail('bridge-field-contract', `${label} drifted`);
  return value;
}

function exactSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail('bridge-sha256', `${label} must be an exact SHA-256 identity`);
  }
  return value;
}

function boundedId(value, label) {
  if (typeof value !== 'string' || value.length > 160 || !SAFE_ID_PATTERN.test(value)) {
    fail('bridge-id', `${label} must be a bounded canonical id`);
  }
  return value;
}

function nonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('bridge-count', `${label} must be a non-negative safe integer`);
  }
  return value;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
