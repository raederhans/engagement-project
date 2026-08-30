import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_ARRAY_ITEMS = 10_000;
const MAX_DATA_DEPTH = 24;
const MAX_DATA_ITEMS = 20_000;

export class ArtifactRegistryContractError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = 'ArtifactRegistryContractError';
    this.code = code;
  }
}

export function fail(code, message) {
  throw new ArtifactRegistryContractError(code, message);
}

export function exactDataObject(value, keys, label) {
  const clone = cloneData(value, label);
  if (!isPlainObject(clone)) fail('object-required', `${label} must be a plain data object`);
  const missing = keys.filter((key) => !Object.hasOwn(clone, key));
  const unknown = Object.keys(clone).filter((key) => !keys.includes(key));
  if (missing.length || unknown.length) {
    fail(
      'schema-mismatch',
      `${label} schema mismatch (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`,
    );
  }
  return clone;
}

export function cloneData(value, label = 'value') {
  return cloneDataValue(value, label, { itemCount: 0, seen: new WeakSet() }, 0);
}

export function freezeData(value, label = 'value') {
  return deepFreeze(cloneData(value, label));
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(cloneData(value)));
}

export function contentIdentity(value) {
  return `sha256:${createHash('sha256').update(canonicalStringify(value), 'utf8').digest('hex')}`;
}

export function boundedText(value, label, { max = 500, pattern = null } = {}) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > max) {
    fail('invalid-text', `${label} must be non-empty bounded text without outer whitespace`);
  }
  if (pattern && !pattern.test(value)) fail('invalid-text', `${label} has an unsupported format`);
  return value;
}

export function exactTimestamp(value, label) {
  if (typeof value !== 'string') fail('invalid-clock', `${label} must be an exact ISO timestamp`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    fail('invalid-clock', `${label} must be an exact ISO timestamp`);
  }
  return value;
}

export function nonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('invalid-count', `${label} must be a non-negative safe integer`);
  }
  return value;
}

function cloneDataValue(value, label, state, depth) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('non-finite-number', `${label} must contain only finite numbers`);
    return value;
  }
  if (typeof value !== 'object') fail('unsupported-value', `${label} contains an unsupported value`);
  if (utilTypes.isProxy(value)) fail('proxy-object', `${label} must not be a Proxy`);
  if (depth > MAX_DATA_DEPTH) fail('data-depth', `${label} exceeds the maximum supported depth`);
  if (state.seen.has(value)) fail('cyclic-value', `${label} must not be cyclic`);
  state.seen.add(value);
  try {
    if (Array.isArray(value)) return cloneArray(value, label, state, depth);
    return cloneObject(value, label, state, depth);
  } finally {
    state.seen.delete(value);
  }
}

function cloneArray(value, label, state, depth) {
  const descriptors = safeDescriptors(value, label);
  const lengthDescriptor = descriptors.length;
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')
    || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
    fail('invalid-array', `${label} has an invalid length descriptor`);
  }
  if (lengthDescriptor.value > MAX_ARRAY_ITEMS) fail('array-size', `${label} contains too many items`);
  reserveItems(state, lengthDescriptor.value, label);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= lengthDescriptor.value) {
      fail('array-property', `${label} must not contain custom or symbol properties`);
    }
  }
  const result = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor) fail('sparse-array', `${label} must be dense data`);
    if (!Object.hasOwn(descriptor, 'value')) fail('accessor-property', `${label}[${index}] must be a data property`);
    if (!descriptor.enumerable) fail('hidden-property', `${label}[${index}] must be enumerable`);
    result.push(cloneDataValue(descriptor.value, `${label}[${index}]`, state, depth + 1));
  }
  return result;
}

function cloneObject(value, label, state, depth) {
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
  reserveItems(state, Reflect.ownKeys(descriptors).length, label);
  const result = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') fail('symbol-property', `${label} must not contain symbol properties`);
    if (BLOCKED_KEYS.has(key)) fail('blocked-property-key', `${label}.${key} is forbidden`);
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value')) fail('accessor-property', `${label}.${key} must be a data property`);
    if (!descriptor.enumerable) fail('hidden-property', `${label}.${key} must be enumerable`);
    result[key] = cloneDataValue(descriptor.value, `${label}.${key}`, state, depth + 1);
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

function reserveItems(state, count, label) {
  if (count > MAX_DATA_ITEMS - state.itemCount) fail('data-items', `${label} contains too many aggregate items`);
  state.itemCount += count;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}
