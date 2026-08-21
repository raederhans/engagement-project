import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export async function readJson(pathname) {
  return JSON.parse(await readFile(pathname, 'utf8'));
}

function pathFlavor(value, platform) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('path is empty or contains a NUL');
  if (value.includes('/') && value.includes('\\')) throw new Error('path mixes slash styles');
  if (/^\\\\[.?]\\/.test(value)) throw new Error('path is a Windows device namespace');
  if (/^\\\\/.test(value)) throw new Error('path is a UNC path');
  if (platform === 'win32') {
    if (!/^[A-Za-z]:[\\/]/.test(value)) throw new Error('Windows authority path must be drive-absolute');
    return path.win32;
  }
  if (value.includes('\\') || /^[A-Za-z]:/.test(value)) throw new Error('POSIX authority path uses a Windows drive or separator');
  return path;
}

function contained(flavor, root, candidate) {
  const relative = flavor.relative(root, candidate);
  return relative !== '' && !flavor.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${flavor.sep}`);
}

function separatorStyle(value) {
  if (value.includes('\\')) return 'backslash';
  if (value.includes('/')) return 'slash';
  return 'none';
}

function lexicalWithin(parent, candidate, separator) {
  const normalizedParent = parent.replace(/[\\/]+$/, '');
  return candidate.startsWith(`${normalizedParent}${separator}`);
}

export function createFilesystemAuthority({
  platform = process.platform,
  canonicalize = realpath,
  stat = lstat,
} = {}) {
  return Object.freeze({
    async receiptPath(worktree, evidenceRoot, receiptPath) {
      const flavor = pathFlavor(worktree, platform);
      const evidenceFlavor = pathFlavor(evidenceRoot, platform);
      const receiptFlavor = pathFlavor(receiptPath, platform);
      if (flavor !== evidenceFlavor || flavor !== receiptFlavor) throw new Error('path flavor differs across authority inputs');
      const styles = new Set([separatorStyle(worktree), separatorStyle(evidenceRoot), separatorStyle(receiptPath)]);
      if (styles.size !== 1 || styles.has('none')) throw new Error('path separator style drift');
      // Drive spelling is an authority boundary on Windows: accepting C: and c:
      // as interchangeable would let an observation conceal a case/drive drift.
      if (platform === 'win32') {
        const drive = worktree.slice(0, 2);
        if (evidenceRoot.slice(0, 2) !== drive || receiptPath.slice(0, 2) !== drive) throw new Error('Windows drive or case drift');
      }
      const separator = styles.has('backslash') ? '\\' : '/';
      if (!lexicalWithin(worktree, evidenceRoot, separator) || !lexicalWithin(evidenceRoot, receiptPath, separator)) {
        throw new Error('receipt lexical path escapes worktree or evidence root');
      }
      const root = flavor.resolve(worktree);
      const evidence = flavor.resolve(evidenceRoot);
      const receipt = flavor.resolve(receiptPath);
      if (!contained(flavor, root, evidence) || !contained(flavor, evidence, receipt)) throw new Error('receipt path escapes worktree or evidence root');
      const [canonicalRoot, canonicalEvidence, canonicalReceipt, receiptStat] = await Promise.all([
        canonicalize(root), canonicalize(evidence), canonicalize(receipt), stat(receipt),
      ]);
      if (!receiptStat.isFile() || receiptStat.isSymbolicLink()) throw new Error('receipt is not a regular file');
      const canonicalFlavor = pathFlavor(canonicalRoot, platform);
      if (canonicalFlavor !== pathFlavor(canonicalEvidence, platform) || canonicalFlavor !== pathFlavor(canonicalReceipt, platform)
        || !contained(canonicalFlavor, canonicalRoot, canonicalEvidence)
        || !contained(canonicalFlavor, canonicalEvidence, canonicalReceipt)) throw new Error('receipt canonical path escapes worktree or evidence root');
      return canonicalReceipt;
    },
  });
}

export const realFilesystemAuthority = createFilesystemAuthority();

export async function inspectGitWorktree(worktree) {
  const run = async (...args) => (await execFileAsync('git', ['-C', worktree, ...args], { windowsHide: true })).stdout.trim();
  const head = await run('rev-parse', 'HEAD');
  const main = await run('rev-parse', 'main');
  const mergeBase = await run('merge-base', 'main', 'HEAD');
  const status = await run('status', '--porcelain=v1');
  const changed = await run('diff', '--name-only', `${mergeBase}..HEAD`);
  return {
    head, main, mergeBase,
    status: status ? status.split(/\r?\n/) : [],
    changedPaths: changed ? changed.split(/\r?\n/) : [],
  };
}

export async function resolveGitRef(worktree, reference) {
  return (await execFileAsync('git', ['-C', worktree, 'rev-parse', `${reference}^{commit}`], { windowsHide: true })).stdout.trim();
}

export const RECORD_ONLY_PATHS = Object.freeze([
  'docs/active/_worktree_registry.md',
  'docs/active/phase1-evidence-completion/context.md',
  'docs/active/phase1-evidence-completion/handoff.observation.json',
  'docs/active/phase1-evidence-completion/task.md',
]);

const PHASE1_0_WRITABLE = Object.freeze([
  'docs/active/_worktree_registry.md',
  'scripts/tests/area_intelligence_browser.mjs',
  'scripts/tests/p1_accessibility_design_contracts.mjs',
  'scripts/tests/release_gate_contracts.mjs',
  'scripts/tests/run_visual_experience_dist_contracts.mjs',
]);

const EXACT_PHASE_POLICY = Object.freeze({
  M1: {
    owner: 'M1 frozen warehouse task',
    writable: ['scripts/acquire_crime_events.mjs', 'scripts/ingest_crime_events.mjs', 'scripts/backfill_crime_event_warehouse.mjs', 'scripts/lib/crime_event_warehouse.mjs', 'scripts/tests/crime_event_warehouse.mjs'],
    forbidden: ['package.json', 'public/data/**', 'src/home_compare/**', 'src/routes_crime/known_route_*.js'],
    ignoredOutputRoots: ['.dfev1/crime/**'],
    ports: [],
    upstreamReceiptBindings: [],
    retention: { duration: 'P180D', triggerEvent: 'independently-reviewed-1D-acceptance', decisionOwner: '1D integration/release owner', deletePrerequisites: ['M1 receipt recheck', '1D cumulative receipt recheck'], authorizationReceipt: '1D cumulative retention authorization' },
    receipt: { schema: 'engagement-phl-crime-event-warehouse/v1', requiredFields: ['current_snapshot_id', 'coverage', 'lineage_registry', 'latest_quality_report', 'latest_revision_report', 'updated_at'], identityFields: ['current_snapshot_id'], revisionFields: ['updated_at', 'latest_revision_report'], validatorCommand: 'npm run test:phase1-handoff', mode: 'admission' },
  },
  M2: {
    owner: 'M2 mart/evaluation task',
    writable: ['scripts/build_area_intelligence_marts.mjs', 'scripts/evaluate_area_intelligence.mjs', 'scripts/lib/area_intelligence_*.mjs', 'scripts/tests/area_intelligence_m2.mjs'],
    forbidden: ['package.json', 'public/data/**', 'src/home_compare/**', 'src/routes_crime/known_route_*.js'],
    ignoredOutputRoots: ['.dfev1/area-intelligence/**'],
    ports: [4198],
    upstreamReceiptBindings: ['M1'],
    retention: { duration: 'P180D', triggerEvent: 'independently-reviewed-1D-acceptance', decisionOwner: '1D integration/release owner', deletePrerequisites: ['M1 receipt recheck', 'M2 receipt recheck', '1D cumulative receipt recheck'], authorizationReceipt: '1D cumulative retention authorization' },
    receipt: { schema: 'ModelEvaluationReport/v1', requiredFields: ['generated_at', 'protocol.schema', 'data.mart_artifact_identity', 'data.source_vintage', 'data.coverage'], identityFields: ['data.mart_artifact_identity', 'data.source_vintage'], revisionFields: ['generated_at', 'protocol.sha256'], validatorCommand: 'npm run test:phase1-handoff', mode: 'admission' },
  },
  M3: {
    owner: 'M3 Home Compare task',
    writable: ['src/home_compare/**', 'scripts/smoke_home_compare_sources.mjs', 'scripts/lib/home_compare_source_smoke.mjs', 'scripts/tests/home_compare_m3.mjs', 'scripts/tests/home_compare_browser.mjs'],
    forbidden: ['package.json', 'public/data/**', 'src/routes_crime/known_route_*.js'],
    ignoredOutputRoots: ['.dfev1/home-neighborhood-compare/m3-v1/**'],
    ports: [4189],
    upstreamReceiptBindings: ['M2'],
    retention: { duration: 'P30D', triggerEvent: 'independently-reviewed-1D-acceptance', decisionOwner: '1D integration/release owner', deletePrerequisites: ['M3 receipt recheck', 'desktop-en-synthetic.png retained', 'mobile-en-synthetic.png retained', '1D cumulative receipt recheck'], authorizationReceipt: '1D cumulative retention authorization' },
    receipt: { schema: 'engagement-home-compare-source-smoke/v1', requiredFields: ['generatedAt', 'status', 'semanticIdentity', 'observations', 'routing', 'privacy', 'limitations'], identityFields: ['semanticIdentity'], revisionFields: ['generatedAt', 'observations.0.revision', 'observations.0.dq'], validatorCommand: 'npm run test:phase1-handoff', mode: 'admission' },
  },
  M4: {
    owner: 'M4 Known Route task',
    writable: ['src/routes_crime/known_route_*.js', 'scripts/smoke_known_route_evidence.mjs', 'scripts/build_known_route_evidence.mjs', 'scripts/lib/known_route_evidence_checkpoint.mjs', 'scripts/tests/known_route_evidence_m4.mjs', 'scripts/tests/known_route_evidence_browser.mjs'],
    forbidden: ['package.json', 'public/data/**', 'src/home_compare/**'],
    ignoredOutputRoots: ['.dfev1/known-route-evidence-v1/**'],
    ports: [4194],
    upstreamReceiptBindings: ['M1'],
    governancePrerequisites: ['M2 frozen evaluation receipt recheck'],
    retention: { duration: 'P30D', triggerEvent: 'independently-reviewed-1D-acceptance', decisionOwner: '1D integration/release owner', deletePrerequisites: ['M1 receipt recheck', 'M4 receipt recheck', '1D cumulative receipt recheck'], authorizationReceipt: '1D cumulative retention authorization' },
    receipt: {
      mode: 'admission',
      schema: 'engagement-known-route-evidence-handoff/v2',
      requiredFields: ['warehouseIdentity', 'routeIdentity', 'centerlineDataVersion', 'catalogIdentity', 'corridorIdentity', 'completedPartitions', 'partitionCount', 'startedAt', 'completion', 'accumulator', 'dataQuality.partitionCompletion', 'dataQuality.accumulatorValidated', 'lineage.warehouseIdentity', 'lineage.routeIdentity', 'lineage.catalogIdentity', 'consent.publicCenterlineRequest', 'clocks.sourceAsOf', 'clocks.retrievedAt', 'clocks.builtAt', 'clocks.observedAt'],
      identityFields: ['warehouseIdentity', 'routeIdentity', 'catalogIdentity'],
      revisionFields: ['centerlineDataVersion', 'startedAt'],
      validatorCommand: 'npm run test:phase1-handoff',
      dataQualityFields: ['dataQuality.partitionCompletion', 'dataQuality.accumulatorValidated'], lineageFields: ['lineage.warehouseIdentity', 'lineage.routeIdentity', 'lineage.catalogIdentity'], consentFields: ['consent.publicCenterlineRequest'], clockFields: ['clocks.sourceAsOf', 'clocks.retrievedAt', 'clocks.builtAt', 'clocks.observedAt'], futureRequired: true,
    },
  },
  '1D': {
    owner: '1D integration/release owner',
    writable: ['package.json', 'scripts/lib/browser_suite_lifecycle.mjs', 'scripts/tests/browser_suite_lifecycle_contracts.mjs', 'scripts/lib/phase1_handoff_evaluator.mjs', 'scripts/tests/phase1_handoff_contracts.mjs', 'scripts/tests/release_workflow_contracts.mjs', 'scripts/run_release_gate.mjs', 'scripts/run_visual_experience_dist.mjs', '.github/workflows/ci.yml', 'scripts/tests/bundle_policy.mjs', 'docs/active/phase1-evidence-completion/**'],
    forbidden: [],
    ignoredOutputRoots: ['.dfev1/phase1/**'],
    ports: [4173, 4178, 4189, 4194, 4198],
    upstreamReceiptBindings: ['M1', 'M2', 'M3', 'M4'],
    retention: { duration: 'per-approved-project-policy', triggerEvent: 'independently-reviewed-1D-acceptance', decisionOwner: '1D integration/release owner', deletePrerequisites: ['all producer receipt rechecks', 'independent review'], authorizationReceipt: '1D cumulative retention authorization' },
    receipt: { schema: 'engagement-phase1-cumulative-receipt/v1', requiredFields: ['producerReceipts', 'topology', 'status', 'overlap'], identityFields: ['producerReceipts'], revisionFields: ['implementationTip', 'recordTip'], validatorCommand: 'npm run test:phase1-handoff', mode: 'admission' },
  },
});

const REQUIRED_PHASE_IDS = Object.freeze(['M1', 'M2', 'M3', 'M4', '1D']);

const AUTHORITY_RECEIPT_POLICY = Object.freeze({
  review: Object.freeze({ schema: 'engagement-phase1-independent-review/v1' }),
  deletion: Object.freeze({ schema: 'engagement-phase1-independent-deletion/v1' }),
});

function collectionReasons(policy, observation) {
  const reasons = [];
  const requireExactlyOnce = (entries, key, label) => {
    const values = Array.isArray(entries) ? entries.map((entry) => entry?.[key]) : [];
    for (const id of REQUIRED_PHASE_IDS) if (values.filter((value) => value === id).length !== 1) reasons.push(`${label} ${id} is missing or duplicated`);
    for (const value of values) if (!REQUIRED_PHASE_IDS.includes(value)) reasons.push(`${label} has unknown id ${String(value)}`);
  };
  requireExactlyOnce(policy?.phases, 'id', 'policy phase');
  requireExactlyOnce(observation?.phases, 'phase', 'observation phase');
  if (!Array.isArray(policy?.edges)) reasons.push('policy edges are not an array');
  else {
    const seen = new Set();
    for (const edge of policy.edges) {
      if (!Array.isArray(edge) || edge.length !== 2 || !REQUIRED_PHASE_IDS.includes(edge[0]) || !REQUIRED_PHASE_IDS.includes(edge[1])) reasons.push(`invalid policy edge ${JSON.stringify(edge)}`);
      else {
        const identity = `${edge[0]}->${edge[1]}`;
        if (seen.has(identity)) reasons.push(`duplicate policy edge ${identity}`);
        seen.add(identity);
      }
    }
  }
  return reasons;
}

function blockedStructureResult(reasons) {
  const phases = Object.fromEntries(REQUIRED_PHASE_IDS.map((id) => [id, {
    status: 'blocked', reasons: [...reasons], decisions: { preparationEligible: false, consumptionEligible: false, admissionEligible: false, deletionEligible: false },
  }]));
  return { status: 'blocked', reasons, phases, decisions: { preparationEligible: false, consumptionEligible: false, admissionEligible: false, deletionEligible: false } };
}

function sameList(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactPolicyReasons(policy) {
  const reasons = [];
  for (const [id, expected] of Object.entries(EXACT_PHASE_POLICY)) {
    const actual = policy.phases.find((phase) => phase.id === id);
    if (!actual) { reasons.push(`missing exact policy phase ${id}`); continue; }
    if (actual.owner !== expected.owner) reasons.push(`${id}: policy owner drift`);
    if (!sameList(actual.writable, expected.writable)) reasons.push(`${id}: policy writable boundary drift`);
    if (!sameList(actual.forbidden, expected.forbidden)) reasons.push(`${id}: policy forbidden boundary drift`);
    if (!sameList(actual.ignoredOutputRoots, expected.ignoredOutputRoots)) reasons.push(`${id}: policy ignored-output boundary drift`);
    if (!sameList(actual.ports, expected.ports)) reasons.push(`${id}: policy port boundary drift`);
    if (!sameList(actual.upstreamReceiptBindings, expected.upstreamReceiptBindings)) reasons.push(`${id}: policy upstream binding drift`);
    if (!sameList(actual.governancePrerequisites || [], expected.governancePrerequisites || [])) reasons.push(`${id}: policy governance prerequisite drift`);
    for (const [field, value] of Object.entries(expected.retention)) {
      if (Array.isArray(value)
        ? !sameList(actual.retention?.[field], value)
        : actual.retention?.[field] !== value) reasons.push(`${id}: policy retention ${field} drift`);
    }
    if (expected.receipt) for (const [field, value] of Object.entries(expected.receipt)) {
      if (field === 'mode' && id !== 'M4') continue;
      if (Array.isArray(value)
        ? !sameList(actual.receipt?.[field], value)
        : actual.receipt?.[field] !== value) reasons.push(`${id}: policy receipt ${field} drift`);
    }
  }
  for (const [kind, expected] of Object.entries(AUTHORITY_RECEIPT_POLICY)) {
    if (policy.authorityReceipts?.[kind]?.schema !== expected.schema) reasons.push(`${kind} authority receipt policy drift`);
  }
  if (!sameList(policy.phase1_0_writable, PHASE1_0_WRITABLE)) reasons.push('Phase1-0 writable scope drift');
  return reasons;
}

export async function inspectGitRevision(worktree, reference, phaseBase) {
  const run = async (...args) => (await execFileAsync('git', ['-C', worktree, ...args], { windowsHide: true })).stdout.trim();
  const tip = await run('rev-parse', reference);
  const mergeBase = await run('merge-base', 'main', tip);
  const base = await run('rev-parse', phaseBase || mergeBase);
  const changed = await run('diff', '--name-only', `${base}..${tip}`);
  return { tip, mergeBase, phaseBase: base, changedPaths: changed ? changed.split(/\r?\n/) : [] };
}

export async function isGitAncestor(worktree, ancestor, descendant) {
  try {
    await execFileAsync('git', ['-C', worktree, 'merge-base', '--is-ancestor', ancestor, descendant], { windowsHide: true });
    return true;
  } catch { return false; }
}

export async function changedPathsBetween(worktree, ancestor, descendant) {
  const { stdout } = await execFileAsync('git', ['-C', worktree, 'diff', '--name-only', `${ancestor}..${descendant}`], { windowsHide: true });
  return stdout.trim() ? stdout.trim().split(/\r?\n/) : [];
}

export function pathMatches(pattern, pathname) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '::DOUBLE_STAR::').replaceAll('*', '[^/]*')
    .replaceAll('::DOUBLE_STAR::', '.*');
  return new RegExp(`^${escaped}$`).test(pathname.replaceAll('\\', '/'));
}

export function patternsOverlap(left, right) {
  return left.some((a) => right.some((b) => patternCouldOverlap(a, b)));
}

function patternCouldOverlap(a, b) {
  if (a === b || pathMatches(a, b) || pathMatches(b, a)) return true;
  const aPrefix = a.split('*')[0];
  const bPrefix = b.split('*')[0];
  return aPrefix.startsWith(bPrefix) || bPrefix.startsWith(aPrefix);
}

export async function evaluateHandoff({
  policy,
  observation,
  inspectWorktree = inspectGitWorktree,
  inspectRevision = inspectGitRevision,
  isAncestor = isGitAncestor,
  changedBetween = changedPathsBetween,
  readReceipt = readJson,
  filesystemAuthority = realFilesystemAuthority,
  authorityReader = { async read(pathname) { return readJson(pathname); } },
  resolveRef = resolveGitRef,
} = {}) {
  const structuralReasons = collectionReasons(policy, observation);
  // Do not construct Maps or enter decision logic until canonical identifiers
  // are proven unique. Map would otherwise silently retain the last duplicate.
  if (structuralReasons.length) return blockedStructureResult(structuralReasons);
  const reasons = [];
  const policyReasons = [];
  if (policy.schema !== 'engagement-phase1-handoff-policy/v2') policyReasons.push('policy schema drift');
  if (observation.schema !== 'engagement-phase1-handoff-observation/v1') policyReasons.push('observation schema drift');
  if (observation.policySchema !== policy.schema) policyReasons.push('observation policy binding drift');
  policyReasons.push(...exactPolicyReasons(policy));
  reasons.push(...policyReasons);
  const policyEligible = policyReasons.length === 0;
  const policies = new Map(policy.phases.map((phase) => [phase.id, phase]));
  const topology = topologicalOrder(policy.edges, [...policies.keys()]);
  const observations = new Map(observation.phases.map((phase) => [phase.phase, phase]));
  const phaseResults = {};
  const phaseMeta = new Map();

  for (const [phaseId, phasePolicy] of policies) {
    const phase = observations.get(phaseId);
    const phaseReasons = [];
    let receiptEligible = false;
    if (!phase) phaseReasons.push('missing observation');
    else {
      for (const key of ['producerTask', 'owner', 'worktree', 'evidenceRoot', 'exactTip', 'expectedBase', 'actualMergeBase', 'phaseBase', 'ancestorResult', 'status', 'actualChangedPaths', 'artifactOwner', 'ignoredRoot', 'retention', 'implementationTip', 'recordTip', 'state']) {
        if (phase[key] == null) phaseReasons.push(`missing ${key}`);
      }
      if (phase.ancestorResult !== true) phaseReasons.push('ancestor result is not true');
      if (phase.actualMergeBase !== phase.expectedBase) phaseReasons.push('recorded merge-base diverges from expected base');
      if (phase.owner !== phasePolicy.owner) phaseReasons.push('owner drift');
      if (phase.artifactOwner !== phasePolicy.owner) phaseReasons.push('artifact owner drift');
      if (!phasePolicy.ignoredOutputRoots.includes(phase.ignoredRoot)) phaseReasons.push('ignored root drift');
      if (!evidenceRootWithin(phase.worktree, phase.evidenceRoot, phasePolicy.ignoredOutputRoots)) phaseReasons.push('evidence root exceeds ignored-output boundary');
      if (!phase.retention?.duration || !phase.retention?.triggerEvent || !phase.retention?.decisionOwner
          || !Array.isArray(phase.retention?.deletePrerequisites)) phaseReasons.push('retention policy incomplete');
      for (const field of ['duration', 'triggerEvent', 'decisionOwner']) {
        if (phase.retention?.[field] !== phasePolicy.retention[field]) phaseReasons.push(`retention ${field} drift`);
      }
      if (!sameList(phase.retention?.deletePrerequisites, phasePolicy.retention.deletePrerequisites)) phaseReasons.push('retention delete-prerequisites drift');
      if (phase.retention?.authorizationReceipt != null) phaseReasons.push('embedded retention authorization is not an independent authority receipt');
      if (phase.actualChangedPaths.some((pathname) => !phasePolicy.writable.some((pattern) => pathMatches(pattern, pathname)))) phaseReasons.push('actual changed path exceeds writable boundary');
      try {
        const actual = await inspectWorktree(phase.worktree);
        if (actual.main !== phase.expectedBase) phaseReasons.push('main topology drift');
        if (JSON.stringify(actual.status) !== JSON.stringify(phase.status.porcelain || [])) phaseReasons.push('worktree status drift');
        const implementation = await inspectRevision(phase.worktree, phase.implementationTip, phase.phaseBase);
        if (implementation.tip !== phase.exactTip || implementation.mergeBase !== phase.actualMergeBase || implementation.phaseBase !== phase.phaseBase) phaseReasons.push('implementation topology drift');
        if (!await isAncestor(phase.worktree, phase.phaseBase, phase.exactTip)) phaseReasons.push('phase base is not an ancestor of exact tip');
        if (!await isAncestor(phase.worktree, phase.expectedBase, phase.exactTip)) phaseReasons.push('exact tip is not a descendant of expected base');
        if (JSON.stringify(implementation.changedPaths) !== JSON.stringify(phase.actualChangedPaths)) phaseReasons.push('implementation changed-path drift');
        if (actual.head !== phase.implementationTip) {
          if (!await isAncestor(phase.worktree, phase.implementationTip, actual.head)) phaseReasons.push('execution head is not an implementation descendant');
          else {
            const recordDelta = await changedBetween(phase.worktree, phase.implementationTip, actual.head);
            if (recordDelta.some((pathname) => !RECORD_ONLY_PATHS.includes(pathname))) phaseReasons.push('execution record delta is not record-only');
          }
        }
        if (phase.recordTip != null && actual.head !== phase.recordTip) {
          if (!await isAncestor(phase.worktree, phase.recordTip, actual.head)) phaseReasons.push('record tip is not an execution ancestor');
          else {
            const afterRecord = await changedBetween(phase.worktree, phase.recordTip, actual.head);
            if (afterRecord.some((pathname) => !RECORD_ONLY_PATHS.includes(pathname))) phaseReasons.push('execution delta after record tip is not record-only');
          }
        }
      } catch { phaseReasons.push('tip/worktree is not resolvable'); }
      if (phase.implementationTip !== phase.exactTip) phaseReasons.push('implementation tip is not the observed exact tip');
      for (const key of ['exactTip', 'implementationTip', 'recordTip']) {
        if (phase[key] == null) continue;
        try { await resolveRef(phase.worktree, phase[key]); }
        catch { phaseReasons.push(`${key} is not resolvable`); }
      }
      if (phase.receipt?.availability === 'available') {
        try {
          if (phase.receipt.schema !== phasePolicy.receipt.schema) throw new Error('observation schema drift');
          if (phase.receipt.validatorCommand !== phasePolicy.receipt.validatorCommand) throw new Error('validator command drift');
          if (phase.receipt.result !== 'pass') throw new Error('receipt result is not pass');
          const canonicalReceiptPath = await filesystemAuthority.receiptPath(phase.worktree, phase.evidenceRoot, phase.receipt.actualPath);
          const receiptEvidence = validateReceipt(phaseId, EXACT_PHASE_POLICY[phaseId], await readReceipt(canonicalReceiptPath), phase.receipt);
          phaseMeta.set(phaseId, { receiptEvidence });
          receiptEligible = canonicalReceiptMode(phaseId) === 'admission';
          if (!receiptEligible) phaseReasons.push('preparation-only receipt cannot be consumed');
        }
        catch (error) { phaseReasons.push(`receipt invalid: ${error.message}`); }
      } else {
        phaseReasons.push('receipt unavailable');
      }
      validateUpstreamReceiptIdentities(phase, phasePolicy, observations, phaseReasons);
      if (phaseId === 'M4') {
        const m2 = observations.get('M2');
        const declaration = (phase.governanceReceiptIdentities || []).filter((entry) => entry?.phase === 'M2');
        if (declaration.length !== 1 || !m2 || m2.state !== 'accepted' || m2.receipt?.availability !== 'available') phaseReasons.push('M2 governance receipt is unavailable or unrechecked');
        else {
          const identity = { ...declaration[0] }; delete identity.phase;
          if (!sameRecord(identity, m2.receipt.identity)) phaseReasons.push('M2 governance receipt identity drift');
          try {
            const m2Tip = m2.reviewedTip || m2.exactTip;
            if (!await isAncestor(phase.worktree, m2Tip, phase.phaseBase)
              || !await isAncestor(phase.worktree, m2Tip, phase.implementationTip)) phaseReasons.push('M2 governance tip is not an ancestor of M4 base and implementation');
          } catch { phaseReasons.push('M2 governance ancestry is not resolvable'); }
        }
      }
      if (phase.state === 'accepted' && !phase.reviewedTip) phaseReasons.push('accepted observation has no reviewed tip');
      if (phase.state === 'accepted' && !phase.recordTip) phaseReasons.push('accepted observation has no record tip');
      if (phase.state === 'accepted' && phase.recordTip !== phase.reviewedTip) phaseReasons.push('accepted record/review tip drift');
      if (phase.reviewedTip != null) {
        try { await resolveRef(phase.worktree, phase.reviewedTip); }
        catch { phaseReasons.push('reviewedTip is not resolvable'); }
      }
      if (phase.state === 'accepted') {
        try {
          await validateReviewAuthority({ phase, phaseId, filesystemAuthority, authorityReader });
        } catch (error) { phaseReasons.push(`independent review authority invalid: ${error.message}`); }
      }
      if (phase.state !== 'accepted') phaseReasons.push(`admission state is ${phase.state}`);
    }
    phaseMeta.set(phaseId, {
      ...phaseMeta.get(phaseId),
      phase,
      phasePolicy,
      phaseReasons,
      receiptEligible,
      preparationEligible: isPreparationEligible(phase, phasePolicy, policyEligible),
    });
  }

  // A declared data edge is also a source-control edge: the upstream reviewed
  // (or exact, while review is pending) tip must precede both the target's
  // declared phase base and its implementation.  This does not infer an
  // M2->M4 product edge; M2 is handled separately above as governance.
  for (const [source, target] of policy.edges) {
    const upstream = observations.get(source);
    const downstream = observations.get(target);
    const targetMeta = phaseMeta.get(target);
    if (!upstream || !downstream || !targetMeta) continue;
    try {
      const upstreamTip = upstream.reviewedTip || upstream.exactTip;
      if (!await isAncestor(downstream.worktree, upstreamTip, downstream.phaseBase)
        || !await isAncestor(downstream.worktree, upstreamTip, downstream.implementationTip)) targetMeta.phaseReasons.push(`${source} topology tip is not an ancestor of ${target} base and implementation`);
    } catch { targetMeta.phaseReasons.push(`${source} to ${target} topology ancestry is not resolvable`); }
  }

  // M4's typed M1 binding is stronger than an observation declaration: the
  // actual M4 handoff receipt must carry the warehouse identity that the M1
  // producer actually emitted, and validateReceipt already requires the same
  // M4 value at its top level and in lineage.
  const m1 = observations.get('M1');
  const m4Meta = phaseMeta.get('M4');
  if (m4Meta?.receiptEvidence && m1?.receipt?.availability === 'available') {
    if (m4Meta.receiptEvidence.identity.warehouseIdentity !== m1.receipt.identity?.current_snapshot_id) {
      m4Meta.phaseReasons.push('M1/M4 warehouse identity cross-binding drift');
    }
  }

  for (const phaseId of topology) {
    const phasePolicy = policies.get(phaseId);
    const meta = phaseMeta.get(phasePolicy.id);
    const upstream = phasePolicy.upstreamReceiptBindings.map((id) => phaseResults[id]);
    const consumptionEligible = meta.receiptEligible && upstream.every((result) => result?.decisions.consumptionEligible);
    const admissionEligible = meta.phaseReasons.length === 0 && upstream.every((result) => result?.decisions.admissionEligible);
    phaseResults[phasePolicy.id] = {
      status: admissionEligible ? 'accepted' : 'blocked',
      reasons: meta.phaseReasons,
      decisions: {
        preparationEligible: meta.preparationEligible,
        consumptionEligible,
        admissionEligible,
        deletionEligible: false,
      },
    };
    reasons.push(...meta.phaseReasons.map((reason) => `${phasePolicy.id}: ${reason}`));
  }
  const finalAdmissionEligible = phaseResults['1D']?.decisions.admissionEligible === true;
  for (const phasePolicy of policy.phases) {
    const phase = observations.get(phasePolicy.id);
    phaseResults[phasePolicy.id].decisions.deletionEligible = finalAdmissionEligible
      && phaseResults[phasePolicy.id].decisions.admissionEligible
      && await validateDeletionAuthority({
        phase,
        phasePolicy,
        oneD: observations.get('1D'),
        oneDResult: phaseResults['1D'],
        filesystemAuthority,
        authorityReader,
      });
  }

  for (const [source, target] of policy.edges) {
    if (!policies.has(source) || !policies.has(target)) reasons.push(`undefined DAG endpoint ${source}->${target}`);
    else if (!policies.get(target).upstreamReceiptBindings.includes(source)) reasons.push(`edge/binding drift ${source}->${target}`);
  }
  for (const phase of policy.phases) {
    for (const upstream of phase.upstreamReceiptBindings) {
      if (!policies.has(upstream)) reasons.push(`${phase.id}: undefined upstream ${upstream}`);
    }
  }
  if (hasCycle(policy.edges)) reasons.push('DAG cycle');
  for (let i = 0; i < policy.phases.length; i += 1) for (const later of policy.phases.slice(i + 1)) {
    if (patternsOverlap(policy.phases[i].writable, later.writable)) reasons.push(`writable overlap ${policy.phases[i].id}/${later.id}`);
    // A later writer being named in an earlier phase's forbidden list is the
    // intended ownership fence, not a collision. Actual collisions are two
    // writable patterns (or a writer reaching its own ignored output root).
    if (patternsOverlap(policy.phases[i].writable, policy.phases[i].ignoredOutputRoots)) reasons.push(`writer/output overlap ${policy.phases[i].id}`);
  }
  const cumulativePaths = observation.phases.flatMap((phase) => phase.actualChangedPaths || []);
  const policyWritable = policy.phases.flatMap((phase) => phase.writable);
  if (cumulativePaths.some((pathname) => !policyWritable.some((pattern) => pathMatches(pattern, pathname))
    && !PHASE1_0_WRITABLE.includes(pathname))) reasons.push('cumulative changed path exceeds phase writable union');
  const globallyBlocked = reasons.length > 0 || Object.values(phaseResults).some((phase) => phase.status === 'blocked');
  if (globallyBlocked) {
    for (const phase of Object.values(phaseResults)) {
      phase.status = 'blocked';
      phase.decisions.admissionEligible = false;
      phase.decisions.deletionEligible = false;
    }
  }
  return {
    status: reasons.length ? 'blocked' : 'accepted',
    reasons,
    phases: phaseResults,
    decisions: {
      preparationEligible: policy.phases.every((phase) => phaseResults[phase.id].decisions.preparationEligible),
      consumptionEligible: phaseResults['1D']?.decisions.consumptionEligible === true,
      admissionEligible: !globallyBlocked && finalAdmissionEligible,
      deletionEligible: !globallyBlocked && policy.phases.every((phase) => phaseResults[phase.id].decisions.deletionEligible),
    },
  };
}

export function validateReceipt(phaseId, policy, receipt, observationReceipt = {}) {
  const canonical = EXACT_PHASE_POLICY[phaseId] || policy;
  if (canonical.receipt.schema && receipt.schema !== canonical.receipt.schema) throw new Error('schema drift');
  for (const field of canonical.receipt.requiredFields) if (readPath(receipt, field) == null) throw new Error(`missing ${field}`);
  const identity = Object.fromEntries(canonical.receipt.identityFields.map((field) => [field, readPath(receipt, field)]));
  const revision = Object.fromEntries(canonical.receipt.revisionFields.map((field) => [field, readPath(receipt, field)]));
  if (JSON.stringify(identity) !== JSON.stringify(observationReceipt.identity)) throw new Error('identity drift');
  if (JSON.stringify(revision) !== JSON.stringify(observationReceipt.revision)) throw new Error('revision drift');
  for (const field of canonical.receipt.dataQualityFields || []) {
    if (readPath(receipt, field) !== true) throw new Error(`data-quality drift ${field}`);
  }
  for (const field of canonical.receipt.lineageFields || []) {
    if (typeof readPath(receipt, field) !== 'string' || !readPath(receipt, field)) throw new Error(`lineage drift ${field}`);
  }
  for (const field of canonical.receipt.consentFields || []) {
    if (readPath(receipt, field) !== true) throw new Error(`consent drift ${field}`);
  }
  for (const field of canonical.receipt.clockFields || []) {
    if (!isExactTimestamp(readPath(receipt, field))) throw new Error(`clock drift ${field}`);
  }
  if (phaseId === 'M4') {
    const clocks = canonical.receipt.clockFields.map((field) => Date.parse(readPath(receipt, field)));
    if (clocks.some((value, index) => index && value < clocks[index - 1])) throw new Error('M4 clocks are out of order');
    if (!Number.isInteger(receipt.completedPartitions) || !Number.isInteger(receipt.partitionCount)
      || receipt.completedPartitions < 0 || receipt.completedPartitions !== receipt.partitionCount) throw new Error('M4 partition completion drift');
    if (!receipt.completion || typeof receipt.accumulator !== 'object') throw new Error('M4 completion or accumulator drift');
    if (receipt.warehouseIdentity !== receipt.lineage?.warehouseIdentity
      || receipt.routeIdentity !== receipt.lineage?.routeIdentity
      || receipt.catalogIdentity !== receipt.lineage?.catalogIdentity) throw new Error('M4 lineage identity drift');
  }
  if (phaseId === '1D') {
    if (!Array.isArray(receipt.producerReceipts) || receipt.producerReceipts.length !== 4
      || new Set(receipt.producerReceipts.map((entry) => entry?.phase)).size !== 4
      || !REQUIRED_PHASE_IDS.slice(0, 4).every((id) => receipt.producerReceipts.some((entry) => entry?.phase === id && entry.identity && entry.revision))) throw new Error('1D producer receipt binding drift');
    if (!Array.isArray(receipt.topology) || !Array.isArray(receipt.overlap) || typeof receipt.status !== 'object') throw new Error('1D cumulative receipt semantics drift');
  }
  return { phaseId, identity, revision };
}

function readPath(value, dotted) {
  return dotted.split('.').reduce((current, key) => current?.[key], value);
}

function isPreparationEligible(phase, policy, policyEligible) {
  return Boolean(policyEligible
    && phase
    && phase.owner === policy.owner
    && phase.artifactOwner === policy.owner
    && policy.ignoredOutputRoots.includes(phase.ignoredRoot)
    && evidenceRootWithin(phase.worktree, phase.evidenceRoot, policy.ignoredOutputRoots)
    && phase.retention?.duration === policy.retention.duration
    && phase.retention?.triggerEvent === policy.retention.triggerEvent
    && phase.retention?.decisionOwner === policy.retention.decisionOwner
    && sameList(phase.retention?.deletePrerequisites, policy.retention.deletePrerequisites)
    && Array.isArray(phase.actualChangedPaths)
    && phase.actualChangedPaths.every((pathname) => policy.writable.some((pattern) => pathMatches(pattern, pathname))));
}

function evidenceRootWithin(worktree, evidenceRoot, patterns) {
  const base = `${String(worktree || '').replaceAll('\\', '/').replace(/\/$/, '')}/`;
  const candidate = String(evidenceRoot || '').replaceAll('\\', '/');
  if (!candidate.startsWith(base)) return false;
  const relative = candidate.slice(base.length);
  return patterns.some((pattern) => pathMatches(pattern, relative) || pathMatches(pattern, `${relative}/`));
}

function validateUpstreamReceiptIdentities(phase, policy, observations, reasons) {
  const declarations = Array.isArray(phase.upstreamReceiptIdentities) ? phase.upstreamReceiptIdentities : [];
  for (const upstream of policy.upstreamReceiptBindings) {
    const matching = declarations.filter((entry) => entry?.phase === upstream);
    if (matching.length !== 1) { reasons.push(`upstream receipt identity missing or duplicated for ${upstream}`); continue; }
    const declared = { ...matching[0] }; delete declared.phase;
    const producer = observations.get(upstream);
    const actual = producer?.receipt?.availability === 'available' ? producer.receipt.identity : null;
    if (!Object.keys(declared).length || !actual || !sameRecord(declared, actual)) reasons.push(`upstream receipt identity drift for ${upstream}`);
  }
}

function sameRecord(left, right) {
  const leftKeys = Object.keys(left || {}).sort();
  const rightKeys = Object.keys(right || {}).sort();
  return sameList(leftKeys, rightKeys) && leftKeys.every((key) => left[key] === right[key]);
}

async function readAuthorityReceipt(reference, phase, filesystemAuthority, authorityReader, kind) {
  if (!reference || typeof reference !== 'object' || typeof reference.path !== 'string'
    || typeof reference.schema !== 'string' || !reference.expectedIdentity
    || !reference.expectedIssuer) throw new Error(`${kind} authority reference is incomplete`);
  const receiptPath = await filesystemAuthority.receiptPath(phase.worktree, phase.evidenceRoot, reference.path);
  const receipt = await authorityReader.read(receiptPath);
  if (!receipt || typeof receipt !== 'object') throw new Error(`${kind} authority receipt is not an object`);
  if (receipt.schema !== reference.schema || receipt.schema !== AUTHORITY_RECEIPT_POLICY[kind].schema) throw new Error(`${kind} authority schema drift`);
  if (!sameRecord(receipt.identity, reference.expectedIdentity)) throw new Error(`${kind} authority identity drift`);
  const issuer = receipt.reviewer || receipt.issuer;
  if (!sameRecord(issuer, reference.expectedIssuer)) throw new Error(`${kind} authority issuer drift`);
  return receipt;
}

function isIndependentIssuer(issuer, phase) {
  return Boolean(issuer
    && typeof issuer.taskId === 'string' && issuer.taskId
    && typeof issuer.identity === 'string' && issuer.identity
    && issuer.taskId !== phase.producerTask
    && issuer.taskId !== phase.owner
    && issuer.taskId !== '1D integration/release owner'
    && issuer.identity !== phase.producerTask
    && issuer.identity !== phase.owner
    && issuer.identity !== '1D integration/release owner');
}

async function validateReviewAuthority({ phase, phaseId, filesystemAuthority, authorityReader }) {
  const receipt = await readAuthorityReceipt(phase.reviewAuthority, phase, filesystemAuthority, authorityReader, 'review');
  if (!isIndependentIssuer(receipt.reviewer, phase)) throw new Error('review authority is not independent');
  if (receipt.phase !== phaseId || receipt.verdict !== 'approve') throw new Error('review verdict or phase drift');
  if (receipt.candidate?.implementationTip !== phase.implementationTip
    || receipt.candidate?.executionRecordTip !== phase.recordTip
    || receipt.candidate?.cumulativeTip !== phase.reviewedTip) throw new Error('review candidate tip binding drift');
}

async function validateDeletionAuthority({ phase, phasePolicy, oneD, oneDResult, filesystemAuthority, authorityReader }) {
  if (!phase || !oneD || oneDResult?.decisions?.admissionEligible !== true || oneD.state !== 'accepted') return false;
  try {
    const receipt = await readAuthorityReceipt(phase.deletionAuthority, phase, filesystemAuthority, authorityReader, 'deletion');
    if (!isIndependentIssuer(receipt.issuer, phase)) return false;
    if (receipt.decision?.taskId === phase.producerTask || receipt.decision?.taskId === phase.owner
      || receipt.decision?.taskId === '1D integration/release owner') return false;
    if (receipt.decision?.taskId !== receipt.issuer.taskId
      || receipt.decision?.identity !== receipt.issuer.identity
      || receipt.decision?.decidedAt !== receipt.decidedAt) return false;
    if (receipt.accepted1D?.cumulativeTip !== oneD.reviewedTip
      || !sameRecord(receipt.accepted1D?.receiptIdentity, oneD.receipt?.identity)) return false;
    return receipt.target?.phase === phase.phase
      && receipt.target?.ignoredRoot === phase.ignoredRoot
      && sameList(receipt.prerequisites, phasePolicy.retention.deletePrerequisites)
      && isExactTimestamp(receipt.decidedAt)
      && isExactTimestamp(receipt.decision?.decidedAt);
  } catch { return false; }
}

function canonicalReceiptMode(phaseId) {
  return EXACT_PHASE_POLICY[phaseId].receipt.mode;
}

function isExactTimestamp(value) {
  return typeof value === 'string'
    && !Number.isNaN(new Date(value).getTime())
    && new Date(value).toISOString() === value;
}

function hasCycle(edges) {
  const nodes = new Set(edges.flat()); const visiting = new Set(); const seen = new Set();
  const visit = (node) => { if (visiting.has(node)) return true; if (seen.has(node)) return false; visiting.add(node); const cycle = edges.filter(([from]) => from === node).some(([, to]) => visit(to)); visiting.delete(node); seen.add(node); return cycle; };
  return [...nodes].some(visit);
}

function topologicalOrder(edges, ids) {
  const indegree = new Map(ids.map((id) => [id, 0]));
  const next = new Map(ids.map((id) => [id, []]));
  for (const [from, to] of edges) if (indegree.has(from) && indegree.has(to)) {
    indegree.set(to, indegree.get(to) + 1); next.get(from).push(to);
  }
  const ready = ids.filter((id) => indegree.get(id) === 0).sort(); const order = [];
  while (ready.length) { const id = ready.shift(); order.push(id); for (const to of next.get(id)) { indegree.set(to, indegree.get(to) - 1); if (indegree.get(to) === 0) ready.push(to); } ready.sort(); }
  return order.length === ids.length ? order : ids;
}
