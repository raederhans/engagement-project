/**
 * Route Safety Diary - Submit Rating Endpoint (Stub)
 *
 * Purpose: Server-side endpoint for submitting trip ratings.
 * Status: [STUB] Returns 501 Not Implemented (M1)
 * See: docs/API_DIARY.md (POST /api/diary/submit)
 */

/**
 * Handle POST /api/diary/submit
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
      hint: 'Use client-side mock in src/api/diary.js for M1 development.'
    }),
    {
      status: 501,
      headers: { 'content-type': 'application/json' }
    }
  );
}
