#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import readline from 'node:readline';
import { promisify } from 'node:util';

import { createKnownRouteEvidenceRequest } from '../src/routes_crime/known_route_evidence_contract.js';
import {
  matchKnownRouteToCenterline,
  requestPhiladelphiaCenterlineCatalog,
} from '../src/routes_crime/known_route_centerline.js';
import {
  addCanonicalGeneralizedIncident,
  createGeneralizedIncidentAccumulator,
} from '../src/routes_crime/known_route_contributions.js';
import { validateAreaIntelligenceMartForEvaluation } from './lib/area_intelligence_evaluation.mjs';
import { validateModelEvaluationReport } from './lib/area_intelligence_evaluation.mjs';
import {
  KNOWN_ROUTE_EVIDENCE_ALGORITHM_VERSION,
  createKnownRouteEvidenceCheckpoint,
  createKnownRouteEvidenceFinalHandoff,
  createSafeKnownRouteAggregateReport,
  identityOf,
  publishKnownRouteFinalArtifacts,
  recoverKnownRouteFinalTransaction,
  restoreKnownRouteEvidenceAccumulator,
  stableText,
  writeJsonAtomic,
} from './lib/known_route_evidence_checkpoint.mjs';

const execFileAsync = promisify(execFile);
const RECEIPT_SCHEMA = 'engagement-phl-crime-warehouse-receipt/v3';
const WAREHOUSE_SCHEMA = 'engagement-phl-crime-event-warehouse/v1';
const REQUIRED_RECEIPT_ARTIFACTS = Object.freeze([
  'warehouse_manifest',
  'backfill_checkpoint',
  'lineage_registry',
  'latest_quality_report',
  'latest_revision_report',
  'current_source_manifest',
]);
const DEFAULT_PROTOCOL_PATH = fileURLToPath(new URL('./data/area_intelligence_evaluation_protocol.v2.json', import.meta.url));

