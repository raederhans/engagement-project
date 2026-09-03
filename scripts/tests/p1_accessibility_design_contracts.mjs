#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import * as mapInit from '../../src/map/initMap.js';
import * as points from '../../src/map/points.js';
import { messages } from '../../src/i18n/messages.js';
import { readProductCss } from './helpers/css_source.mjs';

const root = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (match) => match.slice(1)));
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const styleEntry = await readFile(path.join(root, 'src', 'style.css'), 'utf8');
const css = await readProductCss();
const diaryInsightsSource = await readFile(path.join(root, 'src', 'charts', 'diary_insights.js'), 'utf8');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

function cssHexToken(name) {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  assert.ok(match, `${name} must be a six-digit hex color token`);
  return match[1];
}

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi)
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const luminances = [relativeLuminance(foreground), relativeLuminance(background)]
    .sort((a, b) => b - a);
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(candidate));
    else if (entry.name.endsWith('.js')) files.push(candidate);
  }
  return files;
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.style = {};
    this.className = '';
    this.textContent = '';
    this.parentNode = null;
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
  append(...children) {
    for (const child of children) {
      child.parentNode = this;
      this.children.push(child);
    }
  }
  appendChild(child) { this.append(child); return child; }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  click() { this.listeners.get('click')?.({ currentTarget: this }); }
  querySelector(selector) {
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    for (const child of this.children) {
      if (className && child.className.split(/\s+/).includes(className)) return child;
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  }
}

function fakeDocument() {
  const body = new FakeElement('body');
  return {
    body,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById(id) {
      const visit = (element) => {
        if (element.id === id) return element;
        for (const child of element.children) {
          const match = visit(child);
          if (match) return match;
        }
        return null;
      };
      return visit(body);
    },
  };
}

test('P1 design system has one canonical product layer instead of cascade patches', async () => {
  const globalRoots = css.match(/^:root\s*\{/gm) || [];
  const importantCount = (css.match(/!important/g) || []).length;
  const inlineStyleCount = (html.match(/\sstyle="/g) || []).length;
  const JavaScript = (await Promise.all(
    (await sourceFiles(path.join(root, 'src'))).map((file) => readFile(file, 'utf8')),
  )).join('\n');

  assert.equal(globalRoots.length, 1, 'one global :root must own product tokens');
  assert.ok(importantCount <= 8, `large-scale !important dependence remains: ${importantCount}`);
  assert.equal(inlineStyleCount, 0, 'index.html must use shared component classes, not style attributes');
  assert.equal((JavaScript.match(/style\.cssText/g) || []).length, 0, 'static JS styling must use CSS classes');
  assert.match(css, /--font-product:/);
  assert.match(css, /--space-2:/);
  assert.match(css, /--radius-control:/);
  assert.match(css, /--radius-panel:\s*var\(--radius-card\)/);
  assert.match(css, /--motion-fast:/);
  assert.doesNotMatch(css, /\bInter\b/);
  assert.doesNotMatch(css, /\bsystem-ui\b/);
});

test('Help and the Crime workbench share one civic surface hierarchy', () => {
  for (const token of [
    '--civic-navy',
    '--civic-paper',
    '--civic-paper-light',
    '--civic-orange',
    '--civic-gold',
    '--shadow-overlay',
    '--motion-disclosure',
  ]) {
    assert.match(css, new RegExp(token + ':'), token + ' is missing');
  }
  assert.match(css, /\.about-content\s*\{[^}]*--about-navy:\s*var\(--civic-navy\)[^}]*--about-paper:\s*var\(--civic-paper\)/s);
  assert.match(css, /\.analysis-context\s*\{[^}]*background:[^;]*var\(--civic-paper-light\)[^}]*border-radius:\s*var\(--radius-card\)/s);
  assert.match(css, /#results-drawer\s*\{[^}]*box-shadow:\s*var\(--shadow-overlay\)/s);
});

test('civic annotation text and Help controls meet contrast, target, focus, and motion contracts', () => {
  const orangeInk = cssHexToken('--civic-orange-ink');
  for (const background of [cssHexToken('--civic-paper'), cssHexToken('--civic-paper-light')]) {
    assert.ok(
      contrastRatio(orangeInk, background) >= 4.5,
      `civic annotation ink must reach 4.5:1 on ${background}`,
    );
  }
  assert.match(css, /\.analysis-context__eyebrow\s*\{[^}]*color:\s*var\(--civic-orange-ink\)/s);
  assert.match(css, /\.about-content\s*\{[^}]*--about-orange-ink:\s*var\(--civic-orange-ink\)/s);
  assert.match(css, /\.about-section__heading p\s*\{[^}]*color:\s*var\(--about-orange-ink\)/s);
  assert.match(css, /\.about-close\s*\{[^}]*min-height:\s*var\(--control-target\)/s);
  assert.match(
    css,
    /\.about-close\s*\{[^}]*background:\s*var\(--civic-navy\)[^}]*color:\s*#fff/s,
    'Help close text must keep sufficient contrast before and after lazy content loads',
  );
  assert.match(
    css,
    /\.about-close:focus-visible,[\s\S]*?\.about-source-card a:focus-visible\s*\{[^}]*outline:\s*3px solid #fff[^}]*box-shadow:\s*0 0 0 5px var\(--brand\)/s,
  );
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.about-content-host\s*\{[^}]*scroll-behavior:\s*auto/s,
  );
  assert.doesNotMatch(
    css,
    /@keyframes\s+about-panel-enter\s*\{[^}]*opacity:/s,
    'Help entry motion must not temporarily reduce text contrast',
  );
});

