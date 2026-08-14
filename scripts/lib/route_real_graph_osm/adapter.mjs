import { normalizeRouteGraphCandidate } from '../route_graph_candidate/normalizer.mjs';
import {
  boundedText,
  contentIdentity,
  exactDataObject,
  fail,
  freezeData,
} from '../route_graph_candidate/safe_data.mjs';
import {
  OSM_WALK_PROFILE,
  OSM_WALK_PROFILE_IDENTITY,
} from './profile.mjs';
import { admitOsmIntermediateIngress } from './safe_ingress.mjs';
import {
  OSM_ADAPTER_RESULT_SCHEMA,
  OSM_BOUNDARY_AUDIT_SCHEMA,
  OSM_BOUNDARY_SCHEMA,
  OSM_EDGE_RECORD_SCHEMA,
  OSM_EXTRACTOR_BINDING_SCHEMA,
  OSM_INTERMEDIATE_SCHEMA,
  OSM_TURN_RESTRICTIONS_SCHEMA,
} from './schemas.mjs';

const MAX_GEOMETRY_POINTS = OSM_WALK_PROFILE.decisions.geometry.maximumPointCount;
const LIMITATIONS = Object.freeze([
  'Candidate-only OSM mapping; this result is not GraphArtifact/v1 and is not product, runtime, admission, or publication authority.',
  'The extractor binding and clipping declarations are caller-supplied intermediate evidence, not independent proof of source authenticity or extraction correctness.',
  'Turn restrictions are unavailable and are not treated as an empty set or as applied.',
  'The strict walking profile does not establish accessibility, safety, completeness, city correctness, or cross-boundary connectivity.',
  'OSM tags may be missing, conditional, stale, or heterogeneous; unresolved semantics reject the adapter input instead of becoming false or pass.',
]);

export function adaptOsmWalkingIntermediate(value) {
  const intermediate = admitIntermediate(value);
  const boundaryAudit = auditRawBoundaryAndProject(intermediate);
  const mapped = intermediate.edges.map((record, index) => mapEdgeRecord(record, index, boundaryAudit));
  mapped.sort((left, right) => compareText(left.feature.source_edge_id, right.feature.source_edge_id));
  for (let index = 1; index < mapped.length; index += 1) {
    if (mapped[index - 1].feature.source_edge_id === mapped[index].feature.source_edge_id) {
      fail('duplicate-edge-record-id', `duplicate OSM edge record id: ${mapped[index].feature.source_edge_id}`);
    }
  }

  const rawGraph = freezeData({
    schema: 'route-graph-raw-candidate/v1',
    sourceId: intermediate.sourceId,
    sourceKind: 'osm',
    features: mapped.map(({ feature }) => feature),
  }, 'OSM candidate raw graph');
  const normalization = normalizeRouteGraphCandidate(rawGraph, OSM_WALK_PROFILE.candidateProfile);
  const decisions = decisionCounts(mapped);
  const intermediateIdentity = contentIdentity(intermediate);
  const resultProjection = {
    schema: OSM_ADAPTER_RESULT_SCHEMA,
    dataClassification: 'candidate-external',
    profile: OSM_WALK_PROFILE,
    profileIdentity: OSM_WALK_PROFILE_IDENTITY,
    intermediateIdentity,
    extractor: intermediate.extractor,
    boundary: intermediate.boundary,
    boundaryAudit,
    turnRestrictions: intermediate.turnRestrictions,
    rawGraph,
    normalization,
    decisions,
    limitations: LIMITATIONS,
  };

  return freezeData({
    ...resultProjection,
    adapterIdentity: contentIdentity(resultProjection),
  }, 'OSM walking adapter result');
}

function admitIntermediate(value) {
  const ingress = admitOsmIntermediateIngress(value);
  const input = exactDataObject(ingress, [
    'schema', 'sourceId', 'sourceKind', 'extractor', 'boundary', 'turnRestrictions', 'edges',
  ], 'OSM intermediate');
  if (input.schema !== OSM_INTERMEDIATE_SCHEMA) fail('intermediate-schema', 'OSM intermediate schema is unsupported');
  boundedId(input.sourceId, 'intermediate.sourceId');
  if (input.sourceKind !== 'osm') fail('intermediate-source-kind', 'OSM intermediate sourceKind must be osm');
  input.extractor = admitExtractor(input.extractor);
  input.boundary = admitBoundary(input.boundary);
  input.turnRestrictions = admitTurnRestrictions(input.turnRestrictions);
  input.edges = input.edges.map((record, index) => admitEdgeRecord(record, index));
  input.edges.sort((left, right) => compareText(left.recordId, right.recordId));
  return freezeData(input, 'admitted OSM intermediate');
}

