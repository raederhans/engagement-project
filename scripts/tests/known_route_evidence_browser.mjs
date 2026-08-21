#!/usr/bin/env node
import assert from 'node:assert/strict';

import { chromium } from '@playwright/test';
import { preview } from 'vite';

const PORT = 4194;
const server = await preview({ preview: { host: '127.0.0.1', port: PORT, strictPort: true } });
const baseUrl = new URL(server.config.base, server.resolvedUrls.local[0]);
baseUrl.searchParams.set('view', 'list');
baseUrl.searchParams.set('mode', 'crime');
baseUrl.searchParams.set('start', '2025-06');
baseUrl.searchParams.set('months', '1');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const centerlineRequests = [];
const networkObservations = { cityLimits: 0, incidentEnvelopes: 0 };
await installSyntheticRoutes(context, centerlineRequests, networkObservations);
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
  const urlBefore = page.url();
  const opener = page.locator('[data-route-corridor-open]');
  await opener.waitFor({ state: 'visible' });
  await opener.click();
  const surface = page.locator('[data-route-corridor-surface]');
  await surface.waitFor({ state: 'visible' });
  assert.equal(await surface.getAttribute('data-route-status'), 'route-required');
  await enterSyntheticRoute(surface, 39.95);
  await surface.getByRole('button', { name: 'Review historical records' }).click();
  await page.waitForFunction(() => !['pending', 'superseded'].includes(
    document.querySelector('[data-route-corridor-surface]')?.dataset.routeStatus,
  ));
  assert.equal(
    await surface.getAttribute('data-route-status'),
    'ready',
    `${await surface.locator('[data-route-status]').innerText()} ${JSON.stringify(networkObservations)}`,
  );

  const evidence = page.locator('[data-known-route-evidence]');
  await evidence.getByRole('heading', { name: 'Known Route evidence' }).waitFor();
  assert.match(await evidence.innerText(), /does not generate or recommend a route/i);
  assert.match(await evidence.innerText(), /exact route-derived bounding box expanded by 75 m/i);
  assert.match(await evidence.innerText(), /does not receive the route polyline, vertices, addresses, destination/i);
  assert.equal(centerlineRequests.length, 0, 'M4 must not request the centerline before explicit consent');
  const analyze = evidence.getByRole('button', { name: 'Analyze this known route' });
  assert.equal(await analyze.isDisabled(), true);
  await evidence.locator('[data-known-route-consent]').check();
  assert.equal(await analyze.isEnabled(), true);
  await analyze.click();
  await page.waitForFunction(() => document.querySelector('[data-known-route-evidence]')?.dataset.knownRouteEvidenceStatus === 'ready');
  const validText = await evidence.innerText();
  assert.match(validText, /Street centerline and deterministic match/i);
  assert.match(validText, /Historical reported-incident contribution/i);
  assert.match(validText, /Crash \/ HIN context/i);
  assert.match(validText, /Accessibility evidence/i);
  assert.match(validText, /Partial/i);
  assert.match(validText, /Unavailable — not zero/i);
  assert.match(validText, /Analysis-segment contributions/i);
  assert.match(validText, /Why: nearby generalized source rows contribute/i);
  assert.match(validText, /No total safety score/i);
  assert.doesNotMatch(validText, /safest route|safer route recommendation|personal victim|is safe|is dangerous/i);
  assert.equal(await evidence.locator('[data-known-route-evidence-results] > section').count(), 6);
  const segmentItems = evidence.locator('[data-known-route-evidence-results] > section:last-child li');
  assert.equal(await segmentItems.count(), 2);
  for (const item of await segmentItems.all()) {
    assert.equal(await item.locator('dl > div').count(), 6);
    assert.equal(await item.locator('a[href="https://opendataphilly.org/datasets/crime-incidents/"]').count(), 1);
    assert.match(await item.innerText(), /Data as of.*Coverage.*Location precision.*Uncertainty \/ limitations.*Unavailable reason/is);
  }
  assert.ok(centerlineRequests.length >= 4);
  const spatialPost = centerlineRequests.find((request) => request.method === 'POST'
    && request.body.includes('geometry=') && request.body.includes('outFields='));
  assert.ok(spatialPost, 'consented M4 request must send the disclosed bbox POST');
  assert.match(spatialPost.body, /geometryType=esriGeometryEnvelope/);
  assert.match(spatialPost.body, /outFields=objectid%2Cseg_id%2Cfnode_%2Ctnode_%2Coneway%2Cclass%2Cstreetlabe%2Cupdate_/);
  assert.doesNotMatch(spatialPost.body, /LineString|walking|address|destination|Diary/i);
  assert.equal(page.url(), urlBefore, 'Known Route analysis must not mutate shareable URL state');
  const persisted = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
    url: location.href,
  }));
  assert.doesNotMatch(JSON.stringify(persisted), /-75\.1|39\.95|LineString|known-polyline|routeIdentity|corridorIdentity/i);

  await page.locator('.language-switch').click();
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await evidence.getByRole('heading', { name: '已知路线证据' }).waitFor();
  const chineseText = await evidence.innerText();
  assert.match(chineseText, /不提供总体安全分数/);
  assert.match(chineseText, /无障碍证据/);
  await page.locator('.language-switch').click();
  await page.waitForFunction(() => document.documentElement.lang === 'en');

  await enterSyntheticRoute(surface, 39.96);
  await surface.getByRole('button', { name: 'Review historical records' }).click();
  await page.waitForFunction(() => ['ready', 'no-mapped-incidents'].includes(
    document.querySelector('[data-route-corridor-surface]')?.dataset.routeStatus,
  ));
  await evidence.getByRole('heading', { name: 'Known Route evidence' }).waitFor();
  await evidence.locator('[data-known-route-consent]').check();
  await evidence.getByRole('button', { name: 'Analyze this known route' }).click();
  await page.waitForFunction(() => document.querySelector('[data-known-route-evidence]')?.dataset.knownRouteEvidenceStatus === 'unavailable');
  assert.match(await evidence.innerText(), /too far from admitted centerline geometry/i);
  assert.match(await evidence.innerText(), /Unavailable — not zero/i);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => {
    const shell = document.querySelector('.route-corridor-shell');
    const surfaceNode = document.querySelector('[data-route-corridor-surface]');
    return {
      viewportWidth: innerWidth,
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      shellOverflow: shell.scrollWidth - shell.clientWidth,
      surfaceOverflow: surfaceNode.scrollWidth - surfaceNode.clientWidth,
      shellRight: shell.getBoundingClientRect().right,
      shellLeft: shell.getBoundingClientRect().left,
    };
  });
  assert.ok(mobile.documentOverflow <= 1, JSON.stringify(mobile));
  assert.ok(mobile.shellOverflow <= 1, JSON.stringify(mobile));
  assert.ok(mobile.surfaceOverflow <= 1, JSON.stringify(mobile));
  assert.ok(mobile.shellLeft >= -1 && mobile.shellRight <= mobile.viewportWidth + 1, JSON.stringify(mobile));

  await surface.press('Escape');
  await surface.waitFor({ state: 'hidden' });
  assert.equal(await opener.evaluate((element) => document.activeElement === element), true);
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(pageErrors, []);
  process.stdout.write(`${JSON.stringify({
    status: 'pass',
    fixture: 'synthetic-browser-interception-only',
    validWorkflow: true,
    mapMatchFailure: 'off-network/unavailable-not-zero',
    evidenceStates: ['partial', 'unavailable'],
    segmentContribution: 'additive/no-cross-dimension-score',
    privacy: 'session-only/no-url-or-storage-route',
    languages: ['en', 'zh-CN'],
    keyboard: 'escape-focus-return',
    viewports: ['desktop', 'mobile'],
    consoleErrors: 0,
    pageErrors: 0,
    mobile,
  })}\n`);
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve, reject) => {
    server.httpServer.close((error) => (error ? reject(error) : resolve()));
  });
}

