import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  admitPropertyAddressCandidates,
  admitPropertyParcelJoin,
} from '../../src/home_compare/address.js';
import {
  combineHomeCompareSources,
  fetchHomeProfileEvidence,
  loadHomeCompareRegistry,
  loadM2AreaIntelligenceBoundary,
} from '../../src/home_compare/api.js';
import {
  buildWeightSensitivity,
  createEvidenceMetric,
  createHomeCompareProjection,
  decodeHomeCompareShareState,
  encodeHomeCompareShareState,
  HOME_COMPARE_DIMENSIONS,
  HOME_COMPARE_EVIDENCE_KEYS,
  validateHomeCompareProjection,
} from '../../src/home_compare/contract.js';
import {
  observeHomeCompareSources,
  validateHomeCompareSourceObservation,
  validateHomeCompareSourceRegistry,
  writeHomeCompareSourceManifest,
} from '../lib/home_compare_source_smoke.mjs';
import {
  homeCompareProductHtml,
} from '../../src/home_compare/view.js';
import { homeCompareResultsHtml } from '../../src/home_compare/results_view.js';
import { createHomeCompareController } from '../../src/home_compare/controller.js';
import { setLanguage } from '../../src/i18n/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registry = validateHomeCompareSourceRegistry(JSON.parse(
  await readFile(path.join(repoRoot, 'public/data/home_compare_sources.v1.json'), 'utf8'),
));
const defaultWeights = Object.fromEntries(HOME_COMPARE_DIMENSIONS.map((key) => [key, 20]));

test('property address admission rejects low score, competing candidates, and geography conflict', () => {
  assert.throws(
    () => admitPropertyAddressCandidates(candidatePayload([candidate({ score: 89 })])),
    hasCode('ADDRESS_LOW_CONFIDENCE'),
  );
  assert.throws(
    () => admitPropertyAddressCandidates(candidatePayload([
      candidate({ address: '100 TEST ST, 19100', score: 100 }),
      candidate({ address: '102 TEST ST, 19100', score: 99 }),
    ])),
    hasCode('ADDRESS_AMBIGUOUS'),
  );
  assert.throws(
    () => admitPropertyAddressCandidates(candidatePayload([
      candidate({ x: -75.16, y: 39.95 }),
      candidate({ x: -75.16, y: 39.952 }),
    ])),
    hasCode('ADDRESS_GEOGRAPHY_CONFLICT'),
  );
});

test('property address and parcel join preserve runtime identity while failing closed on parcel gaps', () => {
  const address = admitPropertyAddressCandidates(candidatePayload([candidate()]));
  const joined = admitPropertyParcelJoin(address, { rows: [parcelRow()] });
  assert.equal(joined.normalizedAddress, '100 TEST ST');
  assert.equal(joined.parcelId, '123456789');
  assert.ok(joined.join.distanceMeters < 20);
  assert.equal(joined.property.yearBuilt, 1999);

  assert.throws(() => admitPropertyParcelJoin(address, { rows: [] }), hasCode('PARCEL_MISSING'));
  assert.throws(() => admitPropertyParcelJoin(address, { rows: [
    parcelRow(),
    parcelRow({ parcel_number: '987654321' }),
  ] }), hasCode('PARCEL_AMBIGUOUS'));
  assert.throws(() => admitPropertyParcelJoin(address, { rows: [
    parcelRow(),
    parcelRow({ market_value: 110000 }),
  ] }), hasCode('PARCEL_AMBIGUOUS'));
  assert.throws(() => admitPropertyParcelJoin(address, { rows: [
    parcelRow({ location: '102 TEST ST' }),
  ] }), hasCode('PARCEL_ADDRESS_MISMATCH'));
  assert.throws(() => admitPropertyParcelJoin(address, { rows: [
    parcelRow({ lon: -75.1, lat: 40.05 }),
  ] }), hasCode('PARCEL_GEOGRAPHY_MISMATCH'));
  assert.throws(() => admitPropertyParcelJoin(address, { rows: [
    parcelRow({ lon: 0, lat: 0 }),
  ] }), hasCode('PARCEL_ROW_INVALID'));
});

test('Home Compare serving projection admits two, three, and four profiles without private fields', () => {
  for (const count of [2, 3, 4]) {
    const projection = makeProjection(count);
    assert.equal(projection.profiles.length, count);
    assert.equal(projection.status, 'partial', 'source revision gaps keep the overall projection partial');
    assert.equal(projection.areaIntelligence.status, 'not-promoted');
    assert.equal(projection.areaIntelligence.forecast.status, 'unavailable');
    assert.deepEqual(projection.areaIntelligence.forecast.predictions, []);
    assert.equal(projection.commute.status, 'unavailable');
    const serialized = JSON.stringify(projection);
    assert.doesNotMatch(serialized, /"(?:input_address|normalized_address|coordinates|parcel_identifier|source_record_id)"\s*:/i);
    assert.doesNotMatch(serialized, /100 TEST ST/i);
  }
});

test('Home Compare controller admits exactly two, three, and four unique parcels', async () => {
  for (const count of [2, 3, 4]) {
    let evidenceCalls = 0;
    const { controller, host } = createControllerHarness({
      fetchEvidence: async () => {
        evidenceCalls += 1;
        return controllerEvidenceResult(evidenceCalls);
      },
      loadResultsView: () => ({ homeCompareResultsHtml: () => `<article>${count}</article>` }),
    });
    while (controller.getState().addressCount < count) host.querySelector('[data-home-add]').emit('click');
    setControllerAddresses(host, Array.from({ length: count }, (_, index) => `${index + 1}00 TEST ST`));
    const completed = await controller.compare();
    assert.equal(completed.status, 'partial');
    assert.equal(completed.projection.profiles.length, count);
    assert.equal(evidenceCalls, count);
  }
});

test('Home Compare keeps partial and unavailable evidence distinct from admitted zero', () => {
  const availableZero = metric({ value: { recordCount: 0 } });
  const unavailable = metric({ status: 'unavailable', value: null, dataAsOf: null });
  assert.equal(availableZero.status, 'available');
  assert.equal(availableZero.value.recordCount, 0);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.value, null);
  assert.throws(
    () => createEvidenceMetric({
      status: 'unavailable',
      value: { recordCount: 0 },
      dataAsOf: null,
      coverage: 'Synthetic test coverage.',
      precision: 'Synthetic test precision.',
      sourceIds: ['synthetic-source'],
      limitations: [],
    }),
    /value must be null/i,
  );
});

test('Home Compare rejects promotion, forecasts, safety claims, and private projection fields', () => {
  const projection = makeProjection(2);
  const promoted = structuredClone(projection);
  promoted.areaIntelligence.status = 'promoted';
  assert.throws(() => validateHomeCompareProjection(promoted), /must remain not-promoted/i);

  const forecast = structuredClone(projection);
  forecast.areaIntelligence.forecast = { status: 'available', reason: 'synthetic', predictions: [1] };
  assert.throws(() => validateHomeCompareProjection(forecast), /forecast must remain unavailable/i);

  const safety = structuredClone(projection);
  safety.profiles[0].evidence.property.value.safety_score = 99;
  assert.throws(() => validateHomeCompareProjection(safety), /forbidden field/i);

  const privateField = structuredClone(projection);
  privateField.profiles[0].evidence.property.value.address = '100 TEST ST';
  assert.throws(() => validateHomeCompareProjection(privateField), /forbidden field/i);

  for (const [key, value] of [
    ['normalizedAddress', '100 TEST ST'],
    ['lat', 39.95],
    ['lon', -75.16],
    ['geometry', { x: -75.16, y: 39.95 }],
    ['commuteDestination', 'PRIVATE DESTINATION'],
  ]) {
    const alias = structuredClone(projection);
    alias.profiles[0].evidence.property.value[key] = value;
    assert.throws(
      () => validateHomeCompareProjection(alias),
      /forbidden field/i,
      `${key} must be rejected from serializable comparison artifacts`,
    );
  }
});

