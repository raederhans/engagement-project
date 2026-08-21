import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runBrowserSuite } from '../lib/browser_suite_lifecycle.mjs';

test('browser-suite lifecycle closes preview and removes harness when Chromium launch fails', async () => {
  const fixture = await lifecycleFixture();
  await assert.rejects(runBrowserSuite({
    prepare: fixture.prepare,
    createPreview: fixture.createPreview,
    launchBrowser: async () => { throw new Error('injected Chromium launch failure'); },
    cleanupArtifacts: fixture.cleanupArtifacts,
    run: async () => assert.fail('run must not execute'),
  }), /injected Chromium launch failure/);
  assert.deepEqual(fixture.calls, ['prepare', 'preview', 'server.close', 'artifacts.cleanup']);
  await assert.rejects(access(fixture.harnessPath));
});

test('browser-suite lifecycle rethrows an isolated primary failure unchanged after reverse cleanup', async () => {
  const fixture = await lifecycleFixture();
  const primary = new Error('primary body failure');
  await assert.rejects(runBrowserSuite({
    prepare: fixture.prepare,
    createPreview: fixture.createPreview,
    launchBrowser: fixture.launchBrowser,
    cleanupArtifacts: fixture.cleanupArtifacts,
    run: async () => { throw primary; },
  }), (error) => error === primary);
  assert.deepEqual(fixture.calls.slice(-5), ['page.close', 'context.close', 'browser.close', 'server.close', 'artifacts.cleanup']);
});

test('browser-suite lifecycle aggregates isolated cleanup failures after completing reverse cleanup', async () => {
  const fixture = await lifecycleFixture({ serverClose: true, cleanupArtifacts: true });
  await assert.rejects(runBrowserSuite({
    prepare: fixture.prepare,
    createPreview: fixture.createPreview,
    launchBrowser: fixture.launchBrowser,
    cleanupArtifacts: fixture.cleanupArtifacts,
    run: async () => 'success',
  }), (error) => error instanceof AggregateError
    && error.errors.length === 2
    && error.errors.every((item) => /injected cleanup/.test(item.message)));
  assert.equal(fixture.calls.at(-1), 'artifacts.cleanup');
});

test('browser-suite lifecycle aggregates primary and all cleanup failures without skipping cleanup', async () => {
  const fixture = await lifecycleFixture({ serverClose: true, cleanupArtifacts: true });
  const primary = new Error('primary body failure');
  await assert.rejects(runBrowserSuite({
    prepare: fixture.prepare,
    createPreview: fixture.createPreview,
    launchBrowser: fixture.launchBrowser,
    cleanupArtifacts: fixture.cleanupArtifacts,
    run: async () => { throw primary; },
  }), (error) => error instanceof AggregateError
    && error.primaryError === primary
    && error.cleanupErrors.length === 2
    && error.errors[0] === primary);
  assert.equal(fixture.calls.at(-1), 'artifacts.cleanup');
});

for (const primary of [undefined, null, false, 0, '']) {
  test(`browser-suite lifecycle preserves falsy primary rejection ${String(primary)}`, async () => {
    const fixture = await lifecycleFixture({ run: primary });
    try {
      await runBrowserSuite({
        prepare: fixture.prepare, createPreview: fixture.createPreview, launchBrowser: fixture.launchBrowser,
        cleanupArtifacts: fixture.cleanupArtifacts, run: fixture.run,
      });
      assert.fail('falsy primary rejection must not become a false-green success');
    } catch (error) {
      assert.equal(error, primary);
    }
    assert.deepEqual(fixture.calls.slice(-5), ['page.close', 'context.close', 'browser.close', 'server.close', 'artifacts.cleanup']);
  });
}

test('browser-suite lifecycle preserves a falsy primary alongside every cleanup failure', async () => {
  const fixture = await lifecycleFixture({ run: false, pageClose: true, contextClose: true, browserClose: true, serverClose: true, cleanupArtifacts: true });
  await assert.rejects(runBrowserSuite({
    prepare: fixture.prepare, createPreview: fixture.createPreview, launchBrowser: fixture.launchBrowser,
    cleanupArtifacts: fixture.cleanupArtifacts, run: fixture.run,
  }), (error) => error instanceof AggregateError
    && error.primaryError === false
    && error.cleanupErrors.length === 5
    && error.errors[0] === false
    && error.errors.length === 6);
  assert.deepEqual(fixture.calls.slice(-5), ['page.close', 'context.close', 'browser.close', 'server.close', 'artifacts.cleanup']);
});