test('analysis context and result navigation have touch, focus, and selected-state contracts', () => {
  assert.match(css, /\.analysis-context:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--brand\)/s);
  assert.match(css, /\.analysis-context__edit\s*\{[^}]*min-height:\s*var\(--control-target\)/s);
  assert.match(css, /\.analysis-context__edit:focus-visible\s*\{[^}]*outline:/s);
  assert.match(css, /\.crime-result-nav\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.crime-result-nav button\s*\{[^}]*min-height:\s*var\(--control-target\)/s);
  assert.match(css, /\.crime-result-nav button\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--civic-navy\)/s);
  assert.match(css, /\.crime-result-nav button:focus-visible\s*\{[^}]*outline:/s);
});

test('task focus and query preview use layered civic surfaces with responsive accessible dialogs', () => {
  assert.match(html, /<section class="task-focus"[^>]*aria-labelledby="task-focus-current"[^>]*>/);
  assert.match(html, /<h2 id="task-focus-current" data-task-focus-current>General overview<\/h2>/);
  assert.match(html, /<details class="query-preset-entry" data-query-preset-mount(?![^>]*\sopen(?:\s|=|>))[^>]*>/);
  assert.match(html, /<details class="query-preset-entry"[\s\S]*?<summary>[\s\S]*?Time presets[\s\S]*?<\/summary>/);
  assert.match(css, /\.task-focus\s*\{[^}]*border:\s*1px solid var\(--civic-rule\)[^}]*border-radius:\s*var\(--radius-card\)[^}]*linear-gradient/s);
  assert.match(css, /\.query-preset-entry\s*\{[^}]*border-top:\s*1px solid var\(--civic-rule\)/s);
  assert.match(css, /\.query-preset-entry\s*>\s*summary\s*\{[^}]*min-height:\s*var\(--control-target\)[^}]*list-style:\s*none/s);
  assert.match(css, /\.task-focus-dialog,[\s\S]*?\.query-preset-dialog\s*\{[^}]*border:\s*0[^}]*border-radius:\s*var\(--radius-sheet\)[^}]*box-shadow:\s*var\(--shadow-overlay\)/s);
  assert.match(css, /\.task-focus-options label\s*\{[^}]*min-height:\s*var\(--control-target\)/s);
  assert.match(css, /\.query-preset-entry__actions\s+\.button\s*\{[^}]*min-height:\s*var\(--control-target\)/s);
  assert.match(css, /\.task-focus-options label:focus-within\s*\{[^}]*outline:/s);
  assert.match(css, /@media\s*\(max-width:\s*720px\)\s*\{[\s\S]*?\.task-focus-dialog,[\s\S]*?\.query-preset-dialog\s*\{[^}]*margin:\s*auto 0 0[^}]*width:\s*100%/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.task-focus-dialog,[\s\S]*?\.query-preset-dialog\s*\{[^}]*transition:\s*none/s);
});

