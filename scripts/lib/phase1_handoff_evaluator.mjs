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
      for (let cursor = flavor.dirname(receipt); ; cursor = flavor.dirname(cursor)) {
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
    admission: { validatorStatus: 'not-installed', validatorOwner: 'M1 frozen warehouse task' },
    receipt: { schema: 'engagement-phl-crime-event-warehouse/v1', defaultPath: '.dfev1/crime/warehouse/manifest.json', requiredFields: ['current_snapshot_id', 'coverage', 'lineage_registry', 'latest_quality_report', 'latest_revision_report', 'updated_at'], identityFields: ['current_snapshot_id'], revisionFields: ['updated_at', 'latest_revision_report'], validatorCommand: 'npm run test:phase1-handoff', mode: 'future-admission' },
  },
  M2: {
    owner: 'M2 mart/evaluation task',
    writable: ['scripts/build_area_intelligence_marts.mjs', 'scripts/evaluate_area_intelligence.mjs', 'scripts/lib/area_intelligence_*.mjs', 'scripts/tests/area_intelligence_m2.mjs'],
    forbidden: ['package.json', 'public/data/**', 'src/home_compare/**', 'src/routes_crime/known_route_*.js'],
    ignoredOutputRoots: ['.dfev1/area-intelligence/**'],
    ports: [4198],
    upstreamReceiptBindings: ['M1'],
    retention: { duration: 'P180D', triggerEvent: 'independently-reviewed-1D-acceptance', decisionOwner: '1D integration/release owner', deletePrerequisites: ['M1 receipt recheck', 'M2 receipt recheck', '1D cumulative receipt recheck'], authorizationReceipt: '1D cumulative retention authorization' },
    admission: { validatorStatus: 'not-installed', validatorOwner: 'M2 mart/evaluation task' },
    receipt: { schema: 'ModelEvaluationReport/v1', defaultPath: '.dfev1/area-intelligence/m2-baseline/evaluation/model-evaluation-report.json', requiredFields: ['generated_at', 'protocol.schema', 'protocol.sha256', 'data.mart_artifact_identity', 'data.source_vintage', 'data.coverage', 'data.admission', 'metrics.primary_by_fold_space_holdout', 'metrics.by_category', 'metrics.by_data_volume'], identityFields: ['data.mart_artifact_identity', 'data.source_vintage'], revisionFields: ['generated_at', 'protocol.sha256'], validatorCommand: 'npm run test:phase1-handoff', mode: 'future-admission' },
  },
  M3: {
    owner: 'M3 Home Compare task',
    writable: ['src/home_compare/**', 'scripts/smoke_home_compare_sources.mjs', 'scripts/lib/home_compare_source_smoke.mjs', 'scripts/tests/home_compare_m3.mjs', 'scripts/tests/home_compare_browser.mjs'],
    forbidden: ['package.json', 'public/data/**', 'src/routes_crime/known_route_*.js'],
    ignoredOutputRoots: ['.dfev1/home-neighborhood-compare/m3-v1/**'],
    ports: [4189],
    upstreamReceiptBindings: ['M2'],
    retention: { duration: 'P30D', triggerEvent: 'independently-reviewed-1D-acceptance', decisionOwner: '1D integration/release owner', deletePrerequisites: ['M3 receipt recheck', 'desktop-en-synthetic.png retained', 'mobile-en-synthetic.png retained', '1D cumulative receipt recheck'], authorizationReceipt: '1D cumulative retention authorization' },
    admission: { validatorStatus: 'not-installed', validatorOwner: 'M3 Home Compare task' },
    receipt: { schema: 'engagement-home-compare-source-smoke/v1', defaultPath: '.dfev1/home-neighborhood-compare/m3-v1/official-smoke/manifest.json', requiredFields: ['generatedAt', 'status', 'semanticIdentity', 'observations', 'routing', 'privacy', 'limitations'], identityFields: ['semanticIdentity'], revisionFields: ['generatedAt', 'observations.0.revision', 'observations.0.dq'], validatorCommand: 'npm run test:phase1-handoff', mode: 'future-admission' },
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
    admission: { validatorStatus: 'not-installed', validatorOwner: 'M4 Known Route task' },
    receipt: {
      mode: 'future-admission',
      schema: 'engagement-known-route-evidence-handoff/v2', defaultPath: '.dfev1/known-route-evidence-v1/full-warehouse/final-handoff.json',
      requiredFields: ['warehouseIdentity', 'routeIdentity', 'centerlineDataVersion', 'catalogIdentity', 'corridorIdentity', 'completedPartitions', 'partitionCount', 'startedAt', 'completion', 'accumulator', 'dataQuality.partitionCompletion', 'dataQuality.accumulatorValidated', 'lineage.warehouseIdentity', 'lineage.routeIdentity', 'lineage.catalogIdentity', 'consent.publicCenterlineRequest', 'clocks.sourceAsOf', 'clocks.retrievedAt', 'clocks.builtAt', 'clocks.observedAt', 'governance.m2.identity', 'governance.m2.revision', 'governance.m2.receiptDigest', 'governance.m2.canonicalPath', 'governance.m2.evidenceRoot', 'governance.m2.implementationTip', 'governance.m2.executionRecordTip', 'governance.m2.cumulativeTip', 'governance.m2.dq', 'governance.m2.dqRechecked'],
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
    admission: { validatorStatus: 'not-installed', validatorOwner: '1D integration/release owner' },
    receipt: { schema: 'engagement-phase1-cumulative-receipt/v1', defaultPath: '.dfev1/phase1/cumulative-receipt.json', requiredFields: ['producerReceipts', 'topology', 'status', 'overlap', 'implementationTip', 'executionRecordTip', 'cumulativeTip'], identityFields: ['producerReceipts'], revisionFields: ['implementationTip', 'executionRecordTip', 'cumulativeTip'], validatorCommand: 'npm run test:phase1-handoff', mode: 'future-admission' },
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

// This is deliberately not derived from a candidate receipt.  It is the
// frozen identity projection of public/data/home_compare_sources.v1.json,
// whose full registry is independently validated by the M3 producer.  A
// handoff observation may describe a source state, but cannot introduce a
// source, dataset, or transport of its own choosing.
const FROZEN_HOME_COMPARE_SOURCES = Object.freeze([
  ['citygeo-address-locator', 'Address_Locator', 'arcgis-geocode-server'],
  ['opa-current-property', 'opa_properties_public', 'carto-sql'],
  ['opa-assessment-history', 'assessments', 'carto-sql'],
  ['real-estate-transfers', 'rtt_summary', 'carto-sql'],
  ['philly311-requests', 'public_cases_fc', 'carto-sql'],
  ['li-property-history', 'violations|business_licenses|case_investigations', 'carto-sql'],
  ['vacant-property-indicators', 'Vacant_Indicators_Bldg/0', 'arcgis-feature-service'],
  ['philadelphia-reported-crime', 'incidents_part1_part2', 'carto-sql'],
  ['vision-zero-hin-2025', 'high_injury_network_2025/0', 'arcgis-feature-service'],
].map(([id, dataset, transport]) => Object.freeze({ id, dataset, transport })));

const FROZEN_M3_PRIVACY = Object.freeze({
  runtime_only_fields: Object.freeze(['input_address', 'normalized_address', 'coordinates', 'parcel_identifier', 'commute_destination']),
  forbidden_tracked_or_shareable_fields: Object.freeze(['address', 'coordinates', 'source_record_id', 'owner', 'grantor', 'grantee', 'case_identifier', 'document_identifier']),
});

const EVALUATION_PROTOCOL_SCHEMA = 'engagement-area-intelligence-evaluation-protocol/v1';

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

function uninstalledValidatorReasons() {
  // This is a Phase1-0 invariant in checked-in evaluator code, not an
  // observation field, fixture switch, or resolver result. A later phase
  // owner must add its own reviewed executable validator before this guard can
  // be changed; authority material alone is never a substitute.
  return REQUIRED_PHASE_IDS.map((id) => `${id}: phase-owned admission validator is not installed`);
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
    if (!sameRecord(actual.admission, expected.admission)) reasons.push(`${id}: policy admission-validator boundary drift`);
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

function candidateTips(phase) {
  return {
    implementationTip: phase?.implementationTip,
    executionRecordTip: phase?.recordTip,
    cumulativeTip: phase?.cumulativeTip,
    reviewedTip: phase?.reviewedTip,
  };
}

function candidateTipsForAuthority(phase) {
  const { reviewedTip: _reviewedTip, ...candidate } = candidateTips(phase);
  return candidate;
}

function allWritableOwners(policies, pathname) {
  const owners = policies.filter((policy) => {
    const writable = policy.id === '1D' ? [...policy.writable, ...PHASE1_0_WRITABLE] : policy.writable;
    return writable.some((pattern) => pathMatches(pattern, pathname));
  });
  return owners;
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
  // Phase1-0 owns release/browser/lifecycle proof, not any producer's final
  // admission validator. Do this before any receipt or authority reader can
  // run, so a synthetic receipt, injected resolver, or candidate-owned flag
  // cannot manufacture preparation, consumption, admission, or deletion.
  const validatorReasons = uninstalledValidatorReasons();
  if (validatorReasons.length) return blockedStructureResult([...reasons, ...validatorReasons]);
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
      for (const key of ['producerTask', 'owner', 'worktree', 'evidenceRoot', 'exactTip', 'expectedBase', 'actualMergeBase', 'phaseBase', 'ancestorResult', 'status', 'actualChangedPaths', 'artifactOwner', 'ignoredRoot', 'retention', 'implementationTip', 'recordTip', 'cumulativeTip', 'reviewedTip', 'state']) {
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
        if (phaseId !== '1D' && (phase.phaseBase !== phase.expectedBase || phase.phaseBase !== phase.actualMergeBase)) phaseReasons.push('phase base does not equal trusted candidate base');
        if (!await isAncestor(phase.worktree, phase.expectedBase, phase.exactTip)) phaseReasons.push('exact tip is not a descendant of expected base');
        const programRevision = phaseId === '1D' && phase.cumulativeTip
          ? await inspectRevision(phase.worktree, phase.cumulativeTip, phase.expectedBase)
          : implementation;
        if (JSON.stringify(programRevision.changedPaths) !== JSON.stringify(phase.actualChangedPaths)) phaseReasons.push('program changed-path drift');
        if (phaseId === '1D') {
          const allPolicies = [...policies.values()];
          if (programRevision.changedPaths.some((pathname) => allWritableOwners(allPolicies, pathname).length !== 1)) phaseReasons.push('overall program path is not uniquely owned by the phase writable union');
          if (!phase.preIntegrationBase || phase.phaseBase !== phase.preIntegrationBase) phaseReasons.push('1D phase base is not the declared pre-integration boundary');
          if (!await isAncestor(phase.worktree, phase.expectedBase, phase.phaseBase)
            || !await isAncestor(phase.worktree, phase.phaseBase, phase.implementationTip)) phaseReasons.push('1D phase-base topology drift');
          const ownSlice = await changedBetween(phase.worktree, phase.phaseBase, phase.implementationTip);
          if (ownSlice.some((pathname) => ![...phasePolicy.writable, ...PHASE1_0_WRITABLE].some((pattern) => pathMatches(pattern, pathname)))) phaseReasons.push('1D own changed path exceeds writable boundary');
        } else if (implementation.changedPaths.some((pathname) => !phasePolicy.writable.some((pattern) => pathMatches(pattern, pathname)))) phaseReasons.push('full candidate changed path exceeds writable boundary');
        const tips = candidateTips(phase);
        if (phase.state === 'accepted') {
          if (!tips.executionRecordTip || !tips.cumulativeTip || !tips.reviewedTip) phaseReasons.push('accepted observation is missing execution, cumulative, or reviewed tip');
          if (tips.implementationTip === tips.executionRecordTip || tips.implementationTip === tips.cumulativeTip
            || tips.executionRecordTip === tips.cumulativeTip) phaseReasons.push('candidate tip chain self-references an earlier stage');
          if (actual.head !== tips.cumulativeTip) phaseReasons.push('worktree head is not the cumulative tip');
          const chains = [
            [tips.implementationTip, tips.executionRecordTip, 'implementation tip is not an execution-record ancestor'],
            [tips.executionRecordTip, tips.cumulativeTip, 'execution-record tip is not a cumulative ancestor'],
            [tips.executionRecordTip, tips.reviewedTip, 'execution-record tip is not a reviewed ancestor'],
          ];
          for (const [ancestor, descendant, reason] of chains) if (!await isAncestor(phase.worktree, ancestor, descendant)) phaseReasons.push(reason);
          const executionDelta = await changedBetween(phase.worktree, tips.implementationTip, tips.executionRecordTip);
          const cumulativeDelta = await changedBetween(phase.worktree, tips.executionRecordTip, tips.cumulativeTip);
          if (executionDelta.some((pathname) => !RECORD_ONLY_PATHS.includes(pathname))) phaseReasons.push('execution record delta is not record-only');
          if (cumulativeDelta.some((pathname) => !RECORD_ONLY_PATHS.includes(pathname))) phaseReasons.push('cumulative record delta is not record-only');
        }
      } catch { phaseReasons.push('tip/worktree is not resolvable'); }
      if (phase.implementationTip !== phase.exactTip) phaseReasons.push('implementation tip is not the observed exact tip');
      for (const key of ['exactTip', 'implementationTip', 'recordTip', 'cumulativeTip', 'reviewedTip']) {
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
            || phaseMeta.get('M4')?.receiptEvidence?.receipt?.governance?.m2?.canonicalPath !== m2Evidence.canonicalPath
            || phaseMeta.get('M4')?.receiptEvidence?.receipt?.governance?.m2?.evidenceRoot !== m2.evidenceRoot
            || phaseMeta.get('M4')?.receiptEvidence?.receipt?.governance?.m2?.implementationTip !== m2.implementationTip
            || phaseMeta.get('M4')?.receiptEvidence?.receipt?.governance?.m2?.executionRecordTip !== m2.recordTip
            || phaseMeta.get('M4')?.receiptEvidence?.receipt?.governance?.m2?.cumulativeTip !== m2.cumulativeTip
            || !sameRecord(phaseMeta.get('M4')?.receiptEvidence?.receipt?.governance?.m2?.dq, receiptDqSummary('M2', m2Evidence.receipt))
            || phaseMeta.get('M4')?.receiptEvidence?.receipt?.governance?.m2?.dqRechecked !== true) phaseReasons.push('M2 governance receipt identity drift');
          try {
            const m2Tip = m2.reviewedTip || m2.cumulativeTip || m2.exactTip;
            if (!await isAncestor(phase.worktree, m2Tip, phase.expectedBase)
              || !await isAncestor(phase.worktree, m2Tip, phase.implementationTip)) phaseReasons.push('M2 governance tip is not an ancestor of M4 base and implementation');
          } catch { phaseReasons.push('M2 governance ancestry is not resolvable'); }
        }
      }
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
      const upstreamTip = upstream.reviewedTip || upstream.cumulativeTip || upstream.exactTip;
      const downstreamBase = target === '1D' ? downstream.phaseBase : downstream.expectedBase;
      if (!await isAncestor(downstream.worktree, upstreamTip, downstreamBase)
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
        || binding[0].canonicalPath !== actual.canonicalPath || binding[0].evidenceRoot !== observed.evidenceRoot
        || binding[0].implementationTip !== observed.implementationTip
        || binding[0].executionRecordTip !== observed.recordTip || binding[0].cumulativeTip !== observed.cumulativeTip
        || binding[0].reviewedTip !== observed.reviewedTip
        || !sameRecord(binding[0].dq, receiptDqSummary(id, actual.receipt))
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
    if (phaseId === 'M3' && field === 'observations.0.dq') {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry)) throw new Error('M3 observation DQ revision drift');
      continue;
    }
    if (phaseId === 'M3' && field === 'observations.0.revision') {
      if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > 240)) throw new Error('M3 nullable revision drift');
      continue;
    }
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
      || REQUIRED_PHASE_IDS.some((id) => receipt.status[id] !== 'accepted')
      || !isCommitId(receipt.implementationTip) || !isCommitId(receipt.executionRecordTip) || !isCommitId(receipt.cumulativeTip)) throw new Error('1D cumulative receipt semantics drift');
  }
  return { phaseId, schema: receipt.schema, identity, revision, receipt };
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isDigest(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isCommitId(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
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
  if (phaseId === 'M3') validateM3SourceSmokeReceipt(receipt);
  if (phaseId === 'M4') validateM4HandoffReceipt(receipt);
}

// validateExactWarehouse is deliberately a filesystem/protocol validator: it
// needs the frozen partition root and protocol to check all 64 parts.  A
// handoff receipt cannot truthfully rerun it, so this adapter validates the
// exact receipt projection it is allowed to consume, while the producer's
// own validator remains the authority for the complete warehouse.
function validateM1WarehouseReceipt(receipt) {
  if (receipt.schema !== 'engagement-phl-crime-event-warehouse/v1'
    || !['official-local-candidate', 'synthetic-test'].includes(receipt.mode)
    || receipt.serving_eligible !== false
    || !Number.isSafeInteger(receipt.partition_count) || receipt.partition_count < 1
    || !Number.isSafeInteger(receipt.canonical_row_count) || receipt.canonical_row_count < 0
    || !Number.isSafeInteger(receipt.active_row_count) || receipt.active_row_count < 0
    || !Number.isSafeInteger(receipt.removal_candidate_count) || receipt.removal_candidate_count < 0
    || !Array.isArray(receipt.applied_snapshot_ids) || !receipt.applied_snapshot_ids.length
    || receipt.applied_snapshot_ids.some((value) => !isDigest(value))
    || !receipt.applied_snapshot_ids.includes(receipt.current_snapshot_id)) throw new Error('M1 warehouse header semantics drift');
  if (!isPlainRecord(receipt.coverage) || typeof receipt.lineage_registry !== 'string') throw new Error('M1 coverage or lineage type drift');
  const coverage = receipt.coverage;
  if (!hasExactKeys(coverage, ['earliest_scope_start', 'latest_scope_end_exclusive', 'latest_event_at'])
    || typeof coverage.earliest_scope_start !== 'string' || !coverage.earliest_scope_start
    || typeof coverage.latest_scope_end_exclusive !== 'string' || !coverage.latest_scope_end_exclusive
    || !isIsoDateOrTimestamp(coverage.earliest_scope_start) || !isIsoDateOrTimestamp(coverage.latest_scope_end_exclusive)
    || !isExactTimestamp(coverage.latest_event_at)
    || Date.parse(coverage.earliest_scope_start) >= Date.parse(coverage.latest_scope_end_exclusive)
    || Date.parse(coverage.latest_event_at) >= Date.parse(coverage.latest_scope_end_exclusive)) throw new Error('M1 coverage semantics drift');
  if (!isSafeRelativeJsonPath(receipt.lineage_registry) || !isSafeRelativeJsonPath(receipt.latest_quality_report)
    || !isSafeRelativeJsonPath(receipt.latest_revision_report)
    || !isExactTimestamp(receipt.updated_at)) throw new Error('M1 registry/report path or updated clock drift');
}

function validateM2EvaluationReceipt(receipt) {
  // The receipt itself is the canonical ModelEvaluationReport; accepting a
  // nested convenience object would allow an unrelated report to self-certify.
  validateModelEvaluationReport(receipt);
  if (!isPlainRecord(receipt.protocol) || !isPlainRecord(receipt.data) || !isPlainRecord(receipt.data.coverage)
    || receipt.protocol.schema !== EVALUATION_PROTOCOL_SCHEMA || !isDigest(receipt.protocol.sha256)
    || !isExactTimestamp(receipt.protocol.frozen_at) || receipt.protocol.frozen_before_model_performance !== true
    || !isExactTimestamp(receipt.generated_at)) throw new Error('M2 protocol or generated clock drift');
  const coverage = receipt.data.coverage;
  const admission = receipt.data.admission;
  if (!hasExactKeys(coverage, ['earliest_scope_start', 'latest_scope_end_exclusive', 'latest_event_at'])
    || !isIsoDateOrTimestamp(coverage.earliest_scope_start) || !isIsoDateOrTimestamp(coverage.latest_scope_end_exclusive)
    || !isExactTimestamp(coverage.latest_event_at) || Date.parse(coverage.earliest_scope_start) >= Date.parse(coverage.latest_scope_end_exclusive)
    || !validM2Admission(admission)
    || !Number.isSafeInteger(receipt.data.unit_count?.tract) || receipt.data.unit_count.tract < 1
    || !Number.isSafeInteger(receipt.data.unit_count?.['fixed-grid']) || receipt.data.unit_count['fixed-grid'] < 1
    || !Number.isSafeInteger(receipt.data.mart_rows) || receipt.data.mart_rows < 1
    || !isIsoDateOrTimestamp(receipt.data.complete_week_end_exclusive)) throw new Error('M2 coverage or data semantics drift');
  for (const field of ['primary_by_fold_space_holdout', 'by_category', 'by_data_volume']) {
    const rows = receipt.metrics?.[field];
    if (!Array.isArray(rows) || !rows.length || rows.some((row) => !isPlainRecord(row) || typeof row.model !== 'string' || !row.model || typeof row.fold !== 'string' || !row.fold)) throw new Error(`M2 metrics ${field} semantics drift`);
  }
}

function validateM3SourceSmokeReceipt(receipt) {
  if (!isExactTimestamp(receipt.generatedAt) || !['partial', 'unavailable'].includes(receipt.status)
    || !Array.isArray(receipt.observations) || receipt.observations.length !== FROZEN_HOME_COMPARE_SOURCES.length
    || !Array.isArray(receipt.limitations) || !receipt.limitations.length
    || receipt.limitations.some((value) => typeof value !== 'string' || !value.trim())) throw new Error('M3 source-smoke header semantics drift');
  if (!isPlainRecord(receipt.routing) || receipt.routing.status !== 'unavailable'
    || receipt.routing.road?.status !== 'unavailable' || receipt.routing.transit?.status !== 'unavailable'
    || !Array.isArray(receipt.routing.forbidden_substitutes) || !receipt.routing.forbidden_substitutes.length) throw new Error('M3 routing promotion boundary drift');
  if (!isPlainRecord(receipt.privacy)
    || !sameList(receipt.privacy.runtime_only_fields, FROZEN_M3_PRIVACY.runtime_only_fields)
    || !sameList(receipt.privacy.forbidden_tracked_or_shareable_fields, FROZEN_M3_PRIVACY.forbidden_tracked_or_shareable_fields)) throw new Error('M3 privacy boundary drift');
  const sources = new Map(FROZEN_HOME_COMPARE_SOURCES.map((source) => [source.id, source]));
  const seen = new Set();
  for (const observation of receipt.observations) {
    const source = sources.get(observation?.sourceId);
    if (!source || seen.has(source.id) || observation.dataset !== source.dataset || observation.transport !== source.transport) throw new Error('M3 frozen source identity drift');
    seen.add(source.id);
    validateHomeCompareSourceObservation(observation, source);
  }
}

function validateM4HandoffReceipt(receipt) {
  if (!isPlainRecord(receipt.dataQuality) || !isPlainRecord(receipt.lineage) || !isPlainRecord(receipt.consent)
    || typeof receipt.corridorIdentity !== 'string' || !receipt.corridorIdentity.trim() || Array.isArray(receipt.corridorIdentity)) throw new Error('M4 DQ, lineage, consent, or corridor identity type drift');
  const accumulator = receipt.accumulator;
  if (!isPlainRecord(accumulator) || !Number.isSafeInteger(accumulator.rowsRead) || accumulator.rowsRead < 0
    || !Number.isSafeInteger(accumulator.eligibleGeneralizedRows) || accumulator.eligibleGeneralizedRows < 0
    || !Number.isSafeInteger(accumulator.contributingRows) || accumulator.contributingRows < 0
    || !isPlainRecord(accumulator.excluded) || !Array.isArray(accumulator.segments) || !accumulator.segments.length
    || Object.keys(accumulator.excluded).sort().join('|') !== 'ambiguousNonAdjacent|categoryUnavailable|coordinateUnavailable|malformed|nonActive|outsideUncertaintyCorridor|precisionUnavailable'
    || Object.values(accumulator.excluded).some((value) => !Number.isSafeInteger(value) || value < 0)
    || accumulator.segments.some((segment) => !isPlainRecord(segment)
      || typeof segment.analysisSegmentId !== 'string' || !/^segment-\d{3}$/.test(segment.analysisSegmentId)
      || typeof segment.streetLabel !== 'string' || !segment.streetLabel
      || !Number.isFinite(segment.contributionUnits) || segment.contributionUnits < 0
      || !Number.isSafeInteger(segment.contributingRows) || segment.contributingRows < 0
      || !Array.isArray(segment.categories)
      || segment.categories.some((entry) => !Array.isArray(entry) || entry.length !== 2
        || typeof entry[0] !== 'string' || !entry[0] || !Number.isFinite(entry[1]) || entry[1] < 0))) throw new Error('M4 accumulator semantics drift');
  if (!isPlainRecord(receipt.completion) || !['complete', 'completed'].includes(receipt.completion.state)
    || !isExactTimestamp(receipt.completion.completedAt)
    || !Number.isSafeInteger(receipt.completion.durationMs) || receipt.completion.durationMs < 0
    || !Number.isSafeInteger(receipt.completion.maximumRssBytes) || receipt.completion.maximumRssBytes < 0
    || !Number.isSafeInteger(receipt.completion.resumedPartitions) || receipt.completion.resumedPartitions < 0) throw new Error('M4 completion semantics drift');
}

function isSafeRelativeJsonPath(value) {
  return typeof value === 'string' && value.endsWith('.json') && !value.startsWith('/') && !value.includes('\\')
    && value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function isIsoDateOrTimestamp(value) {
  return isExactTimestamp(value) || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value));
}

