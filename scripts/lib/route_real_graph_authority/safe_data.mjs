import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

import { REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS } from './contracts.mjs';

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ARRAY_PROTOTYPE = Array.prototype;
const OBJECT_PROTOTYPE = Object.prototype;
const REGEXP_PROTOTYPE = RegExp.prototype;
const ARRAY_IS_ARRAY = Array.isArray;
const OBJECT_FREEZE = Object.freeze;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const OBJECT_HAS_OWN = Object.hasOwn;
const OBJECT_IS_EXTENSIBLE = Object.isExtensible;
const OBJECT_IS_FROZEN = Object.isFrozen;
const OBJECT_KEYS = Object.keys;
const REFLECT_APPLY = Reflect.apply;
const REFLECT_OWN_KEYS = Reflect.ownKeys;
const REGEXP_TEST = RegExp.prototype.test;
const REGEXP_GLOBAL_GETTER = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
  REGEXP_PROTOTYPE,
  'global',
).get;
const REGEXP_STICKY_GETTER = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
  REGEXP_PROTOTYPE,
  'sticky',
).get;
const DEFAULT_JSON_LIMITS = Object.freeze({
  maxCodeUnits: 64_000_000,
  maxDepth: 32,
  maxItems: 20_000_000,
});

export class RouteRealGraphAuthorityError extends TypeError {
  constructor(code, message) {
    super(typeof message === 'string' ? message : 'route real graph authority rejected unsafe input');
    this.name = 'RouteRealGraphAuthorityError';
    this.code = typeof code === 'string' && code ? code : 'route-real-graph-authority-error';
  }
}

export function fail(code, message) {
  throw new RouteRealGraphAuthorityError(code, message);
}