test('result panes avoid nested scroll and new transitions respect reduced motion', () => {
  assert.match(css, /\.crime-result-pane\s*\{[^}]*overflow:\s*visible/s);
  assert.doesNotMatch(
    css,
    /#results-drawer\s+\.progressive-surface\[open\]\s*\{[^}]*overflow:\s*auto/s,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*?#results-drawer\s*\{[^}]*overflow:\s*visible/s,
  );
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?#sidepanel[\s\S]*?\.analysis-context[\s\S]*?\.crime-result-pane[\s\S]*?transition:\s*none/s,
  );
});

test('stylesheet ownership is explicit and preserves the canonical cascade order', () => {
  const imports = [...styleEntry.matchAll(/@import\s+['"]([^'"]+)['"]\s*;/g)]
    .map((match) => match[1]);
  assert.deepEqual(imports, [
    './styles/tokens-base.css',
    './styles/diary-map-ui.css',
    './styles/workbench-shell.css',
    './styles/civic-product.css',
    './styles/crime-charts-responsive.css',
    './styles/crime-list-mode.css',
    './styles/public-route-alternatives.css',
  ]);
  assert.equal((css.match(/^:root\s*\{/gm) || []).length, 1);
});

test('Diary static panel styling is class-owned while insight dimensions remain data-driven', async () => {
  const [myRoutes, community, insights, insightsPanel] = await Promise.all([
    readFile(new URL('../../src/routes_diary/ui_my_routes_panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_diary/ui_community_panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/charts/diary_insights.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_diary/ui_insights_panel.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(myRoutes, /\.style\./);
  assert.doesNotMatch(community, /\.style\./);
  assert.doesNotMatch(insights, /scope\.btn\.style\./);
  assert.doesNotMatch(insightsPanel, /introEl\.style\./);
  assert.match(insightsPanel, /introEl\.className\s*=\s*['"][^'"]*diary-insights-intro/);
  for (const className of [
    'diary-route-filters',
    'diary-route-history-list',
    'diary-history-item__details',
    'diary-community-list',
    'diary-community-observations',
  ]) {
    assert.match(css, new RegExp(`\\.${className}\\s*[,\\{]`));
  }
});

test('Diary insights stay below the app bar and reset fixed geometry in landscape sheets', () => {
  assert.match(css, /\.diary-insights-root\s*\{[^}]*top:\s*calc\(var\(--app-bar-height\)\s*\+\s*var\(--space-3\)\)[^}]*width:\s*min\(420px,\s*calc\(100vw\s*-\s*24px\)\)[^}]*z-index:\s*2\d/s);
  assert.match(css, /\.diary-insights__heatmap\s*\{[^}]*grid-template-columns:\s*minmax\(38px,\s*48px\)\s+repeat\(5,\s*minmax\(36px,\s*1fr\)\)[^}]*max-width:\s*100%[^}]*overflow-x:\s*hidden[^}]*box-sizing:\s*border-box/s);
  assert.doesNotMatch(diaryInsightsSource, /style\.gridTemplateColumns/);
  assert.match(
    css,
    /@media\s*\(max-width:\s*900px\)\s*and\s*\(orientation:\s*landscape\)\s*\{[\s\S]*?\.diary-insights-root\s*\{[^}]*top:\s*auto[^}]*right:\s*auto[^}]*width:\s*auto[^}]*max-height:\s*none[^}]*overflow:\s*visible/s,
  );
});

