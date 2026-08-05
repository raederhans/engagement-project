import { expect, test as base } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export const CRIME_API_HOSTS = new Set([
  'citygeo-geocoder-pub.databridge.phila.gov',
  'phl.carto.com',
  'policegis.phila.gov',
  'tigerweb.geo.census.gov',
  'mapservices.pasda.psu.edu',
  'services.arcgis.com',
  'api.censusreporter.org',
]);

const MOCKED_REMOTE_HOSTS = new Set([
  ...CRIME_API_HOSTS,
  'tile.openstreetmap.org',
  'demotiles.maplibre.org',
]);

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
  if (/text_general_code/i.test(body) && /GROUP BY/i.test(body)) {
    return { rows: [{ text_general_code: 'Thefts', n: 8 }] };
  }
  if (/COUNT\(\*\).*\bn\b/is.test(body)) return { rows: [{ n: 12 }] };
  return { rows: [] };
}

export async function installDeterministicRoutes(page) {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({
    contentType: 'image/png',
    body: transparentPng,
  }));
  await page.route('https://demotiles.maplibre.org/font/**', (route) => route.fulfill({
    contentType: 'application/x-protobuf',
    body: Buffer.alloc(0),
  }));
  await page.route('https://citygeo-geocoder-pub.databridge.phila.gov/**', (route) => {
    const query = new URL(route.request().url()).searchParams.get('SingleLine') || '';
    const isB = /Broad/i.test(query);
    return route.fulfill({
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
  await page.route('https://phl.carto.com/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(cartoResponse(route.request())),
  }));
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
      body: JSON.stringify({ error: 'deterministic visual-test fallback' }),
    }));
  }
}

function attachExperienceProbe(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const requests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  return { consoleErrors, pageErrors, requests };
}

export const test = base.extend({
  experience: [async ({ page }, use) => {
    await page.clock.setFixedTime(new Date('2026-08-03T12:00:00Z'));
    await installDeterministicRoutes(page);
    const probe = attachExperienceProbe(page);
    await use(probe);

    const unexpectedHosts = [...new Set(probe.requests
      .filter((url) => new URL(url).origin !== new URL(page.url()).origin)
      .map((url) => new URL(url).hostname)
      .filter((host) => !MOCKED_REMOTE_HOSTS.has(host)))];
    expect(unexpectedHosts, 'experience tests must not depend on an unmocked remote host').toEqual([]);
    expect(probe.pageErrors, 'page errors').toEqual([]);
    expect(probe.consoleErrors, 'console errors').toEqual([]);
  }, { auto: true }],
});

export { expect } from '@playwright/test';

export async function gotoMode(page, mode, params = {}) {
  const url = new URL('/', 'http://experience.test');
  url.searchParams.set('mode', mode);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  await page.goto(`${url.pathname}${url.search}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts?.ready);
  const surface = page.locator(`[data-panel-view="${mode}"]`);
  await expect(surface).toBeVisible();
  await expect(surface).toHaveAttribute('aria-busy', 'false');
}

export async function assertNoHorizontalOverflow(page) {
  const result = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
      })
      .slice(0, 8)
      .map((element) => `${element.tagName.toLowerCase()}#${element.id}.${[...element.classList].join('.')}`),
  }));
  expect(result.document, `horizontal overflow caused by: ${result.offenders.join(', ')}`).toBeLessThanOrEqual(result.viewport + 1);
}

export async function assertCtaInsideViewport(locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = locator.page().viewportSize();
  expect(box, 'CTA must have a layout box').not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

export async function assertFocusNotObscured(locator) {
  await locator.focus();
  await expect(locator).toBeFocused();
  const visibleAtCenter = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
    const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
    return document.elementsFromPoint(x, y).some((candidate) => candidate === element || candidate.contains(element) || element.contains(candidate));
  });
  expect(visibleAtCenter, 'focused control must not be hidden by a fixed or sticky surface').toBe(true);
}

export async function auditSeriousAccessibility(page) {
  const domIssues = await page.evaluate(() => {
    const issues = [];
    const ids = new Map();
    for (const element of document.querySelectorAll('[id]')) {
      const id = element.id;
      ids.set(id, (ids.get(id) || 0) + 1);
    }
    for (const [id, count] of ids) {
      if (count > 1) issues.push(`serious:duplicate-id:${id}`);
    }
    for (const element of document.querySelectorAll('[aria-hidden="true"]')) {
      const focusable = element.matches('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')
        || element.querySelector('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
      if (focusable && !element.inert) issues.push(`serious:focusable-aria-hidden:${element.id || element.className || element.tagName}`);
    }
    return issues;
  });

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .options({ resultTypes: ['violations'] })
    .analyze();
  const axeIssues = results.violations
    .filter(({ impact }) => impact === 'critical' || impact === 'serious')
    .map(({ id, impact, help, helpUrl, nodes }) => ({
      source: 'axe',
      id,
      impact,
      help,
      helpUrl,
      targets: nodes.map((node) => node.target),
    }));
  return [
    ...domIssues.map((issue) => ({ source: 'dom-contract', issue })),
    ...axeIssues,
  ];
}

export const RUNTIME_SCRIPT_BUDGETS = Object.freeze({
  crimeInitial: 1_100_000,
  crimeAnalyzed: 1_350_000,
  diaryInitial: 1_250_000,
});

export function createRuntimeScriptCollector(page) {
  const resources = new Map();
  const pending = new Set();
  const failures = [];

  const handleResponse = (response) => {
    if (response.request().resourceType() !== 'script') return;
    const task = (async () => {
      const body = await response.body();
      resources.set(response.url(), {
        name: new URL(response.url()).pathname,
        bytes: body.byteLength,
        status: response.status(),
      });
    })().catch((error) => failures.push(error));
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };

  page.on('response', handleResponse);
  return {
    async reset() {
      await Promise.allSettled([...pending]);
      resources.clear();
      failures.length = 0;
    },
    async snapshot() {
      await Promise.allSettled([...pending]);
      if (failures.length) throw new AggregateError(failures, 'Unable to read runtime script responses');
      const pageOrigin = new URL(page.url()).origin;
      return [...resources.entries()]
        .filter(([url]) => new URL(url).origin === pageOrigin)
        .map(([, resource]) => resource);
    },
    dispose() {
      page.off('response', handleResponse);
    },
  };
}

export async function captureExperienceScreenshot(
  page,
  testInfo,
  name,
  { locator = null, maxDiffPixelRatio = 0.005, threshold = 0.2 } = {},
) {
  await page.addStyleTag({ content: `
    *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
    #map { background: #edf2f7 !important; }
    #map .maplibregl-canvas { visibility: hidden !important; }
  ` });
  const target = locator || page;
  const screenshot = await target.screenshot({ animations: 'disabled', caret: 'hide' });
  await testInfo.attach(`${name}-${testInfo.project.name}`, { body: screenshot, contentType: 'image/png' });
  await expect(target).toHaveScreenshot(`${name}.png`, {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio,
    threshold,
  });
}

export function crimeRequests(requests) {
  return requests.filter((url) => CRIME_API_HOSTS.has(new URL(url).hostname));
}
