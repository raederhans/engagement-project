import { escapeHtml } from './view.js';

export const HOME_COMPARE_CITYWIDE_READINESS_SCHEMA =
  'engagement-home-compare-citywide-readiness/v1';

const SHA = /^sha256:[a-f0-9]{64}$/;
const CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const AUTHORITY = Object.freeze({
  product_authority: false,
  publication_authority: false,
  redistribution_authority: false,
  safety_authority: false,
  routing_authority: false,
});
const PRIVACY = Object.freeze({
  aggregate_only: true,
  address_included: false,
  coordinates_included: false,
  source_rows_included: false,
});
const SOURCE_IDS = Object.freeze([
  'citygeo-address-locator',
  'opa-current-property',
  'opa-assessment-history',
  'real-estate-transfers',
  'philly311-requests',
  'li-property-history',
  'vacant-property-indicators',
  'philadelphia-reported-crime',
  'vision-zero-hin-2025',
]);
const DIMENSIONS = Object.freeze([
  'geocoder_address_resolution',
  'property_current_assessment',
  'assessment_history',
  'transfers',
  'requests_311',
  'li_property_history',
  'vacancy',
  'reported_incidents',
  'hin_road_context',
]);
const OFFICIAL_URLS = Object.freeze([
  'https://citygeo-geocoder-pub.databridge.phila.gov/arcgis/rest/services/Geocoders/Address_Locator/GeocodeServer',
  'https://data.phila.gov/visualizations/property-assessments/',
  'https://opendataphilly.org/datasets/philadelphia-properties-and-assessment-history/',
  'https://data.phila.gov/visualizations/real-estate-transfers/',
  'https://data.phila.gov/visualizations/311-requests/',
  'https://opendataphilly.org/datasets/licenses-and-inspections-property-history/',
  'https://opendataphilly.org/datasets/vacant-property-indicators/',
  'https://data.phila.gov/visualizations/crime-incidents/',
  'https://opendataphilly.org/datasets/vision-zero-high-injury-network/',
]);
const READINESS_LIMITATIONS = Object.freeze([
  'Local non-authoritative candidate only; this is not address-level evidence.',
  'No private address, coordinate, parcel, source row, or event identifier is included.',
  'No result authorizes product publication, redistribution, safety, routing, travel-time, isochrone, scoring, ranking, or recommendation.',
]);
const SOURCE_LIMITATIONS = Object.freeze([
  Object.freeze(['City geocoder readiness does not admit a citywide address payload or address-level join.']),
  Object.freeze(['OPA current-property readiness does not admit a complete immutable parcel payload or private address-level join.']),
  Object.freeze(['Assessment-history readiness is bounded metadata only; no complete immutable parcel history or private join is admitted.']),
  Object.freeze(['Transfer readiness does not admit a complete immutable transaction payload or private address-level join.']),
  Object.freeze(['311 readiness is bounded metadata only; no complete request payload or private address-level join is admitted.']),
  Object.freeze(['L&I readiness is bounded composite metadata only; no complete property-history payload or private join is admitted.']),
  Object.freeze(['Vacancy readiness is modeled likely-vacant context only; it is not field-confirmed occupancy or address-level evidence.']),
  Object.freeze(['Reported-incident readiness reuses exact M1 aggregate identity only; no event payload, address join, or current safety claim is admitted.']),
  Object.freeze(['HIN readiness is legacy historical planning context only; it is not raw crash data, current safety evidence, or routing authority.']),
]);

export async function loadHomeCompareCitywideReadiness({
  request = fetchJson,
  url = 'data/home_compare_citywide_readiness.v1.json',
  signal,
} = {}) {
  const value = await request(url, { signal, cache: 'no-store' });
  return validateHomeCompareCitywideReadiness(value);
}

