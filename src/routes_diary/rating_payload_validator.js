import { DIARY_RATING_POLICY } from './rating_policy.js';

const ALLOWED_TAGS = new Set(DIARY_RATING_POLICY.allowedTags);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRating(value) {
  return Number.isInteger(value)
    && value >= DIARY_RATING_POLICY.minRating
    && value <= DIARY_RATING_POLICY.maxRating;
}

function invalid(error) {
  return { ok: false, error };
}

export function validateRatingPayload(payload) {
  if (!isRecord(payload)) return invalid('Rating payload must be an object.');
  if (typeof payload.route_id !== 'string' || payload.route_id.length < 1) {
    return invalid('Route is required.');
  }
  if (!Array.isArray(payload.segment_ids)
    || payload.segment_ids.length < 1
    || payload.segment_ids.some((id) => typeof id !== 'string' || id.length < 1)) {
    return invalid('At least one valid route segment is required.');
  }
  if (!isRating(payload.overall_rating)) return invalid('Overall rating must be from 1 to 5.');
  if (!Array.isArray(payload.tags)
    || payload.tags.length < 1
    || payload.tags.length > DIARY_RATING_POLICY.maxTags
    || payload.tags.some((tag) => typeof tag !== 'string' || !ALLOWED_TAGS.has(tag))) {
    return invalid('Select one to three supported tags.');
  }

  const overrides = payload.segment_overrides ?? [];
  if (!Array.isArray(overrides)
    || overrides.length > DIARY_RATING_POLICY.maxSegmentOverrides
    || overrides.some((entry) => (
      !isRecord(entry)
      || typeof entry.segment_id !== 'string'
      || entry.segment_id.length < 1
      || !isRating(entry.rating)
    ))) {
    return invalid('Segment overrides must contain at most two rated segments.');
  }
  if (payload.mode !== 'walk' && payload.mode !== 'bike') {
    return invalid('Travel mode must be walk or bike.');
  }
  if (typeof payload.user_hash !== 'string'
    || payload.user_hash.length < DIARY_RATING_POLICY.minUserHashLength) {
    return invalid('User identifier is invalid.');
  }
  if (payload.notes !== undefined
    && (typeof payload.notes !== 'string'
      || payload.notes.length > DIARY_RATING_POLICY.maxNotesLength)) {
    return invalid('Notes must contain at most 200 characters.');
  }
  if (payload.timestamp !== undefined && typeof payload.timestamp !== 'string') {
    return invalid('Timestamp must be a string.');
  }
  return { ok: true, error: '' };
}
