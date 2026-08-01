const STEP_NAMES = new Set(['overall', 'details', 'segments']);
const draftsByRoute = new Map();

function normalizeRating(value) {
  const rating = Number(value);
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;
}

function normalizeDraft(draft = {}) {
  const tags = Array.from(draft.tags || []).filter((tag) => typeof tag === 'string').slice(0, 3);
  const overrides = Array.from(draft.overrides || [])
    .filter(([segmentId, rating]) => String(segmentId || '').trim() && normalizeRating(rating))
    .slice(0, 2)
    .map(([segmentId, rating]) => [String(segmentId), Number(rating)]);
  return {
    step: STEP_NAMES.has(draft.step) ? draft.step : 'overall',
    overallRating: normalizeRating(draft.overallRating),
    tags,
    notes: String(draft.notes || '').slice(0, 200),
    overrides,
  };
}

export function createRatingDraft(routeId) {
  return getRatingDraft(routeId) || normalizeDraft();
}

export function getRatingDraft(routeId) {
  const saved = draftsByRoute.get(String(routeId || ''));
  return saved ? normalizeDraft(saved) : null;
}

export function saveRatingDraft(routeId, draft) {
  const key = String(routeId || '').trim();
  if (!key) return false;
  draftsByRoute.set(key, normalizeDraft(draft));
  return true;
}

export function clearRatingDraft(routeId) {
  return draftsByRoute.delete(String(routeId || ''));
}

export function selectLowestRatedSegments(routeFeature, segmentLookup, limit = 3) {
  const segmentIds = routeFeature?.properties?.segment_ids || [];
  return segmentIds.map((segmentId, index) => {
    const feature = segmentLookup?.get?.(segmentId) || segmentLookup?.[segmentId];
    const rawScore = Number(feature?.properties?.decayed_mean);
    return {
      segmentId,
      index,
      feature,
      score: Number.isFinite(rawScore) ? rawScore : 3,
    };
  }).sort((a, b) => a.score - b.score || a.index - b.index).slice(0, limit);
}

export function setSegmentOverride(overrides, segmentId, rating) {
  const normalizedRating = normalizeRating(rating);
  if (!normalizedRating) return { ok: false, error: 'Select a rating from 1 to 5.' };
  if (!overrides.has(segmentId) && overrides.size >= 2) {
    return { ok: false, error: 'Only two segment overrides are supported.' };
  }
  overrides.set(segmentId, normalizedRating);
  return { ok: true };
}

export function validateRatingStep({ step, overallRating, tags }) {
  if (step === 'overall') {
    return normalizeRating(overallRating)
      ? { ok: true }
      : { ok: false, error: 'Select an overall rating.' };
  }
  if (step === 'details') {
    const count = tags?.size ?? tags?.length ?? 0;
    if (count < 1) return { ok: false, error: 'Pick at least one tag.' };
    if (count > 3) return { ok: false, error: 'Select at most three tags.' };
  }
  return { ok: true };
}
