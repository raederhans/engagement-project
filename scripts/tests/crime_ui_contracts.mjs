#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { store } from '../../src/state/store.js';
import { attachDistrictPopup } from '../../src/map/ui_popup_district.js';
import '../../src/i18n/crime_offense_catalog.js';
import { readProductCss } from './helpers/css_source.mjs';

test('dense Crime clusters switch to a high-contrast white count label', async () => {
  const { clusterTextColorExpression } = await import('../../src/map/points.js');
  assert.deepEqual(clusterTextColorExpression(), [
    'step',
    ['get', 'point_count'],
    '#112',
    100,
    '#fff',
  ]);
});

test('Crime exposes one primary analytical layer for each analysis mode', async () => {
  const crime = await import('../../src/routes_crime/index.js');
  assert.equal(typeof crime.resolveCrimePrimaryLayer, 'function');
  assert.equal(typeof crime.resolveCrimeLayerVisibility, 'function');

  assert.equal(crime.resolveCrimePrimaryLayer({ queryMode: 'buffer' }), 'incidents');
  assert.equal(crime.resolveCrimePrimaryLayer({ queryMode: 'district' }), 'districts');
  assert.equal(crime.resolveCrimePrimaryLayer({ queryMode: 'tract' }), 'tracts');

  const bufferState = {
    queryMode: 'buffer',
    centerLonLat: [-75.16, 39.95],
    centerBLonLat: null,
    overlayTractsLines: false,
  };
  assert.equal(crime.resolveCrimeLayerVisibility('clusters', bufferState), 'visible');
  assert.equal(crime.resolveCrimeLayerVisibility('unclustered', bufferState), 'visible');
  assert.equal(crime.resolveCrimeLayerVisibility('districts-fill', bufferState), 'none');
  assert.equal(crime.resolveCrimeLayerVisibility('tracts-fill', bufferState), 'none');

  const districtState = { ...bufferState, queryMode: 'district' };
  assert.equal(crime.resolveCrimeLayerVisibility('clusters', districtState), 'none');
  assert.equal(crime.resolveCrimeLayerVisibility('districts-fill', districtState), 'visible');
  assert.equal(crime.resolveCrimeLayerVisibility('tracts-fill', districtState), 'none');

  const tractState = { ...bufferState, queryMode: 'tract' };
  assert.equal(crime.resolveCrimeLayerVisibility('clusters', tractState), 'none');
  assert.equal(crime.resolveCrimeLayerVisibility('districts-fill', tractState), 'none');
  assert.equal(crime.resolveCrimeLayerVisibility('tracts-fill', tractState), 'visible');
});

test('incident refresh requires either a buffer location or a selected census tract', async () => {
  const crime = await import('../../src/routes_crime/index.js');
  assert.equal(typeof crime.hasActiveIncidentSelection, 'function');
  const unselected = {
    queryMode: 'buffer',
    centerLonLat: null,
    center3857: null,
    overlayTractsLines: false,
  };
  assert.equal(crime.hasActiveIncidentSelection(unselected), false);
  assert.equal(crime.resolveCrimeLayerVisibility('clusters', unselected), 'none');

  const selected = {
    ...unselected,
    centerLonLat: [-75.16, 39.95],
    center3857: [-8_365_000, 4_855_000],
  };
  assert.equal(crime.hasActiveIncidentSelection(selected), true);
  assert.equal(crime.resolveCrimeLayerVisibility('clusters', selected), 'visible');

  const unselectedTract = {
    queryMode: 'tract',
    selectedTractGEOID: null,
    overlayTractsLines: false,
  };
  assert.equal(crime.hasActiveIncidentSelection(unselectedTract), false);
  assert.equal(crime.hasActiveIncidentSelection({
    ...unselectedTract,
    selectedTractGEOID: '42101000100',
  }), true);
  assert.equal(crime.resolveCrimeLayerVisibility('clusters', {
    ...unselectedTract,
    selectedTractGEOID: '42101000100',
  }), 'none');
});

test('task focus changes presentation without mutating canonical Crime state', async () => {
  const taskFocus = await import('../../src/routes_crime/task_focus_controller.js').catch(() => ({}));
  assert.equal(typeof taskFocus.createTaskFocusController, 'function');
  const { encodeCrimeViewState } = await import('../../src/state/crime_view_state.js');
  const state = {
    queryMode: 'buffer',
    startMonth: '2025-01',
    durationMonths: 12,
    radius: 1600,
    selectedGroups: ['property'],
    selectedDrilldownCodes: ['0500'],
    centerLonLat: [-75.16, 39.95],
    centerBLonLat: [-75.17, 39.96],
    addressA: 'Market Street',
    addressB: 'Broad Street',
    classMethod: 'equal',
    classBins: 7,
    classPalette: 'Blues',
    classOpacity: 0.8,
  };
  const before = encodeCrimeViewState(state);
  const applied = [];
  const controller = taskFocus.createTaskFocusController({
    presentation: {
      applyTaskFocusPresentation(config) { applied.push(config); },
    },
  });

  assert.equal(controller.getFocusMode(), 'general');
  const result = controller.setFocusMode('long_term');

  assert.equal(result.focusMode, 'long_term');
  assert.equal(result.preferredInitialPane, 'charts');
  assert.equal(applied.at(-1).preferredInitialPane, 'charts');
  assert.equal(taskFocus.TASK_FOCUS_CONFIG.daily_living.preferredInitialPane, 'incidents');
  assert.notEqual(
    taskFocus.TASK_FOCUS_CONFIG.daily_living.preferredInitialPane,
    taskFocus.TASK_FOCUS_CONFIG.general.preferredInitialPane,
  );
  assert.equal(encodeCrimeViewState(state), before);
  for (const forbidden of [
    'startMonth',
    'durationMonths',
    'radius',
    'selectedGroups',
    'selectedDrilldownCodes',
    'centerLonLat',
    'centerBLonLat',
  ]) {
    assert.equal(Object.hasOwn(result, forbidden), false, `${forbidden} must remain query-owned`);
  }
});

test('task focus is page-lifetime memory and never uses browser storage', async () => {
  const { createTaskFocusController } = await import('../../src/routes_crime/task_focus_controller.js');
  const storageCalls = [];
  const storage = new Proxy({}, {
    get(_target, property) {
      if (['getItem', 'setItem', 'removeItem'].includes(property)) {
        return (...args) => storageCalls.push([property, ...args]);
      }
      return undefined;
    },
  });
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: storage, sessionStorage: storage };
  try {
    const first = createTaskFocusController();
    first.setFocusMode('daily_living');
    assert.equal(first.getFocusMode(), 'daily_living');

    const second = createTaskFocusController();
    assert.equal(second.getFocusMode(), 'general');
    assert.deepEqual(storageCalls, []);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('task focus binds an accessible choice dialog and applies an explicit selection', async () => {
  const { createTaskFocusController } = await import('../../src/routes_crime/task_focus_controller.js');
  const interactive = (extra = {}) => {
    const listeners = new Map();
    return {
      dataset: {},
      textContent: '',
      hidden: false,
      attributes: new Map(),
      addEventListener(type, listener) { listeners.set(type, listener); },
      click() { listeners.get('click')?.({ preventDefault() {} }); },
      setAttribute(name, value) { this.attributes.set(name, value); },
      ...extra,
    };
  };
  const openButton = interactive();
  const applyButton = interactive();
  const current = interactive();
  const description = interactive();
  const dialog = interactive({
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; },
  });
  const radios = [
    interactive({ value: 'general', checked: true }),
    interactive({ value: 'long_term', checked: false }),
    interactive({ value: 'daily_living', checked: false }),
  ];
  const nodes = new Map([
    ['[data-task-focus-open]', openButton],
    ['[data-task-focus-dialog]', dialog],
    ['[data-task-focus-apply]', applyButton],
    ['[data-task-focus-current]', current],
    ['[data-task-focus-description]', description],
  ]);
  const mount = interactive({
    hidden: true,
    querySelector(selector) { return nodes.get(selector) || null; },
    querySelectorAll(selector) { return selector === '[data-task-focus-option]' ? radios : []; },
  });
  const applied = [];
  const controller = createTaskFocusController({
    mount,
    presentation: {
      applyTaskFocusPresentation(config) { applied.push(config); },
    },
  });

  assert.equal(mount.hidden, false);
  openButton.click();
  assert.equal(dialog.open, true);
  for (const radio of radios) radio.checked = radio.value === 'long_term';
  applyButton.click();

  assert.equal(controller.getFocusMode(), 'long_term');
  assert.equal(applied.at(-1).preferredInitialPane, 'charts');
  assert.equal(mount.dataset.taskFocus, 'long_term');
  assert.match(current.textContent, /Long-term/i);
  assert.match(description.textContent, /information order|query/i);
  assert.equal(dialog.open, false);
  controller.dispose();

  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /data-task-focus/);
  assert.match(html, /<dialog[^>]+data-task-focus-dialog/);
  assert.match(html, /data-task-focus-option[^>]+value="general"/);
  assert.match(html, /data-task-focus-option[^>]+value="long_term"/);
  assert.match(html, /data-task-focus-option[^>]+value="daily_living"/);
});

