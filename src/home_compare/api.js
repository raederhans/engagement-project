import { CARTO_SQL_BASE } from '../config.js';
import { findPhiladelphiaPropertyAddressCandidates } from '../api/geocoder.js';
import { admitCoverageResponse, COVERAGE_SQL } from '../api/meta.js';
import { fetchJson, rejectPrivateLocationEgress } from '../utils/http.js';
import { buildCountBufferSQL } from '../utils/sql.js';
import { validateAreaIntelligenceServingArtifact } from '../area_intelligence/serving_contract.js';
import { admitPropertyAddressCandidates, admitPropertyParcelJoin } from './address.js';
import { createEvidenceMetric, HOME_COMPARE_EVIDENCE_KEYS, inferHomeProfileStatus } from './contract.js';

const VACANCY_URL = 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Vacant_Indicators_Bldg/FeatureServer/0/query';
const HIN_URL = 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/high_injury_network_2025/FeatureServer/0/query';
const PRIVATE_AGGREGATE = 'Aggregate only; private inputs and rows are excluded.';
const DAY_MS = 86_400_000;
const PROPERTY_DATE_FIELDS = ['assessmentDate', 'marketValueDate', 'latestSaleDate', 'recordingDate'];
const SOURCE_IDS = Object.freeze({
  address: 'citygeo-address-locator',
  property: 'opa-current-property',
  assessments: 'opa-assessment-history',
  transfers: 'real-estate-transfers',
  serviceRequests: 'philly311-requests',
  liHistory: 'li-property-history',
  vacancy: 'vacant-property-indicators',
  reportedIncidents: 'philadelphia-reported-crime',
  hinContext: 'vision-zero-hin-2025',
});

export async function resolveHomePropertyAddress(input, {
  request = fetchJson,
  signal,
  minScore = 90,
  privateAnalysisGate = rejectPrivateLocationEgress,
} = {}) {
  privateAnalysisGate();
  const candidates = await findPhiladelphiaPropertyAddressCandidates(input, {
    request: (url, options = {}) => postSensitiveArcGisQuery(url, {
      request,
      signal: options.signal ?? signal,
      timeoutMs: options.timeoutMs,
    }),
    signal,
  });
  const addressMatch = admitPropertyAddressCandidates(candidates, { minScore });
  const rows = await queryCarto(buildPropertyJoinSql(addressMatch.normalizedAddress), { request, signal });
  return admitPropertyParcelJoin(addressMatch, { rows });
}

export async function fetchHomeProfileEvidence(identity, {
  request = fetchJson,
  signal,
  now = () => new Date().toISOString(),
  incidentReader = fetchHomeCompareIncidentCount,
  coverageReader = fetchHomeCompareCoverage,
  radiusMeters = 400,
  incidentMonths = 12,
  privateAnalysisGate = rejectPrivateLocationEgress,
} = {}) {
  privateAnalysisGate();
  validatePrivateIdentity(identity);
  const retrievedAt = requiredRetrievalDate(now);
  const [assessments, transfers, serviceRequests, liHistory, vacancy, hinContext, reportedIncidents] = await Promise.allSettled([
    fetchAssessments(identity.parcelId, { request, signal, retrievedAt }),
    fetchTransfers(identity.parcelId, { request, signal, retrievedAt }),
    fetchServiceRequests(identity.lngLat, { request, signal, radiusMeters, months: 24 }),
    fetchLiHistory(identity.parcelId, { request, signal }),
    fetchVacancy(identity.parcelId, { request, signal }),
    fetchHinContext(identity.lngLat, { request, signal, radiusMeters }),
    fetchReportedIncidents(identity.lngLat, {
      signal,
      request,
      incidentReader,
      coverageReader,
      radiusMeters,
      months: incidentMonths,
    }),
  ]);

  const propertyValue = withFutureDatesWithheld(identity.property, PROPERTY_DATE_FIELDS, Date.parse(retrievedAt) + DAY_MS);
  const property = createEvidenceMetric({
    status: propertyValue.futureDatedFieldCount ? 'partial' : 'available',
    value: propertyValue,
    dataAsOf: latestDate(...PROPERTY_DATE_FIELDS.map((field) => propertyValue[field])),
    sourceIds: [SOURCE_IDS.address, SOURCE_IDS.property],
    ...metricCopy(
      'One exact normalized-address OPA parcel and consistent point.',
      `Geocoder score ${identity.score}; OPA distance ${identity.join.distanceMeters} m.`,
      'Property records are not an appraisal, inspection, or suitability conclusion.',
    ),
  });

  const evidence = {
    property,
    assessments: settlementMetric(assessments, SOURCE_IDS.assessments),
    transfers: settlementMetric(transfers, SOURCE_IDS.transfers),
    serviceRequests: settlementMetric(serviceRequests, SOURCE_IDS.serviceRequests),
    liHistory: settlementMetric(liHistory, SOURCE_IDS.liHistory),
    vacancy: settlementMetric(vacancy, SOURCE_IDS.vacancy),
    reportedIncidents: settlementMetric(reportedIncidents, SOURCE_IDS.reportedIncidents),
    hinContext: settlementMetric(hinContext, SOURCE_IDS.hinContext),
  };
  const status = inferHomeProfileStatus(evidence);
  return {
    privateLabel: identity.displayAddress,
    profile: {
      profileId: null,
      status,
      evidence,
      limitations: [
        'The public profile excludes addresses, coordinates, parcel IDs, and record IDs.',
        'A zero applies only to its source query; it does not prove absence of harm or defects.',
      ],
    },
    sourceStates: buildSourceStates(evidence, retrievedAt, {
      [SOURCE_IDS.address]: identity.candidateCount,
      [SOURCE_IDS.property]: identity.join.candidateRows,
    }),
  };
}