test('Home Compare normalizes private field keys across naming styles without rejecting ordinary identifiers', () => {
  const privateKeys = [
    'ownerName', 'owner_name', 'owner-name',
    'grantorName', 'grantor_name', 'grantor-name',
    'granteeName', 'grantee_name', 'grantee-name',
    'opaAccountNum', 'opa_account_num', 'opa-account-num',
    'parcelNumber', 'parcel_number', 'parcel-number',
    'normalizedAddress', 'normalized_address', 'normalized-address',
    'coordinates',
  ];
  for (const key of privateKeys) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = { [key]: 'private identity' };
    assert.throws(
      () => validateHomeCompareProjection(projection),
      /forbidden field/i,
      `${key} must fail closed at a nested serialization boundary`,
    );
  }

  const ordinary = structuredClone(makeProjection(2));
  ordinary.profiles[0].evidence.property.value.details = {
    sourceId: 'public-aggregate-source',
    source_id: 'public-aggregate-source',
    ownership: 'non-identifying aggregate category',
  };
  assert.doesNotThrow(() => validateHomeCompareProjection(ordinary));
});

test('Home Compare rejects plural private aliases and OPA account abbreviations recursively', () => {
  const privateAliases = [
    'owners', 'grantors', 'grantees', 'parcels',
    'opaAcctNum', 'opa_acct_num', 'opa-acct-num',
  ];
  for (const key of privateAliases) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [
      { publicSummary: { [key]: ['private identity'] } },
    ];
    assert.throws(
      () => validateHomeCompareProjection(projection),
      /forbidden field/i,
      `${key} must fail closed inside nested arrays and objects`,
    );
  }

  const ordinary = structuredClone(makeProjection(2));
  ordinary.profiles[0].evidence.property.value.details = [{
    sourceId: 'public-aggregate-source',
    source_id: 'public-aggregate-source',
    ownership: 'non-identifying aggregate category',
  }];
  assert.doesNotThrow(() => validateHomeCompareProjection(ordinary));
});

test('Home Compare rejects unsafe conclusions from every user-visible text container', () => {
  const hostile = 'This proves this home is the safest.';
  const mutators = [
    (projection) => { projection.profiles[0].evidence.property.coverage = hostile; },
    (projection) => { projection.profiles[0].evidence.property.precision = hostile; },
    (projection) => { projection.profiles[0].evidence.property.limitations = [hostile]; },
    (projection) => { projection.profiles[0].evidence.property.value.summary = hostile; },
    (projection) => { projection.sources[0].coverage = hostile; },
    (projection) => { projection.sources[0].precision = hostile; },
    (projection) => { projection.sources[0].limitations = [hostile]; },
    (projection) => { projection.profiles[0].limitations = [hostile]; },
    (projection) => { projection.limitations = [hostile]; },
    (projection) => { projection.sensitivity.interpretation = hostile; },
  ];
  for (const mutate of mutators) {
    const projection = structuredClone(makeProjection(2));
    mutate(projection);
    assert.throws(() => validateHomeCompareProjection(projection), /unsafe conclusion/i);
  }

  const legitimate = structuredClone(makeProjection(2));
  legitimate.profiles[0].evidence.property.coverage = 'Coverage is limited to admitted public records.';
  legitimate.profiles[0].evidence.property.precision = 'This does not establish property condition or absolute safety.';
  legitimate.profiles[0].limitations = ['Missing evidence is unavailable, not zero.'];
  legitimate.limitations = ['The comparison does not establish causality, suitability, or personal risk.'];
  assert.doesNotThrow(() => validateHomeCompareProjection(legitimate));
});

test('Home Compare applies clause-aware bilingual conclusion semantics and bounds nested text', () => {
  const hostileConclusions = [
    'This home is the safest.',
    'This home has the lowest risk.',
    'This proves\nthis home is the safest.',
    'This does not prove this home is safe, but this home is the safest.',
    'This does not prove this home is safe; however, this home has the lowest risk.',
    '这证明该住宅最安全。',
    '这不能证明该住宅安全，但该住宅最安全。',
    '这不能证明该住宅安全；然而该住宅属于最低风险。',
  ];
  for (const text of hostileConclusions) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ conclusion: text }];
    assert.throws(
      () => validateHomeCompareProjection(projection),
      /invalid|unsafe conclusion/i,
      `${JSON.stringify(text)} must fail closed`,
    );
  }

  for (const text of [
    'This does not prove this home is safe.',
    '这不能证明该住宅安全。',
    'Feature proximity cannot be converted into victim probability or a safety conclusion.',
    'HIN is crash-derived road context, not address risk, probability, or a ranking.',
    'Targets are weekly counts, not a complete account of harm, individual victim probability, or absolute safety.',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ limitation: text }];
    assert.doesNotThrow(
      () => validateHomeCompareProjection(projection),
      `${JSON.stringify(text)} is a legitimate limitation`,
    );
  }

  for (const text of ['', `bounded${String.fromCharCode(0)}escape`, 'x'.repeat(801)]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ note: text }];
    assert.throws(() => validateHomeCompareProjection(projection), /invalid/i);
  }
});

