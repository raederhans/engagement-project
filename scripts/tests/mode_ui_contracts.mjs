import assert from 'node:assert/strict';
import test from 'node:test';

import { createModeCoordinator } from '../../src/mode_coordinator.js';
import * as about from '../../src/ui/about.js';
import { writeCrimeStateToURL } from '../../src/ui/panel.js';
import { readFile } from 'node:fs/promises';
import { readProductCss } from './helpers/css_source.mjs';

const aboutSource = await readFile(new URL('../../src/ui/about.js', import.meta.url), 'utf8');
const productCss = await readProductCss();

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function coordinatorOptions({
  initialMode = 'crime',
  diaryGate = null,
  crimeRefreshStatus = 'live',
} = {}) {
  let currentMode = initialMode;
  const crimeController = {
    setActive() {},
    async requestRefresh() { return { status: crimeRefreshStatus }; },
  };
  return {
    setCurrentMode(mode) { currentMode = mode; },
    options: {
      map: { isStyleLoaded: () => true },
      diaryFeatureEnabled: true,
      getCurrentMode: () => currentMode,
      writeMode() {},
      chartsPane: { style: {} },
      diaryMount: { replaceChildren() {} },
      loadCrimeController: async () => crimeController,
      loadDiaryModule: async () => ({
        async initDiaryMode() {
          await diaryGate?.promise;
          return { status: 'ready' };
        },
        teardownDiaryMode() {},
      }),
      getDiaryInsights: async () => ({
        show() {},
        hide() {},
        setCollapsed() {},
      }),
    },
  };
}

test('mode intent publishes synchronously before lazy work and exposes a short status snapshot', async () => {
  const intentEvents = [];
  const harness = coordinatorOptions({ initialMode: 'crime' });
  const coordinator = createModeCoordinator({
    ...harness.options,
    onModeIntent: (mode) => intentEvents.push(mode),
  });

  const transition = coordinator.schedule('crime');

  assert.deepEqual(intentEvents, ['crime']);
  assert.deepEqual(coordinator.getShortStatus(), {
    mode: 'crime',
    phase: 'loading',
    label: 'Crime loading',
  });
  await transition;
  assert.deepEqual(coordinator.getShortStatus(), {
    mode: 'crime',
    phase: 'ready',
    label: 'Crime data ready',
  });
});

