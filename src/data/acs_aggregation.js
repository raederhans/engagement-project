export const ACS_AGGREGATION_SCHEMA_VERSION = 'engagement-acs-tract-aggregation-v1';
export const ACS_VRE_REPLICATE_COUNT = 80;
export const ACS_AGGREGATION_PERIOD = '2020-2024';
export const ACS_AGGREGATION_RELEASE = '2024 ACS 5-year';
export const ACS_TRACT_GEOGRAPHY_VINTAGE = '2020 Census';

const SUPPORTED_TABLE = 'B01003';
const SUPPORTED_INDICATOR = 'total-population';
const FULL_TRACT = 'full-tract';

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeInteger(value) {
  const number = finiteNumber(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function unavailable(reason, details = {}) {
  return { status: 'unavailable', reason, ...details, result: null };
}

function notComparable(reason, details = {}) {
  return { status: 'not-comparable', reason, ...details, result: null };
}

function validReplicates(values) {
  if (!Array.isArray(values) || values.length !== ACS_VRE_REPLICATE_COUNT) return null;
  const normalized = values.map(finiteNumber);
  return normalized.every((value) => value != null) ? normalized : null;
}

/**
 * Strictly admit the selected-table VRE snapshot. The array position is the
 * Var_Rep number: index 0 is Var_Rep1 and index 79 is Var_Rep80.
 */
export function normalizeAcsVreSnapshot(payload) {
  if (!isPlainObject(payload) || payload.schemaVersion !== ACS_AGGREGATION_SCHEMA_VERSION) {
    throw new Error('ACS VRE snapshot schema is unsupported.');
  }
  const manifest = payload.manifest;
  if (
    !isPlainObject(manifest)
    || manifest.release !== ACS_AGGREGATION_RELEASE
    || manifest.period !== ACS_AGGREGATION_PERIOD
    || manifest.geographyVintage !== ACS_TRACT_GEOGRAPHY_VINTAGE
    || manifest.summaryLevel !== '140'
    || manifest.tableId !== SUPPORTED_TABLE
    || manifest.indicator !== SUPPORTED_INDICATOR
    || manifest.replicateCount !== ACS_VRE_REPLICATE_COUNT
    || !text(manifest.sourceUrl)
    || !text(manifest.documentationUrl)
    || !text(manifest.geographyUrl)
    || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.accessedAt || '')
    || Number.isNaN(Date.parse(manifest.retrievedAt))
    || !/^sha256:[a-f0-9]{64}$/.test(manifest.rowsSha256 || '')
    || !Array.isArray(payload.rows)
    || manifest.rowCount !== payload.rows.length
  ) {
    throw new Error('ACS VRE snapshot manifest is invalid.');
  }

  const geoids = new Set();
  const rows = payload.rows.map((row) => {
    const geoid = text(row?.geoid);
    const estimate = nonNegativeInteger(row?.estimate);
    const replicates = validReplicates(row?.replicates);
    if (!/^42101\d{6}$/.test(geoid || '') || estimate == null || !replicates || geoids.has(geoid)) {
      throw new Error('ACS VRE snapshot contains an invalid or duplicate tract row.');
    }
    geoids.add(geoid);
    return { geoid, estimate, replicates };
  });
  if (rows.length === 0) throw new Error('ACS VRE snapshot contains no tract rows.');
  return { schemaVersion: payload.schemaVersion, manifest: { ...manifest }, rows };
}

export function calculateSdrEstimate(estimate, replicates) {
  const normalizedEstimate = finiteNumber(estimate);
  const normalizedReplicates = validReplicates(replicates);
  if (normalizedEstimate == null || !normalizedReplicates) {
    return unavailable('invalid-estimate-or-replicates');
  }
  const sumSquaredDifferences = normalizedReplicates.reduce(
    (sum, replicate) => sum + ((replicate - normalizedEstimate) ** 2),
    0,
  );
  const variance = (4 / ACS_VRE_REPLICATE_COUNT) * sumSquaredDifferences;
  const standardError = Math.sqrt(variance);
  const moe90Unrounded = standardError * 1.645;
  return {
    status: 'available',
    estimate: normalizedEstimate,
    variance,
    standardError,
    moe90Unrounded,
    moe90: Math.round(moe90Unrounded),
  };
}

/**
 * Reserved pure seam for supported future ratios. It fails closed when the
 * published denominator is zero; zero replicate denominators follow Census's
 * documented substitution of zero for that replicate ratio.
 */
export function calculateSdrRatio({ numerator, denominator, scale = 1 } = {}) {
  const numeratorEstimate = finiteNumber(numerator?.estimate);
  const denominatorEstimate = finiteNumber(denominator?.estimate);
  const numeratorReplicates = validReplicates(numerator?.replicates);
  const denominatorReplicates = validReplicates(denominator?.replicates);
  const normalizedScale = finiteNumber(scale);
  if (denominatorEstimate === 0) return unavailable('zero-denominator');
  if (
    numeratorEstimate == null || denominatorEstimate == null || denominatorEstimate < 0
    || !numeratorReplicates || !denominatorReplicates || normalizedScale == null
  ) {
    return unavailable('invalid-ratio-input');
  }
  const estimate = (numeratorEstimate / denominatorEstimate) * normalizedScale;
  const replicates = numeratorReplicates.map((value, index) => {
    const replicateDenominator = denominatorReplicates[index];
    return replicateDenominator === 0
      ? 0
      : (value / replicateDenominator) * normalizedScale;
  });
  return calculateSdrEstimate(estimate, replicates);
}

function normalizeSelections(selections) {
  if (!Array.isArray(selections)) return unavailable('tract-selection-required');
  if (selections.length < 2) return unavailable('two-or-more-complete-tracts-required');

  const normalized = [];
  const seen = new Set();
  for (const selection of selections) {
    const geoid = text(selection?.geoid);
    const coverage = text(selection?.coverage);
    const geographyVintage = text(selection?.geographyVintage);
    if (!/^\d{11}$/.test(geoid || '')) return unavailable('invalid-tract-geoid');
    if (coverage !== FULL_TRACT) return unavailable('full-tract-only');
    if (!geographyVintage) return notComparable('geography-vintage-unavailable');
    if (seen.has(geoid)) return unavailable('duplicate-tract-selection');
    seen.add(geoid);
    normalized.push({ geoid, coverage, geographyVintage });
  }
  const vintages = new Set(normalized.map(({ geographyVintage }) => geographyVintage));
  if (vintages.size !== 1) return notComparable('mixed-geography-vintage');
  if (!vintages.has(ACS_TRACT_GEOGRAPHY_VINTAGE)) {
    return notComparable('unsupported-geography-vintage');
  }
  return { status: 'available', selections: normalized };
}

/** Aggregate B01003 only for two or more complete, 2020-vintage Census tracts. */
export function aggregateAcsTractPopulation({ selections, snapshot } = {}) {
  const admittedSelections = normalizeSelections(selections);
  if (admittedSelections.status !== 'available') return admittedSelections;

  let admittedSnapshot;
  try {
    admittedSnapshot = normalizeAcsVreSnapshot(snapshot);
  } catch {
    return unavailable('vre-source-unavailable');
  }
  if (admittedSnapshot.manifest.geographyVintage !== ACS_TRACT_GEOGRAPHY_VINTAGE) {
    return notComparable('snapshot-geography-vintage-mismatch');
  }

  const rowByGeoid = new Map(admittedSnapshot.rows.map((row) => [row.geoid, row]));
  const rows = admittedSelections.selections.map(({ geoid }) => rowByGeoid.get(geoid));
  if (rows.some((row) => !row)) return unavailable('tract-vre-unavailable');

  const estimate = rows.reduce((sum, row) => sum + row.estimate, 0);
  const replicates = Array.from({ length: ACS_VRE_REPLICATE_COUNT }, (_, index) => (
    rows.reduce((sum, row) => sum + row.replicates[index], 0)
  ));
  const uncertainty = calculateSdrEstimate(estimate, replicates);
  if (uncertainty.status !== 'available') return unavailable('aggregate-uncertainty-unavailable');
  if (uncertainty.variance === 0) {
    return unavailable('zero-variance-special-case-unavailable');
  }

  return {
    status: 'available',
    reason: null,
    result: {
      indicator: SUPPORTED_INDICATOR,
      tableId: SUPPORTED_TABLE,
      estimate: uncertainty.estimate,
      moe90: uncertainty.moe90,
      moe90Unrounded: uncertainty.moe90Unrounded,
      standardError: uncertainty.standardError,
      variance: uncertainty.variance,
      confidenceLevel: 0.9,
      tractCount: rows.length,
      geoids: admittedSelections.selections.map(({ geoid }) => geoid),
      period: admittedSnapshot.manifest.period,
      release: admittedSnapshot.manifest.release,
      geographyVintage: admittedSnapshot.manifest.geographyVintage,
      method: 'Census SDR VRE: aggregate the estimate and each of 80 replicates; variance = 4/80 × sum of squared replicate differences; 90% MOE = 1.645 × SE.',
      limitation: 'Complete 2020 Census tracts only. The MOE represents ACS sampling uncertainty for this aggregate, not an error limit or a fact about any person or address.',
      source: {
        provider: 'U.S. Census Bureau',
        sourceUrl: admittedSnapshot.manifest.sourceUrl,
        documentationUrl: admittedSnapshot.manifest.documentationUrl,
        geographyUrl: admittedSnapshot.manifest.geographyUrl,
        accessedAt: admittedSnapshot.manifest.accessedAt,
        retrievedAt: admittedSnapshot.manifest.retrievedAt,
      },
    },
  };
}