export async function loadHomeCompareRegistry({
  request = fetchJson,
  url = 'data/home_compare_sources.v1.json',
  signal,
} = {}) {
  const registry = await request(url, { cacheTTL: 60 * 60_000, signal });
  const { validateHomeCompareSourceRegistry } = await import('./source_registry.js');
  return validateHomeCompareSourceRegistry(registry);
}

export async function loadM2AreaIntelligenceBoundary({
  request = fetchJson,
  url = 'data/area_intelligence_baseline.v1.json',
  signal,
} = {}) {
  const artifact = validateAreaIntelligenceServingArtifact(await request(url, {
    cacheTTL: 60 * 60_000,
    signal,
  }));
  if (artifact.status !== 'not-promoted') {
    throw new TypeError('Home Compare requires the frozen M2 no-promotion boundary.');
  }
  const coverage = artifact.historical_evidence.coverage;
  return {
    status: 'not-promoted',
    historicalEvidence: {
      status: 'available',
      measure: 'PPD reported incidents',
      coverage: `${coverage.earliest_scope_start} to ${coverage.latest_scope_end_exclusive} (latest observed event ${coverage.latest_event_at})`,
      limitations: [...artifact.historical_evidence.limitations],
    },
    forecast: {
      status: 'unavailable',
      reason: 'model-did-not-exceed-predefined-seasonal-baseline',
      predictions: [],
    },
  };
}

export async function combineHomeCompareSources(registry, profileResults, observedAt) {
  const module = await import('./source_registry.js');
  return module.combineHomeCompareSources(registry, profileResults, observedAt);
}

async function fetchAssessments(parcelId, { retrievedAt, ...options }) {
  const rows = await queryCarto(`SELECT year, market_value, taxable_land, taxable_building, exempt_land, exempt_building
    FROM assessments WHERE parcel_number = ${sqlLiteral(parcelId)} ORDER BY year DESC LIMIT 20`, options);
  const records = rows.map((row) => ({
    year: boundedYear(row.year),
    marketValue: nullableNumber(row.market_value),
    taxableLand: nullableNumber(row.taxable_land),
    taxableBuilding: nullableNumber(row.taxable_building),
    exemptLand: nullableNumber(row.exempt_land),
    exemptBuilding: nullableNumber(row.exempt_building),
  }));
  const latestTaxYear = records[0]?.year ?? null;
  const futureTaxYear = latestTaxYear != null && latestTaxYear > new Date(retrievedAt).getUTCFullYear();
  return admittedMetricResult({
    status: futureTaxYear ? 'partial' : 'available',
    value: { recordCount: records.length, latestTaxYear, records },
    dataAsOf: null,
    recordCount: records.length,
    ...metricCopy(
      'Up to 20 OPA assessment records for the parcel.',
      'Exact parcel join; values retain source units.',
      futureTaxYear
      ? 'The latest tax year is ahead of retrieval; it is not used as a source as-of date.'
      : 'Tax year is not publication time; the file may lag the latest calculation.',
    ),
  });
}

