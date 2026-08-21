import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createFilesystemAuthority, evaluateHandoff, pathMatches, patternsOverlap, realFilesystemAuthority } from '../lib/phase1_handoff_evaluator.mjs';

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
  assert.equal(policy.authorityReceipts.review.schema, 'engagement-phase1-independent-review/v1');
  assert.equal(policy.authorityReceipts.deletion.schema, 'engagement-phase1-independent-deletion/v1');
  assert.equal(packageJson.scripts['test:phase1-handoff'], 'node --test scripts/tests/phase1_handoff_contracts.mjs');
  for (const surface of policy.controlSurfaces) await access(new URL(`../../${surface}`, import.meta.url));
  assert.deepEqual(policy.phases.map(({ id }) => id), ['M1', 'M2', 'M3', 'M4', '1D']);
  assert.deepEqual(policy.phases.find(({ id }) => id === 'M1').receipt.requiredFields, ['current_snapshot_id', 'coverage', 'lineage_registry', 'latest_quality_report', 'latest_revision_report', 'updated_at']);
  assert.equal(policy.phases.find(({ id }) => id === 'M2').receipt.defaultPath, '.dfev1/area-intelligence/m2-baseline/evaluation/model-evaluation-report.json');
  assert.equal(policy.phases.find(({ id }) => id === 'M3').receipt.defaultPath, '.dfev1/home-neighborhood-compare/m3-v1/official-smoke/manifest.json');
  const m4 = policy.phases.find(({ id }) => id === 'M4');
  assert.equal(m4.receipt.schema, 'engagement-known-route-evidence-handoff/v2');
  assert.equal(m4.receipt.futureRequired, true);
  assert.ok(m4.receipt.requiredFields.includes('warehouseIdentity'));
  assert.deepEqual(m4.receipt.dataQualityFields, ['dataQuality.partitionCompletion', 'dataQuality.accumulatorValidated']);
  assert.deepEqual(m4.receipt.lineageFields, ['lineage.warehouseIdentity', 'lineage.routeIdentity', 'lineage.catalogIdentity']);
  assert.deepEqual(m4.receipt.consentFields, ['consent.publicCenterlineRequest']);
  assert.deepEqual(m4.receipt.clockFields, ['clocks.sourceAsOf', 'clocks.retrievedAt', 'clocks.builtAt', 'clocks.observedAt']);
  assert.deepEqual(policy.phases.find(({ id }) => id === 'M3').upstreamReceiptBindings, ['M2']);
  assert.deepEqual(policy.phases.find(({ id }) => id === 'M4').upstreamReceiptBindings, ['M1']);
  assert.deepEqual(policy.phases.find(({ id }) => id === 'M4').governancePrerequisites, ['M2 frozen evaluation receipt recheck']);
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
  const authorityReceipts = new Map();
  for (const phase of fixture.phases) {
    const definition = policy.phases.find(({ id }) => id === phase.phase);
    phase.worktree = `fixture/${phase.phase}`;
    phase.evidenceRoot = `${phase.worktree}/${phase.ignoredRoot.replace('/**', '')}`;
    phase.actualMergeBase = phase.expectedBase;
    phase.phaseBase = phase.expectedBase;
    phase.state = 'accepted'; phase.implementationTip = phase.exactTip; phase.recordTip = phase.exactTip; phase.reviewedTip = phase.exactTip;
    phase.status = { porcelain: [], index: [], untracked: [] }; phase.actualChangedPaths = [];
    // A producer's retained evidence must be admissible before the future 1D
    // deletion decision exists. A present authorization, however, is exact.
    phase.retention.authorizationReceipt = null;
    phase.receipt = { availability: 'available', actualPath: phase.phase, schema: definition.receipt.schema, identity: {}, revision: {}, validatorCommand: definition.receipt.validatorCommand, result: 'pass' };
    const receipt = strictFixtureReceipt(phase.phase, definition);
    if (definition.receipt.schema) receipt.schema = definition.receipt.schema;
    for (const field of definition.receipt.identityFields) phase.receipt.identity[field] = getPath(receipt, field);
    for (const field of definition.receipt.revisionFields) phase.receipt.revision[field] = getPath(receipt, field);
    receipts.set(phase.phase, receipt);
  }
  const m1 = fixture.phases.find((phase) => phase.phase === 'M1');
  const m4 = fixture.phases.find((phase) => phase.phase === 'M4');
  const m4Receipt = receipts.get('M4');
  // This is a producer binding, not merely the similarly named M4 field.
  m4Receipt.warehouseIdentity = m1.receipt.identity.current_snapshot_id;
  m4Receipt.lineage.warehouseIdentity = m1.receipt.identity.current_snapshot_id;
  m4.receipt.identity.warehouseIdentity = m1.receipt.identity.current_snapshot_id;
  const m2 = fixture.phases.find((phase) => phase.phase === 'M2');
  m4Receipt.governance = { m2: { identity: m2.receipt.identity, revision: m2.receipt.revision, reviewedTip: m2.reviewedTip, dqRechecked: true } };
  const oneD = fixture.phases.find((phase) => phase.phase === '1D');
  const oneDReceipt = receipts.get('1D');
  oneDReceipt.producerReceipts = ['M1', 'M2', 'M3', 'M4'].map((id) => ({
    phase: id,
    schema: receipts.get(id).schema,
    receiptDigest: digest(`receipt-${id}`),
    identity: fixture.phases.find((phase) => phase.phase === id).receipt.identity,
    revision: fixture.phases.find((phase) => phase.phase === id).receipt.revision,
    implementationTip: fixture.phases.find((phase) => phase.phase === id).implementationTip,
    recordTip: fixture.phases.find((phase) => phase.phase === id).recordTip,
    reviewedTip: fixture.phases.find((phase) => phase.phase === id).reviewedTip,
    dqRechecked: true,
  }));
  oneD.receipt.identity.producerReceipts = oneDReceipt.producerReceipts;
  for (const phase of fixture.phases) {
    const definition = policy.phases.find(({ id }) => id === phase.phase);
    phase.upstreamReceiptIdentities = definition.upstreamReceiptBindings.map((upstream) => ({
      phase: upstream,
      ...fixture.phases.find((item) => item.phase === upstream).receipt.identity,
    }));
    if (phase.phase === 'M4') phase.governanceReceiptIdentities = [{ phase: 'M2', ...fixture.phases.find((item) => item.phase === 'M2').receipt.identity }];
    phase.reviewAuthority = {
      path: `${phase.evidenceRoot}/authority/review/${phase.phase}.json`,
      schema: 'engagement-phase1-independent-review/v1',
      expectedIdentity: { receiptId: `review-${phase.phase}` },
      expectedIssuer: { taskId: 'independent-review-task', identity: 'reviewer-identity' },
    };
    authorityReceipts.set(phase.reviewAuthority.path, {
      schema: phase.reviewAuthority.schema,
      identity: phase.reviewAuthority.expectedIdentity,
      reviewer: phase.reviewAuthority.expectedIssuer,
      phase: phase.phase,
      verdict: 'approve',
      candidate: { implementationTip: phase.implementationTip, executionRecordTip: phase.recordTip, cumulativeTip: phase.reviewedTip },
    });
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
      return { tip: reference, mergeBase: phase.actualMergeBase, expectedBase: phase.expectedBase, changedPaths: [] };
    },
    isAncestor: async () => true,
    changedBetween: async () => [],
    readReceipt: async (key) => receipts.get(key),
    filesystemAuthority: { async receiptPath(_worktree, _evidenceRoot, receiptPath) {
      if (receiptPath.startsWith('../') || receiptPath.startsWith('..\\') || /^[A-Za-z]:[\\/]/.test(receiptPath)) throw new Error('fixture authority rejects path escape');
      return receiptPath;
    } },
    authorityReader: { async read(key) { return authorityReceipts.get(key); } },
    trustedAuthorityResolver: {
      async resolve({ kind, digest, phase, candidate }) {
        return {
          trusted: true,
          kind,
          phase,
          digest,
          candidate,
          issuer: kind === 'review'
            ? { taskId: 'independent-review-task', identity: 'reviewer-identity' }
            : { taskId: 'independent-retention-task', identity: 'retention-identity' },
        };
      },
    },
    resolveRef,
  };
  const accepted = await evaluateHandoff({ policy, observation: fixture, ...fixtureOptions });
  if (accepted.status !== 'accepted') throw new Error(accepted.reasons.join('; '));
  assert.equal(accepted.phases.M1.status, 'accepted', 'missing future deletion authorization does not block retained producer evidence');
  assert.equal(accepted.decisions.preparationEligible, true);
  assert.equal(accepted.decisions.consumptionEligible, true);
  assert.equal(accepted.decisions.admissionEligible, true);
  assert.equal(accepted.decisions.deletionEligible, false, 'accepted evidence is not deletable without a future 1D authorization');
  const untrusted = await evaluateHandoff({ policy, observation: fixture, ...fixtureOptions, trustedAuthorityResolver: null });
  assert.equal(untrusted.status, 'blocked', 'a receipt path and issuer label cannot self-authorize without an external trust resolver');
  assert.equal(untrusted.decisions.admissionEligible, false);
  const hiddenBase = structuredClone(fixture);
  const hiddenM1 = hiddenBase.phases.find((phase) => phase.phase === 'M1');
  hiddenM1.phaseBase = hiddenM1.implementationTip;
  hiddenM1.actualChangedPaths = [];
  const hiddenResult = await evaluateHandoff({
    policy, observation: hiddenBase, ...fixtureOptions,
    inspectRevision: async (worktree, reference) => {
      const phase = hiddenBase.phases.find((item) => item.worktree === worktree);
      return { tip: reference, mergeBase: phase.actualMergeBase, expectedBase: phase.expectedBase, changedPaths: phase.phase === 'M1' ? ['package.json'] : [] };
    },
  });
  assert.equal(hiddenResult.status, 'blocked', 'phaseBase=tip and an empty observation cannot hide an earlier forbidden candidate path');
  assert.equal(hiddenResult.phases.M1.decisions.admissionEligible, false);
  const deletable = structuredClone(fixture);
  for (const phase of deletable.phases) {
    const definition = policy.phases.find(({ id }) => id === phase.phase);
    phase.deletionAuthority = {
      path: `${phase.evidenceRoot}/authority/deletion/${phase.phase}.json`,
      schema: 'engagement-phase1-independent-deletion/v1',
      expectedIdentity: { receiptId: `deletion-${phase.phase}` },
      expectedIssuer: { taskId: 'independent-retention-task', identity: 'retention-identity' },
    };
    authorityReceipts.set(phase.deletionAuthority.path, {
      schema: phase.deletionAuthority.schema,
      identity: phase.deletionAuthority.expectedIdentity,
      issuer: phase.deletionAuthority.expectedIssuer,
      decision: { ...phase.deletionAuthority.expectedIssuer, decidedAt: '2026-08-22T00:00:00.000Z' },
      accepted1D: {
        cumulativeTip: deletable.phases.find((item) => item.phase === '1D').reviewedTip,
        receiptIdentity: deletable.phases.find((item) => item.phase === '1D').receipt.identity,
      },
      target: { phase: phase.phase, ignoredRoot: phase.ignoredRoot },
      prerequisites: definition.retention.deletePrerequisites,
      decidedAt: '2026-08-22T00:00:00.000Z',
    });
  }
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
    ['evidence root outside precise ignored root', (candidate) => { candidate.phases.find(({ phase }) => phase === 'M3').evidenceRoot = 'fixture/M3/.dfev1/not-home'; }, policy],
    ['missing upstream receipt identity', (candidate) => { candidate.phases.find(({ phase }) => phase === 'M3').upstreamReceiptIdentities = []; }, policy],
    ['wrong upstream receipt identity', (candidate) => { candidate.phases.find(({ phase }) => phase === 'M4').upstreamReceiptIdentities[0].current_snapshot_id = 'wrong'; }, policy],
    ['missing M2 governance receipt', (candidate) => { candidate.phases.find(({ phase }) => phase === 'M4').governanceReceiptIdentities = []; }, policy],
    ['wrong M2 governance identity', (candidate) => { candidate.phases.find(({ phase }) => phase === 'M4').governanceReceiptIdentities[0]['data.mart_artifact_identity'] = 'wrong'; }, policy],
    ['divergent ancestor assertion', (candidate) => { candidate.phases.find(({ phase }) => phase === 'M2').ancestorResult = false; }, policy],
    ['M1 canonical receipt policy weakening', (_candidate, candidatePolicy) => { candidatePolicy.phases.find(({ id }) => id === 'M1').receipt.requiredFields = []; }, structuredClone(policy)],
    ['M2 canonical receipt policy weakening', (_candidate, candidatePolicy) => { candidatePolicy.phases.find(({ id }) => id === 'M2').receipt.schema = 'anything/v1'; }, structuredClone(policy)],
    ['M3 canonical receipt policy weakening', (_candidate, candidatePolicy) => { candidatePolicy.phases.find(({ id }) => id === 'M3').receipt.requiredFields = []; }, structuredClone(policy)],
    ['1D canonical receipt policy weakening', (_candidate, candidatePolicy) => { candidatePolicy.phases.find(({ id }) => id === '1D').receipt.schema = null; }, structuredClone(policy)],
  ];
  for (const [name, mutate, candidatePolicy] of hostileCases) {
    const candidate = structuredClone(fixture);
    mutate(candidate, candidatePolicy);
    const result = await evaluateHandoff({ policy: candidatePolicy, observation: candidate, ...fixtureOptions });
    assert.equal(result.status, 'blocked', `${name} must fail closed`);
    assert.equal(result.decisions.admissionEligible, false, `${name} cannot admit globally`);
    assert.equal(result.decisions.deletionEligible, false, `${name} cannot authorize deletion`);
    assert.equal(result.phases.M4.decisions.admissionEligible, false, `${name} cannot admit M4`);
    assert.equal(result.phases['1D'].decisions.admissionEligible, false, `${name} cannot admit 1D`);
  }

  const authorityHostile = [
    ['missing review reference', (candidate) => { candidate.phases[0].reviewAuthority = null; }, () => {}],
    ['review path escape', (candidate) => { candidate.phases[0].reviewAuthority.path = '../review/M1'; }, () => {}],
    ['review schema mismatch', (candidate) => { candidate.phases[0].reviewAuthority.schema = 'forged/v1'; }, () => {}],
    ['review issuer self-sign', (_candidate, _receipts, authorities) => { findAuthority(authorities, 'review', 'M1').reviewer = { taskId: 'M1 frozen warehouse task', identity: 'reviewer-identity' }; }],
    ['review verdict mismatch', (_candidate, _receipts, authorities) => { findAuthority(authorities, 'review', 'M2').verdict = 'reject'; }],
    ['review candidate tip mismatch', (_candidate, _receipts, authorities) => { findAuthority(authorities, 'review', 'M3').candidate.cumulativeTip = 'forged-tip'; }],
    ['review identity mismatch', (_candidate, _receipts, authorities) => { findAuthority(authorities, 'review', 'M4').identity = { receiptId: 'forged-review' }; }],
    ['M1 to M4 actual warehouse identity mismatch', (candidate, entries) => {
      const candidateM4 = candidate.phases.find(({ phase }) => phase === 'M4');
      entries.get('M4').warehouseIdentity = 'forged-warehouse';
      entries.get('M4').lineage.warehouseIdentity = 'forged-warehouse';
      candidateM4.receipt.identity.warehouseIdentity = 'forged-warehouse';
      candidateM4.upstreamReceiptIdentities[0].current_snapshot_id = entries.get('M1').current_snapshot_id;
    }],
    ['declared DAG ancestry fails', () => {}],
    ['M2 governance is not rechecked', (candidate) => { candidate.phases.find(({ phase }) => phase === 'M2').state = 'pending-review'; }],
  ];
  for (const [name, mutate] of authorityHostile) {
    const candidate = structuredClone(fixture);
    const candidateReceipts = new Map([...receipts].map(([key, value]) => [key, structuredClone(value)]));
    const candidateAuthorities = new Map([...authorityReceipts].map(([key, value]) => [key, structuredClone(value)]));
    mutate(candidate, candidateReceipts, candidateAuthorities);
    const hostileOptions = {
      ...fixtureOptions,
      readReceipt: async (key) => candidateReceipts.get(key),
      authorityReader: { async read(key) { return candidateAuthorities.get(key); } },
      isAncestor: name === 'declared DAG ancestry fails' ? async () => false : fixtureOptions.isAncestor,
    };
    const result = await evaluateHandoff({ policy, observation: candidate, ...hostileOptions });
    assert.equal(result.status, 'blocked', `${name} must fail closed`);
    assert.equal(result.decisions.admissionEligible, false, `${name} cannot admit globally`);
    assert.equal(result.decisions.deletionEligible, false, `${name} cannot authorize deletion`);
    assert.equal(result.phases.M4.decisions.admissionEligible, false, `${name} cannot admit M4`);
    assert.equal(result.phases['1D'].decisions.admissionEligible, false, `${name} cannot admit 1D`);
  }

  // Bad deletion receipts do not erase valid retained evidence, but they can
  // never grant deletion.  This keeps the future-delete gate separate from
  // producer preparation/admission as required by the retention policy.
  const deletionHostile = structuredClone(deletable);
  deletionHostile.phases[0].deletionAuthority.expectedIssuer = { taskId: 'M1 frozen warehouse task', identity: 'M1 frozen warehouse task' };
  const deletionResult = await evaluateHandoff({ policy, observation: deletionHostile, ...fixtureOptions });
  assert.equal(deletionResult.status, 'accepted');
  assert.equal(deletionResult.decisions.admissionEligible, true);
  assert.equal(deletionResult.decisions.deletionEligible, false);
  for (const [name, mutate] of [
    ['self-signed deletion authority', (entries, candidate) => {
      const phase = candidate.phases.find((item) => item.phase === 'M1');
      phase.deletionAuthority.expectedIssuer = { taskId: phase.owner, identity: phase.owner };
      const receipt = findAuthority(entries, 'deletion', 'M1');
      receipt.issuer = phase.deletionAuthority.expectedIssuer;
      receipt.decision = { ...phase.deletionAuthority.expectedIssuer, decidedAt: receipt.decidedAt };
    }],
    ['deletion 1D binding mismatch', (entries) => { findAuthority(entries, 'deletion', 'M2').accepted1D.cumulativeTip = 'forged-1D-tip'; }],
  ]) {
    const candidate = structuredClone(deletable);
    const candidateAuthorities = new Map([...authorityReceipts].map(([key, value]) => [key, structuredClone(value)]));
    mutate(candidateAuthorities, candidate);
    const result = await evaluateHandoff({ policy, observation: candidate, ...fixtureOptions, authorityReader: { async read(key) { return candidateAuthorities.get(key); } } });
    assert.equal(result.status, 'accepted', `${name} does not erase retained evidence`);
    assert.equal(result.decisions.admissionEligible, true, `${name} cannot recast admission`);
    assert.equal(result.decisions.deletionEligible, false, `${name} must fail closed for deletion`);
  }

  const documentationChild = structuredClone(fixture);
  for (const phase of documentationChild.phases) {
    phase.recordTip = `${phase.exactTip}-record`;
    phase.reviewedTip = phase.recordTip;
    authorityReceipts.get(phase.reviewAuthority.path).candidate = {
      implementationTip: phase.implementationTip,
      executionRecordTip: phase.recordTip,
      cumulativeTip: phase.reviewedTip,
    };
    const producerBinding = receipts.get('1D').producerReceipts.find((entry) => entry.phase === phase.phase);
    if (producerBinding) {
      producerBinding.implementationTip = phase.implementationTip;
      producerBinding.recordTip = phase.recordTip;
      producerBinding.reviewedTip = phase.reviewedTip;
    }
    if (phase.phase === '1D') {
      receipts.get('1D').implementationTip = phase.implementationTip;
      receipts.get('1D').recordTip = phase.recordTip;
      phase.receipt.revision.implementationTip = phase.implementationTip;
      phase.receipt.revision.recordTip = phase.recordTip;
    }
  }
  const childM2 = documentationChild.phases.find((phase) => phase.phase === 'M2');
  receipts.get('M4').governance.m2 = { identity: childM2.receipt.identity, revision: childM2.receipt.revision, reviewedTip: childM2.reviewedTip, dqRechecked: true };
  documentationChild.phases.find((phase) => phase.phase === '1D').receipt.identity.producerReceipts = receipts.get('1D').producerReceipts;
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
  const documentedResult = await evaluateHandoff({ policy, observation: documentationChild, ...recordOptions });
  assert.equal(documentedResult.status, 'accepted', documentedResult.reasons.join('; '));
  assert.equal((await evaluateHandoff({ policy, observation: documentationChild, ...recordOptions, changedBetween: async () => ['src/home_compare/controller.js'] })).status, 'blocked');
});

