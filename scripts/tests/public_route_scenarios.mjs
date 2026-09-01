import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  PUBLIC_ROUTE_SCENARIO_SCHEMA,
  admitPublicRouteScenarioArtifact,
  buildPublicRouteScenarioViewModel,
} from '../../src/public_route_alternatives/model.js';

const fixtureUrl = new URL(
  '../../public/data/route_alternatives_public_scenarios.v1.json',
  import.meta.url,
);
const m5Url = new URL('../../src/route_alternatives_m5/index.js', import.meta.url);
const r7Url = new URL('../../reports/known-route/r7-go-no-go.v1.json', import.meta.url);
const COMPLETE_SCENARIO = 'city-hall-to-art-museum-complete';

const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'artifactId',
  'artifactClass',
  'generatedAt',
  'walkingOnly',
  'runtimeBoundary',
  'scenarios',
];
const RUNTIME_KEYS = [
  'privateInputAccepted',
  'arbitraryOdAccepted',
  'networkRoutingAllowed',
  'candidateGenerationAllowed',
  'routingAuthority',
  'safetyAuthority',
];
const SCENARIO_KEYS = [
  'scenarioId', 'label', 'origin', 'destination', 'mode', 'admission', 'candidates',
];
const CANDIDATE_KEYS = ['candidateId', 'label', 'edgeIds', 'metrics'];
const METRIC_KEYS = [
  'travelTime',
  'distance',
  'historicalReportedIncidentExposure',
  'crash',
  'highInjuryNetwork',
  'accessibility',
  'mapMatchQuality',
  'freshness',
  'uncertainty',
];
const METRIC_VALUE_KEYS = ['status', 'value', 'unit', 'sourceAsOf', 'note'];
const ALLOWLIST = new Map([
  ['city-hall-to-art-museum-complete', [
    'philadelphia-city-hall', 'philadelphia-museum-of-art',
  ]],
  ['independence-hall-to-reading-terminal-single', [
    'independence-hall', 'reading-terminal-market',
  ]],
  ['rittenhouse-square-to-30th-street-degraded', [
    'rittenhouse-square', '30th-street-station',
  ]],
]);
const ROLE_ALLOWLIST = new Set([
  'fastest',
  'lower-historical-exposure',
  'balanced',
  'accessibility-oriented',
  'route',
]);
const PROHIBITED_PRODUCT_COPY = /\bsafest\b|\bbest route\b|\brisk score\b|\bsafety score\b|personal victim probability|最安全|最佳路线|风险评分|安全评分|个人受害概率/i;

const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
const clone = (value) => structuredClone(value);
const exactKeys = (value, keys) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort());

function admittedFixture() {
  return admitPublicRouteScenarioArtifact(clone(fixture));
}

function assertUnavailableNeverMeansZero(value) {
  if (!value || typeof value !== 'object') return;
  if (value.status === 'unavailable' && Object.hasOwn(value, 'value')) {
    assert.equal(value.value, null);
    assert.equal(value.unit, null);
    assert.equal(value.sourceAsOf, null);
  }
  for (const child of Object.values(value)) assertUnavailableNeverMeansZero(child);
}

test('fixture has the exact public walking schema and complete Philadelphia allowlist', () => {
  assert.equal(PUBLIC_ROUTE_SCENARIO_SCHEMA, 'engagement-public-route-scenarios/v1');
  exactKeys(fixture, TOP_LEVEL_KEYS);
  exactKeys(fixture.runtimeBoundary, RUNTIME_KEYS);
  assert.equal(fixture.schemaVersion, PUBLIC_ROUTE_SCENARIO_SCHEMA);
  assert.equal(fixture.artifactClass, 'illustrative-precomputed-public-scenario');
  assert.equal(fixture.walkingOnly, true);
  assert.ok(Object.values(fixture.runtimeBoundary).every((value) => value === false));
  assert.equal(fixture.scenarios.length, 3);

  for (const scenario of fixture.scenarios) {
    exactKeys(scenario, SCENARIO_KEYS);
    exactKeys(scenario.origin, ['landmarkId', 'label']);
    exactKeys(scenario.destination, ['landmarkId', 'label']);
    exactKeys(scenario.admission, ['candidateSet', 'evidence', 'mapMatch', 'sensitivity']);
    assert.equal(scenario.mode, 'walking');
    assert.deepEqual(
      [scenario.origin.landmarkId, scenario.destination.landmarkId],
      ALLOWLIST.get(scenario.scenarioId),
    );
    for (const candidate of scenario.candidates) {
      exactKeys(candidate, CANDIDATE_KEYS);
      exactKeys(candidate.metrics, METRIC_KEYS);
      for (const metric of Object.values(candidate.metrics)) {
        exactKeys(metric, METRIC_VALUE_KEYS);
      }
    }
  }

  const admitted = admittedFixture();
  assert.equal(Object.isFrozen(admitted), true);
  assert.equal(Object.isFrozen(admitted.scenarios[0].candidates[0].metrics), true);
});