async function fetchTransfers(parcelId, { retrievedAt, ...options }) {
  const rows = await queryCarto(`SELECT document_type, display_date, recording_date, document_date,
    adjusted_total_consideration, matched_regmap, discrepancy, property_count FROM rtt_summary
    WHERE opa_account_num = ${sqlLiteral(parcelId)} ORDER BY display_date DESC NULLS LAST LIMIT 12`, options);
  const maximumAdmittedDate = Date.parse(retrievedAt) + DAY_MS;
  let futureDatedFieldCount = 0;
  const admitDate = (value) => {
    const date = nullableDate(value);
    if (date && Date.parse(date) > maximumAdmittedDate) {
      futureDatedFieldCount += 1;
      return null;
    }
    return date;
  };
  const records = rows.map((row) => ({
      documentType: boundedOptionalText(row.document_type, 80),
      displayDate: admitDate(row.display_date),
      recordingDate: admitDate(row.recording_date),
      documentDate: admitDate(row.document_date),
      consideration: nullableNumber(row.adjusted_total_consideration),
      matchedRegistryMap: booleanOrNull(row.matched_regmap),
      discrepancy: boundedOptionalText(row.discrepancy, 160),
      propertyCount: nullableSafeInteger(row.property_count),
    }));
  return admittedMetricResult({
    status: futureDatedFieldCount ? 'partial' : 'available',
    value: { recordCount: records.length, futureDatedFieldCount, records },
    dataAsOf: latestDate(...records.map((row) => row.recordingDate)),
    recordCount: records.length,
    ...metricCopy(
      'Up to 12 transfer-tax summaries for the OPA account.',
      'Exact OPA join; party/document IDs and future dates are withheld.',
      'Consideration is not an appraisal, recommendation, or proof of ownership.',
      ...(futureDatedFieldCount
        ? [`${futureDatedFieldCount} future dates were withheld; the source remains partial.`]
        : []),
    ),
  });
}

async function fetchServiceRequests(lngLat, { request, signal, radiusMeters, months }) {
  const [longitude, latitude] = admittedPoint(lngLat);
  const rows = await queryCarto(`SELECT COUNT(*)::int AS record_count,
    COUNT(*) FILTER (WHERE lower(coalesce(status, '')) NOT IN ('closed', 'completed'))::int AS open_count,
    MIN(requested_datetime) AS earliest_at, MAX(updated_datetime) AS latest_at FROM public_cases_fc
    WHERE requested_datetime >= (CURRENT_DATE - INTERVAL '${admittedInteger(months, 1, 120)} months')
    AND ST_DWithin(the_geom::geography, ST_SetSRID(ST_Point(${longitude}, ${latitude}), 4326)::geography,
    ${admittedInteger(radiusMeters, 100, 2000)})`, { request, signal });
  const row = singleRow(rows);
  const recordCount = admittedCount(row.record_count);
  return admittedMetricResult({
    value: { recordCount, openCount: admittedCount(row.open_count) },
    dataAsOf: nullableDate(row.latest_at),
    recordCount,
    ...metricCopy(
      `${months}-month 311 window within ${radiusMeters} m of the ephemeral point.`,
      PRIVATE_AGGREGATE,
      'A request does not prove a condition existed, persisted, or was resolved.',
    ),
  });
}

