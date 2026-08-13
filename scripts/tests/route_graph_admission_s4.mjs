import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  INTERNAL_IDENTITY_LIMITATION,
  CALLER_SUPPLIED_REVIEW_ASSERTION_SCHEMA,
  evaluateRouteGraphEligibility,
  inspectRouteGraphAdmissionEvidence,
  verifyRouteGraphEligibilityReport,
} from '../lib/route_graph_admission/index.mjs';
import {
  createCandidateReceipt,
  normalizeRouteGraphCandidate,
} from '../lib/route_graph_candidate/index.mjs';

const sourceDescriptorFixture = await candidateFixture('synthetic_descriptor.json');
const modeProfileFixture = await candidateFixture('walking_profile.json');
const rawGraphFixture = await candidateFixture('valid_raw_graph.json');
const authorityPolicyFixture = await admissionFixture('authority_policy.json');
const promotionIntentFixture = await admissionFixture('promotion_intent.json');
const reviewTemplateFixture = await admissionFixture('review_template.json');

test('complete external evidence is recomputed into separate eligibility identities without actual state', () => {
  const inputs = validInputs();
  const report = evaluateRouteGraphEligibility(inputs);

  assert.equal(report.schema, 'route-graph-external-eligibility-report/v1');
  assert.equal(report.dataClassification, 'validation-only-external-graph-eligibility');
  assert.equal(report.authorityVerified, false);
  assert.equal(report.actualAdmission, false);
  assert.equal(report.promotionExecuted, false);
  assert.equal(report.materializedArtifact, false);
  assert.ok(report.limitations.includes(INTERNAL_IDENTITY_LIMITATION));
  assert.equal(report.identities.semanticDiff.disposition, 'unchanged');
  assert.deepEqual(report.identities.semanticDiff.changedAxes, []);

  const gates = report.gates;
  for (const gate of [
    gates.externalDataEligibility,
    gates.internalReviewEligibility,
    gates.productGraphEligibility,
    gates.redistributionEligibility,
    gates.publicAccessEligibility,
    gates.publicationEligibility,
  ]) {
    assert.equal(gate.eligible, false);
    assert.equal(gate.authorityVerified, false);
    assert.equal(gate.callerPolicyConformance, true);
    assert.deepEqual(gate.conformanceReasonCodes, []);
    assert.ok(gate.reasonCodes.includes('authority-unverified'));
  }
  assert.equal(gates.publicationEligibility.authorityVerified, false);
  assert.equal(gates.publicationEligibility.actualAdmission, false);
  assert.equal(gates.publicationEligibility.promotionExecuted, false);
  assert.equal(gates.publicationEligibility.materializedArtifact, false);
  assert.equal(gates.sourceHealthProjection.projectedStatus, 'unknown');
  assert.equal(gates.sourceHealthProjection.observationState, 'not-observed');
  assert.equal(gates.sourceHealthProjection.recordCount, null);
  assert.equal(gates.sourceHealthProjection.projectionOnly, true);
  assert.equal(gates.sourceHealthProjection.catalogMutationAuthorized, false);

  const stageIdentities = [
    gates.externalDataEligibility.identity,
    gates.internalReviewEligibility.identity,
    gates.productGraphEligibility.identity,
    gates.redistributionEligibility.identity,
    gates.publicAccessEligibility.identity,
    gates.publicationEligibility.identity,
  ];
  assert.equal(new Set(stageIdentities).size, stageIdentities.length);
  assert.equal('graphArtifact' in gates.productGraphEligibility, false);
  assert.equal('artifact' in gates.productGraphEligibility, false);
  assert.deepEqual(verifyRouteGraphEligibilityReport(report, inputs), report, 'verified report matches the recomputed frozen value');
});

