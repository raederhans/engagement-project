import { fail, freezeData } from '../route_graph_candidate/safe_data.mjs';

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const CONTRACT_LIMITS = Object.freeze({
  maxCodeUnits: 262_144,
  maxDepth: 32,
  maxItems: 8_192,
  maxArrayLength: 2_048,
  maxObjectKeys: 256,
  maxStringCodeUnits: 8_192,
});

const BOUNDARY_LIMITS = Object.freeze({
  maxCodeUnits: 4_000_000,
  maxDepth: 24,
  maxItems: 400_000,
  maxArrayLength: 200_000,
  maxObjectKeys: 256,
  maxStringCodeUnits: 1_000_000,
});

export const BOUNDARY_MAX_POLYGONS = 32;
export const BOUNDARY_MAX_RINGS = 256;
export const BOUNDARY_MAX_POINTS = 100_000;
export const BOUNDARY_MAX_POINTS_PER_RING = 50_000;

export function parseContractJsonText(jsonText) {
  return parseJsonText(jsonText, CONTRACT_LIMITS, 'contract JSON', null);
}

export function parseBoundaryGeoJsonText(jsonText) {
  return parseJsonText(
    jsonText,
    BOUNDARY_LIMITS,
    'boundary GeoJSON',
    validateBoundaryIngress,
  );
}

function parseJsonText(jsonText, limits, label, validateParsedValue) {
  if (typeof jsonText !== 'string') {
    fail('json-text-required', `${label} ingress must be a primitive JSON string`);
  }
  if (jsonText.length === 0) fail('json-empty', `${label} must not be empty`);
  if (jsonText.length > limits.maxCodeUnits) {
    fail('json-code-unit-limit', `${label} exceeds ${limits.maxCodeUnits} code units`);
  }

  const state = {
    text: jsonText,
    index: 0,
    items: 0,
    limits,
    label,
  };
  skipWhitespace(state);
  const value = parseValue(state, 0);
  skipWhitespace(state);
  if (state.index !== state.text.length) syntax(state, 'unexpected trailing data');
  if (validateParsedValue !== null) validateParsedValue(value);
  return freezeData(value, `${label} parsed value`);
}

function validateBoundaryIngress(value) {
  let feature;
  if (value?.type === 'FeatureCollection') {
    if (!Array.isArray(value.features) || value.features.length !== 1) {
      fail('boundary-feature-count', 'boundary FeatureCollection must contain exactly one feature');
    }
    [feature] = value.features;
  } else if (value?.type === 'Feature') {
    feature = value;
  } else {
    fail('boundary-feature-required', 'boundary JSON must contain a Feature or one-feature FeatureCollection');
  }
  if (!feature || feature.type !== 'Feature') {
    fail('boundary-feature-required', 'boundary JSON must contain an exact GeoJSON Feature');
  }
  const geometry = feature?.geometry;
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    fail('boundary-polygon-required', 'boundary geometry must be Polygon or MultiPolygon');
  }
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
    fail('boundary-coordinates', 'boundary geometry must contain coordinates');
  }
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (polygons.length > BOUNDARY_MAX_POLYGONS) {
    fail('boundary-polygon-limit', `boundary geometry exceeds ${BOUNDARY_MAX_POLYGONS} polygons`);
  }
  let ringCount = 0;
  let pointCount = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) {
      fail('boundary-rings', 'boundary polygon must contain at least one ring');
    }
    for (const ring of polygon) {
      ringCount += 1;
      if (ringCount > BOUNDARY_MAX_RINGS) {
        fail('boundary-ring-limit', `boundary geometry exceeds ${BOUNDARY_MAX_RINGS} rings`);
      }
      if (!Array.isArray(ring) || ring.length < 4) {
        fail('boundary-ring-size', 'boundary ring must contain at least four positions');
      }
      if (ring.length > BOUNDARY_MAX_POINTS_PER_RING) {
        fail(
          'boundary-ring-point-limit',
          `boundary ring exceeds ${BOUNDARY_MAX_POINTS_PER_RING} points`,
        );
      }
      pointCount += ring.length;
      if (pointCount > BOUNDARY_MAX_POINTS) {
        fail('boundary-point-limit', `boundary geometry exceeds ${BOUNDARY_MAX_POINTS} points`);
      }
      for (const position of ring) {
        if (
          !Array.isArray(position)
          || position.length !== 2
          || !Number.isFinite(position[0])
          || !Number.isFinite(position[1])
          || Object.is(position[0], -0)
          || Object.is(position[1], -0)
          || position[0] < -180
          || position[0] > 180
          || position[1] < -90
          || position[1] > 90
        ) {
          fail('boundary-position', 'boundary position must be a finite CRS84 longitude/latitude pair');
        }
      }
      const first = ring[0];
      const last = ring.at(-1);
      if (first[0] !== last[0] || first[1] !== last[1]) {
        fail('boundary-ring-open', 'boundary ring must be closed');
      }
    }
  }
}

function parseValue(state, depth) {
  state.items += 1;
  if (state.items > state.limits.maxItems) {
    fail('json-item-limit', `${state.label} exceeds ${state.limits.maxItems} parsed items`);
  }
  const char = state.text[state.index];
  if (char === '{') return parseObject(state, depth);
  if (char === '[') return parseArray(state, depth);
  if (char === '"') return parseString(state);
  if (char === 't') return parseLiteral(state, 'true', true);
  if (char === 'f') return parseLiteral(state, 'false', false);
  if (char === 'n') return parseLiteral(state, 'null', null);
  if (char === '-' || isDigit(char)) return parseNumber(state);
  syntax(state, 'expected a JSON value');
}

