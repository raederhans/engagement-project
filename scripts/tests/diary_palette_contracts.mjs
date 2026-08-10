#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const segmentsUrl = new URL('../../src/map/segments_layer.js', import.meta.url);
const diaryRouteUrl = new URL('../../src/routes_diary/index.js', import.meta.url);
const LEGACY_SAFETY_COLORS = /#(?:f87171|fbbf24|34d399|10b981)\b/i;

function constantBlock(source, name) {
  const match = new RegExp(`const ${name} = \\[[\\s\\S]*?\\n\\];`).exec(source);
  assert.ok(match, `${name} must remain a readable array expression`);
  return match[0];
}

function colorsIn(block) {
  return [...block.matchAll(/#[0-9a-f]{6}\b/gi)].map((match) => match[0].toLowerCase());
}

test('segment rating bins preserve thresholds and use a neutral ordered experience palette', async () => {
  const source = await readFile(segmentsUrl, 'utf8');
  const block = constantBlock(source, 'COLOR_BINS');

  assert.deepEqual(colorsIn(block), ['#64748b', '#3b82f6', '#7c3aed', '#5b21b6']);
  assert.deepEqual(
    [...block.matchAll(/max:\s*([^,}\s]+)/g)].map((match) => match[1]),
    ['2.5', '3.4', '4.25', 'Infinity'],
  );
  assert.match(block, /low experience rating/i);
  assert.match(block, /middle experience rating/i);
  assert.match(block, /high experience rating/i);
  assert.match(block, /highest experience rating/i);
  assert.doesNotMatch(block, LEGACY_SAFETY_COLORS);
  assert.doesNotMatch(block, /\/\/\s*(?:risky|caution|safer|safest)\b/i);
});

test('route rating expression keeps its data thresholds and uses the same neutral palette order', async () => {
  const source = await readFile(diaryRouteUrl, 'utf8');
  const block = constantBlock(source, 'ROUTE_EXPERIENCE_RATING_EXPRESSION');

  assert.doesNotMatch(source, /ROUTE_SAFETY_EXPRESSION/);
  assert.deepEqual(colorsIn(block), ['#7c3aed', '#3b82f6', '#64748b']);
  assert.match(block, /\['get', 'overlay_safety'\]/);
  assert.match(block, /\], 4\]/);
  assert.match(block, /\], 2\.5\]/);
  assert.doesNotMatch(block, LEGACY_SAFETY_COLORS);
});
