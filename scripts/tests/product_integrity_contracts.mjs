#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { updateAllCharts } from '../../src/charts/index.js';
import { updateCompare } from '../../src/compare/card.js';
import * as diaryModule from '../../src/routes_diary/index.js';
import * as stateModule from '../../src/state/store.js';
import * as tractView from '../../src/map/tracts_view.js';
import * as panelModule from '../../src/ui/panel.js';
import { buildTopTypesSQL } from '../../src/utils/sql.js';
import { getSegmentDisplayLabel } from '../../src/routes_diary/labels.js';

const { store } = stateModule;

function preserveStore(t) {
  const snapshot = {
    startMonth: store.startMonth,
    durationMonths: store.durationMonths,
    timeWindowMonths: store.timeWindowMonths,
    selectedGroups: [...store.selectedGroups],
    selectedTypes: [...store.selectedTypes],
    selectedDrilldownCodes: [...store.selectedDrilldownCodes],
    queryMode: store.queryMode,
    adminLevel: store.adminLevel,
    selectedDistrictCode: store.selectedDistrictCode,
    selectedTractGEOID: store.selectedTractGEOID,
    coverageMin: store.coverageMin,
    coverageMax: store.coverageMax,
    coverageStatus: store.coverageStatus,
    coverageError: store.coverageError,
    coverageNotice: store.coverageNotice,
    per10k: store.per10k,
    center3857: store.center3857 ? [...store.center3857] : null,
    centerB3857: store.centerB3857 ? [...store.centerB3857] : null,
    addressA: store.addressA,
    addressB: store.addressB,
  };
  t.after(() => Object.assign(store, snapshot));
}

test('drilldown codes become the canonical offense filter for every consumer', (t) => {
  preserveStore(t);
  store.startMonth = '2026-01';
  store.durationMonths = 1;
  store.selectedGroups = ['vehicle'];
  store.selectedTypes = ['Motor Vehicle Theft', 'Theft from Vehicle'];
  store.selectedDrilldownCodes = ['Motor Vehicle Theft'];

  const filters = store.getFilters();

  assert.deepEqual(filters.types, ['Motor Vehicle Theft']);
  assert.deepEqual(filters.resolvedOffenseCodes, ['Motor Vehicle Theft']);
});

test('one analysis mode owns both query behavior and visible geography', (t) => {
  preserveStore(t);
  assert.equal(typeof stateModule.setAnalysisMode, 'function');

  stateModule.setAnalysisMode('tract');
  assert.equal(store.queryMode, 'tract');
  assert.equal(store.adminLevel, 'tracts');
  store.per10k = true;

  store.selectedTractGEOID = '42101000100';
  stateModule.setAnalysisMode('district');
  assert.equal(store.queryMode, 'district');
  assert.equal(store.adminLevel, 'districts');
  assert.equal(store.per10k, false);
  assert.equal(store.selectedTractGEOID, null);

  store.selectedDistrictCode = '01';
  stateModule.setAnalysisMode('buffer');
  assert.equal(store.queryMode, 'buffer');
  assert.equal(store.adminLevel, 'districts');
  assert.equal(store.selectedDistrictCode, null);
});

test('coverage status has a user-visible ready and failure presentation', () => {
  assert.deepEqual(panelModule.describeCoverageStatus({
    coverageStatus: 'ready',
    coverageMin: '2006-01-01',
    coverageMax: '2026-07-30',
  }), {
    tone: 'ready',
    text: 'Live crime coverage: 2006-01-01 to 2026-07-30',
  });
  assert.deepEqual(panelModule.describeCoverageStatus({
    coverageStatus: 'error',
    coverageError: 'Crime coverage is unavailable: upstream timeout',
  }), {
    tone: 'error',
    text: 'Crime coverage is unavailable: upstream timeout',
  });
});

