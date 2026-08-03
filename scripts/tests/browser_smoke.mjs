#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { chromium } from '@playwright/test';
import { preview } from 'vite';

const manifest = JSON.parse(await readFile(new URL('../../dist/.vite/manifest.json', import.meta.url), 'utf8'));
const historyChunk = manifest['src/analysis/analysis_history_controller.js']?.file;
assert.ok(historyChunk, 'Browser smoke requires the Analysis History lazy chunk in the Vite manifest');
const builtJavaScript = await Promise.all(
  Object.values(manifest)
    .map((record) => record.file)
    .filter((file) => file?.endsWith('.js'))
    .map((file) => readFile(new URL(`../../dist/${file}`, import.meta.url), 'utf8')),
);
assert.ok(
  builtJavaScript.some((source) => source.includes('tract_crime_counts_last12m.json')),
  'Browser smoke requires a dist build with VITE_TRACT_CRIME_SNAPSHOT=1.',
);

const server = await preview({
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
let browser = null;

const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

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

async function installDeterministicApiRoutes(page, networkControl) {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({
    contentType: 'image/png',
    body: transparentPng,
  }));
  await page.route('https://demotiles.maplibre.org/font/**', (route) => route.fulfill({
    contentType: 'application/x-protobuf',
    body: Buffer.alloc(0),
  }));
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
    if (/format=GeoJSON/i.test(decodeURIComponent(route.request().postData() || ''))) {
      networkControl.pointRefreshRequests += 1;
    }
    if (networkControl.holdCarto) await networkControl.cartoGate;
    if (networkControl.failCarto) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'held browser failure' }) });
      return;
    }
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

function artifactCard(page, title) {
  return page.locator('.analysis-history__item').filter({ has: page.locator('.analysis-history__title', { hasText: title }) });
}

async function listDatabaseNames(page) {
  return page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name));
}

async function ensureAdvancedFiltersOpen(page) {
  const details = page.locator('#advancedFilters');
  if (!(await details.evaluate((element) => element.open))) {
    await details.locator(':scope > summary').click();
  }
}

async function readSavedArtifact(page, title) {
  return page.evaluate((artifactTitle) => new Promise((resolve, reject) => {
    const openRequest = indexedDB.open('engagement-analysis');
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const request = database.transaction('analysis_artifacts').objectStore('analysis_artifacts').getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        resolve(request.result.find((artifact) => artifact.title === artifactTitle) || null);
        database.close();
      };
    };
  }), title);
}

