import { CARTO_SQL_BASE } from '../config.js';
import { findPhiladelphiaPropertyAddressCandidates } from '../api/geocoder.js';
import { admitCoverageResponse, COVERAGE_SQL } from '../api/meta.js';
import { fetchJson } from '../utils/http.js';
import { buildCountBufferSQL } from '../utils/sql.js';
import { validateAreaIntelligenceServingArtifact } from '../area_intelligence/serving_contract.js';
import { admitPropertyAddressCandidates, admitPropertyParcelJoin } from './address.js';
import { createEvidenceMetric, HOME_COMPARE_EVIDENCE_KEYS, inferHomeProfileStatus } from './contract.js';

const VACANCY_URL = 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Vacant_Indicators_Bldg/FeatureServer/0/query';
const HIN_URL = 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/high_injury_network_2025/FeatureServer/0/query';
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
} = {}) {
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
} = {}) {
  validatePrivateIdentity(identity);
  let retrievedAt;
  try {
    retrievedAt = nullableDate(now());
  } catch {
    throw new TypeError('A Home Compare retrieval clock is required.');
  }
  if (!retrievedAt) throw new TypeError('A Home Compare retrieval clock is required.');
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

  const property = createEvidenceMetric({
    status: 'available',
    value: identity.property,
    dataAsOf: latestDate(identity.property.assessmentDate, identity.property.marketValueDate, identity.property.recordingDate),
    coverage: 'Exact normalized-address OPA match with one parcel identifier and a geographically consistent OPA point.',
    precision: `Address score ${identity.score}; geocoder-to-OPA point distance ${identity.join.distanceMeters} m.`,
    sourceIds: [SOURCE_IDS.address, SOURCE_IDS.property],
    limitations: ['Public assessment and property fields are records, not an appraisal, inspection, or suitability conclusion.'],
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
        'The profile omits its address, coordinates, parcel identifier, and source record identifiers from the serving projection.',
        'An admitted zero describes only the disclosed source query and coverage, not absence of harm, defects, requests, violations, vacancy, or crashes.',
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
  const rows = await queryCarto(`
    SELECT year, market_value, taxable_land, taxable_building, exempt_land, exempt_building
    FROM assessments
    WHERE parcel_number = ${sqlLiteral(parcelId)}
    ORDER BY year DESC
    LIMIT 20
  `, options);
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
    coverage: 'Up to 20 annual OPA assessment-history records for the admitted parcel.',
    precision: 'Exact OPA parcel-number join; monetary values retain source units.',
    limitations: [futureTaxYear
      ? 'The latest published tax year is ahead of retrieval and requires source-vintage review; it is not presented as a source as-of date.'
      : 'Assessment tax year is kept separate from source publication time; the open file may not reflect the most recent tax-year calculation.'],
  });
}

async function fetchTransfers(parcelId, { retrievedAt, ...options }) {
  const rows = await queryCarto(`
    SELECT document_type, display_date, recording_date, document_date,
           adjusted_total_consideration, matched_regmap, discrepancy, property_count
    FROM rtt_summary
    WHERE opa_account_num = ${sqlLiteral(parcelId)}
    ORDER BY display_date DESC NULLS LAST
    LIMIT 12
  `, options);
  const maximumAdmittedDate = Date.parse(retrievedAt) + 24 * 60 * 60 * 1000;
  let futureDatedFieldCount = 0;
  const records = rows.map((row) => {
    const displayDate = dateNotAfter(row.display_date, maximumAdmittedDate);
    const recordingDate = dateNotAfter(row.recording_date, maximumAdmittedDate);
    const documentDate = dateNotAfter(row.document_date, maximumAdmittedDate);
    futureDatedFieldCount += Number(displayDate.future) + Number(recordingDate.future) + Number(documentDate.future);
    return {
      documentType: boundedOptionalText(row.document_type, 80),
      displayDate: displayDate.value,
      recordingDate: recordingDate.value,
      documentDate: documentDate.value,
      consideration: nullableNumber(row.adjusted_total_consideration),
      matchedRegistryMap: booleanOrNull(row.matched_regmap),
      discrepancy: boundedOptionalText(row.discrepancy, 160),
      propertyCount: nullableSafeInteger(row.property_count),
    };
  });
  return admittedMetricResult({
    status: futureDatedFieldCount ? 'partial' : 'available',
    value: { recordCount: records.length, futureDatedFieldCount, records },
    dataAsOf: latestDate(...records.map((row) => row.recordingDate)),
    recordCount: records.length,
    coverage: 'Up to 12 public transfer-tax document summaries joined by OPA account number.',
    precision: 'Exact OPA account-number join; transaction-party and document identifiers are excluded; source dates later than retrieval plus one day are withheld as unknown.',
    limitations: [
      'Recorded consideration is not an appraisal, comparable-sales recommendation, or proof of current ownership.',
      ...(futureDatedFieldCount
        ? [`${futureDatedFieldCount} future sentinel date fields were withheld and this source remains partial.`]
        : []),
    ],
  });
}

