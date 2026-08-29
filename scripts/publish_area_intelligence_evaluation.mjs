#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  validateAreaIntelligenceEvaluationCheckpoint,
  validateAreaIntelligenceEvaluationManifest,
  validateAreaIntelligenceEvaluationServingArtifact,
  validateAreaIntelligenceMartForEvaluation,
  validateModelEvaluationReport,
} from './lib/area_intelligence_evaluation.mjs';
import {
  AREA_INTELLIGENCE_SERVING_SCHEMA,
  validateAreaIntelligenceServingCandidate,
} from '../src/area_intelligence/serving_contract.js';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), '..');
const M1_RECEIPT_SCHEMA = 'engagement-phl-crime-warehouse-receipt/v3';
const EVALUATION_ARTIFACTS = Object.freeze([
  'bias-error-audit.json',
  'data-lineage-summary.json',
  'model-card.md',
  'model-evaluation-report.json',
  'model-state.json',
  'residual-map.json',
  'serving-artifact.json',
]);
const PUBLIC_PROJECTION_PATH = 'public/data/area_intelligence_baseline.v2.json';

export async function publishAreaIntelligenceEvaluation({
  repositoryRoot = defaultRoot,
  evaluationRoot,
  protocolPath,
  martRoot,
  m1ReceiptPath,
  testHooks = {},
} = {}) {
  const root = path.resolve(repositoryRoot);
  const evaluation = path.resolve(evaluationRoot || path.join(root, '.dfev1/area-intelligence/m2-baseline/evaluation'));
  const protocolFile = path.resolve(protocolPath || path.join(root, 'scripts/data/area_intelligence_evaluation_protocol.v2.json'));
  const mart = path.resolve(martRoot || path.dirname(evaluation));
  if (!m1ReceiptPath) throw new Error('Area Intelligence publication requires --m1-receipt=<exact receipt.json>.');
  const receiptFile = path.resolve(m1ReceiptPath);

  const martContext = await validateAreaIntelligenceMartForEvaluation({ martRoot: mart, protocolPath: protocolFile });
  const manifestPath = path.join(evaluation, 'manifest.json');
  const checkpointPath = path.join(evaluation, 'checkpoint.json');
  await Promise.all([
    assertRealFile(manifestPath, 'evaluation manifest'),
    assertRealFile(checkpointPath, 'evaluation checkpoint'),
    assertRealFile(receiptFile, 'M1 receipt'),
    assertRealFile(protocolFile, 'evaluation protocol'),
  ]);
  const [manifestBytes, checkpointBytes, receiptBytes] = await Promise.all([
    fs.readFile(manifestPath),
    fs.readFile(checkpointPath),
    fs.readFile(receiptFile),
  ]);
  const manifest = parseJson(manifestBytes, 'evaluation manifest');
  const checkpoint = parseJson(checkpointBytes, 'evaluation checkpoint');
  const m1Receipt = parseJson(receiptBytes, 'M1 receipt');
  const artifactBytes = await validateEvaluationArtifactBindings(evaluation, manifest);
  const report = parseJson(artifactBytes.get('model-evaluation-report.json'), 'model evaluation report');
  const evaluationServingArtifact = parseJson(artifactBytes.get('serving-artifact.json'), 'evaluation serving artifact');
  const manifestIdentity = sha256(manifestBytes);
  const m1ReceiptSha256 = digest(receiptBytes);

  validateAreaIntelligenceEvaluationCheckpoint(checkpoint, {
    protocolIdentity: martContext.protocolIdentity,
    martManifestIdentity: martContext.martManifestIdentity,
    martArtifactIdentity: martContext.martManifest.artifact_identity,
    receiptSha256: martContext.protocol.exact_input_gate.receipt_sha256,
    protocol: martContext.protocol,
    report,
  });
  validateModelEvaluationReport(report, {
    protocol: martContext.protocol,
    martManifest: martContext.martManifest,
    martManifestIdentity: martContext.martManifestIdentity,
    checkpoint,
  });
  validateAreaIntelligenceEvaluationServingArtifact(evaluationServingArtifact, {
    report,
    protocol: martContext.protocol,
    martManifest: martContext.martManifest,
    martManifestIdentity: martContext.martManifestIdentity,
    checkpoint,
  });
  validateAreaIntelligenceEvaluationManifest(manifest, {
    protocol: martContext.protocol,
    martManifest: martContext.martManifest,
    martManifestIdentity: martContext.martManifestIdentity,
    martInventory: martContext.martInventory,
    report,
    servingArtifact: evaluationServingArtifact,
    checkpoint,
  });
  validateM1ReceiptContext({
    receipt: m1Receipt,
    receiptBytes,
    protocol: martContext.protocol,
    manifest,
    martManifest: martContext.martManifest,
    report,
  });

  const context = {
    protocol: martContext.protocol,
    manifest,
    manifestIdentity,
    martManifest: martContext.martManifest,
    martManifestIdentity: martContext.martManifestIdentity,
    m1Receipt,
    m1ReceiptSha256,
    report,
    checkpoint,
  };
  const projection = createAreaIntelligencePublicProjection(context);
  return publishValidatedAreaIntelligenceProjection({
    repositoryRoot: root,
    projection,
    context,
    testHooks,
  });
}

