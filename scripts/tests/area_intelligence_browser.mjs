#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
const harnessPath = path.resolve('dist/area-intelligence-smoke.html');
const harness = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/${entry.css[0]}"></head><body>
<main style="max-width:760px;margin:24px auto;padding:12px">
<section id="area-intelligence" class="area-intelligence residential-stability" aria-labelledby="area-intelligence-title" data-model-status="loading">
<div class="area-intelligence__heading residential-stability__heading"><p class="crime-summary__eyebrow" data-i18n="areaIntelligence.eyebrow">Area Intelligence evidence</p>
<h1 id="area-intelligence-title" data-i18n="areaIntelligence.title">Read the historical count</h1>
<p data-i18n="areaIntelligence.subtitle">Understand admitted reported-incident counts before checking why prediction is unavailable.</p></div>
<div data-area-intelligence-content aria-live="polite"></div></section></main>
<script type="module">import { updateAreaIntelligence } from '/${areaIntelligence.file}';
window.areaIntelligenceSmoke=updateAreaIntelligence;</script>
</body></html>`;
const consoleErrors = [];
const pageErrors = [];
const requestedBaselines = [];

await runBrowserSuite({
  prepare: () => writeFile(harnessPath, harness, 'utf8'),
  createPreview: () => preview({ preview: { host: '127.0.0.1', port: 4198, strictPort: true } }),
  launchBrowser: () => chromium.launch({ headless: true }),
  createContext: (browser) => browser.newContext({ viewport: { width: 1120, height: 800 } }),
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

    assert.equal(await card.getAttribute('data-model-status'), 'not-promoted');
    assert.equal(await card.getAttribute('data-unavailable-reason'), 'promotion-gate-not-passed');
    const englishText = await card.innerText();
    assert.match(englishText, /Reported incident aggregate count/i);
    assert.match(englishText, /Source as of[\s\S]*2026-08-28/i);
    assert.match(englishText, /2006-01-01 through 2026-08-29 \(exclusive end\)/i);
    assert.match(englishText, /Hundred-block source precision/i);
    assert.match(englishText, /UTC Monday 00:00 inclusive to the next Monday exclusive/i);
    assert.match(englishText, /admitted tract-weeks[\s\S]*admitted grid-weeks/i);
    assert.match(englishText, /2 km separation/i);
    assert.match(englishText, /ambiguous, unmapped, or unavailable spatial assignments/i);
    assert.match(englishText, /All 64 fit states were non-converged/i);
    assert.match(englishText, /90% prediction interval[\s\S]*about 90%/i);
    assert.match(englishText, /no zero forecast or hidden fallback[\s\S]*default value, prediction, or legacy v1/i);
    assert.equal(await card.locator('.area-intelligence__forecast').count(), 0);
    assert.equal(await card.locator('.area-intelligence__evidence-grid > div').count(), 6);
    const desktopColumns = await columnCount(card.locator('.area-intelligence__evidence-grid'));
    assert.equal(desktopColumns, 2);
    await assertAggregateOnlyDom(card);

    await render(page, validArtifact, 'zh-CN');
    const chineseText = await card.innerText();
    assert.match(chineseText, /报告事件历史聚合计数/);
    assert.match(chineseText, /UTC 周一 00:00/);
    assert.match(chineseText, /人口普查区[\s\S]*固定网格/);
    assert.match(chineseText, /2 公里/);
    assert.match(chineseText, /空间归属模糊、未映射或不可用/);
    assert.match(chineseText, /64 个拟合状态均未收敛/);
    assert.match(chineseText, /90% 预测区间[\s\S]*预计约 90%/);
    assert.match(chineseText, /旧版 v1 降级结果/);
    await assertAggregateOnlyDom(card);

    await page.setViewportSize({ width: 390, height: 780 });
    assert.equal(await columnCount(card.locator('.area-intelligence__evidence-grid')), 1);
    assert.equal(await card.locator('[role="status"]').count(), 1);

    const invalid = servingArtifact();
    invalid.lineage.mart = {};
    const invalidResult = await render(page, invalid, 'en');
    assert.equal(invalidResult.status, 'invalid');
    assert.equal(invalidResult.reason, 'invalid-v2');
    assert.match(await card.innerText(), /v2 baseline failed its contract or lineage check/i);
    assert.doesNotMatch(await card.innerText(), /Reported incident aggregate count/i);

    const legacyResult = await render(page, legacyArtifact());
    assert.equal(legacyResult.status, 'invalid');
    assert.equal(legacyResult.reason, 'legacy-not-current');
    assert.match(await card.innerText(), /legacy v1 artifact may be readable[\s\S]*not used as a fallback/i);
    assert.doesNotMatch(await card.innerText(), /Reported incident aggregate count/i);

    const hostileModelCount = servingArtifact();
    hostileModelCount.forecast = {
      status: 'available',
      reason: 'promotion-gate-not-passed',
      predictions: [{ predicted_reported_incident_count: 0 }],
    };
    const hostileResult = await render(page, hostileModelCount);
    assert.equal(hostileResult.status, 'invalid');
    assert.doesNotMatch(await card.innerText(), /Modeled reported-incident count|\b0\b/i);
    assert.equal(await card.locator('.area-intelligence__evidence-grid').count(), 0);
    await assertAggregateOnlyDom(card);

    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
    process.stdout.write('[Area Intelligence Browser] PASS - en/zh, desktop/mobile, v2-only missing/invalid/no-promotion, aggregate history/model boundary, zero console/page errors.\n');
  },
});

async function render(page, artifact, language) {
  return page.evaluate(async ({ value, requestedLanguage }) => window.areaIntelligenceSmoke({
    language: requestedLanguage,
    fetchArtifact: async () => value,
  }), { value: artifact, requestedLanguage: language });
}

async function columnCount(locator) {
  return locator.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
}

async function assertAggregateOnlyDom(card) {
  const text = await card.innerText();
  assert.doesNotMatch(text, /\b(score|rank|winner|safest|current[- ]risk)\b/i);
  assert.doesNotMatch(text, /评分|排名|优胜|最安全|当前风险/);
  assert.doesNotMatch(text, /source_record_id|raw event|canonical event|street address|event coordinates/i);
}

function servingArtifact() {
  return {
    schema: 'engagement-area-intelligence-serving/v2',
    generated_at: '2026-08-29T00:00:00.000Z',
    status: 'not-promoted',
    historical_evidence: {
      status: 'available',
      measure: 'PPD reported incidents',
      source_as_of: '2026-08-28T00:00:00.000Z',
      source_vintage: `sha256:${'1'.repeat(64)}`,
      coverage: {
        earliest_scope_start: '2006-01-01',
        latest_scope_end_exclusive: '2026-08-29',
        complete_week_end_exclusive: '2026-08-24',
      },
      method: {
        grain: 'spatial-unit-week',
        week_definition: 'UTC Monday 00:00 inclusive to next Monday exclusive',
        unit_types: ['tract', 'fixed-grid'],
        spatial_holdout_from_count_model_training: true,
        incomplete_source_week_excluded: true,
        ambiguous_or_unavailable_spatial_assignments_excluded: true,
      },
    },
    forecast: { status: 'unavailable', reason: 'promotion-gate-not-passed', predictions: [] },
    evaluation: {
      promotion_status: 'not-promoted',
      decision: 'no-promotion',
      selected_model: null,
      local_candidate_model: null,
      local_candidate_only: true,
      interval_90_outcome: { passed: false, failed_primary_slice_count: 64 },
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
      protocol: { schema: 'engagement-area-intelligence-evaluation-protocol/v2', sha256: 'a'.repeat(64) },
      evaluation: { schema: 'engagement-area-intelligence-evaluation-run/v2', manifest_sha256: 'b'.repeat(64) },
      mart: {
        schema: 'engagement-area-intelligence-feature-mart/v2',
        manifest_sha256: 'c'.repeat(64),
        artifact_identity: `sha256:${'d'.repeat(64)}`,
        part_bindings_identity: `sha256:${'e'.repeat(64)}`,
      },
      m1_receipt: {
        schema: 'engagement-phl-crime-warehouse-receipt/v3',
        identity: `sha256:${'f'.repeat(64)}`,
        sha256: `sha256:${'0'.repeat(64)}`,
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
