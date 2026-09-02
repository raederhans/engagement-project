#!/usr/bin/env node
import assert from 'node:assert/strict';

import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

import { runBrowserSuite } from '../lib/browser_suite_lifecycle.mjs';
import { assertPublicRouteCopyBoundary } from '../lib/public_route_copy_policy.mjs';

const PORT = 4207;
const EXTERNAL_BASE_URL = String(process.env.PUBLIC_ROUTE_BROWSER_BASE_URL || '').trim();
const ARTIFACT_PATH = '/data/route_alternatives_public_scenarios.v1.json';
const MATRIX = Object.freeze([
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } },
]);
const COMPLETE_SCENARIO = 'city-hall-to-art-museum-complete';
const SINGLE_SCENARIO = 'independence-hall-to-reading-terminal-single';
const DEGRADED_SCENARIO = 'rittenhouse-square-to-30th-street-degraded';
const EXPECTED_ROLES = Object.freeze([
  'accessibility-oriented',
  'balanced',
  'fastest',
  'lower-historical-exposure',
]);
const FORBIDDEN_NETWORK = /(?:\/route\/v\d\/|\bosrm\b|candidate[_-]generation|\/geocod(?:e|er)(?:\/|\?|$))/i;

let baseUrl;
const evidence = [];

await runBrowserSuite({
  createPreview: async () => {
    if (!EXTERNAL_BASE_URL) {
      return preview({ preview: { host: '127.0.0.1', port: PORT, strictPort: true } });
    }
    return {
      config: { base: new URL(EXTERNAL_BASE_URL).pathname },
      resolvedUrls: { local: [EXTERNAL_BASE_URL] },
      close: async () => {},
    };
  },
  launchBrowser: () => chromium.launch({ headless: true }),
  createContext: (browser) => browser.newContext({
    viewport: MATRIX[0].viewport,
    locale: 'en-US',
  }),
  configurePage: (page, _context, { server }) => {
    baseUrl = EXTERNAL_BASE_URL
      ? normalizedBaseUrl(EXTERNAL_BASE_URL)
      : new URL(server.config.base, server.resolvedUrls.local[0]);
    attachObservations(page);
  },
  run: async ({ browser, page }) => {
    evidence.push(await verifyViewport(page, MATRIX[0]));
    const mobileContext = await browser.newContext({
      viewport: MATRIX[1].viewport,
      locale: 'en-US',
    });
    const mobilePage = await mobileContext.newPage();
    attachObservations(mobilePage);
    try {
      evidence.push(await verifyViewport(mobilePage, MATRIX[1]));
    } finally {
      await mobileContext.close();
    }
  },
});

process.stdout.write(`${JSON.stringify({
  status: 'pass',
  browser: 'chromium',
  baseUrl: baseUrl.href,
  viewports: evidence,
  scenarios: {
    complete: { cards: 4, roles: EXPECTED_ROLES },
    single: { cards: 1 },
    degraded: { cards: 1, unavailable: 'preserved-not-zero' },
  },
  languages: ['en', 'zh-CN'],
  keyboard: 'escape-focus-return',
  network: 'same-origin-page-dependencies-and-public-scenario-artifact-only',
})}\n`);

