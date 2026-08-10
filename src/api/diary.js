/**
 * Create the static Pages Diary capability. All mutations stay in the browser;
 * legacy API-shaped options are deliberately ignored so build-time environment
 * values cannot upload ratings, notes, route geometry, or drafts.
 */
export function createDiaryClient() {
  return {
    async submitDiary(payload, { signal } = {}) {
      signal?.throwIfAborted();
      return buildLocalSubmission(payload);
    },

    async getSegments() {
      return localCapabilityUnavailable('Diary uses published sample segments and local entries.');
    },

    async getSegmentDetails() {
      return localCapabilityUnavailable('Remote segment details are not a product capability.');
    },

    async getSegmentAnalytics() {
      return localCapabilityUnavailable('Remote Diary analytics are not a product capability.');
    },

    async submitAgree() {
      return localCapabilityUnavailable('Sample Community is illustrative and read-only.');
    },

    async submitImprove() {
      return localCapabilityUnavailable('Sample Community is illustrative and read-only.');
    },
  };
}

function buildLocalSubmission(payload = {}) {
  const segmentIds = normalizeSegmentIds(payload);
  const overrides = new Map(
    (payload.segment_overrides || []).map((entry) => [entry.segment_id, Number(entry.rating)]),
  );
  const overallRating = Number(payload.overall_rating);

  return {
    ok: true,
    mode: 'demo',
    capability: 'local-only',
    persisted: false,
    submission_id: null,
    updated_segments: segmentIds.map((segmentId) => ({
      segment_id: segmentId,
      rating: overrides.has(segmentId) ? overrides.get(segmentId) : overallRating,
    })),
    saved_route_id: null,
    message: 'Prepared for this browser session; no remote data was written.',
  };
}

function normalizeSegmentIds(payload) {
  const ids = payload?.matched_segments ?? payload?.segment_ids ?? [];
  return Array.isArray(ids) ? ids.filter(Boolean) : [];
}

function localCapabilityUnavailable(message) {
  return {
    ok: false,
    status: 'unavailable',
    mode: 'local-only',
    capability: 'local-only',
    persisted: false,
    message,
  };
}

const defaultClient = createDiaryClient();

export const submitDiary = (payload, options) => defaultClient.submitDiary(payload, options);
export const getSegments = (params) => defaultClient.getSegments(params);
export const getSegmentDetails = (segmentId) => defaultClient.getSegmentDetails(segmentId);
export const getSegmentAnalytics = (segmentId) => defaultClient.getSegmentAnalytics(segmentId);
export const submitAgree = (segmentId, userHash) => defaultClient.submitAgree(segmentId, userHash);
export const submitImprove = (segmentId, userHash) => defaultClient.submitImprove(segmentId, userHash);
