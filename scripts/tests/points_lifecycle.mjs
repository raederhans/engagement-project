#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachClusterExpansion,
  refreshPoints,
} from '../../src/map/points.js';
import { wirePoints } from '../../src/map/wire_points.js';
import { createCrimeRefreshOwner } from '../../src/routes_crime/crime_refresh_owner.js';
import '../../src/i18n/crime_offense_catalog.js';
import {
  createIncidentResultsController,
  createIncidentResultsView,
  visibleIncidentFeatures,
} from '../../src/routes_crime/incident_results_controller.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createMap({ loaded = true } = {}) {
  const handlers = new Map();
  const mutations = [];
  return {
    handlers,
    mutations,
    loaded: () => loaded,
    isStyleLoaded: () => loaded,
    getBounds: () => ({
      getWest: () => -75.2,
      getSouth: () => 39.9,
      getEast: () => -75.1,
      getNorth: () => 40,
    }),
    getSource: () => null,
    getLayer: () => null,
    addSource: (...args) => mutations.push(['addSource', ...args]),
    addLayer: (...args) => mutations.push(['addLayer', ...args]),
    on(event, handler) { handlers.set(event, handler); },
    once(event, handler) { handlers.set(event, handler); },
    off(event, handler) {
      if (handlers.get(event) === handler) handlers.delete(event);
    },
  };
}

function createScheduler() {
  let nextId = 1;
  const timers = new Map();
  const cleared = [];
  return {
    timers,
    cleared,
    setTimeout(callback) {
      const id = nextId++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      cleared.push(id);
      timers.delete(id);
    },
  };
}

function incidentFeature({
  id = 1,
  offense = 'Thefts',
  occurred = '2026-07-15T14:35:00Z',
  location = '1500 MARKET ST',
  district = '09',
  coordinates = [-75.17, 39.96],
} = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates },
    properties: {
      cartodb_id: id,
      text_general_code: offense,
      dispatch_date_time: occurred,
      location_block: location,
      dc_dist: district,
    },
  };
}

function createIncidentView() {
  let activate = () => {};
  return {
    renders: [],
    selections: [],
    loading: 0,
    cleared: 0,
    destroyed: 0,
    setActivateHandler(handler) {
      activate = handler;
      return () => { activate = () => {}; };
    },
    activate(key) { activate(key); },
    setLoading() { this.loading += 1; },
    replaceResults(payload) { this.renders.push(payload); },
    setSelected(payload) { this.selections.push(payload); return true; },
    clearSelection() { this.selections.push(null); },
    clear() { this.cleared += 1; },
    destroy() { this.destroyed += 1; },
  };
}

function createPagedIncidentView() {
  const view = createIncidentView();
  view.renderedKeys = new Set();
  view.currentKey = null;
  view.replaceResults = function replaceResults(payload) {
    this.renders.push(payload);
    this.renderedKeys = new Set(visibleIncidentFeatures(payload.geo.features, {
      selectedKey: payload.selectedKey,
    }).visible.map((feature) => `carto:${feature.properties.cartodb_id}`));
  };
  view.setSelected = function setSelected(payload) {
    this.selections.push(payload);
    if (!this.renderedKeys.has(payload.key)) return false;
    this.currentKey = payload.key;
    return true;
  };
  return view;
}

function createLayerMap() {
  const handlers = new Map();
  const sources = new Map();
  const layers = new Map();
  const mutations = [];
  return {
    handlers,
    sources,
    layers,
    mutations,
    loaded: () => true,
    isStyleLoaded: () => true,
    getBounds: () => ({
      getWest: () => -75.2,
      getSouth: () => 39.9,
      getEast: () => -75.1,
      getNorth: () => 40,
    }),
    getSource: (id) => sources.get(id) || null,
    getLayer: (id) => layers.get(id) || null,
    addSource(id, definition) {
      const source = {
        definition,
        data: definition.data,
        setData(data) { this.data = data; },
        setClusterOptions(options) {
          this.definition = { ...this.definition, ...options };
          mutations.push(['cluster-options', id, options]);
        },
      };
      sources.set(id, source);
      mutations.push(['source', id, definition.data]);
    },
    addLayer(definition) {
      layers.set(definition.id, definition);
      mutations.push(['layer', definition.id]);
    },
    removeLayer(id) { layers.delete(id); },
    removeSource(id) { sources.delete(id); },
    setPaintProperty(id, property, value) {
      layers.get(id).paint[property] = value;
      mutations.push(['paint', id, property, value]);
    },
    on(event, layer, handler) {
      if (typeof layer === 'function') handlers.set(event, layer);
      else handlers.set(`${event}:${layer}`, handler);
    },
    once(event, handler) { handlers.set(event, handler); },
    off(event, layer, handler) {
      const key = typeof layer === 'function' ? event : `${event}:${layer}`;
      const candidate = typeof layer === 'function' ? layer : handler;
      if (handlers.get(key) === candidate) handlers.delete(key);
    },
    getCanvas: () => ({ style: { cursor: '' } }),
  };
}

