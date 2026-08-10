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
