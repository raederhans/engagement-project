#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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
import { readProductCss } from './helpers/css_source.mjs';
import { messages } from '../../src/i18n/messages.js';
import {
  createRouteSummaryModel as createRouteSummaryModelOwner,
  filterLocalDiaryEntries as filterLocalDiaryEntriesOwner,
} from '../../src/routes_diary/diary_view_models.js';
import {
  loadDemoRoutes as loadDemoRoutesOwner,
  loadDemoSegments as loadDemoSegmentsOwner,
} from '../../src/routes_diary/diary_seed_data.js';
import './evidence_bundle_v2.mjs';

const { store } = stateModule;
const evidenceBundleUrl = new URL('../../src/analysis/evidence_bundle.js', import.meta.url);

function evidenceSource(overrides = {}) {
  return {
    id: 'philadelphia-reported-crime',
    dataset: 'incidents_part1_part2',
    status: 'available',
    url: 'https://phl.carto.com/api/v2/sql',
    provider: 'City of Philadelphia via CARTO',
    vintage: '2026-07-30',
    asOf: '2026-07-30',
    retrievedAt: '2026-08-10T00:00:00.000Z',
    revisionPolicy: 'Provider records may be revised after retrieval.',
    coverage: { start: '2006-01-01', end: '2026-07-30', geography: 'Philadelphia' },
    snapshotIdentity: 'coverage:2006-01-01:2026-07-30',
    ...overrides,
  };
}

function evidenceQuery(overrides = {}) {
  return {
    type: 'crime-analysis',
    timeRange: {
      start: '2025-08-01',
      endExclusive: '2026-08-01',
      timeZone: 'America/New_York',
    },
    offenseCodes: ['Thefts'],
    geography: {
      mode: 'buffer',
      radiusM: 400,
      exactSelection: 'omitted-for-privacy',
    },
    comparisonRequested: false,
    display: {
      adminLevel: 'districts',
      per10k: false,
    },
    ...overrides,
  };
}

function evidenceResult(overrides = {}) {
  return {
    status: 'available',
    comparison: {
      a: {
        point: 'A',
        status: 'available',
        total: 0,
      },
    },
    ...overrides,
  };
}

function evidenceInput(overrides = {}) {
  return {
    schemaVersion: 'engagement-evidence-bundle/v1',
    generatedAt: '2026-08-10T00:00:00.000Z',
    query: evidenceQuery(),
    result: evidenceResult(),
    provenance: { sources: [evidenceSource()] },
    limitations: ['Historical reported records are not a complete measure of safety.'],
    privacy: { mode: 'aggregate-only', excludedFields: ['raw incident rows', 'exact addresses'] },
    ...overrides,
  };
}

test('Evidence Bundle v1 uses stable browser-native SHA-256 section hashes', async () => {
  assert.equal(existsSync(evidenceBundleUrl), true, 'Evidence Bundle composer must exist');
  const { canonicalSerialize, composeEvidenceBundle } = await import(evidenceBundleUrl);
  const first = await composeEvidenceBundle(evidenceInput());
  const second = await composeEvidenceBundle(evidenceInput({
    generatedAt: '2026-08-10T12:00:00.000Z',
    query: {
      display: { per10k: false, adminLevel: 'districts' },
      comparisonRequested: false,
      geography: { exactSelection: 'omitted-for-privacy', radiusM: 400, mode: 'buffer' },
      offenseCodes: ['Thefts'],
      timeRange: { timeZone: 'America/New_York', endExclusive: '2026-08-01', start: '2025-08-01' },
      type: 'crime-analysis',
    },
    provenance: { sources: [evidenceSource({ retrievedAt: '2026-08-10T12:00:00.000Z' })] },
  }));
  const expectedQueryHash = [...new Uint8Array(await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalSerialize(evidenceQuery())),
  ))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

  assert.equal(first.schemaVersion, 'engagement-evidence-bundle/v1');
  assert.equal(first.checksums.algorithm, 'SHA-256');
  assert.equal(first.checksums.query, expectedQueryHash);
  assert.deepEqual(first.checksums, second.checksums, 'volatile export timestamps must not change section hashes');
  assert.equal(first.snapshotIdentity, second.snapshotIdentity);
});

test('Evidence Bundle v1 rejects sensitive fields and unknown schema versions', async () => {
  assert.equal(existsSync(evidenceBundleUrl), true, 'Evidence Bundle composer must exist');
  const { composeEvidenceBundle } = await import(evidenceBundleUrl);
  for (const field of [
    'incidentRows', 'incidents', 'rows', 'features', 'exactAddress', 'label',
    'location', 'gpsTrace', 'diaryNotes', 'notes', 'routeGeometry', 'route', 'mediaUrl',
    'photoUrls', 'imageUrl', 'videoUrls', 'attachments', 'geometry', 'coordinates',
    'center3857', 'centerLonLat', 'bbox', 'lat', 'lng', 'latitude', 'longitude',
  ]) {
    await assert.rejects(
      composeEvidenceBundle(evidenceInput({ query: { type: 'crime-analysis', [field]: 'sensitive' } })),
      new RegExp(field, 'i'),
    );
  }
  for (const [field, mutate] of [
    ['description', (input) => { input.query.description = '1500 Market St'; }],
    ['data', (input) => { input.result.data = [{ dispatch_date_time: 'raw incident' }]; }],
    ['memo', (input) => { input.provenance.memo = '1500 Market St'; }],
    ['polyline', (input) => { input.query.geography.polyline = 'encoded-route'; }],
    ['link', (input) => { input.provenance.sources[0].coverage.link = 'https://example.test/private'; }],
  ]) {
    const candidate = evidenceInput();
    mutate(candidate);
    await assert.rejects(
      composeEvidenceBundle(candidate),
      new RegExp(field, 'i'),
      `unknown v1 field ${field} must fail closed`,
    );
  }
  await assert.rejects(
    composeEvidenceBundle(evidenceInput({ schemaVersion: 'engagement-evidence-bundle/v2' })),
    /schema/i,
  );
});

test('Evidence Bundle keeps source unavailable distinct from an admitted aggregate zero', async () => {
  assert.equal(existsSync(evidenceBundleUrl), true, 'Evidence Bundle composer must exist');
  const { composeEvidenceBundle } = await import(evidenceBundleUrl);
  const unavailable = await composeEvidenceBundle(evidenceInput({
    result: { status: 'unavailable' },
    provenance: { sources: [evidenceSource({ status: 'unavailable', vintage: null, asOf: null, retrievedAt: null, snapshotIdentity: null })] },
  }));
  assert.equal(unavailable.result.status, 'unavailable');
  assert.equal(unavailable.provenance.sources[0].status, 'unavailable');
  assert.equal(Object.hasOwn(unavailable.result, 'total'), false);

  const zero = await composeEvidenceBundle(evidenceInput());
  assert.equal(zero.result.status, 'available');
  assert.equal(zero.result.comparison.a.total, 0);
  const withoutRetrievalEvidence = await composeEvidenceBundle(evidenceInput({
    provenance: { sources: [evidenceSource({ retrievedAt: null })] },
  }));
  assert.equal(withoutRetrievalEvidence.provenance.sources[0].retrievedAt, null);
  await assert.rejects(
    composeEvidenceBundle(evidenceInput({
      provenance: { sources: [evidenceSource({ status: 'unavailable' })] },
    })),
    /unavailable/i,
  );
});

test('Diary view models have one focused owner and remain available from the lazy facade', () => {
  assert.equal(diaryModule.createRouteSummaryModel, createRouteSummaryModelOwner);
  assert.equal(diaryModule.filterLocalDiaryEntries, filterLocalDiaryEntriesOwner);
});

test('Diary seed loading has one cache owner and remains available from the lazy facade', () => {
  assert.equal(diaryModule.loadDemoSegments, loadDemoSegmentsOwner);
  assert.equal(diaryModule.loadDemoRoutes, loadDemoRoutesOwner);
});