function createIncidentResultsDom() {
  const createNode = (tagName = 'div') => ({
    tagName,
    children: [],
    dataset: {},
    attributes: {},
    hidden: false,
    textContent: '',
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = [...children]; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    querySelectorAll() { return []; },
    contains(candidate) { return this.children.includes(candidate); },
  });
  const nodes = {
    status: createNode('p'),
    selected: createNode('article'),
    state: createNode('p'),
    list: createNode('ol'),
    more: createNode('button'),
    edit: createNode('button'),
  };
  const selectors = new Map([
    ['[data-incident-results-status]', nodes.status],
    ['[data-selected-incident]', nodes.selected],
    ['[data-incident-results-state]', nodes.state],
    ['[data-incident-results-list]', nodes.list],
    ['[data-incident-results-more]', nodes.more],
    ['[data-incident-results-edit]', nodes.edit],
  ]);
  const root = createNode('section');
  root.querySelector = (selector) => selectors.get(selector) || null;
  root.addEventListener = () => {};
  root.removeEventListener = () => {};
  return {
    root,
    nodes,
    documentRef: { createElement: (tagName) => createNode(tagName) },
  };
}

test('specific offense selections use stable palette colors and disable clustering while readable', async () => {
  const {
    buildOffenseColorExpression,
    buildOffenseHighlights,
  } = await import('../../src/utils/types.js');
  const { makePalette } = await import('../../src/utils/classify.js');
  const codes = [
    'Aggravated Assault Firearm',
    'Aggravated Assault No Firearm',
    'Robbery Firearm',
  ];

  assert.equal(typeof buildOffenseHighlights, 'function');
  assert.equal(typeof buildOffenseColorExpression, 'function');
  const highlights = buildOffenseHighlights(codes, makePalette('OrRd', 5));
  assert.deepEqual(highlights.map(({ code }) => code), codes);
  assert.equal(new Set(highlights.map(({ color }) => color)).size, 3);
  assert.equal(
    highlights.every(({ color }) => makePalette('OrRd', 5).includes(color)),
    true,
  );
  assert.deepEqual(buildOffenseHighlights(codes, makePalette('OrRd', 5)), highlights);

  const map = createLayerMap();
  const geo = {
    type: 'FeatureCollection',
    features: codes.map((offense, index) => incidentFeature({ id: index + 1, offense })),
  };
  const refresh = (classPalette, drilldownCodes = codes) => refreshPoints(map, {
    start: '2026-01-01',
    end: '2026-02-01',
    types: drilldownCodes,
    drilldownCodes,
    classPalette,
    fetchPointsImpl: async () => geo,
  });

  await refresh('OrRd');
  assert.equal(map.sources.get('crime-points').definition.cluster, false);
  assert.equal(map.layers.get('unclustered').paint['circle-stroke-color'], '#172033');
  assert.deepEqual(
    map.layers.get('unclustered').paint['circle-color'],
    buildOffenseColorExpression(highlights),
  );

  await refresh('Blues');
  assert.deepEqual(
    map.layers.get('unclustered').paint['circle-color'],
    buildOffenseColorExpression(buildOffenseHighlights(codes, makePalette('Blues', 5))),
  );
  assert.equal(
    map.mutations.some(([kind, id, property]) => (
      kind === 'paint' && id === 'unclustered' && property === 'circle-color'
    )),
    true,
  );
  assert.equal(
    map.mutations.filter(([kind]) => kind === 'cluster-options').length,
    0,
    'palette-only refreshes must not rebuild clustering',
  );

  await refresh('Blues', []);
  assert.equal(map.sources.get('crime-points').definition.cluster, true);
  assert.equal(map.mutations.filter(([kind]) => kind === 'cluster-options').length, 1);
  assert.deepEqual(
    map.mutations.find(([kind]) => kind === 'cluster-options').at(-1),
    { cluster: true },
    'cluster toggles must preserve MapLibre\'s internally scaled radius and max zoom',
  );
  assert.deepEqual(
    map.layers.get('unclustered').paint['circle-color'],
    buildOffenseColorExpression([]),
  );
  assert.equal(map.layers.get('unclustered').paint['circle-stroke-color'], '#fff');
});

test('buffer point requests combine the current viewport with the selected radius', async () => {
  const map = createLayerMap();
  let request;
  await refreshPoints(map, {
    start: '2026-01-01',
    end: '2026-02-01',
    center3857: [-8_365_000, 4_855_000],
    radiusM: 800,
    fetchPointsImpl: async (params) => {
      request = params;
      return { type: 'FeatureCollection', features: [] };
    },
  });

  assert.deepEqual(request.center3857, [-8_365_000, 4_855_000]);
  assert.equal(request.radiusM, 800);
  assert.deepEqual(Object.keys(request.bbox).sort(), ['xmax', 'xmin', 'ymax', 'ymin']);
});

test('tract point refresh resolves and forwards the selected polygon without a saved buffer filter', async () => {
  const map = createLayerMap();
  const polygon = {
    type: 'Polygon',
    coordinates: [[[-75.2, 39.9], [-75.1, 39.9], [-75.1, 40], [-75.2, 39.9]]],
  };
  let resolved;
  let request;
  await refreshPoints(map, {
    start: '2026-01-01',
    end: '2026-02-01',
    queryMode: 'tract',
    selectedTractGEOID: '42101000100',
    center3857: [-8_365_000, 4_855_000],
    radiusM: 800,
    resolveTractGeometryImpl: async (params) => {
      resolved = params;
      return polygon;
    },
    fetchPointsImpl: async (params) => {
      request = params;
      return { type: 'FeatureCollection', features: [] };
    },
  });

  assert.equal(resolved.selectedTractGEOID, '42101000100');
  assert.equal(request.center3857, undefined);
  assert.equal(request.radiusM, undefined);
  assert.equal(request.tractGeometry, polygon);
});