async function verifyViewport(page, variant) {
  const observations = page.__publicRouteObservations;
  const target = new URL(baseUrl.href);
  target.searchParams.set('mode', 'crime');
  target.searchParams.set('view', 'list');
  await page.goto(target.href, { waitUntil: 'domcontentloaded' });
  await ensureEnglish(page);

  const opener = page.locator('[data-public-route-open]');
  const dialog = page.locator('[data-public-route-dialog]');
  await opener.waitFor({ state: 'visible' });
  const urlBefore = page.url();
  const actionRequestCheckpoint = observations.requests.length;

  await opener.click();
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await dialog.evaluate((node) => node.open), true, `${variant.name}: dialog open`);
  assert.equal(await dialog.evaluate((node) => node.matches(':modal')), true,
    `${variant.name}: dialog must be modal`);

  const surface = dialog.locator('[data-public-route-surface]');
  await surface.waitFor({ state: 'visible' });
  await verifyCompleteScenario({ page, dialog, surface, locale: 'en', variant });
  await assertAccessibility(page, variant, 'en');

  await dialog.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await opener.evaluate((node) => document.activeElement === node), true,
    `${variant.name}: English Escape must restore opener focus`);
  await page.getByRole('button', { name: 'Switch to Simplified Chinese' }).click();
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await opener.click();
  await dialog.waitFor({ state: 'visible' });
  await dialog.locator('[data-public-route-surface]').getByRole('heading', {
    name: '比较时间、距离与历史背景',
  }).waitFor();
  await verifyCompleteScenario({
    page,
    dialog,
    surface: dialog.locator('[data-public-route-surface]'),
    locale: 'zh-CN',
    variant,
  });
  await assertAccessibility(page, variant, 'zh-CN');

  await selectAndVerifyLimitedScenario({
    page,
    dialog,
    scenarioId: SINGLE_SCENARIO,
    expectedNotice: /只有一条路线通过必要检查/,
    unavailableLabel: '不可用',
    variant,
  });
  await selectAndVerifyLimitedScenario({
    page,
    dialog,
    scenarioId: DEGRADED_SCENARIO,
    expectedNotice: /未通过全部必要检查|只显示一条普通路线/,
    unavailableLabel: '不可用',
    variant,
  });
  assert.equal(page.url(), urlBefore, `${variant.name}: scenario changes must not mutate URL`);

  await dialog.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await opener.evaluate((node) => document.activeElement === node), true,
    `${variant.name}: Escape must restore opener focus`);

  const actionRequests = observations.requests.slice(actionRequestCheckpoint);
  assertAllowedActionRequests(actionRequests, baseUrl, variant.name);
  assertNoForbiddenNetwork(observations.requests, variant.name);
  assert.deepEqual(observations.pageErrors, [], `${variant.name}: browser page errors`);
  assert.deepEqual(observations.consoleErrors, [], `${variant.name}: browser console errors`);

  return {
    name: variant.name,
    size: variant.viewport,
    actionRequests: actionRequests.map(({ url }) => new URL(url).pathname),
    seriousCriticalViolations: 0,
    horizontalOverflow: 0,
  };
}

async function verifyCompleteScenario({ page, dialog, surface, locale, variant }) {
  const select = dialog.locator('[data-public-route-scenario]');
  await select.selectOption(COMPLETE_SCENARIO);
  await dialog.locator(`[data-public-route-card][data-public-route-role="fastest"]`).waitFor();
  const currentSurface = dialog.locator('[data-public-route-surface]');
  assert.equal(await currentSurface.getAttribute('data-public-route-status'), 'available');
  const cards = currentSurface.locator('[data-public-route-card]');
  assert.equal(await cards.count(), 4, `${variant.name}/${locale}: representative card count`);
  assert.deepEqual(
    (await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.publicRouteRole))).sort(),
    EXPECTED_ROLES,
    `${variant.name}/${locale}: representative roles`,
  );
  assert.deepEqual(
    await cards.evaluateAll((nodes) => nodes.map(
      (node) => node.querySelectorAll('.public-route-card__metric').length,
    )),
    [10, 10, 10, 10],
    `${variant.name}/${locale}: every card must expose all ten evidence rows`,
  );
  const text = await currentSurface.innerText();
  if (locale === 'en') {
    assert.match(text, /tradeoffs/i, `${variant.name}: explicit tradeoff copy`);
  } else {
    assert.match(text, /权衡/, `${variant.name}: Chinese tradeoff copy`);
  }
  assertPublicRouteCopyBoundary(text, `${variant.name}/${locale}`);
  await assertNoHorizontalOverflow(page, currentSurface, variant);
  assert.equal(await surface.isVisible().catch(() => false) || await currentSurface.isVisible(), true);
}

async function selectAndVerifyLimitedScenario({
  page,
  dialog,
  scenarioId,
  expectedNotice,
  unavailableLabel,
  variant,
}) {
  const before = page.url();
  await dialog.locator('[data-public-route-scenario]').selectOption(scenarioId);
  await page.waitForFunction((selected) => (
    document.querySelector('[data-public-route-scenario]')?.value === selected
  ), scenarioId);
  assert.equal(
    await dialog.locator('[data-public-route-scenario]').evaluate(
      (node) => document.activeElement === node,
    ),
    true,
    `${variant.name}/${scenarioId}: scenario selection must retain keyboard focus`,
  );
  const surface = dialog.locator('[data-public-route-surface]');
  assert.equal(await surface.getAttribute('data-public-route-status'), 'limited');
  assert.equal(await surface.locator('[data-public-route-card]').count(), 1,
    `${variant.name}/${scenarioId}: limited scenario must show one route`);
  assert.equal(
    await surface.locator('[data-public-route-card]').getAttribute('data-public-route-role'),
    'route',
  );
  assert.match(await surface.locator('[data-public-route-notice]').innerText(), expectedNotice);
  const unavailableMetrics = await surface.locator('.public-route-card__metric').evaluateAll(
    (rows, label) => rows
      .filter((row) => row.querySelector('strong')?.textContent?.trim() === label)
      .map((row) => row.textContent.trim()),
    unavailableLabel,
  );
  assert.ok(unavailableMetrics.length > 0,
    `${variant.name}/${scenarioId}: fixture must expose an unavailable metric`);
  for (const metricText of unavailableMetrics) {
    assert.doesNotMatch(metricText, /(?:^|\s)0(?:\s|$)/,
      `${variant.name}/${scenarioId}: unavailable metric must not render as zero`);
  }
  assert.equal(page.url(), before, `${variant.name}/${scenarioId}: URL changed`);
  const text = await surface.innerText();
  assertPublicRouteCopyBoundary(text, `${variant.name}/${scenarioId}`);
  await assertNoHorizontalOverflow(page, surface, variant);
}

