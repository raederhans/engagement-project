import {
  assertSafeData,
  deterministicIdentity,
  haversineDistanceM,
  projectPhiladelphiaCoordinate,
} from './known_route_evidence_contract.js';

export const PHILADELPHIA_CENTERLINE_SOURCE = Object.freeze({
  sourceId: 'philadelphia-street-centerline',
  serviceItemId: 'c36d828494cd44b5bd8b038be696c839',
  layerUrl: 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Street_Centerline/FeatureServer/0',
  catalogUrl: 'https://opendataphilly.org/datasets/street-centerlines/',
  licenseUrl: 'https://www.phila.gov/terms-of-use/',
  maximumQueryFeatures: 2_000,
  selectedFields: Object.freeze([
    'objectid', 'seg_id', 'fnode_', 'tnode_', 'oneway', 'class', 'streetlabe', 'update_',
  ]),
  limitations: Object.freeze([
    'Reference use only; the City does not guarantee engineering accuracy.',
    'The published one-way field has no coded domain in the layer metadata and is not used as routing authority.',
    'The layer does not publish sidewalk, curb-ramp, wheelchair, or pedestrian-access fields.',
  ]),
});

export const CENTERLINE_MATCH_CONTRACT = Object.freeze({
  queryBufferM: 75,
  maximumOffNetworkDistanceM: 35,
  ambiguityDifferenceM: 2,
  sampleSpacingM: 20,
  directionMismatchPenaltyM: 20,
});

const MAX_COORDINATES_PER_FEATURE = 5_000;
const MAX_TOTAL_COORDINATES = 50_000;
const MAX_SEGMENT_COMPARISONS = 2_000_000;

const REQUIRED_FIELD_TYPES = Object.freeze({
  objectid: 'esriFieldTypeOID',
  seg_id: 'esriFieldTypeInteger',
  fnode_: 'esriFieldTypeInteger',
  tnode_: 'esriFieldTypeInteger',
  oneway: 'esriFieldTypeString',
  class: 'esriFieldTypeSmallInteger',
  streetlabe: 'esriFieldTypeString',
  update_: 'esriFieldTypeDate',
});
const OBSERVED_ONEWAY_VALUES = new Set([' ', 'B', 'FT', 'TF']);

export function createCenterlineQueryDisclosure() {
  return Object.freeze({
    endpoint: `${PHILADELPHIA_CENTERLINE_SOURCE.layerUrl}/query`,
    method: 'POST',
    sentFields: Object.freeze([
      'route-derived bbox expanded by 75 metres',
      'EPSG:4326 spatial reference',
      `fixed outFields: ${PHILADELPHIA_CENTERLINE_SOURCE.selectedFields.join(', ')}`,
      'returnGeometry=true',
    ]),
    notSent: Object.freeze([
      'route polyline', 'exact route vertices', 'address', 'destination', 'route name', 'Diary data',
    ]),
    retention: 'The application keeps the response and matched route in current browser memory only.',
  });
}

export function admitCenterlineMetadata(value) {
  if (value?.serviceItemId !== PHILADELPHIA_CENTERLINE_SOURCE.serviceItemId
    || value.name !== 'Street_Centerline'
    || value.type !== 'Feature Layer'
    || value.geometryType !== 'esriGeometryPolyline'
    || value.capabilities !== 'Query'
    || value.objectIdField !== 'objectid'
    || !Number.isInteger(value.maxRecordCount)
    || value.maxRecordCount < PHILADELPHIA_CENTERLINE_SOURCE.maximumQueryFeatures
    || value.hasZ !== false || value.hasM !== false
    || !Number.isSafeInteger(value.editingInfo?.dataLastEditDate)
    || value.editingInfo.dataLastEditDate <= 0
    || !String(value.supportedQueryFormats || '').split(/\s*,\s*/).includes('geoJSON')) {
    throw new Error('Philadelphia centerline metadata contract is unavailable or drifted.');
  }
  const fields = new Map((value.fields || []).map((field) => [field?.name, field]));
  for (const [name, type] of Object.entries(REQUIRED_FIELD_TYPES)) {
    if (fields.get(name)?.type !== type) {
      throw new Error(`Philadelphia centerline field contract drifted: ${name}.`);
    }
  }
  const sourceAsOf = new Date(value.editingInfo.dataLastEditDate).toISOString();
  return Object.freeze({
    sourceId: PHILADELPHIA_CENTERLINE_SOURCE.sourceId,
    serviceItemId: value.serviceItemId,
    sourceAsOf,
    dataVersion: `city-street-centerline:${sourceAsOf}`,
    geometryType: value.geometryType,
    maxRecordCount: value.maxRecordCount,
  });
}