test('Diary reader copy and Sample Community visuals stay personal, illustrative, and neutral', async () => {
  const [communitySource, diaryCss, html] = await Promise.all([
    readFile(new URL('../../src/routes_diary/ui_community_panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/styles/diary-map-ui.css', import.meta.url), 'utf8'),
    readFile(new URL('../../index.html', import.meta.url), 'utf8'),
  ]);
  for (const locale of ['en', 'zh-CN']) {
    assert.match(messages[locale]['diary.title'], locale === 'en' ? /Route Experience Diary/ : /路线体验日记/);
    const diaryCopy = Object.entries(messages[locale])
      .filter(([key]) => /^(diary|rating|segment)\./.test(key))
      .map(([, value]) => value)
      .join('\n');
    assert.doesNotMatch(
      diaryCopy,
      /Route Safety Diary|safety score|community safety score|High risk|Moderate risk|Generally safe|safer route|safest route|路线安全日记|安全评分|社区安全评分|高风险|中等风险|总体安全/iu,
    );
    assert.match(messages[locale]['diary.communityNotice'], locale === 'en' ? /static/i : /静态/u);
    assert.match(messages[locale]['diary.communityNotice'], locale === 'en' ? /not real-time/i : /非实时/u);
    assert.match(messages[locale]['diary.communityNotice'], locale === 'en' ? /not user-submitted/i : /非用户投稿/u);
    assert.match(messages[locale]['diary.communityNotice'], locale === 'en' ? /not representative of any population/i : /不代表任何总体/u);
    assert.match(messages[locale]['diary.communityNotice'], locale === 'en' ? /no official endorsement/i : /没有官方背书/u);
  }
  assert.match(html, /browser-local trip notes/i);
  assert.doesNotMatch(communitySource, /is-good|is-mid|is-bad|is-order-(?:low|middle|high)|high concern/i);
  assert.doesNotMatch(diaryCss, /\.diary-score-pill\.is-(?:good|mid|bad|order-low|order-middle|order-high)/);
  assert.match(diaryCss, /\.diary-score-pill\s*\{[^}]*background:\s*#e2e8f0/s);
});

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
    classPalette: store.classPalette,
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
  store.classPalette = 'OrRd';

  const filters = store.getFilters();

  assert.deepEqual(filters.types, ['Motor Vehicle Theft']);
  assert.deepEqual(filters.resolvedOffenseCodes, ['Motor Vehicle Theft']);
  assert.equal(filters.classPalette, 'OrRd');
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
    text: 'Data available: records from 2006-01-01 through 2026-07-30',
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
  assert.match(
    panelSource,
    /crimeState\.mutate\(CRIME_STATE_ACTIONS\.SET_MODE,\s*\{ mode \}\)/,
  );
});

