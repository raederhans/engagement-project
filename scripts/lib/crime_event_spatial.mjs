import { createHash } from 'node:crypto';

import { associateRouteCorridorIncidents } from '../../src/routes_crime/route_corridor_capability.js';
import { tractFeatureGEOID } from '../../src/utils/geoids.js';

const GEOID_PATTERN = /^\d{11}$/;
const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;
const EARTH_RADIUS_M = 6_378_137;
const BOUNDARY_EPSILON = 1e-10;

export function validateSourceCoordinate(value, cityBbox) {
  if (!Array.isArray(value) || value.length !== 2) {
    return { ok: false, status: 'unavailable', reason: 'coordinate-missing' };
  }
  if (value[0] === null || value[0] === undefined || value[0] === ''
    || value[1] === null || value[1] === undefined || value[1] === '') {
    return { ok: false, status: 'unavailable', reason: 'coordinate-missing' };
  }
  const [longitude, latitude] = value.map(Number);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)
    || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return { ok: false, status: 'unavailable', reason: 'coordinate-invalid' };
  }
  if (Array.isArray(cityBbox) && cityBbox.length === 4) {
    const [minLongitude, minLatitude, maxLongitude, maxLatitude] = cityBbox;
    if (longitude < minLongitude || longitude > maxLongitude
      || latitude < minLatitude || latitude > maxLatitude) {
      return { ok: false, status: 'unavailable', reason: 'coordinate-outside-city-bounds' };
    }
  }
  return { ok: true, coordinate: [longitude, latitude] };
}

export function createTractSpatialIndex(featureCollection, {
  sourceId = 'tract-boundaries-unversioned',
  geographyDefinition = 'unknown',
  cellSizeDegrees = 0.02,
} = {}) {
  if (featureCollection?.type !== 'FeatureCollection'
    || !Array.isArray(featureCollection.features)
    || featureCollection.features.length === 0) {
    throw new Error('Tract mapping requires a non-empty GeoJSON FeatureCollection.');
  }
  if (!Number.isFinite(cellSizeDegrees) || cellSizeDegrees <= 0 || cellSizeDegrees > 1) {
    throw new Error('Tract spatial-index cell size must be within (0, 1] degrees.');
  }

  const byCell = new Map();
  const features = featureCollection.features.map((feature, index) => {
    const geoid = tractFeatureGEOID(feature);
    if (!GEOID_PATTERN.test(geoid)) throw new Error(`Tract feature ${index} has an invalid GEOID.`);
    if (!['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)) {
      throw new Error(`Tract ${geoid} has unsupported geometry ${feature?.geometry?.type || '(missing)'}.`);
    }
    const bbox = geometryBounds(feature.geometry);
    return { geoid, geometry: feature.geometry, bbox };
  });
  if (new Set(features.map(({ geoid }) => geoid)).size !== features.length) {
    throw new Error('Tract mapping source contains duplicate GEOIDs.');
  }

  for (const feature of features) {
    const [minX, minY, maxX, maxY] = feature.bbox;
    const minCellX = Math.floor(minX / cellSizeDegrees);
    const maxCellX = Math.floor(maxX / cellSizeDegrees);
    const minCellY = Math.floor(minY / cellSizeDegrees);
    const maxCellY = Math.floor(maxY / cellSizeDegrees);
    for (let x = minCellX; x <= maxCellX; x += 1) {
      for (let y = minCellY; y <= maxCellY; y += 1) {
        const key = `${x}:${y}`;
        const entries = byCell.get(key) || [];
        entries.push(feature);
        byCell.set(key, entries);
      }
    }
  }

  return Object.freeze({
    sourceId,
    geographyDefinition,
    geoids: Object.freeze(features.map(({ geoid }) => geoid).sort()),
    mapPoint(coordinate) {
      const [longitude, latitude] = coordinate;
      const key = `${Math.floor(longitude / cellSizeDegrees)}:${Math.floor(latitude / cellSizeDegrees)}`;
      const candidates = byCell.get(key) || [];
      const inside = [];
      const boundary = [];
      for (const candidate of candidates) {
        if (!pointInBbox(coordinate, candidate.bbox)) continue;
        const relation = pointGeometryRelation(coordinate, candidate.geometry);
        if (relation === 'inside') inside.push(candidate.geoid);
        else if (relation === 'boundary') boundary.push(candidate.geoid);
      }
      if (boundary.length > 0 || inside.length > 1) {
        return {
          status: 'ambiguous',
          geoid: null,
          reason: 'point-on-or-across-tract-boundary',
          candidates: [...new Set([...boundary, ...inside])].sort(),
          sourceId,
          geographyDefinition,
        };
      }
      if (inside.length === 0) {
        return {
          status: 'unmapped',
          geoid: null,
          reason: 'point-outside-admitted-tract-geometries',
          candidates: [],
          sourceId,
          geographyDefinition,
        };
      }
      return {
        status: 'mapped',
        geoid: inside[0],
        reason: null,
        candidates: inside,
        sourceId,
        geographyDefinition,
      };
    },
  });
}

export function fixedWebMercatorGridCell(coordinate, { cellSizeM = 500 } = {}) {
  if (!Number.isFinite(cellSizeM) || cellSizeM <= 0 || !Number.isInteger(cellSizeM)) {
    throw new Error('Fixed grid cell size must be a positive integer number of projected metres.');
  }
  const [longitude, latitude] = coordinate;
  if (Math.abs(latitude) >= WEB_MERCATOR_MAX_LATITUDE) {
    return { status: 'unavailable', gridId: null, reason: 'web-mercator-latitude-unavailable' };
  }
  const x = EARTH_RADIUS_M * longitude * Math.PI / 180;
  const y = EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360));
  const column = Math.floor(x / cellSizeM);
  const row = Math.floor(y / cellSizeM);
  return {
    status: 'mapped',
    gridId: `epsg3857-${cellSizeM}m:${column}:${row}`,
    scheme: 'epsg3857-square-grid-v1',
    projectedCellSizeM: cellSizeM,
    reason: null,
  };
}

