import { pointToLineDistanceM } from './known_route_centerline.js';

export const GENERALIZED_INCIDENT_CORRIDOR_METHOD = Object.freeze({
  schema: 'known-route-generalized-incident-contribution/v1',
  maximumDistanceM: 200,
  nonAdjacentAmbiguityDifferenceM: 5,
  contribution: 'triangular kernel declining from 1 at 0 m to 0 at 200 m; distributed across adjacent candidate analysis segments',
  precision: 'hundred-block-generalized source points; not precise sidewalk or street-segment locations',
});

export function createGeneralizedIncidentAccumulator({ matchedEdges } = {}) {
  if (!Array.isArray(matchedEdges) || !matchedEdges.length) {
    throw new Error('Known Route contribution accumulator requires matched centerline edges.');
  }
  return {
    schema: GENERALIZED_INCIDENT_CORRIDOR_METHOD.schema,
    rowsRead: 0,
    eligibleGeneralizedRows: 0,
    contributingRows: 0,
    excluded: {
      nonActive: 0,
      coordinateUnavailable: 0,
      precisionUnavailable: 0,
      categoryUnavailable: 0,
      outsideUncertaintyCorridor: 0,
      ambiguousNonAdjacent: 0,
      malformed: 0,
    },
    segments: matchedEdges.map((edge) => ({
      analysisSegmentId: edge.analysisSegmentId,
      streetLabel: edge.streetLabel,
      coordinates: edge.coordinates,
      contributionUnits: 0,
      contributingRows: 0,
      categories: new Map(),
    })),
  };
}

/**
 * Adds one canonical M1 event without retaining its identity, coordinate,
 * generalized location, address, or source row. The caller must not log event.
 */
export function addCanonicalGeneralizedIncident(accumulator, event) {
  accumulator.rowsRead += 1;
  if (!event || typeof event !== 'object') return exclude(accumulator, 'malformed');
  if (event.lifecycle?.state !== 'active') return exclude(accumulator, 'nonActive');
  if (event.coordinate?.status !== 'available' || !isLonLat(event.coordinate.value)) {
    return exclude(accumulator, 'coordinateUnavailable');
  }
  if (event.coordinate.exact_location_claim !== false
    || event.generalized_location?.exact_sidewalk_or_street_segment !== false) {
    return exclude(accumulator, 'precisionUnavailable');
  }
  const category = event.normalized_category;
  if (category?.status !== 'mapped' || typeof category.theme_id !== 'string' || !category.theme_id) {
    return exclude(accumulator, 'categoryUnavailable');
  }
  accumulator.eligibleGeneralizedRows += 1;
  return addCoordinateContribution(accumulator, event.coordinate.value, category.theme_id);
}

/** Runtime adapter for the existing bounded reported-record response. */
export function addRuntimeReportedRecord(accumulator, feature) {
  accumulator.rowsRead += 1;
  const coordinate = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
  if (!isLonLat(coordinate)) return exclude(accumulator, 'coordinateUnavailable');
  const properties = feature.properties || {};
  const category = String(properties.text_general_code || 'Reported category unavailable').trim();
  accumulator.eligibleGeneralizedRows += 1;
  return addCoordinateContribution(accumulator, coordinate, category);
}

export function finalizeGeneralizedIncidentAccumulator(accumulator) {
  const segments = accumulator.segments.map((segment) => {
    const contributionUnits = round(segment.contributionUnits, 6);
    const categories = conserveRoundedMass({
      entries: [...segment.categories.entries()].map(([category, units]) => ({ category, units })),
      target: contributionUnits,
      digits: 6,
    }).map(({ category, units }) => Object.freeze({ category, contributionUnits: units }))
      .sort((left, right) => right.contributionUnits - left.contributionUnits
        || left.category.localeCompare(right.category));
    return Object.freeze({
      analysisSegmentId: segment.analysisSegmentId,
      streetLabel: segment.streetLabel,
      contributionUnits,
      contributingRows: segment.contributingRows,
      categories: Object.freeze(categories),
    });
  });
  const routeContributionUnits = round(segments.reduce((sum, segment) => sum + segment.contributionUnits, 0), 6);
  return Object.freeze({
    schema: accumulator.schema,
    status: accumulator.contributingRows ? 'partial' : 'admitted-zero',
    method: GENERALIZED_INCIDENT_CORRIDOR_METHOD,
    route: Object.freeze({
      contributionUnits: routeContributionUnits,
      contributingRows: accumulator.contributingRows,
      rowsRead: accumulator.rowsRead,
      eligibleGeneralizedRows: accumulator.eligibleGeneralizedRows,
    }),
    excluded: Object.freeze({ ...accumulator.excluded }),
    segments: Object.freeze(segments),
  });
}