export async function validateHomeCompareCitywideReadiness(value) {
  exactObject(value, [
    'schema',
    'input',
    'status',
    'sources',
    'dimensions',
    'privacy',
    'authority',
    'limitations',
    'identity',
  ], 'readiness artifact');
  exactObject(value.input, ['lifecycle', 'ledger'], 'readiness input');
  exactObject(value.input.lifecycle, [
    'schema',
    'semantic_identity',
    'sha256',
    'bytes',
  ], 'lifecycle input');
  exactObject(value.input.ledger, [
    'schema',
    'semantic_identity',
    'sha256',
    'bytes',
  ], 'ledger input');
  exactObject(value.privacy, Object.keys(PRIVACY), 'readiness privacy');
  exactObject(value.authority, Object.keys(AUTHORITY), 'readiness authority');

  if (
    value.schema !== HOME_COMPARE_CITYWIDE_READINESS_SCHEMA
    || value.input.lifecycle.schema !== 'engagement-home-compare-citywide-source-lifecycle/v1'
    || value.input.ledger.schema !== 'engagement-home-compare-citywide-join-dq/v1'
    || !['partial', 'unavailable'].includes(value.status)
    || stable(value.authority) !== stable(AUTHORITY)
    || stable(value.privacy) !== stable(PRIVACY)
    || stable(value.limitations) !== stable(READINESS_LIMITATIONS)
    || !SHA.test(value.identity || '')
    || !Array.isArray(value.sources)
    || value.sources.length !== SOURCE_IDS.length
    || !Array.isArray(value.dimensions)
    || value.dimensions.length !== DIMENSIONS.length
  ) {
    throw new Error('Readiness artifact is unsupported or violates the non-authoritative privacy boundary.');
  }

  for (const input of [value.input.lifecycle, value.input.ledger]) {
    if (
      !SHA.test(input.semantic_identity || '')
      || !SHA.test(input.sha256 || '')
      || !positiveSafeInteger(input.bytes)
    ) {
      throw new Error('Readiness input identity or bytes are invalid.');
    }
  }

  value.sources.forEach((source, index) => validateSource(source, index));
  for (const [index, dimension] of value.dimensions.entries()) {
    await validateDimension(dimension, value.sources[index], index);
  }

  const expectedStatus = value.sources.every(({ status }) => status === 'unavailable')
    ? 'unavailable'
    : 'partial';
  if (value.status !== expectedStatus) throw new Error('Readiness top status drifted.');

  const evidence = structuredClone(value);
  delete evidence.identity;
  if (value.identity !== await identityOf(evidence)) {
    throw new Error('Readiness semantic identity drifted.');
  }
  return Object.freeze(structuredClone(value));
}

export function homeCompareCitywideReadinessHtml(readiness, { locale = 'en' } = {}) {
  const zh = locale === 'zh-CN';
  const copy = zh ? {
    title: '全市来源就绪度',
    candidate: '本地、非权威候选；不是地址级证据。',
    source: '来源',
    dimension: '维度',
    clocks: '时钟',
    coverage: '覆盖 / DQ',
    why: '为何不可用或未准入',
    authority: '不授权产品、发布、再分发、安全、路由、通勤时间或等时圈。',
    missing: '本地 readiness 产物不可用；请生成并追踪 citywide lifecycle、join/DQ 与 readiness 产物。',
  } : {
    title: 'Citywide source readiness',
    candidate: 'Local non-authoritative candidate; not address-level evidence.',
    source: 'Source',
    dimension: 'Dimension',
    clocks: 'Clocks',
    coverage: 'Coverage / DQ',
    why: 'Why unavailable or not admitted',
    authority: 'Does not authorize product, publication, redistribution, safety, routing, travel time, or isochrones.',
    missing: 'Local readiness artifact is unavailable; generate and track the citywide lifecycle, join/DQ, and readiness artifact.',
  };
  if (!readiness) {
    return `<section class="home-compare__readiness" data-home-citywide-readiness data-readiness-status="unavailable"><h3>${escapeHtml(copy.title)}</h3><p>${escapeHtml(copy.missing)}</p></section>`;
  }
  const sources = readiness.sources.map((source) => `
    <article>
      <h4>${escapeHtml(source.source_id)} · ${escapeHtml(source.status)}</h4>
      <p><a href="${escapeHtml(source.official_source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(copy.source)}</a></p>
      <p><strong>${escapeHtml(copy.clocks)}:</strong> ${escapeHtml(clockText(source.clocks))}</p>
      <p><strong>${escapeHtml(copy.coverage)}:</strong> ${escapeHtml(`${source.coverage.status}; ${source.dq.status}; ${source.freshness.status}`)}</p>
      <p>${escapeHtml(source.limitations.join(' '))}</p>
    </article>`).join('');
  const dimensions = readiness.dimensions.map((dimension) => `
    <article>
      <h4>${escapeHtml(dimension.dimension)}</h4>
      <p>${escapeHtml(`${dimension.source_readiness}; join ${dimension.join_status}; admission ${dimension.admission_status}`)}</p>
      <p><strong>${escapeHtml(copy.why)}:</strong> ${escapeHtml(dimension.reason)}</p>
    </article>`).join('');
  return `<section class="home-compare__readiness" data-home-citywide-readiness data-readiness-status="${escapeHtml(readiness.status)}">
    <h3>${escapeHtml(copy.title)}</h3>
    <p><strong>${escapeHtml(copy.candidate)}</strong> ${escapeHtml(copy.authority)}</p>
    <details><summary>${escapeHtml(copy.source)} (9)</summary><div class="home-compare__readiness-list">${sources}</div></details>
    <details><summary>${escapeHtml(copy.dimension)} (9)</summary><div class="home-compare__readiness-list">${dimensions}</div></details>
  </section>`;
}