export function createAreaIntelligencePublicProjection(context) {
  const { protocol, manifest, manifestIdentity, martManifest, martManifestIdentity, m1Receipt, m1ReceiptSha256, report } = context;
  const decision = report.promotion.decision;
  const failedIntervalSliceCount = countFailedIntervalSlices(report, protocol);
  const intervalPassed = failedIntervalSliceCount === 0;
  const reason = decision === 'local-candidate'
    ? 'local-candidate-has-no-serving-authority'
    : 'promotion-gate-not-passed';
  const projection = {
    schema: AREA_INTELLIGENCE_SERVING_SCHEMA,
    generated_at: report.generated_at,
    status: 'not-promoted',
    historical_evidence: {
      status: 'available',
      measure: protocol.target.measure,
      source_as_of: m1Receipt.clocks.source_as_of,
      source_vintage: report.data.source_vintage,
      coverage: {
        earliest_scope_start: report.data.coverage.earliest_scope_start,
        latest_scope_end_exclusive: report.data.coverage.latest_scope_end_exclusive,
        complete_week_end_exclusive: report.data.complete_week_end_exclusive,
      },
      method: {
        grain: protocol.target.grain,
        week_definition: protocol.target.week_definition,
        unit_types: [...protocol.marts.unit_types],
        spatial_holdout_from_count_model_training: protocol.spatial_holdout.training_policy
          === 'Poisson and negative-binomial fits exclude held-out blocks',
        incomplete_source_week_excluded: protocol.target.exclude_incomplete_source_week,
        ambiguous_or_unavailable_spatial_assignments_excluded: protocol.admission.ambiguous_or_unavailable
          === 'exclude-and-audit-never-force-assign',
      },
    },
    forecast: { status: 'unavailable', reason, predictions: [] },
    evaluation: {
      promotion_status: 'not-promoted',
      decision,
      selected_model: null,
      local_candidate_model: report.promotion.local_candidate_model,
      local_candidate_only: true,
      interval_90_outcome: {
        passed: intervalPassed,
        failed_primary_slice_count: failedIntervalSliceCount,
      },
      why_unavailable: {
        code: reason,
        reason_codes: [
          decision === 'local-candidate' ? 'local-candidate-only' : 'promotion-gate-not-passed',
          ...(intervalPassed ? [] : ['primary-interval-90-gate-not-passed']),
          'serving-authority-unavailable',
        ],
      },
    },
    authority: structuredClone(protocol.authority),
    privacy: structuredClone(protocol.privacy),
    lineage: {
      protocol: { schema: protocol.schema, sha256: report.protocol.sha256 },
      evaluation: { schema: manifest.schema, manifest_sha256: manifestIdentity },
      mart: {
        schema: martManifest.schema,
        manifest_sha256: martManifestIdentity,
        artifact_identity: martManifest.artifact_identity,
        part_bindings_identity: martManifest.part_bindings_identity,
      },
      m1_receipt: { schema: m1Receipt.schema, identity: m1Receipt.identity, sha256: m1ReceiptSha256 },
    },
    forbidden_claims: structuredClone(protocol.forbidden_claims),
  };
  return validateAreaIntelligenceServingCandidate(projection, context);
}

