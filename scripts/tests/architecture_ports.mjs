#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  CRIME_STATE_ACTIONS,
  createCrimeStatePort,
} from '../../src/state/crime_state_port.js';

function createCrimeState() {
  return {
    viewMode: 'crime',
    queryMode: 'buffer',
    startMonth: '2025-01',
    durationMonths: 12,
    radius: 400,
    selectedGroups: ['vehicle'],
    selectedTypes: ['Motor Vehicle Theft'],
    selectedDrilldownCodes: [],
    selectedDistrictCode: null,
    selectedTractGEOID: null,
    overlayTractsLines: false,
    centerLonLat: null,
    center3857: null,
    centerBLonLat: null,
    centerB3857: null,
    addressA: null,
    addressB: null,
    per10k: false,
    classMethod: 'quantile',
    classBins: 5,
    classPalette: 'Blues',
    classOpacity: 0.75,
    classCustomBreaks: [],
    selectMode: 'point',
    selectTarget: 'A',
    setComparisonPoint(target, lng, lat, label) {
      const projected = [`projected-${target}`];
      if (target === 'B') {
        this.centerBLonLat = [lng, lat];
        this.centerB3857 = projected;
        this.addressB = label || this.addressB;
      } else {
        this.centerLonLat = [lng, lat];
        this.center3857 = projected;
        this.addressA = label || this.addressA;
      }
    },
  };
}

test('Crime state port reads canonical snapshots without exposing mutable store references', () => {
  const state = createCrimeState();
  const port = createCrimeStatePort({ state });

  const snapshot = port.readSnapshot();
  snapshot.selectedGroups.push('person');

  assert.deepEqual(state.selectedGroups, ['vehicle']);
  assert.deepEqual(port.readSnapshot().selectedGroups, ['vehicle']);
  assert.equal(snapshot.selectMode, undefined);
  assert.equal(snapshot.center3857, undefined);
});

test('Crime URL, preset, and history actions reuse the canonical codec and restore semantics', () => {
  const state = createCrimeState();
  const modes = [];
  const port = createCrimeStatePort({
    state,
    setMode(mode) {
      modes.push(mode);
      state.queryMode = mode;
    },
  });

  port.mutate(CRIME_STATE_ACTIONS.RESTORE_URL, 'analysis=tract&tract=42101000100&months=24&radius=1375');
  assert.equal(state.queryMode, 'tract');
  assert.equal(state.selectedTractGEOID, '42101000100');
  assert.equal(state.radius, 1375);

  port.mutate(CRIME_STATE_ACTIONS.REPLACE_PRESET, {
    ...port.readSnapshot(),
    startMonth: '2024-08',
    durationMonths: 24,
  });
  assert.equal(state.startMonth, '2024-08');
  assert.equal(state.durationMonths, 24);
  assert.equal(state.selectedTypes.length, 0);

  state.center3857 = ['stale'];
  port.mutate(CRIME_STATE_ACTIONS.RESTORE_HISTORY, {
    queryMode: 'buffer',
    centerLonLat: [-75.16, 39.95],
    addressA: 'Saved point',
    durationMonths: 12,
    radius: 400,
  });
  assert.deepEqual(state.centerLonLat, [-75.16, 39.95]);
  assert.deepEqual(state.center3857, ['projected-A']);
  assert.equal(state.addressA, 'Saved point');
  assert.deepEqual(modes, ['tract', 'tract', 'buffer']);
});

test('Crime map selection actions mutate only named query interaction state', () => {
  const state = createCrimeState();
  const port = createCrimeStatePort({ state });

  port.mutate(CRIME_STATE_ACTIONS.SELECT_TRACT, { geoid: '42101000100' });
  assert.equal(state.selectedTractGEOID, '42101000100');
  port.mutate(CRIME_STATE_ACTIONS.SELECT_DISTRICT, { code: '09' });
  assert.equal(state.selectedDistrictCode, '09');
  port.mutate(CRIME_STATE_ACTIONS.SELECT_POINT, {
    target: 'B',
    lng: -75.2,
    lat: 39.96,
    label: 'Map point B',
  });
  assert.deepEqual(state.centerBLonLat, [-75.2, 39.96]);
  assert.equal(state.addressB, 'Map point B');
  port.mutate(CRIME_STATE_ACTIONS.END_MAP_SELECTION);
  assert.equal(state.selectMode, 'idle');

  assert.throws(() => port.mutate('crime.unknown'), /Unknown Crime state action/);
});