export function validateCorridorRegistry(value) {
  if (value == null) return null;
  if (value?.schema !== 'engagement-route-corridor-registry/v1'
    || typeof value.registry_id !== 'string' || !value.registry_id.trim()
    || !Array.isArray(value.corridors)) {
    throw new Error('Route-corridor registry contract is invalid.');
  }
  const ids = new Set();
  const corridors = value.corridors.map((corridor) => {
    if (typeof corridor?.id !== 'string' || !corridor.id.trim() || ids.has(corridor.id)) {
      throw new Error('Route-corridor ids must be non-empty and unique.');
    }
    ids.add(corridor.id);
    if (!Number.isInteger(corridor.buffer_m)) throw new Error(`Corridor ${corridor.id} buffer_m is invalid.`);
    if (!exactDate(corridor.temporal_start) || !exactDate(corridor.temporal_end_exclusive)
      || corridor.temporal_start >= corridor.temporal_end_exclusive) {
      throw new Error(`Corridor ${corridor.id} temporal coverage is invalid.`);
    }
    return structuredClone(corridor);
  });
  return Object.freeze({ schema: value.schema, registryId: value.registry_id, corridors });
}

export function mapEventToCorridors(event, corridorRegistry) {
  if (!corridorRegistry) {
    return {
      status: 'unavailable',
      registryId: null,
      matches: [],
      reason: 'corridor-registry-unavailable',
    };
  }
  if (!event?.coordinate?.value || !exactTimestamp(event.event_at)) {
    return {
      status: 'unavailable',
      registryId: corridorRegistry.registryId,
      matches: [],
      reason: 'event-coordinate-or-time-unavailable',
    };
  }
  const incident = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: event.coordinate.value },
    properties: {
      cartodb_id: event.source_record_id,
      dispatch_date_time: event.event_at,
    },
  };
  const matches = [];
  for (const corridor of corridorRegistry.corridors) {
    const association = associateRouteCorridorIncidents({
      route: corridor.route,
      bufferM: corridor.buffer_m,
      selectedRange: {
        start: corridor.temporal_start,
        end: corridor.temporal_end_exclusive,
      },
      incidents: [incident],
    });
    if (association.matches.length === 1) {
      matches.push({
        corridorId: corridor.id,
        relation: 'reported-point-near-route',
        distanceM: association.matches[0].distanceM,
        bufferM: corridor.buffer_m,
      });
    }
  }
  matches.sort((left, right) => left.corridorId.localeCompare(right.corridorId));
  return {
    status: 'available',
    registryId: corridorRegistry.registryId,
    matches,
    reason: null,
  };
}

export function spatialArtifactIdentity(value) {
  return `sha256:${createHash('sha256').update(stableSerialization(value)).digest('hex')}`;
}

function pointGeometryRelation(point, geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let inside = false;
  for (const polygon of polygons) {
    const outer = pointRingRelation(point, polygon[0]);
    if (outer === 'boundary') return 'boundary';
    if (outer !== 'inside') continue;
    let inHole = false;
    for (const hole of polygon.slice(1)) {
      const relation = pointRingRelation(point, hole);
      if (relation === 'boundary') return 'boundary';
      if (relation === 'inside') inHole = true;
    }
    if (!inHole) inside = true;
  }
  return inside ? 'inside' : 'outside';
}

function pointRingRelation([x, y], ring) {
  if (!Array.isArray(ring) || ring.length < 4) throw new Error('Polygon ring is invalid.');
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [currentX, currentY] = ring[index];
    const [previousX, previousY] = ring[previous];
    if (pointOnSegment(x, y, previousX, previousY, currentX, currentY)) return 'boundary';
    const crosses = ((currentY > y) !== (previousY > y))
      && (x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX);
    if (crosses) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}

function pointOnSegment(x, y, startX, startY, endX, endY) {
  const cross = (x - startX) * (endY - startY) - (y - startY) * (endX - startX);
  if (Math.abs(cross) > BOUNDARY_EPSILON) return false;
  return x >= Math.min(startX, endX) - BOUNDARY_EPSILON
    && x <= Math.max(startX, endX) + BOUNDARY_EPSILON
    && y >= Math.min(startY, endY) - BOUNDARY_EPSILON
    && y <= Math.max(startY, endY) + BOUNDARY_EPSILON;
}

function geometryBounds(geometry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (value) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number') {
      const [x, y] = value;
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Tract coordinate is invalid.');
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    } else {
      value.forEach(visit);
    }
  };
  visit(geometry.coordinates);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) throw new Error('Tract geometry is empty.');
  return [minX, minY, maxX, maxY];
}

function pointInBbox([x, y], [minX, minY, maxX, maxY]) {
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

function exactDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

function exactTimestamp(value) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function stableSerialization(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialization).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialization(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