async function fetchLiHistory(parcelId, options) {
  const [violations, licenses, investigations] = await Promise.all([
    queryCarto(`SELECT COUNT(*)::int AS record_count,
      COUNT(*) FILTER (WHERE lower(coalesce(violationstatus, '')) NOT IN ('closed', 'resolved', 'complied'))::int AS not_closed_count,
      MAX(violationdate) AS latest_at FROM violations WHERE opa_account_num = ${sqlLiteral(parcelId)}`, options),
    queryCarto(`SELECT COUNT(*)::int AS record_count,
      COUNT(*) FILTER (WHERE lower(coalesce(licensestatus, '')) = 'active')::int AS active_count,
      MAX(mostrecentissuedate) FILTER (WHERE mostrecentissuedate <= CURRENT_TIMESTAMP + INTERVAL '1 day') AS latest_at
      FROM business_licenses WHERE opa_account_num = ${sqlLiteral(parcelId)}`, options),
    queryCarto(`SELECT COUNT(*)::int AS record_count,
      COUNT(*) FILTER (WHERE lower(coalesce(investigationstatus, '')) NOT IN ('closed', 'completed'))::int AS not_closed_count,
      MAX(investigationcompleted) FILTER (WHERE investigationcompleted <= CURRENT_TIMESTAMP + INTERVAL '1 day') AS latest_at
      FROM case_investigations WHERE opa_account_num = ${sqlLiteral(parcelId)}`, options),
  ]);
  const violation = singleRow(violations);
  const license = singleRow(licenses);
  const investigation = singleRow(investigations);
  const counts = {
    violations: admittedCount(violation.record_count),
    violationsNotClosedByConfiguredStatuses: admittedCount(violation.not_closed_count),
    licenses: admittedCount(license.record_count),
    activeLicenses: admittedCount(license.active_count),
    investigations: admittedCount(investigation.record_count),
    investigationsNotClosedByConfiguredStatuses: admittedCount(investigation.not_closed_count),
  };
  const recordCount = counts.violations + counts.licenses + counts.investigations;
  return admittedMetricResult({
    value: counts,
    dataAsOf: latestDate(violation.latest_at, license.latest_at, investigation.latest_at),
    recordCount,
    ...metricCopy(
      'L&I violations, licenses, and investigations for the OPA account.',
      'Exact aggregate; not-closed counts use configured, not official, status rules.',
      'Administrative status does not prove property condition; unknowns are not zero.',
    ),
  });
}

async function fetchVacancy(parcelId, { request, signal }) {
  const params = new URLSearchParams({
    f: 'json',
    where: `opa_id='${String(parcelId).replaceAll("'", "''")}'`,
    outFields: 'build_rank,date_update',
    returnGeometry: 'false',
    resultRecordCount: '3',
  });
  const payload = await postSensitiveArcGisQuery(VACANCY_URL, { request, signal, params });
  if (!payload || !Array.isArray(payload.features) || payload.error) throw new TypeError('Vacancy response is malformed.');
  if (payload.features.length > 1) throw new TypeError('Vacancy parcel join is ambiguous.');
  const attributes = payload.features[0]?.attributes || null;
  const recordCount = attributes ? 1 : 0;
  const rank = attributes ? nullableNumber(attributes.build_rank) : null;
  if (attributes && (rank == null || rank < 0 || rank > 100)) throw new TypeError('Vacancy rank is invalid.');
  return admittedMetricResult({
    value: attributes
      ? { listingStatus: 'listed-as-likely-vacant', modelRankPercent: rank }
      : { listingStatus: 'not-listed-by-source-model', modelRankPercent: null },
    dataAsOf: attributes ? nullableDate(attributes.date_update) : null,
    recordCount,
    ...metricCopy(
      'Current Vacant Property Indicators layer for the OPA ID.',
      'Exact query; no match means model non-listing, not confirmed occupancy.',
      'The likely-vacancy model uses administrative data, not field confirmation.',
    ),
  });
}