export function createCenterlineQueryEnvelope(normalizedRoute) {
  const [minLon, minLat, maxLon, maxLat] = normalizedRoute.bbox;
  const latitude = Math.max(Math.abs(minLat), Math.abs(maxLat));
  const latitudePadding = CENTERLINE_MATCH_CONTRACT.queryBufferM / 111_320;
  const longitudePadding = CENTERLINE_MATCH_CONTRACT.queryBufferM
    / (111_320 * Math.max(0.2, Math.cos(latitude * Math.PI / 180)));
  return Object.freeze([
    round(minLon - longitudePadding, 6),
    round(minLat - latitudePadding, 6),
    round(maxLon + longitudePadding, 6),
    round(maxLat + latitudePadding, 6),
  ]);
}

export function admitCenterlineFeatureCollection(value, { expectedCount, sourceVersion } = {}) {
  assertSafeData(value, 'centerline response');
  if (value?.type !== 'FeatureCollection' || !Array.isArray(value.features)
    || !Number.isInteger(expectedCount) || expectedCount < 1
    || expectedCount > PHILADELPHIA_CENTERLINE_SOURCE.maximumQueryFeatures
    || value.features.length !== expectedCount
    || typeof sourceVersion?.dataVersion !== 'string') {
    throw new Error('Philadelphia centerline response is incomplete or invalid.');
  }
  const edgeKeys = new Set();
  let totalCoordinates = 0;
  const edges = value.features.map((feature, index) => {
    if (feature?.type !== 'Feature' || feature.geometry?.type !== 'LineString'
      || !Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length < 2
      || feature.geometry.coordinates.length > MAX_COORDINATES_PER_FEATURE) {
      throw new Error('Philadelphia centerline geometry is unsupported.');
    }
    totalCoordinates += feature.geometry.coordinates.length;
    if (totalCoordinates > MAX_TOTAL_COORDINATES) {
      throw new Error('Philadelphia centerline response exceeds the admitted geometry complexity.');
    }
    const properties = normalizeProperties(feature.properties);
    const edgeKey = `${properties.seg_id}:${properties.objectid}`;
    if (edgeKeys.has(edgeKey)) throw new Error('Philadelphia centerline response contains duplicate edges.');
    edgeKeys.add(edgeKey);
    const coordinates = feature.geometry.coordinates.map((coordinate) => normalizeCoordinate(coordinate));
    return Object.freeze({
      sourceEdgeKey: edgeKey,
      sourceOrder: index,
      segmentId: properties.seg_id,
      objectId: properties.objectid,
      fromNode: properties.fnode_,
      toNode: properties.tnode_,
      onewayObserved: properties.oneway,
      classObserved: properties.class,
      streetLabel: normalizeStreetLabel(properties.streetlabe),
      sourceUpdatedAt: normalizeSourceDate(properties.update_),
      coordinates: Object.freeze(coordinates.map(Object.freeze)),
    });
  }).sort((left, right) => left.segmentId - right.segmentId || left.objectId - right.objectId);
  const identityProjection = edges.map((edge) => ({
    sourceEdgeKey: edge.sourceEdgeKey,
    fromNode: edge.fromNode,
    toNode: edge.toNode,
    onewayObserved: edge.onewayObserved,
    classObserved: edge.classObserved,
    coordinates: edge.coordinates,
  }));
  return Object.freeze({
    schema: 'philadelphia-centerline-session-catalog/v1',
    source: sourceVersion,
    featureCount: edges.length,
    catalogIdentity: deterministicIdentity('centerline-catalog', {
      dataVersion: sourceVersion.dataVersion,
      edges: identityProjection,
    }),
    edges: Object.freeze(edges),
  });
}