test('semantic diff binds schema/source/license/coverage/clocks/mode/topology/geometry/content/audit axes', () => {
  const baselineLifecycle = externalLifecycle();
  const currentLifecycle = externalLifecycle();
  currentLifecycle.descriptor.clocks.sourceAsOf = '2026-08-12';
  currentLifecycle.descriptor.license.derivativeRedistribution = 'prohibited';
  currentLifecycle.descriptor.coverage.routing.description = 'Reviewed synthetic routing coverage changed.';
  const changedRaw = externalRawGraph();
  changedRaw.features.find((feature) => feature.edge_id === 'e-bc').cost_integer += 1;
  currentLifecycle.normalization = normalizeRouteGraphCandidate(changedRaw, currentLifecycle.profile);

  const inspected = inspectRouteGraphAdmissionEvidence({ baselineLifecycle, currentLifecycle });
  assert.equal(inspected.semanticDiff.disposition, 'review-required');
  assert.ok(inspected.semanticDiff.changedAxes.includes('license-attribution-identity-drift'));
  assert.ok(inspected.semanticDiff.changedAxes.includes('coverage-identity-drift'));
  assert.ok(inspected.semanticDiff.changedAxes.includes('four-clocks-identity-drift'));
  assert.ok(inspected.semanticDiff.changedAxes.includes('topology-identity-drift'));
  assert.ok(inspected.semanticDiff.changedAxes.includes('content-identity-drift'));
  assert.ok(inspected.semanticDiff.changedAxes.includes('graph') === false);
  for (const key of ['schema', 'source', 'licenseAttribution', 'coverage', 'fourClocks', 'mode', 'topology', 'geometry', 'content', 'audit', 'graph']) {
    assert.match(inspected.current[key], /^sha256:[a-f0-9]{64}$/);
  }
});

test('semantic drift fails closed unless a matching caller review assertion is bound to fresh identities', () => {
  const baselineLifecycle = externalLifecycle();
  const currentLifecycle = externalLifecycle();
  currentLifecycle.descriptor.clocks.sourceAsOf = '2026-08-12';
  const inputs = inputsFor(baselineLifecycle, currentLifecycle);
  inputs.reviewEvidence = inputs.reviewEvidence.filter((review) => review.scope !== 'semantic-review');

  const report = evaluateRouteGraphEligibility(inputs);
  assert.equal(report.gates.externalDataEligibility.eligible, false);
  assert.equal(report.gates.externalDataEligibility.callerPolicyConformance, false);
  assert.ok(report.gates.externalDataEligibility.reasonCodes.includes('semantic-diff-not-approved'));
  assert.equal(report.gates.internalReviewEligibility.eligible, false);
  assert.ok(report.gates.internalReviewEligibility.reasonCodes.includes('semantic-review-assertion-missing-or-mismatched'));
});

test('caller-authored eligibility metadata and identities cannot alter a recomputed report', () => {
  const inputs = validInputs();
  const report = structuredClone(evaluateRouteGraphEligibility(inputs));
  report.gates.externalDataEligibility.eligible = false;
  report.gates.externalDataEligibility.reasonCodes = ['caller-chosen-reason'];
  report.gates.productGraphEligibility.eligible = true;
  report.reportIdentity = 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';

  assert.throws(
    () => verifyRouteGraphEligibilityReport(report, inputs),
    hasCode('eligibility-report-recomputation-mismatch'),
  );
});

test('stale review bindings cannot satisfy caller-policy eligibility gates', () => {
  const inputs = validInputs();
  const productReview = inputs.reviewEvidence.find((review) => review.scope === 'product-approval');
  productReview.currentGraphIdentity = 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const report = evaluateRouteGraphEligibility(inputs);

  assert.equal(report.gates.externalDataEligibility.callerPolicyConformance, true);
  assert.equal(report.gates.internalReviewEligibility.callerPolicyConformance, true);
  assert.equal(report.gates.productGraphEligibility.eligible, false);
  assert.equal(report.gates.productGraphEligibility.callerPolicyConformance, false);
  assert.ok(report.gates.productGraphEligibility.reasonCodes.includes('authority-unverified'));
  assert.ok(report.gates.productGraphEligibility.reasonCodes.includes('product-approval-assertion-missing-or-mismatched'));
  assert.equal(report.gates.redistributionEligibility.eligible, false);
});