export async function runKnownRouteEvidenceBuild(rawOptions = {}, dependencies = {}) {
  const options = normalizeOptions(rawOptions);
  const outputRoot = path.resolve(options.output
    || path.join('.dfev1', 'known-route-evidence-v1', 'full-warehouse'));
  const routeFile = path.resolve(options.routeInput
    || path.join('.dfev1', 'known-route-evidence-v1', 'inputs', 'public-route.json'));
  requireTaskOwnedPath(outputRoot);
  requireTaskOwnedPath(routeFile);
  if (!options.allowPublicCenterlineRequest) {
    throw new Error('The full Known Route build requires --allow-public-centerline-request for the disclosed public fixture bbox request.');
  }

  const publicRoute = await readPublicRoute(routeFile);
  const normalizedRoute = createKnownRouteEvidenceRequest({
    routeInput: publicRoute.routeInput,
    transportMode: 'walking',
  });
  const requestCatalog = dependencies.requestCatalog || requestPhiladelphiaCenterlineCatalog;
  const catalog = await requestCatalog({ normalizedRoute, consent: true });
  if (catalog?.status === 'unavailable') throw new Error(`centerline-${catalog.reason}`);
  const match = matchKnownRouteToCenterline({ normalizedRoute, catalog });
  if (match.status !== 'matched') throw new Error(`map-match-${match.reason}`);

  const warehouseGate = await validateKnownRouteWarehouseInput({
    warehouseRoot: options.warehouse,
    expectedReceiptIdentity: options.warehouseReceiptIdentity,
  });
  const m2Governance = await validateM2Governance({
    evidenceRoot: options.m2EvidenceRoot,
    expectedMartIdentity: options.m2MartIdentity,
    implementationTip: options.m2ImplementationTip,
    executionRecordTip: options.m2ExecutionRecordTip,
    cumulativeTip: options.m2CumulativeTip,
    expectedM1ReceiptIdentity: warehouseGate.receipt.identity,
    expectedM1Revision: warehouseGate.receipt.warehouse.current_snapshot_id,
    expectedM1Coverage: warehouseGate.receipt.coverage,
    expectedM1Rows: warehouseGate.receipt.counts.canonical_rows,
    protocolPath: options.m2ProtocolPath || DEFAULT_PROTOCOL_PATH,
    validateMart: dependencies.validateMart,
    verifyTips: dependencies.verifyTips,
  });
  const expected = {
    warehouseIdentity: warehouseGate.receipt.identity,
    warehouseReceiptDigest: warehouseGate.receiptDigest,
    warehouseManifestIdentity: warehouseGate.manifestIdentity,
    partitionSetIdentity: warehouseGate.partitionSetIdentity,
    routeIdentity: identityOf({ sessionRouteIdentity: normalizedRoute.sessionRouteIdentity }),
    centerlineDataVersion: match.dataVersion,
    catalogIdentity: identityOf({ catalogIdentity: catalog.catalogIdentity }),
    corridorIdentity: match.corridorIdentity,
    algorithmVersion: KNOWN_ROUTE_EVIDENCE_ALGORITHM_VERSION,
    partitionCount: warehouseGate.partitions.length,
  };

  if (options.validateOnly) {
    return {
      status: 'validated',
      warehouse: warehouseGate.summary,
      m2: m2Governance.outcome,
      centerline: {
        dataVersion: match.dataVersion,
        catalogIdentity: catalog.catalogIdentity,
        corridorIdentity: match.corridorIdentity,
        matchedAnalysisSegmentCount: match.matchedEdges.length,
      },
    };
  }

  await fs.mkdir(outputRoot, { recursive: true });
  await recoverKnownRouteFinalTransaction(outputRoot);
  const checkpointPath = path.join(outputRoot, 'checkpoint.json');
  const reportPath = path.join(outputRoot, 'aggregate-report.json');
  const handoffPath = path.join(outputRoot, 'final-handoff.json');
  const runStarted = Date.now();
  let maximumRssBytes = process.memoryUsage().rss;
  const saved = await readJsonIfPresent(checkpointPath);
  const resumedPartitions = saved?.completedPartitions || 0;
  let checkpoint;
  let accumulator;
  if (saved) {
    accumulator = restoreKnownRouteEvidenceAccumulator(saved, {
      matchedEdges: match.matchedEdges,
      expected,
      verifiedPartitions: warehouseGate.partitions,
    });
    checkpoint = saved;
  } else {
    await requireFreshOutputRoot(outputRoot, [checkpointPath, reportPath, handoffPath]);
    accumulator = createGeneralizedIncidentAccumulator({ matchedEdges: match.matchedEdges });
    checkpoint = createKnownRouteEvidenceCheckpoint({
      ...expected,
      completedPartitions: 0,
      completedPartitionBindings: [],
      accumulator,
      startedAt: exactNow(dependencies.now),
    });
    await writeJsonAtomic(checkpointPath, checkpoint);
  }

  if (checkpoint.completion) {
    const artifacts = createFinalArtifacts({
      checkpoint,
      warehouseGate,
      match,
      catalog,
      accumulator,
      m2Governance,
    });
    await assertExactFinalArtifacts(outputRoot, artifacts);
    return buildResult({
      report: artifacts['aggregate-report.json'],
      handoff: artifacts['final-handoff.json'],
      checkpoint,
      outputRoot,
      restoredCompletedCheckpoint: true,
      idempotent: true,
    });
  }
  if (await pathExists(reportPath) || await pathExists(handoffPath)) {
    throw new Error('Known Route partial checkpoint cannot coexist with final artifacts.');
  }

  for (let partition = checkpoint.completedPartitions; partition < warehouseGate.partitions.length; partition += 1) {
    const binding = warehouseGate.partitions[partition];
    const rowsBefore = accumulator.rowsRead;
    await streamCanonicalPartition(binding.absolutePath, accumulator, partition);
    const rowsAdded = accumulator.rowsRead - rowsBefore;
    if (rowsAdded !== binding.rowCount) {
      throw new Error(`Canonical partition ${partition} row count changed after exact preflight.`);
    }
    maximumRssBytes = Math.max(maximumRssBytes, process.memoryUsage().rss);
    checkpoint = createKnownRouteEvidenceCheckpoint({
      ...expected,
      completedPartitions: partition + 1,
      completedPartitionBindings: warehouseGate.partitions.slice(0, partition + 1),
      accumulator,
      startedAt: checkpoint.startedAt,
    });
    await writeJsonAtomic(checkpointPath, checkpoint);
    dependencies.onProgress?.({ partition: partition + 1, partitionCount: warehouseGate.partitions.length, rowsAdded, rowsRead: accumulator.rowsRead });
  }

  if (accumulator.rowsRead !== warehouseGate.receipt.counts.canonical_rows) {
    throw new Error(`Full warehouse row count mismatch: ${accumulator.rowsRead}/${warehouseGate.receipt.counts.canonical_rows}.`);
  }
  maximumRssBytes = Math.max(maximumRssBytes, process.memoryUsage().rss);
  const completedAt = exactNow(dependencies.now);
  const completion = {
    state: 'complete',
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(checkpoint.startedAt), Date.now() - runStarted),
    maximumRssBytes,
    resumedPartitions,
  };
  checkpoint = createKnownRouteEvidenceCheckpoint({
    ...expected,
    completedPartitions: warehouseGate.partitions.length,
    completedPartitionBindings: warehouseGate.partitions,
    accumulator,
    startedAt: checkpoint.startedAt,
    completion,
  });
  const artifacts = createFinalArtifacts({
    checkpoint,
    warehouseGate,
    match,
    catalog,
    accumulator,
    m2Governance,
  });
  const publication = await publishKnownRouteFinalArtifacts({ outputRoot, artifacts });
  return buildResult({
    report: artifacts['aggregate-report.json'],
    handoff: artifacts['final-handoff.json'],
    checkpoint,
    outputRoot,
    restoredCompletedCheckpoint: false,
    idempotent: publication.idempotent,
  });
}

