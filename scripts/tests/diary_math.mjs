#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  DEFAULT_HALF_LIFE_DAYS,
  weightFor,
  bayesianShrink,
  clampMean,
  effectiveN,
} from '../../src/utils/decay.js';

function approxEqual(a, b, epsilon = 0.02) {
  return Math.abs(a - b) <= epsilon;
}

const now = Date.now();
assert.equal(DEFAULT_HALF_LIFE_DAYS, 21, 'The shared Diary half-life must remain 21 days');
const wFresh = weightFor(now, now);
const wHalfLife = weightFor(now - DEFAULT_HALF_LIFE_DAYS * 86400000, now);
const wTwoHalf = weightFor(now - DEFAULT_HALF_LIFE_DAYS * 2 * 86400000, now);
assert.ok(approxEqual(wFresh, 1), `Fresh weight expected ≈1, got ${wFresh}`);
assert.equal(wHalfLife, 0.5, `Default weight must equal 0.5 at ${DEFAULT_HALF_LIFE_DAYS} days`);
assert.equal(wTwoHalf, 0.25, `Default weight must equal 0.25 at ${DEFAULT_HALF_LIFE_DAYS * 2} days`);

const shrinked = bayesianShrink(5, 1, 3, 5);
assert.equal(shrinked, (3 * 5 + 5) / 6, 'Small samples must use the documented weighted-prior formula');
const shrLargeN = bayesianShrink(4.5, 200, 3, 5);
assert.ok(approxEqual(shrLargeN, 4.5, 0.05), 'Large n should converge to observed mean');

assert.equal(clampMean(0.5), 1, 'Clamp lower bound to 1');
assert.equal(clampMean(5.6), 5, 'Clamp upper bound to 5');
assert.equal(clampMean(3.2), 3.2, 'Clamp should keep in-range values');

assert.equal(effectiveN(0), 0, 'effectiveN(0) should be zero');
assert.equal(effectiveN(12.5), 12.5, 'effectiveN should act as identity over sum of weights');

console.info('[Diary Tests] PASS — decay math helpers stable.');
