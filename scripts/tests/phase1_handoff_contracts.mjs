import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';

import { evaluateHandoff, pathMatches, patternsOverlap } from '../lib/phase1_handoff_evaluator.mjs';

const root = new URL('../../', import.meta.url);
const policyUrl = new URL('../../docs/active/phase1-evidence-completion/handoff.manifest.json', import.meta.url);
const observationUrl = new URL('../../docs/active/phase1-evidence-completion/handoff.observation.json', import.meta.url);
const packageUrl = new URL('../../package.json', import.meta.url);

async function documents() {
  const [policyText, observationText, packageText] = await Promise.all([readFile(policyUrl, 'utf8'), readFile(observationUrl, 'utf8'), readFile(packageUrl, 'utf8')]);
  return { policy: JSON.parse(policyText), observation: JSON.parse(observationText), packageJson: JSON.parse(packageText) };
}

test('Phase 1 policy names real producer receipt contracts and every control surface owner', async () => {
  const { policy, packageJson } = await documents();
  assert.equal(policy.schema, 'engagement-phase1-handoff-policy/v2');
  assert.equal(packageJson.scripts['test:phase1-handoff'], 'node --test scripts/tests/phase1_handoff_contracts.mjs');
  for (const surface of policy.controlSurfaces) await access(new URL(`../../${surface}`, import.meta.url));
  assert.deepEqual(policy.phases.map(({ id }) => id), ['M1', 'M2', 'M3', 'M4', '1D']);
  assert.deepEqual(policy.phases.find(({ id }) => id === 'M1').receipt.requiredFields, ['current_snapshot_id', 'coverage', 'lineage_registry', 'latest_quality_report', 'latest_revision_report', 'updated_at']);
  assert.equal(policy.phases.find(({ id }) => id === 'M2').receipt.defaultPath, '.dfev1/area-intelligence/m2-baseline/evaluation/model-evaluation-report.json');
  assert.equal(policy.phases.find(({ id }) => id === 'M3').receipt.defaultPath, '.dfev1/home-neighborhood-compare/m3-v1/official-smoke/manifest.json');
  const m4 = policy.phases.find(({ id }) => id === 'M4');
  assert.equal(m4.receipt.schema, 'known-route-evidence-checkpoint/v1');
  assert.ok(m4.receipt.requiredFields.includes('warehouseIdentity'));
  assert.deepEqual(m4.receipt.dataQualityFields, ['dataQuality.partitionCompletion', 'dataQuality.accumulatorValidated']);
  assert.deepEqual(m4.receipt.lineageFields, ['lineage.warehouseIdentity', 'lineage.routeIdentity', 'lineage.catalogIdentity']);
  assert.deepEqual(m4.receipt.consentFields, ['consent.publicCenterlineRequest']);
  assert.deepEqual(m4.receipt.clockFields, ['clocks.sourceAsOf', 'clocks.retrievedAt', 'clocks.builtAt', 'clocks.observedAt']);
  assert.deepEqual(policy.phases.find(({ id }) => id === 'M3').upstreamReceiptBindings, ['M2']);
  assert.deepEqual(policy.phases.find(({ id }) => id === 'M4').upstreamReceiptBindings, ['M1', 'M2']);
  assert.deepEqual(policy.phases.find(({ id }) => id === '1D').upstreamReceiptBindings, ['M1', 'M2', 'M3', 'M4']);
  for (const phase of policy.phases) {
    assert.ok(phase.owner && phase.writable.length && phase.ignoredOutputRoots.length);
    assert.ok(phase.retention.duration && phase.retention.triggerEvent && phase.retention.decisionOwner && phase.retention.authorizationReceipt);
    assert.ok(phase.receipt.validatorCommand && phase.receipt.requiredFields.length);
    for (const script of phase.mandatoryScripts) assert.ok(packageJson.scripts[script], `${phase.id} requires ${script}`);
  }
});

test('current real observation is mechanically blocked rather than falsely admitted', async () => {
  const { policy, observation } = await documents();
  const result = await evaluateHandoff({ policy, observation });
  assert.equal(result.status, 'blocked');
  assert.equal(result.phases.M1.status, 'blocked', 'unreviewed producer evidence stays blocked');
  assert.equal(result.phases.M2.status, 'blocked', 'unreviewed producer evidence stays blocked');
  assert.equal(result.phases.M3.status, 'blocked', 'missing M3 receipt stays blocked');
  assert.equal(result.phases.M4.status, 'blocked', 'missing M4 receipt stays blocked');
  assert.equal(result.phases['1D'].status, 'blocked', 'no cumulative receipt may be fabricated');
  assert.equal(result.phases.M1.decisions.consumptionEligible, false, 'unavailable M1 cannot be consumed');
  assert.equal(result.phases.M2.decisions.consumptionEligible, false, 'M2 cannot consume an unavailable M1');
  assert.equal(result.decisions.admissionEligible, false, 'M3/M4/1D missing receipts block final admission');
  assert.equal(result.decisions.deletionEligible, false, 'future deletion remains fail-closed without the 1D authorization');
});

