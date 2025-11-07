/**
 * Route Safety Diary - API Client
 *
 * Purpose: Client-side API functions for diary endpoints (mock for M1).
 * Status: [TODO] Implementation needed for M1 (mock responses)
 * See: docs/API_DIARY.md
 */

// TODO: Import http utility when implementing
// import { http } from '../utils/http.js';

/**
 * Submit trip rating with segment-level data
 * @param {object} payload - Rating data (see docs/API_DIARY.md)
 * @returns {Promise<object>} {ok, submission_id, updated_segments, saved_route_id}
 */
export async function submitDiary(payload) {
  // TODO: M1 mock implementation (500ms delay)
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({
        ok: true,
        submission_id: 'mock_' + Date.now(),
        updated_segments: payload.matched_segments.map(id => ({
          segment_id: id,
          rating: payload.overall_rating + Math.random() * 0.5 - 0.25,
          n_eff: Math.random() * 50 + 10,
          trend_30d: Math.random() * 0.8 - 0.4
        })),
        saved_route_id: payload.save_as_route ? 'route_' + Date.now() : null
      });
    }, 500);
  });

  // TODO: M2 real implementation
  // return http.post('/api/diary/submit', payload);
}

/**
 * Get segments with aggregated ratings (bbox or ID filter)
 * @param {object} params - Query params {bbox, start, end, ids}
 * @returns {Promise<object>} GeoJSON FeatureCollection
 */
export async function getSegments(params = {}) {
  // TODO: M1 mock implementation
  // Return seed data with mock ratings
  console.warn('[Diary] getSegments not implemented (M1 stub)');
  return {
    ok: false,
    status: 501,
    message: 'Endpoint not implemented in M1'
  };

  // TODO: M2 real implementation
  // const query = new URLSearchParams(params).toString();
  // return http.get(`/api/diary/segments?${query}`);
}

/**
 * Get segment details for SegmentCard
 * @param {string} segmentId - Segment ID
 * @returns {Promise<object>} Segment summary
 */
export async function getSegmentDetails(segmentId) {
  // TODO: M1 mock implementation
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({
        ok: true,
        segment_id: segmentId,
        name: 'Main St',
        rating: 3.8,
        n_eff: 45.2,
        confidence: 87,
        trend_30d: 0.4,
        top_tags: ['poor lighting', 'low foot traffic'],
        total_reports: 44,
        last_updated: Date.now() - 7200000 // 2 hours ago
      });
    }, 300);
  });

  // TODO: M2 real implementation
  // return http.get(`/api/diary/segments/${segmentId}`);
}

/**
 * Get full segment analytics for CommunityDetailsModal
 * @param {string} segmentId - Segment ID
 * @returns {Promise<object>} Full analytics
 */
export async function getSegmentAnalytics(segmentId) {
  // TODO: M1 mock implementation
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({
        ok: true,
        segment_id: segmentId,
        name: 'Main St',
        total_reports: 44,
        avg_rating: 3.8,
        confidence: 87,
        trend_30d: 0.4,
        weekly_trend: [
          { week: 'W1', rating: 3.2, count: 8, start_date: '2025-10-01' },
          { week: 'W2', rating: 3.4, count: 11, start_date: '2025-10-08' },
          { week: 'W3', rating: 3.6, count: 12, start_date: '2025-10-15' },
          { week: 'W4', rating: 3.8, count: 14, start_date: '2025-10-22' }
        ],
        rating_distribution: [
          { stars: 1, count: 8, percentage: 18 },
          { stars: 2, count: 15, percentage: 34 },
          { stars: 3, count: 12, percentage: 27 },
          { stars: 4, count: 6, percentage: 14 },
          { stars: 5, count: 3, percentage: 7 }
        ],
        tag_frequency: [
          { tag: 'poor lighting', count: 18, trend: 2 },
          { tag: 'low foot traffic', count: 12, trend: -1 },
          { tag: 'cars too close', count: 8, trend: 0 }
        ],
        recent_activity: [
          { type: 'improve', timestamp: Date.now() - 7200000, display: 'Anonymous noted improvement', relative_time: '2 hours ago' },
          { type: 'agree', timestamp: Date.now() - 18000000, display: 'Anonymous agreed with rating', relative_time: '5 hours ago' }
        ]
      });
    }, 400);
  });

  // TODO: M2 real implementation
  // return http.get(`/api/diary/segments/${segmentId}/analytics`);
}

/**
 * Submit "Agree" community action
 * @param {string} segmentId - Segment ID
 * @returns {Promise<object>} {ok, new_n_eff, message}
 */
export async function submitAgree(segmentId) {
  // TODO: M1 mock implementation
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({
        ok: true,
        segment_id: segmentId,
        new_n_eff: Math.random() * 10 + 40,
        message: 'Thanks — confidence updated'
      });
    }, 500);
  });

  // TODO: M2 real implementation
  // return http.post('/api/diary/agree', { segment_id: segmentId });
}

/**
 * Submit "Feels safer" community action
 * @param {string} segmentId - Segment ID
 * @returns {Promise<object>} {ok, improvement_count, message}
 */
export async function submitImprove(segmentId) {
  // TODO: M1 mock implementation
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({
        ok: true,
        segment_id: segmentId,
        improvement_count: Math.floor(Math.random() * 20) + 5,
        message: 'Thanks — improvement noted'
      });
    }, 500);
  });

  // TODO: M2 real implementation
  // return http.post('/api/diary/improve', { segment_id: segmentId });
}

/**
 * Get safer alternative route
 * @param {object} params - {from: [lng,lat], to: [lng,lat], time: ISO string}
 * @returns {Promise<object>} {ok, route, comparison} or {ok, route: null}
 */
export async function getSaferRoute(params) {
  // TODO: M1 stub (always returns null)
  console.warn('[Diary] A* routing not implemented yet (M1 stub)');
  return {
    ok: true,
    route: null,
    message: 'No safer alternative found within acceptable time limit'
  };

  // TODO: M2 real implementation
  // return http.post('/api/diary/route', params);
}