async function fetchServiceRequests(lngLat, { request, signal, radiusMeters, months }) {
  const [longitude, latitude] = admittedPoint(lngLat);
  const rows = await queryCarto(`
    SELECT COUNT(*)::int AS record_count,
           COUNT(*) FILTER (WHERE lower(coalesce(status, '')) NOT IN ('closed', 'completed'))::int AS open_count,
           MIN(requested_datetime) AS earliest_at,
           MAX(updated_datetime) AS latest_at
    FROM public_cases_fc
    WHERE requested_datetime >= (CURRENT_DATE - INTERVAL '${admittedInteger(months, 1, 120)} months')
      AND ST_DWithin(
        the_geom::geography,
        ST_SetSRID(ST_Point(${longitude}, ${latitude}), 4326)::geography,
        ${admittedInteger(radiusMeters, 100, 2000)}
      )
  `, { request, signal });
  const row = singleRow(rows, '311 aggregate');
  const recordCount = admittedCount(row.record_count, '311 count');
  return admittedMetricResult({
    value: { recordCount, openCount: admittedCount(row.open_count, '311 open count') },
    dataAsOf: nullableDate(row.latest_at),
    recordCount,
    coverage: `${months}-month public 311 request window within ${radiusMeters} m of the ephemeral address point.`,
    precision: 'Aggregate spatial query; request identifiers, addresses, coordinates, and raw rows are excluded.',
    limitations: ['A service request is not verification that a condition existed, persisted, or was resolved.'],
  });
}

async function fetchLiHistory(parcelId, options) {
  const [violations, licenses, investigations] = await Promise.all([
    queryCarto(`
      SELECT COUNT(*)::int AS record_count,
             COUNT(*) FILTER (WHERE lower(coalesce(violationstatus, '')) NOT IN ('closed', 'resolved', 'complied'))::int AS not_closed_count,
             MAX(violationdate) AS latest_at
      FROM violations WHERE opa_account_num = ${sqlLiteral(parcelId)}
    `, options),
    queryCarto(`
      SELECT COUNT(*)::int AS record_count,
             COUNT(*) FILTER (WHERE lower(coalesce(licensestatus, '')) = 'active')::int AS active_count,
             MAX(mostrecentissuedate) FILTER (
               WHERE mostrecentissuedate <= CURRENT_TIMESTAMP + INTERVAL '1 day'
             ) AS latest_at
      FROM business_licenses WHERE opa_account_num = ${sqlLiteral(parcelId)}
    `, options),
    queryCarto(`
      SELECT COUNT(*)::int AS record_count,
             COUNT(*) FILTER (WHERE lower(coalesce(investigationstatus, '')) NOT IN ('closed', 'completed'))::int AS not_closed_count,
             MAX(investigationcompleted) FILTER (
               WHERE investigationcompleted <= CURRENT_TIMESTAMP + INTERVAL '1 day'
             ) AS latest_at
      FROM case_investigations WHERE opa_account_num = ${sqlLiteral(parcelId)}
    `, options),
  ]);
  const violation = singleRow(violations, 'L&I violation aggregate');
  const license = singleRow(licenses, 'L&I license aggregate');
  const investigation = singleRow(investigations, 'L&I investigation aggregate');
  const counts = {
    violations: admittedCount(violation.record_count, 'violation count'),
    violationsNotClosedByConfiguredStatuses: admittedCount(violation.not_closed_count, 'configured-status violation count'),
    licenses: admittedCount(license.record_count, 'license count'),
    activeLicenses: admittedCount(license.active_count, 'active license count'),
    investigations: admittedCount(investigation.record_count, 'investigation count'),
    investigationsNotClosedByConfiguredStatuses: admittedCount(investigation.not_closed_count, 'configured-status investigation count'),
  };
  const recordCount = counts.violations + counts.licenses + counts.investigations;
  return admittedMetricResult({
    value: counts,
    dataAsOf: latestDate(violation.latest_at, license.latest_at, investigation.latest_at),
    recordCount,
    coverage: 'Public L&I violations, business licenses, and case investigations joined by OPA account number.',
    precision: 'Exact OPA account-number aggregate; not-closed counts use configured source-status exclusions, not an official open-status taxonomy; raw rows are excluded.',
    limitations: ['Administrative statuses do not guarantee current property condition; unknown statuses and missing joins are not interpreted as zero.'],
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
    coverage: 'Current admitted Vacant Property Indicators building layer for the exact OPA identifier.',
    precision: 'Exact OPA identifier query; no matching feature is an admitted source-model non-listing, not confirmed occupancy.',
    limitations: ['Vacant Property Indicators is a likely-vacancy model based on administrative data, not field confirmation.'],
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
  const count = admittedCount(payload?.count, 'HIN feature count');
  return admittedMetricResult({
    value: { nearbyNetworkFeatureCount: count },
    dataAsOf: null,
    recordCount: count,
    coverage: `2025 HIN street features within ${radiusMeters} m of the ephemeral address point.`,
    precision: 'ArcGIS point-distance aggregate; feature geometry, street names, coordinates, and object identifiers are excluded.',
    limitations: ['HIN is crash-derived road-network context, not address-level risk, individual probability, or a safety ranking.'],
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
  const end = new Date(maximum.getTime() + 24 * 60 * 60 * 1000);
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
  const admitted = admittedCount(count, 'reported-incident count');
  return admittedMetricResult({
    value: { recordCount: admitted },
    dataAsOf: maximum.toISOString(),
    recordCount: admitted,
    coverage: `${months}-month historical PPD reported-incident window within ${radiusMeters} m; source range ${coverage.min} to ${coverage.max}.`,
    precision: 'Aggregate point-buffer query; generalized incident locations and source records are excluded.',
    limitations: ['Reported incidents are incomplete historical evidence, not a complete account of harm, individual risk, absolute safety, or a forecast.'],
  });
}

function buildPropertyJoinSql(normalizedAddress) {
  return `
    SELECT parcel_number, location, ST_X(the_geom) AS lon, ST_Y(the_geom) AS lat,
           assessment_date, market_value, market_value_date, sale_date, sale_price,
           recording_date, total_livable_area, number_of_bedrooms, number_of_bathrooms,
           year_built, zoning
    FROM opa_properties_public
    WHERE upper(location) = upper(${sqlLiteral(normalizedAddress)})
    LIMIT 6
  `;
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
  return request(endpoint.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cacheTTL: 0,
    retries: 0,
    timeoutMs,
    signal,
  });
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
  return admittedCount(singleRow(rows, 'reported-incident aggregate').n, 'reported-incident count');
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
  const payload = await request(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: sql }).toString(),
    cacheTTL: 0,
    retries: 0,
    signal,
  });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.rows)) {
    throw new TypeError('City data response is malformed.');
  }
  return payload.rows;
}