test('one accepted points response updates map and incident list with the same GeoJSON object', async () => {
  const map = createLayerMap();
  const sourceGeo = {
    type: 'FeatureCollection',
    features: [incidentFeature({ id: 11 }), incidentFeature({ id: 12 })],
  };
  let fetchCalls = 0;
  const incidentResults = {
    replacements: [],
    setLoading() {},
    replaceResults(payload) { this.replacements.push(payload); },
    clear() {},
    destroy() {},
  };
  const controller = wirePoints(map, {
    getFilters: () => ({ start: '2026-01-01', end: '2026-02-01' }),
    autoRefresh: false,
    incidentResultsController: incidentResults,
    refreshPointsImpl: (currentMap, params) => refreshPoints(currentMap, {
      ...params,
      fetchPointsImpl: async () => {
        fetchCalls += 1;
        return sourceGeo;
      },
    }),
    showToast: () => {},
    hideToast: () => {},
  });

  const result = await controller.refresh();

  assert.equal(fetchCalls, 1);
  assert.equal(result.applied, true);
  assert.equal(map.sources.get('crime-points').data, result.geo);
  assert.equal(incidentResults.replacements.length, 1);
  assert.equal(incidentResults.replacements[0].geo, result.geo);
  assert.equal(incidentResults.replacements[0].generation, result.generation);
  controller.destroy();
});

test('map and list activation share one escaped incident detail owner', () => {
  const map = createLayerMap();
  const view = createIncidentView();
  const popupHtml = [];
  const popup = {
    setLngLat() { return this; },
    setHTML(html) { popupHtml.push(html); return this; },
    addTo() { return this; },
    remove() {},
  };
  const controller = createIncidentResultsController(map, {
    view,
    createPopup: () => popup,
  });
  const feature = incidentFeature({
    id: 42,
    offense: '<img src=x onerror=alert(1)>',
    location: '1500 MARKET ST & <script>',
  });
  const geo = { type: 'FeatureCollection', features: [feature] };

  controller.replaceResults({ geo, generation: 3, status: 'ready', count: 1, tooMany: false });
  map.handlers.get('click:unclustered')({
    features: [feature],
    lngLat: { lng: -75.17, lat: 39.96 },
  });
  const mapHtml = popupHtml.at(-1);
  assert.equal(view.selections.at(-1).ensureVisible, false);
  view.activate('carto:42');
  const listHtml = popupHtml.at(-1);

  assert.equal(controller.getSelectedKey(), 'carto:42');
  assert.equal(mapHtml, listHtml);
  assert.match(listHtml, /&lt;img/);
  assert.match(listHtml, /&lt;script&gt;/);
  assert.doesNotMatch(listHtml, /<img|<script>/i);
  assert.equal(view.selections.at(-1).key, 'carto:42');
  assert.equal(view.selections.at(-1).ensureVisible, true);
  controller.destroy();
});

test('list selection recenters an incident only when it falls outside the central focus area', () => {
  const map = createLayerMap();
  const cameraMoves = [];
  let projected = { x: 900, y: 400 };
  map.getCanvas = () => ({ style: { cursor: '' }, clientWidth: 1000, clientHeight: 800 });
  map.project = () => projected;
  map.easeTo = (options) => cameraMoves.push(options);
  const view = createIncidentView();
  const controller = createIncidentResultsController(map, {
    view,
    createPopup: () => ({
      setLngLat() { return this; },
      setHTML() { return this; },
      addTo() { return this; },
      remove() {},
    }),
  });
  const feature = incidentFeature({ id: 43 });
  controller.replaceResults({
    geo: { type: 'FeatureCollection', features: [feature] },
    generation: 1,
    status: 'ready',
    count: 1,
  });

  view.activate('carto:43');
  assert.deepEqual(cameraMoves, [{ center: feature.geometry.coordinates, duration: 300 }]);

  projected = { x: 650, y: 400 };
  view.activate('carto:43');
  assert.equal(cameraMoves.length, 1);

  projected = { x: 900, y: 400 };
  map.handlers.get('click:unclustered')({ features: [feature], lngLat: { lng: -75.16, lat: 39.95 } });
  assert.equal(cameraMoves.length, 1);
  controller.destroy();
});

test('list selection honors reduced-motion preference while focusing an off-center incident', () => {
  const map = createLayerMap();
  const cameraMoves = [];
  map.getCanvas = () => ({ style: { cursor: '' }, clientWidth: 1000, clientHeight: 800 });
  map.project = () => ({ x: 900, y: 400 });
  map.easeTo = (options) => cameraMoves.push(options);
  const view = createIncidentView();
  const controller = createIncidentResultsController(map, {
    view,
    prefersReducedMotion: () => true,
    createPopup: () => ({
      setLngLat() { return this; },
      setHTML() { return this; },
      addTo() { return this; },
      remove() {},
    }),
  });
  const feature = incidentFeature({ id: 44 });
  controller.replaceResults({
    geo: { type: 'FeatureCollection', features: [feature] },
    generation: 1,
    status: 'ready',
    count: 1,
  });

  view.activate('carto:44');

  assert.deepEqual(cameraMoves, [{ center: feature.geometry.coordinates, duration: 0 }]);
  controller.destroy();
});

