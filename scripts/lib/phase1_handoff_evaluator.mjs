import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { validateModelEvaluationReport } from './area_intelligence_evaluation.mjs';
import { validateHomeCompareSourceObservation } from './home_compare_source_smoke.mjs';

const execFileAsync = promisify(execFile);

export async function readJson(pathname) {
  return JSON.parse(await readFile(pathname, 'utf8'));
}

export async function readJsonBytes(pathname) {
  const bytes = await readFile(pathname);
  return Object.freeze({ value: JSON.parse(bytes.toString('utf8')), bytes, rawDigest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` });
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
  return path.posix;
}

function contained(flavor, root, candidate, { allowEqual = false } = {}) {
  const relative = flavor.relative(root, candidate);
  return (allowEqual || relative !== '') && !flavor.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${flavor.sep}`);
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

function rejectUnsafeSegments(value, separator) {
  const withoutDrive = value.replace(/^[A-Za-z]:[\\/]/, '').replace(/^[\\/]/, '');
  const segments = withoutDrive.split(separator);
  if (segments.some((segment) => segment === '.' || segment === '..' || segment === '')) {
    throw new Error('authority path contains an ambiguous segment');
  }
}

function ignoredRootLiteral(ignoredRoot) {
  if (typeof ignoredRoot !== 'string' || !ignoredRoot.endsWith('/**')) throw new Error('ignored root is not an exact literal subtree');
  const literal = ignoredRoot.slice(0, -3);
  if (!literal || literal.startsWith('/') || literal.startsWith('\\') || literal.includes('\\') || literal.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('ignored root is unsafe');
  }
  return literal;
}

export function createFilesystemAuthority({
  platform = process.platform,
  canonicalize = realpath,
  stat = lstat,
} = {}) {
  return Object.freeze({
    async receiptPath(worktree, evidenceRoot, receiptPath, { ignoredRoot, defaultPath } = {}) {
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
      rejectUnsafeSegments(worktree, separator);
      rejectUnsafeSegments(evidenceRoot, separator);
      rejectUnsafeSegments(receiptPath, separator);
      if (!lexicalWithin(worktree, evidenceRoot, separator) || !lexicalWithin(evidenceRoot, receiptPath, separator)) {
        throw new Error('receipt lexical path escapes worktree or evidence root');
      }
      const root = flavor.resolve(worktree);
      const evidence = flavor.resolve(evidenceRoot);
      const receipt = flavor.resolve(receiptPath);
      const allowed = ignoredRoot ? flavor.resolve(root, ignoredRootLiteral(ignoredRoot)) : root;
      if (!contained(flavor, root, evidence) || !contained(flavor, allowed, evidence, { allowEqual: true }) || !contained(flavor, evidence, receipt)) throw new Error('receipt path escapes exact ignored root');
      if (defaultPath && receipt !== flavor.resolve(root, defaultPath)) throw new Error('receipt path is not the canonical policy receipt');
      // A final realpath check alone is insufficient: an inner junction can
      // point back inside the same root and still make later replacement
      // semantics ambiguous. Every existing ancestor must itself be direct.
      const ancestors = [];
      for (let cursor = receipt; ; cursor = flavor.dirname(cursor)) {
        ancestors.push(cursor);
        if (cursor === root) break;
        if (cursor === flavor.dirname(cursor)) throw new Error('receipt path cannot reach worktree root');
      }
      const ancestorStats = await Promise.all(ancestors.map((entry) => stat(entry)));
      if (ancestorStats.some((entry) => entry.isSymbolicLink?.())) throw new Error('receipt ancestor is a symlink or reparse point');
      const [canonicalRoot, canonicalAllowed, canonicalEvidence, canonicalReceipt, receiptStat] = await Promise.all([
        canonicalize(root), canonicalize(allowed), canonicalize(evidence), canonicalize(receipt), stat(receipt),
      ]);
      if (!receiptStat.isFile() || receiptStat.isSymbolicLink()) throw new Error('receipt is not a regular file');
      const canonicalFlavor = pathFlavor(canonicalRoot, platform);
      if (canonicalFlavor !== pathFlavor(canonicalEvidence, platform) || canonicalFlavor !== pathFlavor(canonicalReceipt, platform)
          || !contained(canonicalFlavor, canonicalRoot, canonicalAllowed, { allowEqual: true })
          || !contained(canonicalFlavor, canonicalAllowed, canonicalEvidence, { allowEqual: true })
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
    receipt: { schema: 'engagement-phl-crime-event-warehouse/v1', defaultPath: '.dfev1/crime/warehouse/manifest.json', requiredFields: ['current_snapshot_id', 'coverage', 'lineage_registry', 'latest_quality_report', 'latest_revision_report', 'updated_at'], identityFields: ['current_snapshot_id'], revisionFields: ['updated_at', 'latest_revision_report'], validatorCommand: 'npm run test:phase1-handoff', mode: 'admission' },
  },
  M2: {
    owner: 'M2 mart/evaluation task',
    writable: ['scripts/build_area_intelligence_marts.mjs', 'scripts/evaluate_area_intelligence.mjs', 'scripts/lib/area_intelligence_*.mjs', 'scripts/tests/area_intelligence_m2.mjs'],
    forbidden: ['package.json', 'public/data/**', 'src/home_compare/**', 'src/routes_crime/known_route_*.js'],
    ignoredOutputRoots: ['.dfev1/area-intelligence/**'],
    ports: [4198],
    upstreamReceiptBindings: ['M1'],
    retention: { duration: 'P180D', triggerEvent: 'independently-reviewed-1D-acceptance', decisionOwner: '1D integration/release owner', deletePrerequisites: ['M1 receipt recheck', 'M2 receipt recheck', '1D cumulative receipt recheck'], authorizationReceipt: '1D cumulative retention authorization' },
    receipt: { schema: 'ModelEvaluationReport/v1', defaultPath: '.dfev1/area-intelligence/m2-baseline/evaluation/model-evaluation-report.json', requiredFields: ['generated_at', 'protocol.schema', 'data.mart_artifact_identity', 'data.source_vintage', 'data.coverage', 'evaluation'], identityFields: ['data.mart_artifact_identity', 'data.source_vintage'], revisionFields: ['generated_at', 'protocol.sha256'], validatorCommand: 'npm run test:phase1-handoff', mode: 'admission' },
  },
  M3: {
    owner: 'M3 Home Compare task',
    writable: ['src/home_compare/**', 'scripts/smoke_home_compare_sources.mjs', 'scripts/lib/home_compare_source_smoke.mjs', 'scripts/tests/home_compare_m3.mjs', 'scripts/tests/home_compare_browser.mjs'],
    forbidden: ['package.json', 'public/data/**', 'src/routes_crime/known_route_*.js'],
    ignoredOutputRoots: ['.dfev1/home-neighborhood-compare/m3-v1/**'],
    ports: [4189],
    upstreamReceiptBindings: ['M2'],
    retention: { duration: 'P30D', triggerEvent: 'independently-reviewed-1D-acceptance', decisionOwner: '1D integration/release owner', deletePrerequisites: ['M3 receipt recheck', 'desktop-en-synthetic.png retained', 'mobile-en-synthetic.png retained', '1D cumulative receipt recheck'], authorizationReceipt: '1D cumulative retention authorization' },
    receipt: { schema: 'engagement-home-compare-source-smoke/v1', defaultPath: '.dfev1/home-neighborhood-compare/m3-v1/official-smoke/manifest.json', requiredFields: ['generatedAt', 'status', 'semanticIdentity', 'observations', 'routing', 'privacy', 'limitations'], identityFields: ['semanticIdentity'], revisionFields: ['generatedAt', 'observations.0.revision', 'observations.0.dq'], validatorCommand: 'npm run test:phase1-handoff', mode: 'admission' },
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
      schema: 'engagement-known-route-evidence-handoff/v2', defaultPath: '.dfev1/known-route-evidence-v1/full-warehouse/final-handoff.json',
      requiredFields: ['warehouseIdentity', 'routeIdentity', 'centerlineDataVersion', 'catalogIdentity', 'corridorIdentity', 'completedPartitions', 'partitionCount', 'startedAt', 'completion', 'accumulator', 'dataQuality.partitionCompletion', 'dataQuality.accumulatorValidated', 'lineage.warehouseIdentity', 'lineage.routeIdentity', 'lineage.catalogIdentity', 'consent.publicCenterlineRequest', 'clocks.sourceAsOf', 'clocks.retrievedAt', 'clocks.builtAt', 'clocks.observedAt', 'governance.m2.identity', 'governance.m2.revision', 'governance.m2.receiptDigest', 'governance.m2.reviewedTip', 'governance.m2.dqRechecked'],
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
    receipt: { schema: 'engagement-phase1-cumulative-receipt/v1', defaultPath: '.dfev1/phase1/cumulative-receipt.json', requiredFields: ['producerReceipts', 'topology', 'status', 'overlap'], identityFields: ['producerReceipts'], revisionFields: ['implementationTip', 'recordTip'], validatorCommand: 'npm run test:phase1-handoff', mode: 'admission' },
  },
});

const REQUIRED_PHASE_IDS = Object.freeze(['M1', 'M2', 'M3', 'M4', '1D']);
// The graph is deliberately not inferred from the mutable manifest.  A policy
// may describe this graph, but it cannot weaken, add to, or reverse it.
const CANONICAL_DATA_EDGES = Object.freeze([
  ['M1', 'M2'], ['M2', 'M3'], ['M1', 'M4'],
  ['M1', '1D'], ['M2', '1D'], ['M3', '1D'], ['M4', '1D'],
]);
const CANONICAL_GOVERNANCE_EDGES = Object.freeze([
  Object.freeze({ from: 'M2', to: 'M4', kind: 'frozen-evaluation-recheck' }),
]);

const AUTHORITY_RECEIPT_POLICY = Object.freeze({
  review: Object.freeze({ schema: 'engagement-phase1-independent-review/v1', pathTemplate: 'authority/review/{phase}.json' }),
  deletion: Object.freeze({ schema: 'engagement-phase1-independent-deletion/v1', pathTemplate: 'authority/deletion/{phase}.json' }),
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
  const validateExactEdges = (entries, expected, identity, label) => {
    if (!Array.isArray(entries)) { reasons.push(`${label} are not an array`); return; }
    const actual = new Set();
    for (const entry of entries) {
      const key = identity(entry);
      if (!key) { reasons.push(`invalid ${label} ${JSON.stringify(entry)}`); continue; }
      if (actual.has(key)) reasons.push(`duplicate ${label} ${key}`);
      actual.add(key);
    }
    const canonical = new Set(expected.map(identity));
    for (const key of canonical) if (!actual.has(key)) reasons.push(`missing canonical ${label} ${key}`);
    for (const key of actual) if (!canonical.has(key)) reasons.push(`noncanonical ${label} ${key}`);
  };
  validateExactEdges(policy?.edges, CANONICAL_DATA_EDGES, (edge) => Array.isArray(edge) && edge.length === 2 && REQUIRED_PHASE_IDS.includes(edge[0]) && REQUIRED_PHASE_IDS.includes(edge[1]) ? `${edge[0]}->${edge[1]}` : null, 'policy data edge');
  validateExactEdges(policy?.governanceEdges, CANONICAL_GOVERNANCE_EDGES, (edge) => edge && REQUIRED_PHASE_IDS.includes(edge.from) && REQUIRED_PHASE_IDS.includes(edge.to) && typeof edge.kind === 'string' ? `${edge.from}->${edge.to}:${edge.kind}` : null, 'policy governance edge');
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
      if (Array.isArray(value)
        ? !sameList(actual.receipt?.[field], value)
        : actual.receipt?.[field] !== value) reasons.push(`${id}: policy receipt ${field} drift`);
    }
  }
  for (const [kind, expected] of Object.entries(AUTHORITY_RECEIPT_POLICY)) {
    if (policy.authorityReceipts?.[kind]?.schema !== expected.schema || policy.authorityReceipts?.[kind]?.pathTemplate !== expected.pathTemplate) reasons.push(`${kind} authority receipt policy drift`);
  }
  if (!sameList(policy.phase1_0_writable, PHASE1_0_WRITABLE)) reasons.push('Phase1-0 writable scope drift');
  return reasons;
}

export async function inspectGitRevision(worktree, reference, expectedBase) {
  const run = async (...args) => (await execFileAsync('git', ['-C', worktree, ...args], { windowsHide: true })).stdout.trim();
  const tip = await run('rev-parse', reference);
  const mergeBase = await run('merge-base', 'main', tip);
  // Candidate-path authority is always anchored at the trusted expected base,
  // never at an observation-provided phaseBase that could hide an earlier
  // forbidden change.
  const base = await run('rev-parse', expectedBase || mergeBase);
  const changed = await run('diff', '--name-only', `${base}..${tip}`);
  return { tip, mergeBase, expectedBase: base, changedPaths: changed ? changed.split(/\r?\n/) : [] };
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
  readReceipt = readJsonBytes,
  filesystemAuthority = realFilesystemAuthority,
  authorityReader = { async read(pathname) { return readJsonBytes(pathname); } },
  // A JSON label is not a trust root.  Integration admission must supply a
  // registry/signature-backed resolver which pins the authority receipt bytes
  // and reviewer identity independently from the producer observation.
  trustedAuthorityResolver = null,
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
      if (!evidenceRootWithin(phase.worktree, phase.evidenceRoot, phasePolicy.ignoredOutputRoots)) phaseReasons.push('evidence root exceeds exact ignored-output boundary');
      if (!phase.retention?.duration || !phase.retention?.triggerEvent || !phase.retention?.decisionOwner
          || !Array.isArray(phase.retention?.deletePrerequisites)) phaseReasons.push('retention policy incomplete');
      for (const field of ['duration', 'triggerEvent', 'decisionOwner']) {
        if (phase.retention?.[field] !== phasePolicy.retention[field]) phaseReasons.push(`retention ${field} drift`);
      }
      if (!sameList(phase.retention?.deletePrerequisites, phasePolicy.retention.deletePrerequisites)) phaseReasons.push('retention delete-prerequisites drift');
      if (phase.retention?.authorizationReceipt != null) phaseReasons.push('embedded retention authorization is not an independent authority receipt');
      try {
        const actual = await inspectWorktree(phase.worktree);
        if (actual.main !== phase.expectedBase) phaseReasons.push('main topology drift');
        if (JSON.stringify(actual.status) !== JSON.stringify(phase.status.porcelain || [])) phaseReasons.push('worktree status drift');
        const implementation = await inspectRevision(phase.worktree, phase.implementationTip, phase.expectedBase);
        if (implementation.tip !== phase.exactTip || implementation.mergeBase !== phase.actualMergeBase || (implementation.expectedBase ?? implementation.phaseBase) !== phase.expectedBase) phaseReasons.push('implementation topology drift');
        if (phase.phaseBase !== phase.expectedBase || phase.phaseBase !== phase.actualMergeBase) phaseReasons.push('phase base does not equal trusted candidate base');
        if (!await isAncestor(phase.worktree, phase.expectedBase, phase.exactTip)) phaseReasons.push('exact tip is not a descendant of expected base');
        if (JSON.stringify(implementation.changedPaths) !== JSON.stringify(phase.actualChangedPaths)) phaseReasons.push('implementation changed-path drift');
        if (implementation.changedPaths.some((pathname) => !phasePolicy.writable.some((pattern) => pathMatches(pattern, pathname)))) phaseReasons.push('full candidate changed path exceeds writable boundary');
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
          const separator = phase.worktree.includes('\\') ? '\\' : '/';
          const policyPath = `${phase.worktree.replace(/[\\/]+$/, '')}${separator}${phasePolicy.receipt.defaultPath.replaceAll('/', separator)}`;
          if (phase.receipt.actualPath !== policyPath) throw new Error('receipt path drifts from immutable policy default');
          const canonicalReceiptPath = await filesystemAuthority.receiptPath(phase.worktree, phase.evidenceRoot, phase.receipt.actualPath, {
            ignoredRoot: phase.ignoredRoot,
            defaultPath: phasePolicy.receipt.defaultPath,
          });
          const payload = await readReceipt(canonicalReceiptPath);
          const normalizedReceipt = normalizeRawReceipt(payload);
          const receiptEvidence = { ...validateReceipt(phaseId, EXACT_PHASE_POLICY[phaseId], normalizedReceipt.value, phase.receipt), rawDigest: normalizedReceipt.rawDigest, canonicalPath: canonicalReceiptPath };
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
        const m2Evidence = phaseMeta.get('M2')?.receiptEvidence;
        const declaration = (phase.governanceReceiptIdentities || []).filter((entry) => entry?.phase === 'M2');
        if (declaration.length !== 1 || !m2 || m2.state !== 'accepted' || !m2Evidence) phaseReasons.push('M2 governance receipt is unavailable or unrechecked');
        else {
          const identity = { ...declaration[0] }; delete identity.phase;
          if (!sameRecord(identity, m2Evidence.identity)
            || !sameRecord(phaseMeta.get('M4')?.receiptEvidence?.receipt?.governance?.m2?.identity, m2Evidence.identity)
            || !sameRecord(phaseMeta.get('M4')?.receiptEvidence?.receipt?.governance?.m2?.revision, m2Evidence.revision)
            || phaseMeta.get('M4')?.receiptEvidence?.receipt?.governance?.m2?.receiptDigest !== m2Evidence.rawDigest
            || phaseMeta.get('M4')?.receiptEvidence?.receipt?.governance?.m2?.reviewedTip !== m2.reviewedTip
            || phaseMeta.get('M4')?.receiptEvidence?.receipt?.governance?.m2?.dqRechecked !== true) phaseReasons.push('M2 governance receipt identity drift');
          try {
            const m2Tip = m2.reviewedTip || m2.exactTip;
            if (!await isAncestor(phase.worktree, m2Tip, phase.expectedBase)
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
          await validateReviewAuthority({ phase, phaseId, filesystemAuthority, authorityReader, trustedAuthorityResolver });
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
      if (!await isAncestor(downstream.worktree, upstreamTip, downstream.expectedBase)
        || !await isAncestor(downstream.worktree, upstreamTip, downstream.implementationTip)) targetMeta.phaseReasons.push(`${source} topology tip is not an ancestor of ${target} base and implementation`);
    } catch { targetMeta.phaseReasons.push(`${source} to ${target} topology ancestry is not resolvable`); }
  }

  // M4's typed M1 binding is stronger than an observation declaration: the
  // actual M4 handoff receipt must carry the warehouse identity that the M1
  // producer actually emitted, and validateReceipt already requires the same
  // M4 value at its top level and in lineage.
  const m1 = observations.get('M1');
  const m4Meta = phaseMeta.get('M4');
  if (m4Meta?.receiptEvidence && phaseMeta.get('M1')?.receiptEvidence) {
    if (m4Meta.receiptEvidence.identity.warehouseIdentity !== phaseMeta.get('M1').receiptEvidence.identity.current_snapshot_id) {
      m4Meta.phaseReasons.push('M1/M4 warehouse identity cross-binding drift');
    }
  }
  const oneDMeta = phaseMeta.get('1D');
  if (oneDMeta?.receiptEvidence) {
    const bindings = oneDMeta.receiptEvidence.receipt.producerReceipts;
    for (const id of REQUIRED_PHASE_IDS.slice(0, 4)) {
      const actual = phaseMeta.get(id)?.receiptEvidence;
      const observed = observations.get(id);
      const binding = bindings?.filter((entry) => entry?.phase === id) || [];
      if (binding.length !== 1 || !actual || !observed
        || binding[0].schema !== actual.schema || binding[0].receiptDigest !== actual.rawDigest || !sameRecord(binding[0].identity, actual.identity)
        || !sameRecord(binding[0].revision, actual.revision)
        || binding[0].implementationTip !== observed.implementationTip
        || binding[0].recordTip !== observed.recordTip || binding[0].reviewedTip !== observed.reviewedTip
        || binding[0].dqRechecked !== true) oneDMeta.phaseReasons.push(`1D actual producer binding drift for ${id}`);
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
  // The cumulative receipt is an attestation of this evaluator's own exact
  // graph result.  It is checked after all producer decisions exist, rather
  // than accepting an arbitrary non-empty status/overlap shape.
  if (oneDMeta?.receiptEvidence) {
    const expectedStatus = Object.fromEntries(REQUIRED_PHASE_IDS.map((id) => [id, phaseResults[id]?.status]));
    const receipt = oneDMeta.receiptEvidence.receipt;
    if (!sameRecord(receipt.status, expectedStatus)
      || !sameList(receipt.overlap, [{ status: 'none', pairs: [] }])) {
      oneDMeta.phaseReasons.push('1D status or overlap does not match evaluator recomputation');
      phaseResults['1D'].status = 'blocked';
      phaseResults['1D'].decisions.admissionEligible = false;
      reasons.push('1D: status or overlap does not match evaluator recomputation');
    }
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
        oneDEvidence: oneDMeta?.receiptEvidence,
        producerEvidence: phaseMeta.get(phasePolicy.id)?.receiptEvidence,
        filesystemAuthority,
        authorityReader,
        trustedAuthorityResolver,
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

function normalizeRawReceipt(payload) {
  const envelope = Buffer.isBuffer(payload)
    ? { value: JSON.parse(payload.toString('utf8')), bytes: payload, rawDigest: `sha256:${createHash('sha256').update(payload).digest('hex')}` }
    : payload;
  if (!envelope?.value || !Buffer.isBuffer(envelope.bytes) || typeof envelope.rawDigest !== 'string') {
    throw new Error('receipt reader did not provide immutable raw bytes');
  }
  const expectedDigest = `sha256:${createHash('sha256').update(envelope.bytes).digest('hex')}`;
  if (envelope.rawDigest !== expectedDigest) throw new Error('receipt raw digest does not match supplied bytes');
  let parsed;
  try { parsed = JSON.parse(envelope.bytes.toString('utf8')); } catch { throw new Error('receipt raw bytes are not JSON'); }
  if (JSON.stringify(parsed) !== JSON.stringify(envelope.value)) throw new Error('receipt reader value does not match supplied bytes');
  return Object.freeze({ value: parsed, bytes: envelope.bytes, rawDigest: expectedDigest });
}

export function validateReceipt(phaseId, policy, receipt, observationReceipt = {}) {
  const canonical = EXACT_PHASE_POLICY[phaseId] || policy;
  if (!isPlainRecord(receipt)) throw new Error('receipt is not a plain object');
  if (canonical.receipt.schema && receipt.schema !== canonical.receipt.schema) throw new Error('schema drift');
  for (const field of canonical.receipt.requiredFields) {
    const value = readPath(receipt, field);
    if (value == null || value === false || value === 0 || value === '') throw new Error(`missing or falsey ${field}`);
  }
  const identity = Object.fromEntries(canonical.receipt.identityFields.map((field) => [field, readPath(receipt, field)]));
  const revision = Object.fromEntries(canonical.receipt.revisionFields.map((field) => [field, readPath(receipt, field)]));
  for (const [field, value] of [...Object.entries(identity), ...Object.entries(revision)]) {
    if (phaseId === 'M3' && field === 'observations.0.dq') continue;
    if (phaseId === '1D' && field === 'producerReceipts') continue;
    if (typeof value !== 'string' || !value.trim()) throw new Error(`identity or revision type drift ${field}`);
  }
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
  validateVersionedDomain(phaseId, receipt, canonical.receipt);
  if (phaseId === 'M4') {
    const clocks = canonical.receipt.clockFields.map((field) => Date.parse(readPath(receipt, field)));
    if (clocks.some((value, index) => index && value < clocks[index - 1])) throw new Error('M4 clocks are out of order');
    if (!isExactTimestamp(receipt.startedAt) || Date.parse(receipt.startedAt) < clocks[1]
      || Date.parse(receipt.startedAt) > clocks[3]) throw new Error('M4 startedAt clock drift');
    if (!Number.isInteger(receipt.completedPartitions) || !Number.isInteger(receipt.partitionCount)
      || receipt.partitionCount <= 0 || receipt.completedPartitions !== receipt.partitionCount) throw new Error('M4 partition completion drift');
    if (!isPlainRecord(receipt.completion) || !['complete', 'completed'].includes(receipt.completion.state)
      || !isPlainRecord(receipt.accumulator)) throw new Error('M4 completion or accumulator drift');
    if (receipt.warehouseIdentity !== receipt.lineage?.warehouseIdentity
      || receipt.routeIdentity !== receipt.lineage?.routeIdentity
      || receipt.catalogIdentity !== receipt.lineage?.catalogIdentity) throw new Error('M4 lineage identity drift');
  }
  if (phaseId === '1D') {
    if (!Array.isArray(receipt.producerReceipts) || receipt.producerReceipts.length !== 4
      || new Set(receipt.producerReceipts.map((entry) => entry?.phase)).size !== 4
      || !REQUIRED_PHASE_IDS.slice(0, 4).every((id) => receipt.producerReceipts.some((entry) => entry?.phase === id && isPlainRecord(entry.identity) && isPlainRecord(entry.revision) && typeof entry.schema === 'string' && isDigest(entry.receiptDigest)))) throw new Error('1D producer receipt binding drift');
    if (!Array.isArray(receipt.topology) || !sameEdgeSet(receipt.topology, CANONICAL_DATA_EDGES)
      || !Array.isArray(receipt.overlap) || receipt.overlap.length !== 1 || !isPlainRecord(receipt.overlap[0])
      || receipt.overlap[0].status !== 'none' || !Array.isArray(receipt.overlap[0].pairs) || receipt.overlap[0].pairs.length
      || !isPlainRecord(receipt.status) || Object.keys(receipt.status).length !== REQUIRED_PHASE_IDS.length
      || REQUIRED_PHASE_IDS.some((id) => receipt.status[id] !== 'accepted')) throw new Error('1D cumulative receipt semantics drift');
  }
  return { phaseId, schema: receipt.schema, identity, revision, receipt };
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isDigest(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function sameEdgeSet(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const asKeys = (entries) => entries.map((edge) => Array.isArray(edge) && edge.length === 2 ? `${edge[0]}->${edge[1]}` : '').sort();
  return sameList(asKeys(actual), asKeys(expected));
}

function validateVersionedDomain(phaseId, receipt) {
  const digestFields = {
    M1: ['current_snapshot_id'],
    M2: ['protocol.sha256', 'data.mart_artifact_identity', 'data.source_vintage'],
    M3: ['semanticIdentity'],
    M4: ['warehouseIdentity', 'routeIdentity', 'catalogIdentity'],
  }[phaseId] || [];
  for (const field of digestFields) if (!isDigest(readPath(receipt, field))) throw new Error(`digest drift ${field}`);
  if (phaseId === 'M1') validateM1WarehouseReceipt(receipt);
  if (phaseId === 'M2') validateM2EvaluationReceipt(receipt);
  if (phaseId === 'M3') {
    if (!['partial', 'unavailable'].includes(receipt.status) || !Array.isArray(receipt.observations) || !receipt.observations.length
      || !isPlainRecord(receipt.routing) || !Object.keys(receipt.routing).length
      || !isPlainRecord(receipt.privacy) || !Object.keys(receipt.privacy).length
      || !Array.isArray(receipt.limitations) || !receipt.limitations.length) throw new Error('M3 source-smoke semantics drift');
    for (const observation of receipt.observations) {
      const source = { id: observation?.sourceId, dataset: observation?.dataset, transport: observation?.transport };
      validateHomeCompareSourceObservation(observation, source);
    }
  }
  if (phaseId === 'M4' && (!isPlainRecord(receipt.dataQuality) || !isPlainRecord(receipt.lineage) || !isPlainRecord(receipt.consent))) throw new Error('M4 DQ, lineage, or consent type drift');
}

// validateExactWarehouse is deliberately a filesystem/protocol validator: it
// needs the frozen partition root and protocol to check all 64 parts.  A
// handoff receipt cannot truthfully rerun it, so this adapter validates the
// exact receipt projection it is allowed to consume, while the producer's
// own validator remains the authority for the complete warehouse.
function validateM1WarehouseReceipt(receipt) {
  if (!isPlainRecord(receipt.coverage) || !isPlainRecord(receipt.lineage_registry)) throw new Error('M1 coverage or lineage type drift');
  const coverage = receipt.coverage;
  if (typeof coverage.earliest_scope_start !== 'string' || !coverage.earliest_scope_start
    || typeof coverage.latest_scope_end_exclusive !== 'string' || !coverage.latest_scope_end_exclusive
    || !Number.isFinite(Date.parse(coverage.earliest_scope_start)) || !Number.isFinite(Date.parse(coverage.latest_scope_end_exclusive))
    || Date.parse(coverage.earliest_scope_start) >= Date.parse(coverage.latest_scope_end_exclusive)) throw new Error('M1 coverage semantics drift');
  const lineage = receipt.lineage_registry;
  if (!Array.isArray(lineage.source_snapshots) || !lineage.source_snapshots.length
    || lineage.source_snapshots.some((entry) => !isPlainRecord(entry) || !isDigest(entry.snapshot_id))
    || !isPlainRecord(lineage.model_input_contract)
    || lineage.model_input_contract.serving_status !== 'not-published') throw new Error('M1 lineage semantics drift');
  if (!isExactTimestamp(receipt.updated_at)) throw new Error('M1 updated clock drift');
}

function validateM2EvaluationReceipt(receipt) {
  if (!isPlainRecord(receipt.protocol) || !isPlainRecord(receipt.data) || !isPlainRecord(receipt.data.coverage)
    || !Object.keys(receipt.data.coverage).length || !isExactTimestamp(receipt.generated_at)) throw new Error('M2 protocol, coverage, or generated clock drift');
  if (typeof receipt.protocol.schema !== 'string' || !receipt.protocol.schema || !isDigest(receipt.protocol.sha256)) throw new Error('M2 protocol semantics drift');
  // The detached handoff retains a complete, machine-checkable evaluation
  // report so it can reuse the producer's pure domain validator rather than
  // duplicating metric admissibility in a Markdown policy.
  validateModelEvaluationReport(receipt.evaluation);
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
  const rawWorktree = String(worktree || ''); const rawEvidence = String(evidenceRoot || '');
  if (!rawWorktree || !rawEvidence || rawWorktree.includes('\0') || rawEvidence.includes('\0')) return false;
  if ((rawWorktree.includes('/') && rawWorktree.includes('\\')) || (rawEvidence.includes('/') && rawEvidence.includes('\\'))) return false;
  const style = rawWorktree.includes('\\') ? '\\' : '/';
  if ((rawEvidence.includes('\\') ? '\\' : '/') !== style) return false;
  const normalWorktree = rawWorktree.replace(/[\\/]+$/, '');
  return patterns.some((pattern) => {
    let literal;
    try { literal = ignoredRootLiteral(pattern); } catch { return false; }
    const expected = `${normalWorktree}${style}${literal.replaceAll('/', style)}`;
    if (rawEvidence !== expected && !rawEvidence.startsWith(`${expected}${style}`)) return false;
    const relative = rawEvidence.slice(normalWorktree.length + 1);
    return !relative.split(style).some((segment) => !segment || segment === '.' || segment === '..');
  });
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
  return sameList(leftKeys, rightKeys) && leftKeys.every((key) => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}

async function readAuthorityReceipt(reference, phase, filesystemAuthority, authorityReader, trustedAuthorityResolver, kind) {
  if (!reference || typeof reference !== 'object' || typeof reference.path !== 'string'
    || typeof reference.schema !== 'string' || !reference.expectedIdentity) throw new Error(`${kind} authority reference is incomplete`);
  const separator = phase.evidenceRoot.includes('\\') ? '\\' : '/';
  const expectedRelative = AUTHORITY_RECEIPT_POLICY[kind].pathTemplate.replace('{phase}', phase.phase).replaceAll('/', separator);
  const expectedPath = `${phase.evidenceRoot.replace(/[\\/]+$/, '')}${separator}${expectedRelative}`;
  if (reference.path !== expectedPath) throw new Error(`${kind} authority path is not canonical`);
  const receiptPath = await filesystemAuthority.receiptPath(phase.worktree, phase.evidenceRoot, reference.path, {
    ignoredRoot: phase.ignoredRoot,
  });
  const payload = normalizeRawReceipt(await authorityReader.read(receiptPath));
  const receipt = payload.value?.receipt ?? payload.value;
  if (!isPlainRecord(receipt)) throw new Error(`${kind} authority receipt is not an object`);
  if (!trustedAuthorityResolver?.resolve) throw new Error(`${kind} authority has no independent trusted resolver`);
  const candidate = { implementationTip: phase.implementationTip, executionRecordTip: phase.recordTip, cumulativeTip: phase.reviewedTip };
  const trusted = await trustedAuthorityResolver.resolve({
    kind, canonicalPath: receiptPath, rawDigest: payload.rawDigest, phase: phase.phase, candidate,
    issuer: receipt.reviewer || receipt.issuer,
  });
  if (!trusted || trusted.trusted !== true || trusted.kind !== kind || trusted.phase !== phase.phase
    || trusted.rawDigest !== payload.rawDigest || trusted.canonicalPath !== receiptPath
    || !sameRecord(trusted.candidate, candidate)) throw new Error(`${kind} authority digest, path, or candidate is not independently trusted`);
  if (receipt.schema !== reference.schema || receipt.schema !== AUTHORITY_RECEIPT_POLICY[kind].schema) throw new Error(`${kind} authority schema drift`);
  if (!sameRecord(receipt.identity, reference.expectedIdentity)) throw new Error(`${kind} authority identity drift`);
  const issuer = receipt.reviewer || receipt.issuer;
  if (!sameRecord(issuer, trusted.issuer) || !sameRecord(issuer, reference.expectedIssuer)) throw new Error(`${kind} authority issuer drift`);
  return { receipt, trusted, rawDigest: payload.rawDigest, canonicalPath: receiptPath };
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

async function validateReviewAuthority({ phase, phaseId, filesystemAuthority, authorityReader, trustedAuthorityResolver }) {
  const { receipt } = await readAuthorityReceipt(phase.reviewAuthority, phase, filesystemAuthority, authorityReader, trustedAuthorityResolver, 'review');
  if (!isIndependentIssuer(receipt.reviewer, phase)) throw new Error('review authority is not independent');
  if (receipt.phase !== phaseId || receipt.verdict !== 'approve') throw new Error('review verdict or phase drift');
  if (receipt.candidate?.implementationTip !== phase.implementationTip
    || receipt.candidate?.executionRecordTip !== phase.recordTip
    || receipt.candidate?.cumulativeTip !== phase.reviewedTip) throw new Error('review candidate tip binding drift');
}

async function validateDeletionAuthority({ phase, phasePolicy, oneD, oneDResult, oneDEvidence, producerEvidence, filesystemAuthority, authorityReader, trustedAuthorityResolver }) {
  if (!phase || !oneD || oneDResult?.decisions?.admissionEligible !== true || oneD.state !== 'accepted') return false;
  try {
    const { receipt, trusted } = await readAuthorityReceipt(phase.deletionAuthority, phase, filesystemAuthority, authorityReader, trustedAuthorityResolver, 'deletion');
    if (!isIndependentIssuer(receipt.issuer, phase)) return false;
    if (receipt.decision?.taskId === phase.producerTask || receipt.decision?.taskId === phase.owner
      || receipt.decision?.taskId === '1D integration/release owner') return false;
    if (receipt.decision?.taskId !== receipt.issuer.taskId
      || receipt.decision?.identity !== receipt.issuer.identity
      || receipt.decision?.decidedAt !== receipt.decidedAt) return false;
    if (receipt.accepted1D?.cumulativeTip !== oneD.reviewedTip
      || !sameRecord(receipt.accepted1D?.receiptIdentity, oneD.receipt?.identity)
      || receipt.accepted1D?.receiptDigest !== oneDEvidence?.rawDigest
      || receipt.target?.receiptDigest !== producerEvidence?.rawDigest
      || receipt.target?.canonicalPath !== producerEvidence?.canonicalPath
      || receipt.target?.evidenceRoot !== phase.evidenceRoot) return false;
    if (!sameRecord(trusted.deletionBinding, {
      accepted1DRawDigest: oneDEvidence?.rawDigest,
      targetRawDigest: producerEvidence?.rawDigest,
      targetCanonicalPath: producerEvidence?.canonicalPath,
      evidenceRoot: phase.evidenceRoot,
      targets: receipt.target?.targets,
      candidate: { implementationTip: phase.implementationTip, executionRecordTip: phase.recordTip, cumulativeTip: phase.reviewedTip },
    })) return false;
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