test('topological decisions are order independent and blocked status never reports final admission', async () => {
  const { policy, observation } = await documents();
  const reordered = structuredClone(policy);
  reordered.phases.reverse();
  const result = await evaluateHandoff({ policy: reordered, observation });
  assert.equal(result.status, 'blocked');
  assert.equal(result.decisions.admissionEligible, false);
  for (const phase of Object.values(result.phases)) assert.equal(phase.decisions.admissionEligible, false);
});

test('phase and edge collections fail closed before Map construction on duplicate, missing, or unknown identifiers', async () => {
  const { policy, observation } = await documents();
  const hostile = [
    ['duplicate policy phase', (p) => p.phases.push(structuredClone(p.phases[0]))],
    ['missing policy phase', (p) => { p.phases = p.phases.filter(({ id }) => id !== 'M4'); }],
    ['unknown observation phase', (_p, o) => { o.phases[0].phase = 'UNKNOWN'; }],
    ['duplicate edge', (p) => p.edges.push(structuredClone(p.edges[0]))],
    ['unknown edge endpoint', (p) => p.edges.push(['M1', 'UNKNOWN'])],
    ['deleted canonical edge', (p) => { p.edges = p.edges.filter(([from, to]) => from !== 'M1' || to !== 'M4'); }],
    ['added canonical-looking edge', (p) => p.edges.push(['M2', 'M4'])],
    ['reversed canonical edge', (p) => { p.edges[0] = ['M2', 'M1']; }],
    ['deleted typed governance edge', (p) => { p.governanceEdges = []; }],
    ['forged typed governance edge', (p) => p.governanceEdges.push({ from: 'M1', to: 'M4', kind: 'frozen-evaluation-recheck' })],
  ];
  for (const [name, mutate] of hostile) {
    const candidatePolicy = structuredClone(policy); const candidateObservation = structuredClone(observation);
    mutate(candidatePolicy, candidateObservation);
    const result = await evaluateHandoff({ policy: candidatePolicy, observation: candidateObservation });
    assert.equal(result.status, 'blocked', name);
    assert.equal(result.decisions.admissionEligible, false, name);
    assert.equal(result.decisions.deletionEligible, false, name);
    for (const phase of Object.values(result.phases)) assert.equal(phase.decisions.admissionEligible, false, name);
  }
});

