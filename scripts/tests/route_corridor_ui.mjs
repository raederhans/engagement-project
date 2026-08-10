#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createRouteCorridorUiLoader } from '../../src/routes_crime/route_corridor_ui_loader.js';
import { createOptionalRouteMapPort } from '../../src/routes_crime/route_corridor_app_runtime.js';

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

test('route loader resolves the shell-level host without importing before the trigger', async () => {
  const open = button();
  open.setAttribute = (name, value) => { open[name] = value; };
  open.getAttribute = (name) => open[name] ?? null;
  const retry = button();
  const status = { textContent: '', hidden: true };
  const shellHost = { hidden: true, inert: true };
  const mount = {
    dataset: {},
    ownerDocument: {
      querySelector(selector) {
        return selector === '[data-route-corridor-host]' ? shellHost : null;
      },
    },
    querySelector(selector) {
      return new Map([
        ['[data-route-corridor-open]', open],
        ['[data-route-corridor-retry]', retry],
        ['[data-route-corridor-loader-status]', status],
      ]).get(selector) || null;
    },
  };
  let imports = 0;
  let receivedHost = null;
  createRouteCorridorUiLoader({
    mount,
    loadUi: async () => {
      imports += 1;
      return {
        initRouteCorridorUi(options) {
          receivedHost = options.host;
          return { open() {} };
        },
      };
    },
  });

  assert.equal(imports, 0);
  assert.equal(open.getAttribute('aria-expanded'), 'false');
  open.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(imports, 1);
  assert.equal(receivedHost, shellHost);
});

test('optional route map port stays inert in list mode and rebinds one click owner when a map appears', () => {
  const events = [];
  const fakeMap = (name) => ({
    on: (event) => events.push([name, 'on', event]),
    off: (event) => events.push([name, 'off', event]),
    getStyle: () => ({ name }),
  });
  let currentMap = null;
  const port = createOptionalRouteMapPort(() => currentMap);
  const click = () => {};
  port.on('click', click);
  assert.equal(port.isAvailable(), false);

  currentMap = fakeMap('first');
  assert.equal(port.isAvailable(), true);
  assert.deepEqual(port.getStyle(), { name: 'first' });
  currentMap = fakeMap('second');
  assert.deepEqual(port.getStyle(), { name: 'second' });
  port.off('click', click);
  assert.deepEqual(events, [
    ['first', 'on', 'click'],
    ['first', 'off', 'click'],
    ['second', 'on', 'click'],
    ['second', 'off', 'click'],
  ]);
});

