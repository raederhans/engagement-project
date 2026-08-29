#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

import { runBrowserSuite } from '../lib/browser_suite_lifecycle.mjs';

const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const charts = manifest['src/charts/index.js'];
const entry = manifest['index.html'];
assert.ok(charts?.file, 'Area Intelligence browser smoke requires the built Charts chunk');
const areaIntelligenceKey = charts.dynamicImports?.find((key) => key.endsWith('src/area_intelligence/view.js'));
const areaIntelligence = manifest[areaIntelligenceKey];
assert.ok(areaIntelligence?.file, 'Area Intelligence browser smoke requires its production lazy chunk');
assert.ok(entry?.css?.[0], 'Area Intelligence browser smoke requires the production stylesheet');
const sourceMtime = (await stat('src/area_intelligence/view.js')).mtimeMs;
const builtMtime = (await stat(path.resolve('dist', areaIntelligence.file))).mtimeMs;
assert.ok(builtMtime >= sourceMtime, 'Area Intelligence browser smoke requires build:manifest after current source changes');

const harnessPath = path.resolve('dist/area-intelligence-smoke.html');
const harness = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/${entry.css[0]}"></head><body>
<main style="max-width:760px;margin:24px auto;padding:12px">
<section id="area-intelligence" class="area-intelligence residential-stability" aria-labelledby="area-intelligence-title" data-model-status="loading">
<div class="area-intelligence__heading residential-stability__heading"><p class="crime-summary__eyebrow" data-i18n="areaIntelligence.eyebrow">Area Intelligence evidence</p>
<h1 id="area-intelligence-title" data-i18n="areaIntelligence.title">Read the historical ledger</h1>
<p data-i18n="areaIntelligence.subtitle">Review the complete-coverage admission ledger before checking why no forecast is available.</p></div>
<div data-area-intelligence-content aria-live="polite"></div></section></main>
<script type="module">import { updateAreaIntelligence } from '/${areaIntelligence.file}';
window.areaIntelligenceSmoke=updateAreaIntelligence;</script>
</body></html>`;
const consoleErrors = [];
const pageErrors = [];
const requestedBaselines = [];
const matrix = [
  { name: 'en desktop', language: 'en', viewport: { width: 1120, height: 800 } },
  { name: 'en mobile', language: 'en', viewport: { width: 390, height: 780 } },
  { name: 'zh desktop', language: 'zh-CN', viewport: { width: 1120, height: 800 } },
  { name: 'zh mobile', language: 'zh-CN', viewport: { width: 390, height: 780 } },
];

await runBrowserSuite({
  prepare: () => writeFile(harnessPath, harness, 'utf8'),
  createPreview: () => preview({ preview: { host: '127.0.0.1', port: 4198, strictPort: true } }),
  launchBrowser: () => chromium.launch({ headless: true }),
  createContext: (browser) => browser.newContext({ viewport: matrix[0].viewport }),
  configurePage: (page) => {
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      if (/area_intelligence_baseline\.v[12]\.json$/.test(request.url())) requestedBaselines.push(request.url());
    });
  },
  cleanupArtifacts: () => rm(harnessPath, { force: true }),
  run: async ({ page }) => {
    const validArtifact = servingArtifact();
    await page.route('**/data/area_intelligence_baseline.v2.json', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(validArtifact),
    }));
    await page.goto('http://127.0.0.1:4198/area-intelligence-smoke.html', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.areaIntelligenceSmoke));

    const card = page.locator('#area-intelligence');
    const missing = await page.evaluate(() => window.areaIntelligenceSmoke({
      fetchArtifact: async () => {
        const error = new Error('Required v2 fixture is absent.');
        error.code = 'missing-v2';
        throw error;
      },
    }));
    assert.equal(missing.status, 'invalid');
    assert.equal(missing.reason, 'missing-v2');
    assert.equal(await card.getAttribute('data-unavailable-reason'), 'missing-v2');
    assert.match(await card.innerText(), /required v2 baseline was not found/i);
    assert.equal(requestedBaselines.length, 0);

    const currentV2 = await page.evaluate(() => window.areaIntelligenceSmoke({ language: 'en' }));
    assert.equal(currentV2.status, 'not-promoted');
    assert.equal(requestedBaselines.length, 1);
    assert.match(requestedBaselines[0], /area_intelligence_baseline\.v2\.json$/);

    for (const scenario of matrix) {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.setViewportSize(scenario.viewport);
      const result = await render(page, validArtifact, scenario.language);
      assert.equal(result.status, 'not-promoted', scenario.name);
      await assertMatrixState({ card, page, scenario });
      process.stdout.write(`[Area Intelligence Browser] PASS - ${scenario.name}.\n`);
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(matrix[1].viewport);
    await render(page, validArtifact, 'en');
    const reducedMotion = await card.evaluate((element) => {
      const content = element.querySelector('.area-intelligence__content');
      const unavailable = element.querySelector('.area-intelligence__unavailable');
      return {
        contentAnimation: getComputedStyle(content).animationName,
        contentDuration: getComputedStyle(content).animationDuration,
        unavailableTransition: getComputedStyle(unavailable).transitionDuration,
      };
    });
    assert.equal(reducedMotion.contentAnimation, 'none');
    assert.ok(seconds(reducedMotion.contentDuration) <= 0.01);
    assert.ok(seconds(reducedMotion.unavailableTransition) <= 0.01);

    const invalid = servingArtifact();
    invalid.lineage.mart = {};
    const invalidResult = await render(page, invalid, 'en');
    assert.equal(invalidResult.status, 'invalid');
    assert.equal(invalidResult.reason, 'invalid-v2');
    assert.match(await card.innerText(), /v2 baseline failed its contract or lineage check/i);
    assert.doesNotMatch(await card.innerText(), /canonical rows seen/i);

    const legacyResult = await render(page, legacyArtifact(), 'en');
    assert.equal(legacyResult.status, 'invalid');
    assert.equal(legacyResult.reason, 'legacy-not-current');
    assert.match(await card.innerText(), /legacy v1 artifact may be readable[\s\S]*not used as a fallback/i);

    const hostileModelCount = servingArtifact();
    hostileModelCount.forecast = {
      status: 'available',
      reason: 'promotion-gate-not-passed',
      predictions: [{ predicted_reported_incident_count: 0 }],
    };
    const hostileResult = await render(page, hostileModelCount, 'en');
    assert.equal(hostileResult.status, 'invalid');
    assert.doesNotMatch(await card.innerText(), /\b0\b/i);
    assert.equal(await card.locator('.area-intelligence__ledger-grid').count(), 0);

    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
    process.stdout.write('[Area Intelligence Browser] PASS - v2-only missing/invalid/legacy/model boundary and reduced motion.\n');
  },
});

async function assertMatrixState({ card, page, scenario }) {
  const text = await card.innerText();
  assert.equal(await card.getAttribute('data-model-status'), 'not-promoted', scenario.name);
  assert.equal(await card.getAttribute('data-unavailable-reason'), 'promotion-gate-not-passed', scenario.name);
  assert.equal(await card.locator('.area-intelligence__ledger-grid > div').count(), 9, scenario.name);
  assert.equal(await card.locator('.area-intelligence__fit-states .area-intelligence__gate-facts > div').count(), 4, scenario.name);
  assert.match(text, /PPD reported incident count/);
  assert.match(text, /3,586,620/);
  assert.match(text, /2,972,905/);
  assert.match(text, /549,598/);
  assert.match(text, /64,117/);
  assert.match(text, /3,530,212/);
  assert.match(text, /56,408/);
  assert.match(text, /1,611,918/);
  assert.match(text, /hundred-block-generalized/);
  assert.match(text, scenario.language === 'en' ? /2 km separation/ : /2 公里/);
  assert.match(text, scenario.language === 'en' ? /Fit states total/ : /拟合状态总数/);
  assert.match(text, /64/);
  assert.match(text, /28/);
  assert.match(text, scenario.language === 'en'
    ? /Current district and tract selections do not change these values/
    : /当前分局和普查区选择不会改变这些数值/);
  assert.match(text, scenario.language === 'en'
    ? /no forecast or model count is shown/
    : /不展示预测或模型计数/);
  assert.doesNotMatch(text, /\b(score|rank|winner|safest|current[- ]risk)\b/i);
  assert.doesNotMatch(text, /评分|排名|优胜|最安全|当前风险/);
  assert.doesNotMatch(text, /source_record_id|raw event|canonical event|street address|event coordinates/i);
  await assertNoHorizontalOverflow(card);
  const accessibility = await new AxeBuilder({ page })
    .include('#area-intelligence')
    .withTags(['wcag2a', 'wcag2aa'])
    .options({ resultTypes: ['violations'] })
    .analyze();
  const seriousOrCritical = accessibility.violations.filter(
    ({ impact }) => impact === 'serious' || impact === 'critical',
  );
  assert.deepEqual(seriousOrCritical, [], `${scenario.name}: axe serious/critical violations`);
}

async function render(page, artifact, language) {
  return page.evaluate(async ({ value, requestedLanguage }) => window.areaIntelligenceSmoke({
    language: requestedLanguage,
    fetchArtifact: async () => value,
  }), { value: artifact, requestedLanguage: language });
}

async function assertNoHorizontalOverflow(card) {
  const dimensions = await card.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  assert.ok(dimensions.scrollWidth <= dimensions.clientWidth + 1, JSON.stringify(dimensions));
}

function seconds(value) {
  return String(value).split(',').reduce((maximum, token) => {
    const normalized = token.trim();
    const parsed = Number.parseFloat(normalized);
    const multiplier = normalized.endsWith('ms') ? 0.001 : 1;
    return Math.max(maximum, Number.isFinite(parsed) ? parsed * multiplier : 0);
  }, 0);
}

function servingArtifact() {
  return {
    schema: 'engagement-area-intelligence-serving/v2',
    generated_at: '2026-08-29T16:50:24.298Z',
    status: 'not-promoted',
    historical_evidence: {
      status: 'available',
      measure: 'PPD reported incident count',
      source_as_of: '2026-08-27T03:59:00.000Z',
      source_vintage: 'sha256:445f29fc49067e45285125b7f6b391ff4e930bf3f09cdd7e8cc4040b96c2109e',
      coverage: {
        earliest_scope_start: '2006-01-01',
        latest_scope_end_exclusive: '2026-08-28',
        complete_week_end_exclusive: '2026-08-24',
      },
      counts: {
        canonical_rows_seen: 3586620,
        tract: { admitted: 2972905, ambiguous_excluded: 549598, unmapped_excluded: 64117 },
        fixed_grid: { admitted: 3530212, unavailable_excluded: 56408 },
      },
      unit_count: { tract: 408, fixed_grid: 2352 },
      mart_rows: 1611918,
      method: {
        grain: 'spatial-unit-week',
        week_definition: 'UTC Monday 00:00 inclusive to next Monday exclusive',
        unit_types: ['tract', 'fixed-grid'],
        spatial_holdout_from_count_model_training: true,
        incomplete_source_week_excluded: true,
        ambiguous_or_unavailable_spatial_assignments_excluded: true,
        spatial_holdout_block_size_m: 2000,
        source_location_precision: 'hundred-block-generalized',
      },
    },
    forecast: { status: 'unavailable', reason: 'promotion-gate-not-passed', predictions: [] },
    evaluation: {
      promotion_status: 'not-promoted',
      decision: 'no-promotion',
      selected_model: null,
      local_candidate_model: null,
      local_candidate_only: true,
      interval_90_outcome: { passed: false, failed_primary_slice_count: 28 },
      fit_state_outcome: { total: 64, passed: 0, failed: 64, converged_before_iteration_limit: 0 },
      why_unavailable: {
        code: 'promotion-gate-not-passed',
        reason_codes: [
          'promotion-gate-not-passed',
          'primary-interval-90-gate-not-passed',
          'serving-authority-unavailable',
        ],
      },
    },
    authority: {
      local_evaluation: false,
      serving: false,
      product_promotion: false,
      scientific: false,
      causal: false,
      safety: false,
      deletion: false,
    },
    privacy: {
      aggregate_only: true,
      event_level_data_included: false,
      coordinates_included: false,
      generalized_locations_included: false,
      raw_or_canonical_events_included: false,
      source_record_ids_included: false,
    },
    lineage: {
      protocol: {
        schema: 'engagement-area-intelligence-evaluation-protocol/v2',
        sha256: 'sha256:997aaf5389ab401d0a87e74b749ab4079e26315d4bb8787ad4e1b7051b457dde',
      },
      evaluation: {
        schema: 'engagement-area-intelligence-evaluation-run/v2',
        manifest_sha256: 'a761d003b8ba1972dc1b7aa65c0e4e5bb1809651d5461278a0152852a261d04c',
      },
      mart: {
        schema: 'engagement-area-intelligence-feature-mart/v2',
        manifest_sha256: '7846d966ec189666f2fa947c8d94fd326556f4be975a18c9289c9454d3779f6d',
        artifact_identity: 'sha256:df200d11666b314285750a4914eb35f6377c7534aef14bac2fbc2b4419749861',
        part_bindings_identity: 'sha256:afa2acdfc5040dd812861ba1621f5eda5ba95007eae46e841cb315231a9db146',
      },
      m1_receipt: {
        schema: 'engagement-phl-crime-warehouse-receipt/v3',
        identity: 'sha256:bc439541f4c574fa0260f7538cf186f268c66dff98c03b8334969e703d55e315',
        sha256: 'sha256:2735f174cc978ea6abad31519672c58618fe5602cc9dedef918f8d624f523925',
      },
    },
    forbidden_claims: [
      'individual victim probability',
      'absolute safety',
      'safety score',
      'safest area',
      'safest route',
      'causal effect',
    ],
  };
}

function legacyArtifact() {
  return {
    schema: 'engagement-area-intelligence-serving/v1',
    generated_at: '2026-08-21T07:53:40.810Z',
    status: 'not-promoted',
    historical_evidence: {
      status: 'available',
      measure: 'PPD reported incidents',
      coverage: {
        earliest_scope_start: '2006-01-01',
        latest_scope_end_exclusive: '2026-08-22',
        latest_event_at: '2026-08-20T03:47:00.000Z',
      },
      source_vintage: `sha256:${'9'.repeat(64)}`,
      limitations: ['Historical compatibility fixture.'],
    },
    forecast: {
      status: 'unavailable',
      reason: 'model-did-not-exceed-predefined-seasonal-baseline',
      predictions: [],
    },
    evaluation: { promotion_status: 'not-promoted', selected_model: null },
    forbidden_claims: [
      'individual victim probability',
      'absolute safety',
      'safety score',
      'safest area',
      'safest route',
      'causal effect',
    ],
  };
}
