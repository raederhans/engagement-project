#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { chromium } from '@playwright/test';
import { preview } from 'vite';

const server = await preview({
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
const browser = await chromium.launch({ headless: true });

function cartoResponse(request) {
  const body = decodeURIComponent(request.postData() || '');
  if (/MIN\(dispatch_date_time\)/i.test(body)) {
    return { rows: [{ min_dt: '2006-01-01', max_dt: '2026-07-30' }] };
  }
  if (/format=GeoJSON/i.test(body)) return { type: 'FeatureCollection', features: [] };
  if (/text_general_code/i.test(body) && /GROUP BY/i.test(body)) {
    return { rows: [{ text_general_code: 'Thefts', n: 8 }] };
  }
  if (/COUNT\(\*\).*\bn\b/is.test(body)) return { rows: [{ n: 12 }] };
  return { rows: [] };
}

async function installDeterministicApiRoutes(page) {
  await page.route('https://citygeo-geocoder-pub.databridge.phila.gov/**', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('SingleLine') || '';
    const isB = /Broad/i.test(query);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [{
          address: isB ? 'N BROAD ST & W GIRARD AVE, 19121' : '1500 MARKET ST, 19102',
          score: 100,
          location: isB ? { x: -75.16, y: 39.97 } : { x: -75.166154, y: 39.95218 },
        }],
      }),
    });
  });
  await page.route('https://phl.carto.com/**', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(cartoResponse(route.request())) });
  });
  for (const pattern of [
    'https://policegis.phila.gov/**',
    'https://tigerweb.geo.census.gov/**',
    'https://mapservices.pasda.psu.edu/**',
    'https://services.arcgis.com/**',
    'https://api.censusreporter.org/**',
  ]) {
    await page.route(pattern, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'deterministic browser-test fallback' }),
    }));
  }
}