function settlementMetric(settlement, sourceId) {
  if (settlement.status === 'fulfilled') {
    const result = settlement.value;
    return createEvidenceMetric({
      status: result.status,
      value: result.value,
      dataAsOf: result.dataAsOf,
      coverage: result.coverage,
      precision: result.precision,
      sourceIds: [sourceId],
      limitations: result.limitations,
    });
  }
  return createEvidenceMetric({
    status: 'unavailable',
    value: null,
    dataAsOf: null,
    coverage: 'The requested source query did not produce an admitted result.',
    precision: 'Unavailable is not zero and no fallback was substituted.',
    sourceIds: [sourceId],
    limitations: [`Source query failed closed (${boundedReason(settlement.reason)}).`],
  });
}

function buildSourceStates(evidence, retrievedAt, knownCounts) {
  return Object.fromEntries(HOME_COMPARE_EVIDENCE_KEYS.flatMap((key) => {
    const metric = evidence[key];
    return metric.sourceIds.map((sourceId) => [sourceId, {
      sourceId,
      status: metric.status === 'unavailable' ? 'unavailable' : 'partial',
      recordCount: metric.status === 'unavailable' ? null : knownCounts[sourceId] ?? metricRecordCount(metric.value),
      dataAsOf: sourceId === SOURCE_IDS.address ? null : metric.dataAsOf,
      retrievedAt: metric.status === 'unavailable' ? null : retrievedAt,
    }]);
  }));
}

function admittedMetricResult({ status = 'available', value, dataAsOf, recordCount, coverage, precision, limitations }) {
  if (!Number.isSafeInteger(recordCount) || recordCount < 0) throw new TypeError('Source record count is invalid.');
  if (!['available', 'partial'].includes(status)) throw new TypeError('Source metric status is invalid.');
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

function singleRow(rows, label) {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') {
    throw new TypeError(`${label} response is invalid.`);
  }
  return rows[0];
}

function admittedCount(value, label) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${label} is invalid.`);
  return number;
}

function admittedInteger(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new TypeError('Bounded integer is invalid.');
  return number;
}

function admittedPoint(value) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) throw new TypeError('Point is invalid.');
  const [longitude, latitude] = value;
  if (longitude < -75.35 || longitude > -74.9 || latitude < 39.8 || latitude > 40.2) throw new TypeError('Point is outside Philadelphia.');
  return [longitude, latitude];
}

function boundedYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1800 || year > 2200) throw new TypeError('Assessment year is invalid.');
  return year;
}

function nullableNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('Numeric source value is invalid.');
  return number;
}

function nullableSafeInteger(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new TypeError('Integer source value is invalid.');
  return number;
}

function booleanOrNull(value) {
  if (value == null || value === '') return null;
  if (value === true || value === false) return value;
  if (value === 'true' || value === 't' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 'f' || value === 0 || value === '0') return false;
  throw new TypeError('Boolean source value is invalid.');
}

function boundedOptionalText(value, maximum) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f]/.test(value)) throw new TypeError('Text source value is invalid.');
  return value.trim() || null;
}

function nullableDate(value) {
  if (value == null || value === '') return null;
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  if (Number.isNaN(timestamp)) throw new TypeError('Source date is invalid.');
  return new Date(timestamp).toISOString();
}

function dateNotAfter(value, maximumTimestamp) {
  const parsed = nullableDate(value);
  return {
    value: parsed && Date.parse(parsed) <= maximumTimestamp ? parsed : null,
    future: parsed != null && Date.parse(parsed) > maximumTimestamp,
  };
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