export async function readinessIdentity(value) {
  return identityOf(value);
}

function validateSource(source, index) {
  exactObject(source, [
    'source_id',
    'ordinal',
    'receipt_identity',
    'status',
    'freshness',
    'clocks',
    'coverage',
    'dq',
    'official_source_url',
    'limitations',
  ], `readiness source ${index}`);
  exactObject(source.freshness, ['status', 'max_age_days', 'age_days'], `source ${index} freshness`);
  exactObject(source.clocks, [
    'source_as_of',
    'retrieved_at',
    'built_at',
    'observed_at',
  ], `source ${index} clocks`);
  exactObject(source.coverage, [
    'scope',
    'status',
    'row_count',
    'available_zero',
    'exact_payload',
    'completeness_admitted',
  ], `source ${index} coverage`);
  exactObject(source.dq, [
    'status',
    'observed_field_count',
    'missing_fields',
    'flags',
  ], `source ${index} DQ`);

  if (
    source.source_id !== SOURCE_IDS[index]
    || source.ordinal !== index
    || !SHA.test(source.receipt_identity || '')
    || !['available', 'available-zero', 'partial', 'unavailable'].includes(source.status)
    || source.official_source_url !== OFFICIAL_URLS[index]
    || stable(source.limitations) !== stable(SOURCE_LIMITATIONS[index])
  ) {
    throw new Error('Readiness source identity or boundary is unsupported.');
  }

  const { freshness, clocks, coverage, dq } = source;
  if (
    !['current', 'stale', 'unavailable'].includes(freshness.status)
    || !Number.isSafeInteger(freshness.max_age_days)
    || freshness.max_age_days < 1
    || freshness.max_age_days > 366
    || !(freshness.age_days === null || finiteNonNegative(freshness.age_days))
    || (freshness.status === 'unavailable') !== (freshness.age_days === null)
    || !strictClock(clocks.observed_at)
    || !['source_as_of', 'retrieved_at', 'built_at'].every((key) => (
      clocks[key] === null || strictClock(clocks[key])
    ))
    || coverage.scope !== 'citywide'
    || !['complete-exact-receipt', 'exact-receipt-review-incomplete', 'bounded-metadata-only', 'unavailable'].includes(coverage.status)
    || !(coverage.row_count === null || nonNegativeSafeInteger(coverage.row_count))
    || ![coverage.available_zero, coverage.exact_payload, coverage.completeness_admitted]
      .every((item) => typeof item === 'boolean')
    || !['pass', 'partial', 'unavailable'].includes(dq.status)
    || !Number.isSafeInteger(dq.observed_field_count)
    || dq.observed_field_count < 0
    || dq.observed_field_count > 250
    || stable(dq.missing_fields) !== stable([])
    || stable(dq.flags) !== stable(dqFlags(source.status, coverage.status))
  ) {
    throw new Error('Readiness source metadata is invalid.');
  }

  if (source.status === 'unavailable') {
    if (
      coverage.status !== 'unavailable'
      || coverage.row_count !== null
      || coverage.available_zero !== false
      || coverage.exact_payload !== false
      || coverage.completeness_admitted !== false
      || dq.status !== 'unavailable'
    ) throw new Error('Unavailable readiness source changed coverage semantics.');
    return;
  }

  if (source.status === 'partial') {
    const bounded = coverage.status === 'bounded-metadata-only'
      && coverage.exact_payload === false;
    const reviewIncomplete = coverage.status === 'exact-receipt-review-incomplete'
      && coverage.exact_payload === true;
    if (
      (!bounded && !reviewIncomplete)
      || coverage.available_zero !== false
      || coverage.completeness_admitted !== false
      || dq.status !== 'partial'
    ) throw new Error('Partial readiness source changed coverage semantics.');
    return;
  }

  if (
    coverage.status !== 'complete-exact-receipt'
    || coverage.exact_payload !== true
    || coverage.completeness_admitted !== true
    || !nonNegativeSafeInteger(coverage.row_count)
    || dq.status !== 'pass'
  ) throw new Error('Available readiness source lacks exact admitted coverage.');
  if (source.status === 'available-zero') {
    if (coverage.row_count !== 0 || coverage.available_zero !== true) {
      throw new Error('Available-zero readiness source changed zero semantics.');
    }
  } else if (coverage.available_zero !== false || coverage.row_count === 0) {
    throw new Error('Available readiness source changed zero semantics.');
  }
}