test('Crime panel query actions use canonical state owners through the port', () => {
  const state = createCrimeState();
  state.coverageStatus = 'ready';
  state.coverageMin = '2024-01-01';
  state.coverageMax = '2026-08-08';
  const calls = { modes: [], normalized: 0, cleared: 0 };
  const port = createCrimeStatePort({
    state,
    setMode(mode) {
      calls.modes.push(mode);
      state.queryMode = mode;
      state.per10k = mode === 'tract' ? state.per10k : false;
    },
    normalizeCoverage(target) {
      calls.normalized += 1;
      target.startMonth ||= '2025-09';
    },
    clearSelection(target) {
      calls.cleared += 1;
      target.selectedDistrictCode = null;
      target.selectedTractGEOID = null;
      target.selectMode = 'idle';
    },
  });

  port.mutate(CRIME_STATE_ACTIONS.SET_MODE, { mode: 'tract' });
  port.mutate(CRIME_STATE_ACTIONS.SET_RADIUS, { radius: 1375 });
  port.mutate(CRIME_STATE_ACTIONS.SET_OFFENSE_GROUPS, {
    groups: ['vehicle'],
    resetHighlights: true,
  });
  port.mutate(CRIME_STATE_ACTIONS.SET_OFFENSE_HIGHLIGHTS, {
    codes: ['Thefts', 'thefts', 'Motor Vehicle Theft'],
  });
  port.mutate(CRIME_STATE_ACTIONS.SET_RATE, { per10k: true });
  port.mutate(CRIME_STATE_ACTIONS.SET_TRACT_OVERLAY, { visible: true });
  port.mutate(CRIME_STATE_ACTIONS.SET_CLASSIFICATION, {
    classMethod: 'custom',
    classBins: 7,
    classPalette: 'Greens',
    classOpacity: 0.6,
    classCustomBreaks: [1, 2, 3],
  });
  port.mutate(CRIME_STATE_ACTIONS.SET_TIME_WINDOW, {
    startMonth: '2025-01',
    durationMonths: 24,
  });
  port.mutate(CRIME_STATE_ACTIONS.BEGIN_MAP_SELECTION, { target: 'B' });

  assert.equal(state.queryMode, 'tract');
  assert.equal(state.radius, 1375);
  assert.deepEqual(state.selectedGroups, ['vehicle']);
  assert.deepEqual(state.selectedTypes, ['Motor Vehicle Theft', 'DRIVING UNDER THE INFLUENCE']);
  assert.deepEqual(state.selectedDrilldownCodes, ['Thefts', 'thefts', 'Motor Vehicle Theft']);
  assert.equal(state.per10k, true);
  assert.equal(state.overlayTractsLines, true);
  assert.equal(state.classMethod, 'custom');
  assert.equal(state.classBins, 7);
  assert.equal(state.classPalette, 'Greens');
  assert.equal(state.classOpacity, 0.6);
  assert.deepEqual(state.classCustomBreaks, [1, 2, 3]);
  assert.equal(state.startMonth, '2025-01');
  assert.equal(state.durationMonths, 24);
  assert.equal(state.selectMode, 'point');
  assert.equal(state.selectTarget, 'B');
  assert.equal(state.coverageStatus, 'ready');
  assert.equal(state.coverageMin, '2024-01-01');
  assert.equal(state.coverageMax, '2026-08-08');
  assert.deepEqual(calls, { modes: ['tract'], normalized: 1, cleared: 0 });

  port.mutate(CRIME_STATE_ACTIONS.SET_TIME_WINDOW, { startMonth: null });
  assert.equal(state.startMonth, '2025-09');
  assert.equal(calls.normalized, 2);

  state.centerBLonLat = [-75.2, 39.96];
  state.centerB3857 = ['projected-B'];
  state.addressB = 'Comparison B';
  port.mutate(CRIME_STATE_ACTIONS.CLEAR_COMPARISON, { target: 'B' });
  assert.equal(state.centerBLonLat, null);
  assert.equal(state.centerB3857, null);
  assert.equal(state.addressB, '');
  assert.equal(state.selectMode, 'idle');

  port.mutate(CRIME_STATE_ACTIONS.CLEAR_SELECTION);
  assert.equal(calls.cleared, 1);
});