async function assertAccessibility(page, variant, locale) {
  const results = await new AxeBuilder({ page })
    .include('[data-public-route-dialog]')
    .withTags(['wcag2a', 'wcag2aa'])
    .options({ resultTypes: ['violations'] })
    .analyze();
  const seriousOrCritical = results.violations.filter(
    ({ impact }) => impact === 'serious' || impact === 'critical',
  );
  assert.deepEqual(seriousOrCritical, [],
    `${variant.name}/${locale}: axe serious/critical violations: ${JSON.stringify(seriousOrCritical)}`);
}

async function assertNoHorizontalOverflow(page, surface, variant) {
  const layout = await page.evaluate(() => {
    const activeDialog = document.querySelector('[data-public-route-dialog]');
    const activeSurface = document.querySelector('[data-public-route-surface]');
    const dialogRect = activeDialog.getBoundingClientRect();
    return {
      viewportWidth: innerWidth,
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      dialogOverflow: activeDialog.scrollWidth - activeDialog.clientWidth,
      surfaceOverflow: activeSurface.scrollWidth - activeSurface.clientWidth,
      dialogLeft: dialogRect.left,
      dialogRight: dialogRect.right,
    };
  });
  assert.equal(layout.viewportWidth, variant.viewport.width);
  assert.ok(layout.documentOverflow <= 1, JSON.stringify(layout));
  assert.ok(layout.dialogOverflow <= 1, JSON.stringify(layout));
  assert.ok(layout.surfaceOverflow <= 1, JSON.stringify(layout));
  assert.ok(layout.dialogLeft >= -1 && layout.dialogRight <= layout.viewportWidth + 1,
    JSON.stringify(layout));
  assert.equal(await surface.isVisible(), true);
}

function attachObservations(page) {
  const observations = { requests: [], consoleErrors: [], pageErrors: [] };
  Object.defineProperty(page, '__publicRouteObservations', { value: observations });
  page.on('request', (request) => observations.requests.push({
    url: request.url(),
    method: request.method(),
    resourceType: request.resourceType(),
    body: request.postData() || '',
  }));
  page.on('console', (message) => {
    if (message.type() === 'error') observations.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => observations.pageErrors.push(error.message));
}

function assertAllowedActionRequests(requests, allowedBaseUrl, label) {
  const origin = new URL(allowedBaseUrl).origin;
  const artifactUrl = new URL(`data/route_alternatives_public_scenarios.v1.json`, allowedBaseUrl);
  const allowedDependencyTypes = new Set(['script', 'stylesheet', 'image', 'font', 'media']);
  const unexpected = requests.filter((request) => {
    const url = new URL(request.url);
    if (url.href === artifactUrl.href) return request.method !== 'GET';
    return url.origin !== origin
      || request.method !== 'GET'
      || !allowedDependencyTypes.has(request.resourceType);
  });
  assert.deepEqual(unexpected, [],
    `${label}: Public Scenario action made non-page-dependency requests: ${JSON.stringify(unexpected)}`);
  assert.equal(
    requests.filter(({ url }) => new URL(url).href === artifactUrl.href).length,
    1,
    `${label}: public scenario artifact must be fetched once from the same origin`,
  );
}

function assertNoForbiddenNetwork(requests, label) {
  const offending = requests.filter(({ url, body }) => (
    FORBIDDEN_NETWORK.test(url)
    || FORBIDDEN_NETWORK.test(body)
    || /(?:address|origin|destination|waypoint|private[_-]?input)=/i.test(body)
  )).filter(({ url }) => new URL(url).pathname !== ARTIFACT_PATH);
  assert.deepEqual(offending, [],
    `${label}: OSRM/route/candidate-generation/geocoder/private-input request: ${JSON.stringify(offending)}`);
}

async function ensureEnglish(page) {
  if (await page.locator('html').getAttribute('lang') === 'en') return;
  await page.getByRole('button', { name: '切换到英文' }).click();
  await page.waitForFunction(() => document.documentElement.lang === 'en');
}

function normalizedBaseUrl(value) {
  const url = new URL(value);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  url.search = '';
  url.hash = '';
  return url;
}
