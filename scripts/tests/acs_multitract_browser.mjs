#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const BASE_URL = process.env.ACS_BROWSER_BASE_URL || 'http://127.0.0.1:4189/';
const OUTPUT_DIR = '.tmp/batch9-acs-multitract/browser';
const fixture = await readFile('src/data/acs_vre_b01003_2024_pa101.json', 'utf8');
await mkdir(OUTPUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
let vreRequestCount = 0;

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.route(/acs_vre_b01003_2024_pa101.*\.json(?:\?.*)?$/, async (route) => {
  vreRequestCount += 1;
  await route.fulfill({ status: 200, contentType: 'application/json', body: fixture });
});

try {
  const url = new URL(BASE_URL);
  url.searchParams.set('view', 'list');
  await page.goto(url.href, { waitUntil: 'networkidle' });
  if (await page.locator('html').getAttribute('lang') !== 'en') {
    await page.locator('.language-switch').click();
    await page.waitForFunction(() => document.documentElement.lang === 'en');
  }
  const opener = page.locator('[data-acs-multitract-open]');
  const dialog = page.locator('[data-acs-multitract-dialog]');
  await opener.waitFor({ state: 'visible' });
  assert.equal(vreRequestCount, 0, 'VRE must not load on initial entry');
  assert.equal(await page.locator('body').getAttribute('data-crime-view'), 'list');
  assert.equal(await page.locator('#map').getAttribute('aria-hidden'), 'true');

  await opener.click();
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await dialog.evaluate((element) => element.open), true);
  assert.equal(await dialog.evaluate((element) => element.matches(':modal')), true);
  assert.equal(vreRequestCount, 0, 'opening the dialog must not load VRE');

  const input = page.locator('[data-acs-multitract-input]');
  const calculate = page.locator('[data-acs-multitract-calculate]');
  await input.fill('42101000101\n42101000102');
  assert.equal(vreRequestCount, 0, 'editing the selection must not load VRE');
  assert.equal(await calculate.isDisabled(), true, 'Calculate stays disabled before Review');
  assert.equal(await page.locator('[data-acs-multitract-result]').textContent(), '');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('[data-acs-multitract-review]').evaluate(
    (element) => document.activeElement === element,
  ), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await input.evaluate((element) => document.activeElement === element), true);

  await page.locator('[data-acs-multitract-review]').click();
  await page.waitForFunction(() => (
    document.querySelectorAll('[data-acs-multitract-review-host] tbody tr').length === 2
  ));
  assert.equal(vreRequestCount, 1, 'Review must request VRE exactly once');
  const reviewText = await page.locator('[data-acs-multitract-review-host]').innerText();
  assert.match(reviewText, /42101000101/);
  assert.match(reviewText, /42101000102/);
  assert.match(reviewText, /2020 Census/);
  assert.equal(await calculate.isEnabled(), true);
  assert.equal(await page.locator('[data-acs-multitract-result]').textContent(), '');

  await calculate.click();
  const result = page.locator('[data-acs-multitract-result]');
  await result.locator('table').waitFor({ state: 'visible' });
  assert.equal(vreRequestCount, 1, 'Calculate must reuse the reviewed snapshot');
  const resultText = await result.innerText();
  assert.match(resultText, /Population estimate/);
  assert.match(resultText, /Standard error/);
  assert.match(resultText, /90% margin of error/);
  assert.match(resultText, /5,135/);
  assert.match(resultText, /±463/);
  assert.match(resultText, /2020–2024|2020-2024/);
  assert.match(resultText, /Census SDR VRE/);
  assert.equal(await result.evaluate((element) => document.activeElement === element), true);
  await page.screenshot({ path: `${OUTPUT_DIR}/desktop-en.png`, fullPage: true });

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await opener.evaluate((element) => document.activeElement === element), true);
  await opener.click();
  await dialog.waitFor({ state: 'visible' });
  assert.equal(vreRequestCount, 1, 'reopening must preserve reviewed local state without a request');
  assert.equal(await input.evaluate((element) => document.activeElement === element), true);
  await page.keyboard.press('Escape');

  const languageSwitch = page.locator('.language-switch');
  await languageSwitch.click();
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await opener.click();
  await dialog.getByRole('heading', { name: '比较完整 Census tract' }).waitFor();
  const zhText = await result.innerText();
  assert.match(zhText, /人口估计值/);
  assert.match(zhText, /标准误（SE）/);
  assert.match(zhText, /90% 误差范围/);
  assert.equal(vreRequestCount, 1);
  await page.keyboard.press('Escape');
  await languageSwitch.click();
  await page.waitForFunction(() => document.documentElement.lang === 'en');

  await page.setViewportSize({ width: 390, height: 844 });
  await opener.click();
  await dialog.waitFor({ state: 'visible' });
  const mobileLayout = await page.evaluate(() => {
    const surface = document.querySelector('.acs-multitract__surface');
    const activeDialog = document.querySelector('[data-acs-multitract-dialog]');
    const buttons = [...document.querySelectorAll('.acs-multitract__actions .button')]
      .map((element) => element.getBoundingClientRect());
    const dialogRect = activeDialog.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      dialogLeft: dialogRect.left,
      dialogRight: dialogRect.right,
      dialogOverflow: activeDialog.scrollWidth - activeDialog.clientWidth,
      surfaceOverflow: surface.scrollWidth - surface.clientWidth,
      buttonLefts: buttons.map((rect) => Math.round(rect.left)),
      buttonWidths: buttons.map((rect) => Math.round(rect.width)),
    };
  });
  assert.ok(mobileLayout.documentOverflow <= 1, JSON.stringify(mobileLayout));
  assert.ok(mobileLayout.dialogLeft >= -1, JSON.stringify(mobileLayout));
  assert.ok(mobileLayout.dialogRight <= mobileLayout.viewportWidth + 1, JSON.stringify(mobileLayout));
  assert.ok(mobileLayout.dialogOverflow <= 1, JSON.stringify(mobileLayout));
  assert.ok(mobileLayout.surfaceOverflow <= 1, JSON.stringify(mobileLayout));
  assert.equal(new Set(mobileLayout.buttonLefts).size, 1, JSON.stringify(mobileLayout));
  assert.equal(new Set(mobileLayout.buttonWidths).size, 1, JSON.stringify(mobileLayout));
  await page.screenshot({ path: `${OUTPUT_DIR}/mobile-en.png`, fullPage: true });
  await page.keyboard.press('Escape');

  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({
    status: 'pass',
    vreRequestCount,
    consoleErrors: consoleErrors.length,
    pageErrors: pageErrors.length,
    mobileLayout,
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
