#!/usr/bin/env node

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

import { runBrowserSuite } from '../lib/browser_suite_lifecycle.mjs';
import { validateHomeCompareCitywideReadiness } from '../../src/home_compare/citywide_readiness.js';

const TRACKED = 'public/data/home_compare_citywide_readiness.v1.json';
const BUILT = 'dist/data/home_compare_citywide_readiness.v1.json';
const PRIVATE_VALUES = [
  '100 PRIVATE TEST ST',
  '101 PRIVATE TEST ST',
  'PRIVATE DESTINATION',
  'PRIVATE LEGACY VALUE',
];

try {
  await access(TRACKED);
  await access(BUILT);
} catch {
  throw new Error(
    'P5 browser gate requires root to generate and track the readiness artifact, then run the production build.',
  );
}
const [trackedText, builtText] = await Promise.all([
  readFile(TRACKED, 'utf8'),
  readFile(BUILT, 'utf8'),
]);
assert.equal(builtText, trackedText, 'production build must contain the exact tracked readiness artifact');
const readiness = await validateHomeCompareCitywideReadiness(JSON.parse(trackedText));
assert.equal(readiness.status, 'partial');

const requests = [];
const consoleErrors = [];
const pageErrors = [];
let baseUrl;

await runBrowserSuite({
  createPreview: () => preview({
    preview: { host: '127.0.0.1', port: 4189, strictPort: true },
  }),
  launchBrowser: () => chromium.launch({ headless: true }),
  createContext: (browser) => browser.newContext({ viewport: { width: 1280, height: 900 } }),
  configureContext: async (context, { server }) => {
    baseUrl = new URL(server.config.base, server.resolvedUrls.local[0]);
    await context.grantPermissions(
      ['clipboard-read', 'clipboard-write'],
      { origin: baseUrl.origin },
    );
  },
  configurePage: async (page) => {
    page.on('request', (request) => requests.push({
      url: request.url(),
      body: request.postData() || '',
    }));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      window.__homeUnhandled = [];
      window.addEventListener('unhandledrejection', (event) => {
        window.__homeUnhandled.push(String(event.reason));
      });
      // Seed a legacy-private share value after navigation reaches the browser,
      // before application modules run. The private fixture never enters the
      // preview request URL, while startup scrub behavior is still exercised.
      const url = new URL(location.href);
      url.searchParams.set('hc', JSON.stringify({
        schema: 'engagement-home-compare-share/v1',
        weights: {
          property: 20,
          costHistory: 20,
          civicRecords: 20,
          transportContext: 20,
          dataQuality: 20,
        },
        dimensions: ['property'],
        address: 'PRIVATE LEGACY VALUE',
      }));
      history.replaceState({}, '', url);
    });
  },
  run: async ({ page }) => {
    await page.goto(baseUrl.href, { waitUntil: 'networkidle' });

    const opener = page.locator('[data-home-compare-open]');
    const dialog = page.locator('[data-home-compare-dialog]');
    for (const [locale, viewport] of [
      ['en', { width: 1280, height: 900 }],
      ['zh-CN', { width: 390, height: 844 }],
    ]) {
      await page.setViewportSize(viewport);
      if (await page.locator('html').getAttribute('lang') !== locale) {
        await page.locator('.language-switch').click();
        await page.waitForFunction(
          (target) => document.documentElement.lang === target,
          locale,
        );
      }

      await opener.click();
      await dialog.waitFor({ state: 'visible' });
      const readinessRegion = dialog.locator('[data-home-citywide-readiness]');
      await readinessRegion.waitFor();
      await page.waitForFunction(() => (
        document.querySelector('[data-home-citywide-readiness]')
          ?.getAttribute('data-readiness-status') === 'partial'
      ));
      assert.equal(await dialog.evaluate((element) => element.open), true);
      assert.equal(await dialog.evaluate((element) => element.matches(':modal')), true);
      assert.equal(await dialog.getAttribute('aria-labelledby'), 'home-compare-title');
      assert.equal(await dialog.getAttribute('aria-describedby'), 'home-compare-description');
      assert.equal(
        await dialog.locator('[data-home-address="0"]').evaluate(
          (element) => document.activeElement === element,
        ),
        true,
      );
      assert.equal(new URL(page.url()).searchParams.has('hc'), locale !== 'en');

      const readinessText = await readinessRegion.innerText();
      assert.match(
        readinessText,
        locale === 'en' ? /Citywide source readiness/ : /全市来源就绪度/,
      );
      assert.match(readinessText, /not address-level evidence|不是地址级证据/);
      assert.match(readinessText, /Does not authorize|不授权产品/);
      const details = readinessRegion.locator('details');
      await details.first().click();
      await details.nth(1).click();
      assert.equal(await details.first().locator('article').count(), 9);
      assert.equal(await details.nth(1).locator('article').count(), 9);
      const expandedReadiness = await readinessRegion.innerText();
      assert.match(expandedReadiness, /source_as_of/);
      assert.match(expandedReadiness, /Why unavailable|为何不可用/);
      assert.match(expandedReadiness, /reported_incidents/);
      assert.match(expandedReadiness, /hin_road_context/);

      await dialog.locator('[data-home-address="0"]').fill('100 PRIVATE TEST ST');
      await dialog.locator('[data-home-address="1"]').fill('101 PRIVATE TEST ST');
      await dialog.locator('[data-home-destinations]').fill('PRIVATE DESTINATION');
      const requestCheckpoint = requests.length;
      await dialog.locator('[data-home-run]').click();
      await page.waitForFunction((targetLocale) => {
        const text = document.querySelector('[data-home-status]')?.textContent || '';
        return targetLocale === 'en' ? text.includes('disabled') : text.includes('未启用');
      }, locale);
      assert.equal(await dialog.locator('[data-home-profile]').count(), 0);
      assert.deepEqual(
        requests.slice(requestCheckpoint),
        [],
        'private Home Compare action must make zero new requests',
      );
      assertNoPrivateValues(await privacySnapshot(page), `${locale} pre-share browser sinks`);

      await page.evaluate(() => {
        const url = new URL(location.href);
        for (const key of ['a', 'b', 'labelA', 'labelB']) {
          url.searchParams.set(key, 'PRIVATE LEGACY VALUE');
        }
        url.hash = 'PRIVATE LEGACY VALUE';
        history.pushState({ private: 'PRIVATE LEGACY VALUE' }, '', url);
      });
      await dialog.locator('[data-home-share]').click();
      await page.waitForFunction((targetLocale) => {
        const text = document.querySelector('[data-home-status]')?.textContent || '';
        return targetLocale === 'en' ? text.includes('copied') : text.includes('已复制');
      }, locale);

      const sharedUrl = new URL(page.url());
      assert.deepEqual([...sharedUrl.searchParams.keys()], ['hc']);
      assert.equal(sharedUrl.hash, '');
      const sharedState = JSON.parse(sharedUrl.searchParams.get('hc'));
      assert.deepEqual(Object.keys(sharedState).sort(), ['dimensions', 'schema', 'weights']);
      assert.deepEqual(
        Object.keys(sharedState.weights).sort(),
        ['civicRecords', 'costHistory', 'dataQuality', 'property', 'transportContext'],
      );
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      assert.equal(clipboardText, sharedUrl.href);
      assertNoPrivateValues(
        { sharedState, clipboardText, snapshot: await privacySnapshot(page) },
        `${locale} shared browser sinks`,
      );

      await page.goBack();
      assertNoPrivateValues(
        { url: page.url(), state: await page.evaluate(() => history.state) },
        `${locale} back history entry`,
      );
      await page.goForward();
      assert.equal(page.url(), sharedUrl.href);
      assertNoPrivateValues(
        { url: page.url(), state: await page.evaluate(() => history.state) },
        `${locale} forward history entry`,
      );

      const layout = await page.evaluate(() => {
        const activeDialog = document.querySelector('[data-home-compare-dialog]');
        const surface = document.querySelector('.home-compare__surface');
        const readinessSurface = document.querySelector('[data-home-citywide-readiness]');
        const dialogRect = activeDialog.getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
          dialogLeft: dialogRect.left,
          dialogRight: dialogRect.right,
          dialogOverflow: activeDialog.scrollWidth - activeDialog.clientWidth,
          surfaceOverflow: surface.scrollWidth - surface.clientWidth,
          readinessOverflow: readinessSurface.scrollWidth - readinessSurface.clientWidth,
        };
      });
      assert.ok(layout.documentOverflow <= 1, JSON.stringify(layout));
      assert.ok(layout.dialogLeft >= -1, JSON.stringify(layout));
      assert.ok(layout.dialogRight <= layout.viewportWidth + 1, JSON.stringify(layout));
      assert.ok(layout.dialogOverflow <= 1, JSON.stringify(layout));
      assert.ok(layout.surfaceOverflow <= 1, JSON.stringify(layout));
      assert.ok(layout.readinessOverflow <= 1, JSON.stringify(layout));

      await dialog.locator('[data-home-close]').click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await opener.evaluate((element) => document.activeElement === element), true);
      await opener.click();
      await dialog.waitFor({ state: 'visible' });
      await dialog.locator('[data-home-address="1"]').waitFor();
      assert.deepEqual(
        await dialog.locator('[data-home-address]').evaluateAll(
          (elements) => elements.map((element) => element.value),
        ),
        ['', ''],
      );
      assert.equal(await dialog.locator('[data-home-destinations]').inputValue(), '');
      assert.equal(await dialog.locator('[data-home-profile]').count(), 0);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await opener.evaluate((element) => document.activeElement === element), true);
      assertNoPrivateValues(await privacySnapshot(page), `${locale} post-close browser sinks`);
    }

    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(await page.evaluate(() => window.__homeUnhandled), []);
  },
});