test('admission rejects private, network, routing-authority, arbitrary-pair, and non-walking drift', () => {
  for (const boundary of RUNTIME_KEYS) {
    const changed = clone(fixture);
    changed.runtimeBoundary[boundary] = true;
    assert.throws(() => admitPublicRouteScenarioArtifact(changed), TypeError);
  }

  const privatePair = clone(fixture);
  privatePair.scenarios[0].origin.landmarkId = 'private-home-address';
  assert.throws(() => admitPublicRouteScenarioArtifact(privatePair), /allowlist/i);

  const arbitraryScenario = clone(fixture);
  arbitraryScenario.scenarios[0].scenarioId = 'arbitrary-od';
  assert.throws(() => admitPublicRouteScenarioArtifact(arbitraryScenario), /allowlist/i);

  const driving = clone(fixture);
  driving.scenarios[0].mode = 'driving';
  assert.throws(() => admitPublicRouteScenarioArtifact(driving), /walking/i);
});

test('complete scenario exposes at most four honest roles, Pareto facts, and unstable trade-offs without a winner', () => {
  const view = buildPublicRouteScenarioViewModel(
    admittedFixture(),
    'city-hall-to-art-museum-complete',
    'en',
  );
  assert.equal(view.status, 'available');
  assert.equal(view.mode, 'walking');
  assert.equal(view.cards.length, 4);
  assert.ok(view.cards.every(({ role }) => ROLE_ALLOWLIST.has(role)));
  assert.deepEqual(new Set(view.cards.map(({ role }) => role)), new Set([
    'fastest',
    'lower-historical-exposure',
    'balanced',
    'accessibility-oriented',
  ]));
  assert.ok(view.cards.every(({ metrics }) => Object.hasOwn(metrics, 'detour')));
  assert.ok(view.cards.every(({ metrics }) => (
    Object.keys(metrics).length === 10
      && Object.hasOwn(metrics, 'travelTime')
      && Object.hasOwn(metrics, 'distance')
      && Object.hasOwn(metrics, 'historicalReportedIncidentExposure')
      && Object.hasOwn(metrics, 'crash')
      && Object.hasOwn(metrics, 'highInjuryNetwork')
      && Object.hasOwn(metrics, 'accessibility')
      && Object.hasOwn(metrics, 'mapMatchQuality')
      && Object.hasOwn(metrics, 'freshness')
      && Object.hasOwn(metrics, 'uncertainty')
  )));
  assert.ok(view.paretoCandidateIds.length >= 2);
  assert.equal(view.sensitivity.status, 'unstable');
  assert.equal(Object.hasOwn(view.sensitivity, 'winnerCandidateId'), false);
  assert.ok(view.notices.includes('illustrative-static-fixture'));
  assert.ok(view.notices.includes('no-routing-or-safety-authority'));
});

test('accessibility-oriented appears only when admitted accessibility evidence meets the criterion', () => {
  const available = buildPublicRouteScenarioViewModel(
    admittedFixture(),
    'city-hall-to-art-museum-complete',
    'en',
  );
  const accessibilityCard = available.cards.find(
    ({ role }) => role === 'accessibility-oriented',
  );
  assert.ok(accessibilityCard);
  assert.equal(accessibilityCard.metrics.accessibility.status, 'available');
  assert.equal(accessibilityCard.metrics.accessibility.value, 'meets');

  const missing = clone(fixture);
  for (const candidate of missing.scenarios[0].candidates) {
    candidate.metrics.accessibility = {
      status: 'unavailable',
      value: null,
      unit: null,
      sourceAsOf: null,
      note: {en: 'Unavailable: no admitted accessibility evidence.', 'zh-CN': '不可用：没有已准入无障碍证据。'},
    };
  }
  missing.scenarios[0].admission.evidence = 'partial';
  missing.scenarios[0].admission.sensitivity = 'unavailable';
  const withoutAccessibility = buildPublicRouteScenarioViewModel(
    admitPublicRouteScenarioArtifact(missing),
    'city-hall-to-art-museum-complete',
    'en',
  );
  assert.equal(
    withoutAccessibility.cards.some(({ role }) => role === 'accessibility-oriented'),
    false,
  );
});

test('single candidate produces exactly one ordinary route card', () => {
  const view = buildPublicRouteScenarioViewModel(
    admittedFixture(),
    'independence-hall-to-reading-terminal-single',
    'zh-CN',
  );
  assert.equal(view.status, 'limited');
  assert.equal(view.cards.length, 1);
  assert.equal(view.cards[0].role, 'route');
  assert.deepEqual(view.paretoCandidateIds, []);
  assert.equal(view.sensitivity.status, 'unavailable');
  assert.equal(Object.hasOwn(view.sensitivity, 'winnerCandidateId'), false);
});