export async function publishValidatedAreaIntelligenceProjection({
  repositoryRoot,
  projection,
  context = {},
  testHooks = {},
} = {}) {
  const root = path.resolve(repositoryRoot || defaultRoot);
  if (!context || Object.keys(context).length === 0) {
    throw new Error('Area Intelligence publication requires the exact validated P3 external context.');
  }
  const validated = validateAreaIntelligenceServingCandidate(projection, context);
  const contents = Buffer.from(`${JSON.stringify(validated)}\n`);
  assertProjectionSafe(contents.toString('utf8'));
  const publicationPath = await preparePublicationDestination(root, PUBLIC_PROJECTION_PATH);
  const { destination } = publicationPath;
  await assertSafePublicationParent(publicationPath);
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  await fs.writeFile(temporary, contents, { flag: 'wx' });
  const temporaryIdentity = await fileIdentity(temporary, 'publication temporary file');
  let publication;
  try {
    publication = await commitNoOverwritePublication([{
      ...publicationPath,
      temporary,
      temporaryIdentity,
      contents,
    }], testHooks);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  return {
    status: publication.idempotent ? 'verified-existing-public-projection' : 'published-local-serving-candidate',
    promotion: 'not-promoted',
    idempotent: publication.idempotent,
    files: [{ path: PUBLIC_PROJECTION_PATH, bytes: contents.length }],
    lineage: structuredClone(validated.lineage),
    boundary: 'Local public projection only; not main, remote CI, runtime deployment, forecast authority, or scientific validity.',
  };
}

async function validateEvaluationArtifactBindings(evaluationRoot, manifest) {
  if (!Array.isArray(manifest?.artifacts)) throw new Error('Area Intelligence evaluation manifest is invalid or incomplete.');
  const records = new Map();
  for (const artifact of manifest.artifacts) {
    if (!isRecord(artifact)
      || !EVALUATION_ARTIFACTS.includes(artifact.name)
      || records.has(artifact.name)
      || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1
      || !hashHex(artifact.sha256)) {
      throw new Error('Area Intelligence evaluation artifact binding is invalid, duplicated, or hostile.');
    }
    records.set(artifact.name, artifact);
  }
  if (stableSerialization([...records.keys()].sort()) !== stableSerialization([...EVALUATION_ARTIFACTS].sort())) {
    throw new Error('Area Intelligence evaluation artifact set is missing or ambiguous.');
  }
  const bytesByName = new Map();
  for (const name of EVALUATION_ARTIFACTS) {
    const source = path.resolve(evaluationRoot, name);
    if (!isInsideOrEqual(evaluationRoot, source)) throw new Error('Area Intelligence evaluation artifact escaped its root.');
    const stat = await fs.lstat(source);
    const bytes = await fs.readFile(source);
    const binding = records.get(name);
    if (!stat.isFile() || stat.isSymbolicLink() || bytes.length !== binding.bytes || sha256(bytes) !== binding.sha256) {
      throw new Error(`Area Intelligence evaluation artifact identity mismatch: ${name}`);
    }
    bytesByName.set(name, bytes);
  }
  return bytesByName;
}

function validateM1ReceiptContext({ receipt, receiptBytes, protocol, manifest, martManifest, report }) {
  const receiptCore = structuredClone(receipt);
  delete receiptCore.identity;
  if (receipt?.schema !== M1_RECEIPT_SCHEMA
    || digest(receiptBytes) !== protocol.exact_input_gate.receipt_sha256
    || receipt.identity !== protocol.exact_input_gate.receipt_identity
    || identityOf(receiptCore) !== receipt.identity
    || martManifest.exact_input?.receipt_identity !== receipt.identity
    || martManifest.exact_input?.receipt_sha256 !== digest(receiptBytes)
    || manifest.lineage_seam?.m1_receipt?.identity !== receipt.identity
    || manifest.lineage_seam?.m1_receipt?.sha256 !== digest(receiptBytes)
    || receipt.warehouse?.current_snapshot_id !== report.data?.source_vintage
    || receipt.coverage?.start !== report.data?.coverage?.earliest_scope_start
    || receipt.coverage?.end_exclusive !== report.data?.coverage?.latest_scope_end_exclusive
    || typeof receipt.clocks?.source_as_of !== 'string'
    || receipt.authority?.serving_authority !== false
    || receipt.serving_eligible !== false) {
    throw new Error('Area Intelligence M1 receipt identity, coverage, clock, or authority drifted.');
  }
}

async function commitNoOverwritePublication(staged, testHooks) {
  try {
    const states = await Promise.all(staged.map(async (record) => {
      const existing = await readPublicationFileIfExists(record);
      if (!existing) return 'missing';
      return Buffer.compare(existing, record.contents) === 0 ? 'equal' : 'different';
    }));
    if (states.includes('different')) {
      throw new Error('Area Intelligence publication refuses to overwrite a different existing projection.');
    }
    if (states.every((state) => state === 'equal')) {
      await Promise.all(staged.map(({ temporary }) => fs.rm(temporary, { force: true })));
      return { idempotent: true };
    }
    if (states.some((state) => state === 'equal')) {
      throw new Error('Area Intelligence publication destination set is partial or ambiguous.');
    }
    const installed = [];
    try {
      for (const record of staged) {
        await assertSafePublicationParent(record);
        await fs.link(record.temporary, record.destination);
        installed.push(record);
        const unlinkTemporary = testHooks.unlinkTemporary ?? fs.unlink;
        await unlinkTemporary(record.temporary);
        await testHooks.afterInstall?.({ installed: installed.length, destination: record.destination });
      }
    } catch (failure) {
      const rollback = await Promise.allSettled([...installed].reverse().map(rollbackInstalledLink));
      const rollbackErrors = rollback.filter(({ status }) => status === 'rejected').map(({ reason }) => reason);
      if (rollbackErrors.length) {
        throw new AggregateError([failure, ...rollbackErrors], 'Area Intelligence publication failed and rollback was incomplete.');
      }
      throw failure;
    }
    return { idempotent: false };
  } finally {
    await Promise.allSettled(staged.map(({ temporary }) => fs.rm(temporary, { force: true })));
  }
}

async function rollbackInstalledLink(record) {
  const current = await fileIdentityIfExists(record.destination);
  if (!current) return;
  if (!sameFileIdentity(current, record.temporaryIdentity)) {
    throw new Error('Area Intelligence rollback refused to remove a destination no longer bound to this publication.');
  }
  await fs.rm(record.destination);
}

function assertProjectionSafe(contents) {
  if (/(?:aggregate_primary|primary_by_fold|by_category|by_data_volume|residual[-_]?map|model[-_]?state|area[-_]?order(?:ing)?|"unit_id"|"event_id"|"raw_row")/i.test(contents)) {
    throw new Error('Area Intelligence public projection contains non-allowlisted metrics, ordering, model state, or private data.');
  }
}

function countFailedIntervalSlices(report, protocol) {
  const eligible = new Set(protocol.promotion_gate?.eligible_models || []);
  const bounds = protocol.promotion_gate?.acceptable_interval_coverage_inclusive;
  if (!Array.isArray(bounds) || bounds.length !== 2
    || !bounds.every(Number.isFinite)
    || !Array.isArray(report.metrics?.primary_by_fold_space_holdout)) {
    throw new Error('Area Intelligence 90% interval gate context is incomplete.');
  }
  return report.metrics.primary_by_fold_space_holdout.filter((row) => (
    eligible.has(row?.model)
      && (!Number.isFinite(row.prediction_interval_90_coverage)
        || row.prediction_interval_90_coverage < bounds[0]
        || row.prediction_interval_90_coverage > bounds[1])
  )).length;
}

async function preparePublicationDestination(repositoryRoot, relative) {
  if (typeof relative !== 'string'
    || path.posix.isAbsolute(relative)
    || path.win32.isAbsolute(relative)
    || relative.includes('\\')
    || relative.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Area Intelligence publication path is not a safe repository-relative path.');
  }
  const root = path.resolve(repositoryRoot);
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('Area Intelligence publication repository root must be a real directory.');
  }
  const rootReal = await fs.realpath(root);
  if (!pathsEqual(root, rootReal)) {
    throw new Error('Area Intelligence publication repository root resolves through a reparse point.');
  }
  const parts = relative.split('/');
  const destination = path.resolve(rootReal, ...parts);
  if (!isInsideOrEqual(rootReal, destination)) {
    throw new Error('Area Intelligence publication destination escaped the repository root.');
  }
  let current = rootReal;
  for (const part of parts.slice(0, -1)) {
    const next = path.join(current, part);
    let stat;
    try {
      stat = await fs.lstat(next);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await assertDirectoryIdentity(current);
      await fs.mkdir(next);
      stat = await fs.lstat(next);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Area Intelligence publication path contains a symlink, junction, or non-directory segment.');
    }
    const real = await fs.realpath(next);
    if (!pathsEqual(next, real)) {
      throw new Error('Area Intelligence publication path contains a reparse or redirected segment.');
    }
    current = next;
  }
  const publicationPath = { root: rootReal, parent: current, destination };
  await assertSafePublicationParent(publicationPath);
  await assertSafeDestinationIfPresent(publicationPath);
  return publicationPath;
}

