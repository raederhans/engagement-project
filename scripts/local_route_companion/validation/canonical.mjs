import { createHash } from 'node:crypto';

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function canonicalIdentity(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function identityPayload(value, identityKey = 'identity') {
  const payload = structuredClone(value);
  delete payload[identityKey];
  return payload;
}

export function assertCanonicalIdentity(value, identityKey = 'identity', label = 'artifact') {
  const expected = canonicalIdentity(identityPayload(value, identityKey));
  if (value?.[identityKey] !== expected) {
    throw new Error(`${label} canonical identity mismatch: expected ${expected}`);
  }
  return expected;
}