export function matchKnownRouteToCenterline({ normalizedRoute, catalog } = {}) {
  if (normalizedRoute?.schema !== 'known-route-evidence-request/v1'
    || catalog?.schema !== 'philadelphia-centerline-session-catalog/v1') {
    throw new Error('Known Route centerline match inputs are invalid.');
  }
  if (normalizedRoute.requestedDataVersion !== 'current-observed'
    && normalizedRoute.requestedDataVersion !== catalog.source.dataVersion) {
    throw new Error('Known Route requested data version is unavailable.');
  }
  const samples = routeSamples(normalizedRoute.geometry.coordinates);
  const segmentCount = catalog.edges.reduce((sum, edge) => sum + edge.coordinates.length - 1, 0);
  const segmentComparisons = samples.length * segmentCount;
  if (segmentComparisons > MAX_SEGMENT_COMPARISONS) {
    return failure('matching-complexity-limit');
  }
  const selected = [];
  let maximumDistanceM = 0;
  for (const sample of samples) {
    let first = null;
    let second = null;
    for (const edge of catalog.edges) {
      const distanceM = pointToLineDistanceM(sample.coordinate, edge.coordinates);
      const alignment = lineDirectionAlignment(sample.coordinate, sample.direction, edge.coordinates);
      const candidate = {
        edge,
        distanceM,
        scoreM: distanceM + (1 - alignment) * CENTERLINE_MATCH_CONTRACT.directionMismatchPenaltyM,
      };
      if (!first || compareCandidates(candidate, first) < 0) {
        second = first;
        first = candidate;
      } else if (!second || compareCandidates(candidate, second) < 0) {
        second = candidate;
      }
    }
    if (!first || first.distanceM > CENTERLINE_MATCH_CONTRACT.maximumOffNetworkDistanceM) {
      return failure('off-network', { maximumObservedDistanceM: round(first?.distanceM ?? Infinity, 2) });
    }
    if (second && second.scoreM - first.scoreM <= CENTERLINE_MATCH_CONTRACT.ambiguityDifferenceM
      && second.edge.sourceEdgeKey !== first.edge.sourceEdgeKey) {
      return failure('multiple-candidate-ambiguity', {
        nearestDistanceM: round(first.distanceM, 2),
        alternativeDistanceM: round(second.distanceM, 2),
      });
    }
    maximumDistanceM = Math.max(maximumDistanceM, first.distanceM);
    if (selected.at(-1)?.sourceEdgeKey !== first.edge.sourceEdgeKey) selected.push(first.edge);
  }
  if (!selected.length) return failure('off-network');
  for (let index = 0; index < selected.length - 1; index += 1) {
    if (!shareNode(selected[index], selected[index + 1])) {
      return failure('disconnected-centerline-chain', { transitionIndex: index });
    }
  }
  const matchedEdges = selected.map((edge, index) => Object.freeze({
    analysisSegmentId: `segment-${String(index + 1).padStart(3, '0')}`,
    sourceEdgeKey: edge.sourceEdgeKey,
    fromNode: edge.fromNode,
    toNode: edge.toNode,
    streetLabel: edge.streetLabel,
    coordinates: edge.coordinates,
    sourceUpdatedAt: edge.sourceUpdatedAt,
  }));
  return Object.freeze({
    status: 'matched',
    method: 'deterministic distance-and-direction centerline samples with strict ambiguity and node-connectivity rejection',
    transportSemantics: 'mode-labelled evidence only; no mode-specific traversal or route legality authority',
    dataVersion: catalog.source.dataVersion,
    sourceAsOf: catalog.source.sourceAsOf,
    catalogIdentity: catalog.catalogIdentity,
    corridorIdentity: deterministicIdentity('known-route-corridor', {
      route: normalizedRoute.sessionRouteIdentity,
      dataVersion: catalog.source.dataVersion,
      edges: matchedEdges.map((edge) => edge.sourceEdgeKey),
    }),
    maximumMatchDistanceM: round(maximumDistanceM, 2),
    matchedEdges: Object.freeze(matchedEdges),
    normalizedRoute,
  });
}