test('evaluator accepts a complete fixture and rejects schema, review, topology, status, and glob-overlap drift', async () => {
  const { policy, observation } = await documents();
  const fixture = structuredClone(observation);
  const receipts = new Map();
  for (const phase of fixture.phases) {
    const definition = policy.phases.find(({ id }) => id === phase.phase);
    phase.worktree = `fixture/${phase.phase}`;
    phase.state = 'accepted'; phase.implementationTip = phase.exactTip; phase.recordTip = phase.exactTip; phase.reviewedTip = phase.exactTip;
    phase.status = { porcelain: [], index: [], untracked: [] }; phase.actualChangedPaths = [];
    // A producer's retained evidence must be admissible before the future 1D
    // deletion decision exists. A present authorization, however, is exact.
    phase.retention.authorizationReceipt = null;
    phase.receipt = { availability: 'available', actualPath: phase.phase, schema: definition.receipt.schema, identity: {}, revision: {}, validatorCommand: definition.receipt.validatorCommand, result: 'pass' };
    const receipt = {};
    for (const field of definition.receipt.requiredFields) setPath(receipt, field, fixtureReceiptValue(phase.phase, field));
    if (definition.receipt.schema) receipt.schema = definition.receipt.schema;
    for (const field of definition.receipt.identityFields) phase.receipt.identity[field] = getPath(receipt, field);
    for (const field of definition.receipt.revisionFields) phase.receipt.revision[field] = getPath(receipt, field);
    receipts.set(phase.phase, receipt);
  }
  const inspect = async (worktree) => {
    const phase = fixture.phases.find((item) => item.worktree === worktree);
    return { head: phase.exactTip, main: phase.expectedBase, mergeBase: phase.actualMergeBase, status: [], changedPaths: [] };
  };
  const resolveRef = async (_worktree, reference) => reference;
  const fixtureOptions = {
    inspectWorktree: inspect,
    inspectRevision: async (worktree, reference) => {
      const phase = fixture.phases.find((item) => item.worktree === worktree);
      return { tip: reference, mergeBase: phase.actualMergeBase, changedPaths: [] };
    },
    isAncestor: async () => true,
    changedBetween: async () => [],
    readReceipt: async (key) => receipts.get(key),
    resolveRef,
  };
  const accepted = await evaluateHandoff({ policy, observation: fixture, ...fixtureOptions });
  assert.equal(accepted.status, 'accepted', accepted.reasons.join('; '));
  assert.equal(accepted.phases.M1.status, 'accepted', 'missing future deletion authorization does not block retained producer evidence');
  assert.equal(accepted.decisions.preparationEligible, true);
  assert.equal(accepted.decisions.consumptionEligible, true);
  assert.equal(accepted.decisions.admissionEligible, true);
  assert.equal(accepted.decisions.deletionEligible, false, 'accepted evidence is not deletable without a future 1D authorization');
  const deletable = structuredClone(fixture);
  for (const phase of deletable.phases) phase.retention.authorizationReceipt = policy.phases.find(({ id }) => id === phase.phase).retention.authorizationReceipt;
  assert.equal((await evaluateHandoff({ policy, observation: deletable, ...fixtureOptions })).decisions.deletionEligible, true);
  const noReview = structuredClone(fixture); noReview.phases[0].reviewedTip = null;
  assert.equal((await evaluateHandoff({ policy, observation: noReview, ...fixtureOptions })).status, 'blocked');
  const unresolved = structuredClone(fixture); unresolved.phases[0].recordTip = 'missing-fixture-tip';
  assert.equal((await evaluateHandoff({ policy, observation: unresolved, ...fixtureOptions, resolveRef: async (_worktree, reference) => { if (reference === 'missing-fixture-tip') throw new Error('unresolved'); return reference; } })).status, 'blocked');
  const schemaDrift = structuredClone(fixture); receipts.get('M1').schema = 'wrong/v1';
  assert.equal((await evaluateHandoff({ policy, observation: schemaDrift, ...fixtureOptions })).status, 'blocked');
  receipts.get('M1').schema = policy.phases[0].receipt.schema;
  const overlapPolicy = structuredClone(policy); overlapPolicy.phases.find(({ id }) => id === 'M3').writable.push('src/home_compare/controller.js');
  overlapPolicy.phases.find(({ id }) => id === '1D').writable.push('src/home_compare/**');
  assert.equal((await evaluateHandoff({ policy: overlapPolicy, observation: fixture, ...fixtureOptions })).status, 'blocked');

  const hostileCases = [
    ['artifact owner drift', (candidate) => { candidate.phases.find(({ phase }) => phase === 'M3').artifactOwner = 'untrusted artifact writer'; }, policy],
    ['M3 package.json writable drift', (_candidate, candidatePolicy) => { candidatePolicy.phases.find(({ id }) => id === 'M3').writable.push('package.json'); }, structuredClone(policy)],
    ['M4 forbidden boundary drift', (_candidate, candidatePolicy) => { candidatePolicy.phases.find(({ id }) => id === 'M4').forbidden = []; }, structuredClone(policy)],
    ['M4 receipt schema drift', (_candidate, candidatePolicy) => { candidatePolicy.phases.find(({ id }) => id === 'M4').receipt.schema = null; }, structuredClone(policy)],
    ['M2 port boundary drift', (_candidate, candidatePolicy) => { candidatePolicy.phases.find(({ id }) => id === 'M2').ports = [9999]; }, structuredClone(policy)],
    ['M3 empty upstream binding', (_candidate, candidatePolicy) => { candidatePolicy.phases.find(({ id }) => id === 'M3').upstreamReceiptBindings = []; }, structuredClone(policy)],
    ['retention decision owner drift', (candidate) => { candidate.phases.find(({ phase }) => phase === 'M2').retention.decisionOwner = 'arbitrary deletion owner'; }, policy],
    ['retention trigger drift', (candidate) => { candidate.phases.find(({ phase }) => phase === 'M4').retention.triggerEvent = 'any-time'; }, policy],
    ['retention delete prerequisite drift', (candidate) => { candidate.phases.find(({ phase }) => phase === 'M1').retention.deletePrerequisites = []; }, policy],
    ['arbitrary deletion authorization', (candidate) => { candidate.phases.find(({ phase }) => phase === 'M1').retention.authorizationReceipt = 'anything-at-all'; }, policy],
    ['record and review tip drift', (candidate) => { candidate.phases.find(({ phase }) => phase === '1D').reviewedTip = 'different-reviewed-tip'; }, policy],
  ];
  for (const [name, mutate, candidatePolicy] of hostileCases) {
    const candidate = structuredClone(fixture);
    mutate(candidate, candidatePolicy);
    const result = await evaluateHandoff({ policy: candidatePolicy, observation: candidate, ...fixtureOptions });
    assert.equal(result.status, 'blocked', `${name} must fail closed`);
  }

  const documentationChild = structuredClone(fixture);
  for (const phase of documentationChild.phases) {
    phase.recordTip = `${phase.exactTip}-record`;
    phase.reviewedTip = phase.recordTip;
  }
  const recordInspect = async (worktree) => {
    const phase = documentationChild.phases.find((item) => item.worktree === worktree);
    return { head: phase.recordTip, main: phase.expectedBase, mergeBase: phase.actualMergeBase, status: [], changedPaths: [] };
  };
  const recordOptions = {
    ...fixtureOptions,
    inspectWorktree: recordInspect,
    changedBetween: async () => [
      'docs/active/_worktree_registry.md',
      'docs/active/phase1-evidence-completion/task.md',
    ],
  };
  assert.equal((await evaluateHandoff({ policy, observation: documentationChild, ...recordOptions })).status, 'accepted');
  assert.equal((await evaluateHandoff({ policy, observation: documentationChild, ...recordOptions, changedBetween: async () => ['src/home_compare/controller.js'] })).status, 'blocked');
});

test('glob expansion recognizes concrete owned paths and rejects writer/control-surface overlap', () => {
  assert.equal(pathMatches('src/home_compare/**', 'src/home_compare/controller.js'), true);
  assert.equal(pathMatches('scripts/lib/area_intelligence_*.mjs', 'scripts/lib/area_intelligence_receipt.mjs'), true);
  assert.equal(patternsOverlap(['src/home_compare/**'], ['src/home_compare/controller.js']), true);
  assert.equal(patternsOverlap(['scripts/lib/area_intelligence_*.mjs'], ['scripts/lib/area_intelligence_receipt.mjs']), true);
});

function setPath(object, dotted, value) { const keys = dotted.split('.'); const last = keys.pop(); let current = object; for (const key of keys) current = current[key] ||= {}; current[last] = value; }
function getPath(object, dotted) { return dotted.split('.').reduce((current, key) => current?.[key], object); }
function fixtureReceiptValue(phase, field) {
  if (field.startsWith('dataQuality.') || field.startsWith('consent.')) return true;
  if (field.startsWith('clocks.')) return '2026-08-22T00:00:00.000Z';
  return `${phase}-${field}`;
}
