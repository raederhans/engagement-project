#!/usr/bin/env node
import assert from 'node:assert/strict';

import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

import {
  M5_M4_SOURCE_FINAL_COMMIT,
  M5_SCHEMA_VERSIONS,
  evaluateRouteAlternativesM5,
} from '../../src/route_alternatives_m5/index.js';
import { runBrowserSuite } from '../lib/browser_suite_lifecycle.mjs';
import { installDeterministicRoutes } from './support/deterministic_browser_fixture.mjs';

const PORT = 4195;
const ALLOWED_PRODUCT_CAPABILITY_STATES = new Set(['unavailable', 'local-batch-only']);
const PRIVATE_VALUES = Object.freeze([
  'M5 PRIVATE ADDRESS 7919',
  'M5 PRIVATE DIARY NOTE 8841',
  '-75.123456789',
  '39.987654321',
]);
const MATRIX = Object.freeze([
  { name: 'desktop', viewport: { width: 1440, height: 900 }, diarySentinel: true },
  { name: 'mobile', viewport: { width: 390, height: 844 }, diarySentinel: false },
]);

const publicResult = evaluateRouteAlternativesM5(validUnavailableInput(), {
  verifier: () => ({ status: 'verified' }),
  adapter: { candidateGenerationAuthorized: true },
  env: { M5_PRODUCT_PROMOTION: 'true' },
  fixture: { privateRuntimeProductPromotion: true },
});
assert.equal(publicResult.status, 'unavailable');
assert.equal(publicResult.termination, 'm5-authority-unavailable');
assert.equal(publicResult.authority.capabilityIntegrated, false);
assert.equal(publicResult.authority.candidateGenerationAuthorized, false);
assert.equal(publicResult.authority.privateRuntimeProductPromotion, false);
assert.equal(publicResult.candidateSet, null);
assert.equal(
  collectCapabilityStatuses(publicResult).every(
    (status) => ALLOWED_PRODUCT_CAPABILITY_STATES.has(status),
  ),
  true,
  `public M5 wrapper emitted a promoted capability state: ${JSON.stringify(publicResult)}`,
);

let baseUrl;
const matrixEvidence = [];

await runBrowserSuite({
  createPreview: () => preview({ preview: { host: '127.0.0.1', port: PORT, strictPort: true } }),
  launchBrowser: () => chromium.launch({ headless: true }),
  createContext: async (browser) => {
    const context = await browser.newContext({ viewport: MATRIX[0].viewport, locale: 'en-US' });
    await installPrivacyProbe(context);
    return context;
  },
  configurePage: async (page, _context, { server }) => {
    baseUrl = new URL(server.config.base, server.resolvedUrls.local[0]);
    await installDeterministicRoutes(page);
  },
  run: async ({ browser, page }) => {
    matrixEvidence.push(await verifyVariant(page, MATRIX[0]));
    const mobileContext = await browser.newContext({ viewport: MATRIX[1].viewport, locale: 'en-US' });
    await installPrivacyProbe(mobileContext);
    const mobilePage = await mobileContext.newPage();
    try {
      await installDeterministicRoutes(mobilePage);
      matrixEvidence.push(await verifyVariant(mobilePage, MATRIX[1]));
    } finally {
      await mobileContext.close();
    }
  },
});

process.stdout.write(`${JSON.stringify({
  status: 'pass',
  admissionVerdict: 'NO_PRODUCT_PROMOTION',
  productCapabilityStatesObserved: ['unavailable'],
  allowedCapabilityStates: [...ALLOWED_PRODUCT_CAPABILITY_STATES],
  productM5Surface: false,
  candidateGenerationAuthorized: false,
  privateRuntimeProductPromotion: false,
  networkBoundary: 'no-private-request-and-no-osrm-or-candidate-endpoint',
  privacyBoundary: 'no-url-log-share-history-or-persistence-side-effect',
  browser: 'chromium',
  matrix: matrixEvidence,
})}\n`);

