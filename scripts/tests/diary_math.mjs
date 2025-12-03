#!/usr/bin/env node
import assert from 'node:assert/strict';
import { weightFor, bayesianShrink, clampMean, effectiveN } from '../../src/utils/decay.js';

function approxEqual(a, b, epsilon = 0.02) {
  return Math.abs(a - b) <= epsilon;
}

const now = Date.now();
const halfLife = 21;
const wFresh = weightFor(now, now, halfLife);
const wHalfLife = weightFor(now - halfLife * 86400000, now, halfLife);
const wTwoHalf = weightFor(now - halfLife * 2 * 86400000, now, halfLife);
assert.ok(approxEqual(wFresh, 1), `Fresh weight expected ≈1, got ${wFresh}`);
assert.ok(approxEqual(wHalfLife, 0.5, 0.05), `Half-life weight expected ≈0.5, got ${wHalfLife}`);
assert.ok(wTwoHalf < wHalfLife, 'Two half-life weight should be smaller than half-life');

const shrinked = bayesianShrink(5, 1, 3, 5);
assert.ok(shrinked < 3.4 && shrinked > 3, 'Shrink should stay near prior when n small');
const shrLargeN = bayesianShrink(4.5, 200, 3, 5);
assert.ok(approxEqual(shrLargeN, 4.5, 0.05), 'Large n should converge to observed mean');

assert.equal(clampMean(0.5), 1, 'Clamp lower bound to 1');
assert.equal(clampMean(5.6), 5, 'Clamp upper bound to 5');
assert.equal(clampMean(3.2), 3.2, 'Clamp should keep in-range values');

assert.equal(effectiveN(0), 0, 'effectiveN(0) should be zero');
assert.equal(effectiveN(12.5), 12.5, 'effectiveN should act as identity over sum of weights');

console.info('[Diary Tests] PASS — decay math helpers stable.');