try {
  browser = await chromium.launch({ headless: true });
  const baseUrl = new URL(server.config.base, server.resolvedUrls.local[0]).href;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['clipboard-read', 'clipboard-write'],
    locale: 'en-US',
  });
  const page = await context.newPage();
  const networkControl = {
    stage: 'normal',
    holdCarto: false,
    failCarto: false,
    cartoGate: Promise.resolve(),
    pointRefreshRequests: 0,
  };
  await installDeterministicApiRoutes(page, networkControl);
  const consoleErrors = [];
  let expectedCartoConsoleErrors = 0;
  const pageErrors = [];
  const requests = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const locationUrl = message.location().url;
    let cartoLocation = false;
    try {
      cartoLocation = new URL(locationUrl).origin === 'https://phl.carto.com';
    } catch {}
    if (
      networkControl.stage === 'failCarto'
      && message.text() === 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)'
      && cartoLocation
    ) {
      expectedCartoConsoleErrors += 1;
      return;
    }
    consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));

  await page.goto(new URL('?mode=diary', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Route Safety Diary (demo)' }).waitFor();
  await page.waitForTimeout(250);
  const crimeApiHosts = new Set([
    'citygeo-geocoder-pub.databridge.phila.gov',
    'phl.carto.com',
    'policegis.phila.gov',
    'tigerweb.geo.census.gov',
    'mapservices.pasda.psu.edu',
    'services.arcgis.com',
    'api.censusreporter.org',
  ]);
  const directDiaryCrimeRequest = requests.find((url) => crimeApiHosts.has(new URL(url).hostname));
  assert.equal(directDiaryCrimeRequest, undefined, `Diary direct load requested Crime data: ${directDiaryCrimeRequest}`);
  assert.equal(
    requests.some((url) => new URL(url).pathname.endsWith(`/${historyChunk}`)),
    false,
    `Diary direct load fetched the Analysis History chunk: ${historyChunk}`,
  );
  assert.equal(
    (await listDatabaseNames(page)).includes('engagement-analysis'),
    false,
    'Diary direct load must not create the engagement-analysis database',
  );
  const insightsToggle = page.locator('.diary-insights-toggle');
  await insightsToggle.click();
  assert.equal(await insightsToggle.getAttribute('aria-expanded'), 'true');
  await page.locator('.diary-insights-content').waitFor({ state: 'visible' });

  const simulator = page.locator('details.diary-progressive-surface');
  await simulator.locator(':scope > summary').click();
  const diaryRouteSelect = page.locator('[data-panel-view="diary"] select.diary-select').first();
  const selectedRouteBeforeLanguageChange = await diaryRouteSelect.inputValue();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Pause', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: 'Switch to Simplified Chinese' }).click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  assert.equal(await diaryRouteSelect.inputValue(), selectedRouteBeforeLanguageChange);
  assert.equal(await page.getByRole('button', { name: '暂停', exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole('button', { name: '播放', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '切换到英文' }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();

  await page.getByRole('button', { name: 'Rate this route' }).click();
  await page.getByRole('radio', { name: '5 stars' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'poor lighting' }).click();
  await page.getByRole('button', { name: 'Save rating' }).click();
  await page.getByText('Saved locally on this device.').waitFor();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'My routes', exact: true }).click();
  await page.locator('.diary-score-pill').filter({ hasText: '5.0' }).waitFor();
  await page.getByRole('button', { name: 'Sample community', exact: true }).click();
  await page.getByText('Illustrative, read-only sample data. No comments or ratings are shared with other people.').waitFor();
  assert.equal(await page.locator('[data-panel-view="diary"] input[type="range"]').count(), 0);
  const sampleItem = page.locator('.diary-community-item').first();
  await sampleItem.waitFor();
  assert.equal(await sampleItem.evaluate((element) => getComputedStyle(element).cursor), 'default');

  await page.getByRole('button', { name: 'Crime', exact: true }).click();
  await page.getByRole('button', { name: 'Diary', exact: true }).click();
  await page.getByRole('button', { name: 'Crime', exact: true }).click();
  await page.waitForURL(/(?:\?|&)mode=crime(?:&|$)/);
  await page.locator('[data-panel-view="crime"]').waitFor({ state: 'visible' });

  requests.length = 0;
  const pointRefreshRequestsBeforeCrimeEntry = networkControl.pointRefreshRequests;
  await page.goto(new URL('?mode=crime&utm_source=portfolio', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await page.locator('#dataStatus').filter({ hasText: 'Live crime coverage' }).waitFor({ state: 'attached' });
  await page.locator('#compare-card').filter({ hasText: 'Choose a location to create an analysis summary.' }).waitFor();
  assert.equal(
    networkControl.pointRefreshRequests - pointRefreshRequestsBeforeCrimeEntry,
    0,
    'An unselected Crime entry must not request citywide incident points',
  );
  await ensureAdvancedFiltersOpen(page);
  await page.locator('#durationSel').selectOption('24');
  assert.equal(await page.locator('#startMonth').inputValue(), '2024-08');
  assert.equal(await page.locator('#startMonth').getAttribute('max'), '2024-08');
  await page.locator('#addrA').fill('1500 Market St');
  const pointRefreshRequestsBeforeGeocode = networkControl.pointRefreshRequests;
  await page.locator('#searchABtn').click();
  await page.waitForFunction(() => document.getElementById('addrA')?.value === '1500 MARKET ST, 19102');
  await page.waitForFunction(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('a') && params.get('labelA') === '1500 MARKET ST, 19102';
  });
  assert.equal(await page.locator('#addrB').inputValue(), '');
  await page.locator('#compare-card').filter({ hasText: '12 reported incidents' }).waitFor();
  await page.waitForTimeout(1200);
  assert.equal(
    networkControl.pointRefreshRequests - pointRefreshRequestsBeforeGeocode,
    1,
    'One settled geocode must own exactly one Crime refresh API generation',
  );
  const cartoRequestsBeforeLanguageChange = requests.filter((url) => url.startsWith('https://phl.carto.com/')).length;
  await page.getByRole('button', { name: 'Switch to Simplified Chinese' }).click();
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  const localizedComparisonText = await page.locator('#compare-card').textContent();
  assert.match(localizedComparisonText, /数据截至/);
  assert.match(localizedComparisonText, /2026年7月30日/);
  assert.match(await page.locator('.analysis-history').textContent(), /最近的分析/);
  assert.equal(
    requests.filter((url) => url.startsWith('https://phl.carto.com/')).length,
    cartoRequestsBeforeLanguageChange,
    'Language switching must redraw cached Crime results without refetching data',
  );
  await page.getByRole('button', { name: '切换到英文' }).click();

  await page.getByLabel('Analysis title').fill('A-only artifact');
  await page.getByRole('button', { name: 'Save analysis' }).click();
  await artifactCard(page, 'A-only artifact').waitFor();
  assert.equal((await readSavedArtifact(page, 'A-only artifact'))?.resultSummary?.comparison?.a?.total, 12);
  assert.ok((await listDatabaseNames(page)).includes('engagement-analysis'));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await artifactCard(page, 'A-only artifact').waitFor();
  assert.equal(await page.locator('#addrA').inputValue(), '1500 MARKET ST, 19102');
  assert.equal(await page.locator('#addrB').inputValue(), '');
  await artifactCard(page, 'A-only artifact').locator('.analysis-history__data-status').filter({ hasText: 'Sources current' }).waitFor();
  await ensureAdvancedFiltersOpen(page);
  await page.locator('#durationSel').selectOption('12');
  await page.locator('#startMonth').fill('2025-08');
  await page.locator('#startMonth').dispatchEvent('change');
  await page.locator('#queryModeSel').selectOption('tract');
  await artifactCard(page, 'A-only artifact').locator('.analysis-history__data-status').filter({ hasText: 'Needs refresh' }).waitFor();
  await page.locator('#queryModeSel').selectOption('buffer');
  await artifactCard(page, 'A-only artifact').locator('.analysis-history__data-status').filter({ hasText: 'Sources current' }).waitFor();

  await page.locator('#durationSel').selectOption('6');
  await page.getByRole('button', { name: 'Compare another area' }).click();
  await page.locator('#addrB').fill('Broad and Girard');
  await page.locator('#searchBBtn').click();
  await page.locator('#addressStatus').filter({ hasText: 'Point B' }).waitFor();
  await page.locator('#compare-card').filter({ hasText: '1500 MARKET ST' }).waitFor();
  await page.locator('#compare-card').filter({ hasText: 'N BROAD ST' }).waitFor();
  await page.waitForFunction(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('months') === '6' && params.has('b') && params.get('labelB') === 'N BROAD ST & W GIRARD AVE, 19121';
  });

  await page.locator('#shareViewBtn').click();
  const currentSharedUrl = new URL(page.url());
  assert.equal(currentSharedUrl.searchParams.get('utm_source'), 'portfolio');
  assert.ok(currentSharedUrl.searchParams.get('a'));
  assert.ok(currentSharedUrl.searchParams.get('b'));

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

  let releaseCarto;
  networkControl.cartoGate = new Promise((resolve) => { releaseCarto = resolve; });
  networkControl.holdCarto = true;
  const requestsBeforeRestore = requests.length;
  const pointRefreshRequestsBeforeRestore = networkControl.pointRefreshRequests;
  const freshCartoRequest = page.waitForRequest((request) => request.url().startsWith('https://phl.carto.com/'));
  await artifactCard(page, 'A-only artifact').getByRole('button', { name: 'Open' }).click();
  await page.locator('.analysis-history__snapshot').waitFor({ state: 'visible' });
  await page.locator('#compare-card').filter({ hasText: '12 reported incidents' }).waitFor();
  assert.equal(await page.locator('#addrA').inputValue(), '1500 MARKET ST, 19102');
  assert.equal(await page.locator('#addrB').inputValue(), '');
  assert.equal(new URL(page.url()).searchParams.has('b'), false);
  assert.equal(new URL(page.url()).searchParams.has('labelB'), false);
  assert.equal(new URL(page.url()).searchParams.get('months'), '24');
  assert.doesNotMatch(
    await page.locator('#compare-card').textContent(),
    /N BROAD ST/,
    'Opening an A-only artifact must clear the stale Point B comparison before live refresh completes',
  );
  await freshCartoRequest;
  assert.ok(
    requests.slice(requestsBeforeRestore).some((url) => url.startsWith('https://phl.carto.com/')),
    'Opening an artifact must issue fresh Crime network activity',
  );
  assert.equal(await page.locator('.analysis-history__snapshot').isVisible(), true);
  assert.equal(
    networkControl.pointRefreshRequests - pointRefreshRequestsBeforeRestore,
    1,
    'Held artifact restore must start exactly one Crime refresh generation',
  );
  await page.getByRole('button', { name: 'Diary', exact: true }).click();
  await page.getByRole('heading', { name: 'Route Safety Diary (demo)' }).waitFor();
  const cancelledSnapshotText = await page.locator('.analysis-history__snapshot').textContent();
  assert.match(cancelledSnapshotText, /refresh was cancelled/i);
  assert.doesNotMatch(cancelledSnapshotText, /Refreshing live data/i);
  networkControl.holdCarto = false;
  releaseCarto();
  await page.getByRole('button', { name: 'Crime', exact: true }).click();
  await page.locator('[data-panel-view="crime"]').waitFor({ state: 'visible' });
  await page.locator('.analysis-history__snapshot').waitFor({ state: 'hidden' });

  networkControl.failCarto = false;
  await page.evaluate(() => sessionStorage.clear());
  const uncachedRestoreUrl = new URL(page.url());
  uncachedRestoreUrl.searchParams.set('mode', 'crime');
  uncachedRestoreUrl.searchParams.set('start', '2025-08');
  uncachedRestoreUrl.searchParams.set('months', '12');
  await page.goto(uncachedRestoreUrl.href, { waitUntil: 'domcontentloaded' });
  await artifactCard(page, 'A-only artifact').waitFor();
  await page.locator('.analysis-history__snapshot').waitFor({ state: 'hidden' });
  await ensureAdvancedFiltersOpen(page);
  networkControl.stage = 'failCarto';
  networkControl.failCarto = true;
  await artifactCard(page, 'A-only artifact').getByRole('button', { name: 'Open' }).click();
  await page.waitForFunction(() => /refresh failed/i.test(document.querySelector('.analysis-history__snapshot')?.textContent || ''));
  assert.equal(await page.locator('#addrA').inputValue(), '1500 MARKET ST, 19102');
  assert.match(await page.locator('#compare-card').textContent(), /12 reported incidents/);
  networkControl.failCarto = false;
  networkControl.stage = 'normal';
  await page.locator('#durationSel').selectOption('6');
  await page.locator('.analysis-history__snapshot').waitFor({ state: 'hidden' });

  page.once('dialog', (dialog) => dialog.accept('Renamed A-only'));
  await artifactCard(page, 'A-only artifact').getByRole('button', { name: 'Rename' }).click();
  await artifactCard(page, 'Renamed A-only').waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await artifactCard(page, 'Renamed A-only').waitFor();

  await artifactCard(page, 'Renamed A-only').getByRole('button', { name: 'Share' }).click();
  await page.locator('.analysis-history__status').filter({ hasText: 'Share link copied' }).waitFor();
  const sharedUrl = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  assert.equal(sharedUrl.searchParams.get('utm_source'), 'portfolio');
  assert.equal(sharedUrl.searchParams.get('mode'), 'crime');
  assert.equal(sharedUrl.searchParams.get('analysis'), 'buffer');
  assert.equal(sharedUrl.searchParams.get('months'), '24');
  assert.ok(sharedUrl.searchParams.get('a'));
  assert.equal(sharedUrl.searchParams.has('b'), false);
  for (const privateKey of ['artifact', 'artifactId', 'title', 'result']) {
    assert.equal(sharedUrl.searchParams.has(privateKey), false, `Share URL leaked ${privateKey}`);
  }

  const artifactDownload = page.waitForEvent('download');
  await artifactCard(page, 'Renamed A-only').getByRole('button', { name: 'Export' }).click();
  const downloadedArtifact = await artifactDownload;
  const artifactPayload = JSON.parse(await readFile(await downloadedArtifact.path(), 'utf8'));
  assert.equal(artifactPayload.kind, 'engagement-analysis-artifact');
  assert.equal(artifactPayload.schemaVersion, 1);

  page.once('dialog', (dialog) => dialog.accept());
  await artifactCard(page, 'Renamed A-only').getByRole('button', { name: 'Delete' }).click();
  await artifactCard(page, 'Renamed A-only').waitFor({ state: 'detached' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.analysis-history__empty').waitFor();
  assert.equal(await artifactCard(page, 'Renamed A-only').count(), 0);

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

  const upgradeEvidence = await page.evaluate(async () => {
    const open = (version) => new Promise((resolve, reject) => {
      const request = indexedDB.open('engagement-analysis', version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const oldConnection = await open(1);
    const transaction = oldConnection.transaction('analysis_artifacts', 'readwrite');
    transaction.objectStore('analysis_artifacts').put({ id: 'migration-fixture', value: 'preserved' });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    let blocked = false;
    let versionchange = false;
    let historyVisibleDuringBlock = false;
    oldConnection.onversionchange = () => { versionchange = true; };
    let resolveBlocked;
    const blockedEvent = new Promise((resolve) => { resolveBlocked = resolve; });
    const upgraded = new Promise((resolve, reject) => {
      const request = indexedDB.open('engagement-analysis', 2);
      request.onblocked = () => {
        blocked = true;
        historyVisibleDuringBlock = Boolean(document.querySelector('.analysis-history')?.getClientRects().length);
        resolveBlocked();
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    await Promise.race([
      blockedEvent,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Expected IndexedDB v2 upgrade to be blocked')), 2_000)),
    ]);
    oldConnection.close();
    const upgradedConnection = await upgraded;
    const record = await new Promise((resolve, reject) => {
      const request = upgradedConnection.transaction('analysis_artifacts').objectStore('analysis_artifacts').get('migration-fixture');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const evidence = {
      blocked,
      versionchange,
      historyVisibleDuringBlock,
      version: upgradedConnection.version,
      record,
    };
    upgradedConnection.close();
    return evidence;
  });
  assert.deepEqual(upgradeEvidence, {
    blocked: true,
    versionchange: true,
    historyVisibleDuringBlock: true,
    version: 2,
    record: { id: 'migration-fixture', value: 'preserved' },
  });
  const mockedRemoteHosts = new Set([
    'tile.openstreetmap.org',
    'demotiles.maplibre.org',
    'citygeo-geocoder-pub.databridge.phila.gov',
    'phl.carto.com',
    'policegis.phila.gov',
    'tigerweb.geo.census.gov',
    'mapservices.pasda.psu.edu',
    'services.arcgis.com',
    'api.censusreporter.org',
  ]);
  const remoteRequests = requests.filter((url) => new URL(url).origin !== new URL(baseUrl).origin);
  assert.deepEqual(
    [...new Set(remoteRequests.map((url) => new URL(url).hostname).filter((host) => !mockedRemoteHosts.has(host)))],
    [],
    'Browser smoke must not depend on an unmocked public network host',
  );
  assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join(' | ')}`);
  assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join(' | ')}`);
  assert.equal(expectedCartoConsoleErrors, 3, 'Only the three intentional Carto 503 attempts may be exempted');

  console.log(`[Browser Smoke] PASS - Diary historyChunk=false/analysisDb=false; held restore point requests=1; cached comparison retained for cancel/failure; freshness current-mismatch-current; intentionalCarto503=${expectedCartoConsoleErrors}; remote hosts mocked=${new Set(remoteRequests.map((url) => new URL(url).hostname)).size}; IndexedDB blocked=${upgradeEvidence.blocked}/versionchange=${upgradeEvidence.versionchange}/historyVisible=${upgradeEvidence.historyVisibleDuringBlock}/version=${upgradeEvidence.version}/record=${upgradeEvidence.record.id}; consoleErrors=${consoleErrors.length}; pageErrors=${pageErrors.length}.`);
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => {
    server.httpServer.close((error) => (error ? reject(error) : resolve()));
  });
}
