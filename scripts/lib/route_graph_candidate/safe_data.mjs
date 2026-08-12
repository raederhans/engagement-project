import { createHash } from 'node:crypto';

const BLOCKED_PROPERTY_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class RouteGraphCandidateContractError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = 'RouteGraphCandidateContractError';
    this.code = code;
  }
}

export function fail(code, message) {
  throw new RouteGraphCandidateContractError(code, message);
}

export function cloneDescriptorSafe(value, label = 'value', seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('non-finite-number', `${label} must contain only finite numbers`);
    return value;
  }
  if (typeof value !== 'object') fail('unsupported-value', `${label} contains an unsupported value`);
  if (seen.has(value)) fail('cyclic-value', `${label} must not be cyclic`);
  seen.add(value);
  try {
    if (Array.isArray(value)) return cloneArray(value, label, seen);
    return cloneObject(value, label, seen);
  } finally {
    seen.delete(value);
  }
}

export function exactDataObject(value, keys, label) {
  const clone = cloneDescriptorSafe(value, label);
  if (!isPlainObject(clone)) fail('object-required', `${label} must be a plain data object`);
  const actual = Object.keys(clone);
  const missing = keys.filter((key) => !Object.hasOwn(clone, key));
  const unknown = actual.filter((key) => !keys.includes(key));
  if (missing.length || unknown.length) {
    fail(
      'schema-mismatch',
      `${label} schema mismatch (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`,
    );
  }
  return clone;
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

export function freezeData(value, label = 'value') {
  return deepFreeze(cloneDescriptorSafe(value, label));
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(cloneDescriptorSafe(value)));
}

export function contentIdentity(value) {
  return `sha256:${createHash('sha256').update(
    typeof value === 'string' ? value : canonicalStringify(value),
  ).digest('hex')}`;
}

export function boundedText(value, label, { max = 500, pattern = null } = {}) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max) {
    fail('invalid-text', `${label} must be non-empty bounded text without outer whitespace`);
  }
  if (pattern && !pattern.test(value)) fail('invalid-text', `${label} has an unsupported format`);
  return value;
}

export function exactTimestamp(value, label, { nullable = false, dateAllowed = false } = {}) {
  if (value === null && nullable) return null;
  if (dateAllowed && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value) return value;
  }
  if (typeof value !== 'string') fail('invalid-clock', `${label} must be an exact ISO timestamp${nullable ? ' or null' : ''}`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    fail('invalid-clock', `${label} must be an exact ISO timestamp${nullable ? ' or null' : ''}`);
  }
  return value;
}

export function httpUrl(value, label) {
  boundedText(value, label, { max: 2_048 });
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('invalid-url', `${label} must be an absolute HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) fail('invalid-url', `${label} must be an HTTP(S) URL`);
  return value;
}

export function stringArray(value, label, { min = 0 } = {}) {
  if (!Array.isArray(value)) fail('array-required', `${label} must be an array`);
  const result = value.map((item, index) => boundedText(item, `${label}[${index}]`, { max: 160 }));
  if (result.length < min) fail('array-too-small', `${label} must contain at least ${min} item(s)`);
  if (new Set(result).size !== result.length) fail('duplicate-value', `${label} must not contain duplicates`);
  return result;
}

function cloneArray(value, label, seen) {
  const descriptors = safeDescriptors(value, label);
  const length = descriptors.length;
  if (!length || !Object.hasOwn(length, 'value') || !Number.isSafeInteger(length.value) || length.value < 0) {
    fail('invalid-array', `${label} has an invalid length descriptor`);
  }
  const allowed = new Set(['length', ...Array.from({ length: length.value }, (_, index) => String(index))]);
  const unknown = Reflect.ownKeys(descriptors).filter((key) => typeof key !== 'string' || !allowed.has(key));
  if (unknown.length) fail('array-property', `${label} must not contain custom or symbol properties`);
  const result = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('sparse-array', `${label} must be dense data`);
    result.push(cloneDescriptorSafe(descriptor.value, `${label}[${index}]`, seen));
  }
  return result;
}

function cloneObject(value, label, seen) {
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    fail('uninspectable-object', `${label} could not be inspected safely`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail('object-prototype', `${label} must be a plain data object`);
  }
  const descriptors = safeDescriptors(value, label);
  const result = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') fail('symbol-property', `${label} must not contain symbol properties`);
    if (BLOCKED_PROPERTY_KEYS.has(key)) fail('blocked-property-key', `${label}.${key} is forbidden in candidate data`);
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value')) fail('accessor-property', `${label}.${key} must be a data property`);
    if (!descriptor.enumerable) fail('hidden-property', `${label}.${key} must be enumerable`);
    result[key] = cloneDescriptorSafe(descriptor.value, `${label}.${key}`, seen);
  }
  return result;
}

function safeDescriptors(value, label) {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    fail('uninspectable-object', `${label} could not be inspected safely`);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
