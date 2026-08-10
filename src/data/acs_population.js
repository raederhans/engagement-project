export const ACS_POPULATION_SCHEMA_VERSION = 'engagement-acs-tract-population/v1';

const POPULATION_STATUSES = new Set(['available', 'partial', 'unavailable']);

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function textOrNull(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function timestampOrNull(value) {
  const text = textOrNull(value);
  if (!text) return null;
  const parsed = new Date(text);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === text ? text : null;
}

export function createPopulationMetric({
  estimate,
  moe90,
  vintage,
  source,
  retrievedAt = null,
  status,
  method,
  moe90Status,
} = {}) {
  const normalizedEstimate = finiteNonNegative(estimate);
  const normalizedMoe90 = finiteNonNegative(moe90);
  const derivedStatus = normalizedEstimate == null
    ? 'unavailable'
    : normalizedMoe90 == null ? 'partial' : 'available';
  const normalizedStatus = POPULATION_STATUSES.has(status) ? status : derivedStatus;
  const metric = {
    estimate: normalizedEstimate,
    moe90: normalizedMoe90,
    vintage: textOrNull(vintage),
    source: textOrNull(source),
    retrievedAt: timestampOrNull(retrievedAt),
    status: normalizedEstimate == null ? 'unavailable' : normalizedStatus,
  };
  const normalizedMethod = textOrNull(method);
  if (normalizedMethod) metric.method = normalizedMethod;
  const normalizedMoeStatus = textOrNull(moe90Status);
  if (normalizedMoeStatus) metric.moe90Status = normalizedMoeStatus;
  return metric;
}

export function normalizeAcsRow(row, metadata = {}) {
  const input = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
  const population = createPopulationMetric({
    estimate: input.population?.estimate ?? input.pop ?? input.B01003_001E,
    moe90: input.population?.moe90 ?? input.B01003_001M,
    vintage: input.population?.vintage ?? metadata.vintage,
    source: input.population?.source ?? metadata.source,
    retrievedAt: input.population?.retrievedAt ?? metadata.retrievedAt ?? null,
    status: input.population?.status,
    method: input.population?.method,
    moe90Status: input.population?.moe90Status,
  });
  return {
    ...input,
    pop: population.estimate,
    population,
  };
}

export function normalizeAcsSnapshot(payload, legacyMetadata = {}) {
  if (Array.isArray(payload)) {
    return payload.map((row) => normalizeAcsRow(row, legacyMetadata));
  }
  if (
    !payload || typeof payload !== 'object' || Array.isArray(payload)
    || payload.schemaVersion !== ACS_POPULATION_SCHEMA_VERSION
    || !payload.manifest || !Array.isArray(payload.rows)
    || payload.manifest.rowCount !== payload.rows.length
  ) {
    throw new Error('Bundled ACS snapshot manifest is invalid.');
  }
  const metadata = {
    vintage: payload.manifest.vintage,
    source: payload.manifest.source,
    retrievedAt: payload.manifest.retrievedAt,
  };
  return payload.rows.map((row) => normalizeAcsRow(row, metadata));
}

export function populationEstimate(value) {
  return finiteNonNegative(value?.estimate ?? value);
}
