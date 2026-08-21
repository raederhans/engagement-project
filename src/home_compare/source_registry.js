const REGISTRY_SCHEMA = 'engagement-home-compare-source-registry/v1';
const TRANSPORTS = ['arcgis-geocode-server', 'carto-sql', 'arcgis-feature-service'];
const EXPECTED_SOURCE_IDS = [
  'citygeo-address-locator',
  'opa-current-property',
  'opa-assessment-history',
  'real-estate-transfers',
  'philly311-requests',
  'li-property-history',
  'vacant-property-indicators',
  'philadelphia-reported-crime',
  'vision-zero-hin-2025',
];

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

  const ids = new Set();
  for (const [index, source] of value.sources.entries()) {
    exactObject(source, [
      'id', 'role', 'provider', 'canonical_url', 'transport', 'dataset',
      'expected_fields', 'selected_fields', 'revision_policy', 'coverage',
      'update_cadence', 'accuracy_limitations',
      ...(['carto-sql', 'arcgis-feature-service'].includes(source?.transport) ? ['api_url'] : []),
    ], `sources[${index}]`);
    boundedText(source.id, 80, `sources[${index}].id`);
    if (ids.has(source.id)) throw new TypeError(`Duplicate Home Compare source ${source.id}.`);
    ids.add(source.id);
    for (const field of ['role', 'provider', 'dataset', 'revision_policy', 'coverage', 'update_cadence']) {
      boundedText(source[field], 800, `sources[${index}].${field}`);
    }
    if (!TRANSPORTS.includes(source.transport)) throw new TypeError(`Unsupported Home Compare transport ${source.transport}.`);
    httpsUrl(source.canonical_url, `sources[${index}].canonical_url`);
    if (source.api_url) httpsUrl(source.api_url, `sources[${index}].api_url`);
    stringArray(source.expected_fields, `sources[${index}].expected_fields`, 100);
    stringArray(source.selected_fields, `sources[${index}].selected_fields`, 50);
    if (source.selected_fields.some((field) => !source.expected_fields.includes(field))) {
      throw new TypeError(`Home Compare selected fields exceed the expected schema for ${source.id}.`);
    }
    stringArray(source.accuracy_limitations, `sources[${index}].accuracy_limitations`, 20);
  }
  if ([...ids].sort().some((id, index) => id !== [...EXPECTED_SOURCE_IDS].sort()[index])) {
    throw new TypeError('Home Compare source identities are invalid.');
  }

  exactObject(value.routing, ['status', 'road', 'transit', 'forbidden_substitutes'], 'routing');
  for (const mode of ['road', 'transit']) {
    exactObject(value.routing[mode], ['status', 'reason'], `routing.${mode}`);
    boundedText(value.routing[mode].reason, 800, `routing.${mode}.reason`);
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
  const staticById = new Map(admitted.sources.map((source) => [source.id, source]));
  const allStates = profileResults.flatMap((result) => Object.values(result.sourceStates || {}));
  return EXPECTED_SOURCE_IDS.map((sourceId) => {
    const source = staticById.get(sourceId);
    const states = allStates.filter((state) => state.sourceId === sourceId);
    const available = states.filter((state) => state.status !== 'unavailable');
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
