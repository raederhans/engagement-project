#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { validateModelEvaluationReport } from './lib/area_intelligence_evaluation.mjs';
import {
  validateAreaIntelligenceServingArtifact,
  validateAreaIntelligenceServingCandidate,
} from '../src/area_intelligence/serving_contract.js';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), '..');
const PROTOCOL_SCHEMA = 'engagement-area-intelligence-evaluation-protocol/v2';
const EVALUATION_MANIFEST_SCHEMA = 'engagement-area-intelligence-evaluation-run/v2';
const LINEAGE_SEAM_SCHEMA = 'engagement-area-intelligence-lineage-seam/v1';
const MART_SCHEMA = 'engagement-area-intelligence-feature-mart/v2';
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
const PUBLICATION = Object.freeze([
  ['model-evaluation-report.json', 'reports/area-intelligence/model-evaluation-report.v1.json'],
  ['residual-map.json', 'reports/area-intelligence/residual-map.v1.json'],
  ['bias-error-audit.json', 'reports/area-intelligence/bias-error-audit.v1.json'],
  ['data-lineage-summary.json', 'reports/area-intelligence/data-lineage-summary.v1.json'],
  ['model-card.md', 'reports/area-intelligence/model-card.md'],
  ['serving-artifact.json', 'public/data/area_intelligence_baseline.v1.json'],
]);

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

  const manifestPath = path.join(evaluation, 'manifest.json');
  const [manifestBytes, protocolBytes, martManifestBytes, receiptBytes] = await Promise.all([
    fs.readFile(manifestPath),
    fs.readFile(protocolFile),
    fs.readFile(path.join(mart, 'manifest.json')),
    fs.readFile(receiptFile),
  ]);
  const manifest = parseJson(manifestBytes, 'evaluation manifest');
  const protocol = parseJson(protocolBytes, 'evaluation protocol');
  const martManifest = parseJson(martManifestBytes, 'mart manifest');
  const m1Receipt = parseJson(receiptBytes, 'M1 receipt');
  const artifactBytes = await validateEvaluationArtifacts(evaluation, manifest);
  const report = parseJson(artifactBytes.get('model-evaluation-report.json'), 'model evaluation report');
  const rawServing = parseJson(artifactBytes.get('serving-artifact.json'), 'serving artifact');
  validateModelEvaluationReport(report);
  validateAreaIntelligenceServingArtifact(rawServing);

  const lineage = await validatePublicationLineage({
    manifest,
    manifestBytes,
    protocol,
    protocolBytes,
    mart,
    martManifest,
    martManifestBytes,
    m1Receipt,
    receiptBytes,
    report,
    rawServing,
  });
  const serving = createServingCandidate({ rawServing, report, m1Receipt, lineage });
  validateAreaIntelligenceServingCandidate(serving);

  const contentsBySource = new Map(artifactBytes);
  contentsBySource.set('serving-artifact.json', Buffer.from(`${JSON.stringify(serving)}\n`));
  const staged = [];
  try {
    for (const [sourceName, destinationName] of PUBLICATION) {
      const contents = contentsBySource.get(sourceName);
      assertPrivacySafe(contents.toString('utf8'), sourceName);
      const destination = resolvePublicationDestination(root, destinationName);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
      await fs.writeFile(temporary, contents);
      staged.push({ destination, temporary, bytes: contents.length });
    }
    await commitPublication(staged, testHooks);
  } catch (error) {
    await Promise.allSettled(staged.map(({ temporary }) => fs.rm(temporary, { force: true })));
    throw error;
  }

  return {
    status: 'published-local-serving-candidate',
    promotion: manifest.promotion.status,
    files: staged.map((item) => ({
      path: path.relative(root, item.destination).replaceAll('\\', '/'),
      bytes: item.bytes,
    })),
    lineage,
    boundary: 'Local tracked artifacts only; not main, remote CI, runtime deployment, or scientific validity.',
  };
}