export function parseStrictJson(text, optionsValue) {
  const options = admitOptionsRecord(optionsValue, [
    'label', 'maxCodeUnits', 'maxDepth', 'maxItems',
  ], 'strict JSON parser options');
  const label = labelText(options.label ?? 'input', 'input');
  const maxCodeUnits = admittedLimit(
    options.maxCodeUnits ?? DEFAULT_JSON_LIMITS.maxCodeUnits,
    'strict JSON maxCodeUnits',
    { minimum: 1, maximum: DEFAULT_JSON_LIMITS.maxCodeUnits },
  );
  const maxDepth = admittedLimit(
    options.maxDepth ?? DEFAULT_JSON_LIMITS.maxDepth,
    'strict JSON maxDepth',
    { minimum: 0, maximum: DEFAULT_JSON_LIMITS.maxDepth },
  );
  const maxItems = admittedLimit(
    options.maxItems ?? DEFAULT_JSON_LIMITS.maxItems,
    'strict JSON maxItems',
    { minimum: 1, maximum: DEFAULT_JSON_LIMITS.maxItems },
  );
  if (typeof text !== 'string') {
    fail(
      'json-text-required',
      `${label ?? 'input'} must be primitive JSON text; object, Proxy, getter, descriptor, sparse, hidden, and symbol ingress is forbidden`,
    );
  }
  if (!Number.isSafeInteger(maxCodeUnits) || maxCodeUnits < 1
    || text.length < 1 || text.length > maxCodeUnits) {
    fail('json-size', `${label ?? 'input'} JSON text length is outside the admitted bound`);
  }

  let cursor = 0;
  let itemCount = 0;

  function whitespace() {
    while (cursor < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[cursor])) cursor += 1;
  }

  function stringValue() {
    const start = cursor;
    cursor += 1;
    let escaped = false;
    while (cursor < text.length) {
      const code = text.charCodeAt(cursor);
      if (!escaped && code === 0x22) {
        cursor += 1;
        let result;
        try {
          result = JSON.parse(text.slice(start, cursor));
        } catch {
          fail('json-string', `${label ?? 'input'} contains an invalid JSON string escape`);
        }
        assertUnicodeScalarString(result, label ?? 'input');
        return result;
      }
      if (!escaped && code < 0x20) {
        fail('json-string', `${label ?? 'input'} contains a raw JSON control character`);
      }
      if (escaped) escaped = false;
      else if (code === 0x5c) escaped = true;
      cursor += 1;
    }
    fail('json-string', `${label ?? 'input'} contains an unterminated JSON string`);
  }

  function incrementItems() {
    itemCount += 1;
    if (itemCount > maxItems) {
      fail('json-items', `${label ?? 'input'} exceeds the admitted JSON item bound`);
    }
  }

  function value(depth) {
    if (depth > maxDepth) fail('json-depth', `${label ?? 'input'} exceeds the admitted JSON depth`);
    whitespace();
    const token = text[cursor];
    if (token === '"') return stringValue();
    if (token === '{') return objectValue(depth + 1);
    if (token === '[') return arrayValue(depth + 1);
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, cursor)) {
        cursor += literal.length;
        return result;
      }
    }
    const match = text.slice(cursor).match(
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/,
    );
    if (!match) fail('json-token', `${label ?? 'input'} has an unexpected token at ${cursor}`);
    cursor += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number) || Object.is(number, -0)
      || (Number.isInteger(number) && !Number.isSafeInteger(number))) {
      fail('json-number', `${label ?? 'input'} contains an unsupported JSON number`);
    }
    return number;
  }

  function objectValue(depth) {
    cursor += 1;
    whitespace();
    const result = {};
    const keys = new Set();
    if (text[cursor] === '}') {
      cursor += 1;
      return result;
    }
    while (cursor < text.length) {
      whitespace();
      if (text[cursor] !== '"') {
        fail('json-object', `${label ?? 'input'} object key must be a string`);
      }
      const key = stringValue();
      if (BLOCKED_KEYS.has(key)) {
        fail('blocked-property-key', `${label ?? 'input'} contains prohibited key ${key}`);
      }
      if (keys.has(key)) {
        fail('duplicate-json-key', `${label ?? 'input'} contains duplicate key ${key}`);
      }
      keys.add(key);
      incrementItems();
      whitespace();
      if (text[cursor] !== ':') {
        fail('json-object', `${label ?? 'input'} object key must be followed by a colon`);
      }
      cursor += 1;
      result[key] = value(depth);
      whitespace();
      if (text[cursor] === '}') {
        cursor += 1;
        return result;
      }
      if (text[cursor] !== ',') {
        fail('json-object', `${label ?? 'input'} object entries must be comma separated`);
      }
      cursor += 1;
    }
    fail('json-object', `${label ?? 'input'} contains an unterminated object`);
  }

  function arrayValue(depth) {
    cursor += 1;
    whitespace();
    const result = [];
    if (text[cursor] === ']') {
      cursor += 1;
      return result;
    }
    while (cursor < text.length) {
      incrementItems();
      result.push(value(depth));
      whitespace();
      if (text[cursor] === ']') {
        cursor += 1;
        return result;
      }
      if (text[cursor] !== ',') {
        fail('json-array', `${label ?? 'input'} array entries must be comma separated`);
      }
      cursor += 1;
    }
    fail('json-array', `${label ?? 'input'} contains an unterminated array`);
  }

  const result = value(0);
  whitespace();
  if (cursor !== text.length) {
    fail('json-trailing-data', `${label ?? 'input'} contains trailing JSON data`);
  }
  return result;
}

export function exactDataObject(value, keys, label) {
  const safeLabel = labelText(label, 'data object');
  const admittedKeys = admitExpectedKeys(keys, safeLabel);
  const expected = new Set(admittedKeys);
  const clone = cloneData(value, safeLabel);
  if (!isPlainObject(clone)) fail('object-required', `${safeLabel} must be a plain data object`);
  const actualKeys = OBJECT_KEYS(clone);
  const missing = admittedKeys.filter((key) => !Object.hasOwn(clone, key));
  const unknown = actualKeys.filter((key) => !expected.has(key));
  if (missing.length || unknown.length) {
    fail(
      'schema-mismatch',
      `${safeLabel} schema mismatch (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`,
    );
  }
  return clone;
}

export function cloneData(value, label = 'value') {
  const safeLabel = labelText(label, 'value');
  preflightData(value, safeLabel);
  return cloneValidatedData(value, safeLabel, new WeakSet());
}