function compareCandidates(left, right) {
  return left.scoreM - right.scoreM
    || left.distanceM - right.distanceM
    || left.edge.segmentId - right.edge.segmentId
    || left.edge.objectId - right.edge.objectId;
}

export async function requestPhiladelphiaCenterlineCatalog({
  normalizedRoute,
  consent,
  request = fetch,
  signal,
} = {}) {
  if (consent !== true) return failure('consent-required');
  const metadataBeforeRaw = await requestJson(request, PHILADELPHIA_CENTERLINE_SOURCE.layerUrl, {
    method: 'GET', signal, query: { f: 'pjson' },
  });
  const metadataBefore = admitCenterlineMetadata(metadataBeforeRaw);
  if (normalizedRoute.requestedDataVersion !== 'current-observed'
    && normalizedRoute.requestedDataVersion !== metadataBefore.dataVersion) {
    return failure('requested-data-version-unavailable');
  }
  const envelope = createCenterlineQueryEnvelope(normalizedRoute);
  const spatialQuery = {
    where: '1=1',
    geometry: envelope.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
  };
  const countResponse = await requestJson(request, `${PHILADELPHIA_CENTERLINE_SOURCE.layerUrl}/query`, {
    method: 'POST', signal, body: { ...spatialQuery, returnCountOnly: 'true', f: 'json' },
  });
  if (!Number.isInteger(countResponse?.count) || countResponse.count < 1) return failure('source-coverage-unavailable');
  if (countResponse.count > PHILADELPHIA_CENTERLINE_SOURCE.maximumQueryFeatures) {
    return failure('source-query-limit-exceeded', { featureCount: countResponse.count });
  }
  const featureCollection = await requestJson(request, `${PHILADELPHIA_CENTERLINE_SOURCE.layerUrl}/query`, {
    method: 'POST', signal, body: {
      ...spatialQuery,
      outSR: '4326',
      outFields: PHILADELPHIA_CENTERLINE_SOURCE.selectedFields.join(','),
      returnGeometry: 'true',
      orderByFields: 'objectid ASC',
      resultRecordCount: String(countResponse.count),
      f: 'geojson',
    },
  });
  const metadataAfterRaw = await requestJson(request, PHILADELPHIA_CENTERLINE_SOURCE.layerUrl, {
    method: 'GET', signal, query: { f: 'pjson' },
  });
  const metadataAfter = admitCenterlineMetadata(metadataAfterRaw);
  if (metadataAfter.dataVersion !== metadataBefore.dataVersion) return failure('source-version-drift');
  return admitCenterlineFeatureCollection(featureCollection, {
    expectedCount: countResponse.count,
    sourceVersion: metadataBefore,
  });
}

async function requestJson(request, url, { method, signal, query, body } = {}) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(query || {})) target.searchParams.set(key, value);
  const options = {
    method,
    signal,
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: { accept: 'application/json' },
  };
  if (body) {
    options.headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    options.body = new URLSearchParams(body).toString();
  }
  const response = await request(target.toString(), options);
  if (!response?.ok) throw new Error(`Philadelphia centerline request failed (${response?.status || 'unknown'}).`);
  const value = await response.json();
  if (value?.error) throw new Error('Philadelphia centerline service returned an error.');
  return value;
}

function normalizeProperties(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Philadelphia centerline properties are invalid.');
  }
  const lower = Object.fromEntries(Object.entries(value).map(([key, fieldValue]) => [key.toLowerCase(), fieldValue]));
  if (Object.keys(lower).some((key) => !PHILADELPHIA_CENTERLINE_SOURCE.selectedFields.includes(key))) {
    throw new Error('Philadelphia centerline response contains unrequested fields.');
  }
  for (const field of PHILADELPHIA_CENTERLINE_SOURCE.selectedFields) {
    if (!Object.hasOwn(lower, field)) throw new Error(`Philadelphia centerline response is missing ${field}.`);
  }
  for (const field of ['objectid', 'seg_id', 'fnode_', 'tnode_']) {
    if (!Number.isSafeInteger(lower[field]) || lower[field] <= 0) {
      throw new Error(`Philadelphia centerline ${field} is invalid.`);
    }
  }
  if (!OBSERVED_ONEWAY_VALUES.has(lower.oneway)) throw new Error('Philadelphia centerline one-way vocabulary drifted.');
  if (lower.class !== null && (!Number.isSafeInteger(lower.class) || lower.class < 0)) {
    throw new Error('Philadelphia centerline class is invalid.');
  }
  return lower;
}