test('receipt authority cannot be bypassed by an injected reader', async () => {
  const { policy, observation } = await documents();
  const candidate = structuredClone(observation);
  const phase = candidate.phases.find(({ phase: id }) => id === 'M1');
  phase.receipt.availability = 'available'; phase.receipt.actualPath = '../escape.json'; phase.receipt.schema = policy.phases[0].receipt.schema; phase.receipt.result = 'pass';
  let readerCalled = false;
  const result = await evaluateHandoff({ policy, observation: candidate, filesystemAuthority: { async receiptPath() { throw new Error('receipt path escapes evidence root'); } }, readReceipt: async () => { readerCalled = true; return {}; } });
  assert.equal(readerCalled, false);
  assert.equal(result.decisions.admissionEligible, false);
  assert.equal(result.decisions.deletionEligible, false);
  assert.equal(result.phases.M1.decisions.admissionEligible, false);
});

test('real filesystem authority accepts a canonical inner regular file and rejects lexical escapes', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'phase1-authority-'));
  try {
    const evidence = path.join(temporary, 'evidence');
    const inner = path.join(evidence, 'receipt.json');
    const outside = path.join(temporary, 'outside.json');
    await mkdir(evidence); await writeFile(inner, '{}'); await writeFile(outside, '{}');
    const authority = realFilesystemAuthority;
    assert.equal(await authority.receiptPath(temporary, evidence, inner), await realpath(inner));
    await assert.rejects(authority.receiptPath(temporary, evidence, outside), /escapes/);
    await assert.rejects(authority.receiptPath(temporary, path.join(evidence, '..', 'outside-root'), inner), /escapes|ENOENT/);
    await assert.rejects(authority.receiptPath(temporary, evidence, path.join(evidence, '..', 'outside.json')), /escapes/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('exact ignored root and canonical receipt path reject sibling evidence before bytes are read', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'phase1-exact-root-'));
  try {
    const allowed = path.join(temporary, '.dfev1', 'crime', 'warehouse');
    const sibling = path.join(temporary, '.dfev1', 'area-intelligence', 'warehouse');
    const allowedReceipt = path.join(allowed, 'manifest.json');
    const siblingReceipt = path.join(sibling, 'manifest.json');
    await mkdir(allowed, { recursive: true }); await mkdir(sibling, { recursive: true });
    await writeFile(allowedReceipt, '{}'); await writeFile(siblingReceipt, '{}');
    assert.equal(await realFilesystemAuthority.receiptPath(temporary, allowed, allowedReceipt, { ignoredRoot: '.dfev1/crime/**', defaultPath: '.dfev1/crime/warehouse/manifest.json' }), await realpath(allowedReceipt));
    await assert.rejects(realFilesystemAuthority.receiptPath(temporary, sibling, siblingReceipt, { ignoredRoot: '.dfev1/crime/**', defaultPath: '.dfev1/crime/warehouse/manifest.json' }), /exact ignored root/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('real filesystem authority rejects a live file symlink when Windows permits it', async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'phase1-authority-link-'));
  try {
    const evidence = path.join(temporary, 'evidence');
    const outside = path.join(temporary, 'outside.json');
    const link = path.join(evidence, 'receipt-link.json');
    await mkdir(evidence); await writeFile(outside, '{}');
    try {
      await symlink(outside, link, 'file');
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) {
        t.skip(`Windows file symlink unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(realFilesystemAuthority.receiptPath(temporary, evidence, link), /not a regular file/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('Windows live junction escaping the worktree is rejected when junction creation is permitted', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows junction semantics are not available on this platform');
    return;
  }
  const temporary = await mkdtemp(path.join(tmpdir(), 'phase1-junction-'));
  const outside = `${temporary}-outside`;
  try {
    const junction = path.join(temporary, 'evidence-junction');
    await mkdir(outside, { recursive: true });
    const receipt = path.join(outside, 'receipt.json');
    await writeFile(receipt, '{}');
    try {
      await symlink(outside, junction, 'junction');
    } catch (error) {
      if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) {
        t.skip(`Windows junction unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(realFilesystemAuthority.receiptPath(temporary, junction, path.join(junction, 'receipt.json')), /canonical path escapes/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('filesystem authority rejects hostile lexical and canonical paths before any receipt reader runs', async () => {
  const { policy, observation } = await documents();
  const fileStat = async () => ({ isFile: () => true, isSymbolicLink: () => false });
  const canonical = async (pathname) => pathname;
  const windowsAuthority = createFilesystemAuthority({ platform: 'win32', canonicalize: canonical, stat: fileStat });
  const posixJunctionEscape = createFilesystemAuthority({
    platform: 'linux',
    canonicalize: async (pathname) => pathname === '/worktree/evidence' ? '/outside/evidence' : pathname,
    stat: fileStat,
  });
  const hostile = [
    ['absolute outside', windowsAuthority, 'C:\\other\\receipt.json', 'C:\\worktree\\evidence'],
    ['parent evidence root', windowsAuthority, 'C:\\worktree\\evidence\\receipt.json', 'C:\\worktree\\..\\outside'],
    ['parent receipt', windowsAuthority, 'C:\\worktree\\evidence\\..\\outside.json', 'C:\\worktree\\evidence'],
    ['mixed slash', windowsAuthority, 'C:\\worktree/evidence\\receipt.json', 'C:\\worktree\\evidence'],
    ['UNC', windowsAuthority, '\\\\server\\share\\receipt.json', 'C:\\worktree\\evidence'],
    ['device namespace', windowsAuthority, '\\\\?\\C:\\worktree\\evidence\\receipt.json', 'C:\\worktree\\evidence'],
    ['drive case variation', windowsAuthority, 'c:\\worktree\\evidence\\receipt.json', 'C:\\worktree\\evidence'],
    ['directory case variation', windowsAuthority, 'C:\\WORKTREE\\evidence\\receipt.json', 'C:\\WORKTREE\\evidence'],
    ['POSIX symlink or Windows junction canonical escape', posixJunctionEscape, '/worktree/evidence/receipt.json', '/worktree/evidence'],
  ];
  for (const [name, filesystemAuthority, receiptPath, evidenceRoot] of hostile) {
    const candidate = structuredClone(observation);
    const phase = candidate.phases.find(({ phase: id }) => id === 'M1');
    phase.worktree = receiptPath.startsWith('/') ? '/worktree' : 'C:\\worktree';
    phase.evidenceRoot = evidenceRoot;
    phase.receipt = {
      availability: 'available', actualPath: receiptPath, schema: policy.phases.find(({ id }) => id === 'M1').receipt.schema,
      identity: {}, revision: {}, validatorCommand: 'npm run test:phase1-handoff', result: 'pass',
    };
    let readerCalled = false;
    const result = await evaluateHandoff({
      policy,
      observation: candidate,
      filesystemAuthority,
      readReceipt: async () => { readerCalled = true; return {}; },
      inspectWorktree: async () => ({ head: phase.exactTip, main: phase.expectedBase, mergeBase: phase.actualMergeBase, status: [], changedPaths: [] }),
      inspectRevision: async (_worktree, reference) => ({ tip: reference, mergeBase: phase.actualMergeBase, phaseBase: phase.phaseBase, changedPaths: [] }),
      isAncestor: async () => true,
      changedBetween: async () => [],
      resolveRef: async (_worktree, reference) => reference,
    });
    assert.equal(readerCalled, false, `${name} must reject before reading receipt bytes`);
    assert.equal(result.phases.M1.decisions.admissionEligible, false, `${name} blocks M1 admission`);
    assert.equal(result.decisions.admissionEligible, false, `${name} blocks global admission`);
    assert.equal(result.decisions.deletionEligible, false, `${name} blocks deletion`);
  }
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

function findAuthority(entries, kind, phase) {
  const found = [...entries].find(([key]) => key.replaceAll('\\', '/').endsWith(`/authority/${kind}/${phase}.json`));
  if (!found) throw new Error(`missing fixture authority ${kind}/${phase}`);
  return found[1];
}

function digest(seed) { return `sha256:${String(seed).replace(/[^a-f0-9]/gi, 'a').toLowerCase().padEnd(64, 'a').slice(0, 64)}`; }

function strictFixtureReceipt(phase, definition) {
  const receipt = {};
  for (const field of definition.receipt.requiredFields) setPath(receipt, field, fixtureReceiptValue(phase, field));
  receipt.schema = definition.receipt.schema;
  if (phase === 'M1') {
    receipt.current_snapshot_id = digest('m1'); receipt.coverage = { complete: true }; receipt.lineage_registry = { source: 'registry' };
    receipt.latest_quality_report = 'quality-v1'; receipt.latest_revision_report = 'revision-v1'; receipt.updated_at = '2026-08-22T00:00:00.000Z';
  }
  if (phase === 'M2') {
    receipt.generated_at = '2026-08-22T00:00:00.000Z'; receipt.protocol = { schema: 'evaluation/v1', sha256: digest('m2-protocol') };
    receipt.data = { mart_artifact_identity: digest('m2-mart'), source_vintage: digest('m2-source'), coverage: { complete: true } };
  }
  if (phase === 'M3') {
    receipt.generatedAt = '2026-08-22T00:00:00.000Z'; receipt.status = 'pass'; receipt.semanticIdentity = digest('m3');
    receipt.observations = [{ revision: 'revision-1', dq: true }]; receipt.routing = { unavailable: true }; receipt.privacy = { sessionOnly: true }; receipt.limitations = { source: 'fixture' };
  }
  if (phase === 'M4') {
    receipt.warehouseIdentity = digest('m4-warehouse'); receipt.routeIdentity = digest('m4-route'); receipt.catalogIdentity = digest('m4-catalog'); receipt.centerlineDataVersion = 'centerline-v1'; receipt.corridorIdentity = 'corridor-v1';
    receipt.completedPartitions = 2; receipt.partitionCount = 2; receipt.startedAt = '2026-08-22T00:00:00.000Z'; receipt.completion = { state: 'complete' }; receipt.accumulator = { partitions: 2 };
    receipt.dataQuality = { partitionCompletion: true, accumulatorValidated: true }; receipt.lineage = { warehouseIdentity: receipt.warehouseIdentity, routeIdentity: receipt.routeIdentity, catalogIdentity: receipt.catalogIdentity };
    receipt.consent = { publicCenterlineRequest: true }; receipt.clocks = { sourceAsOf: '2026-08-22T00:00:00.000Z', retrievedAt: '2026-08-22T00:01:00.000Z', builtAt: '2026-08-22T00:02:00.000Z', observedAt: '2026-08-22T00:03:00.000Z' };
  }
  if (phase === '1D') { receipt.producerReceipts = []; receipt.topology = [['M1', 'M2'], ['M2', 'M3'], ['M1', 'M4'], ['M1', '1D'], ['M2', '1D'], ['M3', '1D'], ['M4', '1D']]; receipt.overlap = []; receipt.status = { accepted: true }; receipt.implementationTip = 'tip'; receipt.recordTip = 'tip'; }
  return receipt;
}