async function enterSyntheticRoute(surface, latitude) {
  const rows = surface.locator('[data-route-waypoint-list] > li');
  if (await rows.count() === 2) await surface.getByRole('button', { name: 'Add waypoint' }).click();
  const longitudes = [-75.17, -75.16, -75.15];
  for (let index = 0; index < 3; index += 1) {
    await rows.nth(index).locator('[data-route-waypoint-field="lon"]').fill(String(longitudes[index]));
    await rows.nth(index).locator('[data-route-waypoint-field="lat"]').fill(String(latitude));
    await rows.nth(index).locator('[data-route-waypoint-field="lat"]').dispatchEvent('change');
  }
}

async function installSyntheticRoutes(context, centerlineRequests, networkObservations) {
  await context.route('https://phl.carto.com/api/v2/sql', async (route) => {
    const query = new URLSearchParams(route.request().postData() || '').get('q') || '';
    if (/candidateTotal|candidate_total|json_build_object/i.test(query)) {
      networkObservations.incidentEnvelopes += 1;
      await json(route, { rows: [{ envelope: incidentEnvelope() }] });
      return;
    }
    if (/MIN\s*\(\s*dispatch_date_time/i.test(query)) {
      await json(route, { rows: [{ min_dt: '2006-01-01', max_dt: '2026-08-20' }] });
      return;
    }
    await json(route, { rows: [] });
  });
  await context.route(/City_Limits\/FeatureServer\/0\/query/i, (route) => {
    networkObservations.cityLimits += 1;
    return json(route, cityLimits());
  });
  await context.route(/policegis\.phila\.gov/i, (route) => route.fulfill({ status: 503, body: '{}' }));
  await context.route(/Street_Centerline\/FeatureServer\/0(?:\/query)?/i, async (route) => {
    const request = route.request();
    centerlineRequests.push({ method: request.method(), body: request.postData() || '', url: request.url() });
    if (!/\/query(?:\?|$)/i.test(request.url())) {
      await json(route, centerlineMetadata());
      return;
    }
    const body = new URLSearchParams(request.postData() || '');
    if (body.get('returnCountOnly') === 'true') {
      await json(route, { count: 2 });
      return;
    }
    await json(route, centerlineFeatures());
  });
}

function incidentEnvelope() {
  const feature = (id, coordinates, category) => ({
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates },
    properties: {
      cartodb_id: id,
      dispatch_date_time: '2025-06-15T12:00:00Z',
      text_general_code: category,
      ucr_general: '0600',
      dc_dist: '09',
      location_block: 'SYNTHETIC HUNDRED BLOCK',
    },
  });
  return {
    candidateTotal: 2,
    returnedCandidateCount: 2,
    truncated: false,
    coverageMin: '2006-01-01',
    coverageMax: '2026-08-20',
    coverageMonths: coverageMonths(),
    sourceWideUnmappedCount: 3,
    candidates: [
      feature(101, [-75.166, 39.9505], 'Synthetic theft fixture'),
      feature(102, [-75.154, 39.9504], 'Synthetic assault fixture'),
    ],
  };
}

