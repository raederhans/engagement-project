export function nearestRank(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (!(percentile > 0 && percentile <= 1)) throw new Error('percentile must be in (0, 1]');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(percentile * sorted.length) - 1];
}

const ratio = (numerator, denominator) => denominator > 0 ? numerator / denominator : null;

export function computeBenchmarkMetrics(observations, plannedPairs) {
  if (!Array.isArray(observations)) throw new Error('observations must be an array');
  if (!Number.isSafeInteger(plannedPairs) || plannedPairs <= 0) throw new Error('plannedPairs must be positive');
  const attempted = observations.filter(({ status }) => status !== 'unavailable');
  const successes = observations.filter(({ status }) => status === 'success');
  const invalid = observations.filter(({ status }) => status === 'invalid');
  const unavailable = observations.filter(({ status }) => status === 'unavailable');
  const candidates = successes.flatMap(({ candidates: entries = [] }) => entries);
  const duplicateCount = successes.reduce((total, { candidates: entries = [] }) => (
    total + entries.length - new Set(entries.map(({ candidateIdentity }) => candidateIdentity)).size
  ), 0);
  const latencies = attempted.map(({ latencyMs }) => latencyMs).filter(Number.isFinite);
  const mapMatch = candidates.map(({ mapMatchDistanceM }) => mapMatchDistanceM).filter(Number.isFinite);
  const detours = candidates.map(({ routeDistanceM, straightLineDistanceM }) => (
    Number.isFinite(routeDistanceM) && straightLineDistanceM > 0 ? routeDistanceM / straightLineDistanceM : null
  )).filter(Number.isFinite);
  const coverageCandidates = candidates.filter(({ evidence }) => Number.isSafeInteger(evidence?.totalSegmentCount) && evidence.totalSegmentCount > 0 && Number.isSafeInteger(evidence.coveredSegmentCount) && evidence.coveredSegmentCount <= evidence.totalSegmentCount);
  const coveredSegments = coverageCandidates.reduce((total, { evidence }) => total + evidence.coveredSegmentCount, 0);
  const totalSegments = coverageCandidates.reduce((total, { evidence }) => total + evidence.totalSegmentCount, 0);
  const sensitivity = candidates.filter(({ weightSensitivityChanged }) => typeof weightSensitivityChanged === 'boolean');
  const completeLatency = attempted.length > 0 && latencies.length === attempted.length;
  const completeMapMatch = candidates.length > 0 && mapMatch.length === candidates.length;
  const completeDetour = candidates.length > 0 && detours.length === candidates.length;
  const completeCoverage = candidates.length > 0 && coverageCandidates.length === candidates.length;
  const completeSensitivity = candidates.length > 0 && sensitivity.length === candidates.length;
  const denominator = {
    plannedPairs,
    attemptedPairs: attempted.length,
    successfulPairs: successes.length,
    invalidPairs: invalid.length,
    unavailablePairs: unavailable.length,
    generatedCandidates: candidates.length,
    sensitivityEligibleRoutes: completeSensitivity ? sensitivity.length : 0,
  };
  const hasAttempted = attempted.length > 0;
  const metrics = {
    generationSuccessRate: hasAttempted ? ratio(successes.length, attempted.length) : null,
    invalidRate: hasAttempted ? ratio(invalid.length, attempted.length) : null,
    duplicateCandidateRate: candidates.length > 0 ? ratio(duplicateCount, candidates.length) : null,
    latencyMedianMs: completeLatency ? nearestRank(latencies, 0.5) : null,
    latencyP95Ms: completeLatency ? nearestRank(latencies, 0.95) : null,
    mapMatchDistanceMedianM: completeMapMatch ? nearestRank(mapMatch, 0.5) : null,
    mapMatchDistanceP95M: completeMapMatch ? nearestRank(mapMatch, 0.95) : null,
    segmentEvidenceCoverageRate: completeCoverage && totalSegments > 0 ? ratio(coveredSegments, totalSegments) : null,
    detourMedianRatio: completeDetour ? nearestRank(detours, 0.5) : null,
    detourP95Ratio: completeDetour ? nearestRank(detours, 0.95) : null,
    weightSensitivityChangeRate: completeSensitivity ? ratio(sensitivity.filter(({ weightSensitivityChanged }) => weightSensitivityChanged).length, sensitivity.length) : null,
  };
  return { denominator, metrics };
}