function admitExtractor(value) {
  const extractor = exactDataObject(value, [
    'schema', 'extractorId', 'extractorVersion', 'recordSchema',
  ], 'OSM extractor binding');
  if (extractor.schema !== OSM_EXTRACTOR_BINDING_SCHEMA) fail('extractor-schema', 'OSM extractor binding schema is unsupported');
  boundedId(extractor.extractorId, 'extractor.extractorId');
  boundedId(extractor.extractorVersion, 'extractor.extractorVersion');
  if (extractor.recordSchema !== OSM_EDGE_RECORD_SCHEMA) fail('extractor-record-schema', 'OSM extractor record schema is unsupported');
  return extractor;
}

function admitBoundary(value) {
  const boundary = exactDataObject(value, [
    'schema', 'boundaryId', 'clipperId', 'clipperVersion', 'clippingStatus',
    'clippingPolicy', 'outsideInputPolicy', 'bbox',
  ], 'OSM boundary binding');
  if (boundary.schema !== OSM_BOUNDARY_SCHEMA) fail('boundary-schema', 'OSM boundary schema is unsupported');
  boundedId(boundary.boundaryId, 'boundary.boundaryId');
  boundedId(boundary.clipperId, 'boundary.clipperId');
  boundedId(boundary.clipperVersion, 'boundary.clipperVersion');
  if (boundary.clippingStatus !== 'complete') fail('boundary-clipping-unavailable', 'boundary clipping must be explicitly complete');
  if (boundary.clippingPolicy !== 'extractor-preclipped-explicit-endpoints') fail('boundary-clipping-policy', 'boundary clipping policy is unsupported');
  if (boundary.outsideInputPolicy !== 'reject') fail('boundary-outside-policy', 'outside boundary input policy must be reject');
  boundary.bbox = rawBbox(boundary.bbox, 'boundary.bbox');
  return boundary;
}

function admitTurnRestrictions(value) {
  const restrictions = exactDataObject(value, ['schema', 'status', 'reason'], 'OSM turn restrictions');
  if (restrictions.schema !== OSM_TURN_RESTRICTIONS_SCHEMA) fail('turn-restrictions-schema', 'OSM turn restriction schema is unsupported');
  if (restrictions.status !== 'unavailable' || restrictions.reason !== 'not-extracted') {
    fail('turn-restrictions-unavailable', 'turn restrictions must remain explicitly unavailable/not-extracted');
  }
  return restrictions;
}

function admitEdgeRecord(value, index) {
  const label = `OSM edges[${index}]`;
  const record = exactDataObject(value, [
    'schema', 'recordId', 'osmWayId', 'segmentIndex', 'partIndex',
    'fromNodeId', 'toNodeId', 'fromEndpointKind', 'toEndpointKind',
    'geometry', 'distanceMillimeters', 'boundaryDisposition', 'tags',
  ], label);
  if (record.schema !== OSM_EDGE_RECORD_SCHEMA) fail('edge-record-schema', `${label} schema is unsupported`);
  decimalId(record.osmWayId, `${label}.osmWayId`);
  nonNegativeInteger(record.segmentIndex, `${label}.segmentIndex`);
  nonNegativeInteger(record.partIndex, `${label}.partIndex`);
  const expectedRecordId = edgeRecordId(record);
  if (record.recordId !== expectedRecordId) fail('unstable-edge-record-id', `${label}.recordId must equal ${expectedRecordId}`);
  boundedId(record.recordId, `${label}.recordId`);
  endpointKind(record.fromEndpointKind, `${label}.fromEndpointKind`);
  endpointKind(record.toEndpointKind, `${label}.toEndpointKind`);
  boundedId(record.fromNodeId, `${label}.fromNodeId`);
  boundedId(record.toNodeId, `${label}.toNodeId`);
  if (record.fromNodeId === record.toNodeId) fail('edge-self-loop', `${label} must not use identical endpoint ids`);
  positiveDistance(record.distanceMillimeters, `${label}.distanceMillimeters`);
  if (!['inside', 'clipped'].includes(record.boundaryDisposition)) {
    fail('boundary-disposition', `${label}.boundaryDisposition is unsupported`);
  }
  record.tags = admitTags(record.tags, `${label}.tags`);
  return record;
}

