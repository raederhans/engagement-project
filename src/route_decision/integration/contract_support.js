import { createHash } from 'node:crypto';
import { types as nodeTypes } from 'node:util';

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 64;
const MAX_ITEMS = 250_000;

export function contractFail(scope, message) {
  throw new TypeError(`${scope}: ${message}`);
}

function containerMode(raw, label, fail) {
  let extensible;
  let frozen;
  try {
    extensible = Object.isExtensible(raw);
    frozen = Object.isFrozen(raw);
  } catch {
    fail(`${label} container state cannot be inspected safely`);
  }
  if (extensible === true) return 'mutable';
  if (frozen === true) return 'frozen';
  fail(`${label} must be either extensible mutable data or fully frozen data`);
}

function inspectContainer(raw, label, fail, expectedArray) {
  if (!raw || typeof raw !== 'object') fail(`${label} must be an object`);
  if (nodeTypes.isProxy(raw)) fail(`${label} must not be a Proxy`);

  let prototype;
  let keys;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(raw);
    keys = Reflect.ownKeys(raw);
    descriptors = Object.getOwnPropertyDescriptors(raw);
  } catch {
    fail(`${label} cannot be inspected safely`);
  }
  const isArray = Array.isArray(raw);
  if (isArray !== expectedArray
    || prototype !== (expectedArray ? Array.prototype : Object.prototype)) {
    fail(`${label} must be a standard ${expectedArray ? 'array' : 'plain object'}`);
  }
  if (keys.some((key) => typeof key === 'symbol')) {
    fail(`${label} must contain string keys only`);
  }
  const mode = containerMode(raw, label, fail);
  const expectedMutable = mode === 'mutable';
  let arrayLength = null;
  if (expectedArray) {
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')
      || lengthDescriptor.enumerable !== false
      || lengthDescriptor.configurable !== false
      || lengthDescriptor.writable !== expectedMutable) {
      fail(`${label}.length descriptor does not match the ${mode} array mode`);
    }
    arrayLength = lengthDescriptor.value;
    if (!Number.isSafeInteger(arrayLength) || arrayLength < 0 || arrayLength > MAX_ITEMS) {
      fail(`${label} length is outside the supported range`);
    }
  }
  for (const key of keys) {
    if (typeof key === 'string' && BLOCKED_KEYS.has(key)) {
      fail(`${label}.${key} is prohibited`);
    }
    if (expectedArray && key === 'length') continue;
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
      fail(`${label}.${key} must be an own data property with standard enumerability`);
    }
    if (descriptor.writable !== expectedMutable || descriptor.configurable !== expectedMutable) {
      fail(`${label}.${key} descriptor does not match the ${mode} container mode`);
    }
  }
  return { keys, descriptors, mode, arrayLength };
}

export function exactDataObject(raw, requiredKeys, label, fail) {
  const { keys, descriptors } = inspectContainer(raw, label, fail, false);
  const missing = requiredKeys.filter((key) => !Object.hasOwn(descriptors, key));
  const unknown = keys.filter((key) => !requiredKeys.includes(key));
  if (missing.length || unknown.length) {
    fail(`${label} schema mismatch (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`);
  }
  return Object.fromEntries(requiredKeys.map((key) => [key, descriptors[key].value]));
}

export function snapshotData(raw, label, fail, depth = 0, ancestors = new Set()) {
  if (depth > MAX_DEPTH) fail(`${label} exceeds the supported nesting depth`);
  if (raw === null || typeof raw === 'string' || typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || Object.is(raw, -0)) {
      fail(`${label} must contain safe integers only`);
    }
    return raw;
  }
  if (!raw || typeof raw !== 'object') fail(`${label} contains unsupported data`);
  if (ancestors.has(raw)) fail(`${label} must not contain cycles`);
  ancestors.add(raw);

  let copy;
  if (Array.isArray(raw)) {
    const { keys, descriptors, arrayLength: length } = inspectContainer(
      raw,
      label,
      fail,
      true,
    );
    const extras = keys.filter((key) => key !== 'length'
      && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length));
    if (extras.length) fail(`${label} contains unsupported array properties`);
    copy = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor) fail(`${label} must not contain sparse entries`);
      copy.push(snapshotData(
        descriptor.value,
        `${label}[${index}]`,
        fail,
        depth + 1,
        ancestors,
      ));
    }
  } else {
    const { keys, descriptors } = inspectContainer(raw, label, fail, false);
    if (keys.length > MAX_ITEMS) fail(`${label} contains too many properties`);
    copy = Object.fromEntries(keys.map((key) => [
      key,
      snapshotData(descriptors[key].value, `${label}.${key}`, fail, depth + 1, ancestors),
    ]));
  }
  ancestors.delete(raw);
  return copy;
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort(compareCodeUnits).map((key) => [key, canonicalize(value[key])]),
  );
}

export function contentIdentity(schemaVersion, canonicalization, projection) {
  const canonical = canonicalStringify(projection);
  return {
    schemaVersion,
    canonicalization,
    digestAlgorithm: 'sha256',
    canonicalUtf8Bytes: new TextEncoder().encode(canonical).length,
    digest: `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`,
  };
}

export function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function sameData(left, right) {
  return canonicalStringify(left) === canonicalStringify(right);
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}
