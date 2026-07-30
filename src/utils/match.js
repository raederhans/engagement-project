/**
 * Route Safety Diary - GPS Map-Matching Algorithm
 *
 * Purpose: Match GPS traces to street segments.
 * Status: [TODO] Implementation needed for M1
 * See: docs/ALGO_REQUIREMENTS_M1.md (Section 1)
 */

// TODO: Import dependencies when implementing
// import * as turf from '@turf/turf';

/**
 * Match GPS trace to street segments
 * @param {Array} points - GPS points [{lat, lng, timestamp}, ...]
 * @param {object} segmentsGeoJSON - GeoJSON FeatureCollection of segments
 * @param {object} opts - Options {maxGapM, dirThreshold, snapBufferM}
 * @returns {Array} Array of matched segment IDs in traversal order
 */
export function matchPathToSegments(points, segmentsGeoJSON, opts = {}) {
  void points;
  void segmentsGeoJSON;
  void opts;
  throw new Error('GPS map matching is not implemented; no segment IDs were generated.');
}