test('Diary rating and popup actions expose one clear 44px interaction contract', () => {
  assert.equal((css.match(/^\.diary-star\s*\{/gm) || []).length, 1, 'rating stars must have one canonical rule');
  assert.match(css, /\.diary-star\s*\{[^}]*min-width:\s*var\(--control-target\)[^}]*min-height:\s*var\(--control-target\)[^}]*font-size:\s*36px/s);
  assert.match(css, /\.diary-star:is\(\.is-filled,\s*\.filled\)\s*\{[^}]*color:\s*#[0-9a-f]{6}/i);
  assert.match(css, /\.diary-segment-card\s+button\s*\{[^}]*min-width:\s*var\(--control-target\)[^}]*min-height:\s*var\(--control-target\)/s);
  assert.match(css, /\.maplibregl-popup\.diary-segment-card-pinned\s+\.maplibregl-popup-close-button\s*\{[^}]*min-width:\s*var\(--control-target\)[^}]*min-height:\s*var\(--control-target\)/s);
});

test('Crime and Diary share reusable field, button, status, panel, and drawer primitives', () => {
  for (const className of ['button', 'field', 'status-badge', 'task-panel', 'result-card', 'drawer', 'sheet', 'section-heading']) {
    assert.match(css, new RegExp(`\\.${className}\\s*[,\\{]`), `${className} primitive is missing`);
  }
  assert.match(html, /id="sidepanel"[^>]*class="[^"]*\btask-panel\b[^"]*\bsheet\b/i);
  assert.match(html, /id="compare-card"[^>]*class="[^"]*\bresult-card\b/i);
  assert.match(html, /id="results-drawer"[^>]*class="[^"]*\bdrawer\b/i);
});

test('Crime keeps its primary map action before provenance and makes success quieter than failure', () => {
  assert.ok(
    html.indexOf('id="useCenterBtn"') < html.indexOf('data-result-meta="boundary"'),
    'the primary map action must precede map-result provenance in the task flow',
  );
  assert.match(
    css,
    /\.result-meta\[data-availability="current"\]\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/s,
  );
  assert.match(css, /\.result-meta\[data-availability="partial"\]\s*\{[^}]*border-left-color:\s*var\(--warning\)/s);
  assert.match(css, /\.result-meta\[data-availability="stale"\],\s*\n\.result-meta\[data-availability="unavailable"\]/);
});