function mapEdgeRecord(record, index, boundaryAudit) {
  const label = `OSM edges[${index}]`;
  validateEndpointIdentity(record, 'from', boundaryAudit.boundaryId, label);
  validateEndpointIdentity(record, 'to', boundaryAudit.boundaryId, label);
  const geometry = projectGeometry(record.geometry, boundaryAudit.canonicalBbox, `${label}.geometry`);
  validateCanonicalBoundaryIntersections(record, geometry, boundaryAudit.canonicalBbox, label);
  rejectConditional(record.tags.conditional, record.recordId);

  const route = classifyOptional(record.tags.route, ['ferry'], 'route', record.recordId);
  const isFerry = route === 'ferry';
  const highway = classifyHighway(record.tags.highway, isFerry, record.recordId);
  const foot = classifyRequired(record.tags.foot, OSM_WALK_PROFILE.decisions.foot, 'foot', record.recordId);
  const access = classifyRequired(record.tags.access, OSM_WALK_PROFILE.decisions.access, 'access', record.recordId);
  const direction = classifyDirection(record.tags, record.recordId);
  const construction = record.tags.construction !== null || highway === 'construction';
  const excludedReasons = [];
  if (construction) excludedReasons.push('construction');
  if (highway !== null && OSM_WALK_PROFILE.decisions.highway.excluded.includes(highway)) excludedReasons.push(`highway:${highway}`);
  if (foot === 'excluded') excludedReasons.push(`foot:${record.tags.foot}`);
  if (access === 'excluded') excludedReasons.push(`access:${record.tags.access}`);

  return {
    feature: {
      source_edge_id: record.recordId,
      from_node_id: record.fromNodeId,
      to_node_id: record.toNodeId,
      geometry_lon_lat_1e7: geometry,
      cost_millimeters: record.distanceMillimeters,
      walk_direction: direction,
      walk_access: excludedReasons.length ? 'denied' : 'allowed',
      mode: 'walking',
    },
    semantic: {
      featureKind: isFerry ? 'ferry' : highway === 'steps' ? 'stairs' : 'way',
      boundaryDisposition: record.boundaryDisposition,
      accessDisposition: excludedReasons.length ? 'excluded' : 'included',
      excludedReasons,
    },
  };
}

function admitTags(value, label) {
  const tags = exactDataObject(value, [
    'highway', 'foot', 'access', 'oneway', 'onewayFoot', 'route', 'construction', 'conditional',
  ], label);
  for (const key of ['highway', 'foot', 'access', 'oneway', 'onewayFoot', 'route', 'construction']) {
    tags[key] = optionalTag(tags[key], `${label}.${key}`);
  }
  tags.conditional = exactDataObject(tags.conditional, ['foot', 'access', 'oneway', 'onewayFoot'], `${label}.conditional`);
  for (const key of Object.keys(tags.conditional)) {
    const value = tags.conditional[key];
    if (value !== null) boundedText(value, `${label}.conditional.${key}`, { max: 500 });
  }
  return tags;
}

function rejectConditional(conditional, recordId) {
  const present = Object.entries(conditional).filter(([, value]) => value !== null).map(([key]) => key);
  if (present.length) {
    fail('conditional-semantics-unresolved', `conditional ${present.join(',')} semantics are unresolved for ${recordId}`);
  }
}

function classifyHighway(value, isFerry, recordId) {
  if (value === null) {
    if (isFerry) return null;
    fail('missing-highway', `highway is missing for non-ferry ${recordId}`);
  }
  const policy = OSM_WALK_PROFILE.decisions.highway;
  if (policy.allowed.includes(value) || policy.excluded.includes(value)) return value;
  fail('unknown-highway', `highway value is not admitted for ${recordId}`);
}

function classifyRequired(value, policy, semantic, recordId) {
  if (value === null) fail(`missing-${semantic}`, `${semantic} is missing for ${recordId}`);
  if (policy.allowed.includes(value)) return 'allowed';
  if (policy.excluded.includes(value)) return 'excluded';
  fail(`unknown-${semantic}`, `${semantic} value is not admitted for ${recordId}`);
}

function classifyOptional(value, allowed, semantic, recordId) {
  if (value === null) return null;
  if (allowed.includes(value)) return value;
  fail(`unknown-${semantic}`, `${semantic} value is not admitted for ${recordId}`);
}

