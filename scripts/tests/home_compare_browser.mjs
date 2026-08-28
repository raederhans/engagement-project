#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

import { runBrowserSuite } from '../lib/browser_suite_lifecycle.mjs';

const PORT = 4189;
const OUTPUT_DIR = '.dfev1/home-neighborhood-compare/m3-v1/browser';
const consoleErrors = [];
const pageErrors = [];
const networkRequests = [];
const PRIVATE_VALUES = [
  '100 SYNTHETIC FIXTURE ST',
  '101 SYNTHETIC FIXTURE ST',
  '102 SYNTHETIC FIXTURE ST',
  '103 SYNTHETIC FIXTURE ST',
  '100 SYNTHETIC NORMALIZED AVE',
  '101 SYNTHETIC NORMALIZED AVE',
  '102 SYNTHETIC NORMALIZED AVE',
  '103 SYNTHETIC NORMALIZED AVE',
  'SYNTHETIC DESTINATION A',
  'SYNTHETIC DESTINATION B',
  'SYNTHETIC PRIVATE ADDRESS',
  '123456790',
  '123456791',
  '123456792',
  '123456793',
  '-75.16',
  '39.95',
];
let baseUrl = null;

await runBrowserSuite({
  prepare: () => mkdir(OUTPUT_DIR, { recursive: true }),
  createPreview: () => preview({ preview: { host: '127.0.0.1', port: PORT, strictPort: true } }),
  launchBrowser: () => chromium.launch({ headless: true }),
  createContext: (browser) => browser.newContext({ viewport: { width: 1280, height: 900 } }),
  configureContext: async (context, { server }) => {
    baseUrl = new URL(server.config.base, server.resolvedUrls.local[0]);
    baseUrl.searchParams.set('view', 'list');
    baseUrl.searchParams.set('hc', JSON.stringify({
      schema: 'engagement-home-compare-share/v1',
      weights: { property: 20, costHistory: 20, civicRecords: 20, transportContext: 20, dataQuality: 20 },
      dimensions: ['property'],
      address: '<img src=x onerror=alert(1)>',
    }));
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl.origin });
    await installSyntheticRoutes(context);
  },
  configurePage: (page) => {
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => networkRequests.push({ url: request.url(), body: request.postData() || '' }));
  },
  run: async ({ page, browser }) => {
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
  assert.equal(new URL(page.url()).searchParams.has('hc'), false, 'rejected private share state is removed from the URL');
  assertNoPrivateValues(page.url(), 'URL after rejecting private share state');
  assert.match(await dialog.locator('#home-compare-description').innerText(), /used ephemerally to query the listed official public sources/i);
  assert.match(await dialog.locator('#home-compare-description').innerText(), /commute destinations remain in this session/i);
  assert.equal(await dialog.locator('img, script').count(), 0, 'malicious share state must not create HTML elements');
  assert.equal(await dialog.getAttribute('aria-labelledby'), 'home-compare-title');
  assert.equal(await dialog.getAttribute('aria-describedby'), 'home-compare-description');
  assert.equal(await dialog.getByRole('region', { name: 'Evidence profiles' }).count(), 1);

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

  await verifyProductionChunkRetry(browser);
  await verifyNativeCloseWhileRendererPending(browser, 'click');
  await verifyNativeCloseWhileRendererPending(browser, 'escape');

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
  assert.match(await dialog.locator('.home-compare__sensitivity').innerText(), /Property: 42\.8%/i);
  assert.match(await dialog.locator('.home-compare__sensitivity').innerText(), /changes evidence order only/i);
  verifyPrivateTransport(networkRequests);
  assertNoPrivateValues(await privacySnapshot(page), 'browser persistence before sharing');

  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set('a', '-75.1652,39.9526');
    url.searchParams.set('b', '-75.1720,39.9490');
    url.searchParams.set('labelA', 'SYNTHETIC PRIVATE ADDRESS A');
    url.searchParams.set('labelB', 'SYNTHETIC PRIVATE ADDRESS B');
    url.hash = 'SYNTHETIC PRIVATE ADDRESS FRAGMENT';
    history.pushState({ labelA: 'SYNTHETIC PRIVATE ADDRESS A' }, '', url);
  });
  await dialog.locator('[data-home-share]').click();
  await page.waitForFunction(() => document.querySelector('[data-home-status]')?.textContent?.includes('Privacy-safe'));
  const sharedUrl = new URL(page.url());
  assert.deepEqual([...sharedUrl.searchParams.keys()], ['hc']);
  assert.equal(sharedUrl.hash, '');
  const shared = sharedUrl.searchParams.get('hc');
  const sharedValue = JSON.parse(shared);
  assert.deepEqual(Object.keys(sharedValue).sort(), ['dimensions', 'schema', 'weights']);
  assert.equal(Object.keys(sharedValue.weights).length, 5);
  assert.doesNotMatch(shared, /SYNTHETIC|address|destination|coordinate|parcel/i);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), sharedUrl.href);
  assertNoPrivateValues(await privacySnapshot(page), 'browser persistence after sharing');
  await page.goBack();
  assertNoPrivateValues({ url: page.url(), state: await page.evaluate(() => history.state) }, 'back history entry');
  await page.goForward();
  assert.equal(page.url(), sharedUrl.href);
  assertNoPrivateValues({ url: page.url(), state: await page.evaluate(() => history.state) }, 'forward history entry');

  await page.screenshot({ path: `${OUTPUT_DIR}/desktop-en-synthetic.png`, fullPage: true });
  await dialog.locator('[data-home-close]').click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await opener.evaluate((element) => document.activeElement === element), true);
  assertNoPrivateValues(await privacySnapshot(page), 'browser persistence after close');
  assert.doesNotMatch(await dialog.evaluate((element) => element.innerHTML), /SYNTHETIC|12345679|-75\.16|39\.95/i);

  await page.locator('.language-switch').click();
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await opener.click();
  await dialog.getByRole('heading', { name: '并排比较 2–4 个费城住宅' }).waitFor();
  assert.deepEqual(await dialog.locator('[data-home-address]').evaluateAll((inputs) => inputs.map((input) => input.value)), ['', '']);
  assert.equal(await dialog.locator('[data-home-destinations]').inputValue(), '');
  assert.equal(await dialog.locator('[data-home-profile]').count(), 0);
  assert.match(await dialog.locator('#home-compare-description').innerText(), /地址、坐标和 parcel ID 仅临时用于查询列出的官方公共来源/);
  assert.match(await dialog.locator('#home-compare-description').innerText(), /通勤目的地只保留在本次会话中/);
  await fillAddresses(dialog, 2);
  await runComparison(dialog, 2);
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
  await fillAddresses(dialog, 2);
  await runComparison(dialog, 2);
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
    privacy: {
      urlHistory: 'no-private-values',
      browserStorage: 'local-session-indexeddb-clean',
      network: 'official-hosts-only; destinations-not-transmitted',
      close: 'private-session-destroyed',
    },
    accessibility: 'named-dialog-and-results; keyboard-focus-restored',
    consoleErrors: consoleErrors.length,
    pageErrors: pageErrors.length,
    mobileLayout,
  }, null, 2));
  },
});