test('Crime UI and route coordinators do not assign query-owned fields directly', async () => {
  const queryOwnedFields = [
    'queryMode', 'startMonth', 'durationMonths', 'radius',
    'selectedGroups', 'selectedTypes', 'selectedDrilldownCodes',
    'selectedDistrictCode', 'selectedTractGEOID', 'overlayTractsLines',
    'centerLonLat', 'center3857', 'centerBLonLat', 'centerB3857',
    'addressA', 'addressB', 'per10k',
    'classMethod', 'classBins', 'classPalette', 'classOpacity', 'classCustomBreaks',
    'selectMode', 'selectTarget',
  ];
  const files = [
    new URL('../../src/ui/panel.js', import.meta.url),
    new URL('../../src/routes_crime/index.js', import.meta.url),
    new URL('../../src/routes_crime/crime_map_selection_coordinator.js', import.meta.url),
  ];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const field of queryOwnedFields) {
      assert.doesNotMatch(
        source,
        new RegExp(`\\b(?:store|state)\\.${field}\\s*=(?!=)`),
        `${file.pathname} must mutate ${field} through crimeStatePort`,
      );
    }
    assert.doesNotMatch(source, /\bstore\.setComparisonPoint\s*\(/);
  }
});

test('Crime map selection coordinator dispatches actions before presentation callbacks', async () => {
  const { createCrimeMapSelectionCoordinator } = await import(
    '../../src/routes_crime/crime_map_selection_coordinator.js'
  );
  const listeners = new Map();
  const map = {
    getLayer(layer) {
      return layer === 'tracts-fill' || layer === 'districts-fill';
    },
    on(event, layerOrHandler, maybeHandler) {
      const layer = typeof layerOrHandler === 'string' ? layerOrHandler : '*';
      const handler = typeof layerOrHandler === 'function' ? layerOrHandler : maybeHandler;
      listeners.set(`${event}:${layer}`, handler);
    },
  };
  const state = createCrimeState();
  const calls = [];
  const statePort = {
    mutate(action, payload) {
      calls.push(['mutate', action, payload]);
      if (action === CRIME_STATE_ACTIONS.SELECT_POINT) {
        state.setComparisonPoint(payload.target, payload.lng, payload.lat, payload.label);
      }
      if (action === CRIME_STATE_ACTIONS.END_MAP_SELECTION) state.selectMode = 'idle';
    },
  };
  const coordinator = createCrimeMapSelectionCoordinator({
    map,
    state,
    statePort,
    isActive: () => true,
    readTractId: feature => feature?.properties?.GEOID,
    translate: (_key, { target }) => `Point ${target}`,
    onTractSelected(selection) {
      calls.push(['tract', selection.geoid]);
    },
    onDistrictSelected(selection) {
      calls.push(['district', selection.code]);
    },
    onPointSelected(selection) {
      calls.push(['point', selection.target, state.selectMode]);
    },
    onPointSelectionEnded(selection) {
      calls.push(['ended', selection.target, state.selectMode]);
    },
  });

  assert.equal(coordinator.wireTractSelection(), true);
  assert.equal(coordinator.wireTractSelection(), false);
  assert.equal(coordinator.wireDistrictSelection(), true);
  assert.equal(coordinator.wireDistrictSelection(), false);

  state.queryMode = 'tract';
  listeners.get('click:tracts-fill')({ features: [{ properties: { GEOID: '42101000100' } }] });
  state.queryMode = 'district';
  listeners.get('click:districts-fill')({ features: [{ properties: { DIST_NUMC: 9 } }] });
  state.queryMode = 'buffer';
  state.selectMode = 'point';
  state.selectTarget = 'B';
  listeners.get('click:*')({ lngLat: { lng: -75.2, lat: 39.96 } });

  assert.deepEqual(calls, [
    ['mutate', CRIME_STATE_ACTIONS.SELECT_TRACT, { geoid: '42101000100' }],
    ['tract', '42101000100'],
    ['mutate', CRIME_STATE_ACTIONS.SELECT_DISTRICT, { code: '09' }],
    ['district', '09'],
    ['mutate', CRIME_STATE_ACTIONS.SELECT_POINT, {
      target: 'B', lng: -75.2, lat: 39.96, label: 'Point B',
    }],
    ['point', 'B', 'point'],
    ['mutate', CRIME_STATE_ACTIONS.END_MAP_SELECTION, undefined],
    ['ended', 'B', 'idle'],
  ]);
});

test('map infrastructure has no Diary business submit import and Diary root injects the port', async () => {
  const [segmentsLayer, diaryRoute] = await Promise.all([
    readFile(new URL('../../src/map/segments_layer.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_diary/index.js', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(segmentsLayer, /routes_diary\/form_submit/);
  assert.match(segmentsLayer, /submitFeedback/);
  assert.match(diaryRoute, /submitSegmentFeedback/);
  assert.match(diaryRoute, /submitFeedback:\s*submitSegmentFeedback/);
});