test('mobile layout keeps results in the same scroll column as controls', async () => {
  const [mainSource, styleSource] = await Promise.all([
    readFile(new URL('../../src/main.js', import.meta.url), 'utf8'),
    readProductCss(),
  ]);
  assert.match(mainSource, /appendChild\(root\)|append\(root\)/);
  assert.match(mainSource, /if\s*\(diaryShell\)\s*diaryShell\.after\(root\)/);
  assert.doesNotMatch(mainSource, /\(diaryShell \|\| document\.body\)\.appendChild\(root\)/);
  assert.match(styleSource, /@media\s*\(max-width:\s*720px\)/);
  assert.match(styleSource, /#compare-card,\s*\n#charts\s*\{[^}]*position:\s*static/s);
  assert.match(styleSource, /@media\s*\(max-width:\s*720px\)[\s\S]*#sidepanel\s*\{[^}]*bottom:\s*0/s);
  assert.doesNotMatch(styleSource, /!important/, 'mobile layout must not depend on cascade overrides');
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

test('coverage canonicalizes live CARTO timestamps before publishing result metadata', (t) => {
  preserveStore(t);
  store.startMonth = null;
  store.durationMonths = 12;

  stateModule.applyCoverageToState(store, {
    min: '2006-01-01T00:00:00Z',
    max: '2026-08-03T00:00:00Z',
  });

  assert.equal(store.coverageMin, '2006-01-01');
  assert.equal(store.coverageMax, '2026-08-03');
  assert.throws(() => stateModule.applyCoverageToState(store, {
    min: '2006-01-01T00:00:00Z',
    max: '2026-08-03Tnot-a-time',
  }), /invalid maximum date/i);
  assert.throws(() => stateModule.applyCoverageToState(store, {
    min: '2006-01-01T00:00:00Z',
    max: '2026-02-31T00:00:00Z',
  }), /invalid maximum date/i);
  assert.throws(() => stateModule.applyCoverageToState(store, {
    min: '2006-01-01T00:00:00Z',
    max: '2026-08-03T25:99:99Z',
  }), /invalid maximum date/i);
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

test('comparison summary counts each point once and does not synthesize a sparse 30-day trend', async () => {
  const countCalls = [];
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
      fetchCountBuffer: async (params) => {
        countCalls.push(params);
        return params.center3857[0] === 1 ? 10 : 20;
      },
      fetchTopTypesBuffer: async () => ({ rows: [] }),
    },
    view: { pending() {}, success() {}, error(error) { throw error; } },
  });

  assert.equal(countCalls.length, 2, 'each point should issue only its selected-window count query');
  assert.equal(countCalls.every(({ start, end }) => start === '2025-08-01' && end === '2026-08-01'), true);
  assert.equal(result.a.delta30, null);
  assert.equal(result.b.delta30, null);
});

test('private address search is unavailable before any geocoder request', async () => {
  const {
    findPhiladelphiaPropertyAddressCandidates,
    geocodePhiladelphiaAddress,
  } = await import('../../src/api/geocoder.js');
  let requestCalls = 0;
  await assert.rejects(
    geocodePhiladelphiaAddress('1500 Market St', {
      request: async () => { requestCalls += 1; return { candidates: [] }; },
    }),
    /unavailable/i,
  );
  await assert.rejects(
    findPhiladelphiaPropertyAddressCandidates('1500 Market St', {
      request: async () => { requestCalls += 1; return { candidates: [] }; },
    }),
    /unavailable/i,
  );
  assert.equal(requestCalls, 0);
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

test('address resolution delegates the single Crime refresh to the debounced panel change owner', async () => {
  const [source, panelSource] = await Promise.all([
    readFile(new URL('../../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/ui/panel.js', import.meta.url), 'utf8'),
  ]);
  const callbackStart = source.indexOf('onAddressResolved:');
  const callbackEnd = source.indexOf('onTractsOverlayToggle:', callbackStart);
  assert.notEqual(callbackStart, -1, 'main must define the address resolution callback');
  assert.notEqual(callbackEnd, -1, 'main must keep the address callback inside the panel options');
  const callback = source.slice(callbackStart, callbackEnd);
  assert.match(callback, /coordinator\.fitCurrentCrimeSelection/);
  assert.doesNotMatch(callback, /refreshCrime/);
  assert.match(callback, /async[\s\S]*coordinator\.fitCurrentCrimeSelection/);
  assert.doesNotMatch(source, /pendingAddressMove/);
  assert.doesNotMatch(source, /const refreshCrime[\s\S]*runCrimeMapMove[\s\S]*requestCrimeRefresh/);
  assert.match(panelSource, /onChange\.cancel\(\);[\s\S]*const moveCompleted = await handlers\.onAddressResolved\?\.\(target, result\)/);
  assert.match(panelSource, /if \(moveCompleted === false\) return;[\s\S]*onChange\(\)/);
  assert.match(panelSource, /catch \(error\)[\s\S]*addressStatus\.textContent = error\?\.message \|\| String\(error\)/);
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

test('boundary failure cannot disable independent Crime result surfaces', async () => {
  const [crimeRoute, source] = await Promise.all([
    import('../../src/routes_crime/index.js'),
    readFile(new URL('../../src/routes_crime/index.js', import.meta.url), 'utf8'),
  ]);
  assert.equal(crimeRoute.markCrimeResultsUnavailable, undefined);
  assert.doesNotMatch(source, /style\.opacity\s*=\s*['"]0\.35['"]/);
  assert.doesNotMatch(source, /style\.pointerEvents\s*=\s*['"]none['"]/);
});

test('public share state round-trips public choices and never encodes private point fields', async () => {
  const { encodeCrimeViewState, decodeCrimeViewState } = await import('../../src/state/crime_view_state.js');
  const encoded = encodeCrimeViewState({
    queryMode: 'tract',
    startMonth: '2025-08',
    durationMonths: 12,
    radius: 1375,
    selectedGroups: ['vehicle'],
    selectedDrilldownCodes: ['Motor Vehicle Theft'],
    selectedDistrictCode: null,
    selectedTractGEOID: '42101000100',
    overlayTractsLines: true,
    centerLonLat: [-75.166154, 39.95218],
    centerBLonLat: [-75.2, 39.96],
    addressA: 'PRIVATE ADDRESS A',
    addressB: 'PRIVATE ADDRESS B',
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
    radius: 1375,
    selectedGroups: ['vehicle'],
    selectedDrilldownCodes: ['Motor Vehicle Theft'],
    selectedDistrictCode: null,
    selectedTractGEOID: '42101000100',
    overlayTractsLines: true,
    centerLonLat: null,
    centerBLonLat: null,
    addressA: null,
    addressB: null,
    per10k: true,
    classMethod: 'custom',
    classBins: 4,
    classPalette: 'OrRd',
    classOpacity: 0.6,
    classCustomBreaks: [1, 2, 3],
  });
  assert.doesNotMatch(encoded, /(?:^|&)(?:a|b|labelA|labelB)=|PRIVATE|75\.166154/);
});

test('hostile legacy private query keys are ignored and disappear from the public canonical query', async () => {
  const { decodeCrimeViewState, encodeCrimeViewState } = await import('../../src/state/crime_view_state.js');
  const hostile = 'campaign=keep&analysis=buffer&a=-75.16,39.95&b=-75.2,39.96&labelA=PRIVATE-A&labelB=PRIVATE-B&months=6';
  const decoded = decodeCrimeViewState(hostile);
  assert.equal(decoded.centerLonLat, null);
  assert.equal(decoded.centerBLonLat, null);
  assert.equal(decoded.addressA, null);
  assert.equal(decoded.addressB, null);
  const canonical = encodeCrimeViewState(decoded);
  assert.match(canonical, /analysis=buffer/);
  assert.match(canonical, /months=6/);
  assert.doesNotMatch(canonical, /(?:^|&)(?:a|b|labelA|labelB)=|PRIVATE|75\.16/);
});

test('query preset preview starts from a full canonical snapshot and changes only time fields', async () => {
  const queryPreset = await import('../../src/routes_crime/query_preset_controller.js').catch(() => ({}));
  assert.equal(typeof queryPreset.createQueryPresetPreview, 'function');
  const { canonicalizeCrimeRuntimeState, encodeCrimeViewState } = await import('../../src/state/crime_view_state.js');
  const input = {
    queryMode: 'buffer',
    startMonth: '2025-01',
    durationMonths: 12,
    radius: 1375,
    selectedGroups: ['vehicle'],
    selectedDrilldownCodes: ['Motor Vehicle Theft'],
    overlayTractsLines: true,
    centerLonLat: [-75.166154, 39.95218],
    centerBLonLat: [-75.2, 39.96],
    addressA: '1500 MARKET ST',
    addressB: 'UNIVERSITY CITY',
    per10k: false,
    classMethod: 'custom',
    classBins: 4,
    classPalette: 'OrRd',
    classOpacity: 0.6,
    classCustomBreaks: [1, 2, 3],
  };
  const original = structuredClone(input);
  const preview = queryPreset.createQueryPresetPreview({
    presetId: 'latest-24-months',
    currentState: input,
    coverage: { status: 'ready', min: '2006-01-01', max: '2026-07-30' },
    normalizeCanonical: canonicalizeCrimeRuntimeState,
    serializeCanonical: encodeCrimeViewState,
  });

  assert.equal(preview.status, 'preview');
  assert.deepEqual(preview.before, canonicalizeCrimeRuntimeState(input));
  assert.deepEqual(preview.patch, {
    startMonth: '2024-08',
    durationMonths: 24,
  });
  assert.deepEqual(input, original);
  const changedFields = Object.keys(preview.after).filter((key) => (
    JSON.stringify(preview.after[key]) !== JSON.stringify(preview.before[key])
  ));
  assert.deepEqual(changedFields, ['startMonth', 'durationMonths']);
  assert.equal(preview.after.centerLonLat[0], input.centerLonLat[0]);
  assert.equal(preview.after.centerBLonLat[0], input.centerBLonLat[0]);
  assert.equal(preview.after.radius, input.radius);
  assert.equal(preview.after.selectedGroups[0], input.selectedGroups[0]);
  assert.doesNotMatch(encodeCrimeViewState(preview.after), /preset|latest-24-months/);
});

test('latest-window preview is unavailable without verified and sufficient coverage', async () => {
  const { createQueryPresetPreview } = await import('../../src/routes_crime/query_preset_controller.js');
  const currentState = { queryMode: 'buffer', startMonth: '2025-01', durationMonths: 12 };
  const cases = [
    { status: 'loading', min: '2006-01-01', max: '2026-07-30' },
    { status: 'ready', min: '2006-01-01', max: null },
    { status: 'ready', min: '2025-01-01', max: '2026-07-30' },
  ];
  for (const coverage of cases) {
    assert.deepEqual(createQueryPresetPreview({
      presetId: 'latest-24-months',
      currentState,
      coverage,
    }), { status: 'unavailable' });
  }
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

test('shared Crime state caps concrete offense highlights at three', async () => {
  const { decodeCrimeViewState, encodeCrimeViewState } = await import('../../src/state/crime_view_state.js');
  const codes = [
    'Aggravated Assault Firearm',
    'Aggravated Assault No Firearm',
    'Robbery Firearm',
    'Robbery No Firearm',
  ];
  const encoded = encodeCrimeViewState({
    queryMode: 'buffer',
    selectedGroups: ['person'],
    selectedDrilldownCodes: codes,
  });

  assert.deepEqual(decodeCrimeViewState(encoded).selectedDrilldownCodes, codes.slice(0, 3));
  assert.deepEqual(
    decodeCrimeViewState(`analysis=buffer&groups=person&codes=${codes.join('|')}`).selectedDrilldownCodes,
    codes.slice(0, 3),
  );
  const { normalizeHighlightedOffenses } = await import('../../src/utils/types.js');
  assert.deepEqual(
    normalizeHighlightedOffenses([' A ', 'B', 'A', '', 'C', 'D']),
    ['A', 'B', 'C'],
  );
});

test('shared Crime state accepts bounded integer custom buffer radii', async () => {
  const { decodeCrimeViewState, encodeCrimeViewState } = await import('../../src/state/crime_view_state.js');
  for (const radius of [100, 200, 1375, 2400, 10_000]) {
    assert.equal(decodeCrimeViewState(`radius=${radius}`).radius, radius);
    assert.equal(new URLSearchParams(encodeCrimeViewState({ radius })).get('radius'), String(radius));
  }
  for (const radius of [99, 10_001, 1375.5, 'not-a-radius']) {
    assert.equal(decodeCrimeViewState(`radius=${radius}`).radius, 400);
  }
});

test('analysis artifacts normalize a versioned contract and keep refresh state transient', async () => {
  const {
    ANALYSIS_ARTIFACT_KIND,
    createAnalysisArtifact,
    renameAnalysisArtifact,
    validateAnalysisArtifact,
  } = await import('../../src/analysis/analysis_artifact.js');
  const created = createAnalysisArtifact({
    title: `  Night safety ${'x'.repeat(180)}  `,
    viewState: {
      queryMode: 'district',
      startMonth: '2025-08',
      durationMonths: 12,
      radius: 400,
      selectedDistrictCode: '05',
      selectedGroups: ['vehicle'],
    },
    resultSummary: {
      generatedAt: '2026-07-31T01:00:00.000Z',
      comparison: { a: { total: 10 }, b: null },
      refreshStatus: 'live',
    },
    provenance: {
      coverageMin: '2006-01-01',
      coverageMax: '2026-07-30',
      sources: ['phl-carto'],
    },
  }, {
    createId: () => 'analysis-1',
    now: () => '2026-07-31T02:00:00.000Z',
  });

  assert.equal(created.kind, ANALYSIS_ARTIFACT_KIND);
  assert.equal(created.schemaVersion, 3);
  assert.equal(created.id, 'analysis-1');
  assert.equal(created.title, 'District 05 analysis');
  assert.equal(created.createdAt, '2026-07-31T02:00:00.000Z');
  assert.equal(created.updatedAt, created.createdAt);
  assert.equal(created.resultSummary.generatedAt, '2026-07-31T01:00:00.000Z');
  assert.equal('generatedAt' in created.provenance, false);
  assert.equal('dataStatus' in created, false);
  assert.equal('refreshStatus' in created, false);
  assert.equal('refreshStatus' in created.resultSummary, false);
  assert.equal(validateAnalysisArtifact(created).id, 'analysis-1');

  const renamed = renameAnalysisArtifact(created, '  Safer route  ', {
    now: () => '2026-07-31T03:00:00.000Z',
  });
  assert.equal(renamed.title, 'District 05 analysis');
  assert.equal(renamed.createdAt, created.createdAt);
  assert.equal(renamed.updatedAt, '2026-07-31T03:00:00.000Z');
  assert.throws(
    () => validateAnalysisArtifact({ ...created, kind: 'wrong-kind' }),
    /artifact kind/i,
  );
  const legacy = validateAnalysisArtifact({
    ...created,
    schemaVersion: 1,
    resultSummary: {
      generatedAt: created.resultSummary.generatedAt,
      comparison: {
        a: { label: 'Point A', total: 10, per10k: null, top3: [], delta30: null },
        b: null,
      },
    },
  });
  assert.equal(legacy.schemaVersion, 1);
  assert.equal(legacy.resultSummary.comparison.a.population, undefined);
  const projectedArtifact = createAnalysisArtifact({
    viewState: {
      queryMode: 'district',
      selectedDistrictCode: '05',
      addressA: 'PRIVATE',
      center3857: [-8_365_000, 4_855_000],
    },
  });
  assert.doesNotMatch(JSON.stringify(projectedArtifact), /PRIVATE|8365000|4855000/);
  assert.throws(
    () => validateAnalysisArtifact({
      ...projectedArtifact,
      viewState: { ...projectedArtifact.viewState, addressA: 'PRIVATE' },
    }),
    /unsupported field addressA/i,
  );
  assert.throws(
    () => createAnalysisArtifact({
      viewState: { queryMode: 'buffer', centerLonLat: [-75.16, 39.95] },
    }),
    /private buffer analysis is unavailable/i,
  );
});

test('analysis artifact v3 round-trips structured population without private geography', async () => {
  const { createAnalysisArtifact, validateAnalysisArtifact } = await import('../../src/analysis/analysis_artifact.js');
  const population = {
    estimate: 2_000,
    moe90: null,
    vintage: '2024',
    source: 'U.S. Census Bureau',
    retrievedAt: '2026-08-10T08:38:25.000Z',
    status: 'available',
    method: 'centroid-in-buffer-whole-tract-sum',
    moe90Status: 'unavailable',
  };
  const artifact = createAnalysisArtifact({
    title: 'ACS denominator',
    viewState: { queryMode: 'tract', selectedTractGEOID: '42101000100' },
    resultSummary: {
      generatedAt: '2026-08-10T09:00:00.000Z',
      comparison: { a: { total: 8, per10k: 40, population }, b: null },
    },
  }, {
    createId: () => 'analysis-acs-v2',
    now: () => '2026-08-10T09:01:00.000Z',
  });

  assert.equal(artifact.schemaVersion, 3);
  assert.deepEqual(validateAnalysisArtifact(structuredClone(artifact)), artifact);
  assert.deepEqual(artifact.resultSummary.comparison.a.population, population);
});

test('tract map properties expose ACS estimate, 90% MOE, vintage, and source without changing rate math', () => {
  const result = tractView.mergeTractSnapshotData({
    tracts: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { GEOID: '42101000100' },
        geometry: { type: 'Polygon', coordinates: [] },
      }],
    },
    stats: [{
      geoid: '42101000100',
      pop: 2_000,
      population: {
        estimate: 2_000,
        moe90: 120,
        vintage: '2024',
        source: 'U.S. Census Bureau',
        retrievedAt: '2026-08-10T08:38:25.000Z',
        status: 'available',
      },
    }],
    snapshot: null,
    start: '2025-01-01',
    end: '2026-01-01',
    per10k: true,
  });
  const properties = result.geojson.features[0].properties;
  assert.equal(properties.__pop, 2_000);
  assert.equal(properties.__popMoe90, 120);
  assert.equal(properties.__popVintage, '2024');
  assert.equal(properties.__popSource, 'U.S. Census Bureau');
  assert.equal(properties.__popStatus, 'available');
  assert.deepEqual(properties.__population, {
    estimate: 2_000,
    moe90: 120,
    vintage: '2024',
    source: 'U.S. Census Bureau',
    retrievedAt: '2026-08-10T08:38:25.000Z',
    status: 'available',
  });
});

test('analysis save eligibility is deterministic for every Crime query mode', async () => {
  const { canSaveAnalysis, deriveAnalysisDataStatus } = await import('../../src/analysis/analysis_artifact.js');
  assert.equal(canSaveAnalysis({ coverageStatus: 'loading', queryMode: 'buffer', centerLonLat: [-75, 40] }), false);
  assert.equal(canSaveAnalysis({ coverageStatus: 'ready', queryMode: 'buffer', centerLonLat: null }), false);
  assert.equal(canSaveAnalysis({ coverageStatus: 'ready', queryMode: 'buffer', centerLonLat: [-75, 40] }), false);
  assert.equal(canSaveAnalysis({ coverageStatus: 'ready', queryMode: 'district', selectedDistrictCode: null }), false);
  assert.equal(canSaveAnalysis({ coverageStatus: 'ready', queryMode: 'district', selectedDistrictCode: '01' }), true);
  assert.equal(canSaveAnalysis({ coverageStatus: 'ready', queryMode: 'tract', selectedTractGEOID: null }), false);
  assert.equal(canSaveAnalysis({ coverageStatus: 'ready', queryMode: 'tract', selectedTractGEOID: '42101000100' }), true);
  assert.equal(deriveAnalysisDataStatus(
    { coverageMin: '2006-01-01', coverageMax: '2026-07-30', sources: ['phl-carto'] },
    { coverageMin: '2006-01-01', coverageMax: '2026-07-30', sources: ['phl-carto'] },
  ), 'current');
  assert.equal(deriveAnalysisDataStatus(
    { coverageMin: '2006-01-01', coverageMax: '2026-07-30', sources: ['phl-carto'] },
    { sources: ['phl-carto'], coverageMax: '2026-07-30', coverageMin: '2006-01-01' },
  ), 'current');
  assert.equal(deriveAnalysisDataStatus(
    { coverageMax: '2026-07-30' },
    { coverageMax: '2026-07-31' },
  ), 'provenance-mismatch');
  assert.equal(deriveAnalysisDataStatus(null, { coverageMax: '2026-07-31' }), 'unknown');
});

test('replacing Crime view state clears stale derived and transient state atomically', async () => {
  const { replaceCrimeViewState } = await import('../../src/state/crime_view_state.js');
  const target = {
    queryMode: 'buffer',
    centerLonLat: [-75, 40],
    center3857: [1, 2],
    centerBLonLat: [-74, 41],
    centerB3857: [3, 4],
    selectedTypes: ['stale expanded code'],
    selectedGroups: ['stale group'],
    selectedDrilldownCodes: ['stale child code'],
    selectedDistrictCode: '99',
    selectedTractGEOID: '42101099900',
    selectMode: 'point',
    selectTarget: 'B',
    setComparisonPoint(side, lng, lat, label) {
      if (side === 'A') {
        this.centerLonLat = [lng, lat];
        this.center3857 = ['derived-a'];
        this.addressA = label;
      } else {
        this.centerBLonLat = [lng, lat];
        this.centerB3857 = ['derived-b'];
        this.addressB = label;
      }
    },
  };

  replaceCrimeViewState(target, {
    queryMode: 'district',
    startMonth: '2025-08',
    durationMonths: 12,
    radius: 400,
    selectedGroups: [],
    selectedDrilldownCodes: [],
    selectedDistrictCode: '01',
    centerLonLat: null,
    centerBLonLat: null,
  });

  assert.equal(target.queryMode, 'district');
  assert.equal(target.selectedDistrictCode, '01');
  assert.equal(target.selectedTractGEOID, null);
  assert.deepEqual(target.selectedTypes, []);
  assert.deepEqual(target.selectedDrilldownCodes, []);
  assert.equal(target.centerLonLat, null);
  assert.equal(target.center3857, null);
  assert.equal(target.centerBLonLat, null);
  assert.equal(target.centerB3857, null);
  assert.equal(target.selectMode, 'idle');
  assert.equal(target.selectTarget, 'A');
});

test('comparison snapshots carry one generation time and the matching filter key', async () => {
  const { buildComparisonFilterKey, getLastComparisonSnapshot } = await import('../../src/compare/card.js');
  const filters = {
    start: '2025-08-01', end: '2026-08-01', types: ['Robbery Firearm'],
    center3857: [1, 2], centerB3857: [3, 4], radiusM: 400,
    adminLevel: 'districts', per10k: false, addressA: 'Point A', addressB: 'Point B',
  };
  await updateCompare(filters, {
    now: () => '2026-07-31T04:00:00.000Z',
    fetchers: {
      fetchCountBuffer: async () => 10,
      fetchTopTypesBuffer: async () => ({ rows: [] }),
    },
    view: { pending() {}, success() {}, error(error) { throw error; } },
  });
  assert.deepEqual(getLastComparisonSnapshot(filters), {
    filterKey: buildComparisonFilterKey(filters),
    generatedAt: '2026-07-31T04:00:00.000Z',
    comparison: {
      a: { label: 'Point A', total: 10, per10k: null, top3: [], delta30: null },
      b: { label: 'Point B', total: 10, per10k: null, top3: [], delta30: null },
    },
  });
  assert.equal(getLastComparisonSnapshot({ ...filters, radiusM: 800 }), null);
});

test('mode coordinator exposes an awaitable Crime refresh result', async () => {
  const { createModeCoordinator } = await import('../../src/mode_coordinator.js');
  let refreshResult = { status: 'live' };
  const controller = {
    setActive() {},
    requestRefresh: async () => refreshResult,
    updateBuffer() {},
    setTractsOverlayVisible() {},
  };
  const coordinator = createModeCoordinator({
    map: { isStyleLoaded: () => true },
    diaryFeatureEnabled: false,
    getCurrentMode: () => 'crime',
    writeMode() {},
    loadCrimeController: async () => controller,
    loadDiaryModule: async () => null,
    getDiaryInsights: async () => null,
    reportError() {},
  });
  await coordinator.schedule('crime');
  assert.deepEqual(await coordinator.requestCrimeRefresh(), { status: 'live' });
  refreshResult = { status: 'superseded' };
  assert.deepEqual(await coordinator.requestCrimeRefresh(), { status: 'superseded' });
  controller.requestRefresh = async () => { throw new Error('upstream failed'); };
  assert.deepEqual(await coordinator.requestCrimeRefresh(), {
    status: 'failed',
    error: 'upstream failed',
  });
});

test('mode coordinator passes queue ownership into the Crime refresh and aborts it for Diary', async () => {
  const { createModeCoordinator } = await import('../../src/mode_coordinator.js');
  let mode = 'crime';
  let receivedSignal;
  const controller = {
    setActive() {},
    requestRefresh({ signal } = {}) {
      receivedSignal = signal;
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ status: 'superseded' }), { once: true }));
    },
  };
  const coordinator = createModeCoordinator({
    map: { isStyleLoaded: () => true },
    diaryFeatureEnabled: true,
    getCurrentMode: () => mode,
    writeMode() {},
    loadCrimeController: async () => controller,
    loadDiaryModule: async () => ({ async initDiaryMode() { return { status: 'ready' }; }, teardownDiaryMode() {} }),
    getDiaryInsights: async () => ({ show() {}, hide() {}, setCollapsed() {} }),
    reportError() {},
  });

  const crime = coordinator.schedule('crime');
  while (!receivedSignal) await new Promise((resolve) => setImmediate(resolve));
  mode = 'diary';
  const diary = coordinator.schedule('diary');
  assert.equal(receivedSignal.aborted, true);
  assert.equal((await crime).status, 'superseded');
  assert.equal((await diary).status, 'ready');
});

test('Crime refresh outcomes never label stale work as live', async () => {
  const { classifyCrimeRefreshJobs, normalizeCrimeRefreshResult } = await import('../../src/ui/crime_result_meta.js');
  assert.deepEqual(normalizeCrimeRefreshResult({ applied: true }), { status: 'live' });
  assert.deepEqual(normalizeCrimeRefreshResult({ applied: false }), { status: 'superseded' });
  assert.deepEqual(normalizeCrimeRefreshResult({ status: 'failed' }), { status: 'failed' });
  assert.deepEqual(normalizeCrimeRefreshResult({
    status: 'unavailable',
    reason: 'private-location-analysis',
  }), {
    status: 'unavailable',
    reason: 'private-location-analysis',
    succeeded: [],
    failed: [],
  });
  assert.deepEqual(normalizeCrimeRefreshResult({
    status: 'partial',
    succeeded: ['boundary', 'charts'],
    failed: ['incidents'],
  }), {
    status: 'partial',
    succeeded: ['boundary', 'charts'],
    failed: ['incidents'],
  });
  assert.deepEqual(classifyCrimeRefreshJobs([
    { name: 'boundary', result: { status: 'fulfilled', value: { applied: true } } },
    { name: 'charts', result: { status: 'fulfilled', value: { applied: true } } },
  ]), { status: 'live', succeeded: ['boundary', 'charts'], failed: [] });
  assert.deepEqual(classifyCrimeRefreshJobs([
    { name: 'boundary', result: { status: 'fulfilled', value: { applied: true } } },
    { name: 'incidents', result: { status: 'rejected', reason: new Error('points failed') } },
    { name: 'charts', result: { status: 'fulfilled', value: { applied: true } } },
  ]), { status: 'partial', succeeded: ['boundary', 'charts'], failed: ['incidents'] });
  assert.deepEqual(classifyCrimeRefreshJobs([
    { name: 'boundary', result: { status: 'fulfilled', value: null } },
    { name: 'charts', result: { status: 'rejected', reason: new Error('chart failed') } },
  ]), { status: 'failed', succeeded: [], failed: ['boundary', 'charts'] });
  assert.deepEqual(classifyCrimeRefreshJobs([
    { name: 'boundary', result: { status: 'fulfilled', value: { applied: true } } },
    { name: 'charts', result: { status: 'fulfilled', value: { applied: false } } },
  ]), { status: 'superseded', succeeded: [], failed: [] });
});

test('analysis export emits machine-readable JSON and spreadsheet-safe CSV', async () => {
  const {
    analysisExportToCsv,
    buildAnalysisExport,
    isEvidenceBundleEnabled,
  } = await import('../../src/utils/export_analysis.js');
  const { buildEvidenceBundleSections, composeEvidenceBundle } = await import(evidenceBundleUrl);
  const { buildCrimeEvidenceSource } = await import('../../src/ui/crime_data_sources.js');
  const payload = buildAnalysisExport({
    filters: {
      start: '2025-08-01', end: '2026-08-01', types: ['Theft'],
      queryMode: 'district', selectedDistrictCode: '05',
    },
    comparison: {
      a: { label: '=unsafe', total: 10, population: { estimate: 2500, moe90: 300 } },
      b: { label: 'B', total: 20 },
    },
    generatedAt: '2026-07-31T00:00:00.000Z',
  });
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.comparison.b.total, 20);
  assert.equal(payload.comparison.a.population, undefined, 'legacy v1 export must not acquire v2 population fields');
  const csv = analysisExportToCsv(payload);
  assert.match(csv, /point,label,total/);
  assert.match(csv, /A,"District 05",10/);
  const projected = buildAnalysisExport({
    filters: {
      start: '2025-08-01',
      end: '2026-08-01',
      queryMode: 'district',
      selectedDistrictCode: '05',
      center3857: [-8_365_000, 4_855_000],
      addressA: 'PRIVATE EXPORT TOKEN',
    },
    comparison: { a: { label: 'PRIVATE EXPORT TOKEN', total: 7 }, b: null },
    generatedAt: '2026-07-31T00:00:00.000Z',
  });
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE|8365000|4855000/);
  assert.doesNotMatch(analysisExportToCsv(projected), /PRIVATE|8365000|4855000/);
  assert.throws(() => buildAnalysisExport({
    filters: {
      start: '2025-08-01', end: '2026-08-01', queryMode: 'buffer',
      center3857: [-8_365_000, 4_855_000], addressA: 'PRIVATE',
    },
    comparison: null,
  }), /unavailable/i);

  assert.equal(isEvidenceBundleEnabled({ VITE_FEATURE_EVIDENCE_BUNDLE: '1' }), true);
  assert.equal(isEvidenceBundleEnabled({ VITE_FEATURE_EVIDENCE_BUNDLE: '0' }), false);
  const sections = buildEvidenceBundleSections({
    filters: {
      start: '2025-08-01',
      end: '2026-08-01',
      types: ['Theft'],
      queryMode: 'buffer',
      center3857: [-8360000, 4850000],
      centerB3857: [-8361000, 4851000],
      addressA: '1500 Market St',
      addressB: 'Home',
      radiusM: 400,
      adminLevel: 'districts',
      per10k: false,
    },
    comparison: { a: { label: '1500 Market St', total: 0, per10k: null, top3: [] }, b: null },
    source: evidenceSource(),
  });
  const serializedSections = JSON.stringify(sections);
  assert.doesNotMatch(serializedSections, /1500 Market|\bHome\b|-8360000|-8361000/);
  assert.deepEqual(sections.query.geography, {
    mode: 'buffer',
    radiusM: 400,
    exactSelection: 'omitted-for-privacy',
  });
  assert.equal(sections.result.status, 'available');
  assert.equal(sections.result.comparison.a.total, 0);
  const validBundle = await composeEvidenceBundle({
    schemaVersion: 'engagement-evidence-bundle/v1',
    generatedAt: '2026-08-10T15:00:00.000Z',
    ...sections,
  });
  assert.equal(validBundle.result.comparison.a.total, 0, 'builder output must satisfy the exact v1 schema');
  const comparisonSnapshot = {
    filterKey: 'matching-filter',
    generatedAt: '2026-08-10T14:30:00.000Z',
    comparison: { a: { total: 0 }, b: null },
  };
  const sourceAtFirstExport = buildCrimeEvidenceSource({
    coverageMin: '2006-01-01',
    coverageMax: '2026-07-30',
    comparisonSnapshot,
    generatedAt: '2026-08-10T15:00:00.000Z',
  });
  const sourceAtLaterExport = buildCrimeEvidenceSource({
    coverageMin: '2006-01-01',
    coverageMax: '2026-07-30',
    comparisonSnapshot,
    generatedAt: '2026-08-10T20:00:00.000Z',
  });
  assert.equal(sourceAtFirstExport.retrievedAt, comparisonSnapshot.generatedAt);
  assert.equal(sourceAtLaterExport.retrievedAt, comparisonSnapshot.generatedAt);
  assert.equal(
    buildCrimeEvidenceSource({
      coverageMin: '2006-01-01',
      coverageMax: '2026-07-30',
      comparisonSnapshot: null,
      generatedAt: '2026-08-10T20:00:00.000Z',
    }).retrievedAt,
    null,
    'export time must not be invented as retrieval time when no matching snapshot exists',
  );
  assert.throws(
    () => buildEvidenceBundleSections({
      filters: { start: '2025-08-01', end: '2026-08-01', radiusM: 400 },
      comparison: { a: { total: '' } },
      source: evidenceSource(),
    }),
    /admitted aggregate count/i,
    'an empty count must not be coerced into an admitted zero',
  );
  assert.equal(payload.schemaVersion, 1, 'legacy JSON schema must remain unchanged');
  assert.equal(csv, analysisExportToCsv(payload), 'legacy CSV output must remain unchanged');
});

test('Diary local repository stores normalized route records without a backend', async () => {
  const {
    createDiaryEntry,
    createDiaryLocalRepository,
  } = await import('../../src/routes_diary/local_repository.js');
  const rows = new Map();
  const repository = createDiaryLocalRepository({
    adapter: {
      async putEntry(value) { rows.set(value.id, structuredClone(value)); },
      async getAllEntries() { return [...rows.values()].map((value) => structuredClone(value)); },
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

test('Diary backup replacement is one adapter operation and unavailable storage fails visibly', async () => {
  const { createDiaryLocalRepository, createIndexedDbAdapter } = await import('../../src/routes_diary/local_repository.js');
  const calls = [];
  const repository = createDiaryLocalRepository({
    adapter: {
      async applyBackup(value, options) {
        calls.push(['applyBackup', value.kind, options.strategy]);
        return {
          plan: { mode: options.strategy },
          snapshot: { entries: [], drafts: [] },
        };
      },
    },
  });
  await repository.applyBackup({ kind: 'engagement-diary-private-backup' }, { strategy: 'replace' });
  assert.deepEqual(calls, [['applyBackup', 'engagement-diary-private-backup', 'replace']]);
  await assert.rejects(createIndexedDbAdapter(null).getAllEntries(), /storage is unavailable/i);
});

test('Diary backup round-trips normalized entries and rejects unsupported schemas', async () => {
  const {
    createDiaryEntry,
  } = await import('../../src/routes_diary/local_repository.js');
  const {
    parseDiaryPrivateBackup,
    serializeDiaryPrivateBackup,
  } = await import('../../src/routes_diary/diary_data_portability.js');
  const entry = createDiaryEntry({
    id: 'local-backup-1',
    createdAt: '2026-07-31T00:00:00.000Z',
    payload: { overall_rating: 5, tags: ['calm'], segment_ids: ['seg-2'] },
    routeFeature: {
      geometry: { type: 'LineString', coordinates: [[-75.2, 39.9], [-75.1, 40]] },
      properties: { route_id: 'route-2', name: 'Park loop', mode: 'walk' },
    },
  });
  const backup = serializeDiaryPrivateBackup({ entries: [entry], drafts: [] }, { generatedAt: '2026-07-31T01:00:00.000Z' });
  assert.deepEqual(parseDiaryPrivateBackup(JSON.stringify(backup)).entries, [entry]);
  assert.throws(
    () => parseDiaryPrivateBackup(JSON.stringify({ schemaVersion: 99, entries: [] })),
    /unsupported diary backup/i,
  );
  assert.throws(
    () => parseDiaryPrivateBackup(JSON.stringify({ schemaVersion: 1, entries: [{ id: 'bad' }] })),
    /invalid diary entry/i,
  );
});

test('Diary insights derive trend, tags, and time cells from local records', async () => {
  const { deriveLocalDiaryInsights } = await import('../../src/charts/diary_insights.js');
  const insights = deriveLocalDiaryInsights([
    { createdAt: '2026-07-27T20:00:00.000Z', score: 2, tags: ['poor_lighting'] },
    { createdAt: '2026-07-28T21:00:00.000Z', score: 4, tags: ['poor_lighting', 'speeding_cars'] },
  ]);
  assert.equal(insights.status, 'available');
  assert.deepEqual(insights.trend, [2, 4]);
  assert.deepEqual(insights.tags[0], { label: 'poor lighting', value: 2 });
  assert.equal(insights.heatmap.flat().reduce((sum, value) => sum + value, 0), 2);
  const hostSource = await readFile(new URL('../../src/routes_diary/ui_insights_panel.js', import.meta.url), 'utf8');
  assert.match(hostSource, /import\('\.\.\/charts\/diary_insights\.js'\)/);
  assert.match(hostSource, /setDiaryInsightEntries\(entries\)[\s\S]*renderInsightsSections/);
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
  const [communitySource, liveSource, styleSource] = await Promise.all([
    readFile(new URL('../../src/routes_diary/ui_community_panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/routes_diary/ui_live_panel.js', import.meta.url), 'utf8'),
    readProductCss(),
  ]);
  assert.match(communitySource, /diary\.sampleCommunity/);
  assert.match(communitySource, /diary\.communityNotice/);
  assert.doesNotMatch(communitySource, /onPostComment/);
  assert.doesNotMatch(communitySource, /type\s*=\s*['"]range['"]|onRadiusChange|onSelectSegment/);
  assert.match(communitySource, /className\s*=\s*['"]diary-community-item['"]/);
  assert.doesNotMatch(communitySource, /className\s*=\s*['"]diary-history-item['"]/);
  assert.match(styleSource, /\.diary-community-item\s*\{[^}]*cursor:\s*default/s);
  assert.match(liveSource, /diary\.openRoutes/);
  assert.doesNotMatch(liveSource, /coming soon/i);
});

test('Diary route summary presents route facts without repeating the selector title', async () => {
  const { createRouteSummaryModel } = await import('../../src/routes_diary/index.js');
  const model = createRouteSummaryModel({
    properties: {
      route_id: 'route-1',
      name: 'University Loop',
      from: 'Campus',
      to: 'River Trail',
      mode: 'walk',
      length_m: 1420,
      duration_min: 18,
    },
  });
  assert.deepEqual(model, {
    from: 'Campus',
    to: 'River Trail',
    mode: 'Walk',
    distance: '1.4 km',
    duration: '18 min',
  });
  assert.doesNotMatch(JSON.stringify(model), /University Loop/);
});

test('alternative route description states benefit before cost without live-condition claims', async () => {
  const { describeAlternativeTradeoff } = await import('../../src/routes_diary/alternative_route.js');
  assert.deepEqual(describeAlternativeTradeoff({
    pLow: 2,
    aLow: 1,
    overheadPct: 58.1,
    deltaMin: 15,
  }), {
    benefit: 'Avoids 1 low-rated segment',
    cost: '15 min longer · 58% farther',
    caveat: 'Based on sample route ratings, not live conditions.',
    hasBenefit: true,
  });
  const noBenefit = describeAlternativeTradeoff({
    pLow: 1,
    aLow: 1,
    overheadPct: 20,
    deltaMin: 8,
  });
  assert.equal(noBenefit.benefit, 'No lower-rated segments avoided');
  assert.equal(noBenefit.hasBenefit, false);
  assert.doesNotMatch(JSON.stringify(noBenefit), /safest|best|tonight|current conditions/i);
});

test('Sample Community observations carry explicit sample identity and no simulated recency', async () => {
  const { createSampleCommunityModel } = await import('../../src/routes_diary/ui_community_panel.js');
  assert.equal(typeof createSampleCommunityModel, 'function');

  const model = createSampleCommunityModel();
  assert.ok(model.observations.length > 0);
  for (const observation of model.observations) {
    assert.equal(observation.sample, true);
    assert.match(observation.label, /^Example \d+$/);
    assert.equal('ago' in observation, false);
    assert.equal('user' in observation, false);
  }
  assert.doesNotMatch(JSON.stringify(model), /\b(?:ago|today|tonight|this week)\b/i);
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

test('Crime charts can redraw localized copy from cached data without refetching', async () => {
  const { createChartLocaleCache } = await import('../../src/charts/index.js');
  assert.equal(typeof createChartLocaleCache, 'function');
  const { setLanguage } = await import('../../src/i18n/index.js');
  const cache = createChartLocaleCache();
  let fetchCalls = 0;
  const emptyRows = async () => {
    fetchCalls += 1;
    return { rows: [] };
  };
  const copies = [];
  const statuses = [];
  const errors = [];
  const sinks = {
    status(message) { statuses.push(message); },
    monthly(_city, _area, copy) { copies.push(copy); },
    top(_rows, copy) { copies.push(copy); },
    heat(_matrix, copy) { copies.push(copy); },
    error(error, options) { errors.push([error, options]); },
  };

  setLanguage('en');
  await updateAllCharts({
    start: '2026-01-01',
    end: '2026-07-01',
    types: [],
    center3857: [1, 2],
    radiusM: 400,
    queryMode: 'buffer',
  }, {
    fetchers: {
      fetchMonthlySeriesCity: emptyRows,
      fetchMonthlySeriesBuffer: emptyRows,
      fetchTopTypesBuffer: emptyRows,
      fetch7x24Buffer: emptyRows,
    },
    sinks,
    chartCache: cache,
  });
  const fetchCallsAfterInitialRender = fetchCalls;
  assert.equal(copies[0].citywide, 'Citywide');

  setLanguage('zh-CN');
  assert.equal(cache.refresh(sinks), true);
  assert.equal(fetchCalls, fetchCallsAfterInitialRender);
  assert.equal(copies.at(-1).citywide, '全市');
  assert.equal(copies.at(-1).weekdays[0], '周日');

  const copiesBeforeStatusOnly = copies.length;
  await updateAllCharts({
    start: '2026-01-01',
    end: '2026-07-01',
    types: [],
    center3857: null,
    radiusM: 400,
    queryMode: 'buffer',
  }, { sinks, chartCache: cache });
  setLanguage('en');
  assert.equal(cache.refresh(sinks), true);
  assert.equal(statuses.at(-1), 'Tip: click the map to set a center and show buffer-based charts.');
  assert.equal(copies.length, copiesBeforeStatusOnly);

  const failedResult = await updateAllCharts({
    start: '2026-01-01',
    end: '2026-07-01',
    types: [],
    center3857: [1, 2],
    radiusM: 400,
    queryMode: 'buffer',
  }, {
    fetchers: {
      fetchMonthlySeriesCity: async () => { throw new Error('offline'); },
      fetchMonthlySeriesBuffer: async () => { throw new Error('offline'); },
      fetchTopTypesBuffer: async () => { throw new Error('offline'); },
      fetch7x24Buffer: async () => { throw new Error('offline'); },
    },
    sinks,
    chartCache: cache,
  });
  assert.equal(failedResult.status, 'failed');
  const copiesBeforeErrorRefresh = copies.length;
  setLanguage('zh-CN');
  assert.equal(cache.refresh(sinks), true);
  assert.equal(copies.length, copiesBeforeErrorRefresh);
  assert.equal(errors.at(-1)[1].report, false);
  assert.match(errors.at(-1)[1].message, /图表不可用/);
  setLanguage('en');
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

test('Diary submission completion waits for the atomic local commit before applying results', async () => {
  assert.equal(typeof diaryModule.handleDiarySubmissionSuccess, 'function');
  const calls = [];
  const payload = { segment_ids: ['seg-1'], overall_rating: 4 };
  const response = { persisted: false, mode: 'demo' };
  let releaseCommit;
  const commitGate = new Promise((resolve) => { releaseCommit = resolve; });

  const completion = diaryModule.handleDiarySubmissionSuccess({ payload, response }, {
    createLocalEntry: ({ payload: value, routeFeature }) => ({
      id: 'entry-1',
      routeId: routeFeature.properties.route_id,
      rating: value.overall_rating,
    }),
    localLifecycle: {
      async commitEntry(entry, routeId) {
        calls.push(['commit', entry.id, routeId]);
        await commitGate;
        return { applied: true, entry };
      },
    },
    aggregationModel: {
      applySubmission(value) { calls.push(['apply', value]); },
      buildFeatureCollection() { return { type: 'FeatureCollection', features: [] }; },
    },
    map: null,
    refreshAlternativeRoute() { calls.push(['alternative']); },
    notify(message) { calls.push(['toast', message]); },
    notifyPanel(message) { calls.push(['panel', message]); },
    highlightSegments(ids) { calls.push(['highlight', ids]); },
    routeFeature: { properties: { route_id: 'route-1', name: 'Route 1' } },
  });

  await Promise.resolve();
  assert.equal(calls[0][0], 'commit');
  assert.equal(calls.some(([kind]) => kind === 'apply'), false);
  releaseCommit();
  assert.equal((await completion).applied, true);
  assert.deepEqual(calls.find(([kind]) => kind === 'apply'), ['apply', payload]);
  assert.match(calls.find(([kind]) => kind === 'toast')[1], /browser/i);
  assert.match(calls.find(([kind]) => kind === 'toast')[1], /no data was uploaded/i);
  assert.deepEqual(calls.find(([kind]) => kind === 'highlight')[1], ['seg-1']);
});

test('Diary submission delegates the durable commit to the session local-data controller', async () => {
  const calls = [];
  const payload = { route_id: 'route-1', segment_ids: ['seg-1'], overall_rating: 4 };
  const entry = { id: 'entry-controller', routeId: 'route-1', score: 4 };

  const result = await diaryModule.handleDiarySubmissionSuccess({
    payload,
    response: { persisted: false, mode: 'demo' },
  }, {
    createLocalEntry: () => entry,
    localController: {
      async commitEntry(value, routeId) {
        calls.push(['controller-commit', value, routeId]);
        return { applied: true, entry: value };
      },
    },
    localLifecycle: {
      async commitEntry() {
        throw new Error('legacy lifecycle path used');
      },
    },
    aggregationModel: {
      applySubmission() { calls.push(['apply']); },
      buildFeatureCollection() { return null; },
    },
    refreshAlternativeRoute() {},
    notify() {},
    notifyPanel() {},
    highlightSegments() {},
    routeFeature: { properties: { route_id: 'route-1', name: 'Route 1' } },
  });

  assert.equal(result.applied, true);
  assert.deepEqual(calls[0], ['controller-commit', entry, 'route-1']);
  assert.deepEqual(calls[1], ['apply']);
});

test('a failed local Diary commit does not mutate aggregation or show success', async () => {
  const calls = [];
  await assert.rejects(
    diaryModule.handleDiarySubmissionSuccess({
      payload: { route_id: 'route-1', segment_ids: ['seg-1'], overall_rating: 4 },
      response: { persisted: false, mode: 'demo' },
    }, {
      localLifecycle: { commitEntry: async () => { throw new Error('storage failed'); } },
      aggregationModel: {
        applySubmission() { calls.push('apply'); },
        buildFeatureCollection() { return null; },
      },
      notify() { calls.push('toast'); },
      notifyPanel() { calls.push('panel'); },
      highlightSegments() { calls.push('highlight'); },
      routeFeature: { properties: { route_id: 'route-1', name: 'Route 1' } },
    }),
    /storage failed/,
  );
  assert.deepEqual(calls, []);
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
      { geoid: '42101000200', pop: null },
    ],
    snapshot: {
      meta: {
        schema_version: 2,
        start: '2025-08-01',
        end: '2026-08-01',
        generated_at: '2026-07-31T01:00:00.000Z',
        coverage_date: '2026-07-30',
        row_count: 2,
        source_dataset: 'incidents_part1_part2',
        tract_source: 'public/data/tracts_phl.geojson',
      },
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
    per10k: true,
  });

  assert.equal(result.dataStatus, 'available');
  assert.deepEqual(result.values, [20]);
  assert.equal(result.geojson.features[1].properties.value, null, 'a missing denominator must not become a zero rate');
  assert.deepEqual(result.provenance, {
    schemaVersion: 2,
    start: '2025-08-01',
    end: '2026-08-01',
    generatedAt: '2026-07-31T01:00:00.000Z',
    coverageDate: '2026-07-30',
    rowCount: 2,
    sourceDataset: 'incidents_part1_part2',
    tractSource: 'public/data/tracts_phl.geojson',
    geographyIdentity: 'fnv1a32:2:78e4249a',
  });
});

test('tract enrichment keeps shared boundaries and prior snapshots immutable', () => {
  const geometry = {
    type: 'Polygon',
    coordinates: [[[-75.2, 39.9], [-75.1, 39.9], [-75.1, 40], [-75.2, 39.9]]],
  };
  const sharedTracts = {
    type: 'FeatureCollection',
    source: 'shared-cache',
    features: [{
      type: 'Feature',
      properties: { GEOID: '42101000100', stable: 'preserve-me' },
      geometry,
    }],
  };
  const snapshot = {
    meta: {
      schema_version: 2,
      start: '2025-08-01',
      end: '2026-08-01',
      generated_at: '2026-07-31T01:00:00.000Z',
      coverage_date: '2026-07-30',
      row_count: 1,
      source_dataset: 'incidents_part1_part2',
      tract_source: 'public/data/tracts_phl.geojson',
    },
    rows: [{
      geoid: '42101000100',
      total: 7,
      offenses: [
        { code: 'Robbery Firearm', n: 2 },
        { code: 'Theft', n: 5 },
      ],
    }],
  };

  const first = tractView.mergeTractSnapshotData({
    tracts: sharedTracts,
    stats: [{ geoid: '42101000100', pop: 1000 }],
    snapshot,
    start: '2025-08-01',
    end: '2026-08-01',
    types: ['Theft'],
  });
  const second = tractView.mergeTractSnapshotData({
    tracts: sharedTracts,
    stats: [{ geoid: '42101000100', pop: 1000 }],
    snapshot,
    start: '2025-08-01',
    end: '2026-08-01',
    types: ['Robbery Firearm'],
  });

  assert.notEqual(first.geojson, sharedTracts);
  assert.notEqual(first.geojson.features[0], sharedTracts.features[0]);
  assert.notEqual(first.geojson.features[0].properties, sharedTracts.features[0].properties);
  assert.equal(first.geojson.features[0].geometry, geometry);
  assert.equal(second.geojson.features[0].geometry, geometry);
  assert.deepEqual(sharedTracts.features[0].properties, { GEOID: '42101000100', stable: 'preserve-me' });
  assert.equal(first.geojson.features[0].properties.value, 5);
  assert.equal(second.geojson.features[0].properties.value, 2);
});

test('bundle policy keeps lazy product surfaces and admitted source artifacts outside the established entry budget', async () => {
  const source = await readFile(new URL('../../scripts/tests/bundle_policy.mjs', import.meta.url), 'utf8');
  assert.match(source, /\['Entry', entry, 875_585, 247_583\]/);
  assert.match(source, /\['Analysis History', analysisHistory, 24_800, 8_100\]/);
  assert.match(source, /\['Evidence Bundle product', evidenceBundleProduct, 2_000, 1_000\]/);
  assert.match(source, /\['Evidence Bundle v2', evidenceBundleV2, 24_000, 6_500\]/);
  assert.match(source, /\['ACS multi-tract controller', acsMultitractController, 22_000, 8_000\]/);
  assert.match(source, /vreArtifactBytes <= 200_000/);
  assert.match(source, /nonVreDistBytes <= 4_141_000/);
  assert.match(source, /distBytes <= 4_323_000/);
  assert.match(source, /routeArtifactSize <= 21_000/);
  assert.match(source, /\['P1 translations', p1Messages, 8_644, 3_300\]/);
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

test('malformed tract counts are unavailable instead of becoming admitted zero', () => {
  const result = tractView.mergeTractSnapshotData({
    tracts: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { GEOID: '42101000100' }, geometry: null }],
    },
    stats: [{ geoid: '42101000100', pop: 1000 }],
    snapshot: {
      meta: {
        schema_version: 2,
        start: '2025-08-01',
        end: '2026-08-01',
        generated_at: '2026-07-31T01:00:00.000Z',
        coverage_date: '2026-07-30',
        row_count: 1,
        source_dataset: 'incidents_part1_part2',
        tract_source: 'public/data/tracts_phl.geojson',
      },
      rows: [{ geoid: '42101000100', total: Number.NaN, offenses: [] }],
    },
    start: '2025-08-01',
    end: '2026-08-01',
  });

  assert.equal(result.dataStatus, 'unavailable');
  assert.deepEqual(result.values, []);
  assert.equal(result.geojson.features[0].properties.value, null);
});

test('tract snapshot provenance rejects invalid bounded metadata', () => {
  const result = tractView.mergeTractSnapshotData({
    tracts: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { GEOID: '42101000100' }, geometry: null }],
    },
    stats: [{ geoid: '42101000100', pop: 1000 }],
    snapshot: {
      meta: {
        schema_version: 2,
        start: '2025-08-01',
        end: '2026-08-01',
        generated_at: '2026-07-31T01:00:00.000Z',
        coverage_date: '2026-99-99',
        row_count: 1,
        source_dataset: 'incidents_part1_part2',
        tract_source: 'public/data/tracts_phl.geojson',
      },
      rows: [{ geoid: '42101000100', total: 1, offenses: [] }],
    },
    start: '2025-08-01',
    end: '2026-08-01',
  });
  assert.equal(result.dataStatus, 'unavailable');
  assert.equal(result.provenance, null);
});

test('tract snapshot provenance rejects semantic timestamp, window, and identity contradictions', () => {
  const baseMeta = {
    schema_version: 2,
    start: '2025-08-01',
    end: '2026-08-01',
    generated_at: '2026-07-31T01:00:00.000Z',
    coverage_date: '2026-07-30',
    row_count: 1,
    source_dataset: 'incidents_part1_part2',
    tract_source: 'public/data/tracts_phl.geojson',
  };
  const invalid = [
    { ...baseMeta, generated_at: '2026-07-31 01:00:00Z' },
    { ...baseMeta, start: baseMeta.end },
    { ...baseMeta, start: '2026-07-31' },
    { ...baseMeta, generated_at: '2026-07-29T23:59:59.000Z' },
  ];
  for (const meta of invalid) {
    const result = tractView.mergeTractSnapshotData({
      tracts: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { GEOID: '42101000100' }, geometry: null }] },
      stats: [{ geoid: '42101000100', pop: 1000 }],
      snapshot: { meta, rows: [{ geoid: '42101000100', total: 1, offenses: [] }] },
      start: meta.start,
      end: meta.end,
    });
    assert.equal(result.dataStatus, 'unavailable');
    assert.equal(result.provenance, null);
  }
});