test('unavailable evidence or map matching degrades to one ordinary route with explicit unavailable dimensions', () => {
  const view = buildPublicRouteScenarioViewModel(
    admittedFixture(),
    'rittenhouse-square-to-30th-street-degraded',
    'en',
  );
  assert.equal(view.status, 'limited');
  assert.equal(view.cards.length, 1);
  assert.equal(view.cards[0].role, 'route');
  assert.equal(view.cards[0].metrics.historicalReportedIncidentExposure.status, 'unavailable');
  assert.equal(view.cards[0].metrics.mapMatchQuality.status, 'unavailable');
  assert.ok(view.notices.includes('route-evidence-gate-not-admitted'));
  assertUnavailableNeverMeansZero(view);
});

test('candidate, evidence, map-match, and sensitivity gates each fail closed to one route', () => {
  const mutations = [
    ['candidateSet', (scenario) => {
      scenario.admission.candidateSet = 'degraded';
      scenario.admission.sensitivity = 'unavailable';
    }],
    ['evidence', (scenario) => {
      scenario.admission.evidence = 'partial';
      scenario.admission.sensitivity = 'unavailable';
      scenario.candidates[0].metrics.accessibility = {
        status: 'unavailable', value: null, unit: null, sourceAsOf: null,
        note: {en: 'Unavailable: test fixture.', 'zh-CN': '不可用：测试数据。'},
      };
    }],
    ['mapMatch', (scenario) => {
      scenario.admission.mapMatch = 'low-quality';
      scenario.admission.sensitivity = 'unavailable';
    }],
    ['sensitivity', (scenario) => {
      scenario.admission.sensitivity = 'unavailable';
    }],
  ];
  for (const [gate, mutate] of mutations) {
    const changed = clone(fixture);
    mutate(changed.scenarios[0]);
    const view = buildPublicRouteScenarioViewModel(
      admitPublicRouteScenarioArtifact(changed),
      COMPLETE_SCENARIO,
      'en',
    );
    assert.equal(view.status, 'limited', `${gate} must fail closed`);
    assert.equal(view.cards.length, 1, `${gate} must show only one route`);
    assert.equal(view.cards[0].role, 'route', `${gate} must remove objective roles`);
    assert.deepEqual(view.paretoCandidateIds, [], `${gate} must remove Pareto promotion`);
  }
});

test('admission rejects invalid units, contradictory map-match states, and unknown categories', () => {
  const wrongUnit = clone(fixture);
  wrongUnit.scenarios[0].candidates[0].metrics.travelTime.unit = 'meters';
  assert.throws(() => admitPublicRouteScenarioArtifact(wrongUnit), /travelTime\.unit/i);

  const contradictoryMapMatch = clone(fixture);
  for (const candidate of contradictoryMapMatch.scenarios[0].candidates) {
    candidate.metrics.mapMatchQuality = {
      status: 'unavailable', value: null, unit: null, sourceAsOf: null,
      note: {en: 'Unavailable: test fixture.', 'zh-CN': '不可用：测试数据。'},
    };
  }
  assert.throws(
    () => admitPublicRouteScenarioArtifact(contradictoryMapMatch),
    /mapMatch complete conflicts/i,
  );

  const unknownAccessibility = clone(fixture);
  unknownAccessibility.scenarios[0].candidates[0].metrics.accessibility.value = 'unknown';
  assert.throws(
    () => admitPublicRouteScenarioArtifact(unknownAccessibility),
    /accessibility\.value.*categorical/i,
  );
});

test('missing values stay Unavailable rather than becoming zero, and public output avoids prohibited claims', () => {
  assertUnavailableNeverMeansZero(fixture);
  const artifact = admittedFixture();
  const outputs = artifact.scenarios.map(({ scenarioId }) => (
    buildPublicRouteScenarioViewModel(artifact, scenarioId, 'en')
  ));
  const publicCopy = JSON.stringify({fixture, outputs});
  assert.doesNotMatch(publicCopy, PROHIBITED_PRODUCT_COPY);
  assert.match(publicCopy, /illustrative/i);
  assert.match(publicCopy, /static/i);
});

test('M7 fixture admission does not activate the M5 authority wrapper or the R7 report', async () => {
  const m5Source = await readFile(m5Url, 'utf8');
  const wrapperStart = m5Source.indexOf('export function evaluateRouteAlternativesM5(');
  const coreStart = m5Source.indexOf('export function evaluateRouteAlternativesM5Core(');
  const wrapperSource = m5Source.slice(wrapperStart, coreStart);
  assert.match(wrapperSource, /m5-authority-unavailable/);
  assert.match(wrapperSource, /m5-1-exact-capability-not-integrated/);

  const r7 = JSON.parse(await readFile(r7Url, 'utf8'));
  assert.equal(r7.decision, 'NO-GO');
  assert.equal(r7.availability, 'UNAVAILABLE');
  assert.equal(r7.future_candidate_contract.activated, false);
  assert.equal(r7.output_boundary.generated, false);
});
