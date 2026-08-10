const VOLATILE_HASH_FIELDS = new Set(['generatedAt', 'retrievedAt', 'exportedAt']);

function withoutVolatileFields(value) {
  if (Array.isArray(value)) return value.map(withoutVolatileFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !VOLATILE_HASH_FIELDS.has(key))
    .map(([key, item]) => [key, withoutVolatileFields(item)]));
}

export async function sha256CanonicalValue(value) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder !== 'function') {
    throw new TypeError('Invalid Evidence Bundle: browser Web Crypto SHA-256 is unavailable');
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(withoutVolatileFields(value))),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