function parseObject(state, depth) {
  enterContainer(state, depth);
  state.index += 1;
  skipWhitespace(state);
  const result = Object.create(null);
  const keys = new Set();
  if (state.text[state.index] === '}') {
    state.index += 1;
    return result;
  }

  let count = 0;
  while (state.index < state.text.length) {
    if (state.text[state.index] !== '"') syntax(state, 'object key must be a JSON string');
    const key = parseString(state);
    if (BLOCKED_KEYS.has(key)) fail('json-blocked-key', `${state.label} contains blocked key ${key}`);
    if (keys.has(key)) fail('json-duplicate-key', `${state.label} contains duplicate key ${key}`);
    keys.add(key);
    count += 1;
    if (count > state.limits.maxObjectKeys) {
      fail('json-object-limit', `${state.label} object exceeds ${state.limits.maxObjectKeys} keys`);
    }
    skipWhitespace(state);
    if (state.text[state.index] !== ':') syntax(state, 'expected colon after object key');
    state.index += 1;
    skipWhitespace(state);
    result[key] = parseValue(state, depth + 1);
    skipWhitespace(state);
    const delimiter = state.text[state.index];
    if (delimiter === '}') {
      state.index += 1;
      return result;
    }
    if (delimiter !== ',') syntax(state, 'expected comma or closing object brace');
    state.index += 1;
    skipWhitespace(state);
  }
  syntax(state, 'unterminated object');
}

function parseArray(state, depth) {
  enterContainer(state, depth);
  state.index += 1;
  skipWhitespace(state);
  const result = [];
  if (state.text[state.index] === ']') {
    state.index += 1;
    return result;
  }

  while (state.index < state.text.length) {
    if (result.length >= state.limits.maxArrayLength) {
      fail('json-array-limit', `${state.label} array exceeds ${state.limits.maxArrayLength} items`);
    }
    result.push(parseValue(state, depth + 1));
    skipWhitespace(state);
    const delimiter = state.text[state.index];
    if (delimiter === ']') {
      state.index += 1;
      return result;
    }
    if (delimiter !== ',') syntax(state, 'expected comma or closing array bracket');
    state.index += 1;
    skipWhitespace(state);
  }
  syntax(state, 'unterminated array');
}

function parseString(state) {
  const start = state.index;
  state.index += 1;
  while (state.index < state.text.length) {
    const code = state.text.charCodeAt(state.index);
    if (code === 0x22) {
      state.index += 1;
      let value;
      try {
        value = JSON.parse(state.text.slice(start, state.index));
      } catch {
        syntax(state, 'invalid JSON string');
      }
      if (value.length > state.limits.maxStringCodeUnits) {
        fail(
          'json-string-limit',
          `${state.label} string exceeds ${state.limits.maxStringCodeUnits} code units`,
        );
      }
      return value;
    }
    if (code < 0x20) syntax(state, 'unescaped control character in string');
    if (code === 0x5c) {
      state.index += 1;
      const escape = state.text[state.index];
      if ('"\\/bfnrt'.includes(escape)) {
        state.index += 1;
        continue;
      }
      if (escape === 'u') {
        const hex = state.text.slice(state.index + 1, state.index + 5);
        if (!/^[a-fA-F0-9]{4}$/.test(hex)) syntax(state, 'invalid unicode escape');
        state.index += 5;
        continue;
      }
      syntax(state, 'invalid string escape');
    }
    state.index += 1;
  }
  syntax(state, 'unterminated string');
}

function parseNumber(state) {
  const start = state.index;
  if (state.text[state.index] === '-') state.index += 1;
  if (state.text[state.index] === '0') {
    state.index += 1;
    if (isDigit(state.text[state.index])) syntax(state, 'number contains a leading zero');
  } else {
    if (!isNonZeroDigit(state.text[state.index])) syntax(state, 'invalid number integer part');
    while (isDigit(state.text[state.index])) state.index += 1;
  }
  if (state.text[state.index] === '.') {
    state.index += 1;
    if (!isDigit(state.text[state.index])) syntax(state, 'number fraction requires a digit');
    while (isDigit(state.text[state.index])) state.index += 1;
  }
  if (state.text[state.index] === 'e' || state.text[state.index] === 'E') {
    state.index += 1;
    if (state.text[state.index] === '+' || state.text[state.index] === '-') state.index += 1;
    if (!isDigit(state.text[state.index])) syntax(state, 'number exponent requires a digit');
    while (isDigit(state.text[state.index])) state.index += 1;
  }
  const value = Number(state.text.slice(start, state.index));
  if (!Number.isFinite(value)) fail('json-number-range', `${state.label} number is not finite`);
  if (Object.is(value, -0)) fail('json-negative-zero', `${state.label} must not contain negative zero`);
  return value;
}

function parseLiteral(state, token, value) {
  if (state.text.slice(state.index, state.index + token.length) !== token) {
    syntax(state, `invalid ${token} literal`);
  }
  state.index += token.length;
  return value;
}

function enterContainer(state, depth) {
  if (depth >= state.limits.maxDepth) {
    fail('json-depth-limit', `${state.label} exceeds depth ${state.limits.maxDepth}`);
  }
}

function skipWhitespace(state) {
  while (' \t\r\n'.includes(state.text[state.index])) state.index += 1;
}

function syntax(state, message) {
  fail('json-syntax', `${state.label} ${message} at code unit ${state.index}`);
}

function isDigit(value) {
  return value >= '0' && value <= '9';
}

function isNonZeroDigit(value) {
  return value >= '1' && value <= '9';
}
