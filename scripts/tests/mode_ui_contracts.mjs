import assert from 'node:assert/strict';
import test from 'node:test';

import { createModeCoordinator } from '../../src/mode_coordinator.js';
import * as about from '../../src/ui/about.js';
import { writeCrimeStateToURL } from '../../src/ui/panel.js';
import { readFile } from 'node:fs/promises';

const aboutSource = await readFile(new URL('../../src/ui/about.js', import.meta.url), 'utf8');

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
    aboutSource,
    /\.about-panel\[aria-hidden=['"]true['"]\]\s*\{[^}]*display:\s*none\s*;/s,
  );
  assert.match(
    aboutSource,
    /\.about-panel\.about--open\s*\{[^}]*display:\s*block\s*;/s,
  );
});
