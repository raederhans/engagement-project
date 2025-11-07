/**
 * Route Safety Diary - Compute Safer Route Endpoint (Stub)
 *
 * Purpose: Server-side endpoint for A* pathfinding with safety penalties.
 * Status: [STUB] Returns 501 Not Implemented (M1)
 * See: docs/API_DIARY.md (POST /api/diary/route)
 */

/**
 * Handle POST /api/diary/route
 * @param {Request} req - Request object
 * @param {object} ctx - Context object
 * @returns {Response} 501 Not Implemented
 */
export default async function handler(req, ctx) {
  // M1 stub: Return 501 with message
  return new Response(
    JSON.stringify({
      ok: false,
      status: 501,
      message: 'Diary endpoint stub — to be implemented in M1.',
      hint: 'Use findSaferRoute() stub in src/map/routing_overlay.js (returns null for M1).'
    }),
    {
      status: 501,
      headers: { 'content-type': 'application/json' }
    }
  );
}
