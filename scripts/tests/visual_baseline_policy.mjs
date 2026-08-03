#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const platforms = ['win32', 'linux'];
const projects = ['desktop', 'portrait', 'landscape'];
const baselines = [
  'crime-analysis.png',
  'crime-incident-results.png',
  'diary-live.png',
  'diary-insights-expanded.png',
  'crime-help-data-details.png',
  'diary-my-routes-empty.png',
  'diary-sample-community.png',
  'diary-rating-step-1.png',
  'diary-rating-step-2.png',
  'diary-my-routes-recorded.png',
  'diary-sample-community-zh.png',
];

const fixtureUrl = new URL('./support/deterministic_browser_fixture.mjs', import.meta.url);
const [fixture, config, experienceSpec] = await Promise.all([
  readFile(fixtureUrl, 'utf8'),
  readFile(new URL('../../playwright.config.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./visual_experience.spec.mjs', import.meta.url), 'utf8'),
]);
assert.match(fixture, /toHaveScreenshot\(/, 'visual experience tests must compare screenshots');
assert.doesNotMatch(fixture, /PLAYWRIGHT_VISUAL_COMPARE/, 'CI comparison must not be optional');
assert.doesNotMatch(fixture, /\bmask\s*[:,]/, 'a full-map mask can obscure the product UI');
assert.match(fixture, /maxDiffPixelRatio\s*=\s*0\.005/, 'the default screenshot budget must remain at 0.5%');
assert.match(
  experienceSpec,
  /captureExperienceScreenshot\(\s*page,\s*testInfo,\s*'diary-sample-community-zh',\s*\{ maxDiffPixelRatio: 0\.01 \},\s*\)/,
  'only the CJK cross-runner snapshot may use the explicit 1% glyph-rasterization budget',
);
assert.match(config, /snapshotPathTemplate:[^\n]*\{platform\}/, 'snapshot baselines must be platform-specific');

let verified = 0;
for (const platform of platforms) {
  for (const project of projects) {
    for (const baseline of baselines) {
      const url = new URL(`./__screenshots__/visual_experience.spec.mjs/${platform}/${project}/${baseline}`, import.meta.url);
      const bytes = await readFile(url);
      const metadata = await stat(url);
      assert.deepEqual(
        [...bytes.subarray(0, 8)],
        [137, 80, 78, 71, 13, 10, 26, 10],
        `${platform}/${project}/${baseline} must be a PNG`,
      );
      assert.ok(metadata.size > 3_000, `${platform}/${project}/${baseline} is too small to represent the UI`);
      verified += 1;
    }
  }
}

console.log(`[Visual Baselines] PASS - ${verified} platform-specific deterministic UI baselines verified.`);