console.log(JSON.stringify({
  status: 'pass',
  artifact: TRACKED,
  artifactIdentity: readiness.identity,
  languages: ['en', 'zh-CN'],
  viewports: ['desktop', 'mobile'],
  privateActionRequests: 0,
  profiles: 0,
  routing: 'unavailable',
  clipboard: 'weights-and-dimensions-only',
  persistence: 'no-private-url-storage-history-indexeddb',
}));

function assertNoPrivateValues(value, label) {
  const serialized = JSON.stringify(value);
  for (const privateValue of PRIVATE_VALUES) {
    assert.doesNotMatch(
      serialized,
      new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      `${label} leaked ${privateValue}`,
    );
  }
}

async function privacySnapshot(page) {
  return page.evaluate(async () => {
    const indexedDb = [];
    if (typeof indexedDB.databases === 'function') {
      for (const descriptor of await indexedDB.databases()) {
        if (!descriptor.name) continue;
        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open(descriptor.name, descriptor.version);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const stores = [];
          for (const storeName of database.objectStoreNames) {
            const rows = await new Promise((resolve, reject) => {
              const transaction = database.transaction(storeName, 'readonly');
              const request = transaction.objectStore(storeName).getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            stores.push({ storeName, rows });
          }
          indexedDb.push({ name: descriptor.name, version: descriptor.version, stores });
        } finally {
          database.close();
        }
      }
    }
    return {
      url: location.href,
      historyState: history.state,
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
      indexedDb,
    };
  });
}