function dqFlags(status, coverageStatus) {
  if (status === 'unavailable') return ['source-unavailable'];
  if (coverageStatus === 'exact-receipt-review-incomplete') {
    return ['exact-receipt-review-incomplete'];
  }
  if (coverageStatus === 'bounded-metadata-only') return ['bounded-metadata-only'];
  return ['exact-receipt-admitted'];
}

async function validateDimension(dimension, source, index) {
  exactObject(dimension, [
    'dimension',
    'ordinal',
    'required_source_receipt_identities',
    'source_readiness',
    'join_status',
    'admission_status',
    'reason',
    'row_availability',
    'value_availability',
    'total',
    'available_zero',
    'identity',
  ], `readiness dimension ${index}`);
  const evidence = structuredClone(dimension);
  delete evidence.identity;
  const expectedSourceReadiness = source.status === 'unavailable'
    ? 'unavailable'
    : source.status === 'partial'
      ? 'partial'
      : 'exact-receipt-ready';
  const expectedJoin = expectedSourceReadiness === 'unavailable'
    ? 'unavailable'
    : 'not-admitted';
  if (
    dimension.dimension !== DIMENSIONS[index]
    || dimension.ordinal !== index
    || !Array.isArray(dimension.required_source_receipt_identities)
    || dimension.required_source_receipt_identities.length !== 1
    || dimension.required_source_receipt_identities[0] !== source.receipt_identity
    || dimension.source_readiness !== expectedSourceReadiness
    || dimension.join_status !== expectedJoin
    || dimension.admission_status !== expectedJoin
    || dimension.reason !== dimensionReason(dimension.dimension, expectedSourceReadiness)
    || dimension.row_availability !== 'unavailable'
    || dimension.value_availability !== 'unavailable'
    || dimension.total !== null
    || dimension.available_zero !== false
    || !SHA.test(dimension.identity || '')
    || dimension.identity !== await identityOf(evidence)
  ) {
    throw new Error('Readiness dimension is unsupported or fail-open.');
  }
}

function exactObject(value, keys, label) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || stable(Object.keys(value).sort()) !== stable([...keys].sort())
  ) throw new Error(`${label} contains unknown or missing fields.`);
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function strictClock(value) {
  if (typeof value !== 'string' || !CLOCK.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function dimensionReason(dimension, readiness) {
  if (readiness === 'unavailable') {
    return 'Required source receipt is unavailable; no join, rows, values, or zero claim is admitted.';
  }
  if (dimension === 'hin_road_context') {
    return 'Legacy partial HIN receipt is road context only; no raw crash, current safety, private join, or routing authority is admitted.';
  }
  if (dimension === 'reported_incidents') {
    return 'Exact M1 receipt readiness is reused, but no event payload, private address join key, coverage, or parcel authority is admitted.';
  }
  return 'No exact payload, private address or parcel join authority, exact join key, coverage, or completeness is admitted.';
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Readiness request failed: ${response.status}`);
  return response.json();
}

function clockText(clocks) {
  return ['source_as_of', 'retrieved_at', 'built_at', 'observed_at']
    .map((key) => `${key}: ${clocks[key] || 'unavailable'}`)
    .join(' · ');
}

async function identityOf(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable.');
  const bytes = new TextEncoder().encode(stable(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Readiness identities reject non-finite numbers.');
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('Readiness identities reject undefined values.');
  return serialized;
}