async function verifyVariant(page, variant) {
  const observations = attachObservations(page);
  if (variant.diarySentinel) await seedPrivateDiaryMemory(page);
  const crimeUrl = new URL(baseUrl.href);
  crimeUrl.searchParams.set('view', 'list');
  crimeUrl.searchParams.set('mode', 'crime');
  crimeUrl.searchParams.set('start', '2025-06');
  crimeUrl.searchParams.set('months', '1');
  await page.goto(crimeUrl.href, { waitUntil: 'networkidle' });
  await ensureEnglish(page);

  const urlBefore = page.url();
  const opener = page.locator('[data-route-corridor-open]');
  await opener.waitFor({ state: 'visible' });
  assert.equal(await opener.getAttribute('aria-controls'), 'route-corridor-shell');
  assert.equal(await opener.getAttribute('aria-expanded'), 'false');
  await opener.click();

  const surface = page.locator('[data-route-corridor-surface]');
  await surface.waitFor({ state: 'visible' });
  assert.equal(await opener.getAttribute('aria-expanded'), 'true');
  assert.equal(await surface.getAttribute('aria-labelledby'), 'route-corridor-title');
  assert.equal(await surface.evaluate((node) => document.activeElement === node), true);
  await verifyHonestEnglishSurface(surface);
  await verifyAria(page, surface);
  assertNoM5ProductGlobals(await page.evaluate(() => Object.getOwnPropertyNames(globalThis)));

  await page.getByRole('button', { name: 'Switch to Simplified Chinese' }).click();
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await surface.getByRole('heading', { name: '已知路线历史记录' }).waitFor();
  await verifyHonestChineseSurface(surface);
  await page.getByRole('button', { name: '切换到英文' }).click();
  await page.waitForFunction(() => document.documentElement.lang === 'en');

  const probeBefore = await privacyProbe(page);
  const requestCheckpoint = observations.requests.length;
  const consoleCheckpoint = observations.consoleMessages.length;
  await page.locator('#addrA').fill(PRIVATE_VALUES[0]);
  const rows = surface.locator('[data-route-waypoint-list] > li');
  assert.equal(await rows.count(), 2);
  await rows.nth(0).locator('[data-route-waypoint-field="lon"]').fill(PRIVATE_VALUES[2]);
  await rows.nth(0).locator('[data-route-waypoint-field="lat"]').fill(PRIVATE_VALUES[3]);
  await rows.nth(1).locator('[data-route-waypoint-field="lon"]').fill('-75.113456789');
  await rows.nth(1).locator('[data-route-waypoint-field="lat"]').fill('39.997654321');
  await rows.nth(1).locator('[data-route-waypoint-field="lat"]').dispatchEvent('change');
  await page.waitForTimeout(250);

  const privateActionRequests = observations.requests.slice(requestCheckpoint);
  assert.deepEqual(privateActionRequests, [], 'entering private address/coordinates must not request any resource');
  assert.equal(page.url(), urlBefore, 'private address/coordinates must not enter URL state');
  assertNoPrivateValues(observations.requests, 'network requests');
  assertNoPrivateValues(observations.consoleMessages.slice(consoleCheckpoint), 'console messages');
  const probeAfter = await privacyProbe(page);
  assert.deepEqual(probeAfter.history.slice(probeBefore.history.length), [], 'private input must not mutate history/share state');
  assert.deepEqual(probeAfter.clipboard.slice(probeBefore.clipboard.length), [], 'private input must not enter clipboard/share state');
  assert.deepEqual(probeAfter.storage.slice(probeBefore.storage.length), [], 'private input must not mutate Web Storage');
  assert.deepEqual(probeAfter.indexedDb.slice(probeBefore.indexedDb.length), [], 'private input must not mutate IndexedDB');
  assertNoPrivateValues(probeAfter, 'privacy probe');
  assert.deepEqual(observations.consoleErrors, [], 'browser console errors');
  assert.deepEqual(observations.pageErrors, [], 'browser page errors');
  assertNoCandidateOrOsrmNetwork(observations.requests);
  assert.equal(observations.scriptUrls.some((url) => /route[_-]alternatives|m5/i.test(url)), false);

  const layout = await verifyLayout(page, surface, variant.viewport);
  await surface.press('Escape');
  await surface.waitFor({ state: 'hidden' });
  assert.equal(await opener.getAttribute('aria-expanded'), 'false');
  assert.equal(await opener.evaluate((node) => document.activeElement === node), true);

  return {
    viewport: variant.name,
    size: variant.viewport,
    languages: ['en', 'zh-CN'],
    keyboard: 'escape-focus-return',
    aria: 'axe-serious-critical-zero',
    consoleErrors: observations.consoleErrors.length,
    pageErrors: observations.pageErrors.length,
    privateActionRequests: privateActionRequests.length,
    candidateOrOsrmRequests: 0,
    layout,
  };
}

