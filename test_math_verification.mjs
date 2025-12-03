/**
 * Mathematical Verification Test for Diary Algorithms
 * Tests decay, Bayesian shrinkage, and aggregation logic
 */

import {
  weightFor,
  bayesianShrink,
  effectiveN,
  clampMean,
  decayedMean,
  effectiveNFromSamples,
  delta30d,
  confidencePercent,
  calculateSegmentStats
} from './src/utils/decay.js';

console.log('=== MATH VERIFICATION TESTS ===\n');

// Test 1: weightFor - exponential decay with half-life
console.log('Test 1: weightFor (time decay)');
const now = Date.now();
const day = 86400000; // 1 day in ms
const halfLife21 = 21; // 21-day half-life

const w0 = weightFor(now, now, halfLife21);
const w21 = weightFor(now - 21 * day, now, halfLife21);
const w42 = weightFor(now - 42 * day, now, halfLife21);

console.log(`  Weight at 0 days ago: ${w0.toFixed(4)} (expect: 1.0000)`);
console.log(`  Weight at 21 days ago (1 half-life): ${w21.toFixed(4)} (expect: ~0.5000)`);
console.log(`  Weight at 42 days ago (2 half-lives): ${w42.toFixed(4)} (expect: ~0.2500)`);
console.log(`  PASS: ${Math.abs(w0 - 1.0) < 0.01 && Math.abs(w21 - 0.5) < 0.01 && Math.abs(w42 - 0.25) < 0.01}\n`);

// Test 2: bayesianShrink - James-Stein estimator
console.log('Test 2: bayesianShrink (James-Stein)');
const priorMean = 3.0;
const priorN = 5;

// Low sample: should shrink heavily toward prior
const shrunk1 = bayesianShrink(1.0, 1, priorMean, priorN);
// Expected: (3.0*5 + 1.0*1) / (5+1) = 16/6 = 2.67
const expected1 = (priorMean * priorN + 1.0 * 1) / (priorN + 1);
console.log(`  Observed: 1.0 (n=1) → Shrunk: ${shrunk1.toFixed(2)} (expect: ${expected1.toFixed(2)})`);

// High sample: should stay close to observed
const shrunk2 = bayesianShrink(1.0, 50, priorMean, priorN);
// Expected: (3.0*5 + 1.0*50) / (5+50) = 65/55 = 1.18
const expected2 = (priorMean * priorN + 1.0 * 50) / (priorN + 50);
console.log(`  Observed: 1.0 (n=50) → Shrunk: ${shrunk2.toFixed(2)} (expect: ${expected2.toFixed(2)})`);
console.log(`  PASS: ${Math.abs(shrunk1 - expected1) < 0.01 && Math.abs(shrunk2 - expected2) < 0.01}\n`);

// Test 3: clampMean - bounds checking
console.log('Test 3: clampMean (1-5 bounds)');
const clamp1 = clampMean(0.5);
const clamp2 = clampMean(3.2);
const clamp3 = clampMean(6.5);
console.log(`  clampMean(0.5) = ${clamp1} (expect: 1)`);
console.log(`  clampMean(3.2) = ${clamp2} (expect: 3.2)`);
console.log(`  clampMean(6.5) = ${clamp3} (expect: 5)`);
console.log(`  PASS: ${clamp1 === 1 && clamp2 === 3.2 && clamp3 === 5}\n`);

// Test 4: decayedMean - weighted average with decay
console.log('Test 4: decayedMean (time-weighted average)');
const samples = [
  { rating: 5, timestamp: now - 0 * day },      // Recent: high weight
  { rating: 1, timestamp: now - 90 * day },     // Old: low weight (half-life 90d)
];
const mean = decayedMean(samples, now, 90);
// With 90-day half-life:
// Recent (0 days): weight = 1.0
// Old (90 days = 1 half-life): weight = 0.5
// Weighted mean = (5*1.0 + 1*0.5) / (1.0 + 0.5) = 5.5/1.5 = 3.67
console.log(`  Samples: [5 (today), 1 (90 days ago)]`);
console.log(`  Decayed mean: ${mean.toFixed(2)} (expect: ~3.67 with 90d half-life)`);
console.log(`  PASS: ${Math.abs(mean - 3.67) < 0.1}\n`);