function normalizeCoordinate(value) {
  if (!Array.isArray(value) || value.length < 2
    || !Number.isFinite(value[0]) || !Number.isFinite(value[1])
    || value[0] < -75.35 || value[0] > -74.90 || value[1] < 39.80 || value[1] > 40.20) {
    throw new Error('Philadelphia centerline coordinate is invalid.');
  }
  return [round(value[0], 6), round(value[1], 6)];
}

function normalizeStreetLabel(value) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (/[<>\u0000-\u001f]/.test(text)) throw new Error('Philadelphia centerline street label is unsafe.');
  if (!text || text.length > 120) return 'Street label unavailable';
  return text;
}

function normalizeSourceDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function routeSamples(coordinates) {
  const samples = [];
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    const projectedStart = projectPhiladelphiaCoordinate(start);
    const projectedEnd = projectPhiladelphiaCoordinate(end);
    const direction = [projectedEnd[0] - projectedStart[0], projectedEnd[1] - projectedStart[1]];
    const count = Math.max(1, Math.ceil(haversineDistanceM(start, end) / CENTERLINE_MATCH_CONTRACT.sampleSpacingM));
    for (let sample = 0; sample < count; sample += 1) {
      const fraction = (sample + 0.5) / count;
      samples.push({
        coordinate: [
          start[0] + (end[0] - start[0]) * fraction,
          start[1] + (end[1] - start[1]) * fraction,
        ],
        direction,
      });
    }
  }
  return samples;
}

function lineDirectionAlignment(coordinate, routeDirection, lineCoordinates) {
  const point = projectPhiladelphiaCoordinate(coordinate);
  const routeLength = Math.hypot(...routeDirection);
  let bestDistance = Infinity;
  let bestAlignment = 0;
  for (let index = 0; index < lineCoordinates.length - 1; index += 1) {
    const start = projectPhiladelphiaCoordinate(lineCoordinates[index]);
    const end = projectPhiladelphiaCoordinate(lineCoordinates[index + 1]);
    const distance = pointToProjectedSegmentDistanceM(point, start, end);
    if (distance > bestDistance) continue;
    const edgeDirection = [end[0] - start[0], end[1] - start[1]];
    const edgeLength = Math.hypot(...edgeDirection);
    if (!(routeLength > 0) || !(edgeLength > 0)) continue;
    bestDistance = distance;
    bestAlignment = Math.abs(
      (routeDirection[0] * edgeDirection[0] + routeDirection[1] * edgeDirection[1])
      / (routeLength * edgeLength),
    );
  }
  return Math.min(1, bestAlignment);
}

export function pointToLineDistanceM(coordinate, lineCoordinates) {
  const point = projectPhiladelphiaCoordinate(coordinate);
  let minimum = Infinity;
  for (let index = 0; index < lineCoordinates.length - 1; index += 1) {
    minimum = Math.min(minimum, pointToProjectedSegmentDistanceM(
      point,
      projectPhiladelphiaCoordinate(lineCoordinates[index]),
      projectPhiladelphiaCoordinate(lineCoordinates[index + 1]),
    ));
  }
  return minimum;
}

function pointToProjectedSegmentDistanceM([x, y], [startX, startY], [endX, endY]) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared,
  ));
  return Math.hypot(x - (startX + fraction * deltaX), y - (startY + fraction * deltaY));
}

function shareNode(left, right) {
  return left.fromNode === right.fromNode || left.fromNode === right.toNode
    || left.toNode === right.fromNode || left.toNode === right.toNode;
}

function failure(reason, details = {}) {
  return Object.freeze({ status: 'unavailable', reason, ...details });
}

function round(value, digits) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
