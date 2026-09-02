#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { chromium } from '@playwright/test';
import { preview } from 'vite';

const manifest = JSON.parse(await readFile(new URL('../../dist/.vite/manifest.json', import.meta.url), 'utf8'));
const historyChunk = manifest['src/analysis/analysis_history_controller.js']?.file;
assert.ok(historyChunk, 'Browser smoke requires the Analysis History lazy chunk in the Vite manifest');
const routeCorridorUiChunk = manifest['src/routes_crime/route_corridor_ui_controller.js']?.file;
assert.ok(routeCorridorUiChunk, 'Browser smoke requires a separately lazy Route corridor UI chunk');
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
  if (/MIN\s*\(\s*dispatch_date_time\b/i.test(body)) {
    return { rows: [{ min_dt: '2006-01-01T00:00:00Z', max_dt: '2026-07-30T00:00:00Z' }] };
  }
  if (/format=GeoJSON/i.test(body)) return { type: 'FeatureCollection', features: [] };
  if (/SELECT\s+dc_dist,\s*COUNT\(\*\)\s+AS\s+n[\s\S]*GROUP\s+BY\s+1\s+ORDER\s+BY\s+1/i.test(body)) {
    return { rows: [{ dc_dist: '06', n: 12 }] };
  }
  if (/date_trunc\('month',\s*dispatch_date_time\)\s+AS\s+m/i.test(body)) {
    return { rows: [{ m: '2025-07-01T00:00:00Z', n: 12 }] };
  }
  if (/EXTRACT\(DOW[\s\S]*AS\s+dow[\s\S]*EXTRACT\(HOUR[\s\S]*AS\s+hr/i.test(body)) {
    return { rows: [{ dow: 1, hr: 12, n: 12 }] };
  }
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
    const body = decodeURIComponent(route.request().postData() || '');
    if (/format=GeoJSON/i.test(body)) {
      networkControl.pointRefreshRequests += 1;
    }
    if (networkControl.holdCarto) await networkControl.cartoGate;
    const districtBoundaryCounts = /SELECT\s+dc_dist,\s*COUNT\(\*\)\s+AS\s+n[\s\S]*GROUP\s+BY\s+1\s+ORDER\s+BY\s+1/i.test(body);
    if (networkControl.failCarto && !districtBoundaryCounts) {
      networkControl.failedCartoResponses += 1;
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

async function ensureCrimeEditing(page) {
  const panel = page.locator('#sidepanel');
  if (await panel.getAttribute('data-crime-stage') !== 'edit') {
    await page.locator('[data-analysis-context-edit]').click();
    await panel.locator('[data-crime-setup]').waitFor({ state: 'visible' });
  }
}

async function ensureCrimeResults(page) {
  const panel = page.locator('#sidepanel');
  if (await panel.getAttribute('data-crime-stage') === 'edit') {
    await page.locator('[data-analysis-context-edit]').click();
  }
  await panel.locator('[data-crime-results]').waitFor({ state: 'visible' });
}

async function ensureSavedAnalysesOpen(page) {
  await ensureCrimeResults(page);
  const details = page.locator('[data-analysis-history-disclosure]');
  await details.waitFor({ state: 'visible' });
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

async function readDiarySnapshot(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const openRequest = indexedDB.open('engagement-diary', 2);
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction(['route_entries', 'rating_drafts'], 'readonly');
      const entriesRequest = transaction.objectStore('route_entries').getAll();
      const draftsRequest = transaction.objectStore('rating_drafts').getAll();
      let entries = [];
      let drafts = [];
      entriesRequest.onsuccess = () => { entries = entriesRequest.result || []; };
      draftsRequest.onsuccess = () => { drafts = draftsRequest.result || []; };
      transaction.oncomplete = () => {
        database.close();
        resolve({ entries, drafts });
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    };
  }));
}

async function putDiaryRows(page, { entries = [], drafts = [] } = {}) {
  await page.evaluate(({ entries: nextEntries, drafts: nextDrafts }) => new Promise((resolve, reject) => {
    const openRequest = indexedDB.open('engagement-diary', 2);
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction(['route_entries', 'rating_drafts'], 'readwrite');
      for (const entry of nextEntries) transaction.objectStore('route_entries').put(entry);
      for (const draft of nextDrafts) transaction.objectStore('rating_drafts').put(draft);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    };
  }), { entries, drafts });
}

async function seedLegacyDiaryDatabase(page, entry) {
  await page.evaluate((legacyEntry) => new Promise((resolve, reject) => {
    const deletion = indexedDB.deleteDatabase('engagement-diary');
    deletion.onerror = () => reject(deletion.error);
    deletion.onblocked = () => reject(new Error('Legacy Diary database deletion was blocked.'));
    deletion.onsuccess = () => {
      const openRequest = indexedDB.open('engagement-diary', 1);
      openRequest.onupgradeneeded = () => {
        const database = openRequest.result;
        const entries = database.createObjectStore('route_entries', { keyPath: 'id' });
        entries.createIndex('createdAt', 'createdAt');
        entries.put(legacyEntry);
      };
      openRequest.onerror = () => reject(openRequest.error);
      openRequest.onsuccess = () => {
        openRequest.result.close();
        resolve();
      };
    };
  }), entry);
}

async function waitForDiarySnapshot(page, predicate, message, timeoutMs = 4_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const snapshot = await readDiarySnapshot(page);
    if (predicate(snapshot)) return snapshot;
    await page.waitForTimeout(50);
  }
  throw new Error(message);
}