test('semantic buttons keep their variants and centered Help uses one modal contract', async () => {
  const about = await readFile(new URL('../../src/ui/about.js', import.meta.url), 'utf8');
  assert.match(css, /:where\(#sidepanel button\)\s*\{/);
  assert.doesNotMatch(css, /(^|\n)#sidepanel button\s*\{/);
  assert.match(about, /btn\.setAttribute\(['"]aria-controls['"],\s*panel\.id\)/);
  assert.match(about, /panel\.setAttribute\(['"]role['"],\s*['"]dialog['"]\)/);
  assert.match(about, /panel\.setAttribute\(['"]aria-modal['"],\s*['"]true['"]\)/);
  assert.match(about, /panel\.inert\s*=\s*!isOpen/);
  assert.match(about, /backdrop\.addEventListener\(['"]click['"]/);
});

test('selected map markers expose target-specific non-interactive image semantics', () => {
  const element = new FakeElement('div');
  mapInit.localizeMapMarker({ getElement: () => element }, { labelKey: 'map.markerA' });
  assert.equal(element.getAttribute('role'), 'img');
  assert.equal(element.getAttribute('aria-label'), messages.en['map.markerA']);
  assert.equal(element.getAttribute('tabindex'), '-1');
});

test('reset-map control removes animated camera motion for reduced-motion users', () => {
  assert.equal(typeof mapInit.createResetExtentControl, 'function');
  if (typeof mapInit.createResetExtentControl !== 'function') return;
  const documentRef = fakeDocument();
  let eased = 0;
  let jumped = 0;
  const map = {
    easeTo() { eased += 1; },
    jumpTo() { jumped += 1; },
  };
  const control = mapInit.createResetExtentControl({
    documentRef,
    initialView: { center: [-75.16, 39.95], zoom: 11 },
    windowRef: { matchMedia: () => ({ matches: true }) },
  });
  const container = control.onAdd(map);
  container.children[0].click();
  assert.equal(jumped, 1);
  assert.equal(eased, 0);
});

test('incident density feedback is an announced notice with an immediate Zoom in action', () => {
  assert.equal(typeof points.ensurePointsNotice, 'function');
  if (typeof points.ensurePointsNotice !== 'function') return;
  const documentRef = fakeDocument();
  let zooms = 0;
  points.ensurePointsNotice({
    documentRef,
    map: { zoomIn() { zooms += 1; } },
    key: 'map.tooManyPoints',
    prefersReducedMotion: () => true,
  });
  const notice = documentRef.getElementById('banner');
  assert.equal(notice.getAttribute('role'), 'status');
  assert.equal(notice.getAttribute('aria-live'), 'polite');
  assert.equal(notice.querySelector('.points-notice__message').textContent, messages.en['map.tooManyPoints']);
  const action = notice.querySelector('.points-notice__action');
  assert.equal(action.textContent, messages.en['map.zoomIn']);
  action.click();
  assert.equal(zooms, 1);
});

test('mobile Crime copy, search metadata, touch targets, and attribution are explicit', () => {
  assert.equal(messages.en['crime.area.buffer'], 'Around a point');
  assert.equal(messages.en['map.tooManyPoints'], 'Zoom in to reveal individual incidents.');
  assert.equal(messages.en['map.zoomIn'], 'Zoom in');
  assert.match(html, /id="addrA"[^>]*name="address-a"[^>]*autocomplete="street-address"[^>]*enterkeyhint="search"[^>]*aria-describedby="addressStatus"/i);
  assert.match(html, /class="[^"]*\bsearch-control\b[^"]*"/i);
  assert.match(html, /class="[^"]*\bcheckbox-field\b[^"]*"/i);
  assert.match(css, /\.checkbox-field\s*\{[^}]*min-height:\s*var\(--control-target\)/s);
  assert.match(css, /\.maplibregl-ctrl-attrib\s+a\s*\{[^}]*text-decoration:\s*underline/s);
  assert.match(css, /\.maplibregl-ctrl-attrib-button\s*\{[^}]*min-width:\s*var\(--control-target\)[^}]*min-height:\s*var\(--control-target\)/s);
  assert.match(css, /\.diary-tag\s*\{[^}]*min-width:\s*var\(--control-target\)[^}]*min-height:\s*var\(--control-target\)/s);
  assert.match(css, /\.points-notice__action\s*\{[^}]*min-width:\s*var\(--control-target\)[^}]*min-height:\s*var\(--control-target\)/s);
  assert.match(css, /#sidepanel\s*\{[^}]*scroll-padding-block:/s);
  assert.match(css, /#banner\s*\{[^}]*top:\s*calc\(var\(--app-bar-height\)/s);
});

test('all user-visible asynchronous status surfaces are live regions', () => {
  assert.match(html, /id="addressStatus"[^>]*role="status"[^>]*aria-live="polite"/i);
  assert.match(html, /id="compare-card"[^>]*aria-live="polite"/i);
  assert.match(css, /\.toast\s*\{/);
  assert.match(css, /\.points-notice\s*\{/);
});

test('visual experience checks always rebuild the production bundle before previewing it', () => {
  assert.match(
    packageJson.scripts['test:visual-experience'],
    /^npm run build && node scripts\/run_visual_experience_dist\.mjs$/,
  );
});
