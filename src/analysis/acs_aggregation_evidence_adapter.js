/**
 * Narrow adapter for a future Evidence Bundle integrator. This file is not
 * imported by the existing bundle schema and therefore does not widen it.
 */
export function toAcsAggregationEvidenceRecord(outcome) {
  if (outcome?.status !== 'available' || !outcome.result) return null;
  const value = outcome.result;
  return Object.freeze({
    schemaVersion: 'engagement-acs-aggregation-evidence-adapter/v1',
    indicator: value.indicator,
    estimate: value.estimate,
    moe90: value.moe90,
    confidenceLevel: value.confidenceLevel,
    period: value.period,
    release: value.release,
    geographyVintage: value.geographyVintage,
    tractCount: value.tractCount,
    geoids: Object.freeze([...value.geoids]),
    method: value.method,
    limitation: value.limitation,
    source: Object.freeze({ ...value.source }),
  });
}