test('expanded Diary insights can refit only the active Diary selection', async () => {
  let fits = 0;
  const harness = coordinatorOptions({ initialMode: 'diary' });
  harness.options.loadDiaryModule = async () => ({
    async initDiaryMode() { return { status: 'ready' }; },
    teardownDiaryMode() {},
    fitCurrentDiarySelection() { fits += 1; return true; },
  });
  const coordinator = createModeCoordinator(harness.options);

  await coordinator.schedule('diary');
  assert.equal(coordinator.fitCurrentDiarySelection(), true);
  assert.equal(fits, 1);

  harness.setCurrentMode('crime');
  await coordinator.schedule('crime');
  assert.equal(coordinator.fitCurrentDiarySelection(), false);
  assert.equal(fits, 1);

  const mainSource = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
  assert.match(mainSource, /\(expanded\)\s*=>\s*\{[\s\S]*?if\s*\(!expanded\)\s*return;[\s\S]*?coordinator\?\.fitCurrentDiarySelection\(\);/);
  assert.match(mainSource, /if\s*\(!compactLayout\)\s*return;[\s\S]*?setSheetState\(sheet, ['"]full['"]\)/);
});

test('semantic data scope distinguishes live, fallback, local, and sample content', async () => {
  const {
    describeCrimeDataScope,
    describeDiaryDataScope,
  } = await import('../../src/ui/data_scope.js');

  assert.deepEqual(describeCrimeDataScope({
    coverageMax: '2026-07-30',
    sources: [
      { dataset: 'incidents', kind: 'live', source: 'CARTO' },
      { dataset: 'districts', kind: 'live', source: 'Philadelphia Police GIS' },
    ],
  }), {
    mode: 'crime',
    kind: 'live',
    shortLabel: 'Live · Jul 30',
    accessibleLabel: 'Live Philadelphia crime data through Jul 30, 2026.',
    details: [
      'Incidents: live CARTO · through Jul 30, 2026',
      'Districts: live Philadelphia Police GIS',
    ],
  });

  const fallback = describeCrimeDataScope({
    coverageMax: '2026-07-30',
    sources: [
      { dataset: 'incidents', kind: 'live', source: 'CARTO' },
      { dataset: 'tracts', kind: 'fallback', source: 'Bundled tract snapshot' },
    ],
  });
  assert.equal(fallback.kind, 'fallback');
  assert.equal(fallback.shortLabel, 'Fallback · Jul 30');
  assert.doesNotMatch(fallback.accessibleLabel, /all data (?:is|are) live/i);
  assert.match(fallback.details.join(' '), /Bundled tract snapshot/);

  assert.deepEqual(describeDiaryDataScope('history'), {
    mode: 'diary',
    kind: 'local',
    shortLabel: 'Local',
    accessibleLabel: 'My Routes ratings are saved only on this device.',
    details: ['Saved on this device · not shared online'],
  });
  assert.deepEqual(describeDiaryDataScope('community'), {
    mode: 'diary',
    kind: 'sample',
    shortLabel: 'Sample',
    accessibleLabel: 'Sample Community is illustrative, read-only sample data.',
    details: ['Illustrative sample · read-only · not shared'],
  });
});

test('ready scope details are cleared or replaced when status returns to loading or failed', async () => {
  const { createModeSurfacePresenter } = await import('../../src/ui/mode_surfaces.js');
  const attributes = new Map();
  const status = {
    dataset: {},
    textContent: '',
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
  };
  const details = { dataset: {}, textContent: '' };
  const documentRef = {
    querySelector(selector) {
      if (selector === '[data-app-data-status]') return status;
      if (selector === '[data-app-source-details]') return details;
      return null;
    },
    querySelectorAll() { return []; },
    getElementById() { return null; },
  };
  const presenter = createModeSurfacePresenter({ documentRef });
  const scope = {
    mode: 'crime',
    kind: 'fallback',
    shortLabel: 'Fallback · Jul 30',
    accessibleLabel: 'Some sources use a published fallback.',
    details: ['Tracts: fallback Bundled tract snapshot'],
  };

  presenter.showIntent('crime');
  presenter.showDataScope(scope);
  presenter.showStatus({ mode: 'crime', phase: 'loading', label: 'Crime loading' });
  assert.equal(status.textContent, 'Crime loading');
  assert.equal(status.dataset.scopeKind, undefined);

  presenter.showStatus({ mode: 'crime', phase: 'ready', label: 'Crime data ready' });
  assert.equal(status.textContent, 'Fallback · Jul 30');
  assert.equal(status.dataset.scopeKind, 'fallback');
  assert.equal(attributes.get('aria-label'), scope.accessibleLabel);
  assert.equal(details.textContent, scope.details[0]);

  presenter.showStatus({ mode: 'crime', phase: 'loading', label: 'Crime loading' });
  assert.equal(status.textContent, 'Crime loading');
  assert.equal(status.dataset.scopeKind, undefined);
  assert.equal(details.dataset.scopeKind, undefined);
  assert.equal(details.textContent, '');

  presenter.showStatus({ mode: 'crime', phase: 'failed', label: 'Crime data unavailable' });
  assert.equal(status.textContent, 'Crime data unavailable');
  assert.equal(status.dataset.scopeKind, undefined);
  assert.equal(details.dataset.scopeKind, undefined);
  assert.equal(details.textContent, 'Crime data unavailable');
});

test('stale async mode work cannot replace the final mode status or surface', async () => {
  const diaryGate = deferred();
  const surfaceEvents = [];
  const harness = coordinatorOptions({ initialMode: 'diary', diaryGate });
  const coordinator = createModeCoordinator({
    ...harness.options,
    onModeIntent: (mode) => surfaceEvents.push(['intent', mode]),
    onModeSettled: (mode, phase) => surfaceEvents.push(['settled', mode, phase]),
  });

  const diary = coordinator.schedule('diary');
  await new Promise((resolve) => setImmediate(resolve));
  harness.setCurrentMode('crime');
  const crime = coordinator.schedule('crime');
  await crime;
  diaryGate.resolve();
  await diary;

  assert.deepEqual(coordinator.getShortStatus(), {
    mode: 'crime',
    phase: 'ready',
    label: 'Crime data ready',
  });
  assert.deepEqual(surfaceEvents.at(-1), ['settled', 'crime', 'ready']);
});

test('a superseded Crime refresh cannot publish a false ready state', async () => {
  const settled = [];
  const harness = coordinatorOptions({ crimeRefreshStatus: 'superseded' });
  const coordinator = createModeCoordinator({
    ...harness.options,
    onModeSettled: (...event) => settled.push(event),
  });

  const result = await coordinator.schedule('crime');

  assert.deepEqual(result, { status: 'superseded' });
  assert.deepEqual(coordinator.getShortStatus(), {
    mode: 'crime',
    phase: 'loading',
    label: 'Crime loading',
  });
  assert.deepEqual(settled, []);
});

test('Diary URLs remove Crime-only keys and Crime restores its canonical state', async () => {
  const surfaces = await import('../../src/ui/mode_surfaces.js').catch(() => ({}));
  assert.equal(typeof surfaces.createModeUrlWriter, 'function');

  let href = 'https://example.test/app?mode=crime&analysis=tract&tract=42101000100&foo=keep#map';
  const writer = surfaces.createModeUrlWriter({
    getHref: () => href,
    replaceHref: (nextHref) => { href = nextHref; },
    getCrimeQuery: () => 'analysis=tract&months=12&tract=42101000100',
  });

  writer('diary');
  let current = new URL(href);
  assert.equal(current.searchParams.get('mode'), 'diary');
  assert.equal(current.searchParams.get('analysis'), null);
  assert.equal(current.searchParams.get('tract'), null);
  assert.equal(current.searchParams.get('foo'), 'keep');

  writer('crime');
  current = new URL(href);
  assert.equal(current.searchParams.get('mode'), 'crime');
  assert.equal(current.searchParams.get('analysis'), 'tract');
  assert.equal(current.searchParams.get('months'), '12');
  assert.equal(current.searchParams.get('tract'), '42101000100');
  assert.equal(current.searchParams.get('foo'), 'keep');
  assert.equal(current.hash, '#map');
});

test('late Crime synchronization cannot append Crime keys while Diary owns the URL', (t) => {
  const originalWindow = globalThis.window;
  let replacedUrl = null;
  t.after(() => { globalThis.window = originalWindow; });
  globalThis.window = {
    location: {
      search: '?mode=diary&foo=keep',
      pathname: '/app/',
      hash: '#map',
    },
    history: {
      replaceState(_state, _title, nextUrl) { replacedUrl = nextUrl; },
    },
  };

  writeCrimeStateToURL({
    viewMode: 'diary',
    queryMode: 'buffer',
    durationMonths: 12,
    radius: 400,
    classMethod: 'quantile',
    classBins: 5,
    classPalette: 'Blues',
    classOpacity: 0.75,
  });

  assert.equal(replacedUrl, null);
});

test('Help copy is mode-specific and explains Diary local persistence', () => {
  assert.equal(typeof about.getAboutContent, 'function');
  const crime = about.getAboutContent('crime');
  const diary = about.getAboutContent('diary');

  assert.match(crime, /crime incidents/i);
  assert.doesNotMatch(crime, /saved only in this browser/i);
  assert.match(diary, /saved only in this browser/i);
  assert.doesNotMatch(diary, /offense groups/i);
});

test('global Help control mounts inside the app bar when its slot exists', () => {
  assert.equal(typeof about.resolveAboutMount, 'function');
  const appBarSlot = { id: 'help-slot' };
  const body = { id: 'body' };
  assert.equal(about.resolveAboutMount({
    body,
    querySelector(selector) {
      return selector === '[data-app-help]' ? appBarSlot : null;
    },
  }), appBarSlot);
  assert.equal(about.resolveAboutMount({ body, querySelector() { return null; } }), body);
});

test('closed Help content is removed from layout and interaction', () => {
  assert.match(
    productCss,
    /\.about-panel\[aria-hidden=['"]true['"]\]\s*\{[^}]*display:\s*none\s*;/s,
  );
  assert.match(
    productCss,
    /\.about-panel\.about--open\s*\{[^}]*display:\s*block\s*;/s,
  );
  assert.doesNotMatch(aboutSource, /document\.createElement\(['"]style['"]\)|injectStyles/);
});
