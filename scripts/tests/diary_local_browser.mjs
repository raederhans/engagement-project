#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { chromium } from '@playwright/test';

import { installDeterministicRoutes } from './support/deterministic_browser_fixture.mjs';

const DIST_DIR = path.resolve('dist');
const MANIFEST_PATH = path.join(DIST_DIR, '.vite', 'manifest.json');
const SENTINELS = Object.freeze([
  'M6_PRIVATE_<script>_NOTE?token=8841&email=private@example.invalid',
  'M6_PRIVATE_ROUTE_ID_7919',
  'M6_PRIVATE_DRAFT_6627',
]);

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
const storageChunk = manifest['src/routes_diary/diary_storage.js']?.file;
assert.match(storageChunk || '', /^assets\/diary_storage-[\w-]+\.js$/, 'built Diary storage chunk is required');

const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'engagement-diary-m6-'));
const profileDir = path.join(temporaryRoot, 'chromium-profile');
const exportPath = path.join(temporaryRoot, 'diary-export.json');
const observations = {
  console: [],
  pageErrors: [],
  requests: [],
  urls: [],
  webSockets: [],
};

let server;
let context;
let page;
let baseUrl;
let expectedEntry;
let expectedDraft;
let primaryError;
const cleanupErrors = [];

try {
  server = await startDistServer(DIST_DIR);
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  baseUrl = new URL(`http://127.0.0.1:${address.port}/`);

  ({ context, page } = await launchDiary(profileDir, observations));
  await gotoDiary(page, 'initial');
  await createPrivateRating(page);

  const created = await readProductionSnapshot(page);
  assert.equal(created.entries.length, 1, 'UI create must persist one entry');
  assert.equal(created.entries[0].notes, SENTINELS[0]);
  assert.equal(created.entries[0].schemaVersion, 2);

  const updated = await updateProductionEntryAndDraft(page, created.entries[0]);
  expectedEntry = updated.entry;
  expectedDraft = updated.draft;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForDiary(page);
  await page.getByRole('button', { name: 'My routes', exact: true }).click();
  await page.locator(`[data-id="${expectedEntry.id}"]`).waitFor({ state: 'visible' });
  assert.equal(await page.locator(`[data-id="${expectedEntry.id}"] .diary-history-item__label`).innerText(), expectedEntry.label);
  observeCurrentUrl(page, 'after-update-reload');

  await context.close();
  context = null;
  page = null;
  ({ context, page } = await launchDiary(profileDir, observations));
  await gotoDiary(page, 'browser-restart');
  const afterRestart = await readProductionSnapshot(page);
  assert.deepEqual(afterRestart.entries, [expectedEntry], 'entry must survive a Chromium restart');
  assert.deepEqual(afterRestart.drafts, [expectedDraft], 'draft must survive a Chromium restart');

  await page.getByRole('button', { name: 'My routes', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export private backup' }).click();
  const download = await downloadPromise;
  await download.saveAs(exportPath);
  const exported = JSON.parse(await readFile(exportPath, 'utf8'));
  assert.equal(exported.kind, 'engagement-diary-private-backup');
  assert.equal(exported.schemaVersion, 2);
  assert.deepEqual(exported.entries, [expectedEntry], 'user-gesture export must retain every private entry field');
  assert.deepEqual(exported.drafts, [expectedDraft], 'user-gesture export must retain every private draft field');

  const beforeFailedImports = await readProductionSnapshot(page);
  const fileInput = page.locator('.diary-private-data-card input[type="file"]');
  await fileInput.setInputFiles({
    name: 'invalid-diary.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{not-json'),
  });
  await page.getByText(/Backup operation failed:/).waitFor({ state: 'visible' });
  assert.deepEqual(await readProductionSnapshot(page), beforeFailedImports, 'invalid JSON must not mutate local data');

  const replacement = makeReplacementBackup();
  await chooseBackup(fileInput, replacement, 'replacement-cancel.json');
  await page.getByRole('button', { name: 'Replace local data…' }).click();
  await page.getByText(/Replace permanently removes current local ratings/).waitFor({ state: 'visible' });
  await page.locator('.diary-import-preview').getByRole('button', { name: 'Cancel' }).click();
  await page.getByText('Backup import cancelled. Local data was not changed.').waitFor({ state: 'visible' });
  assert.deepEqual(await readProductionSnapshot(page), beforeFailedImports, 'cancelled replace must not mutate local data');

  await chooseBackup(fileInput, replacement, 'replacement-confirm.json');
  await page.getByRole('button', { name: 'Replace local data…' }).click();
  await page.getByRole('button', { name: 'Yes, replace local data' }).click();
  await page.getByText(/Local data replaced:/).waitFor({ state: 'visible' });
  const replaced = await readProductionSnapshot(page);
  assert.deepEqual(replaced.entries, replacement.entries);
  assert.deepEqual(replaced.drafts, replacement.drafts);

  const tokenEvidence = await verifyBuiltTokenGuards(page, replacement);
  assert.deepEqual(await readProductionSnapshot(page), replaced, 'token guard checks must leave imported data unchanged');

  const row = page.locator(`[data-id="${replacement.entries[0].id}"]`);
  await row.getByRole('button', { name: /^Delete / }).click();
  await row.getByRole('button', { name: 'Yes, delete' }).click();
  await page.getByText(/was deleted from this device/).waitFor({ state: 'visible' });
  const afterDelete = await readProductionSnapshot(page);
  assert.deepEqual(afterDelete.entries, [], 'explicit per-item delete must remove only the selected entry');
  assert.deepEqual(afterDelete.drafts, replacement.drafts, 'per-item delete must not clear unrelated drafts');

  await verifyLocalStorageBoundary(page);
  observeCurrentUrl(page, 'final');
  assertNoPrivateLeak(observations, 'browser-observations');
  assert.deepEqual(observations.pageErrors, [], 'built app must have no page errors');
  assert.deepEqual(
    observations.console.filter(({ type }) => type === 'error'),
    [],
    'built app must have no console errors',
  );

  process.stdout.write(`${JSON.stringify({
    status: 'pass',
    browser: 'chromium-persistent-profile',
    origin: baseUrl.origin,
    database: { name: 'engagement-diary', version: 2, stores: ['rating_drafts', 'route_entries'] },
    lifecycle: ['create', 'read', 'update', 'restart-persistence', 'export', 'replace-preview', 'replace-confirm', 'delete'],
    importGuards: tokenEvidence,
    privacy: {
      sentinels: SENTINELS.length,
      consoleMessages: observations.console.length,
      pageErrors: observations.pageErrors.length,
      requests: observations.requests.length,
      observedUrls: observations.urls,
      privateValuesInConsoleUrlOrNetwork: 0,
    },
    cleanup: 'browser-context-server-and-temporary-profile-owned-by-finally',
  })}\n`);
} catch (error) {
  primaryError = error;
} finally {
  for (const cleanup of [
    async () => context?.close(),
    async () => closeServer(server),
    async () => removeOwnedTemporaryRoot(temporaryRoot),
  ]) {
    try { await cleanup(); } catch (error) { cleanupErrors.push(error); }
  }
}

if (primaryError && cleanupErrors.length) {
  throw new AggregateError([primaryError, ...cleanupErrors], 'Diary browser test and cleanup failed.');
}
if (primaryError) throw primaryError;
if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Diary browser cleanup failed.');

async function launchDiary(userDataDir, probe) {
  const browserContext = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  const browserPage = browserContext.pages()[0] || await browserContext.newPage();
  attachObservations(browserPage, probe);
  await installDeterministicRoutes(browserPage);
  return { context: browserContext, page: browserPage };
}

async function gotoDiary(browserPage, label) {
  const url = new URL(baseUrl);
  url.searchParams.set('mode', 'diary');
  await browserPage.goto(url.href, { waitUntil: 'domcontentloaded' });
  await waitForDiary(browserPage);
  observeCurrentUrl(browserPage, label);
}

async function waitForDiary(browserPage) {
  const surface = browserPage.locator('[data-panel-view="diary"]');
  await surface.waitFor({ state: 'visible' });
  await surface.waitFor({ state: 'attached' });
  await browserPage.waitForFunction(() => document.querySelector('[data-panel-view="diary"]')?.getAttribute('aria-busy') === 'false');
}

async function createPrivateRating(browserPage) {
  await browserPage.getByRole('button', { name: 'Rate your experience on this route' }).click();
  await browserPage.getByRole('radio', { name: '5 stars' }).click();
  await browserPage.getByRole('button', { name: 'Continue' }).click();
  await browserPage.getByRole('button', { name: 'poor lighting' }).click();
  await browserPage.locator('#diary-rating-notes').fill(SENTINELS[0]);
  await browserPage.getByRole('button', { name: 'Save rating' }).click();
  await browserPage.getByText('Saved locally on this device.').waitFor({ state: 'visible' });
  observeCurrentUrl(browserPage, 'after-private-create');
  assertNoPrivateLeak(observations, 'after-private-create');
}

async function updateProductionEntryAndDraft(browserPage, entry) {
  return browserPage.evaluate(async ({ chunkUrl, current, sentinels }) => {
    const storage = await import(chunkUrl);
    const updatedEntry = {
      ...current,
      updatedAt: '2026-08-29T01:00:00.000Z',
      routeId: sentinels[1],
      label: `Private route ${sentinels[1]}`,
      tags: ['poor_lighting', sentinels[0]],
      segmentIds: [...current.segmentIds, sentinels[1]],
      routeSourceVersion: `private-source-${sentinels[1]}`,
      notes: sentinels[0],
      segmentOverrides: { ...current.segmentOverrides, [sentinels[1]]: 2 },
    };
    const draft = {
      kind: 'engagement-diary-draft',
      schemaVersion: 2,
      routeId: sentinels[2],
      sourceVersion: `private-source-${sentinels[2]}`,
      updatedAt: '2026-08-29T01:01:00.000Z',
      step: 'details',
      rating: 3,
      tags: [sentinels[0]],
      notes: sentinels[0],
      overrides: { [sentinels[2]]: 2 },
    };
    await storage.diaryLocalRepository.save(updatedEntry);
    await storage.diaryLocalRepository.saveDraft(draft);
    const snapshot = await storage.diaryLocalRepository.snapshot();
    return { entry: snapshot.entries[0], draft: snapshot.drafts[0] };
  }, {
    chunkUrl: new URL(storageChunk, baseUrl).href,
    current: entry,
    sentinels: SENTINELS,
  });
}

async function readProductionSnapshot(browserPage) {
  return browserPage.evaluate(async (chunkUrl) => {
    const storage = await import(chunkUrl);
    return storage.diaryLocalRepository.snapshot();
  }, new URL(storageChunk, baseUrl).href);
}

async function chooseBackup(fileInput, backup, name) {
  await fileInput.setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByRole('heading', { name: 'Review backup before importing' }).waitFor({ state: 'visible' });
}

function makeReplacementBackup() {
  return {
    kind: 'engagement-diary-private-backup',
    schemaVersion: 2,
    generatedAt: '2026-08-29T02:00:00.000Z',
    entries: [{
      kind: 'engagement-diary-entry',
      schemaVersion: 2,
      id: 'm6-imported-entry',
      createdAt: '2026-08-29T02:00:00.000Z',
      updatedAt: '2026-08-29T02:01:00.000Z',
      routeId: SENTINELS[1],
      label: `Imported ${SENTINELS[1]}`,
      mode: 'walk',
      score: 4,
      tags: [SENTINELS[0]],
      segmentIds: [SENTINELS[1]],
      routeGeometry: { type: 'LineString', coordinates: [[-75.2, 39.9], [-75.1, 40]] },
      routeSourceVersion: `private-source-${SENTINELS[1]}`,
      notes: SENTINELS[0],
      segmentOverrides: { [SENTINELS[1]]: 2 },
    }],
    drafts: [{
      kind: 'engagement-diary-draft',
      schemaVersion: 2,
      routeId: SENTINELS[2],
      sourceVersion: `private-source-${SENTINELS[2]}`,
      updatedAt: '2026-08-29T02:02:00.000Z',
      step: 'segments',
      rating: 4,
      tags: [SENTINELS[0]],
      notes: SENTINELS[0],
      overrides: { [SENTINELS[2]]: 3 },
    }],
  };
}

async function verifyBuiltTokenGuards(browserPage, backup) {
  const evidence = await browserPage.evaluate(async ({ chunkUrl, backupValue }) => {
    const storage = await import(chunkUrl);
    const repository = storage.diaryLocalRepository;
    const before = await repository.snapshot();
    const backupText = JSON.stringify(backupValue);
    const file = { name: 'token-guard.json', size: new Blob([backupText]).size, text: async () => backupText };
    let clock = Date.parse('2026-08-29T03:00:00.000Z');
    let lifecycleCalls = 0;
    const lifecycle = storage.createDiaryLocalLifecycle({ repository });
    const originalApply = lifecycle.applyImport.bind(lifecycle);
    lifecycle.applyImport = (...args) => { lifecycleCalls += 1; return originalApply(...args); };
    const controller = storage.createDiaryLocalController({
      repository,
      lifecycle,
      createImportToken: () => 'browser-expiring-token',
      importPreviewTtlMs: 10,
      now: () => new Date(clock),
    });
    await controller.initialize();
    await controller.prepareImport(file);
    controller.requestReplace('browser-expiring-token');
    const wrong = await controller.applyImport('replace', { previewToken: 'wrong-token' });
    clock += 11;
    const expired = await controller.applyImport('replace', { previewToken: 'browser-expiring-token' });
    controller.dispose();
    const expiryPreserved = JSON.stringify(await repository.snapshot()) === JSON.stringify(before);

    const cancelledLifecycle = storage.createDiaryLocalLifecycle({ repository });
    const cancelledController = storage.createDiaryLocalController({
      repository,
      lifecycle: cancelledLifecycle,
      createImportToken: () => 'browser-cancelled-token',
      now: () => new Date(clock),
    });
    await cancelledController.initialize();
    await cancelledController.prepareImport(file);
    cancelledController.cancelImport();
    const cancelled = await cancelledController.applyImport('replace', { previewToken: 'browser-cancelled-token' });
    cancelledController.dispose();
    const cancelPreserved = JSON.stringify(await repository.snapshot()) === JSON.stringify(before);

    const onceLifecycle = storage.createDiaryLocalLifecycle({ repository });
    const onceController = storage.createDiaryLocalController({
      repository,
      lifecycle: onceLifecycle,
      createImportToken: () => 'browser-one-time-token',
      now: () => new Date(clock),
    });
    await onceController.initialize();
    await onceController.prepareImport(file);
    const confirmationAccepted = onceController.requestReplace('browser-one-time-token');
    const first = await onceController.applyImport('replace', { previewToken: 'browser-one-time-token' });
    const second = await onceController.applyImport('replace', { previewToken: 'browser-one-time-token' });
    onceController.dispose();
    const oneTimePreserved = JSON.stringify(await repository.snapshot()) === JSON.stringify(before);
    return {
      wrongToken: wrong.reason,
      expiredToken: expired.reason,
      cancelledToken: cancelled.reason,
      firstUse: first.applied,
      secondUse: second.reason,
      lifecycleCallsBeforeExpiry: lifecycleCalls,
      confirmationAccepted,
      expiryPreserved,
      cancelPreserved,
      oneTimePreserved,
    };
  }, { chunkUrl: new URL(storageChunk, baseUrl).href, backupValue: backup });
  assert.equal(evidence.lifecycleCallsBeforeExpiry, 0);
  assert.equal(evidence.confirmationAccepted, true);
  assert.equal(evidence.expiryPreserved, true);
  assert.equal(evidence.cancelPreserved, true);
  assert.equal(evidence.oneTimePreserved, true);
  return evidence;
}

async function verifyLocalStorageBoundary(browserPage) {
  const boundary = await browserPage.evaluate(async () => {
    const databases = await indexedDB.databases();
    const diaryDatabase = databases.find(({ name }) => name === 'engagement-diary');
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('engagement-diary', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = [...db.objectStoreNames].sort();
    const version = db.version;
    db.close();
    const cacheNames = globalThis.caches ? await caches.keys() : [];
    return {
      databaseNames: databases.map(({ name }) => name).filter(Boolean).sort(),
      diaryDatabaseVersion: diaryDatabase?.version,
      openedVersion: version,
      stores,
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
      cacheNames,
    };
  });
  assert.deepEqual(boundary.databaseNames, ['engagement-diary']);
  assert.equal(boundary.diaryDatabaseVersion, 2);
  assert.equal(boundary.openedVersion, 2);
  assert.deepEqual(boundary.stores, ['rating_drafts', 'route_entries']);
  assertNoPrivateLeak({
    localStorage: boundary.localStorage,
    sessionStorage: boundary.sessionStorage,
    cacheNames: boundary.cacheNames,
  }, 'non-indexeddb-storage');
}

function attachObservations(browserPage, probe) {
  browserPage.on('console', (message) => probe.console.push({ type: message.type(), text: message.text() }));
  browserPage.on('pageerror', (error) => probe.pageErrors.push(error.message));
  browserPage.on('request', (request) => probe.requests.push({
    method: request.method(),
    url: request.url(),
    body: request.postData() || '',
    headers: request.headers(),
    resourceType: request.resourceType(),
  }));
  browserPage.on('framenavigated', (frame) => {
    if (frame === browserPage.mainFrame()) probe.urls.push({ label: 'navigation', url: frame.url() });
  });
  browserPage.on('websocket', (socket) => {
    const record = { url: socket.url(), sent: [], received: [] };
    probe.webSockets.push(record);
    socket.on('framesent', ({ payload }) => record.sent.push(String(payload)));
    socket.on('framereceived', ({ payload }) => record.received.push(String(payload)));
  });
}

function observeCurrentUrl(browserPage, label) {
  observations.urls.push({ label, url: browserPage.url() });
}

function assertNoPrivateLeak(value, category) {
  let text = JSON.stringify(value);
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const decoded = decodeURIComponent(text.replaceAll('+', ' '));
      if (decoded === text) break;
      text = decoded;
    } catch { break; }
  }
  const index = SENTINELS.findIndex((sentinel) => text.includes(sentinel));
  if (index < 0) return;
  const error = new Error(`Diary privacy gate rejected ${category}; sentinel-index=${index}`);
  error.code = 'DIARY_PRIVATE_SENTINEL_DETECTED';
  throw error;
}