test('caller baseline allowlist is separate from review assertions', () => {
  const inputs = validInputs();
  inputs.callerSuppliedPolicy.baselineAllowlist = [
    'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  ];
  const report = evaluateRouteGraphEligibility(inputs);

  assert.equal(report.gates.externalDataEligibility.eligible, false);
  assert.ok(report.gates.externalDataEligibility.reasonCodes.includes('baseline-not-caller-allowlisted'));
  assert.equal(report.gates.productGraphEligibility.eligible, false);
});

test('simultaneous caller forgery can only create caller-policy conformance, never eligibility or actual state', () => {
  const inputs = validInputs();
  const inspected = inspectRouteGraphAdmissionEvidence(inputs);
  inputs.callerSuppliedPolicy.policyId = 'caller-invented-policy';
  inputs.callerSuppliedPolicy.baselineAllowlist = [inspected.baseline.graph];
  inputs.callerSuppliedPolicy.authorities[0].authorityId = 'caller-invented-authority';
  for (const review of inputs.reviewEvidence) {
    review.authorityId = 'caller-invented-authority';
    review.baselineIdentity = inspected.baseline.graph;
    review.currentGraphIdentity = inspected.current.graph;
    review.semanticDiffIdentity = inspected.semanticDiff.identity;
    review.decision = 'approved';
  }

  const report = evaluateRouteGraphEligibility(inputs);
  for (const gate of [
    report.gates.externalDataEligibility,
    report.gates.internalReviewEligibility,
    report.gates.productGraphEligibility,
    report.gates.redistributionEligibility,
    report.gates.publicAccessEligibility,
    report.gates.publicationEligibility,
  ]) {
    assert.equal(gate.eligible, false, `${gate.gate} must remain ineligible without verified authority`);
    assert.equal(gate.authorityVerified, false, `${gate.gate} authority must remain unverified`);
    assert.equal(gate.callerPolicyConformance, true, `${gate.gate} may only report caller-policy conformance`);
    assert.deepEqual(gate.conformanceReasonCodes, []);
    assert.ok(gate.reasonCodes.includes('authority-unverified'));
    assert.equal(gate.actualAdmission, false, `${gate.gate} must not express actual admission`);
    assert.equal(gate.promotionExecuted, false, `${gate.gate} must not express promotion`);
    assert.equal(gate.materializedArtifact, false, `${gate.gate} must not express materialization`);
  }
  assert.equal(report.authorityVerified, false);
  assert.equal(report.actualAdmission, false);
  assert.equal(report.promotionExecuted, false);
  assert.equal(report.materializedArtifact, false);
  assert.equal(report.gates.sourceHealthProjection.projectedStatus, 'unknown');
  assert.equal(report.gates.sourceHealthProjection.observationState, 'not-observed');
  assert.equal(report.gates.sourceHealthProjection.recordCount, null);
  assert.equal(report.gates.sourceHealthProjection.authorityVerified, false);
  assert.equal(report.gates.sourceHealthProjection.catalogMutationAuthorized, false);
  assert.equal(report.gates.sourceHealthProjection.runtimeMutationAuthorized, false);
});

test('four clocks, acquisition, coverage, mode and topology gates fail closed', () => {
  const cases = [
    ['source-as-of-unknown', (current) => { current.descriptor.clocks.sourceAsOf = null; }],
    ['acquisition-not-complete', (current) => { current.descriptor.acquisition.status = 'partial'; current.descriptor.acquisition.recordCount = null; }],
    ['fallback-used', (current) => { current.descriptor.acquisition.fallbackUsed = true; }],
    ['routing-coverage-not-validated', (current) => { current.descriptor.coverage.routing.status = 'partial'; }],
  ];
  for (const [reason, mutate] of cases) {
    const baseline = externalLifecycle();
    const current = externalLifecycle();
    mutate(current);
    const inputs = inputsFor(baseline, current);
    const report = evaluateRouteGraphEligibility(inputs);
    assert.equal(report.gates.externalDataEligibility.eligible, false, reason);
    assert.equal(report.gates.externalDataEligibility.callerPolicyConformance, false, reason);
    assert.ok(report.gates.externalDataEligibility.reasonCodes.includes(reason), reason);
    assert.equal(report.gates.sourceHealthProjection.projectedStatus, 'unknown');
    assert.equal(report.gates.sourceHealthProjection.observationState, 'not-observed');
    assert.equal(report.gates.sourceHealthProjection.recordCount, null);
    assert.equal(report.gates.sourceHealthProjection.catalogMutationAuthorized, false);
  }
});

test('fresh full-graph topology audit blocks invalid current graph before every eligibility stage', () => {
  const baseline = externalLifecycle();
  const current = externalLifecycle();
  const invalidRaw = externalRawGraph();
  invalidRaw.features[0].from_node = invalidRaw.features[0].to_node;
  invalidRaw.features[0].coordinates = [
    invalidRaw.features[0].coordinates[1],
    invalidRaw.features[0].coordinates[1],
  ];
  invalidRaw.features[0].cost_integer = 0;
  current.normalization = normalizeRouteGraphCandidate(invalidRaw, current.profile);
  const report = evaluateRouteGraphEligibility(inputsFor(baseline, current));

  assert.equal(report.identities.current.auditStatus, 'failed');
  assert.equal(report.gates.externalDataEligibility.eligible, false);
  assert.equal(report.gates.externalDataEligibility.callerPolicyConformance, false);
  assert.ok(report.gates.externalDataEligibility.reasonCodes.includes('topology-audit-not-passed'));
  assert.equal(report.gates.productGraphEligibility.eligible, false);
  assert.equal(report.gates.publicationEligibility.eligible, false);
});

test('redistribution, public access and publication eligibility stay independent downstream stages', () => {
  const inputs = validInputs();
  inputs.reviewEvidence = inputs.reviewEvidence.filter((review) => review.scope !== 'publication-review');
  const report = evaluateRouteGraphEligibility(inputs);

  assert.equal(report.gates.productGraphEligibility.eligible, false);
  assert.equal(report.gates.productGraphEligibility.callerPolicyConformance, true);
  assert.equal(report.gates.redistributionEligibility.eligible, false);
  assert.equal(report.gates.redistributionEligibility.callerPolicyConformance, true);
  assert.equal(report.gates.publicAccessEligibility.eligible, false);
  assert.equal(report.gates.publicAccessEligibility.callerPolicyConformance, true);
  assert.equal(report.gates.publicationEligibility.eligible, false);
  assert.equal(report.gates.publicationEligibility.callerPolicyConformance, false);
  assert.ok(report.gates.publicationEligibility.reasonCodes.includes('authority-unverified'));
  assert.ok(report.gates.publicationEligibility.reasonCodes.includes('publication-review-assertion-missing-or-mismatched'));
});

test('license and exact attribution are mechanically enforced only at redistribution boundary', () => {
  const inputs = validInputs();
  inputs.promotionIntent.attributionText = 'Caller changed attribution';
  const report = evaluateRouteGraphEligibility(inputs);

  assert.equal(report.gates.productGraphEligibility.eligible, false);
  assert.equal(report.gates.productGraphEligibility.callerPolicyConformance, true);
  assert.equal(report.gates.redistributionEligibility.eligible, false);
  assert.ok(report.gates.redistributionEligibility.reasonCodes.includes('required-attribution-not-satisfied'));
  assert.equal(report.gates.publicAccessEligibility.eligible, false);
  assert.equal(report.gates.publicationEligibility.eligible, false);
});

test('S3-1 candidate receipt cannot be renamed or passed as admitted lifecycle evidence', () => {
  const lifecycle = externalLifecycle();
  const candidate = externalLifecycle();
  const receipt = createCandidateReceipt({ ...candidate, baseline: lifecycle, review: null });
  const inputs = validInputs();
  inputs.currentLifecycle = {
    descriptor: receipt.source,
    profile: receipt.profile,
    normalization: receipt.artifact,
  };
  assert.throws(() => evaluateRouteGraphEligibility(inputs), /normalization.*schema mismatch|normalization-graph-required/);
  assert.notEqual(receipt.artifact.schema, 'GraphArtifact/v1');
});

test('legacy policy, review and promotion versions fail closed', () => {
  const cases = [
    (inputs) => { inputs.callerSuppliedPolicy.schema = 'caller-supplied-route-graph-review-policy/v0'; },
    (inputs) => { inputs.reviewEvidence[0].schema = 'route-graph-review-evidence/v0'; },
    (inputs) => { inputs.promotionIntent.schema = 'route-graph-promotion-intent/v0'; },
  ];
  for (const mutate of cases) {
    const inputs = validInputs();
    mutate(inputs);
    assert.throws(() => evaluateRouteGraphEligibility(inputs), /schema is unsupported/);
  }
});

test('accessors, unknown fields and duplicate review scopes are rejected', () => {
  const accessorInputs = validInputs();
  Object.defineProperty(accessorInputs.callerSuppliedPolicy, 'policyId', { enumerable: true, get: () => 'forged' });
  assert.throws(() => evaluateRouteGraphEligibility(accessorInputs), hasCode('accessor-property'));

  const unknownInputs = validInputs();
  unknownInputs.promotionIntent.eligibility = true;
  assert.throws(() => evaluateRouteGraphEligibility(unknownInputs), hasCode('schema-mismatch'));

  const duplicateInputs = validInputs();
  duplicateInputs.reviewEvidence.push(structuredClone(duplicateInputs.reviewEvidence[0]));
  assert.throws(() => evaluateRouteGraphEligibility(duplicateInputs), hasCode('review-scope-duplicate'));
});

function validInputs() {
  return inputsFor(externalLifecycle(), externalLifecycle());
}

function inputsFor(baselineLifecycle, currentLifecycle) {
  const inspected = inspectRouteGraphAdmissionEvidence({ baselineLifecycle, currentLifecycle });
  const callerSuppliedPolicy = structuredClone(authorityPolicyFixture);
  callerSuppliedPolicy.baselineAllowlist = [inspected.baseline.graph];
  const reviewEvidence = [
    'semantic-review',
    'product-approval',
    'redistribution-review',
    'public-approval',
    'publication-review',
  ].map((scope, index) => ({
    ...structuredClone(reviewTemplateFixture),
    schema: CALLER_SUPPLIED_REVIEW_ASSERTION_SCHEMA,
    reviewId: `synthetic-${scope}-${index}`,
    scope,
    baselineIdentity: inspected.baseline.graph,
    currentGraphIdentity: inspected.current.graph,
    semanticDiffIdentity: inspected.semanticDiff.identity,
  }));
  return {
    baselineLifecycle,
    currentLifecycle,
    callerSuppliedPolicy,
    reviewEvidence,
    promotionIntent: structuredClone(promotionIntentFixture),
  };
}

function externalLifecycle() {
  const descriptor = structuredClone(sourceDescriptorFixture);
  descriptor.sourceId = 'synthetic-city-fixture';
  descriptor.sourceKind = 'city';
  descriptor.license.internalCandidateUse = 'allowed';
  descriptor.license.derivativeRedistribution = 'allowed-with-conditions';
  descriptor.attribution = {
    required: true,
    text: 'Synthetic City route graph fixture',
    url: 'https://example.invalid/synthetic-city/attribution',
  };
  descriptor.clocks.sourceAsOf = '2026-08-11';
  descriptor.limitations = ['Synthetic fixture shaped as external data; it is not acquired or admitted real data.'];
  const profile = structuredClone(modeProfileFixture);
  profile.profileId = 'synthetic-city-walking-v1';
  profile.sourceKind = 'city';
  const raw = externalRawGraph();
  return { descriptor, profile, normalization: normalizeRouteGraphCandidate(raw, profile) };
}

function externalRawGraph() {
  const raw = structuredClone(rawGraphFixture);
  raw.sourceId = 'synthetic-city-fixture';
  raw.sourceKind = 'city';
  return raw;
}

function hasCode(code) {
  return (error) => error?.code === code;
}

async function candidateFixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/route_graph_candidate/${name}`, import.meta.url), 'utf8'));
}

async function admissionFixture(name) {
  return JSON.parse(await readFile(new URL(`../fixtures/route-graph-admission-s4/${name}`, import.meta.url), 'utf8'));
}
