import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

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
  assert.equal(policy.phases.find(({ id }) => id === 'M1').receipt.defaultPath, '.dfev1/crime/warehouse/manifest.json');
  assert.equal(policy.phases.find(({ id }) => id === 'M2').receipt.defaultPath, '.dfev1/area-intelligence/m2-baseline/evaluation/model-evaluation-report.json');
  assert.equal(policy.phases.find(({ id }) => id === 'M3').receipt.defaultPath, '.dfev1/home-neighborhood-compare/m3-v1/official-smoke/manifest.json');
  const m4 = policy.phases.find(({ id }) => id === 'M4');
  assert.equal(m4.receipt.schema, 'engagement-known-route-evidence-handoff/v2');
  assert.equal(m4.receipt.defaultPath, '.dfev1/known-route-evidence-v1/full-warehouse/final-handoff.json');
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
  assert.equal(policy.phases.find(({ id }) => id === '1D').receipt.defaultPath, '.dfev1/phase1/cumulative-receipt.json');
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
    phase.state = 'accepted'; phase.implementationTip = tip(`${phase.phase}-implementation`); phase.exactTip = phase.implementationTip;
    phase.recordTip = tip(`${phase.phase}-execution`); phase.cumulativeTip = tip(`${phase.phase}-cumulative`); phase.reviewedTip = phase.cumulativeTip;
    if (phase.phase === '1D') { phase.phaseBase = tip('pre-1d-integrated'); phase.preIntegrationBase = phase.phaseBase; }
    phase.status = { porcelain: [], index: [], untracked: [] }; phase.actualChangedPaths = [];
    // A producer's retained evidence must be admissible before the future 1D
    // deletion decision exists. A present authorization, however, is exact.
    phase.retention.authorizationReceipt = null;
    phase.receipt = { availability: 'available', actualPath: `${phase.worktree}/${definition.receipt.defaultPath}`, schema: definition.receipt.schema, identity: {}, revision: {}, validatorCommand: definition.receipt.validatorCommand, result: 'pass' };
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
  m4Receipt.governance = { m2: {
    identity: m2.receipt.identity, revision: m2.receipt.revision, receiptDigest: rawFixtureDigest(receipts.get('M2')),
    canonicalPath: m2.receipt.actualPath, evidenceRoot: m2.evidenceRoot,
    implementationTip: m2.implementationTip, executionRecordTip: m2.recordTip, cumulativeTip: m2.cumulativeTip,
    dq: m2ReceiptDq(receipts.get('M2')),
    dqRechecked: true,
  } };
  const oneD = fixture.phases.find((phase) => phase.phase === '1D');
  const oneDReceipt = receipts.get('1D');
  oneDReceipt.producerReceipts = ['M1', 'M2', 'M3', 'M4'].map((id) => ({
    phase: id,
    schema: receipts.get(id).schema,
    receiptDigest: rawFixtureDigest(receipts.get(id)),
    identity: fixture.phases.find((phase) => phase.phase === id).receipt.identity,
    revision: fixture.phases.find((phase) => phase.phase === id).receipt.revision,
    implementationTip: fixture.phases.find((phase) => phase.phase === id).implementationTip,
    canonicalPath: fixture.phases.find((phase) => phase.phase === id).receipt.actualPath,
    evidenceRoot: fixture.phases.find((phase) => phase.phase === id).evidenceRoot,
    executionRecordTip: fixture.phases.find((phase) => phase.phase === id).recordTip,
    cumulativeTip: fixture.phases.find((phase) => phase.phase === id).cumulativeTip,
    reviewedTip: fixture.phases.find((phase) => phase.phase === id).reviewedTip,
    dq: fixtureReceiptDq(id, receipts.get(id)),
    dqRechecked: true,
  }));
  oneD.receipt.identity.producerReceipts = oneDReceipt.producerReceipts;
  oneDReceipt.implementationTip = oneD.implementationTip;
  oneDReceipt.executionRecordTip = oneD.recordTip;
  oneDReceipt.cumulativeTip = oneD.cumulativeTip;
  oneD.receipt.revision.implementationTip = oneDReceipt.implementationTip;
  oneD.receipt.revision.executionRecordTip = oneDReceipt.executionRecordTip;
  oneD.receipt.revision.cumulativeTip = oneDReceipt.cumulativeTip;
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
      candidate: { implementationTip: phase.implementationTip, executionRecordTip: phase.recordTip, cumulativeTip: phase.cumulativeTip },
    });
  }
  const inspect = async (worktree) => {
    const phase = fixture.phases.find((item) => item.worktree === worktree);
    return { head: phase.cumulativeTip, main: phase.expectedBase, mergeBase: phase.actualMergeBase, status: [], changedPaths: [] };
  };
  const resolveRef = async (_worktree, reference) => reference;
  const trustedRecords = new Map();
  for (const phase of fixture.phases) {
    for (const kind of ['review', 'deletion']) {
      const reference = phase[`${kind}Authority`];
      if (!reference) continue;
      const authority = authorityReceipts.get(reference.path);
      trustedRecords.set(`${kind}:${phase.phase}`, {
        trusted: true, kind, phase: phase.phase, canonicalPath: reference.path,
        rawDigest: rawFixtureDigest(authority),
        candidate: { implementationTip: phase.implementationTip, executionRecordTip: phase.recordTip, cumulativeTip: phase.cumulativeTip },
        issuer: kind === 'review' ? phase.reviewAuthority.expectedIssuer : phase.deletionAuthority.expectedIssuer,
      });
    }
  }
  const fixtureOptions = {
    inspectWorktree: inspect,
    inspectRevision: async (worktree, reference) => {
      const phase = fixture.phases.find((item) => item.worktree === worktree);
      return { tip: reference, mergeBase: phase.actualMergeBase, expectedBase: phase.expectedBase, changedPaths: [] };
    },
    isAncestor: async () => true,
    changedBetween: async () => [],
    readReceipt: async (key) => {
      const phase = fixture.phases.find((item) => item.receipt.actualPath === key);
      return rawFixturePayload(receipts.get(phase?.phase));
    },
    filesystemAuthority: { async receiptPath(_worktree, _evidenceRoot, receiptPath) {
      if (receiptPath.startsWith('../') || receiptPath.startsWith('..\\') || /^[A-Za-z]:[\\/]/.test(receiptPath)) throw new Error('fixture authority rejects path escape');
      return receiptPath;
    } },
    authorityReader: { async read(key) { return rawFixturePayload(authorityReceipts.get(key)); } },
    trustedAuthorityResolver: {
      async resolve(input) {
        const expected = trustedRecords.get(`${input.kind}:${input.phase}`);
        if (!expected || input.canonicalPath !== expected.canonicalPath || input.rawDigest !== expected.rawDigest
          || JSON.stringify(input.candidate) !== JSON.stringify(expected.candidate)
          || JSON.stringify(input.issuer) !== JSON.stringify(expected.issuer)) return null;
        return structuredClone(expected);
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
  for (const [name, mutate] of [
    ['missing resolver raw digest', (trusted) => { delete trusted.rawDigest; }],
    ['resolver canonical path drift', (trusted) => { trusted.canonicalPath = 'fixture/forged.json'; }],
    ['resolver kind drift', (trusted) => { trusted.kind = 'deletion'; }],
    ['resolver phase drift', (trusted) => { trusted.phase = 'M4'; }],
    ['resolver candidate-tip drift', (trusted) => { trusted.candidate.cumulativeTip = 'forged-tip'; }],
    ['resolver issuer self-sign drift', (trusted) => { trusted.issuer = { taskId: 'M1 frozen warehouse task', identity: 'M1 frozen warehouse task' }; }],
  ]) {
    const result = await evaluateHandoff({
      policy, observation: fixture, ...fixtureOptions,
      trustedAuthorityResolver: { async resolve(input) {
        const trusted = await fixtureOptions.trustedAuthorityResolver.resolve(input);
        if (input.kind === 'review' && input.phase === 'M1') mutate(trusted);
        return trusted;
      } },
    });
    assert.equal(result.status, 'blocked', name);
    assert.equal(result.decisions.admissionEligible, false, name);
    assert.equal(result.decisions.deletionEligible, false, name);
  }
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
        cumulativeTip: deletable.phases.find((item) => item.phase === '1D').cumulativeTip,
        reviewedTip: deletable.phases.find((item) => item.phase === '1D').reviewedTip,
        receiptIdentity: deletable.phases.find((item) => item.phase === '1D').receipt.identity,
        receiptDigest: rawFixtureDigest(receipts.get('1D')),
      },
      target: {
        phase: phase.phase, ignoredRoot: phase.ignoredRoot, evidenceRoot: phase.evidenceRoot,
        canonicalPath: phase.receipt.actualPath, receiptDigest: rawFixtureDigest(receipts.get(phase.phase)),
        schema: receipts.get(phase.phase).schema, identity: phase.receipt.identity, revision: phase.receipt.revision,
        dq: fixtureReceiptDq(phase.phase, receipts.get(phase.phase)),
        candidate: { implementationTip: phase.implementationTip, executionRecordTip: phase.recordTip, cumulativeTip: phase.cumulativeTip },
        targets: [phase.receipt.actualPath],
      },
      prerequisites: definition.retention.deletePrerequisites,
      decidedAt: '2026-08-22T00:00:00.000Z',
    });
    const authority = authorityReceipts.get(phase.deletionAuthority.path);
    trustedRecords.set(`deletion:${phase.phase}`, {
      trusted: true, kind: 'deletion', phase: phase.phase, canonicalPath: phase.deletionAuthority.path,
      rawDigest: rawFixtureDigest(authority), issuer: phase.deletionAuthority.expectedIssuer,
      candidate: { implementationTip: phase.implementationTip, executionRecordTip: phase.recordTip, cumulativeTip: phase.cumulativeTip },
      deletionBinding: {
        accepted1DRawDigest: rawFixtureDigest(receipts.get('1D')),
        targetRawDigest: rawFixtureDigest(receipts.get(phase.phase)), targetCanonicalPath: phase.receipt.actualPath,
        evidenceRoot: phase.evidenceRoot, targets: [phase.receipt.actualPath],
        candidate: { implementationTip: phase.implementationTip, executionRecordTip: phase.recordTip, cumulativeTip: phase.cumulativeTip },
      },
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
    ['execution record tip swap', (candidate) => { candidate.phases.find(({ phase }) => phase === '1D').recordTip = tip('swapped-execution-record'); }, policy],
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
    ['M1 empty coverage is not a warehouse receipt', (_candidate, entries) => { entries.get('M1').coverage = {}; }],
    ['M1 lineage registry object is not the producer path receipt', (_candidate, entries) => { entries.get('M1').lineage_registry = {}; }],
    ['M1 quality report must be a safe relative JSON path', (_candidate, entries) => { entries.get('M1').latest_quality_report = '../quality.json'; }],
    ['M1 revision report must be a safe relative JSON path', (_candidate, entries) => { entries.get('M1').latest_revision_report = 'revisions/transaction.txt'; }],
    ['M1 coverage date field is strict', (_candidate, entries) => { entries.get('M1').coverage.earliest_scope_start = '2026-99-99'; }],
    ['M1 invalid updated timestamp is rejected', (_candidate, entries) => { entries.get('M1').updated_at = 'not-a-time'; }],
    ['M2 array protocol is rejected', (_candidate, entries) => { entries.get('M2').protocol = []; }],
    ['M2 empty coverage is rejected', (_candidate, entries) => { entries.get('M2').data.coverage = {}; }],
    ['M2 incomplete admission is rejected', (_candidate, entries) => { entries.get('M2').data.admission['fixed-grid'].admitted = 0; }],
    ['M2 admission shape is exact', (_candidate, entries) => { entries.get('M2').data.admission.complete = true; }],
    ['M2 arbitrary protocol schema is rejected', (_candidate, entries) => { entries.get('M2').protocol.schema = 'forged/v1'; }],
    ['M2 invalid generated timestamp is rejected', (_candidate, entries) => { entries.get('M2').generated_at = 'not-a-time'; }],
    ['M2 invalid canonical report metric is rejected by producer validator', (_candidate, entries) => { entries.get('M2').metrics.primary_by_fold_space_holdout[0].mae = null; }],
    ['M2 empty required report slice is rejected', (_candidate, entries) => { entries.get('M2').metrics.by_category = []; }],
    ['M3 empty routing is rejected by source-domain adapter', (_candidate, entries) => { entries.get('M3').routing = {}; }],
    ['M3 invalid source observation time is rejected', (_candidate, entries) => { entries.get('M3').observations[0].retrievedAt = 'not-a-time'; }],
    ['M3 invalid source revision is rejected', (_candidate, entries) => { entries.get('M3').observations[0].revision = ''; }],
    ['M3 source identity cannot be constructed from the candidate', (_candidate, entries) => { entries.get('M3').observations[0].dataset = 'forged-dataset'; }],
    ['M3 routing cannot promote a source smoke receipt', (_candidate, entries) => { entries.get('M3').routing.road.status = 'available'; }],
    ['M3 privacy runtime fields are frozen', (_candidate, entries) => { entries.get('M3').privacy.runtime_only_fields = []; }],
    ['M3 empty limitations is rejected', (_candidate, entries) => { entries.get('M3').limitations = []; }],
    ['M4 invalid started clock is rejected', (_candidate, entries) => { entries.get('M4').startedAt = 'not-a-time'; }],
    ['M4 corridor identity cannot be an array', (_candidate, entries) => { entries.get('M4').corridorIdentity = ['corridor']; }],
    ['M4 accumulator requires real checkpoint counters', (_candidate, entries) => { entries.get('M4').accumulator.rowsRead = -1; }],
    ['M4 accumulator requires nonempty segments', (_candidate, entries) => { entries.get('M4').accumulator.segments = []; }],
    ['M4 accumulator segment fields are typed', (_candidate, entries) => { entries.get('M4').accumulator.segments[0].contributionUnits = 'one'; }],
    ['M4 governance M2 raw digest drift is rejected', (_candidate, entries) => { entries.get('M4').governance.m2.receiptDigest = digest('forged-m2'); }],
    ['M4 governance M2 canonical receipt path drift is rejected', (_candidate, entries) => { entries.get('M4').governance.m2.canonicalPath = 'fixture/M2/forged.json'; }],
    ['M4 governance M2 evidence root drift is rejected', (_candidate, entries) => { entries.get('M4').governance.m2.evidenceRoot = 'fixture/M2/.dfev1/forged'; }],
    ['M4 governance M2 execution tip drift is rejected', (_candidate, entries) => { entries.get('M4').governance.m2.executionRecordTip = tip('forged-m2-execution'); }],
    ['1D non-digest producer binding is rejected', (_candidate, entries) => { entries.get('1D').producerReceipts[0].receiptDigest = 'arbitrary'; }],
    ['1D producer receipt path drift is rejected', (_candidate, entries) => { entries.get('1D').producerReceipts[0].canonicalPath = 'fixture/M1/forged.json'; }],
    ['1D producer evidence root drift is rejected', (_candidate, entries) => { entries.get('1D').producerReceipts[1].evidenceRoot = 'fixture/M2/.dfev1/forged'; }],
    ['1D producer cumulative tip drift is rejected', (_candidate, entries) => { entries.get('1D').producerReceipts[2].cumulativeTip = tip('forged-m3-cumulative'); }],
    ['1D recomputed status drift is rejected', (_candidate, entries) => { entries.get('1D').status.M3 = 'blocked'; }],
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
      readReceipt: async (key) => {
        const phase = candidate.phases.find((item) => item.receipt.actualPath === key);
        return rawFixturePayload(candidateReceipts.get(phase?.phase));
      },
      authorityReader: { async read(key) { return rawFixturePayload(candidateAuthorities.get(key)); } },
      isAncestor: name === 'declared DAG ancestry fails' ? async () => false : fixtureOptions.isAncestor,
    };
    const result = await evaluateHandoff({ policy, observation: candidate, ...hostileOptions });
    assert.equal(result.status, 'blocked', `${name} must fail closed`);
    assert.equal(result.decisions.admissionEligible, false, `${name} cannot admit globally`);
    assert.equal(result.decisions.deletionEligible, false, `${name} cannot authorize deletion`);
    assert.equal(result.phases.M4.decisions.admissionEligible, false, `${name} cannot admit M4`);
    assert.equal(result.phases['1D'].decisions.admissionEligible, false, `${name} cannot admit 1D`);
  }

  // Receipt identity is the raw on-disk JSON byte sequence, not a convenient
  // reserialization of an equivalent object. Whitespace changes therefore
  // invalidate bindings unless all downstream receipts and independent trust
  // records are regenerated by their proper owners.
  const whitespaceResult = await evaluateHandoff({
    policy, observation: fixture, ...fixtureOptions,
    readReceipt: async (key) => {
      const phase = fixture.phases.find((item) => item.receipt.actualPath === key);
      return rawFixturePayload(receipts.get(phase?.phase), phase?.phase === 'M2' ? '\n' : '');
    },
  });
  assert.equal(whitespaceResult.status, 'blocked');
  assert.equal(whitespaceResult.decisions.admissionEligible, false);
  assert.equal(whitespaceResult.decisions.deletionEligible, false);

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
    ['deletion raw receipt replay mismatch', (entries) => { findAuthority(entries, 'deletion', 'M3').target.receiptDigest = digest('stale-target'); }],
  ]) {
    const candidate = structuredClone(deletable);
    const candidateAuthorities = new Map([...authorityReceipts].map(([key, value]) => [key, structuredClone(value)]));
    mutate(candidateAuthorities, candidate);
    const result = await evaluateHandoff({ policy, observation: candidate, ...fixtureOptions, authorityReader: { async read(key) { return rawFixturePayload(candidateAuthorities.get(key)); } } });
    assert.equal(result.status, 'accepted', `${name} does not erase retained evidence`);
    assert.equal(result.decisions.admissionEligible, true, `${name} cannot recast admission`);
    assert.equal(result.decisions.deletionEligible, false, `${name} must fail closed for deletion`);
  }

  // Three distinct tips are valid: implementation -> execution evidence ->
  // cumulative record.  A reviewer may attest that cumulative candidate
  // without requiring the execution record to equal the reviewed candidate.
  const documentationChild = structuredClone(fixture);
  const childReceipts = new Map([...receipts].map(([key, value]) => [key, structuredClone(value)]));
  const childAuthorities = new Map([...authorityReceipts].map(([key, value]) => [key, structuredClone(value)]));
  for (const phase of documentationChild.phases) {
    phase.recordTip = tip(`${phase.phase}-execution-record`);
    phase.cumulativeTip = tip(`${phase.phase}-cumulative-record`);
    phase.reviewedTip = phase.cumulativeTip;
    childAuthorities.get(phase.reviewAuthority.path).candidate = {
      implementationTip: phase.implementationTip, executionRecordTip: phase.recordTip, cumulativeTip: phase.cumulativeTip,
    };
    const producerBinding = childReceipts.get('1D').producerReceipts.find((entry) => entry.phase === phase.phase);
    if (producerBinding) {
      producerBinding.executionRecordTip = phase.recordTip;
      producerBinding.cumulativeTip = phase.cumulativeTip;
      producerBinding.reviewedTip = phase.reviewedTip;
    }
  }
  const childM2 = documentationChild.phases.find((phase) => phase.phase === 'M2');
  childReceipts.get('M4').governance.m2 = {
    identity: childM2.receipt.identity, revision: childM2.receipt.revision, receiptDigest: rawFixtureDigest(childReceipts.get('M2')),
    canonicalPath: childM2.receipt.actualPath, evidenceRoot: childM2.evidenceRoot,
    implementationTip: childM2.implementationTip, executionRecordTip: childM2.recordTip, cumulativeTip: childM2.cumulativeTip, dq: m2ReceiptDq(childReceipts.get('M2')), dqRechecked: true,
  };
  childReceipts.get('1D').producerReceipts.find((entry) => entry.phase === 'M4').receiptDigest = rawFixtureDigest(childReceipts.get('M4'));
  const childOneD = documentationChild.phases.find((phase) => phase.phase === '1D');
  childReceipts.get('1D').implementationTip = childOneD.implementationTip;
  childReceipts.get('1D').executionRecordTip = childOneD.recordTip;
  childReceipts.get('1D').cumulativeTip = childOneD.cumulativeTip;
  childOneD.receipt.revision = { implementationTip: childOneD.implementationTip, executionRecordTip: childOneD.recordTip, cumulativeTip: childOneD.cumulativeTip };
  childOneD.receipt.identity.producerReceipts = childReceipts.get('1D').producerReceipts;
  const recordInspect = async (worktree) => {
    const phase = documentationChild.phases.find((item) => item.worktree === worktree);
    return { head: phase.cumulativeTip, main: phase.expectedBase, mergeBase: phase.actualMergeBase, status: [], changedPaths: [] };
  };
  const recordTrusted = new Map(documentationChild.phases.map((phase) => {
    const authority = childAuthorities.get(phase.reviewAuthority.path);
    return [`review:${phase.phase}`, {
      trusted: true, kind: 'review', phase: phase.phase, canonicalPath: phase.reviewAuthority.path,
      rawDigest: rawFixtureDigest(authority), issuer: phase.reviewAuthority.expectedIssuer,
      candidate: { implementationTip: phase.implementationTip, executionRecordTip: phase.recordTip, cumulativeTip: phase.cumulativeTip },
    }];
  }));
  const recordOptions = {
    ...fixtureOptions,
    inspectWorktree: recordInspect,
    changedBetween: async () => ['docs/active/_worktree_registry.md', 'docs/active/phase1-evidence-completion/task.md'],
    readReceipt: async (key) => {
      const phase = documentationChild.phases.find((item) => item.receipt.actualPath === key);
      return rawFixturePayload(childReceipts.get(phase?.phase));
    },
    authorityReader: { async read(key) { return rawFixturePayload(childAuthorities.get(key)); } },
    trustedAuthorityResolver: { async resolve(input) {
      const expected = recordTrusted.get(`${input.kind}:${input.phase}`);
      if (!expected || input.canonicalPath !== expected.canonicalPath || input.rawDigest !== expected.rawDigest
        || JSON.stringify(input.candidate) !== JSON.stringify(expected.candidate)
        || JSON.stringify(input.issuer) !== JSON.stringify(expected.issuer)) return null;
      return structuredClone(expected);
    } },
  };
  const documentedResult = await evaluateHandoff({ policy, observation: documentationChild, ...recordOptions });
  assert.equal(documentedResult.status, 'accepted', documentedResult.reasons.join('; '));
  assert.equal((await evaluateHandoff({ policy, observation: documentationChild, ...recordOptions, changedBetween: async () => ['src/home_compare/controller.js'] })).status, 'blocked');

  for (const [name, mutate] of [
    ['missing cumulative tip', (candidate) => { candidate.phases[0].cumulativeTip = null; }],
    ['execution/cumulative self-reference', (candidate) => { const phase = candidate.phases[0]; phase.cumulativeTip = phase.recordTip; }],
    ['stale cumulative tip swap', (candidate) => { candidate.phases[0].cumulativeTip = tip('stale-cumulative'); }],
  ]) {
    const candidate = structuredClone(fixture); mutate(candidate);
    const result = await evaluateHandoff({ policy, observation: candidate, ...fixtureOptions });
    assert.equal(result.status, 'blocked', name);
    assert.equal(result.phases.M1.decisions.admissionEligible, false, name);
    assert.equal(result.decisions.admissionEligible, false, name);
    assert.equal(result.decisions.deletionEligible, false, name);
  }
  const nonAncestor = await evaluateHandoff({
    policy, observation: fixture, ...fixtureOptions,
    isAncestor: async (_worktree, ancestor, descendant) => !(ancestor === fixture.phases[0].recordTip && descendant === fixture.phases[0].cumulativeTip),
  });
  assert.equal(nonAncestor.status, 'blocked');
  assert.equal(nonAncestor.phases.M1.decisions.admissionEligible, false);
  assert.equal(nonAncestor.decisions.admissionEligible, false);
  assert.equal(nonAncestor.decisions.deletionEligible, false);

  // The cumulative program range may contain M3/M4-owned files, while the
  // final 1D implementation slice is limited to its own integration scope.
  const unionOwned = structuredClone(fixture);
  const oneDPhase = unionOwned.phases.find((phase) => phase.phase === '1D');
  const programPaths = [
    'docs/active/_worktree_registry.md', 'scripts/lib/phase1_handoff_evaluator.mjs',
    'src/home_compare/controller.js', 'src/home_compare/loader.js', 'src/home_compare/results_view.js', 'src/home_compare/view.js',
    'scripts/tests/home_compare_browser.mjs', 'scripts/tests/home_compare_m3.mjs',
    'src/routes_crime/known_route_evidence.js', 'scripts/build_known_route_evidence.mjs',
    'scripts/tests/known_route_evidence_m4.mjs', 'scripts/tests/known_route_evidence_browser.mjs',
  ];
  oneDPhase.actualChangedPaths = programPaths;
  const unionOptions = {
    ...fixtureOptions,
    inspectRevision: async (worktree, reference) => {
      const phase = unionOwned.phases.find((item) => item.worktree === worktree);
      return { tip: reference, mergeBase: phase.actualMergeBase, expectedBase: phase.expectedBase, changedPaths: phase.phase === '1D' ? programPaths : [] };
    },
  };
  const unionResult = await evaluateHandoff({ policy, observation: unionOwned, ...unionOptions });
  assert.equal(unionResult.status, 'accepted', unionResult.reasons.join('; '));
  const ownSliceEscape = await evaluateHandoff({
    policy, observation: unionOwned, ...unionOptions,
    changedBetween: async (_worktree, ancestor, descendant) => ancestor === oneDPhase.phaseBase && descendant === oneDPhase.implementationTip
      ? ['src/home_compare/controller.js'] : [],
  });
  assert.equal(ownSliceEscape.status, 'blocked');
  assert.equal(ownSliceEscape.phases['1D'].decisions.admissionEligible, false);
  assert.equal(ownSliceEscape.decisions.admissionEligible, false);
  assert.equal(ownSliceEscape.decisions.deletionEligible, false);
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

