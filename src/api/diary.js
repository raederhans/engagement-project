import { DIARY_API_BASE } from '../config.js';
import { fetchJson } from '../utils/http.js';

/**
 * Create a Diary API client. With no API base, mutations are explicitly local
 * demo operations and never claim server persistence.
 */
export function createDiaryClient({ apiBase = DIARY_API_BASE, request = fetchJson } = {}) {
  const base = String(apiBase || '').trim().replace(/\/+$/, '');
  const hasApi = Boolean(base);

  const apiUrl = (path) => `${base}/${String(path).replace(/^\/+/, '')}`;
  const get = (path, options = {}) => request(apiUrl(path), options);
  const post = (path, body, headers = {}) => request(apiUrl(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    cacheTTL: 0,
    retries: 0,
  });

  return {
    async submitDiary(payload) {
      if (!hasApi) return buildDemoSubmission(payload);
      return post('submit', toApiSubmission(payload), userHeaders(payload));
    },

    async getSegments(params = {}) {
      if (!hasApi) return demoUnavailable('Diary segment API is not configured.');
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value == null || value === '') continue;
        query.set(key, Array.isArray(value) ? value.join(',') : String(value));
      }
      const suffix = query.size ? `?${query}` : '';
      return get(`segments${suffix}`, { cacheTTL: 5 * 60_000 });
    },

    async getSegmentDetails(segmentId) {
      if (!hasApi) return demoUnavailable('Diary segment details API is not configured.');
      return get(`segments/${encodeURIComponent(segmentId)}`, { cacheTTL: 60_000 });
    },

    async getSegmentAnalytics(segmentId) {
      if (!hasApi) return demoUnavailable('Diary analytics API is not configured.');
      return get(`segments/${encodeURIComponent(segmentId)}/analytics`, { cacheTTL: 2 * 60_000 });
    },

    async submitAgree(segmentId, userHash = '') {
      if (!hasApi) return demoUnavailable('Diary community actions are demo-only.');
      return post('agree', { segment_id: segmentId }, userHeaders({ user_hash: userHash }));
    },

    async submitImprove(segmentId, userHash = '') {
      if (!hasApi) return demoUnavailable('Diary community actions are demo-only.');
      return post('improve', { segment_id: segmentId }, userHeaders({ user_hash: userHash }));
    },

    async getSaferRoute(params) {
      if (!hasApi) return demoUnavailable('Safer-route API is not configured.');
      return post('route', params);
    },
  };
}

function buildDemoSubmission(payload = {}) {
  const segmentIds = normalizeSegmentIds(payload);
  const overrides = new Map(
    (payload.segment_overrides || []).map((entry) => [entry.segment_id, Number(entry.rating)]),
  );
  const overallRating = Number(payload.overall_rating);

  return {
    ok: true,
    mode: 'demo',
    persisted: false,
    submission_id: null,
    updated_segments: segmentIds.map((segmentId) => ({
      segment_id: segmentId,
      rating: overrides.has(segmentId) ? overrides.get(segmentId) : overallRating,
    })),
    saved_route_id: null,
    message: 'Applied in this browser demo only; no server data was written.',
  };
}

function toApiSubmission(payload = {}) {
  const submission = {
    overall_rating: Number(payload.overall_rating),
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    travel_mode: payload.travel_mode || payload.mode || 'walk',
    segment_overrides: Array.isArray(payload.segment_overrides) ? payload.segment_overrides : [],
    save_as_route: Boolean(payload.save_as_route),
    matched_segments: normalizeSegmentIds(payload),
    timestamp: normalizeTimestamp(payload.timestamp),
  };
  if (payload.route_name) submission.route_name = payload.route_name;
  if (payload.notes) submission.notes = payload.notes;
  return submission;
}

function normalizeSegmentIds(payload) {
  const ids = payload?.matched_segments ?? payload?.segment_ids ?? [];
  return Array.isArray(ids) ? ids.filter(Boolean) : [];
}

function normalizeTimestamp(value) {
  if (Number.isFinite(value)) return Number(value);
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function userHeaders(payload) {
  const userHash = String(payload?.user_hash || '').trim();
  return userHash ? { 'x-user-hash': userHash } : {};
}

function demoUnavailable(message) {
  return {
    ok: false,
    status: 501,
    mode: 'demo',
    persisted: false,
    message,
  };
}

const defaultClient = createDiaryClient();

export const submitDiary = (payload) => defaultClient.submitDiary(payload);
export const getSegments = (params) => defaultClient.getSegments(params);
export const getSegmentDetails = (segmentId) => defaultClient.getSegmentDetails(segmentId);
export const getSegmentAnalytics = (segmentId) => defaultClient.getSegmentAnalytics(segmentId);
export const submitAgree = (segmentId, userHash) => defaultClient.submitAgree(segmentId, userHash);
export const submitImprove = (segmentId, userHash) => defaultClient.submitImprove(segmentId, userHash);
export const getSaferRoute = (params) => defaultClient.getSaferRoute(params);