export function freezeData(value, label = 'value') {
  return deepFreeze(cloneData(value, labelText(label, 'value')));
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(cloneData(value)));
}

export function contentIdentity(value) {
  return `sha256:${createHash('sha256').update(canonicalStringify(value), 'utf8').digest('hex')}`;
}

export function boundedText(value, label, optionsValue) {
  const safeLabel = labelText(label, 'text');
  const options = admitOptionsRecord(
    optionsValue,
    ['max', 'pattern', 'nullable'],
    `${safeLabel} options`,
  );
  const max = admittedLimit(options.max ?? 500, `${safeLabel} maximum length`, {
    minimum: 1,
    maximum: REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumStringCodeUnits,
  });
  const pattern = options.pattern ?? null;
  const nullable = options.nullable ?? false;
  if (typeof nullable !== 'boolean') {
    fail('invalid-options', `${safeLabel} nullable option must be boolean`);
  }
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > max) {
    fail('invalid-text', `${safeLabel} must be non-empty bounded text without outer whitespace`);
  }
  assertUnicodeScalarString(value, safeLabel);
  if (pattern !== null && !safeRegExpTest(pattern, value, safeLabel)) {
    fail('invalid-text', `${safeLabel} has an unsupported format`);
  }
  return value;
}

export function exactIdentity(value, label) {
  return boundedText(value, label, { max: 71, pattern: /^sha256:[a-f0-9]{64}$/ });
}

export function exactGitRevision(value, label) {
  return boundedText(value, label, { max: 40, pattern: /^[a-f0-9]{40}$/ });
}

export function exactTimestamp(value, label, optionsValue) {
  const safeLabel = labelText(label, 'timestamp');
  const options = admitOptionsRecord(optionsValue, ['nullable'], `${safeLabel} options`);
  const nullable = options.nullable ?? false;
  if (typeof nullable !== 'boolean') {
    fail('invalid-options', `${safeLabel} nullable option must be boolean`);
  }
  if (value === null && nullable) return null;
  if (typeof value !== 'string') fail('invalid-clock', `${safeLabel} must be an exact ISO timestamp`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    fail('invalid-clock', `${safeLabel} must be an exact ISO timestamp`);
  }
  return value;
}

export function exactDateOrTimestamp(value, label, optionsValue) {
  const safeLabel = labelText(label, 'date or timestamp');
  const options = admitOptionsRecord(optionsValue, ['nullable'], `${safeLabel} options`);
  const nullable = options.nullable ?? false;
  if (typeof nullable !== 'boolean') {
    fail('invalid-options', `${safeLabel} nullable option must be boolean`);
  }
  if (value === null && nullable) return null;
  if (typeof value !== 'string') fail('invalid-clock', `${safeLabel} must be an exact date or timestamp`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsedDate = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === value) {
      return value;
    }
  }
  return exactTimestamp(value, safeLabel);
}

export function nonNegativeSafeInteger(value, label, optionsValue) {
  const safeLabel = labelText(label, 'integer');
  const options = admitOptionsRecord(
    optionsValue,
    ['nullable', 'positive'],
    `${safeLabel} options`,
  );
  const nullable = options.nullable ?? false;
  const positive = options.positive ?? false;
  if (typeof nullable !== 'boolean' || typeof positive !== 'boolean') {
    fail('invalid-options', `${safeLabel} nullable and positive options must be boolean`);
  }
  if (value === null && nullable) return null;
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    fail('invalid-count', `${safeLabel} must be ${nullable ? 'null or ' : ''}a ${positive ? 'positive' : 'non-negative'} safe integer`);
  }
  return value;
}

