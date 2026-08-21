import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

export async function readJson(pathname) {
  return JSON.parse(await readFile(pathname, 'utf8'));
}

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

export async function evaluateHandoff({ policy, observation, inspectWorktree = inspectGitWorktree, readReceipt = readJson, resolveRef = resolveGitRef }) {
  const reasons = [];
  if (policy.schema !== 'engagement-phase1-handoff-policy/v2') reasons.push('policy schema drift');
  if (observation.schema !== 'engagement-phase1-handoff-observation/v1') reasons.push('observation schema drift');
  if (observation.policySchema !== policy.schema) reasons.push('observation policy binding drift');
  const policies = new Map(policy.phases.map((phase) => [phase.id, phase]));
  const observations = new Map(observation.phases.map((phase) => [phase.phase, phase]));
  const phaseResults = {};

  for (const [phaseId, phasePolicy] of policies) {
    const phase = observations.get(phaseId);
    const phaseReasons = [];
    if (!phase) phaseReasons.push('missing observation');
    else {
      for (const key of ['producerTask', 'owner', 'worktree', 'evidenceRoot', 'exactTip', 'expectedBase', 'actualMergeBase', 'ancestorResult', 'status', 'actualChangedPaths', 'artifactOwner', 'ignoredRoot', 'retention', 'implementationTip', 'recordTip', 'state']) {
        if (phase[key] == null) phaseReasons.push(`missing ${key}`);
      }
      if (phase.owner !== phasePolicy.owner) phaseReasons.push('owner drift');
      if (!phasePolicy.ignoredOutputRoots.includes(phase.ignoredRoot)) phaseReasons.push('ignored root drift');
      if (!phase.retention?.duration || !phase.retention?.triggerEvent || !phase.retention?.decisionOwner
          || !Array.isArray(phase.retention?.deletePrerequisites) || !phase.retention?.authorizationReceipt) phaseReasons.push('retention/delete authorization incomplete');
      try {
        const actual = await inspectWorktree(phase.worktree);
        if (actual.head !== phase.exactTip || actual.mergeBase !== phase.actualMergeBase || actual.main !== phase.expectedBase) phaseReasons.push('tip/topology drift');
        if (JSON.stringify(actual.status) !== JSON.stringify(phase.status.porcelain || [])) phaseReasons.push('worktree status drift');
        if (JSON.stringify(actual.changedPaths) !== JSON.stringify(phase.actualChangedPaths)) phaseReasons.push('changed-path drift');
      } catch { phaseReasons.push('tip/worktree is not resolvable'); }
      if (phase.implementationTip !== phase.exactTip) phaseReasons.push('implementation tip is not the observed exact tip');
      for (const key of ['exactTip', 'implementationTip', 'recordTip']) {
        if (phase[key] == null) continue;
        try { await resolveRef(phase.worktree, phase[key]); }
        catch { phaseReasons.push(`${key} is not resolvable`); }
      }
      if (phase.receipt?.availability === 'available') {
        try { validateReceipt(phaseId, phasePolicy, await readReceipt(phase.receipt.actualPath), phase.receipt); }
        catch (error) { phaseReasons.push(`receipt invalid: ${error.message}`); }
      } else {
        phaseReasons.push('receipt unavailable');
      }
      if (phase.state === 'accepted' && !phase.reviewedTip) phaseReasons.push('accepted observation has no reviewed tip');
      if (phase.reviewedTip != null) {
        try { await resolveRef(phase.worktree, phase.reviewedTip); }
        catch { phaseReasons.push('reviewedTip is not resolvable'); }
      }
      if (phase.state !== 'accepted') phaseReasons.push(`admission state is ${phase.state}`);
    }
    phaseResults[phaseId] = { status: phaseReasons.length ? 'blocked' : 'accepted', reasons: phaseReasons };
    reasons.push(...phaseReasons.map((reason) => `${phaseId}: ${reason}`));
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
  return { status: reasons.length ? 'blocked' : 'accepted', reasons, phases: phaseResults };
}

export function validateReceipt(phaseId, policy, receipt, observationReceipt = {}) {
  if (policy.receipt.schema && receipt.schema !== policy.receipt.schema) throw new Error('schema drift');
  for (const field of policy.receipt.requiredFields) if (readPath(receipt, field) == null) throw new Error(`missing ${field}`);
  const identity = Object.fromEntries(policy.receipt.identityFields.map((field) => [field, readPath(receipt, field)]));
  const revision = Object.fromEntries(policy.receipt.revisionFields.map((field) => [field, readPath(receipt, field)]));
  if (JSON.stringify(identity) !== JSON.stringify(observationReceipt.identity)) throw new Error('identity drift');
  if (JSON.stringify(revision) !== JSON.stringify(observationReceipt.revision)) throw new Error('revision drift');
  return { phaseId, identity, revision };
}

function readPath(value, dotted) {
  return dotted.split('.').reduce((current, key) => current?.[key], value);
}

function hasCycle(edges) {
  const nodes = new Set(edges.flat()); const visiting = new Set(); const seen = new Set();
  const visit = (node) => { if (visiting.has(node)) return true; if (seen.has(node)) return false; visiting.add(node); const cycle = edges.filter(([from]) => from === node).some(([, to]) => visit(to)); visiting.delete(node); seen.add(node); return cycle; };
  return [...nodes].some(visit);
}
