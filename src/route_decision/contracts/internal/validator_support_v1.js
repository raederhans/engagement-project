export const ROUTE_CONTRACT_VALIDATOR_SUPPORT_VERSION =
  'route-contract-validator-support/v1';

export function createContractValidatorSupportV1({
  errorPrefix,
  symbolPropertyMessage = 'must not contain symbol properties',
  exactObjectKeyOrder = 'input',
  exactSequenceBounds = 'max-only',
  idPattern = /^[a-z0-9](?:[a-z0-9._:-]{0,119})$/,
  maxIdLength = 120,
  blockedPropertyNames = new Set(['__proto__', 'constructor', 'prototype']),
  booleanMessage = 'must be a boolean',
} = {}) {
  if (typeof errorPrefix !== 'string' || errorPrefix.length === 0) {
    throw new TypeError('validator support v1: errorPrefix must be non-empty text');
  }
  if (!['input', 'required'].includes(exactObjectKeyOrder)) {
    throw new TypeError('validator support v1: exactObjectKeyOrder is unsupported');
  }
  if (!['max-only', 'exact'].includes(exactSequenceBounds)) {
    throw new TypeError('validator support v1: exactSequenceBounds is unsupported');
  }

  function fail(message) {
    throw new TypeError(`${errorPrefix}: ${message}`);
  }

  function inspectPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) {
      fail(`${label} must be a plain object`);
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === 'symbol')) {
      fail(`${label} ${symbolPropertyMessage}`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of ownKeys) {
      if (!Object.hasOwn(descriptors[key], 'value')) {
        fail(`${label} must contain data properties only`);
      }
    }
    return { ownKeys, descriptors };
  }

  function exactObject(value, label, requiredKeys, optionalKeys = []) {
    const { ownKeys, descriptors } = inspectPlainObject(value, label);
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    const missing = requiredKeys.filter((key) => !Object.hasOwn(descriptors, key));
    const unknown = ownKeys.filter((key) => !allowed.has(key));
    if (missing.length || unknown.length) {
      fail(`${label} schema mismatch (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`);
    }
    const outputKeys = exactObjectKeyOrder === 'required'
      ? [...requiredKeys, ...optionalKeys.filter((key) => Object.hasOwn(descriptors, key))]
      : ownKeys;
    return Object.fromEntries(outputKeys.map((key) => [key, descriptors[key].value]));
  }

  function strictArray(value, label, { min = 0, max } = {}) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      fail(`${label} must be an array`);
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === 'symbol')) {
      fail(`${label} ${symbolPropertyMessage}`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < min || (max !== undefined && length > max)) {
      fail(`${label} length is outside the supported range`);
    }
    const items = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor) fail(`${label} must not contain sparse entries`);
      if (!Object.hasOwn(descriptor, 'value')) {
        fail(`${label} must contain data properties only`);
      }
      items.push(descriptor.value);
    }
    const extra = ownKeys.filter((key) => key !== 'length'
      && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length));
    if (extra.length) fail(`${label} contains unsupported properties`);
    return items;
  }

  function exactSchemaVersion(value, expected, label) {
    if (value !== expected) fail(`${label}.schemaVersion is unsupported`);
    return value;
  }

  function boundedId(value, label) {
    if (typeof value !== 'string' || value.length > maxIdLength
      || !idPattern.test(value) || blockedPropertyNames.has(value)) {
      fail(`${label} must be a bounded canonical id`);
    }
    return value;
  }

  function exactEnum(value, allowed, label) {
    if (typeof value !== 'string' || !allowed.has(value)) fail(`${label} is unsupported`);
    return value;
  }

  function safeInteger(
    value,
    label,
    { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {},
  ) {
    if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < min || value > max) {
      fail(`${label} must be an integer between ${min} and ${max}`);
    }
    return value;
  }

  function booleanValue(value, label) {
    if (typeof value !== 'boolean') fail(`${label} ${booleanMessage}`);
    return value;
  }

  function uniqueStrings(value, label, {
    min = 0,
    max,
    validator = boundedId,
  } = {}) {
    const items = strictArray(value, label, { min, max });
    const admitted = items.map((item, index) => validator(item, `${label}[${index}]`));
    if (new Set(admitted).size !== admitted.length) fail(`${label} must be unique`);
    return admitted;
  }

  function exactSequence(value, expected, label) {
    const bounds = exactSequenceBounds === 'exact'
      ? { min: expected.length, max: expected.length }
      : { max: expected.length };
    const sequence = strictArray(value, label, bounds);
    if (sequence.length !== expected.length
      || sequence.some((item, index) => item !== expected[index])) {
      fail(`${label} must exactly preserve ${expected.join(',')}`);
    }
    return [...sequence];
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }

  return Object.freeze({
    boundedId,
    booleanValue,
    deepFreeze,
    exactEnum,
    exactObject,
    exactSchemaVersion,
    exactSequence,
    fail,
    inspectPlainObject,
    safeInteger,
    strictArray,
    uniqueStrings,
  });
}