test('a refreshed result generation restores the selected incident popup', () => {
  const map = createLayerMap();
  const view = createIncidentView();
  let popupAdds = 0;
  const controller = createIncidentResultsController(map, {
    view,
    createPopup: () => ({
      setLngLat() { return this; },
      setHTML() { return this; },
      addTo() { popupAdds += 1; return this; },
      remove() {},
    }),
  });
  const feature = incidentFeature({ id: 45 });
  const payload = {
    geo: { type: 'FeatureCollection', features: [feature] },
    status: 'ready',
    count: 1,
  };

  controller.replaceResults({ ...payload, generation: 1 });
  view.activate('carto:45');
  assert.equal(popupAdds, 1);

  controller.replaceResults({ ...payload, generation: 2 });

  assert.equal(controller.getSelectedKey(), 'carto:45');
  assert.equal(popupAdds, 2);
  controller.destroy();
});

test('a map-selected incident outside the first page is inserted into the synchronized list', () => {
  const map = createLayerMap();
  const view = createPagedIncidentView();
  const features = Array.from({ length: 75 }, (_, index) => incidentFeature({ id: index + 1 }));
  const selected = features[60];
  const controller = createIncidentResultsController(map, {
    view,
    createPopup: () => ({
      setLngLat() { return this; },
      setHTML() { return this; },
      addTo() { return this; },
      remove() {},
    }),
  });

  controller.replaceResults({
    geo: { type: 'FeatureCollection', features },
    generation: 8,
    status: 'ready',
    count: features.length,
  });
  assert.equal(view.renderedKeys.has('carto:61'), false);

  map.handlers.get('click:unclustered')({
    features: [selected],
    lngLat: { lng: -75.17, lat: 39.96 },
  });

  assert.equal(view.renderedKeys.has('carto:61'), true);
  assert.equal(view.currentKey, 'carto:61');
  assert.equal(view.renders.at(-1).selectedKey, 'carto:61');
  assert.equal(view.selections.at(-1).ensureVisible, false);
  controller.destroy();
});

test('a new result generation clears a selected incident that is no longer present', () => {
  const map = createLayerMap();
  const view = createIncidentView();
  let popupRemovals = 0;
  const controller = createIncidentResultsController(map, {
    view,
    createPopup: () => ({
      setLngLat() { return this; },
      setHTML() { return this; },
      addTo() { return this; },
      remove() { popupRemovals += 1; },
    }),
  });
  const first = incidentFeature({ id: 1 });
  const removed = incidentFeature({ id: 2 });

  controller.replaceResults({
    geo: { type: 'FeatureCollection', features: [first, removed] },
    generation: 4,
    status: 'ready',
    count: 2,
  });
  view.activate('carto:2');
  controller.replaceResults({
    geo: { type: 'FeatureCollection', features: [first] },
    generation: 5,
    status: 'ready',
    count: 1,
  });

  assert.equal(controller.getSelectedKey(), null);
  assert.equal(view.selections.at(-1), null);
  assert.equal(popupRemovals, 1);
  controller.destroy();
});

test('a stale points response cannot update either map or incident results', async () => {
  const map = createLayerMap();
  const first = deferred();
  const second = deferred();
  const requests = [first, second];
  const replacements = [];
  const controller = wirePoints(map, {
    getFilters: () => ({}),
    autoRefresh: false,
    incidentResultsController: {
      setLoading() {},
      replaceResults(payload) { replacements.push(payload); },
      clear() {},
      destroy() {},
    },
    refreshPointsImpl: (currentMap, params) => refreshPoints(currentMap, {
      ...params,
      fetchPointsImpl: () => requests.shift().promise,
    }),
    showToast: () => {},
    hideToast: () => {},
  });

  const oldRequest = controller.refresh({ sequence: 1 });
  const currentRequest = controller.refresh({ sequence: 2 });
  first.resolve({ type: 'FeatureCollection', features: [incidentFeature({ id: 1 })] });
  assert.deepEqual(await oldRequest, { applied: false });
  assert.equal(map.mutations.length, 0);
  assert.equal(replacements.length, 0);

  second.resolve({ type: 'FeatureCollection', features: [incidentFeature({ id: 2 })] });
  assert.equal((await currentRequest).applied, true);
  assert.equal(replacements.length, 1);
  controller.destroy();
});

test('high-density incident results never render more than 200 rows and keep the selection reachable', () => {
  const features = Array.from({ length: 20_000 }, (_, index) => incidentFeature({
    id: index + 1,
    occurred: `2026-07-${String((index % 28) + 1).padStart(2, '0')}T14:35:00Z`,
  }));
  const selectedKey = 'carto:19999';
  const result = visibleIncidentFeatures(features, { visibleCount: 20_000, selectedKey });

  assert.equal(result.all.length, 20_000);
  assert.equal(result.visible.length, 200);
  assert.equal(result.visible.some((feature) => feature.properties.cartodb_id === 19_999), true);
});

test('incident results begin with a compact twelve-record slice', () => {
  const features = Array.from({ length: 30 }, (_, index) => incidentFeature({
    id: index + 1,
    occurred: `2026-07-${String(index + 1).padStart(2, '0')}T14:35:00Z`,
  }));

  const result = visibleIncidentFeatures(features);

  assert.equal(result.all.length, 30);
  assert.equal(result.visible.length, 12);
  assert.equal(result.visible[0].properties.cartodb_id, 30);
});

