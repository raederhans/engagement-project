import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertPublicRouteCopyBoundary } from '../lib/public_route_copy_policy.mjs';

import {
  PUBLIC_ROUTE_SCENARIO_SCHEMA,
  admitPublicRouteScenarioArtifact,
  buildPublicRouteScenarioViewModel,
} from '../../src/public_route_alternatives/model.js';
import {
  PUBLIC_ROUTE_SCENARIO_ADMISSION_MANIFEST,
  PUBLIC_ROUTE_SCENARIO_ADMISSION_MANIFEST_SCHEMA,
} from '../../src/public_route_alternatives/admission_manifest.js';

const fixtureUrl = new URL(
  '../../public/data/route_alternatives_public_scenarios.v1.json',
  import.meta.url,
);
const m5Url = new URL('../../src/route_alternatives_m5/index.js', import.meta.url);
const r7Url = new URL('../../reports/known-route/r7-go-no-go.v1.json', import.meta.url);
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
const PROHIBITED_PRODUCT_COPY = /\bsafest\b|\bsafer\b|\bbest route\b|\blowest risk\b|\bleast risk\b|\brecommend(?:ed|ation|ations|ing)?\b|\brisk score\b|\bsafety score\b|personal victim probability|最安全|更安全|最佳路线|最低风险|风险最低|低风险|推荐|首选|风险评分|安全评分|个人受害概率/i;

const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
const clone = (value) => structuredClone(value);
const exactKeys = (value, keys) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort());

async function admittedFixture() {
  return admitPublicRouteScenarioArtifact(clone(fixture));
}