export async function validateKnownRouteWarehouseInput({ warehouseRoot, expectedReceiptIdentity } = {}) {
  if (!warehouseRoot || !digest(expectedReceiptIdentity)) {
    throw new Error('Known Route M1 preflight requires --warehouse and an exact receipt identity.');
  }
  const root = await canonicalDirectory(warehouseRoot, 'M1 warehouse root');
  const receiptArtifact = await readJsonArtifact(path.join(root, 'receipt.json'), 'M1 receipt');
  const receipt = receiptArtifact.value;
  const receiptEvidence = structuredClone(receipt);
  delete receiptEvidence.identity;
  if (receipt?.schema !== RECEIPT_SCHEMA
    || receipt.mode !== 'official-local-candidate'
    || receipt.serving_eligible !== false
    || receipt.identity !== identityOf(receiptEvidence)
    || receipt.identity !== expectedReceiptIdentity
    || receipt.authority?.producer_validated_local_candidate !== true
    || receipt.authority?.integration_authority !== false
    || receipt.authority?.serving_authority !== false
    || receipt.authority?.deletion_authority !== false) {
    throw new Error('Known Route M1 receipt/v3 identity or authority is invalid.');
  }
  const artifacts = receipt.artifacts || {};
  for (const name of REQUIRED_RECEIPT_ARTIFACTS) {
    if (!artifacts[name]) throw new Error(`Known Route M1 receipt lacks required artifact ${name}.`);
  }
  const bound = {};
  for (const name of REQUIRED_RECEIPT_ARTIFACTS) {
    bound[name] = await readBoundArtifact(root, artifacts[name], name);
  }
  const manifest = bound.warehouse_manifest.value;
  const checkpoint = bound.backfill_checkpoint.value;
  const lineage = bound.lineage_registry.value;
  const quality = bound.latest_quality_report.value;
  const revision = bound.latest_revision_report.value;
  const currentSource = bound.current_source_manifest.value;
  const snapshotId = receipt.warehouse?.current_snapshot_id;
  const currentLineage = lineage?.source_snapshots?.find((entry) => entry.snapshot_id === snapshotId);
  if (manifest?.schema !== WAREHOUSE_SCHEMA
    || manifest.mode !== receipt.mode
    || manifest.serving_eligible !== false
    || manifest.current_snapshot_id !== snapshotId
    || receipt.source?.revision !== snapshotId
    || receipt.warehouse?.schema !== manifest.schema
    || receipt.warehouse?.event_schema !== manifest.transforms?.event_schema
    || manifest.partition_count !== 64
    || receipt.counts?.canonical_partitions !== 64
    || manifest.partition_count !== receipt.counts.canonical_partitions
    || manifest.canonical_row_count !== receipt.counts.canonical_rows
    || manifest.active_row_count !== receipt.counts.active_rows
    || manifest.removal_candidate_count !== receipt.counts.removal_candidate_rows
    || manifest.applied_snapshot_ids?.length !== receipt.counts.source_snapshots
    || manifest.coverage?.earliest_scope_start !== receipt.coverage?.start
    || manifest.coverage?.latest_scope_end_exclusive !== receipt.coverage?.end_exclusive
    || manifest.coverage?.earliest_event_at !== receipt.coverage?.earliest_event_at
    || manifest.coverage?.latest_event_at !== receipt.coverage?.latest_event_at
    || manifest.updated_at !== receipt.clocks?.built_at
    || manifest.latest_quality_report !== artifacts.latest_quality_report.path.replace(/^warehouse\//, '')
    || manifest.latest_revision_report !== artifacts.latest_revision_report.path.replace(/^warehouse\//, '')
    || manifest.lineage_registry !== artifacts.lineage_registry.path.replace(/^warehouse\//, '')
    || manifest.transforms?.corridor_registry_id !== null) {
    throw new Error('Known Route M1 receipt to manifest binding drifted.');
  }
  if (checkpoint?.schema !== artifacts.backfill_checkpoint.schema
    || checkpoint.periods?.length !== receipt.counts.source_snapshots
    || Object.keys(checkpoint.completed || {}).length !== receipt.counts.source_snapshots
    || checkpoint.final_quality?.acquired_rows !== receipt.counts.acquired_rows
    || checkpoint.final_quality?.expected_date_scoped_rows !== receipt.counts.expected_date_scoped_rows
    || checkpoint.final_quality?.date_scoped_count_complete !== true
    || checkpoint.final_quality?.requested_scope?.start !== receipt.coverage.start
    || checkpoint.final_quality?.requested_scope?.end_exclusive !== receipt.coverage.end_exclusive
    || checkpoint.updated_at !== receipt.clocks?.observed_at
    || lineage?.schema !== artifacts.lineage_registry.schema
    || lineage.source_snapshots?.length !== receipt.counts.source_snapshots
    || currentLineage?.row_count !== currentSource?.row_count
    || stableText(lineage.canonical_partitions) !== stableText(manifest.canonical_partitions)
    || lineage.model_input_contract?.serving_status !== 'not-published'
    || quality?.schema !== artifacts.latest_quality_report.schema
    || quality.snapshot_id !== snapshotId
    || quality.data_status !== receipt.data_quality?.status
    || stableText(quality.status_semantics) !== stableText(receipt.data_quality?.status_semantics)
    || stableText(quality.coordinate) !== stableText(receipt.data_quality?.coordinate)
    || stableText(quality.join_coverage?.tract) !== stableText(receipt.data_quality?.tract)
    || stableText(quality.join_coverage?.fixed_grid) !== stableText(receipt.data_quality?.fixed_grid)
    || stableText(quality.join_coverage?.route_corridor) !== stableText(receipt.data_quality?.route_corridor)
    || stableText(quality.join_coverage?.acs_estimate_moe) !== stableText(receipt.data_quality?.acs_estimate_moe)
    || quality.labels?.unknown_observed?.length !== receipt.data_quality?.unknown_label_count
    || revision?.schema !== artifacts.latest_revision_report.schema
    || revision.snapshot_id !== snapshotId
    || stableText(revision.counts) !== stableText(artifacts.canonical?.revision_counts)
    || currentSource?.schema !== artifacts.current_source_manifest.schema
    || currentSource.snapshot_id !== snapshotId
    || currentSource.dataset_id !== receipt.source?.dataset_id
    || currentSource.provider !== receipt.source?.provider
    || currentSource.source_table !== receipt.source?.source_table
    || currentSource.source_vintage?.source_as_of !== receipt.clocks?.source_as_of
    || currentSource.source_vintage?.retrieved_at !== receipt.clocks?.retrieved_at) {
    throw new Error('Known Route M1 receipt to checkpoint, lineage, quality, revision, or current source binding drifted.');
  }
  assertM1Clocks(receipt);
  assertM1DataQuality(receipt.data_quality, receipt.counts.canonical_rows);

  const declaredBindings = artifacts.canonical?.partition_bindings;
  if (artifacts.canonical?.path !== 'warehouse/canonical'
    || artifacts.canonical?.partition_count !== 64
    || !Array.isArray(declaredBindings) || declaredBindings.length !== 64
    || stableText(declaredBindings) !== stableText(manifest.canonical_partitions)) {
    throw new Error('Known Route M1 canonical partition declarations are incomplete or drifted.');
  }
  const canonicalRoot = path.join(root, 'warehouse', 'canonical');
  const actualNames = (await fs.readdir(canonicalRoot, { withFileTypes: true }))
    .map((entry) => ({ name: entry.name, file: entry.isFile(), symbolic: entry.isSymbolicLink() }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const expectedNames = declaredBindings.map((_, index) => `part-${String(index).padStart(3, '0')}.jsonl`);
  if (actualNames.length !== expectedNames.length
    || actualNames.some((entry, index) => entry.name !== expectedNames[index] || !entry.file || entry.symbolic)) {
    throw new Error('Known Route actual canonical partition set has an extra, missing, renamed, or non-file entry.');
  }
  const partitions = [];
  for (const [index, declared] of declaredBindings.entries()) {
    const name = expectedNames[index];
    if (declared?.partition !== index || declared.path !== `canonical/${name}`
      || !Number.isSafeInteger(declared.row_count) || declared.row_count < 0
      || !Number.isSafeInteger(declared.bytes) || declared.bytes < 1
      || !digest(declared.identity)) {
      throw new Error(`Known Route M1 canonical binding ${index} is invalid.`);
    }
    const absolutePath = path.join(canonicalRoot, name);
    const actual = await inspectJsonLinesArtifact(absolutePath, `M1 canonical partition ${index}`);
    if (actual.rowCount !== declared.row_count || actual.bytes !== declared.bytes || actual.sha256 !== declared.identity) {
      throw new Error(`Known Route M1 canonical partition ${index} rows, bytes, or SHA-256 drifted.`);
    }
    partitions.push({
      partition: index,
      path: declared.path,
      rowCount: actual.rowCount,
      bytes: actual.bytes,
      sha256: actual.sha256,
      absolutePath,
      mtimeMs: actual.mtimeMs,
    });
  }
  const rowCount = partitions.reduce((sum, part) => sum + part.rowCount, 0);
  const bytes = partitions.reduce((sum, part) => sum + part.bytes, 0);
  const partitionSetIdentity = identityOf(partitions.map((part) => ({
    path: `warehouse/${part.path}`,
    bytes: part.bytes,
    sha256: part.sha256,
  })));
  if (rowCount !== receipt.counts.canonical_rows
    || bytes !== artifacts.canonical.bytes
    || partitionSetIdentity !== artifacts.canonical.sha256) {
    throw new Error('Known Route M1 canonical partition set rows, bytes, or aggregate identity drifted.');
  }
  return {
    root,
    receipt,
    receiptDigest: receiptArtifact.sha256,
    manifest,
    manifestIdentity: bound.warehouse_manifest.sha256,
    partitionSetIdentity,
    partitions,
    summary: {
      receiptIdentity: receipt.identity,
      receiptDigest: receiptArtifact.sha256,
      manifestIdentity: bound.warehouse_manifest.sha256,
      partitionSetIdentity,
      partitionCount: partitions.length,
      canonicalRows: rowCount,
      canonicalBytes: bytes,
    },
  };
}

export async function validateM2Governance({
  evidenceRoot,
  expectedMartIdentity,
  implementationTip,
  executionRecordTip,
  cumulativeTip,
  expectedM1ReceiptIdentity,
  expectedM1Revision,
  expectedM1Coverage,
  expectedM1Rows,
  protocolPath = DEFAULT_PROTOCOL_PATH,
  validateMart = validateAreaIntelligenceMartForEvaluation,
  verifyTips = verifyCommitChain,
} = {}) {
  if (!evidenceRoot || !digest(expectedMartIdentity)
    || !digest(expectedM1ReceiptIdentity) || !digest(expectedM1Revision)
    || !commit(implementationTip) || !commit(executionRecordTip) || !commit(cumulativeTip)) {
    throw new Error('Known Route M2 governance preflight requires exact root, identities, and commit tips.');
  }
  await verifyTips({ implementationTip, executionRecordTip, cumulativeTip });
  const root = await canonicalDirectory(evidenceRoot, 'M2 evidence root');
  const martGate = await validateMart({ martRoot: root, protocolPath });
  if (martGate.martManifest?.artifact_identity !== expectedMartIdentity
    || martGate.martInventory?.row_count !== martGate.martManifest?.row_count
    || martGate.martInventory?.bytes !== martGate.martManifest?.bytes) {
    throw new Error('Known Route M2 mart identity or exact inventory drifted.');
  }
  const evaluation = await readJsonArtifact(path.join(root, 'evaluation', 'manifest.json'), 'M2 evaluation manifest');
  const report = await readJsonArtifact(path.join(root, 'evaluation', 'model-evaluation-report.json'), 'M2 evaluation receipt');
  validateModelEvaluationReport(report.value);
  const descriptor = evaluation.value.artifacts?.find((artifact) => artifact.name === 'model-evaluation-report.json');
  const seam = evaluation.value.lineage_seam;
  if (evaluation.value.schema !== 'engagement-area-intelligence-evaluation-run/v2'
    || report.value.schema !== 'ModelEvaluationReport/v1'
    || report.value.protocol?.schema !== 'engagement-area-intelligence-evaluation-protocol/v2'
    || report.value.protocol?.frozen_before_model_performance !== true
    || report.value.protocol?.sha256 !== evaluation.value.protocol_sha256
    || report.value.protocol?.sha256 !== seam?.protocol?.sha256
    || report.value.data?.mart_artifact_identity !== expectedMartIdentity
    || report.value.data?.mart_manifest_sha256 !== evaluation.value.mart_manifest_sha256
    || report.value.data?.source_vintage !== expectedM1Revision
    || report.value.data?.admission?.canonical_rows_seen !== expectedM1Rows
    || report.value.promotion?.status !== 'not-promoted'
    || evaluation.value.mart_artifact_identity !== expectedMartIdentity
    || evaluation.value.promotion?.status !== 'not-promoted'
    || evaluation.value.promotion?.selected_model !== null
    || evaluation.value.availability !== 'unavailable'
    || seam?.m1_receipt?.identity !== expectedM1ReceiptIdentity
    || seam?.mart?.artifact_identity !== expectedMartIdentity
    || seam?.outcome?.promotion_status !== 'not-promoted'
    || seam?.outcome?.selected_model !== null
    || seam?.outcome?.availability !== 'unavailable'
    || descriptor?.bytes !== report.bytes
    || `sha256:${descriptor?.sha256}` !== report.sha256) {
    throw new Error('Known Route M2 evaluation receipt, lineage, outcome, or artifact binding drifted.');
  }
  const reportCoverage = report.value.data?.coverage;
  if (reportCoverage?.earliest_scope_start !== expectedM1Coverage?.start
    || reportCoverage?.latest_scope_end_exclusive !== expectedM1Coverage?.end_exclusive
    || reportCoverage?.latest_event_at !== expectedM1Coverage?.latest_event_at) {
    throw new Error('Known Route M2 evaluation coverage drifted from the exact M1 receipt.');
  }
  assertM2Admission(report.value.data.admission, expectedM1Rows);
  return {
    identity: {
      'data.mart_artifact_identity': report.value.data.mart_artifact_identity,
      'data.source_vintage': report.value.data.source_vintage,
    },
    revision: {
      generated_at: report.value.generated_at,
      'protocol.sha256': report.value.protocol.sha256,
    },
    receiptDigest: report.sha256,
    canonicalPath: report.canonicalPath,
    evidenceRoot: root,
    implementationTip,
    executionRecordTip,
    cumulativeTip,
    dq: structuredClone(report.value.data.admission),
    dqRechecked: true,
    outcome: { promotionStatus: 'not-promoted', selectedModel: null, availability: 'unavailable' },
    routeEvidenceAuthority: false,
  };
}

async function verifyCommitChain({ implementationTip, executionRecordTip, cumulativeTip }) {
  for (const tip of [implementationTip, executionRecordTip, cumulativeTip]) {
    await execFileAsync('git', ['cat-file', '-e', `${tip}^{commit}`]);
  }
  for (const [ancestor, descendant] of [[implementationTip, executionRecordTip], [executionRecordTip, cumulativeTip]]) {
    try {
      await execFileAsync('git', ['merge-base', '--is-ancestor', ancestor, descendant]);
    } catch {
      throw new Error('Known Route M2 governance commit tips are not an exact ancestor chain.');
    }
  }
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD']);
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', cumulativeTip, stdout.trim()]);
  } catch {
    throw new Error('Known Route M2 cumulative tip is not an ancestor of the M4 implementation.');
  }
}

async function streamCanonicalPartition(file, accumulator, partition) {
  const input = createReadStream(file, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        throw new Error(`Canonical partition ${partition} contains invalid JSON at line ${lineNumber}.`);
      }
      addCanonicalGeneralizedIncident(accumulator, event);
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

async function inspectJsonLinesArtifact(file, label) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} is not an exact regular file.`);
  const hash = createHash('sha256');
  let bytes = 0;
  const stream = createReadStream(file, { highWaterMark: 1024 * 1024 });
  stream.on('data', (chunk) => { hash.update(chunk); bytes += chunk.length; });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let rowCount = 0;
  try {
    for await (const line of lines) {
      if (!line) continue;
      try { JSON.parse(line); } catch { throw new Error(`${label} contains invalid JSON at row ${rowCount + 1}.`); }
      rowCount += 1;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  if (bytes !== stat.size) throw new Error(`${label} changed while it was inspected.`);
  return { rowCount, bytes, sha256: `sha256:${hash.digest('hex')}`, mtimeMs: stat.mtimeMs };
}

async function readBoundArtifact(root, descriptor, label) {
  if (!descriptor || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 1
    || !digest(descriptor.sha256) || typeof descriptor.schema !== 'string') {
    throw new Error(`Known Route M1 receipt artifact ${label} descriptor is invalid.`);
  }
  const file = resolveRelativeArtifact(root, descriptor.path, label);
  const artifact = await readJsonArtifact(file, label);
  if (artifact.bytes !== descriptor.bytes || artifact.sha256 !== descriptor.sha256
    || artifact.value?.schema !== descriptor.schema) {
    throw new Error(`Known Route M1 receipt artifact ${label} bytes, SHA-256, or schema drifted.`);
  }
  return artifact;
}

async function readJsonArtifact(file, label) {
  const canonicalPath = await canonicalFile(file, label);
  const bytes = await fs.readFile(canonicalPath);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error(`${label} is not valid JSON.`); }
  return {
    value,
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    canonicalPath,
  };
}

function createFinalArtifacts({ checkpoint, warehouseGate, match, catalog, accumulator, m2Governance }) {
  const report = createSafeKnownRouteAggregateReport({
    warehouseReceipt: warehouseGate.receipt,
    warehouseReceiptDigest: warehouseGate.receiptDigest,
    warehouseManifestIdentity: warehouseGate.manifestIdentity,
    partitionSetIdentity: warehouseGate.partitionSetIdentity,
    routeIdentity: checkpoint.routeIdentity,
    catalogIdentity: checkpoint.catalogIdentity,
    match,
    catalogFeatureCount: catalog.featureCount,
    accumulator,
    completion: checkpoint.completion,
  });
  const handoff = createKnownRouteEvidenceFinalHandoff({
    checkpoint,
    warehouseReceipt: warehouseGate.receipt,
    m2Governance,
    publicCenterlineRequest: true,
  });
  return {
    'checkpoint.json': checkpoint,
    'aggregate-report.json': report,
    'final-handoff.json': handoff,
  };
}

function buildResult({ report, handoff, checkpoint, outputRoot, restoredCompletedCheckpoint, idempotent }) {
  return {
    status: report.status,
    publicRoute: 'public-non-private-fixture',
    warehouseRowsRead: report.warehouse.canonicalRowsRead,
    partitions: report.warehouse.partitionCount,
    eligibleGeneralizedRows: report.reportedIncidentEvidence.route.eligibleGeneralizedRows,
    contributingRows: report.reportedIncidentEvidence.route.contributingRows,
    excludedRows: Object.values(report.reportedIncidentEvidence.excluded).reduce((sum, value) => sum + value, 0),
    routeContributionUnits: report.reportedIncidentEvidence.route.contributionUnits,
    analysisSegments: report.reportedIncidentEvidence.segments.length,
    durationMs: checkpoint.completion.durationMs,
    maximumRssBytes: checkpoint.completion.maximumRssBytes,
    restoredCompletedCheckpoint,
    idempotent,
    semanticIdentity: report.semanticIdentity,
    handoffIdentity: handoff.identity,
    report: path.relative(process.cwd(), path.join(outputRoot, 'aggregate-report.json')).replaceAll('\\', '/'),
    handoff: path.relative(process.cwd(), path.join(outputRoot, 'final-handoff.json')).replaceAll('\\', '/'),
  };
}

function assertM1DataQuality(dq, rows) {
  if (dq?.status !== 'available'
    || dq.status_semantics?.unavailable_is_zero !== false
    || dq.status_semantics?.partial_is_current !== false
    || dq.status_semantics?.stale_is_current !== false
    || dq.status_semantics?.zero_requires_complete_query !== true) {
    throw new Error('Known Route M1 data-quality status semantics drifted.');
  }
  const groups = [
    dq.coordinate,
    dq.tract,
    dq.fixed_grid,
    { available: dq.route_corridor?.available, unavailable: dq.route_corridor?.unavailable },
    dq.acs_estimate_moe,
  ];
  if (groups.some((group) => !group || Object.values(group).some((value) => !Number.isSafeInteger(value) || value < 0)
    || Object.values(group).reduce((sum, value) => sum + value, 0) !== rows)
    || dq.route_corridor?.matches !== 0 || dq.unknown_label_count !== 0) {
    throw new Error('Known Route M1 data-quality counts do not reconcile with canonical rows.');
  }
}

function assertM1Clocks(receipt) {
  const clocks = [
    receipt.clocks?.source_as_of,
    receipt.clocks?.retrieved_at,
    receipt.clocks?.built_at,
    receipt.clocks?.observed_at,
  ];
  if (clocks.some((value) => typeof value !== 'string' || new Date(value).toISOString() !== value)
    || clocks.some((value, index) => index && Date.parse(value) < Date.parse(clocks[index - 1]))
    || receipt.coverage?.latest_event_at > receipt.clocks.source_as_of) {
    throw new Error('Known Route M1 receipt four-clock or source coverage order drifted.');
  }
}

function assertM2Admission(admission, rows) {
  if (!admission || admission.canonical_rows_seen !== rows
    || admission.tract?.admitted + admission.tract?.ambiguous_excluded + admission.tract?.unmapped_excluded !== rows
    || admission['fixed-grid']?.admitted + admission['fixed-grid']?.unavailable_excluded !== rows
    || admission.unknown_category !== 0 || admission.invalid_event_time !== 0 || admission.non_active !== 0) {
    throw new Error('Known Route M2 DQ recheck did not reconcile with the exact M1 rows.');
  }
}

function normalizeOptions(options) {
  const required = [
    'warehouse', 'warehouseReceiptIdentity', 'm2EvidenceRoot', 'm2MartIdentity',
    'm2ImplementationTip', 'm2ExecutionRecordTip', 'm2CumulativeTip',
  ];
  for (const key of required) if (!options[key]) throw new Error(`Known Route build requires ${optionName(key)}.`);
  return { ...options };
}

function optionName(key) {
  return `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function parseOptions(args) {
  const result = {};
  const flags = new Map([
    ['warehouse', 'warehouse'],
    ['warehouse-receipt-identity', 'warehouseReceiptIdentity'],
    ['output', 'output'],
    ['route-input', 'routeInput'],
    ['m2-evidence-root', 'm2EvidenceRoot'],
    ['m2-mart-identity', 'm2MartIdentity'],
    ['m2-implementation-tip', 'm2ImplementationTip'],
    ['m2-execution-record-tip', 'm2ExecutionRecordTip'],
    ['m2-cumulative-tip', 'm2CumulativeTip'],
    ['m2-protocol-path', 'm2ProtocolPath'],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--allow-public-centerline-request') result.allowPublicCenterlineRequest = true;
    else if (value === '--validate-only') result.validateOnly = true;
    else if (value.startsWith('--')) {
      const [rawName, inline] = value.slice(2).split(/=(.*)/s, 2);
      const key = flags.get(rawName);
      if (!key) throw new Error(`Unknown Known Route build option: ${value}`);
      result[key] = inline ?? args[++index];
      if (!result[key]) throw new Error(`Known Route build option --${rawName} requires a value.`);
    } else throw new Error(`Unknown Known Route build option: ${value}`);
  }
  return result;
}

function requireTaskOwnedPath(file) {
  const taskRoot = path.resolve('.dfev1', 'known-route-evidence-v1');
  const relative = path.relative(taskRoot, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Known Route build output and public input must stay under the task-owned ignored directory.');
  }
}

async function requireFreshOutputRoot(outputRoot, ownedFiles) {
  const entries = await fs.readdir(outputRoot);
  if (entries.length || ownedFiles.some((file) => path.dirname(file) !== outputRoot)) {
    throw new Error('Known Route output root is not fresh and contains no valid checkpoint.');
  }
}

async function readPublicRoute(file) {
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  if (value?.schema !== 'known-route-public-smoke/v1'
    || typeof value.label !== 'string' || !value.label.trim()
    || typeof value.disclosure !== 'string' || !/public, non-private/i.test(value.disclosure)
    || !value.routeInput || Object.keys(value).some((key) => !['schema', 'label', 'disclosure', 'routeInput'].includes(key))) {
    throw new Error('Known Route public build input is invalid.');
  }
  return value;
}

async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function assertExactFinalArtifacts(outputRoot, artifacts) {
  for (const [name, value] of Object.entries(artifacts)) {
    const expected = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    let actual;
    try { actual = await fs.readFile(path.join(outputRoot, name)); } catch (error) {
      throw new Error(`Completed Known Route artifact ${name} is missing: ${error?.message || error}`);
    }
    if (!actual.equals(expected)) {
      throw new Error(`Completed Known Route artifact ${name} drifted; refusing to rewrite a completed exact run.`);
    }
  }
}

function resolveRelativeArtifact(root, relative, label) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || path.posix.isAbsolute(relative)
    || relative.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Known Route ${label} path is not a safe relative artifact path.`);
  }
  const resolved = path.resolve(root, ...relative.split('/'));
  const relation = path.relative(root, resolved);
  if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new Error(`Known Route ${label} escaped its evidence root.`);
  }
  return resolved;
}

async function canonicalDirectory(directory, label) {
  const resolved = path.resolve(directory);
  const canonical = await fs.realpath(resolved);
  const stat = await fs.lstat(canonical);
  if (!stat.isDirectory() || canonical !== resolved) throw new Error(`${label} must be an exact canonical directory.`);
  return canonical;
}

async function canonicalFile(file, label) {
  const resolved = path.resolve(file);
  const canonical = await fs.realpath(resolved);
  const stat = await fs.lstat(canonical);
  if (!stat.isFile() || stat.isSymbolicLink() || canonical !== resolved) throw new Error(`${label} must be an exact canonical file.`);
  return canonical;
}

async function pathExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

function exactNow(now) {
  const value = now ? now() : new Date();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('Known Route build clock is invalid.');
  return value.toISOString();
}

function digest(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function commit(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const result = await runKnownRouteEvidenceBuild(parseOptions(process.argv.slice(2)), {
      onProgress(value) {
        process.stdout.write(`[known-route-evidence-build] partition ${value.partition}/${value.partitionCount}: ${value.rowsAdded} rows; cumulative ${value.rowsRead}.\n`);
      },
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`[known-route-evidence-build] unavailable: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
