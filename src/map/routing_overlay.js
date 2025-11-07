/**
 * Route Safety Diary - Routing Overlay
 *
 * Purpose: Display safer alternative routes with A* pathfinding.
 * Status: [TODO] Implementation needed for M1 (stub returns null)
 * See: docs/DIARY_EXEC_PLAN_M1.md (Phase 4)
 */

// TODO: Import dependencies when implementing
// import * as turf from '@turf/turf';

/**
 * Draw safer alternative route on map
 * @param {MapLibreMap} map - MapLibre map instance
 * @param {object} geojsonLine - GeoJSON Feature with LineString geometry
 * @param {object} meta - Route metadata {timeDiff, avoidedSegments}
 */
export function drawSaferRoute(map, geojsonLine, meta) {
  // TODO: Add route source and layer
  // map.addSource('safer-route', {
  //   type: 'geojson',
  //   data: geojsonLine
  // });

  // TODO: Add animated line layer
  // map.addLayer({
  //   id: 'safer-route-line',
  //   type: 'line',
  //   source: 'safer-route',
  //   paint: {
  //     'line-color': '#2196F3',  // Blue
  //     'line-width': 4,
  //     'line-opacity': 0.8
  //   }
  // });

  // TODO: Create "Safer alternative" strip (top-right overlay)
  // const strip = createSaferRouteStrip(meta);
  // document.body.appendChild(strip);

  // TODO: Zoom map to fit route bounds
  // const bounds = turf.bbox(geojsonLine);
  // map.fitBounds(bounds, { padding: 50 });

  // See: docs/SCENARIO_MAPPING.md (Scenario 3, Safer Alternative Strip)
}

/**
 * Remove safer route overlay from map
 * @param {MapLibreMap} map - MapLibre map instance
 */
export function removeSaferRoute(map) {
  // TODO: Remove route layer
  // if (map.getLayer('safer-route-line')) {
  //   map.removeLayer('safer-route-line');
  // }

  // TODO: Remove route source
  // if (map.getSource('safer-route')) {
  //   map.removeSource('safer-route');
  // }

  // TODO: Remove strip UI
  // const strip = document.getElementById('safer-route-strip');
  // if (strip) strip.remove();
}

/**
 * Create "Safer alternative" strip UI (top-right)
 * @param {object} meta - Route metadata
 * @returns {HTMLElement} Strip element
 */
function createSaferRouteStrip(meta) {
  // TODO: Create white card with border/shadow
  // TODO: Add icon (ThumbsUp, green)
  // TODO: Add title "Safer alternative now"
  // TODO: Add description (meta.timeDiff, meta.avoidedSegments)
  // TODO: Add "Show route" button (zoom to fit)
  // TODO: Add dismiss (X) button
  // TODO: Slide-in animation from right
  // TODO: Return strip element
}

/**
 * Find safer alternative route using A* pathfinding
 * @param {Array} origin - [lng, lat]
 * @param {Array} destination - [lng, lat]
 * @param {object} segments - GeoJSON FeatureCollection of segments
 * @returns {object|null} {route: Feature, meta: {...}} or null if no alternative
 */
export function findSaferRoute(origin, destination, segments) {
  // TODO: M2 implementation (A* with safety penalties)
  // For M1: Return null (no alternative found)
  console.warn('[Diary] A* routing not implemented yet (M1 stub)');
  return null;

  // TODO: M2 algorithm:
  // 1. Build graph from segments (nodes = endpoints, edges = segments)
  // 2. Run A* with cost function: length_m * (1 + penalty(rating))
  //    penalty(rating) = (5 - rating) / 5
  // 3. Heuristic: Euclidean distance (turf.distance)
  // 4. Return path if safety gain > 0.5 AND time diff < 900s
  // See: docs/ALGO_REQUIREMENTS_M1.md (Section 4: A* Pathfinding)
}

/**
 * A* pathfinding algorithm (stub for M2)
 * @param {object} start - Start node
 * @param {object} goal - Goal node
 * @param {object} graph - Graph representation
 * @param {function} costFn - Cost function (segment) => cost
 * @returns {Array} Path as array of segment IDs
 */
function aStar(start, goal, graph, costFn) {
  // TODO: M2 implementation
  // 1. Initialize open set (priority queue) and closed set
  // 2. Initialize g_score and f_score maps
  // 3. While open set not empty:
  //    a. Get node with lowest f_score
  //    b. If node === goal, reconstruct path and return
  //    c. Add node to closed set
  //    d. For each neighbor:
  //       - Calculate tentative g_score
  //       - Update if better than previous
  //       - Add to open set if not already
  // 4. Return null if no path found
  // See: docs/ALGO_REQUIREMENTS_M1.md (A* Pseudocode)
}

/**
 * Heuristic function for A* (Euclidean distance)
 * @param {object} nodeA - Node {lng, lat}
 * @param {object} nodeB - Node {lng, lat}
 * @returns {number} Estimated distance in meters
 */
function heuristic(nodeA, nodeB) {
  // TODO: Use turf.distance(pointA, pointB, {units: 'meters'})
  return 0; // Placeholder
}

/**
 * Reconstruct path from A* cameFrom map
 * @param {Map} cameFrom - Parent pointers
 * @param {object} current - Current node
 * @returns {Array} Path as array of nodes
 */
function reconstructPath(cameFrom, current) {
  // TODO: Backtrack from goal to start using cameFrom map
  return [];
}

/**
 * Cost function for A* (length + safety penalty)
 * @param {object} segment - Segment feature with properties {length_m, rating}
 * @returns {number} Cost in meters (adjusted for safety)
 */
function segmentCost(segment) {
  // TODO: Implement cost = length_m * (1 + penalty(rating))
  // penalty = (5 - rating) / 5
  // Example: 100m segment with rating 1 → cost = 100 * 1.8 = 180m equivalent
  const length = segment.properties.length_m;
  const rating = segment.properties.rating || 3.0;
  const penalty = (5 - rating) / 5;
  return length * (1 + penalty);
}