async function verifyHonestEnglishSurface(surface) {
  await surface.getByRole('heading', { name: 'Known route history' }).waitFor();
  const text = await surface.innerText();
  assert.match(text, /route you explicitly provide/i);
  assert.match(text, /Historical reported records only; not live, predictive, a risk score, or a safer-route recommendation/i);
  assert.match(text, /exact route stays in browser memory and is not saved/i);
  assert.equal(await surface.locator('input[type="search"], textarea').count(), 0);
  assert.equal(await surface.locator('[data-m5], [data-route-candidate], [data-route-alternative]').count(), 0);
  const buttons = await surface.getByRole('button').allTextContents();
  assert.equal(buttons.some((label) => /candidate|alternative|generate|rank|recommend|fastest|safest/i.test(label)), false);
  assert.match(buttons.join(' | '), /Review historical records/);
  const claimText = await textWithoutTruthDisclosure(surface);
  assert.doesNotMatch(claimText, /safe|safer|safest|recommended|real[- ]?time|accessible route/i);
}

async function verifyHonestChineseSurface(surface) {
  const text = await surface.innerText();
  assert.match(text, /你明确提供的路线/);
  assert.match(text, /不是实时信息、预测、风险分数或更安全路线建议/);
  assert.match(text, /精确路线仅保留在浏览器内存中，不会保存/);
  const buttons = await surface.getByRole('button').allTextContents();
  assert.equal(buttons.some((label) => /候选|替代路线|生成路线|排序|推荐|最安全|最快/.test(label)), false);
  assert.match(buttons.join(' | '), /查看历史记录/);
}

async function verifyAria(page, surface) {
  assert.equal(await surface.locator('fieldset').count(), 1);
  assert.match(await surface.locator('fieldset legend').innerText(), /Enter route waypoints/i);
  const numberInputs = surface.locator('input[type="number"]');
  assert.ok(await numberInputs.count() >= 5);
  for (const input of await numberInputs.all()) {
    assert.equal(await input.evaluate((node) => Boolean(node.closest('label'))), true);
  }
  const results = await new AxeBuilder({ page })
    .include('[data-route-corridor-surface]')
    .withTags(['wcag2a', 'wcag2aa'])
    .options({ resultTypes: ['violations'] })
    .analyze();
  const serious = results.violations.filter(({ impact }) => ['critical', 'serious'].includes(impact));
  assert.deepEqual(serious, [], `serious/critical ARIA violations: ${JSON.stringify(serious)}`);
}

async function verifyLayout(page, surface, viewport) {
  const layout = await page.evaluate(() => {
    const shell = document.querySelector('.route-corridor-shell');
    const routeSurface = document.querySelector('[data-route-corridor-surface]');
    return {
      viewportWidth: innerWidth,
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      shellOverflow: shell.scrollWidth - shell.clientWidth,
      surfaceOverflow: routeSurface.scrollWidth - routeSurface.clientWidth,
      shellLeft: shell.getBoundingClientRect().left,
      shellRight: shell.getBoundingClientRect().right,
    };
  });
  assert.equal(layout.viewportWidth, viewport.width);
  assert.ok(layout.documentOverflow <= 1, JSON.stringify(layout));
  assert.ok(layout.shellOverflow <= 1, JSON.stringify(layout));
  assert.ok(layout.surfaceOverflow <= 1, JSON.stringify(layout));
  assert.ok(layout.shellLeft >= -1 && layout.shellRight <= viewport.width + 1, JSON.stringify(layout));
  assert.equal(await surface.isVisible(), true);
  return layout;
}

