const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_JSON_CODE_UNITS = 4_000_000;
const MAX_DEPTH = 32;
const MAX_ITEMS = 100_000;
const MAX_ARRAY_ITEMS = 50_000;
const MAX_OBJECT_KEYS = 20_000;
const MAX_STRING_CODE_UNITS = 32_768;

export class M7StrictJsonError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = 'M7StrictJsonError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new M7StrictJsonError(code, message);
}

export function strictJsonParse(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_JSON_CODE_UNITS) {
    fail('json-size', 'M7 JSON text is empty or outside the supported size');
  }
  let cursor = 0;
  let itemCount = 0;

  function whitespace() {
    while (cursor < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[cursor])) cursor += 1;
  }

  function stringValue(maximum = MAX_STRING_CODE_UNITS) {
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
          fail('json-string', 'M7 JSON string escape is invalid');
        }
        if (result.length > maximum) fail('json-string-size', 'M7 JSON string is too large');
        return result;
      }
      if (!escaped && code < 0x20) fail('json-string', 'M7 JSON contains a raw control character');
      if (escaped) escaped = false;
      else if (code === 0x5c) escaped = true;
      cursor += 1;
    }
    fail('json-string', 'M7 JSON string is unterminated');
  }

  function value(depth) {
    if (depth > MAX_DEPTH) fail('json-depth', 'M7 JSON exceeds the supported depth');
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
    if (!match) fail('json-token', `unexpected M7 JSON token at offset ${cursor}`);
    cursor += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number) || Object.is(number, -0)) {
      fail('json-number', 'M7 JSON numbers must be finite and not negative zero');
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
      if (text[cursor] !== '"') fail('json-object', 'M7 JSON object key must be a string');
      const key = stringValue(128);
      if (BLOCKED_KEYS.has(key)) fail('blocked-property-key', `M7 JSON key ${key} is prohibited`);
      if (keys.has(key)) fail('duplicate-json-key', `duplicate M7 JSON key ${key} is prohibited`);
      keys.add(key);
      if (keys.size > MAX_OBJECT_KEYS) fail('json-object-size', 'M7 JSON object has too many keys');
      itemCount += 1;
      if (itemCount > MAX_ITEMS) fail('json-items', 'M7 JSON has too many items');
      whitespace();
      if (text[cursor] !== ':') fail('json-object', 'M7 JSON key must be followed by a colon');
      cursor += 1;
      result[key] = value(depth);
      whitespace();
      if (text[cursor] === '}') {
        cursor += 1;
        return result;
      }
      if (text[cursor] !== ',') fail('json-object', 'M7 JSON entries must be comma separated');
      cursor += 1;
    }
    fail('json-object', 'M7 JSON object is unterminated');
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
      if (result.length >= MAX_ARRAY_ITEMS) fail('json-array-size', 'M7 JSON array has too many items');
      itemCount += 1;
      if (itemCount > MAX_ITEMS) fail('json-items', 'M7 JSON has too many items');
      result.push(value(depth));
      whitespace();
      if (text[cursor] === ']') {
        cursor += 1;
        return result;
      }
      if (text[cursor] !== ',') fail('json-array', 'M7 JSON array entries must be comma separated');
      cursor += 1;
    }
    fail('json-array', 'M7 JSON array is unterminated');
  }

  const result = value(0);
  whitespace();
  if (cursor !== text.length) fail('json-trailing-data', 'M7 JSON contains trailing data');
  return result;
}
