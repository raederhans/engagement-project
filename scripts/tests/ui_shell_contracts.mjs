#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { readProductCss } from './helpers/css_source.mjs';

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const css = await readProductCss();

test('the map workspace has one semantic product heading in an app bar', () => {
  assert.match(html, /<header\b[^>]*class="[^"]*app-bar[^"]*"[^>]*>/i);
  assert.equal((html.match(/<h1\b/gi) || []).length, 1);
  assert.match(html, /<header\b[\s\S]*?<h1\b[^>]*>[\s\S]*Philadelphia Urban Evidence Lab[\s\S]*?<\/h1>[\s\S]*?<\/header>/i);
  assert.match(html, /class="app-title__full"/);
  assert.match(html, /class="app-title__compact"[^>]*aria-hidden="true"/);
  assert.match(html, /data-mode-switch-mount/);
  assert.match(html, /data-app-data-status/);
  assert.match(html, /data-app-help/);
});

test('unselected Crime starts in setup stage with result surfaces hidden and inert', () => {
  const sidepanelTag = html.match(/<div\b[^>]*id="sidepanel"[^>]*>/i)?.[0] || '';
  const overviewTag = html.match(/<section\b[^>]*data-crime-results[^>]*>/i)?.[0] || '';
  const drawerTag = html.match(/<aside\b[^>]*id="results-drawer"[^>]*>/i)?.[0] || '';
  const historyTag = html.match(/<details\b[^>]*data-analysis-history-disclosure[^>]*>/i)?.[0] || '';

  assert.match(sidepanelTag, /data-crime-stage="setup"/i);
  for (const tag of [overviewTag, drawerTag, historyTag]) {
    assert.match(tag, /\bhidden\b/i);
    assert.match(tag, /aria-hidden="true"/i);
    assert.match(tag, /\binert\b/i);
  }
});

test('default Crime results prioritize the summary and defer saved analyses', () => {
  const summaryPane = html.match(/<section\b[^>]*data-result-pane="summary"[\s\S]*?<\/section>/i)?.[0] || '';
  assert.ok(summaryPane.indexOf('id="compare-card"') < summaryPane.indexOf('data-result-meta="summary"'));
  assert.match(
    html,
    /<details\b[^>]*data-analysis-history-disclosure[^>]*name="crime-results"[^>]*hidden[^>]*>/i,
  );
  assert.equal(
    (html.match(/<details\b[^>]*name="crime-results"/gi) || []).length,
    5,
    'native details groups must keep one deep result disclosure open at a time',
  );
  assert.match(html, /data-analysis-history-disclosure[\s\S]*?<section\b[^>]*data-analysis-history-mount/i);
});

test('Crime exposes one hidden analysis-context region with an accessible edit action', () => {
  const contextTag = html.match(/<section\b[^>]*data-analysis-context[^>]*>/i)?.[0] || '';
  assert.match(contextTag, /\bhidden\b/i);
  assert.match(contextTag, /aria-labelledby="analysis-context-title"/i);
  assert.match(contextTag, /tabindex="-1"/i);
  assert.doesNotMatch(contextTag, /aria-live=/i);
  assert.match(html, /id="analysis-context-title"/i);
  assert.match(html, /id="crime-query-controls"[^>]*data-crime-setup/i);
  assert.match(
    html,
    /<button\b[^>]*data-analysis-context-edit[^>]*aria-controls="crime-query-controls"/i,
  );
});