try {
  const baseUrl = new URL(server.config.base, server.resolvedUrls.local[0]).href;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await installDeterministicApiRoutes(page);
  const consoleErrors = [];
  const pageErrors = [];
  const requests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));

  await page.goto(new URL('?mode=diary', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Route Safety Diary (demo)' }).waitFor();
  const directDiaryCrimeRequest = requests.find((url) => (
    /phl\.carto\.com|tigerweb\.geo\.census\.gov|api\.censusreporter\.org|Police_Districts/i.test(url)
  ));
  assert.equal(directDiaryCrimeRequest, undefined, `Diary direct load requested Crime data: ${directDiaryCrimeRequest}`);

  requests.length = 0;
  await page.goto(new URL('?mode=crime&utm_source=portfolio', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await page.locator('#dataStatus').filter({ hasText: 'Live crime coverage' }).waitFor();
  await page.locator('#durationSel').selectOption('24');
  assert.equal(await page.locator('#startMonth').inputValue(), '2024-08');
  assert.equal(await page.locator('#startMonth').getAttribute('max'), '2024-08');
  await page.locator('#addrA').fill('1500 Market St');
  await page.locator('#searchABtn').click();
  await page.waitForFunction(() => document.getElementById('addrA')?.value === '1500 MARKET ST, 19102');
  await page.locator('#addrB').fill('Broad and Girard');
  await page.locator('#searchBBtn').click();
  await page.locator('#addressStatus').filter({ hasText: 'Point B' }).waitFor();
  await page.locator('#compare-card').filter({ hasText: '1500 MARKET ST' }).waitFor();
  await page.locator('#compare-card').filter({ hasText: 'N BROAD ST' }).waitFor();

  await page.locator('#shareViewBtn').click();
  const sharedUrl = new URL(page.url());
  assert.equal(sharedUrl.searchParams.get('utm_source'), 'portfolio');
  assert.ok(sharedUrl.searchParams.get('a'));
  assert.ok(sharedUrl.searchParams.get('b'));

  const jsonDownload = page.waitForEvent('download');
  await page.locator('#exportJsonBtn').click();
  const downloadedJson = await jsonDownload;
  assert.equal(downloadedJson.suggestedFilename(), 'engagement-analysis.json');
  const jsonPayload = JSON.parse(await readFile(await downloadedJson.path(), 'utf8'));
  assert.equal(jsonPayload.comparison.a.total, 12);
  assert.equal(jsonPayload.comparison.b.total, 12);
  const csvDownload = page.waitForEvent('download');
  await page.locator('#exportCsvBtn').click();
  const downloadedCsv = await csvDownload;
  assert.equal(downloadedCsv.suggestedFilename(), 'engagement-comparison.csv');
  const csvPayload = await readFile(await downloadedCsv.path(), 'utf8');
  assert.match(csvPayload, /A,"1500 MARKET ST, 19102",12/);
  assert.match(csvPayload, /B,"N BROAD ST & W GIRARD AVE, 19121",12/);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#addrA').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#addrA').inputValue(), '1500 MARKET ST, 19102');
  assert.equal(await page.locator('#addrB').inputValue(), 'N BROAD ST & W GIRARD AVE, 19121');
  assert.equal(new URL(page.url()).searchParams.get('utm_source'), 'portfolio');

  requests.length = 0;
  await page.getByRole('button', { name: 'Diary', exact: true }).click();
  await page.getByRole('heading', { name: 'Route Safety Diary (demo)' }).waitFor();
  const forbiddenDiaryRequest = requests.find((url) => (
    /phl\.carto\.com|tigerweb\.geo\.census\.gov|api\.censusreporter\.org|Police_Districts/i.test(url)
  ));
  assert.equal(forbiddenDiaryRequest, undefined, `Diary direct load requested Crime data: ${forbiddenDiaryRequest}`);

  await page.getByRole('button', { name: 'Rate this route' }).click();
  await page.getByRole('button', { name: '★' }).nth(4).click();
  await page.getByRole('button', { name: 'poor lighting' }).click();
  await page.getByRole('button', { name: 'Submit rating' }).click();
  await page.getByText('Saved locally on this device.').waitFor();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'My routes', exact: true }).click();
  await page.locator('.diary-score-pill').filter({ hasText: '5.0' }).waitFor();
  await page.getByRole('button', { name: 'Sample community', exact: true }).click();
  await page.getByText('Illustrative, read-only sample data. No comments or ratings are shared with other people.').waitFor();
  assert.equal(await page.locator('[data-panel-view="diary"] input[type="range"]').count(), 0);

  await page.getByRole('button', { name: 'Crime', exact: true }).click();
  await page.getByRole('button', { name: 'Diary', exact: true }).click();
  await page.getByRole('button', { name: 'Crime', exact: true }).click();
  await page.waitForURL(/(?:\?|&)mode=crime(?:&|$)/);
  await page.locator('[data-panel-view="crime"]').waitFor({ state: 'visible' });

  const layout = await page.evaluate(() => {
    const side = document.getElementById('sidepanel');
    const compare = document.getElementById('compare-card');
    const charts = document.getElementById('charts');
    return {
      noHorizontalOverflow: side.scrollWidth <= side.clientWidth + 1,
      compareInsidePanel: side.contains(compare),
      chartsInsidePanel: side.contains(charts),
      comparePosition: getComputedStyle(compare).position,
      chartsPosition: getComputedStyle(charts).position,
    };
  });
  assert.deepEqual(layout, {
    noHorizontalOverflow: true,
    compareInsidePanel: true,
    chartsInsidePanel: true,
    comparePosition: 'static',
    chartsPosition: 'static',
  });
  assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join(' | ')}`);
  assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join(' | ')}`);

  console.log('[Browser Smoke] PASS - A/B geocoding, share restore, exports, IndexedDB reload, Diary isolation, mode switching, and mobile layout verified.');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => {
    server.httpServer.close((error) => (error ? reject(error) : resolve()));
  });
}