test('Crime exposes a shared map/list entry and keeps the controller behind nested dynamic imports', async () => {
  const [html, main, crime, appLoader, appRuntime, panel, controller, styles, listStyles, packageJson, bundlePolicy] = await Promise.all([
    readFile(new URL('../../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_crime/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_crime/route_corridor_app_loader.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_crime/route_corridor_app_runtime.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/ui/panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_crime/route_corridor_ui_controller.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/styles/workbench-shell.css', import.meta.url), 'utf8'),
    readFile(new URL('../../src/styles/crime-list-mode.css', import.meta.url), 'utf8'),
    readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    readFile(new URL('./bundle_policy.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /data-route-corridor-entry/);
  assert.match(html, /data-route-corridor-open/);
  assert.match(html, /data-route-corridor-loader-status[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /data-route-corridor-retry[^>]*hidden/);
  assert.match(html, /data-route-corridor-open[^>]*aria-expanded="false"[^>]*aria-controls="route-corridor-shell"/);
  assert.match(html, /id="route-corridor-shell"[^>]*data-route-corridor-host[^>]*hidden[^>]*inert/);
  const scriptIndex = html.indexOf('<script type="module" src="/src/main.js"></script>');
  const sidepanelCloseIndex = html.lastIndexOf('</div>', scriptIndex);
  assert.ok(html.indexOf('data-route-corridor-host') > sidepanelCloseIndex, 'route surface host must live outside #sidepanel');
  const taskFocusEnd = html.indexOf('</section>', html.indexOf('data-task-focus'));
  assert.ok(html.indexOf('data-route-corridor-entry') > taskFocusEnd, 'Known Route entry must remain visible when list mode does not initialize Task Focus');
  assert.match(main, /import\('\.\/routes_crime\/route_corridor_app_loader\.js'\)/);
  assert.doesNotMatch(crime, /route_corridor/);
  assert.match(appLoader, /createRouteCorridorUiLoader/);
  assert.match(appLoader, /import\('\.\/route_corridor_app_runtime\.js'\)/);
  assert.doesNotMatch(appLoader, /route_corridor_crime_coordinator|route_corridor_ui_controller|hin_2025_ui/);
  assert.match(appRuntime, /import\('\.\/route_corridor_crime_coordinator\.js'\)/);
  assert.match(appRuntime, /import\('\.\/route_corridor_ui_controller\.js'\)/);
  assert.match(appRuntime, /import\('\.\/hin_2025_ui\.js'\)/);
  assert.match(panel, /routeCorridorMount/);
  assert.doesNotMatch(controller, /aria-modal=["']true/);
  assert.match(controller, /let active = false;/, 'a closed route drawer must not begin as a map-click owner');
  assert.match(controller, /const onMapClick = \(event\) => \{\s*if \(!active \|\| !drawing\) return;/);
  assert.match(controller, /draw\.hidden = map\.isAvailable\?\.\(\) === false/);
  assert.doesNotMatch(controller, /requires its mount, map, and request port/);
  assert.match(
    controller,
    /const hideSurface = \([^)]*\) => \{[\s\S]*?active = false;[\s\S]*?surface\.hidden = true;/,
    'Close and Escape must release hidden drawing ownership before hiding the drawer',
  );
  assert.match(controller, /open\(\) \{\s*active = true;/, 'reopening may resume the preserved drawing session');
  const hideSurfaceSource = controller.slice(
    controller.indexOf('const hideSurface'),
    controller.indexOf('const onClose'),
  );
  assert.doesNotMatch(hideSurfaceSource, /drawing = false|routeInput = null/, 'Close must pause rather than clear drawing or route data');
  assert.match(
    controller,
    /setActive\(next\) \{[\s\S]*?if \(!active\) \{\s*clearRouteInputs\(\);\s*hideSurface\(\);/,
    'mode switch, unlike Close, must still clear the route before hiding',
  );
  assert.match(controller, /keydown/);
  assert.match(controller, /Escape/);
  assert.match(controller, /focus\?\.\(\{ preventScroll: true \}\)/);
  assert.match(controller, /surface\.inert = true/);
  assert.match(controller, /data-route-instruction/);
  assert.match(controller, /data-route-waypoint-list/);
  assert.match(controller, /data-route-waypoint-add/);
  assert.match(controller, /data-route-waypoint-remove/);
  assert.match(controller, /data-route-waypoint-undo/);
  assert.match(controller, /data-route-waypoint-clear/);
  assert.match(controller, /lon\.type = 'number';[\s\S]*lon\.min = '-180';[\s\S]*lon\.max = '180';/);
  assert.match(controller, /lat\.type = 'number';[\s\S]*lat\.min = '-90';[\s\S]*lat\.max = '90';/);
  assert.match(controller, /createManualRouteInput\(coordinates\)/, 'waypoints and map drawing must share the existing route input model');
  assert.match(controller, /const clearRouteInputs = \(\) => \{[\s\S]*?file\.value = '';/, 'Clear must release the selected file as well as in-memory route geometry');
  assert.doesNotMatch(controller, /localStorage|sessionStorage|indexedDB|history\.pushState|history\.replaceState/);
  assert.doesNotMatch(controller, /createElement\('button'\)[\s\S]*item\.append\(button\)/, 'result rows must not be focusable without a selection behavior');
  assert.doesNotMatch(listStyles, /body\[data-crime-view="list"\][^{]*\[data-route-corridor-entry\]/);
  assert.match(styles, /\.route-corridor-shell[\s\S]*width:\s*clamp\(420px,[\s\S]*480px\)/);
  assert.match(styles, /max-width:\s*100vw/);
  assert.match(styles, /@media \(max-width: 720px\) and \(orientation: portrait\)[\s\S]*\.route-corridor-shell[\s\S]*inset:/);
  assert.match(styles, /\.route-corridor-shell__scroll[\s\S]*overflow-y:\s*auto/);
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*\.route-corridor-shell/);
  assert.match(packageJson, /test:route-corridor-ui/);
  assert.match(bundlePolicy, /route_corridor_ui_controller\.js/);
});
