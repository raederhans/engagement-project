/**
 * Route Safety Diary - Time-Decay & Bayesian Shrinkage
 *
 * Purpose: Calculate decayed ratings, effective sample sizes, and trends.
 * Status: [TODO] Implementation needed for M1
 * See: docs/ALGO_REQUIREMENTS_M1.md (Section 2)
 */

// TODO: Import dependencies when implementing
// import dayjs from 'dayjs';

/**
 * Calculate time-decayed mean rating
 * @param {Array} samples - Rating samples [{rating, timestamp}, ...]
 * @param {number} now - Current timestamp (ms)
 * @param {number} halfLifeDays - Half-life in days (default: 90)
 * @returns {number} Decayed mean rating (1-5)
 */
export function decayedMean(samples, now, halfLifeDays = 90) {
  // TODO: Implement exponential time-decay
  // Formula: weight_i = e^(-λ * days_ago_i)
  // λ = ln(2) / halfLifeDays
  // decayed_mean = Σ(rating_i * weight_i) / Σ(weight_i)

  const lambda = Math.log(2) / halfLifeDays;
  let weightedSum = 0;
  let weightSum = 0;

  for (const sample of samples) {
    const daysAgo = (now - sample.timestamp) / (1000 * 60 * 60 * 24);
    const weight = Math.exp(-lambda * daysAgo);
    weightedSum += sample.rating * weight;
    weightSum += weight;
  }

  return weightSum > 0 ? weightedSum / weightSum : 3.0; // Fallback to prior mean
}

/**
 * Calculate Bayesian shrinkage (James-Stein estimator)
 * @param {number} observedMean - Segment's decayed mean
 * @param {number} observedN - Segment's effective sample size
 * @param {number} priorMean - Global prior mean (default: 3.0)
 * @param {number} priorN - Prior strength (default: 5 pseudo-samples)
 * @returns {number} Shrunk mean rating (1-5)
 */
export function bayesianShrinkage(observedMean, observedN, priorMean = 3.0, priorN = 5) {
  // TODO: Implement Bayesian shrinkage
  // Formula: shrunk_mean = (priorMean * priorN + observedMean * observedN) / (priorN + observedN)
  // Purpose: Prevent overconfidence from small samples
  // Example: 1 rating of 5.0 → shrinks toward 3.0
  //          50 ratings of 4.5 → barely shrinks

  const numerator = priorMean * priorN + observedMean * observedN;
  const denominator = priorN + observedN;
  return numerator / denominator;
}

/**
 * Calculate effective sample size (n_eff)
 * @param {Array} samples - Rating samples [{timestamp}, ...]
 * @param {number} now - Current timestamp (ms)
 * @param {number} halfLifeDays - Half-life in days (default: 90)
 * @returns {number} Effective sample size (n_eff)
 */
export function effectiveN(samples, now, halfLifeDays = 90) {
  // TODO: Implement effective sample size
  // Formula: n_eff = Σ weight_i
  // Purpose: Represents "equivalent number of fresh ratings"
  // Example: 10 ratings from 90 days ago → n_eff ≈ 5

  const lambda = Math.log(2) / halfLifeDays;
  let weightSum = 0;

  for (const sample of samples) {
    const daysAgo = (now - sample.timestamp) / (1000 * 60 * 60 * 24);
    weightSum += Math.exp(-lambda * daysAgo);
  }

  return weightSum;
}

/**
 * Calculate 30-day trend (Δ30d)
 * @param {Array} samples - Rating samples [{rating, timestamp}, ...]
 * @param {number} now - Current timestamp (ms)
 * @returns {number} Trend (+/- change in rating)
 */
export function delta30d(samples, now) {
  // TODO: Implement 30-day trend
  // Formula: Δ30d = mean(last 30 days) - mean(31-90 days ago)
  // Interpretation:
  //   Positive → improving (green up-arrow)
  //   Negative → worsening (red down-arrow)
  //   ~0       → stable (neutral dash)

  const cutoff30d = now - 30 * 86400000; // 30 days in ms
  const cutoff90d = now - 90 * 86400000; // 90 days in ms

  const recent = samples.filter(s => s.timestamp >= cutoff30d);
  const older = samples.filter(s => s.timestamp < cutoff30d && s.timestamp >= cutoff90d);

  if (recent.length === 0 || older.length === 0) {
    return 0; // Insufficient data
  }

  const recentMean = recent.reduce((sum, s) => sum + s.rating, 0) / recent.length;
  const olderMean = older.reduce((sum, s) => sum + s.rating, 0) / older.length;

  return recentMean - olderMean;
}

/**
 * Calculate confidence percentage from n_eff
 * @param {number} n_eff - Effective sample size
 * @returns {number} Confidence percentage (0-100)
 */
export function confidencePercent(n_eff) {
  // TODO: Map n_eff to confidence percentage
  // Formula: confidence = min(100, (n_eff / 50) * 100)
  // Rationale: n_eff = 50 is "very high confidence" (100%)
  return Math.min(100, (n_eff / 50) * 100);
}

/**
 * Get trend icon and color
 * @param {number} delta - 30-day trend value
 * @returns {object} {icon, color, text}
 */
export function trendIcon(delta) {
  // TODO: Map delta to UI representation
  if (delta > 0.2) {
    return { icon: '↑', color: 'green', text: `+${delta.toFixed(1)}` };
  }
  if (delta < -0.2) {
    return { icon: '↓', color: 'red', text: delta.toFixed(1) };
  }
  return { icon: '—', color: 'gray', text: '0.0' };
}

/**
 * Calculate full segment statistics (combines all functions)
 * @param {Array} samples - Rating samples [{rating, timestamp}, ...]
 * @param {number} now - Current timestamp (ms)
 * @param {object} opts - Options {halfLifeDays, priorMean, priorN}
 * @returns {object} {rating, n_eff, confidence, trend_30d}
 */
export function calculateSegmentStats(samples, now, opts = {}) {
  const {
    halfLifeDays = 90,
    priorMean = 3.0,
    priorN = 5
  } = opts;

  // TODO: Implement full calculation pipeline
  // 1. Calculate decayed mean
  const observedMean = decayedMean(samples, now, halfLifeDays);

  // 2. Calculate effective N
  const observedN = effectiveN(samples, now, halfLifeDays);

  // 3. Apply Bayesian shrinkage
  const rating = bayesianShrinkage(observedMean, observedN, priorMean, priorN);

  // 4. Calculate confidence
  const confidence = confidencePercent(observedN);

  // 5. Calculate trend
  const trend_30d = delta30d(samples, now);

  return {
    rating,
    n_eff: observedN,
    confidence,
    trend_30d
  };
}