test('incident list rows defer district metadata to the selected detail', () => {
  const { root, nodes, documentRef } = createIncidentResultsDom();
  const view = createIncidentResultsView({
    root,
    documentRef,
    translate: (key) => key,
    createDetailModel: () => ({
      key: 'carto:7',
      offense: 'Other Assaults',
      occurred: '2026-07-15 14:35',
      location: '1500 MARKET ST',
      district: '09',
    }),
  });

  view.replaceResults({
    geo: { type: 'FeatureCollection', features: [incidentFeature({ id: 7 })] },
    generation: 1,
    status: 'ready',
    count: 1,
  });

  const button = nodes.list.children[0].children[0];
  assert.deepEqual(button.children.map(({ tagName }) => tagName), ['strong', 'span']);
  assert.equal(button.children[1].textContent, '2026-07-15 14:35 · 1500 MARKET ST');
});

test('incident list and selected detail localize official offense codes after a language switch', async (t) => {
  const { setLanguage, t: translate } = await import('../../src/i18n/index.js');
  t.after(() => setLanguage('en'));
  setLanguage('zh-CN');
  const { root, nodes, documentRef } = createIncidentResultsDom();
  const view = createIncidentResultsView({ root, documentRef, translate });

  view.replaceResults({
    geo: { type: 'FeatureCollection', features: [incidentFeature({ id: 8, offense: 'Other Assaults' })] },
    generation: 1,
    status: 'ready',
    count: 1,
  });

  assert.equal(nodes.list.children[0].children[0].children[0].textContent, '其他袭击');
});

test('language redraw reuses cached incidents without fetching and destroy releases all owners', () => {
  const map = createLayerMap();
  const view = createIncidentView();
  let languageListener = null;
  let releases = 0;
  let popupRemovals = 0;
  const controller = createIncidentResultsController(map, {
    view,
    languageChange(listener) {
      languageListener = listener;
      return () => { releases += 1; };
    },
    createPopup: () => ({
      setLngLat() { return this; },
      setHTML() { return this; },
      addTo() { return this; },
      remove() { popupRemovals += 1; },
    }),
  });
  const feature = incidentFeature({ id: 7 });
  controller.replaceResults({
    geo: { type: 'FeatureCollection', features: [feature] },
    generation: 9,
    status: 'ready',
    count: 1,
  });
  view.activate('carto:7');
  const rendersBeforeLanguage = view.renders.length;

  languageListener();
  assert.equal(view.renders.length, rendersBeforeLanguage + 1);
  assert.equal(controller.getSelectedKey(), 'carto:7');

  controller.destroy();
  controller.destroy();
  assert.equal(releases, 1);
  assert.equal(view.destroyed, 1);
  assert.equal(map.handlers.has('click:unclustered'), false);
  assert.equal(popupRemovals >= 1, true);
  const selectionCount = view.selections.length;
  view.activate('carto:7');
  assert.equal(view.selections.length, selectionCount);
});

test('refreshPoints forwards AbortSignal and stale success cannot mutate the map', async () => {
  const map = createMap();
  const gate = deferred();
  const controller = new AbortController();
  let receivedSignal;

  const refresh = refreshPoints(map, {
    start: '2026-01-01',
    end: '2026-02-01',
    signal: controller.signal,
    shouldApply: () => true,
    fetchPointsImpl: (params) => {
      receivedSignal = params.signal;
      return gate.promise;
    },
  });
  controller.abort();
  gate.resolve({ type: 'FeatureCollection', features: [] });

  assert.deepEqual(await refresh, { applied: false });
  assert.equal(receivedSignal, controller.signal);
  assert.deepEqual(map.mutations, []);
});

test('a newer refresh aborts the superseded request', async () => {
  const map = createMap();
  const requests = [];
  const controller = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: (_map, params) => {
      const gate = deferred();
      requests.push({ gate, signal: params.signal });
      return gate.promise;
    },
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
  });
  await Promise.resolve();
  const next = controller.refresh();

  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].signal.aborted, false);
  requests[0].gate.resolve({ applied: false });
  requests[1].gate.resolve({ applied: true });
  await next;
  controller.destroy();
});

test('an unselected Crime entry stays idle until an analysis authorizes incident loading', async () => {
  const map = createMap();
  const scheduler = createScheduler();
  let filters = { queryMode: 'buffer', center3857: null };
  const requests = [];
  const controller = wirePoints(map, {
    getFilters: () => filters,
    shouldRefresh: (snapshot) => snapshot.queryMode === 'buffer' && Boolean(snapshot.center3857),
    refreshPointsImpl: async (_map, snapshot) => {
      requests.push(snapshot);
      return { applied: true };
    },
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
    scheduler,
  });

  await Promise.resolve();
  assert.equal(requests.length, 0);
  map.handlers.get('moveend')();
  assert.equal(scheduler.timers.size, 0);

  filters = { queryMode: 'buffer', center3857: [-8_365_000, 4_855_000] };
  assert.deepEqual(await controller.refresh(filters), { applied: true });
  assert.equal(requests.length, 1);

  filters = { queryMode: 'buffer', center3857: null };
  map.handlers.get('moveend')();
  assert.equal(scheduler.timers.size, 0);
  assert.equal(requests.length, 1);
  controller.destroy();
});