function classifyDirection(tags, recordId) {
  const policy = OSM_WALK_PROFILE.decisions.oneway;
  if (tags.oneway !== null && !policy.general.includes(tags.oneway)) {
    fail('unknown-oneway', `oneway value is not admitted for ${recordId}`);
  }
  if (tags.onewayFoot !== null && !policy.footOverride.includes(tags.onewayFoot)) {
    fail('unknown-oneway-foot', `onewayFoot value is not admitted for ${recordId}`);
  }
  const selected = tags.onewayFoot ?? tags.oneway;
  if (selected === null || ['0', 'false', 'no'].includes(selected)) return 'bidirectional';
  if (selected === '-1') return 'reverse';
  return 'forward';
}

function validateEndpointIdentity(record, side, boundaryId, label) {
  const kind = record[`${side}EndpointKind`];
  const nodeId = record[`${side}NodeId`];
  const expected = kind === 'osm-node'
    ? /^osm-node:[1-9][0-9]*$/
    : `clip:${boundaryId}:${record.osmWayId}:${record.segmentIndex}:${record.partIndex}:${side}`;
  if (typeof expected === 'string' ? nodeId !== expected : !expected.test(nodeId)) {
    fail('unstable-endpoint-id', `${label}.${side}NodeId does not match its endpoint kind and stable identity`);
  }
}

function validateBoundaryMarkerShape(record, label) {
  const clippedEndpointCount = [record.fromEndpointKind, record.toEndpointKind]
    .filter((kind) => kind === 'boundary-intersection').length;
  if (record.boundaryDisposition === 'inside' && clippedEndpointCount !== 0) {
    fail('boundary-marker-mismatch', `${label} inside record cannot contain a boundary-intersection endpoint`);
  }
  if (record.boundaryDisposition === 'clipped' && clippedEndpointCount === 0) {
    fail('boundary-marker-mismatch', `${label} clipped record requires a boundary-intersection endpoint`);
  }
}

function auditRawBoundaryAndProject(intermediate) {
  const rawBounds = intermediate.boundary.bbox;
  let rawCoordinateCount = 0;
  let rawBoundaryIntersectionEndpointCount = 0;
  for (let edgeIndex = 0; edgeIndex < intermediate.edges.length; edgeIndex += 1) {
    const record = intermediate.edges[edgeIndex];
    const label = `OSM edges[${edgeIndex}]`;
    validateBoundaryMarkerShape(record, label);
    for (let coordinateIndex = 0; coordinateIndex < record.geometry.length; coordinateIndex += 1) {
      validateRawCoordinate(record.geometry[coordinateIndex], rawBounds, `${label}.geometry[${coordinateIndex}]`);
      rawCoordinateCount += 1;
    }
    for (const side of ['from', 'to']) {
      if (record[`${side}EndpointKind`] !== 'boundary-intersection') continue;
      rawBoundaryIntersectionEndpointCount += 1;
      const coordinate = side === 'from' ? record.geometry[0] : record.geometry.at(-1);
      if (!isOnBboxEdge(coordinate, rawBounds)) {
        fail(
          'boundary-intersection-not-on-raw-bbox',
          `${label} ${side} boundary intersection must lie exactly on the raw admitted bbox edge before rounding`,
        );
      }
    }
  }

  const canonicalBbox = projectBbox(rawBounds, 'boundary.bbox');
  return freezeData({
    schema: OSM_BOUNDARY_AUDIT_SCHEMA,
    boundaryId: intermediate.boundary.boundaryId,
    rawBbox: rawBounds,
    rawBboxNumberTokens: rawBounds.map(exactNumberToken),
    canonicalBbox,
    rawCoordinateAudit: 'passed',
    rawBoundaryIntersectionAudit: 'passed',
    canonicalProjection: 'nearest-1e-7-degrees-using-ecmascript-math-round',
    rawCoordinateCount,
    rawBoundaryIntersectionEndpointCount,
    authority: 'candidate-only-not-established',
  }, 'OSM raw boundary audit and canonical projection');
}

function projectGeometry(value, canonicalBounds, label) {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_GEOMETRY_POINTS) {
    fail('invalid-geometry', `${label} must contain 2..${MAX_GEOMETRY_POINTS} coordinates`);
  }
  const geometry = value.map((item, index) => projectCoordinate(item, canonicalBounds, `${label}[${index}]`));
  if (!geometry.some((item, index) => index > 0 && !sameCoordinate(item, geometry[index - 1]))) {
    fail('zero-length-geometry', `${label} must contain at least one nonzero rounded segment`);
  }
  if (sameCoordinate(geometry[0], geometry.at(-1))) {
    fail('endpoint-coordinate-collapse', `${label} cannot use identical rounded coordinates for different endpoint ids`);
  }
  return geometry;
}