function hasExactKeys(value, keys) {
  return isPlainRecord(value) && sameList(Object.keys(value).sort(), [...keys].sort());
}

function validM2Admission(value) {
  if (!hasExactKeys(value, ['canonical_rows_seen', 'tract', 'fixed-grid', 'unknown_category', 'invalid_event_time', 'non_active'])
    || !hasExactKeys(value.tract, ['admitted', 'ambiguous_excluded', 'unmapped_excluded'])
    || !hasExactKeys(value['fixed-grid'], ['admitted', 'unavailable_excluded'])) return false;
  const integers = [value.canonical_rows_seen, value.tract.admitted, value.tract.ambiguous_excluded,
    value.tract.unmapped_excluded, value['fixed-grid'].admitted, value['fixed-grid'].unavailable_excluded,
    value.unknown_category, value.invalid_event_time, value.non_active];
  return integers.every((number) => Number.isSafeInteger(number) && number >= 0)
    && value.canonical_rows_seen > 0 && value.tract.admitted > 0 && value['fixed-grid'].admitted > 0;
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

function receiptDqSummary(phaseId, receipt) {
  if (phaseId === 'M1') return { latestQualityReport: receipt.latest_quality_report };
  if (phaseId === 'M2') return structuredClone(receipt.data.admission);
  if (phaseId === 'M3') return receipt.observations.map(({ sourceId, dq }) => ({ sourceId, dq: [...dq] }));
  if (phaseId === 'M4') return structuredClone(receipt.dataQuality);
  return null;
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
  const candidate = candidateTipsForAuthority(phase);
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
    || receipt.candidate?.cumulativeTip !== phase.cumulativeTip) throw new Error('review candidate tip binding drift');
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
    if (receipt.accepted1D?.cumulativeTip !== oneD.cumulativeTip
      || receipt.accepted1D?.reviewedTip !== oneD.reviewedTip
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
      candidate: candidateTipsForAuthority(phase),
    })) return false;
    return receipt.target?.phase === phase.phase
      && receipt.target?.ignoredRoot === phase.ignoredRoot
      && sameList(receipt.prerequisites, phasePolicy.retention.deletePrerequisites)
      && isExactTimestamp(receipt.decidedAt)
      && isExactTimestamp(receipt.decision?.decidedAt)
      && receipt.target?.schema === producerEvidence?.schema
      && sameRecord(receipt.target?.identity, producerEvidence?.identity)
      && sameRecord(receipt.target?.revision, producerEvidence?.revision)
      && sameRecord(receipt.target?.dq, receiptDqSummary(phase.phase, producerEvidence?.receipt))
      && sameRecord(receipt.target?.candidate, candidateTipsForAuthority(phase));
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