function coverageMonths() {
  const values = [];
  for (let year = 2006; year <= 2026; year += 1) {
    const finalMonth = year === 2026 ? 8 : 12;
    for (let month = 1; month <= finalMonth; month += 1) {
      values.push(`${year}-${String(month).padStart(2, '0')}`);
    }
  }
  return values;
}

function cityLimits() {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[[-75.3, 39.85], [-74.95, 39.85], [-74.95, 40.15], [-75.3, 40.15], [-75.3, 39.85]]],
      },
    }],
  };
}

function centerlineMetadata() {
  const fields = [
    ['objectid', 'esriFieldTypeOID'],
    ['seg_id', 'esriFieldTypeInteger'],
    ['fnode_', 'esriFieldTypeInteger'],
    ['tnode_', 'esriFieldTypeInteger'],
    ['oneway', 'esriFieldTypeString'],
    ['class', 'esriFieldTypeSmallInteger'],
    ['streetlabe', 'esriFieldTypeString'],
    ['update_', 'esriFieldTypeDate'],
  ].map(([name, type]) => ({ name, type }));
  return {
    serviceItemId: 'c36d828494cd44b5bd8b038be696c839',
    name: 'Street_Centerline',
    type: 'Feature Layer',
    geometryType: 'esriGeometryPolyline',
    capabilities: 'Query',
    objectIdField: 'objectid',
    maxRecordCount: 2000,
    hasZ: false,
    hasM: false,
    supportedQueryFormats: 'JSON, geoJSON',
    editingInfo: { dataLastEditDate: Date.parse('2026-07-29T13:55:32.074Z') },
    fields,
  };
}

function centerlineFeatures() {
  const edge = (objectid, segId, from, to, coordinates) => ({
    type: 'Feature',
    properties: {
      objectid,
      seg_id: segId,
      fnode_: from,
      tnode_: to,
      oneway: 'B',
      class: 3,
      streetlabe: 'SYNTHETIC PUBLIC TEST ST',
      update_: Date.parse('2026-07-01T00:00:00Z'),
    },
    geometry: { type: 'LineString', coordinates },
  });
  return {
    type: 'FeatureCollection',
    features: [
      edge(10, 100, 1, 2, [[-75.17, 39.95], [-75.16, 39.95]]),
      edge(11, 101, 2, 3, [[-75.16, 39.95], [-75.15, 39.95]]),
    ],
  };
}

async function json(route, body) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}