test('immutable policy default receipt paths block an injected reader before raw bytes are read', async () => {
  const { policy, observation } = await documents();
  const candidate = structuredClone(observation);
  const phase = candidate.phases.find(({ phase: id }) => id === 'M1');
  phase.receipt = {
    availability: 'available', actualPath: `${phase.worktree}/.dfev1/crime/warehouse/attacker.json`,
    schema: policy.phases.find(({ id }) => id === 'M1').receipt.schema, identity: {}, revision: {},
    validatorCommand: 'npm run test:phase1-handoff', result: 'pass',
  };
  let read = false;
  const result = await evaluateHandoff({
    policy, observation: candidate,
    filesystemAuthority: { async receiptPath() { return phase.receipt.actualPath; } },
    readReceipt: async () => { read = true; return rawFixturePayload({}); },
  });
  assert.equal(read, false);
  assert.equal(result.phases.M1.decisions.admissionEligible, false);
  assert.equal(result.decisions.admissionEligible, false);
  assert.equal(result.decisions.deletionEligible, false);
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

test('filesystem authority rejects an inner reparse ancestor even when its final canonical path stays inside the exact root', async () => {
  const stat = async (pathname) => ({
    isFile: () => pathname.endsWith('manifest.json'),
    // This adapter models either a POSIX symlink or a Windows reparse/junction
    // discovered at an existing inner ancestor.  The final canonical target
    // intentionally remains inside the root, which is why realpath alone is
    // not an adequate authority check.
    isSymbolicLink: () => pathname.endsWith('/warehouse'),
  });
  const authority = createFilesystemAuthority({ platform: 'linux', canonicalize: async (pathname) => pathname, stat });
  await assert.rejects(
    authority.receiptPath('/worktree', '/worktree/.dfev1/crime/warehouse', '/worktree/.dfev1/crime/warehouse/manifest.json', {
      ignoredRoot: '.dfev1/crime/**', defaultPath: '.dfev1/crime/warehouse/manifest.json',
    }),
    /symlink or reparse/,
  );
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
    await assert.rejects(realFilesystemAuthority.receiptPath(temporary, junction, path.join(junction, 'receipt.json')), /canonical path escapes|symlink or reparse/);
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
function tip(seed) { return createHash('sha1').update(String(seed)).digest('hex'); }
function rawFixtureDigest(value) { return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
function rawFixturePayload(value, prefix = '') {
  const bytes = Buffer.from(`${prefix}${JSON.stringify(value)}`, 'utf8');
  return { value: JSON.parse(bytes.toString('utf8')), bytes, rawDigest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
}

function m2ReceiptDq(receipt) { return structuredClone(receipt.data.admission); }
function fixtureReceiptDq(phase, receipt) {
  if (phase === 'M1') return { latestQualityReport: receipt.latest_quality_report };
  if (phase === 'M2') return m2ReceiptDq(receipt);
  if (phase === 'M3') return receipt.observations.map(({ sourceId, dq }) => ({ sourceId, dq: [...dq] }));
  if (phase === 'M4') return structuredClone(receipt.dataQuality);
  return null;
}

function strictFixtureReceipt(phase, definition) {
  const receipt = {};
  for (const field of definition.receipt.requiredFields) setPath(receipt, field, fixtureReceiptValue(phase, field));
  receipt.schema = definition.receipt.schema;
  if (phase === 'M1') {
    receipt.current_snapshot_id = digest('m1');
    receipt.mode = 'official-local-candidate'; receipt.serving_eligible = false; receipt.partition_count = 64;
    receipt.canonical_row_count = 4; receipt.active_row_count = 3; receipt.removal_candidate_count = 1;
    receipt.applied_snapshot_ids = [receipt.current_snapshot_id];
    receipt.coverage = { earliest_scope_start: '2026-01-01', latest_scope_end_exclusive: '2026-08-22', latest_event_at: '2026-08-21T00:00:00.000Z' };
    receipt.lineage_registry = 'lineage/registry.json';
    receipt.latest_quality_report = 'quality/transaction.json'; receipt.latest_revision_report = 'revisions/transaction.json'; receipt.updated_at = '2026-08-22T00:00:00.000Z';
  }
  if (phase === 'M2') {
    receipt.generated_at = '2026-08-22T00:00:00.000Z'; receipt.protocol = { schema: 'engagement-area-intelligence-evaluation-protocol/v1', sha256: digest('m2-protocol'), frozen_at: '2026-08-21T00:00:00.000Z', frozen_before_model_performance: true };
    receipt.data = {
      mart_artifact_identity: digest('m2-mart'), mart_manifest_sha256: digest('m2-manifest'), source_vintage: digest('m2-source'),
      coverage: { earliest_scope_start: '2026-01-01', latest_scope_end_exclusive: '2026-08-22', latest_event_at: '2026-08-21T00:00:00.000Z' },
      complete_week_end_exclusive: '2026-08-17', unit_count: { tract: 1, 'fixed-grid': 1 }, mart_rows: 2,
      admission: { canonical_rows_seen: 2, tract: { admitted: 1, ambiguous_excluded: 0, unmapped_excluded: 0 }, 'fixed-grid': { admitted: 1, unavailable_excluded: 0 }, unknown_category: 0, invalid_event_time: 0, non_active: 0 },
    };
    receipt.metrics = {
      primary_by_fold_space_holdout: [{ model: 'fixture', fold: 'one', mae: 1, poisson_deviance: 1, negative_binomial_deviance: 1, prediction_interval_90_coverage: 0.9, relative_mae_gain_vs_seasonal_naive: 0.1 }],
      by_category: [{ model: 'fixture', fold: 'one' }], by_data_volume: [{ model: 'fixture', fold: 'one' }],
    }; receipt.promotion = { status: 'not-promoted' };
  }
  if (phase === 'M3') {
    receipt.generatedAt = '2026-08-22T00:00:00.000Z'; receipt.status = 'partial'; receipt.semanticIdentity = digest('m3');
    const sources = [
      ['citygeo-address-locator', 'Address_Locator', 'arcgis-geocode-server'], ['opa-current-property', 'opa_properties_public', 'carto-sql'], ['opa-assessment-history', 'assessments', 'carto-sql'], ['real-estate-transfers', 'rtt_summary', 'carto-sql'], ['philly311-requests', 'public_cases_fc', 'carto-sql'], ['li-property-history', 'violations|business_licenses|case_investigations', 'carto-sql'], ['vacant-property-indicators', 'Vacant_Indicators_Bldg/0', 'arcgis-feature-service'], ['philadelphia-reported-crime', 'incidents_part1_part2', 'carto-sql'], ['vision-zero-hin-2025', 'high_injury_network_2025/0', 'arcgis-feature-service'],
    ];
    receipt.observations = sources.map(([sourceId, dataset, transport]) => ({ sourceId, status: 'partial', dataset, transport, retrievedAt: '2026-08-22T00:00:00.000Z', sourceAsOf: '2026-08-21T00:00:00.000Z', revision: null, rowCount: 1, schemaFields: ['id'], missingFields: [], dq: ['fixture-dq'] }));
    receipt.routing = { status: 'unavailable', road: { status: 'unavailable', reason: 'fixture' }, transit: { status: 'unavailable', reason: 'fixture' }, forbidden_substitutes: ['fixture'] };
    receipt.privacy = { runtime_only_fields: ['input_address', 'normalized_address', 'coordinates', 'parcel_identifier', 'commute_destination'], forbidden_tracked_or_shareable_fields: ['address', 'coordinates', 'source_record_id', 'owner', 'grantor', 'grantee', 'case_identifier', 'document_identifier'] }; receipt.limitations = ['fixture limitation'];
  }
  if (phase === 'M4') {
    receipt.warehouseIdentity = digest('m4-warehouse'); receipt.routeIdentity = digest('m4-route'); receipt.catalogIdentity = digest('m4-catalog'); receipt.centerlineDataVersion = 'centerline-v1'; receipt.corridorIdentity = 'corridor-v1';
    receipt.completedPartitions = 2; receipt.partitionCount = 2; receipt.startedAt = '2026-08-22T00:02:00.000Z'; receipt.completion = { state: 'complete', completedAt: '2026-08-22T00:03:00.000Z', durationMs: 1, maximumRssBytes: 1, resumedPartitions: 0 }; receipt.accumulator = { rowsRead: 2, eligibleGeneralizedRows: 2, contributingRows: 1, excluded: { nonActive: 0, coordinateUnavailable: 0, precisionUnavailable: 0, categoryUnavailable: 0, outsideUncertaintyCorridor: 0, ambiguousNonAdjacent: 0, malformed: 0 }, segments: [{ analysisSegmentId: 'segment-001', streetLabel: 'Fixture Street', contributionUnits: 1, contributingRows: 1, categories: [['property', 1]] }] };
    receipt.dataQuality = { partitionCompletion: true, accumulatorValidated: true }; receipt.lineage = { warehouseIdentity: receipt.warehouseIdentity, routeIdentity: receipt.routeIdentity, catalogIdentity: receipt.catalogIdentity };
    receipt.consent = { publicCenterlineRequest: true }; receipt.clocks = { sourceAsOf: '2026-08-22T00:00:00.000Z', retrievedAt: '2026-08-22T00:01:00.000Z', builtAt: '2026-08-22T00:02:00.000Z', observedAt: '2026-08-22T00:03:00.000Z' };
  }
  if (phase === '1D') { receipt.producerReceipts = []; receipt.topology = [['M1', 'M2'], ['M2', 'M3'], ['M1', 'M4'], ['M1', '1D'], ['M2', '1D'], ['M3', '1D'], ['M4', '1D']]; receipt.overlap = [{ status: 'none', pairs: [] }]; receipt.status = { M1: 'accepted', M2: 'accepted', M3: 'accepted', M4: 'accepted', '1D': 'accepted' }; receipt.implementationTip = tip('1d-implementation'); receipt.executionRecordTip = tip('1d-execution'); receipt.cumulativeTip = tip('1d-cumulative'); }
  return receipt;
}