export function assertArray(value, label, optionsValue) {
  const safeLabel = labelText(label, 'array');
  const options = admitOptionsRecord(
    optionsValue,
    ['maximum', 'minimum'],
    `${safeLabel} options`,
  );
  const maximum = admittedLimit(
    options.maximum ?? REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumArrayLength,
    `${safeLabel} maximum`,
    {
      minimum: 0,
      maximum: REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumArrayLength,
    },
  );
  const minimum = admittedLimit(options.minimum ?? 0, `${safeLabel} minimum`, {
    minimum: 0,
    maximum: REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumArrayLength,
  });
  if (minimum > maximum) {
    fail('invalid-options', `${safeLabel} minimum cannot exceed maximum`);
  }
  if (value !== null && typeof value === 'object' && utilTypes.isProxy(value)) {
    fail('proxy-object', `${safeLabel} must not be a Proxy`);
  }
  if (!ARRAY_IS_ARRAY(value)) {
    fail('array-bound', `${safeLabel} must contain ${minimum}..${maximum} items`);
  }
  const length = safeArrayLength(value, safeLabel);
  if (length < minimum || length > maximum) {
    fail('array-bound', `${safeLabel} must contain ${minimum}..${maximum} items`);
  }
  preflightData(value, safeLabel);
  return value;
}

function preflightData(value, label) {
  const state = {
    active: new WeakSet(),
    aggregateItems: 0,
    descriptors: 0,
    stringCodeUnits: 0,
  };
  inspectData(value, label, 0, state);
}

function inspectData(value, label, depth, state) {
  if (depth > REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumDepth) {
    fail('object-depth-budget', `${label} exceeds the admitted object depth budget`);
  }
  consumeAggregateItem(state, label);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    consumeStringCodeUnits(state, value, label);
    assertUnicodeScalarString(value, label);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      fail('non-finite-number', `${label} must contain only admitted finite numbers`);
    }
    return;
  }
  if (typeof value !== 'object') {
    fail('unsupported-value', `${label} contains an unsupported value`);
  }
  if (utilTypes.isProxy(value)) fail('proxy-object', `${label} must not be a Proxy`);
  if (state.active.has(value)) fail('cyclic-value', `${label} must not be cyclic`);
  state.active.add(value);
  try {
    if (ARRAY_IS_ARRAY(value)) inspectArray(value, label, depth, state);
    else inspectObject(value, label, depth, state);
  } finally {
    state.active.delete(value);
  }
}

function inspectArray(value, label, depth, state) {
  if (safePrototype(value, label) !== ARRAY_PROTOTYPE) {
    fail('object-prototype', `${label} must use the exact Array prototype`);
  }
  consumeDescriptors(state, 1, label);
  const lengthDescriptor = safeOwnDescriptor(value, 'length', label);
  const lengthMode = arrayLengthDescriptorMode(lengthDescriptor, label);
  const length = lengthDescriptor.value;
  if (length > REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumArrayLength) {
    fail('object-array-length-budget', `${label} exceeds the admitted array length budget`);
  }
  if (length > REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumAggregateItems
    - state.aggregateItems) {
    fail('object-aggregate-budget', `${label} exceeds the admitted aggregate object item budget`);
  }
  if (length > REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumDescriptors
    - state.descriptors) {
    fail('object-descriptor-budget', `${label} exceeds the admitted descriptor budget`);
  }

  const keys = safeOwnKeys(value, label);
  if (keys.length < 1) fail('invalid-array', `${label} is missing its length property`);
  consumeDescriptors(state, keys.length - 1, label);
  let sawLength = false;
  let indexCount = 0;
  for (const key of keys) {
    if (typeof key !== 'string') {
      fail('descriptor-policy-symbol', `${label} must not contain symbol properties`);
    }
    consumePropertyKey(state, key, label);
    if (key === 'length') {
      sawLength = true;
      continue;
    }
    const index = canonicalArrayIndex(key);
    if (index === null || index >= length) {
      fail('descriptor-policy-array-custom', `${label} must not contain custom array properties`);
    }
    indexCount += 1;
  }
  if (!sawLength) fail('invalid-array', `${label} is missing its length property`);
  if (indexCount !== length) {
    fail('descriptor-policy-sparse-array', `${label} must contain every dense array index`);
  }

  for (const key of keys) {
    if (key === 'length') continue;
    const descriptor = safeOwnDescriptor(value, key, `${label}[${key}]`);
    const mode = dataDescriptorMode(descriptor, `${label}[${key}]`);
    if (mode !== lengthMode) {
      fail('descriptor-policy-mixed-mode', `${label} mixes mutable and frozen array descriptors`);
    }
  }
  assertContainerMode(value, lengthMode, label);

  for (const key of keys) {
    if (key === 'length') continue;
    const descriptor = safeOwnDescriptor(value, key, `${label}[${key}]`);
    inspectData(descriptor.value, `${label}[${key}]`, depth + 1, state);
  }
}