export function aggregateRuntimeReportedRecords({ matches, matchedEdges } = {}) {
  const accumulator = createGeneralizedIncidentAccumulator({ matchedEdges });
  for (const match of matches || []) addRuntimeReportedRecord(accumulator, match?.incident);
  return finalizeGeneralizedIncidentAccumulator(accumulator);
}

function addCoordinateContribution(accumulator, coordinate, category) {
  const candidates = accumulator.segments.map((segment, index) => ({
    segment,
    index,
    distanceM: pointToLineDistanceM(coordinate, segment.coordinates),
  })).filter(({ distanceM }) => distanceM <= GENERALIZED_INCIDENT_CORRIDOR_METHOD.maximumDistanceM)
    .sort((left, right) => left.distanceM - right.distanceM || left.index - right.index);
  if (!candidates.length) return exclude(accumulator, 'outsideUncertaintyCorridor');
  if (candidates.length > 1
    && Math.abs(candidates[1].index - candidates[0].index) > 1
    && candidates[1].distanceM - candidates[0].distanceM
      <= GENERALIZED_INCIDENT_CORRIDOR_METHOD.nonAdjacentAmbiguityDifferenceM) {
    return exclude(accumulator, 'ambiguousNonAdjacent');
  }
  const adjacent = candidates.filter(({ index }) => Math.abs(index - candidates[0].index) <= 1);
  const rawWeights = adjacent.map(({ distanceM }) => Math.max(0,
    1 - distanceM / GENERALIZED_INCIDENT_CORRIDOR_METHOD.maximumDistanceM,
  ));
  const totalRawWeight = rawWeights.reduce((sum, value) => sum + value, 0);
  const eventContribution = rawWeights[0];
  if (!(totalRawWeight > 0) || !(eventContribution > 0)) return exclude(accumulator, 'outsideUncertaintyCorridor');
  adjacent.forEach(({ segment }, index) => {
    const share = eventContribution * rawWeights[index] / totalRawWeight;
    segment.contributionUnits += share;
    segment.contributingRows += 1;
    segment.categories.set(category, (segment.categories.get(category) || 0) + share);
  });
  accumulator.contributingRows += 1;
  return true;
}

function exclude(accumulator, reason) {
  accumulator.excluded[reason] += 1;
  return false;
}

function isLonLat(value) {
  return Array.isArray(value) && value.length === 2
    && Number.isFinite(value[0]) && value[0] >= -180 && value[0] <= 180
    && Number.isFinite(value[1]) && value[1] >= -90 && value[1] <= 90;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function conserveRoundedMass({ entries, target, digits }) {
  if (!entries.length) return [];
  const factor = 10 ** digits;
  const projected = entries.map(({ category, units }) => {
    const scaled = units * factor;
    const base = Math.floor(scaled + Number.EPSILON);
    return { category, base, remainder: scaled - base };
  });
  let remaining = Math.round(target * factor) - projected.reduce((sum, entry) => sum + entry.base, 0);
  const allocationOrder = [...projected].sort((left, right) => right.remainder - left.remainder
    || left.category.localeCompare(right.category));
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
    allocationOrder[index % allocationOrder.length].base += 1;
  }
  return projected.map(({ category, base }) => ({ category, units: base / factor }));
}