async function runComparison(dialog, count) {
  await dialog.locator('[data-home-run]').click();
  try {
    await dialog.locator(`[data-home-profile="${count}"]`).waitFor({ state: 'visible' });
  } catch (error) {
    throw new Error(`comparison did not render ${count} profiles: ${await dialog.locator('[data-home-status]').innerText()} | ${await dialog.locator('[data-home-results]').innerText()} | ${error.message}`);
  }
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
    const params = sensitivePostParams(route.request(), ['Street']);
    assert.equal(params.get('f'), 'json');
    assert.equal(params.get('outSR'), '4326');
    const input = params.get('Street') || '';
    const index = syntheticIndex(input);
    await json(route, {
      candidates: [{
        address: `${100 + index} SYNTHETIC NORMALIZED AVE`,
        score: 100,
        location: { x: -75.16 + index * 0.001, y: 39.95 + index * 0.001 },
        attributes: {
          Score: 100,
          Match_addr: `${100 + index} SYNTHETIC NORMALIZED AVE`,
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
    const params = sensitivePostParams(route.request(), ['where']);
    assert.equal(params.get('returnGeometry'), 'false');
    const where = params.get('where') || '';
    if (where.includes("'123456792'")) {
      await json(route, { features: null, error: { code: 'synthetic-unavailable' } });
      return;
    }
    await json(route, { features: [{ attributes: { build_rank: 72, date_update: Date.parse('2026-08-17T00:00:00Z') } }] });
  });
  await context.route(/high_injury_network_2025\/FeatureServer\/0\/query/i, async (route) => {
    const params = sensitivePostParams(route.request(), ['geometry']);
    assert.equal(params.get('geometryType'), 'esriGeometryPoint');
    assert.equal(params.get('returnCountOnly'), 'true');
    await json(route, { count: syntheticCoordinateIndex(params.get('geometry')) + 1 });
  });
}

function propertyRow(index) {
  return {
    parcel_number: String(123456790 + index),
    location: `${100 + index} SYNTHETIC NORMALIZED AVE`,
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
  const match = String(value).match(/(10[0-3])\s+SYNTHETIC (?:FIXTURE ST|NORMALIZED AVE)/i);
  return match ? Number(match[1]) - 100 : 0;
}

function syntheticCoordinateIndex(value) {
  const [longitude, latitude] = String(value).split(',').map(Number);
  const longitudeIndex = Math.round((longitude + 75.16) / 0.001);
  const latitudeIndex = Math.round((latitude - 39.95) / 0.001);
  assert.equal(longitudeIndex, latitudeIndex, `synthetic coordinate pair drifted: ${value}`);
  assert.ok(longitudeIndex >= 0 && longitudeIndex <= 3, `synthetic coordinate is out of fixture range: ${value}`);
  return longitudeIndex;
}

function sensitivePostParams(request, requiredKeys) {
  const url = new URL(request.url());
  assert.equal(request.method(), 'POST', `${url.pathname} must use POST`);
  assert.equal(url.search, '', `${url.pathname} must not expose sensitive query parameters`);
  assert.match(request.headers()['content-type'] || '', /^application\/x-www-form-urlencoded(?:;|$)/i);
  const params = new URLSearchParams(request.postData() || '');
  for (const key of requiredKeys) assert.equal(params.has(key), true, `${url.pathname} body is missing ${key}`);
  return params;
}

async function json(route, body) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

function assertNoPrivateValues(value, label) {
  const text = JSON.stringify(value);
  for (const privateValue of PRIVATE_VALUES) {
    assert.equal(text.includes(privateValue), false, `${label} contains ${privateValue}`);
  }
}

function verifyPrivateTransport(requests) {
  const officialHosts = new Set([
    'citygeo-geocoder-pub.databridge.phila.gov',
    'phl.carto.com',
    'services.arcgis.com',
  ]);
  const decoded = requests.map((request) => {
    const text = `${request.url} ${request.body}`;
    try { return { ...request, text: decodeURIComponent(text.replaceAll('+', ' ')) }; } catch { return { ...request, text }; }
  });
  const transmitted = decoded.filter(({ text }) => PRIVATE_VALUES.some((value) => text.includes(value)));
  const privateUrls = decoded.filter(({ url }) => {
    let text = url;
    try { text = decodeURIComponent(url.replaceAll('+', ' ')); } catch {}
    return PRIVATE_VALUES.some((value) => text.includes(value));
  });
  assert.ok(transmitted.some(({ text }) => text.includes('100 SYNTHETIC FIXTURE ST')), 'input address transport is observed');
  assert.ok(transmitted.some(({ text }) => text.includes('100 SYNTHETIC NORMALIZED AVE')), 'normalized address transport is observed');
  assert.ok(transmitted.some(({ text }) => text.includes('123456790')), 'parcel transport is observed');
  assert.ok(transmitted.some(({ text }) => text.includes('-75.16') && text.includes('39.95')), 'coordinate transport is observed');
  assert.equal(transmitted.every(({ url }) => officialHosts.has(new URL(url).hostname)), true, 'private query values go only to admitted official hosts');
  assert.deepEqual(privateUrls, [], 'private transport values stay out of request URLs');
  assert.equal(decoded.some(({ text }) => /SYNTHETIC DESTINATION [AB]/.test(text)), false, 'commute destinations are never transmitted');
}

async function privacySnapshot(page) {
  return page.evaluate(async () => {
    const databases = [];
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const storeName of db.objectStoreNames) {
        const values = await new Promise((resolve, reject) => {
          const request = db.transaction(storeName).objectStore(storeName).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        databases.push({ name, storeName, values });
      }
      db.close();
    }
    return {
      url: location.href,
      historyState: history.state,
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
      indexedDB: databases,
    };
  });
}

async function verifyProductionChunkRetry(browser) {
  const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
  const chunk = manifest['src/home_compare/results_view.js']?.file;
  const retryChunk = manifest['src/home_compare/results_view.js?homeCompareRetry=1']?.file;
  assert.match(chunk || '', /^assets\/results_view-[\w-]+\.js$/, 'manifest must name the initial production results-view chunk');
  assert.match(retryChunk || '', /^assets\/results_view-[\w-]+\.js$/, 'manifest must name the explicit retry production chunk');
  assert.notEqual(retryChunk, chunk, 'retry must have a distinct Vite-built module-map entry after the first chunk fails');
  const matcher = new RegExp(`/${chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?|$)`);
  const resultsChunkMatcher = /\/assets\/results_view-[\w-]+\.js(?:\?|$)/;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = []; let requests = 0; const resultsChunkRequests = [];
  await page.addInitScript(() => { window.__homeUnhandled = []; window.addEventListener('unhandledrejection', (event) => window.__homeUnhandled.push(String(event.reason))); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => { if (resultsChunkMatcher.test(request.url())) resultsChunkRequests.push(request.url()); });
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl.origin });
    await installSyntheticRoutes(context);
    await context.route(matcher, async (route) => {
      requests += 1;
      await route.fulfill({ status: 503, contentType: 'text/javascript', body: '/* transient production chunk failure */' });
    });
    await page.goto(baseUrl.href, { waitUntil: 'networkidle' });
    const opener = page.locator('[data-home-compare-open]'); const dialog = page.locator('[data-home-compare-dialog]');
    await opener.click(); await fillAddresses(dialog, 2); await dialog.locator('[data-home-run]').click();
    try {
      await dialog.locator('[data-home-retry-results]').waitFor({ state: 'visible' });
    } catch (error) {
      throw new Error(`production chunk failure was not rendered: requests=${requests}; status=${await dialog.locator('[data-home-status]').innerText()}; results=${await dialog.locator('[data-home-results]').innerText()}; pageErrors=${JSON.stringify(pageErrors)}; ${error.message}`);
    }
    assert.equal(await dialog.locator('[data-home-retry-results]').isVisible(), true);
    assert.equal(await dialog.locator('[data-home-profile]').count(), 0, 'chunk failure leaves no stale result DOM');
    assert.deepEqual(await page.evaluate(() => [...window.__homeUnhandled]), []);
    assert.deepEqual(pageErrors, []);
    await context.unroute(matcher);
    await dialog.locator('[data-home-retry-results]').click();
    await dialog.locator('[data-home-profile="2"]').waitFor({ state: 'visible' });
    assert.equal(requests, 1, 'the one deliberately failed initial static-import request is observed');
    assert.ok(resultsChunkRequests.some((url) => url.includes(`/${chunk}`)), 'first compare must request the manifest initial chunk');
    assert.ok(resultsChunkRequests.some((url) => url.includes(`/${retryChunk}`)), 'retry must request the distinct Vite-built production retry chunk');
    await dialog.locator('[data-home-close]').click(); await dialog.waitFor({ state: 'hidden' }); await opener.click();
    assert.equal(await dialog.locator('[data-home-profile]').count(), 0, 'completed close/reopen starts a fresh private session');
    assert.deepEqual(await dialog.locator('[data-home-address]').evaluateAll((inputs) => inputs.map((input) => input.value)), ['', '']);
  } finally { await context.close(); }
}

async function verifyNativeCloseWhileRendererPending(browser, action) {
  const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
  const chunk = manifest['src/home_compare/results_view.js']?.file;
  const matcher = new RegExp(`/${chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?|$)`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(); let release; let markStarted;
  const pageErrors = [];
  const pending = new Promise((resolve) => { release = resolve; }); const started = new Promise((resolve) => { markStarted = resolve; });
  try {
    await page.addInitScript(() => { window.__homeUnhandled = []; window.addEventListener('unhandledrejection', (event) => window.__homeUnhandled.push(String(event.reason))); });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl.origin }); await installSyntheticRoutes(context);
    await context.route(matcher, async (route) => { markStarted(); await pending; await route.continue(); });
    await page.goto(baseUrl.href, { waitUntil: 'networkidle' });
    const opener = page.locator('[data-home-compare-open]'); const dialog = page.locator('[data-home-compare-dialog]');
    await opener.click(); await fillAddresses(dialog, 2); await dialog.locator('[data-home-run]').click(); await started;
    if (action === 'click') await dialog.locator('[data-home-close]').click(); else await page.keyboard.press('Escape');
    assert.equal(await dialog.getAttribute('aria-busy'), 'false', `${action} cancels before held renderer resolves`);
    release(); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await opener.evaluate((element) => document.activeElement === element), true, `${action} restores focus`);
    await opener.click(); assert.equal(await dialog.locator('[data-home-profile]').count(), 0, `${action} cannot commit stale result after reopen`);
    assert.deepEqual(await page.evaluate(() => [...window.__homeUnhandled]), [], `${action} leaves no unhandled rejection`);
    assert.deepEqual(pageErrors, [], `${action} leaves no page error`);
  } finally { release?.(); await context.close(); }
}
