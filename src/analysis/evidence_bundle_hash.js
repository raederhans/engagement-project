const VOLATILE_HASH_FIELDS = new Set(['generatedAt', 'retrievedAt', 'exportedAt']);

function canonicalHashValue(value, excludeVolatileFields) {
  if (Array.isArray(value)) return value.map((item) => canonicalHashValue(item, excludeVolatileFields));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !excludeVolatileFields || !VOLATILE_HASH_FIELDS.has(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalHashValue(item, excludeVolatileFields)]));
}

export async function sha256CanonicalValue(value, { excludeVolatileFields = true } = {}) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder !== 'function') {
    throw new TypeError('Invalid Evidence Bundle: browser Web Crypto SHA-256 is unavailable');
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonicalHashValue(value, excludeVolatileFields))),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
