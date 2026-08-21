#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

const PORT = 4189;
const OUTPUT_DIR = '.dfev1/home-neighborhood-compare/m3-v1/browser';
await mkdir(OUTPUT_DIR, { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: PORT, strictPort: true } });
const baseUrl = new URL(server.config.base, server.resolvedUrls.local[0]);
baseUrl.searchParams.set('view', 'list');
baseUrl.searchParams.set('hc', JSON.stringify({
  schema: 'engagement-home-compare-share/v1',
  weights: { property: 20, costHistory: 20, civicRecords: 20, transportContext: 20, dataQuality: 20 },
  dimensions: ['property'],
  address: '<img src=x onerror=alert(1)>',
}));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl.origin });
await installSyntheticRoutes(context);
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto(baseUrl.href, { waitUntil: 'networkidle' });
  if (await page.locator('html').getAttribute('lang') !== 'en') {
    await page.locator('.language-switch').click();
    await page.waitForFunction(() => document.documentElement.lang === 'en');
  }
  const opener = page.locator('[data-home-compare-open]');
  const dialog = page.locator('[data-home-compare-dialog]');
  await opener.waitFor({ state: 'visible' });
  assert.equal(await page.locator('body').getAttribute('data-crime-view'), 'list');

  await opener.click();
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await dialog.evaluate((element) => element.open), true);
  assert.equal(await dialog.evaluate((element) => element.matches(':modal')), true);
  assert.equal(await dialog.locator('[data-home-address="0"]').evaluate((element) => document.activeElement === element), true);
  assert.match(await dialog.locator('[data-home-status]').innerText(), /Invalid shared settings were rejected/i);
  assert.match(await dialog.locator('#home-compare-description').innerText(), /used ephemerally to query the listed official public sources/i);
  assert.match(await dialog.locator('#home-compare-description').innerText(), /commute destinations remain in this session/i);
  assert.equal(await dialog.locator('img, script').count(), 0, 'malicious share state must not create HTML elements');

  await fillAddresses(dialog, 2);
  await dialog.locator('[data-home-destinations]').fill('SYNTHETIC DESTINATION A\nSYNTHETIC DESTINATION B');
  await dialog.locator('[data-home-address="0"]').focus();
  await page.keyboard.press('Tab');
  assert.equal(await dialog.locator('[data-home-address="1"]').evaluate((element) => document.activeElement === element), true);
  await runComparison(dialog, 2);
  const unavailableMetrics = await dialog.locator('[data-evidence-status="unavailable"]').allInnerTexts();
  assert.deepEqual(unavailableMetrics, [], `unexpected unavailable profile metrics: ${JSON.stringify(unavailableMetrics)}`);
  assert.match(await dialog.innerText(), /Forecast remains unavailable/i);
  assert.match(await dialog.innerText(), /did not exceed the predefined seasonal baseline/i);
  assert.match(await dialog.innerText(), /Travel-time and isochrone summary unavailable/i);
  assert.match(await dialog.innerText(), /does not calculate a safety score, rank homes, or recommend a home/i);
  assert.equal(await dialog.locator('[data-home-profile]').count(), 2);
  await dialog.locator('[data-home-profile="1"] .home-compare__metric').first().click();
  const drilldown = await dialog.locator('[data-home-profile="1"] .home-compare__metric').first().innerText();
  assert.match(drilldown, /Data as of/i);
  assert.match(drilldown, /Coverage/i);
  assert.match(drilldown, /Precision \/ uncertainty/i);
  assert.match(drilldown, /Official source/i);

  await dialog.locator('[data-home-add]').click();
  await fillAddress(dialog, 2);
  await runComparison(dialog, 3);
  assert.equal(await dialog.locator('[data-home-profile]').count(), 3);
  const third = dialog.locator('[data-home-profile="3"]');
  assert.match(await third.innerText(), /Unavailable—not zero/i);
  assert.equal(await third.locator('[data-evidence-status="unavailable"]').count(), 1);

  await dialog.locator('[data-home-add]').click();
  await fillAddress(dialog, 3);
  await dialog.locator('[data-home-weight="property"]').fill('60');
  await runComparison(dialog, 4);
  assert.equal(await dialog.locator('[data-home-profile]').count(), 4);
  assert.match(await dialog.locator('.home-compare__sensitivity').innerText(), /Property: 42\.9%/i);
  assert.match(await dialog.locator('.home-compare__sensitivity').innerText(), /changes evidence order only/i);

  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set('a', '-75.1652,39.9526');
    url.searchParams.set('b', '-75.1720,39.9490');
    url.searchParams.set('labelA', 'SYNTHETIC PRIVATE ADDRESS A');
    url.searchParams.set('labelB', 'SYNTHETIC PRIVATE ADDRESS B');
    history.replaceState({}, '', url);
  });
  await dialog.locator('[data-home-share]').click();
  await page.waitForFunction(() => document.querySelector('[data-home-status]')?.textContent?.includes('Privacy-safe'));
  const sharedUrl = new URL(page.url());
  assert.deepEqual([...sharedUrl.searchParams.keys()], ['hc']);
  const shared = sharedUrl.searchParams.get('hc');
  const sharedValue = JSON.parse(shared);
  assert.deepEqual(Object.keys(sharedValue).sort(), ['dimensions', 'schema', 'weights']);
  assert.equal(Object.keys(sharedValue.weights).length, 5);
  assert.doesNotMatch(shared, /SYNTHETIC|address|destination|coordinate|parcel/i);

  await page.screenshot({ path: `${OUTPUT_DIR}/desktop-en-synthetic.png`, fullPage: true });
  await dialog.locator('[data-home-close]').click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await opener.evaluate((element) => document.activeElement === element), true);

  await page.locator('.language-switch').click();
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await opener.click();
  await dialog.getByRole('heading', { name: '并排比较 2–4 个费城住宅' }).waitFor();
  assert.match(await dialog.locator('#home-compare-description').innerText(), /地址、坐标和 parcel ID 仅临时用于查询列出的官方公共来源/);
  assert.match(await dialog.locator('#home-compare-description').innerText(), /通勤目的地只保留在本次会话中/);
  assert.match(await dialog.innerText(), /预测继续不可用/);
  assert.match(await dialog.innerText(), /通勤时间与 isochrone 不可用/);
  assert.match(await dialog.innerText(), /不计算 safety score、不排名，也不推荐住宅/);
  await dialog.locator('[data-home-close]').click();
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('.language-switch').click();
  await page.waitForFunction(() => document.documentElement.lang === 'en');

  await page.setViewportSize({ width: 390, height: 844 });
  await opener.click();
  await dialog.waitFor({ state: 'visible' });
  const mobileLayout = await page.evaluate(() => {
    const activeDialog = document.querySelector('[data-home-compare-dialog]');
    const surface = document.querySelector('.home-compare__surface');
    const grid = document.querySelector('.home-compare__profile-grid');
    const dialogRect = activeDialog.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      dialogLeft: dialogRect.left,
      dialogRight: dialogRect.right,
      dialogOverflow: activeDialog.scrollWidth - activeDialog.clientWidth,
      surfaceOverflow: surface.scrollWidth - surface.clientWidth,
      profileColumns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
    };
  });
  assert.ok(mobileLayout.documentOverflow <= 1, JSON.stringify(mobileLayout));
  assert.ok(mobileLayout.dialogLeft >= -1, JSON.stringify(mobileLayout));
  assert.ok(mobileLayout.dialogRight <= mobileLayout.viewportWidth + 1, JSON.stringify(mobileLayout));
  assert.ok(mobileLayout.dialogOverflow <= 1, JSON.stringify(mobileLayout));
  assert.ok(mobileLayout.surfaceOverflow <= 1, JSON.stringify(mobileLayout));
  assert.equal(mobileLayout.profileColumns, 1, JSON.stringify(mobileLayout));
  await page.screenshot({ path: `${OUTPUT_DIR}/mobile-en-synthetic.png`, fullPage: true });

  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({
    status: 'pass',
    profiles: [2, 3, 4],
    languages: ['en', 'zh-CN'],
    shareState: 'weights-and-dimensions-only',
    sourceStates: ['partial', 'unavailable'],
    forecast: 'not-promoted/unavailable',
    commute: 'unavailable',
    consoleErrors: consoleErrors.length,
    pageErrors: pageErrors.length,
    mobileLayout,
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve, reject) => {
    server.httpServer.close((error) => (error ? reject(error) : resolve()));
  });
}

