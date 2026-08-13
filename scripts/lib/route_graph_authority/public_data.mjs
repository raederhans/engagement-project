import { types as utilTypes } from 'node:util';

import { fail } from '../route_graph_candidate/safe_data.mjs';

export const PUBLIC_CONTAINER_MUTABLE = 'mutable';
export const PUBLIC_CONTAINER_FROZEN = 'frozen';

export function admitPublicDataObject(value, keys, label) {
  assertNotProxy(value, label);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('object-required', `${label} must be a plain data object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('object-prototype', `${label} must be a plain data object`);
  }
  const mode = publicContainerMode(value, label);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actualKeys = [];
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') fail('symbol-property', `${label} must not contain symbol properties`);
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value')) fail('accessor-property', `${label}.${key} must be a data property`);
    if (!descriptor.enumerable) fail('hidden-property', `${label}.${key} must be enumerable`);
    assertFieldMode(descriptor, mode, `${label}.${key}`);
    actualKeys.push(key);
  }
  const missing = keys.filter((key) => !actualKeys.includes(key));
  const unknown = actualKeys.filter((key) => !keys.includes(key));
  if (missing.length || unknown.length) {
    fail(
      'schema-mismatch',
      `${label} schema mismatch (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`,
    );
  }
  return Object.freeze({
    mode,
    data: Object.freeze(Object.fromEntries(keys.map((key) => [key, descriptors[key].value]))),
  });
}

export function admitPublicDataArray(value, label, { max, expectedMode = null }) {
  assertNotProxy(value, label);
  if (!Array.isArray(value)) fail('array-required', `${label} must be an array`);
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    fail('array-prototype', `${label} must use the standard Array prototype`);
  }
  const mode = publicContainerMode(value, label);
  if (expectedMode !== null && mode !== expectedMode) {
    fail('container-mode-mismatch', `${label} must use the same ${expectedMode} descriptor mode as its containing public root`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length;
  if (!length
    || !Object.hasOwn(length, 'value')
    || !Number.isSafeInteger(length.value)
    || length.value < 0
    || length.value > max
    || length.enumerable !== false
    || length.configurable !== false
    || length.writable !== (mode === PUBLIC_CONTAINER_MUTABLE)) {
    fail('array-length-descriptor-mode', `${label} must have a standard ${mode} array length descriptor`);
  }
  const allowed = new Set(['length']);
  for (let index = 0; index < length.value; index += 1) allowed.add(String(index));
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      fail('array-property', `${label} must not contain extra, hidden, or symbol properties`);
    }
  }
  const items = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      fail('array-index-descriptor-mode', `${label} must contain dense enumerable data indexes`);
    }
    assertFieldMode(descriptor, mode, `${label}[${index}]`, 'array-index-descriptor-mode');
    items.push(descriptor.value);
  }
  return Object.freeze({ mode, items: Object.freeze(items) });
}

function publicContainerMode(value, label) {
  const extensible = Object.isExtensible(value);
  if (extensible) return PUBLIC_CONTAINER_MUTABLE;
  if (Object.isFrozen(value)) return PUBLIC_CONTAINER_FROZEN;
  fail('container-descriptor-mode', `${label} must be either extensible and fully mutable or nonextensible and fully frozen`);
}

function assertFieldMode(descriptor, mode, label, code = 'field-descriptor-mode') {
  const mutable = mode === PUBLIC_CONTAINER_MUTABLE;
  if (descriptor.writable !== mutable || descriptor.configurable !== mutable) {
    fail(code, `${label} must use the container-wide ${mode} data descriptor mode`);
  }
}

function assertNotProxy(value, label) {
  if (utilTypes.isProxy(value)) fail('proxy-object', `${label} must not be a Proxy`);
}
