const REGISTRY_SCHEMA = 'engagement-home-compare-source-registry/v1';
const TRUSTED_SOURCE_IDENTITY = 'c95e8dda11090c12f209d83000ff3d0d02b1dba4a52d23fbb1205a62157fa270';

export function validateHomeCompareSourceRegistry(value) {
  exactObject(value, ['schema', 'verified_at', 'publisher', 'terms', 'privacy', 'sources', 'routing'], 'registry');
  if (value.schema !== REGISTRY_SCHEMA || !Array.isArray(value.sources) || value.sources.length !== 9) {
    throw new TypeError('Home Compare source registry is invalid.');
  }
  boundedText(value.publisher, 160, 'publisher');
  iso(value.verified_at, 'verified_at');
  exactObject(value.terms, ['label', 'url', 'limitation'], 'terms');
  boundedText(value.terms.label, 160, 'terms.label');
  httpsUrl(value.terms.url, 'terms.url');
  boundedText(value.terms.limitation, 800, 'terms.limitation');
  exactObject(value.privacy, ['runtime_only_fields', 'forbidden_tracked_or_shareable_fields'], 'privacy');
  stringArray(value.privacy.runtime_only_fields, 'privacy.runtime_only_fields', 20);
  stringArray(value.privacy.forbidden_tracked_or_shareable_fields, 'privacy.forbidden_tracked_or_shareable_fields', 20);

  for (const [index, source] of value.sources.entries()) {
    exactObject(source, [
      'id', 'role', 'provider', 'canonical_url', 'transport', 'dataset',
      'expected_fields', 'selected_fields', 'revision_policy', 'coverage',
      'update_cadence', 'accuracy_limitations',
      ...(['carto-sql', 'arcgis-feature-service'].includes(source?.transport) ? ['api_url'] : []),
    ], `sources[${index}]`);
    for (const field of ['role', 'provider', 'dataset', 'revision_policy', 'coverage', 'update_cadence']) {
      boundedText(source[field], 800, 'source field');
    }
    stringArray(source.accuracy_limitations, 'source limits', 20);
  }
  const identity = value.sources.map((source) => [
    source.id,
    source.canonical_url,
    source.api_url || '',
    source.transport,
    source.dataset,
    source.expected_fields,
    source.selected_fields,
  ]);
  if (sha256Hex(new TextEncoder().encode(JSON.stringify(identity))) !== TRUSTED_SOURCE_IDENTITY) {
    throw new TypeError('Source identity is invalid.');
  }

  exactObject(value.routing, ['status', 'road', 'transit', 'forbidden_substitutes'], 'routing');
  for (const mode of ['road', 'transit']) {
    exactObject(value.routing[mode], ['status', 'reason'], `routing.${mode}`);
    boundedText(value.routing[mode].reason, 800, 'routing reason');
  }
  stringArray(value.routing.forbidden_substitutes, 'routing.forbidden_substitutes', 20);
  if (value.routing.status !== 'unavailable'
    || value.routing.road.status !== 'unavailable'
    || value.routing.transit.status !== 'unavailable') {
    throw new TypeError('Home Compare routing must remain unavailable.');
  }
  return structuredClone(value);
}

export function combineHomeCompareSources(registry, profileResults, observedAt = new Date().toISOString()) {
  const admitted = validateHomeCompareSourceRegistry(registry);
  if (!Array.isArray(profileResults) || !profileResults.length) {
    throw new TypeError('Home Compare source observations require profiles.');
  }
  const allStates = profileResults.flatMap((result) => Object.values(result.sourceStates || {}));
  return admitted.sources.map((source) => {
    const sourceId = source.id;
    const available = allStates.filter((state) => state.sourceId === sourceId && state.status !== 'unavailable');
    const counts = available.map((state) => state.recordCount);
    return {
      sourceId,
      // A bounded profile query cannot promote a mutable public source to current.
      status: available.length ? 'partial' : 'unavailable',
      officialUrl: source.canonical_url,
      sourceAsOf: latestDate(...available.map((state) => state.dataAsOf)),
      retrievedAt: latestDate(...available.map((state) => state.retrievedAt)),
      builtAt: null,
      observedAt,
      revision: { status: 'unavailable', identity: null },
      coverage: source.coverage,
      precision: source.revision_policy,
      recordCount: counts.length && counts.every((count) => Number.isSafeInteger(count) && count >= 0)
        ? counts.reduce((sum, count) => sum + count, 0) : null,
      limitations: [...source.accuracy_limitations],
    };
  });
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} fields are invalid.`);
  }
}

function stringArray(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum
    || value.some((item) => typeof item !== 'string' || !item || item.length > 800)) {
    throw new TypeError(`${label} is invalid.`);
  }
}

function boundedText(value, maximum, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f]/.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
}

function httpsUrl(value, label) {
  try {
    if (new URL(value).protocol !== 'https:') throw new Error();
  } catch {
    throw new TypeError(`${label} must be an HTTPS URL.`);
  }
}

function iso(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new TypeError(`${label} must be an ISO date.`);
}

function latestDate(...values) {
  const timestamps = values.filter(Boolean).map((value) => Date.parse(value)).filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function sha256Hex(bytes) {
  const maxWord = 2 ** 32;
  const initialState = [];
  const constants = [];
  for (let candidate = 2; constants.length < 64; candidate += 1) {
    let divisor = 2;
    while (candidate % divisor) divisor += 1;
    if (candidate !== divisor) continue;
    if (initialState.length < 8) initialState.push((Math.sqrt(candidate) * maxWord) >>> 0);
    constants.push((Math.cbrt(candidate) * maxWord) >>> 0);
  }
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / maxWord), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15];
      const y = words[index - 2];
      words[index] = (words[index - 16]
        + (rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3))
        + words[index - 7]
        + (rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = initialState;
    for (let index = 0; index < 64; index += 1) {
      const temp1 = (h
        + (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25))
        + ((e & f) ^ (~e & g)) + constants[index] + words[index]) >>> 0;
      const temp2 = ((rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22))
        + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    const compressed = [a, b, c, d, e, f, g, h];
    for (let index = 0; index < 8; index += 1) {
      initialState[index] = (initialState[index] + compressed[index]) >>> 0;
    }
  }
  return initialState.map((word) => word.toString(16).padStart(8, '0')).join('');
}

function rotateRight(value, amount) {
  return (value >>> amount) | (value << (32 - amount));
}
