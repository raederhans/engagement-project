#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../../src/style.css', import.meta.url), 'utf8');

test('the map workspace has one semantic product heading in an app bar', () => {
  assert.match(html, /<header\b[^>]*class="[^"]*app-bar[^"]*"[^>]*>/i);
  assert.equal((html.match(/<h1\b/gi) || []).length, 1);
  assert.match(html, /<header\b[\s\S]*?<h1\b[^>]*>[\s\S]*Philadelphia Engagement Explorer[\s\S]*?<\/h1>[\s\S]*?<\/header>/i);
  assert.match(html, /class="app-title__full"/);
  assert.match(html, /class="app-title__compact"[^>]*aria-hidden="true"/);
  assert.match(html, /data-mode-switch-mount/);
  assert.match(html, /data-app-data-status/);
  assert.match(html, /data-app-help/);
});

test('analysis summary stays visible while charts are progressively disclosed', async () => {
  const controller = await readFile(new URL('../../src/ui/sheet_controller.js', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../../src/ui/panel.js', import.meta.url), 'utf8');
  assert.doesNotMatch(controller, /enhanceProgressiveSurface\(['"]compare-card['"]/);
  assert.match(controller, /enhanceProgressiveSurface\(['"]charts['"],\s*['"]View charts and details['"]\)/);
  assert.match(controller, /document\.createElement\(['"]details['"]\)/);
  assert.doesNotMatch(controller, /details\.open\s*=\s*true/);
  assert.match(html, /id="results-drawer"[^>]*aria-label="Analysis details"/i);
  assert.match(css, /#results-drawer\s*\{[^}]*position:\s*fixed[^}]*right:/s);
  assert.doesNotMatch(html, /id="charts"[^>]*style=/i);
  assert.match(css, /#results-drawer\s+\.progressive-surface:not\(\[open\]\)\s*>\s*:not\(summary\)\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(panel, /resultsDrawer\.contains\(chartsPanel\)/);
  assert.doesNotMatch(panel, /chartsPanel\.parentElement\s*!==\s*resultsDrawer/);
});

test('current analysis summary is mounted before recent analyses', async () => {
  const { placeAnalysisHistoryAfterSummary } = await import('../../src/ui/panel.js');
  assert.equal(typeof placeAnalysisHistoryAfterSummary, 'function');
  const shell = {
    children: [],
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
    },
    insertBefore(child, reference) {
      child.parentElement = this;
      const index = reference ? this.children.indexOf(reference) : -1;
      if (index < 0) this.children.push(child);
      else this.children.splice(index, 0, child);
    },
  };
  const summary = { parentElement: null, nextSibling: null };
  const details = { parentElement: null };
  const history = { parentElement: null };
  shell.appendChild(summary);
  shell.appendChild(details);
  summary.nextSibling = details;

  placeAnalysisHistoryAfterSummary({ crimeShell: shell, compareCard: summary, analysisHistoryMount: history });

  assert.deepEqual(shell.children, [summary, history, details]);
});

test('Crime task panel leads with location and defers comparison and advanced controls', () => {
  assert.match(html, />Explore a location<\/[^>]+>/i);
  assert.match(html, /id="compareAreaBtn"[^>]*>Compare another area<\/button>/i);
  assert.match(html, /id="comparisonFields"[^>]*(?:hidden|aria-hidden="true")/i);
  assert.match(html, /<details\b[^>]*id="advancedFilters"[^>]*>/i);
  assert.match(html, /<summary[^>]*>More filters<\/summary>/i);
  assert.doesNotMatch(html, />Controls<\/div>/i);
});

test('desktop and mobile controls use the product target-size tokens', () => {
  assert.match(css, /--control-target:\s*44px\s*;/);
  assert.match(css, /@media\s*\([^)]*max-width:\s*720px[^)]*\)[\s\S]*--control-target:\s*48px\s*;/);
  assert.match(css, /min-height:\s*var\(--control-target\)/);
});

test('mobile mode switching and the sheet handle keep 44px touch targets', () => {
  assert.doesNotMatch(css, /\.sheet-handle\s*\{[^}]*min-height:\s*32px/s);
  assert.doesNotMatch(css, /\.mode-switch__button\s*\{[^}]*min-height:\s*42px/s);
  assert.doesNotMatch(css, /\.mode-switch__button\s*\{[^}]*min-height:\s*calc\(var\(--control-target\)\s*-\s*6px\)/s);
  assert.match(css, /\.sheet-handle\s*\{[^}]*min-height:\s*44px\s*!important/s);
  assert.match(css, /\.mode-switch__button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(
    css,
    /@media\s*\(max-width:\s*720px\)[\s\S]*?\.mode-switch__button\s*\{[^}]*min-height:\s*var\(--control-target\)/s,
  );
});

test('collapsed sheet content is removed from keyboard navigation', async () => {
  const controller = await readFile(new URL('../../src/ui/sheet_controller.js', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../../src/ui/panel.js', import.meta.url), 'utf8');
  assert.match(controller, /className\s*=\s*['"]sheet-content['"]/);
  assert.match(controller, /handle\.setAttribute\(['"]aria-controls['"]/);
  assert.match(controller, /content\.inert\s*=\s*collapsed/);
  assert.match(controller, /content\.setAttribute\(['"]aria-hidden['"],\s*String\(collapsed\)\)/);
  assert.match(panel, /const panelContentRoot\s*=\s*sheetContent\s*\|\|\s*panelRoot/);
  assert.match(css, /#sidepanel\[data-sheet-state=['"]collapsed['"]\]\s+\.sheet-content\s*\{[^}]*visibility:\s*hidden/s);
});

test('mobile sheet exposes collapsed, half, and full layout states', () => {
  assert.match(html, /id="sidepanel"[^>]*data-sheet-state="half"/);
  for (const state of ['collapsed', 'half', 'full']) {
    assert.match(css, new RegExp(`#sidepanel\\[data-sheet-state="${state}"\\]`));
  }
  assert.match(css, /--sheet-collapsed-height:\s*(?:96|104|112)px\s*;/);
  assert.match(css, /--sheet-half-height:\s*58(?:\.0)?dvh\s*;/);
  assert.match(css, /--sheet-full-height:\s*(?:88|90|92)(?:\.0)?dvh\s*;/);
  const finalMobileRule = css.lastIndexOf('@media (max-width: 720px)');
  const finalFullWidthOverride = css.lastIndexOf('width: 100% !important;');
  assert.ok(finalMobileRule >= 0);
  assert.ok(
    finalFullWidthOverride > finalMobileRule,
    'the final mobile cascade must restore a full-width bottom sheet',
  );
});

test('the shared sheet handle stays outside mode-specific panel surfaces', async () => {
  const panel = await readFile(new URL('../../src/ui/panel.js', import.meta.url), 'utf8');
  assert.match(panel, /const sheetHandle\s*=\s*panelRoot\.querySelector\(['"]:scope > \.sheet-handle['"]\)/);
  assert.match(panel, /sheetHandle\?\.remove\(\)/);
  assert.match(panel, /panelRoot\.prepend\(sheetHandle\)/);
});

test('responsive rules cover portrait, landscape, and low-height screens', () => {
  assert.match(css, /@media[^\r\n{]*orientation:\s*portrait[^\r\n{]*\{/);
  assert.match(css, /@media[^\r\n{]*orientation:\s*landscape[^\r\n{]*\{/);
  assert.match(css, /@media[^\r\n{]*max-height:\s*640px[^\r\n{]*\{/);
  const finalLandscapeRule = css.lastIndexOf('@media (max-width: 900px) and (orientation: landscape)');
  const finalDesktopPanel = css.lastIndexOf('width: 360px !important;');
  assert.ok(
    finalLandscapeRule > finalDesktopPanel,
    'the final landscape cascade must override the desktop side panel',
  );
  const landscapeCss = css.slice(finalLandscapeRule);
  assert.match(landscapeCss, /#sidepanel\s*\{[^}]*bottom:\s*0\s*!important[^}]*width:\s*100%\s*!important/s);
  assert.match(landscapeCss, /\.sheet-handle\s*\{[^}]*display:\s*grid/s);
});

test('small-screen Diary keeps its primary route action visible', async () => {
  const livePanel = await readFile(new URL('../../src/routes_diary/ui_live_panel.js', import.meta.url), 'utf8');
  assert.match(livePanel, /rateWrap\.className\s*=\s*['"]diary-rate-action['"]/);
  assert.match(css, /\.diary-rate-action\s*\{[^}]*position:\s*static/s);
  assert.doesNotMatch(css, /\.diary-rate-action\s*\{[^}]*position:\s*fixed/s);
});

test('small-screen Crime keeps the map-pick action visible', () => {
  assert.match(css, /#useCenterBtn\s*\{[^}]*position:\s*fixed[^}]*bottom:/s);
  assert.match(
    css,
    /\[data-panel-view="crime"\]\s*\{[^}]*padding-bottom:\s*76px/s,
  );
});

test('the shell prevents horizontal scrolling and respects reduced motion', () => {
  assert.match(css, /(?:html|body|html,\s*body)[^{]*\{[^}]*overflow-x:\s*(?:clip|hidden)\s*;/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('sheet state progression is deterministic in both directions', async () => {
  const { cycleSheetState, nextSheetState } = await import('../../src/ui/sheet_controller.js');
  assert.equal(nextSheetState('collapsed', 1), 'half');
  assert.equal(nextSheetState('half', 1), 'full');
  assert.equal(nextSheetState('full', 1), 'full');
  assert.equal(nextSheetState('full', -1), 'half');
  assert.equal(nextSheetState('half', -1), 'collapsed');
  assert.equal(nextSheetState('collapsed', -1), 'collapsed');
  assert.equal(cycleSheetState('collapsed'), 'half');
  assert.equal(cycleSheetState('half'), 'full');
  assert.equal(cycleSheetState('full'), 'collapsed');
});
