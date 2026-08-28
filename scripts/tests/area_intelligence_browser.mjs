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
<div class="area-intelligence__heading residential-stability__heading"><p class="crime-summary__eyebrow">Area Intelligence baseline</p>
<h1 id="area-intelligence-title">Historical evidence and forecast status</h1></div>
<div data-area-intelligence-content aria-live="polite"></div></section></main>
<script type="module">import { updateAreaIntelligence } from '/${areaIntelligence.file}';
window.areaIntelligenceSmoke=updateAreaIntelligence;</script>
</body></html>`;
const consoleErrors = [];
const pageErrors = [];

await runBrowserSuite({
  prepare: () => writeFile(harnessPath, harness, 'utf8'),
  createPreview: () => preview({ preview: { host: '127.0.0.1', port: 4198, strictPort: true } }),
  launchBrowser: () => chromium.launch({ headless: true }),
  createContext: (browser) => browser.newContext({ viewport: { width: 1120, height: 800 } }),
  configurePage: (page) => {
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  },
  cleanupArtifacts: () => rm(harnessPath, { force: true }),
  run: async ({ page }) => {
  await page.goto('http://127.0.0.1:4198/area-intelligence-smoke.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.areaIntelligenceSmoke));

  await render(page, servingArtifact({ promoted: false }));
  const card = page.locator('#area-intelligence');
  assert.equal(await card.getAttribute('data-model-status'), 'not-promoted');
  assert.match(await card.innerText(), /pre-defined promotion gate did not pass/i);
  assert.match(await card.innerText(), /Unavailable reason: promotion-gate-not-passed/i);
  assert.match(await card.innerText(), /no zero forecast or hidden fallback/i);
  assert.match(await card.innerText(), /Source as of[\s\S]*2026-08-28/i);
  assert.match(await card.innerText(), /2006-01-01 through 2026-08-28 \(exclusive end\)/i);
  assert.match(await card.innerText(), /Synthetic browser fixture; never product evidence/i);
  assert.equal(await card.locator('.area-intelligence__forecast').count(), 0);

  await render(page, servingArtifact({ promoted: true }));
  assert.equal(await card.getAttribute('data-model-status'), 'promoted');
  const promotedText = await card.innerText();
  assert.match(promotedText, /Modeled reported-incident count/i);
  assert.match(promotedText, /90% prediction interval/i);
  assert.match(promotedText, /not individual risk, absolute safety, or a route recommendation/i);
  assert.equal(await card.locator('.area-intelligence__forecast > div').count(), 3);
  const desktopColumns = await card.locator('.area-intelligence__forecast').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  assert.equal(desktopColumns, 3);

  await page.setViewportSize({ width: 390, height: 780 });
  const mobileColumns = await card.locator('.area-intelligence__forecast').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  assert.equal(mobileColumns, 1);
  assert.equal(await card.locator('[role="status"]').count(), 0, 'promoted card must not retain a stale unavailable status');

  const stale = servingArtifact({ promoted: false });
  delete stale.lineage;
  await render(page, stale);
  assert.equal(await card.getAttribute('data-model-status'), 'invalid');
  assert.match(await card.innerText(), /serving lineage or contract failed/i);
  assert.doesNotMatch(await card.innerText(), /Historical charts show admitted/i);
  assert.equal(await card.locator('.area-intelligence__forecast').count(), 0);

  const malformed = servingArtifact({ promoted: false });
  malformed.lineage.mart = {};
  malformed.lineage.m1_receipt = {};
  delete malformed.lineage.evaluation.manifest_sha256;
  await render(page, malformed);
  assert.equal(await card.getAttribute('data-model-status'), 'invalid');
  assert.match(await card.innerText(), /serving lineage or contract failed/i);
  assert.doesNotMatch(await card.innerText(), /Historical charts show admitted/i);
  assert.equal(await card.locator('.area-intelligence__forecast').count(), 0);
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(pageErrors, []);
  process.stdout.write('[Area Intelligence Browser] PASS - current-lineage, promoted/no-promotion/invalid, disclosures, responsive layout, zero console/page errors.\n');
  },
});

async function render(page, artifact) {
  await page.evaluate(async (value) => {
    await window.areaIntelligenceSmoke({
      queryMode: 'tract',
      selectedTractGEOID: '42101007400',
      fetchArtifact: async () => value,
    });
  }, artifact);
}

function servingArtifact({ promoted }) {
  const generatedAt = '2026-08-29T00:00:00.000Z';
  const model = 'negative-binomial-log-link-v1';
  const digest = (character) => `sha256:${character.repeat(64)}`;
  const hash = (character) => character.repeat(64);
  const protocolSha256 = hash('a');
  return {
    schema: 'engagement-area-intelligence-serving/v1', generated_at: generatedAt,
    status: promoted ? 'promoted' : 'not-promoted',
    historical_evidence: {
      status: 'available', measure: 'PPD reported incidents', source_vintage: digest('b'),
      source_as_of: '2026-08-28T00:00:00.000Z',
      coverage: { earliest_scope_start: '2006-01-01', latest_scope_end_exclusive: '2026-08-28' },
      limitations: ['Synthetic browser fixture; never product evidence.'],
    },
    forecast: promoted ? {
      status: 'available', model_version: model,
      predictions: [{
        unit_type: 'tract', unit_id: '42101007400', target_week_start: '2026-08-17',
        predicted_reported_incident_count: 4.2, prediction_interval_90: { lower: 1, upper: 9 },
        trained_through: '2025-08-18', feature_observed_through: '2026-08-17', model_version: model,
        generated_at: generatedAt, source_vintage: digest('b'), limitations: ['Synthetic browser fixture.'],
      }],
    } : {
      status: 'unavailable', reason: 'promotion-gate-not-passed', predictions: [],
    },
    evaluation: {
      promotion_status: promoted ? 'promoted' : 'not-promoted',
      selected_model: promoted ? model : null, audit_model: model, protocol_sha256: protocolSha256,
    },
    lineage: {
      protocol: { schema: 'engagement-area-intelligence-evaluation-protocol/v2', sha256: protocolSha256 },
      evaluation: { schema: 'engagement-area-intelligence-evaluation-run/v2', manifest_sha256: hash('c') },
      mart: {
        schema: 'engagement-area-intelligence-feature-mart/v2', manifest_sha256: hash('d'),
        artifact_identity: digest('e'), part_bindings_identity: digest('f'),
      },
      m1_receipt: { schema: 'engagement-phl-crime-warehouse-receipt/v3', identity: digest('1') },
    },
    forbidden_claims: [
      'individual victim probability', 'absolute safety', 'safety score',
      'safest area', 'safest route', 'causal effect',
    ],
  };
}
