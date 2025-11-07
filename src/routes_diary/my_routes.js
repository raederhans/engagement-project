/**
 * Route Safety Diary - My Routes (Saved Routes List)
 *
 * Purpose: Display and manage user's saved routes.
 * Status: [TODO] Deferred to M3 (not in M1 scope)
 * See: docs/DIARY_EXEC_PLAN_M1.md (Phase 3, "Save as route" feature)
 */

/**
 * Open "My Routes" panel/modal
 */
export function openMyRoutesPanel() {
  // TODO: M3 implementation
  // - Fetch saved routes from API or localStorage
  // - Display routes in a list (name, date, segments count)
  // - Wire click handlers to load route on map
  // - Add delete button per route
  console.warn('[Diary] My Routes feature not implemented (M3).');
}

/**
 * Close "My Routes" panel/modal
 */
export function closeMyRoutesPanel() {
  // TODO: M3 implementation
}

/**
 * Load a saved route onto the map
 * @param {string} routeId - Saved route ID
 */
export function loadRoute(routeId) {
  // TODO: M3 implementation
  // - Fetch route segments from API
  // - Highlight segments on map
  // - Optionally fly to route bounds
}

/**
 * Delete a saved route
 * @param {string} routeId - Route ID to delete
 */
export function deleteRoute(routeId) {
  // TODO: M3 implementation
  // - Confirm with user (modal or native confirm)
  // - DELETE /api/diary/routes/:id
  // - Remove from UI list
}