async function validateEvaluationArtifacts(evaluationRoot, manifest) {
  if (manifest?.schema !== EVALUATION_MANIFEST_SCHEMA || !Array.isArray(manifest.artifacts)) {
    throw new Error('Area Intelligence evaluation manifest is invalid or incomplete.');
  }
  const records = new Map();
  for (const artifact of manifest.artifacts) {
    if (!isRecord(artifact)
      || typeof artifact.name !== 'string'
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
    assertPrivacySafe(bytes.toString('utf8'), name);
    bytesByName.set(name, bytes);
  }
  return bytesByName;
}

async function validatePublicationLineage({
  manifest,
  manifestBytes,
  protocol,
  protocolBytes,
  mart,
  martManifest,
  martManifestBytes,
  m1Receipt,
  receiptBytes,
  report,
  rawServing,
}) {
  const seam = manifest.lineage_seam;
  const protocolSha256 = sha256(protocolBytes);
  const martManifestSha256 = sha256(martManifestBytes);
  const receiptSha256 = digest(receiptBytes);
  if (!exactKeys(seam, ['schema', 'protocol', 'mart', 'm1_receipt', 'outcome'])
    || seam.schema !== LINEAGE_SEAM_SCHEMA
    || !exactKeys(seam.protocol, ['schema', 'sha256'])
    || !exactKeys(seam.mart, ['schema', 'manifest_sha256', 'artifact_identity', 'part_bindings_identity', 'part_count', 'row_count', 'bytes', 'parts'])
    || !Array.isArray(seam.mart?.parts)
    || seam.mart.parts.length === 0
    || !seam.mart.parts.every((part) => exactKeys(part, ['path', 'unit_type', 'partition', 'row_count', 'bytes', 'sha256']))
    || !exactKeys(seam.m1_receipt, ['schema', 'identity', 'sha256'])
    || !exactKeys(seam.outcome, ['promotion_status', 'selected_model', 'availability'])) {
    throw new Error('Area Intelligence evaluation lineage seam is invalid or ambiguous.');
  }
  if (protocol.schema !== PROTOCOL_SCHEMA
    || protocolSha256 !== seam.protocol.sha256
    || manifest.protocol_sha256 !== protocolSha256
    || protocol.exact_input_gate?.receipt_schema !== seam.m1_receipt.schema
    || protocol.exact_input_gate?.receipt_identity !== seam.m1_receipt.identity) {
    throw new Error('Area Intelligence protocol identity does not match the evaluation lineage seam.');
  }
  if (martManifest.schema !== MART_SCHEMA
    || martManifestSha256 !== seam.mart.manifest_sha256
    || manifest.mart_manifest_sha256 !== martManifestSha256
    || manifest.mart_artifact_identity !== seam.mart.artifact_identity
    || martManifest.artifact_identity !== seam.mart.artifact_identity
    || martManifest.part_bindings_identity !== seam.mart.part_bindings_identity
    || martManifest.protocol?.sha256 !== protocolSha256
    || martManifest.exact_input?.receipt_identity !== seam.m1_receipt.identity
    || martManifest.exact_input?.receipt_sha256 !== seam.m1_receipt.sha256) {
    throw new Error('Area Intelligence mart identity does not match the evaluation lineage seam.');
  }
  validateMartArtifactIdentity(martManifest);
  const martInventory = await validateMartPartBindings(mart, martManifest);
  if (stableSerialization(martInventory) !== stableSerialization({
    part_bindings_identity: seam.mart.part_bindings_identity,
    part_count: seam.mart.part_count,
    row_count: seam.mart.row_count,
    bytes: seam.mart.bytes,
    parts: seam.mart.parts,
  })) {
    throw new Error('Area Intelligence actual mart part bindings do not match the evaluation lineage seam.');
  }
  const receiptCore = structuredClone(m1Receipt);
  delete receiptCore.identity;
  if (m1Receipt.schema !== M1_RECEIPT_SCHEMA
    || m1Receipt.schema !== seam.m1_receipt.schema
    || receiptSha256 !== seam.m1_receipt.sha256
    || m1Receipt.identity !== seam.m1_receipt.identity
    || identityOf(receiptCore) !== m1Receipt.identity) {
    throw new Error('Area Intelligence M1 receipt identity does not match the evaluation lineage seam.');
  }
  const reportCoverage = report.data?.coverage;
  if (typeof m1Receipt.coverage?.start !== 'string'
    || typeof m1Receipt.coverage?.end_exclusive !== 'string'
    || typeof reportCoverage?.earliest_scope_start !== 'string'
    || typeof reportCoverage?.latest_scope_end_exclusive !== 'string'
    || reportCoverage.earliest_scope_start !== m1Receipt.coverage.start
    || reportCoverage.latest_scope_end_exclusive !== m1Receipt.coverage.end_exclusive
    || rawServing.historical_evidence?.source_vintage !== report.data?.source_vintage
    || stableSerialization(rawServing.historical_evidence?.coverage) !== stableSerialization(reportCoverage)) {
    throw new Error('Area Intelligence source vintage or coverage lineage is inconsistent.');
  }
  const expectedAvailability = manifest.promotion?.status === 'promoted' ? 'available' : 'unavailable';
  if (!['promoted', 'not-promoted'].includes(manifest.promotion?.status)
    || manifest.availability !== expectedAvailability
    || seam.outcome.promotion_status !== manifest.promotion.status
    || seam.outcome.selected_model !== (manifest.promotion.selected_model ?? null)
    || seam.outcome.availability !== expectedAvailability
    || report.promotion?.status !== manifest.promotion.status
    || (report.promotion.selected_model ?? null) !== seam.outcome.selected_model
    || report.protocol?.sha256 !== protocolSha256
    || report.data?.mart_manifest_sha256 !== martManifestSha256
    || report.data?.mart_artifact_identity !== seam.mart.artifact_identity
    || report.data?.source_vintage !== m1Receipt.source?.revision
    || rawServing.status !== manifest.promotion.status
    || rawServing.evaluation?.promotion_status !== manifest.promotion.status
    || (rawServing.evaluation?.selected_model ?? null) !== seam.outcome.selected_model
    || rawServing.evaluation?.protocol_sha256 !== protocolSha256
    || rawServing.generated_at !== manifest.generated_at
    || report.generated_at !== manifest.generated_at) {
    throw new Error('Area Intelligence evaluation outcome or report lineage is inconsistent.');
  }
  if (manifest.promotion.status === 'not-promoted'
    && (rawServing.forecast?.status !== 'unavailable' || rawServing.forecast.predictions?.length !== 0)) {
    throw new Error('Area Intelligence failed promotion must remain unavailable with empty predictions.');
  }
  if (manifest.promotion.status === 'promoted'
    && (rawServing.forecast?.status !== 'available' || !rawServing.forecast.predictions?.length)) {
    throw new Error('Area Intelligence promoted outcome lacks admitted predictions.');
  }
  return {
    protocol: structuredClone(seam.protocol),
    evaluation: { schema: manifest.schema, manifest_sha256: sha256(manifestBytes) },
    mart: {
      schema: seam.mart.schema,
      manifest_sha256: seam.mart.manifest_sha256,
      artifact_identity: seam.mart.artifact_identity,
      part_bindings_identity: seam.mart.part_bindings_identity,
    },
    m1_receipt: { schema: seam.m1_receipt.schema, identity: seam.m1_receipt.identity },
  };
}

async function validateMartPartBindings(martRoot, manifest) {
  if (!Array.isArray(manifest.parts) || manifest.parts.length === 0) {
    throw new Error('Area Intelligence mart has no admitted part bindings.');
  }
  const bindings = [];
  const declared = new Set();
  for (const part of manifest.parts) {
    if (!exactKeys(part, ['path', 'unit_type', 'partition', 'row_count', 'bytes', 'sha256'])
      || !/^marts\/(tract|fixed-grid)\/part-\d{3}\.jsonl$/.test(part.path || '')
      || part.path !== `marts/${part.unit_type}/part-${String(part.partition).padStart(3, '0')}.jsonl`
      || declared.has(part.path)
      || !Number.isSafeInteger(part.row_count) || part.row_count < 0
      || !Number.isSafeInteger(part.bytes) || part.bytes < 0
      || !hashHex(part.sha256)) {
      throw new Error('Area Intelligence mart part binding is invalid, duplicated, or hostile.');
    }
    declared.add(part.path);
    const filePath = path.resolve(martRoot, ...part.path.split('/'));
    if (!isInsideOrEqual(martRoot, filePath)) throw new Error('Area Intelligence mart part escaped its root.');
    const observed = await inspectJsonl(filePath);
    if (observed.row_count !== part.row_count || observed.bytes !== part.bytes || observed.sha256 !== part.sha256) {
      throw new Error(`Area Intelligence mart part binding drifted: ${part.path}`);
    }
    bindings.push({
      path: part.path,
      unit_type: part.unit_type,
      partition: part.partition,
      row_count: part.row_count,
      bytes: part.bytes,
      sha256: part.sha256,
    });
  }
  const actual = await listMartParts(path.join(martRoot, 'marts'), martRoot);
  if (stableSerialization(actual) !== stableSerialization([...declared].sort())) {
    throw new Error('Area Intelligence mart part set is partial or ambiguous.');
  }
  const result = {
    part_bindings_identity: identityOf(bindings),
    part_count: bindings.length,
    row_count: bindings.reduce((sum, part) => sum + part.row_count, 0),
    bytes: bindings.reduce((sum, part) => sum + part.bytes, 0),
    parts: bindings,
  };
  if (result.part_bindings_identity !== manifest.part_bindings_identity
    || result.row_count !== manifest.row_count
    || result.bytes !== manifest.bytes) {
    throw new Error('Area Intelligence mart aggregate part binding identity drifted.');
  }
  return result;
}

function createServingCandidate({ rawServing, report, m1Receipt, lineage }) {
  const candidate = {
    schema: rawServing.schema,
    generated_at: rawServing.generated_at,
    status: rawServing.status,
    historical_evidence: {
      ...structuredClone(rawServing.historical_evidence),
      source_as_of: m1Receipt.clocks?.source_as_of,
      coverage: structuredClone(report.data.coverage),
      limitations: structuredClone(report.limitations),
    },
    forecast: structuredClone(rawServing.forecast),
    evaluation: {
      promotion_status: rawServing.evaluation.promotion_status,
      selected_model: rawServing.evaluation.selected_model,
      protocol_sha256: lineage.protocol.sha256,
    },
    lineage,
    forbidden_claims: structuredClone(rawServing.forbidden_claims),
  };
  if (candidate.status === 'not-promoted') candidate.forecast.reason = 'promotion-gate-not-passed';
  return candidate;
}

async function commitPublication(staged, testHooks) {
  const token = `${process.pid}-${randomUUID()}`;
  const records = staged.map((item) => ({ ...item, backup: `${item.destination}.bak-${token}`, backedUp: false, installed: false }));
  try {
    for (const record of records) {
      if (await exists(record.destination)) {
        await fs.rename(record.destination, record.backup);
        record.backedUp = true;
      }
    }
    let installed = 0;
    for (const record of records) {
      await fs.rename(record.temporary, record.destination);
      record.installed = true;
      installed += 1;
      await testHooks.afterInstall?.({ installed, destination: record.destination });
    }
  } catch (failure) {
    const rollbackErrors = [];
    for (const record of [...records].reverse()) {
      try {
        if (record.installed) await fs.rm(record.destination, { force: true });
        if (record.backedUp) await fs.rename(record.backup, record.destination);
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    await Promise.allSettled(records.map((record) => fs.rm(record.temporary, { force: true })));
    if (rollbackErrors.length) {
      throw new AggregateError([failure, ...rollbackErrors], 'Area Intelligence publication failed and rollback was incomplete.');
    }
    throw failure;
  }
  await Promise.all(records.filter(({ backedUp }) => backedUp).map(({ backup }) => fs.rm(backup, { force: true })));
}

function validateMartArtifactIdentity(manifest) {
  const core = structuredClone(manifest);
  delete core.artifact_identity;
  delete core.generated_at;
  if (manifest.artifact_identity !== identityOf(core)) {
    throw new Error('Area Intelligence mart artifact identity drifted from its manifest fields.');
  }
}

async function inspectJsonl(filePath) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Area Intelligence mart part is not a real file.');
  let rowCount = 0;
  const hash = createHash('sha256');
  const input = createReadStream(filePath);
  let pending = '';
  for await (const chunk of input) {
    hash.update(chunk);
    const text = pending + chunk.toString('utf8');
    const lines = text.split('\n');
    pending = lines.pop();
    rowCount += lines.filter(Boolean).length;
  }
  if (pending) rowCount += 1;
  return { row_count: rowCount, bytes: stat.size, sha256: hash.digest('hex') };
}

async function listMartParts(directory, martRoot) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Area Intelligence mart tree contains a symbolic link.');
    if (entry.isDirectory()) paths.push(...await listMartParts(absolute, martRoot));
    else if (entry.isFile() && /^part-\d{3}\.jsonl$/.test(entry.name)) {
      paths.push(path.relative(martRoot, absolute).replaceAll('\\', '/'));
    }
  }
  return paths.sort();
}

function assertPrivacySafe(contents, name) {
  if (/(?:[A-Za-z]:[\\/]+Users[\\/]+|file:\/\/\/|"(?:generalized_location|location_block|source_record_id|point_x|point_y|coordinates?|input_address|normalized_address|parcel_identifier)"\s*:)/i.test(contents)) {
    throw new Error(`Area Intelligence publication contains a forbidden local path or event/private field: ${name}`);
  }
}

function resolvePublicationDestination(root, relative) {
  const destination = path.resolve(root, ...relative.split('/'));
  if (!isInsideOrEqual(root, destination)) throw new Error('Area Intelligence publication destination escaped the repository root.');
  return destination;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Area Intelligence ${label} is not valid JSON: ${error.message}`);
  }
}

function exactKeys(value, keys) {
  return isRecord(value)
    && stableSerialization(Object.keys(value).sort()) === stableSerialization([...keys].sort());
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

async function exists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
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
