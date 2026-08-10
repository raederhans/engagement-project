/**
 * Narrow adapter for a future Evidence Bundle integrator. This file is not
 * imported by the existing bundle schema and therefore does not widen it.
 */
export function toAcsAggregationEvidenceRecord(outcome) {
  if (outcome?.status !== 'available' || !outcome.result) return null;
  const value = outcome.result;
  const numeric = [
    value.estimate,
    value.standardError,
    value.variance,
    value.moe90,
    value.moe90Unrounded,
  ];
  const geoids = Array.isArray(value.geoids) ? value.geoids : [];
  const strings = [
    value.indicator,
    value.tableId,
    value.period,
    value.release,
    value.geographyVintage,
    value.method,
    value.limitation,
  ];
  const sourceStrings = value.source && [
    value.source.provider,
    value.source.sourceUrl,
    value.source.documentationUrl,
    value.source.geographyUrl,
    value.source.accessedAt,
    value.source.retrievedAt,
    value.source.sourceAsOf,
    value.source.snapshotVersion,
    value.source.snapshotIdentity,
  ];
  if (
    numeric.some((number) => !Number.isFinite(number) || number < 0)
    || strings.some((text) => typeof text !== 'string' || !text.trim())
    || value.confidenceLevel !== 0.9
    || !Number.isSafeInteger(value.tractCount)
    || value.tractCount < 2
    || geoids.length !== value.tractCount
    || new Set(geoids).size !== geoids.length
    || geoids.some((geoid) => !/^42101\d{6}$/.test(geoid))
    || !sourceStrings
    || sourceStrings.some((text) => typeof text !== 'string' || !text.trim())
    || !Number.isSafeInteger(value.source.recordCount)
    || value.source.recordCount < value.tractCount
  ) return null;
  return Object.freeze({
    schemaVersion: 'engagement-acs-aggregation-evidence-adapter/v1',
    indicator: value.indicator,
    tableId: value.tableId,
    estimate: value.estimate,
    standardError: value.standardError,
    variance: value.variance,
    moe90: value.moe90,
    moe90Unrounded: value.moe90Unrounded,
    confidenceLevel: value.confidenceLevel,
    period: value.period,
    release: value.release,
    geographyVintage: value.geographyVintage,
    tractCount: value.tractCount,
    geoids: Object.freeze([...geoids]),
    method: value.method,
    limitation: value.limitation,
    source: Object.freeze({ ...value.source }),
  });
}
