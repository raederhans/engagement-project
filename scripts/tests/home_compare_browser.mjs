#!/usr/bin/env node
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { runBrowserSuite } from '../lib/browser_suite_lifecycle.mjs';
import { validateHomeCompareCitywideReadiness } from '../../src/home_compare/citywide_readiness.js';

const tracked = 'public/data/home_compare_citywide_readiness.v1.json';
const built = 'dist/data/home_compare_citywide_readiness.v1.json';
try { await access(tracked); await access(built); } catch { throw new Error('P5 browser gate requires root to generate and track public/data/home_compare_citywide_readiness.v1.json, then run the production build before browser acceptance.'); }
const [trackedText, builtText] = await Promise.all([readFile(tracked, 'utf8'), readFile(built, 'utf8')]);
assert.equal(builtText, trackedText, 'production build must contain the exact tracked readiness artifact');
await validateHomeCompareCitywideReadiness(JSON.parse(trackedText));
const requests = []; const consoleErrors=[]; const pageErrors=[]; let baseUrl;
await runBrowserSuite({
  createPreview: () => preview({ preview: { host:'127.0.0.1', port:4189, strictPort:true } }),
  launchBrowser: () => chromium.launch({ headless:true }),
  createContext: (browser) => browser.newContext({ viewport:{ width:1280, height:900 } }),
  configureContext: async (_context,{server}) => { baseUrl = new URL(server.config.base, server.resolvedUrls.local[0]); },
  configurePage: async (page) => { page.on('request', (request) => requests.push({ url:request.url(), body:request.postData() || '' })); page.on('console',(message)=>{if(message.type()==='error')consoleErrors.push(message.text())}); page.on('pageerror',(error)=>pageErrors.push(error.message)); await page.addInitScript(()=>{window.__homeUnhandled=[];window.addEventListener('unhandledrejection',(event)=>window.__homeUnhandled.push(String(event.reason)))}) },
  run: async ({ page }) => {
    baseUrl.searchParams.set('hc', JSON.stringify({ schema:'engagement-home-compare-share/v1', weights:{property:20,costHistory:20,civicRecords:20,transportContext:20,dataQuality:20}, dimensions:['property'], address:'PRIVATE' }));
    await page.goto(baseUrl.href, { waitUntil:'networkidle' });
    const opener=page.locator('[data-home-compare-open]'); const dialog=page.locator('[data-home-compare-dialog]');
    for (const [locale, viewport] of [['en',{width:1280,height:900}],['zh-CN',{width:390,height:844}]]) {
      await page.setViewportSize(viewport);
      if ((await page.locator('html').getAttribute('lang')) !== locale) { await page.locator('.language-switch').click(); await page.waitForFunction((target) => document.documentElement.lang === target, locale); }
      await opener.click(); await dialog.locator('[data-home-citywide-readiness]').waitFor(); assert.equal(await dialog.evaluate((node)=>node.matches(':modal')),true); assert.equal(await dialog.getAttribute('aria-labelledby'),'home-compare-title'); assert.equal(await dialog.getAttribute('aria-describedby'),'home-compare-description'); assert.equal(await dialog.locator('[data-home-address="0"]').evaluate((node)=>document.activeElement===node),true); assert.equal(new URL(page.url()).searchParams.has('hc'),false);
      const text=await dialog.innerText(); assert.match(text, locale==='en'?/Citywide source readiness|Local readiness artifact is unavailable/:/全市来源就绪度|本地 readiness 产物不可用/);
      const checkpoint=requests.length; await dialog.locator('[data-home-address="0"]').fill('100 PRIVATE TEST ST'); await dialog.locator('[data-home-run]').click();
      await page.waitForFunction(() => document.querySelector('[data-home-status]')?.textContent?.includes('unavailable') || document.querySelector('[data-home-status]')?.textContent?.includes('不可用'));
      assert.equal(await dialog.locator('[data-home-profile]').count(),0); assert.deepEqual(requests.slice(checkpoint),[],'private address action must make zero requests');
      const privacy=await page.evaluate(()=>({url:location.href,local:{...localStorage},session:{...sessionStorage},state:history.state}));
      assert.doesNotMatch(JSON.stringify(privacy),/100 PRIVATE TEST ST/); assert.equal(await dialog.locator('[data-home-citywide-readiness]').count(),1);
      await dialog.locator('[data-home-citywide-readiness] details').first().click(); await dialog.locator('[data-home-citywide-readiness] details').nth(1).click(); assert.match(await dialog.innerText(),/source_as_of|来源/); assert.match(await dialog.innerText(),/Why unavailable|为何不可用/);
      await page.evaluate(()=>{const url=new URL(location.href);url.searchParams.set('a','PRIVATE');url.searchParams.set('b','PRIVATE');url.searchParams.set('labelA','PRIVATE');url.hash='PRIVATE';history.pushState({private:'PRIVATE'},'',url);}); await dialog.locator('[data-home-share]').click(); const shared=new URL(page.url()); assert.deepEqual([...shared.searchParams.keys()],['hc']); assert.equal(shared.hash,''); assert.doesNotMatch(JSON.stringify(await page.evaluate(()=>({url:location.href,local:{...localStorage},session:{...sessionStorage},state:history.state}))),/PRIVATE/); await page.goBack(); assert.doesNotMatch(page.url(),/PRIVATE/); await page.goForward(); assert.doesNotMatch(page.url(),/PRIVATE/);
      const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-window.innerWidth,dialog:document.querySelector('[data-home-compare-dialog]').scrollWidth-document.querySelector('[data-home-compare-dialog]').clientWidth}));assert.ok(layout.overflow<=1);assert.ok(layout.dialog<=1); await dialog.locator('[data-home-close]').click(); await dialog.waitFor({state:'hidden'}); assert.equal(await opener.evaluate((node)=>document.activeElement===node),true); await opener.click(); assert.deepEqual(await dialog.locator('[data-home-address]').evaluateAll((nodes)=>nodes.map((node)=>node.value)),['','']); assert.equal(await dialog.locator('[data-home-destinations]').inputValue(),''); assert.equal(await dialog.locator('[data-home-profile]').count(),0); await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'}); assert.equal(await opener.evaluate((node)=>document.activeElement===node),true);
    } assert.deepEqual(consoleErrors,[]);assert.deepEqual(pageErrors,[]);assert.deepEqual(await page.evaluate(()=>window.__homeUnhandled),[]);
  },
});
console.log(JSON.stringify({status:'pass',artifact:tracked,languages:['en','zh-CN'],viewports:['desktop','mobile'],privateRequests:0,profiles:0,routing:'unavailable'}));
