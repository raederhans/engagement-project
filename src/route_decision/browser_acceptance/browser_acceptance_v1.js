import {
  ROUTE_DECISION_BROWSER_DELIVERY_VERSION,
  parseRouteDecisionBrowserDelivery,
} from '../browser_delivery/browser_delivery_v1.js';

export const ROUTE_DECISION_BROWSER_ACCEPTANCE_VERSION =
  'engagement-route-decision-browser-acceptance/v1';
export const ROUTE_DECISION_BROWSER_ATOMIC_PRESENTATION_VERSION =
  'engagement-route-decision-browser-atomic-presentation/v1';
export const ROUTE_DECISION_BROWSER_ACCEPTANCE_IDENTITY_VERSION =
  'engagement-route-decision-browser-acceptance-identity/v1';
export const ROUTE_DECISION_BROWSER_ACCEPTANCE_CANONICALIZATION =
  'route-decision-browser-acceptance-canonical-json/v1';

const DISPLAY_SCOPE = 'browser-boundary-summary/v1';
const SOURCE_PRESENTATION_RELATIONSHIP =
  'source-fact-contract-only-not-full-s4-presentation-projection';
const ATOMIC_SECTIONS = Object.freeze([
  'summary',
  'claimBoundary',
  'limitations',
]);
const DOES_NOT_PROVE = Object.freeze([
  'source-authenticity',
  'typed-recomputation',
  'performance-authority',
  'external-graph-authority',
  'product-admission',
  'actual-browser-or-ui-execution',
  'loader-worker-or-server-lifecycle',
]);

function fail(message) {
  throw new TypeError(`RouteDecisionBrowserAcceptance/v1 contract: ${message}`);
}

function clonePureData(value) {
  if (Array.isArray(value)) return value.map(clonePureData);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .map(([key, child]) => [key, clonePureData(child)]));
}

function validateAtomicSource(delivery) {
  if (delivery.schemaVersion !== ROUTE_DECISION_BROWSER_DELIVERY_VERSION) {
    fail('source delivery version must be the exact S5-B primitive contract');
  }
  const display = delivery.displayModel;
  if (display.displayCompletenessScope !== DISPLAY_SCOPE
    || display.sourcePresentationRelationship !== SOURCE_PRESENTATION_RELATIONSHIP
    || display.textCompleteForBoundarySummary !== true
    || display.mapOptional !== true
    || display.mapModel !== null) {
    fail('source display boundary is not the exact browser-boundary-summary/v1 contract');
  }
  const sectionNames = Object.keys(display.sections);
  if (sectionNames.length !== ATOMIC_SECTIONS.length
    || ATOMIC_SECTIONS.some((name) => !sectionNames.includes(name))
    || ATOMIC_SECTIONS.some((name) => !Array.isArray(display.sections[name]))) {
    fail('summary, claimBoundary, and limitations must be present as one exact atomic set');
  }
  const terminalLine = display.sections.summary.find(({ code }) => code === 'search-terminal');
  const graphObservationLine = display.sections.summary.find(
    ({ code }) => code === 'bound-graph-requested-factor-states',
  );
  if (!terminalLine || !graphObservationLine
    || !graphObservationLine.text.endsWith(
      'This is conservative graph-wide disclosure, not a terminal cause.',
    )) {
    fail('graph-wide unresolved states must remain observations, not terminal causes');
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort(compareCodeUnits)
    .map((key) => [key, canonicalize(value[key])]));
}

function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function acceptanceIdentity(value) {
  const canonical = JSON.stringify(canonicalize(value));
  const bytes = new TextEncoder().encode(canonical);
  return {
    schemaVersion: ROUTE_DECISION_BROWSER_ACCEPTANCE_IDENTITY_VERSION,
    canonicalization: ROUTE_DECISION_BROWSER_ACCEPTANCE_CANONICALIZATION,
    digestAlgorithm: 'sha256',
    canonicalUtf8Bytes: bytes.length,
    digest: `sha256:${sha256(bytes)}`,
  };
}

function sha256(bytes) {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15];
      const y = words[index - 2];
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}

function rotateRight(value, amount) {
  return (value >>> amount) | (value << (32 - amount));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Admit one exact S5-B primitive JSON document and return all presentation
 * sections as one indivisible, detached pure-data value. The two content
 * digests prove internal consistency only; neither establishes source or
 * product authority.
 */
export function acceptRouteDecisionBrowserPresentation(serializedJson) {
  const delivery = parseRouteDecisionBrowserDelivery(serializedJson);
  validateAtomicSource(delivery);
  const display = delivery.displayModel;
  const result = {
    schemaVersion: ROUTE_DECISION_BROWSER_ACCEPTANCE_VERSION,
    sourceDelivery: {
      schemaVersion: delivery.schemaVersion,
      deliveryIdentity: clonePureData(delivery.deliveryIdentity),
    },
    atomicPresentation: {
      schemaVersion: ROUTE_DECISION_BROWSER_ATOMIC_PRESENTATION_VERSION,
      sourcePresentationSchemaVersion: display.sourcePresentationSchemaVersion,
      sourcePresentationRelationship: display.sourcePresentationRelationship,
      displayCompletenessScope: display.displayCompletenessScope,
      textCompleteForBoundarySummary: true,
      mapOptional: true,
      mapModel: null,
      atomicSections: [...ATOMIC_SECTIONS],
      summary: clonePureData(display.sections.summary),
      claimBoundary: clonePureData(display.sections.claimBoundary),
      limitations: clonePureData(display.sections.limitations),
    },
    acceptanceBoundary: {
      schemaVersion: 'engagement-route-decision-browser-acceptance-boundary/v1',
      proves: [
        's5-browser-delivery-primitive-json-admitted',
        'atomic-summary-claimBoundary-limitations-projection',
        'acceptance-content-identity-match',
      ],
      doesNotProve: [...DOES_NOT_PROVE],
      sourceDeliveryDigestSemantics:
        'internal-consistency-only-not-source-authenticity-or-authority',
      graphWideUnresolvedStateSemantics: 'observation-only-not-terminal-cause',
    },
  };
  result.acceptanceIdentity = acceptanceIdentity(result);
  return deepFreeze(result);
}
