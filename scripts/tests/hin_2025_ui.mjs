#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createHin2025Presentation } from '../../src/routes_crime/hin_2025_ui.js';

test('HIN presentation distinguishes admitted zero from unavailable and never invents matches', () => {
  const zero = createHin2025Presentation({
    status: 'no-associated-streets',
    matches: [],
    snapshot: { networkVintage: 2025 },
  });
  const unavailable = createHin2025Presentation({
    status: 'unavailable',
    matches: [{ streetName: 'MUST NOT RENDER' }],
  });
  assert.equal(zero.zeroClaim, true);
  assert.equal(zero.snapshot.networkVintage, 2025);
  assert.equal(unavailable.zeroClaim, false);
  assert.deepEqual(unavailable.matches, []);
  assert.equal(unavailable.snapshot, null);
});

test('HIN text surface names street context, period, separated timestamps, method, limitations, and official handoff', async () => {
  const source = await readFile(new URL('../../src/routes_crime/hin_2025_ui.js', import.meta.url), 'utf8');
  for (const marker of [
    'data-hin-status role="status" aria-live="polite"',
    'data-hin-evidence',
    'data-hin-streets',
    'hin.layerData',
    'hin.layerSchema',
    'hin.itemMetadata',
    'hin.officialItem',
    'hin.officialContext',
    'hin.license',
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(source, /2019–2023/);
  assert.match(source, /inclusive 20 m/i);
  assert.match(source, /does not mean the route belongs to the HIN/i);
  assert.match(source, /does not mean[\s\S]*crash occurred on the route/i);
  assert.match(source, /not a zero result/i);
  assert.doesNotMatch(source, /risk score|safety score|safer-route recommendation|GPS matched|official safety certification/i);
});

test('Known Route controller supports the same keyboard/file surface through an optional map port and keeps HIN nested-lazy', async () => {
  const [controller, appLoader, listCss] = await Promise.all([
    readFile(new URL('../../src/routes_crime/route_corridor_ui_controller.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_crime/route_corridor_app_loader.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/styles/crime-list-mode.css', import.meta.url), 'utf8'),
  ]);
  assert.match(appLoader, /createOptionalRouteMapPort\(getMap\)/);
  assert.match(appLoader, /isAvailable: \(\) => Boolean\(resolve\(\)\)/);
  assert.match(appLoader, /import\('\.\/hin_2025_ui\.js'\)/);
  assert.doesNotMatch(controller, /hin_2025_ui|requestKnownRouteHin2025Context/);
  assert.match(controller, /requires its mount, map port, and request port/);
  assert.match(controller, /draw\.hidden = map\.isAvailable\?\.\(\) === false/);
  assert.match(controller, /data-route-waypoint-list/);
  assert.match(controller, /data-route-file/);
  assert.doesNotMatch(listCss, /body\[data-crime-view="list"\][^{]*\[data-route-corridor-entry\]/);
});