async function assertRejected(changed, expected) {
  await assert.rejects(() => admitPublicRouteScenarioArtifact(changed), expected);
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

test('fixture has the exact public walking schema and versioned independent admission manifest', async () => {
  assert.equal(PUBLIC_ROUTE_SCENARIO_SCHEMA, 'engagement-public-route-scenarios/v1');
  assert.equal(
    PUBLIC_ROUTE_SCENARIO_ADMISSION_MANIFEST_SCHEMA,
    'engagement-public-route-scenario-admission/v1',
  );
  assert.equal(Object.isFrozen(PUBLIC_ROUTE_SCENARIO_ADMISSION_MANIFEST), true);
  assert.equal(
    PUBLIC_ROUTE_SCENARIO_ADMISSION_MANIFEST.identity.artifactId,
    'philadelphia-public-landmark-walking-alternatives-2026-09-01',
  );
  assert.match(PUBLIC_ROUTE_SCENARIO_ADMISSION_MANIFEST.canonicalSha256, /^sha256:[a-f0-9]{64}$/);
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

  const admitted = await admittedFixture();
  assert.equal(Object.isFrozen(admitted), true);
  assert.equal(Object.isFrozen(admitted.scenarios[0].candidates[0].metrics), true);
});

test('admission rejects private, network, routing-authority, arbitrary-pair, and non-walking drift', async () => {
  for (const boundary of RUNTIME_KEYS) {
    const changed = clone(fixture);
    changed.runtimeBoundary[boundary] = true;
    await assertRejected(changed, TypeError);
  }

  const privatePair = clone(fixture);
  privatePair.scenarios[0].origin.landmarkId = 'private-home-address';
  await assertRejected(privatePair, /allowlist/i);

  const arbitraryScenario = clone(fixture);
  arbitraryScenario.scenarios[0].scenarioId = 'arbitrary-od';
  await assertRejected(arbitraryScenario, /allowlist/i);

  const driving = clone(fixture);
  driving.scenarios[0].mode = 'driving';
  await assertRejected(driving, /walking/i);
});

test('complete scenario exposes at most four honest roles, Pareto facts, and unstable trade-offs without a winner', async () => {
  const view = buildPublicRouteScenarioViewModel(
    await admittedFixture(),
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

test('accessibility-oriented appears only when admitted accessibility evidence meets the criterion', async () => {
  const artifact = await admittedFixture();
  const available = buildPublicRouteScenarioViewModel(
    artifact,
    'city-hall-to-art-museum-complete',
    'en',
  );
  const accessibilityCard = available.cards.find(
    ({ role }) => role === 'accessibility-oriented',
  );
  assert.ok(accessibilityCard);
  assert.equal(accessibilityCard.metrics.accessibility.status, 'available');
  assert.equal(accessibilityCard.metrics.accessibility.value, 'meets');

  const withoutAccessibility = buildPublicRouteScenarioViewModel(
    artifact,
    'rittenhouse-square-to-30th-street-degraded',
    'en',
  );
  assert.equal(
    withoutAccessibility.cards.some(({ role }) => role === 'accessibility-oriented'),
    false,
  );
});

test('single candidate produces exactly one ordinary route card', async () => {
  const view = buildPublicRouteScenarioViewModel(
    await admittedFixture(),
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

test('unavailable evidence or map matching degrades to one ordinary route with explicit unavailable dimensions', async () => {
  const view = buildPublicRouteScenarioViewModel(
    await admittedFixture(),
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

test('canonical manifest rejects candidate, evidence, map-match, and sensitivity drift', async () => {
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
    await assert.rejects(
      () => admitPublicRouteScenarioArtifact(changed),
      /content digest/i,
      `${gate} drift must fail closed`,
    );
  }
});

test('admission rejects artifact identity and generated-at drift before public rendering', async () => {
  const invalidArtifactId = clone(fixture);
  invalidArtifactId.artifactId = 'INVALID ARTIFACT ID';
  await assertRejected(invalidArtifactId, /artifact\.artifactId is invalid/i);

  const changedArtifactId = clone(fixture);
  changedArtifactId.artifactId = `${fixture.artifactId}-drift`;
  await assertRejected(changedArtifactId, /artifact identity.*admission manifest/i);

  for (const generatedAt of ['not-a-date', '2026-02-30T00:00:00.000Z']) {
    const invalidGeneratedAt = clone(fixture);
    invalidGeneratedAt.generatedAt = generatedAt;
    await assertRejected(invalidGeneratedAt, /artifact\.generatedAt must be an ISO instant/i);
  }

  const staleGeneratedAt = clone(fixture);
  staleGeneratedAt.generatedAt = '2026-08-01T00:00:00.000Z';
  await assertRejected(staleGeneratedAt, /generatedAt precedes admitted source evidence/i);

  const changedGeneratedAt = clone(fixture);
  changedGeneratedAt.generatedAt = '2026-09-02T00:00:00.000Z';
  await assertRejected(changedGeneratedAt, /artifact identity.*admission manifest/i);
});

test('admission manifest rejects candidate, edge, label, and in-range metric drift', async () => {
  const changedCandidate = clone(fixture);
  changedCandidate.scenarios[0].candidates[0].candidateId = 'cityhall-artmuseum-fast-v2';
  await assertRejected(changedCandidate, /artifact identity.*admission manifest/i);

  const changedEdge = clone(fixture);
  changedEdge.scenarios[0].candidates[0].edgeIds[0] = 'ch-am-f-99';
  await assertRejected(changedEdge, /artifact identity.*admission manifest/i);

  const reorderedEdges = clone(fixture);
  reorderedEdges.scenarios[0].candidates[0].edgeIds.reverse();
  await assertRejected(reorderedEdges, /artifact identity.*admission manifest/i);

  const changedLabel = clone(fixture);
  changedLabel.scenarios[0].candidates[0].label.en = 'Fast illustrative option v2';
  await assertRejected(changedLabel, /content digest.*admission manifest/i);

  const changedMetric = clone(fixture);
  changedMetric.scenarios[0].candidates[0].metrics.travelTime.value = 1441;
  await assertRejected(changedMetric, /content digest.*admission manifest/i);
});

test('admission rejects recommendation, safer, and lowest-risk copy in English and Chinese', async () => {
  const mutations = [
    ['en', 'Recommended option'],
    ['en', 'Safer option'],
    ['en', 'Lowest risk option'],
    ['zh-CN', '推荐选项'],
    ['zh-CN', '更安全选项'],
    ['zh-CN', '最低风险选项'],
  ];
  for (const [locale, copyValue] of mutations) {
    const changed = clone(fixture);
    changed.scenarios[0].candidates[0].label[locale] = copyValue;
    await assertRejected(changed, /copy boundary/i);
  }
});

test('visible-copy guard admits only exact negated disclosures and rejects product claims', () => {
  assert.doesNotThrow(() => assertPublicRouteCopyBoundary([
    'This is not live directions, an observed route evaluation, or a recommendation.',
    'Treat the cards as tradeoffs, not as a recommendation.',
    '它不是实时导航、实测路线评估或推荐，也不具备路线或安全权限。',
    '请将卡片视为权衡说明，而非推荐。',
  ].join('\n')));
  for (const hostileCopy of [
    'This is a recommendation.',
    'We recommend this route.',
    'Personal victim probability: 20%.',
    'Least risk option.',
    '这是推荐路线。',
    '个人受害概率为 20%。',
    '首选路线。',
    '风险最低。',
    '低风险路线。',
  ]) {
    assert.throws(() => assertPublicRouteCopyBoundary(hostileCopy), /copy boundary/i);
  }
});

test('admission rejects invalid units, contradictory map-match states, and unknown categories', async () => {
  const wrongUnit = clone(fixture);
  wrongUnit.scenarios[0].candidates[0].metrics.travelTime.unit = 'meters';
  await assertRejected(wrongUnit, /travelTime\.unit/i);

  const contradictoryMapMatch = clone(fixture);
  for (const candidate of contradictoryMapMatch.scenarios[0].candidates) {
    candidate.metrics.mapMatchQuality = {
      status: 'unavailable', value: null, unit: null, sourceAsOf: null,
      note: {en: 'Unavailable: test fixture.', 'zh-CN': '不可用：测试数据。'},
    };
  }
  await assertRejected(contradictoryMapMatch, /mapMatch complete conflicts/i);

  const unknownAccessibility = clone(fixture);
  unknownAccessibility.scenarios[0].candidates[0].metrics.accessibility.value = 'unknown';
  await assertRejected(unknownAccessibility, /accessibility\.value.*categorical/i);
});

test('missing values stay Unavailable rather than becoming zero, and public output avoids prohibited claims', async () => {
  assertUnavailableNeverMeansZero(fixture);
  const artifact = await admittedFixture();
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