test('latest-window suggestions use an explicit accessible preview instead of instant apply', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  assert.match(html, /data-query-preset-mount/);
  assert.match(html, /data-query-preset="latest-6-months"/);
  assert.match(html, /data-query-preset="latest-24-months"/);
  assert.match(html, /<dialog[^>]+data-query-preset-dialog[^>]+aria-labelledby="query-preset-title"/);
  assert.match(html, /data-query-preset-changes[^>]+role="list"/);
  assert.match(html, /data-query-preset-cancel/);
  assert.match(html, /data-query-preset-confirm/);
  assert.match(html, /data-query-preset-undo/);
  assert.match(html, /review[^<]+settings|查看[^<]+设置/i);
});

test('query preset code stays nested-lazy until a user opens a suggestion', async () => {
  const { createTaskFocusController } = await import('../../src/routes_crime/task_focus_controller.js');
  const listeners = new Map();
  const presetButton = {
    dataset: { queryPreset: 'latest-24-months' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    click() { listeners.get('click')?.(); },
  };
  const presetMount = {
    querySelectorAll(selector) { return selector === '[data-query-preset]' ? [presetButton] : []; },
  };
  const mount = {
    dataset: {},
    hidden: true,
    querySelector(selector) {
      return selector === '[data-query-preset-mount]' ? presetMount : null;
    },
    querySelectorAll: () => [],
  };
  const opened = [];
  let loads = 0;
  const controller = createTaskFocusController({
    mount,
    presetPorts: { marker: 'port' },
    loadQueryPresetModule: async () => {
      loads += 1;
      return {
        initCrimeQueryPreset(options) {
          assert.equal(options.mount, presetMount);
          assert.equal(options.marker, 'port');
          return { openPreset: (presetId) => opened.push(presetId) };
        },
      };
    },
  });

  assert.equal(loads, 0);
  presetButton.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 1);
  assert.deepEqual(opened, ['latest-24-months']);
  presetButton.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 1);
  assert.deepEqual(opened, ['latest-24-months', 'latest-24-months']);
  controller.dispose();

  const [taskSource, crimeSource, queryPresetSource] = await Promise.all([
    readFile(new URL('../../src/routes_crime/task_focus_controller.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_crime/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_crime/query_preset_controller.js', import.meta.url), 'utf8'),
  ]);
  assert.match(taskSource, /import\('\.\/query_preset_controller\.js'\)/);
  assert.doesNotMatch(crimeSource, /import\('\.\/query_preset_controller\.js'\)/);
  assert.doesNotMatch(queryPresetSource, /from ['"]\.\.\/i18n\//);
  assert.doesNotMatch(queryPresetSource, /from ['"]\.\.\/state\//);
  assert.match(taskSource, /translate:\s*t/);
});

test('query preset UI renders the exact preview and cancellation leaves the query untouched', async () => {
  const { initCrimeQueryPreset } = await import('../../src/routes_crime/query_preset_controller.js');
  const interactive = (extra = {}) => {
    const listeners = new Map();
    return {
      dataset: {},
      textContent: '',
      hidden: false,
      disabled: false,
      children: [],
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener() {},
      click() { return this.disabled ? undefined : listeners.get('click')?.({ preventDefault() {} }); },
      setAttribute(name, value) { this[name] = value; },
      replaceChildren(...children) { this.children = children; },
      ...extra,
    };
  };
  const dialog = interactive({
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; },
  });
  const status = interactive();
  const changes = interactive();
  const cancel = interactive();
  const confirm = interactive({ disabled: true });
  const undo = interactive({ hidden: true });
  const nodes = new Map([
    ['[data-query-preset-dialog]', dialog],
    ['[data-query-preset-status]', status],
    ['[data-query-preset-changes]', changes],
    ['[data-query-preset-cancel]', cancel],
    ['[data-query-preset-confirm]', confirm],
    ['[data-query-preset-undo]', undo],
  ]);
  const mount = interactive({
    querySelector: (selector) => nodes.get(selector) || null,
    querySelectorAll: () => [],
  });
  const current = queryPresetFixtureForUi();
  const sideEffects = [];
  let resolveRefresh;
  const refreshGate = new Promise((resolve) => { resolveRefresh = resolve; });
  const strings = {
    'preset.change.startMonth': 'Start month: {before} → {after}',
    'preset.change.durationMonths': 'Duration: {before} months → {after} months',
    'preset.unknown': 'Not set',
    'preset.previewReady': 'Review the two changes below.',
  };
  const ui = initCrimeQueryPreset({
    mount,
    documentRef: { createElement: () => interactive() },
    translate: (key, variables = {}) => Object.entries(variables).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      strings[key] || key,
    ),
    readCanonical: () => current,
    readCoverage: () => ({ status: 'ready', min: '2020-01', max: '2026-06' }),
    replace: (next) => {
      Object.assign(current, structuredClone(next));
      sideEffects.push('replace');
    },
    sync: () => sideEffects.push('sync'),
    url: () => sideEffects.push('url'),
    clear: () => sideEffects.push('clear'),
    refresh: () => {
      sideEffects.push('refresh');
      return refreshGate;
    },
  });

  const preview = ui.openPreset('latest-6-months');
  assert.equal(preview.status, 'preview');
  assert.equal(dialog.open, true);
  assert.equal(confirm.disabled, false);
  assert.equal(changes.children.length, 2);
  assert.match(changes.children[0].textContent, /start|开始/i);
  assert.match(changes.children[1].textContent, /duration|时长/i);

  cancel.click();
  assert.equal(dialog.open, false);
  assert.deepEqual(sideEffects, []);

  ui.openPreset('latest-6-months');
  const pending = ui.confirmPreview();
  assert.equal(cancel.disabled, true);
  assert.equal(undo.disabled, true);
  cancel.click();
  assert.equal(dialog.open, true, 'A pending canonical transaction must not look cancelled');

  resolveRefresh({ applied: true, status: 'live' });
  await pending;
  assert.equal(cancel.disabled, false);
  assert.equal(undo.disabled, false);
  assert.equal(undo.hidden, false);
  assert.deepEqual(sideEffects, ['replace', 'sync', 'url', 'clear', 'refresh']);
  ui.dispose();
});

function queryPresetFixtureForUi() {
  return {
    queryMode: 'buffer',
    startMonth: '2025-01',
    durationMonths: 12,
    radius: 800,
    selectedGroups: ['property'],
    centerLonLat: [-75.16, 39.95],
    classMethod: 'quantile',
    classBins: 5,
    classPalette: 'Blues',
    classOpacity: 0.75,
  };
}

test('focus preference initializes a new analysis pane without stealing manual pane choice', async () => {
  const { createCrimeWorkbenchController } = await import('../../src/ui/crime_workbench.js');
  const { createTaskFocusController } = await import('../../src/routes_crime/task_focus_controller.js');
  const element = (dataset = {}) => ({
    dataset,
    hidden: false,
    inert: false,
    textContent: '',
    attributes: new Map(),
    addEventListener() {},
    contains: () => false,
    focus() {},
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
  });
  const nav = {
    children: [],
    append(...buttons) {
      for (const button of buttons) {
        this.children = this.children.filter((child) => child !== button);
        this.children.push(button);
      }
    },
    prepend(button) {
      this.children = this.children.filter((child) => child !== button);
      this.children.unshift(button);
    },
  };
  const paneButtons = ['summary', 'incidents', 'charts'].map((pane) => {
    const button = element({ resultPaneTarget: pane });
    button.parentElement = nav;
    nav.children.push(button);
    return button;
  });
  const state = { queryMode: 'buffer', centerLonLat: null, radius: 400 };
  const panelRoot = element();
  const crimeShell = element();
  crimeShell.querySelectorAll = () => paneButtons;
  const controller = createCrimeWorkbenchController({
    state,
    panelRoot,
    context: element(),
    setup: element(),
    results: [element()],
    editButton: element(),
    contextTitle: element(),
    contextMeta: element(),
    summaryPane: element(),
    resultDrawer: element(),
    incidentPane: element(),
    chartsPane: element(),
    paneButtons,
    documentRef: { activeElement: null },
  });

  assert.equal(typeof controller.setResultPane, 'function');
  const focusController = createTaskFocusController({
    mount: {
      hidden: false,
      dataset: {},
      parentElement: crimeShell,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    presentation: { applyTaskFocusPresentation: controller.focus },
  });
  focusController.setFocusMode('long_term');
  assert.deepEqual(nav.children.map((button) => button.dataset.resultPaneTarget), [
    'charts', 'summary', 'incidents',
  ]);
  state.centerLonLat = [-75.16, 39.95];
  controller.sync();
  assert.equal(panelRoot.dataset.crimeResultPane, 'charts');

  controller.setResultPane('incidents');
  focusController.setFocusMode('daily_living');
  controller.sync();
  assert.equal(panelRoot.dataset.crimeResultPane, 'incidents');
  assert.deepEqual(nav.children.map((button) => button.dataset.resultPaneTarget), [
    'incidents', 'summary', 'charts',
  ]);

  state.radius = 800;
  controller.sync();
  assert.equal(panelRoot.dataset.crimeResultPane, 'incidents');
});

test('task focus uses a narrow panel port and a fault-isolated second-level Crime boundary', async () => {
  const [panelSource, mainSource, crimeSource] = await Promise.all([
    readFile(new URL('../../src/ui/panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_crime/index.js', import.meta.url), 'utf8'),
  ]);

  assert.match(panelSource, /taskFocus\s*:\s*\{/);
  assert.match(panelSource, /mount\s*:\s*taskFocusMount/);
  assert.match(panelSource, /applyTaskFocusPresentation\s*:\s*crimeWorkbench\.focus/);
  assert.match(mainSource, /taskFocus\s*:\s*panel\.taskFocus/);
  assert.match(crimeSource, /import\('\.\/task_focus_controller\.js'\)/);
  assert.match(crimeSource, /default:\s*initTaskFocus/);
  assert.match(crimeSource, /initTaskFocus\(taskFocus, presetPorts\)/);
  assert.match(crimeSource, /Task focus failed/);
  const taskSource = await readFile(new URL('../../src/routes_crime/task_focus_controller.js', import.meta.url), 'utf8');
  assert.doesNotMatch(taskSource, /parentElement|append\?\.\(button\)/);
});

test('query preset integration owns one URL write and one refresh with no legacy instant mutator', async () => {
  const [html, panelSource, mainSource, crimeSource] = await Promise.all([
    readFile(new URL('../../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../../src/ui/panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_crime/index.js', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(html, /id="preset(?:6|12)"/);
  assert.doesNotMatch(panelSource, /applyRecentPreset|\bpreset6\b|\bpreset12\b/);
  assert.match(panelSource, /function syncControlsFromStore\s*\(\)/);
  assert.match(panelSource, /function syncFromStore\s*\(\)\s*\{\s*syncControlsFromStore\(\);\s*writeCrimeStateToURL\(store\);/);
  assert.match(mainSource, /presetPorts\s*:\s*\{/);
  assert.match(mainSource, /state\s*:\s*store/);
  assert.match(mainSource, /normalize\s*:\s*\(state\)\s*=>\s*decodeCrimeViewState\(encodeCrimeViewState\(state\)\)/);
  assert.match(mainSource, /replace\s*:\s*\(next\)\s*=>\s*replaceCrimeViewState/);
  assert.match(mainSource, /sync\s*:\s*\(\)\s*=>\s*panel\.syncPreset/);
  assert.match(mainSource, /url\s*:\s*\(\)\s*=>\s*writeCrimeStateToURL\(store\)/);
  assert.match(mainSource, /clear\s*:\s*\(\)\s*=>\s*analysisHistoryController/);
  assert.match(mainSource, /refresh\s*:\s*\(\)\s*=>\s*refreshCrime\(false\)/);
  assert.match(crimeSource, /presetPorts\s*=\s*null/);
  assert.match(crimeSource, /initTaskFocus\(taskFocus, presetPorts\)/);
});

test('Crime task and availability copy stays neutral, historical, and non-persona', async () => {
  const { messages } = await import('../../src/i18n/index.js');
  await import('../../src/ui/data_scope.js');
  await import('../../src/i18n/crime_safety.js');
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  assert.equal(messages.en['residential.eyebrow'], 'Long-term context');
  assert.equal(messages['zh-CN']['residential.eyebrow'], '长期背景');
  assert.doesNotMatch(html, /Homebuyer view|购房参考/);
  assert.equal(messages.en['scope.live'], 'Data available');
  assert.equal(messages['zh-CN']['scope.live'], '数据可用');
  assert.match(messages.en['scope.through'], /records through/);
  assert.match(messages['zh-CN']['scope.through'], /记录截至/);
  assert.match(messages.en['map.noPointIncidents'], /incident points/i);
  assert.match(messages['zh-CN']['map.noPointIncidents'], /事件点/);
  assert.doesNotMatch(messages.en['map.noPointIncidents'], /^No incidents\b/i);
  for (const key of ['app.connecting', 'crime.coverageReady', 'crime.coverageConnecting', 'crime.exportNotReady']) {
    assert.doesNotMatch(messages.en[key], /\blive\b/i, `${key} must not imply real-time Crime data`);
    assert.doesNotMatch(messages['zh-CN'][key], /实时/, `${key} must not imply real-time Crime data`);
  }
});

test('Evidence Bundle download is feature-flagged, bilingual, and does not replace legacy exports', async () => {
  const [html, panelSource] = await Promise.all([
    readFile(new URL('../../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../../src/ui/panel.js', import.meta.url), 'utf8'),
  ]);
  const { messages } = await import('../../src/i18n/index.js');

  assert.match(html, /id="exportJsonBtn"/);
  assert.match(html, /id="exportCsvBtn"/);
  assert.doesNotMatch(html, /exportEvidenceBundleBtn/, 'flagged experiment button is created only at runtime');
  assert.match(panelSource, /isEvidenceBundleEnabled/);
  assert.match(panelSource, /exportEvidenceBundleBtn/);
  assert.match(panelSource, /composeCrimeEvidenceBundleV2/);
  assert.match(panelSource, /import\(['"]\.\.\/analysis\/evidence_bundle_product\.js['"]\)/);
  assert.doesNotMatch(panelSource, /composeEvidenceBundle\s*[,}]/, 'the product writer must not keep writing v1');
  assert.doesNotMatch(panelSource, /from ['"]\.\.\/analysis\/evidence_bundle_product\.js['"]/, 'flag-off entry must not eagerly load the v2 product composer');
  assert.doesNotMatch(
    panelSource,
    /buildEvidenceBundleSections,[\s\S]{0,200}from ['"]\.\.\/utils\/export_analysis\.js['"]/,
    'flag-off entry must not eagerly load the experiment bridge',
  );
  assert.match(panelSource, /engagement-evidence-bundle\.json/);
  assert.match(
    panelSource,
    /exportEvidenceBundleBtn\.style\.gridColumn\s*=\s*['"]1\s*\/\s*-1['"]/,
    'the flagged fourth action must span the full second grid row',
  );
  assert.equal(messages.en['crime.exportEvidenceBundle'], 'Evidence bundle');
  assert.equal(messages['zh-CN']['crime.exportEvidenceBundle'], '证据包');
  for (const copy of [messages.en['crime.exportEvidenceBundle'], messages['zh-CN']['crime.exportEvidenceBundle']]) {
    assert.doesNotMatch(copy, /verified safe|real[- ]?time|complete record|已验证安全|实时|完整记录/i);
  }
});

test('Crime workspace derives setup, results, and edit stages without mutating the selection', async () => {
  const { deriveCrimeWorkspacePresentation } = await import('../../src/ui/panel.js');

  assert.deepEqual(deriveCrimeWorkspacePresentation({
    queryMode: 'buffer',
    centerLonLat: null,
  }), {
    stage: 'setup',
    hasAnalysis: false,
    showContext: false,
    showSetup: true,
    showResults: false,
  });

  const selected = {
    queryMode: 'buffer',
    centerLonLat: [-75.16, 39.95],
    radius: 1600,
  };
  assert.deepEqual(deriveCrimeWorkspacePresentation(selected), {
    stage: 'results',
    hasAnalysis: true,
    showContext: true,
    showSetup: false,
    showResults: true,
  });
  assert.deepEqual(deriveCrimeWorkspacePresentation(selected, { editing: true }), {
    stage: 'edit',
    hasAnalysis: true,
    showContext: true,
    showSetup: true,
    showResults: false,
  });
  assert.deepEqual(selected.centerLonLat, [-75.16, 39.95]);
});

test('analysis context summarizes area and time using reported-incident language', async () => {
  const { createCrimeAnalysisContext } = await import('../../src/ui/panel.js');
  const context = createCrimeAnalysisContext({
    addressA: '1500 Market Street',
    queryMode: 'buffer',
    centerLonLat: [-75.16, 39.95],
    radius: 1600,
    durationMonths: 12,
    startMonth: '2025-01',
  });

  assert.deepEqual(context, {
    title: '1500 Market Street',
    area: '1,600 m radius',
    window: '2025-01 · 12 months',
    evidence: 'Reported incidents',
    meta: '1,600 m radius · 2025-01 · 12 months · Reported incidents',
  });
  assert.doesNotMatch(JSON.stringify(context), /\bsafe(?:ty)?\b|\bdanger(?:ous)?\b/i);

  const comparisonContext = createCrimeAnalysisContext({
    addressA: '1500 Market Street',
    addressB: 'Broad Street Station',
    queryMode: 'buffer',
    centerLonLat: [-75.16, 39.95],
    centerBLonLat: [-75.163, 39.953],
    radius: 400,
    durationMonths: 6,
  });
  assert.equal(comparisonContext.title, '1500 Market Street');
  assert.match(comparisonContext.meta, /Compared with Broad Street Station/);
});

test('workspace presentation applies hidden, aria-hidden, and inert as one contract', async () => {
  const { applyCrimeWorkspacePresentation } = await import('../../src/ui/panel.js');
  const element = () => ({
    dataset: {},
    hidden: false,
    inert: false,
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
  });
  const panelRoot = element();
  const context = element();
  const setup = element();
  const overview = element();
  const drawer = element();

  applyCrimeWorkspacePresentation({
    panelRoot,
    context,
    setup,
    results: [overview, drawer],
    presentation: {
      stage: 'results',
      showContext: true,
      showSetup: false,
      showResults: true,
    },
  });

  assert.equal(panelRoot.dataset.crimeStage, 'results');
  assert.deepEqual(
    [context, setup, overview, drawer].map((node) => ({
      hidden: node.hidden,
      inert: node.inert,
      ariaHidden: node.attributes.get('aria-hidden'),
    })),
    [
      { hidden: false, inert: false, ariaHidden: 'false' },
      { hidden: true, inert: true, ariaHidden: 'true' },
      { hidden: false, inert: false, ariaHidden: 'false' },
      { hidden: false, inert: false, ariaHidden: 'false' },
    ],
  );
});

test('result pane presentation keeps summary as default and exposes only one detail pane', async () => {
  const { deriveCrimeResultPanePresentation } = await import('../../src/ui/crime_workbench.js');

  assert.deepEqual(deriveCrimeResultPanePresentation(), {
    pane: 'summary',
    showSummary: true,
    showDrawer: false,
    showIncidents: false,
    showCharts: false,
  });
  assert.deepEqual(deriveCrimeResultPanePresentation('incidents'), {
    pane: 'incidents',
    showSummary: false,
    showDrawer: true,
    showIncidents: true,
    showCharts: false,
  });
  assert.deepEqual(deriveCrimeResultPanePresentation('charts'), {
    pane: 'charts',
    showSummary: false,
    showDrawer: true,
    showIncidents: false,
    showCharts: true,
  });
  assert.deepEqual(deriveCrimeResultPanePresentation('incidents', { incidentsAvailable: false }), {
    pane: 'summary',
    showSummary: true,
    showDrawer: false,
    showIncidents: false,
    showCharts: false,
  });
  assert.equal(deriveCrimeResultPanePresentation('unknown').pane, 'summary');
});

test('tract polygons remain visible and interactive when choropleth values are unavailable', async (t) => {
  const originalDocument = globalThis.document;
  const elements = new Map();
  globalThis.document = {
    getElementById(id) { return elements.get(id) || null; },
    createElement: () => ({
      id: '',
      className: '',
      hidden: true,
      textContent: '',
      setAttribute() {},
      removeAttribute() {},
    }),
    body: {
      appendChild(element) { elements.set(element.id, element); },
    },
  };
  t.after(() => { globalThis.document = originalDocument; });

  const sources = new Map();
  const layers = new Map();
  const map = {
    getSource: (id) => sources.get(id) || null,
    addSource(id, definition) {
      sources.set(id, {
        ...definition,
        setData(data) { this.data = data; },
      });
    },
    getLayer: (id) => layers.get(id) || null,
    addLayer(definition) { layers.set(definition.id, definition); },
    setPaintProperty(id, property, value) { layers.get(id).paint[property] = value; },
  };
  const geojson = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { GEOID: '42101000100', value: null },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-75.2, 39.9], [-75.1, 39.9], [-75.1, 40], [-75.2, 39.9]]],
      },
    }],
  };
  const { renderTractsChoropleth } = await import('../../src/map/render_choropleth_tracts.js');

  renderTractsChoropleth(map, {
    geojson,
    values: [],
    dataStatus: 'unavailable',
    statusMessage: 'Snapshot unavailable',
  });

  assert.equal(sources.get('tracts-fill').data, geojson);
  assert.equal(layers.get('tracts-fill').paint['fill-opacity'], 0.12);
  assert.equal(layers.get('tracts-fill').paint['fill-outline-color'], '#64748b');
  assert.equal(elements.get('tracts-outline-banner').hidden, false);
});

test('clearing a buffer location removes dependent comparison state', async () => {
  const stateModule = await import('../../src/state/store.js');
  assert.equal(typeof stateModule.clearCrimeAnalysisSelection, 'function');
  const state = {
    queryMode: 'buffer',
    center3857: [1, 2],
    centerLonLat: [-75.16, 39.95],
    centerB3857: [3, 4],
    centerBLonLat: [-75.15, 39.96],
    addressA: 'Point A',
    addressB: 'Point B',
    selectedDistrictCode: '09',
    selectedTractGEOID: '42101000100',
    selectMode: 'point',
    selectTarget: 'B',
  };

  stateModule.clearCrimeAnalysisSelection(state);

  assert.deepEqual(state, {
    queryMode: 'buffer',
    center3857: null,
    centerLonLat: null,
    centerB3857: null,
    centerBLonLat: null,
    addressA: '',
    addressB: '',
    selectedDistrictCode: null,
    selectedTractGEOID: null,
    selectMode: 'idle',
    selectTarget: 'A',
  });
});

test('clearing a district or tract selection preserves the saved buffer location', async () => {
  const { clearCrimeAnalysisSelection } = await import('../../src/state/store.js');
  for (const [queryMode, selectedKey] of [
    ['district', 'selectedDistrictCode'],
    ['tract', 'selectedTractGEOID'],
  ]) {
    const state = {
      queryMode,
      center3857: [1, 2],
      centerLonLat: [-75.16, 39.95],
      centerB3857: [3, 4],
      centerBLonLat: [-75.15, 39.96],
      addressA: 'Point A',
      addressB: 'Point B',
      selectedDistrictCode: '09',
      selectedTractGEOID: '42101000100',
      selectMode: 'idle',
      selectTarget: 'A',
    };

    clearCrimeAnalysisSelection(state);

    assert.deepEqual(state.centerLonLat, [-75.16, 39.95]);
    assert.deepEqual(state.centerBLonLat, [-75.15, 39.96]);
    assert.equal(state.addressA, 'Point A');
    assert.equal(state.addressB, 'Point B');
    assert.equal(state[selectedKey], null);
  }
});

test('clear-selection visibility follows the active analysis selection', async () => {
  const panel = await import('../../src/ui/panel.js');
  assert.equal(typeof panel.shouldShowCrimeClearSelection, 'function');
  assert.equal(panel.shouldShowCrimeClearSelection({ queryMode: 'buffer', centerLonLat: null }), false);
  assert.equal(panel.shouldShowCrimeClearSelection({ queryMode: 'buffer', centerLonLat: [-75.16, 39.95] }), true);
  assert.equal(panel.shouldShowCrimeClearSelection({ queryMode: 'district', selectedDistrictCode: null }), false);
  assert.equal(panel.shouldShowCrimeClearSelection({ queryMode: 'district', selectedDistrictCode: '09' }), true);
  assert.equal(panel.shouldShowCrimeClearSelection({ queryMode: 'tract', selectedTractGEOID: '42101000100' }), true);
});

test('buffer overlay reconciliation removes stale A and B markers independently', async () => {
  const crime = await import('../../src/routes_crime/index.js');
  assert.equal(typeof crime.reconcileBufferOverlays, 'function');
  const removed = [];
  const cleared = [];
  const markerA = { remove: () => removed.push('A') };
  const markerB = { remove: () => removed.push('B') };

  const result = crime.reconcileBufferOverlays({
    map: {},
    queryMode: 'buffer',
    centerLonLat: null,
    centerBLonLat: null,
    radiusM: 800,
    markerA,
    markerB,
    clearA: () => cleared.push('A'),
    clearB: () => cleared.push('B'),
  });

  assert.deepEqual(result, { markerA: null, markerB: null });
  assert.deepEqual(removed, ['A', 'B']);
  assert.deepEqual(cleared, ['A', 'B']);
});

test('camera padding reserves the visible desktop panel and mobile sheet', async () => {
  const {
    bufferBounds,
    geometryBounds,
    readPanelAwarePadding,
    resolvePanelAwarePadding,
  } = await import('../../src/map/camera_fit.js');

  const mapRect = { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 };
  const desktop = resolvePanelAwarePadding({
    mapRect,
    obstructionRects: [
      { left: 0, top: 64, right: 360, bottom: 800, width: 360, height: 736 },
      { left: 0, top: 0, right: 1200, bottom: 64, width: 1200, height: 64 },
    ],
  });
  assert.ok(desktop.left > desktop.right);
  assert.ok(desktop.top > 24);

  const mobile = resolvePanelAwarePadding({
    mapRect: { left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844 },
    obstructionRects: [
      { left: 0, top: 354, right: 390, bottom: 844, width: 390, height: 490 },
    ],
  });
  assert.ok(mobile.bottom > mobile.top);

  const rects = new Map([
    ['.app-bar', { left: 0, top: 0, right: 1200, bottom: 64, width: 1200, height: 64 }],
    ['#sidepanel', { left: 0, top: 64, right: 360, bottom: 800, width: 360, height: 736 }],
    ['#results-drawer', null],
    ['.diary-insights-root', { left: 840, top: 80, right: 1200, bottom: 760, width: 360, height: 680 }],
  ]);
  const panelAware = readPanelAwarePadding({
    getContainer: () => ({ getBoundingClientRect: () => mapRect }),
  }, {
    documentRef: {
      querySelector: (selector) => {
        const rect = rects.get(selector);
        if (!rect) return null;
        return {
          hidden: false,
          getAttribute: () => null,
          getBoundingClientRect: () => rect,
        };
      },
    },
    windowRef: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
  });
  assert.ok(panelAware.left > 24);
  assert.ok(panelAware.right > 24);

  const pointBounds = bufferBounds([-75.16, 39.95], 400);
  assert.ok(pointBounds[0][0] < -75.16);
  assert.ok(pointBounds[1][0] > -75.16);
  assert.ok(pointBounds[0][1] < 39.95);
  assert.ok(pointBounds[1][1] > 39.95);

  assert.deepEqual(geometryBounds({
    type: 'Polygon',
    coordinates: [[[-75.2, 39.9], [-75.1, 39.9], [-75.1, 40], [-75.2, 40], [-75.2, 39.9]]],
  }), [[-75.2, 39.9], [-75.1, 40]]);
});

test('buffer point picking never opens the district detail popup', async (t) => {
  const originalMode = store.queryMode;
  const originalStartMonth = store.startMonth;
  const originalDurationMonths = store.durationMonths;
  store.queryMode = 'buffer';
  store.startMonth = '2026-01';
  store.durationMonths = 1;
  t.after(() => {
    store.queryMode = originalMode;
    store.startMonth = originalStartMonth;
    store.durationMonths = originalDurationMonths;
  });

  let handler;
  let fetchCalls = 0;
  let popupCalls = 0;
  const map = {
    on(event, layer, callback) {
      if (event === 'click' && layer === 'districts-fill') handler = callback;
    },
    off() {},
  };
  const cleanup = attachDistrictPopup(map, 'districts-fill', {
    fetchByDistrictImpl: async () => {
      fetchCalls += 1;
      return { rows: [] };
    },
    fetchTopTypesByDistrictImpl: async () => {
      fetchCalls += 1;
      return { rows: [] };
    },
    createPopup: () => {
      popupCalls += 1;
      return {
        setLngLat() { return this; },
        setHTML() { return this; },
        addTo() { return this; },
        remove() {},
      };
    },
  });

  assert.equal(typeof handler, 'function');
  await handler({
    features: [{ properties: { DIST_NUMC: '01', name: 'District 1' } }],
    lngLat: { lng: -75.16, lat: 39.95 },
  });
  cleanup();

  assert.equal(fetchCalls, 0);
  assert.equal(popupCalls, 0);
});

test('district popup localizes top offense labels without changing provider rows', async (t) => {
  const originalMode = store.queryMode;
  const originalStartMonth = store.startMonth;
  const originalDurationMonths = store.durationMonths;
  store.queryMode = 'district';
  store.startMonth = '2026-01';
  store.durationMonths = 1;
  const { setLanguage } = await import('../../src/i18n/index.js');
  setLanguage('zh-CN');
  t.after(() => {
    store.queryMode = originalMode;
    store.startMonth = originalStartMonth;
    store.durationMonths = originalDurationMonths;
    setLanguage('en');
  });

  let handler;
  let popupHtml = '';
  const providerRows = [{ text_general_code: 'Rape', n: 3 }];
  const map = {
    on(_event, _layer, callback) { handler = callback; },
    off() {},
  };
  const cleanup = attachDistrictPopup(map, 'districts-fill', {
    fetchByDistrictImpl: async () => ({ rows: [{ dc_dist: '01', n: 9 }] }),
    fetchTopTypesByDistrictImpl: async () => ({ rows: providerRows }),
    createPopup: () => ({
      setLngLat() { return this; },
      setHTML(html) { popupHtml = html; return this; },
      addTo() { return this; },
      remove() {},
    }),
  });

  await handler({
    features: [{ properties: { DIST_NUMC: '01', name: 'Central' } }],
    lngLat: { lng: -75.16, lat: 39.95 },
  });
  cleanup();

  assert.match(popupHtml, /强奸 \(3\)/);
  assert.doesNotMatch(popupHtml, /Rape/);
  assert.deepEqual(providerRows, [{ text_general_code: 'Rape', n: 3 }]);
});

test('map initialization installs navigation and reset-extent controls', async () => {
  const mapModule = await import('../../src/map/initMap.js');
  assert.equal(typeof mapModule.installDefaultMapControls, 'function');

  const added = [];
  const map = {
    addControl(control, position) {
      added.push({ control, position });
      control.onAdd?.(this);
    },
    easeToOptions: null,
    easeTo(options) {
      this.easeToOptions = options;
    },
  };
  class NavigationControl {
    constructor(options) {
      this.options = options;
    }
  }
  const created = [];
  const documentRef = {
    createElement(tag) {
      const listeners = new Map();
      const element = {
        tag,
        className: '',
        type: '',
        title: '',
        textContent: '',
        attributes: new Map(),
        addEventListener(type, callback) { listeners.set(type, callback); },
        removeEventListener(type) { listeners.delete(type); },
        setAttribute(name, value) { this.attributes.set(name, value); },
        click() { listeners.get('click')?.(); },
      };
      created.push(element);
      return element;
    },
  };

  const controls = mapModule.installDefaultMapControls(map, {
    maplibre: { NavigationControl },
    documentRef,
    initialView: { center: [-75.16, 39.95], zoom: 11 },
  });

  assert.equal(added.length, 2);
  assert.ok(added[0].control instanceof NavigationControl);
  assert.equal(added[0].position, 'top-right');
  assert.equal(added[1].position, 'top-right');
  assert.equal(created.at(-1).attributes.get('aria-label'), 'Reset map extent');

  created.at(-1).click();
  assert.deepEqual(map.easeToOptions, {
    center: [-75.16, 39.95],
    zoom: 11,
    bearing: 0,
    pitch: 0,
    duration: 350,
  });
  controls.remove();
});

test('completed Crime analysis renders a compact trustworthy summary before details', async () => {
  const { buildCrimeSummaryHtml } = await import('../../src/compare/card.js');
  assert.equal(typeof buildCrimeSummaryHtml, 'function');
  const html = buildCrimeSummaryHtml({
    a: {
      label: '1500 Market Street',
      total: 42,
      top3: [
        { text_general_code: 'Theft', n: 18 },
        { text_general_code: 'Burglary', n: 9 },
        { text_general_code: 'Robbery', n: 6 },
      ],
      delta30: 0.125,
    },
    b: null,
  }, {
    start: '2026-01-01',
    end: '2026-07-01',
    coverageDate: '2026-07-31',
  });

  assert.match(html, /Analysis summary/i);
  assert.match(html, /42 reported incidents/i);
  assert.match(html, /Most common[\s\S]*Theft/i);
  assert.match(html, /Average per 30 days[\s\S]*7\.0 incidents/i);
  assert.match(html, /Top categories in this selection[\s\S]*Theft[\s\S]*18 · 42\.9%[\s\S]*Burglary[\s\S]*9 · 21\.4%/i);
  assert.match(html, /Jan 1[\s\S]*Jun 30, 2026/i);
  assert.match(html, /Data through Jul 31, 2026/i);
  assert.match(html, /Historical data, not a live safety alert/i);
  assert.doesNotMatch(html, /Last 30 days|Recent 30-day change|-100\.0%/i);
  assert.doesNotMatch(html, /Compare A vs B/i);
  assert.doesNotMatch(html, /crime-comparison-details/i);
});

test('Crime summary and offense selector localize labels while preserving official option values', async (t) => {
  const { setLanguage } = await import('../../src/i18n/index.js');
  const { buildCrimeSummaryHtml } = await import('../../src/compare/card.js');
  const { localizeOffenseOptions } = await import('../../src/ui/panel.js');
  t.after(() => setLanguage('en'));
  setLanguage('zh-CN');

  const html = buildCrimeSummaryHtml({
    a: {
      label: '地图点 A',
      total: 12,
      top3: [{ text_general_code: 'Other Assaults', n: 7 }],
      delta30: null,
    },
    b: null,
  }, { start: '2026-01-01', end: '2026-02-01' });
  assert.match(html, /其他袭击/);
  assert.doesNotMatch(html, /Other Assaults/);

  const options = [
    { value: 'Rape', textContent: '', dataset: {} },
    { value: '', textContent: '正在加载', dataset: { i18n: 'crime.loadingCodes' } },
  ];
  localizeOffenseOptions({ options });
  assert.equal(options[0].value, 'Rape');
  assert.equal(options[0].textContent, '强奸');
  assert.equal(options[1].textContent, '正在加载');
});

test('analysis summary names the latest available date when coverage metadata is absent', async () => {
  const { buildCrimeSummaryHtml } = await import('../../src/compare/card.js');
  const html = buildCrimeSummaryHtml({
    a: { label: 'Point A', total: 1, top3: [], delta30: null },
    b: null,
  }, {
    start: '2026-01-01',
    end: '2026-02-01',
  });

  assert.match(html, /Data through latest available date/i);
  assert.doesNotMatch(html, /Data through null/i);
});

test('two-area summary offers one detailed comparison submenu from existing metrics', async () => {
  const { buildCrimeSummaryHtml } = await import('../../src/compare/card.js');
  const html = buildCrimeSummaryHtml({
    a: {
      label: '1500 Market Street',
      total: 42,
      per10k: 28,
      top3: [
        { text_general_code: 'Theft', n: 18 },
        { text_general_code: 'Burglary', n: 9 },
      ],
      delta30: 0.125,
    },
    b: {
      label: 'North Broad Street',
      total: 30,
      per10k: 20,
      top3: [
        { text_general_code: 'Assault', n: 12 },
        { text_general_code: 'Theft', n: 6 },
      ],
      delta30: -0.05,
    },
  }, {
    start: '2026-01-01',
    end: '2026-07-01',
  });

  assert.match(html, /<details[^>]*class="crime-comparison-details"/i);
  assert.match(html, /Detailed comparison/i);
  assert.match(html, /1500 Market Street recorded 12 more incidents than North Broad Street \(40\.0% higher\)/i);
  assert.match(html, /<table[^>]*class="crime-comparison-table"/i);
  assert.match(html, /Reported incidents[\s\S]*42[\s\S]*30/i);
  assert.match(html, /Per 10,000 people[\s\S]*28\.0[\s\S]*20\.0/i);
  assert.match(html, /Average per 30 days[\s\S]*7\.0[\s\S]*5\.0/i);
  assert.doesNotMatch(html, /Recent 30-day change|\+12\.5%|-5\.0%/i);
  assert.match(html, /Theft[\s\S]*18 · 42\.9%/i);
  assert.match(html, /Assault[\s\S]*12 · 40\.0%/i);
  assert.match(html, /descriptive historical comparison/i);
  assert.doesNotMatch(html, /\sstyle=/i, 'comparison details must keep P1 class-based styling');
});

test('detailed comparison keeps unavailable metrics truthful and handles a zero baseline', async () => {
  const { buildCrimeSummaryHtml } = await import('../../src/compare/card.js');
  const html = buildCrimeSummaryHtml({
    a: { label: 'Point A', total: 8, per10k: null, top3: [], delta30: null },
    b: { label: 'Point B', total: 0, per10k: null, top3: [], delta30: null },
  });

  assert.match(html, /Point A recorded 8 more incidents than Point B/i);
  assert.doesNotMatch(html, /Infinity|NaN/);
  assert.match(html, /Per 10,000 people[\s\S]*Not available[\s\S]*Not available/i);
  assert.match(html, /Average per 30 days[\s\S]*Not available[\s\S]*Not available/i);
  assert.match(html, /Selected time window/i);
  assert.equal((html.match(/Not available/g) || []).length, 5);
  assert.match(html, /No category data available/i);
});

test('comparison discloses the ACS denominator estimate, unavailable buffer MOE, and vintage without a rate interval claim', async () => {
  const { buildCrimeSummaryHtml } = await import('../../src/compare/card.js');
  const html = buildCrimeSummaryHtml({
    a: {
      label: 'Point A',
      total: 8,
      per10k: 40,
      top3: [],
      delta30: null,
      population: {
        estimate: 2_000,
        moe90: null,
        vintage: '2024',
        source: 'U.S. Census Bureau',
        retrievedAt: '2026-08-10T08:38:25.000Z',
        status: 'available',
        method: 'centroid-in-buffer-whole-tract-sum',
        moe90Status: 'unavailable',
      },
    },
    b: null,
  });

  assert.match(html, /Population estimate[\s\S]*2,000/i);
  assert.match(html, /ACS 90% MOE[\s\S]*Unavailable for circular buffer/i);
  assert.match(html, /ACS vintage[\s\S]*2024/i);
  assert.match(html, /centroids fall inside the circle/i);
  assert.match(html, /denominator uncertainty only/i);
  assert.match(html, /not a confidence interval for the crime rate/i);
  assert.doesNotMatch(html, /statistically significant|significance/i);
});

test('comparison disclosure state survives a rerendered details element', async () => {
  const { bindComparisonDisclosure } = await import('../../src/compare/card.js');
  assert.equal(typeof bindComparisonDisclosure, 'function');
  const state = { open: false };
  const createDetails = () => ({
    open: false,
    listeners: new Map(),
    addEventListener(name, listener) { this.listeners.set(name, listener); },
  });

  const first = createDetails();
  bindComparisonDisclosure(first, state);
  first.open = true;
  first.listeners.get('toggle')();
  assert.equal(state.open, true);

  const rerendered = createDetails();
  bindComparisonDisclosure(rerendered, state);
  assert.equal(rerendered.open, true);
});

test('comparison disclosure state belongs to one default compare view', async () => {
  const source = await readFile(new URL('../../src/compare/card.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^const comparisonDisclosureState\s*=/m);
  assert.match(
    source,
    /function createDefaultCompareView\([^)]*\)\s*\{[\s\S]*?const comparisonDisclosureState\s*=\s*\{\s*open:\s*false\s*\}/,
  );
});

test('detailed comparison disclosure meets touch and reduced-motion contracts', async () => {
  const css = await readProductCss();
  assert.match(
    css,
    /\.crime-comparison-details\s*>\s*summary\s*\{[^}]*min-height:\s*var\(--control-target\)/s,
  );
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.crime-comparison-category__track\s*\{[^}]*transition:\s*none/s,
  );
  assert.doesNotMatch(css, /\.crime-comparison-category__track[^}]*!important/s);
});

test('current analysis exposes one canonical selected state immediately', async () => {
  const { setCurrentAnalysisSelection } = await import('../../src/compare/card.js');
  assert.equal(typeof setCurrentAnalysisSelection, 'function');
  const attributes = new Map();
  const element = {
    dataset: {},
    classList: {
      values: new Set(),
      toggle(name, enabled) {
        if (enabled) this.values.add(name);
        else this.values.delete(name);
      },
    },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
  };

  setCurrentAnalysisSelection(element, 'district:01');
  assert.equal(attributes.get('aria-current'), 'true');
  assert.equal(element.dataset.selectionKey, 'district:01');
  assert.equal(element.classList.values.has('is-current-analysis'), true);

  setCurrentAnalysisSelection(element, null);
  assert.equal(attributes.has('aria-current'), false);
  assert.equal('selectionKey' in element.dataset, false);
  assert.equal(element.classList.values.has('is-current-analysis'), false);
});

test('comparison controls stay hidden until the user asks for another area', async () => {
  const { setComparisonFieldsVisible } = await import('../../src/ui/panel.js');
  assert.equal(typeof setComparisonFieldsVisible, 'function');
  const attributes = new Map();
  const button = {
    textContent: '',
    setAttribute(name, value) { attributes.set(name, value); },
  };
  const fields = {
    hidden: true,
    setAttribute(name, value) { attributes.set(`fields:${name}`, value); },
    removeAttribute(name) { attributes.delete(`fields:${name}`); },
  };

  setComparisonFieldsVisible({ button, fields }, true);
  assert.equal(fields.hidden, false);
  assert.equal(button.textContent, 'Remove comparison');
  assert.equal(attributes.get('aria-expanded'), 'true');
  assert.equal(attributes.has('fields:aria-hidden'), false);

  setComparisonFieldsVisible({ button, fields }, false);
  assert.equal(fields.hidden, true);
  assert.equal(button.textContent, 'Compare another area');
  assert.equal(attributes.get('aria-expanded'), 'false');
  assert.equal(attributes.has('fields:aria-hidden'), false);
});

test('drilldown menu rows follow the available options up to a compact ceiling', async () => {
  const { fitMultiSelectRows } = await import('../../src/ui/panel.js');
  const select = { size: 6, options: { length: 0 } };

  assert.equal(fitMultiSelectRows(select), 1);
  assert.equal(select.size, 1);

  select.options.length = 3;
  assert.equal(fitMultiSelectRows(select), 3);
  assert.equal(select.size, 3);

  select.options.length = 11;
  assert.equal(fitMultiSelectRows(select), 6);
  assert.equal(select.size, 6);
});

test('specific offense selector keeps at most three choices and explains native modifier selection', async () => {
  const { syncOffenseHighlightOptions } = await import('../../src/utils/types.js');
  assert.equal(typeof syncOffenseHighlightOptions, 'function');
  const options = ['A', 'B', 'C', 'D'].map((value) => ({
    value,
    selected: false,
    disabled: false,
  }));
  const select = { options };

  assert.deepEqual(syncOffenseHighlightOptions(select, ['A', 'B', 'C', 'D']), ['A', 'B', 'C']);
  assert.deepEqual(options.map(({ selected }) => selected), [true, true, true, false]);
  assert.deepEqual(options.map(({ disabled }) => disabled), [false, false, false, true]);

  assert.deepEqual(syncOffenseHighlightOptions(select, ['B']), ['B']);
  assert.deepEqual(options.map(({ selected }) => selected), [false, true, false, false]);
  assert.deepEqual(options.map(({ disabled }) => disabled), [false, false, false, false]);

  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /<select[^>]+id="fineSel"[^>]+aria-describedby="fineSelHint"/);
  assert.match(html, /id="fineSelHint"[^>]+role="status"[^>]+aria-live="polite"/);

  const messagesSource = await readFile(new URL('../../src/i18n/messages.js', import.meta.url), 'utf8');
  assert.match(messagesSource, /Shift selects a range/);
  assert.match(messagesSource, /Ctrl\/Cmd-click toggles one/);
  assert.match(messagesSource, /Shift 连选范围/);
  assert.match(messagesSource, /Ctrl \/ Cmd 点击切换单项/);
});

test('only the latest offense-option request may update the selector', async () => {
  const panelSource = await readFile(new URL('../../src/ui/panel.js', import.meta.url), 'utf8');
  assert.match(panelSource, /drilldownRequestGeneration/);
  assert.match(panelSource, /requestGeneration !== drilldownRequestGeneration/);
  const emptyBranchStart = panelSource.indexOf('if (renderedCodes.length === 0)');
  const emptyBranchEnd = panelSource.indexOf('} else {', emptyBranchStart);
  assert.ok(emptyBranchStart >= 0 && emptyBranchEnd > emptyBranchStart);
  assert.match(panelSource.slice(emptyBranchStart, emptyBranchEnd), /syncOffenseHighlights\(\[\]\)/);
  const noGroupsStart = panelSource.indexOf('if (values.length === 0)');
  const noGroupsEnd = panelSource.indexOf('} else {', noGroupsStart);
  assert.ok(noGroupsStart >= 0 && noGroupsEnd > noGroupsStart);
  assert.match(
    panelSource.slice(noGroupsStart, noGroupsEnd),
    /if \(!preserveSelection\) syncOffenseHighlights\(\[\]\)/,
  );
});

test('time-window analysis refresh starts before the offense-option request settles', async () => {
  const panelSource = await readFile(new URL('../../src/ui/panel.js', import.meta.url), 'utf8');
  const helperStart = panelSource.indexOf('const refreshTimeWindow = () =>');
  const helperEnd = panelSource.indexOf("groupSel?.addEventListener('change'", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = panelSource.slice(helperStart, helperEnd);
  assert.ok(helper.indexOf('onChange()') < helper.indexOf('refreshDrilldownForWindow()'));
});

test('every time-window control reloads offense options without duplicating the immediate result refresh', async () => {
  const panelSource = await readFile(new URL('../../src/ui/panel.js', import.meta.url), 'utf8');
  assert.match(
    panelSource,
    /refreshDrilldownForWindow\s*=\s*\(\)\s*=>[\s\S]*?preserveSelection:\s*true,[\s\S]*?notify:\s*false/,
  );
  const handlersStart = panelSource.indexOf("startMonth?.addEventListener('change'");
  const handlersEnd = panelSource.indexOf("shareViewBtn?.addEventListener('click'", handlersStart);
  assert.ok(handlersStart >= 0 && handlersEnd > handlersStart);
  const handlers = panelSource.slice(handlersStart, handlersEnd);
  assert.equal((handlers.match(/refreshTimeWindow\(\)/g) || []).length, 2);
  const presetSyncStart = panelSource.indexOf('function syncPreset()');
  const presetSyncEnd = panelSource.indexOf('function syncFromStore()', presetSyncStart);
  assert.ok(presetSyncStart >= 0 && presetSyncEnd > presetSyncStart);
  const presetSync = panelSource.slice(presetSyncStart, presetSyncEnd);
  assert.match(presetSync, /syncControlsFromStore\(\)/);
  assert.match(presetSync, /onChange\.cancel\(\)/);
  assert.match(presetSync, /return refreshDrilldownForWindow\(\)/);
  assert.doesNotMatch(presetSync, /onChange\(\)/);
  assert.match(
    panelSource,
    /const renderedCodes = preserveSelection\s*\?\s*\[\.\.\.new Set\(\[\.\.\.availableCodes, \.\.\.requestedCodes\]\)\]\s*:\s*availableCodes/,
  );
});

test('failed time-window option refresh preserves the visible selectable offense state', async () => {
  const panelSource = await readFile(new URL('../../src/ui/panel.js', import.meta.url), 'utf8');
  assert.match(
    panelSource,
    /const renderStatus = \(key\) => \{\s*if \(preserveSelection\) return;/,
  );
  assert.match(panelSource, /renderStatus\('crime\.loadingCodes'\)/);
  assert.match(
    panelSource,
    /catch \(err\) \{[\s\S]*?renderStatus\('crime\.codeLoadError'\)/,
  );
});

test('initial offense hydration does not duplicate a valid initial Crime refresh', async () => {
  const panelSource = await readFile(new URL('../../src/ui/panel.js', import.meta.url), 'utf8');
  const initStart = panelSource.indexOf('// Init-time populate');
  const initEnd = panelSource.indexOf("startMonth?.addEventListener('change'", initStart);
  assert.ok(initStart >= 0 && initEnd > initStart);
  assert.match(panelSource.slice(initStart, initEnd), /notify:\s*false/);
  assert.match(
    panelSource,
    /if \(notify\) onChange\(\)/,
  );
});

test('categorical Crime legend pairs every highlight color with a text label', async (t) => {
  const originalDocument = globalThis.document;
  const elements = new Map();
  const makeElement = (tagName) => ({
    tagName,
    className: '',
    hidden: false,
    textContent: '',
    style: {},
    dataset: {},
    attributes: new Map(),
    children: [],
    setAttribute(name, value) { this.attributes.set(name, value); },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    querySelectorAll(selector) {
      if (selector !== '[data-offense-code]') return [];
      const matches = [];
      const visit = (element) => {
        if (element?.dataset?.offenseCode) matches.push(element);
        for (const child of element?.children || []) visit(child);
      };
      for (const child of this.children) visit(child);
      return matches;
    },
  });
  globalThis.document = {
    getElementById(id) { return elements.get(id) || null; },
    createElement: makeElement,
    body: {
      appendChild(element) { elements.set(element.id, element); },
    },
  };
  t.after(() => { globalThis.document = originalDocument; });

  const { setLanguage } = await import('../../src/i18n/index.js');
  t.after(() => setLanguage('en'));
  setLanguage('zh-CN');
  const legend = await import('../../src/map/legend.js');
  legend.initLegend('highlight-legend-test');
  legend.updateLegend({
    title: 'map.offenseLegendTitle',
    subtitle: 'map.offenseLegendSubtitle',
    items: [
      { color: '#045a8d', code: 'Aggravated Assault Firearm' },
      { color: '#74a9cf', code: 'Aggravated Assault No Firearm' },
    ],
  });

  const root = elements.get('highlight-legend-test');
  assert.equal(root.hidden, false);
  assert.equal(root.children[0].attributes.get('data-i18n'), 'map.offenseLegendTitle');
  assert.equal(root.children[1].attributes.get('data-i18n'), 'map.offenseLegendSubtitle');
  assert.equal(root.children.filter(({ className }) => className === 'map-legend__row').length, 2);
  assert.deepEqual(
    root.children
      .filter(({ className }) => className === 'map-legend__row')
      .map((row) => row.children[1].textContent),
    ['持枪严重袭击', '非持枪严重袭击'],
  );

  setLanguage('en');
  assert.deepEqual(
    root.children
      .filter(({ className }) => className === 'map-legend__row')
      .map((row) => row.children[1].textContent),
    ['Aggravated assault with firearm', 'Aggravated assault without firearm'],
  );
});

test('buffer highlight legend is restored after background choropleth jobs settle', async () => {
  const source = await readFile(new URL('../../src/routes_crime/index.js', import.meta.url), 'utf8');
  const settled = source.indexOf('await Promise.allSettled');
  const outcome = source.indexOf('const outcome = classifyCrimeRefreshJobs', settled);
  assert.ok(settled >= 0 && outcome > settled);
  assert.match(source.slice(settled, outcome), /if \(incidentView\) reconcileCrimeLegend\(snapshot\)/);
});

test('the default Crime basemap is visually muted behind analytical overlays', async () => {
  const { resolveMapStyle } = await import('../../src/config.js');
  const style = resolveMapStyle('crime');
  assert.equal(typeof style, 'object');
  const raster = style.layers.find((layer) => layer.id === 'osm-tiles');
  assert.ok(raster);
  assert.ok(raster.paint);
  assert.ok(raster.paint['raster-saturation'] <= -0.4);
  assert.ok(raster.paint['raster-contrast'] <= 0);
});

test('Crime map notices sit below the global app bar', async () => {
  const [pointsSource, css] = await Promise.all([
    readFile(new URL('../../src/map/points.js', import.meta.url), 'utf8'),
    readProductCss(),
  ]);
  assert.doesNotMatch(pointsSource, /position:\s*'fixed',\s*top:\s*'12px'/);
  assert.match(css, /#banner\s*\{[^}]*bottom:\s*52px[^}]*left:\s*384px/s);
  assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*#banner\s*\{[^}]*top:\s*calc\(var\(--app-bar-height\)\s*\+\s*12px\)/s);
});

test('map-selected Crime areas synchronize controls and the canonical URL', async () => {
  const source = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
  const callback = source.match(/onSelectionChange:[\s\S]*?onDataScopeChange:/)?.[0] || '';
  assert.match(callback, /origin !== ['"]map['"]/);
  assert.match(callback, /panel\.syncFromStore\?\.\(\)/);
  assert.doesNotMatch(callback, /writeCrimeStateToURL\(store\)/);
});

test('Crime list presentation exposes semantic controls, result table, status, and limitations', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('../../index.html', import.meta.url), 'utf8'),
    readProductCss(),
  ]);
  assert.match(html, /<fieldset[^>]*data-crime-view-mode[^>]*>/);
  assert.match(html, /<input[^>]*type="radio"[^>]*name="crime-view-mode"[^>]*value="map"/);
  assert.match(html, /<input[^>]*type="radio"[^>]*name="crime-view-mode"[^>]*value="list"/);
  assert.match(html, /data-map-runtime-status[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /<section[^>]*data-crime-list-results[^>]*aria-labelledby="crime-list-results-title"/);
  assert.match(html, /<table[^>]*data-crime-list-table[^>]*>/);
  assert.match(html, /<caption[^>]*data-crime-list-caption/);
  for (const scope of ['col', 'row']) assert.match(html, new RegExp(`<th[^>]*scope="${scope}"`));
  assert.match(html, /data-crime-list-status[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /data-crime-list-description[^>]*data-i18n="crime\.list\.description"/);
  assert.match(html, /data-crime-list-limitations/);
  assert.match(css, /html\[data-crime-view="list"\][^}]*overflow-y:\s*auto/s);
  assert.match(css, /body\[data-crime-view="list"\][^}]*height:\s*auto[^}]*overflow-y:\s*visible/s);
  assert.match(css, /body\[data-crime-view="list"\][^}]*\[data-incident-results-status\][^}]*display:\s*none/s);
});

test('Crime list refresh focuses the visible result surface for the selected result tab', async () => {
  const { resolveCrimeListFocusTarget } = await import('../../src/ui/crime_list_results.js');
  const heading = { id: 'crime-list-results-title' };
  const summary = { id: 'compare-card' };
  const summaryPane = { querySelector: (selector) => selector === '#compare-card' ? summary : null };
  const incidentPane = { hidden: true, inert: true };
  const root = { closest: () => incidentPane };
  const documentRef = {
    getElementById: () => heading,
    querySelector: () => summaryPane,
  };

  assert.equal(resolveCrimeListFocusTarget({ root, documentRef }), summary);
  incidentPane.hidden = false;
  incidentPane.inert = false;
  assert.equal(resolveCrimeListFocusTarget({ root, documentRef }), heading);
});

test('list-first entry has no static MapLibre or initMap import', async () => {
  const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /^import\s+['"]maplibre-gl\/dist\/maplibre-gl\.css['"];?$/m);
  assert.doesNotMatch(main, /await import\(['"]\.\/map\/initMap\.js['"]\)/);
  assert.match(main, /createOptionalMapRuntime/);
});