function inspectObject(value, label, depth, state) {
  const prototype = safePrototype(value, label);
  if (prototype !== OBJECT_PROTOTYPE && prototype !== null) {
    fail('object-prototype', `${label} must be a plain data object`);
  }
  assertEnumerableObjectWidth(value, label);
  const keys = safeOwnKeys(value, label);
  if (keys.length > REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumObjectWidth) {
    fail('object-width-budget', `${label} exceeds the admitted object width budget`);
  }
  consumeDescriptors(state, keys.length, label);
  let objectMode = null;
  for (const key of keys) {
    if (typeof key !== 'string') {
      fail('descriptor-policy-symbol', `${label} must not contain symbol properties`);
    }
    consumePropertyKey(state, key, label);
    if (BLOCKED_KEYS.has(key)) {
      fail('blocked-property-key', `${label}.${key} is forbidden`);
    }
    const descriptor = safeOwnDescriptor(value, key, `${label}.${key}`);
    const mode = dataDescriptorMode(descriptor, `${label}.${key}`);
    if (objectMode !== null && objectMode !== mode) {
      fail('descriptor-policy-mixed-mode', `${label} mixes mutable and frozen data descriptors`);
    }
    objectMode = mode;
  }
  if (objectMode === null) objectMode = emptyContainerMode(value, label);
  assertContainerMode(value, objectMode, label);

  for (const key of keys) {
    const descriptor = safeOwnDescriptor(value, key, `${label}.${key}`);
    inspectData(descriptor.value, `${label}.${key}`, depth + 1, state);
  }
}

function consumeAggregateItem(state, label) {
  state.aggregateItems += 1;
  if (state.aggregateItems
    > REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumAggregateItems) {
    fail('object-aggregate-budget', `${label} exceeds the admitted aggregate object item budget`);
  }
}

function consumeDescriptors(state, count, label) {
  if (!Number.isSafeInteger(count) || count < 0
    || count > REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumDescriptors - state.descriptors) {
    fail('object-descriptor-budget', `${label} exceeds the admitted descriptor budget`);
  }
  state.descriptors += count;
}

function consumePropertyKey(state, key, label) {
  if (key.length
    > REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumPropertyKeyCodeUnits) {
    fail('object-key-budget', `${label} contains an oversized property key`);
  }
  consumeStringCodeUnits(state, key, label);
}

function consumeStringCodeUnits(state, value, label) {
  if (value.length > REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumStringCodeUnits
    || value.length > REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumStringCodeUnits
      - state.stringCodeUnits) {
    fail('object-string-budget', `${label} exceeds the admitted aggregate string budget`);
  }
  state.stringCodeUnits += value.length;
}

function cloneValidatedData(value, label, active) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || typeof value === 'number') return value;
  if (active.has(value)) fail('cyclic-value', `${label} must not be cyclic`);
  active.add(value);
  try {
    if (ARRAY_IS_ARRAY(value)) {
      const length = safeOwnDescriptor(value, 'length', label).value;
      const result = new Array(length);
      for (let index = 0; index < length; index += 1) {
        const descriptor = safeOwnDescriptor(value, String(index), `${label}[${index}]`);
        result[index] = cloneValidatedData(descriptor.value, `${label}[${index}]`, active);
      }
      return result;
    }
    const result = {};
    for (const key of safeOwnKeys(value, label)) {
      const descriptor = safeOwnDescriptor(value, key, `${label}.${key}`);
      result[key] = cloneValidatedData(descriptor.value, `${label}.${key}`, active);
    }
    return result;
  } finally {
    active.delete(value);
  }
}

function safeArrayLength(value, label) {
  const descriptor = safeOwnDescriptor(value, 'length', label);
  arrayLengthDescriptorMode(descriptor, label);
  return descriptor.value;
}