for (const [stage, inject] of [
  ['prepare', { prepare: new Error('prepare primary') }],
  ['preview creation', { createPreview: new Error('preview primary') }],
  ['browser launch', { launchBrowser: new Error('browser primary') }],
  ['context creation', { newContext: new Error('context primary') }],
  ['body', { run: new Error('body primary') }],
]) {
  test(`browser-suite lifecycle records ${stage} primary while attempting every later cleanup`, async () => {
    const fixture = await lifecycleFixture({ ...inject, pageClose: true, contextClose: true, browserClose: true, serverClose: true, cleanupArtifacts: true });
    await assert.rejects(runBrowserSuite({
      prepare: fixture.prepare, createPreview: fixture.createPreview, launchBrowser: fixture.launchBrowser,
      cleanupArtifacts: fixture.cleanupArtifacts, run: fixture.run,
    }), (error) => error instanceof AggregateError
      && error.primaryError === inject[Object.keys(inject)[0]]
      && error.cleanupErrors.length >= 1);
    assert.equal(fixture.calls.at(-1), 'artifacts.cleanup');
  });
}

for (const [name, inject] of [
  ['context creation', { newContext: true }],
  ['route setup', { configureContext: true }],
  ['page creation', { newPage: true }],
  ['page setup', { configurePage: true }],
]) {
  test(`browser-suite lifecycle reverses every acquired resource when ${name} fails`, async () => {
    const fixture = await lifecycleFixture(inject);
    await assert.rejects(runBrowserSuite({
      prepare: fixture.prepare,
      createPreview: fixture.createPreview,
      launchBrowser: fixture.launchBrowser,
      configureContext: fixture.configureContext,
      configurePage: fixture.configurePage,
      cleanupArtifacts: fixture.cleanupArtifacts,
      run: async () => assert.fail('run must not execute'),
    }), /injected/);
    assert.ok(fixture.calls.includes('server.close'), `${name} closes preview`);
    assert.ok(fixture.calls.includes('browser.close'), `${name} closes browser`);
    assert.ok(fixture.calls.includes('artifacts.cleanup'), `${name} removes harness`);
    if (!inject.newContext) assert.ok(fixture.calls.includes('context.close'), `${name} closes context`);
    if (inject.configurePage) assert.ok(fixture.calls.includes('page.close'), `${name} closes page`);
    assert.equal(fixture.calls.at(-1), 'artifacts.cleanup');
    await assert.rejects(access(fixture.harnessPath));
  });
}

async function lifecycleFixture(inject = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-suite-lifecycle-'));
  const harnessPath = path.join(root, 'harness.html');
  const calls = [];
  const fail = (key) => {
    if (Object.hasOwn(inject, key)) throw inject[key] === true ? new Error(`injected cleanup ${key} failure`) : inject[key];
  };
  const page = { async close() { calls.push('page.close'); fail('pageClose'); } };
  const context = {
    async close() { calls.push('context.close'); fail('contextClose'); },
    async newPage() {
      calls.push('page.new');
      if (inject.newPage) throw new Error('injected page creation failure');
      return page;
    },
  };
  const browser = {
    async close() { calls.push('browser.close'); fail('browserClose'); },
    async newContext() {
      calls.push('context.new');
      if (inject.newContext) throw inject.newContext === true ? new Error('injected context creation failure') : inject.newContext;
      return context;
    },
  };
  return {
    calls,
    harnessPath,
    async prepare() {
      calls.push('prepare');
      if (Object.hasOwn(inject, 'prepare')) throw inject.prepare;
      await writeFile(harnessPath, '<!doctype html>');
    },
    async createPreview() {
      calls.push('preview');
      if (Object.hasOwn(inject, 'createPreview')) throw inject.createPreview;
      return {
        httpServer: {
          close(callback) {
            calls.push('server.close');
            callback(inject.serverClose ? new Error('injected cleanup server failure') : undefined);
          },
        },
      };
    },
    async launchBrowser() { calls.push('browser.launch'); if (Object.hasOwn(inject, 'launchBrowser')) throw inject.launchBrowser; return browser; },
    async configureContext() {
      calls.push('routes.install');
      if (inject.configureContext) throw new Error('injected route setup failure');
    },
    async configurePage() {
      calls.push('page.configure');
      if (inject.configurePage) throw new Error('injected page setup failure');
    },
    async cleanupArtifacts() {
      calls.push('artifacts.cleanup');
      await rm(root, { recursive: true, force: true });
      if (inject.cleanupArtifacts) throw new Error('injected cleanup artifact failure');
    },
    async run() {
      if (Object.hasOwn(inject, 'run')) throw inject.run;
      return 'success';
    },
  };
}