async function startDistServer(root) {
  await stat(path.join(root, 'index.html'));
  const httpServer = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(requestUrl.pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      let file = path.resolve(root, relative);
      if (!file.startsWith(`${root}${path.sep}`) && file !== path.join(root, 'index.html')) {
        response.writeHead(403).end();
        return;
      }
      try {
        if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      } catch {
        file = path.join(root, 'index.html');
      }
      const contents = await readFile(file);
      response.writeHead(200, {
        'content-type': contentType(file),
        'cache-control': 'no-store',
        'content-length': contents.byteLength,
      });
      response.end(request.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain' });
      if (!response.writableEnded) response.end(error.message);
    }
  });
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  return httpServer;
}

function contentType(file) {
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.geojson': 'application/geo+json; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  };
  return types[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

async function closeServer(httpServer) {
  if (!httpServer) return;
  await new Promise((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
}

async function removeOwnedTemporaryRoot(target) {
  const resolvedTarget = path.resolve(target);
  const resolvedTemp = path.resolve(tmpdir());
  assert.equal(path.dirname(resolvedTarget), resolvedTemp, 'temporary profile cleanup must stay directly under the OS temp root');
  assert.match(path.basename(resolvedTarget), /^engagement-diary-m6-/);
  await rm(resolvedTarget, { recursive: true, force: true, maxRetries: 3 });
}
