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
const areaIntelligenceJavaScriptInputs = [
  'src/area_intelligence/view.js',
  'src/area_intelligence/serving_contract.js',
  'src/i18n/index.js',
  'src/i18n/messages.js',
  'src/i18n/area_intelligence.js',
];
const areaIntelligenceStyleInput = 'src/styles/crime-charts-responsive.css';
const trackedArtifactPath = 'public/data/area_intelligence_baseline.v2.json';
const builtArtifactPath = 'dist/data/area_intelligence_baseline.v2.json';
const builtJavaScriptMtime = (await stat(path.resolve('dist', areaIntelligence.file))).mtimeMs;
const builtStyleMtime = (await stat(path.resolve('dist', entry.css[0]))).mtimeMs;
for (const input of areaIntelligenceJavaScriptInputs) {
  assert.ok(
    builtJavaScriptMtime >= (await stat(input)).mtimeMs,
    `Area Intelligence browser smoke requires build:manifest after ${input} changes`,
  );
}
assert.ok(
  builtStyleMtime >= (await stat(areaIntelligenceStyleInput)).mtimeMs,
  `Area Intelligence browser smoke requires build:manifest after ${areaIntelligenceStyleInput} changes`,
);
const trackedArtifactBytes = await readFile(trackedArtifactPath);
assert.deepEqual(
  await readFile(builtArtifactPath),
  trackedArtifactBytes,
  'Area Intelligence browser smoke requires dist to contain the exact tracked v2 artifact',
);
const trackedArtifact = JSON.parse(trackedArtifactBytes);

const harnessPath = path.resolve('dist/area-intelligence-smoke.html');
const harness = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="./${entry.css[0]}"></head><body>
<main style="max-width:760px;margin:24px auto;padding:12px">
<section id="area-intelligence" class="area-intelligence residential-stability" aria-labelledby="area-intelligence-title" data-model-status="loading">
<div class="area-intelligence__heading residential-stability__heading"><p class="crime-summary__eyebrow" data-i18n="areaIntelligence.eyebrow">Area Intelligence evidence</p>
<h1 id="area-intelligence-title" data-i18n="areaIntelligence.title">Read the historical ledger</h1>
<p data-i18n="areaIntelligence.subtitle">Review the complete-coverage admission ledger before checking why no forecast is available.</p></div>
<div data-area-intelligence-content aria-live="polite"></div></section></main>
<script type="module">import { updateAreaIntelligence } from './${areaIntelligence.file}';
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
  run: async ({ page, server }) => {
    const baseUrl = new URL(server.config.base, server.resolvedUrls.local[0]);
    await page.goto(new URL('area-intelligence-smoke.html', baseUrl).href, { waitUntil: 'networkidle' });
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
      const result = await renderCurrent(page, scenario.language);
      assert.equal(result.status, 'not-promoted', scenario.name);
      await assertMatrixState({ card, page, scenario });
      process.stdout.write(`[Area Intelligence Browser] PASS - ${scenario.name}.\n`);
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(matrix[1].viewport);
    await renderCurrent(page, 'en');
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

    const invalid = structuredClone(trackedArtifact);
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

    const hostileModelCount = structuredClone(trackedArtifact);
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
  if (scenario.language === 'en') {
    assert.match(text, /Source as of[\s\S]*2026-08-27T03:59:00\.000Z/);
    assert.match(text, /Coverage[\s\S]*2006-01-01 through 2026-08-28 \(exclusive end\)/);
    assert.match(text, /Complete weeks through[\s\S]*Before 2026-08-24/);
    assert.match(text, /Analysis geometry[\s\S]*Census tract and fixed grid/);
    assert.match(text, /Week: UTC Monday 00:00 inclusive to next Monday exclusive/);
    assert.match(text, /Tract and fixed-grid are kept as separate spatial-unit-week denominators/);
    assert.match(text, /Exclusions: incomplete weeks and ambiguous, unmapped, or unavailable spatial assignments are not counted/);
    assert.match(text, /It would not establish a person-level probability or a comparative safety conclusion/);
  } else {
    assert.match(text, /来源截至[\s\S]*2026-08-27T03:59:00\.000Z/);
    assert.match(text, /覆盖范围[\s\S]*2006-01-01 至 2026-08-28（不含结束日）/);
    assert.match(text, /完整周截至[\s\S]*2026-08-24 之前/);
    assert.match(text, /分析几何[\s\S]*人口普查区与固定网格/);
    assert.match(text, /周定义：UTC Monday 00:00 inclusive to next Monday exclusive/);
    assert.match(text, /人口普查区与固定网格保持为独立的 spatial-unit-week 分母/);
    assert.match(text, /排除项：不完整周，以及空间归属模糊、未映射或不可用的记录均不计入/);
    assert.match(text, /它不能确定个人层面的概率或比较性的安全结论/);
  }
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

async function renderCurrent(page, language) {
  return page.evaluate(async (requestedLanguage) => window.areaIntelligenceSmoke({
    language: requestedLanguage,
  }), language);
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