async function assertFocused(locator, message) {
  await locator.waitFor();
  const handle = await locator.elementHandle();
  assert.ok(handle, message);
  await locator.page().waitForFunction(
    (element) => document.activeElement === element,
    handle,
    { timeout: 4_000 },
  );
  assert.equal(await locator.evaluate((element) => document.activeElement === element), true, message);
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
    failedCartoResponses: 0,
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
  await page.getByRole('heading', { name: 'Route Experience Diary (demo)' }).waitFor();
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

  const routeOptions = await diaryRouteSelect.locator('option').evaluateAll((options) => (
    options.map((option) => option.value).filter(Boolean)
  ));
  assert.ok(routeOptions.length >= 2, 'Diary draft isolation requires at least two demo routes');
  const [routeA, routeB] = routeOptions;

  await page.getByRole('button', { name: 'Rate your experience on this route' }).click();
  await page.getByRole('radio', { name: '4 stars' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'poor lighting' }).click();
  await page.locator('#diary-rating-notes').fill('Keep this unfinished note');
  await waitForDiarySnapshot(
    page,
    (snapshot) => snapshot.drafts.some((draft) => (
      draft.routeId === routeA && draft.rating === 4 && draft.notes === 'Keep this unfinished note'
    )),
    'Route A draft was not persisted before reload',
  );
  await page.getByRole('button', { name: 'Close rating dialog' }).click();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Route Experience Diary (demo)' }).waitFor();
  const restoredRouteSelect = page.locator('[data-panel-view="diary"] select.diary-select').first();
  await restoredRouteSelect.selectOption(routeA);
  await page.getByRole('button', { name: 'Rate your experience on this route' }).click();
  await page.getByText('Unfinished rating restored from this device.').waitFor();
  assert.match(await page.locator('.diary-step-label').textContent(), /Step 2/);
  assert.equal(await page.getByRole('button', { name: 'poor lighting' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#diary-rating-notes').inputValue(), 'Keep this unfinished note');
  await page.getByRole('button', { name: 'Close rating dialog' }).click();

  await restoredRouteSelect.selectOption(routeB);
  await page.getByRole('button', { name: 'Rate your experience on this route' }).click();
  assert.match(await page.locator('.diary-step-label').textContent(), /Step 1/);
  await page.getByRole('radio', { name: '3 stars' }).click();
  await waitForDiarySnapshot(
    page,
    (snapshot) => snapshot.drafts.some((draft) => draft.routeId === routeB && draft.rating === 3),
    'Route B draft was not persisted independently',
  );
  await page.getByRole('button', { name: 'Close rating dialog' }).click();

  await restoredRouteSelect.selectOption(routeA);
  await page.getByRole('button', { name: 'Rate your experience on this route' }).click();
  await page.getByText('Unfinished rating restored from this device.').waitFor();
  await page.getByRole('button', { name: 'Save rating' }).click();
  await page.getByText('Saved locally on this device.').waitFor();

  const committedDiary = await waitForDiarySnapshot(
    page,
    (snapshot) => (
      snapshot.entries.some((entry) => entry.routeId === routeA)
      && !snapshot.drafts.some((draft) => draft.routeId === routeA)
      && snapshot.drafts.some((draft) => draft.routeId === routeB)
    ),
    'Successful rating did not commit Route A while preserving Route B draft',
  );
  const routeAEntry = committedDiary.entries.find((entry) => entry.routeId === routeA);

  const otherEntry = {
    kind: 'engagement-diary-entry',
    schemaVersion: 2,
    id: 'browser-smoke-other-entry',
    createdAt: '2026-08-04T04:00:00.000Z',
    updatedAt: '2026-08-04T04:00:00.000Z',
    routeId: routeB,
    label: 'Other local route',
    mode: 'walk',
    score: 2,
    tags: [],
    segmentIds: [],
    routeGeometry: null,
    routeSourceVersion: 'browser-smoke',
    notes: '',
    segmentOverrides: {},
  };
  await putDiaryRows(page, { entries: [otherEntry] });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'My routes', exact: true }).click();
  await page.locator('.diary-score-pill').filter({ hasText: '4.0' }).waitFor();
  const historyPeriod = page.getByRole('combobox', { name: 'Time period' });
  await historyPeriod.selectOption('all');
  await assertFocused(historyPeriod, 'history filter focus must survive its rerender');
  await page.getByRole('button', { name: `Delete ${routeAEntry.label}` }).click();
  const deleteConfirm = page.getByRole('button', { name: 'Yes, delete' });
  await assertFocused(deleteConfirm, 'delete confirmation must receive focus');
  assert.match(await deleteConfirm.getAttribute('aria-describedby'), /diary-delete-confirm-prompt/);
  await deleteConfirm.click();
  await page.getByText(`“${routeAEntry.label}” was deleted from this device.`).waitFor();
  await assertFocused(page.locator('#diary-route-history-title'), 'successful delete must return focus to route history');
  const afterDelete = await readDiarySnapshot(page);
  assert.equal(afterDelete.entries.some((entry) => entry.id === routeAEntry.id), false);
  assert.equal(afterDelete.entries.some((entry) => entry.id === otherEntry.id), true);
  assert.equal(afterDelete.drafts.some((draft) => draft.routeId === routeB), true);

  const diaryBackupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export private backup' }).click();
  const diaryBackup = await diaryBackupDownload;
  const diaryBackupPath = await diaryBackup.path();
  const diaryBackupPayload = JSON.parse(await readFile(diaryBackupPath, 'utf8'));
  assert.equal(diaryBackupPayload.kind, 'engagement-diary-private-backup');
  assert.equal(diaryBackupPayload.schemaVersion, 2);
  assert.equal(JSON.stringify(diaryBackupPayload).includes('user_hash'), false);
  assert.equal(JSON.stringify(diaryBackupPayload).includes('payload'), false);
  assert.equal(diaryBackupPayload.entries.some((entry) => entry.id === otherEntry.id), true);
  assert.equal(diaryBackupPayload.drafts.some((draft) => draft.routeId === routeB), true);
  await page.getByText('Private backup exported.').waitFor();
  await assertFocused(page.locator('[data-diary-focus-target="data-status"]'), 'export completion must focus its status');

  const backupInput = page.locator('.diary-private-data-card input[type="file"]');
  await backupInput.setInputFiles(diaryBackupPath);
  const importPreviewHeading = page.getByRole('heading', { name: 'Review backup before importing' });
  await importPreviewHeading.waitFor();
  await assertFocused(importPreviewHeading, 'validated backup must focus its import preview');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('Backup import cancelled. Local data was not changed.').waitFor();
  await assertFocused(page.getByRole('button', { name: 'Choose backup file' }), 'cancelled import must return focus to file selection');
  await backupInput.setInputFiles(diaryBackupPath);
  await importPreviewHeading.waitFor();
  await assertFocused(importPreviewHeading, 'reselected backup must focus its refreshed import preview');
  const backedUpRouteBDraft = diaryBackupPayload.drafts.find((draft) => draft.routeId === routeB);
  const backedUpRouteBTime = Date.parse(backedUpRouteBDraft.updatedAt);
  assert.equal(Number.isFinite(backedUpRouteBTime), true, 'Exported Diary draft must have a valid update time');
  const locallyUpdatedRouteBDraft = {
    ...backedUpRouteBDraft,
    rating: 5,
    updatedAt: new Date(backedUpRouteBTime + 60_000).toISOString(),
  };
  await putDiaryRows(page, { drafts: [locallyUpdatedRouteBDraft] });
  await page.getByRole('button', { name: 'Merge backup' }).click();
  await page.getByText(/Backup merged:/).waitFor();
  await assertFocused(page.locator('[data-diary-focus-target="data-status"]'), 'merge completion must focus its status');
  assert.equal((await readDiarySnapshot(page)).drafts.find((draft) => draft.routeId === routeB)?.rating, 5);

  await backupInput.setInputFiles(diaryBackupPath);
  await page.getByRole('heading', { name: 'Review backup before importing' }).waitFor();
  const concurrentDraft = {
    ...locallyUpdatedRouteBDraft,
    updatedAt: new Date(Date.parse(locallyUpdatedRouteBDraft.updatedAt) + 60_000).toISOString(),
    rating: 2,
    notes: 'Edited after the replace preview without changing record counts',
  };
  await putDiaryRows(page, { drafts: [concurrentDraft] });
  await page.getByRole('button', { name: 'Replace local data…' }).click();
  const replaceConfirm = page.getByRole('button', { name: 'Yes, replace local data' });
  await assertFocused(replaceConfirm, 'replace confirmation must receive focus');
  assert.match(await replaceConfirm.getAttribute('aria-describedby'), /diary-replace-confirm-warning/);
  await replaceConfirm.click();
  await page.getByText(/Local Diary data changed after this preview/).waitFor();
  const staleImportStatus = page.locator('[data-diary-focus-target="data-status"]');
  await assertFocused(staleImportStatus, 'stale replacement error must focus its alert');
  assert.equal(await staleImportStatus.getAttribute('role'), 'alert');
  assert.equal(
    (await readDiarySnapshot(page)).drafts.find((draft) => draft.routeId === concurrentDraft.routeId)?.notes,
    concurrentDraft.notes,
    'A stale destructive preview must not overwrite same-count concurrent local edits',
  );

  await page.getByRole('button', { name: 'Sample community', exact: true }).click();
  await page.getByText('Static examples — not real-time or user-submitted, not representative, no official endorsement, and not safety/risk ratings', { exact: true }).waitFor();
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
  await page.goto(new URL('?mode=crime&utm_source=portfolio&codes=Thefts&analysis=buffer&a=-75.166154%2C39.95218&b=-75.16%2C39.97&labelA=PRIVATE+A&labelB=PRIVATE+B', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-crime-setup]').waitFor({ state: 'visible' });
  await page.locator('#compare-card').waitFor({ state: 'hidden' });
  for (const privateKey of ['a', 'b', 'labelA', 'labelB']) {
    assert.equal(new URL(page.url()).searchParams.has(privateKey), false, `Crime startup leaked private URL key ${privateKey}`);
  }
  assert.equal(
    networkControl.pointRefreshRequests - pointRefreshRequestsBeforeCrimeEntry,
    0,
    'An unselected Crime entry must not request citywide incident points',
  );
  await ensureAdvancedFiltersOpen(page);
  await page.locator('#addrA').fill('1500 Market St');
  const geocoderRequestsBeforePrivateAction = requests.filter((url) => url.startsWith('https://citygeo-geocoder-pub.databridge.phila.gov/')).length;
  const pointRefreshRequestsBeforePrivateAction = networkControl.pointRefreshRequests;
  await page.locator('#searchABtn').click();
  await page.locator('#addressStatus').filter({ hasText: /private address and buffer analysis is unavailable/i }).waitFor();
  assert.equal(await page.locator('#addrA').inputValue(), '1500 Market St');
  assert.equal(
    requests.filter((url) => url.startsWith('https://citygeo-geocoder-pub.databridge.phila.gov/')).length,
    geocoderRequestsBeforePrivateAction,
    'Private address search must fail before geocoder egress',
  );
  assert.equal(
    networkControl.pointRefreshRequests,
    pointRefreshRequestsBeforePrivateAction,
    'Private address search must fail before Crime buffer egress',
  );
  for (const privateKey of ['a', 'b', 'labelA', 'labelB']) {
    assert.equal(new URL(page.url()).searchParams.has(privateKey), false, `Private address action leaked URL key ${privateKey}`);
  }

  const publicCrimeUrl = new URL('?mode=crime&view=list&analysis=district&district=06&utm_source=portfolio&codes=Thefts', baseUrl);
  await page.goto(publicCrimeUrl.href, { waitUntil: 'domcontentloaded' });
  await page.locator('#compare-card').filter({ hasText: '12 reported incidents' }).waitFor();
  await page.waitForFunction(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('view') === 'list' && params.get('analysis') === 'district' && params.get('district') === '06';
  });
  assert.equal(
    new URL(page.url()).searchParams.get('codes'),
    'Thefts',
    'A canonical direct offense filter must survive time-window option reconciliation',
  );
  for (const privateKey of ['a', 'b', 'labelA', 'labelB']) {
    assert.equal(new URL(page.url()).searchParams.has(privateKey), false, `Public district flow leaked URL key ${privateKey}`);
  }
  for (const resultName of ['incidents', 'charts', 'summary']) {
    await page.locator(`[data-result-meta="${resultName}"][data-availability="current"]`).waitFor({ state: 'attached' });
  }
  await page.getByRole('radio', { name: 'Map', exact: true }).check();
  await page.locator('[data-primary-canvas]').waitFor({ state: 'visible' });
  const summaryMeta = page.locator('[data-result-meta="summary"]');
  await summaryMeta.locator('details > summary').click();
  assert.match(await summaryMeta.textContent(), /CARTO/);
  assert.match(await summaryMeta.textContent(), /2024|2025|2026/);

  const focusUrlBefore = page.url();
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  const focusDialog = page.locator('[data-task-focus-dialog]');
  await focusDialog.locator('[data-task-focus-option][value="long_term"]').check();
  await focusDialog.getByRole('button', { name: 'Apply', exact: true }).click();
  assert.equal(page.url(), focusUrlBefore, 'Task focus must not mutate the canonical Crime URL');
  assert.equal(await page.locator('[data-task-focus-current]').textContent(), 'Long-term context');
  assert.deepEqual(
    await page.locator('[data-panel-view="crime"] [data-result-pane-target]').evaluateAll(
      (buttons) => buttons.map((button) => button.dataset.resultPaneTarget),
    ),
    ['charts', 'summary', 'incidents'],
    'Long-term focus must immediately put trends first without mutating the analysis',
  );
  await page.locator('[data-result-pane="summary"]').waitFor({ state: 'visible' });

  const routeUrlBefore = page.url();
  const routeRequestsBefore = networkControl.pointRefreshRequests;
  assert.equal(
    await page.evaluate((chunk) => performance.getEntriesByType('resource').some((entry) => entry.name.endsWith(chunk)), routeCorridorUiChunk),
    false,
    'Changing task focus must not import the Route corridor UI',
  );
  await page.getByRole('button', { name: 'View records near a known route' }).click();
  const routeSurface = page.locator('[data-route-corridor-surface]');
  await routeSurface.waitFor({ state: 'visible' });
  assert.equal(await routeSurface.getAttribute('data-route-status'), 'route-required');
  assert.equal(page.url(), routeUrlBefore, 'Opening Route corridor UI must not mutate the canonical URL');
  assert.equal(networkControl.pointRefreshRequests, routeRequestsBefore, 'Opening Route corridor UI must not request incidents');
  assert.equal(
    await page.evaluate((chunk) => performance.getEntriesByType('resource').some((entry) => entry.name.endsWith(chunk)), routeCorridorUiChunk),
    true,
    'The explicit route action must load the second-level UI chunk',
  );
  await page.getByRole('button', { name: 'Switch to Simplified Chinese' }).click();
  await routeSurface.getByRole('heading', { name: '已知路线历史记录' }).waitFor();
  assert.match(await routeSurface.locator('[data-route-query-context]').textContent(), /历史时间/);
  await page.getByRole('button', { name: '切换到英文' }).click();
  await routeSurface.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: 'List', exact: true }).check();
  await page.locator('[data-crime-list-workspace]').waitFor({ state: 'visible' });

  const presetUrlBefore = new URL(page.url());
  const presetDisclosure = page.locator('[data-query-preset-mount]');
  assert.equal(await presetDisclosure.getAttribute('open'), null, 'Suggested time windows should be collapsed by default');
  await presetDisclosure.locator(':scope > summary').click();
  const presetDialog = page.locator('[data-query-preset-dialog]');
  await presetDisclosure.locator('[data-query-preset="latest-6-months"]').click();
  await presetDialog.locator('[data-query-preset-status]').filter({ hasText: 'Nothing has been applied yet' }).waitFor();
  assert.equal(await presetDialog.locator('[data-query-preset-changes] > li').count(), 2);
  await presetDialog.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(page.url(), presetUrlBefore.href, 'Cancelling a query preset preview must keep the URL unchanged');

  const pointRefreshRequestsBeforeQueryPreset = networkControl.pointRefreshRequests;
  await presetDisclosure.locator('[data-query-preset="latest-6-months"]').click();
  await presetDialog.getByRole('button', { name: 'Apply and refresh once' }).click();
  await page.waitForFunction(() => new URLSearchParams(window.location.search).get('months') === '6');
  await presetDialog.locator('[data-query-preset-status]').filter({ hasText: 'historical results are ready' }).waitFor();
  assert.equal(
    networkControl.pointRefreshRequests - pointRefreshRequestsBeforeQueryPreset,
    1,
    'Applying one query preset must own exactly one Crime refresh generation',
  );
  const appliedPresetUrl = new URL(page.url());
  assert.equal(appliedPresetUrl.searchParams.has('preset'), false, 'Preset identity must not become URL truth');
  for (const key of new Set([...presetUrlBefore.searchParams.keys(), ...appliedPresetUrl.searchParams.keys()])) {
    if (key === 'start' || key === 'months') continue;
    assert.equal(
      appliedPresetUrl.searchParams.get(key),
      presetUrlBefore.searchParams.get(key),
      `Query preset apply must preserve canonical field ${key}`,
    );
  }
  await presetDialog.getByRole('button', { name: 'Undo this change' }).click();
  await page.waitForFunction((expectedMonths) => (
    new URLSearchParams(window.location.search).get('months') === expectedMonths
  ), presetUrlBefore.searchParams.get('months'));
  await presetDialog.locator('[data-query-preset-status]').filter({ hasText: 'prior query was restored' }).waitFor();
  const restoredPresetUrl = new URL(page.url());
  for (const key of new Set([...presetUrlBefore.searchParams.keys(), ...restoredPresetUrl.searchParams.keys()])) {
    assert.equal(
      restoredPresetUrl.searchParams.get(key),
      presetUrlBefore.searchParams.get(key),
      `Query preset undo must restore ${key}`,
    );
  }
  await presetDialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('radio', { name: 'Map', exact: true }).check();
  await page.locator('[data-primary-canvas]').waitFor({ state: 'visible' });
  await ensureCrimeResults(page);
  await page.getByRole('button', { name: 'Charts', exact: true }).click();
  await page.locator('[data-result-pane="charts"]').waitFor({ state: 'visible' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#compare-card').filter({ hasText: '12 reported incidents' }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('analysis'), 'district');
  assert.equal(new URL(page.url()).searchParams.get('district'), '06');
  await ensureCrimeResults(page);
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

  await ensureSavedAnalysesOpen(page);
  await page.getByLabel('Analysis title').fill('Ignored draft title');
  await page.getByRole('button', { name: 'Save analysis' }).click();
  await artifactCard(page, 'District 06 analysis').waitFor();
  const savedDistrictArtifact = await readSavedArtifact(page, 'District 06 analysis');
  assert.equal(savedDistrictArtifact?.schemaVersion, 3);
  assert.equal(savedDistrictArtifact?.viewState?.queryMode, 'district');
  assert.equal(savedDistrictArtifact?.viewState?.selectedDistrictCode, '06');
  assert.equal(savedDistrictArtifact?.resultSummary?.comparison?.a?.total, 12);
  assert.equal(savedDistrictArtifact?.resultSummary?.comparison?.a?.label, 'District 06');
  assert.equal(savedDistrictArtifact?.resultSummary?.comparison?.b, null);
  assert.doesNotMatch(JSON.stringify(savedDistrictArtifact), /1500 Market|PRIVATE A|PRIVATE B|-75\.166154|39\.95218/);
  assert.ok((await listDatabaseNames(page)).includes('engagement-analysis'));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await ensureSavedAnalysesOpen(page);
  await artifactCard(page, 'District 06 analysis').waitFor();
  await artifactCard(page, 'District 06 analysis').locator('.analysis-history__data-status').filter({ hasText: 'Sources current' }).waitFor({ state: 'attached' });
  await ensureCrimeEditing(page);
  await ensureAdvancedFiltersOpen(page);
  await page.locator('#durationSel').selectOption('6');
  await page.locator('#startMonth').fill('2026-02');
  await page.locator('#startMonth').dispatchEvent('change');
  await page.waitForFunction(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('months') === '6' && params.get('start') === '2026-02';
  });
  await page.waitForTimeout(1200);

  await page.locator('#shareViewBtn').click();
  const currentSharedUrl = new URL(page.url());
  assert.equal(currentSharedUrl.searchParams.get('utm_source'), 'portfolio');
  assert.equal(currentSharedUrl.searchParams.get('analysis'), 'district');
  assert.equal(currentSharedUrl.searchParams.get('district'), '06');
  for (const privateKey of ['a', 'b', 'labelA', 'labelB']) {
    assert.equal(currentSharedUrl.searchParams.has(privateKey), false, `Current share URL leaked ${privateKey}`);
  }

  const jsonDownload = page.waitForEvent('download');
  await page.locator('#exportJsonBtn').click();
  const downloadedJson = await jsonDownload;
  assert.equal(downloadedJson.suggestedFilename(), 'engagement-analysis.json');
  const jsonPayload = JSON.parse(await readFile(await downloadedJson.path(), 'utf8'));
  assert.equal(jsonPayload.filters.queryMode, 'district');
  assert.equal(jsonPayload.filters.selectedDistrictCode, '06');
  assert.equal(jsonPayload.comparison.a.total, 12);
  assert.equal(jsonPayload.comparison.a.label, 'District 06');
  assert.equal(jsonPayload.comparison.b, null);
  assert.doesNotMatch(JSON.stringify(jsonPayload), /addressA|addressB|centerLonLat|center3857|PRIVATE/);
  const csvDownload = page.waitForEvent('download');
  await page.locator('#exportCsvBtn').click();
  const downloadedCsv = await csvDownload;
  assert.equal(downloadedCsv.suggestedFilename(), 'engagement-comparison.csv');
  const csvPayload = await readFile(await downloadedCsv.path(), 'utf8');
  assert.match(csvPayload, /A,"District 06",12/);
  assert.doesNotMatch(csvPayload, /1500 Market|PRIVATE|N BROAD ST/);

  await page.getByRole('radio', { name: 'List', exact: true }).check();
  await page.locator('[data-crime-list-workspace]').waitFor({ state: 'visible' });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#compare-card').filter({ hasText: '12 reported incidents' }).waitFor();
  let releaseCarto;
  networkControl.cartoGate = new Promise((resolve) => { releaseCarto = resolve; });
  networkControl.holdCarto = true;
  const requestsBeforeRestore = requests.length;
  const pointRefreshRequestsBeforeRestore = networkControl.pointRefreshRequests;
  const freshCartoRequest = page.waitForRequest((request) => request.url().startsWith('https://phl.carto.com/'));
  await ensureSavedAnalysesOpen(page);
  await artifactCard(page, 'District 06 analysis').getByRole('button', { name: 'Open' }).click();
  await page.locator('.analysis-history__snapshot').waitFor({ state: 'visible' });
  await page.locator('#compare-card').filter({ hasText: '12 reported incidents' }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('analysis'), 'district');
  assert.equal(new URL(page.url()).searchParams.get('district'), '06');
  assert.equal(new URL(page.url()).searchParams.get('months'), '12');
  for (const privateKey of ['a', 'b', 'labelA', 'labelB']) {
    assert.equal(new URL(page.url()).searchParams.has(privateKey), false, `Artifact restore URL leaked ${privateKey}`);
  }
  await freshCartoRequest;
  assert.ok(
    requests.slice(requestsBeforeRestore).some((url) => url.startsWith('https://phl.carto.com/')),
    'Opening an artifact must issue fresh Crime network activity',
  );
  assert.equal(await page.locator('.analysis-history__snapshot').isVisible(), true);
  assert.equal(
    networkControl.pointRefreshRequests - pointRefreshRequestsBeforeRestore,
    1,
    'Held public artifact restore must start exactly one Crime refresh generation',
  );
  await page.getByRole('button', { name: 'Diary', exact: true }).click();
  await page.getByRole('heading', { name: 'Route Experience Diary (demo)' }).waitFor();
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
  uncachedRestoreUrl.searchParams.set('view', 'list');
  uncachedRestoreUrl.searchParams.set('start', '2026-02');
  uncachedRestoreUrl.searchParams.set('months', '6');
  await page.goto(uncachedRestoreUrl.href, { waitUntil: 'domcontentloaded' });
  await ensureSavedAnalysesOpen(page);
  await artifactCard(page, 'District 06 analysis').waitFor();
  await page.locator('.analysis-history__snapshot').waitFor({ state: 'hidden' });
  await page.locator('#compare-card').filter({ hasText: '12 reported incidents' }).waitFor();
  for (const resultName of ['incidents', 'charts', 'summary']) {
    await page.locator(`[data-result-meta="${resultName}"][data-availability="current"]`).waitFor({ state: 'attached' });
  }
  await page.getByRole('radio', { name: 'Map', exact: true }).check();
  await page.locator('[data-primary-canvas]').waitFor({ state: 'visible' });
  networkControl.stage = 'failCarto';
  networkControl.failCarto = true;
  await artifactCard(page, 'District 06 analysis').getByRole('button', { name: 'Open' }).click();
  await page.waitForFunction(() => /refresh failed/i.test(document.querySelector('.analysis-history__snapshot')?.textContent || ''));
  assert.equal(new URL(page.url()).searchParams.get('district'), '06');
  assert.match(await page.locator('#compare-card').textContent(), /12 reported incidents/);
  assert.deepEqual(
    await page.locator('[data-result-meta="incidents"], [data-result-meta="charts"]').evaluateAll(
      (items) => items.map((item) => [item.dataset.resultMeta, item.dataset.availability]),
    ),
    [['incidents', 'unavailable'], ['charts', 'stale']],
  );
  await page.locator('[data-result-meta="summary"][data-availability="partial"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('[data-app-data-status]').getAttribute('data-phase'), 'ready');
  networkControl.failCarto = false;
  networkControl.stage = 'normal';
  await page.getByRole('button', { name: 'Charts', exact: true }).click();
  await page.locator('[data-result-pane="charts"]').waitFor({ state: 'visible' });
  await page.locator('[data-result-meta="charts"] [data-result-meta-retry]').click();
  await page.locator('[data-result-meta="charts"][data-availability="current"]').waitFor();
  await ensureCrimeEditing(page);
  await ensureAdvancedFiltersOpen(page);
  await page.locator('#durationSel').selectOption('6');
  await page.locator('.analysis-history__snapshot').waitFor({ state: 'hidden' });

  await ensureSavedAnalysesOpen(page);
  await artifactCard(page, 'District 06 analysis').getByRole('button', { name: 'Share' }).click();
  await page.locator('.analysis-history__status').filter({ hasText: 'Share link copied' }).waitFor();
  const sharedUrl = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  assert.equal(sharedUrl.searchParams.get('utm_source'), 'portfolio');
  assert.equal(sharedUrl.searchParams.get('mode'), 'crime');
  assert.equal(sharedUrl.searchParams.get('analysis'), 'district');
  assert.equal(sharedUrl.searchParams.get('district'), '06');
  assert.equal(sharedUrl.searchParams.get('months'), '12');
  for (const privateKey of ['a', 'b', 'labelA', 'labelB', 'artifact', 'artifactId', 'title', 'result']) {
    assert.equal(sharedUrl.searchParams.has(privateKey), false, `Share URL leaked ${privateKey}`);
  }

  const artifactDownload = page.waitForEvent('download');
  await artifactCard(page, 'District 06 analysis').getByRole('button', { name: 'Export' }).click();
  const downloadedArtifact = await artifactDownload;
  const artifactPayload = JSON.parse(await readFile(await downloadedArtifact.path(), 'utf8'));
  assert.equal(artifactPayload.kind, 'engagement-analysis-artifact');
  assert.equal(artifactPayload.schemaVersion, 3);
  assert.equal(artifactPayload.title, 'District 06 analysis');
  assert.equal(artifactPayload.viewState.queryMode, 'district');
  assert.equal(artifactPayload.viewState.selectedDistrictCode, '06');
  assert.doesNotMatch(JSON.stringify(artifactPayload), /addressA|addressB|centerLonLat|center3857|PRIVATE/);

  page.once('dialog', (dialog) => dialog.accept());
  await artifactCard(page, 'District 06 analysis').getByRole('button', { name: 'Delete' }).click();
  await artifactCard(page, 'District 06 analysis').waitFor({ state: 'detached' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ensureSavedAnalysesOpen(page);
  await page.locator('.analysis-history__empty').waitFor();
  assert.equal(await artifactCard(page, 'District 06 analysis').count(), 0);

  const pointRequestsBeforeClear = networkControl.pointRefreshRequests;
  await ensureCrimeEditing(page);
  await page.locator('#clearSelBtn').filter({ hasText: 'Clear selection' }).click();
  await page.waitForFunction(() => !new URLSearchParams(window.location.search).has('district'));
  await page.locator('[data-crime-setup]').waitFor({ state: 'visible' });
  await page.locator('#compare-card').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#clearSelBtn').isHidden(), true);
  assert.equal(
    networkControl.pointRefreshRequests - pointRequestsBeforeClear,
    0,
    'Clearing a district selection must not trigger a citywide incident request',
  );

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
    let workspaceVisibleDuringBlock = false;
    oldConnection.onversionchange = () => { versionchange = true; };
    let resolveBlocked;
    const blockedEvent = new Promise((resolve) => { resolveBlocked = resolve; });
    const upgraded = new Promise((resolve, reject) => {
      const request = indexedDB.open('engagement-analysis', 2);
      request.onblocked = () => {
        blocked = true;
        workspaceVisibleDuringBlock = Boolean(document.querySelector('[data-crime-setup]')?.getClientRects().length);
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
      workspaceVisibleDuringBlock,
      version: upgradedConnection.version,
      record,
    };
    upgradedConnection.close();
    return evidence;
  });
  assert.deepEqual(upgradeEvidence, {
    blocked: true,
    versionchange: true,
    workspaceVisibleDuringBlock: true,
    version: 2,
    record: { id: 'migration-fixture', value: 'preserved' },
  });
  const migrationContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'en-US',
  });
  let diaryMigrationEvidence;
  try {
    const migrationPage = await migrationContext.newPage();
    await installDeterministicApiRoutes(migrationPage, {
      holdCarto: false,
      failCarto: false,
      cartoGate: Promise.resolve(),
      pointRefreshRequests: 0,
      failedCartoResponses: 0,
    });
    await migrationPage.goto(new URL('?mode=crime', baseUrl).href, { waitUntil: 'domcontentloaded' });
    await seedLegacyDiaryDatabase(migrationPage, {
      id: 'legacy-diary-entry',
      createdAt: '2026-08-01T00:00:00.000Z',
      label: 'Legacy route',
      mode: 'walk',
      user_hash: 'top-level-secret',
      payload: {
        route_id: 'legacy-route',
        overall_rating: 4,
        tags: ['poor_lighting'],
        segment_ids: ['seg-1'],
        notes: 'Migrated in the browser',
        segment_overrides: { 'seg-1': 2 },
        user_hash: 'nested-secret',
      },
    });
    await migrationPage.goto(new URL('?mode=diary', baseUrl).href, { waitUntil: 'domcontentloaded' });
    await migrationPage.getByRole('heading', { name: 'Route Experience Diary (demo)' }).waitFor();
    const migrated = await readDiarySnapshot(migrationPage);
    diaryMigrationEvidence = {
      entry: migrated.entries.find((entry) => entry.id === 'legacy-diary-entry'),
      draftStoreAvailable: Array.isArray(migrated.drafts),
    };
  } finally {
    await migrationContext.close();
  }
  assert.equal(diaryMigrationEvidence.entry.kind, 'engagement-diary-entry');
  assert.equal(diaryMigrationEvidence.entry.schemaVersion, 2);
  assert.equal(diaryMigrationEvidence.entry.notes, 'Migrated in the browser');
  assert.equal('payload' in diaryMigrationEvidence.entry, false);
  assert.equal(JSON.stringify(diaryMigrationEvidence.entry).includes('secret'), false);
  assert.equal(diaryMigrationEvidence.draftStoreAvailable, true);
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
  assert.ok(networkControl.failedCartoResponses > 0, 'The partial-failure scenario must exercise Carto 503 responses');
  assert.equal(
    expectedCartoConsoleErrors,
    networkControl.failedCartoResponses,
    'Only resource errors caused by the deliberate Carto 503 responses may be exempted',
  );

  console.log(`[Browser Smoke] PASS - Diary historyChunk=false/analysisDb=false; Diary v1->v2 canonical=${diaryMigrationEvidence.entry.schemaVersion}; held restore point requests=1; cached comparison retained for cancel/failure; freshness current-mismatch-current; intentionalCarto503=${expectedCartoConsoleErrors}; remote hosts mocked=${new Set(remoteRequests.map((url) => new URL(url).hostname)).size}; IndexedDB blocked=${upgradeEvidence.blocked}/versionchange=${upgradeEvidence.versionchange}/workspaceVisible=${upgradeEvidence.workspaceVisibleDuringBlock}/version=${upgradeEvidence.version}/record=${upgradeEvidence.record.id}; consoleErrors=${consoleErrors.length}; pageErrors=${pageErrors.length}.`);
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => {
    server.httpServer.close((error) => (error ? reject(error) : resolve()));
  });
}