test('Crime controls expose one time model and one geography model', async () => {
  const [html, panelSource] = await Promise.all([
    readFile(new URL('../../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../../src/ui/panel.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(html, /id="twSel"/);
  assert.doesNotMatch(html, /id="adminSel"/);
  assert.match(html, /id="dataStatus"[^>]*aria-live="polite"/);
  assert.doesNotMatch(panelSource, /store\.timeWindowMonths\s*=/);
  assert.doesNotMatch(panelSource, /store\.adminLevel\s*=/);
  assert.match(panelSource, /setAnalysisMode\(mode\)/);
});

test('mobile layout keeps results in the same scroll column as controls', async () => {
  const [mainSource, styleSource] = await Promise.all([
    readFile(new URL('../../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/style.css', import.meta.url), 'utf8'),
  ]);
  assert.match(mainSource, /appendChild\(root\)|append\(root\)/);
  assert.match(mainSource, /diaryShell\?\.after\(root\)/);
  assert.doesNotMatch(mainSource, /\(diaryShell \|\| document\.body\)\.appendChild\(root\)/);
  assert.match(styleSource, /@media\s*\(max-width:\s*720px\)/);
  assert.match(styleSource, /#sidepanel[\s\S]*#compare-card[\s\S]*position:\s*static\s*!important/);
});

test('coverage initializes one explicit calendar range and a visible ready state', (t) => {
  preserveStore(t);
  assert.equal(typeof stateModule.applyCoverageToState, 'function');
  store.startMonth = null;
  store.durationMonths = 6;

  stateModule.applyCoverageToState(store, {
    min: '2006-01-01',
    max: '2026-07-30',
  });

  assert.equal(store.coverageStatus, 'ready');
  assert.equal(store.coverageError, null);
  assert.equal(store.startMonth, '2025-08');
  assert.equal(store.durationMonths, 12);
  assert.deepEqual(store.getStartEnd(), {
    start: '2025-08-01',
    end: '2026-08-01',
  });
});

test('coverage failure cannot silently fall back to a moving current-date window', (t) => {
  preserveStore(t);
  assert.equal(typeof stateModule.applyCoverageFailure, 'function');
  store.startMonth = null;
  store.coverageMax = null;

  stateModule.applyCoverageFailure(store, new Error('coverage unavailable'));

  assert.equal(store.coverageStatus, 'error');
  assert.match(store.coverageError, /coverage unavailable/i);
  assert.throws(() => store.getStartEnd(), /coverage.*unavailable/i);
});

test('coverage resets a shared date range that is outside the live dataset', (t) => {
  preserveStore(t);
  store.startMonth = '2027-01';
  store.durationMonths = 12;
  stateModule.applyCoverageToState(store, { min: '2006-01-01', max: '2026-07-30' });
  assert.equal(store.startMonth, '2025-08');
  assert.equal(store.durationMonths, 12);
  assert.match(store.coverageNotice, /outside live coverage/i);

  store.startMonth = '2005-01';
  store.durationMonths = 3;
  stateModule.applyCoverageToState(store, { min: '2006-01-01', max: '2026-07-30' });
  assert.equal(store.startMonth, '2026-05');
});

test('changing duration after coverage initialization keeps the window inside coverage', (t) => {
  preserveStore(t);
  store.startMonth = null;
  store.durationMonths = 12;
  stateModule.applyCoverageToState(store, { min: '2006-01-01', max: '2026-07-30' });
  store.durationMonths = 24;
  assert.equal(stateModule.normalizeCoverageWindow(store), true);
  assert.equal(store.startMonth, '2024-08');
  assert.deepEqual(store.getStartEnd(), { start: '2024-08-01', end: '2026-08-01' });
  assert.match(store.coverageNotice, /latest 24 months/i);
});

test('compare uses the captured date range and offense filter for every query', async () => {
  const calls = [];
  const fetchCountBuffer = async (params) => {
    calls.push(['count', params]);
    return 10;
  };
  const fetchTopTypesBuffer = async (params) => {
    calls.push(['top', params]);
    return { rows: [] };
  };

  await updateCompare({
    start: '2025-08-01',
    end: '2026-08-01',
    types: ['Robbery Firearm'],
    center3857: [1, 2],
    radiusM: 400,
    adminLevel: 'districts',
  }, {
    fetchers: { fetchCountBuffer, fetchTopTypesBuffer },
    view: { pending() {}, success() {}, error(error) { throw error; } },
  });

  assert.equal(calls[0][1].start, '2025-08-01');
  assert.equal(calls[0][1].end, '2026-08-01');
  const topCall = calls.find(([kind]) => kind === 'top')[1];
  assert.deepEqual(topCall.types, ['Robbery Firearm']);
});

test('address search uses the public Philadelphia geocoder and rejects weak matches', async () => {
  const { geocodePhiladelphiaAddress } = await import('../../src/api/geocoder.js');
  let requestedUrl;
  const result = await geocodePhiladelphiaAddress('1500 Market St', {
    request: async (url) => {
      requestedUrl = url;
      return {
        candidates: [{
          address: '1500 MARKET ST, 19102',
          score: 100,
          location: { x: -75.166154, y: 39.95218 },
        }],
      };
    },
  });
  assert.match(requestedUrl, /citygeo-geocoder-pub\.databridge\.phila\.gov/);
  assert.match(requestedUrl, /SingleLine=1500\+Market\+St/);
  assert.deepEqual(result, {
    address: '1500 MARKET ST, 19102',
    score: 100,
    lngLat: [-75.166154, 39.95218],
  });

  const intersection = await geocodePhiladelphiaAddress('Broad and Girard', {
    request: async () => ({
      candidates: [{
        address: 'N BROAD ST & W GIRARD AVE,, 19121',
        score: 100,
        location: { x: -75.16, y: 39.97 },
      }],
    }),
  });
  assert.equal(intersection.address, 'N BROAD ST & W GIRARD AVE, 19121');
  await assert.rejects(
    geocodePhiladelphiaAddress('uncertain', {
      minScore: 85,
      request: async () => ({ candidates: [{ address: 'Maybe', score: 40, location: { x: -75, y: 40 } }] }),
    }),
    /confident Philadelphia match/i,
  );
});

test('address ownership prevents an older response from replacing a newer result', async () => {
  const { createLatestGeocodeOwner } = await import('../../src/api/geocoder.js');
  const pending = new Map();
  const owner = createLatestGeocodeOwner({
    geocode: (address, { signal }) => new Promise((resolve, reject) => {
      pending.set(address, resolve);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  const older = owner.resolve('A', 'older');
  const newer = owner.resolve('A', 'newer');
  pending.get('newer')({ address: 'NEWER', lngLat: [-75.1, 39.9] });
  assert.deepEqual(await newer, { applied: true, result: { address: 'NEWER', lngLat: [-75.1, 39.9] } });
  assert.deepEqual(await older, { applied: false, result: null });
});

test('diary segment labels replace placeholder street names with a stable segment label', () => {
  assert.equal(
    getSegmentDisplayLabel({ properties: { street_name: 'Unknown' } }, 4),
    'Segment 4',
  );
  assert.equal(
    getSegmentDisplayLabel({ properties: { street_name: 'Chancellor Street' } }, 4),
    'Chancellor Street',
  );
});

test('compare calculates independent A and B metrics from the same analysis contract', async () => {
  const calls = [];
  let rendered;
  const fetchCountBuffer = async ({ center3857, start }) => {
    calls.push(['count', center3857, start]);
    return center3857[0] === 1 ? 10 : 20;
  };
  const result = await updateCompare({
    start: '2025-08-01',
    end: '2026-08-01',
    types: ['Robbery Firearm'],
    center3857: [1, 2],
    centerB3857: [3, 4],
    radiusM: 400,
    adminLevel: 'districts',
  }, {
    fetchers: {
      fetchCountBuffer,
      fetchTopTypesBuffer: async () => ({ rows: [] }),
    },
    view: { pending() {}, success(value) { rendered = value; }, error(error) { throw error; } },
  });
  assert.equal(calls.some(([, center]) => center[0] === 1), true);
  assert.equal(calls.some(([, center]) => center[0] === 3), true);
  assert.equal(result.a.total, 10);
  assert.equal(result.b.total, 20);
  assert.equal(rendered.b.total, 20);
});

test('comparison export is invalidated when current filters no longer match', async () => {
  const { getLastComparison } = await import('../../src/compare/card.js');
  const filters = {
    start: '2025-08-01', end: '2026-08-01', types: ['Robbery Firearm'],
    center3857: [1, 2], centerB3857: [3, 4], radiusM: 400,
    adminLevel: 'districts', per10k: false, addressA: 'Point A', addressB: 'Point B',
  };
  await updateCompare(filters, {
    fetchers: {
      fetchCountBuffer: async () => 10,
      fetchTopTypesBuffer: async () => ({ rows: [] }),
    },
    view: { pending() {}, success() {}, error(error) { throw error; } },
  });
  assert.ok(getLastComparison(filters));
  assert.equal(getLastComparison({ ...filters, radiusM: 800 }), null);
});

test('the real store export filter shape retains the current comparison', async (t) => {
  preserveStore(t);
  const { getLastComparison } = await import('../../src/compare/card.js');
  store.startMonth = '2025-08';
  store.durationMonths = 12;
  store.center3857 = [1, 2];
  store.centerB3857 = [3, 4];
  store.radius = 400;
  store.adminLevel = 'districts';
  store.per10k = false;
  store.addressA = 'Point A';
  store.addressB = 'Point B';
  await updateCompare(store.getFilters(), {
    fetchers: {
      fetchCountBuffer: async () => 10,
      fetchTopTypesBuffer: async () => ({ rows: [] }),
    },
    view: { pending() {}, success() {}, error(error) { throw error; } },
  });
  assert.ok(getLastComparison(store.getFilters()));
});

test('Crime layer visibility follows the current geography on every refresh', async () => {
  const { reconcileCrimeLayerVisibility } = await import('../../src/routes_crime/index.js');
  const visibility = new Map();
  const map = {
    getLayer: () => ({}),
    setLayoutProperty(id, property, value) { if (property === 'visibility') visibility.set(id, value); },
  };
  reconcileCrimeLayerVisibility(map, {
    adminLevel: 'tracts', overlayTractsLines: true, queryMode: 'tract',
    centerLonLat: null, centerBLonLat: null,
  });
  assert.equal(visibility.get('tracts-fill'), 'visible');
  assert.equal(visibility.get('districts-fill'), 'none');
  reconcileCrimeLayerVisibility(map, {
    adminLevel: 'districts', overlayTractsLines: false, queryMode: 'district',
    centerLonLat: null, centerBLonLat: null,
  });
  assert.equal(visibility.get('tracts-fill'), 'none');
  assert.equal(visibility.get('districts-fill'), 'visible');
});

test('boundary failure hides stale map results and visibly marks charts unavailable', async () => {
  const { markCrimeResultsUnavailable } = await import('../../src/routes_crime/index.js');
  const visibility = new Map();
  const elements = new Map([
    ['charts', { style: {} }],
    ['compare-card', { style: {} }],
    ['sidepanel', { prepend(element) { elements.set(element.id, element); } }],
  ]);
  const documentRef = {
    getElementById: (id) => elements.get(id) || null,
    createElement: () => ({ style: {}, setAttribute() {} }),
  };
  const map = {
    getLayer: () => ({}),
    setLayoutProperty(id, property, value) { if (property === 'visibility') visibility.set(id, value); },
  };
  markCrimeResultsUnavailable(map, 'Current results unavailable.', documentRef);
  assert.equal(visibility.get('districts-fill'), 'none');
  assert.equal(visibility.get('tracts-fill'), 'none');
  assert.equal(elements.get('charts').style.opacity, '0.35');
  assert.match(elements.get('crime-results-status').textContent, /unavailable/i);
});

test('share state round-trips every user-visible Crime analysis choice', async () => {
  const { encodeCrimeViewState, decodeCrimeViewState } = await import('../../src/state/crime_view_state.js');
  const encoded = encodeCrimeViewState({
    queryMode: 'tract',
    startMonth: '2025-08',
    durationMonths: 12,
    radius: 400,
    selectedGroups: ['vehicle'],
    selectedDrilldownCodes: ['Motor Vehicle Theft'],
    selectedDistrictCode: null,
    selectedTractGEOID: '42101000100',
    overlayTractsLines: true,
    centerLonLat: [-75.166154, 39.95218],
    centerBLonLat: [-75.2, 39.96],
    addressA: '1500 MARKET ST',
    addressB: 'UNIVERSITY CITY',
    per10k: true,
    classMethod: 'custom',
    classBins: 4,
    classPalette: 'OrRd',
    classOpacity: 0.6,
    classCustomBreaks: [1, 2, 3],
  });
  assert.deepEqual(decodeCrimeViewState(encoded), {
    queryMode: 'tract',
    startMonth: '2025-08',
    durationMonths: 12,
    radius: 400,
    selectedGroups: ['vehicle'],
    selectedDrilldownCodes: ['Motor Vehicle Theft'],
    selectedDistrictCode: null,
    selectedTractGEOID: '42101000100',
    overlayTractsLines: true,
    centerLonLat: [-75.166154, 39.95218],
    centerBLonLat: [-75.2, 39.96],
    addressA: '1500 MARKET ST',
    addressB: 'UNIVERSITY CITY',
    per10k: true,
    classMethod: 'custom',
    classBins: 4,
    classPalette: 'OrRd',
    classOpacity: 0.6,
    classCustomBreaks: [1, 2, 3],
  });
});

test('shared Crime state ignores unrelated parameters and rejects invalid ranges', async () => {
  const { decodeCrimeViewState, hasCrimeViewState } = await import('../../src/state/crime_view_state.js');
  assert.equal(hasCrimeViewState(new URLSearchParams('utm_source=portfolio')), false);
  assert.equal(hasCrimeViewState(new URLSearchParams('utm_source=portfolio&analysis=buffer')), true);
  const decoded = decodeCrimeViewState('months=&radius=999999&start=2026-99&bins=2.5&opacity=-2&district=x');
  assert.equal(decoded.durationMonths, 12);
  assert.equal(decoded.radius, 400);
  assert.equal(decoded.startMonth, null);
  assert.equal(decoded.classBins, 5);
  assert.equal(decoded.classOpacity, 0.75);
});

test('analysis export emits machine-readable JSON and spreadsheet-safe CSV', async () => {
  const { buildAnalysisExport, analysisExportToCsv } = await import('../../src/utils/export_analysis.js');
  const payload = buildAnalysisExport({
    filters: { start: '2025-08-01', end: '2026-08-01', types: ['Theft'] },
    comparison: { a: { label: '=unsafe', total: 10 }, b: { label: 'B', total: 20 } },
    generatedAt: '2026-07-31T00:00:00.000Z',
  });
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.comparison.b.total, 20);
  const csv = analysisExportToCsv(payload);
  assert.match(csv, /point,label,total/);
  assert.match(csv, /A,"'=unsafe",10/);
});

test('Diary local repository stores normalized route records without a backend', async () => {
  const {
    createDiaryEntry,
    createDiaryLocalRepository,
  } = await import('../../src/routes_diary/local_repository.js');
  const rows = new Map();
  const repository = createDiaryLocalRepository({
    adapter: {
      async put(value) { rows.set(value.id, structuredClone(value)); },
      async getAll() { return [...rows.values()].map((value) => structuredClone(value)); },
      async clear() { rows.clear(); },
      async replaceAll(values) { rows.clear(); for (const value of values) rows.set(value.id, structuredClone(value)); },
    },
  });
  const entry = createDiaryEntry({
    id: 'local-1',
    createdAt: '2026-07-31T00:00:00.000Z',
    payload: { overall_rating: 4, tags: ['poor lighting'], segment_ids: ['seg-1'] },
    routeFeature: {
      geometry: { type: 'LineString', coordinates: [[-75.2, 39.9], [-75.1, 40]] },
      properties: { route_id: 'route-1', name: 'Home to school', mode: 'bike', source_version: 'demo-2026-07' },
    },
  });
  await repository.save(entry);
  assert.deepEqual(await repository.list(), [entry]);
  assert.equal(entry.score, 4);
  assert.equal(entry.routeId, 'route-1');
  assert.equal(entry.routeGeometry.type, 'LineString');
  assert.equal(entry.routeSourceVersion, 'demo-2026-07');
});

test('Diary replacement is one adapter operation and unavailable storage fails visibly', async () => {
  const { createDiaryLocalRepository, createIndexedDbAdapter } = await import('../../src/routes_diary/local_repository.js');
  const calls = [];
  const repository = createDiaryLocalRepository({
    adapter: {
      async put() { calls.push('put'); },
      async getAll() { return []; },
      async clear() { calls.push('clear'); },
      async replaceAll(entries) { calls.push(['replaceAll', entries.length]); },
    },
  });
  await repository.replace([{ id: 'one' }]);
  assert.deepEqual(calls, [['replaceAll', 1]]);
  await assert.rejects(createIndexedDbAdapter(null).getAll(), /storage is unavailable/i);
});

test('Diary backup round-trips normalized entries and rejects unsupported schemas', async () => {
  const {
    createDiaryEntry,
    parseDiaryBackup,
    serializeDiaryBackup,
  } = await import('../../src/routes_diary/local_repository.js');
  const entry = createDiaryEntry({
    id: 'local-backup-1',
    createdAt: '2026-07-31T00:00:00.000Z',
    payload: { overall_rating: 5, tags: ['calm'], segment_ids: ['seg-2'] },
    routeFeature: {
      geometry: { type: 'LineString', coordinates: [[-75.2, 39.9], [-75.1, 40]] },
      properties: { route_id: 'route-2', name: 'Park loop', mode: 'walk' },
    },
  });
  const backup = serializeDiaryBackup([entry], { generatedAt: '2026-07-31T01:00:00.000Z' });
  assert.deepEqual(parseDiaryBackup(JSON.stringify(backup)), [entry]);
  assert.throws(
    () => parseDiaryBackup(JSON.stringify({ schemaVersion: 99, entries: [] })),
    /unsupported diary backup/i,
  );
  assert.throws(
    () => parseDiaryBackup(JSON.stringify({ schemaVersion: 1, entries: [{ id: 'bad' }] })),
    /invalid diary entry/i,
  );
});

test('Diary insights derive trend, tags, and time cells from local records', async () => {
  const { deriveLocalDiaryInsights } = await import('../../src/charts/diary_insights.js');
  const insights = deriveLocalDiaryInsights([
    { createdAt: '2026-07-27T20:00:00.000Z', score: 2, tags: ['poor_lighting'] },
    { createdAt: '2026-07-28T21:00:00.000Z', score: 4, tags: ['poor_lighting', 'speeding_cars'] },
  ]);
  assert.deepEqual(insights.trend, [2, 4]);
  assert.deepEqual(insights.tags[0], { label: 'poor lighting', value: 2 });
  assert.equal(insights.heatmap.flat().reduce((sum, value) => sum + value, 0), 2);
  const hostSource = await readFile(new URL('../../src/routes_diary/ui_insights_panel.js', import.meta.url), 'utf8');
  assert.match(hostSource, /setEntries\(entries\)[\s\S]*setDiaryInsightEntries\(entries\)/);
  assert.doesNotMatch(hostSource, /Demo visuals/);
});

test('Diary trend uses the latest eight ratings in chronological order', async () => {
  const { deriveLocalDiaryInsights } = await import('../../src/charts/diary_insights.js');
  const entries = Array.from({ length: 10 }, (_, index) => ({
    createdAt: `2026-07-${String(10 - index).padStart(2, '0')}T12:00:00.000Z`,
    score: 10 - index,
    tags: [],
  }));
  assert.deepEqual(deriveLocalDiaryInsights(entries).trend, [3, 4, 5, 6, 7, 8, 9, 10]);
});

test('Diary alternative-route and simulation algorithms are isolated from the controller', async () => {
  const { resolveAlternativeForRoute, summarizeAlternativeBenefit } = await import('../../src/routes_diary/alternative_route.js');
  const { buildSimulationCoordinates } = await import('../../src/routes_diary/route_simulator.js');
  const route = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[-75.2, 39.9], [-75.19, 39.91]] },
    properties: {
      route_id: 'route-1',
      segment_ids: ['seg-1', 'seg-2'],
      alt_segment_ids: ['seg-3'],
      length_m: 1000,
      duration_min: 10,
      alt_length_m: 1100,
      alt_duration_min: 11,
      alt_geometry: { type: 'LineString', coordinates: [[-75.2, 39.9], [-75.18, 39.92]] },
    },
  };
  const alternative = resolveAlternativeForRoute(route, { getSegment: () => null });
  assert.equal(alternative.feature.properties.route_id, 'route-1_alt');
  assert.deepEqual(summarizeAlternativeBenefit(route, alternative.meta, {
    countLowRated: (ids) => ids.includes('seg-1') ? 2 : 0,
  }), { pLow: 2, aLow: 0, overheadPct: 10, deltaMin: 1 });
  assert.equal(buildSimulationCoordinates(route.geometry).length > route.geometry.coordinates.length, true);
});

test('Community UI is explicitly sample-only and has no fake post action', async () => {
  const [communitySource, liveSource] = await Promise.all([
    readFile(new URL('../../src/routes_diary/ui_community_panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_diary/ui_live_panel.js', import.meta.url), 'utf8'),
  ]);
  assert.match(communitySource, /Sample Community/);
  assert.match(communitySource, /read-only/i);
  assert.doesNotMatch(communitySource, /onPostComment/);
  assert.doesNotMatch(communitySource, /type\s*=\s*['"]range['"]|onRadiusChange|onSelectSegment/);
  assert.match(liveSource, /Open My routes/);
  assert.doesNotMatch(liveSource, /coming soon/i);
});

test('buffer Top-N chart receives the same offense filter as monthly and heat charts', async () => {
  let topParams;
  const emptyRows = async () => ({ rows: [] });
  await updateAllCharts({
    start: '2025-08-01',
    end: '2026-08-01',
    types: ['Robbery Firearm'],
    center3857: [1, 2],
    radiusM: 400,
    queryMode: 'buffer',
  }, {
    fetchers: {
      fetchMonthlySeriesCity: emptyRows,
      fetchMonthlySeriesBuffer: emptyRows,
      fetchTopTypesBuffer: async (params) => {
        topParams = params;
        return { rows: [] };
      },
      fetch7x24Buffer: emptyRows,
    },
    sinks: { status() {}, monthly() {}, top() {}, heat() {}, error(error) { throw error; } },
  });

  assert.deepEqual(topParams.types, ['Robbery Firearm']);
});

test('Top-N SQL applies the resolved offense filter', () => {
  const sql = buildTopTypesSQL({
    start: '2025-08-01',
    end: '2026-08-01',
    types: ['Robbery Firearm'],
    center3857: [1, 2],
    radiusM: 400,
    limit: 3,
  });

  assert.match(sql, /text_general_code IN \('Robbery Firearm'\)/);
});

test('Diary submission completion consumes payload and transport result as one contract', () => {
  assert.equal(typeof diaryModule.handleDiarySubmissionSuccess, 'function');
  const calls = [];
  const payload = { segment_ids: ['seg-1'], overall_rating: 4 };
  const response = { persisted: false, mode: 'demo' };

  diaryModule.handleDiarySubmissionSuccess({ payload, response }, {
    aggregationModel: {
      applySubmission(value) { calls.push(['apply', value]); },
      buildFeatureCollection() { return { type: 'FeatureCollection', features: [] }; },
    },
    map: null,
    refreshAlternativeRoute() { calls.push(['alternative']); },
    notify(message) { calls.push(['toast', message]); },
    notifyPanel(message) { calls.push(['panel', message]); },
    highlightSegments(ids) { calls.push(['highlight', ids]); },
  });

  assert.deepEqual(calls[0], ['apply', payload]);
  assert.match(calls.find(([kind]) => kind === 'toast')[1], /browser demo only/i);
  assert.deepEqual(calls.find(([kind]) => kind === 'highlight')[1], ['seg-1']);
});

test('tract snapshot values honor the same resolved offense filter as the rest of Crime', () => {
  assert.equal(typeof tractView.mergeTractSnapshotData, 'function');
  const result = tractView.mergeTractSnapshotData({
    tracts: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { GEOID: '42101000100' }, geometry: null },
        { type: 'Feature', properties: { GEOID: '42101000200' }, geometry: null },
      ],
    },
    stats: [
      { geoid: '42101000100', pop: 1000 },
      { geoid: '42101000200', pop: 2000 },
    ],
    snapshot: {
      meta: { schema_version: 2, start: '2025-08-01', end: '2026-08-01', row_count: 2 },
      rows: [
        {
          geoid: '42101000100',
          total: 7,
          offenses: [
            { code: 'Robbery Firearm', n: 2 },
            { code: 'Theft', n: 5 },
          ],
        },
        { geoid: '42101000200', total: 4, offenses: [{ code: 'Theft', n: 4 }] },
      ],
    },
    start: '2025-08-01',
    end: '2026-08-01',
    types: ['Robbery Firearm'],
    per10k: false,
  });

  assert.equal(result.dataStatus, 'available');
  assert.deepEqual(result.values, [2, 0]);
});

test('tract snapshot requires the exact current tract identity set', () => {
  const result = tractView.mergeTractSnapshotData({
    tracts: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { GEOID: '42101000100' }, geometry: null }],
    },
    stats: [{ geoid: '42101000100', pop: 1000 }],
    snapshot: {
      meta: { schema_version: 2, start: '2025-08-01', end: '2026-08-01', row_count: 1 },
      rows: [{ geoid: '42101099900', total: 1, offenses: [] }],
    },
    start: '2025-08-01',
    end: '2026-08-01',
  });
  assert.equal(result.dataStatus, 'unavailable');
  assert.match(result.statusMessage, /geography does not match/i);
});

test('tract snapshot rejects duplicate or missing GEOIDs in live boundary features', () => {
  const result = tractView.mergeTractSnapshotData({
    tracts: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { GEOID: '42101000100' }, geometry: null },
        { type: 'Feature', properties: { GEOID: '42101000100' }, geometry: null },
      ],
    },
    stats: [{ geoid: '42101000100', pop: 1000 }],
    snapshot: {
      meta: { schema_version: 2, start: '2025-08-01', end: '2026-08-01', row_count: 2 },
      rows: [
        { geoid: '42101000100', total: 1, offenses: [] },
        { geoid: '42101000200', total: 2, offenses: [] },
      ],
    },
    start: '2025-08-01',
    end: '2026-08-01',
  });
  assert.equal(result.dataStatus, 'unavailable');
  assert.deepEqual(result.values, []);
});

test('missing or mismatched tract snapshot is unavailable rather than a true zero dataset', () => {
  assert.equal(typeof tractView.mergeTractSnapshotData, 'function');
  const result = tractView.mergeTractSnapshotData({
    tracts: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { GEOID: '42101000100' }, geometry: null }],
    },
    stats: [{ geoid: '42101000100', pop: 1000 }],
    snapshot: {
      meta: { schema_version: 2, start: '2025-08-01', end: '2026-08-01' },
      rows: [],
    },
    start: '2025-09-01',
    end: '2026-08-01',
    types: [],
    per10k: false,
  });

  assert.equal(result.dataStatus, 'unavailable');
  assert.deepEqual(result.values, []);
  assert.match(result.statusMessage, /does not cover/i);
  assert.equal(result.geojson.features[0].properties.value, null);
});