function arrayLengthDescriptorMode(descriptor, label) {
  if (!descriptor || !OBJECT_HAS_OWN(descriptor, 'value')
    || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0
    || descriptor.enumerable !== false || descriptor.configurable !== false
    || typeof descriptor.writable !== 'boolean') {
    fail('invalid-array', `${label} has an invalid length descriptor`);
  }
  return descriptor.writable ? 'mutable' : 'frozen';
}

function dataDescriptorMode(descriptor, label) {
  if (!descriptor || !OBJECT_HAS_OWN(descriptor, 'value')) {
    fail('descriptor-policy-accessor', `${label} must be a data property without accessors`);
  }
  if (descriptor.enumerable !== true) {
    fail('descriptor-policy-hidden', `${label} must be enumerable`);
  }
  if (descriptor.configurable === true && descriptor.writable === true) return 'mutable';
  if (descriptor.configurable === false && descriptor.writable === false) return 'frozen';
  fail('descriptor-policy-custom-mode', `${label} has a custom data descriptor mode`);
}

function emptyContainerMode(value, label) {
  if (safeIsFrozen(value, label)) return 'frozen';
  if (safeIsExtensible(value, label)) return 'mutable';
  fail('descriptor-policy-custom-mode', `${label} has an unsupported empty-container mode`);
}

function assertContainerMode(value, mode, label) {
  if (mode === 'mutable' && !safeIsExtensible(value, label)) {
    fail('descriptor-policy-custom-mode', `${label} mutable descriptors require an extensible container`);
  }
  if (mode === 'frozen' && !safeIsFrozen(value, label)) {
    fail('descriptor-policy-custom-mode', `${label} frozen descriptors require a frozen container`);
  }
}

function canonicalArrayIndex(key) {
  if (!/^(?:0|[1-9]\d*)$/.test(key)) return null;
  const index = Number(key);
  if (!Number.isSafeInteger(index) || index < 0 || String(index) !== key) return null;
  return index;
}

function safeOwnKeys(value, label) {
  try {
    return REFLECT_OWN_KEYS(value);
  } catch {
    fail('uninspectable-object', `${label} could not be inspected safely`);
  }
}

function safeOwnDescriptor(value, key, label) {
  try {
    const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
    if (!descriptor) fail('uninspectable-object', `${label} descriptor is unavailable`);
    return descriptor;
  } catch (error) {
    if (error instanceof RouteRealGraphAuthorityError) throw error;
    fail('uninspectable-object', `${label} could not be inspected safely`);
  }
}

function safePrototype(value, label) {
  try {
    return OBJECT_GET_PROTOTYPE_OF(value);
  } catch {
    fail('uninspectable-object', `${label} prototype could not be inspected safely`);
  }
}

function safeIsExtensible(value, label) {
  try {
    return OBJECT_IS_EXTENSIBLE(value);
  } catch {
    fail('uninspectable-object', `${label} extensibility could not be inspected safely`);
  }
}

function safeIsFrozen(value, label) {
  try {
    return OBJECT_IS_FROZEN(value);
  } catch {
    fail('uninspectable-object', `${label} frozen state could not be inspected safely`);
  }
}

function admitExpectedKeys(keysValue, label) {
  const keys = cloneData(keysValue, `${label} expected keys`);
  if (!ARRAY_IS_ARRAY(keys)
    || keys.length > REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumObjectWidth) {
    fail('schema-key-budget', `${label} expected keys must be a bounded dense array`);
  }
  const unique = new Set();
  for (const key of keys) {
    if (typeof key !== 'string' || !key || key.length > 240 || BLOCKED_KEYS.has(key)
      || unique.has(key)) {
      fail('schema-key-policy', `${label} expected keys must be unique bounded safe strings`);
    }
    unique.add(key);
  }
  return keys;
}

