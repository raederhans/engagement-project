/** Shared time-decay and Bayesian aggregation helpers for Diary ratings. */

export const DEFAULT_HALF_LIFE_DAYS = 21;

export function weightFor(sampleTimestamp, nowTimestamp, halfLifeDays = DEFAULT_HALF_LIFE_DAYS) {
  const sample = Number(sampleTimestamp);
  const now = Number(nowTimestamp);
  if (!Number.isFinite(sample) || !Number.isFinite(now) || halfLifeDays <= 0) {
    return 1;
  }
  const dtDays = Math.max(0, (now - sample) / 86400000);
  return Math.pow(2, -dtDays / halfLifeDays);
}

export function bayesianShrink(mean, n, priorMean = 3.0, priorN = 5) {
  const observedMean = Number.isFinite(mean) ? mean : priorMean;
  const observedN = Math.max(0, Number.isFinite(n) ? n : 0);
  const numerator = priorMean * priorN + observedMean * observedN;
  const denominator = Math.max(1e-6, priorN + observedN);
  return numerator / denominator;
}

export function effectiveN(sumW) {
  return Math.max(0, Number.isFinite(sumW) ? sumW : 0);
}

export function clampMean(value) {
  const numeric = Number.isFinite(value) ? value : 3;
  return Math.min(5, Math.max(1, numeric));
}