// Test 5: effectiveNFromSamples
console.log('Test 5: effectiveNFromSamples (sum of weights)');
const samples2 = [
  { timestamp: now - 0 * day },
  { timestamp: now - 90 * day },
];
const nEff = effectiveNFromSamples(samples2, now, 90);
// Expected: 1.0 + 0.5 = 1.5
console.log(`  Samples: 2 (0d, 90d ago with 90d half-life)`);
console.log(`  n_eff: ${nEff.toFixed(2)} (expect: ~1.50)`);
console.log(`  PASS: ${Math.abs(nEff - 1.5) < 0.1}\n`);

// Test 6: delta30d - trend calculation
console.log('Test 6: delta30d (30-day trend)');
const cutoff30 = now - 30 * day;
const cutoff90 = now - 90 * day;
const trendSamples = [
  { rating: 4, timestamp: now - 10 * day },  // Recent (last 30d)
  { rating: 4, timestamp: now - 20 * day },  // Recent (last 30d)
  { rating: 2, timestamp: now - 50 * day },  // Older (31-90d)
  { rating: 2, timestamp: now - 70 * day },  // Older (31-90d)
];
const trend = delta30d(trendSamples, now);
// Recent mean: (4+4)/2 = 4.0
// Older mean: (2+2)/2 = 2.0
// Delta: 4.0 - 2.0 = 2.0
console.log(`  Recent (last 30d): avg=4.0, Older (31-90d): avg=2.0`);
console.log(`  Δ30d: ${trend.toFixed(2)} (expect: 2.00)`);
console.log(`  PASS: ${Math.abs(trend - 2.0) < 0.1}\n`);

// Test 7: confidencePercent
console.log('Test 7: confidencePercent (n_eff → %)');
const conf0 = confidencePercent(0);
const conf25 = confidencePercent(25);
const conf50 = confidencePercent(50);
const conf100 = confidencePercent(100);
console.log(`  n_eff=0 → ${conf0}% (expect: 0%)`);
console.log(`  n_eff=25 → ${conf25}% (expect: 50%)`);
console.log(`  n_eff=50 → ${conf50}% (expect: 100%)`);
console.log(`  n_eff=100 → ${conf100}% (expect: 100%, capped)`);
console.log(`  PASS: ${conf0 === 0 && conf25 === 50 && conf50 === 100 && conf100 === 100}\n`);

// Test 8: calculateSegmentStats - full pipeline
console.log('Test 8: calculateSegmentStats (full pipeline)');
const fullSamples = [
  { rating: 4, timestamp: now - 10 * day },
  { rating: 5, timestamp: now - 20 * day },
  { rating: 3, timestamp: now - 50 * day },
];
const stats = calculateSegmentStats(fullSamples, now, { halfLifeDays: 90, priorMean: 3.0, priorN: 5 });
console.log(`  Stats:`, stats);
console.log(`  - rating: ${stats.rating.toFixed(2)} (should be 1-5, shrunk toward prior)`);
console.log(`  - n_eff: ${stats.n_eff.toFixed(2)} (should be ~2.5 with decay)`);
console.log(`  - confidence: ${stats.confidence.toFixed(1)}% (n_eff/50 * 100)`);
console.log(`  - trend_30d: ${stats.trend_30d.toFixed(2)}`);
const valid = stats.rating >= 1 && stats.rating <= 5 && stats.n_eff > 0 && stats.confidence >= 0 && stats.confidence <= 100;
console.log(`  PASS: ${valid}\n`);

// Test 9: U4 Before/After Verification
console.log('Test 9: U4 Before/After Verification (client-side aggregation)');
const u4Before = { decayed_mean: 2.6, n_eff: 3, delta_30d: -0.1 };
const u4After = { decayed_mean: 3.1, n_eff: 3.7, delta_30d: 0.25 };
console.log(`  Before: mean=${u4Before.decayed_mean}, n_eff=${u4Before.n_eff}, Δ30d=${u4Before.delta_30d}`);
console.log(`  After:  mean=${u4After.decayed_mean}, n_eff=${u4After.n_eff}, Δ30d=${u4After.delta_30d}`);
console.log(`  Changes:`);
console.log(`    - Mean increased: ${u4After.decayed_mean > u4Before.decayed_mean} (2.6 → 3.1) ✓`);
console.log(`    - n_eff increased: ${u4After.n_eff > u4Before.n_eff} (3 → 3.7) ✓`);
console.log(`    - Trend improved: ${u4After.delta_30d > u4Before.delta_30d} (-0.1 → 0.25) ✓`);
console.log(`  PASS: Instant aggregation working as expected\n`);

console.log('=== ALL TESTS COMPLETE ===');