function admitOptionsRecord(value, allowedKeys, label) {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object') {
    fail('invalid-options', `${label} must be a plain bounded options object`);
  }
  if (utilTypes.isProxy(value)) fail('proxy-object', `${label} must not be a Proxy`);
  const prototype = safePrototype(value, label);
  if (prototype !== OBJECT_PROTOTYPE && prototype !== null) {
    fail('invalid-options', `${label} must be a plain bounded options object`);
  }
  assertEnumerableObjectWidth(value, label, allowedKeys.length);
  const keys = safeOwnKeys(value, label);
  if (keys.length > allowedKeys.length
    || keys.length > REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumObjectWidth) {
    fail('invalid-options', `${label} exceeds its exact option width`);
  }
  const allowed = new Set(allowedKeys);
  let mode = null;
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.has(key) || BLOCKED_KEYS.has(key)) {
      fail('invalid-options', `${label} contains an unsupported option`);
    }
    const descriptor = safeOwnDescriptor(value, key, `${label}.${key}`);
    const candidateMode = dataDescriptorMode(descriptor, `${label}.${key}`);
    if (mode !== null && mode !== candidateMode) {
      fail('descriptor-policy-mixed-mode', `${label} mixes mutable and frozen descriptors`);
    }
    mode = candidateMode;
  }
  if (mode === null) mode = emptyContainerMode(value, label);
  assertContainerMode(value, mode, label);
  const result = {};
  for (const key of keys) {
    result[key] = safeOwnDescriptor(value, key, `${label}.${key}`).value;
  }
  return result;
}

function assertEnumerableObjectWidth(
  value,
  label,
  maximum = REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumObjectWidth,
) {
  let count = 0;
  for (const key in value) {
    if (!OBJECT_HAS_OWN(value, key)) continue;
    count += 1;
    if (count > maximum) {
      fail('object-width-budget', `${label} exceeds the admitted enumerable width budget`);
    }
  }
}

function admittedLimit(value, label, { minimum, maximum = Number.MAX_SAFE_INTEGER }) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('invalid-budget', `${label} must be a safe integer inside the admitted bound`);
  }
  return value;
}

function labelText(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value || value.length > 500) {
    fail('invalid-label', 'validation labels must be primitive bounded text');
  }
  return value;
}

function safeRegExpTest(pattern, value, label) {
  if (!pattern || typeof pattern !== 'object' || utilTypes.isProxy(pattern)
    || !utilTypes.isRegExp(pattern) || safePrototype(pattern, `${label} pattern`) !== REGEXP_PROTOTYPE) {
    fail('invalid-options', `${label} pattern must be an exact built-in RegExp`);
  }
  const keys = safeOwnKeys(pattern, `${label} pattern`);
  if (keys.length !== 1 || keys[0] !== 'lastIndex') {
    fail('invalid-options', `${label} pattern must not contain custom properties`);
  }
  const lastIndex = safeOwnDescriptor(pattern, 'lastIndex', `${label} pattern.lastIndex`);
  if (!OBJECT_HAS_OWN(lastIndex, 'value') || lastIndex.value !== 0
    || lastIndex.enumerable !== false || lastIndex.configurable !== false
    || typeof lastIndex.writable !== 'boolean'
    || REFLECT_APPLY(REGEXP_GLOBAL_GETTER, pattern, [])
    || REFLECT_APPLY(REGEXP_STICKY_GETTER, pattern, [])) {
    fail('invalid-options', `${label} pattern must be stateless and unmodified`);
  }
  return REFLECT_APPLY(REGEXP_TEST, pattern, [value]);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  if (ARRAY_IS_ARRAY(value)) {
    for (let index = 0; index < value.length; index += 1) {
      deepFreeze(value[index], seen);
    }
  } else {
    for (const key of OBJECT_KEYS(value)) deepFreeze(value[key], seen);
  }
  return OBJECT_FREEZE(value);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || ARRAY_IS_ARRAY(value)) return false;
  const prototype = OBJECT_GET_PROTOTYPE_OF(value);
  return prototype === OBJECT_PROTOTYPE || prototype === null;
}

function canonicalize(value) {
  if (ARRAY_IS_ARRAY(value)) {
    const result = new Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      result[index] = canonicalize(value[index]);
    }
    return result;
  }
  if (!isPlainObject(value)) return value;
  const result = {};
  for (const key of OBJECT_KEYS(value).sort()) result[key] = canonicalize(value[key]);
  return result;
}

function assertUnicodeScalarString(value, label) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail('json-string', `${label} contains an unpaired surrogate`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail('json-string', `${label} contains an unpaired surrogate`);
    }
  }
}