async function runComparison(dialog, count) {
  await dialog.locator('[data-home-run]').click();
  await dialog.locator(`[data-home-profile="${count}"]`).waitFor({ state: 'visible' });
  assert.equal(await dialog.locator('[data-home-profile]').count(), count);
}

async function fillAddresses(dialog, count) {
  for (let index = 0; index < count; index += 1) await fillAddress(dialog, index);
}

async function fillAddress(dialog, index) {
  await dialog.locator(`[data-home-address="${index}"]`).fill(`${100 + index} SYNTHETIC FIXTURE ST`);
}

async function installSyntheticRoutes(context) {
  await context.route(/citygeo-geocoder-pub\.databridge\.phila\.gov\/.*\/Address_Locator\/GeocodeServer\/findAddressCandidates/i, async (route) => {
    const input = new URL(route.request().url()).searchParams.get('Street') || '';
    const index = syntheticIndex(input);
    await json(route, {
      candidates: [{
        address: `${100 + index} SYNTHETIC FIXTURE ST`,
        score: 100,
        location: { x: -75.16 + index * 0.001, y: 39.95 + index * 0.001 },
        attributes: {
          Score: 100,
          Match_addr: `${100 + index} SYNTHETIC FIXTURE ST`,
          House: String(100 + index),
          ZIP: '19100',
          Addr_type: 'PointAddress',
          Ref_ID: `synthetic-fixture-${index}`,
        },
      }],
    });
  });

  await context.route('https://phl.carto.com/api/v2/sql', async (route) => {
    const request = route.request();
    const query = new URLSearchParams(request.postData() || new URL(request.url()).search.slice(1)).get('q') || '';
    if (/MIN\(dispatch_date_time/i.test(query)) {
      await json(route, { rows: [{ min_dt: '2006-01-01', max_dt: '2026-08-20' }] });
      return;
    }
    if (/FROM opa_properties_public/i.test(query)) {
      const index = syntheticIndex(query);
      await json(route, { rows: [propertyRow(index)] });
      return;
    }
    if (/FROM assessments/i.test(query)) {
      await json(route, { rows: [{ year: 2026, market_value: 250000, taxable_land: 50000, taxable_building: 200000, exempt_land: 0, exempt_building: 0 }] });
      return;
    }
    if (/FROM rtt_summary/i.test(query)) {
      await json(route, { rows: [{ document_type: 'DEED', display_date: '2024-01-03', recording_date: '2024-01-04', document_date: '2024-01-02', adjusted_total_consideration: 225000, matched_regmap: true, discrepancy: null, property_count: 1 }] });
      return;
    }
    if (/FROM public_cases_fc/i.test(query)) {
      await json(route, { rows: [{ record_count: 12, open_count: 2, earliest_at: '2025-01-01', latest_at: '2026-08-20' }] });
      return;
    }
    if (/FROM violations/i.test(query)) {
      await json(route, { rows: [{ record_count: 2, not_closed_count: 1, latest_at: '2026-08-19' }] });
      return;
    }
    if (/FROM business_licenses/i.test(query)) {
      await json(route, { rows: [{ record_count: 1, active_count: 1, latest_at: '2026-08-18' }] });
      return;
    }
    if (/FROM case_investigations/i.test(query)) {
      await json(route, { rows: [{ record_count: 1, not_closed_count: 0, latest_at: '2026-08-17' }] });
      return;
    }
    if (/FROM incidents_part1_part2/i.test(query)) {
      await json(route, { rows: [{ n: 7 }] });
      return;
    }
    await json(route, { rows: [] });
  });

  await context.route(/Vacant_Indicators_Bldg\/FeatureServer\/0\/query/i, async (route) => {
    const where = new URL(route.request().url()).searchParams.get('where') || '';
    if (where.includes("'123456792'")) {
      await json(route, { features: null, error: { code: 'synthetic-unavailable' } });
      return;
    }
    await json(route, { features: [{ attributes: { build_rank: 72, date_update: Date.parse('2026-08-17T00:00:00Z') } }] });
  });
  await context.route(/high_injury_network_2025\/FeatureServer\/0\/query/i, (route) => json(route, { count: 1 }));
}

function propertyRow(index) {
  return {
    parcel_number: String(123456790 + index),
    location: `${100 + index} SYNTHETIC FIXTURE ST`,
    lon: -75.16 + index * 0.001,
    lat: 39.95 + index * 0.001,
    assessment_date: '2026-01-01T00:00:00Z',
    market_value: 250000 + index * 10000,
    market_value_date: '2026-01-01T00:00:00Z',
    sale_date: '2024-01-03T00:00:00Z',
    sale_price: 225000 + index * 10000,
    recording_date: '2024-01-04T00:00:00Z',
    total_livable_area: 1400 + index * 50,
    number_of_bedrooms: 3,
    number_of_bathrooms: 2,
    year_built: 1920 + index,
    zoning: 'RSA5',
  };
}

function syntheticIndex(value) {
  const match = String(value).match(/(10[0-3])\s+SYNTHETIC FIXTURE ST/i);
  return match ? Number(match[1]) - 100 : 0;
}

async function json(route, body) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}