test('a failed incident results chunk is surfaced and retried on the next refresh', async (t) => {
  const originalDocument = globalThis.document;
  const originalWarn = console.warn;
  const incidentStatus = { textContent: '' };
  const incidentRoot = {
    setAttribute() {},
    querySelector(selector) {
      return selector === '[data-incident-results-status]' ? incidentStatus : null;
    },
  };
  globalThis.document = {
    getElementById(id) { return id === 'incident-results' ? incidentRoot : null; },
    querySelector(selector) {
      return selector === '#incident-results [data-incident-results-status]' ? incidentStatus : null;
    },
  };
  console.warn = () => {};
  t.after(() => {
    globalThis.document = originalDocument;
    console.warn = originalWarn;
  });

  const map = createMap();
  const scheduler = createScheduler();
  const replacements = [];
  const toasts = [];
  let loadAttempts = 0;
  const controller = wirePoints(map, {
    autoRefresh: false,
    getFilters: () => ({ queryMode: 'buffer', center3857: [-8_365_000, 4_855_000] }),
    shouldRefresh: () => true,
    refreshPointsImpl: async (_map, params) => ({
      applied: true,
      geo: { type: 'FeatureCollection', features: [incidentFeature()] },
      generation: params.resultGeneration,
      status: 'ready',
      count: 1,
      tooMany: false,
    }),
    _loadIncidentModule: async () => {
      loadAttempts += 1;
      if (loadAttempts === 1) throw new Error('chunk unavailable');
      return {
        createIncidentResultsController: () => ({
          setLoading() {},
          setFailed() {},
          replaceResults(payload) { replacements.push(payload); },
          clear() {},
          destroy() {},
        }),
      };
    },
    clearCrimePointsImpl: () => {},
    showToast: (message) => toasts.push(message),
    hideToast: () => {},
    scheduler,
  });

  assert.deepEqual(await controller.refresh(), { status: 'failed' });
  assert.equal(loadAttempts, 1);
  assert.equal(toasts.length, 1);
  assert.notEqual(toasts[0], '');

  const recovered = await controller.refresh();
  assert.equal(recovered.applied, true);
  assert.equal(loadAttempts, 2);
  assert.equal(replacements.length, 1);
  controller.destroy();
});

test('cluster activation expands through the GeoJSON source and owns the camera move', async () => {
  const handlers = new Map();
  const cameraMoves = [];
  const source = {
    getClusterExpansionZoom(clusterId) {
      assert.equal(clusterId, 73);
      return Promise.resolve(14);
    },
  };
  const map = {
    on(event, layer, handler) { handlers.set(`${event}:${layer}`, handler); },
    off(event, layer, handler) {
      if (handlers.get(`${event}:${layer}`) === handler) handlers.delete(`${event}:${layer}`);
    },
    getSource(id) { return id === 'crime-points' ? source : null; },
    easeTo(options) { cameraMoves.push(options); },
  };
  let refreshes = 0;
  const cleanup = attachClusterExpansion(map, {
    isActive: () => true,
    runMapMove: async (action) => {
      action();
      return true;
    },
    refresh: async () => { refreshes += 1; },
  });

  await handlers.get('click:clusters')({
    features: [{
      properties: { cluster_id: 73 },
      geometry: { type: 'Point', coordinates: [-75.16, 39.95] },
    }],
  });

  assert.deepEqual(cameraMoves, [{
    center: [-75.16, 39.95],
    zoom: 14,
    duration: 350,
  }]);
  assert.equal(refreshes, 1);
  cleanup();
  assert.equal(handlers.has('click:clusters'), false);
});

test('cluster expansion disables animation when reduced motion is requested', async () => {
  const handlers = new Map();
  const cameraMoves = [];
  const map = {
    on(event, layer, handler) { handlers.set(`${event}:${layer}`, handler); },
    off() {},
    getSource: () => ({ getClusterExpansionZoom: async () => 15 }),
    easeTo(options) { cameraMoves.push(options); },
  };
  const cleanup = attachClusterExpansion(map, {
    isActive: () => true,
    prefersReducedMotion: () => true,
    runMapMove: async (action) => { action(); return true; },
  });

  await handlers.get('click:clusters')({
    features: [{
      properties: { cluster_id: 4 },
      geometry: { type: 'Point', coordinates: [-75.16, 39.95] },
    }],
  });

  assert.equal(cameraMoves[0].duration, 0);
  cleanup();
});

test('a newer points generation invalidates a held cluster expansion', async () => {
  const handlers = new Map();
  const expansion = deferred();
  let generation = 7;
  let cameraMoves = 0;
  let refreshes = 0;
  const map = {
    on(event, layer, handler) { handlers.set(`${event}:${layer}`, handler); },
    off() {},
    getSource: () => ({ getClusterExpansionZoom: () => expansion.promise }),
    easeTo() { cameraMoves += 1; },
  };
  const cleanup = attachClusterExpansion(map, {
    isActive: () => true,
    getGeneration: () => generation,
    runMapMove: async (action) => { action(); return true; },
    refresh: async () => { refreshes += 1; },
  });
  const activation = handlers.get('click:clusters')({
    features: [{
      properties: { cluster_id: 9 },
      geometry: { type: 'Point', coordinates: [-75.16, 39.95] },
    }],
  });

  generation += 1;
  expansion.resolve(15);
  await activation;

  assert.equal(cameraMoves, 0);
  assert.equal(refreshes, 0);
  cleanup();
});

