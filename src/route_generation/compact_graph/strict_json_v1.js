const MAX_JSON_CODE_UNITS = 5_000_000;
const MAX_DEPTH = 64;
const MAX_ITEMS = 500_000;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function fail(message) {
  throw new TypeError(`CompactGraph JSON contract: ${message}`);
}

export function strictJsonParse(text) {
  if (typeof text !== 'string') {
    fail('input must be primitive JSON text; object, Proxy, getter, and descriptor inputs are forbidden');
  }
  if (text.length === 0 || text.length > MAX_JSON_CODE_UNITS) {
    fail('JSON text length is outside the supported range');
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
          fail('JSON string escape is invalid');
        }
        assertUnicodeScalarString(result);
        return result;
      }
      if (!escaped && code < 0x20) fail('JSON strings must not contain raw control characters');
      if (escaped) escaped = false;
      else if (code === 0x5c) escaped = true;
      cursor += 1;
    }
    fail('JSON string is unterminated');
  }

  function value(depth) {
    if (depth > MAX_DEPTH) fail('JSON exceeds the supported nesting depth');
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
    const match = text.slice(cursor).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) fail(`unexpected JSON token at code-unit offset ${cursor}`);
    cursor += match[0].length;
    const number = Number(match[0]);
    if (!Number.isSafeInteger(number) || Object.is(number, -0)) {
      fail('JSON numbers must be safe integers and must not be negative zero');
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
      if (text[cursor] !== '"') fail('JSON object key must be a string');
      const key = stringValue();
      if (BLOCKED_KEYS.has(key)) fail(`JSON object key ${key} is prohibited`);
      if (keys.has(key)) fail(`duplicate JSON object key ${key} is prohibited`);
      keys.add(key);
      itemCount += 1;
      if (itemCount > MAX_ITEMS) fail('JSON contains too many items');
      whitespace();
      if (text[cursor] !== ':') fail('JSON object key must be followed by a colon');
      cursor += 1;
      result[key] = value(depth);
      whitespace();
      if (text[cursor] === '}') {
        cursor += 1;
        return result;
      }
      if (text[cursor] !== ',') fail('JSON object entries must be comma separated');
      cursor += 1;
    }
    fail('JSON object is unterminated');
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
      itemCount += 1;
      if (itemCount > MAX_ITEMS) fail('JSON contains too many items');
      result.push(value(depth));
      whitespace();
      if (text[cursor] === ']') {
        cursor += 1;
        return result;
      }
      if (text[cursor] !== ',') fail('JSON array entries must be comma separated');
      cursor += 1;
    }
    fail('JSON array is unterminated');
  }

  const result = value(0);
  whitespace();
  if (cursor !== text.length) fail('JSON text contains trailing data');
  return result;
}

function assertUnicodeScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('JSON string contains an unpaired surrogate');
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail('JSON string contains an unpaired surrogate');
    }
  }
}
