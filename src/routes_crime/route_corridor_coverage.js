import { fetchPoliceDistrictsPreferred } from '../api/boundaries.js';
import {
  ROUTE_CORRIDOR_BUFFER_LIMITS_M,
  validateKnownRouteInput,
} from './route_corridor_capability.js';
import {
  conservativeGroundDistanceInWebMercator,
  projectLonLatToWebMercator,
  sampleGreatCircleRoute,
} from './route_corridor_privacy.js';

export const PHILADELPHIA_COVERAGE_MARGIN_M = 500;

const footprintCache = new WeakMap();

/**
 * Normalize official/fallback Philadelphia police district polygons into a
 * local admission footprint. The conservative proof below requires the whole
 * corridor to remain inside one district, so internal-boundary uncertainty is
 * unavailable instead of being silently treated as coverage.
 */
export function createPhiladelphiaCoverageFootprint(geojson) {
  if (geojson?.type !== 'FeatureCollection'
    || !Array.isArray(geojson.features)
    || geojson.features.length < 20
    || geojson.features.some(({ geometry }) => !['Polygon', 'MultiPolygon'].includes(geometry?.type))) {
    throw new Error('Philadelphia route coverage requires valid police district boundaries.');
  }
  if (footprintCache.has(geojson)) return footprintCache.get(geojson);
  const footprint = {
    kind: 'philadelphia-police-district-interiors',
    featureCount: geojson.features.length,
    polygons: geojson.features.flatMap(({ geometry }) => (
      geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    )),
  };
  footprintCache.set(geojson, footprint);
  return footprint;
}

/**
 * Fail-closed local proof that the whole route corridor is inside the known
 * one known police-district polygon. The extra margin absorbs source polygon
 * and projection approximation. Routes crossing a district boundary are
 * deliberately unavailable even though both districts are in Philadelphia.
 */
export function evaluatePhiladelphiaRouteCoverage({ routeInput, bufferM, footprint } = {}) {
  const routeAdmission = validateKnownRouteInput(routeInput);
  if (!routeAdmission.ok) throw new Error(`Philadelphia coverage requires a valid route: ${routeAdmission.reason}.`);
  if (!Number.isInteger(bufferM)
    || bufferM < ROUTE_CORRIDOR_BUFFER_LIMITS_M.min
    || bufferM > ROUTE_CORRIDOR_BUFFER_LIMITS_M.max) {
    throw new Error('Philadelphia coverage requires a valid integral metre buffer.');
  }
  if (footprint?.kind !== 'philadelphia-police-district-interiors'
    || !Array.isArray(footprint.polygons)
    || footprint.polygons.length < 20) {
    throw new Error('Philadelphia coverage footprint is unavailable.');
  }

  const routeCoordinates = routeAdmission.value.geometry.coordinates;
  const sampledRoute = sampleGreatCircleRoute(routeCoordinates);
  const projectedRoute = sampledRoute.map(projectLonLatToWebMercator);
  const maxAbsLatitude = Math.max(...sampledRoute.map(([, latitude]) => Math.abs(latitude)))
    + (bufferM + PHILADELPHIA_COVERAGE_MARGIN_M) / 110_000;
  const requiredProjectedClearance = conservativeGroundDistanceInWebMercator(
    bufferM + PHILADELPHIA_COVERAGE_MARGIN_M,
    maxAbsLatitude,
  );
  const corridorCovered = footprint.polygons.some((polygon) => (
    projectedLineHasClearance(projectedRoute, projectPolygon(polygon), requiredProjectedClearance)
  ));
  return {
    status: 'ready',
    region: 'Philadelphia',
    corridorCovered,
    conservativeMarginM: PHILADELPHIA_COVERAGE_MARGIN_M,
    method: 'single-police-district-interior',
  };
}

function projectPolygon(polygon) {
  return polygon.map((ring) => ring.map(projectLonLatToWebMercator));
}

function projectedLineHasClearance(line, polygon, requiredClearance) {
  if (line.some((point) => !pointInPolygon(point, polygon))) return false;
  for (let lineIndex = 0; lineIndex < line.length - 1; lineIndex += 1) {
    for (const ring of polygon) {
      for (let ringIndex = 0; ringIndex < ring.length - 1; ringIndex += 1) {
        if (segmentDistance(line[lineIndex], line[lineIndex + 1], ring[ringIndex], ring[ringIndex + 1])
          < requiredClearance) return false;
      }
    }
  }
  return true;
}

function pointInPolygon(point, [outer, ...holes]) {
  return pointInRing(point, outer) && holes.every((ring) => !pointInRing(point, ring));
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xA, yA] = ring[index];
    const [xB, yB] = ring[previous];
    if ((yA > y) !== (yB > y)
      && x < (xB - xA) * (y - yA) / (yB - yA) + xA) inside = !inside;
  }
  return inside;
}

function segmentDistance(startA, endA, startB, endB) {
  if (segmentsIntersect(startA, endA, startB, endB)) return 0;
  return Math.min(
    pointToSegmentDistance(startA, startB, endB),
    pointToSegmentDistance(endA, startB, endB),
    pointToSegmentDistance(startB, startA, endA),
    pointToSegmentDistance(endB, startA, endA),
  );
}

function pointToSegmentDistance([x, y], [startX, startY], [endX, endY]) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared,
  ));
  return Math.hypot(x - (startX + fraction * deltaX), y - (startY + fraction * deltaY));
}

function segmentsIntersect(a, b, c, d) {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  if (first === 0 && pointOnSegment(c, a, b)) return true;
  if (second === 0 && pointOnSegment(d, a, b)) return true;
  if (third === 0 && pointOnSegment(a, c, d)) return true;
  if (fourth === 0 && pointOnSegment(b, c, d)) return true;
  return first !== second && third !== fourth;
}

function orientation([xA, yA], [xB, yB], [xC, yC]) {
  return Math.sign((xB - xA) * (yC - yA) - (yB - yA) * (xC - xA));
}

function pointOnSegment([x, y], [startX, startY], [endX, endY]) {
  return x >= Math.min(startX, endX) && x <= Math.max(startX, endX)
    && y >= Math.min(startY, endY) && y <= Math.max(startY, endY);
}

/**
 * Fetches only a fixed public Philadelphia boundary resource. Exact route
 * coordinates remain local and are never arguments to the boundary request.
 */
export async function fetchPhiladelphiaRouteCorridorCoverage({
  routeInput,
  bufferM,
  signal,
} = {}, { fetchBoundaries = fetchPoliceDistrictsPreferred } = {}) {
  let source = null;
  const boundaries = await fetchBoundaries({
    signal,
    onSourceResolved: (metadata) => { source = { ...metadata }; },
  });
  const result = evaluatePhiladelphiaRouteCoverage({
    routeInput,
    bufferM,
    footprint: createPhiladelphiaCoverageFootprint(boundaries),
  });
  return {
    ...result,
    source: source?.provider || 'Philadelphia police district boundaries',
    sourceKind: source?.kind || 'unknown',
  };
}
