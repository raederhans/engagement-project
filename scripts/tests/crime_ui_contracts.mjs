#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { store } from '../../src/state/store.js';
import { attachDistrictPopup } from '../../src/map/ui_popup_district.js';

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
  assert.equal(crime.shouldShowCrimeLegend(bufferState), false);
  assert.equal(crime.shouldShowCrimeLegend(districtState), true);
  assert.equal(crime.shouldShowCrimeLegend(tractState), true);
});

test('incident layers stay hidden until a buffer analysis has an intentional location', async () => {
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
      top3: [{ text_general_code: 'Theft', n: 18 }],
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
  assert.match(html, /Jan 1[\s\S]*Jun 30, 2026/i);
  assert.match(html, /Data through Jul 31, 2026/i);
  assert.match(html, /Historical data, not a live safety alert/i);
  assert.doesNotMatch(html, /Compare A vs B/i);
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
    readFile(new URL('../../src/style.css', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(pointsSource, /position:\s*'fixed',\s*top:\s*'12px'/);
  assert.match(css, /#banner\s*\{[^}]*bottom:\s*52px[^}]*left:\s*384px/s);
  assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*#banner\s*\{[^}]*top:\s*calc\(var\(--app-bar-height\)\s*\+\s*12px\)/s);
});