test('analysis summary is the default pane while incidents and charts are explicit sibling panes', async () => {
  const controller = await readFile(new URL('../../src/ui/sheet_controller.js', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../../src/ui/panel.js', import.meta.url), 'utf8');
  assert.doesNotMatch(controller, /enhanceProgressiveSurface\(/);
  assert.match(html, /id="results-drawer"[^>]*aria-label="Analysis details"/i);
  assert.match(html, /data-result-pane="summary"/i);
  assert.match(html, /id="incident-results"[^>]*data-result-pane="incidents"/i);
  assert.match(html, /id="charts"[^>]*data-result-pane="charts"/i);
  assert.match(css, /#results-drawer\s*\{[^}]*position:\s*fixed[^}]*right:/s);
  assert.doesNotMatch(html, /id="charts"[^>]*style=/i);
  assert.doesNotMatch(css, /!important/);
  assert.match(panel, /querySelector\(['"]\[data-crime-results\]['"]\)/);
  assert.doesNotMatch(panel, /crimeShell\.appendChild\(compareCard\)/);
  assert.match(panel, /resultsDrawer\.contains\(chartsPanel\)/);
  assert.doesNotMatch(panel, /chartsPanel\.parentElement\s*!==\s*resultsDrawer/);
});

test('current analysis task flow keeps incidents and charts before recent analyses', async () => {
  const { placeAnalysisHistoryAfterResults } = await import('../../src/ui/panel.js');
  assert.equal(typeof placeAnalysisHistoryAfterResults, 'function');
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

  placeAnalysisHistoryAfterResults({ crimeShell: shell, resultsDrawer: details, analysisHistoryMount: history });

  assert.deepEqual(shell.children, [summary, details, history]);
});

test('Crime exposes one result navigation and one synchronized incident-results surface', () => {
  assert.doesNotMatch(html, /data-crime-task-nav/i);
  assert.match(html, /<nav\b[^>]*data-crime-result-nav[^>]*aria-label="Analysis views"/i);
  assert.match(html, /data-result-pane-target="summary"/i);
  assert.match(html, /data-result-pane-target="incidents"/i);
  assert.match(html, /data-result-pane-target="charts"/i);
  assert.match(html, /<section\b[^>]*id="incident-results"[^>]*data-result-pane="incidents"[^>]*aria-labelledby="incident-results-title"[^>]*>/i);
  assert.match(html, /data-incident-results-status[^>]*role="status"[^>]*aria-live="polite"/i);
  assert.match(html, /<ol\b[^>]*data-incident-results-list/i);
  assert.match(html, /data-incident-results-more[^>]*type="button"/i);
  assert.match(css, /\.incident-results__item\s*>\s*button\s*\{[^}]*min-height:\s*var\(--control-target\)/s);
});

test('Crime advanced controls do not nest Data details or a duplicate Help disclosure', () => {
  assert.doesNotMatch(html, /<details\b[^>]*class="data-details"/i);
  assert.match(html, /<section\b[^>]*class="data-details"[^>]*aria-labelledby="crime-data-details-title"/i);
  assert.match(html, /id="crime-data-details-title"[^>]*data-i18n="crime\.dataDetails"/i);
  assert.doesNotMatch(html, /id="help-card"/i);
});

test('dynamic incident status copy has one controller owner', () => {
  const statusTag = html.match(/<[^>]*data-incident-results-status[^>]*>/i)?.[0] || '';
  const stateTag = html.match(/<[^>]*data-incident-results-state[^>]*>/i)?.[0] || '';

  assert.doesNotMatch(statusTag, /data-i18n=/i);
  assert.doesNotMatch(stateTag, /data-i18n=/i);
});

test('incident results prioritize the compact event list before provenance details', () => {
  const incidentSection = html.match(/<section\b[^>]*id="incident-results"[\s\S]*?<div\b[^>]*id="charts"/i)?.[0] || '';
  const listIndex = incidentSection.indexOf('data-incident-results-list');
  const provenanceIndex = incidentSection.indexOf('data-result-meta="incidents"');

  assert.notEqual(listIndex, -1);
  assert.notEqual(provenanceIndex, -1);
  assert.equal(listIndex < provenanceIndex, true);
  assert.match(incidentSection, /data-i18n="incidents\.description"/i);
});

test('task navigation focuses the existing workflow target without creating URL state', async () => {
  const { activateCrimeTaskTarget } = await import('../../src/ui/crime_task_nav.js');
  const calls = [];
  const target = {
    scrollIntoView(options) { calls.push(['scroll', options]); },
    focus(options) { calls.push(['focus', options]); },
  };
  const activated = activateCrimeTaskTarget(
    { dataset: { taskTarget: 'incident-results' } },
    {
      documentRef: { getElementById: (id) => (id === 'incident-results' ? target : null) },
      reducedMotion: () => true,
    },
  );

  assert.equal(activated, true);
  assert.deepEqual(calls, [
    ['scroll', { block: 'start', inline: 'nearest', behavior: 'auto' }],
    ['focus', { preventScroll: true }],
  ]);
});

test('Crime task panel leads with location and defers comparison and advanced controls', () => {
  assert.match(html, />Explore a location<\/[^>]+>/i);
  assert.match(html, /id="compareAreaBtn"[^>]*>Compare another area<\/button>/i);
  assert.match(html, /id="comparisonFields"[^>]*(?:hidden|aria-hidden="true")/i);
  assert.match(html, /<details\b[^>]*id="advancedFilters"[^>]*>/i);
  assert.match(html, /<summary[^>]*>More filters<\/summary>/i);
  assert.doesNotMatch(html, />Controls<\/div>/i);
});

test('Crime buffer radius offers useful presets and an accessible custom value', async () => {
  const radiusSelect = html.match(/<select\b[^>]*id="radiusSel"[^>]*>([\s\S]*?)<\/select>/i)?.[1] || '';
  const values = [...radiusSelect.matchAll(/<option\b[^>]*value="([^"]+)"/gi)].map((match) => match[1]);
  assert.deepEqual(values, ['200', '400', '800', '1200', '1600', '2400', 'custom']);
  assert.match(html, /id="customRadiusRow"[^>]*class="[^"]*custom-radius-row[^"]*"[^>]*hidden/i);
  assert.match(html, /<input\b[^>]*id="customRadiusInput"[^>]*class="[^"]*field[^"]*"[^>]*type="number"[^>]*min="100"[^>]*max="10000"[^>]*step="1"/i);
  assert.doesNotMatch(html.match(/<div\b[^>]*id="bufferRadiusRow"[\s\S]*?<\/div>\s*<div\b[^>]*class="field-group"/i)?.[0] || '', /\sstyle=/i);
  assert.match(css, /\.custom-radius-row\s*\{[^}]*display:\s*grid/s);

  const { describeRadiusControlState } = await import('../../src/ui/panel.js');
  assert.deepEqual(describeRadiusControlState(400), {
    selectValue: '400',
    customValue: '400',
    customVisible: false,
  });
  assert.deepEqual(describeRadiusControlState(1375), {
    selectValue: 'custom',
    customValue: '1375',
    customVisible: true,
  });
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
  assert.match(css, /\.sheet-handle\s*\{[^}]*min-height:\s*44px/s);
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
  assert.match(
    css,
    /@media\s*\(max-width:\s*720px\)[\s\S]*?#sidepanel\s*\{[^}]*right:\s*0[^}]*left:\s*0[^}]*width:\s*100%/s,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*720px\)[\s\S]*?#sidepanel\s*\{[^}]*overflow:\s*clip/s,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*900px\)\s*and\s*\(orientation:\s*landscape\)[\s\S]*?#sidepanel\s*\{[^}]*overflow:\s*clip/s,
  );
  assert.match(css, /\.sheet-content\s*\{[^}]*overflow-y:\s*auto/s);
});

test('map recovery stays above sheets and map notices but below the global app bar', () => {
  const appBarZ = Number(css.match(/\.app-bar\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);
  const mobileSheetZ = Number(css.match(
    /@media\s*\(max-width:\s*720px\)[\s\S]*?#sidepanel\s*\{[^}]*z-index:\s*(\d+)/s,
  )?.[1]);
  const mapNoticeZ = Number(css.match(/\.map-notice\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);
  const recoveryZ = Number(css.match(/\.map-recovery\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);

  assert.ok([
    appBarZ,
    mobileSheetZ,
    mapNoticeZ,
    recoveryZ,
  ].every(Number.isFinite));
  assert.ok(mapNoticeZ > mobileSheetZ, 'ordinary map notices must remain visible above a full mobile sheet');
  assert.ok(recoveryZ > mapNoticeZ, 'WebGL recovery must not be covered by an ordinary map notice');
  assert.ok(recoveryZ > mobileSheetZ, 'map recovery must remain visible above a full mobile sheet');
  assert.ok(recoveryZ < appBarZ, 'map recovery must not cover the global app bar');
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
  assert.ok(finalLandscapeRule >= 0);
  const landscapeCss = css.slice(finalLandscapeRule);
  assert.match(landscapeCss, /#sidepanel\s*\{[^}]*bottom:\s*0[^}]*width:\s*100%/s);
  assert.match(landscapeCss, /\.sheet-handle\s*\{[^}]*display:\s*grid/s);
  assert.doesNotMatch(landscapeCss, /!important/);
});

test('small-screen Diary keeps its primary route action inside the sheet scroll owner', async () => {
  const livePanel = await readFile(new URL('../../src/routes_diary/ui_live_panel.js', import.meta.url), 'utf8');
  assert.match(livePanel, /rateWrap\.className\s*=\s*['"]diary-rate-action['"]/);
  assert.match(css, /@media\s*\(max-width:\s*720px\),[^}]+landscape[^\{]*\{[\s\S]*?\.diary-rate-action\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0/s);
  assert.match(css, /@media\s*\(max-width:\s*900px\)\s*and\s*\(orientation:\s*landscape\)\s*\{[\s\S]*?\.diary-rate-action\s*\{[^}]*position:\s*static/s);
  assert.match(css, /\[data-panel-view="diary"\]\s*\{[^}]*padding-bottom:\s*0/s);
  assert.match(css, /\.sheet-content\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto[^}]*safe-area-inset-bottom/s);
  assert.match(css, /\.diary-insights-root\s*\{[^}]*position:\s*relative[^}]*z-index:\s*29/s);
});

test('small-screen Crime keeps the map-pick action in the sheet flow', () => {
  assert.match(html, /class="search-control"[\s\S]*?id="useCenterBtn"/);
  assert.match(css, /@media\s*\(max-width:\s*720px\),[^}]+landscape[^\{]*\{[\s\S]*?#useCenterBtn\s*\{[^}]*position:\s*static/s);
  assert.doesNotMatch(css, /#useCenterBtn\s*\{[^}]*position:\s*fixed/s);
});

test('the fixed map shell prevents document scrolling and respects reduced motion', () => {
  assert.match(css, /(?:html|body|html,\s*body)[^{]*\{[^}]*overflow-x:\s*(?:clip|hidden)\s*;/s);
  assert.match(css, /(?:html|body|html,\s*body)[^{]*\{[^}]*overflow-y:\s*clip\s*;/s);
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
