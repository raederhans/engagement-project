import { Buffer } from 'node:buffer';

import { fail } from '../route_graph_candidate/safe_data.mjs';
import { parseContractJsonText } from '../route_real_graph_build/bounded_json.mjs';
import { BRIDGE_JSON_INGRESS_LIMITS, OPL_INGRESS_LIMITS } from './contracts.mjs';

export function preflightPrimitiveUtf8Text(value, label) {
  if (typeof value !== 'string') {
    fail('primitive-text-required', 'text ingress must be primitive text');
  }
  if (arguments.length !== 2 || typeof label !== 'string') {
    fail('text-preflight-arguments', 'bridge text preflight accepts text and an internal label only');
  }
  return preflightFixedPrimitiveUtf8Text(value, label, BRIDGE_JSON_INGRESS_LIMITS);
}

export function preflightReviewedOplUtf8Text(value, label) {
  if (typeof value !== 'string') {
    fail('primitive-text-required', 'OPL ingress must be primitive text');
  }
  if (arguments.length !== 2 || typeof label !== 'string') {
    fail('text-preflight-arguments', 'OPL text preflight accepts text and an internal label only');
  }
  return preflightFixedPrimitiveUtf8Text(value, label, OPL_INGRESS_LIMITS);
}

function preflightFixedPrimitiveUtf8Text(value, label, limits) {
  if (value.length === 0) fail('text-empty', `${label} must not be empty`);
  const { maximumCodeUnits, maximumUtf8Bytes } = limits;
  if (value.length > maximumCodeUnits) {
    fail('text-code-unit-limit', `${label} exceeds ${maximumCodeUnits} code units`);
  }
  assertWellFormedUnicode(value, label);
  const byteCount = Buffer.byteLength(value, 'utf8');
  if (byteCount > maximumUtf8Bytes) {
    fail('text-utf8-byte-limit', `${label} exceeds ${maximumUtf8Bytes} UTF-8 bytes`);
  }
  return byteCount;
}

export function parseBridgeContractJsonText(jsonText, label) {
  if (arguments.length !== 2 || typeof label !== 'string') {
    fail('bridge-json-arguments', 'bridge JSON parsing requires primitive text and an internal label');
  }
  preflightPrimitiveUtf8Text(jsonText, label);
  return parseContractJsonText(jsonText);
}

function assertWellFormedUnicode(value, label) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        fail('text-invalid-unicode', `${label} contains an unpaired high surrogate`);
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      fail('text-invalid-unicode', `${label} contains an unpaired low surrogate`);
    }
  }
}
