#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createRouteCorridorUiLoader } from '../../src/routes_crime/route_corridor_ui_loader.js';

function button() {
  const listeners = new Map();
  return {
    disabled: false,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    click() { listeners.get('click')?.({ currentTarget: this }); },
  };
}

test('route UI performs no import before explicit action and retries a rejected first import', async () => {
  const open = button();
  const retry = button();
  const status = { textContent: '', hidden: true };
  const mount = {
    dataset: {},
    querySelector(selector) {
      return new Map([
        ['[data-route-corridor-open]', open],
        ['[data-route-corridor-retry]', retry],
        ['[data-route-corridor-loader-status]', status],
      ]).get(selector) || null;
    },
  };
  let imports = 0;
  const loader = createRouteCorridorUiLoader({
    mount,
    warn: () => {},
    loadUi: async () => {
      imports += 1;
      if (imports === 1) throw new Error('chunk unavailable');
      return { initRouteCorridorUi: () => ({ open: () => { mount.dataset.opened = 'true'; } }) };
    },
  });
  loader.setActive(false);
  assert.equal(mount.hidden, true, 'route entry must leave the shared sheet outside Crime mode');
  loader.setActive(true);
  assert.equal(mount.hidden, false);

  assert.equal(imports, 0);
  open.click();
  await loader.whenIdle();
  assert.equal(imports, 1);
  assert.equal(mount.dataset.routeCorridorLoader, 'unavailable');
  assert.equal(retry.hidden, false);

  retry.click();
  await loader.whenIdle();
  assert.equal(imports, 2);
  assert.equal(mount.dataset.routeCorridorLoader, 'ready');
  assert.equal(mount.dataset.opened, 'true');
});

test('Crime exposes a secondary explicit entry and keeps the controller behind a dynamic import', async () => {
  const [html, crime, panel, packageJson, bundlePolicy] = await Promise.all([
    readFile(new URL('../../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_crime/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/ui/panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    readFile(new URL('./bundle_policy.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /data-route-corridor-entry/);
  assert.match(html, /data-route-corridor-open/);
  assert.match(html, /data-route-corridor-loader-status[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /data-route-corridor-retry[^>]*hidden/);
  assert.match(html, /data-route-corridor-host/);
  assert.match(crime, /createRouteCorridorUiLoader/);
  assert.match(crime, /import\('\.\/route_corridor_ui_controller\.js'\)/);
  assert.match(panel, /routeCorridorMount/);
  assert.match(packageJson, /test:route-corridor-ui/);
  assert.match(bundlePolicy, /route_corridor_ui_controller\.js/);
});