test('Home Compare admits direct English and Chinese negation disclosures', () => {
  for (const text of [
    'This home is not safe.',
    '该住宅并不安全。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ limitation: text }];
    assert.doesNotThrow(() => validateHomeCompareProjection(projection));
  }
});

test('Home Compare does not let unavailable evidence mask a later affirmative conclusion', () => {
  for (const text of [
    'Risk is unavailable and this home is the safest.',
    '该区域风险数据不可用，但该住宅最安全。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ conclusion: text }];
    assert.throws(() => validateHomeCompareProjection(projection), /unsafe conclusion/i);
  }
});

test('Home Compare scopes disclosures across common English and Chinese clause boundaries', () => {
  for (const text of [
    'This cannot prove safety and the home is the safest.',
    'Risk is unavailable, while the property is the safest.',
    'This home is not safe, and the route is safest.',
    'This cannot prove safety, the property is safest.',
    '风险不可用，且该住宅最安全。',
    '该路线并不安全，同时该路线风险最低。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ conclusion: text }];
    assert.throws(() => validateHomeCompareProjection(projection), /unsafe conclusion/i);
  }

  for (const text of [
    'Risk and safety are unavailable.',
    'Reported incidents are incomplete history, not individual risk, absolute safety, or a forecast.',
    '风险和安全结论均不可用。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ limitation: text }];
    assert.doesNotThrow(() => validateHomeCompareProjection(projection));
  }
});

test('Home Compare rejects affirmative causal claims and preserves explicit causal negation', () => {
  for (const text of [
    'The route reduces crime.',
    'The property increases incidents.',
    'The home prevents victimization.',
    'The route lowers risk.',
    'The property raises harm.',
    '该路线降低犯罪。',
    '该住宅减少受害事件。',
    '该区域增加风险。',
    '该住宅提高受害概率。',
    '该路线预防犯罪。',
    '该住宅防止受害事件。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ conclusion: text }];
    assert.throws(() => validateHomeCompareProjection(projection), /unsafe conclusion/i);
  }

  for (const text of [
    'The route does not reduce crime.',
    'The property cannot increase incidents.',
    '该路线不能降低犯罪。',
    '该住宅不减少受害事件。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ limitation: text }];
    assert.doesNotThrow(() => validateHomeCompareProjection(projection));
  }
});

test('Home Compare rejects every Unicode control or format character before conclusion checks', () => {
  for (const text of [
    `bounded${String.fromCodePoint(0x7f)}escape`,
    `bounded${String.fromCodePoint(0x85)}escape`,
    `bounded${String.fromCodePoint(0x200b)}escape`,
    `saf${String.fromCodePoint(0x7f)}est`,
    `saf${String.fromCodePoint(0x200b)}est`,
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ conclusion: text }];
    assert.throws(() => validateHomeCompareProjection(projection), /invalid/i);
  }
});

test('Home Compare rejects affirmative home claims regardless of unrelated disclosure placement', () => {
  for (const text of [
    'The home is safest although risk is unavailable.',
    'The home is safest because evidence is not complete.',
    'The property is safest despite unknown risk.',
    'The home is safest, not merely safe.',
    'Evidence is not complete and your home is safest.',
    '该住宅最安全，因为风险不可用。',
    '该住宅最安全，虽然风险不可用。',
    '风险数据不可用，所以该住宅最安全。',
    '该住宅最安全且风险不可用。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ conclusion: text }];
    assert.throws(() => validateHomeCompareProjection(projection), /unsafe conclusion/i);
  }
});

test('Home Compare admits subject-independent safety predicates with locally bound negation', () => {
  for (const text of [
    'The neighborhood is safest.',
    'The community is safest.',
    'The street is safest.',
    'The block has the lowest risk.',
    'This residence is safest.',
    '该街道风险最低。',
    '这个社区最安全。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ conclusion: text }];
    assert.throws(() => validateHomeCompareProjection(projection), /unsafe conclusion/i);
  }

  for (const text of [
    'No home is safe.',
    'This neighborhood is not safe.',
    '没有住宅是安全的。',
    '该街道并不安全。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ limitation: text }];
    assert.doesNotThrow(() => validateHomeCompareProjection(projection));
  }
});

test('Home Compare rejects expanded direct safety and risk predicates', () => {
  for (const text of [
    'The home remains safest.',
    'The neighborhood offers the lowest risk.',
    'The street poses no risk.',
    'Block 5 is safest.',
    'Residence 21 has the lowest risk.',
    'Neighborhood risk is lowest.',
    '该住宅没有风险。',
    '该小区最安全。',
    '街道风险为最低。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ conclusion: text }];
    assert.throws(() => validateHomeCompareProjection(projection), /unsafe conclusion/i);
  }
});

test('Home Compare rejects syntax-anchored active passive and reverse causal assertions', () => {
  for (const text of [
    'The route causes crime.',
    'Crime is caused by the route.',
    'The route decreases incidents.',
    'The property stops victimization.',
    '该路线导致犯罪。',
    '犯罪由该路线造成。',
    '该住宅阻止受害事件。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ conclusion: text }];
    assert.throws(() => validateHomeCompareProjection(projection), /unsafe conclusion/i);
  }
});

test('Home Compare rejects contrastive negation that masks a later assertion', () => {
  for (const text of [
    'The route reduces not congestion but crime.',
    'This proves not cost but safety.',
    'This establishes not value but risk.',
    'Crime is not reduced but is increased by the route.',
    '犯罪没有减少反而因该路线而增加。',
    '这证明的不是便利，而是安全。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ conclusion: text }];
    assert.throws(() => validateHomeCompareProjection(projection), /unsafe conclusion/i);
  }
});

test('Home Compare admits evidence-linked and quantified safety denials', () => {
  for (const text of [
    'There is no reliable evidence that the route reduces crime.',
    'No currently admitted evidence shows the neighborhood reduces crime.',
    'The route cannot be shown to reduce crime.',
    'The property has not been shown to increase incidents.',
    '没有可靠证据表明该路线降低犯罪。',
    'Not every home is safe.',
    'Neither home is safe.',
    '没有一个住宅是安全的。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ limitation: text }];
    assert.doesNotThrow(() => validateHomeCompareProjection(projection));
  }
});

test('Home Compare admits source product and dataset metadata descriptions', () => {
  for (const text of [
    'The source reports increases in crime.',
    'The product displays an increase in crime counts.',
    'The dataset reports reduced incidents from the official source.',
    'The source has low-risk and high-risk category labels.',
    'The dataset has the lowest risk field named category.',
    'The product has the safest-route label disabled.',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ description: text }];
    assert.doesNotThrow(() => validateHomeCompareProjection(projection));
  }
});

test('Home Compare rejects residential claims disguised as metadata and Chinese double negation', () => {
  for (const text of [
    'The home has the lowest risk field named category.',
    'The property has the safest-route label disabled.',
    '该住宅不是不安全，而是最安全。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ conclusion: text }];
    assert.throws(() => validateHomeCompareProjection(projection), /unsafe conclusion/i);
  }
});

test('Home Compare rejects ambiguous safety and causal text through the fail-closed lexicon', () => {
  for (const text of [
    'These homes are safest.',
    'Homes have the lowest risk.',
    'The two homes are safest.',
    'Community homes are safest.',
    'The block is clearly safest.',
    '社区的风险最低。',
    'The route does not reduce crime, yet increases incidents.',
    'Crime is not reduced by the route but increased by the property.',
    'The route significantly reduces crime.',
    'The route reduces the risk.',
    '该路线不降低犯罪但增加风险。',
    '该路线不能减少事件，同时提高风险。',
    '该路线明显降低犯罪。',
    '该路线降低了犯罪。',
    'The route reduces crime but does not increase risk.',
    '该路线降低犯罪但不增加风险。',
    'No evidence exists and the home is safest.',
    '该住宅没有风险。',
    'The source is safe.',
    'The property is not unsafe.',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ conclusion: text }];
    assert.throws(() => validateHomeCompareProjection(projection), /unsafe conclusion/i);
  }
});

test('Home Compare allows only complete trusted metadata and bounded denial forms', () => {
  for (const text of [
    'The source shows risk fields from the official dataset.',
    'The product indicates risk availability.',
    'The dataset shows safety-related record counts.',
    '该来源说明风险字段。',
    'This source has low-risk categories.',
    'A dataset has the lowest risk field named category.',
    'Neither of the homes is safe.',
    'None of the homes is safe.',
    'No residential property is safe.',
    'There is no home that is safe.',
    '没有任何住宅是安全的。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ limitation: text }];
    assert.doesNotThrow(() => validateHomeCompareProjection(projection));
  }
});

test('Home Compare rejects evidence denials followed by inference or a second assertion', () => {
  for (const text of [
    'No evidence shows the route reduces crime so the home is safest.',
    'No evidence shows the route reduces crime therefore the home is safest.',
    'There is no proof that the route reduces crime hence the property is safest.',
    'No evidence shows the route reduces crime. The home is safest.',
    'This cannot prove the route reduces crime. The home is safest.',
    '没有证据表明该路线降低犯罪故该住宅最安全。',
    '没有证据表明该路线降低犯罪于是该住宅最安全。',
    '没有证据表明该路线降低犯罪并由此证明该住宅最安全。',
    '没有证据表明该路线降低犯罪。该住宅最安全。',
    'No evidence shows the route reduces crime! The home is safest.',
    'There is no proof that the route reduces crime? The property is safest.',
    'This cannot prove absolute safety therefore the route has the lowest risk.',
    '没有证据表明该路线降低犯罪！该住宅最安全。',
    '没有证据证明该住宅安全？该区域风险最低。',
    '这不能证明该住宅安全故该路线风险最低。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ conclusion: text }];
    assert.throws(() => validateHomeCompareProjection(projection), /unsafe conclusion/i);
  }
});

test('Home Compare binds negation to each complete assertion instead of the surrounding sentence', () => {
  for (const text of [
    'The route reduces crime but does not increase risk.',
    'The route does not reduce crime but the property increases incidents.',
    'No evidence exists and the home is safest.',
    'No evidence shows the route reduces crime, but the home is safest.',
    '该路线降低犯罪但不增加风险。',
    'The home has no risk.',
    'Crime is reduced by the route although risk is unavailable.',
    'The property is not unsafe.',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ conclusion: text }];
    assert.throws(() => validateHomeCompareProjection(projection), /unsafe conclusion/i);
  }
});

test('Home Compare admits locally negated causal and operational metadata statements', () => {
  for (const text of [
    'The route does not reduce crime.',
    'The source reports reduced incident coverage.',
    'The parser is safe to retry.',
    'Risk and safety conclusions are unavailable.',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ limitation: text }];
    assert.doesNotThrow(() => validateHomeCompareProjection(projection));
  }
});

test('Home Compare rejects active, passive, and reverse causal claims with local negation only', () => {
  for (const text of [
    'Crime is reduced by the route.',
    'Incidents are increased by the property.',
    'Victimization is prevented by the home.',
    'Harm is lowered by the route.',
    '犯罪因该路线而降低。',
    '受害事件被该住宅防止。',
    '事件因该区域而增加。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ conclusion: text }];
    assert.throws(() => validateHomeCompareProjection(projection), /unsafe conclusion/i);
  }

  for (const text of [
    'Crime is not reduced by the route.',
    'No evidence shows the route reduces crime.',
    '犯罪没有因该路线而降低。',
    '没有证据表明该路线降低犯罪。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ limitation: text }];
    assert.doesNotThrow(() => validateHomeCompareProjection(projection));
  }
});

test('Home Compare admits descriptive safety and risk text without an affirmative predicate', () => {
  for (const text of [
    'The product displays public safety and risk context.',
    'The source reports risk indicators.',
    'The product compares risk evidence by profile.',
    'Source coverage includes safety-related public records.',
    'No evidence shows the route reduces crime.',
    'There is no proof that the property increases incidents.',
    '没有证据表明该路线降低犯罪。',
    '没有证据证明该住宅最安全。',
  ]) {
    const projection = structuredClone(makeProjection(2));
    projection.profiles[0].evidence.property.value.details = [{ description: text }];
    assert.doesNotThrow(() => validateHomeCompareProjection(projection));
  }
});

test('Home Compare commute and isochrone outputs remain unavailable without admitted routing authority', () => {
  for (const mutate of [
    (projection) => { projection.commute.status = 'available'; },
    (projection) => { projection.commute.authority = 'caller-claimed-graph'; },
    (projection) => { projection.commute.travelTimes = [{ minutes: 10 }]; },
    (projection) => { projection.commute.isochrones = [{ minutes: 15 }]; },
    (projection) => { projection.commute.reason = 'This establishes a low-risk route.'; },
  ]) {
    const projection = structuredClone(makeProjection(2));
    mutate(projection);
    assert.throws(() => validateHomeCompareProjection(projection), /commute|unsafe conclusion/i);
  }
});

test('Home Compare admits only historical-only M2 and fails current unavailability closed', async () => {
  const trackedM2 = JSON.parse(await readFile(path.join(repoRoot, 'public/data/area_intelligence_baseline.v1.json'), 'utf8'));
  const historical = await loadM2AreaIntelligenceBoundary({ request: async () => trackedM2 });
  const admittedHistorical = structuredClone(makeProjection(2));
  admittedHistorical.areaIntelligence = historical;
  assert.equal(validateHomeCompareProjection(admittedHistorical).areaIntelligence.status, 'not-promoted');

  const unsafe = structuredClone(makeProjection(2));
  unsafe.areaIntelligence.historicalEvidence.limitations = ['This evidence establishes a low-risk area.'];
  assert.throws(() => validateHomeCompareProjection(unsafe), /unsafe conclusion/i);

  const malformed = structuredClone(makeProjection(2));
  malformed.areaIntelligence.historicalEvidence.measure = null;
  assert.throws(() => validateHomeCompareProjection(malformed), /historical evidence contract/i);

  let evidenceCalls = 0;
  const { controller, host } = createControllerHarness({
    loadAreaIntelligence: async () => unavailableAreaBoundary(),
    fetchEvidence: async () => {
      evidenceCalls += 1;
      return controllerEvidenceResult(evidenceCalls);
    },
    loadResultsView: () => ({ homeCompareResultsHtml: () => '<article>must not render</article>' }),
  });
  setControllerAddresses(host);
  assert.deepEqual(await controller.compare(), { status: 'unavailable', reason: 'source-unavailable' });
  assert.equal(evidenceCalls, 0, 'an unavailable M2 boundary is rejected before private evidence queries');
  assert.equal(controller.getState().hasResult, false);
});

test('Home Compare aborts sibling address work when malformed M2 fails', async () => {
  const signals = [];
  const never = deferred();
  const { controller, host } = createControllerHarness({
    loadAreaIntelligence: async () => { throw new TypeError('Malformed M2 fixture.'); },
    resolveAddress: async (_address, { signal }) => {
      signals.push(signal);
      return never.promise;
    },
    loadResultsView: () => ({ homeCompareResultsHtml: () => '<article>must not render</article>' }),
  });
  setControllerAddresses(host);
  assert.deepEqual(await controller.compare(), { status: 'unavailable', reason: 'source-unavailable' });
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal.aborted), 'malformed M2 aborts sibling private address requests');
  assert.equal(controller.getState().hasResult, false);
});

test('Home Compare rejects caller-tampered profile and root availability states', () => {
  const rootTamper = structuredClone(makeProjection(2));
  rootTamper.status = 'available';
  assert.throws(
    () => validateHomeCompareProjection(rootTamper),
    /status mismatch/i,
  );

  const profileTamper = structuredClone(makeProjection(2));
  profileTamper.profiles[0].evidence.assessments = metric({
    status: 'unavailable', value: null, dataAsOf: null,
  });
  assert.throws(
    () => validateHomeCompareProjection(profileTamper),
    /status mismatch/i,
  );
});

test('share state contains weights and dimensions only and rejects malicious or private state', () => {
  const encoded = encodeHomeCompareShareState({ weights: defaultWeights });
  const decoded = decodeHomeCompareShareState(encoded);
  assert.deepEqual(decoded.weights, defaultWeights);
  assert.deepEqual(decoded.dimensions, HOME_COMPARE_DIMENSIONS);
  assert.doesNotMatch(encoded, /address|destination|coordinate|parcel|<script/i);

  assert.throws(() => decodeHomeCompareShareState(JSON.stringify({
    ...JSON.parse(encoded),
    address: '<img src=x onerror=alert(1)>',
  })), /fields are invalid/i);
  assert.throws(() => decodeHomeCompareShareState(JSON.stringify({
    ...JSON.parse(encoded),
    weights: { ...defaultWeights, property: 101 },
  })), /integer from 0 to 100/i);
  assert.throws(() => decodeHomeCompareShareState('{"__proto__":{"address":"private"}}'), /fields are invalid/i);
  assert.throws(() => decodeHomeCompareShareState('x'.repeat(4097)), /bounded JSON text/i);
  assert.throws(() => decodeHomeCompareShareState(JSON.stringify({
    ...JSON.parse(encoded),
    dimensions: ['property'],
  })), /dimensions are invalid/i);
});

test('weight sensitivity changes evidence emphasis without ranking homes or recommending', () => {
  const sensitivity = buildWeightSensitivity({
    property: 40,
    costHistory: 25,
    civicRecords: 15,
    transportContext: 10,
    dataQuality: 10,
  });
  assert.deepEqual(sensitivity.topDimensions, ['property', 'costHistory']);
  assert.equal(sensitivity.perturbationPercent, 20);
  assert.match(sensitivity.interpretation, /do not rank homes/i);
  assert.doesNotMatch(JSON.stringify(sensitivity), /safety[_-]?score|recommendedHome|winner/i);

  const uneven = buildWeightSensitivity({
    property: 1,
    costHistory: 1,
    civicRecords: 1,
    transportContext: 1,
    dataQuality: 2,
  });
  assert.equal(
    Object.values(uneven.normalizedWeights).reduce((sum, value) => sum + Math.round(value * 10), 0),
    1000,
    'normalized percentages must total exactly 100.0 after rounding',
  );
  assert.throws(
    () => buildWeightSensitivity(Object.fromEntries(HOME_COMPARE_DIMENSIONS.map((key) => [key, 0]))),
    /at least one weight must be positive/i,
  );
  assert.throws(
    () => buildWeightSensitivity({ ...defaultWeights, property: 20.5 }),
    /integer from 0 to 100/i,
  );
});

test('Home Compare view renders 2/3/4 address controls, bilingual boundaries, and escaped labels', () => {
  for (const count of [2, 3, 4]) {
    const shell = homeCompareProductHtml({
      locale: count === 3 ? 'zh-CN' : 'en',
      addressCount: count,
      weights: defaultWeights,
    });
    assert.equal((shell.match(/data-home-address=/g) || []).length, count);
    assert.match(shell, count === 3 ? /并排比较 2–4 个费城住宅/ : /Compare 2–4 Philadelphia homes/);
    assert.match(shell, count === 3
      ? /地址、坐标和 parcel ID 仅临时用于查询列出的官方公共来源/
      : /used ephemerally to query the listed official public sources/);
    assert.match(shell, count === 3
      ? /通勤目的地只保留在本次会话中/
      : /commute destinations remain in this session/);
  }
  const rendered = homeCompareResultsHtml(makeProjection(2), {
    labels: ['<img src=x onerror=alert(1)>', '<script>alert(2)</script>'],
    locale: 'zh-CN',
  });
  assert.doesNotMatch(rendered, /<img|<script/i);
  assert.match(rendered, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(rendered, /预测继续不可用/);
  assert.match(rendered, /通勤时间与 isochrone 不可用/);
  assert.match(rendered, /不计算 safety score/);
});

test('Home Compare discards a computed projection when a deferred results renderer outlives close or destroy', async () => {
  for (const action of ['close', 'destroy']) {
    const resultsView = deferred();
    let evidenceCalls = 0;
    const { controller, dialog, host } = createControllerHarness({
      loadResultsView: () => resultsView.promise,
      fetchEvidence: async () => {
        evidenceCalls += 1;
        return controllerEvidenceResult(evidenceCalls);
      },
    });
    setControllerAddresses(host);

    const pending = controller.compare();
    await waitFor(() => evidenceCalls === 2);
    await nextTurn();
    assert.equal(controller.getState().busy, true, `${action} case remains pending on renderer import`);
    assert.equal(controller.getState().hasResult, false, `${action} case does not commit before renderer import`);

    if (action === 'close') host.querySelector('[data-home-close]').emit('click');
    else controller.destroy();
    assert.equal(controller.getState().hasResult, false, `${action} clears an in-flight projection`);

    resultsView.resolve({ homeCompareResultsHtml: () => '<article>stale</article>' });
    assert.deepEqual(await pending, { status: 'superseded' });
    assert.equal(controller.getState().hasResult, false, `${action} cannot leave stale results renderable`);
    assert.equal(controller.getState().busy, false, `${action} cannot leave the controller busy`);
  }
});

test('Home Compare synchronously cancels click and Escape before a queued native close event', async () => {
  for (const action of ['click', 'escape']) {
    const resultsView = deferred();
    const { controller, dialog, host } = createControllerHarness({ loadResultsView: () => resultsView.promise });
    setControllerAddresses(host);
    const pending = controller.compare();
    await nextTurn();
    if (action === 'click') host.querySelector('[data-home-close]').emit('click');
    else dialog.cancel();
    assert.equal(controller.getState().busy, false, `${action} preflight cancels before close event`);
    assert.equal(controller.getState().hasResult, false, `${action} clears renderable in-flight state synchronously`);
    resultsView.resolve({ homeCompareResultsHtml: () => '<article>stale</article>' });
    assert.deepEqual(await pending, { status: 'superseded' });
    assert.equal(controller.getState().hasResult, false, `${action} cannot commit during queued close timing`);
    await nextTurn();
  }
});

test('Home Compare freezes every request input and rejects busy edits before state changes', async () => {
  const evidence = deferred();
  const resolvedAddresses = [];
  let evidenceCalls = 0;
  const { controller, host } = createControllerHarness({
    resolveAddress: async (address) => {
      resolvedAddresses.push(address);
      return controllerIdentity(address);
    },
    fetchEvidence: async () => {
      evidenceCalls += 1;
      return evidence.promise;
    },
    loadResultsView: () => ({ homeCompareResultsHtml: () => '<article>snapshot</article>' }),
  });
  setControllerAddresses(host);
  const destinations = host.querySelector('[data-home-destinations]');
  destinations.value = 'Original destination';
  destinations.emit('input');

  const pending = controller.compare();
  await waitFor(() => evidenceCalls === 2);
  const [firstAddress, secondAddress] = [
    host.querySelector('[data-home-address="0"]'),
    host.querySelector('[data-home-address="1"]'),
  ];
  const propertyWeight = host.querySelectorAll('[data-home-weight]')
    .find((input) => input.dataset.homeWeight === 'property');
  assert.equal(firstAddress.disabled, true);
  assert.equal(destinations.disabled, true);
  assert.equal(propertyWeight.disabled, true);
  assert.equal(host.querySelector('[data-home-add]').disabled, true);

  firstAddress.value = '999 MUTATED ST';
  firstAddress.emit('input');
  destinations.value = 'Mutated destination';
  destinations.emit('input');
  propertyWeight.value = '100';
  propertyWeight.emit('input');
  assert.deepEqual(controller.getState().weights, defaultWeights, 'busy weight edit is rejected before state mutation');

  evidence.resolve(controllerEvidenceResult(1));
  const completed = await pending;
  assert.deepEqual(resolvedAddresses, ['100 TEST ST', '200 TEST ST'], 'address resolution uses the immutable request snapshot');
  assert.equal(completed.projection.sensitivity.normalizedWeights.property, 20, 'projection sensitivity uses the immutable request snapshot');
  assert.equal(host.querySelector('[data-home-address="0"]').value, '100 TEST ST');
  assert.equal(host.querySelector('[data-home-destinations]').value, 'Original destination');
});

test('Home Compare rejects duplicate parcel identities before evidence queries', async () => {
  let evidenceCalls = 0;
  const { controller, host } = createControllerHarness({
    resolveAddress: async (address) => controllerIdentity(address, '111111111'),
    fetchEvidence: async () => {
      evidenceCalls += 1;
      return controllerEvidenceResult(evidenceCalls);
    },
    loadResultsView: () => ({ homeCompareResultsHtml: () => '<article>should not render</article>' }),
  });
  setControllerAddresses(host);

  assert.deepEqual(await controller.compare(), { status: 'unavailable', reason: 'parcel-duplicate' });
  assert.equal(evidenceCalls, 0);
  assert.equal(controller.getState().hasResult, false);
});

test('Home Compare rejects duplicate normalized addresses even if a hostile resolver changes parcel identity', async () => {
  let resolution = 0;
  let evidenceCalls = 0;
  const { controller, host } = createControllerHarness({
    resolveAddress: async () => controllerIdentity('100 TEST ST', resolution++ === 0 ? '111111111' : '222222222'),
    fetchEvidence: async () => {
      evidenceCalls += 1;
      return controllerEvidenceResult(evidenceCalls);
    },
    loadResultsView: () => ({ homeCompareResultsHtml: () => '<article>should not render</article>' }),
  });
  setControllerAddresses(host, ['100 TEST ST', '100 TEST ST']);

  assert.deepEqual(await controller.compare(), { status: 'unavailable', reason: 'address-duplicate' });
  assert.equal(evidenceCalls, 0);
  assert.equal(controller.getState().hasResult, false);
});

test('Home Compare supersedes an old address session before stale evidence work or commit', async () => {
  const oldIdentities = [deferred(), deferred()];
  let oldIndex = 0;
  const evidenceParcels = [];
  const { controller, dialog, host } = createControllerHarness({
    resolveAddress: async (address) => {
      if (address.startsWith('OLD')) return oldIdentities[oldIndex++].promise;
      return controllerIdentity(address, address.endsWith('A') ? '222222222' : '333333333');
    },
    fetchEvidence: async (identity) => {
      evidenceParcels.push(identity.parcelId);
      return {
        ...controllerEvidenceResult(evidenceParcels.length),
        privateLabel: identity.displayAddress,
      };
    },
    loadResultsView: () => ({ homeCompareResultsHtml: (_projection, { labels }) => `<article>${labels.join('|')}</article>` }),
  });
  setControllerAddresses(host, ['OLD A', 'OLD B']);
  const oldCompare = controller.compare();
  await waitFor(() => oldIndex === 2);
  host.querySelector('[data-home-close]').emit('click');
  await nextTurn();

  controller.open();
  setControllerAddresses(host, ['NEW A', 'NEW B']);
  const current = await controller.compare();
  assert.equal(current.status, 'partial');
  assert.deepEqual(evidenceParcels, ['222222222', '333333333']);

  oldIdentities[0].resolve(controllerIdentity('OLD A', '444444444'));
  oldIdentities[1].resolve(controllerIdentity('OLD B', '555555555'));
  assert.deepEqual(await oldCompare, { status: 'superseded' });
  assert.deepEqual(evidenceParcels, ['222222222', '333333333'], 'stale identities cannot launch evidence queries');
  assert.equal(controller.getState().hasResult, true);
  assert.match(host.querySelector('[data-home-results]').innerHTML, /NEW A\|NEW B/);
  dialog.close();
});

test('Home Compare shares only non-location settings and uses no persistent browser storage or logging', async () => {
  const copied = [];
  const replacements = [];
  const { controller, host } = createControllerHarness({
    clipboard: { writeText: async (value) => { copied.push(value); } },
    historyRef: { replaceState: (state, title, url) => { replacements.push({ state, title, url: String(url) }); } },
    locationRef: { href: 'https://example.test/compare?legacy=private#old' },
  });
  setControllerAddresses(host, ['PRIVATE HOME A', 'PRIVATE HOME B']);
  const destinations = host.querySelector('[data-home-destinations]');
  destinations.value = 'PRIVATE DESTINATION';
  destinations.emit('input');
  host.querySelector('[data-home-share]').emit('click');
  await waitFor(() => copied.length === 1 && replacements.length === 1);

  const serializedEffects = JSON.stringify({ copied, replacements });
  assert.doesNotMatch(serializedEffects, /PRIVATE HOME|PRIVATE DESTINATION|legacy=private|#old/i);
  assert.deepEqual(replacements[0].state, {});
  const sharedUrl = new URL(copied[0]);
  assert.deepEqual([...sharedUrl.searchParams.keys()], ['hc']);
  assert.equal(sharedUrl.hash, '');
  assert.deepEqual(decodeHomeCompareShareState(sharedUrl.searchParams.get('hc')).weights, defaultWeights);
  assert.equal(controller.getState().status, 'shared');

  const runtimeSource = await Promise.all([
    'src/home_compare/address.js',
    'src/home_compare/contract.js',
    'src/home_compare/controller.js',
  ].map((file) => readFile(path.join(repoRoot, file), 'utf8')));
  assert.doesNotMatch(
    runtimeSource.join('\n'),
    /\b(?:localStorage|sessionStorage|indexedDB|sendBeacon|console\.(?:log|info|warn|error)|telemetry)\b/,
  );
});

test('Home Compare renderer execution failures stay results-unavailable and recover with a healthy retry', async () => {
  const unhandled = [];
  const observeUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', observeUnhandled);
  try {
    let attempt = 0;
    const { controller, dialog, host } = createControllerHarness({
      loadResultsView: () => {
        attempt += 1;
        if (attempt === 1) return { homeCompareResultsHtml: () => { throw new Error('initial renderer failure'); } };
        if (attempt === 2) return {
          homeCompareResultsHtml: (_projection, { locale }) => {
            if (locale === 'zh-CN') throw new Error('language renderer failure');
            return '<article>first healthy render</article>';
          },
        };
        return { homeCompareResultsHtml: () => '<article>recovered renderer</article>' };
      },
    });
    setControllerAddresses(host);
    assert.deepEqual(await controller.compare(), { status: 'unavailable', reason: 'results-unavailable' });
    assert.equal(controller.getState().hasResult, false);
    assert.equal(host.querySelector('[data-home-retry-results]').hidden, false);

    host.querySelector('[data-home-retry-results]').emit('click');
    await waitFor(() => controller.getState().hasResult);
    assert.equal(host.querySelector('[data-home-results]').innerHTML, '<article>first healthy render</article>');
    setLanguage('zh-CN');
    assert.equal(controller.getState().status, 'results-unavailable');
    assert.equal(controller.getState().hasResult, false, 'language re-render failure clears committed state');
    assert.equal(host.querySelector('[data-home-retry-results]').hidden, false);
    host.querySelector('[data-home-retry-results]').emit('click');
    await waitFor(() => controller.getState().hasResult);
    assert.equal(host.querySelector('[data-home-results]').innerHTML, '<article>recovered renderer</article>');
    setLanguage('en');
    await nextTurn();
    assert.deepEqual(unhandled, []);
    dialog.close();
  } finally {
    setLanguage('en');
    process.removeListener('unhandledRejection', observeUnhandled);
  }
});

test('Home Compare preserves completed results across an ordinary queued close and reopen', async () => {
  const { controller, dialog, host } = createControllerHarness({
    loadResultsView: () => ({ homeCompareResultsHtml: () => '<article>completed</article>' }),
  });
  setControllerAddresses(host);
  await controller.compare();
  dialog.close();
  await nextTurn();
  controller.open();
  assert.equal(controller.getState().hasResult, true);
  assert.equal(host.querySelector('[data-home-results]').innerHTML, '<article>completed</article>');
});

test('Home Compare observes lazy results-view rejection, keeps it separate from source unavailability, and retries explicitly', async () => {
  const unhandled = [];
  const observeUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', observeUnhandled);
  try {
    let viewAttempts = 0;
    const { controller, host } = createControllerHarness({
      loadResultsView: () => {
        viewAttempts += 1;
        if (viewAttempts === 1) return Promise.reject(new Error('chunk unavailable'));
        return Promise.resolve({ homeCompareResultsHtml: () => '<article>recovered</article>' });
      },
    });
    setControllerAddresses(host);

    const failed = await controller.compare();
    assert.deepEqual(failed, { status: 'unavailable', reason: 'results-unavailable' });
    assert.deepEqual(controller.getState(), {
      addressCount: 2,
      busy: false,
      status: 'results-unavailable',
      hasResult: false,
      weights: defaultWeights,
    });
    assert.equal(host.querySelector('[data-home-retry-results]').hidden, false);
    await nextTurn();
    assert.deepEqual(unhandled, [], 'the import rejection is observed from creation');

    host.querySelector('[data-home-retry-results]').emit('click');
    await waitFor(() => !controller.getState().busy && controller.getState().hasResult);
    assert.equal(viewAttempts, 2);
    assert.equal(controller.getState().status, 'partial');
    assert.equal(host.querySelector('[data-home-results]').innerHTML, '<article>recovered</article>');
  } finally {
    process.removeListener('unhandledRejection', observeUnhandled);
  }
});

test('source registry freezes official fields, privacy exclusions, and unavailable routing', () => {
  assert.equal(registry.sources.length, 9);
  assert.equal(registry.routing.status, 'unavailable');
  assert.equal(registry.routing.road.status, 'unavailable');
  assert.equal(registry.routing.transit.status, 'unavailable');
  assert.ok(registry.privacy.forbidden_tracked_or_shareable_fields.includes('address'));
  assert.ok(registry.sources.every((source) => source.canonical_url.startsWith('https://')));
});

test('runtime registry admission rejects drift and routing promotion', async () => {
  assert.equal((await loadHomeCompareRegistry({ request: async () => registry })).sources.length, 9);
  const promoted = structuredClone(registry);
  promoted.routing.status = 'available';
  await assert.rejects(
    loadHomeCompareRegistry({ request: async () => promoted }),
    /must remain unavailable/i,
  );
  const drifted = structuredClone(registry);
  drifted.sources[0].unexpected = true;
  await assert.rejects(
    loadHomeCompareRegistry({ request: async () => drifted }),
    /fields are invalid/i,
  );
});

test('runtime evidence keeps geocoder provenance, unknown counts, source revision, and tax-year timing honest', async () => {
  const identity = admitPropertyParcelJoin(
    admitPropertyAddressCandidates(candidatePayload([candidate()])),
    { rows: [parcelRow()] },
  );
  const result = await fetchHomeProfileEvidence(identity, {
    request: syntheticRuntimeRequest,
    now: () => '2026-08-21T00:00:00.000Z',
    incidentReader: async () => 0,
    coverageReader: async () => ({ min: '2006-01-01', max: '2026-08-20' }),
  });
  assert.deepEqual(result.profile.evidence.property.sourceIds, [
    'citygeo-address-locator',
    'opa-current-property',
  ]);
  assert.equal(result.sourceStates['citygeo-address-locator'].recordCount, 1);
  assert.equal(result.sourceStates['citygeo-address-locator'].dataAsOf, null);
  assert.equal(result.sourceStates['opa-current-property'].recordCount, 1);
  assert.equal(result.sourceStates['opa-current-property'].dataAsOf, '2026-01-01T00:00:00.000Z');
  assert.equal(result.profile.evidence.assessments.status, 'partial');
  assert.equal(result.profile.evidence.assessments.value.latestTaxYear, 2027);
  assert.equal(result.profile.evidence.assessments.dataAsOf, null);
  assert.equal(result.profile.evidence.hinContext.dataAsOf, null);

  result.sourceStates['citygeo-address-locator'].recordCount = null;
  const sources = await combineHomeCompareSources(registry, [result], '2026-08-21T00:00:00.000Z');
  assert.equal(sources.length, 9);
  assert.equal(sources.find(({ sourceId }) => sourceId === 'citygeo-address-locator').recordCount, null);
  assert.deepEqual(
    sources.find(({ sourceId }) => sourceId === 'vision-zero-hin-2025').revision,
    { status: 'unavailable', identity: null },
  );
});

test('source observation validator rejects malformed partial counts', () => {
  const source = registry.sources[0];
  assert.throws(() => validateHomeCompareSourceObservation({
    sourceId: source.id,
    status: 'partial',
    dataset: source.dataset,
    transport: source.transport,
    retrievedAt: '2026-08-21T00:00:00.000Z',
    sourceAsOf: null,
    revision: null,
    rowCount: -1,
    schemaFields: [...source.expected_fields],
    missingFields: [],
    dq: [],
  }, source), /row count/i);
});

test('source smoke fails schema drift closed and writes semantic no-op idempotently', async (t) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'home-compare-smoke-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const requestJson = syntheticSourceRequest(registry);
  const first = await observeHomeCompareSources(registry, {
    requestJson,
    retrievedAt: '2026-08-21T00:00:00.000Z',
  });
  assert.equal(first.status, 'partial');
  assert.ok(first.observations.every(({ status }) => status === 'partial'));
  assert.equal(first.routing.status, 'unavailable');
  const assessment = first.observations.find(({ sourceId }) => sourceId === 'opa-assessment-history');
  assert.equal(assessment.sourceAsOf, null);
  assert.ok(assessment.dq.includes('max-published-assessment-tax-year-2026'));

  const target = path.join(outputRoot, 'manifest.json');
  const written = await writeHomeCompareSourceManifest(first, target);
  assert.equal(written.status, 'published');
  const firstStat = await stat(target);
  const second = await observeHomeCompareSources(registry, {
    requestJson,
    retrievedAt: '2026-08-21T01:00:00.000Z',
  });
  assert.equal(second.semanticIdentity, first.semanticIdentity);
  const noOp = await writeHomeCompareSourceManifest(second, target);
  assert.equal(noOp.status, 'idempotent');
  assert.equal((await stat(target)).mtimeMs, firstStat.mtimeMs);
  assert.equal(JSON.parse(await readFile(target, 'utf8')).generatedAt, first.generatedAt);

  const driftedRequest = syntheticSourceRequest(registry, { omitGeocoderField: 'Ref_ID' });
  const drifted = await observeHomeCompareSources(registry, { requestJson: driftedRequest });
  const geocoder = drifted.observations.find(({ sourceId }) => sourceId === 'citygeo-address-locator');
  assert.equal(geocoder.status, 'unavailable');
  assert.deepEqual(geocoder.missingFields, ['Ref_ID']);
  assert.ok(geocoder.dq.includes('schema-drift'));
});

function makeProjection(count) {
  const profiles = Array.from({ length: count }, (_, index) => {
    const partial = index === count - 1 && count === 3;
    return {
      profileId: `home-${index + 1}`,
      status: partial ? 'partial' : 'available',
      evidence: Object.fromEntries(HOME_COMPARE_EVIDENCE_KEYS.map((key) => [
        key,
        partial && key === 'assessments' ? metric({ status: 'partial' }) : metric(),
      ])),
      limitations: ['Synthetic fixture for isolated contract testing only.'],
    };
  });
  return createHomeCompareProjection({
    generatedAt: '2026-08-21T00:00:00.000Z',
    profiles,
    sources: [sourceObservation()],
    areaIntelligence: areaBoundary(),
    sensitivity: buildWeightSensitivity(defaultWeights),
  });
}

function metric({ status = 'available', value = { recordCount: 0 }, dataAsOf = '2026-08-20T00:00:00.000Z' } = {}) {
  return createEvidenceMetric({
    status,
    value,
    dataAsOf,
    coverage: 'Synthetic fixture coverage.',
    precision: 'Synthetic fixture precision.',
    sourceIds: ['synthetic-source'],
    limitations: ['Synthetic fixture only; not runtime or source evidence.'],
  });
}

function sourceObservation() {
  return {
    sourceId: 'synthetic-source',
    status: 'partial',
    officialUrl: 'https://example.invalid/official-source',
    sourceAsOf: '2026-08-20T00:00:00.000Z',
    retrievedAt: '2026-08-21T00:00:00.000Z',
    builtAt: null,
    observedAt: '2026-08-21T00:00:00.000Z',
    revision: { status: 'unavailable', identity: null },
    coverage: 'Synthetic fixture coverage.',
    precision: 'Synthetic fixture precision.',
    recordCount: 0,
    limitations: ['Synthetic fixture only; not runtime or source evidence.'],
  };
}

function areaBoundary() {
  return {
    status: 'not-promoted',
    historicalEvidence: {
      status: 'available',
      measure: 'PPD reported incidents',
      coverage: '2006-01-01 to 2026-08-22.',
      limitations: ['Reported incidents are not absolute safety evidence.'],
    },
    forecast: {
      status: 'unavailable',
      reason: 'model-did-not-exceed-predefined-seasonal-baseline',
      predictions: [],
    },
  };
}

function unavailableAreaBoundary() {
  return {
    status: 'unavailable',
    historicalEvidence: {
      status: 'unavailable',
      measure: null,
      coverage: 'Current M2 serving evidence is unavailable.',
      limitations: ['Unavailable is not zero and does not establish safety, causality, or risk.'],
    },
    forecast: {
      status: 'unavailable',
      reason: 'current-m2-serving-evidence-unavailable',
      predictions: [],
    },
  };
}

function candidate({
  address = '100 TEST ST, 19100',
  score = 100,
  x = -75.16,
  y = 39.95,
  type = 'PointAddress',
} = {}) {
  return {
    address,
    score,
    location: { x, y },
    attributes: {
      Score: score,
      Match_addr: address,
      House: '100',
      Addr_type: type,
      Ref_ID: 'synthetic-ref',
    },
  };
}

function candidatePayload(candidates) {
  return { candidates };
}

function parcelRow(overrides = {}) {
  return {
    parcel_number: '123456789',
    location: '100 TEST ST',
    lon: -75.15995,
    lat: 39.95002,
    assessment_date: '2026-01-01T00:00:00Z',
    market_value: 100000,
    market_value_date: '2026-01-01T00:00:00Z',
    sale_date: '2020-01-01T00:00:00Z',
    sale_price: 90000,
    recording_date: '2020-02-01T00:00:00Z',
    total_livable_area: 1200,
    number_of_bedrooms: 3,
    number_of_bathrooms: 2,
    year_built: 1999,
    zoning: 'RSA5',
    ...overrides,
  };
}

async function syntheticRuntimeRequest(url, options = {}) {
  const text = String(url);
  if (text.includes('Vacant_Indicators_Bldg')) return { features: [] };
  if (text.includes('high_injury_network_2025')) return { count: 0 };
  const sql = new URLSearchParams(options.body || '').get('q') || '';
  if (/FROM assessments/i.test(sql)) return { rows: [{ year: 2027, market_value: 120000 }] };
  if (/FROM rtt_summary/i.test(sql)) return { rows: [] };
  if (/FROM public_cases_fc/i.test(sql)) return { rows: [{ record_count: 0, open_count: 0, earliest_at: null, latest_at: null }] };
  if (/FROM violations/i.test(sql)) return { rows: [{ record_count: 0, not_closed_count: 0, latest_at: null }] };
  if (/FROM business_licenses/i.test(sql)) return { rows: [{ record_count: 0, active_count: 0, latest_at: null }] };
  if (/FROM case_investigations/i.test(sql)) return { rows: [{ record_count: 0, not_closed_count: 0, latest_at: null }] };
  throw new Error(`Unexpected synthetic runtime request: ${text}`);
}

function syntheticSourceRequest(sourceRegistry, { omitGeocoderField = null } = {}) {
  const byTable = new Map();
  for (const source of sourceRegistry.sources) {
    if (source.transport !== 'carto-sql') continue;
    if (source.id === 'li-property-history') {
      byTable.set('violations', source.expected_fields.filter((field) => ['opa_account_num', 'parcel_id_num', 'violationdate', 'violationstatus'].includes(field)));
      byTable.set('business_licenses', source.expected_fields.filter((field) => ['opa_account_num', 'parcel_id_num', 'licensetype', 'licensestatus'].includes(field)));
      byTable.set('case_investigations', source.expected_fields.filter((field) => ['opa_account_num', 'parcel_id_num', 'investigationcompleted', 'investigationstatus'].includes(field)));
    } else {
      byTable.set(source.dataset, source.expected_fields);
    }
  }
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/GeocodeServer')) {
      const fields = sourceRegistry.sources.find(({ id }) => id === 'citygeo-address-locator').expected_fields
        .filter((field) => field !== omitGeocoderField);
      return { candidateFields: fields.map((name) => ({ name })) };
    }
    if (parsed.pathname.endsWith('/query')) return { count: 7 };
    if (parsed.hostname === 'services.arcgis.com') {
      const source = sourceRegistry.sources.find(({ api_url }) => api_url === `${parsed.origin}${parsed.pathname}`);
      return {
        fields: source.expected_fields.map((name) => ({ name })),
        editingInfo: { lastEditDate: Date.parse('2026-08-17T00:00:00.000Z') },
      };
    }
    const query = parsed.searchParams.get('q') || '';
    const table = [...byTable.keys()].find((name) => query.includes(`FROM ${name}`));
    if (!table) throw new Error(`Synthetic request did not recognize query: ${query}`);
    if (/LIMIT 0/i.test(query)) {
      return { fields: Object.fromEntries(byTable.get(table).map((field) => [field, { type: 'string' }])) };
    }
    return { rows: [{ row_count: 10, source_as_of: '2026-08-20T00:00:00.000Z' }] };
  };
}

function hasCode(code) {
  return (error) => error?.code === code;
}

function createControllerHarness({
  loadResultsView,
  fetchEvidence = async () => controllerEvidenceResult(1),
  resolveAddress = async (address) => controllerIdentity(address),
  loadAreaIntelligence = async () => areaBoundary(),
  clipboard,
  locationRef = { href: 'https://example.test/' },
  historyRef = { replaceState() {} },
} = {}) {
  const host = new ControllerHost();
  const dialog = new ControllerDialog(host);
  const controller = createHomeCompareController({
    dialog,
    loadResultsView,
    loadRegistry: async () => registry,
    loadAreaIntelligence,
    resolveAddress,
    fetchEvidence,
    clipboard,
    locationRef,
    historyRef,
  });
  return { controller, dialog, host };
}

function controllerIdentity(address, parcelId = null) {
  const digits = address.match(/\d+/)?.[0] || '1';
  return {
    normalizedAddress: address,
    displayAddress: address,
    parcelId: parcelId || digits.padStart(9, '0').slice(-9),
  };
}

function controllerEvidenceResult(index) {
  return {
    profile: structuredClone(makeProjection(2).profiles[index - 1] || makeProjection(2).profiles[0]),
    privateLabel: `Private home ${index}`,
    sourceStates: Object.fromEntries(registry.sources.map((source) => [source.id, {
      sourceId: source.id,
      status: 'unavailable',
      recordCount: null,
      dataAsOf: null,
      retrievedAt: null,
    }])),
  };
}

function setControllerAddresses(host, values = ['100 TEST ST', '200 TEST ST']) {
  for (const [index, value] of values.entries()) {
    const input = host.querySelector(`[data-home-address="${index}"]`);
    input.value = value;
    input.emit('input');
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitFor(predicate, attempts = 20) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await nextTurn();
  }
  assert.fail('Timed out waiting for the controller condition.');
}

class ControllerElement {
  #listeners = new Map();

  constructor(dataset = {}) {
    this.dataset = dataset;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.disabled = false;
  }

  addEventListener(type, listener) {
    const listeners = this.#listeners.get(type) || [];
    listeners.push(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.#listeners.set(type, (this.#listeners.get(type) || []).filter((item) => item !== listener));
  }

  emit(type) {
    for (const listener of [...(this.#listeners.get(type) || [])]) listener({ currentTarget: this, target: this });
  }

  replaceChildren() {
    this.innerHTML = '';
  }

  focus() {}

  scrollIntoView() {}
}

class ControllerHost extends ControllerElement {
  #elements = new Map();
  #weights = HOME_COMPARE_DIMENSIONS.map((dimension) => new ControllerElement({ homeWeight: dimension }));

  constructor() {
    super();
    for (const selector of [
      '[data-home-destinations]', '[data-home-add]', '[data-home-run]', '[data-home-share]',
      '[data-home-close]', '[data-home-status]', '[data-home-results]', '[data-home-retry-results]',
    ]) this.#elements.set(selector, new ControllerElement());
  }

  querySelector(selector) {
    const address = selector.match(/^\[data-home-address="(\d+)"\]$/);
    if (address) return this.#element(selector);
    return this.#elements.get(selector) || null;
  }

  querySelectorAll(selector) {
    if (selector === '[data-home-weight]') return this.#weights;
    if (selector === '[data-home-remove]') return [];
    return [];
  }

  #element(selector) {
    if (!this.#elements.has(selector)) this.#elements.set(selector, new ControllerElement());
    return this.#elements.get(selector);
  }
}

class ControllerDialog extends ControllerElement {
  constructor(host) {
    super();
    this.host = host;
  }

  querySelector(selector) {
    return selector === '[data-home-compare-host]' ? this.host : null;
  }

  setAttribute() {}

  removeAttribute() {}

  showModal() {}

  close() {
    setImmediate(() => this.emit('close'));
  }

  cancel() {
    this.emit('cancel');
    this.close();
  }
}