test('an inactive cluster expansion cannot move the map after its zoom resolves', async () => {
  const handlers = new Map();
  const expansion = deferred();
  let active = true;
  let cameraMoves = 0;
  const map = {
    on(event, layer, handler) { handlers.set(`${event}:${layer}`, handler); },
    off() {},
    getSource: () => ({ getClusterExpansionZoom: () => expansion.promise }),
    easeTo() { cameraMoves += 1; },
  };
  const cleanup = attachClusterExpansion(map, {
    isActive: () => active,
    runMapMove: async (action) => { action(); return true; },
    refresh: async () => {},
  });
  const activation = handlers.get('click:clusters')({
    features: [{
      properties: { cluster_id: 9 },
      geometry: { type: 'Point', coordinates: [-75.16, 39.95] },
    }],
  });
  active = false;
  expansion.resolve(15);
  await activation;

  assert.equal(cameraMoves, 0);
  cleanup();
});

test('refresh accepts a captured filter snapshot without reading live filters again', async () => {
  const map = createMap({ loaded: false });
  let filterReads = 0;
  let receivedFilters;
  const controller = wirePoints(map, {
    getFilters: () => {
      filterReads += 1;
      return { start: 'live' };
    },
    refreshPointsImpl: async (_map, params) => {
      receivedFilters = params;
    },
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
  });

  const result = await controller.refresh({ start: 'captured', end: 'snapshot' });

  assert.deepEqual(result, { applied: true });
  assert.equal(filterReads, 0);
  assert.equal(receivedFilters.start, 'captured');
  assert.equal(receivedFilters.end, 'snapshot');
  controller.destroy();
});

test('an outer refresh cancellation aborts points transport and blocks its late sink', async () => {
  const map = createMap({ loaded: false });
  const gate = deferred();
  const outer = new AbortController();
  let receivedSignal;
  const controller = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: async (_map, params) => {
      receivedSignal = params.signal;
      await gate.promise;
      if (params.shouldApply()) map.mutations.push(['late-points-sink']);
      return { applied: params.shouldApply() };
    },
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
  });

  const request = controller.refresh(
    { start: '2026-01-01', end: '2026-02-01' },
    { signal: outer.signal, shouldApply: () => !outer.signal.aborted },
  );
  await Promise.resolve();
  outer.abort(new DOMException('Superseded Crime refresh', 'AbortError'));

  assert.equal(receivedSignal.aborted, true);
  gate.resolve();
  assert.deepEqual(await request, { applied: false });
  assert.deepEqual(map.mutations, []);
  controller.destroy();
});

test('superseded points cannot commit while the next Crime refresh is still at its boundary', async () => {
  const map = createMap({ loaded: false });
  const secondBoundary = deferred();
  const pointRequests = [];
  const pointsController = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: async (_map, params) => {
      const gate = deferred();
      pointRequests.push({ gate, params });
      await gate.promise;
      if (params.shouldApply()) map.mutations.push(['points', params.sequence]);
      return { applied: params.shouldApply() };
    },
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
  });
  let sequence = 0;
  const owner = createCrimeRefreshOwner({
    readSnapshot: () => ({ sequence: ++sequence }),
    runRefresh: async (snapshot, context) => {
      if (snapshot.sequence === 2) await secondBoundary.promise;
      return pointsController.refresh(snapshot, {
        signal: context.signal,
        shouldApply: context.isCurrent,
      });
    },
  });

  const first = owner.refresh();
  await Promise.resolve();
  const second = owner.refresh();
  await Promise.resolve();
  assert.equal(pointRequests.length, 1);
  assert.equal(pointRequests[0].params.signal.aborted, true);

  pointRequests[0].gate.resolve();
  assert.deepEqual(await first, { applied: false });
  assert.deepEqual(map.mutations, []);

  secondBoundary.resolve();
  await Promise.resolve();
  assert.equal(pointRequests.length, 2);
  pointRequests[1].gate.resolve();
  assert.deepEqual(await second, { applied: true });
  assert.deepEqual(map.mutations, [['points', 2]]);
  pointsController.destroy();
  owner.destroy();
});

test('superseded and deactivated failures do not toast or retry', async () => {
  const map = createMap();
  const scheduler = createScheduler();
  const requests = [];
  let toastCount = 0;
  const controller = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: (_map, params) => {
      const gate = deferred();
      requests.push({ gate, signal: params.signal });
      return gate.promise;
    },
    clearCrimePointsImpl: () => {},
    showToast: () => { toastCount += 1; },
    hideToast: () => {},
    scheduler,
  });
  await Promise.resolve();
  const second = controller.refresh();
  requests[0].gate.reject(new Error('superseded'));
  await Promise.resolve();
  controller.setActive(false);
  requests[1].gate.reject(new Error('deactivated'));
  await second;

  assert.equal(toastCount, 0);
  assert.equal(scheduler.timers.size, 0);
  controller.destroy();
});

test('destroy aborts work, cancels debounce/retry timers, and removes listeners', async () => {
  const map = createMap({ loaded: false });
  const scheduler = createScheduler();
  const pending = deferred();
  const controller = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: (_map, params) => {
      pending.signal = params.signal;
      return pending.promise;
    },
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
    scheduler,
  });

  map.handlers.get('moveend')();
  assert.equal(scheduler.timers.size, 1);
  map.handlers.get('load')();
  await Promise.resolve();
  controller.destroy();

  assert.equal(pending.signal.aborted, true);
  assert.equal(scheduler.timers.size, 0);
  assert.equal(map.handlers.size, 0);
  pending.reject(new DOMException('Aborted', 'AbortError'));
  await Promise.resolve();
});