function validateRawCoordinate(value, rawBounds, label) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) {
    fail('invalid-coordinate', `${label} must contain longitude and latitude as finite numbers`);
  }
  const [longitude, latitude] = value;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    fail('coordinate-range', `${label} is outside valid longitude/latitude ranges`);
  }
  if (longitude < rawBounds[0] || longitude > rawBounds[2]
    || latitude < rawBounds[1] || latitude > rawBounds[3]) {
    fail('geometry-outside-boundary', `${label} is outside the declared clipped boundary bbox before rounding`);
  }
}

function projectCoordinate(value, canonicalBounds, label) {
  const [longitude, latitude] = value;
  const rounded = [roundCoordinate(longitude), roundCoordinate(latitude)];
  if (rounded[0] < canonicalBounds[0] || rounded[0] > canonicalBounds[2]
    || rounded[1] < canonicalBounds[1] || rounded[1] > canonicalBounds[3]) {
    fail('geometry-outside-boundary', `${label} is outside the declared clipped boundary bbox`);
  }
  return rounded;
}

function rawBbox(value, label) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) {
    fail('boundary-bbox', `${label} must contain four finite numbers`);
  }
  if (value[0] < -180 || value[2] > 180 || value[1] < -90 || value[3] > 90
    || value[0] >= value[2] || value[1] >= value[3]) {
    fail('boundary-bbox', `${label} must contain increasing valid longitude/latitude bounds`);
  }
  return [...value];
}

function projectBbox(rawBounds, label) {
  const result = rawBounds.map((number) => roundCoordinate(number));
  if (result[0] >= result[2] || result[1] >= result[3]) {
    fail('boundary-bbox', `${label} collapses after admitted coordinate rounding`);
  }
  return result;
}

function validateCanonicalBoundaryIntersections(record, geometry, canonicalBounds, label) {
  for (const side of ['from', 'to']) {
    if (record[`${side}EndpointKind`] !== 'boundary-intersection') continue;
    const coordinate = side === 'from' ? geometry[0] : geometry.at(-1);
    if (!isOnBboxEdge(coordinate, canonicalBounds)) {
      fail(
        'boundary-intersection-not-on-bbox',
        `${label} ${side} boundary intersection must project onto the canonical bbox edge`,
      );
    }
  }
}

function isOnBboxEdge(coordinate, bounds) {
  return coordinate[0] === bounds[0] || coordinate[0] === bounds[2]
    || coordinate[1] === bounds[1] || coordinate[1] === bounds[3];
}

function sameCoordinate(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

function roundCoordinate(value) {
  const rounded = Math.round(value * 10_000_000) / 10_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function exactNumberToken(value) {
  return Object.is(value, -0) ? '-0' : String(value);
}

function edgeRecordId(record) {
  return `osm-way:${record.osmWayId}:segment:${record.segmentIndex}:part:${record.partIndex}`;
}

function decisionCounts(mapped) {
  const count = (predicate) => mapped.filter(predicate).length;
  return freezeData({
    inputPhysicalFeatureCount: mapped.length,
    includedPhysicalFeatureCount: count(({ semantic }) => semantic.accessDisposition === 'included'),
    excludedPhysicalFeatureCount: count(({ semantic }) => semantic.accessDisposition === 'excluded'),
    stairsPhysicalFeatureCount: count(({ semantic }) => semantic.featureKind === 'stairs'),
    ferryPhysicalFeatureCount: count(({ semantic }) => semantic.featureKind === 'ferry'),
    clippedPhysicalFeatureCount: count(({ semantic }) => semantic.boundaryDisposition === 'clipped'),
    constructionExcludedPhysicalFeatureCount: count(({ semantic }) => semantic.excludedReasons.includes('construction')),
    turnRestrictionRecordCount: null,
  }, 'OSM adapter decision counts');
}

function optionalTag(value, label) {
  if (value === null) return null;
  return boundedText(value, label, { max: 160, pattern: /^[a-z0-9_:-]+$/ });
}

function endpointKind(value, label) {
  if (!['osm-node', 'boundary-intersection'].includes(value)) fail('endpoint-kind', `${label} is unsupported`);
}

function positiveDistance(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_000_000_000) {
    fail('invalid-distance', `${label} must be an integer number of millimeters in the admitted range`);
  }
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail('invalid-index', `${label} must be a non-negative safe integer`);
}

function decimalId(value, label) {
  return boundedText(value, label, { max: 32, pattern: /^[1-9][0-9]*$/ });
}

function boundedId(value, label) {
  return boundedText(value, label, { max: 160, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/ });
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
