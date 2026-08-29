const DEFAULT_TTL_MS = 5 * 60 * 1000;

function timestamp(value) {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : Date.now();
}

function opaqueToken() {
  return globalThis.crypto?.randomUUID?.() || '';
}

export function createDiaryImportPreviewSession(plans, {
  createToken = opaqueToken,
  ttlMs = DEFAULT_TTL_MS,
  now = () => new Date(),
} = {}) {
  const token = String(createToken() || '').trim();
  if (!token) throw new Error('Diary backup preview token is unavailable.');
  const expiresAt = timestamp(now()) + Math.max(1, Number(ttlMs) || 0);
  let consumed = false;
  return Object.freeze({
    token,
    expiresAt,
    plans,
    status(candidate, value = now()) {
      if (consumed) return 'consumed';
      if (!candidate || candidate !== token) return 'invalid';
      return timestamp(value) <= expiresAt ? 'current' : 'expired';
    },
    consume() {
      if (consumed) return false;
      consumed = true;
      return true;
    },
  });
}