test('destroy clears retry and toast timers created by an active failure', async () => {
  const map = createMap({ loaded: false });
  const scheduler = createScheduler();
  const pending = deferred();
  const controller = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: () => pending.promise,
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
    scheduler,
  });
  const request = controller.refresh();
  pending.reject(new Error('network unavailable'));
  assert.deepEqual(await request, { status: 'failed' });

  assert.equal(scheduler.timers.size, 2);
  controller.destroy();
  assert.equal(scheduler.timers.size, 0);
  assert.equal(map.handlers.size, 0);
});

test('moveend stays idle while inactive and resumes through the same listener', async () => {
  const map = createMap({ loaded: false });
  const scheduler = createScheduler();
  let refreshCount = 0;
  const controller = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: async () => {
      refreshCount += 1;
      return { applied: true };
    },
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
    scheduler,
  });
  const moveend = map.handlers.get('moveend');

  controller.setActive(false);
  moveend();
  assert.equal(scheduler.timers.size, 0);
  assert.equal(refreshCount, 0);

  controller.setActive(true);
  moveend();
  assert.equal(scheduler.timers.size, 1);
  const [timerId, callback] = scheduler.timers.entries().next().value;
  scheduler.timers.delete(timerId);
  callback();
  await Promise.resolve();
  assert.equal(refreshCount, 1);
  controller.destroy();
});

test('programmatic movement refreshes once from final bounds and preserves no-move, user-pan, and cancellation semantics', async () => {
  const map = createMap({ loaded: false });
  const scheduler = createScheduler();
  let moving = false;
  let bounds = [-75.2, 39.9, -75.1, 40];
  const refreshBounds = [];
  map.isMoving = () => moving;
  map.getBounds = () => ({
    getWest: () => bounds[0],
    getSouth: () => bounds[1],
    getEast: () => bounds[2],
    getNorth: () => bounds[3],
  });
  const controller = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: async (currentMap) => {
      const current = currentMap.getBounds();
      refreshBounds.push([current.getWest(), current.getSouth(), current.getEast(), current.getNorth()]);
      return { applied: true };
    },
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
    scheduler,
  });
  const moveend = map.handlers.get('moveend');

  const moveCompleted = controller.runProgrammaticMapMove(() => { moving = true; });
  const ownedRefresh = moveCompleted.then((completed) => (
    completed ? controller.refresh() : { applied: false }
  ));
  await Promise.resolve();
  assert.deepEqual(refreshBounds, []);
  bounds = [-75.18, 39.92, -75.08, 40.02];
  moving = false;
  moveend();
  assert.deepEqual(await ownedRefresh, { applied: true });
  assert.equal(scheduler.timers.size, 0);
  assert.deepEqual(refreshBounds, [[-75.18, 39.92, -75.08, 40.02]]);

  bounds = [-75.17, 39.93, -75.07, 40.03];
  const noMoveCompleted = await controller.runProgrammaticMapMove(() => {});
  assert.equal(noMoveCompleted, true);
  await controller.refresh();
  assert.deepEqual(refreshBounds.at(-1), bounds);

  bounds = [-75.16, 39.94, -75.06, 40.04];
  moveend();
  const [userTimerId, userCallback] = scheduler.timers.entries().next().value;
  scheduler.timers.delete(userTimerId);
  userCallback();
  await Promise.resolve();
  assert.deepEqual(refreshBounds.at(-1), bounds);

  await assert.rejects(
    controller.runProgrammaticMapMove(() => { throw new Error('flyTo failed'); }),
    /flyTo failed/,
  );
  await controller.refresh();
  assert.equal(refreshBounds.length, 4);

  moving = true;
  const cancelledMove = controller.runProgrammaticMapMove(() => {});
  const cancelledRefresh = cancelledMove.then((completed) => (
    completed ? controller.refresh() : { applied: false }
  ));
  controller.setActive(false);
  assert.equal(await cancelledMove, false);
  assert.deepEqual(await cancelledRefresh, { applied: false });
  assert.equal(refreshBounds.length, 4);
  controller.destroy();
});

test('a replacement programmatic move ignores the synchronous moveend emitted while stopping the old animation', async () => {
  const map = createMap({ loaded: false });
  const scheduler = createScheduler();
  let moving = false;
  map.isMoving = () => moving;
  const controller = wirePoints(map, {
    getFilters: () => ({}),
    refreshPointsImpl: async () => ({ applied: true }),
    clearCrimePointsImpl: () => {},
    showToast: () => {},
    hideToast: () => {},
    scheduler,
  });
  const moveend = map.handlers.get('moveend');

  const firstMove = controller.runProgrammaticMapMove(() => { moving = true; });
  let secondSettled = false;
  const secondMove = controller.runProgrammaticMapMove(() => {
    moveend(); // MapLibre stops the first animation synchronously inside flyTo().
    moving = true;
  }).then((completed) => {
    secondSettled = true;
    return completed;
  });

  assert.equal(await firstMove, false);
  await Promise.resolve();
  assert.equal(secondSettled, false);
  assert.equal(scheduler.timers.size, 0);

  moving = false;
  moveend();
  assert.equal(await secondMove, true);
  assert.equal(scheduler.timers.size, 0);
  controller.destroy();
});
