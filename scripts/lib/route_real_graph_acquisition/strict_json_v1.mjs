import { fail } from './safe_data.mjs';

const MAX_JSON_CODE_UNITS = 64_000;
const MAX_DEPTH = 16;
const MAX_ITEMS = 1_000;
const MAX_ARRAY_ITEMS = 1_000;
const MAX_OBJECT_KEYS = 1_000;
const MAX_STRING_CODE_UNITS = 4_096;
const MAX_OBJECT_KEY_CODE_UNITS = 128;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function strictJsonParse(text) {
  if (typeof text !== 'string') {
    fail('json-text-required', 'input must be primitive JSON text; object, Proxy, getter, and descriptor inputs are forbidden');
  }
  if (text.length === 0 || text.length > MAX_JSON_CODE_UNITS) {
    fail('json-size', 'JSON text length is outside the supported range');
  }
  let cursor = 0;
  let itemCount = 0;

  function whitespace() {
    while (cursor < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[cursor])) cursor += 1;
  }

  function stringValue(maxCodeUnits, sizeCode, sizeLabel) {
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
          fail('json-string', 'JSON string escape is invalid');
        }
        assertUnicodeScalarString(result);
        if (result.length > maxCodeUnits) {
          fail(sizeCode, `${sizeLabel} exceeds ${maxCodeUnits} code units`);
        }
        return result;
      }
      if (!escaped && code < 0x20) fail('json-string', 'JSON strings must not contain raw control characters');
      if (escaped) escaped = false;
      else if (code === 0x5c) escaped = true;
      cursor += 1;
    }
    fail('json-string', 'JSON string is unterminated');
  }

  function value(depth) {
    if (depth > MAX_DEPTH) fail('json-depth', 'JSON exceeds the supported nesting depth');
    whitespace();
    const token = text[cursor];
    if (token === '"') return stringValue(MAX_STRING_CODE_UNITS, 'json-string-size', 'JSON string');
    if (token === '{') return objectValue(depth + 1);
    if (token === '[') return arrayValue(depth + 1);
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, cursor)) {
        cursor += literal.length;
        return result;
      }
    }
    const match = text.slice(cursor).match(/^-?(?:0|[1-9]\d*)/);
    if (!match) fail('json-token', `unexpected JSON token at code-unit offset ${cursor}`);
    cursor += match[0].length;
    const number = Number(match[0]);
    if (!Number.isSafeInteger(number) || Object.is(number, -0)) fail('json-number', 'JSON numbers must be safe integers and not negative zero');
    return number;
  }

  function objectValue(depth) {
    cursor += 1;
    whitespace();
    const result = {};
    const keys = new Set();
    let keyCount = 0;
    if (text[cursor] === '}') {
      cursor += 1;
      return result;
    }
    while (cursor < text.length) {
      whitespace();
      if (text[cursor] !== '"') fail('json-object', 'JSON object key must be a string');
      const key = stringValue(MAX_OBJECT_KEY_CODE_UNITS, 'json-key-size', 'JSON object key');
      if (BLOCKED_KEYS.has(key)) fail('blocked-property-key', `JSON object key ${key} is prohibited`);
      if (keys.has(key)) fail('duplicate-json-key', `duplicate JSON object key ${key} is prohibited`);
      keyCount += 1;
      if (keyCount > MAX_OBJECT_KEYS) fail('json-object-size', 'JSON object contains too many keys');
      keys.add(key);
      itemCount += 1;
      if (itemCount > MAX_ITEMS) fail('json-items', 'JSON contains too many items');
      whitespace();
      if (text[cursor] !== ':') fail('json-object', 'JSON object key must be followed by a colon');
      cursor += 1;
      result[key] = value(depth);
      whitespace();
      if (text[cursor] === '}') {
        cursor += 1;
        return result;
      }
      if (text[cursor] !== ',') fail('json-object', 'JSON object entries must be comma separated');
      cursor += 1;
    }
    fail('json-object', 'JSON object is unterminated');
  }

  function arrayValue(depth) {
    cursor += 1;
    whitespace();
    const result = [];
    let arrayItemCount = 0;
    if (text[cursor] === ']') {
      cursor += 1;
      return result;
    }
    while (cursor < text.length) {
      arrayItemCount += 1;
      if (arrayItemCount > MAX_ARRAY_ITEMS) fail('json-array-size', 'JSON array contains too many items');
      itemCount += 1;
      if (itemCount > MAX_ITEMS) fail('json-items', 'JSON contains too many items');
      result.push(value(depth));
      whitespace();
      if (text[cursor] === ']') {
        cursor += 1;
        return result;
      }
      if (text[cursor] !== ',') fail('json-array', 'JSON array entries must be comma separated');
      cursor += 1;
    }
    fail('json-array', 'JSON array is unterminated');
  }

  const result = value(0);
  whitespace();
  if (cursor !== text.length) fail('json-trailing-data', 'JSON text contains trailing data');
  return result;
}

function assertUnicodeScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('json-string', 'JSON string contains an unpaired surrogate');
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail('json-string', 'JSON string contains an unpaired surrogate');
    }
  }
}