async function fetchHinContext(lngLat, { request, signal, radiusMeters }) {
  const [longitude, latitude] = admittedPoint(lngLat);
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    geometry: `${longitude},${latitude}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    distance: String(admittedInteger(radiusMeters, 100, 2000)),
    units: 'esriSRUnit_Meter',
    returnCountOnly: 'true',
  });
  const payload = await postSensitiveArcGisQuery(HIN_URL, { request, signal, params });
  const count = admittedCount(payload?.count);
  return admittedMetricResult({
    value: { nearbyNetworkFeatureCount: count },
    dataAsOf: null,
    recordCount: count,
    ...metricCopy(
      `2025 HIN streets within ${radiusMeters} m of the ephemeral point.`,
      PRIVATE_AGGREGATE,
      'HIN is crash-derived road context, not address risk, probability, or a ranking.',
    ),
  });
}

async function fetchReportedIncidents(lngLat, {
  signal,
  request,
  incidentReader,
  coverageReader,
  radiusMeters,
  months,
}) {
  const coverage = await coverageReader({ request, signal });
  const maximum = new Date(`${coverage.max}T00:00:00.000Z`);
  if (Number.isNaN(maximum.getTime())) throw new TypeError('Crime coverage is invalid.');
  const end = new Date(maximum.getTime() + DAY_MS);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - admittedInteger(months, 1, 24));
  const count = await incidentReader({
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    types: [],
    center3857: toWebMercator(lngLat),
    radiusM: radiusMeters,
    request,
    signal,
  });
  const admitted = admittedCount(count);
  return admittedMetricResult({
    value: { recordCount: admitted },
    dataAsOf: maximum.toISOString(),
    recordCount: admitted,
    ...metricCopy(
      `${months}-month PPD window within ${radiusMeters} m; source ${coverage.min} to ${coverage.max}.`,
      PRIVATE_AGGREGATE,
      'Incidents are incomplete history, not individual risk, absolute safety, or a forecast.',
    ),
  });
}

function buildPropertyJoinSql(normalizedAddress) {
  return `SELECT parcel_number, location, ST_X(the_geom) AS lon, ST_Y(the_geom) AS lat,
    assessment_date, market_value, market_value_date, sale_date, sale_price, recording_date,
    total_livable_area, number_of_bedrooms, number_of_bathrooms, year_built, zoning
    FROM opa_properties_public WHERE upper(location) = upper(${sqlLiteral(normalizedAddress)}) LIMIT 6`;
}

async function postSensitiveArcGisQuery(url, {
  request = fetchJson,
  signal,
  params,
  timeoutMs = 15_000,
} = {}) {
  const endpoint = new URL(url);
  const body = new URLSearchParams(endpoint.searchParams);
  endpoint.search = '';
  if (params) {
    for (const [key, value] of params) body.set(key, value);
  }
  return postForm(request, endpoint.toString(), body, { signal, timeoutMs });
}

async function fetchHomeCompareIncidentCount({
  start,
  end,
  types,
  center3857,
  radiusM,
  request = fetchJson,
  signal,
}) {
  const rows = await queryCarto(buildCountBufferSQL({ start, end, types, center3857, radiusM }), {
    request,
    signal,
  });
  return admittedCount(singleRow(rows).n);
}

async function fetchHomeCompareCoverage({
  request = fetchJson,
  signal,
} = {}) {
  return admitCoverageResponse({
    rows: await queryCarto(COVERAGE_SQL, { request, signal }),
  });
}

async function queryCarto(sql, { request = fetchJson, signal } = {}) {
  const payload = await postForm(request, CARTO_SQL_BASE, new URLSearchParams({ q: sql }), { signal });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.rows)) {
    invalid('City data response');
  }
  return payload.rows;
}

function postForm(request, url, body, { signal, timeoutMs } = {}) {
  return request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cacheTTL: 0,
    retries: 0,
    timeoutMs,
    signal,
  });
}

function settlementMetric(settlement, sourceId) {
  if (settlement.status === 'fulfilled') {
    const result = settlement.value;
    return createEvidenceMetric({
      ...result,
      sourceIds: [sourceId],
    });
  }
  return createEvidenceMetric({
    status: 'unavailable',
    value: null,
    dataAsOf: null,
    sourceIds: [sourceId],
    ...metricCopy(
      'The source query produced no admitted result.',
      'Unavailable is not zero; no fallback was used.',
      `Source query failed closed (${boundedReason(settlement.reason)}).`,
    ),
  });
}

function buildSourceStates(evidence, retrievedAt, knownCounts) {
  return Object.fromEntries(HOME_COMPARE_EVIDENCE_KEYS.flatMap((key) => {
    const metric = evidence[key];
    const unavailable = metric.status === 'unavailable';
    return metric.sourceIds.map((sourceId) => [sourceId, {
      sourceId,
      status: unavailable ? 'unavailable' : 'partial',
      recordCount: unavailable ? null : knownCounts[sourceId] ?? metricRecordCount(metric.value),
      dataAsOf: sourceId === SOURCE_IDS.address ? null : metric.dataAsOf,
      retrievedAt: unavailable ? null : retrievedAt,
    }]);
  }));
}

function admittedMetricResult({ status = 'available', value, dataAsOf, recordCount, coverage, precision, limitations }) {
  if (!Number.isSafeInteger(recordCount) || recordCount < 0) invalid('Source record count');
  if (!['available', 'partial'].includes(status)) invalid('Source metric status');
  return { status, value, dataAsOf: nullableDate(dataAsOf), recordCount, coverage, precision, limitations };
}

function validatePrivateIdentity(identity) {
  if (!identity || typeof identity !== 'object' || !/^\d{6,16}$/.test(identity.parcelId || '')
    || !Array.isArray(identity.lngLat) || identity.lngLat.length !== 2
    || !identity.lngLat.every(Number.isFinite) || !identity.property || !identity.join) {
    throw new TypeError('A validated private Home Compare identity is required.');
  }
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function singleRow(rows) {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') {
    invalid('Source response');
  }
  return rows[0];
}

function admittedCount(value) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < 0) invalid('Source count');
  return number;
}

function admittedInteger(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) invalid('Bounded integer');
  return number;
}

function admittedPoint(value) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) invalid('Point');
  const [longitude, latitude] = value;
  if (longitude < -75.35 || longitude > -74.9 || latitude < 39.8 || latitude > 40.2) throw new TypeError('Point is outside Philadelphia.');
  return [longitude, latitude];
}

function boundedYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1800 || year > 2200) invalid('Assessment year');
  return year;
}

function nullableNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) invalid('Numeric source value');
  return number;
}

function nullableSafeInteger(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) invalid('Integer source value');
  return number;
}

function booleanOrNull(value) {
  if (value == null || value === '') return null;
  if (value === true || value === false) return value;
  if (value === 'true' || value === 't' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 'f' || value === 0 || value === '0') return false;
  invalid('Boolean source value');
}

function boundedOptionalText(value, maximum) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f]/.test(value)) invalid('Text source value');
  return value.trim() || null;
}

function nullableDate(value) {
  if (value == null || value === '') return null;
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  if (Number.isNaN(timestamp)) invalid('Source date');
  return new Date(timestamp).toISOString();
}

function metricCopy(coverage, precision, ...limitations) {
  return { coverage, precision, limitations };
}

function withFutureDatesWithheld(value, fields, maximumTimestamp) {
  const admitted = { ...value, futureDatedFieldCount: 0 };
  for (const field of fields) {
    if (admitted[field] && Date.parse(admitted[field]) > maximumTimestamp) {
      admitted[field] = null;
      admitted.futureDatedFieldCount += 1;
    }
  }
  return admitted;
}

function requiredRetrievalDate(now) {
  try {
    const date = nullableDate(now());
    if (date) return date;
  } catch {
    // Normalize invalid clocks to the same fail-closed contract.
  }
  throw new TypeError('A Home Compare retrieval clock is required.');
}

function invalid(label) {
  throw new TypeError(`${label} is invalid.`);
}

function latestDate(...values) {
  const timestamps = values.filter(Boolean).map((value) => Date.parse(value)).filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function metricRecordCount(value) {
  const candidates = [
    value?.recordCount,
    value?.violations != null && value?.licenses != null && value?.investigations != null
      ? value.violations + value.licenses + value.investigations : null,
    value?.nearbyNetworkFeatureCount,
  ].filter((candidate) => Number.isSafeInteger(candidate) && candidate >= 0);
  return candidates[0] ?? null;
}

function boundedReason(error) {
  const code = String(error?.code || error?.name || 'unavailable').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
  return code || 'unavailable';
}

function toWebMercator(lngLat) {
  const [longitude, latitude] = admittedPoint(lngLat);
  const radius = 6_378_137;
  return [
    radius * longitude * Math.PI / 180,
    radius * Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI / 180) / 2)),
  ];
}