async function assertSafePublicationParent({ root, parent, destination }) {
  if (!isInsideOrEqual(root, parent) || !isInsideOrEqual(root, destination)) {
    throw new Error('Area Intelligence publication path escaped its canonical repository root.');
  }
  const relative = path.relative(root, parent);
  let current = root;
  await assertDirectoryIdentity(current);
  for (const part of relative ? relative.split(path.sep) : []) {
    current = path.join(current, part);
    await assertDirectoryIdentity(current);
  }
}

async function assertDirectoryIdentity(directory) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Area Intelligence publication directory became a symlink, junction, or non-directory.');
  }
  const real = await fs.realpath(directory);
  if (!pathsEqual(directory, real)) {
    throw new Error('Area Intelligence publication directory resolves through a reparse point.');
  }
}

async function assertSafeDestinationIfPresent(record) {
  let stat;
  try {
    stat = await fs.lstat(record.destination);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Area Intelligence publication destination is a symlink, junction, or non-file.');
  }
  const real = await fs.realpath(record.destination);
  if (!pathsEqual(record.destination, real)) {
    throw new Error('Area Intelligence publication destination resolves through a reparse point.');
  }
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Area Intelligence ${label} is not valid JSON: ${error.message}`);
  }
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function hashHex(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function digest(value) {
  return `sha256:${sha256(value)}`;
}

function identityOf(value) {
  return digest(Buffer.from(stableSerialization(value)));
}

function stableSerialization(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialization).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialization(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isInsideOrEqual(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function readPublicationFileIfExists(record) {
  await assertSafePublicationParent(record);
  let before;
  try {
    before = await fileIdentity(record.destination, 'existing publication destination');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  await assertSafeDestinationIfPresent(record);
  const bytes = await fs.readFile(record.destination);
  const after = await fileIdentity(record.destination, 'existing publication destination');
  if (!sameFileIdentity(before, after)) {
    throw new Error('Area Intelligence publication destination changed while it was inspected.');
  }
  return bytes;
}

async function fileIdentityIfExists(filePath) {
  try {
    return await fileIdentity(filePath, 'publication destination');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function fileIdentity(filePath, label) {
  const stat = await fs.lstat(filePath, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Area Intelligence ${label} is not a real file.`);
  }
  return { dev: stat.dev, ino: stat.ino, size: stat.size };
}

function sameFileIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino && left?.size === right?.size;
}

function pathsEqual(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function assertRealFile(filePath, label) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Area Intelligence ${label} must be a real file.`);
  }
}

function parseArgs(values) {
  return Object.fromEntries(values.map((entry) => {
    if (!entry.startsWith('--') || !entry.includes('=')) throw new Error(`Invalid argument: ${entry}`);
    const separator = entry.indexOf('=');
    return [entry.slice(2, separator), entry.slice(separator + 1)];
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) {
  const args = parseArgs(process.argv.slice(2));
  const result = await publishAreaIntelligenceEvaluation({
    repositoryRoot: defaultRoot,
    evaluationRoot: args.evaluation,
    protocolPath: args.protocol,
    martRoot: args.mart,
    m1ReceiptPath: args['m1-receipt'],
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