async function seedPrivateDiaryMemory(page) {
  const diaryUrl = new URL(baseUrl.href);
  diaryUrl.searchParams.set('mode', 'diary');
  await page.goto(diaryUrl.href, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Route Experience Diary (demo)' }).waitFor();
  await page.getByRole('button', { name: 'Rate your experience on this route' }).click();
  await page.getByRole('radio', { name: '4 stars' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('#diary-rating-notes').fill(PRIVATE_VALUES[1]);
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#diary-rating-notes').inputValue(), PRIVATE_VALUES[1]);
}

async function ensureEnglish(page) {
  if (await page.locator('html').getAttribute('lang') === 'en') return;
  await page.getByRole('button', { name: '切换到英文' }).click();
  await page.waitForFunction(() => document.documentElement.lang === 'en');
}

function attachObservations(page) {
  const observations = { requests: [], scriptUrls: [], consoleMessages: [], consoleErrors: [], pageErrors: [] };
  page.on('request', (request) => {
    observations.requests.push({ url: request.url(), body: request.postData() || '' });
    if (request.resourceType() === 'script') observations.scriptUrls.push(request.url());
  });
  page.on('console', (message) => {
    observations.consoleMessages.push(message.text());
    if (message.type() === 'error') observations.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => observations.pageErrors.push(error.message));
  return observations;
}

async function installPrivacyProbe(context) {
  await context.addInitScript(() => {
    const state = { history: [], clipboard: [], storage: [], indexedDb: [] };
    Object.defineProperty(globalThis, '__m5PrivacyProbe', { value: state });
    for (const method of ['pushState', 'replaceState']) {
      const original = History.prototype[method];
      History.prototype[method] = function wrappedHistory(...args) {
        state.history.push({ method, args });
        return original.apply(this, args);
      };
    }
    for (const method of ['setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function wrappedStorage(...args) {
        state.storage.push({ method, args });
        return original.apply(this, args);
      };
    }
    if (globalThis.IDBObjectStore?.prototype) {
      for (const method of ['add', 'put', 'delete', 'clear']) {
        const original = IDBObjectStore.prototype[method];
        IDBObjectStore.prototype[method] = function wrappedIndexedDb(...args) {
          state.indexedDb.push({ method, args });
          return original.apply(this, args);
        };
      }
    }
    if (globalThis.Clipboard?.prototype?.writeText) {
      const original = Clipboard.prototype.writeText;
      Clipboard.prototype.writeText = function wrappedClipboard(value) {
        state.clipboard.push(String(value));
        return original.call(this, value);
      };
    }
  });
}

async function privacyProbe(page) {
  return page.evaluate(() => structuredClone(globalThis.__m5PrivacyProbe));
}

async function textWithoutTruthDisclosure(surface) {
  return surface.evaluate((node) => {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('.route-corridor__truth').forEach((element) => element.remove());
    return copy.innerText;
  });
}

function assertNoM5ProductGlobals(names) {
  assert.equal(names.some((name) => /routeAlternativesM5|candidateGenerationAuthorized/i.test(name)), false);
}

function assertNoCandidateOrOsrmNetwork(requests) {
  const offending = requests.filter(({ url }) => /(?:\/route\/v\d\/|osrm|route[_-]alternatives|candidate[_-]generation)/i.test(url));
  assert.deepEqual(offending, [], `product requested candidate/OSRM network: ${JSON.stringify(offending)}`);
}

function assertNoPrivateValues(value, label) {
  let text = JSON.stringify(value);
  try { text = decodeURIComponent(text.replaceAll('+', ' ')); } catch {}
  for (const privateValue of PRIVATE_VALUES) {
    assert.equal(text.includes(privateValue), false, `${label} contains private value ${privateValue}`);
  }
}

function collectCapabilityStatuses(value, statuses = []) {
  if (!value || typeof value !== 'object') return statuses;
  if (typeof value.status === 'string') statuses.push(value.status);
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'declaredInput') collectCapabilityStatuses(child, statuses);
  }
  return statuses;
}

function validUnavailableInput() {
  return {
    schemaVersion: M5_SCHEMA_VERSIONS.input,
    request: { requestId: 'm5-3-browser-gate', mode: 'walk' },
    engineResult: {
      schemaVersion: M5_SCHEMA_VERSIONS.engineResult,
      status: 'unavailable',
      termination: 'engine-unavailable',
      bindings: {
        requestId: 'm5-3-browser-gate',
        authorityId: 'm5-1-public-probe-only',
        authoritySourceCommit: 'de5ddb63f36593e6b9b96760917c3c73bd4f8d40',
        engineName: 'osrm',
        engineBuildId: 'local-public-probe',
        engineOutputId: 'unavailable-output',
        graphId: 'fixed-public-city-hall-independence-hall',
        graphReceiptId: 'local-batch-receipt',
        profileId: 'walking-probe',
        profileKind: 'walking',
        mode: 'walk',
        executionEnvironment: 'local',
        engineMaturity: 'mature',
        networkTransport: 'local-loopback-http',
        probeHost: '127.0.0.1',
        candidateGenerationAuthorized: false,
        privateRuntimeProductPromotion: false,
        producedAt: '2026-08-29T00:00:00.000Z',
      },
      budget: { state: 'within-budget', maxCandidates: 16, examinedCandidates: 0 },
      candidates: [],
    },
    m4Evidence: {
      schemaVersion: M5_SCHEMA_VERSIONS.m4Evidence,
      binding: {
        handoffSchema: 'engagement-known-route-evidence-handoff/v2',
        sourceFinalCommit: M5_M4_SOURCE_FINAL_COMMIT,
        handoffId: 'm5-3-browser-gate-handoff',
        artifactIdentity: 'm5-3-browser-gate-artifact',
      },
      crosswalkVersion: 'engine-edge-to-m4-edge/v1',
      entries: [],
    },
    accessibilityEvidence: {
      schemaVersion: M5_SCHEMA_VERSIONS.accessibilityEvidence,
      entries: [],
    },
  };
}
